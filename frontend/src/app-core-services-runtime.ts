import {
    AddListenHistoryEntry,
    AudioGetVisualizationFrame,
    GetInternalCoverArtConfig,
    GetLastFmFollowing,
    GetLastFmFollowingFeed,
    GetLibraryFolderCoverPath,
    GetLibraryFolderImageFiles,
    GetListenBrainzFollowing,
    GetListenBrainzFollowingFeed,
    GetListenBrainzRecordingFeedback,
    LogFrontendMessage,
    ReadFileBase64,
    ReadImageThumbnail,
    ReadTrackEmbeddedCover,
    ReadTrackTags,
    SubmitLastFm,
    SubmitLastFmLove,
    SubmitLastFmUnlove,
    SubmitListenBrainz,
    SubmitListenBrainzRecordingFeedback,
} from '../wailsjs/go/main/App';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import type { AppCoreServicesRuntimeContext } from './app-runtime-setup';
import { createListenBrainzController, type ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import { createListenBrainzSocialController } from './controllers/listenbrainz-social-controller';
import { createSidebarController } from './controllers/sidebar-controller';
import { createVisualizerController } from './controllers/visualizer-controller';
import { createCoverArtService } from './services/cover-art-service';
import { createPlaybackSequencingService } from './services/playback-sequencing-service';
import { createPlaybackStateService } from './services/playback-state-service';
import { createScrobbleService } from './services/scrobble-service';
import { createTrackMetadataService } from './services/track-metadata-service';
import { openMbLink } from './musicbrainz';
import { noteSlowBackgroundBridgeCall, runBackgroundBridgeCall } from './utils/bridge-load-gate';
import { formatPerfLogMessage } from './utils/perf-log';
import { lookupMusicBrainzTrackMetadata, musicBrainzMBIDSearchQuery, setMusicBrainzRequestLogServerResolver } from './utils/musicbrainz-entity-helpers';
import { scheduleLastFmRequest } from './utils/lastfm-request-scheduler';
import { scheduleListenBrainzRequest } from './utils/musicbrainz-request-scheduler';
import type { RoonAccentSettings } from './utils/roon-accent-theme';
import { DEFAULT_ROON_ACCENT_COLOR, DEFAULT_ROON_ACCENT_SATURATION, resolveRoonAccentTheme } from './utils/roon-accent-theme';
import type { AudioVisualizationFrame, ImageLibraryFile, LibraryIndexedFile, ListenBrainzSocialEvent, Track } from './types/app-types';
import { activeSelectionTargetWithin, firstTagValue, normalizedTrackNumber } from './utils/display-helpers';
import { folderKeyForPath, relativeFolderSegmentsForTrack, releaseFolderPathForTrackAtDepth } from './utils/main-helpers';

type WindowWithOptionalReleaseFolderResolver = Window & {
    go?: {
        main?: {
            App?: {
                ResolveLibraryFolderForReleaseMBID?: (releaseMBID: string) => Promise<string> | string;
                RefreshTrackMetadata?: (trackPath: string) => Promise<unknown> | unknown;
            };
        };
    };
};

type WindowWithListenHistoryBridge = Window & {
    go?: {
        main?: {
            App?: {
                AddListenHistoryEntry?: (
                    trackPath: string,
                    trackName: string,
                    artistName: string,
                    releaseName: string,
                    listenedAt: number,
                    playedPercent: number,
                ) => Promise<boolean>;
            };
        };
    };
};

type InternalCoverArtConfig = {
    baseUrl?: string;
    token?: string;
};

type OverviewRecencyEntry = {
    title: string;
    subtitle: string;
    meta: string;
    sortTimestamp: number;
    trackIndex: number;
    trackIndexes?: number[];
    coverAlt: string;
    openLabel: string;
};

type OverviewDashboardMode = 'recents' | 'albums';

type OverviewAlbumGridEntry = {
    title: string;
    artist: string;
    trackIndex: number;
    trackIndexes?: number[];
    coverAlt: string;
    coverFolderPath: string;
};

type OverviewAlbumInlineTrackEntry = {
    trackIndex: number;
    title: string;
    durationLabel: string;
    trackNumber: string;
    sortDiscNumber: number;
    sortTrackNumber: number;
};

const overviewAlbumGridRenderBatchSize = 80;
const overviewAlbumGridCoverLoadConcurrency = 4;
const overviewAlbumGridFallbackInitialCoverCount = 32;
const overviewAlbumGridThumbnailMaxEdgePx = 220;
const overviewAlbumGridAppendThresholdPx = 900;
const overviewAlbumGridLoadedCoverLimit = 250;
const overviewAlbumGridSeekAppendBurstSize = 2_400;
const overviewAlbumGridBottomSeekAppendBurstSize = 8_000;
const overviewAlbumGridViewStabilityDelayMs = 300;
const overviewAlbumGridCoverInvalidationDelayMs = 30_000;
const overviewCountNumberFormatter = new Intl.NumberFormat('en-US');

const formatOverviewInlineTrackDuration = (durationSeconds?: number): string => {
    if (!Number.isFinite(durationSeconds) || durationSeconds === undefined || durationSeconds <= 0) {
        return '';
    }

    const totalSeconds = Math.max(0, Math.round(durationSeconds));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
};

const addListenHistoryEntry = async (
    trackPath: string,
    trackName: string,
    artistName: string,
    releaseName: string,
    listenedAt: number,
    playedPercent: number,
): Promise<boolean> => {
    const runtimeBridge = (window as WindowWithListenHistoryBridge).go?.main?.App?.AddListenHistoryEntry;
    if (runtimeBridge) {
        return await runtimeBridge(trackPath, trackName, artistName, releaseName, listenedAt, playedPercent);
    }

    return await AddListenHistoryEntry(trackPath, trackName, artistName, releaseName, listenedAt, playedPercent);
};

const artistMBIDFromTarget = (target: HTMLElement | null): string => {
    const mbUrl = (target?.closest('[data-mb-url]') as HTMLElement | null)?.dataset.mbUrl || target?.dataset.mbUrl || '';
    if (mbUrl === '') {
        return '';
    }

    try {
        const parsed = new URL(mbUrl);
        const match = parsed.pathname.match(/\/artist\/([^/]+)$/i);
        return decodeURIComponent(match?.[1] || '').trim();
    } catch {
        const match = mbUrl.match(/\/artist\/([^/?#]+)/i);
        return decodeURIComponent(match?.[1] || '').trim();
    }
};

const taggedArtistMBIDsForTrack = (track: Track | undefined): string[] => {
    if (!track) {
        return [];
    }

    const taggedValues: string[] = [];
    const seen = new Set<string>();
    const taggedKeys = new Set([
        'musicbrainz_artistid',
        'musicbrainz artist id',
        'txxx:musicbrainz artist id',
    ]);

    const pushCandidate = (value: string): void => {
        const clean = value.trim();
        if (clean === '') {
            return;
        }

        const key = clean.toLowerCase();
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        taggedValues.push(clean);
    };

    pushCandidate(track.mbIds.artistId || '');

    for (const [tagName, values] of Object.entries(track.allFileTags || {})) {
        if (!taggedKeys.has(tagName.trim().toLowerCase())) {
            continue;
        }

        for (const value of values) {
            for (const candidate of value.split(';')) {
                pushCandidate(candidate);
            }
        }
    }

    return taggedValues;
};

export const artistFilterSearchQueryForTarget = (track: Track | undefined, target: HTMLElement | null): string => {
    const taggedArtistMBIDs = taggedArtistMBIDsForTrack(track);
    if (taggedArtistMBIDs.length === 0) {
        return '';
    }

    const targetMBID = artistMBIDFromTarget(target);
    const resolvedMBID = targetMBID !== '' ? targetMBID : taggedArtistMBIDs[0];
    return musicBrainzMBIDSearchQuery('artist', resolvedMBID || '');
};

export const createAppCoreServicesRuntime = (context: AppCoreServicesRuntimeContext) => {
    const defaultMusicBrainzServerUrl = 'https://musicbrainz.org';
    const defaultListenBrainzServerUrl = 'https://api.listenbrainz.org';
    const defaultLastFmServerUrl = 'https://ws.audioscrobbler.com/2.0';
    const overviewAlbumGridSortCollator = new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: 'base',
    });
    let cachedOverviewAlbumGridEntries: OverviewAlbumGridEntry[] | null = null;
    let cachedOverviewAlbumGridSourceTracks: Track[] | null = null;
    let overviewAlbumGridEntriesForRender: OverviewAlbumGridEntry[] = [];
    let overviewAlbumGridRenderedCount = 0;
    let overviewAlbumGridCoverObserver: IntersectionObserver | null = null;
    let overviewAlbumGridVisibilityObserver: IntersectionObserver | null = null;
    let overviewAlbumGridFallbackQueueHandle: number | null = null;
    let overviewAlbumGridViewStabilityHandle: number | null = null;
    let overviewAlbumGridScrollListener: ((event: Event) => void) | null = null;
    let overviewAlbumGridScrollPillPointerId: number | null = null;
    let overviewAlbumGridScrollPillGrabOffsetPx = 0;
    let overviewAlbumGridRequestedScrollProgress: number | null = null;
    let overviewAlbumGridLastViewChangeAtMs = 0;
    let overviewAlbumGridCoverLoadsInFlight = 0;
    let overviewAlbumGridQueuedImages: HTMLImageElement[] = [];
    const overviewAlbumGridCoverSrcByTrackIndex = new Map<number, string | null>();
    const overviewAlbumGridCoverElementByTrackIndex = new Map<number, HTMLImageElement>();
    const overviewAlbumGridCoverLoadGenerationByTrackIndex = new Map<number, number>();
    const overviewAlbumGridCoverResolveRequestIdByTrackIndex = new Map<number, number>();
    const overviewAlbumGridLoadedCoverTrackIndexes: number[] = [];
    const overviewAlbumGridImageByTrackIndex = new Map<number, HTMLImageElement>();
    const overviewAlbumGridEntryByTrackIndex = new Map<number, OverviewAlbumGridEntry>();
    const overviewAlbumGridVisibleTrackIndexes = new Set<number>();
    const overviewAlbumGridPendingUnloadByTrackIndex = new Map<number, number>();
    const overviewAlbumGridUnloadGenerationByTrackIndex = new Map<number, number>();
    const overviewAlbumInlinePanelAnimationTokenByElement = new WeakMap<HTMLDivElement, number>();
    const overviewAlbumInlinePanelAnimationTimeoutByElement = new WeakMap<HTMLDivElement, number>();
    const overviewAlbumInlinePanelClosePromiseByElement = new WeakMap<HTMLDivElement, Promise<void>>();
    const overviewAlbumGridViewStabilityWaiters: Array<() => void> = [];
    let expandedOverviewAlbumGridTrackIndex: number | null = null;
    let overviewAlbumGridExpansionSyncToken = 0;
    const roonAccentColorKey = 'roonAccentColor';
    const roonAccentSaturationKey = 'roonAccentSaturation';
    const localReleaseFolderByMBID = new Map<string, Promise<string>>();
    const devPerfLoggingEnabled = import.meta.env.DEV && typeof (globalThis as { vi?: unknown }).vi === 'undefined';
    const lastPerfLogAtByName = new Map<string, number>();
    let internalCoverArtConfigPromise: Promise<{ baseUrl: string; token: string } | undefined> | undefined;
    let indexedFolderCoverPathsSource: ImageLibraryFile[] | null = null;
    let indexedFolderCoverPathsByFolder: Map<string, string> | null = null;

    const isPreferredIndexedCoverImagePath = (path: string): boolean => {
        const lowerPath = path.trim().toLowerCase();
        return lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') || lowerPath.endsWith('.png');
    };

    const indexedCoverPriority = (name: string): number => {
        const lowerName = name.trim().toLowerCase();
        switch (true) {
            case lowerName === 'cover.jpg':
                return 0;
            case lowerName === 'folder.jpg':
                return 1;
            case lowerName.startsWith('albumart') && !lowerName.endsWith('.png'):
                return 2;
            case lowerName === 'cover.png':
                return 3;
            case lowerName === 'folder.png':
                return 4;
            case lowerName.startsWith('albumart') && lowerName.endsWith('.png'):
                return 5;
            default:
                return 6;
        }
    };

    const indexedFolderCoverPaths = (): Map<string, string> => {
        if (indexedFolderCoverPathsSource === context.imageFiles && indexedFolderCoverPathsByFolder) {
            return indexedFolderCoverPathsByFolder;
        }

        const nextCoverPathsByFolder = new Map<string, string>();
        const bestPriorityByFolder = new Map<string, number>();
        const bestNameByFolder = new Map<string, string>();
        for (const imageFile of context.imageFiles) {
            const folderKey = folderKeyForPath(imageFile.folderPath || '');
            const candidatePath = (imageFile.path || '').trim();
            if (!folderKey || candidatePath === '' || !isPreferredIndexedCoverImagePath(candidatePath)) {
                continue;
            }

            const candidateName = (imageFile.name || '').trim().toLowerCase();
            const candidatePriority = indexedCoverPriority(candidateName);
            const currentPriority = bestPriorityByFolder.get(folderKey);
            const currentName = bestNameByFolder.get(folderKey) || '';
            if (currentPriority !== undefined && (candidatePriority > currentPriority || (candidatePriority === currentPriority && candidateName >= currentName))) {
                continue;
            }

            bestPriorityByFolder.set(folderKey, candidatePriority);
            bestNameByFolder.set(folderKey, candidateName);
            nextCoverPathsByFolder.set(folderKey, candidatePath);
        }

        indexedFolderCoverPathsSource = context.imageFiles;
        indexedFolderCoverPathsByFolder = nextCoverPathsByFolder;
        return nextCoverPathsByFolder;
    };

    const getInternalCoverArtConfig = async (): Promise<{ baseUrl: string; token: string } | undefined> => {
        if (!internalCoverArtConfigPromise) {
            internalCoverArtConfigPromise = measureBridgeCall('GetInternalCoverArtConfig', 20, async () => (
                await GetInternalCoverArtConfig() as InternalCoverArtConfig
            )).then((config) => {
                const baseUrl = (config.baseUrl || '').trim().replace(/\/+$/, '');
                const token = (config.token || '').trim();
                if (baseUrl === '' || token === '') {
                    return undefined;
                }

                return { baseUrl, token };
            }).catch(() => undefined);
        }

        return await internalCoverArtConfigPromise;
    };

    const logSlowBridgeCall = (name: string, elapsedMs: number): void => {
        if (!devPerfLoggingEnabled) {
            return;
        }

        const nowMs = Date.now();
        const lastLoggedAtMs = lastPerfLogAtByName.get(name) || 0;
        if (nowMs - lastLoggedAtMs < 1500) {
            return;
        }

        lastPerfLogAtByName.set(name, nowMs);
        const message = formatPerfLogMessage(`slow bridge ${name} ${elapsedMs.toFixed(1)}ms`);
        console.warn(message);
        void LogFrontendMessage(message).catch(() => undefined);
    };

    const measureBridgeCall = async <T>(
        name: string,
        thresholdMs: number,
        callback: () => Promise<T>,
        options: {
            background?: boolean;
            maxWaitMs?: number;
            onTimeout?: () => Promise<T> | T;
            cooldownOnSlowMs?: number;
        } = {},
    ): Promise<T> => {
        const execute = async (): Promise<T> => {
            const startedAtMs = performance.now();
            try {
                return await callback();
            } finally {
                const elapsedMs = performance.now() - startedAtMs;
                if (elapsedMs >= thresholdMs) {
                    logSlowBridgeCall(name, elapsedMs);
                    if ((options.cooldownOnSlowMs || 0) > 0) {
                        noteSlowBackgroundBridgeCall(options.cooldownOnSlowMs);
                    }
                }
            }
        };

        if (!options.background) {
            return await execute();
        }

        return await runBackgroundBridgeCall(execute, {
            maxWaitMs: options.maxWaitMs,
            onTimeout: options.onTimeout,
        });
    };

    const hasLastFmCredentialsConfigured = (): boolean => context.currentSettings.lastFmApiKey.trim() !== ''
        && context.currentSettings.lastFmApiSecret.trim() !== ''
        && context.currentSettings.lastFmSessionKey.trim() !== '';

    const submitLastFmFeedbackForTrack = async (track: Track, score: ListenBrainzFeedbackScore): Promise<void> => {
        if ((score !== 1 && score !== 0) || !hasLastFmCredentialsConfigured()) {
            return;
        }

        const payload = {
            artistName: track.displayArtist || firstTagValue(track, 'artist') || 'Unknown Artist',
            trackName: track.displayTitle || track.title || track.name,
            releaseName: firstTagValue(track, 'album') || track.displayAlbum || '',
            albumArtist: firstTagValue(track, 'albumartist', 'album artist', 'album_artist') || undefined,
            trackNumber: normalizedTrackNumber(track),
            recordingMbid: track.mbIds.recordingId || undefined,
        };

        await scheduleLastFmRequest(async () => (
            score === 1 ? await SubmitLastFmLove(payload) : await SubmitLastFmUnlove(payload)
        ), {
            server: defaultLastFmServerUrl,
            path: score === 1 ? 'track.love' : 'track.unlove',
        });
    };

    const playbackStateService = createPlaybackStateService(context.playbackSessionState);
    setMusicBrainzRequestLogServerResolver(() => context.currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl);
    const scrobbleService = createScrobbleService({
        submitListenBrainz: async (eventType, payload, listenedAt) => await scheduleListenBrainzRequest(async () => (
            await SubmitListenBrainz(eventType, payload, listenedAt)
        ), {
            server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
            path: '/1/submit-listens',
        }),
        submitLastFm: async (eventType, payload, listenedAt) => await scheduleLastFmRequest(async () => (
            await SubmitLastFm(eventType, payload, listenedAt)
        ), {
            server: defaultLastFmServerUrl,
            path: eventType === 'playing_now' ? 'track.updateNowPlaying' : 'track.scrobble',
        }),
        submitListenHistory: async (trackPath, payload, listenedAt, playedPercent) => await addListenHistoryEntry(
            trackPath,
            payload.trackName,
            payload.artistName,
            payload.releaseName,
            listenedAt,
            playedPercent,
        ),
        hasListenHistoryEnabled: () => (
            context.currentSettings.localLibraryFilesDatabaseEnabled
            && context.currentSettings.localLibraryFilesDatabaseListenHistoryEnabled
        ),
        getListenHistoryThresholdSeconds: () => context.currentSettings.localLibraryFilesDatabaseListenHistoryThresholdSeconds,
    }, context.scrobbleSessionState);
    const playbackSequencingService = createPlaybackSequencingService({
        getTracks: () => context.tracks,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        getReleaseDepthForTrack: (track: Track) => context.releaseDepthForTrack(track),
    }, context.playbackSequencingState);
    const trackMetadataService = createTrackMetadataService({
        getTracks: () => context.tracks,
        setTrack: (index: number, track: Track) => {
            context.tracks[index] = track;
        },
        readTrackTags: async (paths: string[]) => await measureBridgeCall('ReadTrackTags', 80, async () => await ReadTrackTags(paths), {
            background: true,
            maxWaitMs: 600,
            cooldownOnSlowMs: 350,
        }),
        forceRefreshTrackTags: async (paths: string[]) => {
            const runtimeWindow = window as WindowWithOptionalReleaseFolderResolver;
            const refreshTrackMetadata = runtimeWindow.go?.main?.App?.RefreshTrackMetadata;
            if (typeof refreshTrackMetadata !== 'function') {
                return await measureBridgeCall('ReadTrackTags(force)', 80, async () => await ReadTrackTags(paths), {
                    background: true,
                    maxWaitMs: 600,
                    cooldownOnSlowMs: 350,
                });
            }

            const entries = await measureBridgeCall('RefreshTrackMetadata', 80, async () => await Promise.all(paths.map(async (path) => [
                path,
                await Promise.resolve(refreshTrackMetadata(path)),
            ] as const)), {
                background: true,
                maxWaitMs: 600,
                cooldownOnSlowMs: 350,
            });
            return Object.fromEntries(entries);
        },
        lookupMusicBrainzTrackMetadata: async (recordingId: string, releaseId: string) => await lookupMusicBrainzTrackMetadata(recordingId, releaseId),
        getPreferMusicBrainzMetadata: () => context.currentSettings.preferMusicBrainzMetadata,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        getTagRequestVersion: () => context.tagRequestVersion,
    });
    const coverArtService = createCoverArtService({
        getCoverArtPriority: () => context.currentSettings.coverArtPriority,
        getInternalCoverArtConfig,
        getIndexedFolderCoverPath: (folderPath: string): string | undefined => indexedFolderCoverPaths().get(folderKeyForPath(folderPath || '')),
        getLibraryFolderCoverPath: async (folderPath: string): Promise<string> => await measureBridgeCall('GetLibraryFolderCoverPath', 40, async () => await GetLibraryFolderCoverPath(folderPath) as string, {
            background: true,
            maxWaitMs: 500,
            cooldownOnSlowMs: 300,
        }),
        getLibraryFolderImageFiles: async (folderPath: string): Promise<LibraryIndexedFile[]> => await measureBridgeCall('GetLibraryFolderImageFiles', 80, async () => await GetLibraryFolderImageFiles(folderPath) as LibraryIndexedFile[], {
            background: true,
            maxWaitMs: 600,
            cooldownOnSlowMs: 350,
        }),
        readImageThumbnail: async (filePath: string, maxEdge: number): Promise<{ base64?: string; mimeType?: string }> => await measureBridgeCall('ReadImageThumbnail', 60, async () => await ReadImageThumbnail(filePath, maxEdge) as { base64?: string; mimeType?: string }, {
            background: true,
            maxWaitMs: 600,
            cooldownOnSlowMs: 350,
        }),
        readFileBase64: async (filePath: string): Promise<string> => await measureBridgeCall('ReadFileBase64', 80, async () => await ReadFileBase64(filePath) as string, {
            background: true,
            maxWaitMs: 600,
            cooldownOnSlowMs: 350,
        }),
        readTrackEmbeddedCover: async (trackPath: string): Promise<{ base64?: string; mimeType?: string }> => await measureBridgeCall('ReadTrackEmbeddedCover', 80, async () => await ReadTrackEmbeddedCover(trackPath) as { base64?: string; mimeType?: string }, {
            background: true,
            maxWaitMs: 600,
            cooldownOnSlowMs: 350,
        }),
        registerObjectUrl: (url: string): void => {
            context.objectUrls.push(url);
        },
    });

    const visualizerController = createVisualizerController({
        canvas: context.playerVisualizerCanvas,
        getPlaybackState: () => playbackStateService.getPlaybackState(),
        fetchVisualizationFrame: async (frameCount: number): Promise<AudioVisualizationFrame> => (
            await measureBridgeCall('AudioGetVisualizationFrame', 40, async () => await AudioGetVisualizationFrame(frameCount) as AudioVisualizationFrame)
        ),
        getCoverArtImageSource: () => context.getCoverArtImageSource?.(),
        logDebug: (message: string): void => {
            console.debug(message);
            void LogFrontendMessage(message).catch(() => undefined);
        },
    });
    visualizerController.setMode(context.currentSettings.visualizerMode);
    visualizerController.setEqualizerPosition(context.currentSettings.equalizerPosition);
    visualizerController.setLissajousScale(context.currentSettings.lissajousScale);
    visualizerController.setEnabled(context.currentSettings.lissajousEnabled);

    const listenBrainzController = createListenBrainzController({
        elements: {
            playerCard: context.playerCard,
            listenBrainzLoveBtn: context.listenBrainzLoveBtn,
            listenBrainzFeedbackMenu: context.listenBrainzFeedbackMenu,
            listenBrainzFeedbackLoveBtn: context.listenBrainzFeedbackLoveBtn,
            listenBrainzFeedbackHateBtn: context.listenBrainzFeedbackHateBtn,
        },
        getToken: () => context.currentSettings.listenBrainzUserToken,
        getTracks: () => context.tracks,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        ensureTrackTagsResolved: async (index: number): Promise<void> => {
            await trackMetadataService.ensureTrackTagsResolved(index);
        },
        fetchRecordingFeedback: async (recordingMbid: string): Promise<number> => await scheduleListenBrainzRequest(async () => (
            await GetListenBrainzRecordingFeedback(recordingMbid) as number
        ), {
            server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
            path: '/1/feedback/user/{user}/get-feedback-for-recordings',
        }),
        submitRecordingFeedback: async (recordingMbid: string, score: ListenBrainzFeedbackScore): Promise<unknown> => await scheduleListenBrainzRequest(async () => (
            await SubmitListenBrainzRecordingFeedback(recordingMbid, score)
        ), {
            server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
            path: '/1/feedback/recording-feedback',
        }),
        onFeedbackSubmitted: async (track: Track, score: ListenBrainzFeedbackScore): Promise<void> => {
            await submitLastFmFeedbackForTrack(track, score);
        },
        beforeOpenMenu: () => {
            context.closePlayOrderMenu();
            context.closeTrackMetaMenu();
            context.closeSidebarQueueMenu();
            context.playlistController().closeMenu();
        },
    });

    const hasListenBrainzScrobbling = (): boolean => listenBrainzController.canScrobble();
    const hasLastFmScrobbling = (): boolean => hasLastFmCredentialsConfigured();
    const closeListenBrainzFeedbackMenu = (): void => {
        listenBrainzController.closeMenu();
    };
    const resetListenBrainzFeedbackState = (): void => {
        listenBrainzController.resetFeedbackState();
    };
    const refreshListenBrainzFeedbackForCurrentTrack = async (force = false): Promise<void> => {
        await listenBrainzController.refreshFeedbackForCurrentTrack(force);
    };
    const submitListenBrainzFeedbackForTrack = async (trackIndex: number, score: ListenBrainzFeedbackScore): Promise<void> => {
        await listenBrainzController.submitFeedbackForTrack(trackIndex, score);
    };

    const resolveLibraryFolderForReleaseMBID = async (releaseMBID: string): Promise<string> => {
        const cleanReleaseMBID = releaseMBID.trim().toLowerCase();
        if (cleanReleaseMBID === '' || !context.currentSettings.musicBrainzTagDatabaseEnabled) {
            return '';
        }

        const cachedPromise = localReleaseFolderByMBID.get(cleanReleaseMBID);
        if (cachedPromise) {
            return await cachedPromise;
        }

        const runtimeWindow = window as WindowWithOptionalReleaseFolderResolver;
        const resolveFolder = runtimeWindow.go?.main?.App?.ResolveLibraryFolderForReleaseMBID;
        if (typeof resolveFolder !== 'function') {
            return '';
        }

        const lookupPromise = Promise.resolve(resolveFolder(cleanReleaseMBID))
            .then((folderPath) => folderPath.trim())
            .catch(() => '');
        localReleaseFolderByMBID.set(cleanReleaseMBID, lookupPromise);
        return await lookupPromise;
    };

    const withResolvedLocalReleaseFolders = async (events: ListenBrainzSocialEvent[]): Promise<ListenBrainzSocialEvent[]> => {
        return await Promise.all(events.map(async (event) => {
            const releaseMBID = (event.trackMetadata.additionalInfo.releaseMbid || '').trim();
            if (releaseMBID === '') {
                return event;
            }

            const localReleaseFolderPath = await resolveLibraryFolderForReleaseMBID(releaseMBID);
            if (localReleaseFolderPath === '') {
                return event;
            }

            return {
                ...event,
                trackMetadata: {
                    ...event.trackMetadata,
                    additionalInfo: {
                        ...event.trackMetadata.additionalInfo,
                        localReleaseFolderPath,
                    },
                },
            };
        }));
    };

    let sidebarController: ReturnType<typeof createSidebarController> | null = null;

    const showLibrarySidebar = (): void => {
        sidebarController?.showLibrary();
    };

    const openLocalReleaseFolder = async (folderPath: string): Promise<void> => {
        const cleanFolderPath = folderPath.trim();
        if (cleanFolderPath === '') {
            return;
        }

        showLibrarySidebar();
        context.libraryController().navigateToFolder(cleanFolderPath);
    };

    const openLibrarySearch = (query: string, options?: { expandFilteredFolders?: boolean }): void => {
        const cleanQuery = query.trim();
        if (cleanQuery === '') {
            return;
        }

        showLibrarySidebar();

        const libraryController = context.libraryController();
        if (!libraryController.isSidebarOpen()) {
            libraryController.setSidebarOpen(true);
        }

        libraryController.startLibrarySearch(cleanQuery, options);
        context.librarySearch.focus({ preventScroll: true });
        context.librarySearch.select();
    };

    const normalizeSocialProviderWarning = (providerLabel: string, error: unknown): string => {
        const rawMessage = error instanceof Error
            ? error.message.trim()
            : typeof error === 'string'
                ? error.trim()
                : '';
        const normalizedMessage = rawMessage.toLowerCase();

        if (normalizedMessage.includes('context deadline exceeded') || normalizedMessage.includes('client.timeout exceeded')) {
            return `${providerLabel} request timed out.`;
        }

        if (normalizedMessage.includes('forcibly closed by the remote host')) {
            return `${providerLabel} connection was closed by the remote host.`;
        }

        if (normalizedMessage.includes('no such host')) {
            return `${providerLabel} host could not be reached.`;
        }

        if (rawMessage !== '') {
            return `${providerLabel}: ${rawMessage}`;
        }

        return `${providerLabel} request failed.`;
    };

    const collectSocialProviderResults = async <T>(
        providers: Array<{ label: string; request: () => Promise<T> }>,
    ): Promise<{ data: T[]; warnings: string[] }> => {
        if (providers.length === 0) {
            return {
                data: [],
                warnings: [],
            };
        }

        const settledResults = await Promise.allSettled(providers.map(async ({ request }) => await request()));
        const data: T[] = [];
        const warnings: string[] = [];

        settledResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                data.push(result.value);
                return;
            }

            warnings.push(normalizeSocialProviderWarning(providers[index].label, result.reason));
        });

        return { data, warnings };
    };

    const socialController = createListenBrainzSocialController({
        elements: {
            sidebarToggle: context.sidebarToggle,
            libraryExpandToggle: context.libraryExpandToggle,
            sidebarSectionTrigger: context.sidebarSectionTrigger,
            sidebarSectionTriggerLabel: context.sidebarSectionTriggerLabel,
            sidebarSectionMenu: context.sidebarSectionMenu,
            sidebarSectionOptionLibrary: context.sidebarSectionOptionLibrary,
            sidebarSectionOptionSocial: context.sidebarSectionOptionSocial,
            sidebarPaneLibrary: context.sidebarPaneLibrary,
            sidebarPaneSocial: context.sidebarPaneSocial,
            socialFeedStatus: context.socialFeedStatus,
            socialFeedList: context.socialFeedList,
        },
        hasAnyProviderConfigured: () => hasListenBrainzScrobbling() || hasLastFmScrobbling(),
        isSidebarVisible: () => context.app.classList.contains('sidebar-open'),
        fetchFollowingUsers: async () => {
            const providers: Array<{ label: string; request: () => Promise<string[]> }> = [];

            if (hasListenBrainzScrobbling()) {
                providers.push({
                    label: 'ListenBrainz following',
                    request: async () => await scheduleListenBrainzRequest(async () => (
                        await GetListenBrainzFollowing() as string[]
                    ), {
                        server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
                        path: '/1/user/{user}/following',
                    }),
                });
            }

            if (hasLastFmScrobbling()) {
                providers.push({
                    label: 'Last.fm following',
                    request: async () => await scheduleLastFmRequest(async () => (
                        await GetLastFmFollowing() as string[]
                    ), {
                        server: defaultLastFmServerUrl,
                        path: 'user.getFriends',
                    }),
                });
            }

            const { data, warnings } = await collectSocialProviderResults(providers);
            const merged = data.flat();
            return {
                data: [...new Set(merged.map((name) => name.trim()).filter((name) => name !== ''))].sort((left, right) => left.localeCompare(right)),
                warnings,
            };
        },
        fetchFollowingFeed: async (count: number) => {
            const providers: Array<{ label: string; request: () => Promise<ListenBrainzSocialEvent[]> }> = [];

            if (hasListenBrainzScrobbling()) {
                providers.push({
                    label: 'ListenBrainz feed',
                    request: async () => await scheduleListenBrainzRequest(async () => (
                        await GetListenBrainzFollowingFeed(count) as ListenBrainzSocialEvent[]
                    ), {
                        server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
                        path: '/1/user/{user}/feed/events/listens/following',
                    }),
                });
            }

            if (hasLastFmScrobbling()) {
                providers.push({
                    label: 'Last.fm feed',
                    request: async () => await scheduleLastFmRequest(async () => (
                        await GetLastFmFollowingFeed(count) as ListenBrainzSocialEvent[]
                    ), {
                        server: defaultLastFmServerUrl,
                        path: 'user.getRecentTracks',
                    }),
                });
            }

            const { data, warnings } = await collectSocialProviderResults(providers);
            return {
                data: await withResolvedLocalReleaseFolders(data.flat()),
                warnings,
            };
        },
        openUserProfile: (provider, userName): void => {
            const encodedUserName = encodeURIComponent(userName);
            const profileUrl = provider === 'lastfm'
                ? `https://www.last.fm/user/${encodedUserName}`
                : `${(context.currentSettings.listenBrainzServerUrl || 'https://listenbrainz.org').replace(/\/+$/, '')}/user/${encodedUserName}/`;

            void BrowserOpenURL(profileUrl);
        },
        openLocalReleaseFolder,
        openLibrarySearch,
        onShowSocial: () => {
            context.libraryController().setSidebarExpanded(false);
        },
    });
    sidebarController = createSidebarController({
        elements: {
            app: context.app,
            sidebarToggle: context.sidebarToggle,
            libraryHeaderTitleText: context.libraryHeaderTitleText,
            sidebarNavPane: context.sidebarNavPane,
            sidebarModeBar: context.sidebarModeBar,
            sidebarPaneLibrary: context.sidebarPaneLibrary,
            sidebarPaneSocial: context.sidebarPaneSocial,
        },
        onShowNavigation: () => {
            socialController.showLibrary();
        },
        showLibrarySection: () => {
            socialController.showLibrary();
        },
        showSocialSection: () => {
            socialController.showSocial();
        },
        isSocialActiveSection: () => socialController.isSocialActive(),
    });

    const openMbOnCtrlClick = (event: MouseEvent, target: HTMLElement): void => {
        if (!event.ctrlKey) {
            return;
        }

        const eventTarget = event.target;
        if (eventTarget instanceof HTMLElement) {
            const nestedLink = eventTarget.closest('[data-mb-url]');
            if (nestedLink instanceof HTMLElement && target.contains(nestedLink)) {
                openMbLink(nestedLink);
                return;
            }
        }

        if (target.dataset.mbUrl) {
            openMbLink(target);
        }
    };

    const setCtrlHeldState = (held: boolean): void => {
        context.app.classList.toggle('ctrl-held', held);
    };

    const escapeHtml = (value: string): string => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const normalizedTimestampMs = (value?: number): number => {
        if (!value || !Number.isFinite(value) || value <= 0) {
            return 0;
        }

        return value < 1_000_000_000_000 ? value * 1000 : value;
    };

    const formatOverviewRelativeTime = (timestampMs: number, prefix: string): string => {
        if (timestampMs <= 0) {
            return prefix;
        }

        const elapsedMs = Math.max(0, Date.now() - timestampMs);
        const elapsedMinutes = Math.floor(elapsedMs / 60_000);
        if (elapsedMinutes < 1) {
            return `${prefix} just now`;
        }

        if (elapsedMinutes < 60) {
            return `${prefix} ${elapsedMinutes}m ago`;
        }

        const elapsedHours = Math.floor(elapsedMinutes / 60);
        if (elapsedHours < 48) {
            return `${prefix} ${elapsedHours}h ago`;
        }

        const elapsedDays = Math.floor(elapsedHours / 24);
        if (elapsedDays < 60) {
            return `${prefix} ${elapsedDays}d ago`;
        }

        const elapsedMonths = Math.floor(elapsedDays / 30);
        if (elapsedMonths < 24) {
            return `${prefix} ${elapsedMonths}mo ago`;
        }

        const elapsedYears = Math.floor(elapsedDays / 365);
        return `${prefix} ${elapsedYears}y ago`;
    };

    const normalizedOverviewAlbumGridLetter = (value: string): string => {
        const match = value.trim().toUpperCase().match(/[A-Z0-9]/);
        return match?.[0] || '#';
    };

    const overviewAlbumGridProgress = (): number => {
        const maxScrollTop = Math.max(0, context.overviewAlbumGridView.scrollHeight - context.overviewAlbumGridView.clientHeight);
        if (maxScrollTop <= 0) {
            return 0;
        }

        return Math.min(1, Math.max(0, context.overviewAlbumGridView.scrollTop / maxScrollTop));
    };

    const overviewAlbumGridLetterForProgress = (progress: number): string => {
        if (overviewAlbumGridEntriesForRender.length === 0) {
            return '#';
        }

        const safeProgress = Math.min(1, Math.max(0, progress));
        const entryIndex = Math.min(
            overviewAlbumGridEntriesForRender.length - 1,
            Math.max(0, Math.round(safeProgress * Math.max(0, overviewAlbumGridEntriesForRender.length - 1))),
        );
        const entry = overviewAlbumGridEntriesForRender[entryIndex];
        return normalizedOverviewAlbumGridLetter(entry.artist || entry.title || '');
    };

    const setOverviewAlbumGridScrollHintVisible = (visible: boolean): void => {
        context.overviewAlbumGridScrollHint.hidden = !visible;
        context.overviewAlbumGridScrollHint.classList.toggle('is-visible', visible);
        context.overviewAlbumGridScrollHint.setAttribute('aria-hidden', String(!visible));
    };

    const syncOverviewAlbumGridScrollPill = (options: { showHint?: boolean; forceLetter?: string } = {}): void => {
        const maxScrollTop = Math.max(0, context.overviewAlbumGridView.scrollHeight - context.overviewAlbumGridView.clientHeight);
        const rail = context.overviewAlbumGridScrollRail;
        const pill = context.overviewAlbumGridScrollPill;
        const hint = context.overviewAlbumGridScrollHint;

        if (overviewDashboardMode !== 'albums' || maxScrollTop <= 0 || overviewAlbumGridEntriesForRender.length === 0) {
            rail.hidden = true;
            rail.setAttribute('aria-hidden', 'true');
            rail.classList.remove('is-active');
            setOverviewAlbumGridScrollHintVisible(false);
            pill.style.transform = 'translate(-50%, 0px)';
            hint.style.transform = 'translateY(0px)';
            return;
        }

        rail.hidden = false;
        rail.setAttribute('aria-hidden', 'false');
        rail.classList.toggle('is-active', overviewAlbumGridScrollPillPointerId !== null);

        const progress = overviewAlbumGridProgress();
        const travel = Math.max(0, rail.clientHeight - pill.offsetHeight);
        const offsetPx = travel * progress;
        pill.style.transform = `translate(-50%, ${offsetPx}px)`;
        hint.style.transform = `translateY(${offsetPx}px)`;
        hint.textContent = options.forceLetter || overviewAlbumGridLetterForProgress(progress);

        if (options.showHint === true) {
            setOverviewAlbumGridScrollHintVisible(true);
        } else if (options.showHint === false) {
            setOverviewAlbumGridScrollHintVisible(false);
        }
    };

    const scrollOverviewAlbumGridFromPointer = (clientY: number): void => {
        const paneRect = context.overviewAlbumGridView.getBoundingClientRect();
        const railStyles = window.getComputedStyle(context.overviewAlbumGridScrollRail);
        const railTopInset = Number.parseFloat(railStyles.top || '0') || 0;
        const railBottomInset = Number.parseFloat(railStyles.bottom || '0') || 0;
        const railTop = paneRect.top + railTopInset;
        const railHeight = Math.max(0, paneRect.height - railTopInset - railBottomInset);
        const pillHeight = context.overviewAlbumGridScrollPill.offsetHeight || 0;
        const travel = Math.max(0, railHeight - pillHeight);
        const rawOffsetPx = (clientY - railTop) - overviewAlbumGridScrollPillGrabOffsetPx;
        const offsetPx = Math.min(travel, Math.max(0, rawOffsetPx));
        const progress = travel <= 0 ? 0 : offsetPx / travel;
        overviewAlbumGridRequestedScrollProgress = progress;
        realizeOverviewAlbumGridForRequestedProgress(context.overviewAlbumGridView, context.overviewAlbumGrid, overviewAlbumGridRequestVersion, progress);
        const maxScrollTop = Math.max(0, context.overviewAlbumGridView.scrollHeight - context.overviewAlbumGridView.clientHeight);
        context.overviewAlbumGridView.scrollTop = progress * maxScrollTop;
        syncOverviewAlbumGridScrollPill({
            showHint: true,
            forceLetter: overviewAlbumGridLetterForProgress(progress),
        });
    };

    const releaseOverviewAlbumGridScrollPill = (pointerId: number): void => {
        if (overviewAlbumGridScrollPillPointerId !== pointerId) {
            return;
        }

        overviewAlbumGridScrollPillPointerId = null;
        overviewAlbumGridScrollPillGrabOffsetPx = 0;
        overviewAlbumGridRequestedScrollProgress = null;
        if (typeof context.overviewAlbumGridScrollPill.hasPointerCapture === 'function'
            && context.overviewAlbumGridScrollPill.hasPointerCapture(pointerId)) {
            context.overviewAlbumGridScrollPill.releasePointerCapture(pointerId);
        }

        syncOverviewAlbumGridScrollPill({ showHint: false });
    };

    const waitForNextAnimationFrame = async (): Promise<void> => {
        await new Promise<void>((resolve) => {
            if (typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(() => {
                    resolve();
                });
                return;
            }

            window.setTimeout(() => {
                resolve();
            }, 0);
        });
    };

    const overviewAlbumDescriptorForTrack = (track: Pick<Track, 'folderPath' | 'rootName' | 'rootPath' | 'path' | 'releaseDepth' | 'displayAlbum' | 'displayArtist' | 'allFileTags'>) => {
        const releaseFolderPath = releaseFolderPathForTrackAtDepth(track, context.releaseDepthForTrack(track)).trim();
        const releaseFolderKey = folderKeyForPath(releaseFolderPath);
        const releaseRelativeSegments = relativeFolderSegmentsForTrack(releaseFolderPath, track.rootName || '');
        const releaseFolderTitle = releaseRelativeSegments[releaseRelativeSegments.length - 1]?.trim() || '';
        const releaseFolderArtist = releaseRelativeSegments.length >= 2
            ? releaseRelativeSegments[releaseRelativeSegments.length - 2]?.trim() || ''
            : '';
        const album = firstTagValue(track, 'album') || (track.displayAlbum || '').trim() || releaseFolderTitle || 'Unknown Album';
        const albumArtist = firstTagValue(track, 'albumartist', 'album artist', 'album_artist')
            || (track.displayArtist || '').trim()
            || releaseFolderArtist
            || 'Unknown Artist';
        const key = releaseFolderKey !== ''
            ? [track.rootPath || '', releaseFolderKey].join('|').toLowerCase()
            : [track.rootPath || '', album, albumArtist].join('|').toLowerCase();

        return {
            album,
            albumArtist,
            key,
        };
    };

    const buildLastAddedAlbumEntries = (): OverviewRecencyEntry[] => {
        const albumTrackIndexesByKey = new Map<string, number[]>();
        context.tracks.forEach((track, trackIndex) => {
            const descriptor = overviewAlbumDescriptorForTrack(track);
            const existingTrackIndexes = albumTrackIndexesByKey.get(descriptor.key);
            if (existingTrackIndexes) {
                existingTrackIndexes.push(trackIndex);
                return;
            }

            albumTrackIndexesByKey.set(descriptor.key, [trackIndex]);
        });

        const recentTracks = context.tracks
            .map((track, trackIndex) => ({ track, trackIndex }))
            .filter(({ track }) => normalizedTimestampMs(track.modifiedAtMs) > 0)
            .sort((left, right) => normalizedTimestampMs(right.track.modifiedAtMs) - normalizedTimestampMs(left.track.modifiedAtMs));

        const seenAlbumKeys = new Set<string>();
        const entries: OverviewRecencyEntry[] = [];

        for (const { track, trackIndex } of recentTracks) {
            const descriptor = overviewAlbumDescriptorForTrack(track);
            if (seenAlbumKeys.has(descriptor.key)) {
                continue;
            }

            seenAlbumKeys.add(descriptor.key);
            const timestampMs = normalizedTimestampMs(track.modifiedAtMs);
            entries.push({
                title: descriptor.album,
                subtitle: descriptor.albumArtist,
                meta: formatOverviewRelativeTime(timestampMs, 'Added'),
                sortTimestamp: timestampMs,
                trackIndex,
                trackIndexes: albumTrackIndexesByKey.get(descriptor.key) || [trackIndex],
                coverAlt: `Album cover for ${descriptor.album}`,
                openLabel: `Open listen view for ${descriptor.album}`,
            });

            if (entries.length >= 4) {
                break;
            }
        }

        return entries;
    };

    const buildLastPlayedTrackEntries = async (): Promise<OverviewRecencyEntry[]> => {
        const loadedHistory = await context.loadListenHistoryData();
        if (!loadedHistory || !loadedHistory.historyItems || loadedHistory.trackIndexes.length === 0 || loadedHistory.historyItems.length === 0) {
            return [];
        }

        const indexedEntries = loadedHistory.trackIndexes.map((trackIndex, index) => ({
            trackIndex,
            track: context.tracks[trackIndex],
            historyItem: loadedHistory.historyItems?.[index],
        }));

        indexedEntries.sort((left, right) => (
            normalizedTimestampMs(right.historyItem?.listenedAt) - normalizedTimestampMs(left.historyItem?.listenedAt)
        ));

        const entries: OverviewRecencyEntry[] = [];

        for (const entry of indexedEntries) {
            const track = entry.track;
            if (!track) {
                continue;
            }

            const descriptor = overviewAlbumDescriptorForTrack(track);
            const timestampMs = normalizedTimestampMs(entry.historyItem?.listenedAt);
            const title = (track.displayTitle || track.title || track.name || '').trim() || 'Unknown Track';
            const subtitle = (track.displayArtist || '').trim() || descriptor.albumArtist.trim() || 'Unknown Artist';
            entries.push({
                title,
                subtitle,
                meta: formatOverviewRelativeTime(timestampMs, 'Played'),
                sortTimestamp: timestampMs,
                trackIndex: entry.trackIndex,
                coverAlt: `Cover art for ${title}`,
                openLabel: `Open listen view for ${title}`,
            });

            if (entries.length >= 4) {
                break;
            }
        }

        return entries;
    };

    const buildOverviewAlbumGridEntries = (): OverviewAlbumGridEntry[] => {
        if (cachedOverviewAlbumGridEntries && cachedOverviewAlbumGridSourceTracks === context.tracks) {
            return cachedOverviewAlbumGridEntries;
        }

        const albumsByKey = new Map<string, OverviewAlbumGridEntry>();
        const albumTrackIndexesByKey = new Map<string, number[]>();

        context.tracks.forEach((track, trackIndex) => {
            const descriptor = overviewAlbumDescriptorForTrack(track);
            const existingTrackIndexes = albumTrackIndexesByKey.get(descriptor.key);
            if (existingTrackIndexes) {
                existingTrackIndexes.push(trackIndex);
                return;
            }

            albumTrackIndexesByKey.set(descriptor.key, [trackIndex]);
        });

        context.tracks.forEach((track, trackIndex) => {
            const descriptor = overviewAlbumDescriptorForTrack(track);
            if (albumsByKey.has(descriptor.key)) {
                return;
            }

            const coverFolderPath = releaseFolderPathForTrackAtDepth(track, context.releaseDepthForTrack(track)).trim()
                || (track.folderPath || '').trim();

            albumsByKey.set(descriptor.key, {
                title: descriptor.album,
                artist: descriptor.albumArtist,
                trackIndex,
                trackIndexes: albumTrackIndexesByKey.get(descriptor.key) || [trackIndex],
                coverAlt: `Album cover for ${descriptor.album}`,
                coverFolderPath,
            });
        });

        cachedOverviewAlbumGridEntries = Array.from(albumsByKey.values()).sort((left, right) => {
            const artistComparison = overviewAlbumGridSortCollator.compare(left.artist, right.artist);
            if (artistComparison !== 0) {
                return artistComparison;
            }

            const titleComparison = overviewAlbumGridSortCollator.compare(left.title, right.title);
            if (titleComparison !== 0) {
                return titleComparison;
            }

            return left.trackIndex - right.trackIndex;
        });

        cachedOverviewAlbumGridSourceTracks = context.tracks;
        return cachedOverviewAlbumGridEntries;
    };

    const renderOverviewRecencyEntries = (container: HTMLDivElement | undefined, entries: OverviewRecencyEntry[], emptyText: string): void => {
        if (!container) {
            return;
        }

        if (entries.length === 0) {
            container.innerHTML = `<p class="overview-empty">${escapeHtml(emptyText)}</p>`;
            return;
        }

        container.innerHTML = entries.map((entry) => {
            const initials = entry.title
                .split(/\s+/)
                .filter((part) => part !== '')
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() || '')
                .join('') || 'AL';

            return `
                <button
                    class="overview-album-card"
                    type="button"
                    data-overview-track-index="${String(entry.trackIndex)}"
                    ${entry.trackIndexes && entry.trackIndexes.length > 0 ? `data-overview-track-indexes="${escapeHtml(entry.trackIndexes.join(','))}"` : ''}
                    data-overview-timestamp="${String(entry.sortTimestamp)}"
                    aria-label="${escapeHtml(entry.openLabel)}"
                >
                    <span class="overview-album-cover-shell">
                        <img class="overview-album-cover" alt="${escapeHtml(entry.coverAlt)}">
                        <span class="overview-album-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
                    </span>
                    <span class="overview-album-body">
                        <p class="overview-album-title">${escapeHtml(entry.title)}</p>
                        <p class="overview-album-artist">${escapeHtml(entry.subtitle)}</p>
                        <p class="overview-album-meta">${escapeHtml(entry.meta)}</p>
                    </span>
                </button>
            `;
        }).join('');
    };

    const hydrateOverviewAlbumCovers = async (
        container: HTMLDivElement | undefined,
        entries: OverviewRecencyEntry[],
        requestVersion: number,
    ): Promise<void> => {
        if (!container) {
            return;
        }

        for (const entry of entries) {
            if (requestVersion !== overviewDashboardRequestVersion) {
                return;
            }

            const track = context.tracks[entry.trackIndex];
            if (!track) {
                continue;
            }

            const coverSrc = await coverArtService.resolveForTrack(track);
            if (!coverSrc || requestVersion !== overviewDashboardRequestVersion) {
                continue;
            }

            const card = container.querySelector(`[data-overview-track-index="${String(entry.trackIndex)}"]`) as HTMLElement | null;
            const coverImage = card?.querySelector('.overview-album-cover') as HTMLImageElement | null;
            const coverShell = card?.querySelector('.overview-album-cover-shell') as HTMLSpanElement | null;
            if (!coverImage || !coverShell) {
                continue;
            }

            coverImage.src = coverSrc;
            coverImage.classList.add('is-visible');
            coverShell.classList.add('has-cover');
        }
    };

    const createOverviewAlbumGridCard = (entry: OverviewAlbumGridEntry): HTMLDivElement => {
        const card = document.createElement('div');
        card.className = 'library-album-card overview-library-album-card';
        card.dataset.overviewGridTrackIndex = String(entry.trackIndex);
        if (entry.trackIndexes && entry.trackIndexes.length > 0) {
            card.dataset.overviewTrackIndexes = entry.trackIndexes.join(',');
        }
        card.title = `${entry.artist} - ${entry.title}`;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-expanded', 'false');

        const cover = document.createElement('span');
        cover.className = 'library-album-cover is-loading';

        const fallback = document.createElement('span');
        fallback.className = 'library-album-cover-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        cover.append(fallback);

        const skeleton = document.createElement('span');
        skeleton.className = 'library-album-cover-skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        cover.append(skeleton);

        const image = document.createElement('img');
        image.className = 'library-album-cover-image';
        image.alt = entry.coverAlt;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.dataset.overviewGridTrackIndex = String(entry.trackIndex);
        cover.append(image);

        card.append(cover);
        return card;
    };

    const overviewAlbumInlinePanelId = (trackIndex: number): string => `overview-album-inline-panel-${String(trackIndex)}`;

    const parseCssDurationMs = (value: string): number => {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return 0;
        }

        if (trimmedValue.endsWith('ms')) {
            return Number.parseFloat(trimmedValue.slice(0, -2)) || 0;
        }

        if (trimmedValue.endsWith('s')) {
            return (Number.parseFloat(trimmedValue.slice(0, -1)) || 0) * 1000;
        }

        return Number.parseFloat(trimmedValue) || 0;
    };

    const overviewAlbumInlinePanelTransitionMs = (panel: HTMLDivElement): number => {
        const computedStyles = window.getComputedStyle(panel);
        const durations = computedStyles.transitionDuration
            .split(',')
            .map((value) => parseCssDurationMs(value));
        const delays = computedStyles.transitionDelay
            .split(',')
            .map((value) => parseCssDurationMs(value));
        const entryCount = Math.max(durations.length, delays.length);
        let maxDurationMs = 0;

        for (let index = 0; index < entryCount; index += 1) {
            const durationMs = durations[index] ?? durations[durations.length - 1] ?? 0;
            const delayMs = delays[index] ?? delays[delays.length - 1] ?? 0;
            maxDurationMs = Math.max(maxDurationMs, durationMs + delayMs);
        }

        return maxDurationMs;
    };

    const clearOverviewAlbumInlinePanelAnimationTimeout = (panel: HTMLDivElement): void => {
        const timeoutHandle = overviewAlbumInlinePanelAnimationTimeoutByElement.get(panel);
        if (typeof timeoutHandle === 'number') {
            window.clearTimeout(timeoutHandle);
            overviewAlbumInlinePanelAnimationTimeoutByElement.delete(panel);
        }
    };

    const nextOverviewAlbumInlinePanelAnimationToken = (panel: HTMLDivElement): number => {
        clearOverviewAlbumInlinePanelAnimationTimeout(panel);
        const nextToken = (overviewAlbumInlinePanelAnimationTokenByElement.get(panel) || 0) + 1;
        overviewAlbumInlinePanelAnimationTokenByElement.set(panel, nextToken);
        return nextToken;
    };

    const finishOverviewAlbumInlinePanelAnimation = (panel: HTMLDivElement): void => {
        clearOverviewAlbumInlinePanelAnimationTimeout(panel);
        panel.style.removeProperty('height');
        panel.style.removeProperty('overflow');
        panel.style.removeProperty('opacity');
        panel.style.removeProperty('transform');
        panel.style.removeProperty('pointer-events');
    };

    const animateOverviewAlbumInlinePanelOpen = async (panel: HTMLDivElement): Promise<void> => {
        const transitionMs = overviewAlbumInlinePanelTransitionMs(panel);
        if (transitionMs <= 0) {
            return;
        }

        const animationToken = nextOverviewAlbumInlinePanelAnimationToken(panel);
        const expandedHeightPx = panel.getBoundingClientRect().height || panel.scrollHeight;
        panel.style.overflow = 'hidden';
        panel.style.height = '0px';
        panel.style.opacity = '0';
        panel.style.transform = 'translateY(-8px) scale(0.985)';
        panel.style.pointerEvents = 'none';
        panel.getBoundingClientRect();

        await waitForNextAnimationFrame();

        if (overviewAlbumInlinePanelAnimationTokenByElement.get(panel) !== animationToken || !panel.isConnected) {
            return;
        }

        panel.style.height = `${String(expandedHeightPx)}px`;
        panel.style.opacity = '1';
        panel.style.transform = 'translateY(0) scale(1)';

        const completeAnimation = (): void => {
            if (overviewAlbumInlinePanelAnimationTokenByElement.get(panel) !== animationToken) {
                return;
            }

            finishOverviewAlbumInlinePanelAnimation(panel);
        };

        const onTransitionEnd = (event: TransitionEvent): void => {
            if (event.target !== panel || event.propertyName !== 'height') {
                return;
            }

            panel.removeEventListener('transitionend', onTransitionEnd);
            completeAnimation();
        };

        panel.addEventListener('transitionend', onTransitionEnd);
        const timeoutHandle = window.setTimeout(() => {
            panel.removeEventListener('transitionend', onTransitionEnd);
            completeAnimation();
        }, transitionMs + 32);
        overviewAlbumInlinePanelAnimationTimeoutByElement.set(panel, timeoutHandle);
    };

    const animateOverviewAlbumInlinePanelClose = (panel: HTMLDivElement): Promise<void> => {
        const existingClosePromise = overviewAlbumInlinePanelClosePromiseByElement.get(panel);
        if (existingClosePromise) {
            return existingClosePromise;
        }

        const transitionMs = overviewAlbumInlinePanelTransitionMs(panel);
        if (transitionMs <= 0 || !panel.isConnected) {
            panel.remove();
            return Promise.resolve();
        }

        const closePromise = new Promise<void>((resolve) => {
            const animationToken = nextOverviewAlbumInlinePanelAnimationToken(panel);
            const collapsedHeightPx = panel.getBoundingClientRect().height || panel.scrollHeight;
            panel.style.overflow = 'hidden';
            panel.style.height = `${String(collapsedHeightPx)}px`;
            panel.style.opacity = '1';
            panel.style.transform = 'translateY(0) scale(1)';
            panel.style.pointerEvents = 'none';
            panel.getBoundingClientRect();

            const completeAnimation = (): void => {
                if (overviewAlbumInlinePanelAnimationTokenByElement.get(panel) !== animationToken) {
                    resolve();
                    return;
                }

                finishOverviewAlbumInlinePanelAnimation(panel);
                overviewAlbumInlinePanelClosePromiseByElement.delete(panel);
                if (panel.isConnected) {
                    panel.remove();
                }
                resolve();
            };

            const onTransitionEnd = (event: TransitionEvent): void => {
                if (event.target !== panel || event.propertyName !== 'height') {
                    return;
                }

                panel.removeEventListener('transitionend', onTransitionEnd);
                completeAnimation();
            };

            panel.addEventListener('transitionend', onTransitionEnd);
            const timeoutHandle = window.setTimeout(() => {
                panel.removeEventListener('transitionend', onTransitionEnd);
                completeAnimation();
            }, transitionMs + 32);
            overviewAlbumInlinePanelAnimationTimeoutByElement.set(panel, timeoutHandle);

            void waitForNextAnimationFrame().then(() => {
                if (overviewAlbumInlinePanelAnimationTokenByElement.get(panel) !== animationToken || !panel.isConnected) {
                    return;
                }

                panel.style.height = '0px';
                panel.style.opacity = '0';
                panel.style.transform = 'translateY(-8px) scale(0.985)';
            });
        });

        overviewAlbumInlinePanelClosePromiseByElement.set(panel, closePromise);
        return closePromise;
    };

    const overviewAlbumInlineTracks = (entry: OverviewAlbumGridEntry): OverviewAlbumInlineTrackEntry[] => {
        return (entry.trackIndexes || [entry.trackIndex])
            .map((trackIndex) => {
                const track = context.tracks[trackIndex];
                if (!track) {
                    return null;
                }

                const normalizedDiscNumber = Number.parseInt(firstTagValue(track, 'discnumber', 'disc number', 'disc') || '1', 10);
                const normalizedTrackNo = Number.parseInt(normalizedTrackNumber(track) || '', 10);
                const fileNameTitle = (track.name || '').replace(/\.[^.]+$/, '').trim();
                return {
                    trackIndex,
                    title: (track.displayTitle || track.title || fileNameTitle || 'Unknown Track').trim(),
                    durationLabel: formatOverviewInlineTrackDuration(track.technicalDetails?.durationSeconds),
                    trackNumber: normalizedTrackNumber(track) || '0',
                    sortDiscNumber: Number.isFinite(normalizedDiscNumber) ? normalizedDiscNumber : 1,
                    sortTrackNumber: Number.isFinite(normalizedTrackNo) ? normalizedTrackNo : Number.MAX_SAFE_INTEGER,
                };
            })
            .filter((entryValue): entryValue is OverviewAlbumInlineTrackEntry => entryValue !== null)
            .sort((left, right) => {
                if (left.sortDiscNumber !== right.sortDiscNumber) {
                    return left.sortDiscNumber - right.sortDiscNumber;
                }

                if (left.sortTrackNumber !== right.sortTrackNumber) {
                    return left.sortTrackNumber - right.sortTrackNumber;
                }

                return left.trackIndex - right.trackIndex;
            });
    };

    const createOverviewAlbumInlinePanel = (entry: OverviewAlbumGridEntry): HTMLDivElement => {
        const panel = document.createElement('div');
        panel.className = 'overview-album-inline-panel';
        panel.id = overviewAlbumInlinePanelId(entry.trackIndex);
        panel.dataset.overviewInlinePanelTrackIndex = String(entry.trackIndex);

        const inlineTracks = overviewAlbumInlineTracks(entry);

        panel.innerHTML = `
            <div class="overview-album-inline-header">
                <div class="overview-album-inline-heading">
                    <p class="overview-album-inline-title">${escapeHtml(entry.title)}</p>
                    <p class="overview-album-inline-subtitle">${escapeHtml(entry.artist)}</p>
                </div>
                <button class="overview-album-inline-close" type="button" aria-label="Collapse album track list">X</button>
            </div>
            <div class="overview-album-inline-track-grid"></div>
        `;

        const trackGrid = panel.querySelector('.overview-album-inline-track-grid') as HTMLDivElement | null;
        if (!trackGrid) {
            return panel;
        }

        const fragment = document.createDocumentFragment();
        inlineTracks.forEach((trackEntry) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'overview-album-inline-track';
            button.dataset.overviewTrackIndex = String(trackEntry.trackIndex);
            button.setAttribute('aria-label', `Play ${trackEntry.title}`);
            button.innerHTML = `
                <span class="overview-album-inline-track-number">${escapeHtml(trackEntry.trackNumber)}</span>
                <span class="overview-album-inline-track-title">${escapeHtml(trackEntry.title)}</span>
                <span class="overview-album-inline-track-duration">${escapeHtml(trackEntry.durationLabel)}</span>
            `;
            fragment.append(button);
        });
        trackGrid.append(fragment);

        return panel;
    };

    const syncOverviewAlbumGridExpandedRow = async (container: HTMLDivElement | undefined): Promise<void> => {
        if (!container) {
            return;
        }

        const syncToken = ++overviewAlbumGridExpansionSyncToken;
        const children = Array.from(container.children);
        const closePromises = children.flatMap((child) => (
            child instanceof HTMLDivElement && child.classList.contains('overview-album-inline-panel')
                ? [animateOverviewAlbumInlinePanelClose(child)]
                : []
        ));

        const cards = children.filter((child): child is HTMLDivElement => (
            child instanceof HTMLDivElement && child.classList.contains('overview-library-album-card')
        ));
        cards.forEach((card) => {
            card.classList.remove('is-expanded');
            card.setAttribute('aria-expanded', 'false');
            card.removeAttribute('aria-controls');
        });

        if (closePromises.length > 0) {
            await Promise.all(closePromises);
        }

        if (syncToken !== overviewAlbumGridExpansionSyncToken || !container.isConnected) {
            return;
        }

        if (expandedOverviewAlbumGridTrackIndex === null) {
            return;
        }

        const currentCards = Array.from(container.children).filter((child): child is HTMLDivElement => (
            child instanceof HTMLDivElement && child.classList.contains('overview-library-album-card')
        ));

        const expandedEntry = overviewAlbumGridEntryByTrackIndex.get(expandedOverviewAlbumGridTrackIndex);
        const expandedCard = currentCards.find((card) => Number(card.dataset.overviewGridTrackIndex || '') === expandedOverviewAlbumGridTrackIndex) || null;
        if (!expandedEntry || !expandedCard) {
            expandedOverviewAlbumGridTrackIndex = null;
            return;
        }

        const gridTemplateColumns = window.getComputedStyle(container).gridTemplateColumns;
        const columnCount = Math.max(1, gridTemplateColumns && gridTemplateColumns !== 'none'
            ? gridTemplateColumns.split(' ').filter((value) => value.trim() !== '').length
            : 1);
        const expandedCardIndex = currentCards.indexOf(expandedCard);
        if (expandedCardIndex < 0) {
            expandedOverviewAlbumGridTrackIndex = null;
            return;
        }

        const rowEndIndex = Math.min(currentCards.length - 1, (Math.floor(expandedCardIndex / columnCount) * columnCount) + (columnCount - 1));
        const anchorCard = currentCards[rowEndIndex];
        if (!anchorCard) {
            return;
        }

        expandedCard.classList.add('is-expanded');
        expandedCard.setAttribute('aria-expanded', 'true');
        expandedCard.setAttribute('aria-controls', overviewAlbumInlinePanelId(expandedEntry.trackIndex));

        const panel = createOverviewAlbumInlinePanel(expandedEntry);
        container.insertBefore(panel, anchorCard.nextSibling);
        void animateOverviewAlbumInlinePanelOpen(panel);
    };

    const toggleOverviewAlbumGridExpandedRow = (eventTarget: EventTarget | null): void => {
        const targetElement = eventTarget instanceof Element
            ? eventTarget
            : eventTarget instanceof Node
                ? eventTarget.parentElement
                : null;
        if (!targetElement) {
            return;
        }

        const trackButton = targetElement.closest('.overview-album-inline-track');
        if (trackButton && context.overviewAlbumGrid.contains(trackButton)) {
            return;
        }

        const closeButton = targetElement.closest('.overview-album-inline-close');
        if (closeButton && context.overviewAlbumGrid.contains(closeButton)) {
            expandedOverviewAlbumGridTrackIndex = null;
            void syncOverviewAlbumGridExpandedRow(context.overviewAlbumGrid);
            return;
        }

        const card = targetElement.closest('.overview-library-album-card') as HTMLDivElement | null;
        if (!card || !context.overviewAlbumGrid.contains(card)) {
            return;
        }

        const trackIndex = Number(card.dataset.overviewGridTrackIndex || '');
        if (!Number.isInteger(trackIndex) || trackIndex < 0) {
            return;
        }

        expandedOverviewAlbumGridTrackIndex = expandedOverviewAlbumGridTrackIndex === trackIndex ? null : trackIndex;
        void syncOverviewAlbumGridExpandedRow(context.overviewAlbumGrid);
    };

    const disconnectOverviewAlbumGridCoverObserver = (): void => {
        overviewAlbumGridCoverObserver?.disconnect();
        overviewAlbumGridCoverObserver = null;
    };

    const disconnectOverviewAlbumGridVisibilityObserver = (): void => {
        overviewAlbumGridVisibilityObserver?.disconnect();
        overviewAlbumGridVisibilityObserver = null;
        overviewAlbumGridVisibleTrackIndexes.clear();
    };

    const disconnectOverviewAlbumGridPaneWatcher = (pane?: HTMLDivElement): void => {
        if (pane && overviewAlbumGridScrollListener) {
            pane.removeEventListener('scroll', overviewAlbumGridScrollListener);
        }

        overviewAlbumGridScrollListener = null;
    };

    const cancelOverviewAlbumGridFallbackQueue = (): void => {
        if (overviewAlbumGridFallbackQueueHandle === null) {
            return;
        }

        window.cancelAnimationFrame(overviewAlbumGridFallbackQueueHandle);
        overviewAlbumGridFallbackQueueHandle = null;
    };

    const resolveOverviewAlbumGridViewStabilityWaiters = (): void => {
        const waiters = overviewAlbumGridViewStabilityWaiters.splice(0, overviewAlbumGridViewStabilityWaiters.length);
        waiters.forEach((resolve) => {
            resolve();
        });
    };

    const scheduleOverviewAlbumGridViewStabilityTimer = (): void => {
        if (overviewAlbumGridViewStabilityHandle !== null) {
            window.clearTimeout(overviewAlbumGridViewStabilityHandle);
        }

        const elapsedSinceViewChangeMs = Math.max(0, Date.now() - overviewAlbumGridLastViewChangeAtMs);
        const remainingDelayMs = Math.max(0, overviewAlbumGridViewStabilityDelayMs - elapsedSinceViewChangeMs);
        overviewAlbumGridViewStabilityHandle = window.setTimeout(() => {
            overviewAlbumGridViewStabilityHandle = null;
            pruneOverviewAlbumGridQueuedCoverLoadsOutsideCurrentView();
            invalidateOverviewAlbumGridResolvingLoadsOutsideCurrentView();
            resolveOverviewAlbumGridViewStabilityWaiters();
        }, remainingDelayMs);
    };

    const markOverviewAlbumGridViewDirty = (): void => {
        overviewAlbumGridLastViewChangeAtMs = Date.now();
        scheduleOverviewAlbumGridViewStabilityTimer();
    };

    const waitForOverviewAlbumGridViewStability = async (): Promise<void> => {
        if (Date.now() - overviewAlbumGridLastViewChangeAtMs >= overviewAlbumGridViewStabilityDelayMs
            && overviewAlbumGridViewStabilityHandle === null) {
            return;
        }

        await new Promise<void>((resolve) => {
            overviewAlbumGridViewStabilityWaiters.push(resolve);
            scheduleOverviewAlbumGridViewStabilityTimer();
        });
    };

    const resetOverviewAlbumGridViewStabilityGate = (): void => {
        if (overviewAlbumGridViewStabilityHandle !== null) {
            window.clearTimeout(overviewAlbumGridViewStabilityHandle);
            overviewAlbumGridViewStabilityHandle = null;
        }

        overviewAlbumGridLastViewChangeAtMs = 0;
        resolveOverviewAlbumGridViewStabilityWaiters();
    };

    const clearOverviewAlbumGridPendingUnloadHandle = (trackIndex: number): void => {
        const handle = overviewAlbumGridPendingUnloadByTrackIndex.get(trackIndex);
        if (handle === undefined) {
            return;
        }

        window.clearTimeout(handle);
        overviewAlbumGridPendingUnloadByTrackIndex.delete(trackIndex);
    };

    const invalidateOverviewAlbumGridCoverInvalidation = (trackIndex: number): number => {
        clearOverviewAlbumGridPendingUnloadHandle(trackIndex);
        const nextGeneration = (overviewAlbumGridUnloadGenerationByTrackIndex.get(trackIndex) || 0) + 1;
        overviewAlbumGridUnloadGenerationByTrackIndex.set(trackIndex, nextGeneration);
        return nextGeneration;
    };

    const cancelAllOverviewAlbumGridPendingUnloads = (): void => {
        overviewAlbumGridPendingUnloadByTrackIndex.forEach((handle) => {
            window.clearTimeout(handle);
        });
        overviewAlbumGridPendingUnloadByTrackIndex.clear();
        overviewAlbumGridUnloadGenerationByTrackIndex.clear();
    };

    const resetOverviewAlbumGridCoverQueue = (): void => {
        overviewAlbumGridQueuedImages = [];
        overviewAlbumGridCoverLoadsInFlight = 0;
        overviewAlbumGridCoverElementByTrackIndex.clear();
        overviewAlbumGridCoverLoadGenerationByTrackIndex.clear();
        overviewAlbumGridCoverResolveRequestIdByTrackIndex.clear();
        overviewAlbumGridLoadedCoverTrackIndexes.length = 0;
        overviewAlbumGridImageByTrackIndex.clear();
        disconnectOverviewAlbumGridCoverObserver();
        disconnectOverviewAlbumGridVisibilityObserver();
        cancelOverviewAlbumGridFallbackQueue();
        cancelAllOverviewAlbumGridPendingUnloads();
        resetOverviewAlbumGridViewStabilityGate();
    };

    const isOverviewAlbumGridTrackVisible = (trackIndex: number): boolean => overviewAlbumGridVisibilityObserver !== null
        && overviewAlbumGridVisibleTrackIndexes.has(trackIndex);

    const invalidateOverviewAlbumGridCoverLoad = (trackIndex: number): number => {
        const nextGeneration = (overviewAlbumGridCoverLoadGenerationByTrackIndex.get(trackIndex) || 0) + 1;
        overviewAlbumGridCoverLoadGenerationByTrackIndex.set(trackIndex, nextGeneration);
        overviewAlbumGridCoverSrcByTrackIndex.delete(trackIndex);
        return nextGeneration;
    };

    const pruneOverviewAlbumGridQueuedCoverLoadsOutsideCurrentView = (): void => {
        overviewAlbumGridQueuedImages = overviewAlbumGridQueuedImages.filter((image) => {
            if (!image.isConnected) {
                delete image.dataset.coverQueued;
                return false;
            }

            const trackIndex = Number(image.dataset.overviewGridTrackIndex || '');
            if (!Number.isInteger(trackIndex) || trackIndex < 0 || isOverviewAlbumGridTrackVisible(trackIndex)) {
                return true;
            }

            delete image.dataset.coverQueued;
            return false;
        });
    };

    const invalidateOverviewAlbumGridResolvingLoadsOutsideCurrentView = (): void => {
        overviewAlbumGridCoverElementByTrackIndex.forEach((image, trackIndex) => {
            if (!image.isConnected || image.dataset.coverResolving === undefined || isOverviewAlbumGridTrackVisible(trackIndex)) {
                return;
            }

            invalidateOverviewAlbumGridCoverLoad(trackIndex);
            delete image.dataset.coverResolving;
        });
    };

    const unloadOverviewAlbumGridCoverImage = (trackIndex: number): void => {
        const image = overviewAlbumGridImageByTrackIndex.get(trackIndex);
        const coverShell = image?.closest('.library-album-cover') as HTMLSpanElement | null;

        invalidateOverviewAlbumGridCoverInvalidation(trackIndex);
        overviewAlbumGridVisibleTrackIndexes.delete(trackIndex);
        overviewAlbumGridImageByTrackIndex.delete(trackIndex);
        const cachedCoverSrc = overviewAlbumGridCoverSrcByTrackIndex.get(trackIndex);
        if (cachedCoverSrc) {
            overviewAlbumGridCoverSrcByTrackIndex.delete(trackIndex);
        }

        if (!image || !image.isConnected || !coverShell) {
            return;
        }

        image.removeAttribute('src');
        delete image.dataset.coverLoaded;
        delete image.dataset.coverQueued;
        delete image.dataset.coverResolving;
        coverShell.classList.remove('has-image');
        coverShell.classList.remove('is-unavailable');
        coverShell.classList.add('is-loading');

        if (overviewAlbumGridCoverObserver) {
            overviewAlbumGridCoverObserver.observe(image);
        }
    };

    const scheduleOverviewAlbumGridCoverInvalidation = (trackIndex: number): void => {
        const generation = invalidateOverviewAlbumGridCoverInvalidation(trackIndex);

        const image = overviewAlbumGridImageByTrackIndex.get(trackIndex);
        if (!image || image.dataset.coverLoaded !== 'true' || isOverviewAlbumGridTrackVisible(trackIndex)) {
            return;
        }

        const handle = window.setTimeout(() => {
            overviewAlbumGridPendingUnloadByTrackIndex.delete(trackIndex);
            void (async () => {
                await waitForOverviewAlbumGridViewStability();
                if (generation !== overviewAlbumGridUnloadGenerationByTrackIndex.get(trackIndex)) {
                    return;
                }

                if (isOverviewAlbumGridTrackVisible(trackIndex)) {
                    return;
                }

                unloadOverviewAlbumGridCoverImage(trackIndex);
            })();
        }, overviewAlbumGridCoverInvalidationDelayMs);
        overviewAlbumGridPendingUnloadByTrackIndex.set(trackIndex, handle);
    };

    const enforceOverviewAlbumGridLoadedCoverLimit = (currentTrackIndex?: number): void => {
        if (Number.isInteger(currentTrackIndex) && currentTrackIndex !== undefined) {
            const existingIndex = overviewAlbumGridLoadedCoverTrackIndexes.indexOf(currentTrackIndex);
            if (existingIndex >= 0) {
                overviewAlbumGridLoadedCoverTrackIndexes.splice(existingIndex, 1);
            }

            overviewAlbumGridLoadedCoverTrackIndexes.push(currentTrackIndex);
        }

        while (overviewAlbumGridLoadedCoverTrackIndexes.length > overviewAlbumGridLoadedCoverLimit) {
            const candidateIndex = overviewAlbumGridLoadedCoverTrackIndexes.findIndex((trackIndex) => (
                Number.isInteger(trackIndex)
                && trackIndex !== currentTrackIndex
                && !isOverviewAlbumGridTrackVisible(trackIndex)
            ));
            if (candidateIndex < 0) {
                break;
            }

            const [oldestTrackIndex] = overviewAlbumGridLoadedCoverTrackIndexes.splice(candidateIndex, 1);
            if (!Number.isInteger(oldestTrackIndex)) {
                continue;
            }

            unloadOverviewAlbumGridCoverImage(oldestTrackIndex);
        }
    };

    const resolveOverviewAlbumGridCoverSrc = async (entry: OverviewAlbumGridEntry): Promise<string | null> => {
        const cachedCoverSrc = overviewAlbumGridCoverSrcByTrackIndex.get(entry.trackIndex);
        if (cachedCoverSrc !== undefined) {
            return cachedCoverSrc;
        }

        let coverPath = coverArtService.getFolderCoverPath(entry.coverFolderPath)
            || indexedFolderCoverPaths().get(folderKeyForPath(entry.coverFolderPath));
        if (!coverPath && entry.coverFolderPath !== '') {
            coverPath = (await coverArtService.resolveFolderCoverPath(entry.coverFolderPath)) || undefined;
        }

        if (!coverPath) {
            overviewAlbumGridCoverSrcByTrackIndex.set(entry.trackIndex, null);
            return null;
        }

        const thumbnail = await measureBridgeCall('ReadImageThumbnail', 60, async () => (
            await ReadImageThumbnail(coverPath, overviewAlbumGridThumbnailMaxEdgePx) as { base64?: string; mimeType?: string }
        ), {
            background: true,
            maxWaitMs: 600,
            cooldownOnSlowMs: 350,
        });
        const base64 = (thumbnail.base64 || '').trim();
        if (base64 === '') {
            overviewAlbumGridCoverSrcByTrackIndex.set(entry.trackIndex, null);
            return null;
        }

        const mimeType = thumbnail.mimeType && thumbnail.mimeType.startsWith('image/')
            ? thumbnail.mimeType
            : 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64}`;
        overviewAlbumGridCoverSrcByTrackIndex.set(entry.trackIndex, dataUrl);
        return dataUrl;
    };

    const applyOverviewAlbumGridCover = (image: HTMLImageElement, coverSrc: string | null): void => {
        const coverShell = image.closest('.library-album-cover') as HTMLSpanElement | null;
        if (!coverShell || !image.isConnected) {
            return;
        }

        const trackIndex = Number(image.dataset.overviewGridTrackIndex || '');

        if (!coverSrc) {
            coverShell.classList.remove('is-loading');
            coverShell.classList.add('is-unavailable');
            return;
        }

        image.src = coverSrc;
        coverShell.classList.add('has-image');
        coverShell.classList.remove('is-loading');
        coverShell.classList.remove('is-unavailable');

        if (Number.isInteger(trackIndex) && trackIndex >= 0) {
            overviewAlbumGridImageByTrackIndex.set(trackIndex, image);
            enforceOverviewAlbumGridLoadedCoverLimit(trackIndex);
        }
    };

    const targetOverviewAlbumGridRenderedCountForProgress = (progress: number): number => {
        if (overviewAlbumGridEntriesForRender.length === 0) {
            return 0;
        }

        const safeProgress = Math.min(1, Math.max(0, progress));
        if (safeProgress >= 0.999) {
            return overviewAlbumGridEntriesForRender.length;
        }

        return Math.min(
            overviewAlbumGridEntriesForRender.length,
            Math.max(
                overviewAlbumGridRenderedCount,
                Math.ceil(safeProgress * overviewAlbumGridEntriesForRender.length) + (overviewAlbumGridRenderBatchSize * 4),
            ),
        );
    };

    const hydrateOverviewAlbumGridCoverImage = async (
        image: HTMLImageElement,
        requestVersion: number,
    ): Promise<void> => {
        if (requestVersion !== overviewAlbumGridRequestVersion || !image.isConnected) {
            return;
        }

        if (image.dataset.coverLoaded === 'true' || image.dataset.coverResolving === 'true') {
            return;
        }

        const trackIndex = Number(image.dataset.overviewGridTrackIndex || '');
        if (!Number.isInteger(trackIndex) || trackIndex < 0) {
            return;
        }

        const loadGeneration = overviewAlbumGridCoverLoadGenerationByTrackIndex.get(trackIndex) || 0;
        const resolveRequestId = (overviewAlbumGridCoverResolveRequestIdByTrackIndex.get(trackIndex) || 0) + 1;
        overviewAlbumGridCoverResolveRequestIdByTrackIndex.set(trackIndex, resolveRequestId);

        const entry = overviewAlbumGridEntryByTrackIndex.get(trackIndex);
        if (!entry) {
            image.dataset.coverLoaded = 'true';
            applyOverviewAlbumGridCover(image, null);
            return;
        }

        image.dataset.coverResolving = String(resolveRequestId);
        try {
            const coverSrc = await resolveOverviewAlbumGridCoverSrc(entry);
            if (requestVersion !== overviewAlbumGridRequestVersion || !image.isConnected) {
                return;
            }

            await waitForOverviewAlbumGridViewStability();
            if (requestVersion !== overviewAlbumGridRequestVersion || !image.isConnected) {
                return;
            }

            if (loadGeneration !== (overviewAlbumGridCoverLoadGenerationByTrackIndex.get(trackIndex) || 0)) {
                overviewAlbumGridCoverSrcByTrackIndex.delete(trackIndex);
                return;
            }

            if (overviewAlbumGridVisibilityObserver && !isOverviewAlbumGridTrackVisible(trackIndex)) {
                overviewAlbumGridCoverSrcByTrackIndex.delete(trackIndex);
                return;
            }

            image.dataset.coverLoaded = 'true';
            applyOverviewAlbumGridCover(image, coverSrc || null);
        } finally {
            if (image.dataset.coverResolving === String(resolveRequestId)) {
                delete image.dataset.coverResolving;
            }
            if (overviewAlbumGridCoverResolveRequestIdByTrackIndex.get(trackIndex) === resolveRequestId) {
                overviewAlbumGridCoverResolveRequestIdByTrackIndex.delete(trackIndex);
            }
        }
    };

    const drainOverviewAlbumGridCoverQueue = (requestVersion: number): void => {
        while (overviewAlbumGridCoverLoadsInFlight < overviewAlbumGridCoverLoadConcurrency && overviewAlbumGridQueuedImages.length > 0) {
            const nextImage = overviewAlbumGridQueuedImages.shift();
            if (!nextImage || !nextImage.isConnected || nextImage.dataset.coverLoaded === 'true' || nextImage.dataset.coverQueued !== 'true') {
                continue;
            }

            delete nextImage.dataset.coverQueued;
            overviewAlbumGridCoverLoadsInFlight += 1;
            void hydrateOverviewAlbumGridCoverImage(nextImage, requestVersion)
                .finally(() => {
                    overviewAlbumGridCoverLoadsInFlight = Math.max(0, overviewAlbumGridCoverLoadsInFlight - 1);
                    drainOverviewAlbumGridCoverQueue(requestVersion);
                });
        }
    };

    const queueOverviewAlbumGridCoverImages = (images: HTMLImageElement[], requestVersion: number): void => {
        images.forEach((image) => {
            if (image.dataset.coverLoaded === 'true' || image.dataset.coverQueued === 'true' || image.dataset.coverResolving === 'true') {
                return;
            }

            image.dataset.coverQueued = 'true';
            overviewAlbumGridQueuedImages.push(image);
        });

        drainOverviewAlbumGridCoverQueue(requestVersion);
    };

    const ensureOverviewAlbumGridCoverObserver = (pane: HTMLDivElement, requestVersion: number): IntersectionObserver | null => {
        if (typeof IntersectionObserver === 'undefined') {
            return null;
        }

        if (overviewAlbumGridCoverObserver) {
            return overviewAlbumGridCoverObserver;
        }

        overviewAlbumGridCoverObserver = new IntersectionObserver((entries) => {
            const visibleImages: HTMLImageElement[] = [];
            entries.forEach((entry) => {
                if (!entry.isIntersecting || !(entry.target instanceof HTMLImageElement)) {
                    return;
                }

                overviewAlbumGridCoverObserver?.unobserve(entry.target);
                visibleImages.push(entry.target);
            });

            if (visibleImages.length > 0) {
                queueOverviewAlbumGridCoverImages(visibleImages, requestVersion);
            }
        }, {
            root: pane,
            rootMargin: '220px 0px',
        });

        return overviewAlbumGridCoverObserver;
    };

    const ensureOverviewAlbumGridVisibilityObserver = (requestVersion: number): IntersectionObserver | null => {
        if (typeof IntersectionObserver === 'undefined') {
            return null;
        }

        if (overviewAlbumGridVisibilityObserver) {
            return overviewAlbumGridVisibilityObserver;
        }

        overviewAlbumGridVisibilityObserver = new IntersectionObserver((entries) => {
            const visibleImages: HTMLImageElement[] = [];
            entries.forEach((entry) => {
                if (!(entry.target instanceof HTMLImageElement)) {
                    return;
                }

                const trackIndex = Number(entry.target.dataset.overviewGridTrackIndex || '');
                if (!Number.isInteger(trackIndex) || trackIndex < 0) {
                    return;
                }

                if (entry.isIntersecting) {
                    invalidateOverviewAlbumGridCoverInvalidation(trackIndex);
                    overviewAlbumGridVisibleTrackIndexes.add(trackIndex);
                    if (entry.target.dataset.coverLoaded !== 'true'
                        && entry.target.dataset.coverQueued !== 'true'
                        && entry.target.dataset.coverResolving !== 'true') {
                        visibleImages.push(entry.target);
                    }
                    return;
                }

                overviewAlbumGridVisibleTrackIndexes.delete(trackIndex);
                scheduleOverviewAlbumGridCoverInvalidation(trackIndex);
            });

            if (visibleImages.length > 0) {
                queueOverviewAlbumGridCoverImages(visibleImages, requestVersion);
            }

            enforceOverviewAlbumGridLoadedCoverLimit();
        }, {
            root: context.overviewAlbumGridView,
            threshold: 0.01,
        });

        return overviewAlbumGridVisibilityObserver;
    };

    const queueOverviewAlbumGridCovers = (pane: HTMLDivElement, images: HTMLImageElement[], requestVersion: number): void => {
        const pendingImages = images.filter((image) => image.dataset.coverLoaded !== 'true' && image.dataset.coverResolving !== 'true');
        const visibilityObserver = ensureOverviewAlbumGridVisibilityObserver(requestVersion);
        images.forEach((image) => {
            visibilityObserver?.observe(image);
        });

        if (pendingImages.length === 0) {
            return;
        }

        const observer = ensureOverviewAlbumGridCoverObserver(pane, requestVersion);
        queueOverviewAlbumGridCoverImages(pendingImages.slice(0, overviewAlbumGridFallbackInitialCoverCount), requestVersion);
        if (!observer) {
            return;
        }

        pendingImages.forEach((image) => {
            observer.observe(image);
        });
    };

    const appendOverviewAlbumGridToCount = (
        pane: HTMLDivElement | undefined,
        container: HTMLDivElement | undefined,
        requestVersion: number,
        targetRenderedCount: number,
    ): void => {
        if (!container || overviewAlbumGridRenderedCount >= overviewAlbumGridEntriesForRender.length) {
            return;
        }

        const batchEnd = Math.min(
            Math.max(overviewAlbumGridRenderedCount, targetRenderedCount),
            overviewAlbumGridEntriesForRender.length,
        );
        if (batchEnd <= overviewAlbumGridRenderedCount) {
            return;
        }

        const fragment = document.createDocumentFragment();
        const batchImages: HTMLImageElement[] = [];
        overviewAlbumGridEntriesForRender.slice(overviewAlbumGridRenderedCount, batchEnd).forEach((entry) => {
            const card = createOverviewAlbumGridCard(entry);
            const image = card.querySelector('.library-album-cover-image') as HTMLImageElement | null;
            if (image) {
                overviewAlbumGridCoverElementByTrackIndex.set(entry.trackIndex, image);
                batchImages.push(image);
            }
            fragment.append(card);
        });
        container.append(fragment);
        overviewAlbumGridRenderedCount = batchEnd;

        void syncOverviewAlbumGridExpandedRow(container);

        if (pane && batchImages.length > 0) {
            queueOverviewAlbumGridCovers(pane, batchImages, requestVersion);
        }

        syncOverviewAlbumGridScrollPill();
    };

    const appendOverviewAlbumGridBatch = (
        pane: HTMLDivElement | undefined,
        container: HTMLDivElement | undefined,
        requestVersion: number,
    ): void => {
        appendOverviewAlbumGridToCount(
            pane,
            container,
            requestVersion,
            overviewAlbumGridRenderedCount + overviewAlbumGridRenderBatchSize,
        );
    };

    const syncOverviewAlbumGridToRequestedProgress = (pane: HTMLDivElement): void => {
        if (overviewAlbumGridRequestedScrollProgress === null) {
            return;
        }

        const maxScrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight);
        pane.scrollTop = overviewAlbumGridRequestedScrollProgress * maxScrollTop;
    };

    const realizeOverviewAlbumGridForRequestedProgress = (
        pane: HTMLDivElement | undefined,
        container: HTMLDivElement | undefined,
        requestVersion: number,
        progress: number,
    ): void => {
        if (!pane || !container || requestVersion !== overviewAlbumGridRequestVersion) {
            return;
        }

        const targetRenderedCount = targetOverviewAlbumGridRenderedCountForProgress(progress);
        if (targetRenderedCount <= overviewAlbumGridRenderedCount) {
            syncOverviewAlbumGridToRequestedProgress(pane);
            return;
        }

        const maxAdditionalEntries = progress >= 0.999
            ? overviewAlbumGridBottomSeekAppendBurstSize
            : overviewAlbumGridSeekAppendBurstSize;
        appendOverviewAlbumGridToCount(
            pane,
            container,
            requestVersion,
            Math.min(targetRenderedCount, overviewAlbumGridRenderedCount + maxAdditionalEntries),
        );
        syncOverviewAlbumGridToRequestedProgress(pane);
    };

    const scheduleOverviewAlbumGridAppend = (
        pane: HTMLDivElement | undefined,
        container: HTMLDivElement | undefined,
        requestVersion: number,
    ): void => {
        if (overviewAlbumGridFallbackQueueHandle !== null || requestVersion !== overviewAlbumGridRequestVersion) {
            return;
        }

        overviewAlbumGridFallbackQueueHandle = window.requestAnimationFrame(() => {
            overviewAlbumGridFallbackQueueHandle = null;
            if (requestVersion !== overviewAlbumGridRequestVersion) {
                return;
            }

            if (overviewAlbumGridRequestedScrollProgress !== null) {
                realizeOverviewAlbumGridForRequestedProgress(
                    pane,
                    container,
                    requestVersion,
                    overviewAlbumGridRequestedScrollProgress,
                );
            } else {
                appendOverviewAlbumGridBatch(pane, container, requestVersion);
            }

            if (pane && overviewAlbumGridRenderedCount < overviewAlbumGridEntriesForRender.length) {
                if (overviewAlbumGridRequestedScrollProgress !== null) {
                    const targetRenderedCount = targetOverviewAlbumGridRenderedCountForProgress(overviewAlbumGridRequestedScrollProgress);
                    if (overviewAlbumGridRenderedCount < targetRenderedCount) {
                        scheduleOverviewAlbumGridAppend(pane, container, requestVersion);
                        return;
                    }
                }

                const remainingScrollPx = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
                if (remainingScrollPx <= overviewAlbumGridAppendThresholdPx) {
                    scheduleOverviewAlbumGridAppend(pane, container, requestVersion);
                }
            }
        });
    };

    const renderOverviewAlbumGridEntries = async (
        pane: HTMLDivElement | undefined,
        container: HTMLDivElement | undefined,
        entries: OverviewAlbumGridEntry[],
        requestVersion: number,
    ): Promise<void> => {
        if (!container) {
            return;
        }

        disconnectOverviewAlbumGridPaneWatcher(pane);
        resetOverviewAlbumGridCoverQueue();
        container.replaceChildren();
        overviewAlbumGridEntriesForRender = entries;
        overviewAlbumGridRenderedCount = 0;
        markOverviewAlbumGridViewDirty();

        if (entries.length === 0) {
            container.innerHTML = '<p class="library-album-grid-empty">No albums in library</p>';
            syncOverviewAlbumGridScrollPill({ showHint: false });
            return;
        }

        appendOverviewAlbumGridBatch(pane, container, requestVersion);

        if (!pane || requestVersion !== overviewAlbumGridRequestVersion) {
            return;
        }

        overviewAlbumGridScrollListener = () => {
            markOverviewAlbumGridViewDirty();
            const remainingScrollPx = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
            syncOverviewAlbumGridScrollPill({ showHint: overviewAlbumGridScrollPillPointerId !== null });
            if (remainingScrollPx <= overviewAlbumGridAppendThresholdPx) {
                scheduleOverviewAlbumGridAppend(pane, container, requestVersion);
            }
        };
        pane.addEventListener('scroll', overviewAlbumGridScrollListener, { passive: true });

        await waitForNextAnimationFrame();
        if (requestVersion !== overviewAlbumGridRequestVersion) {
            return;
        }

        if (pane.scrollHeight - pane.clientHeight <= overviewAlbumGridAppendThresholdPx) {
            scheduleOverviewAlbumGridAppend(pane, container, requestVersion);
        }

        syncOverviewAlbumGridScrollPill();
    };

    let overviewDashboardRequestVersion = 0;
    let overviewAlbumGridRequestVersion = 0;
    let overviewDashboardMode: OverviewDashboardMode = 'recents';

    const syncOverviewDashboardMode = (): void => {
        const recentsActive = overviewDashboardMode === 'recents';
        const albumsActive = overviewDashboardMode === 'albums';
        const overviewAlbumGridShell = context.overviewAlbumGridView.parentElement;

        context.overviewRecentsView.hidden = !recentsActive;
        context.overviewAlbumGridView.hidden = !albumsActive;
        if (overviewAlbumGridShell instanceof HTMLElement) {
            overviewAlbumGridShell.hidden = !albumsActive;
        }
        context.overviewShowRecents.setAttribute('aria-pressed', String(recentsActive));
        context.overviewShowAlbums.setAttribute('aria-pressed', String(albumsActive));
        context.overviewShowRecents.classList.toggle('is-active', recentsActive);
        context.overviewShowAlbums.classList.toggle('is-active', albumsActive);
    };

    const refreshOverviewAlbumGrid = async (): Promise<void> => {
        const requestVersion = ++overviewAlbumGridRequestVersion;
        const albumGridEntries = buildOverviewAlbumGridEntries();
        overviewAlbumGridEntryByTrackIndex.clear();
        albumGridEntries.forEach((entry) => {
            overviewAlbumGridEntryByTrackIndex.set(entry.trackIndex, entry);
        });

        await renderOverviewAlbumGridEntries(context.overviewAlbumGridView, context.overviewAlbumGrid, albumGridEntries, requestVersion);
    };

    const setOverviewDashboardMode = (mode: OverviewDashboardMode): void => {
        overviewDashboardMode = mode;
        syncOverviewDashboardMode();
        context.overviewPage.scrollTop = 0;
        context.overviewAlbumGridView.scrollTop = 0;

        if (mode !== 'albums') {
            expandedOverviewAlbumGridTrackIndex = null;
            disconnectOverviewAlbumGridPaneWatcher(context.overviewAlbumGridView);
            resetOverviewAlbumGridCoverQueue();
            overviewAlbumGridScrollPillPointerId = null;
            overviewAlbumGridRequestedScrollProgress = null;
            syncOverviewAlbumGridScrollPill({ showHint: false });
        }

        if (mode === 'albums') {
            void refreshOverviewAlbumGrid();
        }
    };

    const refreshOverviewRecencySections = async (): Promise<void> => {
        const requestVersion = ++overviewDashboardRequestVersion;
        const lastAddedEntries = buildLastAddedAlbumEntries();

        renderOverviewRecencyEntries(context.overviewLastAddedList, lastAddedEntries, 'No recently added albums yet.');
        void hydrateOverviewAlbumCovers(context.overviewLastAddedList, lastAddedEntries, requestVersion);

        try {
            const lastPlayedEntries = await buildLastPlayedTrackEntries();
            if (requestVersion !== overviewDashboardRequestVersion) {
                return;
            }

            renderOverviewRecencyEntries(context.overviewLastPlayedList, lastPlayedEntries, 'No listen history yet.');
            void hydrateOverviewAlbumCovers(context.overviewLastPlayedList, lastPlayedEntries, requestVersion);
        } catch {
            if (requestVersion !== overviewDashboardRequestVersion) {
                return;
            }

            renderOverviewRecencyEntries(context.overviewLastPlayedList, [], 'No listen history yet.');
        }
    };

    const isRoonShellActive = (): boolean => context.app.classList.contains('shell-theme-roon');

    const showOverviewPage = (): void => {
        setOverviewDashboardMode('recents');
        context.overviewPage.hidden = false;
        context.playerLane.hidden = isRoonShellActive() ? false : true;
        context.overviewPage.scrollTop = 0;
        context.app.classList.add('showing-overview');
        refreshOverviewDashboard();
    };

    const showNowPlayingPage = (): void => {
        context.overviewPage.hidden = isRoonShellActive() ? false : true;
        context.playerLane.hidden = false;
        context.app.classList.remove('showing-overview');
    };

    const syncResponsiveOverviewScrollPosition = (): void => {
        if (!isRoonShellActive() || !context.app.classList.contains('showing-overview')) {
            return;
        }

        if (window.innerWidth <= 1100) {
            context.overviewPage.scrollTop = 0;
        }
    };

    const formatOverviewCount = (value: number): string => overviewCountNumberFormatter.format(value);

    window.addEventListener('resize', syncResponsiveOverviewScrollPosition, { passive: true });

    function refreshOverviewDashboard(): void {
        const trackCount = context.tracks.length;
        const albumCount = buildOverviewAlbumGridEntries().length;
        const artistCount = new Set(context.tracks.map((track) => (track.displayArtist || '').trim()).filter((value) => value !== '')).size;
        const libraryCount = new Set(context.tracks.map((track) => (track.rootName || '').trim()).filter((value) => value !== '')).size;

        if (context.overviewTracksCount) {
            context.overviewTracksCount.textContent = formatOverviewCount(trackCount);
        }

        if (context.overviewAlbumsCount) {
            context.overviewAlbumsCount.textContent = formatOverviewCount(albumCount);
        }

        if (context.overviewArtistsCount) {
            context.overviewArtistsCount.textContent = formatOverviewCount(artistCount);
        }

        if (context.overviewLibrariesCount) {
            context.overviewLibrariesCount.textContent = formatOverviewCount(libraryCount);
        }

        void refreshOverviewRecencySections();

        if (overviewDashboardMode === 'albums') {
            void refreshOverviewAlbumGrid();
        }
    }

    context.overviewAlbumGridScrollPill.addEventListener('pointerdown', (event) => {
        if (context.overviewAlbumGridScrollRail.hidden) {
            return;
        }

        event.preventDefault();
        overviewAlbumGridScrollPillPointerId = event.pointerId;
        const pillRect = context.overviewAlbumGridScrollPill.getBoundingClientRect();
        overviewAlbumGridScrollPillGrabOffsetPx = Math.min(
            pillRect.height,
            Math.max(0, event.clientY - pillRect.top),
        );
        if (typeof context.overviewAlbumGridScrollPill.setPointerCapture === 'function') {
            context.overviewAlbumGridScrollPill.setPointerCapture(event.pointerId);
        }

        scrollOverviewAlbumGridFromPointer(event.clientY);
    });

    context.overviewAlbumGridScrollPill.addEventListener('pointermove', (event) => {
        if (overviewAlbumGridScrollPillPointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        scrollOverviewAlbumGridFromPointer(event.clientY);
    });

    context.overviewAlbumGridScrollPill.addEventListener('pointerup', (event) => {
        releaseOverviewAlbumGridScrollPill(event.pointerId);
    });

    context.overviewAlbumGridScrollPill.addEventListener('pointercancel', (event) => {
        releaseOverviewAlbumGridScrollPill(event.pointerId);
    });

    context.overviewAlbumGridScrollPill.addEventListener('lostpointercapture', (event) => {
        releaseOverviewAlbumGridScrollPill(event.pointerId);
    });

    context.overviewShowAlbums.addEventListener('click', () => {
        setOverviewDashboardMode('albums');
    });

    context.overviewShowRecents.addEventListener('click', () => {
        setOverviewDashboardMode('recents');
    });

    context.overviewAlbumGrid.addEventListener('click', (event: MouseEvent) => {
        toggleOverviewAlbumGridExpandedRow(event.target);
    });

    context.overviewAlbumGrid.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        const targetElement = event.target instanceof Element ? event.target : null;
        if (!targetElement?.closest('.overview-library-album-card, .overview-album-inline-close')) {
            return;
        }

        event.preventDefault();
        toggleOverviewAlbumGridExpandedRow(event.target);
    });

    syncOverviewDashboardMode();
    syncOverviewAlbumGridScrollPill({ showHint: false });

    const getStoredRoonAccentTheme = (): RoonAccentSettings => resolveRoonAccentTheme({
        color: localStorage.getItem(roonAccentColorKey) ?? DEFAULT_ROON_ACCENT_COLOR,
        saturation: localStorage.getItem(roonAccentSaturationKey) ?? String(DEFAULT_ROON_ACCENT_SATURATION),
    });

    localStorage.removeItem('shareImageComment');

    const syncRoonAccentCssVars = (theme: RoonAccentSettings): void => {
        const resolvedTheme = resolveRoonAccentTheme(theme);
        for (const [propertyName, propertyValue] of Object.entries(resolvedTheme.cssVars)) {
            context.app.style.setProperty(propertyName, propertyValue);
        }
    };

    const applyRoonAccentTheme = (theme: RoonAccentSettings): void => {
        const resolvedTheme = resolveRoonAccentTheme(theme);
        localStorage.setItem(roonAccentColorKey, resolvedTheme.color);
        localStorage.setItem(roonAccentSaturationKey, String(resolvedTheme.saturation));
        syncRoonAccentCssVars(resolvedTheme);
    };

    const initializeRoonShell = (): void => {
        context.app.classList.remove('shell-theme-classic');
        context.app.classList.add('shell-theme-roon');
        context.playerCard.classList.remove('layout-release');
        localStorage.removeItem('appShellTheme');
        localStorage.removeItem('playerCardLayout');
        showOverviewPage();
        sidebarController.showNavigation();
    };

    const trackMetaClickSuppressDurationMs = 280;
    let suppressTrackMetaClickUntil = 0;

    const suppressTrackMetaClicks = (): void => {
        suppressTrackMetaClickUntil = Date.now() + trackMetaClickSuppressDurationMs;
    };

    const shouldSuppressTrackMetaClick = (): boolean => Date.now() < suppressTrackMetaClickUntil;
    const shouldBlockTrackMetaModalOpen = (): boolean => shouldSuppressTrackMetaClick() || context.app.classList.contains('sidebar-open');
    const trackMetaSelectionTargets = [
        context.trackTitle,
        context.trackAlbum,
        context.trackArtist,
        context.trackTitleInline,
        context.trackReleaseAlbum,
        context.trackReleaseLabel,
        context.trackArtistHeader,
    ] as const;
    let activeTrackMetaSelectionTarget: HTMLElement | null = null;

    const updateTrackMetaSelectionTarget = (): void => {
        activeTrackMetaSelectionTarget = activeSelectionTargetWithin(trackMetaSelectionTargets);
    };

    updateTrackMetaSelectionTarget();
    document.addEventListener('selectionchange', updateTrackMetaSelectionTarget);

    const hasTrackMetaSelection = (target: HTMLElement): boolean => activeTrackMetaSelectionTarget === target;

    context.trackTitle.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackTitle)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackTitle);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('recording');
    });
    context.trackTitle.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackTitle);
        context.openTrackMetaMenu(event.clientX, event.clientY, true, 'file', 'track', context.tracks[context.currentTrackIndex]?.path || '');
    });
    context.trackAlbum.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackAlbum)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackAlbum);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('release');
    });
    context.trackAlbum.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackAlbum);
        context.openTrackMetaMenu(event.clientX, event.clientY, false, 'folder', 'album', context.tracks[context.currentTrackIndex]?.folderPath || '');
    });
    context.trackArtist.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackArtist)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackArtist);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('artist');
    });
    context.trackArtist.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const eventTarget = event.target;
        const nestedLink = eventTarget instanceof HTMLElement
            ? eventTarget.closest('[data-mb-url]')
            : null;
        const firstArtistLink = context.trackArtist.querySelector('[data-mb-url]');
        const trackMetaTarget = nestedLink instanceof HTMLElement && context.trackArtist.contains(nestedLink)
            ? nestedLink
            : (firstArtistLink instanceof HTMLElement ? firstArtistLink : context.trackArtist);
        context.setTrackMetaMenuTarget(
            trackMetaTarget,
        );
        context.openTrackMetaMenu(event.clientX, event.clientY, false, null, null, '', artistFilterSearchQueryForTarget(context.tracks[context.currentTrackIndex], trackMetaTarget), true);
    });
    context.trackTitleInline.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackTitleInline)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackTitleInline);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('recording');
    });
    context.trackTitleInline.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackTitleInline);
        context.openTrackMetaMenu(event.clientX, event.clientY, true, 'file', 'track', context.tracks[context.currentTrackIndex]?.path || '');
    });
    context.trackReleaseAlbum.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackReleaseAlbum)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackReleaseAlbum);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('release');
    });
    context.trackReleaseAlbum.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackReleaseAlbum);
        context.openTrackMetaMenu(event.clientX, event.clientY, false, 'folder', 'album', context.tracks[context.currentTrackIndex]?.folderPath || '');
    });
    context.trackReleaseLabel.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackReleaseLabel)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackReleaseLabel);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('label');
    });
    context.trackArtistHeader.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasTrackMetaSelection(context.trackArtistHeader)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackArtistHeader);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('artist');
    });
    context.trackArtistHeader.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const eventTarget = event.target;
        const nestedLink = eventTarget instanceof HTMLElement
            ? eventTarget.closest('[data-mb-url]')
            : null;
        const firstArtistLink = context.trackArtistHeader.querySelector('[data-mb-url]');
        const trackMetaTarget = nestedLink instanceof HTMLElement && context.trackArtistHeader.contains(nestedLink)
            ? nestedLink
            : (firstArtistLink instanceof HTMLElement ? firstArtistLink : context.trackArtistHeader);
        context.setTrackMetaMenuTarget(
            trackMetaTarget,
        );
        context.openTrackMetaMenu(event.clientX, event.clientY, false, null, null, '', artistFilterSearchQueryForTarget(context.tracks[context.currentTrackIndex], trackMetaTarget), true);
    });

    return {
        initializeRoonShell,
        applyRoonAccentTheme,
        closeListenBrainzFeedbackMenu,
        coverArtService,
        defaultLastFmServerUrl,
        defaultListenBrainzServerUrl,
        defaultMusicBrainzServerUrl,
        getStoredRoonAccentTheme,
        hasLastFmScrobbling,
        hasListenBrainzScrobbling,
        visualizerController,
        listenBrainzController,
        sidebarController,
        socialController,
        openLibrarySearch,
        playbackSequencingService,
        playbackStateService,
        refreshOverviewDashboard,
        refreshListenBrainzFeedbackForCurrentTrack,
        resetListenBrainzFeedbackState,
        scrobbleService,
        setCtrlHeldState,
        showNowPlayingPage,
        showOverviewPage,
        submitListenBrainzFeedbackForTrack,
        suppressTrackMetaClicks,
        trackMetadataService,
    };
};
