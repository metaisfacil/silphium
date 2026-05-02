import {
    AddListenHistoryEntry,
    AudioGetVisualizationFrame,
    GetInternalCoverArtConfig,
    GetLastFmFollowing,
    GetLastFmFollowingFeed,
    GetLibraryFolderCoverPath,
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
import { lookupMusicBrainzTrackMetadata, setMusicBrainzRequestLogServerResolver } from './utils/musicbrainz-entity-helpers';
import { scheduleLastFmRequest } from './utils/lastfm-request-scheduler';
import { scheduleListenBrainzRequest } from './utils/musicbrainz-request-scheduler';
import type { AudioVisualizationFrame, ImageLibraryFile, ListenBrainzSocialEvent, PlayerCardLayout, Track } from './types/app-types';
import { activeSelectionTargetWithin, firstTagValue, normalizedTrackNumber } from './utils/display-helpers';
import { folderKeyForPath } from './utils/main-helpers';

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

export const createAppCoreServicesRuntime = (context: AppCoreServicesRuntimeContext) => {
    const defaultMusicBrainzServerUrl = 'https://musicbrainz.org';
    const defaultListenBrainzServerUrl = 'https://api.listenbrainz.org';
    const defaultLastFmServerUrl = 'https://ws.audioscrobbler.com/2.0';
    const playerCardLayoutKey = 'playerCardLayout';
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
            releaseName: track.displayAlbum || firstTagValue(track, 'album') || '',
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

    const openLocalReleaseFolder = async (folderPath: string): Promise<void> => {
        const cleanFolderPath = folderPath.trim();
        if (cleanFolderPath === '') {
            return;
        }

        socialController.showLibrary();
        context.libraryController().navigateToFolder(cleanFolderPath);
    };

    const openLibrarySearch = (query: string, options?: { expandFilteredFolders?: boolean }): void => {
        const cleanQuery = query.trim();
        if (cleanQuery === '') {
            return;
        }

        socialController.showLibrary();

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
    const sidebarController = createSidebarController({
        showLibrary: () => {
            socialController.showLibrary();
        },
        showSocial: () => {
            socialController.showSocial();
        },
        isSocialActive: () => socialController.isSocialActive(),
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

    const getStoredLayout = (): PlayerCardLayout =>
        localStorage.getItem(playerCardLayoutKey) === 'release' ? 'release' : 'default';

    localStorage.removeItem('shareImageComment');

    const applyPlayerCardLayout = (layout: PlayerCardLayout): void => {
        context.playerCard.classList.toggle('layout-release', layout === 'release');
        localStorage.setItem(playerCardLayoutKey, layout);
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
        context.setTrackMetaMenuTarget(
            nestedLink instanceof HTMLElement && context.trackArtist.contains(nestedLink)
                ? nestedLink
                : (firstArtistLink instanceof HTMLElement ? firstArtistLink : context.trackArtist),
        );
        context.openTrackMetaMenu(event.clientX, event.clientY, false, null, null, '');
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
        context.setTrackMetaMenuTarget(
            nestedLink instanceof HTMLElement && context.trackArtistHeader.contains(nestedLink)
                ? nestedLink
                : (firstArtistLink instanceof HTMLElement ? firstArtistLink : context.trackArtistHeader),
        );
        context.openTrackMetaMenu(event.clientX, event.clientY, false, null, null, '');
    });

    return {
        applyPlayerCardLayout,
        closeListenBrainzFeedbackMenu,
        coverArtService,
        defaultLastFmServerUrl,
        defaultListenBrainzServerUrl,
        defaultMusicBrainzServerUrl,
        getStoredLayout,
        hasLastFmScrobbling,
        hasListenBrainzScrobbling,
        visualizerController,
        listenBrainzController,
        sidebarController,
        socialController,
        openLibrarySearch,
        playbackSequencingService,
        playbackStateService,
        refreshListenBrainzFeedbackForCurrentTrack,
        resetListenBrainzFeedbackState,
        scrobbleService,
        setCtrlHeldState,
        submitListenBrainzFeedbackForTrack,
        suppressTrackMetaClicks,
        trackMetadataService,
    };
};
