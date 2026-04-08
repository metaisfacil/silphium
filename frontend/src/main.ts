import { setupExplorationButton } from './components/media-controls-exploration';
import './style.css';
import './app.css';
import './components/overlays/overlays.css';
import './components/overlays/exploration-modal.css';
import type { ArtistInfoController } from './controllers/artist-info-controller';
import type { ImageModalController } from './controllers/image-modal-controller';
import type { LibraryController } from './controllers/library-controller';
import type { PlaylistController } from './controllers/playlist-controller';
import type { PlaylistTargetModalController } from './controllers/playlist-target-modal-controller';
import type { ShareController } from './controllers/share-controller';
import type { SettingsController } from './controllers/settings-controller';
import { UI_TIMINGS_MS } from './constants/ui-timings';
import {
    ScanConfiguredLibraryFolders,
    AudioListOutputDevices,
    AppendTracksToPlaylistFile,
    GetMusicBrainzTagWorkerProgress,
    AudioQueueNextTrack,
    AudioGetVisualizationFrame,
    AudioSeek,
    AudioSetVolume,
    AudioStop,
    GetAppVersion,
    GetLibraryFolderPage,
    GetLastFmRequestToken,
    GetLastFmSessionKey,
    GetLibraryIndexedFilePage,
    ResolveLibraryFolderForPath,
    IsLibraryFolderImmediateDescendantsEnumerated,
    GetSettings,
    LogFrontendMessage,
    LookupArtistByMBID,
    ReadFileBase64,
    ReadImageThumbnail,
    SavePlaylistFile,
    SaveShareImageFile,
    SaveSettings,
    SearchLibrary,
    SelectLibraryFolder,
    SelectPlaylistFile,
    SelectPlaylistSaveFile,
    SelectShareImageSaveFile,
    ValidateFFmpegPath,
} from '../wailsjs/go/main/App';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import type {
    AppSettings,
    AudioOutputDevice,
    AudioPlaybackState,
    CustomSendToActionScope,
    FFmpegPathStatus,
    ImageLibraryFile,
    LibraryFolderPage,
    LibraryIndexedFilePage,
    LibraryScanResult,
    LibrarySearchPage,
    MusicBrainzTagWorkerProgress,
    PlaybackOrderMode,
    TextLibraryFile,
    Track,
} from './types/app-types';
import {
    asReleaseDepth,
    findLibraryFolderForFilePath,
} from './utils/main-helpers'; 
import { installHmrFullReset } from './utils/hmr-full-reset';
import { scheduleMusicBrainzRequest } from './utils/musicbrainz-request-scheduler';
import {
    defaultAppSettings,
    defaultMusicBrainzTagWorkerProgress,
    normalizeMusicBrainzTagWorkerProgress,
    normalizeAppSettings,
} from './utils/settings-normalization';
import { bindEventHandlersFromScope, setupControllersFromScope } from './app-bootstrap-setup';
import { createCoverFlipRuntime } from './app-cover-flip-runtime';
import { getAppShellElements, renderAppShell } from './app-shell';
import { createPlaybackOrderPlaylistRuntime } from './app-playback-order-playlist-runtime';
import {
    setupCoreServicesRuntime,
    setupLibraryLoadRuntime,
    setupModalRuntime,
    setupNowPlayingRuntime,
    setupPlaybackControlsRuntime,
    setupQueueMenuRuntime,
} from './app-runtime-setup';

const app = document.querySelector('#app') as HTMLElement | null;
const isWindowsRuntime = /windows/i.test(navigator.userAgent);
const isMacRuntime = /macintosh|mac os x/i.test(navigator.userAgent);
const isLinuxRuntime = /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent);

if (!app) {
    throw new Error('App container not found');
}

installHmrFullReset(import.meta);

renderAppShell(app);


setupExplorationButton(document, {
    getActiveTrack: () => (currentTrackIndex >= 0 && currentTrackIndex < tracks.length ? tracks[currentTrackIndex] : undefined),
});

let tracks: Track[] = [];
let textFiles: TextLibraryFile[] = [];
let imageFiles: ImageLibraryFile[] = [];
const trackIndexByPath = new Map<string, number>();
const textFileIndexByPath = new Map<string, number>();
const imageFileIndexByPath = new Map<string, number>();
let currentTrackIndex = -1;
let objectUrls: string[] = [];
let tagRequestVersion = 0;
let artistInfoRequestVersion = 0;
let activeBackgroundLayer = 0;
let coverFlipped = false;
let playbackPollHandle: number | undefined;
let musicBrainzEntityModalHideTimer: number | undefined;
let technicalInfoModalHideTimer: number | undefined;
let aboutModalHideTimer: number | undefined;
let errorModalHideTimer: number | undefined;
let isSeeking = false;
let playbackMutationVersion = 0;
let playPauseToggleInFlight = false;
let trackNavigationChain: Promise<void> = Promise.resolve();
let gaplessQueueRequestVersion = 0;
let queuedGaplessTrackPath = '';
let activeReplayGainReleaseTrackPaths: string[] = [];
const replayGainReleaseDynamicRangeLabelByKey = new Map<string, string>();
const replayGainReleaseDynamicRangePendingByKey = new Map<string, Promise<string>>();
let replayGainReleaseDynamicRangeRequestVersion = 0;
let availableAudioOutputDevices: AudioOutputDevice[] = [];
let currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress = { ...defaultMusicBrainzTagWorkerProgress };
let currentSettings: AppSettings = { ...defaultAppSettings };
let startupInitializationComplete = false;
let ffmpegConfigurationRequired = false;
let trackMetaMenuTarget: HTMLElement | null = null;
let trackMetaMenuActionScope: CustomSendToActionScope | null = null;
let trackMetaMenuActionPath = '';
let sidebarQueueTrackIndexes: number[] = [];
let sidebarQueueFeedbackTrackIndex: number | null = null;
let sidebarQueueFolderPath = '';
let sidebarQueueFolderLabel = '';
let sidebarQueueFolderTarget = false;
let sidebarQueueTrackIndexesScopedToSelection = false;
let sidebarQueueFileActionPath = '';
let sidebarQueueIncludeFileActions = false;
let sidebarQueueSendToActionScope: CustomSendToActionScope | null = null;
let queueConfirmResolver: ((confirmed: boolean) => void) | null = null;
const musicBrainzEntityModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const technicalInfoModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const aboutModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const errorModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const sidebarQueueDescendantPromptThreshold = 200;
const selectedLibraryRootLabel = 'Selected folders';

const applyUiDitheringSetting = (): void => {
    app.classList.toggle('ui-dithering-disabled', currentSettings.uiDitheringEnabled === false);
};

const validateConfiguredFFmpegPath = async (ffmpegPath: string): Promise<FFmpegPathStatus> => await ValidateFFmpegPath(ffmpegPath) as FFmpegPathStatus;

const missingFFmpegMessage = (status: FFmpegPathStatus): string => {
    if (status.message && status.message.trim() !== '') {
        return `${status.message.trim()}. Open Settings and save a valid ffmpeg executable path before continuing.`;
    }

    return 'FFmpeg was not found. Open Settings and save a valid ffmpeg executable path before continuing.';
};

const promptForMissingFFmpeg = (status: FFmpegPathStatus): void => {
    ffmpegConfigurationRequired = true;
    playbackStateService.setBackendReady(false);
    libraryController.renderFolder('none');
    openErrorModal('FFmpeg Required', missingFFmpegMessage(status));
    settingsController.open('general');
};

const completeStartupIfReady = async (): Promise<void> => {
    if (startupInitializationComplete) {
        return;
    }

    const ffmpegStatus = await validateConfiguredFFmpegPath(currentSettings.ffmpegPath);
    if (!ffmpegStatus.available) {
        promptForMissingFFmpeg(ffmpegStatus);
        return;
    }

    ffmpegConfigurationRequired = false;
    await initializeBackendPlayback();

    if (currentSettings.libraryFolders.length > 0) {
        await scanConfiguredLibraryFolders();
    } else {
        libraryController.renderFolder('none');
    }

    startupInitializationComplete = true;
    void refreshListenBrainzFeedbackForCurrentTrack(true);
};

const LIBRARY_CLIENT_FINALIZE_MS_KEY = 'libraryClientFinalizeEstimateMs';

const shell = getAppShellElements(document);
const { coverFrame } = shell;
let settingsController: SettingsController;
let playlistController: PlaylistController;
let playlistTargetModalController: PlaylistTargetModalController;
let artistInfoController: ArtistInfoController;
let imageModalController: ImageModalController;
let libraryController: LibraryController;
let shareController: ShareController;
let libraryClientFinalizeEstimateMs = parseFloat(localStorage.getItem(LIBRARY_CLIENT_FINALIZE_MS_KEY) ?? '') || 0;
let activeLibraryLoadScanResolvedAtMs: number | null = null;
let fullLibraryScanLoadActive = false;
let suppressAutoSelectAfterFullLibraryScan = false;
const libraryIndexedFilePageSize = 1000;
const libraryIncrementalRefreshDebounceMs = 180;
let pendingLibraryIncrementalRefreshHandle: number | null = null;
const nowPlayingCoverRefreshDebounceMs = 220;
let pendingNowPlayingCoverRefreshHandle: number | null = null;

const beginLibraryLoadTracking = (): void => {
    activeLibraryLoadScanResolvedAtMs = null;
};

const markLibraryScanResolved = (): void => {
    activeLibraryLoadScanResolvedAtMs = performance.now();
};

const finishLibraryLoadTracking = (): void => {
    if (activeLibraryLoadScanResolvedAtMs === null) {
        return;
    }

    const clientFinalizeMs = Math.max(0, performance.now() - activeLibraryLoadScanResolvedAtMs);
    activeLibraryLoadScanResolvedAtMs = null;
    if (!Number.isFinite(clientFinalizeMs) || clientFinalizeMs <= 0) {
        return;
    }

    if (libraryClientFinalizeEstimateMs <= 0) {
        libraryClientFinalizeEstimateMs = clientFinalizeMs;
    } else {
        libraryClientFinalizeEstimateMs = (libraryClientFinalizeEstimateMs * 0.7) + (clientFinalizeMs * 0.3);
    }

    localStorage.setItem(LIBRARY_CLIENT_FINALIZE_MS_KEY, String(libraryClientFinalizeEstimateMs));
};

const scheduleLibraryIncrementalFolderRefresh = (): void => {
    if (pendingLibraryIncrementalRefreshHandle !== null) {
        return;
    }

    pendingLibraryIncrementalRefreshHandle = window.setTimeout(() => {
        pendingLibraryIncrementalRefreshHandle = null;
        const currentFolderPath = libraryController.getCurrentFolderPath();
        logRescan('Refreshing current folder: %s', currentFolderPath || '(root)');
        libraryController.refreshCurrentFolder();
    }, libraryIncrementalRefreshDebounceMs);
};

const releaseDepthForTrack = (track: Pick<Track, 'rootPath'>): number => {
    const folder = findLibraryFolderForFilePath(track.rootPath || '', currentSettings.libraryFolders);
    return folder ? asReleaseDepth(folder.releaseDepth) : 0;
};

const createScopeAccessor = <T>(getter: () => T, setter?: (value: T) => void) => (
    setter
        ? { configurable: true, enumerable: true, get: getter, set: setter }
        : { configurable: true, enumerable: true, get: getter }
);

const runtimeScope = Object.create(shell, {
    currentSettings: createScopeAccessor(() => currentSettings, (value) => {
        currentSettings = value;
    }),
    tracks: createScopeAccessor(() => tracks, (value) => {
        tracks = value;
    }),
    textFiles: createScopeAccessor(() => textFiles, (value) => {
        textFiles = value;
    }),
    imageFiles: createScopeAccessor(() => imageFiles, (value) => {
        imageFiles = value;
    }),
    currentTrackIndex: createScopeAccessor(() => currentTrackIndex, (value) => {
        currentTrackIndex = value;
    }),
    objectUrls: createScopeAccessor(() => objectUrls, (value) => { objectUrls = value; }),
    tagRequestVersion: createScopeAccessor(() => tagRequestVersion, (value) => { tagRequestVersion = value; }),
    artistInfoRequestVersion: createScopeAccessor(() => artistInfoRequestVersion, (value) => { artistInfoRequestVersion = value; }),
    activeBackgroundLayer: createScopeAccessor(() => activeBackgroundLayer, (value) => { activeBackgroundLayer = value; }),
    coverFlipped: createScopeAccessor(() => coverFlipped, (value) => { coverFlipped = value; }),
    playbackPollHandle: createScopeAccessor(() => playbackPollHandle, (value) => { playbackPollHandle = value; }),
    musicBrainzEntityModalHideTimer: createScopeAccessor(() => musicBrainzEntityModalHideTimer, (value) => { musicBrainzEntityModalHideTimer = value; }),
    technicalInfoModalHideTimer: createScopeAccessor(() => technicalInfoModalHideTimer, (value) => { technicalInfoModalHideTimer = value; }),
    aboutModalHideTimer: createScopeAccessor(() => aboutModalHideTimer, (value) => { aboutModalHideTimer = value; }),
    errorModalHideTimer: createScopeAccessor(() => errorModalHideTimer, (value) => { errorModalHideTimer = value; }),
    isSeeking: createScopeAccessor(() => isSeeking, (value) => { isSeeking = value; }),
    playbackMutationVersion: createScopeAccessor(() => playbackMutationVersion, (value) => { playbackMutationVersion = value; }),
    playPauseToggleInFlight: createScopeAccessor(() => playPauseToggleInFlight, (value) => { playPauseToggleInFlight = value; }),
    trackNavigationChain: createScopeAccessor(() => trackNavigationChain, (value) => { trackNavigationChain = value; }),
    gaplessQueueRequestVersion: createScopeAccessor(() => gaplessQueueRequestVersion, (value) => { gaplessQueueRequestVersion = value; }),
    queuedGaplessTrackPath: createScopeAccessor(() => queuedGaplessTrackPath, (value) => { queuedGaplessTrackPath = value; }),
    activeReplayGainReleaseTrackPaths: createScopeAccessor(() => activeReplayGainReleaseTrackPaths, (value) => { activeReplayGainReleaseTrackPaths = value; }),
    replayGainReleaseDynamicRangeRequestVersion: createScopeAccessor(() => replayGainReleaseDynamicRangeRequestVersion, (value) => { replayGainReleaseDynamicRangeRequestVersion = value; }),
    availableAudioOutputDevices: createScopeAccessor(() => availableAudioOutputDevices, (value) => { availableAudioOutputDevices = value; }),
    currentMusicBrainzTagWorkerProgress: createScopeAccessor(() => currentMusicBrainzTagWorkerProgress, (value) => { currentMusicBrainzTagWorkerProgress = value; }),
    ffmpegConfigurationRequired: createScopeAccessor(() => ffmpegConfigurationRequired, (value) => { ffmpegConfigurationRequired = value; }),
    libraryClientFinalizeEstimateMs: createScopeAccessor(() => libraryClientFinalizeEstimateMs, (value) => { libraryClientFinalizeEstimateMs = value; }),
    activeLibraryLoadScanResolvedAtMs: createScopeAccessor(() => activeLibraryLoadScanResolvedAtMs, (value) => { activeLibraryLoadScanResolvedAtMs = value; }),
    fullLibraryScanLoadActive: createScopeAccessor(() => fullLibraryScanLoadActive, (value) => { fullLibraryScanLoadActive = value; }),
    suppressAutoSelectAfterFullLibraryScan: createScopeAccessor(() => suppressAutoSelectAfterFullLibraryScan, (value) => { suppressAutoSelectAfterFullLibraryScan = value; }),
    pendingNowPlayingCoverRefreshHandle: createScopeAccessor(() => pendingNowPlayingCoverRefreshHandle, (value) => { pendingNowPlayingCoverRefreshHandle = value; }),
    sidebarQueueTrackIndexes: createScopeAccessor(() => sidebarQueueTrackIndexes, (value) => { sidebarQueueTrackIndexes = value; }),
    sidebarQueueFeedbackTrackIndex: createScopeAccessor(() => sidebarQueueFeedbackTrackIndex, (value) => { sidebarQueueFeedbackTrackIndex = value; }),
    sidebarQueueFolderPath: createScopeAccessor(() => sidebarQueueFolderPath, (value) => { sidebarQueueFolderPath = value; }),
    sidebarQueueFolderLabel: createScopeAccessor(() => sidebarQueueFolderLabel, (value) => { sidebarQueueFolderLabel = value; }),
    sidebarQueueFolderTarget: createScopeAccessor(() => sidebarQueueFolderTarget, (value) => { sidebarQueueFolderTarget = value; }),
    sidebarQueueTrackIndexesScopedToSelection: createScopeAccessor(() => sidebarQueueTrackIndexesScopedToSelection, (value) => { sidebarQueueTrackIndexesScopedToSelection = value; }),
    sidebarQueueFileActionPath: createScopeAccessor(() => sidebarQueueFileActionPath, (value) => { sidebarQueueFileActionPath = value; }),
    sidebarQueueIncludeFileActions: createScopeAccessor(() => sidebarQueueIncludeFileActions, (value) => { sidebarQueueIncludeFileActions = value; }),
    sidebarQueueSendToActionScope: createScopeAccessor(() => sidebarQueueSendToActionScope, (value) => { sidebarQueueSendToActionScope = value; }),
    queueConfirmResolver: createScopeAccessor(() => queueConfirmResolver, (value) => { queueConfirmResolver = value; }),
    trackMetaMenuTarget: createScopeAccessor(() => trackMetaMenuTarget, (value) => { trackMetaMenuTarget = value; }),
    trackMetaMenuActionScope: createScopeAccessor(() => trackMetaMenuActionScope, (value) => { trackMetaMenuActionScope = value; }),
    trackMetaMenuActionPath: createScopeAccessor(() => trackMetaMenuActionPath, (value) => { trackMetaMenuActionPath = value; }),
    settingsControllerRef: createScopeAccessor(() => settingsController),
    playlistControllerRef: createScopeAccessor(() => playlistController),
    playlistTargetModalControllerRef: createScopeAccessor(() => playlistTargetModalController),
    artistInfoControllerRef: createScopeAccessor(() => artistInfoController),
    imageModalControllerRef: createScopeAccessor(() => imageModalController),
    libraryControllerRef: createScopeAccessor(() => libraryController),
    shareControllerRef: createScopeAccessor(() => shareController),
});

Object.assign(runtimeScope, {
    app,
    window,
    document,
    isWindowsRuntime,
    isMacRuntime,
    isLinuxRuntime,
    trackIndexByPath,
    textFileIndexByPath,
    imageFileIndexByPath,
    replayGainReleaseDynamicRangeLabelByKey,
    replayGainReleaseDynamicRangePendingByKey,
    selectedLibraryRootLabel,
    libraryIndexedFilePageSize,
    sidebarQueueDescendantPromptThreshold,
    nowPlayingCoverRefreshDebounceMs,
    musicBrainzEntityModalTransitionMs,
    technicalInfoModalTransitionMs,
    aboutModalTransitionMs,
    errorModalTransitionMs,
    validateConfiguredFFmpegPath,
    missingFFmpegMessage,
    applyUiDitheringSetting,
    beginLibraryLoadTracking,
    markLibraryScanResolved,
    finishLibraryLoadTracking,
    scheduleLibraryIncrementalFolderRefresh,
    shareElements: {
        shareModal: shell.shareModal,
        shareBackdrop: shell.shareBackdrop,
        shareDialog: shell.shareDialog,
        shareClose: shell.shareClose,
        sharePreview: shell.sharePreview,
        shareCommentInput: shell.shareCommentInput,
        shareStatus: shell.shareStatus,
        shareSave: shell.shareSave,
        shareCopy: shell.shareCopy,
    },
    artistInfoElements: {
        artistInfoName: shell.artistInfoName,
        artistInfoType: shell.artistInfoType,
        artistInfoCountry: shell.artistInfoCountry,
        artistInfoLifeSpan: shell.artistInfoLifeSpan,
        artistInfoGenres: shell.artistInfoGenres,
        artistInfoSummary: shell.artistInfoSummary,
        artistInfoLinks: shell.artistInfoLinks,
    },
    saveSettingsBackend: async (settings: unknown): Promise<AppSettings> => await SaveSettings(settings as Parameters<typeof SaveSettings>[0]) as unknown as AppSettings,
    scanConfiguredLibraryFoldersBackend: async (): Promise<LibraryScanResult> => await ScanConfiguredLibraryFolders() as LibraryScanResult,
    audioStop: async (): Promise<AudioPlaybackState> => await AudioStop() as AudioPlaybackState,
    listAudioOutputDevices: async (): Promise<AudioOutputDevice[]> => await AudioListOutputDevices() as AudioOutputDevice[],
    getSettings: async (): Promise<AppSettings> => await GetSettings() as unknown as AppSettings,
    getMusicBrainzTagWorkerProgress: async (): Promise<MusicBrainzTagWorkerProgress> => await GetMusicBrainzTagWorkerProgress() as MusicBrainzTagWorkerProgress,
    getAppVersion: async (): Promise<string> => await GetAppVersion(),
    loadIndexedFilePage: async (kind: string, offset: number, limit: number): Promise<LibraryIndexedFilePage> => await GetLibraryIndexedFilePage(kind, offset, limit) as LibraryIndexedFilePage,
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => SavePlaylistFile(playlistPath, trackPaths),
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => AppendTracksToPlaylistFile(playlistPath, trackPaths),
    audioQueueNextTrack: async (currentPath: string, nextPath: string) => await AudioQueueNextTrack(currentPath, nextPath),
    getLastFmRequestToken: async (apiKey: string, apiSecret: string): Promise<string> => await GetLastFmRequestToken(apiKey, apiSecret) as string,
    getLastFmSessionKey: async (apiKey: string, apiSecret: string, requestToken: string): Promise<string> => await GetLastFmSessionKey(apiKey, apiSecret, requestToken) as string,
    browserOpenUrl: BrowserOpenURL,
    selectLibraryFolder: SelectLibraryFolder,
    selectPlaylistFile: SelectPlaylistFile,
    selectPlaylistSaveFile: SelectPlaylistSaveFile,
    selectShareImageSaveFile: SelectShareImageSaveFile,
    saveShareImageFile: SaveShareImageFile,
    readFileBase64: ReadFileBase64,
    readImageThumbnail: ReadImageThumbnail,
    loadFolderPage: async (folderPath: string, offset: number, limit: number): Promise<LibraryFolderPage> => await GetLibraryFolderPage(folderPath, offset, limit) as LibraryFolderPage,
    resolveLibraryFolderForAbsolutePath: async (path: string): Promise<string> => await ResolveLibraryFolderForPath(path),
    isFolderImmediateDescendantsEnumerated: async (folderPath: string): Promise<boolean> => await IsLibraryFolderImmediateDescendantsEnumerated(folderPath),
    searchLibrary: async (query: string, offset: number, limit: number): Promise<LibrarySearchPage> => await SearchLibrary(query, offset, limit) as LibrarySearchPage,
    fetchVisualizationFrame: async (frameCount: number) => await AudioGetVisualizationFrame(frameCount),
});

Object.assign(runtimeScope, setupCoreServicesRuntime(Object.assign(Object.create(runtimeScope), {
    releaseDepthForTrack: (track: Pick<Track, 'rootPath'>) => releaseDepthForTrack(track),
    closePlayOrderMenu: () => {
        runtimeScope.closePlayOrderMenu();
    },
    closeTrackMetaMenu: () => {
        runtimeScope.closeTrackMetaMenu();
    },
    closeSidebarQueueMenu: () => {
        runtimeScope.closeSidebarQueueMenu();
    },
    openMusicBrainzEntityForCurrentTrack: async (entityType: 'recording' | 'release' | 'label' | 'artist') => {
        await runtimeScope.openMusicBrainzEntityForCurrentTrack(entityType);
    },
    setTrackMetaMenuTarget: (value: HTMLElement) => {
        runtimeScope.trackMetaMenuTarget = value;
    },
    openTrackMetaMenu: (
        clientX: number,
        clientY: number,
        includeCopyActions: boolean,
        actionScope: CustomSendToActionScope,
        actionKind: 'track' | 'album' | null,
        actionPath: string,
    ) => {
        runtimeScope.openTrackMetaMenu(clientX, clientY, includeCopyActions, actionScope, actionKind, actionPath);
    },
})));

const {
    applyPlayerCardLayout,
    defaultMusicBrainzServerUrl,
    visualizerController,
    socialController,
    playbackSequencingService,
    playbackStateService,
    refreshListenBrainzFeedbackForCurrentTrack,
    resetListenBrainzFeedbackState,
    getStoredLayout,
} = runtimeScope;

Object.assign(runtimeScope, setupNowPlayingRuntime(Object.assign(Object.create(runtimeScope), {
    resolveCoverForTrack: async (track: Track) => await runtimeScope.resolveCoverForTrack(track),
    goToTrack: (direction: -1 | 1) => {
        runtimeScope.goToTrack(direction);
    },
    updateMediaSessionMetadata: () => {
        runtimeScope.updateMediaSessionMetadata();
    },
    updateMediaSessionPlaybackState: () => {
        runtimeScope.updateMediaSessionPlaybackState();
    },
    updateMediaSessionPositionState: () => {
        runtimeScope.updateMediaSessionPositionState();
    },
})));

const {
    initializeBackendPlayback,
    refreshLyricsPanel,
    rebuildTrackPathIndex,
    setCoverFlipped,
    updateLyricsPanelVisibility,
    updatePlayButton,
    updateTrackLabels,
} = runtimeScope;
Object.assign(runtimeScope, setupQueueMenuRuntime(Object.assign(Object.create(runtimeScope), {
    closeListenBrainzFeedbackMenu: () => {
        runtimeScope.closeListenBrainzFeedbackMenu();
    },
    ensureTrackTagsResolved: async (index: number) => {
        await runtimeScope.ensureTrackTagsResolved(index);
    },
    openErrorModal: (title: string, message: string) => {
        runtimeScope.openErrorModal(title, message);
    },
    logFrontendMessage: LogFrontendMessage,
    loadTrack: async (
        index: number,
        allowMissingTrackRecovery = true,
        replayGainSequenceOverrideIndexes?: number[],
        manualTrackSelection = false,
    ) => {
        await runtimeScope.loadTrack(index, allowMissingTrackRecovery, replayGainSequenceOverrideIndexes, manualTrackSelection);
    },
    queueGaplessNextTrack: async (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]) => {
        await runtimeScope.queueGaplessNextTrack(stateOverride, sequenceOverrideIndexes);
    },
    playCurrentTrack: async () => {
        await runtimeScope.playCurrentTrack();
    },
})));

const {
    updatePlayOrderMenuState,
} = runtimeScope;

Object.assign(runtimeScope, setupModalRuntime(runtimeScope));

const {
    openErrorModal,
} = runtimeScope;

const {
    loadPlaylistData,
    savePlaybackOrderSetting,
    setPlaybackOrderMode,
} = createPlaybackOrderPlaylistRuntime({
    get currentSettings() {
        return currentSettings;
    },
    set currentSettings(value) {
        currentSettings = value;
    },
    get tracks() {
        return tracks;
    },
    set tracks(value) {
        tracks = value;
    },
    get playlistController() {
        return playlistController;
    },
    playbackSequencingService,
    updatePlayOrderMenuState,
    visualizerController,
    applyUiDitheringSetting,
    rebuildTrackPathIndex,
});

Object.assign(runtimeScope, {
    loadPlaylistData,
    savePlaybackOrderSetting,
    setPlaybackOrderMode,
});

Object.assign(runtimeScope, setupLibraryLoadRuntime(Object.assign(Object.create(runtimeScope), {
    closeMusicBrainzEntityModal: () => {
        runtimeScope.closeMusicBrainzEntityModal();
    },
    closeTechnicalInfoModal: () => {
        runtimeScope.closeTechnicalInfoModal();
    },
    updateMediaSessionMetadata: () => {
        runtimeScope.updateMediaSessionMetadata();
    },
    loadTrack: async (index: number) => await runtimeScope.loadTrack(index),
    setPlaybackOrderMode: (mode: PlaybackOrderMode) => {
        setPlaybackOrderMode(mode);
    },
    completeStartupIfReady: async () => {
        await completeStartupIfReady();
    },
    logRescan: (message: string, ...args: unknown[]) => {
        logRescan(message, ...args);
    },
})));

const {
    scanConfiguredLibraryFolders,
} = runtimeScope;

Object.assign(runtimeScope, setupPlaybackControlsRuntime(runtimeScope));

const {
    initializeAppVersion,
    initializeMediaSessionIntegration,
    refreshAvailableAudioOutputDevices,
} = runtimeScope;

const initializeSettings = async (): Promise<void> => {
    applyPlayerCardLayout(getStoredLayout());
    resetListenBrainzFeedbackState();

    try {
        await refreshAvailableAudioOutputDevices();

        const settings = await GetSettings() as unknown as AppSettings;
        currentSettings = normalizeAppSettings(settings);
        visualizerController.setMode(currentSettings.visualizerMode);
        visualizerController.setEqualizerPosition(currentSettings.equalizerPosition);
        visualizerController.setEnabled(currentSettings.lissajousEnabled);
        applyUiDitheringSetting();
        socialController.handleSettingsChanged();
        currentMusicBrainzTagWorkerProgress = normalizeMusicBrainzTagWorkerProgress(
            await GetMusicBrainzTagWorkerProgress() as MusicBrainzTagWorkerProgress,
        );
        settingsController.setMusicBrainzTagWorkerProgress(currentMusicBrainzTagWorkerProgress);
        setPlaybackOrderMode(currentSettings.playbackOrder);
        await completeStartupIfReady();
        return;
    } catch (error) {
        console.error(error);
    }

    libraryController.renderFolder('none');
    void refreshListenBrainzFeedbackForCurrentTrack(true);
};

Object.assign(runtimeScope, {
    completeStartupIfReady,
    initializeSettings,
});

Object.assign(runtimeScope, {
    lookupArtistByMBID: (mbid: string) => scheduleMusicBrainzRequest(async () => (
        await LookupArtistByMBID(mbid)
    ), {
        server: currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl,
        path: `/ws/2/artist/${mbid}?fmt=json&inc=genres+tags+url-rels`,
    }),
});

({
    settingsController,
    playlistController,
    playlistTargetModalController,
    shareController,
    imageModalController,
    artistInfoController,
    libraryController,
} = setupControllersFromScope(runtimeScope));

const coverFront = coverFrame.querySelector('.cover-front') as HTMLElement;
const coverFlipRuntime = createCoverFlipRuntime({
    coverFrame,
    get coverFlipped() {
        return coverFlipped;
    },
    setCoverFlipped,
});

const {
    logRescan,
    toggleCoverFlipFromContextMenu,
    toggleCoverFlipFromSecondaryInput,
} = coverFlipRuntime;

const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
const cardResizeObserver = new ResizeObserver(() => {
    updateLyricsPanelVisibility();
});

Object.defineProperty(runtimeScope, 'suppressCoverFrontClickUntil', createScopeAccessor(() => coverFlipRuntime.suppressCoverFrontClickUntil));
Object.assign(runtimeScope, {
    coverFront,
    volumeBtn,
    cardResizeObserver,
    logRescan,
    toggleCoverFlipFromSecondaryInput,
    toggleCoverFlipFromContextMenu,
    audioSeek: async (seconds: number) => await AudioSeek(seconds) as AudioPlaybackState,
    audioSetVolume: async (volumeValue: number) => await AudioSetVolume(volumeValue) as AudioPlaybackState,
});

bindEventHandlersFromScope(runtimeScope);

updatePlayButton();
updateTrackLabels();
updatePlayOrderMenuState();
libraryController.refreshSidebarToggleState();
refreshLyricsPanel();
resetListenBrainzFeedbackState();
initializeMediaSessionIntegration();
void initializeSettings();
void initializeAppVersion();
