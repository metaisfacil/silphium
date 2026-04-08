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
    findLibraryFolderForFilePath,
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

export const createAppNowPlayingRuntime = (context: AppNowPlayingRuntimeContext) => {
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

            context.coverArtService.invalidateForTrack(activeTrack);
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

    const releaseDepthForTrack = (track: Pick<Track, 'rootPath'>): number => {
        const folder = configuredLibraryFolderForPath(track.rootPath || '');
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

        if (resolvedIndex === context.currentTrackIndex) {
            return;
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

        refreshNowPlayingLabel();
        void applyCoverArtForTrack(resolvedIndex);
        context.libraryController().renderFolder('none');

        context.tagRequestVersion += 1;
        void context.hydrateCurrentTrackTag(resolvedIndex, context.tagRequestVersion);

        context.artistInfoRequestVersion += 1;
        void context.hydrateCurrentArtistInfo(resolvedIndex);

        void context.refreshListenBrainzFeedbackForCurrentTrack(true);
    };

    const queueGaplessNextTrack = async (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]): Promise<void> => {
        if (!context.currentSettings.audio.gaplessPlayback || !context.playbackStateService.isBackendReady()) {
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

        if (!playbackState.playing) {
            return;
        }

        const nextIndex = peekNextTrackIndexForDirection(1);
        const nextPath = nextIndex !== undefined ? context.tracks[nextIndex]?.path || '' : '';
        const requestVersion = ++context.gaplessQueueRequestVersion;

        if (nextPath === '') {
            if (context.queuedGaplessTrackPath === '') {
                return;
            }

            context.queuedGaplessTrackPath = '';
            logPlaybackDebug(`GaplessQueue clear after="${activeTrack.path}"`);
            try {
                await AudioQueueNextTrack(activeTrack.path, '');
                if (requestVersion !== context.gaplessQueueRequestVersion) {
                    return;
                }
            } catch (error) {
                console.debug(error);
                logPlaybackDebug(`GaplessQueue clear failed after="${activeTrack.path}" error=${describeErrorForLog(error)}`);
            }
            return;
        }

        if (nextPath === context.queuedGaplessTrackPath) {
            return;
        }

        context.queuedGaplessTrackPath = nextPath;
        logPlaybackDebug(`GaplessQueue next="${nextPath}" after="${activeTrack.path}"`);
        try {
            const currentReleaseTrackPaths = currentReplayGainReleaseTrackPaths(sequenceOverrideIndexes);
            const replayGainReleaseTrackPaths = currentReleaseTrackPaths.length > 1
                && currentReleaseTrackPaths.some((path) => trackPathKey(path) === trackPathKey(nextPath))
                ? currentReleaseTrackPaths
                : collectReplayGainReleaseTrackPathsForIndex(nextIndex as number, sequenceOverrideIndexes);
            if (replayGainReleaseTrackPaths.length > 1) {
                await AudioQueueNextTrackWithReplayGainContext(activeTrack.path, nextPath, replayGainReleaseTrackPaths);
            } else {
                await AudioQueueNextTrack(activeTrack.path, nextPath);
            }
            if (requestVersion !== context.gaplessQueueRequestVersion) {
                return;
            }
        } catch (error) {
            console.debug(error);
            logPlaybackDebug(`GaplessQueue failed next="${nextPath}" after="${activeTrack.path}" error=${describeErrorForLog(error)}`);
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
        const allowTrack = !!track && isTrackScrobbleAllowed(track, state.duration, context.currentSettings.scrobbleFilterMode, context.currentSettings.scrobbleRules);
        const deferLastFmNowPlaying = !!track
            && context.currentSettings.preferMusicBrainzMetadata
            && !track.mbMetadataResolved
            && (track.mbIds.releaseId || '').trim() !== '';

        context.scrobbleService.maybeSubmit(state, track, {
            listenBrainz: context.hasListenBrainzScrobbling(),
            lastFm: hasLastFmCredentialsConfigured() && allowTrack,
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
        const clearNowPlayingCard = (): void => {
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
            clearNowPlayingCard();
        }

        syncCurrentTrackFromPlaybackState(nextState);
        const transition = context.playbackStateService.applyPlaybackState(nextState, context.tracks.length > 0);
        updateTrackLabels();
        updatePlayButton();
        maybeSubmitListenBrainz(nextState);
        context.updateMediaSessionMetadata();
        context.updateMediaSessionPlaybackState();
        context.updateMediaSessionPositionState();
        context.visualizerController.setPlaybackState(nextState);
        void queueGaplessNextTrack(nextState);
        void refreshReplayGainReleaseDynamicRangeIndicator();

        if (transition.trackEnded) {
            context.goToTrack(1);
        }
    };

    const syncPlaybackState = async (): Promise<void> => {
        if (!context.playbackStateService.isBackendReady()) {
            return;
        }

        const requestVersion = context.playbackMutationVersion;
        try {
            const nextState = await AudioGetState() as AudioPlaybackState;
            if (requestVersion !== context.playbackMutationVersion) {
                return;
            }

            applyPlaybackState(nextState);
        } catch (error) {
            handleAudioError(error);
        }
    };

    const startPlaybackPolling = (): void => {
        if (context.playbackPollHandle !== undefined) {
            window.clearInterval(context.playbackPollHandle);
        }

        context.playbackPollHandle = window.setInterval(() => {
            void syncPlaybackState();
        }, 250);
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

    const updateLyricsPanelVisibility = (): void => {
        const lyricsPanelWidth = 400;
        const visibilityBuffer = 120;
        const shellStyles = getComputedStyle(context.playerShell);
        const horizontalPadding = (parseFloat(shellStyles.paddingLeft) || 0) + (parseFloat(shellStyles.paddingRight) || 0);
        const verticalPadding = (parseFloat(shellStyles.paddingTop) || 0) + (parseFloat(shellStyles.paddingBottom) || 0);
        const wasLyricsVisible = context.playerLane.classList.contains('lyrics-visible');
        if (!wasLyricsVisible) {
            context.playerLane.classList.add('lyrics-visible');
        }
        const laneStyles = getComputedStyle(context.playerLane);
        const laneGap = parseFloat(laneStyles.gap || laneStyles.columnGap || '0') || 0;
        if (!wasLyricsVisible) {
            context.playerLane.classList.remove('lyrics-visible');
        }

        const availableWidth = Math.max(0, window.innerWidth - horizontalPadding);
        const targetCardWidth = Math.max(0, (window.innerHeight - verticalPadding) * 0.75);
        const singleCardWidth = Math.min(availableWidth, targetCardWidth);
        const measuredCardHeight = context.playerCard.getBoundingClientRect().height;
        const requiredWidth = singleCardWidth + lyricsPanelWidth + laneGap + visibilityBuffer;
        const canShow = hasActiveTrackLyrics() && singleCardWidth > 0 && availableWidth >= requiredWidth;

        context.playerLane.style.setProperty('--lyrics-panel-width', `${lyricsPanelWidth}px`);
        if (measuredCardHeight > 0) {
            context.playerLane.style.setProperty('--player-card-height', `${Math.round(measuredCardHeight)}px`);
        }
        context.playerLane.classList.toggle('lyrics-visible', canShow);
        context.lyricsPanel.setAttribute('aria-hidden', canShow ? 'false' : 'true');
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
        const label = composeTechnicalLabel(activeTrack.displayTechnical, cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack()) || 'Details';
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

    const shouldSkipLoadedTrack = async (): Promise<boolean> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return false;
        }

        await ensureTrackTagsResolved(context.currentTrackIndex);

        const playbackState = context.playbackStateService.getPlaybackState();
        const track = context.tracks[context.currentTrackIndex];
        if (!playbackState.loaded || playbackState.sourcePath !== track.path) {
            return false;
        }

        if (!Number.isFinite(playbackState.duration) || playbackState.duration <= 0 || playbackState.duration >= silentTrackDurationThresholdSeconds) {
            return false;
        }

        return matchesSilenceTitleHeuristic(track);
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
