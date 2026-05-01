import { setupAppControllers } from './app-controller-setup';
import { setupAppEventBindings } from './app-event-bindings';
import type { AppRuntimeScope } from './app-runtime-scope';
import type { PlaylistTrackMetadataCacheEntry } from './controllers/playlist-controller';
import type { AppSettings, AudioPlaybackState, MusicBrainzTagWorkerProgress, TextLibraryFile, Track } from './types/app-types';

type RuntimeScope<K extends keyof AppRuntimeScope> = Pick<AppRuntimeScope, K>;

type AppControllerSetupScope = RuntimeScope<
    | 'librarySettings'
    | 'settingsElements'
    | 'isWindowsRuntime'
    | 'isMacRuntime'
    | 'isLinuxRuntime'
    | 'currentSettings'
    | 'currentMusicBrainzTagWorkerProgress'
    | 'availableAudioOutputDevices'
    | 'getMusicBrainzTagWorkerProgress'
    | 'currentTrackIndex'
    | 'tracks'
    | 'textFiles'
    | 'imageFiles'
    | 'libraryControllerState'
    | 'playlistControllerState'
    | 'settingsControllerState'
    | 'ffmpegConfigurationRequired'
    | 'validateConfiguredFFmpegPath'
    | 'missingFFmpegMessage'
    | 'saveSettingsBackend'
    | 'selectLibraryFolder'
    | 'selectPlaylistFile'
    | 'playbackSequencingService'
    | 'visualizerController'
    | 'applyUiDitheringSetting'
    | 'socialController'
    | 'setPlaybackOrderMode'
    | 'applyCoverArtForTrack'
    | 'playlistControllerRef'
    | 'resetShuffleHistory'
    | 'hasListenBrainzScrobbling'
    | 'closeListenBrainzFeedbackMenu'
    | 'playbackStateService'
    | 'audioQueueNextTrack'
    | 'queueGaplessNextTrack'
    | 'refreshNowPlayingLabel'
    | 'completeStartupIfReady'
    | 'refreshListenBrainzFeedbackForCurrentTrack'
    | 'getLastFmRequestToken'
    | 'browserOpenUrl'
    | 'openQueueConfirmModal'
    | 'getLastFmSessionKey'
    | 'refreshAvailableAudioOutputDevices'
    | 'audioReinitializeBackend'
    | 'applyPlaybackState'
    | 'updatePlayButton'
    | 'scanConfiguredLibraryFolders'
    | 'openErrorModal'
    | 'getStoredLayout'
    | 'applyPlayerCardLayout'
    | 'playlistBtn'
    | 'playlistMenuElements'
    | 'playlistModalElements'
    | 'baseSequenceIndexes'
    | 'ensureTrackTagsResolvedBatch'
    | 'selectPlaylistSaveFile'
    | 'loadListenHistoryData'
    | 'loadPlaylistData'
    | 'savePlaylistTrackMetadataCache'
    | 'savePlaylistData'
    | 'appendTracksToPlaylistData'
    | 'loadTrack'
    | 'playCurrentTrack'
    | 'playlistTargetModalElements'
    | 'shareElements'
    | 'ensureTrackTagsResolved'
    | 'trackIndexForPath'
    | 'resolveCoverForTrack'
    | 'coverArtService'
    | 'coverArt'
    | 'closePlayOrderMenu'
    | 'closeTrackMetaMenu'
    | 'selectShareImageSaveFile'
    | 'saveShareImageFile'
    | 'copyShareImageToClipboard'
    | 'imageModalElements'
    | 'readFileBase64'
    | 'readImageThumbnail'
    | 'artistInfoElements'
    | 'artistInfoRequestVersion'
    | 'lookupArtistByMBID'
    | 'lookupMusicBrainzRecordingURLs'
    | 'app'
    | 'sidebarToggle'
    | 'libraryExpandToggle'
    | 'librarySidebar'
    | 'libraryBack'
    | 'libraryPath'
    | 'librarySearch'
    | 'librarySort'
    | 'libraryBrowser'
    | 'libraryScanYieldIndicator'
    | 'loadFolderPage'
    | 'resolveLibraryFolderForAbsolutePath'
    | 'isFolderImmediateDescendantsEnumerated'
    | 'searchLibrary'
    | 'releaseDepthForTrack'
    | 'fetchVisualizationFrame'
    | 'ensureTrackIndexForPath'
    | 'textFileIndexForPath'
    | 'imageFileIndexForPath'
    | 'fullLibraryScanLoadActive'
    | 'suppressAutoSelectAfterFullLibraryScan'
    | 'ensureTextFileIndexForPath'
    | 'ensureImageFileIndexForPath'
    | 'openTextFileModal'
    | 'openSidebarQueueMenu'
    | 'closeSidebarQueueMenu'
>;

type AppEventBindingsScope = RuntimeScope<
    | 'window'
    | 'document'
    | 'coverArt'
    | 'coverFrame'
    | 'coverFront'
    | 'trackTechnical'
    | 'trackTechnicalAlt'
    | 'libraryAbout'
    | 'sidebarQueueAddNext'
    | 'sidebarQueueAddToPlaylist'
    | 'sidebarQueuePlay'
    | 'sidebarQueueLove'
    | 'sidebarQueueHate'
    | 'sidebarQueueEnd'
    | 'sidebarQueueOpenInBrowser'
    | 'sidebarQueueTreeToggleBtn'
    | 'sidebarQueueSendToList'
    | 'errorBackdrop'
    | 'errorClose'
    | 'errorOk'
    | 'errorModal'
    | 'queueConfirmBackdrop'
    | 'queueConfirmCancel'
    | 'queueConfirmProceed'
    | 'textFileBackdrop'
    | 'textFileClose'
    | 'musicBrainzEntityBackdrop'
    | 'musicBrainzEntityClose'
    | 'shareBackdrop'
    | 'shareClose'
    | 'shareCommentInput'
    | 'shareSave'
    | 'shareCopy'
    | 'technicalInfoBackdrop'
    | 'technicalInfoClose'
    | 'aboutBackdrop'
    | 'aboutClose'
    | 'aboutRepoLink'
    | 'settingsElements'
    | 'playlistModalElements'
    | 'playlistTargetModalElements'
    | 'imageModalElements'
    | 'playPause'
    | 'playOrderMenu'
    | 'trackMetaParentFolderBtn'
    | 'trackMetaBrowserFolderBtn'
    | 'trackMetaCopyFilePathBtn'
    | 'trackMetaCopyFolderPathBtn'
    | 'trackMetaOpenMbBtn'
    | 'trackMetaSendToList'
    | 'back'
    | 'forward'
    | 'shareBtn'
    | 'seek'
    | 'volume'
    | 'volumeBtn'
    | 'playlistTargetModalControllerRef'
    | 'playlistControllerRef'
    | 'settingsControllerRef'
    | 'libraryControllerRef'
    | 'shareControllerRef'
    | 'imageModalControllerRef'
    | 'librarySidebar'
    | 'librarySearch'
    | 'sidebarToggle'
    | 'playerCard'
    | 'sidebarQueueMenu'
    | 'queueConfirmModal'
    | 'listenBrainzFeedbackMenu'
    | 'listenBrainzLoveBtn'
    | 'trackMetaMenu'
    | 'musicBrainzEntityModal'
    | 'shareModal'
    | 'technicalInfoModal'
    | 'aboutModal'
    | 'textFileModal'
    | 'trackTitle'
    | 'trackAlbum'
    | 'trackArtist'
    | 'trackTitleInline'
    | 'trackReleaseAlbum'
    | 'trackArtistHeader'
    | 'playerLane'
    | 'handleDroppedFolderPath'
    | 'playDroppedTrackPath'
    | 'openCoverImageModal'
    | 'toggleCoverFlipFromSecondaryInput'
    | 'toggleCoverFlipFromContextMenu'
    | 'openTechnicalInfoModal'
    | 'openAboutModal'
    | 'captureSidebarQueueSelectionContext'
    | 'closeSidebarQueueMenu'
    | 'resolveSidebarQueueTrackIndexesForAction'
    | 'addSidebarSelectionToPlaylist'
    | 'playSidebarQueueSelection'
    | 'submitSidebarQueueFeedback'
    | 'sidebarQueueFeedbackTrackIndex'
    | 'sidebarQueueSendToActionScope'
    | 'sidebarQueueFileActionPath'
    | 'sendToActionsForScope'
    | 'logSendToFrontend'
    | 'runCustomSendToAction'
    | 'suppressTrackMetaClicks'
    | 'openErrorModal'
    | 'closeErrorModal'
    | 'closeQueueConfirmModal'
    | 'closeTextFileModal'
    | 'closeMusicBrainzEntityModal'
    | 'closeTechnicalInfoModal'
    | 'closeAboutModal'
    | 'closePlayOrderMenu'
    | 'closeTrackMetaMenu'
    | 'closeListenBrainzFeedbackMenu'
    | 'openPlayOrderMenu'
    | 'setPlaybackOrderMode'
    | 'savePlaybackOrderSetting'
    | 'openCurrentTrackFolderInSidebar'
    | 'openCurrentTrackFolderInFileBrowser'
    | 'openSidebarQueueItemInFileBrowser'
    | 'copyCurrentTrackFilePath'
    | 'copyCurrentTrackFolderPath'
    | 'trackMetaMenuTarget'
    | 'trackMetaMenuActionScope'
    | 'trackMetaMenuActionPath'
    | 'goToTrack'
    | 'toggleCurrentTrack'
    | 'updateLyricsPanelVisibility'
    | 'hideToTrayWhenMinimized'
    | 'unlockMediaSessionAnchorFromUserGesture'
    | 'handleFocusedHardwareMediaKey'
    | 'handleFocusedKeyboardShortcut'
    | 'focusedShortcutBindingsUseCode'
    | 'setCtrlHeldState'
    | 'updatePlayButton'
    | 'updateTrackLabels'
    | 'updatePlayOrderMenuState'
    | 'refreshLyricsPanel'
    | 'refreshCurrentTrackMetadata'
    | 'resetListenBrainzFeedbackState'
    | 'initializeMediaSessionIntegration'
    | 'initializeSettings'
    | 'initializeAppVersion'
    | 'handleLibraryScanUpdatedEvent'
    | 'updateLibraryLoadingEtaFromProgress'
    | 'normalizeMusicBrainzTagWorkerProgress'
    | 'dispatchExternalPlaybackAction'
    | 'logFrontendMessage'
    | 'cardResizeObserver'
    | 'logRescan'
    | 'coverFlipped'
    | 'suppressCoverFrontClickUntil'
    | 'currentMusicBrainzTagWorkerProgress'
    | 'isSeeking'
    | 'currentTimeLabel'
    | 'formatTime'
    | 'audioSeek'
    | 'audioSetVolume'
    | 'applyPlaybackState'
    | 'handleAudioError'
    | 'mediaSessionController'
>;

const createControllerSetupContextFromScope = (scope: AppControllerSetupScope) => ({
    librarySettings: scope.librarySettings,
    settingsElements: scope.settingsElements,
    isWindowsRuntime: scope.isWindowsRuntime,
    isMacRuntime: scope.isMacRuntime,
    isLinuxRuntime: scope.isLinuxRuntime,
    get currentSettings() {
        return scope.currentSettings;
    },
    set currentSettings(value) {
        scope.currentSettings = value;
    },
    get currentMusicBrainzTagWorkerProgress() {
        return scope.currentMusicBrainzTagWorkerProgress;
    },
    set currentMusicBrainzTagWorkerProgress(value) {
        scope.currentMusicBrainzTagWorkerProgress = value;
    },
    getMusicBrainzTagWorkerProgress: async () => await scope.getMusicBrainzTagWorkerProgress(),
    get availableAudioOutputDevices() {
        return scope.availableAudioOutputDevices;
    },
    set availableAudioOutputDevices(value) {
        scope.availableAudioOutputDevices = value;
    },
    get currentTrackIndex() {
        return scope.currentTrackIndex;
    },
    set currentTrackIndex(value) {
        scope.currentTrackIndex = value;
    },
    get tracks() {
        return scope.tracks;
    },
    set tracks(value) {
        scope.tracks = value;
    },
    get textFiles() {
        return scope.textFiles;
    },
    get imageFiles() {
        return scope.imageFiles;
    },
    libraryControllerState: scope.libraryControllerState,
    playlistControllerState: scope.playlistControllerState,
    settingsControllerState: scope.settingsControllerState,
    get ffmpegConfigurationRequired() {
        return scope.ffmpegConfigurationRequired;
    },
    set ffmpegConfigurationRequired(value) {
        scope.ffmpegConfigurationRequired = value;
    },
    validateConfiguredFFmpegPath: scope.validateConfiguredFFmpegPath,
    missingFFmpegMessage: scope.missingFFmpegMessage,
    saveSettings: async (settings: AppSettings) => await scope.saveSettingsBackend(settings),
    selectLibraryFolder: scope.selectLibraryFolder,
    selectPlaylistFile: scope.selectPlaylistFile,
    playbackSequencingService: scope.playbackSequencingService,
    getPlaybackOrderMode: () => scope.playbackSequencingService.getPlaybackOrderMode(),
    setLissajousEnabled: (enabled: boolean) => {
        scope.visualizerController.setEnabled(enabled);
    },
    setLissajousScale: (scale: AppSettings['lissajousScale']) => {
        scope.visualizerController.setLissajousScale(scale);
    },
    setVisualizerMode: (mode: AppSettings['visualizerMode']) => {
        scope.visualizerController.setMode(mode);
    },
    setEqualizerPosition: (position: AppSettings['equalizerPosition']) => {
        scope.visualizerController.setEqualizerPosition(position);
    },
    applyUiDitheringSetting: scope.applyUiDitheringSetting,
    handleSocialSettingsChanged: () => {
        scope.socialController.handleSettingsChanged();
    },
    setPlaybackOrderMode: scope.setPlaybackOrderMode,
    applyCoverArtForTrack: async (index: number) => {
        await scope.applyCoverArtForTrack(index);
    },
    refreshPlaylistFavorites: () => {
        scope.playlistControllerRef.refreshFavorites();
    },
    resetShuffleHistory: scope.resetShuffleHistory,
    hasListenBrainzScrobbling: scope.hasListenBrainzScrobbling,
    closeListenBrainzFeedbackMenu: () => {
        scope.closeListenBrainzFeedbackMenu();
    },
    isPlaybackBackendReady: () => scope.playbackStateService.isBackendReady(),
    audioQueueNextTrack: async (currentPath: string, nextPath: string) => await scope.audioQueueNextTrack(currentPath, nextPath),
    queueGaplessNextTrack: async (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]) => {
        await scope.queueGaplessNextTrack(stateOverride, sequenceOverrideIndexes);
    },
    refreshNowPlayingLabel: scope.refreshNowPlayingLabel,
    completeStartupIfReady: async () => {
        await scope.completeStartupIfReady();
    },
    refreshListenBrainzFeedbackForCurrentTrack: async () => {
        await scope.refreshListenBrainzFeedbackForCurrentTrack();
    },
    getLastFmRequestToken: async (apiKey: string, apiSecret: string) => await scope.getLastFmRequestToken(apiKey, apiSecret),
    browserOpenUrl: scope.browserOpenUrl,
    openQueueConfirmModal: scope.openQueueConfirmModal,
    getLastFmSessionKey: async (apiKey: string, apiSecret: string, requestToken: string) => await scope.getLastFmSessionKey(apiKey, apiSecret, requestToken),
    refreshAvailableAudioOutputDevices: async () => await scope.refreshAvailableAudioOutputDevices(),
    audioReinitializeBackend: async () => await scope.audioReinitializeBackend(),
    setPlaybackBackendReady: (ready: boolean) => {
        scope.playbackStateService.setBackendReady(ready);
    },
    applyPlaybackState: scope.applyPlaybackState,
    updatePlayButton: scope.updatePlayButton,
    scanConfiguredLibraryFolders: async () => {
        await scope.scanConfiguredLibraryFolders();
    },
    openErrorModal: scope.openErrorModal,
    getPlayerCardLayout: scope.getStoredLayout,
    setPlayerCardLayout: scope.applyPlayerCardLayout,
    playlistBtn: scope.playlistBtn,
    playlistMenuElements: scope.playlistMenuElements,
    playlistModalElements: scope.playlistModalElements,
    getPlaybackOrderLabel: () => scope.playbackSequencingService.getPlaybackOrderLabel(),
    getBaseSequence: () => scope.baseSequenceIndexes(),
    ensureTrackTagsResolvedBatch: async (indexes: number[]) => {
        await scope.ensureTrackTagsResolvedBatch(indexes);
    },
    selectPlaylistSaveFile: scope.selectPlaylistSaveFile,
    loadListenHistoryData: async () => await scope.loadListenHistoryData(),
    loadPlaylistData: async (playlistPath: string) => await scope.loadPlaylistData(playlistPath),
    savePlaylistTrackMetadataCache: async (entries: PlaylistTrackMetadataCacheEntry[]) => await scope.savePlaylistTrackMetadataCache(entries),
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => scope.savePlaylistData(playlistPath, trackPaths),
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => scope.appendTracksToPlaylistData(playlistPath, trackPaths),
    loadTrack: async (index: number, allowMissingTrackRecovery = true, replayGainSequenceOverrideIndexes?: number[], manualTrackSelection = false) => {
        await scope.loadTrack(index, allowMissingTrackRecovery, replayGainSequenceOverrideIndexes, manualTrackSelection);
    },
    playCurrentTrack: async () => {
        await scope.playCurrentTrack();
    },
    playlistTargetModalElements: scope.playlistTargetModalElements,
    shareElements: scope.shareElements,
    ensureTrackTagsResolved: async (index: number) => {
        await scope.ensureTrackTagsResolved(index);
    },
    trackIndexForPath: scope.trackIndexForPath,
    resolveCoverForTrack: async (track: Track) => await scope.resolveCoverForTrack(track),
    getCachedMediaArtwork: (track: Track) => scope.coverArtService.getCachedMediaArtwork(track),
    getCoverArtSrc: () => scope.coverArt.classList.contains('is-visible') && scope.coverArt.src ? scope.coverArt.src : undefined,
    closeOtherMenus: () => {
        scope.closePlayOrderMenu();
        scope.closeTrackMetaMenu();
        scope.closeListenBrainzFeedbackMenu();
        scope.closeSidebarQueueMenu();
        scope.playlistControllerRef.closeMenu();
    },
    selectShareImageSaveFile: scope.selectShareImageSaveFile,
    saveShareImageFile: scope.saveShareImageFile,
    copyShareImageToClipboard: scope.copyShareImageToClipboard,
    imageModalElements: scope.imageModalElements,
    readFileBase64: scope.readFileBase64,
    readImageThumbnail: scope.readImageThumbnail,
    artistInfoElements: scope.artistInfoElements,
    get artistInfoRequestVersion() {
        return scope.artistInfoRequestVersion;
    },
    lookupArtistByMBID: scope.lookupArtistByMBID,
    lookupMusicBrainzRecordingURLs: scope.lookupMusicBrainzRecordingURLs,
    openUrl: scope.browserOpenUrl,
    app: scope.app,
    sidebarToggle: scope.sidebarToggle,
    libraryExpandToggle: scope.libraryExpandToggle,
    librarySidebar: scope.librarySidebar,
    libraryBack: scope.libraryBack,
    libraryPath: scope.libraryPath,
    librarySearch: scope.librarySearch,
    librarySort: scope.librarySort,
    libraryBrowser: scope.libraryBrowser,
    libraryScanYieldIndicator: scope.libraryScanYieldIndicator,
    loadFolderPage: scope.loadFolderPage,
    resolveLibraryFolderForAbsolutePath: scope.resolveLibraryFolderForAbsolutePath,
    isFolderImmediateDescendantsEnumerated: scope.isFolderImmediateDescendantsEnumerated,
    searchLibrary: scope.searchLibrary,
    getReleaseDepthForTrack: (track: Track) => scope.releaseDepthForTrack(track),
    getFolderCoverPath: (folderPath: string) => scope.coverArtService.getFolderCoverPath(folderPath),
    fetchVisualizationFrame: scope.fetchVisualizationFrame,
    resolveTrackIndex: scope.ensureTrackIndexForPath,
    resolveTextFileIndex: scope.textFileIndexForPath,
    resolveImageFileIndex: scope.imageFileIndexForPath,
    get fullLibraryScanLoadActive() {
        return scope.fullLibraryScanLoadActive;
    },
    set fullLibraryScanLoadActive(value) {
        scope.fullLibraryScanLoadActive = value;
    },
    get suppressAutoSelectAfterFullLibraryScan() {
        return scope.suppressAutoSelectAfterFullLibraryScan;
    },
    set suppressAutoSelectAfterFullLibraryScan(value) {
        scope.suppressAutoSelectAfterFullLibraryScan = value;
    },
    ensureTrackIndexForPath: scope.ensureTrackIndexForPath,
    ensureTextFileIndexForPath: scope.ensureTextFileIndexForPath || scope.textFileIndexForPath,
    ensureImageFileIndexForPath: scope.ensureImageFileIndexForPath || scope.imageFileIndexForPath,
    openTextFileModal: async (textFile: TextLibraryFile) => {
        await scope.openTextFileModal(textFile);
    },
    openSidebarQueueMenu: scope.openSidebarQueueMenu,
    closeSidebarQueueMenu: scope.closeSidebarQueueMenu,
});

export type AppControllerSetupContext = ReturnType<typeof createControllerSetupContextFromScope>;

export const setupControllersFromScope = (scope: AppControllerSetupScope) => setupAppControllers(createControllerSetupContextFromScope(scope));

const createEventBindingsContextFromScope = (scope: AppEventBindingsScope) => ({
        window: scope.window,
        document: scope.document,
        coverArt: scope.coverArt,
        coverFrame: scope.coverFrame,
        coverFront: scope.coverFront,
        trackTechnical: scope.trackTechnical,
        trackTechnicalAlt: scope.trackTechnicalAlt,
        libraryAbout: scope.libraryAbout,
        sidebarQueueAddNext: scope.sidebarQueueAddNext,
        sidebarQueueAddToPlaylist: scope.sidebarQueueAddToPlaylist,
        sidebarQueuePlay: scope.sidebarQueuePlay,
        sidebarQueueLove: scope.sidebarQueueLove,
        sidebarQueueHate: scope.sidebarQueueHate,
        sidebarQueueEnd: scope.sidebarQueueEnd,
        sidebarQueueOpenInBrowser: scope.sidebarQueueOpenInBrowser,
        sidebarQueueTreeToggleBtn: scope.sidebarQueueTreeToggleBtn,
        sidebarQueueSendToList: scope.sidebarQueueSendToList,
        errorBackdrop: scope.errorBackdrop,
        errorClose: scope.errorClose,
        errorOk: scope.errorOk,
        errorModal: scope.errorModal,
        queueConfirmBackdrop: scope.queueConfirmBackdrop,
        queueConfirmCancel: scope.queueConfirmCancel,
        queueConfirmProceed: scope.queueConfirmProceed,
        textFileBackdrop: scope.textFileBackdrop,
        textFileClose: scope.textFileClose,
        musicBrainzEntityBackdrop: scope.musicBrainzEntityBackdrop,
        musicBrainzEntityClose: scope.musicBrainzEntityClose,
        shareBackdrop: scope.shareBackdrop,
        shareClose: scope.shareClose,
        shareCommentInput: scope.shareCommentInput,
        shareSave: scope.shareSave,
        shareCopy: scope.shareCopy,
        technicalInfoBackdrop: scope.technicalInfoBackdrop,
        technicalInfoClose: scope.technicalInfoClose,
        aboutBackdrop: scope.aboutBackdrop,
        aboutClose: scope.aboutClose,
        aboutRepoLink: scope.aboutRepoLink,
        settingsElements: scope.settingsElements,
        playlistModalElements: scope.playlistModalElements,
        playlistTargetModalElements: scope.playlistTargetModalElements,
        imageModalElements: scope.imageModalElements,
        playPause: scope.playPause,
        playOrderMenu: scope.playOrderMenu,
        trackMetaParentFolderBtn: scope.trackMetaParentFolderBtn,
        trackMetaBrowserFolderBtn: scope.trackMetaBrowserFolderBtn,
        trackMetaCopyFilePathBtn: scope.trackMetaCopyFilePathBtn,
        trackMetaCopyFolderPathBtn: scope.trackMetaCopyFolderPathBtn,
        trackMetaOpenMbBtn: scope.trackMetaOpenMbBtn,
        trackMetaSendToList: scope.trackMetaSendToList,
        back: scope.back,
        forward: scope.forward,
        shareBtn: scope.shareBtn,
        seek: scope.seek,
        volume: scope.volume,
        volumeBtn: scope.volumeBtn,
        playlistTargetModalController: scope.playlistTargetModalControllerRef,
        playlistController: scope.playlistControllerRef,
        settingsController: scope.settingsControllerRef,
        libraryController: scope.libraryControllerRef,
        shareController: scope.shareControllerRef,
        imageModalController: scope.imageModalControllerRef,
        librarySidebar: scope.librarySidebar,
        librarySearch: scope.librarySearch,
        sidebarToggle: scope.sidebarToggle,
        playerCard: scope.playerCard,
        sidebarQueueMenu: scope.sidebarQueueMenu,
        queueConfirmModal: scope.queueConfirmModal,
        listenBrainzFeedbackMenu: scope.listenBrainzFeedbackMenu,
        listenBrainzLoveBtn: scope.listenBrainzLoveBtn,
        trackMetaMenu: scope.trackMetaMenu,
        musicBrainzEntityModal: scope.musicBrainzEntityModal,
        shareModal: scope.shareModal,
        technicalInfoModal: scope.technicalInfoModal,
        aboutModal: scope.aboutModal,
        textFileModal: scope.textFileModal,
        trackTitle: scope.trackTitle,
        trackAlbum: scope.trackAlbum,
        trackArtist: scope.trackArtist,
        trackTitleInline: scope.trackTitleInline,
        trackReleaseAlbum: scope.trackReleaseAlbum,
        trackArtistHeader: scope.trackArtistHeader,
        playerLane: scope.playerLane,
        handleDroppedFolderPath: scope.handleDroppedFolderPath,
        playDroppedTrackPath: scope.playDroppedTrackPath,
        openCoverImageModal: scope.openCoverImageModal,
        toggleCoverFlipFromSecondaryInput: scope.toggleCoverFlipFromSecondaryInput,
        toggleCoverFlipFromContextMenu: scope.toggleCoverFlipFromContextMenu,
        openTechnicalInfoModal: scope.openTechnicalInfoModal,
        openAboutModal: scope.openAboutModal,
        captureSidebarQueueSelectionContext: scope.captureSidebarQueueSelectionContext,
        closeSidebarQueueMenu: scope.closeSidebarQueueMenu,
        resolveSidebarQueueTrackIndexesForAction: scope.resolveSidebarQueueTrackIndexesForAction,
        addSidebarSelectionToPlaylist: scope.addSidebarSelectionToPlaylist,
        playSidebarQueueSelection: scope.playSidebarQueueSelection,
        submitSidebarQueueFeedback: scope.submitSidebarQueueFeedback,
        sidebarQueueFeedbackTrackIndex: () => scope.sidebarQueueFeedbackTrackIndex,
        sidebarQueueSendToActionScope: () => scope.sidebarQueueSendToActionScope,
        sidebarQueueFileActionPath: () => scope.sidebarQueueFileActionPath,
        sendToActionsForScope: scope.sendToActionsForScope,
        logSendToFrontend: scope.logSendToFrontend,
        runCustomSendToAction: scope.runCustomSendToAction,
        suppressTrackMetaClicks: scope.suppressTrackMetaClicks,
        openErrorModal: scope.openErrorModal,
        closeErrorModal: scope.closeErrorModal,
        closeQueueConfirmModal: scope.closeQueueConfirmModal,
        closeTextFileModal: scope.closeTextFileModal,
        closeMusicBrainzEntityModal: scope.closeMusicBrainzEntityModal,
        closeTechnicalInfoModal: scope.closeTechnicalInfoModal,
        closeAboutModal: scope.closeAboutModal,
        closePlayOrderMenu: scope.closePlayOrderMenu,
        closeTrackMetaMenu: scope.closeTrackMetaMenu,
        closeListenBrainzFeedbackMenu: scope.closeListenBrainzFeedbackMenu,
        openPlayOrderMenu: scope.openPlayOrderMenu,
        setPlaybackOrderMode: scope.setPlaybackOrderMode,
        savePlaybackOrderSetting: scope.savePlaybackOrderSetting,
        openCurrentTrackFolderInSidebar: scope.openCurrentTrackFolderInSidebar,
        openCurrentTrackFolderInFileBrowser: scope.openCurrentTrackFolderInFileBrowser,
        openSidebarQueueItemInFileBrowser: scope.openSidebarQueueItemInFileBrowser,
        copyCurrentTrackFilePath: scope.copyCurrentTrackFilePath,
        copyCurrentTrackFolderPath: scope.copyCurrentTrackFolderPath,
        trackMetaMenuTarget: () => scope.trackMetaMenuTarget,
        trackMetaMenuActionScope: () => scope.trackMetaMenuActionScope,
        trackMetaMenuActionPath: () => scope.trackMetaMenuActionPath,
        goToTrack: scope.goToTrack,
        toggleCurrentTrack: scope.toggleCurrentTrack,
        updateLyricsPanelVisibility: scope.updateLyricsPanelVisibility,
        hideToTrayWhenMinimized: scope.hideToTrayWhenMinimized,
        unlockMediaSessionAnchorFromUserGesture: scope.unlockMediaSessionAnchorFromUserGesture,
        handleFocusedHardwareMediaKey: scope.handleFocusedHardwareMediaKey,
        handleFocusedKeyboardShortcut: scope.handleFocusedKeyboardShortcut,
        focusedShortcutBindingsUseCode: scope.focusedShortcutBindingsUseCode,
        setCtrlHeldState: scope.setCtrlHeldState,
        updatePlayButton: scope.updatePlayButton,
        updateTrackLabels: scope.updateTrackLabels,
        updatePlayOrderMenuState: scope.updatePlayOrderMenuState,
        refreshLyricsPanel: scope.refreshLyricsPanel,
        refreshCurrentTrackMetadata: async () => {
            await scope.refreshCurrentTrackMetadata();
        },
        resetListenBrainzFeedbackState: scope.resetListenBrainzFeedbackState,
        initializeMediaSessionIntegration: scope.initializeMediaSessionIntegration,
        initializeSettings: scope.initializeSettings,
        initializeAppVersion: scope.initializeAppVersion,
        handleLibraryScanUpdatedEvent: scope.handleLibraryScanUpdatedEvent,
        updateLibraryLoadingEtaFromProgress: scope.updateLibraryLoadingEtaFromProgress,
        normalizeMusicBrainzTagWorkerProgress: scope.normalizeMusicBrainzTagWorkerProgress,
        setMusicBrainzTagWorkerProgress: (value: MusicBrainzTagWorkerProgress) => {
            scope.settingsControllerRef.setMusicBrainzTagWorkerProgress(value);
        },
        dispatchExternalPlaybackAction: scope.dispatchExternalPlaybackAction,
        logFrontendMessage: scope.logFrontendMessage,
        playlistControllerLoadPlaylistByPath: (playlistPath: string) => scope.playlistControllerRef.loadPlaylistByPath(playlistPath),
        handleDocumentClickWithinSettings: (target: Node) => scope.settingsControllerRef.handleDocumentClick(target),
        playerCardResizeObserver: scope.cardResizeObserver,
        logRescan: scope.logRescan,
        get coverFlipped() {
            return scope.coverFlipped;
        },
        get suppressCoverFrontClickUntil() {
            return scope.suppressCoverFrontClickUntil;
        },
        get currentMusicBrainzTagWorkerProgress() {
            return scope.currentMusicBrainzTagWorkerProgress;
        },
        set currentMusicBrainzTagWorkerProgress(value) {
            scope.currentMusicBrainzTagWorkerProgress = value;
        },
        get isSeeking() {
            return scope.isSeeking;
        },
        set isSeeking(value) {
            scope.isSeeking = value;
        },
        currentTimeLabel: scope.currentTimeLabel,
        formatTime: scope.formatTime,
        audioSeek: async (seconds: number) => await scope.audioSeek(seconds),
        audioSetVolume: async (volumeValue: number) => await scope.audioSetVolume(volumeValue),
        applyPlaybackState: scope.applyPlaybackState,
        handleAudioError: scope.handleAudioError,
        mediaSessionController: scope.mediaSessionController,
    });

export type AppEventBindingsContext = ReturnType<typeof createEventBindingsContextFromScope>;

export const bindEventHandlersFromScope = (scope: AppEventBindingsScope): void => {
    setupAppEventBindings(createEventBindingsContextFromScope(scope));
};
