import { setupExplorationButton } from './components/media-controls-exploration';
import { setLibraryShareConnectionsIndicator } from './components/sidebar';
import './style.css';
import './app.css';
import './components/overlays/overlays.css';
import './components/overlays/exploration-modal.css';
import { UI_TIMINGS_MS } from './constants/ui-timings';
import {
    ScanConfiguredLibraryFolders,
    AudioListOutputDevices,
    AudioReinitializeBackend,
    AppendTracksToPlaylistFile,
    CopyShareImageToClipboard,
    GetMusicBrainzTagWorkerProgress,
    AudioQueueNextTrack,
    AudioGetVisualizationFrame,
    AudioSeek,
    AudioSetVolume,
    AudioStop,
    GetAppVersion,
    GetLibraryFolderPageSorted,
    GetLastFmRequestToken,
    GetLastFmSessionKey,
    GetLibraryIndexedFilePage,
    ResolveLibraryFolderForPath,
    IsLibraryFolderImmediateDescendantsEnumerated,
    GetSettings,
    LogFrontendMessage,
    LookupArtistByMBID,
    LookupMusicBrainzRecordingURLs,
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
import { createAppState, type AppState } from './app-state';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import type {
    AppSettings,
    AudioOutputDevice,
    AudioPlaybackState,
    CustomSendToActionScope,
    FFmpegPathStatus,
    LibraryFolderPage,
    LibraryIndexedFilePage,
    LibraryScanResult,
    LibrarySearchPage,
    MusicBrainzTagWorkerProgress,
    PlaybackOrderMode,
    Track,
} from './types/app-types';
import {
    asReleaseDepth,
    findLibraryFolderForTrack,
    formatTime,
} from './utils/main-helpers'; 
import { installHmrFullReset } from './utils/hmr-full-reset';
import { scheduleMusicBrainzRequest } from './utils/musicbrainz-request-scheduler';
import { installProfilingAgent } from './services/profiling-agent';
import {
    normalizeMusicBrainzTagWorkerProgress,
    normalizeAppSettings,
} from './utils/settings-normalization';
import {
    summarizeAudioOutputDevicesForBridge,
    summarizeAudioPlaybackStateForBridge,
    summarizeLibraryFolderPageForBridge,
    summarizeLibraryIndexedFilePageForBridge,
    summarizeLibraryScanResultForBridge,
    summarizeLibrarySearchPageForBridge,
    traceBridgeCall,
} from './utils/bridge-trace';
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
installProfilingAgent();

renderAppShell(app);

const state = createAppState();
const runtimeControllerRefs = {} as ReturnType<typeof setupControllersFromScope>;
let openExplorationLibrarySearch: ((query: string, options?: { expandFilteredFolders?: boolean }) => void) | null = null;

setupExplorationButton(document, {
    getActiveTrack: () => (
        state.currentTrackIndex >= 0 && state.currentTrackIndex < state.tracks.length
            ? state.tracks[state.currentTrackIndex]
            : undefined
    ),
    openLibrarySearch: (query: string, options?: { expandFilteredFolders?: boolean }) => {
        openExplorationLibrarySearch?.(query, options);
    },
});

const musicBrainzEntityModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const technicalInfoModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const aboutModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const errorModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const sidebarQueueDescendantPromptThreshold = 200;
const selectedLibraryRootLabel = 'Selected folders';

const applyUiDitheringSetting = (): void => {
    app.classList.toggle('ui-dithering-disabled', state.currentSettings.uiDitheringEnabled === false);
};

const validateConfiguredFFmpegPath = async (ffmpegPath: string): Promise<FFmpegPathStatus> => await ValidateFFmpegPath(ffmpegPath) as FFmpegPathStatus;

const missingFFmpegMessage = (status: FFmpegPathStatus): string => {
    if (status.message && status.message.trim() !== '') {
        return `${status.message.trim()}. Open Settings and save a valid ffmpeg executable path before continuing.`;
    }

    return 'FFmpeg was not found. Open Settings and save a valid ffmpeg executable path before continuing.';
};

const promptForMissingFFmpeg = (status: FFmpegPathStatus): void => {
    state.ffmpegConfigurationRequired = true;
    playbackStateService.setBackendReady(false);
    runtimeControllerRefs.libraryController.renderFolder('none');
    openErrorModal('FFmpeg Required', missingFFmpegMessage(status));
    runtimeControllerRefs.settingsController.open('general');
};

const completeStartupIfReady = async (): Promise<void> => {
    if (state.startupInitializationComplete) {
        return;
    }

    const ffmpegStatus = await validateConfiguredFFmpegPath(state.currentSettings.ffmpegPath);
    if (!ffmpegStatus.available) {
        promptForMissingFFmpeg(ffmpegStatus);
        return;
    }

    state.ffmpegConfigurationRequired = false;
    await initializeBackendPlayback();

    if (state.currentSettings.libraryFolders.length > 0) {
        await scanConfiguredLibraryFolders();
    } else {
        runtimeControllerRefs.libraryController.renderFolder('none');
    }

    state.startupInitializationComplete = true;
    void refreshListenBrainzFeedbackForCurrentTrack(true);
};

const LIBRARY_CLIENT_FINALIZE_MS_KEY = 'libraryClientFinalizeEstimateMs';
const LIBRARY_TOTAL_LOAD_MS_KEY = 'libraryTotalLoadEstimateMs';

const shell = getAppShellElements(document);
const { coverFrame, playerTaskbar } = shell;
setLibraryShareConnectionsIndicator(shell.libraryShareConnectionsIndicator, 0);
const storedLibraryClientFinalizeEstimateMs = parseFloat(localStorage.getItem(LIBRARY_CLIENT_FINALIZE_MS_KEY) ?? '') || 0;
const storedLibraryTotalLoadEstimateMs = parseFloat(localStorage.getItem(LIBRARY_TOTAL_LOAD_MS_KEY) ?? '') || 0;
state.libraryClientFinalizeEstimateMs = storedLibraryClientFinalizeEstimateMs;
state.libraryTotalLoadEstimateMs = storedLibraryTotalLoadEstimateMs > 0
    ? storedLibraryTotalLoadEstimateMs
    : (storedLibraryClientFinalizeEstimateMs > 0
        ? Math.max(storedLibraryClientFinalizeEstimateMs * 5, 20_000)
        : 0);
let activeLibraryLoadStartedAtMs: number | null = null;
let activeLibraryLoadResolved = false;
const libraryIndexedFilePageSize = 5000;
const libraryIncrementalRefreshDebounceMs = 180;
const nowPlayingCoverRefreshDebounceMs = 220;

const beginLibraryLoadTracking = (): void => {
    activeLibraryLoadStartedAtMs = performance.now();
    activeLibraryLoadResolved = false;
    state.activeLibraryLoadScanResolvedAtMs = null;
};

const markLibraryScanResolved = (): void => {
    activeLibraryLoadResolved = true;
    state.activeLibraryLoadScanResolvedAtMs = performance.now();
};

const finishLibraryLoadTracking = (): void => {
    const finishedAtMs = performance.now();
    if (activeLibraryLoadStartedAtMs !== null && activeLibraryLoadResolved) {
        const totalLoadMs = Math.max(0, finishedAtMs - activeLibraryLoadStartedAtMs);
        if (Number.isFinite(totalLoadMs) && totalLoadMs > 0) {
            if (state.libraryTotalLoadEstimateMs <= 0) {
                state.libraryTotalLoadEstimateMs = totalLoadMs;
            } else {
                state.libraryTotalLoadEstimateMs = (state.libraryTotalLoadEstimateMs * 0.7) + (totalLoadMs * 0.3);
            }

            localStorage.setItem(LIBRARY_TOTAL_LOAD_MS_KEY, String(state.libraryTotalLoadEstimateMs));
        }
    }

    activeLibraryLoadStartedAtMs = null;
    activeLibraryLoadResolved = false;

    if (state.activeLibraryLoadScanResolvedAtMs === null) {
        return;
    }

    const clientFinalizeMs = Math.max(0, finishedAtMs - state.activeLibraryLoadScanResolvedAtMs);
    state.activeLibraryLoadScanResolvedAtMs = null;
    if (!Number.isFinite(clientFinalizeMs) || clientFinalizeMs <= 0) {
        return;
    }

    if (state.libraryClientFinalizeEstimateMs <= 0) {
        state.libraryClientFinalizeEstimateMs = clientFinalizeMs;
    } else {
        state.libraryClientFinalizeEstimateMs = (state.libraryClientFinalizeEstimateMs * 0.7) + (clientFinalizeMs * 0.3);
    }

    localStorage.setItem(LIBRARY_CLIENT_FINALIZE_MS_KEY, String(state.libraryClientFinalizeEstimateMs));
};

const scheduleLibraryIncrementalFolderRefresh = (): void => {
    if (state.pendingLibraryIncrementalRefreshHandle !== null) {
        return;
    }

    state.pendingLibraryIncrementalRefreshHandle = window.setTimeout(() => {
        state.pendingLibraryIncrementalRefreshHandle = null;
        const currentFolderPath = runtimeControllerRefs.libraryController.getCurrentFolderPath();
        logRescan('Refreshing current folder: %s', currentFolderPath || '(root)');
        runtimeControllerRefs.libraryController.refreshCurrentFolder();
    }, libraryIncrementalRefreshDebounceMs);
};

const releaseDepthForTrack = (track: Pick<Track, 'rootPath' | 'releaseDepth'> & { path?: string }): number => {
    if (typeof track.releaseDepth === 'number' && Number.isFinite(track.releaseDepth)) {
        return asReleaseDepth(track.releaseDepth);
    }

    const folder = findLibraryFolderForTrack({ rootPath: track.rootPath, path: track.path || '' }, state.currentSettings.libraryFolders);
    return folder ? asReleaseDepth(folder.releaseDepth) : 0;
};

const createScopeAccessor = <T>(getter: () => T, setter?: (value: T) => void) => (
    setter
        ? { configurable: true, enumerable: true, get: getter, set: setter }
        : { configurable: true, enumerable: true, get: getter }
);

const createStateAccessor = <K extends keyof AppState>(key: K) => createScopeAccessor(() => state[key], (value: AppState[K]) => {
    state[key] = value;
});

const runtimeRefs = {
    app,
    window,
    document,
    isWindowsRuntime,
    isMacRuntime,
    isLinuxRuntime,
    trackIndexByPath: state.trackIndexByPath,
    textFileIndexByPath: state.textFileIndexByPath,
    imageFileIndexByPath: state.imageFileIndexByPath,
    replayGainReleaseDynamicRangeLabelByKey: state.replayGainReleaseDynamicRangeLabelByKey,
    replayGainReleaseDynamicRangePendingByKey: state.replayGainReleaseDynamicRangePendingByKey,
    selectedLibraryRootLabel,
    libraryIndexedFilePageSize,
    sidebarQueueDescendantPromptThreshold,
    nowPlayingCoverRefreshDebounceMs,
    musicBrainzEntityModalTransitionMs,
    technicalInfoModalTransitionMs,
    aboutModalTransitionMs,
    errorModalTransitionMs,
    shareElements: {
        shareModal: shell.shareModal,
        shareBackdrop: shell.shareBackdrop,
        shareDialog: shell.shareDialog,
        shareClose: shell.shareClose,
        sharePreview: shell.sharePreview,
        shareStreamingLinksRegion: shell.shareStreamingLinksRegion,
        shareStreamingLinks: shell.shareStreamingLinks,
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
};

const runtimePorts = {
    validateConfiguredFFmpegPath,
    missingFFmpegMessage,
    applyUiDitheringSetting,
    beginLibraryLoadTracking,
    markLibraryScanResolved,
    finishLibraryLoadTracking,
    scheduleLibraryIncrementalFolderRefresh,
    saveSettingsBackend: async (settings: unknown): Promise<AppSettings> => await SaveSettings(settings as Parameters<typeof SaveSettings>[0]) as unknown as AppSettings,
    scanConfiguredLibraryFoldersBackend: async (): Promise<LibraryScanResult> => await traceBridgeCall('library', 'ScanConfiguredLibraryFolders', async () => (
        await ScanConfiguredLibraryFolders() as LibraryScanResult
    ), {
        sink: LogFrontendMessage,
        summarizeResult: summarizeLibraryScanResultForBridge,
    }),
    audioStop: async (): Promise<AudioPlaybackState> => await traceBridgeCall('transport', 'AudioStop', async () => await AudioStop() as AudioPlaybackState, {
        sink: LogFrontendMessage,
        summarizeResult: summarizeAudioPlaybackStateForBridge,
    }),
    listAudioOutputDevices: async (): Promise<AudioOutputDevice[]> => await traceBridgeCall('transport', 'AudioListOutputDevices', async () => (
        await AudioListOutputDevices() as AudioOutputDevice[]
    ), {
        sink: LogFrontendMessage,
        summarizeResult: summarizeAudioOutputDevicesForBridge,
    }),
    audioReinitializeBackend: async (): Promise<AudioPlaybackState> => await traceBridgeCall('transport', 'AudioReinitializeBackend', async () => (
        await AudioReinitializeBackend() as AudioPlaybackState
    ), {
        sink: LogFrontendMessage,
        summarizeResult: summarizeAudioPlaybackStateForBridge,
    }),
    getSettings: async (): Promise<AppSettings> => await GetSettings() as unknown as AppSettings,
    getMusicBrainzTagWorkerProgress: async (): Promise<MusicBrainzTagWorkerProgress> => await GetMusicBrainzTagWorkerProgress() as MusicBrainzTagWorkerProgress,
    getAppVersion: async (): Promise<string> => await GetAppVersion(),
    loadIndexedFilePage: async (kind: string, offset: number, limit: number): Promise<LibraryIndexedFilePage> => await traceBridgeCall('library', 'GetLibraryIndexedFilePage', async () => (
        await GetLibraryIndexedFilePage(kind, offset, limit) as LibraryIndexedFilePage
    ), {
        sink: LogFrontendMessage,
        details: { kind, offset, limit },
        summarizeResult: summarizeLibraryIndexedFilePageForBridge,
    }),
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => SavePlaylistFile(playlistPath, trackPaths),
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => AppendTracksToPlaylistFile(playlistPath, trackPaths),
    audioQueueNextTrack: async (currentPath: string, nextPath: string) => await traceBridgeCall('transport', 'AudioQueueNextTrack', async () => (
        await AudioQueueNextTrack(currentPath, nextPath)
    ), {
        sink: LogFrontendMessage,
        details: { currentPath, nextPath },
        summarizeResult: summarizeAudioPlaybackStateForBridge,
    }),
    getLastFmRequestToken: async (apiKey: string, apiSecret: string): Promise<string> => await GetLastFmRequestToken(apiKey, apiSecret) as string,
    getLastFmSessionKey: async (apiKey: string, apiSecret: string, requestToken: string): Promise<string> => await GetLastFmSessionKey(apiKey, apiSecret, requestToken) as string,
    browserOpenUrl: BrowserOpenURL,
    selectLibraryFolder: async (): Promise<string> => await traceBridgeCall('library', 'SelectLibraryFolder', async () => await SelectLibraryFolder(), {
        sink: LogFrontendMessage,
        summarizeResult: (selectedPath) => ({ selectedPath }),
    }),
    selectPlaylistFile: SelectPlaylistFile,
    selectPlaylistSaveFile: SelectPlaylistSaveFile,
    selectShareImageSaveFile: SelectShareImageSaveFile,
    saveShareImageFile: SaveShareImageFile,
    copyShareImageToClipboard: CopyShareImageToClipboard,
    readFileBase64: ReadFileBase64,
    readImageThumbnail: ReadImageThumbnail,
    loadFolderPage: async (folderPath: string, sortMode: import('./types/app-types').LibraryBrowserSortMode, offset: number, limit: number): Promise<LibraryFolderPage> => await traceBridgeCall('library', 'GetLibraryFolderPageSorted', async () => (
        await GetLibraryFolderPageSorted(folderPath, sortMode, offset, limit) as LibraryFolderPage
    ), {
        sink: LogFrontendMessage,
        details: { folderPath, sortMode, offset, limit },
        summarizeResult: summarizeLibraryFolderPageForBridge,
    }),
    resolveLibraryFolderForAbsolutePath: async (path: string): Promise<string> => await traceBridgeCall('library', 'ResolveLibraryFolderForPath', async () => await ResolveLibraryFolderForPath(path), {
        sink: LogFrontendMessage,
        details: { path },
        summarizeResult: (folderPath) => ({ folderPath }),
    }),
    isFolderImmediateDescendantsEnumerated: async (folderPath: string): Promise<boolean> => await traceBridgeCall('library', 'IsLibraryFolderImmediateDescendantsEnumerated', async () => (
        await IsLibraryFolderImmediateDescendantsEnumerated(folderPath)
    ), {
        sink: LogFrontendMessage,
        details: { folderPath },
        summarizeResult: (enumerated) => ({ enumerated }),
    }),
    searchLibrary: async (query: string, offset: number, limit: number): Promise<LibrarySearchPage> => await traceBridgeCall('library', 'SearchLibrary', async () => (
        await SearchLibrary(query, offset, limit) as LibrarySearchPage
    ), {
        sink: LogFrontendMessage,
        details: { query, offset, limit },
        summarizeResult: summarizeLibrarySearchPageForBridge,
    }),
    fetchVisualizationFrame: async (frameCount: number) => await AudioGetVisualizationFrame(frameCount),
    logFrontendMessage: LogFrontendMessage,
    audioSeek: async (seconds: number) => await traceBridgeCall('transport', 'AudioSeek', async () => await AudioSeek(seconds) as AudioPlaybackState, {
        sink: LogFrontendMessage,
        details: { seconds: Number(seconds.toFixed(3)) },
        summarizeResult: summarizeAudioPlaybackStateForBridge,
    }),
    audioSetVolume: async (volumeValue: number) => await traceBridgeCall('transport', 'AudioSetVolume', async () => await AudioSetVolume(volumeValue) as AudioPlaybackState, {
        sink: LogFrontendMessage,
        details: { volumeValue: Number(volumeValue.toFixed(3)) },
        summarizeResult: summarizeAudioPlaybackStateForBridge,
    }),
    formatTime,
};

const runtimeScope = Object.create(shell, {
    currentSettings: createStateAccessor('currentSettings'),
    playbackSequencingState: createStateAccessor('playbackSequencingState'),
    playbackSessionState: createStateAccessor('playbackSessionState'),
    scrobbleSessionState: createStateAccessor('scrobbleSessionState'),
    tracks: createStateAccessor('tracks'),
    textFiles: createStateAccessor('textFiles'),
    imageFiles: createStateAccessor('imageFiles'),
    libraryControllerState: createStateAccessor('libraryControllerState'),
    playlistControllerState: createStateAccessor('playlistControllerState'),
    settingsControllerState: createStateAccessor('settingsControllerState'),
    currentTrackIndex: createStateAccessor('currentTrackIndex'),
    objectUrls: createStateAccessor('objectUrls'),
    tagRequestVersion: createStateAccessor('tagRequestVersion'),
    artistInfoRequestVersion: createStateAccessor('artistInfoRequestVersion'),
    activeBackgroundLayer: createStateAccessor('activeBackgroundLayer'),
    coverFlipped: createStateAccessor('coverFlipped'),
    playbackPollHandle: createStateAccessor('playbackPollHandle'),
    musicBrainzEntityModalHideTimer: createStateAccessor('musicBrainzEntityModalHideTimer'),
    technicalInfoModalHideTimer: createStateAccessor('technicalInfoModalHideTimer'),
    aboutModalHideTimer: createStateAccessor('aboutModalHideTimer'),
    errorModalHideTimer: createStateAccessor('errorModalHideTimer'),
    isSeeking: createStateAccessor('isSeeking'),
    playbackMutationVersion: createStateAccessor('playbackMutationVersion'),
    playPauseToggleInFlight: createStateAccessor('playPauseToggleInFlight'),
    trackNavigationChain: createStateAccessor('trackNavigationChain'),
    gaplessQueueRequestVersion: createStateAccessor('gaplessQueueRequestVersion'),
    queuedGaplessTrackPath: createStateAccessor('queuedGaplessTrackPath'),
    activeReplayGainReleaseTrackPaths: createStateAccessor('activeReplayGainReleaseTrackPaths'),
    replayGainReleaseDynamicRangeRequestVersion: createStateAccessor('replayGainReleaseDynamicRangeRequestVersion'),
    availableAudioOutputDevices: createStateAccessor('availableAudioOutputDevices'),
    currentMusicBrainzTagWorkerProgress: createStateAccessor('currentMusicBrainzTagWorkerProgress'),
    ffmpegConfigurationRequired: createStateAccessor('ffmpegConfigurationRequired'),
    libraryTotalLoadEstimateMs: createStateAccessor('libraryTotalLoadEstimateMs'),
    libraryClientFinalizeEstimateMs: createStateAccessor('libraryClientFinalizeEstimateMs'),
    activeLibraryLoadScanResolvedAtMs: createStateAccessor('activeLibraryLoadScanResolvedAtMs'),
    fullLibraryScanLoadActive: createStateAccessor('fullLibraryScanLoadActive'),
    suppressAutoSelectAfterFullLibraryScan: createStateAccessor('suppressAutoSelectAfterFullLibraryScan'),
    pendingNowPlayingCoverRefreshHandle: createStateAccessor('pendingNowPlayingCoverRefreshHandle'),
    sidebarQueueTrackIndexes: createStateAccessor('sidebarQueueTrackIndexes'),
    sidebarQueueFeedbackTrackIndex: createStateAccessor('sidebarQueueFeedbackTrackIndex'),
    sidebarQueueFolderPath: createStateAccessor('sidebarQueueFolderPath'),
    sidebarQueueFolderLabel: createStateAccessor('sidebarQueueFolderLabel'),
    sidebarQueueFolderTarget: createStateAccessor('sidebarQueueFolderTarget'),
    sidebarQueueTrackIndexesScopedToSelection: createStateAccessor('sidebarQueueTrackIndexesScopedToSelection'),
    sidebarQueueFileActionPath: createStateAccessor('sidebarQueueFileActionPath'),
    sidebarQueueIncludeFileActions: createStateAccessor('sidebarQueueIncludeFileActions'),
    sidebarQueueSendToActionScope: createStateAccessor('sidebarQueueSendToActionScope'),
    queueConfirmResolver: createStateAccessor('queueConfirmResolver'),
    trackMetaMenuTarget: createStateAccessor('trackMetaMenuTarget'),
    trackMetaMenuActionScope: createStateAccessor('trackMetaMenuActionScope'),
    trackMetaMenuActionPath: createStateAccessor('trackMetaMenuActionPath'),
    trackMetaArtistFilterQuery: createStateAccessor('trackMetaArtistFilterQuery'),
    settingsControllerRef: createScopeAccessor(() => runtimeControllerRefs.settingsController),
    playlistControllerRef: createScopeAccessor(() => runtimeControllerRefs.playlistController),
    playlistTargetModalControllerRef: createScopeAccessor(() => runtimeControllerRefs.playlistTargetModalController),
    artistInfoControllerRef: createScopeAccessor(() => runtimeControllerRefs.artistInfoController),
    imageModalControllerRef: createScopeAccessor(() => runtimeControllerRefs.imageModalController),
    libraryControllerRef: createScopeAccessor(() => runtimeControllerRefs.libraryController),
    shareControllerRef: createScopeAccessor(() => runtimeControllerRefs.shareController),
});

Object.assign(runtimeScope, runtimeRefs, runtimePorts);

Object.assign(runtimeScope, setupCoreServicesRuntime(Object.assign(Object.create(runtimeScope), {
    releaseDepthForTrack: (track: Pick<Track, 'rootPath' | 'releaseDepth'> & { path?: string }) => releaseDepthForTrack(track),
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
        artistFilterQuery?: string,
        showArtistFilterAction?: boolean,
    ) => {
        runtimeScope.openTrackMetaMenu(clientX, clientY, includeCopyActions, actionScope, actionKind, actionPath, artistFilterQuery, showArtistFilterAction);
    },
})));

openExplorationLibrarySearch = (query: string, options?: { expandFilteredFolders?: boolean }) => {
    (runtimeScope as typeof runtimeScope & { openLibrarySearch?: (searchQuery: string, searchOptions?: { expandFilteredFolders?: boolean }) => void }).openLibrarySearch?.(query, options);
};

const {
    initializeRoonShell,
    applyRoonAccentTheme,
    defaultMusicBrainzServerUrl,
    visualizerController,
    socialController,
    playbackSequencingService,
    playbackStateService,
    refreshListenBrainzFeedbackForCurrentTrack,
    resetListenBrainzFeedbackState,
    getStoredRoonAccentTheme,
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
    appendTracksToPlaylistData,
    loadListenHistoryData,
    loadPlaylistData,
    savePlaylistData,
    savePlaylistTrackMetadataCache,
    savePlaybackOrderSetting,
    setPlaybackOrderMode,
} = createPlaybackOrderPlaylistRuntime({
    get currentSettings() {
        return state.currentSettings;
    },
    set currentSettings(value) {
        state.currentSettings = value;
    },
    get tracks() {
        return state.tracks;
    },
    set tracks(value) {
        state.tracks = value;
    },
    trackIndexByPath: state.trackIndexByPath,
    get playlistController() {
        return runtimeControllerRefs.playlistController;
    },
    playbackSequencingService,
    resetShuffleHistory: () => {
        runtimeScope.resetShuffleHistory();
    },
    updatePlayOrderMenuState,
    visualizerController,
    applyUiDitheringSetting,
    rebuildTrackPathIndex,
});

Object.assign(runtimeScope, {
    appendTracksToPlaylistData,
    loadListenHistoryData,
    loadPlaylistData,
    savePlaylistData,
    savePlaylistTrackMetadataCache,
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
    applyRoonAccentTheme(getStoredRoonAccentTheme());
    initializeRoonShell();
    resetListenBrainzFeedbackState();

    try {
        await refreshAvailableAudioOutputDevices();

        const settings = await GetSettings() as unknown as AppSettings;
        state.currentSettings = normalizeAppSettings(settings);
        visualizerController.setMode(state.currentSettings.visualizerMode);
        visualizerController.setEqualizerPosition(state.currentSettings.equalizerPosition);
        visualizerController.setLissajousScale(state.currentSettings.lissajousScale);
        visualizerController.setEnabled(state.currentSettings.lissajousEnabled);
        applyUiDitheringSetting();
        socialController.handleSettingsChanged();
        state.currentMusicBrainzTagWorkerProgress = normalizeMusicBrainzTagWorkerProgress(
            await GetMusicBrainzTagWorkerProgress() as MusicBrainzTagWorkerProgress,
        );
        runtimeControllerRefs.settingsController.setMusicBrainzTagWorkerProgress(state.currentMusicBrainzTagWorkerProgress);
        setPlaybackOrderMode(state.currentSettings.playbackOrder);
        await completeStartupIfReady();
        return;
    } catch (error) {
        console.error(error);
    }

    runtimeControllerRefs.libraryController.renderFolder('none');
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
        server: state.currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl,
        path: `/ws/2/artist/${mbid}?fmt=json&inc=genres+tags+url-rels`,
    }),
    lookupMusicBrainzRecordingURLs: (mbid: string) => scheduleMusicBrainzRequest(async () => (
        await LookupMusicBrainzRecordingURLs(mbid)
    ), {
        server: state.currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl,
        path: `/ws/2/recording/${mbid}?fmt=json&inc=url-rels`,
    }),
});

Object.assign(runtimeControllerRefs, setupControllersFromScope(runtimeScope));

const coverFront = coverFrame.querySelector('.cover-front') as HTMLElement;
const coverFlipRuntime = createCoverFlipRuntime({
    coverFrame,
    get coverFlipped() {
        return state.coverFlipped;
    },
    setCoverFlipped,
});

const {
    logRescan,
    toggleCoverFlipFromContextMenu,
    toggleCoverFlipFromSecondaryInput,
} = coverFlipRuntime;

const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
const syncRoonTaskbarHeight = (): void => {
    const measuredTaskbarHeightPx = Math.max(0, Math.ceil(playerTaskbar.getBoundingClientRect().height || 0));

    if (measuredTaskbarHeightPx > 0) {
        app?.style.setProperty('--roon-track-view-taskbar-height', `${measuredTaskbarHeightPx}px`);
    }
};

const cardResizeObserver = new ResizeObserver((entries) => {
    const measuredCardHeightPx = entries[0]?.contentRect.height;
    updateLyricsPanelVisibility(measuredCardHeightPx);
});

const roonTaskbarResizeObserver = new ResizeObserver(() => {
    syncRoonTaskbarHeight();
});

syncRoonTaskbarHeight();
roonTaskbarResizeObserver.observe(playerTaskbar);

const lateRuntimeRefs = {
    coverFront,
    volumeBtn,
    cardResizeObserver,
};

const lateRuntimePorts = {
    logRescan,
    toggleCoverFlipFromSecondaryInput,
    toggleCoverFlipFromContextMenu,
};

Object.defineProperty(runtimeScope, 'suppressCoverFrontClickUntil', createScopeAccessor(() => coverFlipRuntime.suppressCoverFrontClickUntil));
Object.assign(runtimeScope, lateRuntimeRefs, lateRuntimePorts);

bindEventHandlersFromScope(runtimeScope);

updatePlayButton();
updateTrackLabels();
updatePlayOrderMenuState();
runtimeControllerRefs.libraryController.refreshSidebarToggleState();
refreshLyricsPanel();
resetListenBrainzFeedbackState();
initializeMediaSessionIntegration();
void initializeSettings();
void initializeAppVersion();
