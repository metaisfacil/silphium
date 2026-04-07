import type { SettingsModalElements } from '../components/overlays/settings-modal';
import type { AppLibraryFolder, AudioOutputDevice, CoverArtPrioritySource, CustomSendToAction, CustomSendToActionScope, FocusedKeyboardShortcuts, MusicBrainzTagWorkerProgress, PlayerCardLayout, ScrobbleFilterMode, ScrobbleRule, ScrobbleRuleField, ScrobbleRuleOperator } from '../types/app-types';

export type LibraryFolderDialogValues = {
    label: string;
    releaseDepth: number;
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
    ffmpegPath: string;
    listenBrainzUserToken: string;
    lastFmApiKey: string;
    lastFmApiSecret: string;
    lastFmSessionKey: string;
    scrobbleFilterMode: ScrobbleFilterMode;
    scrobbleRules: ScrobbleRule[];
    musicBrainzServerUrl: string;
    musicBrainzRequestRateMs: number;
    listenBrainzServerUrl: string;
    listenBrainzRequestRateMs: number;
    favoritePlaylists: string[];
    coverArtPriority: CoverArtPrioritySource[];
    audioOutputDevice: string;
    audioOutputBufferMs: number;
    gaplessPlayback: boolean;
    replayGainEnabled: boolean;
    preferMusicBrainzMetadata: boolean;
    musicBrainzTagDatabaseEnabled: boolean;
    musicBrainzTagStaleDays: number;
    musicBrainzTagRequestStaggeringEnabled: boolean;
    musicBrainzTagWorkerCores: number;
    lissajousEnabled: boolean;
    uiDitheringEnabled: boolean;
    minimizeToTrayOnClose: boolean;
    customSendToActions: CustomSendToAction[];
    keyboardShortcuts: FocusedKeyboardShortcuts;
};

export type SettingsViewValues = SettingsFormValues & {
    audioOutputDevices: AudioOutputDevice[];
    musicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
};

export type SettingsPrimaryTab = 'general' | 'network' | 'database' | 'playlists' | 'scrobbling' | 'audio' | 'ui' | 'actions';
export type SettingsTab = SettingsPrimaryTab | 'shortcuts';

export type SettingsControllerOptions = {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    getValues: () => SettingsViewValues;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    save: (values: SettingsFormValues) => Promise<void>;
    fetchLastFmSessionKey: (apiKey: string, apiSecret: string) => Promise<string>;
    applyAudioNow: (values: SettingsFormValues) => Promise<AudioOutputDevice[]>;
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
