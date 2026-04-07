import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultAppSettings } from './utils/settings-normalization';
import type { AppControllerSetupContext } from './app-bootstrap-setup';

const {
    createArtistInfoControllerMock,
    createImageModalControllerMock,
    createLibraryControllerMock,
    createPlaylistControllerMock,
    createPlaylistTargetModalControllerMock,
    createShareControllerMock,
    createSettingsControllerMock,
    createFromAppSettingsMock,
} = vi.hoisted(() => ({
    createArtistInfoControllerMock: vi.fn(),
    createImageModalControllerMock: vi.fn(),
    createLibraryControllerMock: vi.fn(),
    createPlaylistControllerMock: vi.fn(),
    createPlaylistTargetModalControllerMock: vi.fn(),
    createShareControllerMock: vi.fn(),
    createSettingsControllerMock: vi.fn(),
    createFromAppSettingsMock: vi.fn((value) => value),
}));

vi.mock('./controllers/artist-info-controller', () => ({
    createArtistInfoController: createArtistInfoControllerMock,
}));

vi.mock('./controllers/image-modal-controller', () => ({
    createImageModalController: createImageModalControllerMock,
}));

vi.mock('./controllers/library-controller', () => ({
    createLibraryController: createLibraryControllerMock,
}));

vi.mock('./controllers/playlist-controller', () => ({
    createPlaylistController: createPlaylistControllerMock,
}));

vi.mock('./controllers/playlist-target-modal-controller', () => ({
    createPlaylistTargetModalController: createPlaylistTargetModalControllerMock,
}));

vi.mock('./controllers/share-controller', () => ({
    createShareController: createShareControllerMock,
}));

vi.mock('./controllers/settings-controller', () => ({
    createSettingsController: createSettingsControllerMock,
}));

vi.mock('../wailsjs/go/models', () => ({
    main: {
        AppSettings: {
            createFrom: createFromAppSettingsMock,
        },
    },
}));

import { setupAppControllers } from './app-controller-setup';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const createTrack = (path: string, title: string) => ({
    title,
    name: title,
    path,
    relativePath: title,
    folderPath: '/music/library',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: title,
    displayAlbum: 'Album',
    displayArtist: 'Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: true,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
});

const createContext = () => {
    const tracks = [
        createTrack('/music/library/track-1.flac', 'Track 1'),
        createTrack('/music/library/track-2.flac', 'Track 2'),
    ];
    const textFiles = [{ path: '/music/library/readme.txt', name: 'readme.txt' }];
    const imageFiles = [{ path: '/music/library/cover.jpg', name: 'cover.jpg' }];

    return {
        librarySettings: document.createElement('button'),
        settingsElements: { modal: document.createElement('div') },
        isWindowsRuntime: true,
        isMacRuntime: false,
        isLinuxRuntime: false,
        currentSettings: {
            ...defaultAppSettings,
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            libraryPath: '/music/library',
            favoritePlaylists: ['favorites.m3u'],
            audio: {
                ...defaultAppSettings.audio,
                gaplessPlayback: false,
            },
        },
        currentMusicBrainzTagWorkerProgress: { enabled: true, active: false, progress: 0.2 },
        availableAudioOutputDevices: [{ id: 'default', name: 'Default', backend: 'wasapi', isDefault: true }],
        currentTrackIndex: 0,
        tracks,
        textFiles,
        imageFiles,
        ffmpegConfigurationRequired: true,
        artistInfoRequestVersion: 9,
        validateConfiguredFFmpegPath: vi.fn(async () => ({ available: true })),
        missingFFmpegMessage: vi.fn(() => 'Missing FFmpeg'),
        saveSettings: vi.fn(async (settings) => settings),
        selectLibraryFolder: vi.fn(async () => '/music/library'),
        selectPlaylistFile: vi.fn(async () => '/playlists/favorites.m3u'),
        getPlaybackOrderMode: vi.fn(() => 'shuffle-library'),
        setLissajousEnabled: vi.fn(),
        applyUiDitheringSetting: vi.fn(),
        handleListenBrainzSocialSettingsChanged: vi.fn(),
        setPlaybackOrderMode: vi.fn(),
        applyCoverArtForTrack: vi.fn(async () => undefined),
        resetShuffleHistory: vi.fn(),
        hasListenBrainzScrobbling: vi.fn(() => false),
        closeListenBrainzFeedbackMenu: vi.fn(),
        isPlaybackBackendReady: vi.fn(() => true),
        audioQueueNextTrack: vi.fn(async () => undefined),
        queueGaplessNextTrack: vi.fn(async () => undefined),
        refreshNowPlayingLabel: vi.fn(),
        completeStartupIfReady: vi.fn(async () => undefined),
        refreshListenBrainzFeedbackForCurrentTrack: vi.fn(async () => undefined),
        getLastFmRequestToken: vi.fn(async () => 'request-token'),
        browserOpenUrl: vi.fn(async () => undefined),
        openQueueConfirmModal: vi.fn(async () => true),
        getLastFmSessionKey: vi.fn(async () => 'session-key'),
        refreshAvailableAudioOutputDevices: vi.fn(async () => [{ id: 'usb', name: 'USB DAC', backend: 'wasapi', isDefault: false }]),
        audioReinitializeBackend: vi.fn(async () => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: 1, endEventId: 0 })),
        setPlaybackBackendReady: vi.fn(),
        applyPlaybackState: vi.fn(),
        updatePlayButton: vi.fn(),
        scanConfiguredLibraryFolders: vi.fn(async () => undefined),
        openErrorModal: vi.fn(),
        getPlayerCardLayout: vi.fn(() => 'release'),
        setPlayerCardLayout: vi.fn(),
        playlistBtn: document.createElement('button'),
        playlistMenuElements: { menu: document.createElement('div') },
        playlistModalElements: { modal: document.createElement('div') },
        getPlaybackOrderLabel: vi.fn(() => 'Shuffle library'),
        getBaseSequence: vi.fn(() => [0, 1]),
        ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
        selectPlaylistSaveFile: vi.fn(async () => '/playlists/output.m3u'),
        loadPlaylistData: vi.fn(async () => ['/music/library/track-1.flac']),
        savePlaylistData: vi.fn(() => undefined),
        appendTracksToPlaylistData: vi.fn(() => undefined),
        loadTrack: vi.fn(async () => undefined),
        playCurrentTrack: vi.fn(async () => undefined),
        playlistTargetModalElements: { modal: document.createElement('div') },
        shareElements: { modal: document.createElement('div') },
        ensureTrackTagsResolved: vi.fn(async () => undefined),
        trackIndexForPath: vi.fn((path: string) => tracks.findIndex((track) => track.path === path)),
        resolveCoverForTrack: vi.fn(async () => 'cover-data'),
        getCachedMediaArtwork: vi.fn(() => ['artwork']),
        getCoverArtSrc: vi.fn(() => '/cover.png'),
        closeOtherMenus: vi.fn(),
        selectShareImageSaveFile: vi.fn(async () => '/art/share.png'),
        saveShareImageFile: vi.fn(async () => undefined),
        imageModalElements: { modal: document.createElement('div') },
        readFileBase64: vi.fn(async () => 'base64'),
        readImageThumbnail: vi.fn(async () => 'thumbnail'),
        artistInfoElements: { panel: document.createElement('div') },
        lookupArtistByMBID: vi.fn(async () => ({ name: 'Artist' })),
        openUrl: vi.fn(async () => undefined),
        app: document.createElement('div'),
        sidebarToggle: document.createElement('button'),
        librarySidebar: document.createElement('aside'),
        libraryBack: document.createElement('button'),
        libraryPath: document.createElement('p'),
        librarySearch: document.createElement('input'),
        libraryBrowser: document.createElement('div'),
        libraryScanYieldIndicator: document.createElement('span'),
        loadFolderPage: vi.fn(async () => ({ folderPath: '/music/library', offset: 0, limit: 100, totalEntries: 0, entries: [] })),
        resolveLibraryFolderForAbsolutePath: vi.fn(async () => '/music/library'),
        isFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
        searchLibrary: vi.fn(async () => ({ query: 'track', offset: 0, limit: 100, totalEntries: 1, entries: [] })),
        resolveTrackIndex: vi.fn((path: string) => tracks.findIndex((track) => track.path === path)),
        resolveTextFileIndex: vi.fn(() => 0),
        resolveImageFileIndex: vi.fn(() => 0),
        fullLibraryScanLoadActive: true,
        suppressAutoSelectAfterFullLibraryScan: false,
        ensureTrackIndexForPath: vi.fn((path: string) => tracks.findIndex((track) => track.path === path)),
        openTextFileModal: vi.fn(async () => undefined),
        openSidebarQueueMenu: vi.fn(),
        closeSidebarQueueMenu: vi.fn(),
    };
};

describe('app-controller-setup', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('wires controller factories and settings flows through the app context', async () => {
        const playlistController = {
            refreshFavorites: vi.fn(),
            activatePlaybackQueueSource: vi.fn(),
        };
        const imageModalController = {
            openImageFile: vi.fn(),
        };
        const playlistTargetModalController = { modal: true };
        const shareController = { share: true };
        const artistInfoController = { artist: true };
        const libraryController = { library: true };

        createSettingsControllerMock.mockImplementation((config) => ({ config }));
        createPlaylistControllerMock.mockReturnValue(playlistController);
        createPlaylistTargetModalControllerMock.mockReturnValue(playlistTargetModalController);
        createShareControllerMock.mockReturnValue(shareController);
        createImageModalControllerMock.mockReturnValue(imageModalController);
        createArtistInfoControllerMock.mockReturnValue(artistInfoController);
        createLibraryControllerMock.mockReturnValue(libraryController);

        const context = createContext();
        const controllers = setupAppControllers(context as unknown as AppControllerSetupContext);

        const settingsConfig = createSettingsControllerMock.mock.calls[0]?.[0];
        const playlistConfig = createPlaylistControllerMock.mock.calls[0]?.[0];
        const shareConfig = createShareControllerMock.mock.calls[0]?.[0];
        const artistInfoConfig = createArtistInfoControllerMock.mock.calls[0]?.[0];
        const libraryConfig = createLibraryControllerMock.mock.calls[0]?.[0];

        expect(controllers).toEqual({
            settingsController: { config: settingsConfig },
            playlistController,
            playlistTargetModalController,
            shareController,
            imageModalController,
            artistInfoController,
            libraryController,
        });

        expect(settingsConfig.getValues().favoritePlaylists).toEqual(['favorites.m3u']);

        const saveValues = {
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            ffmpegPath: 'ffmpeg',
            listenBrainzUserToken: 'token',
            lastFmApiKey: 'key',
            lastFmApiSecret: 'secret',
            lastFmSessionKey: 'session',
            scrobbleFilterMode: 'blacklist',
            scrobbleRules: [],
            musicBrainzServerUrl: '',
            musicBrainzRequestRateMs: 1000,
            listenBrainzServerUrl: '',
            listenBrainzRequestRateMs: 1000,
            favoritePlaylists: ['favorites.m3u'],
            coverArtPriority: ['file', 'embedded'],
            audioOutputDevice: 'default',
            audioOutputBufferMs: 64,
            gaplessPlayback: false,
            replayGainEnabled: true,
            preferMusicBrainzMetadata: false,
            musicBrainzTagDatabaseEnabled: false,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            musicBrainzTagWorkerCores: 2,
            lissajousEnabled: true,
            uiDitheringEnabled: true,
            minimizeToTrayOnClose: false,
            customSendToActions: [],
            keyboardShortcuts: defaultAppSettings.keyboardShortcuts,
        };

        await settingsConfig.save(saveValues);
        await settingsConfig.save({ ...saveValues, gaplessPlayback: true });
        await expect(settingsConfig.fetchLastFmSessionKey('', 'secret')).rejects.toThrow('Last.fm API key and shared secret are required.');
        context.openQueueConfirmModal.mockResolvedValueOnce(false);
        await expect(settingsConfig.fetchLastFmSessionKey(' key ', ' secret ')).rejects.toThrow('Last.fm authorization was cancelled.');
        context.openQueueConfirmModal.mockResolvedValueOnce(true);
        expect(await settingsConfig.fetchLastFmSessionKey(' key ', ' secret ')).toBe('session-key');
        expect(await settingsConfig.applyAudioNow(saveValues)).toEqual([{ id: 'usb', name: 'USB DAC', backend: 'wasapi', isDefault: false }]);
        await settingsConfig.forceReload();
        context.ffmpegConfigurationRequired = false;
        expect(await settingsConfig.beforeClose()).toBeNull();
        context.ffmpegConfigurationRequired = true;
        context.validateConfiguredFFmpegPath.mockResolvedValueOnce({ available: true });
        expect(await settingsConfig.beforeClose()).toBeNull();
        context.ffmpegConfigurationRequired = true;
        context.validateConfiguredFFmpegPath.mockResolvedValueOnce({ available: false });
        expect(await settingsConfig.beforeClose()).toBe('Missing FFmpeg');
        settingsConfig.onCloseBlocked('Missing FFmpeg');
        settingsConfig.setPlayerCardLayout('cover');
        expect(settingsConfig.getPlayerCardLayout()).toBe('release');

        await playlistConfig.ensureTrackTagsResolvedBatch([0, 1]);
        expect(playlistConfig.getTrack(0)).toBe(context.tracks[0]);
        expect(playlistConfig.getTrackPath(1)).toBe(context.tracks[1].path);
        expect(playlistConfig.getTrackCount()).toBe(2);
        expect(playlistConfig.getCurrentTrackIndex()).toBe(0);
        expect(playlistConfig.getFavoritePlaylists()).toEqual(['favorites.m3u']);
        await playlistConfig.loadPlaylistData('/playlists/favorites.m3u');
        playlistConfig.savePlaylistData('/playlists/favorites.m3u', ['/music/library/track-1.flac']);
        playlistConfig.appendTracksToPlaylistData('/playlists/favorites.m3u', ['/music/library/track-1.flac']);
        await playlistConfig.onTrackChosen(1, { userInitiated: true, source: 'library' });
        playlistConfig.onExternalPlaylistLoaded();

        context.currentTrackIndex = -1;
        expect(shareConfig.getCurrentTrack()).toBeUndefined();
        context.currentTrackIndex = 0;
        expect(shareConfig.getCurrentTrack()).toEqual({ track: context.tracks[0], index: 0 });
        await shareConfig.ensureTrackTagsResolved(0);
        expect(shareConfig.trackIndexForPath(context.tracks[1].path)).toBe(1);
        expect(shareConfig.getTrack(0)).toBe(context.tracks[0]);
        expect(await shareConfig.resolveCoverForTrack(context.tracks[0])).toBe('cover-data');
        expect(shareConfig.getCachedMediaArtwork(context.tracks[0])).toEqual(['artwork']);
        expect(shareConfig.getCoverArtSrc()).toBe('/cover.png');
        shareConfig.closeOtherMenus();

        expect(artistInfoConfig.getTracks()).toBe(context.tracks);
        expect(artistInfoConfig.getCurrentTrackIndex()).toBe(0);
        expect(artistInfoConfig.getRequestVersion()).toBe(9);
        expect(await artistInfoConfig.lookupArtistByMBID('artist-id')).toEqual({ name: 'Artist' });
        expect(artistInfoConfig.openUrl).toBe(context.openUrl);

        expect(libraryConfig.getTracks()).toBe(context.tracks);
        expect(libraryConfig.getTextFiles()).toBe(context.textFiles);
        expect(libraryConfig.getImageFiles()).toBe(context.imageFiles);
        expect(libraryConfig.getCurrentTrackIndex()).toBe(0);
        await libraryConfig.loadFolderPage('/music/library', 0, 100);
        await libraryConfig.resolveLibraryFolderForAbsolutePath('/music/library/track-1.flac');
        await libraryConfig.isFolderImmediateDescendantsEnumerated('/music/library');
        await libraryConfig.searchLibrary('track', 0, 100);
        expect(libraryConfig.resolveTrackIndex(context.tracks[0].path)).toBe(0);
        expect(libraryConfig.resolveTextFileIndex(context.textFiles[0].path)).toBe(0);
        expect(libraryConfig.resolveImageFileIndex(context.imageFiles[0].path)).toBe(0);
        libraryConfig.onTrackChosen(1);
        await flushPromises();
        libraryConfig.onTrackPathChosen(context.tracks[0].path);
        await flushPromises();
        context.ensureTrackIndexForPath.mockReturnValueOnce(-1);
        libraryConfig.onTrackPathChosen('/music/library/missing.flac');
        libraryConfig.onTextFileChosen(0);
        libraryConfig.onImageFileChosen(0);
        libraryConfig.onQueueRequested(10, 20, [0], 1, true, '/music/library/track-1.flac');
        libraryConfig.onFolderQueueRequested(30, 40, '/music/library', 'Library', [0, -1, 999]);
        libraryConfig.onFolderQueueRequested(50, 60, '/music/library', 'Library');
        libraryConfig.onSidebarClosed();

        expect(context.validateConfiguredFFmpegPath).toHaveBeenCalled();
        expect(createFromAppSettingsMock).toHaveBeenCalled();
        expect(context.saveSettings).toHaveBeenCalled();
        expect(context.setLissajousEnabled).toHaveBeenCalledWith(true);
        expect(context.applyUiDitheringSetting).toHaveBeenCalled();
        expect(context.handleListenBrainzSocialSettingsChanged).toHaveBeenCalled();
        expect(context.setPlaybackOrderMode).toHaveBeenCalledWith('shuffle-library');
        expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0);
        expect(playlistController.refreshFavorites).toHaveBeenCalled();
        expect(context.resetShuffleHistory).toHaveBeenCalled();
        expect(context.closeListenBrainzFeedbackMenu).toHaveBeenCalled();
        expect(context.audioQueueNextTrack).toHaveBeenCalledWith('', '');
        expect(context.queueGaplessNextTrack).toHaveBeenCalledTimes(1);
        expect(context.completeStartupIfReady).toHaveBeenCalled();
        expect(context.refreshListenBrainzFeedbackForCurrentTrack).toHaveBeenCalled();
        expect(context.browserOpenUrl).toHaveBeenCalledWith('https://www.last.fm/api/auth/?api_key=key&token=request-token');
        expect(context.getLastFmSessionKey).toHaveBeenCalledWith('key', 'secret', 'request-token');
        expect(context.refreshAvailableAudioOutputDevices).toHaveBeenCalled();
        expect(context.audioReinitializeBackend).toHaveBeenCalled();
        expect(context.setPlaybackBackendReady).toHaveBeenCalledWith(true);
        expect(context.applyPlaybackState).toHaveBeenCalled();
        expect(context.updatePlayButton).toHaveBeenCalled();
        expect(context.scanConfiguredLibraryFolders).toHaveBeenCalled();
        expect(context.openErrorModal).toHaveBeenCalledWith('FFmpeg Required', 'Missing FFmpeg');
        expect(context.setPlayerCardLayout).toHaveBeenCalledWith('cover');
        expect(context.loadTrack).toHaveBeenCalledWith(1, true, undefined, true);
        expect(context.playCurrentTrack).toHaveBeenCalled();
        expect(context.ensureTrackTagsResolved).toHaveBeenCalledWith(0);
        expect(context.lookupArtistByMBID).toHaveBeenCalledWith('artist-id');
        expect(playlistController.activatePlaybackQueueSource).toHaveBeenCalledTimes(2);
        expect(context.suppressAutoSelectAfterFullLibraryScan).toBe(true);
        expect(context.openTextFileModal).toHaveBeenCalledWith(context.textFiles[0]);
        expect(imageModalController.openImageFile).toHaveBeenCalledWith(context.imageFiles[0]);
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(10, 20, [0], 1, true, '/music/library/track-1.flac');
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(30, 40, [0], undefined, false, '', '/music/library', 'Library', true, true);
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(50, 60, [], undefined, false, '', '/music/library', 'Library', true, false);
        expect(context.closeSidebarQueueMenu).toHaveBeenCalled();
    });
});