import type { SettingsModalElements } from '../components/overlays/settings-modal';
import type { AppLibraryFolder, AudioOutputDevice, CoverArtPrioritySource, CustomSendToAction, CustomSendToActionScope, FocusedKeyboardShortcuts, MusicBrainzTagWorkerProgress, PlayerCardLayout, PlayerEqualizerPosition, PlayerVisualizerMode, ScrobbleFilterMode, ScrobbleRule, ScrobbleRuleField, ScrobbleRuleOperator } from '../types/app-types';

export type LibraryFolderDialogValues = {
    label: string;
    releaseDepth: number;
    musicBrainzTagWorkerScansEnabled: boolean;
};

export type ScrobbleRuleDialogValues = {
    field: ScrobbleRuleField;
    operator: ScrobbleRuleOperator;
    value: string;
};

export type SendToActionDialogValues = {
    title: string;
    scope: CustomSendToActionScope;
    commandTemplate: string;
};

export type SettingsFormValues = {
    libraryFolders: AppLibraryFolder[];
    localLibraryFilesDatabaseEnabled: boolean;
    localLibraryFilesDatabaseLoadOnStartup: boolean;
    localLibraryFilesDatabaseListenHistoryEnabled: boolean;
    localLibraryFilesDatabaseListenHistoryLimit: number;
    localLibraryFilesDatabaseListenHistoryThresholdSeconds: number;
    ffmpegPath: string;
    remoteLibraryTranscodingEnabled: boolean;
    remoteLibraryTranscodingBitrateKbps: number;
    librarySharingEnabled: boolean;
    librarySharingPort: number;
    librarySharingPassword?: string;
    librarySharingPasswordHash?: string;
    listenBrainzUserToken: string;
    lastFmApiKey: string;
    lastFmApiSecret: string;
    lastFmSessionKey: string;
    scrobblingEnabled: boolean;
    scrobbleFilterMode: ScrobbleFilterMode;
    scrobbleRules: ScrobbleRule[];
    musicBrainzServerUrl: string;
    musicBrainzRequestRateMs: number;
    listenBrainzServerUrl: string;
    listenBrainzRequestRateMs: number;
    favoritePlaylists: string[];
    savePlaylistsOnAddRemove: boolean;
    coverArtPriority: CoverArtPrioritySource[];
    audioOutputDevice: string;
    audioOutputBufferMs: number;
    gaplessPlayback: boolean;
    replayGainEnabled: boolean;
    preferMusicBrainzMetadata: boolean;
    musicBrainzTagDatabaseEnabled: boolean;
    highlightMusicBrainzTaggedAlbumFolders: boolean;
    musicBrainzTagStaleDays: number;
    musicBrainzTagRequestStaggeringEnabled: boolean;
    musicBrainzTagWorkerCores: number;
    lissajousEnabled: boolean;
    lissajousScale: number;
    visualizerMode: PlayerVisualizerMode;
    equalizerPosition: PlayerEqualizerPosition;
    uiDitheringEnabled: boolean;
    minimizeToTrayOnClose: boolean;
    customSendToActions: CustomSendToAction[];
    keyboardShortcuts: FocusedKeyboardShortcuts;
};

export type SettingsViewValues = SettingsFormValues & {
    audioOutputDevices: AudioOutputDevice[];
    musicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
};

export type ApplyAudioNowResult = {
    devices: AudioOutputDevice[];
    selectedDevice: string;
    message?: string;
};

export type SettingsPrimaryTab = 'general' | 'library' | 'network' | 'playlists' | 'scrobbling' | 'audio' | 'ui' | 'actions';
export type SettingsTab = SettingsPrimaryTab | 'database' | 'shortcuts';

export type SettingsControllerOptions = {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    state?: SettingsControllerState;
    getValues: () => SettingsViewValues;
    getMusicBrainzTagWorkerProgress?: () => Promise<MusicBrainzTagWorkerProgress>;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    save: (values: SettingsFormValues) => Promise<void>;
    fetchLastFmSessionKey: (apiKey: string, apiSecret: string) => Promise<string>;
    applyAudioNow: (values: SettingsFormValues) => Promise<ApplyAudioNowResult>;
    forceReload: (values: SettingsFormValues) => Promise<void>;
    beforeClose?: () => Promise<string | null>;
    onCloseBlocked?: (message: string) => void;
    getPlayerCardLayout: () => PlayerCardLayout;
    setPlayerCardLayout: (layout: PlayerCardLayout) => void;
    isWindows?: boolean;
    isMac?: boolean;
    isLinux?: boolean;
};

export const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];
export const allCoverArtPrioritySources: CoverArtPrioritySource[] = ['file', 'embedded', 'musicbrainz'];
export const DEFAULT_MUSIC_BRAINZ_TAG_STALE_DAYS = 30;
export const MAX_MUSIC_BRAINZ_TAG_STALE_DAYS = 36500;

export type SettingsControllerState = {
    favoritePlaylists: string[];
    selectedFavoritePlaylistIndex: number;
    scrobbleRules: ScrobbleRule[];
    selectedScrobbleRuleIndex: number;
    customSendToActions: CustomSendToAction[];
    selectedCustomSendToActionIndex: number;
    lastCustomSendToActionClickIndex: number;
    lastCustomSendToActionClickAt: number;
    lastScrobbleRuleClickIndex: number;
    lastScrobbleRuleClickAt: number;
    libraryFolders: AppLibraryFolder[];
    selectedLibraryFolderIndex: number;
    lastLibraryFolderClickIndex: number;
    lastLibraryFolderClickAt: number;
    forceReloadInProgress: boolean;
    lastFmSessionFetchInProgress: boolean;
    forceReloadEtaSeconds: number | null;
    audioOutputDevices: AudioOutputDevice[];
    coverArtPriority: CoverArtPrioritySource[];
    coverArtPriorityOrder: CoverArtPrioritySource[];
    draggedCoverPriorityIndex: number;
    musicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
};

export const createSettingsControllerState = (): SettingsControllerState => ({
    favoritePlaylists: [],
    selectedFavoritePlaylistIndex: -1,
    scrobbleRules: [],
    selectedScrobbleRuleIndex: -1,
    customSendToActions: [],
    selectedCustomSendToActionIndex: -1,
    lastCustomSendToActionClickIndex: -1,
    lastCustomSendToActionClickAt: Number.NEGATIVE_INFINITY,
    lastScrobbleRuleClickIndex: -1,
    lastScrobbleRuleClickAt: Number.NEGATIVE_INFINITY,
    libraryFolders: [],
    selectedLibraryFolderIndex: -1,
    lastLibraryFolderClickIndex: -1,
    lastLibraryFolderClickAt: Number.NEGATIVE_INFINITY,
    forceReloadInProgress: false,
    lastFmSessionFetchInProgress: false,
    forceReloadEtaSeconds: null,
    audioOutputDevices: [],
    coverArtPriority: [...defaultCoverArtPriority],
    coverArtPriorityOrder: [...allCoverArtPrioritySources],
    draggedCoverPriorityIndex: -1,
    musicBrainzTagWorkerProgress: {
        enabled: false,
        active: false,
        progress: 0,
        pendingTrackScans: 0,
        totalTrackScans: 0,
        completedTrackScans: 0,
        pendingEntityLookups: 0,
        totalEntityLookups: 0,
        completedEntityLookups: 0,
    },
});
