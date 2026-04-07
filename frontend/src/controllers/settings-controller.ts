import type { SettingsModalElements } from '../components/overlays/settings-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { AppLibraryFolder, AudioOutputDevice, CoverArtPrioritySource, CustomSendToAction, CustomSendToActionScope, FocusedKeyboardShortcuts, MusicBrainzTagWorkerProgress, PlayerCardLayout, ScrobbleFilterMode, ScrobbleRule, ScrobbleRuleField, ScrobbleRuleOperator } from '../types/app-types';
import { asReleaseDepth, describeScrobbleRule, libraryFolderPathKey, normalizeLibraryFolderLabel, normalizeLibraryFolders, normalizeScrobbleRules, validateScrobbleRules } from '../utils/main-helpers';
import { formatShortcutBindingFromKeyboardEvent, normalizeFocusedKeyboardShortcuts } from '../utils/shortcut-bindings';

type LibraryFolderDialogValues = {
    label: string;
    releaseDepth: number;
};

type ScrobbleRuleDialogValues = {
    field: ScrobbleRuleField;
    operator: ScrobbleRuleOperator;
    value: string;
};

type SendToActionDialogValues = {
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

type SettingsPrimaryTab = 'general' | 'network' | 'database' | 'playlists' | 'scrobbling' | 'audio' | 'ui' | 'actions';
type SettingsTab = SettingsPrimaryTab | 'shortcuts';

const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];
const allCoverArtPrioritySources: CoverArtPrioritySource[] = ['file', 'embedded', 'musicbrainz'];
const DEFAULT_MUSIC_BRAINZ_TAG_STALE_DAYS = 30;
const MAX_MUSIC_BRAINZ_TAG_STALE_DAYS = 36500;

const normalizeCoverArtPriority = (items: string[] | undefined): CoverArtPrioritySource[] => {
    if (items === undefined) {
        return [...defaultCoverArtPriority];
    }

    const ordered: CoverArtPrioritySource[] = [];
    const seen = new Set<CoverArtPrioritySource>();
    for (const item of items) {
        const normalized = item.trim().toLowerCase();
        if (normalized !== 'file' && normalized !== 'embedded' && normalized !== 'musicbrainz') {
            continue;
        }

        const source = normalized as CoverArtPrioritySource;
        if (seen.has(source)) {
            continue;
        }

        seen.add(source);
        ordered.push(source);
    }

    if (ordered.length === 0 && items.length > 0) {
        return [...defaultCoverArtPriority];
    }

    return ordered;
};

const normalizeCoverArtPriorityOrder = (items: string[] | undefined): CoverArtPrioritySource[] => {
    const ordered = normalizeCoverArtPriority(items);
    const seen = new Set<CoverArtPrioritySource>(ordered);
    for (const fallback of allCoverArtPrioritySources) {
        if (!seen.has(fallback)) {
            ordered.push(fallback);
        }
    }

    return ordered;
};

type SettingsControllerOptions = {
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

export type SettingsController = ReturnType<typeof createSettingsController>;

export const createSettingsController = (options: SettingsControllerOptions) => {
    const { trigger, elements } = options;
    const {
        settingsModal,
        settingsBackdrop,
        settingsClose,
        settingsTabs,
        settingsTabsScrollLeft,
        settingsTabsScrollRight,
        settingsTabGeneral,
        settingsTabNetwork,
        settingsTabDatabase,
        settingsTabPlaylists,
        settingsTabScrobbling,
        settingsTabAudio,
        settingsTabUi,
        settingsTabActions,
        settingsPanelGeneral,
        settingsPanelNetwork,
        settingsPanelDatabase,
        settingsPanelPlaylists,
        settingsPanelScrobbling,
        settingsPanelAudio,
        settingsPanelUi,
        settingsPanelActions,
        settingsShortcutAccordionToggle,
        settingsShortcutAccordionPanel,
        settingsLibraryFolderList,
        settingsAddLibraryFolder,
        settingsRemoveLibraryFolder,
        settingsFavoritePlaylistList,
        settingsAddFavoritePlaylist,
        settingsRemoveFavoritePlaylist,
        settingsScrobbleFilterMode,
        settingsScrobbleRuleList,
        settingsAddScrobbleRule,
        settingsRemoveScrobbleRule,
        settingsSendToActionList,
        settingsAddSendToAction,
        settingsRemoveSendToAction,
        settingsForceReload,
        settingsSave,
        settingsLibraryDepthModal,
        settingsLibraryDepthBackdrop,
        settingsLibraryDepthForm,
        settingsLibraryDepthTitle,
        settingsLibraryDepthLabelInput,
        settingsLibraryDepthInput,
        settingsLibraryDepthStatus,
        settingsLibraryDepthCancel,
        settingsLibraryDepthConfirm,
        settingsScrobbleRuleModal,
        settingsScrobbleRuleBackdrop,
        settingsScrobbleRuleForm,
        settingsScrobbleRuleTitle,
        settingsScrobbleRuleField,
        settingsScrobbleRuleOperator,
        settingsScrobbleRuleValueLabel,
        settingsScrobbleRuleValue,
        settingsScrobbleRuleHint,
        settingsScrobbleRuleStatus,
        settingsScrobbleRuleCancel,
        settingsScrobbleRuleConfirm,
        settingsSendToActionModal,
        settingsSendToActionBackdrop,
        settingsSendToActionForm,
        settingsSendToActionTitleInput,
        settingsSendToActionScopeInput,
        settingsSendToActionCommandHint,
        settingsSendToActionCommandInput,
        settingsSendToActionStatus,
        settingsSendToActionCancel,
        settingsSendToActionConfirm,
        settingsFFmpegPath,
        settingsListenBrainzToken,
        settingsLastFmApiKey,
        settingsLastFmApiSecret,
        settingsLastFmSessionKey,
        settingsLastFmSessionKeyFetch,
        settingsMusicBrainzServerUrl,
        settingsMusicBrainzRequestRateMs,
        settingsListenBrainzServerUrl,
        settingsListenBrainzRequestRateMs,
        settingsAudioOutputDevice,
        settingsAudioOutputBufferMs,
        settingsApplyAudioNow,
        settingsGaplessPlayback,
        settingsReplayGain,
        settingsPreferMusicBrainzMetadata,
        settingsMusicBrainzTagDatabaseEnabled,
        settingsMusicBrainzTagStaleDays,
        settingsMusicBrainzTagRequestStaggeringEnabled,
        settingsMusicBrainzTagWorkerCores,
        settingsMusicBrainzTagWorkerProgressBar,
        settingsMusicBrainzTagWorkerProgressFill,
        settingsMusicBrainzTagWorkerProgressValue,
        settingsMusicBrainzTagWorkerProgressRemaining,
        settingsMusicBrainzTagWorkerProgressStatus,
        settingsPlayerCardLayout,
        settingsCoverArtPriorityAccordionToggle,
        settingsCoverArtPriorityAccordionPanel,
        settingsCoverArtPriorityList,
        settingsLissajousEnabled,
        settingsUiDitheringEnabled,
        settingsMinimizeToTrayField,
        settingsMinimizeToTrayOnClose,
        settingsShortcutPlayPauseToggle,
        settingsShortcutNextTrack,
        settingsShortcutPreviousTrack,
        settingsShortcutStopPlayback,
        settingsShortcutFocusLibraryFilter,
        settingsShortcutOpenSettings,
        settingsStatus,
    } = elements;

    const settingsModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const settingsShortcutAccordionTransitionMs = 180;
    const settingsTabScrollStepPx = 160;
    const settingsTabsShell = settingsTabs.parentElement instanceof HTMLDivElement
        ? settingsTabs.parentElement
        : null;
    const statusFadeDelayMs = 5000;
    const showMinimizeToTrayOption = options.isWindows ?? true;
    const isWindowsRuntime = options.isWindows ?? false;
    const isMacRuntime = options.isMac ?? false;
    const isLinuxRuntime = options.isLinux ?? false;
    let hideTimer: number | undefined;
    let libraryDepthHideTimer: number | undefined;
    let scrobbleRuleHideTimer: number | undefined;
    let sendToActionHideTimer: number | undefined;
    let settingsStatusFadeTimer: number | undefined;
    let settingsLibraryDepthStatusFadeTimer: number | undefined;
    let shortcutAccordionHideTimer: number | undefined;
    let coverArtPriorityAccordionHideTimer: number | undefined;

    let favoritePlaylists: string[] = [];
    let selectedFavoritePlaylistIndex = -1;
    let scrobbleRules: ScrobbleRule[] = [];
    let selectedScrobbleRuleIndex = -1;
    let customSendToActions: CustomSendToAction[] = [];
    let selectedCustomSendToActionIndex = -1;
    let lastCustomSendToActionClickIndex = -1;
    let lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;
    let lastScrobbleRuleClickIndex = -1;
    let lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
    let libraryFolders: AppLibraryFolder[] = [];
    let selectedLibraryFolderIndex = -1;
    let lastLibraryFolderClickIndex = -1;
    let lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
    let pendingLibraryDepthResolver: ((value: LibraryFolderDialogValues | null) => void) | null = null;
    let libraryDepthReturnFocusTarget: HTMLElement | null = null;
    let pendingScrobbleRuleResolver: ((value: ScrobbleRuleDialogValues | null) => void) | null = null;
    let scrobbleRuleReturnFocusTarget: HTMLElement | null = null;
    let pendingSendToActionResolver: ((value: SendToActionDialogValues | null) => void) | null = null;
    let sendToActionReturnFocusTarget: HTMLElement | null = null;
    let forceReloadInProgress = false;
    let lastFmSessionFetchInProgress = false;
    let forceReloadEtaSeconds: number | null = null;
    let audioOutputDevices: AudioOutputDevice[] = [];
    let coverArtPriority: CoverArtPrioritySource[] = [...defaultCoverArtPriority];
    let coverArtPriorityOrder: CoverArtPrioritySource[] = [...allCoverArtPrioritySources];
    let draggedCoverPriorityIndex = -1;
    let musicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress = {
        enabled: false,
        active: false,
        progress: 0,
        pendingTrackScans: 0,
        totalTrackScans: 0,
        completedTrackScans: 0,
        pendingEntityLookups: 0,
        totalEntityLookups: 0,
        completedEntityLookups: 0,
    };
    let musicBrainzTagWorkerEntityRatePerSecond: number | null = null;
    let musicBrainzTagWorkerLastSampleAtMs: number | null = null;
    let musicBrainzTagWorkerLastCompletedEntityLookups = 0;
    const libraryFolderRepeatClickWindowMs = 400;

    settingsMinimizeToTrayField.hidden = !showMinimizeToTrayOption;

    const applySendToCommandExamplesForPlatform = () => {
        if (isWindowsRuntime) {
            settingsSendToActionCommandHint.innerHTML = 'Examples:<br><code>%programfiles%\\\\Mp3tag\\\\Mp3tag.exe {path}</code><br><code>covit --input {path} --primary-output {directory}\\\\cover</code>';
            settingsSendToActionCommandInput.placeholder = '%programfiles%\\Mp3tag\\Mp3tag.exe {path}';
            return;
        }

        if (isMacRuntime) {
            settingsSendToActionCommandHint.innerHTML = 'Examples:<br><code>open {path}</code><br><code>covit --input {path} --primary-output {directory}/cover</code>';
            settingsSendToActionCommandInput.placeholder = 'open {path}';
            return;
        }

        if (isLinuxRuntime) {
            settingsSendToActionCommandHint.innerHTML = 'Examples:<br><code>xdg-open {path}</code><br><code>covit --input {path} --primary-output {directory}/cover</code>';
            settingsSendToActionCommandInput.placeholder = 'xdg-open {path}';
            return;
        }

        settingsSendToActionCommandHint.innerHTML = 'Examples:<br><code>covit --input {path} --primary-output {directory}/cover</code>';
        settingsSendToActionCommandInput.placeholder = 'covit --input {path}';
    };

    applySendToCommandExamplesForPlatform();

    const scrobbleTextOperatorOptions: Array<{ value: ScrobbleRuleOperator; label: string }> = [
        { value: 'contains', label: 'Contains text' },
        { value: 'equals', label: 'Equals text' },
        { value: 'starts_with', label: 'Starts with' },
        { value: 'regex', label: 'Matches RegEx' },
    ];
    const scrobbleDurationOperatorOptions: Array<{ value: ScrobbleRuleOperator; label: string }> = [
        { value: 'less_than', label: 'Is shorter than' },
        { value: 'greater_than', label: 'Is longer than' },
    ];

    const normalizeFavoritePlaylists = (items: string[]): string[] => {
        const deduped = new Set<string>();
        const lines = items
            .map((line) => line.trim())
            .filter((line) => line !== '');

        lines.forEach((line) => {
            deduped.add(line);
        });

        return Array.from(deduped);
    };

    const asCustomSendToActionScope = (value: string): CustomSendToActionScope | null => {
        if (value === 'track' || value === 'album' || value === 'file' || value === 'folder') {
            return value;
        }

        return null;
    };

    const normalizeCustomSendToActions = (items: CustomSendToAction[]): CustomSendToAction[] => {
        const deduped = new Set<string>();
        const normalized: CustomSendToAction[] = [];
        for (const item of items) {
            const title = item.title.trim();
            const commandTemplate = item.commandTemplate.trim();
            const scope = asCustomSendToActionScope(item.scope);
            if (title === '' || commandTemplate === '' || scope === null) {
                continue;
            }

            const dedupeKey = `${scope}\n${title.toLowerCase()}\n${commandTemplate.toLowerCase()}`;
            if (deduped.has(dedupeKey)) {
                continue;
            }

            deduped.add(dedupeKey);
            normalized.push({
                title,
                scope,
                commandTemplate,
            });
        }

        return normalized;
    };

    const asScrobbleRuleField = (value: string): ScrobbleRuleField => {
        switch (value) {
        case 'albumArtist':
        case 'trackArtist':
        case 'albumTitle':
        case 'trackTitle':
        case 'genre':
        case 'anyTag':
        case 'artistMbid':
        case 'albumMbid':
        case 'trackLength':
            return value;
        default:
            return 'path';
        }
    };

    const defaultScrobbleRuleOperator = (field: ScrobbleRuleField): ScrobbleRuleOperator => {
        if (field === 'trackLength') {
            return 'greater_than';
        }

        if (field === 'path') {
            return 'starts_with';
        }

        return 'contains';
    };

    const operatorOptionsForScrobbleRuleField = (field: ScrobbleRuleField): Array<{ value: ScrobbleRuleOperator; label: string }> => {
        return field === 'trackLength' ? scrobbleDurationOperatorOptions : scrobbleTextOperatorOptions;
    };

    const resolvePrimaryTab = (tab: SettingsTab): SettingsPrimaryTab => (tab === 'shortcuts' ? 'ui' : tab);

    const scrollAccordionIntoView = (toggle: HTMLButtonElement, panel: HTMLDivElement): void => {
        const accordion = toggle.closest('.settings-accordion');
        const target = accordion instanceof HTMLElement ? accordion : panel;
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const scrollShortcutAccordionIntoView = (): void => {
        scrollAccordionIntoView(settingsShortcutAccordionToggle, settingsShortcutAccordionPanel);
    };

    const scrollCoverArtPriorityAccordionIntoView = (): void => {
        scrollAccordionIntoView(settingsCoverArtPriorityAccordionToggle, settingsCoverArtPriorityAccordionPanel);
    };

    const clearAccordionHideTimer = (timer: number | undefined, setTimer: (nextTimer: number | undefined) => void): void => {
        if (timer !== undefined) {
            window.clearTimeout(timer);
            setTimer(undefined);
        }
    };

    const setAccordionExpanded = (
        toggle: HTMLButtonElement,
        panel: HTMLDivElement,
        expanded: boolean,
        animate: boolean,
        hideTimer: number | undefined,
        setHideTimer: (nextTimer: number | undefined) => void,
    ): void => {
        clearAccordionHideTimer(hideTimer, setHideTimer);
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const accordion = toggle.closest('.settings-accordion');
        const wrapper = accordion instanceof HTMLElement ? accordion : null;

        if (!animate) {
            wrapper?.classList.toggle('is-expanded', expanded);
            panel.hidden = !expanded;
            return;
        }

        if (expanded) {
            panel.hidden = false;
            window.requestAnimationFrame(() => {
                wrapper?.classList.add('is-expanded');
            });
            return;
        }

        wrapper?.classList.remove('is-expanded');
        const nextHideTimer = window.setTimeout(() => {
            panel.hidden = true;
            setHideTimer(undefined);
        }, settingsShortcutAccordionTransitionMs);
        setHideTimer(nextHideTimer);
    };

    const setShortcutAccordionExpanded = (expanded: boolean, animate = true): void => {
        setAccordionExpanded(
            settingsShortcutAccordionToggle,
            settingsShortcutAccordionPanel,
            expanded,
            animate,
            shortcutAccordionHideTimer,
            (nextTimer) => {
                shortcutAccordionHideTimer = nextTimer;
            },
        );
    };

    const setCoverArtPriorityAccordionExpanded = (expanded: boolean, animate = true): void => {
        setAccordionExpanded(
            settingsCoverArtPriorityAccordionToggle,
            settingsCoverArtPriorityAccordionPanel,
            expanded,
            animate,
            coverArtPriorityAccordionHideTimer,
            (nextTimer) => {
                coverArtPriorityAccordionHideTimer = nextTimer;
            },
        );
    };

    const normalizeMusicBrainzTagWorkerCores = (value: string): number => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 0;
        }

        return Math.min(Math.floor(parsed), 128);
    };

    const normalizeMusicBrainzTagStaleDays = (value: string): number => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return DEFAULT_MUSIC_BRAINZ_TAG_STALE_DAYS;
        }

        return Math.min(Math.floor(parsed), MAX_MUSIC_BRAINZ_TAG_STALE_DAYS);
    };

    const normalizeMusicBrainzTagWorkerProgress = (value?: Partial<MusicBrainzTagWorkerProgress> | null): MusicBrainzTagWorkerProgress => {
        const source = value || {};
        const progress = Number.isFinite(source.progress) ? Number(source.progress) : 0;
        const clampCount = (count: unknown): number => {
            const numeric = Number(count);
            if (!Number.isFinite(numeric) || numeric <= 0) {
                return 0;
            }

            return Math.floor(numeric);
        };

        return {
            enabled: !!source.enabled,
            active: !!source.active,
            progress: Math.max(0, Math.min(1, progress)),
            pendingTrackScans: clampCount(source.pendingTrackScans),
            totalTrackScans: clampCount(source.totalTrackScans),
            completedTrackScans: clampCount(source.completedTrackScans),
            pendingEntityLookups: clampCount(source.pendingEntityLookups),
            totalEntityLookups: clampCount(source.totalEntityLookups),
            completedEntityLookups: clampCount(source.completedEntityLookups),
        };
    };

    const resetMusicBrainzTagWorkerEtaTracking = (): void => {
        musicBrainzTagWorkerEntityRatePerSecond = null;
        musicBrainzTagWorkerLastSampleAtMs = null;
        musicBrainzTagWorkerLastCompletedEntityLookups = 0;
    };

    const estimateMusicBrainzTagWorkerEtaSeconds = (nextProgress: MusicBrainzTagWorkerProgress): number | null => {
        if (!nextProgress.enabled || !nextProgress.active || nextProgress.pendingEntityLookups <= 0) {
            resetMusicBrainzTagWorkerEtaTracking();
            return null;
        }

        const nowMs = Date.now();
        const completedEntityLookups = nextProgress.completedEntityLookups;
        const previousSampleAtMs = musicBrainzTagWorkerLastSampleAtMs;
        const shouldResetTracking = previousSampleAtMs === null
            || completedEntityLookups < musicBrainzTagWorkerLastCompletedEntityLookups
            || !musicBrainzTagWorkerProgress.active
            || musicBrainzTagWorkerProgress.pendingEntityLookups <= 0;

        if (shouldResetTracking) {
            musicBrainzTagWorkerEntityRatePerSecond = null;
            musicBrainzTagWorkerLastSampleAtMs = nowMs;
            musicBrainzTagWorkerLastCompletedEntityLookups = completedEntityLookups;
            return null;
        }

        const elapsedSeconds = Math.max(0, (nowMs - previousSampleAtMs) / 1000);
        const completedDelta = completedEntityLookups - musicBrainzTagWorkerLastCompletedEntityLookups;
        if (completedDelta > 0 && elapsedSeconds > 0) {
            const instantRate = completedDelta / elapsedSeconds;
            musicBrainzTagWorkerEntityRatePerSecond = musicBrainzTagWorkerEntityRatePerSecond === null
                ? instantRate
                : (musicBrainzTagWorkerEntityRatePerSecond * 0.65) + (instantRate * 0.35);
            musicBrainzTagWorkerLastSampleAtMs = nowMs;
            musicBrainzTagWorkerLastCompletedEntityLookups = completedEntityLookups;
        }

        if (musicBrainzTagWorkerEntityRatePerSecond === null || musicBrainzTagWorkerEntityRatePerSecond <= 0) {
            return null;
        }

        return nextProgress.pendingEntityLookups / musicBrainzTagWorkerEntityRatePerSecond;
    };

    const renderMusicBrainzTagWorkerProgress = (value: MusicBrainzTagWorkerProgress): void => {
        const nextProgress = normalizeMusicBrainzTagWorkerProgress(value);
        const etaSeconds = estimateMusicBrainzTagWorkerEtaSeconds(nextProgress);
        musicBrainzTagWorkerProgress = nextProgress;
        const progressPercent = Math.round(musicBrainzTagWorkerProgress.progress * 100);

        settingsMusicBrainzTagWorkerProgressValue.textContent = `${progressPercent}%`;
        settingsMusicBrainzTagWorkerProgressFill.style.width = `${progressPercent}%`;
        settingsMusicBrainzTagWorkerProgressBar.setAttribute('aria-valuenow', String(progressPercent));
        settingsMusicBrainzTagWorkerProgressBar.setAttribute('aria-valuetext', `${progressPercent}% complete`);
        settingsMusicBrainzTagWorkerProgressBar.classList.toggle('is-active', musicBrainzTagWorkerProgress.active);
        settingsMusicBrainzTagWorkerProgressBar.classList.toggle('is-disabled', !musicBrainzTagWorkerProgress.enabled);

        const processedEntityCount = musicBrainzTagWorkerProgress.completedEntityLookups;
        const entityCount = musicBrainzTagWorkerProgress.pendingEntityLookups;
        const etaLabel = formatEtaLabel(etaSeconds);
        const remainingLabel = `${entityCount} ${entityCount === 1 ? 'entity' : 'entities'} still to look up`;
        settingsMusicBrainzTagWorkerProgressRemaining.textContent = `${processedEntityCount} ${processedEntityCount === 1 ? 'entity' : 'entities'} processed • ${remainingLabel}${etaLabel ? ` • ${etaLabel} remaining` : '.'}`;

        if (!musicBrainzTagWorkerProgress.enabled) {
            settingsMusicBrainzTagWorkerProgressStatus.textContent = 'MusicBrainz tag database is disabled.';
            return;
        }

        if (musicBrainzTagWorkerProgress.active) {
            if (musicBrainzTagWorkerProgress.pendingTrackScans > 0 && musicBrainzTagWorkerProgress.pendingEntityLookups > 0) {
                settingsMusicBrainzTagWorkerProgressStatus.textContent = 'Scanning local track metadata and fetching queued MusicBrainz entities.';
                return;
            }

            if (musicBrainzTagWorkerProgress.pendingTrackScans > 0) {
                settingsMusicBrainzTagWorkerProgressStatus.textContent = 'Scanning local track metadata to build the lookup queue.';
                return;
            }

            settingsMusicBrainzTagWorkerProgressStatus.textContent = 'Fetching queued MusicBrainz entities.';
            return;
        }

        settingsMusicBrainzTagWorkerProgressStatus.textContent = 'Background metadata index is up to date.';
    };

    const normalizeRequestRateMs = (value: string): number => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return 0;
        }

        return Math.floor(parsed);
    };

    const PUBLIC_MIN_RATE_LIMIT_MS = 1000;

    const parseServerHostname = (value: string): string => {
        const trimmed = value.trim();
        if (trimmed === '') {
            return '';
        }

        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
        try {
            return new URL(withScheme).hostname.toLowerCase();
        } catch {
            return '';
        }
    };

    const isLocalDevelopmentServer = (url: string): boolean => {
        const host = parseServerHostname(url);
        return host === 'localhost'
            || host === '::1'
            || host === '127.0.0.1'
            || /^127\./.test(host)
            || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
            || /^10\.0\.\d{1,3}\.\d{1,3}$/.test(host);
    };

    const normalizeServerRequestRateMs = (value: string, serverUrl: string): number => {
        const parsed = normalizeRequestRateMs(value);
        if (isLocalDevelopmentServer(serverUrl)) {
            return parsed;
        }

        return Math.max(PUBLIC_MIN_RATE_LIMIT_MS, parsed);
    };

    const normalizedMusicBrainzRequestRateMs = (): number => normalizeServerRequestRateMs(
        settingsMusicBrainzRequestRateMs.value,
        settingsMusicBrainzServerUrl.value,
    );

    const normalizedListenBrainzRequestRateMs = (): number => normalizeServerRequestRateMs(
        settingsListenBrainzRequestRateMs.value,
        settingsListenBrainzServerUrl.value,
    );

    const refreshMusicBrainzRateControls = (): void => {
        const isLocal = isLocalDevelopmentServer(settingsMusicBrainzServerUrl.value);
        settingsMusicBrainzRequestRateMs.disabled = !isLocal;
        settingsMusicBrainzRequestRateMs.min = isLocal ? '0' : String(PUBLIC_MIN_RATE_LIMIT_MS);
        if (!isLocal) {
            settingsMusicBrainzRequestRateMs.value = String(normalizedMusicBrainzRequestRateMs());
        }
    };

    const refreshListenBrainzRateControls = (): void => {
        const isLocal = isLocalDevelopmentServer(settingsListenBrainzServerUrl.value);
        settingsListenBrainzRequestRateMs.disabled = !isLocal;
        settingsListenBrainzRequestRateMs.min = isLocal ? '0' : String(PUBLIC_MIN_RATE_LIMIT_MS);
        if (!isLocal) {
            settingsListenBrainzRequestRateMs.value = String(normalizedListenBrainzRequestRateMs());
        }
    };

    const buildFormValues = (): SettingsFormValues => ({
        libraryFolders: libraryFolders.map((folder) => ({ ...folder })),
        ffmpegPath: settingsFFmpegPath.value,
        listenBrainzUserToken: settingsListenBrainzToken.value,
        lastFmApiKey: settingsLastFmApiKey.value,
        lastFmApiSecret: settingsLastFmApiSecret.value,
        lastFmSessionKey: settingsLastFmSessionKey.value,
        scrobbleFilterMode: settingsScrobbleFilterMode.value === 'whitelist' ? 'whitelist' : 'blacklist',
        scrobbleRules: normalizeScrobbleRules(scrobbleRules).map((rule) => ({ ...rule })),
        musicBrainzServerUrl: settingsMusicBrainzServerUrl.value,
        musicBrainzRequestRateMs: normalizedMusicBrainzRequestRateMs(),
        listenBrainzServerUrl: settingsListenBrainzServerUrl.value,
        listenBrainzRequestRateMs: normalizedListenBrainzRequestRateMs(),
        favoritePlaylists: favoritePlaylists.slice(),
        coverArtPriority: coverArtPriority.slice(),
        audioOutputDevice: settingsAudioOutputDevice.value || 'default',
        audioOutputBufferMs: normalizeAudioOutputBufferMs(settingsAudioOutputBufferMs.value),
        gaplessPlayback: settingsGaplessPlayback.checked,
        replayGainEnabled: settingsReplayGain.checked,
        preferMusicBrainzMetadata: settingsPreferMusicBrainzMetadata.checked,
        musicBrainzTagDatabaseEnabled: settingsMusicBrainzTagDatabaseEnabled.checked,
        musicBrainzTagStaleDays: normalizeMusicBrainzTagStaleDays(settingsMusicBrainzTagStaleDays.value),
        musicBrainzTagRequestStaggeringEnabled: settingsMusicBrainzTagRequestStaggeringEnabled.checked,
        musicBrainzTagWorkerCores: normalizeMusicBrainzTagWorkerCores(settingsMusicBrainzTagWorkerCores.value),
        lissajousEnabled: settingsLissajousEnabled.checked,
        uiDitheringEnabled: settingsUiDitheringEnabled.checked,
        minimizeToTrayOnClose: settingsMinimizeToTrayOnClose.checked,
        customSendToActions: normalizeCustomSendToActions(customSendToActions).map((action) => ({ ...action })),
        keyboardShortcuts: getShortcutValues(),
    });

    const refreshMusicBrainzTagWorkerControls = (): void => {
        const disabled = !settingsMusicBrainzTagDatabaseEnabled.checked;
        settingsMusicBrainzTagStaleDays.disabled = disabled;
        settingsMusicBrainzTagRequestStaggeringEnabled.disabled = disabled;
        settingsMusicBrainzTagWorkerCores.disabled = disabled;
    };

    const renderFavoritePlaylistList = (): void => {
        settingsFavoritePlaylistList.innerHTML = '';

        if (favoritePlaylists.length === 0) {
            settingsFavoritePlaylistList.innerHTML = '<li class="settings-favorite-empty">No favourite playlists configured.</li>';
            settingsRemoveFavoritePlaylist.disabled = true;
            return;
        }

        favoritePlaylists.forEach((playlistPath, index) => {
            const item = document.createElement('li');
            item.className = 'settings-favorite-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = `settings-favorite-item-btn${index === selectedFavoritePlaylistIndex ? ' is-selected' : ''}`;
            button.dataset.favoritePlaylistIndex = String(index);
            button.title = playlistPath;
            button.textContent = playlistPath;

            item.append(button);
            settingsFavoritePlaylistList.append(item);
        });

        settingsRemoveFavoritePlaylist.disabled = selectedFavoritePlaylistIndex < 0;
    };

    const renderScrobbleRuleList = (): void => {
        settingsScrobbleRuleList.innerHTML = '';

        if (scrobbleRules.length === 0) {
            settingsScrobbleRuleList.innerHTML = '<li class="settings-folder-empty">No scrobble rules configured.</li>';
            settingsRemoveScrobbleRule.disabled = true;
            return;
        }

        scrobbleRules.forEach((rule, index) => {
            const item = document.createElement('li');
            item.className = 'settings-folder-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = `settings-folder-item-btn${index === selectedScrobbleRuleIndex ? ' is-selected' : ''}`;
            button.dataset.scrobbleRuleIndex = String(index);
            button.title = `${describeScrobbleRule(rule)}\nDouble-click to edit`;
            button.textContent = describeScrobbleRule(rule);

            item.append(button);
            settingsScrobbleRuleList.append(item);
        });

        settingsRemoveScrobbleRule.disabled = selectedScrobbleRuleIndex < 0;
    };

    const formatCustomActionScopeLabel = (scope: CustomSendToActionScope): string => {
        if (scope === 'track') {
            return 'Track';
        }

        if (scope === 'album') {
            return 'Album';
        }

        if (scope === 'folder') {
            return 'Folder';
        }

        return 'File';
    };

    const renderCustomSendToActionList = (): void => {
        settingsSendToActionList.innerHTML = '';

        if (customSendToActions.length === 0) {
            settingsSendToActionList.innerHTML = '<li class="settings-folder-empty">No send to actions configured.</li>';
            settingsRemoveSendToAction.disabled = true;
            return;
        }

        customSendToActions.forEach((action, index) => {
            const item = document.createElement('li');
            item.className = 'settings-folder-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = `settings-folder-item-btn${index === selectedCustomSendToActionIndex ? ' is-selected' : ''}`;
            button.dataset.sendToActionIndex = String(index);
            button.title = `${formatCustomActionScopeLabel(action.scope)}: ${action.commandTemplate}\nDouble-click to edit`;
            button.textContent = `[${formatCustomActionScopeLabel(action.scope)}] ${action.title}`;

            item.append(button);
            settingsSendToActionList.append(item);
        });

        settingsRemoveSendToAction.disabled = selectedCustomSendToActionIndex < 0;
    };

    const setSelectedCustomSendToActionIndex = (nextIndex: number): void => {
        selectedCustomSendToActionIndex = nextIndex >= 0 && nextIndex < customSendToActions.length ? nextIndex : -1;
        renderCustomSendToActionList();
    };

    const renderLibraryFolderList = (): void => {
        settingsLibraryFolderList.innerHTML = '';

        if (libraryFolders.length === 0) {
            settingsLibraryFolderList.innerHTML = '<li class="settings-library-folder-empty">No library folders configured.</li>';
            settingsRemoveLibraryFolder.disabled = true;
            return;
        }

        libraryFolders.forEach((folder, index) => {
            const item = document.createElement('li');
            item.className = 'settings-library-folder-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = `settings-library-folder-item-btn${index === selectedLibraryFolderIndex ? ' is-selected' : ''}`;
            button.dataset.libraryFolderIndex = String(index);
            button.title = [
                folder.label ? `Label: ${folder.label}` : '',
                folder.path,
                'Double-click to change label and release depth',
            ].filter((line) => line !== '').join('\n');

            const pathLabel = document.createElement('span');
            pathLabel.className = 'settings-library-folder-path';
            pathLabel.textContent = folder.path;

            const meta = document.createElement('span');
            meta.className = 'settings-library-folder-meta';

            if (folder.label) {
                const labelBadge = document.createElement('span');
                labelBadge.className = 'settings-library-folder-label-badge';
                labelBadge.textContent = `Label: ${folder.label}`;
                meta.append(labelBadge);
            }

            const depthBadge = document.createElement('span');
            depthBadge.className = 'settings-library-folder-depth-badge';
            depthBadge.textContent = folder.releaseDepth > 0 ? `Depth ${folder.releaseDepth}` : 'Whole folder';

            meta.append(depthBadge);

            button.append(pathLabel, meta);
            item.append(button);
            settingsLibraryFolderList.append(item);
        });

        settingsRemoveLibraryFolder.disabled = selectedLibraryFolderIndex < 0;
    };

    const setSelectedLibraryFolderIndex = (nextIndex: number): void => {
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= libraryFolders.length) {
            selectedLibraryFolderIndex = -1;
        } else {
            selectedLibraryFolderIndex = nextIndex;
        }

        renderLibraryFolderList();
    };

    const formatEtaLabel = (secondsRemaining: number | null): string => {
        if (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
            return '';
        }

        const wholeSeconds = Math.max(1, Math.ceil(secondsRemaining));
        if (wholeSeconds < 60) {
            return `~${wholeSeconds}s`;
        }

        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        if (seconds === 0) {
            return `~${minutes}m`;
        }

        return `~${minutes}m ${seconds}s`;
    };

    const refreshForceReloadStatus = (): void => {
        if (!forceReloadInProgress) {
            return;
        }

        const etaLabel = formatEtaLabel(forceReloadEtaSeconds);
        setSettingsStatusMessage(etaLabel
            ? `Reloading library... ${etaLabel} remaining`
            : 'Reloading library...');
    };

    const setStatusMessageWithFade = (
        element: HTMLParagraphElement,
        message: string,
        getTimer: () => number | undefined,
        setTimer: (value: number | undefined) => void,
    ): void => {
        const activeTimer = getTimer();
        if (activeTimer !== undefined) {
            window.clearTimeout(activeTimer);
            setTimer(undefined);
        }

        element.classList.remove('is-faded');
        element.textContent = message;

        if (message.trim() === '') {
            return;
        }

        const fadeTimer = window.setTimeout(() => {
            element.classList.add('is-faded');
            const clearTimer = window.setTimeout(() => {
                element.textContent = '';
                element.classList.remove('is-faded');
                setTimer(undefined);
            }, settingsModalTransitionMs);
            setTimer(clearTimer);
        }, statusFadeDelayMs);
        setTimer(fadeTimer);
    };

    const setSettingsStatusMessage = (message: string): void => {
        setStatusMessageWithFade(
            settingsStatus,
            message,
            () => settingsStatusFadeTimer,
            (value) => {
                settingsStatusFadeTimer = value;
            },
        );
    };

    const setLibraryDepthStatusMessage = (message: string): void => {
        setStatusMessageWithFade(
            settingsLibraryDepthStatus,
            message,
            () => settingsLibraryDepthStatusFadeTimer,
            (value) => {
                settingsLibraryDepthStatusFadeTimer = value;
            },
        );
    };

    const refreshLastFmSessionFetchButton = (): void => {
        settingsLastFmSessionKeyFetch.disabled = lastFmSessionFetchInProgress || settingsSave.disabled || settingsForceReload.disabled;
        settingsLastFmSessionKeyFetch.textContent = lastFmSessionFetchInProgress ? 'Fetching...' : 'Fetch';
    };

    const setForceReloadEtaSeconds = (secondsRemaining: number | null): void => {
        if (!forceReloadInProgress) {
            return;
        }

        const normalized = (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining <= 0)
            ? null
            : Math.ceil(secondsRemaining);

        if (forceReloadEtaSeconds === normalized) {
            return;
        }

        forceReloadEtaSeconds = normalized;
        refreshForceReloadStatus();
    };

    const setScrobbleRuleStatusMessage = (message: string): void => {
        settingsScrobbleRuleStatus.textContent = message;
    };

    const setSendToActionStatusMessage = (message: string): void => {
        settingsSendToActionStatus.textContent = message;
    };

    const refreshScrobbleRuleDialogControls = (preferredOperator?: ScrobbleRuleOperator): void => {
        const field = asScrobbleRuleField(settingsScrobbleRuleField.value);
        const options = operatorOptionsForScrobbleRuleField(field);
        const currentOperator = preferredOperator ?? (settingsScrobbleRuleOperator.value as ScrobbleRuleOperator);
        settingsScrobbleRuleOperator.innerHTML = '';
        options.forEach((option) => {
            const element = document.createElement('option');
            element.value = option.value;
            element.textContent = option.label;
            settingsScrobbleRuleOperator.append(element);
        });

        const selectedOperator = options.some((option) => option.value === currentOperator)
            ? currentOperator
            : defaultScrobbleRuleOperator(field);
        settingsScrobbleRuleOperator.value = selectedOperator;

        if (field === 'trackLength') {
            settingsScrobbleRuleValueLabel.textContent = 'Threshold (seconds)';
            settingsScrobbleRuleHint.textContent = 'Compare the full track duration in whole seconds.';
            settingsScrobbleRuleValue.type = 'number';
            settingsScrobbleRuleValue.min = '0';
            settingsScrobbleRuleValue.step = '1';
            settingsScrobbleRuleValue.inputMode = 'numeric';
            settingsScrobbleRuleValue.placeholder = '240';
            return;
        }

        settingsScrobbleRuleValueLabel.textContent = field === 'path' ? 'Path or pattern' : 'Text or pattern';
        if (settingsScrobbleRuleOperator.value === 'regex') {
            settingsScrobbleRuleHint.textContent = 'Use /pattern/flags or a raw pattern. Raw patterns are compiled case-insensitively.';
        } else if (field === 'path' && settingsScrobbleRuleOperator.value === 'starts_with') {
            settingsScrobbleRuleHint.textContent = 'Use a folder or full path. Subpaths match automatically.';
        } else if (field === 'anyTag') {
            settingsScrobbleRuleHint.textContent = 'Checks all tag values on the track and matches if any tag contains this value.';
        } else {
            settingsScrobbleRuleHint.textContent = 'Text matching is case-insensitive.';
        }

        settingsScrobbleRuleValue.type = 'text';
        settingsScrobbleRuleValue.inputMode = 'text';
        settingsScrobbleRuleValue.removeAttribute('min');
        settingsScrobbleRuleValue.removeAttribute('step');
        settingsScrobbleRuleValue.placeholder = field === 'path'
            ? 'C:\\Music\\Private'
            : field === 'anyTag'
                ? 'live bootleg'
                : 'Value';
    };

    const closeScrobbleRuleDialog = (value: ScrobbleRuleDialogValues | null, restoreFocus: boolean, immediate = false): void => {
        if (settingsScrobbleRuleModal.hidden && !settingsScrobbleRuleModal.classList.contains('is-visible')) {
            return;
        }

        if (scrobbleRuleHideTimer !== undefined) {
            window.clearTimeout(scrobbleRuleHideTimer);
            scrobbleRuleHideTimer = undefined;
        }

        const resolve = pendingScrobbleRuleResolver;
        pendingScrobbleRuleResolver = null;

        const focusTarget = scrobbleRuleReturnFocusTarget;
        scrobbleRuleReturnFocusTarget = null;

        const finalizeDialogClose = (): void => {
            settingsScrobbleRuleModal.hidden = true;
            settingsScrobbleRuleModal.classList.remove('is-visible');
            settingsScrobbleRuleTitle.textContent = 'Add scrobble rule';
            settingsScrobbleRuleField.value = 'path';
            refreshScrobbleRuleDialogControls('starts_with');
            settingsScrobbleRuleValue.value = '';
            setScrobbleRuleStatusMessage('');
            settingsScrobbleRuleConfirm.textContent = 'Apply';

            resolve?.(value);

            if (restoreFocus && focusTarget) {
                window.requestAnimationFrame(() => {
                    focusTarget.focus();
                });
            }
        };

        if (immediate) {
            finalizeDialogClose();
            return;
        }

        settingsScrobbleRuleModal.classList.remove('is-visible');
        scrobbleRuleHideTimer = window.setTimeout(() => {
            scrobbleRuleHideTimer = undefined;
            finalizeDialogClose();
        }, settingsModalTransitionMs);
    };

    const openScrobbleRuleDialog = (
        initialValues: ScrobbleRuleDialogValues,
        confirmLabel: string,
        title: string,
    ): Promise<ScrobbleRuleDialogValues | null> => {
        closeScrobbleRuleDialog(null, false, true);

        settingsScrobbleRuleTitle.textContent = title;
        settingsScrobbleRuleField.value = initialValues.field;
        refreshScrobbleRuleDialogControls(initialValues.operator);
        settingsScrobbleRuleValue.value = initialValues.value;
        setScrobbleRuleStatusMessage('');
        settingsScrobbleRuleConfirm.textContent = confirmLabel;
        scrobbleRuleReturnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        settingsScrobbleRuleModal.hidden = false;
        settingsScrobbleRuleModal.classList.remove('is-visible');

        window.requestAnimationFrame(() => {
            settingsScrobbleRuleModal.classList.add('is-visible');
            settingsScrobbleRuleValue.focus();
            settingsScrobbleRuleValue.select();
        });

        return new Promise<ScrobbleRuleDialogValues | null>((resolve) => {
            pendingScrobbleRuleResolver = resolve;
        });
    };

    const closeSendToActionDialog = (value: SendToActionDialogValues | null, restoreFocus: boolean, immediate = false): void => {
        if (settingsSendToActionModal.hidden && !settingsSendToActionModal.classList.contains('is-visible')) {
            return;
        }

        if (sendToActionHideTimer !== undefined) {
            window.clearTimeout(sendToActionHideTimer);
            sendToActionHideTimer = undefined;
        }

        const resolve = pendingSendToActionResolver;
        pendingSendToActionResolver = null;

        const focusTarget = sendToActionReturnFocusTarget;
        sendToActionReturnFocusTarget = null;

        const finalizeDialogClose = (): void => {
            settingsSendToActionModal.hidden = true;
            settingsSendToActionModal.classList.remove('is-visible');
            settingsSendToActionTitleInput.value = '';
            settingsSendToActionScopeInput.value = 'track';
            settingsSendToActionCommandInput.value = '';
            settingsSendToActionConfirm.textContent = 'Add action';
            const sendToActionDialogTitle = settingsSendToActionForm.querySelector('#settings-send-to-action-title');
            if (sendToActionDialogTitle instanceof HTMLParagraphElement) {
                sendToActionDialogTitle.textContent = 'Add send to action';
            }
            setSendToActionStatusMessage('');
            resolve?.(value);

            if (restoreFocus && focusTarget) {
                window.requestAnimationFrame(() => {
                    focusTarget.focus();
                });
            }
        };

        if (immediate) {
            finalizeDialogClose();
            return;
        }

        settingsSendToActionModal.classList.remove('is-visible');
        sendToActionHideTimer = window.setTimeout(() => {
            sendToActionHideTimer = undefined;
            finalizeDialogClose();
        }, settingsModalTransitionMs);
    };

    const openSendToActionDialog = (
        initialValues: SendToActionDialogValues,
        confirmLabel: string,
        title: string,
    ): Promise<SendToActionDialogValues | null> => {
        closeSendToActionDialog(null, false, true);

        settingsSendToActionTitleInput.value = initialValues.title;
        settingsSendToActionScopeInput.value = initialValues.scope;
        settingsSendToActionCommandInput.value = initialValues.commandTemplate;
        settingsSendToActionConfirm.textContent = confirmLabel;
        const sendToActionDialogTitle = settingsSendToActionForm.querySelector('#settings-send-to-action-title');
        if (sendToActionDialogTitle instanceof HTMLParagraphElement) {
            sendToActionDialogTitle.textContent = title;
        }
        setSendToActionStatusMessage('');
        sendToActionReturnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        settingsSendToActionModal.hidden = false;
        settingsSendToActionModal.classList.remove('is-visible');

        window.requestAnimationFrame(() => {
            settingsSendToActionModal.classList.add('is-visible');
            settingsSendToActionTitleInput.focus();
            settingsSendToActionTitleInput.select();
        });

        return new Promise<SendToActionDialogValues | null>((resolve) => {
            pendingSendToActionResolver = resolve;
        });
    };

    const editCustomSendToAction = async (index: number): Promise<boolean> => {
        const action = customSendToActions[index];
        if (!action) {
            return false;
        }

        const nextValues = await openSendToActionDialog({ ...action }, 'Save', 'Edit send to action');
        if (nextValues === null) {
            return false;
        }

        customSendToActions[index] = {
            title: nextValues.title,
            scope: nextValues.scope,
            commandTemplate: nextValues.commandTemplate,
        };
        customSendToActions = normalizeCustomSendToActions(customSendToActions);
        selectedCustomSendToActionIndex = customSendToActions.findIndex((candidate) => (
            candidate.title === nextValues.title
                && candidate.scope === nextValues.scope
                && candidate.commandTemplate === nextValues.commandTemplate
        ));
        renderCustomSendToActionList();
        settingsSendToActionList.focus();
        return true;
    };

    const editScrobbleRule = async (index: number): Promise<boolean> => {
        const rule = scrobbleRules[index];
        if (!rule) {
            return false;
        }

        const nextValues = await openScrobbleRuleDialog({ ...rule }, 'Save', 'Scrobble rule');
        if (nextValues === null) {
            return false;
        }

        scrobbleRules[index] = { ...nextValues };
        selectedScrobbleRuleIndex = index;
        renderScrobbleRuleList();
        settingsScrobbleRuleList.focus();
        return true;
    };

    const closeLibraryDepthDialog = (value: LibraryFolderDialogValues | null, restoreFocus: boolean, immediate = false): void => {
        if (settingsLibraryDepthModal.hidden && !settingsLibraryDepthModal.classList.contains('is-visible')) {
            return;
        }

        if (libraryDepthHideTimer !== undefined) {
            window.clearTimeout(libraryDepthHideTimer);
            libraryDepthHideTimer = undefined;
        }

        const resolve = pendingLibraryDepthResolver;
        pendingLibraryDepthResolver = null;

        const focusTarget = libraryDepthReturnFocusTarget;
        libraryDepthReturnFocusTarget = null;

        const finalizeDialogClose = (): void => {
            settingsLibraryDepthModal.hidden = true;
            settingsLibraryDepthModal.classList.remove('is-visible');
            settingsLibraryDepthTitle.textContent = 'Library folder settings';
            settingsLibraryDepthLabelInput.value = '';
            settingsLibraryDepthInput.value = '';
            setLibraryDepthStatusMessage('');
            settingsLibraryDepthConfirm.textContent = 'Apply';

            resolve?.(value);

            if (restoreFocus && focusTarget) {
                window.requestAnimationFrame(() => {
                    focusTarget.focus();
                });
            }
        };

        if (immediate) {
            finalizeDialogClose();
            return;
        }

        settingsLibraryDepthModal.classList.remove('is-visible');
        libraryDepthHideTimer = window.setTimeout(() => {
            libraryDepthHideTimer = undefined;
            finalizeDialogClose();
        }, settingsModalTransitionMs);
    };

    const openLibraryDepthDialog = (
        initialValues: LibraryFolderDialogValues,
        confirmLabel: string,
        title: string,
    ): Promise<LibraryFolderDialogValues | null> => {
        closeLibraryDepthDialog(null, false, true);

        settingsLibraryDepthTitle.textContent = title;
        settingsLibraryDepthLabelInput.value = initialValues.label;
        settingsLibraryDepthInput.value = initialValues.releaseDepth > 0 ? String(initialValues.releaseDepth) : '';
        setLibraryDepthStatusMessage('');
        settingsLibraryDepthConfirm.textContent = confirmLabel;
        libraryDepthReturnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        settingsLibraryDepthModal.hidden = false;
        settingsLibraryDepthModal.classList.remove('is-visible');

        window.requestAnimationFrame(() => {
    	        settingsLibraryDepthModal.classList.add('is-visible');
	        settingsLibraryDepthLabelInput.focus();
	        settingsLibraryDepthLabelInput.select();
        });

        return new Promise<LibraryFolderDialogValues | null>((resolve) => {
            pendingLibraryDepthResolver = resolve;
        });
    };

    const editLibraryFolderSettings = async (index: number): Promise<boolean> => {
        const folder = libraryFolders[index];
        if (!folder) {
            return false;
        }

        const nextValues = await openLibraryDepthDialog({ label: folder.label, releaseDepth: folder.releaseDepth }, 'Save', 'Library folder settings');
        if (nextValues === null) {
            return false;
        }

        folder.label = nextValues.label;
        folder.releaseDepth = nextValues.releaseDepth;
        setSelectedLibraryFolderIndex(index);
        settingsLibraryFolderList.focus();
        return true;
    };

    const labelForCoverArtPriority = (source: CoverArtPrioritySource): string => {
        if (source === 'musicbrainz') {
            return 'Load cover from MusicBrainz';
        }

        if (source === 'embedded') {
            return 'Embedded track artwork';
        }

        return 'Separate image file in release folder';
    };

    const moveCoverArtPriority = (fromIndex: number, toIndex: number): void => {
        if (fromIndex < 0 || toIndex < 0 || fromIndex >= coverArtPriorityOrder.length || toIndex >= coverArtPriorityOrder.length) {
            return;
        }

        if (fromIndex === toIndex) {
            return;
        }

        const next = coverArtPriorityOrder.slice();
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        coverArtPriorityOrder = normalizeCoverArtPriorityOrder(next);
        const enabled = new Set<CoverArtPrioritySource>(coverArtPriority);
        coverArtPriority = coverArtPriorityOrder.filter((source) => enabled.has(source));
    };

    const setCoverArtPrioritySourceEnabled = (source: CoverArtPrioritySource, enabled: boolean): void => {
        const nextEnabled = new Set<CoverArtPrioritySource>(coverArtPriority);
        if (enabled) {
            nextEnabled.add(source);
        } else {
            nextEnabled.delete(source);
        }

        coverArtPriority = coverArtPriorityOrder.filter((candidate) => nextEnabled.has(candidate));
    };

    const clearCoverArtDragState = (): void => {
        draggedCoverPriorityIndex = -1;
        settingsCoverArtPriorityList.classList.remove('is-dragging');
        settingsCoverArtPriorityList.querySelectorAll('.is-drop-target').forEach((node) => {
            node.classList.remove('is-drop-target');
        });
    };

    const renderCoverArtPriorityList = (): void => {
        settingsCoverArtPriorityList.innerHTML = '';

        const enabled = new Set<CoverArtPrioritySource>(coverArtPriority);

        coverArtPriorityOrder.forEach((source, index) => {
            const item = document.createElement('li');
            item.className = 'settings-priority-item';

            const row = document.createElement('div');
            row.className = `settings-priority-item-btn${enabled.has(source) ? '' : ' is-disabled'}`;
            row.dataset.coverArtPriorityIndex = String(index);
            row.draggable = true;
            row.title = 'Drag to change priority';

            const handle = document.createElement('span');
            handle.className = 'settings-priority-handle';
            handle.setAttribute('aria-hidden', 'true');
            handle.textContent = '=';

            const label = document.createElement('label');
            label.className = 'settings-priority-checkbox-row';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'settings-checkbox';
            checkbox.dataset.coverArtPrioritySource = source;
            checkbox.checked = enabled.has(source);

            const text = document.createElement('span');
            text.className = 'settings-priority-label';
            text.textContent = labelForCoverArtPriority(source);

            label.append(checkbox, text);
            row.append(handle, label);

            item.append(row);
            settingsCoverArtPriorityList.append(item);
        });
    };

    const settingsTabButtons: Record<SettingsPrimaryTab, HTMLButtonElement> = {
        general: settingsTabGeneral,
        network: settingsTabNetwork,
        database: settingsTabDatabase,
        playlists: settingsTabPlaylists,
        scrobbling: settingsTabScrobbling,
        audio: settingsTabAudio,
        ui: settingsTabUi,
        actions: settingsTabActions,
    };

    const updateTabScrollControls = (): void => {
        const maxScrollLeft = settingsTabs.scrollWidth - settingsTabs.clientWidth;
        const canScroll = maxScrollLeft > 1;
        settingsTabsScrollLeft.hidden = !canScroll;
        settingsTabsScrollRight.hidden = !canScroll;
        const hasLeftOverflow = canScroll && settingsTabs.scrollLeft > 1;
        const hasRightOverflow = canScroll && settingsTabs.scrollLeft < maxScrollLeft - 1;
        settingsTabsScrollLeft.disabled = !hasLeftOverflow;
        settingsTabsScrollRight.disabled = !hasRightOverflow;
        if (settingsTabsShell) {
            settingsTabsShell.classList.toggle('has-left-overflow', hasLeftOverflow);
            settingsTabsShell.classList.toggle('has-right-overflow', hasRightOverflow);
        }
    };

    const scrollTabsBy = (offsetPx: number): void => {
        settingsTabs.scrollBy({ left: offsetPx, behavior: 'smooth' });
    };

    const ensureTabIsVisible = (tabButton: HTMLButtonElement): void => {
        const tabLeft = tabButton.offsetLeft;
        const tabRight = tabLeft + tabButton.offsetWidth;
        const currentLeft = settingsTabs.scrollLeft;
        const currentRight = currentLeft + settingsTabs.clientWidth;

        if (tabLeft < currentLeft) {
            settingsTabs.scrollTo({ left: Math.max(0, tabLeft - 8), behavior: 'smooth' });
            return;
        }

        if (tabRight > currentRight) {
            const nextLeft = tabRight - settingsTabs.clientWidth + 8;
            settingsTabs.scrollTo({ left: Math.max(0, nextLeft), behavior: 'smooth' });
        }
    };

    const setActiveTab = (tab: SettingsTab): void => {
        const primaryTab = resolvePrimaryTab(tab);
        const generalActive = primaryTab === 'general';
        const networkActive = primaryTab === 'network';
        const databaseActive = primaryTab === 'database';
        const playlistsActive = primaryTab === 'playlists';
        const scrobblingActive = primaryTab === 'scrobbling';
        const audioActive = primaryTab === 'audio';
        const uiActive = primaryTab === 'ui';
        const actionsActive = primaryTab === 'actions';
        settingsTabGeneral.classList.toggle('is-active', generalActive);
        settingsTabNetwork.classList.toggle('is-active', networkActive);
        settingsTabDatabase.classList.toggle('is-active', databaseActive);
        settingsTabPlaylists.classList.toggle('is-active', playlistsActive);
        settingsTabScrobbling.classList.toggle('is-active', scrobblingActive);
        settingsTabAudio.classList.toggle('is-active', audioActive);
        settingsTabUi.classList.toggle('is-active', uiActive);
        settingsTabActions.classList.toggle('is-active', actionsActive);
        settingsTabGeneral.setAttribute('aria-selected', generalActive ? 'true' : 'false');
        settingsTabNetwork.setAttribute('aria-selected', networkActive ? 'true' : 'false');
        settingsTabDatabase.setAttribute('aria-selected', databaseActive ? 'true' : 'false');
        settingsTabPlaylists.setAttribute('aria-selected', playlistsActive ? 'true' : 'false');
        settingsTabScrobbling.setAttribute('aria-selected', scrobblingActive ? 'true' : 'false');
        settingsTabAudio.setAttribute('aria-selected', audioActive ? 'true' : 'false');
        settingsTabUi.setAttribute('aria-selected', uiActive ? 'true' : 'false');
        settingsTabActions.setAttribute('aria-selected', actionsActive ? 'true' : 'false');
        settingsPanelGeneral.hidden = !generalActive;
        settingsPanelNetwork.hidden = !networkActive;
        settingsPanelDatabase.hidden = !databaseActive;
        settingsPanelPlaylists.hidden = !playlistsActive;
        settingsPanelScrobbling.hidden = !scrobblingActive;
        settingsPanelAudio.hidden = !audioActive;
        settingsPanelUi.hidden = !uiActive;
        settingsPanelActions.hidden = !actionsActive;
        ensureTabIsVisible(settingsTabButtons[primaryTab]);
    };

    const normalizeAudioOutputBufferMs = (rawValue: string): number => {
        const trimmed = rawValue.trim();
        if (trimmed === '') {
            return 0;
        }

        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 0;
        }

        return Math.min(1000, parsed);
    };

    const renderAudioOutputDeviceOptions = (selectedDevice: string): void => {
        settingsAudioOutputDevice.innerHTML = '';

        const primaryDriverOption = document.createElement('option');
        primaryDriverOption.value = 'default';
        primaryDriverOption.textContent = 'Primary Sound Driver';
        settingsAudioOutputDevice.append(primaryDriverOption);

        const normalizedDevices = audioOutputDevices.length > 0
            ? audioOutputDevices
            : [{ id: 'default', name: 'System default output device', backend: 'auto', isDefault: true }];

        normalizedDevices.forEach((device) => {
            const normalizedId = (device.id || 'default').trim() || 'default';
            if (normalizedId === 'default') {
                return;
            }

            const option = document.createElement('option');
            option.value = normalizedId;
            const deviceName = device.name || device.id || 'System default output device';
            option.textContent = deviceName;
            settingsAudioOutputDevice.append(option);
        });

        const targetDevice = selectedDevice.trim() || 'default';
        if (targetDevice === 'default') {
            settingsAudioOutputDevice.value = 'default';
            return;
        }

        const hasExact = normalizedDevices.some((device) => (device.id || 'default') === targetDevice);
        if (!hasExact) {
            const fallbackOption = document.createElement('option');
            fallbackOption.value = targetDevice;
            fallbackOption.textContent = `${targetDevice} (saved)`;
            settingsAudioOutputDevice.append(fallbackOption);
        }

        settingsAudioOutputDevice.value = hasExact ? targetDevice : targetDevice;
    };

    const refreshAudioOutputDevices = (devices: AudioOutputDevice[], selectedDevice: string): void => {
        audioOutputDevices = Array.isArray(devices) ? devices.slice() : [];
        renderAudioOutputDeviceOptions(selectedDevice);
    };

    const getShortcutValues = (): FocusedKeyboardShortcuts => {
        return normalizeFocusedKeyboardShortcuts({
            playPauseToggle: settingsShortcutPlayPauseToggle.value,
            nextTrack: settingsShortcutNextTrack.value,
            previousTrack: settingsShortcutPreviousTrack.value,
            stopPlayback: settingsShortcutStopPlayback.value,
            focusLibraryFilter: settingsShortcutFocusLibraryFilter.value,
            openSettings: settingsShortcutOpenSettings.value,
        });
    };

    const setShortcutValues = (shortcuts: FocusedKeyboardShortcuts): void => {
        settingsShortcutPlayPauseToggle.value = shortcuts.playPauseToggle;
        settingsShortcutNextTrack.value = shortcuts.nextTrack;
        settingsShortcutPreviousTrack.value = shortcuts.previousTrack;
        settingsShortcutStopPlayback.value = shortcuts.stopPlayback;
        settingsShortcutFocusLibraryFilter.value = shortcuts.focusLibraryFilter;
        settingsShortcutOpenSettings.value = shortcuts.openSettings;
    };

    const bindShortcutCaptureInput = (input: HTMLInputElement): void => {
        input.addEventListener('focus', () => {
            input.select();
        });

        input.addEventListener('keydown', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.key === 'Delete') {
                input.value = '';
                return;
            }

            const binding = formatShortcutBindingFromKeyboardEvent(event);
            if (!binding) {
                return;
            }

            input.value = binding;
        });

        input.addEventListener('keyup', (event) => {
            if (event.code !== 'CapsLock') {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
        });
    };

    bindShortcutCaptureInput(settingsShortcutPlayPauseToggle);
    bindShortcutCaptureInput(settingsShortcutNextTrack);
    bindShortcutCaptureInput(settingsShortcutPreviousTrack);
    bindShortcutCaptureInput(settingsShortcutStopPlayback);
    bindShortcutCaptureInput(settingsShortcutFocusLibraryFilter);
    bindShortcutCaptureInput(settingsShortcutOpenSettings);

    setShortcutAccordionExpanded(false, false);
    setCoverArtPriorityAccordionExpanded(false, false);
    renderMusicBrainzTagWorkerProgress(musicBrainzTagWorkerProgress);
    refreshLastFmSessionFetchButton();

    settingsLibraryDepthLabelInput.addEventListener('input', () => {
        setLibraryDepthStatusMessage('');
    });

    settingsLibraryDepthInput.addEventListener('input', () => {
        setLibraryDepthStatusMessage('');
    });

    settingsScrobbleRuleField.addEventListener('change', () => {
        refreshScrobbleRuleDialogControls();
        setScrobbleRuleStatusMessage('');
    });

    settingsScrobbleRuleOperator.addEventListener('change', () => {
        refreshScrobbleRuleDialogControls(settingsScrobbleRuleOperator.value as ScrobbleRuleOperator);
        setScrobbleRuleStatusMessage('');
    });

    settingsScrobbleRuleValue.addEventListener('input', () => {
        setScrobbleRuleStatusMessage('');
    });

    settingsSendToActionTitleInput.addEventListener('input', () => {
        setSendToActionStatusMessage('');
    });

    settingsSendToActionCommandInput.addEventListener('input', () => {
        setSendToActionStatusMessage('');
    });

    settingsFFmpegPath.addEventListener('input', () => {
        setSettingsStatusMessage('');
    });

    settingsLastFmApiKey.addEventListener('input', () => {
        setSettingsStatusMessage('');
    });

    settingsLastFmApiSecret.addEventListener('input', () => {
        setSettingsStatusMessage('');
    });

    settingsLastFmSessionKey.addEventListener('input', () => {
        setSettingsStatusMessage('');
    });

    settingsLibraryDepthBackdrop.addEventListener('click', () => {
        closeLibraryDepthDialog(null, true);
    });

    settingsLibraryDepthCancel.addEventListener('click', () => {
        closeLibraryDepthDialog(null, true);
    });

    settingsScrobbleRuleBackdrop.addEventListener('click', () => {
        closeScrobbleRuleDialog(null, true);
    });

    settingsScrobbleRuleCancel.addEventListener('click', () => {
        closeScrobbleRuleDialog(null, true);
    });

    settingsSendToActionBackdrop.addEventListener('click', () => {
        closeSendToActionDialog(null, true);
    });

    settingsSendToActionCancel.addEventListener('click', () => {
        closeSendToActionDialog(null, true);
    });

    settingsLibraryDepthForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const normalizedLabel = normalizeLibraryFolderLabel(settingsLibraryDepthLabelInput.value);

        const trimmed = settingsLibraryDepthInput.value.trim();
        if (trimmed === '') {
            closeLibraryDepthDialog({ label: normalizedLabel, releaseDepth: 0 }, false);
            return;
        }

        if (!/^\d+$/.test(trimmed)) {
            setLibraryDepthStatusMessage('Enter a whole number 0 or greater.');
            settingsLibraryDepthInput.focus();
            settingsLibraryDepthInput.select();
            return;
        }

        closeLibraryDepthDialog({
            label: normalizedLabel,
            releaseDepth: asReleaseDepth(Number.parseInt(trimmed, 10)),
        }, false);
    });

    settingsScrobbleRuleForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const field = asScrobbleRuleField(settingsScrobbleRuleField.value);
        const operator = settingsScrobbleRuleOperator.value as ScrobbleRuleOperator;
        const value = settingsScrobbleRuleValue.value.trim();
        if (value === '') {
            setScrobbleRuleStatusMessage(field === 'trackLength'
                ? 'Enter a whole number 0 or greater.'
                : 'Enter a value for this rule.');
            settingsScrobbleRuleValue.focus();
            settingsScrobbleRuleValue.select();
            return;
        }

        if (field === 'trackLength' && !/^\d+$/.test(value)) {
            setScrobbleRuleStatusMessage('Enter a whole number 0 or greater.');
            settingsScrobbleRuleValue.focus();
            settingsScrobbleRuleValue.select();
            return;
        }

        const nextRules = normalizeScrobbleRules([{ field, operator, value }]);
        if (nextRules.length === 0) {
            setScrobbleRuleStatusMessage(field === 'trackLength'
                ? 'Enter a whole number 0 or greater.'
                : 'Enter a valid value for this rule.');
            settingsScrobbleRuleValue.focus();
            settingsScrobbleRuleValue.select();
            return;
        }

        const validationMessage = validateScrobbleRules(nextRules);
        if (validationMessage) {
            setScrobbleRuleStatusMessage(validationMessage);
            settingsScrobbleRuleValue.focus();
            settingsScrobbleRuleValue.select();
            return;
        }

        closeScrobbleRuleDialog(nextRules[0], false);
    });

    settingsSendToActionForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const title = settingsSendToActionTitleInput.value.trim();
        if (title === '') {
            setSendToActionStatusMessage('Enter a title for the send to action.');
            settingsSendToActionTitleInput.focus();
            settingsSendToActionTitleInput.select();
            return;
        }

        const scope = asCustomSendToActionScope(settingsSendToActionScopeInput.value);
        if (scope === null) {
            setSendToActionStatusMessage('Choose a valid action scope.');
            settingsSendToActionScopeInput.focus();
            return;
        }

        const commandTemplate = settingsSendToActionCommandInput.value.trim();
        if (commandTemplate === '') {
            setSendToActionStatusMessage('Enter a command template for the send to action.');
            settingsSendToActionCommandInput.focus();
            settingsSendToActionCommandInput.select();
            return;
        }

        closeSendToActionDialog({
            title,
            scope,
            commandTemplate,
        }, false);
    });

    const finalizeClose = (): void => {
        closeLibraryDepthDialog(null, false, true);
        closeScrobbleRuleDialog(null, false, true);
        closeSendToActionDialog(null, false, true);
        settingsModal.classList.remove('is-visible');
        lastLibraryFolderClickIndex = -1;
        lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
        lastScrobbleRuleClickIndex = -1;
        lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
        lastCustomSendToActionClickIndex = -1;
        lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;

        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
        }

        hideTimer = window.setTimeout(() => {
            settingsModal.hidden = true;
            setSettingsStatusMessage('');
            hideTimer = undefined;
        }, settingsModalTransitionMs);
    };

    const requestClose = async (): Promise<boolean> => {
        const blockedMessage = await options.beforeClose?.() || null;
        if (blockedMessage) {
            options.onCloseBlocked?.(blockedMessage);
            return false;
        }

        finalizeClose();
        return true;
    };

    const open = (initialTab: SettingsTab = 'general'): void => {
        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
            hideTimer = undefined;
        }

        const values = options.getValues();
        libraryFolders = normalizeLibraryFolders(values.libraryFolders);
        settingsFFmpegPath.value = values.ffmpegPath || '';
        settingsListenBrainzToken.value = values.listenBrainzUserToken || '';
        settingsLastFmApiKey.value = values.lastFmApiKey || '';
        settingsLastFmApiSecret.value = values.lastFmApiSecret || '';
        settingsLastFmSessionKey.value = values.lastFmSessionKey || '';
        settingsScrobbleFilterMode.value = values.scrobbleFilterMode === 'whitelist' ? 'whitelist' : 'blacklist';
        scrobbleRules = normalizeScrobbleRules(values.scrobbleRules);
        settingsMusicBrainzServerUrl.value = values.musicBrainzServerUrl || '';
        settingsMusicBrainzRequestRateMs.value = values.musicBrainzRequestRateMs > 0 ? String(values.musicBrainzRequestRateMs) : '';
        settingsListenBrainzServerUrl.value = values.listenBrainzServerUrl || '';
        settingsListenBrainzRequestRateMs.value = values.listenBrainzRequestRateMs > 0 ? String(values.listenBrainzRequestRateMs) : '';
        refreshMusicBrainzRateControls();
        refreshListenBrainzRateControls();
        refreshAudioOutputDevices(values.audioOutputDevices, values.audioOutputDevice || 'default');
        settingsAudioOutputBufferMs.value = values.audioOutputBufferMs > 0 ? String(values.audioOutputBufferMs) : '';
        settingsGaplessPlayback.checked = !!values.gaplessPlayback;
        settingsReplayGain.checked = !!values.replayGainEnabled;
        settingsPreferMusicBrainzMetadata.checked = !!values.preferMusicBrainzMetadata;
        settingsMusicBrainzTagDatabaseEnabled.checked = !!values.musicBrainzTagDatabaseEnabled;
        settingsMusicBrainzTagStaleDays.value = String(values.musicBrainzTagStaleDays);
        settingsMusicBrainzTagRequestStaggeringEnabled.checked = !!values.musicBrainzTagRequestStaggeringEnabled;
        settingsMusicBrainzTagWorkerCores.value = values.musicBrainzTagWorkerCores > 0 ? String(values.musicBrainzTagWorkerCores) : '';
        settingsLissajousEnabled.checked = values.lissajousEnabled !== false;
        settingsUiDitheringEnabled.checked = values.uiDitheringEnabled !== false;
        settingsMinimizeToTrayOnClose.checked = !!values.minimizeToTrayOnClose;
        refreshMusicBrainzTagWorkerControls();
        renderMusicBrainzTagWorkerProgress(values.musicBrainzTagWorkerProgress);
        settingsPlayerCardLayout.value = options.getPlayerCardLayout();
        setShortcutValues(normalizeFocusedKeyboardShortcuts(values.keyboardShortcuts));
        favoritePlaylists = normalizeFavoritePlaylists(values.favoritePlaylists);
        customSendToActions = normalizeCustomSendToActions(values.customSendToActions || []);
        coverArtPriority = normalizeCoverArtPriority(values.coverArtPriority);
        coverArtPriorityOrder = normalizeCoverArtPriorityOrder(values.coverArtPriority);
        selectedLibraryFolderIndex = libraryFolders.length > 0 ? 0 : -1;
        selectedFavoritePlaylistIndex = -1;
        selectedScrobbleRuleIndex = -1;
        selectedCustomSendToActionIndex = -1;
        lastLibraryFolderClickIndex = -1;
        lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
        lastScrobbleRuleClickIndex = -1;
        lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
        lastCustomSendToActionClickIndex = -1;
        lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;
        renderLibraryFolderList();
        renderFavoritePlaylistList();
        renderScrobbleRuleList();
        renderCustomSendToActionList();
        renderCoverArtPriorityList();
        if (forceReloadInProgress) {
            refreshForceReloadStatus();
        } else {
            setSettingsStatusMessage('');
        }
        refreshLastFmSessionFetchButton();
        const primaryTab = resolvePrimaryTab(initialTab);
        const shortcutsRequested = initialTab === 'shortcuts';
        setShortcutAccordionExpanded(shortcutsRequested, false);
        setCoverArtPriorityAccordionExpanded(false, false);
        setActiveTab(initialTab);
        settingsModal.hidden = false;
        window.requestAnimationFrame(() => {
            settingsModal.classList.add('is-visible');
            updateTabScrollControls();
            if (shortcutsRequested) {
                scrollShortcutAccordionIntoView();
            }
        });
        if (primaryTab === 'general') {
            if (settingsFFmpegPath.value.trim() === '') {
                settingsFFmpegPath.focus();
                return;
            }
            if (libraryFolders.length > 0) {
                settingsLibraryFolderList.focus();
                return;
            }

            settingsAddLibraryFolder.focus();
            return;
        }
        if (primaryTab === 'network') {
            settingsMusicBrainzServerUrl.focus();
            return;
        }
        if (primaryTab === 'database') {
            settingsMusicBrainzTagDatabaseEnabled.focus();
            return;
        }
        if (primaryTab === 'playlists') {
            settingsFavoritePlaylistList.focus();
            return;
        }
        if (primaryTab === 'scrobbling') {
            settingsScrobbleFilterMode.focus();
            return;
        }
        if (primaryTab === 'audio') {
            settingsAudioOutputDevice.focus();
            return;
        }
        if (primaryTab === 'actions') {
            settingsAddSendToAction.focus();
            return;
        }
        if (shortcutsRequested) {
            settingsShortcutPlayPauseToggle.focus();
            return;
        }

        settingsPlayerCardLayout.focus();
    };

    trigger.addEventListener('click', () => {
        open();
    });

    settingsBackdrop.addEventListener('click', () => {
        void requestClose();
    });

    settingsClose.addEventListener('click', () => {
        void requestClose();
    });

    settingsAddLibraryFolder.addEventListener('click', async () => {
        setSettingsStatusMessage('');

        try {
            const selectedFolder = await options.selectLibraryFolder();
            if (!selectedFolder) {
                return;
            }

            const selectedFolderKey = libraryFolderPathKey(selectedFolder);
            const existingIndex = libraryFolders.findIndex((folder) => libraryFolderPathKey(folder.path) === selectedFolderKey);
            const existingFolder = existingIndex >= 0 ? libraryFolders[existingIndex] : null;

            const nextValues = await openLibraryDepthDialog(
                {
                    label: existingFolder?.label || '',
                    releaseDepth: existingFolder?.releaseDepth || 0,
                },
                existingFolder ? 'Save' : 'Add folder',
                existingFolder ? 'Library folder settings' : 'Add library folder',
            );
            if (nextValues === null) {
                return;
            }

            if (existingIndex >= 0) {
                libraryFolders[existingIndex] = {
                    ...libraryFolders[existingIndex],
                    label: nextValues.label,
                    releaseDepth: nextValues.releaseDepth,
                };
                setSelectedLibraryFolderIndex(existingIndex);
                settingsLibraryFolderList.focus();
                return;
            }

            libraryFolders = normalizeLibraryFolders([...libraryFolders, {
                path: selectedFolder,
                label: nextValues.label,
                releaseDepth: nextValues.releaseDepth,
            }]);
            setSelectedLibraryFolderIndex(libraryFolders.findIndex((folder) => libraryFolderPathKey(folder.path) === selectedFolderKey));
            settingsLibraryFolderList.focus();
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage('Unable to open folder picker.');
        }
    });

    settingsTabGeneral.addEventListener('click', () => {
        setActiveTab('general');
        if (libraryFolders.length > 0) {
            settingsLibraryFolderList.focus();
            return;
        }

        settingsAddLibraryFolder.focus();
    });

    settingsTabNetwork.addEventListener('click', () => {
        setActiveTab('network');
        settingsMusicBrainzServerUrl.focus();
    });

    settingsTabDatabase.addEventListener('click', () => {
        setActiveTab('database');
        settingsMusicBrainzTagDatabaseEnabled.focus();
    });

    settingsTabPlaylists.addEventListener('click', () => {
        setActiveTab('playlists');
        settingsFavoritePlaylistList.focus();
    });

    settingsTabAudio.addEventListener('click', () => {
        setActiveTab('audio');
        settingsAudioOutputDevice.focus();
    });

    settingsTabScrobbling.addEventListener('click', () => {
        setActiveTab('scrobbling');
        settingsScrobbleFilterMode.focus();
    });

    settingsTabActions.addEventListener('click', () => {
        setActiveTab('actions');
        settingsAddSendToAction.focus();
    });

    settingsTabsScrollLeft.addEventListener('click', () => {
        scrollTabsBy(-settingsTabScrollStepPx);
    });

    settingsTabsScrollRight.addEventListener('click', () => {
        scrollTabsBy(settingsTabScrollStepPx);
    });

    settingsTabs.addEventListener('wheel', (event) => {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        if (delta === 0) {
            return;
        }

        event.preventDefault();
        settingsTabs.scrollBy({ left: delta, behavior: 'auto' });
    }, { passive: false });

    settingsTabs.addEventListener('scroll', () => {
        updateTabScrollControls();
    });

    window.addEventListener('resize', () => {
        updateTabScrollControls();
    });

    settingsMusicBrainzTagDatabaseEnabled.addEventListener('change', () => {
        refreshMusicBrainzTagWorkerControls();
    });

    settingsMusicBrainzServerUrl.addEventListener('input', () => {
        refreshMusicBrainzRateControls();
    });

    settingsListenBrainzServerUrl.addEventListener('input', () => {
        refreshListenBrainzRateControls();
    });

    settingsApplyAudioNow.addEventListener('click', async () => {
        if (settingsApplyAudioNow.disabled) {
            return;
        }

        settingsApplyAudioNow.disabled = true;
        setSettingsStatusMessage('Refreshing audio settings...');

        try {
            const formValues = buildFormValues();
            const validationMessage = validateScrobbleRules(formValues.scrobbleRules);
            if (validationMessage) {
                throw new Error(validationMessage);
            }

            const refreshedDevices = await options.applyAudioNow(formValues);
            refreshAudioOutputDevices(refreshedDevices, formValues.audioOutputDevice || 'default');
            setSettingsStatusMessage('Audio settings refreshed.');
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage('Unable to refresh audio settings right now.');
        } finally {
            settingsApplyAudioNow.disabled = false;
        }
    });

    settingsLastFmSessionKeyFetch.addEventListener('click', async () => {
        if (settingsLastFmSessionKeyFetch.disabled || lastFmSessionFetchInProgress) {
            return;
        }

        const apiKey = settingsLastFmApiKey.value.trim();
        if (apiKey === '') {
            setSettingsStatusMessage('Enter your Last.fm API key first.');
            settingsLastFmApiKey.focus();
            settingsLastFmApiKey.select();
            return;
        }

        const apiSecret = settingsLastFmApiSecret.value.trim();
        if (apiSecret === '') {
            setSettingsStatusMessage('Enter your Last.fm shared secret first.');
            settingsLastFmApiSecret.focus();
            settingsLastFmApiSecret.select();
            return;
        }

        lastFmSessionFetchInProgress = true;
        refreshLastFmSessionFetchButton();
        setSettingsStatusMessage('Opening Last.fm authorization...');

        try {
            const sessionKey = (await options.fetchLastFmSessionKey(apiKey, apiSecret)).trim();
            if (sessionKey === '') {
                throw new Error('Last.fm returned an empty session key.');
            }

            settingsLastFmSessionKey.value = sessionKey;
            setSettingsStatusMessage('Last.fm session key fetched. Save settings to keep it.');
            settingsLastFmSessionKey.focus();
            settingsLastFmSessionKey.select();
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage(error instanceof Error && error.message.trim() !== ''
                ? error.message
                : 'Unable to fetch Last.fm session key right now.');
        } finally {
            lastFmSessionFetchInProgress = false;
            refreshLastFmSessionFetchButton();
        }
    });

    settingsTabUi.addEventListener('click', () => {
        setActiveTab('ui');
        settingsPlayerCardLayout.focus();
    });

    settingsShortcutAccordionToggle.addEventListener('click', () => {
        const shouldExpand = settingsShortcutAccordionPanel.hidden !== false;
        setShortcutAccordionExpanded(shouldExpand);
        if (shouldExpand) {
            window.requestAnimationFrame(() => {
                scrollShortcutAccordionIntoView();
            });
        }
    });

    settingsCoverArtPriorityAccordionToggle.addEventListener('click', () => {
        const shouldExpand = settingsCoverArtPriorityAccordionPanel.hidden !== false;
        setCoverArtPriorityAccordionExpanded(shouldExpand);
        if (shouldExpand) {
            window.requestAnimationFrame(() => {
                scrollCoverArtPriorityAccordionIntoView();
            });
        }
    });

    settingsPlayerCardLayout.addEventListener('change', () => {
        const layout = settingsPlayerCardLayout.value === 'release' ? 'release' : 'default';
        options.setPlayerCardLayout(layout);
    });

    settingsFavoritePlaylistList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('[data-favorite-playlist-index]');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const nextIndex = Number(button.dataset.favoritePlaylistIndex);
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= favoritePlaylists.length) {
            return;
        }

        selectedFavoritePlaylistIndex = nextIndex;
        renderFavoritePlaylistList();
    });

    settingsScrobbleRuleList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('[data-scrobble-rule-index]');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const nextIndex = Number(button.dataset.scrobbleRuleIndex);
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= scrobbleRules.length) {
            return;
        }

        const isRepeatClick = nextIndex === lastScrobbleRuleClickIndex
            && event.timeStamp - lastScrobbleRuleClickAt <= libraryFolderRepeatClickWindowMs;

        lastScrobbleRuleClickIndex = nextIndex;
        lastScrobbleRuleClickAt = event.timeStamp;
        selectedScrobbleRuleIndex = nextIndex;
        renderScrobbleRuleList();

        if (!isRepeatClick) {
            return;
        }

        lastScrobbleRuleClickIndex = -1;
        lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
        void editScrobbleRule(nextIndex);
    });

    settingsSendToActionList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('[data-send-to-action-index]');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const nextIndex = Number(button.dataset.sendToActionIndex);
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= customSendToActions.length) {
            return;
        }

        const isRepeatClick = nextIndex === lastCustomSendToActionClickIndex
            && event.timeStamp - lastCustomSendToActionClickAt <= libraryFolderRepeatClickWindowMs;
        lastCustomSendToActionClickIndex = nextIndex;
        lastCustomSendToActionClickAt = event.timeStamp;
        setSelectedCustomSendToActionIndex(nextIndex);

        if (!isRepeatClick) {
            return;
        }

        lastCustomSendToActionClickIndex = -1;
        lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;
        void editCustomSendToAction(nextIndex);
    });

    settingsLibraryFolderList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('[data-library-folder-index]');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const nextIndex = Number(button.dataset.libraryFolderIndex);
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= libraryFolders.length) {
            return;
        }

        const isRepeatClick = nextIndex === lastLibraryFolderClickIndex
            && event.timeStamp - lastLibraryFolderClickAt <= libraryFolderRepeatClickWindowMs;

        lastLibraryFolderClickIndex = nextIndex;
        lastLibraryFolderClickAt = event.timeStamp;
        setSelectedLibraryFolderIndex(nextIndex);

        if (!isRepeatClick) {
            return;
        }

        lastLibraryFolderClickIndex = -1;
        lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
	    void editLibraryFolderSettings(nextIndex);
    });

    settingsRemoveLibraryFolder.addEventListener('click', () => {
        if (selectedLibraryFolderIndex < 0 || selectedLibraryFolderIndex >= libraryFolders.length) {
            return;
        }

        libraryFolders.splice(selectedLibraryFolderIndex, 1);
        if (libraryFolders.length === 0) {
            selectedLibraryFolderIndex = -1;
        } else if (selectedLibraryFolderIndex >= libraryFolders.length) {
            selectedLibraryFolderIndex = libraryFolders.length - 1;
        }

        renderLibraryFolderList();
    });

    settingsCoverArtPriorityList.addEventListener('dragstart', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const item = target.closest('[data-cover-art-priority-index]');
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const index = Number(item.dataset.coverArtPriorityIndex);
        if (!Number.isInteger(index) || index < 0 || index >= coverArtPriorityOrder.length) {
            return;
        }

        draggedCoverPriorityIndex = index;
        settingsCoverArtPriorityList.classList.add('is-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
        }
    });

    settingsCoverArtPriorityList.addEventListener('dragover', (event) => {
        if (draggedCoverPriorityIndex < 0) {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const item = target.closest('[data-cover-art-priority-index]');
        if (!(item instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        settingsCoverArtPriorityList.querySelectorAll('.is-drop-target').forEach((node) => {
            if (node !== item) {
                node.classList.remove('is-drop-target');
            }
        });
        item.classList.add('is-drop-target');
    });

    settingsCoverArtPriorityList.addEventListener('drop', (event) => {
        if (draggedCoverPriorityIndex < 0) {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            clearCoverArtDragState();
            return;
        }

        const item = target.closest('[data-cover-art-priority-index]');
        if (!(item instanceof HTMLElement)) {
            clearCoverArtDragState();
            return;
        }

        event.preventDefault();
        const destinationIndex = Number(item.dataset.coverArtPriorityIndex);
        if (!Number.isInteger(destinationIndex)) {
            clearCoverArtDragState();
            return;
        }

        moveCoverArtPriority(draggedCoverPriorityIndex, destinationIndex);
        clearCoverArtDragState();
        renderCoverArtPriorityList();
    });

    settingsCoverArtPriorityList.addEventListener('dragend', () => {
        clearCoverArtDragState();
    });

    settingsCoverArtPriorityList.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') {
            return;
        }

        const source = target.dataset.coverArtPrioritySource;
        if (source !== 'file' && source !== 'embedded' && source !== 'musicbrainz') {
            return;
        }

        setCoverArtPrioritySourceEnabled(source, target.checked);
        renderCoverArtPriorityList();
    });

    settingsAddFavoritePlaylist.addEventListener('click', async () => {
        setSettingsStatusMessage('');

        try {
            const selectedPlaylist = await options.selectPlaylistFile();
            if (!selectedPlaylist) {
                return;
            }

            favoritePlaylists = normalizeFavoritePlaylists([...favoritePlaylists, selectedPlaylist]);
            selectedFavoritePlaylistIndex = favoritePlaylists.findIndex((playlistPath) => playlistPath === selectedPlaylist.trim());
            renderFavoritePlaylistList();
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage('Unable to open playlist picker.');
        }
    });

    settingsAddScrobbleRule.addEventListener('click', async () => {
        setSettingsStatusMessage('');

        const nextRule = await openScrobbleRuleDialog({ field: 'path', operator: 'starts_with', value: '' }, 'Add rule', 'Add scrobble rule');
        if (nextRule === null) {
            return;
        }

        scrobbleRules = normalizeScrobbleRules([...scrobbleRules, nextRule]);
        selectedScrobbleRuleIndex = scrobbleRules.findIndex((rule) => (
            rule.field === nextRule.field && rule.operator === nextRule.operator && rule.value === nextRule.value
        ));
        renderScrobbleRuleList();
    });

    settingsAddSendToAction.addEventListener('click', async () => {
        const nextAction = await openSendToActionDialog({
            title: '',
            scope: 'track',
            commandTemplate: '',
        }, 'Add action', 'Add send to action');
        if (nextAction === null) {
            return;
        }

        customSendToActions = normalizeCustomSendToActions([...customSendToActions, {
            title: nextAction.title,
            scope: nextAction.scope,
            commandTemplate: nextAction.commandTemplate,
        }]);
        selectedCustomSendToActionIndex = customSendToActions.findIndex((candidate) => (
            candidate.title === nextAction.title
                && candidate.scope === nextAction.scope
                && candidate.commandTemplate === nextAction.commandTemplate
        ));
        renderCustomSendToActionList();
        setSettingsStatusMessage('');
        settingsSendToActionList.focus();
    });

    settingsRemoveFavoritePlaylist.addEventListener('click', () => {
        if (selectedFavoritePlaylistIndex < 0 || selectedFavoritePlaylistIndex >= favoritePlaylists.length) {
            return;
        }

        favoritePlaylists.splice(selectedFavoritePlaylistIndex, 1);
        selectedFavoritePlaylistIndex = -1;
        renderFavoritePlaylistList();
    });

    settingsRemoveScrobbleRule.addEventListener('click', () => {
        if (selectedScrobbleRuleIndex < 0 || selectedScrobbleRuleIndex >= scrobbleRules.length) {
            return;
        }

        scrobbleRules.splice(selectedScrobbleRuleIndex, 1);
        selectedScrobbleRuleIndex = -1;
        renderScrobbleRuleList();
    });

    settingsRemoveSendToAction.addEventListener('click', () => {
        if (selectedCustomSendToActionIndex < 0 || selectedCustomSendToActionIndex >= customSendToActions.length) {
            return;
        }

        customSendToActions.splice(selectedCustomSendToActionIndex, 1);
        selectedCustomSendToActionIndex = -1;
        renderCustomSendToActionList();
    });

    settingsSave.addEventListener('click', async () => {
        if (settingsSave.disabled) {
            return;
        }

        settingsSave.disabled = true;
        settingsForceReload.disabled = true;
        refreshLastFmSessionFetchButton();

        try {
            const formValues = buildFormValues();
            const validationMessage = validateScrobbleRules(formValues.scrobbleRules);
            if (validationMessage) {
                throw new Error(validationMessage);
            }

            await options.save(formValues);
            finalizeClose();
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage(error instanceof Error && error.message.trim() !== ''
                ? error.message
                : 'Unable to save settings.');
        } finally {
            settingsSave.disabled = false;
            settingsForceReload.disabled = false;
            refreshLastFmSessionFetchButton();
        }
    });

    settingsForceReload.addEventListener('click', async () => {
        if (settingsForceReload.disabled || settingsSave.disabled) {
            return;
        }

        forceReloadInProgress = true;
        forceReloadEtaSeconds = null;
        refreshForceReloadStatus();
        settingsForceReload.disabled = true;
        settingsSave.disabled = true;
        refreshLastFmSessionFetchButton();

        try {
            const formValues = buildFormValues();
            const validationMessage = validateScrobbleRules(formValues.scrobbleRules);
            if (validationMessage) {
                throw new Error(validationMessage);
            }

            await options.save(formValues);
            await options.forceReload(formValues);
            forceReloadInProgress = false;
            forceReloadEtaSeconds = null;
            setSettingsStatusMessage('Library reloaded.');
        } catch (error) {
            console.error(error);
            forceReloadInProgress = false;
            forceReloadEtaSeconds = null;
            setSettingsStatusMessage('Unable to force reload library.');
        } finally {
            settingsForceReload.disabled = false;
            settingsSave.disabled = false;
            refreshLastFmSessionFetchButton();
        }
    });

    return {
        close: finalizeClose,
        handleDocumentClick: (target: Node): boolean => settingsModal.contains(target),
        handleEscape: (): boolean => {
            if (settingsModal.hidden) {
                return false;
            }

            if (!settingsSendToActionModal.hidden) {
                closeSendToActionDialog(null, true);
                return true;
            }

            if (!settingsScrobbleRuleModal.hidden) {
                closeScrobbleRuleDialog(null, true);
                return true;
            }

            if (!settingsLibraryDepthModal.hidden) {
                closeLibraryDepthDialog(null, true);
                return true;
            }

            void requestClose();
            return true;
        },
        open,
        setMusicBrainzTagWorkerProgress: renderMusicBrainzTagWorkerProgress,
        setForceReloadEtaSeconds,
    };
};