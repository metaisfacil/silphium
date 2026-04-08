import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { AppLibraryFolder, AudioOutputDevice, CoverArtPrioritySource, CustomSendToAction, MusicBrainzTagWorkerProgress, ScrobbleRule, ScrobbleRuleOperator } from '../types/app-types';
import { normalizeLibraryFolders, normalizeScrobbleRules } from '../utils/main-helpers';
import { normalizeFocusedKeyboardShortcuts } from '../utils/shortcut-bindings';
import {
    type DialogTimers,
    type LibraryDepthDialogElements,
    type LibraryDepthDialogState,
    type ScrobbleRuleDialogElements,
    type ScrobbleRuleDialogState,
    type SendToActionDialogElements,
    type SendToActionDialogState,
    applySendToCommandExamplesForPlatform,
    closeLibraryDepthDialog,
    closeScrobbleRuleDialog,
    closeSendToActionDialog,
    openLibraryDepthDialog,
    openScrobbleRuleDialog,
    openSendToActionDialog,
    refreshScrobbleRuleDialogControls,
} from './settings-controller-dialogs';
import {
    type MusicBrainzProgressEtaState,
    type MusicBrainzProgressRenderContext,
    renderAudioOutputDeviceOptions,
    renderCoverArtPriorityList,
    renderCustomSendToActionList,
    renderFavoritePlaylistList,
    renderLibraryFolderList,
    renderMusicBrainzTagWorkerProgressUI,
    renderScrobbleRuleList,
} from './settings-controller-rendering';
import { allCoverArtPrioritySources, defaultCoverArtPriority } from './settings-controller-types';
import type { LibraryFolderDialogValues, ScrobbleRuleDialogValues, SendToActionDialogValues, SettingsControllerOptions, SettingsFormValues, SettingsPrimaryTab, SettingsTab } from './settings-controller-types';
import {
    normalizeAudioOutputBufferMs,
    normalizeCoverArtPriority,
    normalizeCoverArtPriorityOrder,
    normalizeCustomSendToActions,
    normalizeFavoritePlaylists,
    normalizeMusicBrainzTagStaleDays,
    normalizeMusicBrainzTagWorkerCores,
    resolvePrimaryTab,
} from './settings-controller-utils';
import { bindSettingsControllerEvents, type SettingsControllerEventContext } from './settings-controller-events';
import { bindShortcutCaptureInput, createSettingsTabRuntime } from './settings-controller-layout';
import { createSettingsControllerStatusRuntime } from './settings-controller-status-runtime';

export type { SettingsFormValues, SettingsViewValues } from './settings-controller-types';

export type SettingsController = ReturnType<typeof createSettingsController>;

export const createSettingsController = (options: SettingsControllerOptions) => {
    const { elements } = options;
    const {
        settingsModal,
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
        settingsRemoveFavoritePlaylist,
        settingsScrobbleFilterMode,
        settingsScrobbleRuleList,
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
        settingsVisualizerControls,
        settingsVisualizerMode,
        settingsEqualizerPositionField,
        settingsEqualizerPosition,
        settingsCoverArtPriorityAccordionToggle,
        settingsCoverArtPriorityAccordionPanel,
        settingsCoverArtPriorityList: settingsCoverArtPriorityListElement,
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
    let settingsStatusFadeTimer: number | undefined;
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
    const libraryFolderRepeatClickWindowMs = 400;

    // Dialog state
    const dialogTimers: DialogTimers = {
        libraryDepthHideTimer: undefined,
        scrobbleRuleHideTimer: undefined,
        sendToActionHideTimer: undefined,
        settingsLibraryDepthStatusFadeTimer: undefined,
    };

    const libraryDepthElements: LibraryDepthDialogElements = {
        modal: settingsLibraryDepthModal,
        backdrop: settingsLibraryDepthBackdrop,
        form: settingsLibraryDepthForm,
        title: settingsLibraryDepthTitle,
        labelInput: settingsLibraryDepthLabelInput,
        depthInput: settingsLibraryDepthInput,
        status: settingsLibraryDepthStatus,
        cancel: settingsLibraryDepthCancel,
        confirm: settingsLibraryDepthConfirm,
    };

    const scrobbleRuleElements: ScrobbleRuleDialogElements = {
        modal: settingsScrobbleRuleModal,
        backdrop: settingsScrobbleRuleBackdrop,
        form: settingsScrobbleRuleForm,
        title: settingsScrobbleRuleTitle,
        field: settingsScrobbleRuleField,
        operator: settingsScrobbleRuleOperator,
        valueLabel: settingsScrobbleRuleValueLabel,
        value: settingsScrobbleRuleValue,
        hint: settingsScrobbleRuleHint,
        status: settingsScrobbleRuleStatus,
        cancel: settingsScrobbleRuleCancel,
        confirm: settingsScrobbleRuleConfirm,
    };

    const sendToActionElements: SendToActionDialogElements = {
        modal: settingsSendToActionModal,
        backdrop: settingsSendToActionBackdrop,
        form: settingsSendToActionForm,
        titleInput: settingsSendToActionTitleInput,
        scopeInput: settingsSendToActionScopeInput,
        commandHint: settingsSendToActionCommandHint,
        commandInput: settingsSendToActionCommandInput,
        status: settingsSendToActionStatus,
        cancel: settingsSendToActionCancel,
        confirm: settingsSendToActionConfirm,
    };

    const libraryDepthDialogState: LibraryDepthDialogState = {
        pendingResolver: null,
        returnFocusTarget: null,
    };

    const scrobbleRuleDialogState: ScrobbleRuleDialogState = {
        pendingResolver: null,
        returnFocusTarget: null,
    };

    const sendToActionDialogState: SendToActionDialogState = {
        pendingResolver: null,
        returnFocusTarget: null,
    };

    const mbProgressEta: MusicBrainzProgressEtaState = {
        entityRatePerSecond: null,
        lastSampleAtMs: null,
        lastCompletedEntityLookups: 0,
    };

    const mbProgressCtx: MusicBrainzProgressRenderContext = {
        progressBar: settingsMusicBrainzTagWorkerProgressBar,
        progressFill: settingsMusicBrainzTagWorkerProgressFill,
        progressValue: settingsMusicBrainzTagWorkerProgressValue,
        progressRemaining: settingsMusicBrainzTagWorkerProgressRemaining,
        progressStatus: settingsMusicBrainzTagWorkerProgressStatus,
    };

    settingsMinimizeToTrayField.hidden = !showMinimizeToTrayOption;

    applySendToCommandExamplesForPlatform(
        settingsSendToActionCommandHint,
        settingsSendToActionCommandInput,
        isWindowsRuntime,
        isMacRuntime,
        isLinuxRuntime,
    );

    const renderMusicBrainzTagWorkerProgress = (value: MusicBrainzTagWorkerProgress): void => {
        musicBrainzTagWorkerProgress = renderMusicBrainzTagWorkerProgressUI(value, mbProgressCtx, musicBrainzTagWorkerProgress, mbProgressEta);
    };

    const {
        normalizedListenBrainzRequestRateMs,
        normalizedMusicBrainzRequestRateMs,
        refreshForceReloadStatus,
        refreshLastFmSessionFetchButton,
        refreshListenBrainzRateControls,
        refreshMusicBrainzRateControls,
        refreshMusicBrainzTagWorkerControls,
        scrollCoverArtPriorityAccordionIntoView,
        scrollShortcutAccordionIntoView,
        setCoverArtPriorityAccordionExpanded,
        setForceReloadEtaSeconds,
        setLibraryDepthStatusMessage,
        setScrobbleRuleStatusMessage,
        setSendToActionStatusMessage,
        setSettingsStatusMessage,
        setShortcutAccordionExpanded,
    } = createSettingsControllerStatusRuntime({
        settingsModalTransitionMs,
        settingsShortcutAccordionTransitionMs,
        statusFadeDelayMs,
        settingsShortcutAccordionToggle,
        settingsShortcutAccordionPanel,
        settingsCoverArtPriorityAccordionToggle,
        settingsCoverArtPriorityAccordionPanel,
        settingsStatus,
        settingsLibraryDepthStatus,
        settingsScrobbleRuleStatus,
        settingsSendToActionStatus,
        settingsMusicBrainzServerUrl,
        settingsMusicBrainzRequestRateMs,
        settingsListenBrainzServerUrl,
        settingsListenBrainzRequestRateMs,
        settingsMusicBrainzTagDatabaseEnabled,
        settingsMusicBrainzTagStaleDays,
        settingsMusicBrainzTagRequestStaggeringEnabled,
        settingsMusicBrainzTagWorkerCores,
        settingsLastFmSessionKeyFetch,
        settingsSave,
        settingsForceReload,
        get shortcutAccordionHideTimer() {
            return shortcutAccordionHideTimer;
        },
        set shortcutAccordionHideTimer(value) {
            shortcutAccordionHideTimer = value;
        },
        get coverArtPriorityAccordionHideTimer() {
            return coverArtPriorityAccordionHideTimer;
        },
        set coverArtPriorityAccordionHideTimer(value) {
            coverArtPriorityAccordionHideTimer = value;
        },
        get settingsStatusFadeTimer() {
            return settingsStatusFadeTimer;
        },
        set settingsStatusFadeTimer(value) {
            settingsStatusFadeTimer = value;
        },
        get libraryDepthStatusFadeTimer() {
            return dialogTimers.settingsLibraryDepthStatusFadeTimer;
        },
        set libraryDepthStatusFadeTimer(value) {
            dialogTimers.settingsLibraryDepthStatusFadeTimer = value;
        },
        get forceReloadInProgress() {
            return forceReloadInProgress;
        },
        set forceReloadInProgress(value) {
            forceReloadInProgress = value;
        },
        get forceReloadEtaSeconds() {
            return forceReloadEtaSeconds;
        },
        set forceReloadEtaSeconds(value) {
            forceReloadEtaSeconds = value;
        },
        get lastFmSessionFetchInProgress() {
            return lastFmSessionFetchInProgress;
        },
        set lastFmSessionFetchInProgress(value) {
            lastFmSessionFetchInProgress = value;
        },
    });

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
        settingsCoverArtPriorityListElement.classList.remove('is-dragging');
        settingsCoverArtPriorityListElement.querySelectorAll('.is-drop-target').forEach((node) => {
            node.classList.remove('is-drop-target');
        });
    };

    const doRenderLibraryFolderList = (): void => {
        renderLibraryFolderList(settingsLibraryFolderList, settingsRemoveLibraryFolder, libraryFolders, selectedLibraryFolderIndex);
    };

    const doRenderFavoritePlaylistList = (): void => {
        renderFavoritePlaylistList(settingsFavoritePlaylistList, settingsRemoveFavoritePlaylist, favoritePlaylists, selectedFavoritePlaylistIndex);
    };

    const doRenderScrobbleRuleList = (): void => {
        renderScrobbleRuleList(settingsScrobbleRuleList, settingsRemoveScrobbleRule, scrobbleRules, selectedScrobbleRuleIndex);
    };

    const doRenderCustomSendToActionList = (): void => {
        renderCustomSendToActionList(settingsSendToActionList, settingsRemoveSendToAction, customSendToActions, selectedCustomSendToActionIndex);
    };

    const doRenderCoverArtPriorityList = (): void => {
        renderCoverArtPriorityList(settingsCoverArtPriorityListElement, coverArtPriority, coverArtPriorityOrder);
    };

    const setSelectedLibraryFolderIndex = (nextIndex: number): void => {
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= libraryFolders.length) {
            selectedLibraryFolderIndex = -1;
        } else {
            selectedLibraryFolderIndex = nextIndex;
        }

        doRenderLibraryFolderList();
    };

    const setSelectedCustomSendToActionIndex = (nextIndex: number): void => {
        selectedCustomSendToActionIndex = nextIndex >= 0 && nextIndex < customSendToActions.length ? nextIndex : -1;
        doRenderCustomSendToActionList();
    };

    const refreshAudioOutputDevices = (devices: AudioOutputDevice[], selectedDevice: string): void => {
        audioOutputDevices = Array.isArray(devices) ? devices.slice() : [];
        renderAudioOutputDeviceOptions(settingsAudioOutputDevice, audioOutputDevices, selectedDevice);
    };

    const getShortcutValues = () => {
        return normalizeFocusedKeyboardShortcuts({
            playPauseToggle: settingsShortcutPlayPauseToggle.value,
            nextTrack: settingsShortcutNextTrack.value,
            previousTrack: settingsShortcutPreviousTrack.value,
            stopPlayback: settingsShortcutStopPlayback.value,
            focusLibraryFilter: settingsShortcutFocusLibraryFilter.value,
            openSettings: settingsShortcutOpenSettings.value,
        });
    };

    const refreshEqualizerPositionControls = (): void => {
        const equalizerActive = settingsVisualizerMode.value === 'equalizer';
        settingsVisualizerControls.dataset.equalizerVisible = equalizerActive ? 'true' : 'false';
        settingsEqualizerPositionField.setAttribute('aria-hidden', equalizerActive ? 'false' : 'true');
        settingsEqualizerPosition.disabled = !equalizerActive;
        settingsEqualizerPosition.title = equalizerActive
            ? ''
            : 'Only used when Visualizer style is set to Band equalizer';
    };

    const setShortcutValues = (shortcuts: ReturnType<typeof getShortcutValues>): void => {
        settingsShortcutPlayPauseToggle.value = shortcuts.playPauseToggle;
        settingsShortcutNextTrack.value = shortcuts.nextTrack;
        settingsShortcutPreviousTrack.value = shortcuts.previousTrack;
        settingsShortcutStopPlayback.value = shortcuts.stopPlayback;
        settingsShortcutFocusLibraryFilter.value = shortcuts.focusLibraryFilter;
        settingsShortcutOpenSettings.value = shortcuts.openSettings;
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
    const { scrollTabsBy, setActiveTab, updateTabScrollControls } = createSettingsTabRuntime({
        settingsTabs,
        settingsTabsShell,
        settingsTabsScrollLeft,
        settingsTabsScrollRight,
        settingsTabButtons,
        settingsTabPanels: {
            general: settingsPanelGeneral,
            network: settingsPanelNetwork,
            database: settingsPanelDatabase,
            playlists: settingsPanelPlaylists,
            scrobbling: settingsPanelScrobbling,
            audio: settingsPanelAudio,
            ui: settingsPanelUi,
            actions: settingsPanelActions,
        },
    });

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
        visualizerMode: settingsVisualizerMode.value === 'equalizer' ? 'equalizer' : 'lissajous',
        equalizerPosition: settingsEqualizerPosition.value === 'top' ? 'top' : 'bottom',
        uiDitheringEnabled: settingsUiDitheringEnabled.checked,
        minimizeToTrayOnClose: settingsMinimizeToTrayOnClose.checked,
        customSendToActions: normalizeCustomSendToActions(customSendToActions).map((action) => ({ ...action })),
        keyboardShortcuts: getShortcutValues(),
    });

    const doCloseLibraryDepthDialog = (value: LibraryFolderDialogValues | null, restoreFocus: boolean, immediate = false): void => {
        closeLibraryDepthDialog(value, restoreFocus, immediate, libraryDepthElements, libraryDepthDialogState, dialogTimers, settingsModalTransitionMs, setLibraryDepthStatusMessage);
    };

    const doOpenLibraryDepthDialog = (initialValues: LibraryFolderDialogValues, confirmLabel: string, title: string) => {
        return openLibraryDepthDialog(initialValues, confirmLabel, title, libraryDepthElements, libraryDepthDialogState, dialogTimers, settingsModalTransitionMs, setLibraryDepthStatusMessage);
    };

    const doCloseScrobbleRuleDialog = (value: ScrobbleRuleDialogValues | null, restoreFocus: boolean, immediate = false): void => {
        closeScrobbleRuleDialog(value, restoreFocus, immediate, scrobbleRuleElements, scrobbleRuleDialogState, dialogTimers, settingsModalTransitionMs);
    };

    const doOpenScrobbleRuleDialog = (initialValues: ScrobbleRuleDialogValues, confirmLabel: string, title: string) => {
        return openScrobbleRuleDialog(initialValues, confirmLabel, title, scrobbleRuleElements, scrobbleRuleDialogState, dialogTimers, settingsModalTransitionMs);
    };

    const doCloseSendToActionDialog = (value: SendToActionDialogValues | null, restoreFocus: boolean, immediate = false): void => {
        closeSendToActionDialog(value, restoreFocus, immediate, sendToActionElements, sendToActionDialogState, dialogTimers, settingsModalTransitionMs);
    };

    const doOpenSendToActionDialog = (initialValues: SendToActionDialogValues, confirmLabel: string, title: string) => {
        return openSendToActionDialog(initialValues, confirmLabel, title, sendToActionElements, sendToActionDialogState, dialogTimers, settingsModalTransitionMs);
    };

    const editCustomSendToAction = async (index: number): Promise<boolean> => {
        const action = customSendToActions[index];
        if (!action) {
            return false;
        }

        const nextValues = await doOpenSendToActionDialog({ ...action }, 'Save', 'Edit send to action');
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
        doRenderCustomSendToActionList();
        settingsSendToActionList.focus();
        return true;
    };

    const editScrobbleRule = async (index: number): Promise<boolean> => {
        const rule = scrobbleRules[index];
        if (!rule) {
            return false;
        }

        const nextValues = await doOpenScrobbleRuleDialog({ ...rule }, 'Save', 'Scrobble rule');
        if (nextValues === null) {
            return false;
        }

        scrobbleRules[index] = { ...nextValues };
        selectedScrobbleRuleIndex = index;
        doRenderScrobbleRuleList();
        settingsScrobbleRuleList.focus();
        return true;
    };

    const editLibraryFolderSettings = async (index: number): Promise<boolean> => {
        const folder = libraryFolders[index];
        if (!folder) {
            return false;
        }

        const nextValues = await doOpenLibraryDepthDialog({ label: folder.label, releaseDepth: folder.releaseDepth }, 'Save', 'Library folder settings');
        if (nextValues === null) {
            return false;
        }

        folder.label = nextValues.label;
        folder.releaseDepth = nextValues.releaseDepth;
        setSelectedLibraryFolderIndex(index);
        settingsLibraryFolderList.focus();
        return true;
    };

    const finalizeClose = (): void => {
        doCloseLibraryDepthDialog(null, false, true);
        doCloseScrobbleRuleDialog(null, false, true);
        doCloseSendToActionDialog(null, false, true);
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
        settingsVisualizerMode.value = values.visualizerMode === 'equalizer' ? 'equalizer' : 'lissajous';
        settingsEqualizerPosition.value = values.equalizerPosition === 'top' ? 'top' : 'bottom';
        refreshEqualizerPositionControls();
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
        doRenderLibraryFolderList();
        doRenderFavoritePlaylistList();
        doRenderScrobbleRuleList();
        doRenderCustomSendToActionList();
        doRenderCoverArtPriorityList();
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
            settingsListenBrainzToken.focus();
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
    refreshEqualizerPositionControls();

    const eventContext: SettingsControllerEventContext = {
        elements,
        options,
        libraryFolderRepeatClickWindowMs,
        settingsTabScrollStepPx,
        get libraryFolders() {
            return libraryFolders;
        },
        set libraryFolders(value) {
            libraryFolders = value;
        },
        get selectedLibraryFolderIndex() {
            return selectedLibraryFolderIndex;
        },
        set selectedLibraryFolderIndex(value) {
            selectedLibraryFolderIndex = value;
        },
        get lastLibraryFolderClickIndex() {
            return lastLibraryFolderClickIndex;
        },
        set lastLibraryFolderClickIndex(value) {
            lastLibraryFolderClickIndex = value;
        },
        get lastLibraryFolderClickAt() {
            return lastLibraryFolderClickAt;
        },
        set lastLibraryFolderClickAt(value) {
            lastLibraryFolderClickAt = value;
        },
        get favoritePlaylists() {
            return favoritePlaylists;
        },
        set favoritePlaylists(value) {
            favoritePlaylists = value;
        },
        get selectedFavoritePlaylistIndex() {
            return selectedFavoritePlaylistIndex;
        },
        set selectedFavoritePlaylistIndex(value) {
            selectedFavoritePlaylistIndex = value;
        },
        get scrobbleRules() {
            return scrobbleRules;
        },
        set scrobbleRules(value) {
            scrobbleRules = value;
        },
        get selectedScrobbleRuleIndex() {
            return selectedScrobbleRuleIndex;
        },
        set selectedScrobbleRuleIndex(value) {
            selectedScrobbleRuleIndex = value;
        },
        get lastScrobbleRuleClickIndex() {
            return lastScrobbleRuleClickIndex;
        },
        set lastScrobbleRuleClickIndex(value) {
            lastScrobbleRuleClickIndex = value;
        },
        get lastScrobbleRuleClickAt() {
            return lastScrobbleRuleClickAt;
        },
        set lastScrobbleRuleClickAt(value) {
            lastScrobbleRuleClickAt = value;
        },
        get customSendToActions() {
            return customSendToActions;
        },
        set customSendToActions(value) {
            customSendToActions = value;
        },
        get selectedCustomSendToActionIndex() {
            return selectedCustomSendToActionIndex;
        },
        set selectedCustomSendToActionIndex(value) {
            selectedCustomSendToActionIndex = value;
        },
        get lastCustomSendToActionClickIndex() {
            return lastCustomSendToActionClickIndex;
        },
        set lastCustomSendToActionClickIndex(value) {
            lastCustomSendToActionClickIndex = value;
        },
        get lastCustomSendToActionClickAt() {
            return lastCustomSendToActionClickAt;
        },
        set lastCustomSendToActionClickAt(value) {
            lastCustomSendToActionClickAt = value;
        },
        get coverArtPriorityOrder() {
            return coverArtPriorityOrder;
        },
        set coverArtPriorityOrder(value) {
            coverArtPriorityOrder = value;
        },
        get draggedCoverPriorityIndex() {
            return draggedCoverPriorityIndex;
        },
        set draggedCoverPriorityIndex(value) {
            draggedCoverPriorityIndex = value;
        },
        get forceReloadInProgress() {
            return forceReloadInProgress;
        },
        set forceReloadInProgress(value) {
            forceReloadInProgress = value;
        },
        get forceReloadEtaSeconds() {
            return forceReloadEtaSeconds;
        },
        set forceReloadEtaSeconds(value) {
            forceReloadEtaSeconds = value;
        },
        get lastFmSessionFetchInProgress() {
            return lastFmSessionFetchInProgress;
        },
        set lastFmSessionFetchInProgress(value) {
            lastFmSessionFetchInProgress = value;
        },
        setShortcutAccordionExpanded,
        setCoverArtPriorityAccordionExpanded,
        scrollShortcutAccordionIntoView,
        scrollCoverArtPriorityAccordionIntoView,
        refreshLastFmSessionFetchButton,
        refreshMusicBrainzTagWorkerControls,
        refreshMusicBrainzRateControls,
        refreshListenBrainzRateControls,
        refreshEqualizerPositionControls,
        refreshScrobbleRuleDialogControls: (preferredOperator?: ScrobbleRuleOperator) => {
            refreshScrobbleRuleDialogControls(scrobbleRuleElements, preferredOperator);
        },
        refreshAudioOutputDevices,
        refreshForceReloadStatus,
        clearCoverArtDragState,
        moveCoverArtPriority,
        setCoverArtPrioritySourceEnabled,
        doRenderLibraryFolderList,
        doRenderFavoritePlaylistList,
        doRenderScrobbleRuleList,
        doRenderCustomSendToActionList,
        doRenderCoverArtPriorityList,
        setSelectedLibraryFolderIndex,
        setSelectedCustomSendToActionIndex,
        buildFormValues,
        doOpenLibraryDepthDialog,
        doOpenScrobbleRuleDialog,
        doOpenSendToActionDialog,
        doCloseLibraryDepthDialog,
        doCloseScrobbleRuleDialog,
        doCloseSendToActionDialog,
        editLibraryFolderSettings,
        editScrobbleRule,
        editCustomSendToAction,
        setSettingsStatusMessage,
        setLibraryDepthStatusMessage,
        setScrobbleRuleStatusMessage,
        setSendToActionStatusMessage,
        requestClose,
        finalizeClose,
        open,
        setActiveTab,
        scrollTabsBy,
        updateTabScrollControls,
    };

    bindSettingsControllerEvents(eventContext);

    return {
        close: finalizeClose,
        handleDocumentClick: (target: Node): boolean => settingsModal.contains(target),
        handleEscape: (): boolean => {
            if (settingsModal.hidden) {
                return false;
            }

            if (!settingsSendToActionModal.hidden) {
                doCloseSendToActionDialog(null, true);
                return true;
            }

            if (!settingsScrobbleRuleModal.hidden) {
                doCloseScrobbleRuleDialog(null, true);
                return true;
            }

            if (!settingsLibraryDepthModal.hidden) {
                doCloseLibraryDepthDialog(null, true);
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
