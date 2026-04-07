import { createAppCoreServicesRuntime } from './app-core-services-runtime';
import { createAppLibraryLoadRuntime } from './app-library-load-runtime';
import { createAppModalRuntime } from './app-modal-runtime';
import { createAppNowPlayingRuntime } from './app-now-playing-runtime';
import { createAppPlaybackControlsRuntime } from './app-playback-controls-runtime';
import { createAppQueueMenuRuntime } from './app-queue-menu-runtime';

export const setupCoreServicesRuntime = (scope: any) => createAppCoreServicesRuntime({
    app: scope.app,
    get currentSettings() {
        return scope.currentSettings;
    },
    get tracks() {
        return scope.tracks;
    },
    get currentTrackIndex() {
        return scope.currentTrackIndex;
    },
    releaseDepthForTrack: (track: any) => scope.releaseDepthForTrack(track),
    get tagRequestVersion() {
        return scope.tagRequestVersion;
    },
    objectUrls: scope.objectUrls,
    playerLissajousCanvas: scope.playerLissajousCanvas,
    playerCard: scope.playerCard,
    listenBrainzLoveBtn: scope.listenBrainzLoveBtn,
    listenBrainzFeedbackMenu: scope.listenBrainzFeedbackMenu,
    listenBrainzFeedbackLoveBtn: scope.listenBrainzFeedbackLoveBtn,
    listenBrainzFeedbackHateBtn: scope.listenBrainzFeedbackHateBtn,
    closePlayOrderMenu: () => {
        scope.closePlayOrderMenu();
    },
    closeTrackMetaMenu: () => {
        scope.closeTrackMetaMenu();
    },
    closeSidebarQueueMenu: () => {
        scope.closeSidebarQueueMenu();
    },
    playlistController: () => scope.playlistControllerRef,
    sidebarToggle: scope.sidebarToggle,
    sidebarSectionTrigger: scope.sidebarSectionTrigger,
    sidebarSectionTriggerLabel: scope.sidebarSectionTriggerLabel,
    sidebarSectionMenu: scope.sidebarSectionMenu,
    sidebarSectionOptionLibrary: scope.sidebarSectionOptionLibrary,
    sidebarSectionOptionSocial: scope.sidebarSectionOptionSocial,
    sidebarPaneLibrary: scope.sidebarPaneLibrary,
    sidebarPaneSocial: scope.sidebarPaneSocial,
    socialFeedStatus: scope.socialFeedStatus,
    socialFeedList: scope.socialFeedList,
    trackTitle: scope.trackTitle,
    trackAlbum: scope.trackAlbum,
    trackArtist: scope.trackArtist,
    trackTitleInline: scope.trackTitleInline,
    trackReleaseAlbum: scope.trackReleaseAlbum,
    trackReleaseLabel: scope.trackReleaseLabel,
    trackArtistHeader: scope.trackArtistHeader,
    openMusicBrainzEntityForCurrentTrack: async (entityType: any) => {
        await scope.openMusicBrainzEntityForCurrentTrack(entityType);
    },
    setTrackMetaMenuTarget: (value: HTMLElement) => {
        scope.trackMetaMenuTarget = value;
    },
    openTrackMetaMenu: (clientX: number, clientY: number, includeCopyActions: boolean, actionScope: any, actionKind: any, actionPath: string) => {
        scope.openTrackMetaMenu(clientX, clientY, includeCopyActions, actionScope, actionKind, actionPath);
    },
});

export const setupNowPlayingRuntime = (scope: any) => createAppNowPlayingRuntime({
    get pendingNowPlayingCoverRefreshHandle() {
        return scope.pendingNowPlayingCoverRefreshHandle;
    },
    set pendingNowPlayingCoverRefreshHandle(value) {
        scope.pendingNowPlayingCoverRefreshHandle = value;
    },
    nowPlayingCoverRefreshDebounceMs: scope.nowPlayingCoverRefreshDebounceMs,
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
    set textFiles(value) {
        scope.textFiles = value;
    },
    get imageFiles() {
        return scope.imageFiles;
    },
    set imageFiles(value) {
        scope.imageFiles = value;
    },
    trackIndexByPath: scope.trackIndexByPath,
    textFileIndexByPath: scope.textFileIndexByPath,
    imageFileIndexByPath: scope.imageFileIndexByPath,
    get currentSettings() {
        return scope.currentSettings;
    },
    set currentSettings(value) {
        scope.currentSettings = value;
    },
    get activeReplayGainReleaseTrackPaths() {
        return scope.activeReplayGainReleaseTrackPaths;
    },
    set activeReplayGainReleaseTrackPaths(value) {
        scope.activeReplayGainReleaseTrackPaths = value;
    },
    replayGainReleaseDynamicRangeLabelByKey: scope.replayGainReleaseDynamicRangeLabelByKey,
    replayGainReleaseDynamicRangePendingByKey: scope.replayGainReleaseDynamicRangePendingByKey,
    get replayGainReleaseDynamicRangeRequestVersion() {
        return scope.replayGainReleaseDynamicRangeRequestVersion;
    },
    set replayGainReleaseDynamicRangeRequestVersion(value) {
        scope.replayGainReleaseDynamicRangeRequestVersion = value;
    },
    playlistController: () => scope.playlistControllerRef,
    get gaplessQueueRequestVersion() {
        return scope.gaplessQueueRequestVersion;
    },
    set gaplessQueueRequestVersion(value) {
        scope.gaplessQueueRequestVersion = value;
    },
    get queuedGaplessTrackPath() {
        return scope.queuedGaplessTrackPath;
    },
    set queuedGaplessTrackPath(value) {
        scope.queuedGaplessTrackPath = value;
    },
    get fullLibraryScanLoadActive() {
        return scope.fullLibraryScanLoadActive;
    },
    scrobbleService: scope.scrobbleService,
    libraryController: () => scope.libraryControllerRef,
    get tagRequestVersion() {
        return scope.tagRequestVersion;
    },
    set tagRequestVersion(value) {
        scope.tagRequestVersion = value;
    },
    hydrateCurrentTrackTag: async (index: number, version: number) => {
        await scope.hydrateCurrentTrackTag(index, version);
    },
    get artistInfoRequestVersion() {
        return scope.artistInfoRequestVersion;
    },
    set artistInfoRequestVersion(value) {
        scope.artistInfoRequestVersion = value;
    },
    hydrateCurrentArtistInfo: async (index: number) => {
        await scope.hydrateCurrentArtistInfo(index);
    },
    refreshListenBrainzFeedbackForCurrentTrack: async (force?: boolean) => {
        await scope.refreshListenBrainzFeedbackForCurrentTrack(force);
    },
    playbackStateService: scope.playbackStateService,
    hasListenBrainzScrobbling: scope.hasListenBrainzScrobbling,
    playPause: scope.playPause,
    currentTimeLabel: scope.currentTimeLabel,
    trackDurationLabel: scope.trackDurationLabel,
    seek: scope.seek,
    get isSeeking() {
        return scope.isSeeking;
    },
    updateMediaSessionMetadata: () => {
        scope.updateMediaSessionMetadata();
    },
    updateMediaSessionPlaybackState: () => {
        scope.updateMediaSessionPlaybackState();
    },
    updateMediaSessionPositionState: () => {
        scope.updateMediaSessionPositionState();
    },
    lissajousVisualizerController: scope.lissajousVisualizerController,
    goToTrack: (direction: -1 | 1) => {
        scope.goToTrack(direction);
    },
    get playbackMutationVersion() {
        return scope.playbackMutationVersion;
    },
    get playbackPollHandle() {
        return scope.playbackPollHandle;
    },
    set playbackPollHandle(value) {
        scope.playbackPollHandle = value;
    },
    volume: scope.volume,
    playerShell: scope.playerShell,
    playerLane: scope.playerLane,
    playerCard: scope.playerCard,
    lyricsPanel: scope.lyricsPanel,
    lyricsContent: scope.lyricsContent,
    trackTechnical: scope.trackTechnical,
    trackTechnicalAlt: scope.trackTechnicalAlt,
    trackTitle: scope.trackTitle,
    trackAlbum: scope.trackAlbum,
    trackPosition: scope.trackPosition,
    trackArtist: scope.trackArtist,
    trackReleaseAlbum: scope.trackReleaseAlbum,
    trackTitleInline: scope.trackTitleInline,
    trackPositionInline: scope.trackPositionInline,
    trackReleaseLabel: scope.trackReleaseLabel,
    trackReleaseCat: scope.trackReleaseCat,
    trackReleaseYear: scope.trackReleaseYear,
    trackGenreInline: scope.trackGenreInline,
    trackArtistHeader: scope.trackArtistHeader,
    trackMetadataService: scope.trackMetadataService,
    resolveCoverForTrack: async (track: any) => await scope.resolveCoverForTrack(track),
    coverArtBackground: scope.coverArtBackground,
    coverArt: scope.coverArt,
    setBackgroundCover: (coverSrc?: string) => {
        scope.setBackgroundCover(coverSrc);
    },
    get coverFlipped() {
        return scope.coverFlipped;
    },
    set coverFlipped(value) {
        scope.coverFlipped = value;
    },
    coverFlipper: scope.coverFlipper,
    playbackSequencingService: scope.playbackSequencingService,
    coverArtService: scope.coverArtService,
});

export const setupQueueMenuRuntime = (scope: any) => createAppQueueMenuRuntime({
    get currentSettings() {
        return scope.currentSettings;
    },
    get tracks() {
        return scope.tracks;
    },
    get currentTrackIndex() {
        return scope.currentTrackIndex;
    },
    set currentTrackIndex(value) {
        scope.currentTrackIndex = value;
    },
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
    get sidebarQueueTrackIndexes() {
        return scope.sidebarQueueTrackIndexes;
    },
    set sidebarQueueTrackIndexes(value) {
        scope.sidebarQueueTrackIndexes = value;
    },
    get sidebarQueueFeedbackTrackIndex() {
        return scope.sidebarQueueFeedbackTrackIndex;
    },
    set sidebarQueueFeedbackTrackIndex(value) {
        scope.sidebarQueueFeedbackTrackIndex = value;
    },
    get sidebarQueueFolderPath() {
        return scope.sidebarQueueFolderPath;
    },
    set sidebarQueueFolderPath(value) {
        scope.sidebarQueueFolderPath = value;
    },
    get sidebarQueueFolderLabel() {
        return scope.sidebarQueueFolderLabel;
    },
    set sidebarQueueFolderLabel(value) {
        scope.sidebarQueueFolderLabel = value;
    },
    get sidebarQueueFolderTarget() {
        return scope.sidebarQueueFolderTarget;
    },
    set sidebarQueueFolderTarget(value) {
        scope.sidebarQueueFolderTarget = value;
    },
    get sidebarQueueTrackIndexesScopedToSelection() {
        return scope.sidebarQueueTrackIndexesScopedToSelection;
    },
    set sidebarQueueTrackIndexesScopedToSelection(value) {
        scope.sidebarQueueTrackIndexesScopedToSelection = value;
    },
    get sidebarQueueFileActionPath() {
        return scope.sidebarQueueFileActionPath;
    },
    set sidebarQueueFileActionPath(value) {
        scope.sidebarQueueFileActionPath = value;
    },
    get sidebarQueueIncludeFileActions() {
        return scope.sidebarQueueIncludeFileActions;
    },
    set sidebarQueueIncludeFileActions(value) {
        scope.sidebarQueueIncludeFileActions = value;
    },
    get sidebarQueueSendToActionScope() {
        return scope.sidebarQueueSendToActionScope;
    },
    set sidebarQueueSendToActionScope(value) {
        scope.sidebarQueueSendToActionScope = value;
    },
    get queueConfirmResolver() {
        return scope.queueConfirmResolver;
    },
    set queueConfirmResolver(value) {
        scope.queueConfirmResolver = value;
    },
    get trackMetaMenuTarget() {
        return scope.trackMetaMenuTarget;
    },
    set trackMetaMenuTarget(value) {
        scope.trackMetaMenuTarget = value;
    },
    get trackMetaMenuActionScope() {
        return scope.trackMetaMenuActionScope;
    },
    set trackMetaMenuActionScope(value) {
        scope.trackMetaMenuActionScope = value;
    },
    get trackMetaMenuActionPath() {
        return scope.trackMetaMenuActionPath;
    },
    set trackMetaMenuActionPath(value) {
        scope.trackMetaMenuActionPath = value;
    },
    playOrderMenu: scope.playOrderMenu,
    trackMetaMenu: scope.trackMetaMenu,
    trackMetaSendToList: scope.trackMetaSendToList,
    trackMetaSendToDivider: scope.trackMetaSendToDivider,
    trackMetaCopyFilePathBtn: scope.trackMetaCopyFilePathBtn,
    trackMetaCopyFolderPathBtn: scope.trackMetaCopyFolderPathBtn,
    trackMetaCopyDivider: scope.trackMetaCopyDivider,
    trackMetaParentFolderBtn: scope.trackMetaParentFolderBtn,
    trackMetaBrowserFolderBtn: scope.trackMetaBrowserFolderBtn,
    sidebarQueueMenu: scope.sidebarQueueMenu,
    sidebarQueueSendToList: scope.sidebarQueueSendToList,
    sidebarQueueSendToDivider: scope.sidebarQueueSendToDivider,
    sidebarQueueFeedbackDivider: scope.sidebarQueueFeedbackDivider,
    sidebarQueueLove: scope.sidebarQueueLove,
    sidebarQueueHate: scope.sidebarQueueHate,
    playPause: scope.playPause,
    queueConfirmModal: scope.queueConfirmModal,
    queueConfirmTitle: scope.queueConfirmTitle,
    queueConfirmMessage: scope.queueConfirmMessage,
    libraryBrowser: scope.libraryBrowser,
    get libraryController() {
        return scope.libraryControllerRef;
    },
    get playlistController() {
        return scope.playlistControllerRef;
    },
    get playlistTargetModalController() {
        return scope.playlistTargetModalControllerRef;
    },
    playbackSequencingService: scope.playbackSequencingService,
    sidebarQueueDescendantPromptThreshold: scope.sidebarQueueDescendantPromptThreshold,
    closeListenBrainzFeedbackMenu: () => {
        scope.closeListenBrainzFeedbackMenu();
    },
    hasListenBrainzScrobbling: scope.hasListenBrainzScrobbling,
    ensureTrackIndexForPath: scope.ensureTrackIndexForPath,
    ensureTrackTagsResolved: async (index: number) => {
        await scope.ensureTrackTagsResolved(index);
    },
    submitListenBrainzFeedbackForTrack: async (trackIndex: number, score: any) => {
        await scope.submitListenBrainzFeedbackForTrack(trackIndex, score);
    },
    openErrorModal: (title: string, message: string) => {
        scope.openErrorModal(title, message);
    },
    logFrontendMessage: scope.logFrontendMessage,
    loadTrack: async (index: number, allowMissingTrackRecovery = true, replayGainSequenceOverrideIndexes?: number[], manualTrackSelection = false) => {
        await scope.loadTrack(index, allowMissingTrackRecovery, replayGainSequenceOverrideIndexes, manualTrackSelection);
    },
    queueGaplessNextTrack: async (stateOverride?: any, sequenceOverrideIndexes?: number[]) => {
        await scope.queueGaplessNextTrack(stateOverride, sequenceOverrideIndexes);
    },
    playCurrentTrack: async () => {
        await scope.playCurrentTrack();
    },
});

export const setupModalRuntime = (scope: any) => createAppModalRuntime({
    get artistInfoController() {
        return scope.artistInfoControllerRef;
    },
    get activeBackgroundLayer() {
        return scope.activeBackgroundLayer;
    },
    set activeBackgroundLayer(value) {
        scope.activeBackgroundLayer = value;
    },
    bgLayerA: scope.bgLayerA,
    bgLayerB: scope.bgLayerB,
    trackMetadataService: scope.trackMetadataService,
    get currentTrackIndex() {
        return scope.currentTrackIndex;
    },
    refreshNowPlayingLabel: scope.refreshNowPlayingLabel,
    get libraryController() {
        return scope.libraryControllerRef;
    },
    applyCoverArtForTrack: async (index: number) => {
        await scope.applyCoverArtForTrack(index);
    },
    get artistInfoRequestVersion() {
        return scope.artistInfoRequestVersion;
    },
    set artistInfoRequestVersion(value) {
        scope.artistInfoRequestVersion = value;
    },
    textFileModal: scope.textFileModal,
    textFileTitle: scope.textFileTitle,
    textFileCode: scope.textFileCode,
    coverArt: scope.coverArt,
    get tracks() {
        return scope.tracks;
    },
    coverArtService: scope.coverArtService,
    get imageModalController() {
        return scope.imageModalControllerRef;
    },
    collectReleaseImageFiles: scope.collectReleaseImageFiles,
    indexOfImageByPath: scope.indexOfImageByPath,
    aboutModal: scope.aboutModal,
    get aboutModalHideTimer() {
        return scope.aboutModalHideTimer;
    },
    set aboutModalHideTimer(value) {
        scope.aboutModalHideTimer = value;
    },
    aboutModalTransitionMs: scope.aboutModalTransitionMs,
    errorModal: scope.errorModal,
    errorTitle: scope.errorTitle,
    errorModalMessage: scope.errorModalMessage,
    get errorModalHideTimer() {
        return scope.errorModalHideTimer;
    },
    set errorModalHideTimer(value) {
        scope.errorModalHideTimer = value;
    },
    errorModalTransitionMs: scope.errorModalTransitionMs,
    musicBrainzEntityModal: scope.musicBrainzEntityModal,
    musicBrainzEntityDialog: scope.musicBrainzEntityDialog,
    musicBrainzEntityTitle: scope.musicBrainzEntityTitle,
    musicBrainzEntityContent: scope.musicBrainzEntityContent,
    get musicBrainzEntityModalHideTimer() {
        return scope.musicBrainzEntityModalHideTimer;
    },
    set musicBrainzEntityModalHideTimer(value) {
        scope.musicBrainzEntityModalHideTimer = value;
    },
    musicBrainzEntityModalTransitionMs: scope.musicBrainzEntityModalTransitionMs,
    ensureTrackTagsResolved: async (index: number) => {
        await scope.ensureTrackTagsResolved(index);
    },
    technicalInfoModal: scope.technicalInfoModal,
    technicalInfoTitle: scope.technicalInfoTitle,
    technicalInfoContent: scope.technicalInfoContent,
    get technicalInfoModalHideTimer() {
        return scope.technicalInfoModalHideTimer;
    },
    set technicalInfoModalHideTimer(value) {
        scope.technicalInfoModalHideTimer = value;
    },
    technicalInfoModalTransitionMs: scope.technicalInfoModalTransitionMs,
});

export const setupLibraryLoadRuntime = (scope: any) => createAppLibraryLoadRuntime({
    libraryIndexedFilePageSize: scope.libraryIndexedFilePageSize,
    selectedLibraryRootLabel: scope.selectedLibraryRootLabel,
    get objectUrls() {
        return scope.objectUrls;
    },
    set objectUrls(value) {
        scope.objectUrls = value;
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
    set textFiles(value) {
        scope.textFiles = value;
    },
    get imageFiles() {
        return scope.imageFiles;
    },
    set imageFiles(value) {
        scope.imageFiles = value;
    },
    get currentTrackIndex() {
        return scope.currentTrackIndex;
    },
    set currentTrackIndex(value) {
        scope.currentTrackIndex = value;
    },
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
    get availableAudioOutputDevices() {
        return scope.availableAudioOutputDevices;
    },
    set availableAudioOutputDevices(value) {
        scope.availableAudioOutputDevices = value;
    },
    get libraryClientFinalizeEstimateMs() {
        return scope.libraryClientFinalizeEstimateMs;
    },
    set libraryClientFinalizeEstimateMs(value) {
        scope.libraryClientFinalizeEstimateMs = value;
    },
    get activeLibraryLoadScanResolvedAtMs() {
        return scope.activeLibraryLoadScanResolvedAtMs;
    },
    set activeLibraryLoadScanResolvedAtMs(value) {
        scope.activeLibraryLoadScanResolvedAtMs = value;
    },
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
    trackIndexByPath: scope.trackIndexByPath,
    textFileIndexByPath: scope.textFileIndexByPath,
    imageFileIndexByPath: scope.imageFileIndexByPath,
    trackTitle: scope.trackTitle,
    trackAlbum: scope.trackAlbum,
    trackPosition: scope.trackPosition,
    trackArtist: scope.trackArtist,
    trackTechnical: scope.trackTechnical,
    trackTechnicalAlt: scope.trackTechnicalAlt,
    trackArtistHeader: scope.trackArtistHeader,
    trackReleaseAlbum: scope.trackReleaseAlbum,
    trackReleaseLabel: scope.trackReleaseLabel,
    trackReleaseCat: scope.trackReleaseCat,
    trackReleaseYear: scope.trackReleaseYear,
    trackTitleInline: scope.trackTitleInline,
    trackGenreInline: scope.trackGenreInline,
    lyricsContent: scope.lyricsContent,
    playerLane: scope.playerLane,
    lyricsPanel: scope.lyricsPanel,
    coverArt: scope.coverArt,
    coverArtBackground: scope.coverArtBackground,
    aboutVersion: scope.aboutVersion,
    closeSidebarQueueMenu: () => {
        scope.closeSidebarQueueMenu();
    },
    closeListenBrainzFeedbackMenu: () => {
        scope.closeListenBrainzFeedbackMenu();
    },
    closeMusicBrainzEntityModal: () => {
        scope.closeMusicBrainzEntityModal();
    },
    closeTechnicalInfoModal: () => {
        scope.closeTechnicalInfoModal();
    },
    clearReplayGainReleaseDynamicRangeCache: scope.clearReplayGainReleaseDynamicRangeCache,
    audioStop: async () => await scope.audioStop(),
    applyPlaybackState: scope.applyPlaybackState,
    handleAudioError: scope.handleAudioError,
    clearCoverArtCache: () => {
        scope.coverArtService.clearCache();
    },
    clearArtistInfoCache: () => {
        scope.artistInfoControllerRef.clearCache();
    },
    clearImageModalCache: () => {
        scope.imageModalControllerRef.clearCachedDataUrls();
    },
    resetLibraryState: () => {
        scope.libraryControllerRef.resetLibraryState();
    },
    resetPlaylistState: () => {
        scope.playlistControllerRef.resetState();
    },
    resetScrobbleState: () => {
        scope.scrobbleService.reset();
    },
    resetShuffleHistory: scope.resetShuffleHistory,
    setBackgroundCover: scope.setBackgroundCover,
    setCoverFlipped: scope.setCoverFlipped,
    resetArtistInfoPanel: scope.resetArtistInfoPanel,
    renderLibraryFolder: () => {
        scope.libraryControllerRef.renderFolder('none');
    },
    updateMediaSessionMetadata: scope.updateMediaSessionMetadata,
    beginLibraryLoadTracking: scope.beginLibraryLoadTracking,
    markLibraryScanResolved: scope.markLibraryScanResolved,
    finishLibraryLoadTracking: scope.finishLibraryLoadTracking,
    scanConfiguredLibraryFoldersBackend: async () => await scope.scanConfiguredLibraryFoldersBackend(),
    setLibraryLoading: (loading: boolean) => {
        scope.libraryControllerRef.setLibraryLoading(loading);
    },
    setLibraryLoadingEtaSeconds: (value: number | null) => {
        scope.libraryControllerRef.setLibraryLoadingEtaSeconds(value);
    },
    setLibraryLoadingStatusLabel: (value: string) => {
        scope.libraryControllerRef.setLibraryLoadingStatusLabel(value);
    },
    setLibraryPathMessage: (value: string) => {
        scope.libraryControllerRef.setLibraryPathMessage(value);
    },
    setForceReloadEtaSeconds: (value: number | null) => {
        scope.settingsControllerRef.setForceReloadEtaSeconds(value);
    },
    setLibraryRootName: (value: string) => {
        scope.libraryControllerRef.setLibraryRootName(value);
    },
    setLibraryIndexTruncated: (value: boolean) => {
        scope.libraryControllerRef.setLibraryIndexTruncated(value);
    },
    getLibraryRootName: () => scope.libraryControllerRef.getLibraryRootName(),
    getCurrentFolderPath: () => scope.libraryControllerRef.getCurrentFolderPath(),
    setCurrentFolderPath: (value: string) => {
        scope.libraryControllerRef.setCurrentFolderPath(value);
    },
    getLibrarySearchStateSnapshot: () => scope.libraryControllerRef.getLibrarySearchStateSnapshot(),
    restoreLibrarySearchState: (snapshot: any) => {
        scope.libraryControllerRef.restoreLibrarySearchState(snapshot);
    },
    navigateToFolder: (folderPath: string) => {
        scope.libraryControllerRef.navigateToFolder(folderPath);
    },
    rebuildLibraryTree: (rootName: string, truncated: boolean, nextTracks: any[], nextTextFiles: any[], nextImageFiles: any[]) => {
        return scope.libraryControllerRef.rebuildLibraryTree(rootName, truncated, nextTracks, nextTextFiles, nextImageFiles);
    },
    firstTrackIndexFromRandomAlbumFolder: () => scope.libraryControllerRef.firstTrackIndexFromRandomAlbumFolder(),
    getPlaybackState: () => scope.playbackStateService.getPlaybackState(),
    loadTrack: async (index: number) => {
        await scope.loadTrack(index);
    },
    updatePlayButton: scope.updatePlayButton,
    refreshPlaylistOpenModal: () => {
        scope.playlistControllerRef.refreshOpenModal();
    },
    scheduleLibraryIncrementalFolderRefresh: scope.scheduleLibraryIncrementalFolderRefresh,
    scheduleNowPlayingCoverRefresh: scope.scheduleNowPlayingCoverRefresh,
    applyPlayerCardLayout: scope.applyPlayerCardLayout,
    getStoredLayout: scope.getStoredLayout,
    resetListenBrainzFeedbackState: scope.resetListenBrainzFeedbackState,
    listAudioOutputDevices: async () => await scope.listAudioOutputDevices(),
    getSettings: async () => await scope.getSettings(),
    setLissajousEnabled: (enabled: boolean) => {
        scope.lissajousVisualizerController.setEnabled(enabled);
    },
    applyUiDitheringSetting: scope.applyUiDitheringSetting,
    handleListenBrainzSocialSettingsChanged: () => {
        scope.listenBrainzSocialController.handleSettingsChanged();
    },
    getMusicBrainzTagWorkerProgress: async () => await scope.getMusicBrainzTagWorkerProgress(),
    setMusicBrainzTagWorkerProgress: (value: any) => {
        scope.settingsControllerRef.setMusicBrainzTagWorkerProgress(value);
    },
    setPlaybackOrderMode: scope.setPlaybackOrderMode,
    completeStartupIfReady: async () => {
        await scope.completeStartupIfReady();
    },
    refreshListenBrainzFeedbackForCurrentTrack: async (force?: boolean) => {
        await scope.refreshListenBrainzFeedbackForCurrentTrack(force);
    },
    getAppVersion: async () => await scope.getAppVersion(),
    rebuildTrackPathIndex: scope.rebuildTrackPathIndex,
    rebuildTextFilePathIndex: scope.rebuildTextFilePathIndex,
    rebuildImageFilePathIndex: scope.rebuildImageFilePathIndex,
    setFolderCoverPath: (folder: string, coverPath: string) => {
        scope.coverArtService.setFolderCoverPath(folder, coverPath);
    },
    logRescan: scope.logRescan,
    loadIndexedFilePage: async (kind: any, offset: number, limit: number) => {
        return await scope.loadIndexedFilePage(kind, offset, limit);
    },
});

export const setupPlaybackControlsRuntime = (scope: any) => createAppPlaybackControlsRuntime({
    get availableAudioOutputDevices() {
        return scope.availableAudioOutputDevices;
    },
    set availableAudioOutputDevices(value) {
        scope.availableAudioOutputDevices = value;
    },
    aboutVersion: scope.aboutVersion,
    coverArtService: scope.coverArtService,
    get gaplessQueueRequestVersion() {
        return scope.gaplessQueueRequestVersion;
    },
    set gaplessQueueRequestVersion(value) {
        scope.gaplessQueueRequestVersion = value;
    },
    get queuedGaplessTrackPath() {
        return scope.queuedGaplessTrackPath;
    },
    set queuedGaplessTrackPath(value) {
        scope.queuedGaplessTrackPath = value;
    },
    playbackSequencingService: scope.playbackSequencingService,
    playlistController: () => scope.playlistControllerRef,
    resetShuffleHistory: scope.resetShuffleHistory,
    get currentTrackIndex() {
        return scope.currentTrackIndex;
    },
    set currentTrackIndex(value) {
        scope.currentTrackIndex = value;
    },
    get tracks() {
        return scope.tracks;
    },
    scrobbleService: scope.scrobbleService,
    get currentSettings() {
        return scope.currentSettings;
    },
    libraryController: () => scope.libraryControllerRef,
    logPlaybackDebug: scope.logPlaybackDebug,
    collectReplayGainReleaseTrackPathsForIndex: scope.collectReplayGainReleaseTrackPathsForIndex,
    setActiveReplayGainReleaseTrackPaths: scope.setActiveReplayGainReleaseTrackPaths,
    applyPlaybackState: scope.applyPlaybackState,
    setCoverFlipped: scope.setCoverFlipped,
    hasConfiguredLibraryFolders: scope.hasConfiguredLibraryFolders,
    beginLibraryLoadTracking: scope.beginLibraryLoadTracking,
    markLibraryScanResolved: scope.markLibraryScanResolved,
    get libraryClientFinalizeEstimateMs() {
        return scope.libraryClientFinalizeEstimateMs;
    },
    loadLibraryScan: scope.loadLibraryScan,
    finishLibraryLoadTracking: scope.finishLibraryLoadTracking,
    handleAudioError: scope.handleAudioError,
    refreshNowPlayingLabel: scope.refreshNowPlayingLabel,
    applyCoverArtForTrack: async (index: number) => {
        await scope.applyCoverArtForTrack(index);
    },
    get tagRequestVersion() {
        return scope.tagRequestVersion;
    },
    set tagRequestVersion(value) {
        scope.tagRequestVersion = value;
    },
    hydrateCurrentTrackTag: async (index: number, version: number) => {
        await scope.hydrateCurrentTrackTag(index, version);
    },
    get artistInfoRequestVersion() {
        return scope.artistInfoRequestVersion;
    },
    set artistInfoRequestVersion(value) {
        scope.artistInfoRequestVersion = value;
    },
    hydrateCurrentArtistInfo: async (index: number) => {
        await scope.hydrateCurrentArtistInfo(index);
    },
    playbackStateService: scope.playbackStateService,
    get playPauseToggleInFlight() {
        return scope.playPauseToggleInFlight;
    },
    set playPauseToggleInFlight(value) {
        scope.playPauseToggleInFlight = value;
    },
    shouldSkipLoadedTrack: async (): Promise<boolean> => await scope.shouldSkipLoadedTrack(),
    get playbackMutationVersion() {
        return scope.playbackMutationVersion;
    },
    set playbackMutationVersion(value) {
        scope.playbackMutationVersion = value;
    },
    nextTrackIndexForDirection: scope.nextTrackIndexForDirection,
    get trackNavigationChain() {
        return scope.trackNavigationChain;
    },
    set trackNavigationChain(value) {
        scope.trackNavigationChain = value;
    },
    coverArt: scope.coverArt,
    librarySearch: scope.librarySearch,
    listenBrainzSocialController: scope.listenBrainzSocialController,
    settingsController: () => scope.settingsControllerRef,
});
