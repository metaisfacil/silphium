import { createArtistInfoController } from './controllers/artist-info-controller';
import { createImageModalController } from './controllers/image-modal-controller';
import { createLibraryController } from './controllers/library-controller';
import { createPlaylistController, type PlaylistController, type PlaylistTrackChosenContext } from './controllers/playlist-controller';
import { createPlaylistTargetModalController } from './controllers/playlist-target-modal-controller';
import { createShareController } from './controllers/share-controller';
import type { AppControllerSetupContext } from './app-bootstrap-setup';
import { setupSettingsController } from './app-settings-controller-setup';
import type { AppSettings, AudioPlaybackState, Track } from './types/app-types';

export const setupAppControllers = (context: AppControllerSetupContext) => {
    let playlistController: PlaylistController | undefined;

    const settingsController = setupSettingsController({
        trigger: context.librarySettings,
        elements: context.settingsElements,
        isWindowsRuntime: context.isWindowsRuntime,
        isMacRuntime: context.isMacRuntime,
        isLinuxRuntime: context.isLinuxRuntime,
        get currentSettings() {
            return context.currentSettings;
        },
        set currentSettings(value) {
            context.currentSettings = value;
        },
        get currentMusicBrainzTagWorkerProgress() {
            return context.currentMusicBrainzTagWorkerProgress;
        },
        set currentMusicBrainzTagWorkerProgress(value) {
            context.currentMusicBrainzTagWorkerProgress = value;
        },
        get availableAudioOutputDevices() {
            return context.availableAudioOutputDevices;
        },
        set availableAudioOutputDevices(value) {
            context.availableAudioOutputDevices = value;
        },
        get currentTrackIndex() {
            return context.currentTrackIndex;
        },
        set currentTrackIndex(value) {
            context.currentTrackIndex = value;
        },
        get tracks() {
            return context.tracks;
        },
        set tracks(value) {
            context.tracks = value;
        },
        get ffmpegConfigurationRequired() {
            return context.ffmpegConfigurationRequired;
        },
        set ffmpegConfigurationRequired(value) {
            context.ffmpegConfigurationRequired = value;
        },
        validateConfiguredFFmpegPath: context.validateConfiguredFFmpegPath,
        missingFFmpegMessage: context.missingFFmpegMessage,
        saveSettings: async (settings: AppSettings) => {
            return await context.saveSettings(settings);
        },
        selectLibraryFolder: context.selectLibraryFolder,
        selectPlaylistFile: context.selectPlaylistFile,
        getPlaybackOrderMode: context.getPlaybackOrderMode,
        setLissajousEnabled: context.setLissajousEnabled,
        applyUiDitheringSetting: context.applyUiDitheringSetting,
        handleListenBrainzSocialSettingsChanged: context.handleListenBrainzSocialSettingsChanged,
        setPlaybackOrderMode: context.setPlaybackOrderMode,
        applyCoverArtForTrack: async (index: number) => {
            await context.applyCoverArtForTrack(index);
        },
        refreshPlaylistFavorites: () => {
            playlistController?.refreshFavorites();
        },
        resetShuffleHistory: context.resetShuffleHistory,
        hasListenBrainzScrobbling: context.hasListenBrainzScrobbling,
        closeListenBrainzFeedbackMenu: context.closeListenBrainzFeedbackMenu,
        isPlaybackBackendReady: context.isPlaybackBackendReady,
        audioQueueNextTrack: async (currentPath: string, nextPath: string) => {
            return await context.audioQueueNextTrack(currentPath, nextPath);
        },
        queueGaplessNextTrack: async (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]) => {
            await context.queueGaplessNextTrack(stateOverride, sequenceOverrideIndexes);
        },
        refreshNowPlayingLabel: context.refreshNowPlayingLabel,
        completeStartupIfReady: async () => {
            await context.completeStartupIfReady();
        },
        refreshListenBrainzFeedbackForCurrentTrack: async () => {
            await context.refreshListenBrainzFeedbackForCurrentTrack();
        },
        getLastFmRequestToken: async (apiKey: string, apiSecret: string) => {
            return await context.getLastFmRequestToken(apiKey, apiSecret);
        },
        browserOpenUrl: context.browserOpenUrl,
        openQueueConfirmModal: context.openQueueConfirmModal,
        getLastFmSessionKey: async (apiKey: string, apiSecret: string, requestToken: string) => {
            return await context.getLastFmSessionKey(apiKey, apiSecret, requestToken);
        },
        refreshAvailableAudioOutputDevices: async () => {
            return await context.refreshAvailableAudioOutputDevices();
        },
        audioReinitializeBackend: async () => {
            return await context.audioReinitializeBackend();
        },
        setPlaybackBackendReady: context.setPlaybackBackendReady,
        applyPlaybackState: context.applyPlaybackState,
        updatePlayButton: context.updatePlayButton,
        scanConfiguredLibraryFolders: async () => {
            await context.scanConfiguredLibraryFolders();
        },
        openErrorModal: context.openErrorModal,
        getPlayerCardLayout: context.getPlayerCardLayout,
        setPlayerCardLayout: context.setPlayerCardLayout,
    });

    playlistController = createPlaylistController({
        trigger: context.playlistBtn,
        menu: context.playlistMenuElements,
        modal: context.playlistModalElements,
        getTrack: (index: number) => context.tracks[index],
        getTrackPath: (index: number) => context.tracks[index]?.path || '',
        getTrackCount: () => context.tracks.length,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        getPlaybackOrderLabel: context.getPlaybackOrderLabel,
        getBaseSequence: context.getBaseSequence,
        ensureTrackTagsResolvedBatch: async (indexes: number[]) => {
            await context.ensureTrackTagsResolvedBatch(indexes);
        },
        selectPlaylistFile: context.selectPlaylistFile,
        selectPlaylistSaveFile: context.selectPlaylistSaveFile,
        loadPlaylistData: async (playlistPath: string) => {
            return await context.loadPlaylistData(playlistPath);
        },
        savePlaylistData: (playlistPath: string, trackPaths: string[]) => context.savePlaylistData(playlistPath, trackPaths),
        appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => context.appendTracksToPlaylistData(playlistPath, trackPaths),
        getFavoritePlaylists: () => context.currentSettings.favoritePlaylists,
        onTrackChosen: async (index: number, selectionContext: PlaylistTrackChosenContext) => {
            const manualTrackSelection = selectionContext.userInitiated && selectionContext.source !== 'queue';
            await context.loadTrack(index, true, undefined, manualTrackSelection);
            await context.playCurrentTrack();
        },
        onExternalPlaylistLoaded: () => {
            context.resetShuffleHistory();
        },
    });

    const playlistTargetModalController = createPlaylistTargetModalController(context.playlistTargetModalElements);

    const shareController = createShareController({
        elements: context.shareElements,
        getCurrentTrack: () => {
            if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
                return undefined;
            }

            return { track: context.tracks[context.currentTrackIndex], index: context.currentTrackIndex };
        },
        ensureTrackTagsResolved: async (index: number) => {
            await context.ensureTrackTagsResolved(index);
        },
        trackIndexForPath: context.trackIndexForPath,
        getTrack: (index: number) => context.tracks[index],
        resolveCoverForTrack: async (track: Track) => {
            return await context.resolveCoverForTrack(track);
        },
        getCachedMediaArtwork: (track: Track) => context.getCachedMediaArtwork(track),
        getCoverArtSrc: context.getCoverArtSrc,
        closeOtherMenus: context.closeOtherMenus,
        selectShareImageSaveFile: context.selectShareImageSaveFile,
        saveShareImageFile: context.saveShareImageFile,
    });

    const imageModalController = createImageModalController({
        elements: context.imageModalElements,
        readFileBase64: context.readFileBase64,
        readImageThumbnail: context.readImageThumbnail,
    });

    const artistInfoController = createArtistInfoController({
        elements: context.artistInfoElements,
        getTracks: () => context.tracks,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        getRequestVersion: () => context.artistInfoRequestVersion,
        lookupArtistByMBID: async (mbid: string) => {
            return await context.lookupArtistByMBID(mbid);
        },
        openUrl: context.openUrl,
    });

    const libraryController = createLibraryController({
        app: context.app,
        sidebarToggle: context.sidebarToggle,
        librarySidebar: context.librarySidebar,
        libraryBack: context.libraryBack,
        libraryPath: context.libraryPath,
        librarySearch: context.librarySearch,
        libraryBrowser: context.libraryBrowser,
        libraryScanYieldIndicator: context.libraryScanYieldIndicator,
        getTracks: () => context.tracks,
        getTextFiles: () => context.textFiles,
        getImageFiles: () => context.imageFiles,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        loadFolderPage: async (folderPath: string, offset: number, limit: number) => {
            return await context.loadFolderPage(folderPath, offset, limit);
        },
        resolveLibraryFolderForAbsolutePath: async (path: string) => {
            return await context.resolveLibraryFolderForAbsolutePath(path);
        },
        isFolderImmediateDescendantsEnumerated: async (folderPath: string) => {
            return await context.isFolderImmediateDescendantsEnumerated(folderPath);
        },
        searchLibrary: async (query: string, offset: number, limit: number) => {
            return await context.searchLibrary(query, offset, limit);
        },
        resolveTrackIndex: context.resolveTrackIndex,
        resolveTextFileIndex: context.resolveTextFileIndex,
        resolveImageFileIndex: context.resolveImageFileIndex,
        onTrackChosen: (index: number) => {
            if (context.fullLibraryScanLoadActive) {
                context.suppressAutoSelectAfterFullLibraryScan = true;
            }

            playlistController.activatePlaybackQueueSource();
            void context.loadTrack(index, true, undefined, true).then(() => {
                void context.playCurrentTrack();
            });
        },
        onTrackPathChosen: (trackPath: string) => {
            if (context.fullLibraryScanLoadActive) {
                context.suppressAutoSelectAfterFullLibraryScan = true;
            }

            const resolvedIndex = context.ensureTrackIndexForPath(trackPath);
            if (resolvedIndex < 0) {
                return;
            }

            playlistController.activatePlaybackQueueSource();
            void context.loadTrack(resolvedIndex, true, undefined, true).then(() => {
                void context.playCurrentTrack();
            });
        },
        onTextFileChosen: (textFileIndex: number) => {
            const textFile = context.textFiles[textFileIndex];
            if (textFile) {
                void context.openTextFileModal(textFile);
            }
        },
        onImageFileChosen: (imageFileIndex: number) => {
            const imageFile = context.imageFiles[imageFileIndex];
            if (imageFile) {
                void imageModalController.openImageFile(imageFile);
            }
        },
        onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[], feedbackTrackIndex?: number, includeFileActions?: boolean, fileActionPath?: string) => {
            context.openSidebarQueueMenu(clientX, clientY, trackIndexes, feedbackTrackIndex, !!includeFileActions, fileActionPath || '');
        },
        onFolderQueueRequested: (clientX: number, clientY: number, folderPath: string, folderLabel: string, trackIndexes?: number[]) => {
            const normalizedTrackIndexes = (trackIndexes || []).filter((trackIndex) => (
                Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < context.tracks.length
            ));
            const trackIndexesScopedToSelection = trackIndexes !== undefined;
            context.openSidebarQueueMenu(
                clientX,
                clientY,
                normalizedTrackIndexes,
                undefined,
                false,
                '',
                folderPath,
                folderLabel,
                true,
                trackIndexesScopedToSelection,
            );
        },
        onSidebarClosed: () => {
            context.closeSidebarQueueMenu();
        },
    });

    return {
        settingsController,
        playlistController,
        playlistTargetModalController,
        shareController,
        imageModalController,
        artistInfoController,
        libraryController,
    };
};
