import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppLibraryLoadRuntime } from './app-library-load-runtime';
import type { LibraryIndexedFile, LibraryIndexedFilePage, LibraryScanResult, Track } from './types/app-types';

const createScanResult = (overrides: Partial<LibraryScanResult> = {}): LibraryScanResult => ({
    rootPath: 'C:/Library',
    rootName: 'Library',
    scanGeneration: 1,
    trackFiles: [],
    textFiles: [],
    imageFiles: [],
    deferredFiles: false,
    coverPathByFolder: {},
    totalEntries: 0,
    trackCount: 0,
    textFileCount: 0,
    imageFileCount: 0,
    truncated: false,
    entryLimit: 0,
    ...overrides,
});

const emptyIndexedFilePage = (kind: LibraryIndexedFilePage['kind']): LibraryIndexedFilePage => ({
    kind,
    offset: 0,
    limit: 1000,
    totalEntries: 0,
    entries: [],
});

const createDeferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

const createContext = (quickScanResult: LibraryScanResult, trackEntry: LibraryIndexedFile) => ({
    libraryIndexedFilePageSize: 1000,
    selectedLibraryRootLabel: 'Library',
    objectUrls: [],
    tracks: [] as Track[],
    textFiles: [],
    imageFiles: [],
    currentTrackIndex: -1,
    currentSettings: {
        libraryFolders: [{ path: 'C:/Library', label: 'Library', releaseDepth: 0 }],
        playbackOrder: 'ordered-library',
    },
    currentMusicBrainzTagWorkerProgress: { enabled: false, active: false, progress: 0, pendingTrackScans: 0, totalTrackScans: 0, completedTrackScans: 0, pendingEntityLookups: 0, totalEntityLookups: 0, completedEntityLookups: 0 },
    availableAudioOutputDevices: [],
    libraryTotalLoadEstimateMs: 0,
    libraryClientFinalizeEstimateMs: 2000,
    activeLibraryLoadScanResolvedAtMs: null,
    fullLibraryScanLoadActive: false,
    suppressAutoSelectAfterFullLibraryScan: false,
    trackIndexByPath: new Map<string, number>(),
    textFileIndexByPath: new Map<string, number>(),
    imageFileIndexByPath: new Map<string, number>(),
    trackTitle: document.createElement('div'),
    trackAlbum: document.createElement('div'),
    trackPosition: document.createElement('div'),
    trackArtist: document.createElement('div'),
    trackTechnical: document.createElement('button'),
    trackTechnicalAlt: document.createElement('button'),
    trackArtistHeader: document.createElement('div'),
    trackReleaseAlbum: document.createElement('div'),
    trackReleaseLabel: document.createElement('div'),
    trackReleaseCat: document.createElement('div'),
    trackReleaseYear: document.createElement('div'),
    trackTitleInline: document.createElement('div'),
    trackGenreInline: document.createElement('div'),
    lyricsContent: document.createElement('div'),
    playerLane: document.createElement('div'),
    lyricsPanel: document.createElement('div'),
    coverArt: document.createElement('img'),
    coverArtBackground: document.createElement('img'),
    aboutVersion: document.createElement('div'),
    closeSidebarQueueMenu: vi.fn(),
    closeListenBrainzFeedbackMenu: vi.fn(),
    closeMusicBrainzEntityModal: vi.fn(),
    closeTechnicalInfoModal: vi.fn(),
    clearReplayGainReleaseDynamicRangeCache: vi.fn(),
    audioStop: vi.fn(async () => ({ loaded: false, playing: false, sourcePath: '', volume: 0.8, currentTimeSeconds: 0, durationSeconds: 0, endedEventId: 0 })),
    applyPlaybackState: vi.fn(),
    handleAudioError: vi.fn(),
    clearCoverArtCache: vi.fn(),
    clearResolvedCoverArtCache: vi.fn(),
    clearArtistInfoCache: vi.fn(),
    clearImageModalCache: vi.fn(),
    resetLibraryState: vi.fn(),
    resetPlaylistState: vi.fn(),
    resetScrobbleState: vi.fn(),
    resetShuffleHistory: vi.fn(),
    setBackgroundCover: vi.fn(),
    setCoverFlipped: vi.fn(),
    resetArtistInfoPanel: vi.fn(),
    renderLibraryFolder: vi.fn(),
    waitForCurrentLibraryBrowser: vi.fn(async () => undefined),
    updateMediaSessionMetadata: vi.fn(),
    beginLibraryLoadTracking: vi.fn(),
    markLibraryScanResolved: vi.fn(),
    finishLibraryLoadTracking: vi.fn(),
    scanConfiguredLibraryFoldersBackend: vi.fn(async () => quickScanResult),
    setLibraryLoading: vi.fn(),
    setLibraryLoadingEtaSeconds: vi.fn(),
    setLibraryLoadingStatusLabel: vi.fn(),
    setLibraryPathMessage: vi.fn(),
    setForceReloadEtaSeconds: vi.fn(),
    setLibraryRootName: vi.fn(),
    setLibraryIndexTruncated: vi.fn(),
    getLibraryRootName: vi.fn(() => ''),
    getCurrentFolderPath: vi.fn(() => ''),
    setCurrentFolderPath: vi.fn(),
    getLibrarySearchStateSnapshot: vi.fn(() => null),
    restoreLibrarySearchState: vi.fn(),
    navigateToFolder: vi.fn(),
    rebuildLibraryTree: vi.fn(async () => undefined),
    firstTrackIndexFromRandomAlbumFolder: vi.fn(() => 0),
    getPlaybackState: vi.fn(() => ({ loaded: false, playing: false, sourcePath: '', volume: 0.8, currentTimeSeconds: 0, durationSeconds: 0, endedEventId: 0 })),
    loadTrack: vi.fn(async () => undefined),
    updatePlayButton: vi.fn(),
    refreshPlaylistOpenModal: vi.fn(),
    scheduleLibraryIncrementalFolderRefresh: vi.fn(),
    scheduleNowPlayingCoverRefresh: vi.fn(),
    scheduleOverviewDashboardRefresh: vi.fn(),
    resetListenBrainzFeedbackState: vi.fn(),
    listAudioOutputDevices: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ libraryFolders: [] })),
    setLissajousEnabled: vi.fn(),
    applyUiDitheringSetting: vi.fn(),
    handleSocialSettingsChanged: vi.fn(),
    getMusicBrainzTagWorkerProgress: vi.fn(async () => ({ enabled: false, active: false, progress: 0, pendingTrackScans: 0, totalTrackScans: 0, completedTrackScans: 0, pendingEntityLookups: 0, totalEntityLookups: 0, completedEntityLookups: 0 })),
    setMusicBrainzTagWorkerProgress: vi.fn(),
    setPlaybackOrderMode: vi.fn(),
    completeStartupIfReady: vi.fn(async () => undefined),
    refreshListenBrainzFeedbackForCurrentTrack: vi.fn(async () => undefined),
    getAppVersion: vi.fn(async () => 'dev'),
    ensureTrackIndexForPath: vi.fn(() => 0),
    rebuildTrackPathIndex: vi.fn(),
    rebuildTextFilePathIndex: vi.fn(),
    rebuildImageFilePathIndex: vi.fn(),
    setFolderCoverPath: vi.fn(),
    logRescan: vi.fn(),
    loadIndexedFilePage: vi.fn(async (kind: LibraryIndexedFilePage['kind']) => {
        if (kind === 'track') {
            return {
                kind,
                offset: 0,
                limit: 1000,
                totalEntries: 1,
                entries: [trackEntry],
            };
        }

        return emptyIndexedFilePage(kind);
    }),
});

describe('app-library-load-runtime', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('starts a historical total-load ETA immediately before the backend scan resolves', async () => {
        vi.useFakeTimers();
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

        const quickScanResult = createScanResult();
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        let resolveScan!: (value: LibraryScanResult) => void;
        context.libraryTotalLoadEstimateMs = 90_000;
        context.scanConfiguredLibraryFoldersBackend = vi.fn(() => new Promise<LibraryScanResult>((resolve) => {
            resolveScan = resolve;
        }));

        const runtime = createAppLibraryLoadRuntime(context as never);
        const scanPromise = runtime.scanConfiguredLibraryFolders();

        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(90);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(90);

        nowMs = 10_000;
        await vi.advanceTimersByTimeAsync(10_000);

        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(80);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(80);

        resolveScan(quickScanResult);
        await scanPromise;
    });

    it('replaces an exhausted historical ETA with a scanning status while the backend scan is still unresolved', async () => {
        vi.useFakeTimers();
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

        const quickScanResult = createScanResult();
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        let resolveScan!: (value: LibraryScanResult) => void;
        context.libraryTotalLoadEstimateMs = 1_000;
        context.scanConfiguredLibraryFoldersBackend = vi.fn(() => new Promise<LibraryScanResult>((resolve) => {
            resolveScan = resolve;
        }));

        const runtime = createAppLibraryLoadRuntime(context as never);
        const scanPromise = runtime.scanConfiguredLibraryFolders();

        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(1);

        nowMs = 1_200;
        await vi.advanceTimersByTimeAsync(1_200);

        expect(context.setLibraryLoadingStatusLabel).toHaveBeenLastCalledWith('Scanning library folders...');
        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(null);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(null);

        resolveScan(quickScanResult);
        await scanPromise;
    });

    it('does not add the client finalize tail onto active scanning progress', () => {
        const quickScanResult = createScanResult();
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);

        const runtime = createAppLibraryLoadRuntime(context as never);

        runtime.updateLibraryLoadingEtaFromProgress({
            rootPath: 'C:/Library',
            entriesScanned: 40,
            totalEntries: 100,
            elapsedMs: 15_000,
            etaSeconds: 15,
            phase: 'scanning',
        });

        expect(context.setLibraryLoadingStatusLabel).toHaveBeenLastCalledWith('');
        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(15);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(15);
    });

    it('keeps a finalizing 1s scan ETA visible until it reaches zero', () => {
        const quickScanResult = createScanResult();
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);

        const runtime = createAppLibraryLoadRuntime(context as never);

        runtime.updateLibraryLoadingEtaFromProgress({
            rootPath: 'C:/Library',
            entriesScanned: 99,
            totalEntries: 100,
            elapsedMs: 1500,
            etaSeconds: 1,
            phase: 'finalizing',
        });

        expect(context.setLibraryLoadingStatusLabel).toHaveBeenLastCalledWith('');
        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(3);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(3);
    });

    it('replaces an exhausted finalizing scan ETA with an explicit status label', () => {
        const quickScanResult = createScanResult();
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        context.libraryClientFinalizeEstimateMs = 0;

        const runtime = createAppLibraryLoadRuntime(context as never);

        runtime.updateLibraryLoadingEtaFromProgress({
            rootPath: 'C:/Library',
            entriesScanned: 100,
            totalEntries: 100,
            elapsedMs: 2500,
            etaSeconds: 0,
            phase: 'finalizing',
        });

        expect(context.setLibraryLoadingStatusLabel).toHaveBeenLastCalledWith('Finalizing library...');
        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(null);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(null);
    });

    it('keeps loading active for deferred scans and finishes hydration on the completion update', async () => {
        const quickScanResult = createScanResult({
            deferredFiles: true,
            totalEntries: 42,
            trackCount: 1,
        });
        const hydratedScanResult = createScanResult({
            deferredFiles: false,
            totalEntries: 42,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        const runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.scanConfiguredLibraryFolders();

        expect(context.markLibraryScanResolved).not.toHaveBeenCalled();
        expect(context.fullLibraryScanLoadActive).toBe(true);
        expect(context.finishLibraryLoadTracking).not.toHaveBeenCalled();
        expect(context.setLibraryLoading).toHaveBeenCalledWith(true);
        expect(context.setLibraryLoading).not.toHaveBeenCalledWith(false);
        expect(context.tracks).toHaveLength(0);
        expect(context.setLibraryLoadingEtaSeconds).not.toHaveBeenCalledWith(2);

        await runtime.handleLibraryScanUpdatedEvent(hydratedScanResult);

        expect(context.markLibraryScanResolved).toHaveBeenCalledTimes(1);
        expect(context.loadIndexedFilePage).toHaveBeenCalledWith('track', 0, 1000);
        expect(context.tracks).toHaveLength(1);
        expect(context.loadTrack).toHaveBeenCalledWith(0);
        expect(context.finishLibraryLoadTracking).toHaveBeenCalledTimes(1);
        expect(context.setLibraryLoading).toHaveBeenLastCalledWith(false);
        expect(context.fullLibraryScanLoadActive).toBe(false);
    });

    it('switches from scanning to loading library files before the first paged hydration result arrives', async () => {
        const quickScanResult = createScanResult({
            totalEntries: 1,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const trackPageDeferred = createDeferred<LibraryIndexedFilePage>();
        const context = createContext(quickScanResult, trackEntry);
        context.loadIndexedFilePage = vi.fn(async (kind: LibraryIndexedFilePage['kind']) => {
            if (kind === 'track') {
                return await trackPageDeferred.promise;
            }

            return emptyIndexedFilePage(kind);
        });

        const runtime = createAppLibraryLoadRuntime(context as never);
        const scanPromise = runtime.scanConfiguredLibraryFolders();

        await vi.waitFor(() => {
            expect(context.setLibraryPathMessage).toHaveBeenCalledWith('Loading library files…');
        });

        expect(context.setLibraryLoadingStatusLabel).toHaveBeenCalledWith('Loading library files...');
        expect(context.setLibraryLoadingEtaSeconds).not.toHaveBeenCalledWith(2);
        expect(context.markLibraryScanResolved).not.toHaveBeenCalled();

        trackPageDeferred.resolve({
            kind: 'track',
            offset: 0,
            limit: 1000,
            totalEntries: 1,
            entries: [trackEntry],
        });
        await scanPromise;

        expect(context.markLibraryScanResolved).toHaveBeenCalledTimes(1);
    });

    it('starts the initial track load before the library tree rebuild finishes', async () => {
        const quickScanResult = createScanResult({
            totalEntries: 1,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const rebuildDeferred = createDeferred<undefined>();
        const context = createContext(quickScanResult, trackEntry);
        context.rebuildLibraryTree = vi.fn(async () => await rebuildDeferred.promise);

        const runtime = createAppLibraryLoadRuntime(context as never);
        const scanPromise = runtime.scanConfiguredLibraryFolders();

        await vi.waitFor(() => {
            expect(context.rebuildLibraryTree).toHaveBeenCalledTimes(1);
        });

        expect(context.loadTrack).toHaveBeenCalledWith(0);

        rebuildDeferred.resolve(undefined);
        await scanPromise;
    });

    it('keeps library loading active until the first folder render settles', async () => {
        const quickScanResult = createScanResult({
            totalEntries: 1,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const browserDeferred = createDeferred<undefined>();
        const context = createContext(quickScanResult, trackEntry);
        context.waitForCurrentLibraryBrowser = vi.fn(async () => await browserDeferred.promise);

        const runtime = createAppLibraryLoadRuntime(context as never);
        const scanPromise = runtime.scanConfiguredLibraryFolders();

        await vi.waitFor(() => {
            expect(context.waitForCurrentLibraryBrowser).toHaveBeenCalledTimes(1);
        });

        expect(context.finishLibraryLoadTracking).not.toHaveBeenCalled();
        expect(context.setLibraryLoading).not.toHaveBeenCalledWith(false);

        browserDeferred.resolve(undefined);
        await scanPromise;

        expect(context.finishLibraryLoadTracking).toHaveBeenCalledTimes(1);
        expect(context.setLibraryLoading).toHaveBeenLastCalledWith(false);
    });

    it('keeps the historical ETA running for deferred scans until hydration completes', async () => {
        vi.useFakeTimers();
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

        const quickScanResult = createScanResult({
            deferredFiles: true,
            totalEntries: 42,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        context.libraryTotalLoadEstimateMs = 90_000;

        const runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.scanConfiguredLibraryFolders();

        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenCalledWith(90);
        expect(context.setLibraryLoadingEtaSeconds).not.toHaveBeenCalledWith(2);

        nowMs = 10_000;
        await vi.advanceTimersByTimeAsync(10_000);

        expect(context.setLibraryLoadingEtaSeconds).toHaveBeenLastCalledWith(80);
        expect(context.setForceReloadEtaSeconds).toHaveBeenLastCalledWith(80);
    });

    it('resolves preserved playback by falling back to the previous relative path', async () => {
        const quickScanResult = createScanResult({
            trackCount: 1,
            totalEntries: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Local Song.flac',
            path: 'C:/Library/Artist/Album/01 Local Song.flac',
            relativePath: 'Artist/Album/01 Local Song.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        context.suppressAutoSelectAfterFullLibraryScan = true;
        context.currentTrackIndex = 0;
        context.tracks = [{
            title: '01 Local Song.flac',
            name: '01 Local Song.flac',
            path: 'C:/Library/Artist/Album/01 Local Song.flac',
            relativePath: 'Artist/Album/01 Local Song.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
            displayTitle: '01 Local Song.flac',
            displayAlbum: '',
            displayArtist: '',
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
        }];
        context.getPlaybackState = vi.fn(() => ({
            loaded: true as boolean,
            playing: true as boolean,
            sourcePath: 'C:/Library/Artist/Album/01 Local Song (missing).flac',
            volume: 0.8,
            currentTimeSeconds: 12,
            durationSeconds: 120,
            endedEventId: 0,
        }));
        const runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.scanConfiguredLibraryFolders();

        expect(context.ensureTrackIndexForPath).not.toHaveBeenCalled();
        expect(context.currentTrackIndex).toBe(0);
        expect(context.tracks).toHaveLength(1);
    });

    it('queues hydration completion that arrives during the initial deferred scan load', async () => {
        const quickScanResult = createScanResult({
            deferredFiles: true,
            totalEntries: 42,
            trackCount: 1,
        });
        const hydratedScanResult = createScanResult({
            deferredFiles: false,
            totalEntries: 42,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        let resolveInitialRebuild!: () => void;
        let rebuildCallCount = 0;
        context.rebuildLibraryTree = vi.fn(() => {
            rebuildCallCount += 1;
            if (rebuildCallCount === 1) {
                return new Promise<undefined>((resolve) => {
                    resolveInitialRebuild = () => resolve(undefined);
                });
            }

            return Promise.resolve(undefined);
        });

        const runtime = createAppLibraryLoadRuntime(context as never);
        const scanPromise = runtime.scanConfiguredLibraryFolders();

        await vi.waitFor(() => {
            expect(context.rebuildLibraryTree).toHaveBeenCalledTimes(1);
        });

        await runtime.handleLibraryScanUpdatedEvent(hydratedScanResult);

        expect(context.loadIndexedFilePage).not.toHaveBeenCalledWith('track', 0, 1000);

        resolveInitialRebuild();
        await scanPromise;

        expect(context.rebuildLibraryTree).toHaveBeenCalledTimes(2);
        expect(context.loadIndexedFilePage).toHaveBeenCalledWith('track', 0, 1000);
        expect(context.tracks).toHaveLength(1);
        expect(context.finishLibraryLoadTracking).toHaveBeenCalledTimes(1);
        expect(context.setLibraryLoading).toHaveBeenLastCalledWith(false);
        expect(context.fullLibraryScanLoadActive).toBe(false);
    });

    it('queues hydration completion that arrives before the deferred startup bootstrap finishes', async () => {
        const quickScanResult = createScanResult({
            scanGeneration: 2,
            deferredFiles: true,
            totalEntries: 42,
            trackCount: 1,
        });
        const hydratedScanResult = createScanResult({
            scanGeneration: 2,
            deferredFiles: false,
            totalEntries: 42,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        let runtime!: ReturnType<typeof createAppLibraryLoadRuntime>;
        context.scanConfiguredLibraryFoldersBackend = vi.fn(async () => {
            await runtime.handleLibraryScanUpdatedEvent(hydratedScanResult);
            return quickScanResult;
        });

        runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.scanConfiguredLibraryFolders();

        expect(context.markLibraryScanResolved).toHaveBeenCalledTimes(1);
        expect(context.loadIndexedFilePage).toHaveBeenCalledWith('track', 0, 1000);
        expect(context.tracks).toHaveLength(1);
        expect(context.finishLibraryLoadTracking).toHaveBeenCalledTimes(1);
        expect(context.setLibraryLoading).toHaveBeenLastCalledWith(false);
        expect(context.fullLibraryScanLoadActive).toBe(false);
    });

    it('ignores stale queued hydration completion from an older startup scan generation', async () => {
        const quickScanResult = createScanResult({
            scanGeneration: 2,
            deferredFiles: true,
            totalEntries: 42,
            trackCount: 1,
        });
        const staleHydratedScanResult = createScanResult({
            scanGeneration: 1,
            deferredFiles: false,
            totalEntries: 42,
            trackCount: 1,
        });
        const hydratedScanResult = createScanResult({
            scanGeneration: 2,
            deferredFiles: false,
            totalEntries: 42,
            trackCount: 1,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        let runtime!: ReturnType<typeof createAppLibraryLoadRuntime>;
        context.scanConfiguredLibraryFoldersBackend = vi.fn(async () => {
            await runtime.handleLibraryScanUpdatedEvent(staleHydratedScanResult);
            return quickScanResult;
        });

        runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.scanConfiguredLibraryFolders();

        expect(context.markLibraryScanResolved).not.toHaveBeenCalled();
        expect(context.finishLibraryLoadTracking).not.toHaveBeenCalled();
        expect(context.fullLibraryScanLoadActive).toBe(true);

        await runtime.handleLibraryScanUpdatedEvent(hydratedScanResult);

        expect(context.markLibraryScanResolved).toHaveBeenCalledTimes(1);
        expect(context.finishLibraryLoadTracking).toHaveBeenCalledTimes(1);
        expect(context.setLibraryLoading).toHaveBeenLastCalledWith(false);
        expect(context.fullLibraryScanLoadActive).toBe(false);
    });

    it('clears resolved cover art on incremental scan updates before refreshing the now playing card', async () => {
        const quickScanResult = createScanResult();
        const incrementalScanResult = createScanResult({
            trackCount: 2,
            imageFileCount: 1,
            totalEntries: 3,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        context.getLibraryRootName = vi.fn(() => 'Library');

        const runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.handleLibraryScanUpdatedEvent(incrementalScanResult);

        expect(context.clearResolvedCoverArtCache).toHaveBeenCalledTimes(1);
        expect(context.clearCoverArtCache).not.toHaveBeenCalled();
        expect(context.scheduleOverviewDashboardRefresh).toHaveBeenCalledTimes(1);
        expect(context.scheduleLibraryIncrementalFolderRefresh).toHaveBeenCalledTimes(1);
        expect(context.scheduleNowPlayingCoverRefresh).toHaveBeenCalledTimes(1);
    });

    it('skips incremental folder refresh but still refreshes the now-playing cover while playback is active', async () => {
        const quickScanResult = createScanResult();
        const incrementalScanResult = createScanResult({
            trackCount: 2,
            imageFileCount: 1,
            totalEntries: 3,
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        context.getLibraryRootName = vi.fn(() => 'Library');
        context.getPlaybackState.mockImplementation(() => ({
            loaded: true,
            playing: true,
            sourcePath: 'C:/Library/Artist/Album/01 Track.flac',
            volume: 0.8,
            currentTimeSeconds: 12,
            durationSeconds: 300,
            endedEventId: 0,
        }));

        const runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.handleLibraryScanUpdatedEvent(incrementalScanResult);

        expect(context.clearResolvedCoverArtCache).toHaveBeenCalledTimes(1);
        expect(context.clearCoverArtCache).not.toHaveBeenCalled();
        expect(context.scheduleLibraryIncrementalFolderRefresh).not.toHaveBeenCalled();
        expect(context.scheduleNowPlayingCoverRefresh).toHaveBeenCalledTimes(1);
    });

    it('does not hydrate image-file pages during the initial library load', async () => {
        const quickScanResult = createScanResult({
            trackCount: 1,
            imageFileCount: 3,
            totalEntries: 4,
            coverPathByFolder: {
                'Library/Artist/Album': 'C:/Library/Artist/Album/cover.jpg',
            },
        });
        const trackEntry: LibraryIndexedFile = {
            name: '01 Track.flac',
            path: 'C:/Library/Artist/Album/01 Track.flac',
            relativePath: 'Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            rootPath: 'C:/Library',
            rootName: 'Library',
        };
        const context = createContext(quickScanResult, trackEntry);
        const runtime = createAppLibraryLoadRuntime(context as never);

        await runtime.scanConfiguredLibraryFolders();

        expect(context.loadIndexedFilePage).toHaveBeenCalledWith('track', 0, 1000);
        expect(context.loadIndexedFilePage).not.toHaveBeenCalledWith('image-file', 0, 1000);
        expect(context.imageFiles).toEqual([]);
        expect(context.setFolderCoverPath).toHaveBeenCalledWith('Library/Artist/Album', 'C:/Library/Artist/Album/cover.jpg');
    });
});