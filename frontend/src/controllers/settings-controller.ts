import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { AudioOutputDevice, CoverArtPrioritySource, MusicBrainzTagWorkerProgress, ScrobbleRuleOperator } from '../types/app-types';
import { resolveRoonAccentTheme } from '../utils/roon-accent-theme';
import { normalizeLissajousScale } from '../utils/settings-normalization';
import { defaultLibrarySharingPort, normalizeLibraryFolders, normalizeLibrarySharingPort, normalizeScrobbleRules } from '../utils/main-helpers';
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
import { createSettingsControllerState } from './settings-controller-types';
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
        settingsTooltipLayer,
        settingsTabs,
        settingsTabsScrollLeft,
        settingsTabsScrollRight,
        settingsTabGeneral,
        settingsTabLibrary,
        settingsTabNetwork,
        settingsTabPlaylists,
        settingsTabScrobbling,
        settingsTabAudio,
        settingsTabUi,
        settingsTabActions,
        settingsPanelGeneral,
        settingsPanelLibrary,
        settingsPanelNetwork,
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
        settingsSavePlaylistsOnAddRemove,
        settingsScrobblingEnabled,
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
        settingsLibraryDepthMusicBrainzTagWorkerScansEnabled,
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
        settingsLibrarySharingEnabled,
        settingsLibrarySharingPort,
        settingsLibrarySharingPassword,
        settingsLocalLibraryFilesDatabaseEnabled,
        settingsLocalLibraryFilesDatabaseLoadOnStartup,
        settingsLocalLibraryFilesDatabaseListenHistoryEnabled,
        settingsLocalLibraryFilesDatabaseListenHistoryLimit,
        settingsLocalLibraryFilesDatabaseListenHistoryThresholdSeconds,
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
        settingsHighlightMusicBrainzTaggedAlbumFolders,
        settingsMusicBrainzTagStaleDays,
        settingsMusicBrainzTagRequestStaggeringEnabled,
        settingsMusicBrainzTagWorkerCores,
        settingsMusicBrainzTagWorkerProgressBar,
        settingsMusicBrainzTagWorkerProgressFill,
        settingsMusicBrainzTagWorkerProgressValue,
        settingsMusicBrainzTagWorkerProgressRemaining,
        settingsMusicBrainzTagWorkerProgressStatus,
        settingsRoonAccentColor,
        settingsRoonAccentSaturation,
        settingsRoonAccentSaturationValue,
        settingsVisualizerControls,
        settingsVisualizerMode,
        settingsEqualizerPositionField,
        settingsEqualizerPosition,
        settingsLissajousScaleField,
        settingsLissajousScale,
        settingsLissajousScaleValue,
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
    const settingsTooltipId = 'settings-tooltip-portal';
    const settingsTooltipOffsetPx = 8;
    const settingsTooltipViewportPaddingPx = 12;
    const settingsTooltipFallbackWidthPx = 240;
    const settingsTooltipFallbackHeightPx = 64;
    const settingsTabsShell = settingsTabs.parentElement instanceof HTMLDivElement
        ? settingsTabs.parentElement
        : null;
    const statusFadeDelayMs = 5000;
    const musicBrainzTagWorkerRefreshIntervalMs = 2000;
    const showMinimizeToTrayOption = options.isWindows ?? true;
    const isWindowsRuntime = options.isWindows ?? false;
    const isMacRuntime = options.isMac ?? false;
    const isLinuxRuntime = options.isLinux ?? false;
    const controllerState = options.state ?? createSettingsControllerState();
    let hideTimer: number | undefined;
    let settingsStatusFadeTimer: number | undefined;
    let shortcutAccordionHideTimer: number | undefined;
    let coverArtPriorityAccordionHideTimer: number | undefined;
    let musicBrainzTagWorkerRefreshHandle: number | undefined;
    let musicBrainzTagWorkerRefreshInFlight = false;
    let activeSettingsTooltipTrigger: HTMLButtonElement | null = null;
    let librarySharingPasswordHash = '';
    const libraryFolderRepeatClickWindowMs = 400;
    const settingsTooltipBubble = document.createElement('div');
    settingsTooltipBubble.id = settingsTooltipId;
    settingsTooltipBubble.className = 'settings-tooltip-bubble';
    settingsTooltipBubble.setAttribute('role', 'tooltip');
    settingsTooltipBubble.hidden = true;
    settingsTooltipLayer.replaceChildren(settingsTooltipBubble);

    const getSettingsTooltipTrigger = (target: EventTarget | null): HTMLButtonElement | null => {
        if (!(target instanceof Element)) {
            return null;
        }

        const trigger = target.closest('.settings-tooltip-trigger');
        return trigger instanceof HTMLButtonElement ? trigger : null;
    };

    const getSettingsTooltipContainer = (target: EventTarget | null): HTMLElement | null => {
        if (!(target instanceof Element)) {
            return null;
        }

        const container = target.closest('.settings-tooltip');
        return container instanceof HTMLElement ? container : null;
    };

    const getActiveSettingsTooltipSource = (): { container: HTMLElement; bubble: HTMLElement } | null => {
        if (!(activeSettingsTooltipTrigger instanceof HTMLButtonElement) || !settingsModal.contains(activeSettingsTooltipTrigger)) {
            return null;
        }

        const container = activeSettingsTooltipTrigger.closest('.settings-tooltip');
        if (!(container instanceof HTMLElement)) {
            return null;
        }

        const bubble = container.querySelector('.settings-tooltip-bubble');
        if (!(bubble instanceof HTMLElement)) {
            return null;
        }

        return { container, bubble };
    };

    const hideSettingsTooltip = (trigger?: HTMLButtonElement | null): void => {
        if (trigger && activeSettingsTooltipTrigger !== trigger) {
            return;
        }

        if (activeSettingsTooltipTrigger instanceof HTMLButtonElement) {
            activeSettingsTooltipTrigger.removeAttribute('aria-describedby');
        }

        activeSettingsTooltipTrigger = null;
        settingsTooltipBubble.classList.remove('is-visible', 'settings-tooltip-bubble--above');
        settingsTooltipBubble.hidden = true;
        settingsTooltipBubble.innerHTML = '';
        settingsTooltipBubble.style.removeProperty('left');
        settingsTooltipBubble.style.removeProperty('top');
        settingsTooltipLayer.setAttribute('aria-hidden', 'true');
    };

    const positionSettingsTooltip = (): void => {
        const source = getActiveSettingsTooltipSource();
        if (source === null || activeSettingsTooltipTrigger === null) {
            hideSettingsTooltip();
            return;
        }

        if (settingsTooltipBubble.innerHTML !== source.bubble.innerHTML) {
            settingsTooltipBubble.innerHTML = source.bubble.innerHTML;
        }

        const triggerRect = activeSettingsTooltipTrigger.getBoundingClientRect();
        const tooltipWidth = Math.max(
            Math.min(settingsTooltipFallbackWidthPx, window.innerWidth - (settingsTooltipViewportPaddingPx * 2)),
            Math.round(settingsTooltipBubble.getBoundingClientRect().width),
        );
        const tooltipHeight = Math.max(settingsTooltipFallbackHeightPx, Math.round(settingsTooltipBubble.getBoundingClientRect().height));
        const preferredLeft = source.container.classList.contains('settings-tooltip--end')
            ? triggerRect.right - tooltipWidth
            : triggerRect.left;
        const maxLeft = Math.max(settingsTooltipViewportPaddingPx, window.innerWidth - settingsTooltipViewportPaddingPx - tooltipWidth);
        const left = Math.min(Math.max(preferredLeft, settingsTooltipViewportPaddingPx), maxLeft);
        const availableBelow = window.innerHeight - settingsTooltipViewportPaddingPx - triggerRect.bottom;
        const availableAbove = triggerRect.top - settingsTooltipViewportPaddingPx;
        let renderAbove = source.container.classList.contains('settings-tooltip--above');

        if (renderAbove && availableAbove < tooltipHeight + settingsTooltipOffsetPx && availableBelow > availableAbove) {
            renderAbove = false;
        } else if (!renderAbove && availableBelow < tooltipHeight + settingsTooltipOffsetPx && availableAbove > availableBelow) {
            renderAbove = true;
        }

        const preferredTop = renderAbove
            ? triggerRect.top - tooltipHeight - settingsTooltipOffsetPx
            : triggerRect.bottom + settingsTooltipOffsetPx;
        const maxTop = Math.max(settingsTooltipViewportPaddingPx, window.innerHeight - settingsTooltipViewportPaddingPx - tooltipHeight);
        const top = Math.min(Math.max(preferredTop, settingsTooltipViewportPaddingPx), maxTop);

        settingsTooltipBubble.classList.toggle('settings-tooltip-bubble--above', renderAbove);
        settingsTooltipBubble.style.left = `${left}px`;
        settingsTooltipBubble.style.top = `${top}px`;
    };

    const showSettingsTooltip = (trigger: HTMLButtonElement): void => {
        const container = trigger.closest('.settings-tooltip');
        const sourceBubble = container?.querySelector('.settings-tooltip-bubble');
        if (!(container instanceof HTMLElement) || !(sourceBubble instanceof HTMLElement) || sourceBubble.innerHTML.trim() === '') {
            hideSettingsTooltip(trigger);
            return;
        }

        activeSettingsTooltipTrigger = trigger;
        settingsTooltipBubble.innerHTML = sourceBubble.innerHTML;
        settingsTooltipBubble.hidden = false;
        settingsTooltipLayer.setAttribute('aria-hidden', 'false');
        positionSettingsTooltip();
        settingsTooltipBubble.classList.add('is-visible');
        trigger.setAttribute('aria-describedby', settingsTooltipId);
    };

    settingsModal.addEventListener('mouseover', (event) => {
        const trigger = getSettingsTooltipTrigger(event.target);
        if (trigger !== null) {
            showSettingsTooltip(trigger);
        }
    });

    settingsModal.addEventListener('mouseout', (event) => {
        if (activeSettingsTooltipTrigger === null) {
            return;
        }

        const activeContainer = activeSettingsTooltipTrigger.closest('.settings-tooltip');
        const targetContainer = getSettingsTooltipContainer(event.target);
        if (!(activeContainer instanceof HTMLElement) || targetContainer !== activeContainer) {
            return;
        }

        if (event.relatedTarget instanceof Node && activeContainer.contains(event.relatedTarget)) {
            return;
        }

        hideSettingsTooltip(activeSettingsTooltipTrigger);
    });

    settingsModal.addEventListener('focusin', (event) => {
        const trigger = getSettingsTooltipTrigger(event.target);
        if (trigger !== null) {
            showSettingsTooltip(trigger);
        }
    });

    settingsModal.addEventListener('focusout', (event) => {
        if (activeSettingsTooltipTrigger === null) {
            return;
        }

        const activeContainer = activeSettingsTooltipTrigger.closest('.settings-tooltip');
        if (!(activeContainer instanceof HTMLElement)) {
            hideSettingsTooltip();
            return;
        }

        if (event.relatedTarget instanceof Node && activeContainer.contains(event.relatedTarget)) {
            return;
        }

        hideSettingsTooltip(activeSettingsTooltipTrigger);
    });

    settingsModal.addEventListener('scroll', () => {
        if (activeSettingsTooltipTrigger !== null) {
            positionSettingsTooltip();
        }
    }, true);

    const refreshRoonAccentFieldPreview = (): void => {
        const accentTheme = resolveRoonAccentTheme({
            color: settingsRoonAccentColor.value,
            saturation: settingsRoonAccentSaturation.value,
        });

        settingsRoonAccentColor.style.setProperty('--settings-accent-color', accentTheme.appliedColor);
        settingsRoonAccentSaturationValue.value = `${accentTheme.saturation}%`;
        settingsRoonAccentSaturationValue.textContent = `${accentTheme.saturation}%`;
    };

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
        musicBrainzTagWorkerScansEnabledInput: settingsLibraryDepthMusicBrainzTagWorkerScansEnabled,
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
        controllerState.musicBrainzTagWorkerProgress = renderMusicBrainzTagWorkerProgressUI(
            value,
            mbProgressCtx,
            controllerState.musicBrainzTagWorkerProgress,
            mbProgressEta,
        );
    };

    const stopMusicBrainzTagWorkerProgressRefresh = (): void => {
        if (musicBrainzTagWorkerRefreshHandle === undefined) {
            return;
        }

        window.clearInterval(musicBrainzTagWorkerRefreshHandle);
        musicBrainzTagWorkerRefreshHandle = undefined;
    };

    const refreshMusicBrainzTagWorkerProgressFromBackend = async (): Promise<void> => {
        if (options.getMusicBrainzTagWorkerProgress === undefined) {
            return;
        }

        if (settingsModal.hidden || musicBrainzTagWorkerRefreshInFlight) {
            return;
        }

        musicBrainzTagWorkerRefreshInFlight = true;
        try {
            renderMusicBrainzTagWorkerProgress(await options.getMusicBrainzTagWorkerProgress());
        } catch (error) {
            console.debug(error);
        } finally {
            musicBrainzTagWorkerRefreshInFlight = false;
        }
    };

    const startMusicBrainzTagWorkerProgressRefresh = (): void => {
        if (options.getMusicBrainzTagWorkerProgress === undefined || musicBrainzTagWorkerRefreshHandle !== undefined) {
            return;
        }

        void refreshMusicBrainzTagWorkerProgressFromBackend();
        musicBrainzTagWorkerRefreshHandle = window.setInterval(() => {
            void refreshMusicBrainzTagWorkerProgressFromBackend();
        }, musicBrainzTagWorkerRefreshIntervalMs);
    };

    const {
        normalizedListenBrainzRequestRateMs,
        normalizedMusicBrainzRequestRateMs,
        refreshForceReloadStatus,
        refreshLastFmSessionFetchButton,
        refreshLocalLibraryFilesDatabaseControls,
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
        settingsLocalLibraryFilesDatabaseEnabled,
        settingsLocalLibraryFilesDatabaseLoadOnStartup,
        settingsLocalLibraryFilesDatabaseListenHistoryEnabled,
        settingsLocalLibraryFilesDatabaseListenHistoryLimit,
        settingsLocalLibraryFilesDatabaseListenHistoryThresholdSeconds,
        settingsMusicBrainzTagDatabaseEnabled,
        settingsHighlightMusicBrainzTaggedAlbumFolders,
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
            return controllerState.forceReloadInProgress;
        },
        set forceReloadInProgress(value) {
            controllerState.forceReloadInProgress = value;
        },
        get forceReloadEtaSeconds() {
            return controllerState.forceReloadEtaSeconds;
        },
        set forceReloadEtaSeconds(value) {
            controllerState.forceReloadEtaSeconds = value;
        },
        get lastFmSessionFetchInProgress() {
            return controllerState.lastFmSessionFetchInProgress;
        },
        set lastFmSessionFetchInProgress(value) {
            controllerState.lastFmSessionFetchInProgress = value;
        },
    });

    const moveCoverArtPriority = (fromIndex: number, toIndex: number): void => {
        if (
            fromIndex < 0
            || toIndex < 0
            || fromIndex >= controllerState.coverArtPriorityOrder.length
            || toIndex >= controllerState.coverArtPriorityOrder.length
        ) {
            return;
        }

        if (fromIndex === toIndex) {
            return;
        }

        const next = controllerState.coverArtPriorityOrder.slice();
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        controllerState.coverArtPriorityOrder = normalizeCoverArtPriorityOrder(next);
        const enabled = new Set<CoverArtPrioritySource>(controllerState.coverArtPriority);
        controllerState.coverArtPriority = controllerState.coverArtPriorityOrder.filter((source) => enabled.has(source));
    };

    const setCoverArtPrioritySourceEnabled = (source: CoverArtPrioritySource, enabled: boolean): void => {
        const nextEnabled = new Set<CoverArtPrioritySource>(controllerState.coverArtPriority);
        if (enabled) {
            nextEnabled.add(source);
        } else {
            nextEnabled.delete(source);
        }

        controllerState.coverArtPriority = controllerState.coverArtPriorityOrder.filter((candidate) => nextEnabled.has(candidate));
    };

    const clearCoverArtDragState = (): void => {
        controllerState.draggedCoverPriorityIndex = -1;
        settingsCoverArtPriorityListElement.classList.remove('is-dragging');
        settingsCoverArtPriorityListElement.querySelectorAll('.is-drop-target').forEach((node) => {
            node.classList.remove('is-drop-target');
        });
    };

    const doRenderLibraryFolderList = (): void => {
        renderLibraryFolderList(
            settingsLibraryFolderList,
            settingsRemoveLibraryFolder,
            controllerState.libraryFolders,
            controllerState.selectedLibraryFolderIndex,
        );
    };

    const doRenderFavoritePlaylistList = (): void => {
        renderFavoritePlaylistList(
            settingsFavoritePlaylistList,
            settingsRemoveFavoritePlaylist,
            controllerState.favoritePlaylists,
            controllerState.selectedFavoritePlaylistIndex,
        );
    };

    const doRenderScrobbleRuleList = (): void => {
        renderScrobbleRuleList(
            settingsScrobbleRuleList,
            settingsRemoveScrobbleRule,
            controllerState.scrobbleRules,
            controllerState.selectedScrobbleRuleIndex,
        );
    };

    const doRenderCustomSendToActionList = (): void => {
        renderCustomSendToActionList(
            settingsSendToActionList,
            settingsRemoveSendToAction,
            controllerState.customSendToActions,
            controllerState.selectedCustomSendToActionIndex,
        );
    };

    const doRenderCoverArtPriorityList = (): void => {
        renderCoverArtPriorityList(
            settingsCoverArtPriorityListElement,
            controllerState.coverArtPriority,
            controllerState.coverArtPriorityOrder,
        );
    };

    const setSelectedLibraryFolderIndex = (nextIndex: number): void => {
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= controllerState.libraryFolders.length) {
            controllerState.selectedLibraryFolderIndex = -1;
        } else {
            controllerState.selectedLibraryFolderIndex = nextIndex;
        }

        doRenderLibraryFolderList();
    };

    const setSelectedCustomSendToActionIndex = (nextIndex: number): void => {
        controllerState.selectedCustomSendToActionIndex = nextIndex >= 0 && nextIndex < controllerState.customSendToActions.length ? nextIndex : -1;
        doRenderCustomSendToActionList();
    };

    const refreshAudioOutputDevices = (devices: AudioOutputDevice[], selectedDevice: string): void => {
        controllerState.audioOutputDevices = Array.isArray(devices) ? devices.slice() : [];
        renderAudioOutputDeviceOptions(settingsAudioOutputDevice, controllerState.audioOutputDevices, selectedDevice);
    };

    const formatLissajousScaleValue = (scale: number): string => `${Math.round(scale * 100)}%`;

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
        const lissajousActive = !equalizerActive;
        const lissajousScale = normalizeLissajousScale(settingsLissajousScale.value);
        settingsVisualizerControls.dataset.equalizerVisible = equalizerActive ? 'true' : 'false';
        settingsVisualizerControls.dataset.lissajousVisible = lissajousActive ? 'true' : 'false';
        settingsEqualizerPositionField.setAttribute('aria-hidden', equalizerActive ? 'false' : 'true');
        settingsEqualizerPosition.disabled = !equalizerActive;
        settingsEqualizerPosition.title = equalizerActive
            ? ''
            : 'Only used when Visualizer style is set to Band equalizer';
        settingsLissajousScaleField.setAttribute('aria-hidden', lissajousActive ? 'false' : 'true');
        settingsLissajousScale.disabled = !lissajousActive;
        settingsLissajousScale.title = lissajousActive
            ? ''
            : 'Only used when Visualizer style is set to Lissajous';
        settingsLissajousScaleValue.value = formatLissajousScaleValue(lissajousScale);
        settingsLissajousScaleValue.textContent = formatLissajousScaleValue(lissajousScale);
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
        library: settingsTabLibrary,
        network: settingsTabNetwork,
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
            library: settingsPanelLibrary,
            network: settingsPanelNetwork,
            playlists: settingsPanelPlaylists,
            scrobbling: settingsPanelScrobbling,
            audio: settingsPanelAudio,
            ui: settingsPanelUi,
            actions: settingsPanelActions,
        },
    });

    const buildFormValues = (): SettingsFormValues => ({
        libraryFolders: controllerState.libraryFolders.map((folder) => ({ ...folder })),
        localLibraryFilesDatabaseEnabled: settingsLocalLibraryFilesDatabaseEnabled.checked,
        localLibraryFilesDatabaseLoadOnStartup: settingsLocalLibraryFilesDatabaseLoadOnStartup.checked,
        localLibraryFilesDatabaseListenHistoryEnabled: settingsLocalLibraryFilesDatabaseListenHistoryEnabled.checked,
        localLibraryFilesDatabaseListenHistoryLimit: Math.max(0, Number.parseInt(settingsLocalLibraryFilesDatabaseListenHistoryLimit.value.trim(), 10) || 0),
        localLibraryFilesDatabaseListenHistoryThresholdSeconds: Math.max(1, Number.parseInt(settingsLocalLibraryFilesDatabaseListenHistoryThresholdSeconds.value.trim(), 10) || 30),
        ffmpegPath: settingsFFmpegPath.value,
        remoteLibraryTranscodingEnabled: false,
        remoteLibraryTranscodingBitrateKbps: 192,
        librarySharingEnabled: settingsLibrarySharingEnabled.checked,
        librarySharingPort: normalizeLibrarySharingPort(settingsLibrarySharingPort.value || defaultLibrarySharingPort),
        librarySharingPassword: settingsLibrarySharingPassword.value,
        librarySharingPasswordHash: librarySharingPasswordHash,
        listenBrainzUserToken: settingsListenBrainzToken.value,
        lastFmApiKey: settingsLastFmApiKey.value,
        lastFmApiSecret: settingsLastFmApiSecret.value,
        lastFmSessionKey: settingsLastFmSessionKey.value,
        scrobblingEnabled: settingsScrobblingEnabled.checked,
        scrobbleFilterMode: settingsScrobbleFilterMode.value === 'whitelist' ? 'whitelist' : 'blacklist',
        scrobbleRules: normalizeScrobbleRules(controllerState.scrobbleRules).map((rule) => ({ ...rule })),
        musicBrainzServerUrl: settingsMusicBrainzServerUrl.value,
        musicBrainzRequestRateMs: normalizedMusicBrainzRequestRateMs(),
        listenBrainzServerUrl: settingsListenBrainzServerUrl.value,
        listenBrainzRequestRateMs: normalizedListenBrainzRequestRateMs(),
        favoritePlaylists: controllerState.favoritePlaylists.slice(),
        savePlaylistsOnAddRemove: settingsSavePlaylistsOnAddRemove.checked,
        coverArtPriority: controllerState.coverArtPriority.slice(),
        audioOutputDevice: settingsAudioOutputDevice.value || 'default',
        audioOutputBufferMs: normalizeAudioOutputBufferMs(settingsAudioOutputBufferMs.value),
        gaplessPlayback: settingsGaplessPlayback.checked,
        replayGainEnabled: settingsReplayGain.checked,
        preferMusicBrainzMetadata: settingsPreferMusicBrainzMetadata.checked,
        musicBrainzTagDatabaseEnabled: settingsMusicBrainzTagDatabaseEnabled.checked,
        highlightMusicBrainzTaggedAlbumFolders: settingsHighlightMusicBrainzTaggedAlbumFolders.checked,
        musicBrainzTagStaleDays: normalizeMusicBrainzTagStaleDays(settingsMusicBrainzTagStaleDays.value),
        musicBrainzTagRequestStaggeringEnabled: settingsMusicBrainzTagRequestStaggeringEnabled.checked,
        musicBrainzTagWorkerCores: normalizeMusicBrainzTagWorkerCores(settingsMusicBrainzTagWorkerCores.value),
        lissajousEnabled: settingsLissajousEnabled.checked,
        lissajousScale: normalizeLissajousScale(settingsLissajousScale.value),
        visualizerMode: settingsVisualizerMode.value === 'equalizer' ? 'equalizer' : 'lissajous',
        equalizerPosition: settingsEqualizerPosition.value === 'top' ? 'top' : 'bottom',
        uiDitheringEnabled: settingsUiDitheringEnabled.checked,
        minimizeToTrayOnClose: settingsMinimizeToTrayOnClose.checked,
        customSendToActions: normalizeCustomSendToActions(controllerState.customSendToActions).map((action) => ({ ...action })),
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
        const action = controllerState.customSendToActions[index];
        if (!action) {
            return false;
        }

        const nextValues = await doOpenSendToActionDialog({ ...action }, 'Save', 'Edit send to action');
        if (nextValues === null) {
            return false;
        }

        controllerState.customSendToActions[index] = {
            title: nextValues.title,
            scope: nextValues.scope,
            commandTemplate: nextValues.commandTemplate,
        };
        controllerState.customSendToActions = normalizeCustomSendToActions(controllerState.customSendToActions);
        controllerState.selectedCustomSendToActionIndex = controllerState.customSendToActions.findIndex((candidate) => (
            candidate.title === nextValues.title
                && candidate.scope === nextValues.scope
                && candidate.commandTemplate === nextValues.commandTemplate
        ));
        doRenderCustomSendToActionList();
        settingsSendToActionList.focus();
        return true;
    };

    const editScrobbleRule = async (index: number): Promise<boolean> => {
        const rule = controllerState.scrobbleRules[index];
        if (!rule) {
            return false;
        }

        const nextValues = await doOpenScrobbleRuleDialog({ ...rule }, 'Save', 'Scrobble rule');
        if (nextValues === null) {
            return false;
        }

        controllerState.scrobbleRules[index] = { ...nextValues };
        controllerState.selectedScrobbleRuleIndex = index;
        doRenderScrobbleRuleList();
        settingsScrobbleRuleList.focus();
        return true;
    };

    const editLibraryFolderSettings = async (index: number): Promise<boolean> => {
        const folder = controllerState.libraryFolders[index];
        if (!folder) {
            return false;
        }

        const nextValues = await doOpenLibraryDepthDialog({
            label: folder.label,
            releaseDepth: folder.releaseDepth,
            musicBrainzTagWorkerScansEnabled: folder.musicBrainzTagWorkerScansEnabled !== false,
        }, 'Save', 'Library folder settings');
        if (nextValues === null) {
            return false;
        }

        folder.label = nextValues.label;
        folder.releaseDepth = nextValues.releaseDepth;
        if (nextValues.musicBrainzTagWorkerScansEnabled) {
            delete folder.musicBrainzTagWorkerScansEnabled;
        } else {
            folder.musicBrainzTagWorkerScansEnabled = false;
        }
        setSelectedLibraryFolderIndex(index);
        settingsLibraryFolderList.focus();
        return true;
    };

    const finalizeClose = (): void => {
        stopMusicBrainzTagWorkerProgressRefresh();
        hideSettingsTooltip();
        doCloseLibraryDepthDialog(null, false, true);
        doCloseScrobbleRuleDialog(null, false, true);
        doCloseSendToActionDialog(null, false, true);
        settingsModal.classList.remove('is-visible');
        controllerState.lastLibraryFolderClickIndex = -1;
        controllerState.lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
        controllerState.lastScrobbleRuleClickIndex = -1;
        controllerState.lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
        controllerState.lastCustomSendToActionClickIndex = -1;
        controllerState.lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;

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
        controllerState.libraryFolders = normalizeLibraryFolders(values.libraryFolders);
        settingsLocalLibraryFilesDatabaseEnabled.checked = values.localLibraryFilesDatabaseEnabled !== false;
        settingsLocalLibraryFilesDatabaseLoadOnStartup.checked = values.localLibraryFilesDatabaseLoadOnStartup !== false;
        settingsLocalLibraryFilesDatabaseListenHistoryEnabled.checked = values.localLibraryFilesDatabaseListenHistoryEnabled === true;
        settingsLocalLibraryFilesDatabaseListenHistoryLimit.value = values.localLibraryFilesDatabaseListenHistoryLimit > 0
            ? String(values.localLibraryFilesDatabaseListenHistoryLimit)
            : '0';
        settingsLocalLibraryFilesDatabaseListenHistoryThresholdSeconds.value = values.localLibraryFilesDatabaseListenHistoryThresholdSeconds > 0
            ? String(values.localLibraryFilesDatabaseListenHistoryThresholdSeconds)
            : '30';
        settingsFFmpegPath.value = values.ffmpegPath || '';
        settingsLibrarySharingEnabled.checked = !!values.librarySharingEnabled;
        settingsLibrarySharingPort.value = values.librarySharingPort && values.librarySharingPort > 0 ? String(values.librarySharingPort) : String(defaultLibrarySharingPort);
        settingsLibrarySharingPassword.value = values.librarySharingPassword || '';
        librarySharingPasswordHash = values.librarySharingPasswordHash || '';
        settingsListenBrainzToken.value = values.listenBrainzUserToken || '';
        settingsLastFmApiKey.value = values.lastFmApiKey || '';
        settingsLastFmApiSecret.value = values.lastFmApiSecret || '';
        settingsLastFmSessionKey.value = values.lastFmSessionKey || '';
        settingsScrobblingEnabled.checked = values.scrobblingEnabled !== false;
        settingsScrobbleFilterMode.value = values.scrobbleFilterMode === 'whitelist' ? 'whitelist' : 'blacklist';
        controllerState.scrobbleRules = normalizeScrobbleRules(values.scrobbleRules);
        settingsMusicBrainzServerUrl.value = values.musicBrainzServerUrl || '';
        settingsMusicBrainzRequestRateMs.value = values.musicBrainzRequestRateMs > 0 ? String(values.musicBrainzRequestRateMs) : '';
        settingsListenBrainzServerUrl.value = values.listenBrainzServerUrl || '';
        settingsListenBrainzRequestRateMs.value = values.listenBrainzRequestRateMs > 0 ? String(values.listenBrainzRequestRateMs) : '';
        refreshMusicBrainzRateControls();
        refreshListenBrainzRateControls();
        refreshAudioOutputDevices(values.audioOutputDevices, values.audioOutputDevice || 'default');
        settingsSavePlaylistsOnAddRemove.checked = values.savePlaylistsOnAddRemove === true;
        settingsAudioOutputBufferMs.value = values.audioOutputBufferMs > 0 ? String(values.audioOutputBufferMs) : '';
        settingsGaplessPlayback.checked = !!values.gaplessPlayback;
        settingsReplayGain.checked = !!values.replayGainEnabled;
        settingsPreferMusicBrainzMetadata.checked = !!values.preferMusicBrainzMetadata;
        settingsMusicBrainzTagDatabaseEnabled.checked = !!values.musicBrainzTagDatabaseEnabled;
        settingsHighlightMusicBrainzTaggedAlbumFolders.checked = !!values.highlightMusicBrainzTaggedAlbumFolders;
        settingsMusicBrainzTagStaleDays.value = String(values.musicBrainzTagStaleDays);
        settingsMusicBrainzTagRequestStaggeringEnabled.checked = !!values.musicBrainzTagRequestStaggeringEnabled;
        settingsMusicBrainzTagWorkerCores.value = values.musicBrainzTagWorkerCores > 0 ? String(values.musicBrainzTagWorkerCores) : '';
        settingsLissajousEnabled.checked = values.lissajousEnabled !== false;
        settingsLissajousScale.value = String(normalizeLissajousScale(values.lissajousScale));
        settingsVisualizerMode.value = values.visualizerMode === 'equalizer' ? 'equalizer' : 'lissajous';
        settingsEqualizerPosition.value = values.equalizerPosition === 'top' ? 'top' : 'bottom';
        refreshEqualizerPositionControls();
        settingsUiDitheringEnabled.checked = values.uiDitheringEnabled !== false;
        settingsMinimizeToTrayOnClose.checked = !!values.minimizeToTrayOnClose;
        refreshLocalLibraryFilesDatabaseControls();
        refreshMusicBrainzTagWorkerControls();
        renderMusicBrainzTagWorkerProgress(values.musicBrainzTagWorkerProgress);
        const roonAccentTheme = options.getRoonAccentTheme();
        settingsRoonAccentColor.value = roonAccentTheme.color;
        settingsRoonAccentSaturation.value = String(roonAccentTheme.saturation);
        refreshRoonAccentFieldPreview();
        setShortcutValues(normalizeFocusedKeyboardShortcuts(values.keyboardShortcuts));
        controllerState.favoritePlaylists = normalizeFavoritePlaylists(values.favoritePlaylists);
        controllerState.customSendToActions = normalizeCustomSendToActions(values.customSendToActions || []);
        controllerState.coverArtPriority = normalizeCoverArtPriority(values.coverArtPriority);
        controllerState.coverArtPriorityOrder = normalizeCoverArtPriorityOrder(values.coverArtPriority);
        controllerState.selectedLibraryFolderIndex = controllerState.libraryFolders.length > 0 ? 0 : -1;
        controllerState.selectedFavoritePlaylistIndex = -1;
        controllerState.selectedScrobbleRuleIndex = -1;
        controllerState.selectedCustomSendToActionIndex = -1;
        controllerState.lastLibraryFolderClickIndex = -1;
        controllerState.lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
        controllerState.lastScrobbleRuleClickIndex = -1;
        controllerState.lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
        controllerState.lastCustomSendToActionClickIndex = -1;
        controllerState.lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;
        doRenderLibraryFolderList();
        doRenderFavoritePlaylistList();
        doRenderScrobbleRuleList();
        doRenderCustomSendToActionList();
        doRenderCoverArtPriorityList();
        if (controllerState.forceReloadInProgress) {
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
        startMusicBrainzTagWorkerProgressRefresh();
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
            if (controllerState.libraryFolders.length > 0) {
                settingsLibraryFolderList.focus();
                return;
            }

            settingsAddLibraryFolder.focus();
            return;
        }
        if (initialTab === 'database') {
            settingsMusicBrainzTagDatabaseEnabled.focus();
            return;
        }
        if (primaryTab === 'library') {
            settingsLocalLibraryFilesDatabaseEnabled.focus();
            return;
        }
        if (primaryTab === 'network') {
            settingsLibrarySharingEnabled.focus();
            return;
        }
        if (primaryTab === 'playlists') {
            settingsFavoritePlaylistList.focus();
            return;
        }
        if (primaryTab === 'scrobbling') {
            settingsScrobblingEnabled.focus();
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

        settingsRoonAccentColor.focus();
    };

    bindShortcutCaptureInput(settingsShortcutPlayPauseToggle);
    bindShortcutCaptureInput(settingsShortcutNextTrack);
    bindShortcutCaptureInput(settingsShortcutPreviousTrack);
    bindShortcutCaptureInput(settingsShortcutStopPlayback);
    bindShortcutCaptureInput(settingsShortcutFocusLibraryFilter);
    bindShortcutCaptureInput(settingsShortcutOpenSettings);

    setShortcutAccordionExpanded(false, false);
    setCoverArtPriorityAccordionExpanded(false, false);
    renderMusicBrainzTagWorkerProgress(controllerState.musicBrainzTagWorkerProgress);
    refreshLastFmSessionFetchButton();
    refreshEqualizerPositionControls();

    const eventContext: SettingsControllerEventContext = {
        elements,
        options,
        libraryFolderRepeatClickWindowMs,
        settingsTabScrollStepPx,
        get libraryFolders() {
            return controllerState.libraryFolders;
        },
        set libraryFolders(value) {
            controllerState.libraryFolders = value;
        },
        get selectedLibraryFolderIndex() {
            return controllerState.selectedLibraryFolderIndex;
        },
        set selectedLibraryFolderIndex(value) {
            controllerState.selectedLibraryFolderIndex = value;
        },
        get lastLibraryFolderClickIndex() {
            return controllerState.lastLibraryFolderClickIndex;
        },
        set lastLibraryFolderClickIndex(value) {
            controllerState.lastLibraryFolderClickIndex = value;
        },
        get lastLibraryFolderClickAt() {
            return controllerState.lastLibraryFolderClickAt;
        },
        set lastLibraryFolderClickAt(value) {
            controllerState.lastLibraryFolderClickAt = value;
        },
        get favoritePlaylists() {
            return controllerState.favoritePlaylists;
        },
        set favoritePlaylists(value) {
            controllerState.favoritePlaylists = value;
        },
        get selectedFavoritePlaylistIndex() {
            return controllerState.selectedFavoritePlaylistIndex;
        },
        set selectedFavoritePlaylistIndex(value) {
            controllerState.selectedFavoritePlaylistIndex = value;
        },
        get scrobbleRules() {
            return controllerState.scrobbleRules;
        },
        set scrobbleRules(value) {
            controllerState.scrobbleRules = value;
        },
        get selectedScrobbleRuleIndex() {
            return controllerState.selectedScrobbleRuleIndex;
        },
        set selectedScrobbleRuleIndex(value) {
            controllerState.selectedScrobbleRuleIndex = value;
        },
        get lastScrobbleRuleClickIndex() {
            return controllerState.lastScrobbleRuleClickIndex;
        },
        set lastScrobbleRuleClickIndex(value) {
            controllerState.lastScrobbleRuleClickIndex = value;
        },
        get lastScrobbleRuleClickAt() {
            return controllerState.lastScrobbleRuleClickAt;
        },
        set lastScrobbleRuleClickAt(value) {
            controllerState.lastScrobbleRuleClickAt = value;
        },
        get customSendToActions() {
            return controllerState.customSendToActions;
        },
        set customSendToActions(value) {
            controllerState.customSendToActions = value;
        },
        get selectedCustomSendToActionIndex() {
            return controllerState.selectedCustomSendToActionIndex;
        },
        set selectedCustomSendToActionIndex(value) {
            controllerState.selectedCustomSendToActionIndex = value;
        },
        get lastCustomSendToActionClickIndex() {
            return controllerState.lastCustomSendToActionClickIndex;
        },
        set lastCustomSendToActionClickIndex(value) {
            controllerState.lastCustomSendToActionClickIndex = value;
        },
        get lastCustomSendToActionClickAt() {
            return controllerState.lastCustomSendToActionClickAt;
        },
        set lastCustomSendToActionClickAt(value) {
            controllerState.lastCustomSendToActionClickAt = value;
        },
        get coverArtPriorityOrder() {
            return controllerState.coverArtPriorityOrder;
        },
        set coverArtPriorityOrder(value) {
            controllerState.coverArtPriorityOrder = value;
        },
        get draggedCoverPriorityIndex() {
            return controllerState.draggedCoverPriorityIndex;
        },
        set draggedCoverPriorityIndex(value) {
            controllerState.draggedCoverPriorityIndex = value;
        },
        get forceReloadInProgress() {
            return controllerState.forceReloadInProgress;
        },
        set forceReloadInProgress(value) {
            controllerState.forceReloadInProgress = value;
        },
        get forceReloadEtaSeconds() {
            return controllerState.forceReloadEtaSeconds;
        },
        set forceReloadEtaSeconds(value) {
            controllerState.forceReloadEtaSeconds = value;
        },
        get lastFmSessionFetchInProgress() {
            return controllerState.lastFmSessionFetchInProgress;
        },
        set lastFmSessionFetchInProgress(value) {
            controllerState.lastFmSessionFetchInProgress = value;
        },
        setShortcutAccordionExpanded,
        setCoverArtPriorityAccordionExpanded,
        scrollShortcutAccordionIntoView,
        scrollCoverArtPriorityAccordionIntoView,
        refreshLastFmSessionFetchButton,
        refreshLocalLibraryFilesDatabaseControls,
        refreshMusicBrainzTagWorkerControls,
        refreshMusicBrainzRateControls,
        refreshListenBrainzRateControls,
        refreshEqualizerPositionControls,
        refreshRoonAccentFieldPreview,
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
