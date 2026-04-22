import {
    AudioGetState,
    AudioQueueNextTrack,
    AudioQueueNextTrackWithReplayGainContext,
    InitializeAudioBackend,
    LogFrontendMessage,
} from '../wailsjs/go/main/App';
import { applyMbLinks } from './musicbrainz';
import { updateExplorationButton } from './components/media-controls-exploration';
import { renderPlayPauseIcon } from './components/media-controls';
import type { AppNowPlayingRuntimeContext } from './app-runtime-setup';
import { createAppReleaseRuntime } from './app-release-runtime';
import type { AppLibraryFolder, AudioPlaybackState, ImageLibraryFile, TextLibraryFile, Track } from './types/app-types';
import {
    asReleaseDepth,
    buildLibraryRootNameByPath,
    effectivePlaybackTechnicalMetadata,
    findLibraryFolderForFilePath,
    findLibraryFolderForTrack,
    formatTime,
    isTrackScrobbleAllowed,
    libraryFolderPathKey,
    taggedTrackPosition,
} from './utils/main-helpers';
import {
    composeTechnicalLabel,
    describeErrorForLog,
    formatSortArtist,
    getFirstTag,
    getReleaseCat,
    getReleaseLabel,
    matchesSilenceTitleHeuristic,
    setTechnicalLabel,
} from './utils/display-helpers';
import { runBackgroundBridgeCall, shouldDeferBackgroundBridgeCall } from './utils/bridge-load-gate';
import { formatPerfLogMessage } from './utils/perf-log';
import { createPlaybackProgressEstimator } from './utils/playback-progress-estimator';
import { playbackReconcileDelayMs } from './utils/playback-reconcile-delay';
import { createSerialAsyncPoller } from './utils/serial-async-poller';

export const createAppNowPlayingRuntime = (context: AppNowPlayingRuntimeContext) => {
    const playbackProgressDomUpdateThresholdSeconds = 0.05;
    const settledTransitionMetadataRefreshThresholdSeconds = 0.05;
    const settledTransitionMetadataRefreshProbeMs = 50;
    const playerCardTrackTransitionOutMs = 90;
    const nextTrackPreloadStartSeconds = 1;
    const lyricsPanelWidthPx = 400;
    const lyricsVisibilityBufferPx = 120;
    const playbackProgressEstimator = createPlaybackProgressEstimator();
    const devPerfLoggingEnabled = import.meta.env.DEV && typeof (globalThis as { vi?: unknown }).vi === 'undefined';
    let playbackProgressAnimationFrameId = 0;
    let playbackProgressEndSyncRequested = false;
    let playbackStateSyncInFlight = false;
    let lastAudioStatePerfLogAtMs = 0;
    let lastPlayerCardHeightPx = 0;
    let lastLyricsVisibilityState: boolean | null = null;
    let deferredPlaybackEffectsHandle: number | undefined;
    let settledTransitionMetadataRefreshHandle: number | undefined;
    let settledTransitionMetadataRefreshDeferred = false;
    let pendingSettledTransitionMetadataRefreshPath = '';
    let queuedTrackCoverPrefetchPath = '';
    let playerCardTrackTransitionHandle: number | undefined;
    let playerCardTrackTransitionFrameHandle = 0;
    let playerCardTrackTransitionVersion = 0;

    const clearPlayerCardTrackTransition = (): void => {
        playerCardTrackTransitionVersion += 1;
        if (playerCardTrackTransitionHandle !== undefined) {
            window.clearTimeout(playerCardTrackTransitionHandle);
            playerCardTrackTransitionHandle = undefined;
        }

        if (playerCardTrackTransitionFrameHandle !== 0) {
            window.cancelAnimationFrame(playerCardTrackTransitionFrameHandle);
            playerCardTrackTransitionFrameHandle = 0;
        }

        context.playerCard.classList.remove('is-track-transitioning');
    };

    const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const runPlayerCardTrackTransition = (applyUpdate: () => void): void => {
        clearPlayerCardTrackTransition();
        if (prefersReducedMotion()) {
            applyUpdate();
            return;
        }

        const transitionVersion = playerCardTrackTransitionVersion;
        context.playerCard.classList.add('is-track-transitioning');
        playerCardTrackTransitionHandle = window.setTimeout(() => {
            if (transitionVersion !== playerCardTrackTransitionVersion) {
                return;
            }

            playerCardTrackTransitionHandle = undefined;
            applyUpdate();
            playerCardTrackTransitionFrameHandle = window.requestAnimationFrame(() => {
                playerCardTrackTransitionFrameHandle = 0;
                if (transitionVersion !== playerCardTrackTransitionVersion) {
                    return;
                }

                context.playerCard.classList.remove('is-track-transitioning');
            });
        }, playerCardTrackTransitionOutMs);
    };

    const clearSettledTransitionMetadataRefresh = (): void => {
        pendingSettledTransitionMetadataRefreshPath = '';
        settledTransitionMetadataRefreshDeferred = false;
        if (settledTransitionMetadataRefreshHandle !== undefined) {
            window.clearTimeout(settledTransitionMetadataRefreshHandle);
            settledTransitionMetadataRefreshHandle = undefined;
        }
    };

    const maybeRefreshSettledTransitionMetadata = (): void => {
        if (pendingSettledTransitionMetadataRefreshPath === '') {
            return;
        }

        const estimatedState = playbackProgressEstimator.estimate();
        if (!estimatedState.loaded) {
            clearSettledTransitionMetadataRefresh();
            return;
        }

        const pendingPathKey = trackPathKey(pendingSettledTransitionMetadataRefreshPath);
        const estimatedPathKey = trackPathKey(estimatedState.sourcePath || '');
        if (estimatedPathKey === '' || estimatedPathKey !== pendingPathKey) {
            clearSettledTransitionMetadataRefresh();
            return;
        }

        const activeTrack = context.tracks[context.currentTrackIndex];
        if (!activeTrack || trackPathKey(activeTrack.path) !== pendingPathKey) {
            clearSettledTransitionMetadataRefresh();
            return;
        }

        if (estimatedState.playing && estimatedState.currentTime < settledTransitionMetadataRefreshThresholdSeconds) {
            if (!settledTransitionMetadataRefreshDeferred) {
                settledTransitionMetadataRefreshDeferred = true;
                settledTransitionMetadataRefreshHandle = window.setTimeout(() => {
                    settledTransitionMetadataRefreshHandle = undefined;
                    maybeRefreshSettledTransitionMetadata();
                }, settledTransitionMetadataRefreshProbeMs);
                return;
            }
        }

        clearSettledTransitionMetadataRefresh();
        void refreshCurrentTrackMetadata().catch((error: unknown) => {
            console.error(error);
        });
    };

    const logSlowAudioStatePoll = (elapsedMs: number): void => {
        if (!devPerfLoggingEnabled) {
            return;
        }

        const nowMs = Date.now();
        if (nowMs - lastAudioStatePerfLogAtMs < 1500) {
            return;
        }

        lastAudioStatePerfLogAtMs = nowMs;
        const message = formatPerfLogMessage(`slow bridge AudioGetState ${elapsedMs.toFixed(1)}ms`);
        console.warn(message);
        void LogFrontendMessage(message).catch(() => undefined);
    };

    const scheduleDeferredPlaybackStateEffects = (nextState: AudioPlaybackState): void => {
        if (deferredPlaybackEffectsHandle !== undefined) {
            window.clearTimeout(deferredPlaybackEffectsHandle);
        }

        deferredPlaybackEffectsHandle = window.setTimeout(() => {
            deferredPlaybackEffectsHandle = undefined;
            maybeSubmitListenBrainz(nextState);
            context.updateMediaSessionMetadata();
            context.updateMediaSessionPlaybackState();
            context.updateMediaSessionPositionState();
            syncPlaybackProgressLoop();
            playbackPoller.poke();
            void queueGaplessNextTrack(nextState);
        }, 0);
    };

    const stopPlaybackProgressLoop = (): void => {
        if (playbackProgressAnimationFrameId === 0) {
            return;
        }

        window.cancelAnimationFrame(playbackProgressAnimationFrameId);
        playbackProgressAnimationFrameId = 0;
    };

    const requestPlaybackStateReconcile = (): void => {
        if (playbackStateSyncInFlight) {
            return;
        }

        void syncPlaybackState();
    };

    const tickPlaybackProgressLoop = (): void => {
        playbackProgressAnimationFrameId = 0;
        const estimatedState = playbackProgressEstimator.estimate();
        const currentPlaybackState = context.playbackStateService.getPlaybackState();
        const currentTimeDelta = Math.abs(estimatedState.currentTime - currentPlaybackState.currentTime);

        if (estimatedState.loaded && estimatedState.playing && currentTimeDelta >= playbackProgressDomUpdateThresholdSeconds) {
            if (context.playbackStateService.setCurrentTime(estimatedState.currentTime)) {
                updateTrackLabels();
                context.updateMediaSessionPositionState();
            }
        }

        if (estimatedState.loaded && estimatedState.playing) {
            const remainingSeconds = Number.isFinite(estimatedState.duration)
                ? estimatedState.duration - estimatedState.currentTime
                : Number.POSITIVE_INFINITY;
            if (remainingSeconds <= playbackProgressDomUpdateThresholdSeconds && !playbackProgressEndSyncRequested) {
                playbackProgressEndSyncRequested = true;
                requestPlaybackStateReconcile();
            }

            playbackProgressAnimationFrameId = window.requestAnimationFrame(() => {
                tickPlaybackProgressLoop();
            });
            return;
        }

        stopPlaybackProgressLoop();
    };

    const syncPlaybackProgressLoop = (): void => {
        const playbackState = context.playbackStateService.getPlaybackState();
        if (!playbackState.loaded || !playbackState.playing) {
            stopPlaybackProgressLoop();
            return;
        }

        if (playbackProgressAnimationFrameId !== 0) {
            return;
        }

        playbackProgressAnimationFrameId = window.requestAnimationFrame(() => {
            tickPlaybackProgressLoop();
        });
    };

    const scheduleNowPlayingCoverRefresh = (): void => {
        if (context.pendingNowPlayingCoverRefreshHandle !== null) {
            window.clearTimeout(context.pendingNowPlayingCoverRefreshHandle);
        }

        context.pendingNowPlayingCoverRefreshHandle = window.setTimeout(() => {
            context.pendingNowPlayingCoverRefreshHandle = null;

            if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
                return;
            }

            const activeTrack = context.tracks[context.currentTrackIndex];
            if (!activeTrack) {
                return;
            }

            context.coverArtService.invalidateResolvedForTrack(activeTrack);
            void applyCoverArtForTrack(context.currentTrackIndex);
        }, context.nowPlayingCoverRefreshDebounceMs);
    };

    const rebuildTrackPathIndex = (): void => {
        context.trackIndexByPath.clear();
        context.tracks.forEach((track: Track, index: number) => {
            context.trackIndexByPath.set(track.path.toLowerCase(), index);
        });
    };

    const rebuildTextFilePathIndex = (): void => {
        context.textFileIndexByPath.clear();
        context.textFiles.forEach((textFile: TextLibraryFile, index: number) => {
            context.textFileIndexByPath.set(textFile.path.toLowerCase(), index);
        });
    };

    const rebuildImageFilePathIndex = (): void => {
        context.imageFileIndexByPath.clear();
        context.imageFiles.forEach((imageFile: ImageLibraryFile, index: number) => {
            context.imageFileIndexByPath.set(imageFile.path.toLowerCase(), index);
        });
    };

    const configuredLibraryFolderForPath = (path: string): AppLibraryFolder | null => {
        return findLibraryFolderForFilePath(path, context.currentSettings.libraryFolders);
    };

    const configuredLibraryRootNameByPath = (): Map<string, string> => {
        return buildLibraryRootNameByPath(context.currentSettings.libraryFolders);
    };

    const releaseDepthForTrack = (track: Pick<Track, 'rootPath' | 'path' | 'releaseDepth'>): number => {
        if (typeof track.releaseDepth === 'number' && Number.isFinite(track.releaseDepth)) {
            return asReleaseDepth(track.releaseDepth);
        }

        const folder = findLibraryFolderForTrack(track as Pick<Track, 'rootPath' | 'path'>, context.currentSettings.libraryFolders)
            || configuredLibraryFolderForPath(track.rootPath || '');
        return folder ? asReleaseDepth(folder.releaseDepth) : 0;
    };

    const trackIndexForPath = (path: string): number => {
        const normalizedPath = path.trim().toLowerCase();
        if (!normalizedPath) {
            return -1;
        }

        const cached = context.trackIndexByPath.get(normalizedPath);
        if (cached !== undefined) {
            return cached;
        }

        const foundIndex = context.tracks.findIndex((track: Track) => track.path.toLowerCase() === normalizedPath);
        if (foundIndex >= 0) {
            context.trackIndexByPath.set(normalizedPath, foundIndex);
        }

        return foundIndex;
    };

    const trackPathKey = (path: string): string => path.trim().toLowerCase();

    const {
        cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack,
        clearReplayGainReleaseDynamicRangeCache,
        collectReleaseImageFiles,
        collectReplayGainReleaseTrackPathsForIndex,
        currentReplayGainReleaseTrackPaths,
        indexOfImageByPath,
        refreshReplayGainReleaseDynamicRangeIndicator,
        releaseRootPathForTrack,
        replayGainReleaseDynamicRangeCacheKey,
        replayGainReleaseKeyForTrack,
        replayGainReleaseTrackPaths,
        replayGainReleaseTrackPathsForIndex,
    } = createAppReleaseRuntime({
        get tracks() {
            return context.tracks;
        },
        set tracks(value) {
            context.tracks = value;
        },
        get imageFiles() {
            return context.imageFiles;
        },
        set imageFiles(value) {
            context.imageFiles = value;
        },
        get currentTrackIndex() {
            return context.currentTrackIndex;
        },
        set currentTrackIndex(value) {
            context.currentTrackIndex = value;
        },
        get currentSettings() {
            return context.currentSettings;
        },
        set currentSettings(value) {
            context.currentSettings = value;
        },
        get activeReplayGainReleaseTrackPaths() {
            return context.activeReplayGainReleaseTrackPaths;
        },
        set activeReplayGainReleaseTrackPaths(value) {
            context.activeReplayGainReleaseTrackPaths = value;
        },
        replayGainReleaseDynamicRangeLabelByKey: context.replayGainReleaseDynamicRangeLabelByKey,
        replayGainReleaseDynamicRangePendingByKey: context.replayGainReleaseDynamicRangePendingByKey,
        get replayGainReleaseDynamicRangeRequestVersion() {
            return context.replayGainReleaseDynamicRangeRequestVersion;
        },
        set replayGainReleaseDynamicRangeRequestVersion(value) {
            context.replayGainReleaseDynamicRangeRequestVersion = value;
        },
        releaseDepthForTrack,
        get playlistController() {
            return context.playlistController();
        },
        baseSequenceIndexes: () => baseSequenceIndexes(),
        trackPathKey,
        updateNowPlayingTechnicalLabels: () => {
            updateNowPlayingTechnicalLabels();
        },
    });

    const normalizeReplayGainReleaseTrackPathsForState = (paths: string[]): string[] => {
        const normalized: string[] = [];
        const seen = new Set<string>();

        for (const path of paths) {
            const cleanPath = path.trim();
            const normalizedPathKey = trackPathKey(cleanPath);
            if (!normalizedPathKey || seen.has(normalizedPathKey)) {
                continue;
            }

            seen.add(normalizedPathKey);
            normalized.push(cleanPath);
        }

        return normalized;
    };

    const setActiveReplayGainReleaseTrackPaths = (releasePaths?: string[]): void => {
        context.activeReplayGainReleaseTrackPaths = Array.isArray(releasePaths)
            ? normalizeReplayGainReleaseTrackPathsForState(releasePaths)
            : [];
    };

    const describeIndexedLibraryFileForPath = (candidatePath: string): {
        name: string;
        path: string;
        relativePath: string;
        folderPath: string;
        rootPath: string;
        rootName: string;
    } => {
        const normalizedPath = candidatePath.trim();
        const normalizedPathForSplit = normalizedPath.replace(/\\/g, '/');
        const segments = normalizedPathForSplit.split('/').filter((segment) => segment !== '');
        const fileName = segments[segments.length - 1] || normalizedPath;

        const matchingLibraryFolder = configuredLibraryFolderForPath(normalizedPath);
        const normalizedRootPath = (matchingLibraryFolder?.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
        const rootName = matchingLibraryFolder
            ? (configuredLibraryRootNameByPath().get(libraryFolderPathKey(matchingLibraryFolder.path)) || '')
            : '';
        const normalizedLowerPath = normalizedPathForSplit.toLowerCase();
        const normalizedLowerRootPath = normalizedRootPath.toLowerCase();

        let relativePath = fileName;
        let folderPath = '';
        if (normalizedRootPath && normalizedLowerPath.startsWith(`${normalizedLowerRootPath}/`)) {
            const libraryRelativePath = normalizedPathForSplit.slice(normalizedRootPath.length + 1);
            const libraryRelativeFolderPath = libraryRelativePath.includes('/')
                ? libraryRelativePath.slice(0, libraryRelativePath.lastIndexOf('/'))
                : '';

            relativePath = rootName ? `${rootName}/${libraryRelativePath}` : libraryRelativePath;
            folderPath = rootName
                ? (libraryRelativeFolderPath ? `${rootName}/${libraryRelativeFolderPath}` : rootName)
                : libraryRelativeFolderPath;
        }

        return {
            name: fileName,
            path: normalizedPath,
            relativePath,
            folderPath,
            rootPath: matchingLibraryFolder?.path || '',
            rootName,
        };
    };

    const createPlaceholderTrackForPath = (trackPath: string): Track => {
        const indexedFile = describeIndexedLibraryFileForPath(trackPath);

        return {
            title: indexedFile.name,
            name: indexedFile.name,
            path: indexedFile.path,
            relativePath: indexedFile.relativePath,
            folderPath: indexedFile.folderPath,
            rootPath: indexedFile.rootPath,
            rootName: indexedFile.rootName,
            displayTitle: indexedFile.name,
            displayAlbum: 'Unknown Album',
            displayArtist: 'Unknown Artist',
            displayTrackNumber: '',
            displayTrackTotal: '',
            displayTechnical: '',
            displayLyrics: '',
            tagsResolved: false,
            mbMetadataResolved: false,
            technicalDetails: {},
            allFileTags: {},
            mbIds: {},
            artistMbids: [],
            mbArtistCredits: [],
        };
    };

    const ensureTrackIndexForPath = (path: string): number => {
        const existingIndex = trackIndexForPath(path);
        if (existingIndex >= 0) {
            return existingIndex;
        }

        const normalizedPath = path.trim();
        if (!normalizedPath) {
            return -1;
        }

        const placeholderTrack = createPlaceholderTrackForPath(normalizedPath);
        context.tracks.push(placeholderTrack);
        const createdIndex = context.tracks.length - 1;
        context.trackIndexByPath.set(normalizedPath.toLowerCase(), createdIndex);
        return createdIndex;
    };

    const ensureTextFileIndexForPath = (path: string): number => {
        const existingIndex = textFileIndexForPath(path);
        if (existingIndex >= 0) {
            return existingIndex;
        }

        const normalizedPath = path.trim();
        if (!normalizedPath) {
            return -1;
        }

        const indexedFile = describeIndexedLibraryFileForPath(normalizedPath);
        context.textFiles.push({
            name: indexedFile.name,
            path: indexedFile.path,
            relativePath: indexedFile.relativePath,
            folderPath: indexedFile.folderPath,
            rootPath: indexedFile.rootPath,
            rootName: indexedFile.rootName,
        });
        const createdIndex = context.textFiles.length - 1;
        context.textFileIndexByPath.set(normalizedPath.toLowerCase(), createdIndex);
        return createdIndex;
    };

    const ensureImageFileIndexForPath = (path: string): number => {
        const existingIndex = imageFileIndexForPath(path);
        if (existingIndex >= 0) {
            return existingIndex;
        }

        const normalizedPath = path.trim();
        if (!normalizedPath) {
            return -1;
        }

        const indexedFile = describeIndexedLibraryFileForPath(normalizedPath);
        context.imageFiles.push({
            name: indexedFile.name,
            path: indexedFile.path,
            relativePath: indexedFile.relativePath,
            folderPath: indexedFile.folderPath,
            rootPath: indexedFile.rootPath,
            rootName: indexedFile.rootName,
        });
        const createdIndex = context.imageFiles.length - 1;
        context.imageFileIndexByPath.set(normalizedPath.toLowerCase(), createdIndex);
        return createdIndex;
    };

    const textFileIndexForPath = (path: string): number => {
        const normalizedPath = path.trim().toLowerCase();
        if (!normalizedPath) {
            return -1;
        }

        const cached = context.textFileIndexByPath.get(normalizedPath);
        if (cached !== undefined) {
            return cached;
        }

        const foundIndex = context.textFiles.findIndex((textFile: TextLibraryFile) => textFile.path.toLowerCase() === normalizedPath);
        if (foundIndex >= 0) {
            context.textFileIndexByPath.set(normalizedPath, foundIndex);
        }

        return foundIndex;
    };

    const imageFileIndexForPath = (path: string): number => {
        const normalizedPath = path.trim().toLowerCase();
        if (!normalizedPath) {
            return -1;
        }

        const cached = context.imageFileIndexByPath.get(normalizedPath);
        if (cached !== undefined) {
            return cached;
        }

        const foundIndex = context.imageFiles.findIndex((imageFile: ImageLibraryFile) => imageFile.path.toLowerCase() === normalizedPath);
        if (foundIndex >= 0) {
            context.imageFileIndexByPath.set(normalizedPath, foundIndex);
        }

        return foundIndex;
    };

    const currentTrackForPlaybackState = (state: AudioPlaybackState): Track | undefined => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return undefined;
        }

        const track = context.tracks[context.currentTrackIndex];
        if (!track || state.sourcePath !== track.path) {
            return undefined;
        }

        return track;
    };

    const normalizePolledPlaybackState = (nextState: AudioPlaybackState): AudioPlaybackState => {
        const previousState = context.playbackStateService.getPlaybackState();
        if (!previousState.loaded || !previousState.playing || !nextState.loaded || nextState.playing) {
            return nextState;
        }

        const previousSourcePathKey = trackPathKey(previousState.sourcePath || '');
        const nextSourcePathKey = trackPathKey(nextState.sourcePath || '');
        if (previousSourcePathKey === '' || nextSourcePathKey === '' || previousSourcePathKey === nextSourcePathKey) {
            return nextState;
        }

        return {
            ...nextState,
            playing: true,
        };
    };

    const applyCoverArtForTrack = async (index: number): Promise<void> => {
        const track = context.tracks[index];
        if (!track) {
            return;
        }

        const coverSrc = await context.resolveCoverForTrack(track);
        if (index !== context.currentTrackIndex) {
            return;
        }

        if (coverSrc) {
            context.coverArtBackground.src = coverSrc;
            context.coverArtBackground.classList.add('is-visible');
            context.coverArt.src = coverSrc;
            context.coverArt.classList.add('is-visible');
            context.setBackgroundCover(coverSrc);
            return;
        }

        context.coverArtBackground.removeAttribute('src');
        context.coverArtBackground.classList.remove('is-visible');
        context.coverArt.removeAttribute('src');
        context.coverArt.classList.remove('is-visible');
        context.setBackgroundCover();
    };

    const syncCurrentTrackFromPlaybackState = (state: AudioPlaybackState): void => {
        const normalizedSourcePath = state.sourcePath.trim();
        if (!state.loaded || normalizedSourcePath === '') {
            return;
        }

        const resolvedIndex = ensureTrackIndexForPath(normalizedSourcePath);
        if (resolvedIndex < 0 || resolvedIndex >= context.tracks.length) {
            return;
        }

        const activeTrack = context.tracks[context.currentTrackIndex];
        if (activeTrack && trackPathKey(activeTrack.path) === trackPathKey(normalizedSourcePath)) {
            return;
        }

        if (activeTrack) {
            const previousPlaybackState = context.playbackStateService.getPlaybackState();
            if (trackPathKey(previousPlaybackState.sourcePath || '') === trackPathKey(activeTrack.path)
                && previousPlaybackState.loaded
                && previousPlaybackState.playing) {
                context.scrobbleService.completeLocalHistory(activeTrack, previousPlaybackState.duration);
            }
        }

        if (resolvedIndex === context.currentTrackIndex) {
            return;
        }

        clearSettledTransitionMetadataRefresh();
        if (activeTrack) {
            pendingSettledTransitionMetadataRefreshPath = normalizedSourcePath;
        }

        context.currentTrackIndex = resolvedIndex;
        context.gaplessQueueRequestVersion += 1;
        context.queuedGaplessTrackPath = '';
        context.playlistController().scheduleRender();
        setCoverFlipped(false);
        context.scrobbleService.startTrackSession(normalizedSourcePath);

        const track = context.tracks[resolvedIndex];
        if (context.currentSettings.preferMusicBrainzMetadata) {
            track.mbMetadataResolved = false;
        }

        if (!context.libraryController().isSidebarOpen()) {
            context.libraryController().setSidebarAutoFolderPath(track.folderPath);
        }

        runPlayerCardTrackTransition(() => {
            refreshNowPlayingLabel();
        });
        void applyCoverArtForTrack(resolvedIndex);
        context.libraryController().renderFolder('none');

        context.tagRequestVersion += 1;
        void context.hydrateCurrentTrackTag(resolvedIndex, context.tagRequestVersion);
        maybeRefreshSettledTransitionMetadata();

        context.artistInfoRequestVersion += 1;
        void context.hydrateCurrentArtistInfo(resolvedIndex);

        void context.refreshListenBrainzFeedbackForCurrentTrack(true);
    };

    const queueGaplessNextTrack = async (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]): Promise<void> => {
        if (!context.playbackStateService.isBackendReady()) {
            return;
        }

        if (context.fullLibraryScanLoadActive) {
            return;
        }

        const playbackState = stateOverride || context.playbackStateService.getPlaybackState();
        const activeTrack = currentTrackForPlaybackState(playbackState);
        if (!playbackState.loaded || !activeTrack) {
            return;
        }

        if (shouldDeferBackgroundBridgeCall()) {
            return;
        }

        if (sequenceOverrideIndexes === undefined && playbackState.playing && playbackState.currentTime < nextTrackPreloadStartSeconds) {
            return;
        }

        const nextIndex = peekNextTrackIndexForDirection(1);
        const nextPath = nextIndex !== undefined ? context.tracks[nextIndex]?.path || '' : '';
        const requestVersion = ++context.gaplessQueueRequestVersion;

        if (nextPath === '') {
            queuedTrackCoverPrefetchPath = '';
        } else if (nextIndex !== undefined && nextPath !== queuedTrackCoverPrefetchPath) {
            queuedTrackCoverPrefetchPath = nextPath;
            const nextTrack = context.tracks[nextIndex];
            void context.resolveCoverForTrack(nextTrack).catch((error: unknown) => {
                console.debug(error);
            });
        }

        if (nextPath === '') {
            if (context.queuedGaplessTrackPath === '') {
                return;
            }

            context.queuedGaplessTrackPath = '';
            logPlaybackDebug(`NextTrackPrep clear after="${activeTrack.path}"`);
            try {
                await runBackgroundBridgeCall(async () => {
                    await AudioQueueNextTrack(activeTrack.path, '');
                }, {
                    maxWaitMs: 180,
                    onTimeout: () => undefined,
                });
                if (requestVersion !== context.gaplessQueueRequestVersion) {
                    return;
                }
            } catch (error) {
                console.debug(error);
                logPlaybackDebug(`NextTrackPrep clear failed after="${activeTrack.path}" error=${describeErrorForLog(error)}`);
            }
            return;
        }

        if (nextPath === context.queuedGaplessTrackPath) {
            return;
        }

        context.queuedGaplessTrackPath = nextPath;
        logPlaybackDebug(`NextTrackPrep next="${nextPath}" after="${activeTrack.path}"`);
        try {
            const currentReleaseTrackPaths = currentReplayGainReleaseTrackPaths(sequenceOverrideIndexes);
            const replayGainReleaseTrackPaths = currentReleaseTrackPaths.length > 1
                && currentReleaseTrackPaths.some((path) => trackPathKey(path) === trackPathKey(nextPath))
                ? currentReleaseTrackPaths
                : collectReplayGainReleaseTrackPathsForIndex(nextIndex as number, sequenceOverrideIndexes);
            if (replayGainReleaseTrackPaths.length > 1) {
                await runBackgroundBridgeCall(async () => {
                    await AudioQueueNextTrackWithReplayGainContext(activeTrack.path, nextPath, replayGainReleaseTrackPaths);
                }, {
                    maxWaitMs: 180,
                    onTimeout: () => undefined,
                });
            } else {
                await runBackgroundBridgeCall(async () => {
                    await AudioQueueNextTrack(activeTrack.path, nextPath);
                }, {
                    maxWaitMs: 180,
                    onTimeout: () => undefined,
                });
            }
            if (requestVersion !== context.gaplessQueueRequestVersion) {
                return;
            }
        } catch (error) {
            console.debug(error);
            logPlaybackDebug(`NextTrackPrep failed next="${nextPath}" after="${activeTrack.path}" error=${describeErrorForLog(error)}`);
            if (requestVersion === context.gaplessQueueRequestVersion) {
                context.queuedGaplessTrackPath = '';
            }
        }
    };

    const hasLastFmCredentialsConfigured = (): boolean => context.currentSettings.lastFmApiKey.trim() !== ''
        && context.currentSettings.lastFmApiSecret.trim() !== ''
        && context.currentSettings.lastFmSessionKey.trim() !== '';

    const maybeSubmitListenBrainz = (state: AudioPlaybackState): void => {
        const track = currentTrackForPlaybackState(state);
        const automaticScrobblingEnabled = context.currentSettings.scrobblingEnabled !== false;
        const allowTrack = !!track && isTrackScrobbleAllowed(track, state.duration, context.currentSettings.scrobbleFilterMode, context.currentSettings.scrobbleRules);
        const deferLastFmNowPlaying = !!track
            && context.currentSettings.preferMusicBrainzMetadata
            && !track.mbMetadataResolved
            && (track.mbIds.releaseId || '').trim() !== '';

        context.scrobbleService.maybeSubmit(state, track, {
            listenBrainz: automaticScrobblingEnabled && context.hasListenBrainzScrobbling(),
            lastFm: automaticScrobblingEnabled && hasLastFmCredentialsConfigured() && allowTrack,
        }, {
            deferLastFmNowPlaying,
        });
    };

    const updatePlayButton = (): void => {
        const playbackState = context.playbackStateService.getPlaybackState();
        const nextState = playbackState.playing ? 'pause' : 'play';
        const nextLabel = playbackState.playing ? 'Pause' : 'Play';
        if (context.playPause.dataset.state !== nextState) {
            context.playPause.innerHTML = renderPlayPauseIcon(nextState);
            context.playPause.dataset.state = nextState;
        }

        if (context.playPause.getAttribute('aria-label') !== nextLabel) {
            context.playPause.setAttribute('aria-label', nextLabel);
        }
    };

    const updateTrackLabels = (): void => {
        const playbackState = context.playbackStateService.getPlaybackState();
        context.currentTimeLabel.textContent = formatTime(playbackState.currentTime);
        context.trackDurationLabel.textContent = formatTime(playbackState.duration);
        context.seek.max = Number.isFinite(playbackState.duration) ? String(playbackState.duration) : '0';
        if (!context.isSeeking) {
            context.seek.value = String(playbackState.currentTime);
        }
    };

    const logPlaybackDebug = (message: string): void => {
        const formatted = `[PLAYBACK] ${message}`;
        console.debug(formatted);
        if (!message.startsWith('AudioError')) {
            return;
        }

        void LogFrontendMessage(formatted).catch(() => undefined);
    };

    const handleAudioError = (error: unknown): void => {
        console.error(error);
        const message = error instanceof Error ? error.message : 'Audio backend error';
        logPlaybackDebug(`AudioError ${describeErrorForLog(error)}`);
        if (!context.libraryController().getLibraryRootName()) {
            context.libraryController().setLibraryPathMessage(message);
        }
    };

    const applyPlaybackState = (nextState: AudioPlaybackState): void => {
        playbackProgressEstimator.sync(nextState);
        playbackProgressEndSyncRequested = false;

        const clearNowPlayingCard = (): void => {
            clearPlayerCardTrackTransition();
            context.currentTrackIndex = -1;
            context.trackTitle.textContent = 'Unknown Title';
            context.trackAlbum.textContent = 'Unknown Album';
            context.trackPosition.textContent = '';
            context.trackArtist.textContent = 'Unknown Artist';
            setTechnicalLabel(context.trackTechnical, '');
            context.trackTechnical.disabled = true;
            setTechnicalLabel(context.trackTechnicalAlt, '');
            context.trackTechnicalAlt.disabled = true;
            context.trackReleaseAlbum.textContent = '';
            context.trackTitleInline.textContent = '';
            context.trackPositionInline.textContent = '';
            context.trackReleaseLabel.textContent = '';
            context.trackReleaseCat.textContent = '';
            context.trackReleaseYear.textContent = '';
            context.trackGenreInline.textContent = '';
            context.trackArtistHeader.textContent = '';
            context.lyricsContent.textContent = '';
            context.playerLane.classList.remove('lyrics-visible');
            context.lyricsPanel.setAttribute('aria-hidden', 'true');
            applyMbLinks(context.trackTitle, context.trackAlbum, context.trackArtist, {});
            applyMbLinks(context.trackTitleInline, context.trackReleaseAlbum, context.trackArtistHeader, {});
            updateExplorationButton(document, undefined);
            context.playlistController().scheduleRender();
        };

        if (!nextState.loaded) {
            context.gaplessQueueRequestVersion += 1;
            context.queuedGaplessTrackPath = '';
            setActiveReplayGainReleaseTrackPaths();
            clearSettledTransitionMetadataRefresh();
            clearNowPlayingCard();
        }

        syncCurrentTrackFromPlaybackState(nextState);
        const transition = context.playbackStateService.applyPlaybackState(nextState, context.tracks.length > 0);
        updateTrackLabels();
        updatePlayButton();
        context.visualizerController.setPlaybackState(nextState);
        scheduleDeferredPlaybackStateEffects(nextState);

        if (transition.trackEnded) {
            context.goToTrack(1);
        }
    };

    const syncPlaybackState = async (): Promise<void> => {
        if (!context.playbackStateService.isBackendReady() || playbackStateSyncInFlight) {
            return;
        }

        playbackStateSyncInFlight = true;
        const requestVersion = context.playbackMutationVersion;
        const startedAtMs = performance.now();
        try {
            const nextState = await runBackgroundBridgeCall(async () => await AudioGetState() as AudioPlaybackState, {
                maxWaitMs: 120,
                onTimeout: async () => await AudioGetState() as AudioPlaybackState,
            });

            const elapsedMs = performance.now() - startedAtMs;
            if (elapsedMs >= 120) {
                logSlowAudioStatePoll(elapsedMs);
            }
            if (requestVersion !== context.playbackMutationVersion) {
                return;
            }

            applyPlaybackState(normalizePolledPlaybackState(nextState));
        } catch (error) {
            handleAudioError(error);
        } finally {
            playbackStateSyncInFlight = false;
        }
    };

    const playbackPoller = createSerialAsyncPoller({
        run: async () => {
            await syncPlaybackState();
        },
        getDelayMs: () => playbackReconcileDelayMs(context.playbackStateService.getPlaybackState()),
    });

    const startPlaybackPolling = (): void => {
        playbackPoller.stop();
        playbackPoller.start();
    };

    const initializeBackendPlayback = async (): Promise<void> => {
        try {
            const initialState = await InitializeAudioBackend() as AudioPlaybackState;
            context.playbackStateService.setBackendReady(true);
            applyPlaybackState(initialState);
            context.volume.value = String(initialState.volume);
            startPlaybackPolling();
            context.visualizerController.start();
        } catch (error) {
            context.playbackStateService.setBackendReady(false);
            handleAudioError(error);
        }
    };

    const silentTrackDurationThresholdSeconds = 30;

    const hasActiveTrackLyrics = (): boolean => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return false;
        }

        return context.tracks[context.currentTrackIndex].displayLyrics.trim() !== '';
    };

    const resolvedPlayerLaneGapPx = (): number => {
        const rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize || '16') || 16;
        return Math.min(Math.max(window.innerWidth * 0.03, rootFontSizePx), rootFontSizePx * 1.6);
    };

    const updateLyricsPanelVisibility = (measuredCardHeightPx?: number): void => {
        const shellStyles = getComputedStyle(context.playerShell);
        const horizontalPadding = (parseFloat(shellStyles.paddingLeft) || 0) + (parseFloat(shellStyles.paddingRight) || 0);
        const verticalPadding = (parseFloat(shellStyles.paddingTop) || 0) + (parseFloat(shellStyles.paddingBottom) || 0);
        const laneGapPx = resolvedPlayerLaneGapPx();
        const availableWidth = Math.max(0, window.innerWidth - horizontalPadding);
        const targetCardWidth = Math.max(0, (window.innerHeight - verticalPadding) * 0.75);
        const singleCardWidth = Math.min(availableWidth, targetCardWidth);
        const nextMeasuredCardHeightPx = Number.isFinite(measuredCardHeightPx) && (measuredCardHeightPx || 0) > 0
            ? measuredCardHeightPx || 0
            : (lastPlayerCardHeightPx > 0 ? lastPlayerCardHeightPx : context.playerCard.getBoundingClientRect().height);
        const requiredWidth = singleCardWidth + lyricsPanelWidthPx + laneGapPx + lyricsVisibilityBufferPx;
        const canShow = hasActiveTrackLyrics() && singleCardWidth > 0 && availableWidth >= requiredWidth;

        if (context.playerLane.style.getPropertyValue('--lyrics-panel-width') !== `${lyricsPanelWidthPx}px`) {
            context.playerLane.style.setProperty('--lyrics-panel-width', `${lyricsPanelWidthPx}px`);
        }

        if (nextMeasuredCardHeightPx > 0) {
            lastPlayerCardHeightPx = nextMeasuredCardHeightPx;
            const roundedCardHeightPx = Math.round(nextMeasuredCardHeightPx);
            if (context.playerLane.style.getPropertyValue('--player-card-height') !== `${roundedCardHeightPx}px`) {
                context.playerLane.style.setProperty('--player-card-height', `${roundedCardHeightPx}px`);
            }
        }

        if (lastLyricsVisibilityState !== canShow) {
            context.playerLane.classList.toggle('lyrics-visible', canShow);
            lastLyricsVisibilityState = canShow;
        }

        const nextAriaHidden = canShow ? 'false' : 'true';
        if (context.lyricsPanel.getAttribute('aria-hidden') !== nextAriaHidden) {
            context.lyricsPanel.setAttribute('aria-hidden', nextAriaHidden);
        }
    };

    const refreshLyricsPanel = (): void => {
        const nextLyrics = hasActiveTrackLyrics() ? context.tracks[context.currentTrackIndex].displayLyrics : '';
        context.lyricsContent.textContent = nextLyrics;
        updateLyricsPanelVisibility();
    };

    const updateNowPlayingTechnicalLabels = (): void => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const activeTrack = context.tracks[context.currentTrackIndex];
        const technicalLabel = effectivePlaybackTechnicalMetadata(activeTrack, context.currentSettings);
        const label = composeTechnicalLabel(technicalLabel, cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack()) || 'Details';
        setTechnicalLabel(context.trackTechnical, label);
        context.trackTechnical.disabled = false;
        setTechnicalLabel(context.trackTechnicalAlt, label);
        context.trackTechnicalAlt.disabled = false;
    };

    const refreshNowPlayingLabel = (): void => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const activeTrack = context.tracks[context.currentTrackIndex];
        context.trackTitle.textContent = activeTrack.displayTitle;
        context.trackAlbum.textContent = activeTrack.displayAlbum;
        context.trackPosition.textContent = taggedTrackPosition(activeTrack);
        context.trackArtist.textContent = activeTrack.displayArtist;
        updateNowPlayingTechnicalLabels();
        context.trackReleaseAlbum.textContent = activeTrack.displayAlbum;
        context.trackTitleInline.textContent = activeTrack.displayTitle;
        const num = activeTrack.displayTrackNumber.trim();
        const total = activeTrack.displayTrackTotal.trim();
        context.trackPositionInline.textContent = num && total ? `${num}/${total}` : num || '';
        const fileTags = activeTrack.allFileTags;
        context.trackReleaseLabel.textContent = getReleaseLabel(fileTags);
        context.trackReleaseCat.textContent = getReleaseCat(fileTags);
        context.trackReleaseYear.textContent = getFirstTag(fileTags, 'date', 'year', 'originaldate', 'releasedate');
        context.trackGenreInline.textContent = getFirstTag(fileTags, 'genre');
        const artistSortName = getFirstTag(fileTags, 'artistsort', 'sortartist', 'artist_sort');
        const headerArtistText = formatSortArtist(activeTrack.displayArtist, artistSortName);
        refreshLyricsPanel();
        const mbLinkOptions = {
            artistText: activeTrack.displayArtist,
            artistMbids: activeTrack.artistMbids,
            artistCredits: activeTrack.mbArtistCredits,
        };
        applyMbLinks(context.trackTitle, context.trackAlbum, context.trackArtist, activeTrack.mbIds, mbLinkOptions);
        applyMbLinks(context.trackTitleInline, context.trackReleaseAlbum, context.trackArtistHeader, activeTrack.mbIds, {
            ...mbLinkOptions,
            artistText: headerArtistText,
        });

        if (activeTrack.mbIds.labelId) {
            context.trackReleaseLabel.dataset.mbUrl = `https://musicbrainz.org/label/${activeTrack.mbIds.labelId}`;
        } else {
            delete context.trackReleaseLabel.dataset.mbUrl;
        }

        updateExplorationButton(document, activeTrack);
        context.updateMediaSessionMetadata();
        void context.refreshListenBrainzFeedbackForCurrentTrack();

        context.playlistController().scheduleRender();
        void refreshReplayGainReleaseDynamicRangeIndicator();
    };

    const ensureTrackTagsResolved = async (index: number): Promise<void> => {
        await context.trackMetadataService.ensureTrackTagsResolved(index);
        if (index === context.currentTrackIndex) {
            refreshNowPlayingLabel();
        }
    };

    const ensureTrackTagsResolvedBatch = async (indexes: number[]): Promise<void> => {
        await context.trackMetadataService.ensureTrackTagsResolvedBatch(indexes);
        if (indexes.includes(context.currentTrackIndex)) {
            refreshNowPlayingLabel();
        }
    };

    const refreshCurrentTrackMetadata = async (): Promise<void> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const index = context.currentTrackIndex;
        const activeTrack = context.tracks[index];
        if (!activeTrack) {
            return;
        }

        context.tagRequestVersion += 1;
        const requestVersion = context.tagRequestVersion;
        const result = await context.trackMetadataService.refreshTrack(index, requestVersion);
        if (requestVersion !== context.tagRequestVersion || index !== context.currentTrackIndex) {
            return;
        }

        refreshNowPlayingLabel();
        context.libraryController().renderFolder('none');
        await applyCoverArtForTrack(index);

        if (result.updatedTags) {
            context.artistInfoRequestVersion += 1;
            void context.hydrateCurrentArtistInfo(index);
        }

        void context.refreshListenBrainzFeedbackForCurrentTrack(true);
    };

    const shouldSkipLoadedTrack = async (): Promise<boolean> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return false;
        }

        const playbackState = context.playbackStateService.getPlaybackState();
        const track = context.tracks[context.currentTrackIndex];
        if (!playbackState.loaded || playbackState.sourcePath !== track.path) {
            return false;
        }

        if (!Number.isFinite(playbackState.duration) || playbackState.duration <= 0 || playbackState.duration >= silentTrackDurationThresholdSeconds) {
            return false;
        }

        if (matchesSilenceTitleHeuristic(track)) {
            return true;
        }

        await ensureTrackTagsResolved(context.currentTrackIndex);

        const refreshedTrack = context.tracks[context.currentTrackIndex];
        if (!refreshedTrack) {
            return false;
        }

        return matchesSilenceTitleHeuristic(refreshedTrack);
    };

    const setCoverFlipped = (flipped: boolean): void => {
        context.coverFlipped = flipped;
        context.coverFlipper.classList.toggle('is-flipped', flipped);
    };

    const resetShuffleHistory = (): void => {
        context.playbackSequencingService.resetShuffleHistory();
    };

    const baseSequenceIndexes = (): { indexes: number[]; currentPosition: number } => {
        return context.playbackSequencingService.baseSequenceIndexes();
    };

    const nextTrackIndexForDirection = (direction: -1 | 1): number | undefined => {
        const nextPlaylistIndex = context.playlistController().getNextTrackIndex(direction);
        if (nextPlaylistIndex !== undefined) {
            return nextPlaylistIndex;
        }

        return context.playbackSequencingService.nextTrackIndexForDirection(direction);
    };

    const peekNextTrackIndexForDirection = (direction: -1 | 1): number | undefined => {
        const nextPlaylistIndex = context.playlistController().peekNextTrackIndex(direction);
        if (nextPlaylistIndex !== undefined) {
            return nextPlaylistIndex;
        }

        return context.playbackSequencingService.peekNextTrackIndexForDirection(direction);
    };

    return {
        applyCoverArtForTrack,
        applyPlaybackState,
        baseSequenceIndexes,
        cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack,
        clearReplayGainReleaseDynamicRangeCache,
        collectReleaseImageFiles,
        configuredLibraryFolderForPath,
        configuredLibraryRootNameByPath,
        collectReplayGainReleaseTrackPathsForIndex,
        currentReplayGainReleaseTrackPaths,
        currentTrackForPlaybackState,
        ensureImageFileIndexForPath,
        ensureTrackIndexForPath,
        ensureTextFileIndexForPath,
        ensureTrackTagsResolved,
        ensureTrackTagsResolvedBatch,
        refreshCurrentTrackMetadata,
        handleAudioError,
        imageFileIndexForPath,
        indexOfImageByPath,
        initializeBackendPlayback,
        logPlaybackDebug,
        nextTrackIndexForDirection,
        peekNextTrackIndexForDirection,
        queueGaplessNextTrack,
        refreshLyricsPanel,
        refreshNowPlayingLabel,
        refreshReplayGainReleaseDynamicRangeIndicator,
        rebuildImageFilePathIndex,
        rebuildTextFilePathIndex,
        rebuildTrackPathIndex,
        releaseDepthForTrack,
        releaseRootPathForTrack,
        replayGainReleaseDynamicRangeCacheKey,
        replayGainReleaseKeyForTrack,
        replayGainReleaseTrackPaths,
        replayGainReleaseTrackPathsForIndex,
        resetShuffleHistory,
        scheduleNowPlayingCoverRefresh,
        setActiveReplayGainReleaseTrackPaths,
        setCoverFlipped,
        shouldSkipLoadedTrack,
        startPlaybackPolling,
        syncCurrentTrackFromPlaybackState,
        syncPlaybackState,
        textFileIndexForPath,
        trackIndexForPath,
        trackPathKey,
        updateLyricsPanelVisibility,
        updateNowPlayingTechnicalLabels,
        updatePlayButton,
        updateTrackLabels,
    };
};
