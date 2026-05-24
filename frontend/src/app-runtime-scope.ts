import type { getAppShellElements } from './app-shell';
import type { ArtistDetails } from './types/app-types';
import type { RoonAccentSettings } from './utils/roon-accent-theme';
import type { ArtistInfoController, createArtistInfoController } from './controllers/artist-info-controller';
import type { createVisualizerController } from './controllers/visualizer-controller';
import type { ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import type { createListenBrainzSocialController } from './controllers/listenbrainz-social-controller';
import type { SidebarController } from './controllers/sidebar-controller';
import type { ExternalPlaybackAction, createMediaSessionController } from './controllers/media-session-controller';
import type { ImageModalController } from './controllers/image-modal-controller';
import type { LibraryController } from './controllers/library-controller';
import type { LibraryControllerState } from './controllers/library-controller-types';
import type { LoadedPlaylistData, PlaylistController, PlaylistTrackMetadataCacheEntry } from './controllers/playlist-controller';
import type { PlaylistControllerState } from './controllers/playlist-controller-state';
import type { PlaylistTargetModalController } from './controllers/playlist-target-modal-controller';
import type { ShareController, createShareController } from './controllers/share-controller';
import type { SettingsController } from './controllers/settings-controller';
import type { SettingsControllerState } from './controllers/settings-controller-types';
import type { createCoverArtService } from './services/cover-art-service';
import type { createPlaybackSequencingService, PlaybackSequencingState } from './services/playback-sequencing-service';
import type { createPlaybackStateService, PlaybackSessionState } from './services/playback-state-service';
import type { createScrobbleService, ScrobbleSessionState } from './services/scrobble-service';
import type { createTrackMetadataService } from './services/track-metadata-service';
import type {
    AppShellTheme,
    AppSettings,
    ArtistExternalUrl,
    AudioOutputDevice,
    AudioPlaybackState,
    AudioVisualizationFrame,
    CustomSendToAction,
    CustomSendToActionScope,
    FFmpegPathStatus,
    ImageLibraryFile,
    LibraryBrowserSortMode,
    LibraryFolderPage,
    LibraryIndexedFilePage,
    LibraryScanProgress,
    LibraryScanResult,
    LibrarySearchPage,
    MusicBrainzEntityType,
    MusicBrainzTagWorkerProgress,
    PlaybackOrderMode,
    PlayerCardLayout,
    TextLibraryFile,
    Track,
} from './types/app-types';

export type TrackMetaActionKind = 'track' | 'album' | null;

export type AppShellElements = ReturnType<typeof getAppShellElements>;
type ShareElements = Parameters<typeof createShareController>[0]['elements'];
type ArtistInfoElements = Parameters<typeof createArtistInfoController>[0]['elements'];
type CoverArtService = ReturnType<typeof createCoverArtService>;
type PlaybackSequencingService = ReturnType<typeof createPlaybackSequencingService>;
type PlaybackStateService = ReturnType<typeof createPlaybackStateService>;
type ScrobbleService = ReturnType<typeof createScrobbleService>;
type TrackMetadataService = ReturnType<typeof createTrackMetadataService>;
type VisualizerController = ReturnType<typeof createVisualizerController>;
type ListenBrainzSocialController = ReturnType<typeof createListenBrainzSocialController>;
type MediaSessionController = ReturnType<typeof createMediaSessionController>;

type SharedRuntimeMethods = {
    validateConfiguredFFmpegPath: (ffmpegPath: string) => Promise<FFmpegPathStatus>;
    missingFFmpegMessage: (status: FFmpegPathStatus) => string;
    saveSettingsBackend: (settings: AppSettings) => Promise<AppSettings>;
    scanConfiguredLibraryFoldersBackend: () => Promise<LibraryScanResult>;
    audioStop: () => Promise<AudioPlaybackState>;
    listAudioOutputDevices: () => Promise<AudioOutputDevice[]>;
    getSettings: () => Promise<AppSettings>;
    getMusicBrainzTagWorkerProgress: () => Promise<MusicBrainzTagWorkerProgress>;
    getAppVersion: () => Promise<string>;
    loadIndexedFilePage: (kind: LibraryIndexedFilePage['kind'], offset: number, limit: number) => Promise<LibraryIndexedFilePage>;
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    audioQueueNextTrack: (currentPath: string, nextPath: string) => Promise<unknown>;
    getLastFmRequestToken: (apiKey: string, apiSecret: string) => Promise<string>;
    getLastFmSessionKey: (apiKey: string, apiSecret: string, requestToken: string) => Promise<string>;
    browserOpenUrl: (url: string) => Promise<void>;
    audioReinitializeBackend: () => Promise<AudioPlaybackState>;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    selectPlaylistSaveFile: () => Promise<string>;
    selectShareImageSaveFile: (defaultName: string) => Promise<string>;
    saveShareImageFile: (path: string, base64: string) => Promise<boolean>;
    copyShareImageToClipboard: (base64: string) => Promise<boolean>;
    readFileBase64: (path: string) => Promise<string>;
    readImageThumbnail: (path: string, maxEdge: number) => Promise<{ base64?: string; mimeType?: string }>;
    loadFolderPage: (folderPath: string, sortMode: LibraryBrowserSortMode, offset: number, limit: number) => Promise<LibraryFolderPage>;
    resolveLibraryFolderForAbsolutePath: (path: string) => Promise<string>;
    isFolderImmediateDescendantsEnumerated: (folderPath: string) => Promise<boolean>;
    searchLibrary: (query: string, offset: number, limit: number) => Promise<LibrarySearchPage>;
    fetchVisualizationFrame: (frameCount: number) => Promise<AudioVisualizationFrame>;
    applyUiDitheringSetting: () => void;
    beginLibraryLoadTracking: () => void;
    markLibraryScanResolved: () => void;
    finishLibraryLoadTracking: () => void;
    scheduleLibraryIncrementalFolderRefresh: () => void;
    lookupArtistByMBID: (mbid: string) => Promise<ArtistDetails>;
    lookupMusicBrainzRecordingURLs: (mbid: string) => Promise<ArtistExternalUrl[]>;
    logFrontendMessage: (message: string) => Promise<void>;
    initializeSettings: () => Promise<void>;
    audioSeek: (seconds: number) => Promise<AudioPlaybackState>;
    audioSetVolume: (volumeValue: number) => Promise<AudioPlaybackState>;
    logRescan: (message: string, ...args: unknown[]) => void;
    formatTime: (value: number) => string;
};

type ReturnedRuntimeMethods = {
    closeListenBrainzFeedbackMenu: () => void;
    resetArtistInfoPanel: () => void;
    hasLastFmScrobbling: () => boolean;
    hasListenBrainzScrobbling: () => boolean;
    openLibrarySearch: (query: string, options?: { expandFilteredFolders?: boolean }) => void;
    refreshListenBrainzFeedbackForCurrentTrack: (force?: boolean) => Promise<void>;
    resetListenBrainzFeedbackState: () => void;
    submitListenBrainzFeedbackForTrack: (trackIndex: number, score: ListenBrainzFeedbackScore) => Promise<void>;
    applyPlayerCardLayout: (layout: PlayerCardLayout) => void;
    getStoredLayout: () => PlayerCardLayout;
    applyShellTheme: (theme: AppShellTheme) => void;
    getStoredShellTheme: () => AppShellTheme;
    applyRoonAccentTheme: (theme: RoonAccentSettings) => void;
    getStoredRoonAccentTheme: () => RoonAccentSettings;
    showOverviewPage: () => void;
    showNowPlayingPage: () => void;
    refreshOverviewDashboard: () => void;
    setCtrlHeldState: (held: boolean) => void;
    suppressTrackMetaClicks: () => void;
    applyCoverArtForTrack: (index: number) => Promise<void>;
    applyPlaybackState: (state: AudioPlaybackState) => void;
    baseSequenceIndexes: () => { indexes: number[]; currentPosition: number };
    clearReplayGainReleaseDynamicRangeCache: () => void;
    collectReleaseImageFiles: (track: Track) => ImageLibraryFile[];
    ensureReleaseImageFilesLoaded: (track: Track) => Promise<ImageLibraryFile[]>;
    collectReplayGainReleaseTrackPathsForIndex: (trackIndex: number, sequenceOverrideIndexes?: number[]) => string[];
    replayGainReleaseTrackPathsForIndex: (trackIndex: number) => string[];
    ensureTrackIndexForPath: (path: string) => number;
    ensureTextFileIndexForPath?: (path: string) => number;
    ensureImageFileIndexForPath?: (path: string) => number;
    ensureTrackTagsResolved: (index: number) => Promise<void>;
    ensureTrackTagsResolvedBatch: (indexes: number[]) => Promise<void>;
    handleAudioError: (error: unknown) => void;
    imageFileIndexForPath: (path: string) => number;
    indexOfImageByPath: (gallery: ImageLibraryFile[], candidatePath?: string) => number;
    initializeBackendPlayback: () => Promise<void>;
    logPlaybackDebug: (message: string) => void;
    nextTrackIndexForDirection: (direction: -1 | 1) => number | undefined;
    peekNextTrackIndexForDirection: (direction: -1 | 1) => number | undefined;
    queueGaplessNextTrack: (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]) => Promise<void>;
    refreshLyricsPanel: () => void;
    refreshCurrentTrackMetadata: () => Promise<void>;
    refreshNowPlayingLabel: () => void;
    rebuildImageFilePathIndex: () => void;
    rebuildTextFilePathIndex: () => void;
    rebuildTrackPathIndex: () => void;
    releaseDepthForTrack: (track: Pick<Track, 'rootPath' | 'releaseDepth'>) => number;
    resetShuffleHistory: () => void;
    scheduleNowPlayingCoverRefresh: () => void;
    setActiveReplayGainReleaseTrackPaths: (releasePaths?: string[]) => void;
    setCoverFlipped: (flipped: boolean) => void;
    shouldSkipLoadedTrack: () => Promise<boolean>;
    textFileIndexForPath: (path: string) => number;
    trackIndexForPath: (path: string) => number;
    trackPathKey: (path: string) => string;
    updateLyricsPanelVisibility: (measuredCardHeightPx?: number) => void;
    updateNowPlayingTechnicalLabels: () => void;
    updatePlayButton: () => void;
    updateTrackLabels: () => void;
    loadListenHistoryData: () => Promise<LoadedPlaylistData | null>;
    loadPlaylistData: (playlistPath: string) => Promise<LoadedPlaylistData | null>;
    savePlaylistTrackMetadataCache: (entries: PlaylistTrackMetadataCacheEntry[]) => Promise<boolean>;
    savePlaybackOrderSetting: () => Promise<void>;
    setPlaybackOrderMode: (mode: PlaybackOrderMode) => void;
    hasConfiguredLibraryFolders: () => boolean;
    loadLibraryScan: (scanResult: LibraryScanResult, options?: { autoSelectStartingTrack?: boolean; preserveFolderView?: boolean; currentFolderPath?: string }) => Promise<void>;
    scanConfiguredLibraryFolders: () => Promise<void>;
    handleLibraryScanUpdatedEvent: (scanResult: LibraryScanResult) => Promise<void>;
    updateLibraryLoadingEtaFromProgress: (progress: LibraryScanProgress) => void;
    openErrorModal: (title: string, message: string) => void;
    closeErrorModal: () => void;
    openQueueConfirmModal: (title: string, message: string) => Promise<boolean>;
    closeQueueConfirmModal: (confirmed: boolean) => void;
    openTextFileModal: (textFile: TextLibraryFile) => Promise<void>;
    closeTextFileModal: () => void;
    openMusicBrainzEntityForCurrentTrack: (entityType: MusicBrainzEntityType) => Promise<void>;
    closeMusicBrainzEntityModal: () => void;
    openTechnicalInfoModal: () => Promise<void>;
    closeTechnicalInfoModal: () => void;
    openAboutModal: () => void;
    closeAboutModal: () => void;
    openCoverImageModal: () => void;
    addSidebarSelectionToPlaylist: (...args: unknown[]) => Promise<void>;
    captureSidebarQueueSelectionContext: () => unknown;
    copyCurrentTrackFilePath: () => Promise<void>;
    copyCurrentTrackFolderPath: () => Promise<void>;
    handleDroppedFolderPath: (clientX: number, clientY: number, droppedFolderPath: string) => Promise<void>;
    logSendToFrontend: (message: string) => void;
    openCurrentTrackFolderInFileBrowser: () => Promise<void>;
    openCurrentTrackFolderInSidebar: () => void;
    openSidebarQueueItemInFileBrowser: () => Promise<void>;
    openPlayOrderMenu: (clientX: number, clientY: number) => void;
    closePlayOrderMenu: () => void;
    openSidebarQueueMenu: (...args: unknown[]) => void;
    openTrackMetaMenu: (clientX: number, clientY: number, includeCopyActions: boolean, actionScope: CustomSendToActionScope | null, actionKind: TrackMetaActionKind, actionPath: string, artistFilterQuery?: string, showArtistFilterAction?: boolean) => void;
    closeTrackMetaMenu: () => void;
    playDroppedTrackPath: (droppedTrackPath: string) => Promise<void>;
    playSidebarQueueSelection: (trackIndexes: number[]) => Promise<void>;
    resolveSidebarQueueTrackIndexesForAction: (...args: unknown[]) => Promise<number[]>;
    runCustomSendToAction: (action: CustomSendToAction, path: string) => Promise<void>;
    sendToActionsForScope: (scope: CustomSendToActionScope) => CustomSendToAction[];
    submitSidebarQueueFeedback: (trackIndex: number, score: ListenBrainzFeedbackScore) => Promise<void>;
    updatePlayOrderMenuState: () => void;
    dispatchExternalPlaybackAction: (action: ExternalPlaybackAction) => void;
    focusedShortcutBindingsUseCode: (code: string) => boolean;
    goToTrack: (direction: -1 | 1) => void;
    handleFocusedHardwareMediaKey: (event: KeyboardEvent) => boolean;
    handleFocusedKeyboardShortcut: (event: KeyboardEvent) => boolean;
    hideToTrayWhenMinimized: (remainingRetries?: number) => Promise<void>;
    initializeAppVersion: () => Promise<void>;
    initializeMediaSessionIntegration: () => void;
    loadTrack: (index: number, allowMissingTrackRecovery?: boolean, replayGainSequenceOverrideIndexes?: number[], manualTrackSelection?: boolean) => Promise<void>;
    pauseCurrentTrack: () => Promise<void>;
    playCurrentTrack: () => Promise<void>;
    refreshAvailableAudioOutputDevices: () => Promise<AudioOutputDevice[]>;
    resolveCoverForTrack: (track: Track) => Promise<string | undefined>;
    stopCurrentTrack: () => Promise<void>;
    toggleCurrentTrack: () => Promise<void>;
    unlockMediaSessionAnchorFromUserGesture: () => void;
    updateMediaSessionMetadata: () => void;
    updateMediaSessionPlaybackState: () => void;
    updateMediaSessionPositionState: () => void;
    completeStartupIfReady: () => Promise<void>;
    normalizeMusicBrainzTagWorkerProgress: (value: MusicBrainzTagWorkerProgress) => MusicBrainzTagWorkerProgress;
    toggleCoverFlipFromSecondaryInput: (event: MouseEvent | PointerEvent) => void;
    toggleCoverFlipFromContextMenu: (event: MouseEvent) => boolean;
    closeSidebarQueueMenu: () => void;
    hydrateCurrentTrackTag: (index: number, version: number) => Promise<void>;
    hydrateCurrentArtistInfo: (index: number) => Promise<void>;
    setBackgroundCover: (coverSrc?: string) => void;
};

export type AppRuntimePorts = SharedRuntimeMethods & ReturnedRuntimeMethods;

export interface AppRuntimeState {
    currentSettings: AppSettings;
    tracks: Track[];
    textFiles: TextLibraryFile[];
    imageFiles: ImageLibraryFile[];
    libraryControllerState: LibraryControllerState;
    playlistControllerState: PlaylistControllerState;
    settingsControllerState: SettingsControllerState;
    playbackSequencingState: PlaybackSequencingState;
    playbackSessionState: PlaybackSessionState;
    scrobbleSessionState: ScrobbleSessionState;
    currentTrackIndex: number;
    objectUrls: string[];
    tagRequestVersion: number;
    artistInfoRequestVersion: number;
    activeBackgroundLayer: number;
    coverFlipped: boolean;
    playbackPollHandle: number | undefined;
    musicBrainzEntityModalHideTimer: number | undefined;
    technicalInfoModalHideTimer: number | undefined;
    aboutModalHideTimer: number | undefined;
    errorModalHideTimer: number | undefined;
    isSeeking: boolean;
    playbackMutationVersion: number;
    playPauseToggleInFlight: boolean;
    trackNavigationChain: Promise<void>;
    gaplessQueueRequestVersion: number;
    queuedGaplessTrackPath: string;
    activeReplayGainReleaseTrackPaths: string[];
    replayGainReleaseDynamicRangeRequestVersion: number;
    availableAudioOutputDevices: AudioOutputDevice[];
    currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
    ffmpegConfigurationRequired: boolean;
    libraryTotalLoadEstimateMs: number;
    libraryClientFinalizeEstimateMs: number;
    activeLibraryLoadScanResolvedAtMs: number | null;
    fullLibraryScanLoadActive: boolean;
    suppressAutoSelectAfterFullLibraryScan: boolean;
    pendingNowPlayingCoverRefreshHandle: number | null;
    sidebarQueueTrackIndexes: number[];
    sidebarQueueFeedbackTrackIndex: number | null;
    sidebarQueueFolderPath: string;
    sidebarQueueFolderLabel: string;
    sidebarQueueFolderTarget: boolean;
    sidebarQueueTrackIndexesScopedToSelection: boolean;
    sidebarQueueFileActionPath: string;
    sidebarQueueIncludeFileActions: boolean;
    sidebarQueueSendToActionScope: CustomSendToActionScope | null;
    queueConfirmResolver: ((confirmed: boolean) => void) | null;
    trackMetaMenuTarget: HTMLElement | null;
    trackMetaMenuActionScope: CustomSendToActionScope | null;
    trackMetaMenuActionPath: string;
    trackMetaArtistFilterQuery: string;
    suppressCoverFrontClickUntil: number;
}

export interface AppRuntimeRefs {
    app: HTMLElement;
    window: Window;
    document: Document;
    shareElements: ShareElements;
    artistInfoElements: ArtistInfoElements;
    isWindowsRuntime: boolean;
    isMacRuntime: boolean;
    isLinuxRuntime: boolean;
    trackIndexByPath: Map<string, number>;
    textFileIndexByPath: Map<string, number>;
    imageFileIndexByPath: Map<string, number>;
    replayGainReleaseDynamicRangeLabelByKey: Map<string, string>;
    replayGainReleaseDynamicRangePendingByKey: Map<string, Promise<string>>;
    selectedLibraryRootLabel: string;
    libraryIndexedFilePageSize: number;
    sidebarQueueDescendantPromptThreshold: number;
    nowPlayingCoverRefreshDebounceMs: number;
    musicBrainzEntityModalTransitionMs: number;
    technicalInfoModalTransitionMs: number;
    aboutModalTransitionMs: number;
    errorModalTransitionMs: number;
    coverFront: HTMLElement;
    volumeBtn: HTMLButtonElement;
    cardResizeObserver: ResizeObserver;
}

export interface AppRuntimeControllerRefs {
    settingsControllerRef: SettingsController;
    playlistControllerRef: PlaylistController;
    playlistTargetModalControllerRef: PlaylistTargetModalController;
    artistInfoControllerRef: ArtistInfoController;
    imageModalControllerRef: ImageModalController;
    libraryControllerRef: LibraryController;
    shareControllerRef: ShareController;
}

export interface AppRuntimeServiceRefs {
    coverArtService: CoverArtService;
    playbackStateService: PlaybackStateService;
    playbackSequencingService: PlaybackSequencingService;
    scrobbleService: ScrobbleService;
    trackMetadataService: TrackMetadataService;
    visualizerController: VisualizerController;
    sidebarController: SidebarController;
    socialController: ListenBrainzSocialController;
    mediaSessionController: MediaSessionController;
}

export interface AppRuntimeScope extends AppShellElements, AppRuntimeState, AppRuntimeRefs, AppRuntimeControllerRefs, AppRuntimeServiceRefs, AppRuntimePorts {}
