import { afterEach, describe, expect, it, vi } from 'vitest';

const {
    createAppLibraryLoadRuntimeMock,
    createAppPlaybackControlsRuntimeMock,
} = vi.hoisted(() => ({
    createAppLibraryLoadRuntimeMock: vi.fn((context) => ({ context })),
    createAppPlaybackControlsRuntimeMock: vi.fn((context) => ({ context })),
}));

vi.mock('./app-library-load-runtime', () => ({
    createAppLibraryLoadRuntime: createAppLibraryLoadRuntimeMock,
}));

vi.mock('./app-playback-controls-runtime', () => ({
    createAppPlaybackControlsRuntime: createAppPlaybackControlsRuntimeMock,
}));

import { setupLibraryLoadRuntime, setupPlaybackControlsRuntime } from './app-runtime-setup';
import type { AppRuntimeScope } from './app-runtime-scope';

const createScope = () => {
    const libraryControllerRef = {
        getLibraryRootName: vi.fn(() => 'Library'),
        getCurrentFolderPath: vi.fn(() => 'Library/Artist'),
        setCurrentFolderPath: vi.fn(),
        getLibrarySearchStateSnapshot: vi.fn(() => null),
        restoreLibrarySearchState: vi.fn(),
        navigateToFolder: vi.fn(),
        rebuildLibraryTree: vi.fn(async () => undefined),
        firstTrackIndexFromRandomAlbumFolder: vi.fn(() => 3),
        resetLibraryState: vi.fn(),
        setLibraryLoading: vi.fn(),
        setLibraryLoadingEtaSeconds: vi.fn(),
        setLibraryLoadingStatusLabel: vi.fn(),
        setLibraryPathMessage: vi.fn(),
        setLibraryRootName: vi.fn(),
        setLibraryIndexTruncated: vi.fn(),
        renderFolder: vi.fn(),
    };
    const playlistControllerRef = {
        refreshOpenModal: vi.fn(),
        resetState: vi.fn(),
        loadPlaylistByPath: vi.fn(),
    };
    const settingsControllerRef = {
        setForceReloadEtaSeconds: vi.fn(),
        setMusicBrainzTagWorkerProgress: vi.fn(),
        handleDocumentClick: vi.fn(() => false),
        open: vi.fn(),
    };

    return {
        libraryIndexedFilePageSize: 1000,
        selectedLibraryRootLabel: 'Selected folders',
        objectUrls: [],
        tracks: [],
        textFiles: [],
        imageFiles: [],
        currentTrackIndex: 2,
        currentSettings: { playbackOrder: 'ordered-library' },
        currentMusicBrainzTagWorkerProgress: { progress: 0.5 },
        availableAudioOutputDevices: [{ id: 'default', name: 'Default', backend: 'wasapi', isDefault: true }],
        libraryClientFinalizeEstimateMs: 2500,
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
        coverArtBackground: document.createElement('img'),
        aboutVersion: document.createElement('div'),
        closeSidebarQueueMenu: vi.fn(),
        closeListenBrainzFeedbackMenu: vi.fn(),
        closeMusicBrainzEntityModal: vi.fn(),
        closeTechnicalInfoModal: vi.fn(),
        clearReplayGainReleaseDynamicRangeCache: vi.fn(),
        audioStop: vi.fn(async () => ({ loaded: false })),
        applyPlaybackState: vi.fn(),
        handleAudioError: vi.fn(),
        coverArtService: {
            clearCache: vi.fn(),
            setFolderCoverPath: vi.fn(),
            getCachedMediaArtwork: vi.fn(() => []),
        },
        artistInfoControllerRef: {
            clearCache: vi.fn(),
        },
        imageModalControllerRef: {
            clearCachedDataUrls: vi.fn(),
        },
        scrobbleService: {
            reset: vi.fn(),
            startTrackSession: vi.fn(),
        },
        resetShuffleHistory: vi.fn(),
        setBackgroundCover: vi.fn(),
        setCoverFlipped: vi.fn(),
        resetArtistInfoPanel: vi.fn(),
        updateMediaSessionMetadata: vi.fn(),
        beginLibraryLoadTracking: vi.fn(),
        markLibraryScanResolved: vi.fn(),
        finishLibraryLoadTracking: vi.fn(),
        scanConfiguredLibraryFoldersBackend: vi.fn(async () => ({ trackFiles: [], textFiles: [], imageFiles: [] })),
        libraryControllerRef,
        playlistControllerRef,
        settingsControllerRef,
        playbackStateService: {
            getPlaybackState: vi.fn(() => ({ loaded: true, playing: false })),
            isBackendReady: vi.fn(() => true),
        },
        loadTrack: vi.fn(async () => undefined),
        updatePlayButton: vi.fn(),
        scheduleLibraryIncrementalFolderRefresh: vi.fn(),
        scheduleNowPlayingCoverRefresh: vi.fn(),
        applyPlayerCardLayout: vi.fn(),
        getStoredLayout: vi.fn(() => 'release'),
        resetListenBrainzFeedbackState: vi.fn(),
        listAudioOutputDevices: vi.fn(async () => ['device']),
        getSettings: vi.fn(async () => ({ ffmpegPath: 'ffmpeg' })),
        visualizerController: {
            setEnabled: vi.fn(),
            setMode: vi.fn(),
        },
        applyUiDitheringSetting: vi.fn(),
        socialController: {
            handleSettingsChanged: vi.fn(),
            showLibrary: vi.fn(),
        },
        getMusicBrainzTagWorkerProgress: vi.fn(async () => ({ enabled: true })),
        setPlaybackOrderMode: vi.fn(),
        completeStartupIfReady: vi.fn(async () => undefined),
        refreshListenBrainzFeedbackForCurrentTrack: vi.fn(async () => undefined),
        getAppVersion: vi.fn(async () => 'dev'),
        rebuildTrackPathIndex: vi.fn(),
        rebuildTextFilePathIndex: vi.fn(),
        rebuildImageFilePathIndex: vi.fn(),
        logRescan: vi.fn(),
        loadIndexedFilePage: vi.fn(async () => ({ entries: [], totalEntries: 0 })),
        aboutVersionTransitionMs: 180,
        gaplessQueueRequestVersion: 0,
        queuedGaplessTrackPath: '',
        playbackSequencingService: {
            getPlaybackOrderMode: vi.fn(() => 'ordered-library'),
        },
        playPauseToggleInFlight: false,
        playbackMutationVersion: 7,
        shouldSkipLoadedTrack: vi.fn(async () => false),
        nextTrackIndexForDirection: vi.fn(() => 1),
        trackNavigationChain: Promise.resolve(),
        coverArt: Object.assign(document.createElement('img'), { src: '/cover.png' }),
        librarySearch: document.createElement('input'),
    };
};

describe('app-runtime-setup wrappers', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('wires library-load runtime callbacks through live scope accessors', async () => {
        const scope = createScope();
        const runtime = setupLibraryLoadRuntime(scope as unknown as AppRuntimeScope);
        const context = createAppLibraryLoadRuntimeMock.mock.calls[0]?.[0];

        expect(runtime).toEqual({ context });
        expect(context.currentSettings).toBe(scope.currentSettings);

        context.currentSettings = { playbackOrder: 'shuffle-library' };
        expect(scope.currentSettings).toEqual({ playbackOrder: 'shuffle-library' });

        await context.listAudioOutputDevices();
        await context.getSettings();
        await context.getMusicBrainzTagWorkerProgress();
        context.refreshPlaylistOpenModal();
        context.setMusicBrainzTagWorkerProgress({ enabled: false });

        expect(scope.listAudioOutputDevices).toHaveBeenCalledTimes(1);
        expect(scope.getSettings).toHaveBeenCalledTimes(1);
        expect(scope.getMusicBrainzTagWorkerProgress).toHaveBeenCalledTimes(1);
        expect(scope.playlistControllerRef.refreshOpenModal).toHaveBeenCalledTimes(1);
        expect(scope.settingsControllerRef.setMusicBrainzTagWorkerProgress).toHaveBeenCalledWith({ enabled: false });
    });

    it('wires playback-controls runtime callbacks and mutable state through scope', async () => {
        const scope = createScope();
        const runtime = setupPlaybackControlsRuntime(scope as unknown as AppRuntimeScope);
        const context = createAppPlaybackControlsRuntimeMock.mock.calls[0]?.[0];

        expect(runtime).toEqual({ context });
        expect(context.libraryController()).toBe(scope.libraryControllerRef);
        expect(context.settingsController()).toBe(scope.settingsControllerRef);
        expect(context.currentTrackIndex).toBe(2);

        context.setCoverFlipped(false);
        context.currentTrackIndex = 5;
        context.playPauseToggleInFlight = true;
        context.trackNavigationChain = Promise.resolve();
        await context.shouldSkipLoadedTrack();

        expect(scope.setCoverFlipped).toHaveBeenCalledWith(false);
        expect(scope.currentTrackIndex).toBe(5);
        expect(scope.playPauseToggleInFlight).toBe(true);
        expect(scope.shouldSkipLoadedTrack).toHaveBeenCalledTimes(1);
    });
});