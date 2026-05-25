import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSettingsControllerState } from './controllers/settings-controller-types';
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
} = vi.hoisted(() => ({
    createArtistInfoControllerMock: vi.fn(),
    createImageModalControllerMock: vi.fn(),
    createLibraryControllerMock: vi.fn(),
    createPlaylistControllerMock: vi.fn(),
    createPlaylistTargetModalControllerMock: vi.fn(),
    createShareControllerMock: vi.fn(),
    createSettingsControllerMock: vi.fn(),
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

import { setupAppControllers } from './app-controller-setup';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const createDeferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });

    return { promise, resolve, reject };
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
        getMusicBrainzTagWorkerProgress: vi.fn(async () => ({ enabled: true, active: true, progress: 0.4 })),
        availableAudioOutputDevices: [{ id: 'default', name: 'Default', backend: 'wasapi', isDefault: true }],
        currentTrackIndex: 0,
        tracks,
        textFiles,
        imageFiles,
        libraryControllerState: {
            sidebarOpen: false,
            sidebarExpanded: false,
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
            loadedPlaylistReadOnly: false,
            loadedPlaylistHistoryItems: null,
            loadedPlaylistCachedItems: null,
            editableQueueTrackIndexes: null,
            editableQueueCurrentPosition: null,
            selectedSource: 'queue',
            selectedFavoriteIndex: null,
            playbackSource: 'queue',
        },
        settingsControllerState: createSettingsControllerState(),
        ffmpegConfigurationRequired: true,
        artistInfoRequestVersion: 9,
        validateConfiguredFFmpegPath: vi.fn(async () => ({ available: true })),
        missingFFmpegMessage: vi.fn(() => 'Missing FFmpeg'),
        saveSettings: vi.fn(async (settings) => settings),
        selectLibraryFolder: vi.fn(async () => '/music/library'),
        selectPlaylistFile: vi.fn(async () => '/playlists/favorites.m3u'),
        playbackSequencingService: {
            baseSequenceIndexes: vi.fn(() => ({ indexes: [0, 1], currentPosition: 0 })),
            nextTrackIndexForDirection: vi.fn(() => 1),
            peekNextTrackIndexForDirection: vi.fn(() => 1),
        },
        getPlaybackOrderMode: vi.fn(() => 'shuffle-library'),
        setLissajousEnabled: vi.fn(),
        setLissajousScale: vi.fn(),
        setVisualizerMode: vi.fn(),
        setEqualizerPosition: vi.fn(),
        applyUiDitheringSetting: vi.fn(),
        handleSocialSettingsChanged: vi.fn(),
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
        playlistBtn: document.createElement('button'),
        playlistMenuElements: { menu: document.createElement('div') },
        playlistModalElements: { modal: document.createElement('div') },
        getPlaybackOrderLabel: vi.fn(() => 'Shuffle library'),
        getBaseSequence: vi.fn(() => [0, 1]),
        ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
        selectPlaylistSaveFile: vi.fn(async () => '/playlists/output.m3u'),
        loadListenHistoryData: vi.fn(async () => ({ name: 'Listen History', trackIndexes: [0] })),
        loadPlaylistData: vi.fn(async () => ['/music/library/track-1.flac']),
        savePlaylistTrackMetadataCache: vi.fn(async () => true),
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
        copyShareImageToClipboard: vi.fn(async () => true),
        lookupMusicBrainzRecordingURLs: vi.fn(async () => []),
        fetchVisualizationFrame: vi.fn(async () => ({
            loaded: true,
            playing: true,
            sourcePath: tracks[0].path,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 4,
            sampleStride: 1,
            peak: 0.4,
            samples: [100, -100, 200, -200, 300, -300, 400, -400],
        })),
        imageModalElements: { modal: document.createElement('div') },
        readFileBase64: vi.fn(async () => 'base64'),
        readImageThumbnail: vi.fn(async () => 'thumbnail'),
        artistInfoElements: { panel: document.createElement('div') },
        lookupArtistByMBID: vi.fn(async () => ({ name: 'Artist' })),
        openUrl: vi.fn(async () => undefined),
        app: document.createElement('div'),
        sidebarToggle: document.createElement('button'),
        libraryExpandToggle: document.createElement('button'),
        librarySidebar: document.createElement('aside'),
        libraryBack: document.createElement('button'),
        libraryPath: document.createElement('p'),
        librarySearch: document.createElement('input'),
        librarySort: document.createElement('select'),
        libraryBrowser: document.createElement('div'),
        libraryScanYieldIndicator: document.createElement('span'),
        loadFolderPage: vi.fn(async () => ({ folderPath: '/music/library', offset: 0, limit: 100, totalEntries: 0, entries: [] })),
        resolveLibraryFolderForAbsolutePath: vi.fn(async () => '/music/library'),
        isFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
        searchLibrary: vi.fn(async () => ({ query: 'track', offset: 0, limit: 100, totalEntries: 1, entries: [] })),
        getReleaseDepthForTrack: vi.fn(() => 1),
        getFolderCoverPath: vi.fn(() => '/music/library/cover.jpg'),
        resolveFolderCoverPath: vi.fn(async () => '/music/library/cover.jpg'),
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
            activateLibraryPlaybackSource: vi.fn(),
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
        expect(settingsConfig.getValues().savePlaylistsOnAddRemove).toBe(false);
        await expect(settingsConfig.getMusicBrainzTagWorkerProgress()).resolves.toEqual({ enabled: true, active: true, progress: 0.4 });
        expect(settingsConfig.state).toBe(context.settingsControllerState);
        expect(libraryConfig.state).toBe(context.libraryControllerState);
        expect(playlistConfig.state).toBe(context.playlistControllerState);
        expect(playlistConfig.backgroundHydrationEnabled).toBe(false);
        expect(playlistConfig.playbackSequencingService).toBe(context.playbackSequencingService);

        const saveValues = {
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            localLibraryFilesDatabaseEnabled: true,
            localLibraryFilesDatabaseLoadOnStartup: true,
            localLibraryFilesDatabaseListenHistoryEnabled: false,
            localLibraryFilesDatabaseListenHistoryLimit: 0,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 30,
            ffmpegPath: 'ffmpeg',
            librarySharingEnabled: false,
            librarySharingPort: 41637,
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
            savePlaylistsOnAddRemove: true,
            coverArtPriority: ['file', 'embedded'],
            audioOutputDevice: 'default',
            audioOutputBufferMs: 64,
            gaplessPlayback: false,
            replayGainEnabled: true,
            preferMusicBrainzMetadata: false,
            musicBrainzTagDatabaseEnabled: false,
            highlightMusicBrainzTaggedAlbumFolders: false,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            musicBrainzTagWorkerCores: 2,
            lissajousEnabled: true,
            lissajousScale: 0.4,
            visualizerMode: 'equalizer',
            equalizerPosition: 'top',
            uiDitheringEnabled: true,
            minimizeToTrayOnClose: false,
            customSendToActions: [],
            keyboardShortcuts: defaultAppSettings.keyboardShortcuts,
        };

        await settingsConfig.save(saveValues);
        await settingsConfig.save({ ...saveValues, gaplessPlayback: true });
        await settingsConfig.save({
            ...saveValues,
            libraryFolders: [{ path: 'silphium-remote://192.168.2.10:41637', kind: 'remote', host: '192.168.2.10', port: 41637, label: 'Laptop', releaseDepth: 0 }],
        });
        await flushPromises();
        expect(context.scanConfiguredLibraryFolders).toHaveBeenCalledTimes(1);
        await expect(settingsConfig.fetchLastFmSessionKey('', 'secret')).rejects.toThrow('Last.fm API key and shared secret are required.');
        context.openQueueConfirmModal.mockResolvedValueOnce(false);
        await expect(settingsConfig.fetchLastFmSessionKey(' key ', ' secret ')).rejects.toThrow('Last.fm authorization was cancelled.');
        context.openQueueConfirmModal.mockResolvedValueOnce(true);
        expect(await settingsConfig.fetchLastFmSessionKey(' key ', ' secret ')).toBe('session-key');
        expect(await settingsConfig.applyAudioNow(saveValues)).toEqual({
            devices: [{ id: 'usb', name: 'USB DAC', backend: 'wasapi', isDefault: false }],
            selectedDevice: 'default',
            message: 'Audio settings refreshed.',
        });
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
        expect(context.scanConfiguredLibraryFolders).toHaveBeenCalledTimes(3);

        await playlistConfig.ensureTrackTagsResolvedBatch([0, 1]);
        expect(playlistConfig.getTrack(0)).toBe(context.tracks[0]);
        expect(playlistConfig.getTrackPath(1)).toBe(context.tracks[1].path);
        expect(playlistConfig.getTrackCount()).toBe(2);
        expect(playlistConfig.getCurrentTrackIndex()).toBe(0);
        expect(playlistConfig.getFavoritePlaylists()).toEqual(['favorites.m3u']);
        expect(playlistConfig.shouldAutoSavePlaylistsOnAddRemove()).toBe(true);
        expect(playlistConfig.hasListenHistoryPlaylist()).toBe(false);
        await playlistConfig.loadListenHistoryData();
        await playlistConfig.loadPlaylistData('/playlists/favorites.m3u');
        await playlistConfig.savePlaylistTrackMetadataCache([{ trackPath: '/music/library/track-1.flac', trackName: 'Track 1', artistName: 'Artist' }]);
        playlistConfig.savePlaylistData('/playlists/favorites.m3u', ['/music/library/track-1.flac']);
        playlistConfig.appendTracksToPlaylistData('/playlists/favorites.m3u', ['/music/library/track-1.flac']);
        playlistConfig.onQueueRequested(11, 22, [1], 1, true, '/music/library/track-2.flac');
        await playlistConfig.onTrackChosen(1, { userInitiated: true, source: 'library' });
        playlistConfig.onExternalPlaylistLoaded();
        await playlistConfig.onPlaybackSequenceMutated();
        context.currentSettings.savePlaylistsOnAddRemove = false;
        expect(playlistConfig.shouldAutoSavePlaylistsOnAddRemove()).toBe(false);

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
        expect(await shareConfig.lookupMusicBrainzRecordingURLs('recording-id')).toEqual([]);
        expect(shareConfig.openUrl).toBe(context.browserOpenUrl);
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
        expect(context.saveSettings).toHaveBeenCalled();
        expect(context.setLissajousEnabled).toHaveBeenCalledWith(true);
        expect(context.setLissajousScale).toHaveBeenCalledWith(0.4);
        expect(context.setVisualizerMode).toHaveBeenCalledWith('equalizer');
        expect(context.setEqualizerPosition).toHaveBeenCalledWith('top');
        expect(context.applyUiDitheringSetting).toHaveBeenCalled();
        expect(context.handleSocialSettingsChanged).toHaveBeenCalled();
        expect(context.setPlaybackOrderMode).toHaveBeenCalledWith('shuffle-library');
        expect(context.savePlaylistTrackMetadataCache).toHaveBeenCalledWith([{ trackPath: '/music/library/track-1.flac', trackName: 'Track 1', artistName: 'Artist' }]);
        expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0);
        expect(playlistController.refreshFavorites).toHaveBeenCalled();
        expect(context.resetShuffleHistory).toHaveBeenCalled();
        expect(context.closeListenBrainzFeedbackMenu).toHaveBeenCalled();
        expect(context.audioQueueNextTrack).toHaveBeenCalledWith('', '');
        expect(context.queueGaplessNextTrack).toHaveBeenCalledTimes(2);
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
        expect(context.loadTrack).toHaveBeenCalledWith(1, true, undefined, true);
        expect(context.playCurrentTrack).toHaveBeenCalled();
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(11, 22, [1], 1, true, '/music/library/track-2.flac');
        expect(context.ensureTrackTagsResolved).toHaveBeenCalledWith(0);
        expect(context.lookupMusicBrainzRecordingURLs).toHaveBeenCalledWith('recording-id');
        expect(context.lookupArtistByMBID).toHaveBeenCalledWith('artist-id');
        expect(playlistController.activateLibraryPlaybackSource).toHaveBeenCalledTimes(2);
        expect(context.suppressAutoSelectAfterFullLibraryScan).toBe(true);
        expect(context.openTextFileModal).toHaveBeenCalledWith(context.textFiles[0]);
        expect(imageModalController.openImageFile).toHaveBeenCalledWith(context.imageFiles[0]);
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(10, 20, [0], 1, true, '/music/library/track-1.flac');
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(30, 40, [0], undefined, false, '', '/music/library', 'Library', true, true, undefined);
        expect(context.openSidebarQueueMenu).toHaveBeenCalledWith(50, 60, [], undefined, false, '', '/music/library', 'Library', true, false, undefined);
        expect(context.closeSidebarQueueMenu).toHaveBeenCalled();
    });

    it('applies visualizer settings before settings persistence resolves', async () => {
        createSettingsControllerMock.mockImplementation((config) => ({ config }));
        createPlaylistControllerMock.mockReturnValue({
            refreshFavorites: vi.fn(),
            activateLibraryPlaybackSource: vi.fn(),
        });
        createPlaylistTargetModalControllerMock.mockReturnValue({ modal: true });
        createShareControllerMock.mockReturnValue({ share: true });
        createImageModalControllerMock.mockReturnValue({ openImageFile: vi.fn() });
        createArtistInfoControllerMock.mockReturnValue({ artist: true });
        createLibraryControllerMock.mockReturnValue({ library: true });

        const context = createContext();
        const saveDeferred = createDeferred<typeof context.currentSettings>();
        context.saveSettings.mockImplementationOnce(async () => await saveDeferred.promise);

        setupAppControllers(context as unknown as AppControllerSetupContext);
        const settingsConfig = createSettingsControllerMock.mock.calls.at(-1)?.[0];

        const savePromise = settingsConfig.save({
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            localLibraryFilesDatabaseEnabled: true,
            localLibraryFilesDatabaseLoadOnStartup: true,
            localLibraryFilesDatabaseListenHistoryEnabled: false,
            localLibraryFilesDatabaseListenHistoryLimit: 0,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 30,
            ffmpegPath: 'ffmpeg',
            librarySharingEnabled: false,
            librarySharingPort: 41637,
            listenBrainzUserToken: '',
            lastFmApiKey: '',
            lastFmApiSecret: '',
            lastFmSessionKey: '',
            scrobblingEnabled: true,
            scrobbleFilterMode: 'blacklist',
            scrobbleRules: [],
            musicBrainzServerUrl: '',
            musicBrainzRequestRateMs: 1000,
            listenBrainzServerUrl: '',
            listenBrainzRequestRateMs: 1000,
            favoritePlaylists: [],
            savePlaylistsOnAddRemove: false,
            coverArtPriority: ['file', 'embedded'],
            audioOutputDevice: 'default',
            audioOutputBufferMs: 0,
            gaplessPlayback: false,
            replayGainEnabled: false,
            preferMusicBrainzMetadata: false,
            musicBrainzTagDatabaseEnabled: false,
            highlightMusicBrainzTaggedAlbumFolders: false,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            musicBrainzTagWorkerCores: 1,
            lissajousEnabled: false,
            lissajousScale: 0.55,
            visualizerMode: 'equalizer',
            equalizerPosition: 'top',
            uiDitheringEnabled: false,
            minimizeToTrayOnClose: false,
            customSendToActions: [],
            keyboardShortcuts: defaultAppSettings.keyboardShortcuts,
        });

        await flushPromises();

        expect(context.setVisualizerMode).toHaveBeenCalledWith('equalizer');
        expect(context.setEqualizerPosition).toHaveBeenCalledWith('top');
        expect(context.setLissajousScale).toHaveBeenCalledWith(0.55);
        expect(context.setLissajousEnabled).toHaveBeenCalledWith(false);
        expect(context.applyUiDitheringSetting).toHaveBeenCalled();

        saveDeferred.resolve({
            ...context.currentSettings,
            visualizerMode: 'equalizer',
            equalizerPosition: 'top',
            lissajousScale: 0.55,
            lissajousEnabled: false,
            uiDitheringEnabled: false,
        });

        await savePromise;
    });

    it('does not trigger a local rescan when saving unchanged local folders alongside existing remote folders', async () => {
        createSettingsControllerMock.mockImplementation((config) => ({ config }));
        createPlaylistControllerMock.mockReturnValue({
            refreshFavorites: vi.fn(),
            activatePlaybackQueueSource: vi.fn(),
        });
        createPlaylistTargetModalControllerMock.mockReturnValue({ modal: true });
        createShareControllerMock.mockReturnValue({ share: true });
        createImageModalControllerMock.mockReturnValue({ openImageFile: vi.fn() });
        createArtistInfoControllerMock.mockReturnValue({ artist: true });
        createLibraryControllerMock.mockReturnValue({ library: true });

        const context = createContext();
        context.currentSettings = {
            ...context.currentSettings,
            libraryFolders: [
                { path: '/music/library', label: 'Library', releaseDepth: 1 },
                { path: 'silphium-remote://192.168.2.10:41637', kind: 'remote', host: '192.168.2.10', port: 41637, label: 'Laptop', releaseDepth: 0 },
            ] as typeof context.currentSettings.libraryFolders,
        };

        setupAppControllers(context as unknown as AppControllerSetupContext);
        const settingsConfig = createSettingsControllerMock.mock.calls.at(-1)?.[0];

        await settingsConfig.save({
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            localLibraryFilesDatabaseEnabled: true,
            localLibraryFilesDatabaseLoadOnStartup: true,
            localLibraryFilesDatabaseListenHistoryEnabled: false,
            localLibraryFilesDatabaseListenHistoryLimit: 0,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 30,
            ffmpegPath: 'ffmpeg',
            librarySharingEnabled: false,
            librarySharingPort: 41637,
            listenBrainzUserToken: '',
            lastFmApiKey: '',
            lastFmApiSecret: '',
            lastFmSessionKey: '',
            scrobblingEnabled: true,
            scrobbleFilterMode: 'blacklist',
            scrobbleRules: [],
            musicBrainzServerUrl: '',
            musicBrainzRequestRateMs: 1000,
            listenBrainzServerUrl: '',
            listenBrainzRequestRateMs: 1000,
            favoritePlaylists: ['favorites.m3u'],
            savePlaylistsOnAddRemove: false,
            coverArtPriority: ['file', 'embedded'],
            audioOutputDevice: 'default',
            audioOutputBufferMs: 0,
            gaplessPlayback: false,
            replayGainEnabled: false,
            preferMusicBrainzMetadata: false,
            musicBrainzTagDatabaseEnabled: false,
            highlightMusicBrainzTaggedAlbumFolders: false,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            musicBrainzTagWorkerCores: 1,
            lissajousEnabled: true,
            lissajousScale: defaultAppSettings.lissajousScale,
            visualizerMode: 'lissajous',
            equalizerPosition: 'bottom',
            uiDitheringEnabled: true,
            minimizeToTrayOnClose: false,
            customSendToActions: [],
            keyboardShortcuts: defaultAppSettings.keyboardShortcuts,
        });
        await flushPromises();

        expect(context.scanConfiguredLibraryFolders).not.toHaveBeenCalled();
    });

    it('rolls back visualizer settings when settings persistence fails', async () => {
        createSettingsControllerMock.mockImplementation((config) => ({ config }));
        createPlaylistControllerMock.mockReturnValue({
            refreshFavorites: vi.fn(),
            activatePlaybackQueueSource: vi.fn(),
        });
        createPlaylistTargetModalControllerMock.mockReturnValue({ modal: true });
        createShareControllerMock.mockReturnValue({ share: true });
        createImageModalControllerMock.mockReturnValue({ openImageFile: vi.fn() });
        createArtistInfoControllerMock.mockReturnValue({ artist: true });
        createLibraryControllerMock.mockReturnValue({ library: true });

        const context = createContext();
        context.saveSettings.mockRejectedValueOnce(new Error('save failed'));

        setupAppControllers(context as unknown as AppControllerSetupContext);
        const settingsConfig = createSettingsControllerMock.mock.calls.at(-1)?.[0];

        await expect(settingsConfig.save({
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            localLibraryFilesDatabaseEnabled: true,
            localLibraryFilesDatabaseLoadOnStartup: true,
            localLibraryFilesDatabaseListenHistoryEnabled: false,
            localLibraryFilesDatabaseListenHistoryLimit: 0,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 30,
            ffmpegPath: 'ffmpeg',
            librarySharingEnabled: false,
            librarySharingPort: 41637,
            listenBrainzUserToken: '',
            lastFmApiKey: '',
            lastFmApiSecret: '',
            lastFmSessionKey: '',
            scrobblingEnabled: true,
            scrobbleFilterMode: 'blacklist',
            scrobbleRules: [],
            musicBrainzServerUrl: '',
            musicBrainzRequestRateMs: 1000,
            listenBrainzServerUrl: '',
            listenBrainzRequestRateMs: 1000,
            favoritePlaylists: [],
            savePlaylistsOnAddRemove: false,
            coverArtPriority: ['file', 'embedded'],
            audioOutputDevice: 'default',
            audioOutputBufferMs: 0,
            gaplessPlayback: false,
            replayGainEnabled: false,
            preferMusicBrainzMetadata: false,
            musicBrainzTagDatabaseEnabled: false,
            highlightMusicBrainzTaggedAlbumFolders: false,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            musicBrainzTagWorkerCores: 1,
            lissajousEnabled: false,
            lissajousScale: 0.55,
            visualizerMode: 'equalizer',
            equalizerPosition: 'top',
            uiDitheringEnabled: false,
            minimizeToTrayOnClose: false,
            customSendToActions: [],
            keyboardShortcuts: defaultAppSettings.keyboardShortcuts,
        })).rejects.toThrow('save failed');

        expect(context.setVisualizerMode).toHaveBeenNthCalledWith(1, 'equalizer');
        expect(context.setEqualizerPosition).toHaveBeenNthCalledWith(1, 'top');
        expect(context.setLissajousScale).toHaveBeenNthCalledWith(1, 0.55);
        expect(context.setLissajousEnabled).toHaveBeenNthCalledWith(1, false);
        expect(context.setVisualizerMode).toHaveBeenLastCalledWith('lissajous');
        expect(context.setEqualizerPosition).toHaveBeenLastCalledWith('bottom');
        expect(context.setLissajousScale).toHaveBeenLastCalledWith(defaultAppSettings.lissajousScale);
        expect(context.setLissajousEnabled).toHaveBeenLastCalledWith(true);
    });

    it('falls back to the default output device when the refreshed list no longer contains the saved device', async () => {
        createSettingsControllerMock.mockImplementation((config) => ({ config }));
        createPlaylistControllerMock.mockReturnValue({
            refreshFavorites: vi.fn(),
            activatePlaybackQueueSource: vi.fn(),
        });
        createPlaylistTargetModalControllerMock.mockReturnValue({ modal: true });
        createShareControllerMock.mockReturnValue({ share: true });
        createImageModalControllerMock.mockReturnValue({ openImageFile: vi.fn() });
        createArtistInfoControllerMock.mockReturnValue({ artist: true });
        createLibraryControllerMock.mockReturnValue({ library: true });

        const context = createContext();
        context.refreshAvailableAudioOutputDevices.mockResolvedValueOnce([
            { id: 'fresh-device', name: 'USB DAC', backend: 'wasapi', isDefault: false },
        ]);

        setupAppControllers(context as unknown as AppControllerSetupContext);
        const settingsConfig = createSettingsControllerMock.mock.calls.at(-1)?.[0];

        const applyValues = {
            libraryFolders: [{ path: '/music/library', label: 'Library', releaseDepth: 1 }],
            localLibraryFilesDatabaseEnabled: true,
            localLibraryFilesDatabaseLoadOnStartup: true,
            localLibraryFilesDatabaseListenHistoryEnabled: false,
            localLibraryFilesDatabaseListenHistoryLimit: 0,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 30,
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
            savePlaylistsOnAddRemove: false,
            coverArtPriority: ['file', 'embedded'],
            audioOutputDevice: 'stale-device',
            audioOutputBufferMs: 64,
            gaplessPlayback: false,
            replayGainEnabled: true,
            preferMusicBrainzMetadata: false,
            musicBrainzTagDatabaseEnabled: false,
            highlightMusicBrainzTaggedAlbumFolders: false,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            musicBrainzTagWorkerCores: 2,
            lissajousEnabled: true,
            lissajousScale: 0.4,
            visualizerMode: 'equalizer',
            equalizerPosition: 'top',
            uiDitheringEnabled: true,
            minimizeToTrayOnClose: false,
            customSendToActions: [],
            keyboardShortcuts: defaultAppSettings.keyboardShortcuts,
        };

        const result = await settingsConfig.applyAudioNow(applyValues);

        expect(result).toEqual({
            devices: [{ id: 'fresh-device', name: 'USB DAC', backend: 'wasapi', isDefault: false }],
            selectedDevice: 'default',
            message: 'Audio settings refreshed. Switched to Primary Sound Driver because the selected audio device is unavailable.',
        });
        expect(context.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
            audio: expect.objectContaining({ outputDevice: 'default' }),
        }));
        expect(context.audioReinitializeBackend).toHaveBeenCalledTimes(1);
    });
});