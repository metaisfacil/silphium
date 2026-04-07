import type {
    AppSettings,
    AudioOutputDevice,
    CustomSendToActionScope,
    ImageLibraryFile,
    MusicBrainzTagWorkerProgress,
    TextLibraryFile,
    Track,
} from './types/app-types';
import { defaultAppSettings, defaultMusicBrainzTagWorkerProgress } from './utils/settings-normalization';
import type { SettingsController } from './controllers/settings-controller';
import type { PlaylistController } from './controllers/playlist-controller';
import type { PlaylistTargetModalController } from './controllers/playlist-target-modal-controller';
import type { ArtistInfoController } from './controllers/artist-info-controller';
import type { ImageModalController } from './controllers/image-modal-controller';
import type { LibraryController } from './controllers/library-controller';
import type { ShareController } from './controllers/share-controller';

export interface AppState {
    tracks: Track[];
    textFiles: TextLibraryFile[];
    imageFiles: ImageLibraryFile[];
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
    // Controllers (late-init)
    settingsController: SettingsController;
    playlistController: PlaylistController;
    playlistTargetModalController: PlaylistTargetModalController;
    artistInfoController: ArtistInfoController;
    imageModalController: ImageModalController;
    libraryController: LibraryController;
    shareController: ShareController;
}

export const createAppState = (): AppState => ({
    tracks: [],
    textFiles: [],
    imageFiles: [],
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
    // Controllers are set during initialization
    settingsController: undefined as unknown as SettingsController,
    playlistController: undefined as unknown as PlaylistController,
    playlistTargetModalController: undefined as unknown as PlaylistTargetModalController,
    artistInfoController: undefined as unknown as ArtistInfoController,
    imageModalController: undefined as unknown as ImageModalController,
    libraryController: undefined as unknown as LibraryController,
    shareController: undefined as unknown as ShareController,
});
