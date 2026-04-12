import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSettingsControllerState } from './controllers/settings-controller-types';
const {
    setupAppControllersMock,
    setupAppEventBindingsMock,
} = vi.hoisted(() => ({
    setupAppControllersMock: vi.fn((context) => ({ context })),
    setupAppEventBindingsMock: vi.fn(),
}));

vi.mock('./app-controller-setup', () => ({
    setupAppControllers: setupAppControllersMock,
}));

vi.mock('./app-event-bindings', () => ({
    setupAppEventBindings: setupAppEventBindingsMock,
}));

import { bindEventHandlersFromScope, setupControllersFromScope } from './app-bootstrap-setup';
import type { AppRuntimeScope } from './app-runtime-scope';

const createScope = () => {
    const coverArt = document.createElement('img');
    coverArt.src = '/cover.png';
    coverArt.classList.add('is-visible');

    return {
        currentSettings: { playbackOrder: 'ordered-library' },
        currentMusicBrainzTagWorkerProgress: { progress: 0.25 },
        availableAudioOutputDevices: [{ id: 'default' }],
        currentTrackIndex: 1,
        tracks: [{ path: '/music/track-1.flac' }],
        textFiles: [{ path: '/docs/info.txt' }],
        imageFiles: [{ path: '/art/cover.jpg' }],
        libraryControllerState: {
            sidebarOpen: false,
            libraryRootName: '',
            currentFolderPath: '',
            sidebarAutoFolderPath: '',
            libraryIndexTruncated: false,
            libraryLoading: false,
            libraryLoadingEtaSeconds: null,
            libraryLoadingStatusLabel: '',
            libraryBrowserSortMode: 'name',
            librarySearchQuery: '',
            librarySearchPending: false,
            activeSearchResult: null,
            expandedSearchFolders: new Set<string>(),
        },
        playlistControllerState: {
            loadedPlaylistTrackIndexes: null,
            loadedPlaylistName: '',
            loadedPlaylistPath: '',
            editableQueueTrackIndexes: null,
            selectedSource: 'queue',
            selectedFavoriteIndex: null,
            playbackSource: 'queue',
        },
        settingsControllerState: createSettingsControllerState(),
        ffmpegConfigurationRequired: false,
        artistInfoRequestVersion: 4,
        fullLibraryScanLoadActive: false,
        suppressAutoSelectAfterFullLibraryScan: false,
        sidebarQueueFeedbackTrackIndex: 3,
        sidebarQueueSendToActionScope: 'track',
        sidebarQueueFileActionPath: '/music/current.flac',
        trackMetaMenuTarget: document.createElement('div'),
        trackMetaMenuActionScope: 'track',
        trackMetaMenuActionPath: '/music/current.flac',
        coverFlipped: true,
        suppressCoverFrontClickUntil: 99,
        librarySettings: document.createElement('button'),
        settingsElements: { modal: document.createElement('div') },
        isWindowsRuntime: true,
        isMacRuntime: false,
        isLinuxRuntime: false,
        validateConfiguredFFmpegPath: vi.fn(async () => ({ available: true })),
        missingFFmpegMessage: vi.fn(() => 'Missing FFmpeg'),
        saveSettingsBackend: vi.fn(async (settings) => settings),
        selectLibraryFolder: vi.fn(async () => '/music'),
        selectPlaylistFile: vi.fn(async () => '/playlists/favorites.m3u'),
        playbackSequencingService: {
            getPlaybackOrderMode: vi.fn(() => 'ordered-library'),
            getPlaybackOrderLabel: vi.fn(() => 'Ordered library'),
        },
        visualizerController: {
            setEnabled: vi.fn(),
            setLissajousScale: vi.fn(),
            setMode: vi.fn(),
        },
        applyUiDitheringSetting: vi.fn(),
        socialController: {
            handleSettingsChanged: vi.fn(),
        },
        setPlaybackOrderMode: vi.fn(),
        applyCoverArtForTrack: vi.fn(async () => undefined),
        playlistControllerRef: {
            refreshFavorites: vi.fn(),
            closeMenu: vi.fn(),
            loadPlaylistByPath: vi.fn(),
        },
        resetShuffleHistory: vi.fn(),
        hasListenBrainzScrobbling: vi.fn(() => false),
        closeListenBrainzFeedbackMenu: vi.fn(),
        playbackStateService: {
            isBackendReady: vi.fn(() => true),
            setBackendReady: vi.fn(),
        },
        audioQueueNextTrack: vi.fn(async () => undefined),
        queueGaplessNextTrack: vi.fn(async () => undefined),
        refreshNowPlayingLabel: vi.fn(),
        completeStartupIfReady: vi.fn(async () => undefined),
        refreshListenBrainzFeedbackForCurrentTrack: vi.fn(async () => undefined),
        getLastFmRequestToken: vi.fn(async () => 'request-token'),
        browserOpenUrl: vi.fn(async () => undefined),
        openQueueConfirmModal: vi.fn(async () => true),
        getLastFmSessionKey: vi.fn(async () => 'session-key'),
        refreshAvailableAudioOutputDevices: vi.fn(async () => [{ id: 'default' }]),
        audioReinitializeBackend: vi.fn(async () => undefined),
        applyPlaybackState: vi.fn(),
        updatePlayButton: vi.fn(),
        scanConfiguredLibraryFolders: vi.fn(async () => undefined),
        openErrorModal: vi.fn(),
        getStoredLayout: vi.fn(() => 'release'),
        applyPlayerCardLayout: vi.fn(),
        playlistBtn: document.createElement('button'),
        playlistMenuElements: { menu: document.createElement('div') },
        playlistModalElements: { modal: document.createElement('div') },
        baseSequenceIndexes: vi.fn(() => [0]),
        ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
        selectPlaylistSaveFile: vi.fn(async () => '/playlists/out.m3u'),
        loadPlaylistData: vi.fn(async () => []),
        savePlaylistData: vi.fn(() => undefined),
        appendTracksToPlaylistData: vi.fn(() => undefined),
        loadTrack: vi.fn(async () => undefined),
        playCurrentTrack: vi.fn(async () => undefined),
        playlistTargetModalElements: { modal: document.createElement('div') },
        shareElements: { modal: document.createElement('div') },
        ensureTrackTagsResolved: vi.fn(async () => undefined),
        trackIndexForPath: vi.fn(() => 0),
        resolveCoverForTrack: vi.fn(async () => 'cover-data'),
        coverArtService: {
            getCachedMediaArtwork: vi.fn(() => ['artwork']),
        },
        coverArt,
        closePlayOrderMenu: vi.fn(),
        closeTrackMetaMenu: vi.fn(),
        closeSidebarQueueMenu: vi.fn(),
        selectShareImageSaveFile: vi.fn(async () => '/art/share.png'),
        saveShareImageFile: vi.fn(async () => undefined),
        copyShareImageToClipboard: vi.fn(async () => true),
        imageModalElements: { modal: document.createElement('div') },
        readFileBase64: vi.fn(async () => 'base64'),
        readImageThumbnail: vi.fn(async () => 'thumb'),
        artistInfoElements: { panel: document.createElement('div') },
        lookupArtistByMBID: vi.fn(async () => ({ name: 'Artist' })),
        app: document.createElement('div'),
        sidebarToggle: document.createElement('button'),
        librarySidebar: document.createElement('aside'),
        libraryBack: document.createElement('button'),
        libraryPath: document.createElement('p'),
        librarySearch: document.createElement('input'),
        librarySort: document.createElement('select'),
        libraryBrowser: document.createElement('div'),
        libraryScanYieldIndicator: document.createElement('span'),
        loadFolderPage: vi.fn(async () => ({ entries: [] })),
        resolveLibraryFolderForAbsolutePath: vi.fn(async () => '/music'),
        isFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
        searchLibrary: vi.fn(async () => ({ entries: [] })),
        ensureTrackIndexForPath: vi.fn(() => 0),
        textFileIndexByPath: vi.fn(() => 0),
        imageFileIndexByPath: vi.fn(() => 0),
        openTextFileModal: vi.fn(async () => undefined),
        openSidebarQueueMenu: vi.fn(),
        window,
        document,
        coverFrame: document.createElement('div'),
        coverFront: document.createElement('div'),
        trackTechnical: document.createElement('button'),
        trackTechnicalAlt: document.createElement('button'),
        libraryAbout: document.createElement('button'),
        sidebarQueueAddNext: document.createElement('button'),
        sidebarQueueAddToPlaylist: document.createElement('button'),
        sidebarQueuePlay: document.createElement('button'),
        sidebarQueueLove: document.createElement('button'),
        sidebarQueueHate: document.createElement('button'),
        sidebarQueueEnd: document.createElement('button'),
        sidebarQueueSendToList: document.createElement('div'),
        errorBackdrop: document.createElement('div'),
        errorClose: document.createElement('button'),
        errorOk: document.createElement('button'),
        errorModal: document.createElement('div'),
        queueConfirmBackdrop: document.createElement('div'),
        queueConfirmCancel: document.createElement('button'),
        queueConfirmProceed: document.createElement('button'),
        textFileBackdrop: document.createElement('div'),
        textFileClose: document.createElement('button'),
        musicBrainzEntityBackdrop: document.createElement('div'),
        musicBrainzEntityClose: document.createElement('button'),
        shareBackdrop: document.createElement('div'),
        shareClose: document.createElement('button'),
        shareCommentInput: document.createElement('input'),
        shareSave: document.createElement('button'),
        shareCopy: document.createElement('button'),
        technicalInfoBackdrop: document.createElement('div'),
        technicalInfoClose: document.createElement('button'),
        aboutBackdrop: document.createElement('div'),
        aboutClose: document.createElement('button'),
        aboutRepoLink: document.createElement('a'),
        playPause: document.createElement('button'),
        playOrderMenu: document.createElement('div'),
        trackMetaParentFolderBtn: document.createElement('button'),
        trackMetaBrowserFolderBtn: document.createElement('button'),
        trackMetaCopyFilePathBtn: document.createElement('button'),
        trackMetaCopyFolderPathBtn: document.createElement('button'),
        trackMetaOpenMbBtn: document.createElement('button'),
        trackMetaSendToList: document.createElement('div'),
        back: document.createElement('button'),
        forward: document.createElement('button'),
        shareBtn: document.createElement('button'),
        seek: document.createElement('input'),
        volume: document.createElement('input'),
        volumeBtn: document.createElement('button'),
        playlistTargetModalControllerRef: { open: vi.fn() },
        settingsControllerRef: {
            handleDocumentClick: vi.fn(() => false),
            setMusicBrainzTagWorkerProgress: vi.fn(),
        },
        libraryControllerRef: { navigate: vi.fn() },
        shareControllerRef: { open: vi.fn() },
        imageModalControllerRef: { open: vi.fn() },
        playerCard: document.createElement('section'),
        sidebarQueueMenu: document.createElement('div'),
        queueConfirmModal: document.createElement('div'),
        listenBrainzFeedbackMenu: document.createElement('div'),
        listenBrainzLoveBtn: document.createElement('button'),
        trackMetaMenu: document.createElement('div'),
        musicBrainzEntityModal: document.createElement('div'),
        shareModal: document.createElement('div'),
        technicalInfoModal: document.createElement('div'),
        aboutModal: document.createElement('div'),
        textFileModal: document.createElement('div'),
        trackTitle: document.createElement('p'),
        trackAlbum: document.createElement('p'),
        trackArtist: document.createElement('p'),
        trackTitleInline: document.createElement('span'),
        trackReleaseAlbum: document.createElement('span'),
        trackArtistHeader: document.createElement('p'),
        playerLane: document.createElement('div'),
        handleDroppedFolderPath: vi.fn(),
        playDroppedTrackPath: vi.fn(),
        openCoverImageModal: vi.fn(),
        toggleCoverFlipFromSecondaryInput: vi.fn(),
        toggleCoverFlipFromContextMenu: vi.fn(),
        openTechnicalInfoModal: vi.fn(),
        openAboutModal: vi.fn(),
        captureSidebarQueueSelectionContext: vi.fn(),
        resolveSidebarQueueTrackIndexesForAction: vi.fn(() => [0]),
        addSidebarSelectionToPlaylist: vi.fn(),
        playSidebarQueueSelection: vi.fn(),
        submitSidebarQueueFeedback: vi.fn(),
        sendToActionsForScope: vi.fn(() => [{ title: 'Send to target' }]),
        logSendToFrontend: vi.fn(),
        runCustomSendToAction: vi.fn(),
        suppressTrackMetaClicks: vi.fn(),
        closeErrorModal: vi.fn(),
        closeQueueConfirmModal: vi.fn(),
        closeTextFileModal: vi.fn(),
        closeMusicBrainzEntityModal: vi.fn(),
        closeTechnicalInfoModal: vi.fn(),
        closeAboutModal: vi.fn(),
        openPlayOrderMenu: vi.fn(),
        savePlaybackOrderSetting: vi.fn(),
        openCurrentTrackFolderInSidebar: vi.fn(),
        openCurrentTrackFolderInFileBrowser: vi.fn(),
        copyCurrentTrackFilePath: vi.fn(),
        copyCurrentTrackFolderPath: vi.fn(),
        goToTrack: vi.fn(),
        toggleCurrentTrack: vi.fn(),
        updateLyricsPanelVisibility: vi.fn(),
        hideToTrayWhenMinimized: vi.fn(),
        unlockMediaSessionAnchorFromUserGesture: vi.fn(),
        handleFocusedHardwareMediaKey: vi.fn(),
        handleFocusedKeyboardShortcut: vi.fn(),
        focusedShortcutBindingsUseCode: vi.fn(() => true),
        setCtrlHeldState: vi.fn(),
        updateTrackLabels: vi.fn(),
        updatePlayOrderMenuState: vi.fn(),
        refreshLyricsPanel: vi.fn(),
        resetListenBrainzFeedbackState: vi.fn(),
        initializeMediaSessionIntegration: vi.fn(),
        initializeSettings: vi.fn(),
        initializeAppVersion: vi.fn(),
        handleLibraryScanUpdatedEvent: vi.fn(),
        updateLibraryLoadingEtaFromProgress: vi.fn(),
        normalizeMusicBrainzTagWorkerProgress: vi.fn((value) => value),
        dispatchExternalPlaybackAction: vi.fn(),
        cardResizeObserver: { disconnect: vi.fn() },
        logRescan: vi.fn(),
        currentTimeLabel: document.createElement('span'),
        formatTime: vi.fn((value: number) => `${value}s`),
        audioSeek: vi.fn(async () => undefined),
        audioSetVolume: vi.fn(async () => undefined),
        handleAudioError: vi.fn(),
        mediaSessionController: { sync: vi.fn() },
    };
};

describe('app-bootstrap-setup wrappers', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('maps scope-backed controller setup callbacks and mutable state', async () => {
        const scope = createScope();
        const runtime = setupControllersFromScope(scope as unknown as AppRuntimeScope);
        const context = setupAppControllersMock.mock.calls[0]?.[0];

        expect(runtime).toEqual({ context });
        expect(context.currentSettings).toBe(scope.currentSettings);
        expect(context.libraryControllerState).toBe(scope.libraryControllerState);
        expect(context.playlistControllerState).toBe(scope.playlistControllerState);
        expect(context.settingsControllerState).toBe(scope.settingsControllerState);

        context.currentSettings = { playbackOrder: 'shuffle-library' };
        context.currentMusicBrainzTagWorkerProgress = { progress: 0.75 };
        context.availableAudioOutputDevices = [{ id: 'usb' }];
        context.currentTrackIndex = 5;
        context.tracks = [{ path: '/music/updated.flac' }];
        context.ffmpegConfigurationRequired = true;

        await context.saveSettings({ libraryPath: '/music' });
        await context.applyCoverArtForTrack(2);
        context.refreshPlaylistFavorites();
        expect(context.isPlaybackBackendReady()).toBe(true);
        await context.audioQueueNextTrack('current', 'next');
        await context.queueGaplessNextTrack({ loaded: true }, [0]);
        await context.completeStartupIfReady();
        await context.refreshListenBrainzFeedbackForCurrentTrack();
        expect(await context.getLastFmRequestToken('key', 'secret')).toBe('request-token');
        expect(await context.getLastFmSessionKey('key', 'secret', 'token')).toBe('session-key');
        await context.refreshAvailableAudioOutputDevices();
        await context.audioReinitializeBackend();
        context.setPlaybackBackendReady(false);
        expect(context.getPlaybackOrderMode()).toBe('ordered-library');
        expect(context.getPlaybackOrderLabel()).toBe('Ordered library');
        expect(context.getBaseSequence()).toEqual([0]);
        await context.ensureTrackTagsResolvedBatch([0]);
        await context.loadPlaylistData('/playlists/favorites.m3u');
        context.savePlaylistData('/playlists/favorites.m3u', ['/music/track-1.flac']);
        context.appendTracksToPlaylistData('/playlists/favorites.m3u', ['/music/track-1.flac']);
        await context.loadTrack(1, false, [0], true);
        await context.playCurrentTrack();
        await context.ensureTrackTagsResolved(0);
        expect(await context.resolveCoverForTrack(scope.tracks[0])).toBe('cover-data');
        expect(context.getCachedMediaArtwork(scope.tracks[0])).toEqual(['artwork']);
        expect(context.getCoverArtSrc()).toContain('/cover.png');
        scope.coverArt.classList.remove('is-visible');
        expect(context.getCoverArtSrc()).toBeUndefined();
        context.closeOtherMenus();
        expect(context.artistInfoRequestVersion).toBe(4);
        context.fullLibraryScanLoadActive = true;
        context.suppressAutoSelectAfterFullLibraryScan = true;
        await context.openTextFileModal(scope.textFiles[0]);

        expect(scope.currentSettings).toEqual({ playbackOrder: 'shuffle-library' });
        expect(scope.currentMusicBrainzTagWorkerProgress).toEqual({ progress: 0.75 });
        expect(scope.availableAudioOutputDevices).toEqual([{ id: 'usb' }]);
        expect(scope.currentTrackIndex).toBe(5);
        expect(scope.tracks).toEqual([{ path: '/music/updated.flac' }]);
        expect(scope.ffmpegConfigurationRequired).toBe(true);
        expect(scope.saveSettingsBackend).toHaveBeenCalledWith({ libraryPath: '/music' });
        expect(scope.visualizerController.setEnabled).not.toHaveBeenCalled();
        expect(scope.visualizerController.setLissajousScale).not.toHaveBeenCalled();
        expect(scope.visualizerController.setMode).not.toHaveBeenCalled();
        expect(scope.playbackStateService.setBackendReady).toHaveBeenCalledWith(false);
        expect(scope.closePlayOrderMenu).toHaveBeenCalledTimes(1);
        expect(scope.closeTrackMetaMenu).toHaveBeenCalledTimes(1);
        expect(scope.closeListenBrainzFeedbackMenu).toHaveBeenCalledTimes(1);
        expect(scope.closeSidebarQueueMenu).toHaveBeenCalledTimes(1);
        expect(scope.playlistControllerRef.closeMenu).toHaveBeenCalledTimes(1);
    });

    it('maps event binding callbacks and live getters from scope', async () => {
        const scope = createScope();

        bindEventHandlersFromScope(scope as unknown as AppRuntimeScope);
        const context = setupAppEventBindingsMock.mock.calls[0]?.[0];

        expect(context.window).toBe(window);
        expect(context.document).toBe(document);
        expect(context.librarySearch).toBe(scope.librarySearch);
        expect(context.sidebarQueueFeedbackTrackIndex()).toBe(3);
        expect(context.sidebarQueueSendToActionScope()).toBe('track');
        expect(context.sidebarQueueFileActionPath()).toBe('/music/current.flac');
        expect(context.trackMetaMenuTarget()).toBe(scope.trackMetaMenuTarget);
        expect(context.trackMetaMenuActionScope()).toBe('track');
        expect(context.trackMetaMenuActionPath()).toBe('/music/current.flac');
        expect(context.coverFlipped).toBe(true);
        expect(context.suppressCoverFrontClickUntil).toBe(99);
        expect(context.currentMusicBrainzTagWorkerProgress).toEqual({ progress: 0.25 });

        context.setMusicBrainzTagWorkerProgress({ progress: 1 });
        context.currentMusicBrainzTagWorkerProgress = { progress: 0.5 };
        context.playlistControllerLoadPlaylistByPath('/playlists/favorites.m3u');
        context.handleDocumentClickWithinSettings(document.body);
        await context.audioSeek(15);
        await context.audioSetVolume(0.4);

        expect(scope.settingsControllerRef.setMusicBrainzTagWorkerProgress).toHaveBeenCalledWith({ progress: 1 });
        expect(scope.currentMusicBrainzTagWorkerProgress).toEqual({ progress: 0.5 });
        expect(scope.playlistControllerRef.loadPlaylistByPath).toHaveBeenCalledWith('/playlists/favorites.m3u');
        expect(scope.settingsControllerRef.handleDocumentClick).toHaveBeenCalledWith(document.body);
        expect(scope.audioSeek).toHaveBeenCalledWith(15);
        expect(scope.audioSetVolume).toHaveBeenCalledWith(0.4);
    });
});