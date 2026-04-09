import type {
    AppSettings,
    AudioOutputDevice,
    CustomSendToActionScope,
    ImageLibraryFile,
    MusicBrainzTagWorkerProgress,
    TextLibraryFile,
    Track,
} from './types/app-types';
import { createLibraryControllerState, type LibraryControllerState } from './controllers/library-controller-types';
import { createPlaylistControllerState, type PlaylistControllerState } from './controllers/playlist-controller-state';
import { createSettingsControllerState, type SettingsControllerState } from './controllers/settings-controller-types';
import { defaultAppSettings, defaultMusicBrainzTagWorkerProgress } from './utils/settings-normalization';

export interface AppState {
    tracks: Track[];
    textFiles: TextLibraryFile[];
    imageFiles: ImageLibraryFile[];
    libraryControllerState: LibraryControllerState;
    playlistControllerState: PlaylistControllerState;
    settingsControllerState: SettingsControllerState;
    trackIndexByPath: Map<string, number>;
    textFileIndexByPath: Map<string, number>;
    imageFileIndexByPath: Map<string, number>;
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
    replayGainReleaseDynamicRangeLabelByKey: Map<string, string>;
    replayGainReleaseDynamicRangePendingByKey: Map<string, Promise<string>>;
    replayGainReleaseDynamicRangeRequestVersion: number;
    availableAudioOutputDevices: AudioOutputDevice[];
    currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
    currentSettings: AppSettings;
    startupInitializationComplete: boolean;
    ffmpegConfigurationRequired: boolean;
    trackMetaMenuTarget: HTMLElement | null;
    trackMetaMenuActionScope: CustomSendToActionScope | null;
    trackMetaMenuActionPath: string;
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
    libraryClientFinalizeEstimateMs: number;
    activeLibraryLoadScanResolvedAtMs: number | null;
    fullLibraryScanLoadActive: boolean;
    suppressAutoSelectAfterFullLibraryScan: boolean;
    pendingLibraryIncrementalRefreshHandle: number | null;
    pendingNowPlayingCoverRefreshHandle: number | null;
    hideToTrayOnMinimizeInFlight: boolean;
    hideToTrayRetryTimer: number | undefined;
}

export const createAppState = (): AppState => ({
    tracks: [],
    textFiles: [],
    imageFiles: [],
    libraryControllerState: createLibraryControllerState(),
    playlistControllerState: createPlaylistControllerState(),
    settingsControllerState: createSettingsControllerState(),
    trackIndexByPath: new Map(),
    textFileIndexByPath: new Map(),
    imageFileIndexByPath: new Map(),
    currentTrackIndex: -1,
    objectUrls: [],
    tagRequestVersion: 0,
    artistInfoRequestVersion: 0,
    activeBackgroundLayer: 0,
    coverFlipped: false,
    playbackPollHandle: undefined,
    musicBrainzEntityModalHideTimer: undefined,
    technicalInfoModalHideTimer: undefined,
    aboutModalHideTimer: undefined,
    errorModalHideTimer: undefined,
    isSeeking: false,
    playbackMutationVersion: 0,
    playPauseToggleInFlight: false,
    trackNavigationChain: Promise.resolve(),
    gaplessQueueRequestVersion: 0,
    queuedGaplessTrackPath: '',
    activeReplayGainReleaseTrackPaths: [],
    replayGainReleaseDynamicRangeLabelByKey: new Map(),
    replayGainReleaseDynamicRangePendingByKey: new Map(),
    replayGainReleaseDynamicRangeRequestVersion: 0,
    availableAudioOutputDevices: [],
    currentMusicBrainzTagWorkerProgress: { ...defaultMusicBrainzTagWorkerProgress },
    currentSettings: { ...defaultAppSettings },
    startupInitializationComplete: false,
    ffmpegConfigurationRequired: false,
    trackMetaMenuTarget: null,
    trackMetaMenuActionScope: null,
    trackMetaMenuActionPath: '',
    sidebarQueueTrackIndexes: [],
    sidebarQueueFeedbackTrackIndex: null,
    sidebarQueueFolderPath: '',
    sidebarQueueFolderLabel: '',
    sidebarQueueFolderTarget: false,
    sidebarQueueTrackIndexesScopedToSelection: false,
    sidebarQueueFileActionPath: '',
    sidebarQueueIncludeFileActions: false,
    sidebarQueueSendToActionScope: null,
    queueConfirmResolver: null,
    libraryClientFinalizeEstimateMs: 0,
    activeLibraryLoadScanResolvedAtMs: null,
    fullLibraryScanLoadActive: false,
    suppressAutoSelectAfterFullLibraryScan: false,
    pendingLibraryIncrementalRefreshHandle: null,
    pendingNowPlayingCoverRefreshHandle: null,
    hideToTrayOnMinimizeInFlight: false,
    hideToTrayRetryTimer: undefined,
});
