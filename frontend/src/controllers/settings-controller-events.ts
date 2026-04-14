import type { SettingsModalElements } from '../components/overlays/settings-modal';
import type {
    AudioOutputDevice,
    AppLibraryFolder,
    CoverArtPrioritySource,
    CustomSendToAction,
    ScrobbleRule,
    ScrobbleRuleOperator,
} from '../types/app-types';
import {
    asReleaseDepth,
    libraryFolderPathKey,
    normalizeLibraryFolderLabel,
    normalizeLibraryFolders,
    normalizeScrobbleRules,
    validateScrobbleRules,
} from '../utils/main-helpers';
import { errorMessage } from '../utils/display-helpers';
import type {
    LibraryFolderDialogValues,
    ScrobbleRuleDialogValues,
    SendToActionDialogValues,
    SettingsControllerOptions,
    SettingsFormValues,
    SettingsTab,
} from './settings-controller-types';
import {
    asCustomSendToActionScope,
    asScrobbleRuleField,
    normalizeCustomSendToActions,
    normalizeFavoritePlaylists,
} from './settings-controller-utils';

export interface SettingsControllerEventContext {
    elements: SettingsModalElements;
    options: SettingsControllerOptions;
    libraryFolderRepeatClickWindowMs: number;
    settingsTabScrollStepPx: number;
    libraryFolders: AppLibraryFolder[];
    selectedLibraryFolderIndex: number;
    lastLibraryFolderClickIndex: number;
    lastLibraryFolderClickAt: number;
    favoritePlaylists: string[];
    selectedFavoritePlaylistIndex: number;
    scrobbleRules: ScrobbleRule[];
    selectedScrobbleRuleIndex: number;
    lastScrobbleRuleClickIndex: number;
    lastScrobbleRuleClickAt: number;
    customSendToActions: CustomSendToAction[];
    selectedCustomSendToActionIndex: number;
    lastCustomSendToActionClickIndex: number;
    lastCustomSendToActionClickAt: number;
    coverArtPriorityOrder: CoverArtPrioritySource[];
    draggedCoverPriorityIndex: number;
    forceReloadInProgress: boolean;
    forceReloadEtaSeconds: number | null;
    lastFmSessionFetchInProgress: boolean;
    setShortcutAccordionExpanded: (expanded: boolean, animate?: boolean) => void;
    setCoverArtPriorityAccordionExpanded: (expanded: boolean, animate?: boolean) => void;
    scrollShortcutAccordionIntoView: () => void;
    scrollCoverArtPriorityAccordionIntoView: () => void;
    refreshLastFmSessionFetchButton: () => void;
    refreshLocalLibraryFilesDatabaseControls: () => void;
    refreshMusicBrainzTagWorkerControls: () => void;
    refreshMusicBrainzRateControls: () => void;
    refreshListenBrainzRateControls: () => void;
    refreshEqualizerPositionControls: () => void;
    refreshScrobbleRuleDialogControls: (preferredOperator?: ScrobbleRuleOperator) => void;
    refreshAudioOutputDevices: (devices: AudioOutputDevice[], selectedDevice: string) => void;
    refreshForceReloadStatus: () => void;
    clearCoverArtDragState: () => void;
    moveCoverArtPriority: (fromIndex: number, toIndex: number) => void;
    setCoverArtPrioritySourceEnabled: (source: CoverArtPrioritySource, enabled: boolean) => void;
    doRenderLibraryFolderList: () => void;
    doRenderFavoritePlaylistList: () => void;
    doRenderScrobbleRuleList: () => void;
    doRenderCustomSendToActionList: () => void;
    doRenderCoverArtPriorityList: () => void;
    setSelectedLibraryFolderIndex: (index: number) => void;
    setSelectedCustomSendToActionIndex: (index: number) => void;
    buildFormValues: () => SettingsFormValues;
    doOpenLibraryDepthDialog: (initialValues: LibraryFolderDialogValues, confirmLabel: string, title: string) => Promise<LibraryFolderDialogValues | null>;
    doOpenScrobbleRuleDialog: (initialValues: ScrobbleRuleDialogValues, confirmLabel: string, title: string) => Promise<ScrobbleRuleDialogValues | null>;
    doOpenSendToActionDialog: (initialValues: SendToActionDialogValues, confirmLabel: string, title: string) => Promise<SendToActionDialogValues | null>;
    doCloseLibraryDepthDialog: (value: LibraryFolderDialogValues | null, restoreFocus: boolean, immediate?: boolean) => void;
    doCloseScrobbleRuleDialog: (value: ScrobbleRuleDialogValues | null, restoreFocus: boolean, immediate?: boolean) => void;
    doCloseSendToActionDialog: (value: SendToActionDialogValues | null, restoreFocus: boolean, immediate?: boolean) => void;
    editLibraryFolderSettings: (index: number) => Promise<boolean>;
    editScrobbleRule: (index: number) => Promise<boolean>;
    editCustomSendToAction: (index: number) => Promise<boolean>;
    setSettingsStatusMessage: (message: string) => void;
    setLibraryDepthStatusMessage: (message: string) => void;
    setScrobbleRuleStatusMessage: (message: string) => void;
    setSendToActionStatusMessage: (message: string) => void;
    requestClose: () => Promise<boolean>;
    finalizeClose: () => void;
    open: (initialTab?: SettingsTab) => void;
    setActiveTab: (tab: SettingsTab) => void;
    scrollTabsBy: (offsetPx: number) => void;
    updateTabScrollControls: () => void;
}

export const bindSettingsControllerEvents = (context: SettingsControllerEventContext): void => {
    const {
        elements,
        options,
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
        refreshScrobbleRuleDialogControls,
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
    } = context;
    const { trigger } = options;
    const {
        settingsBackdrop,
        settingsClose,
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
        settingsLibraryDepthBackdrop,
        settingsLibraryDepthForm,
        settingsLibraryDepthLabelInput,
        settingsLibraryDepthInput,
        settingsLibraryDepthCancel,
        settingsScrobbleRuleBackdrop,
        settingsScrobbleRuleForm,
        settingsScrobbleRuleField,
        settingsScrobbleRuleOperator,
        settingsScrobbleRuleValue,
        settingsScrobbleRuleCancel,
        settingsSendToActionBackdrop,
        settingsSendToActionForm,
        settingsSendToActionTitleInput,
        settingsSendToActionScopeInput,
        settingsSendToActionCommandInput,
        settingsSendToActionCancel,
        settingsFFmpegPath,
        settingsLocalLibraryFilesDatabaseEnabled,
        settingsLocalLibraryFilesDatabaseListenHistoryEnabled,
        settingsListenBrainzToken,
        settingsLastFmApiKey,
        settingsLastFmApiSecret,
        settingsLastFmSessionKey,
        settingsLastFmSessionKeyFetch,
        settingsMusicBrainzServerUrl,
        settingsListenBrainzServerUrl,
        settingsAudioOutputDevice,
        settingsApplyAudioNow,
        settingsMusicBrainzTagDatabaseEnabled,
        settingsPlayerCardLayout,
        settingsVisualizerMode,
        settingsLissajousScale,
        settingsCoverArtPriorityAccordionToggle,
        settingsCoverArtPriorityAccordionPanel,
        settingsCoverArtPriorityList,
    } = elements;

    const bindAccordionHeaderToggle = (
        toggle: HTMLButtonElement,
        panel: HTMLDivElement,
        setExpanded: (expanded: boolean, animate?: boolean) => void,
        scrollIntoView: () => void,
    ): void => {
        const activate = (): void => {
            const shouldExpand = panel.hidden !== false;
            setExpanded(shouldExpand);
            if (shouldExpand) {
                window.requestAnimationFrame(() => {
                    scrollIntoView();
                });
            }
        };

        toggle.addEventListener('click', () => {
            activate();
        });

        const header = toggle.parentElement;
        if (header instanceof HTMLDivElement && header.classList.contains('settings-accordion-header')) {
            header.addEventListener('click', (event) => {
                const target = event.target;
                if (!(target instanceof Element)) {
                    return;
                }

                if (target.closest('.settings-tooltip') || target.closest('.settings-accordion-toggle')) {
                    return;
                }

                activate();
                toggle.focus();
            });
        }
    };

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
        doCloseLibraryDepthDialog(null, true);
    });

    settingsLibraryDepthCancel.addEventListener('click', () => {
        doCloseLibraryDepthDialog(null, true);
    });

    settingsScrobbleRuleBackdrop.addEventListener('click', () => {
        doCloseScrobbleRuleDialog(null, true);
    });

    settingsScrobbleRuleCancel.addEventListener('click', () => {
        doCloseScrobbleRuleDialog(null, true);
    });

    settingsSendToActionBackdrop.addEventListener('click', () => {
        doCloseSendToActionDialog(null, true);
    });

    settingsSendToActionCancel.addEventListener('click', () => {
        doCloseSendToActionDialog(null, true);
    });

    settingsLibraryDepthForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const normalizedLabel = normalizeLibraryFolderLabel(settingsLibraryDepthLabelInput.value);
        const trimmed = settingsLibraryDepthInput.value.trim();
        if (trimmed === '') {
            doCloseLibraryDepthDialog({ label: normalizedLabel, releaseDepth: 0 }, false);
            return;
        }

        if (!/^\d+$/.test(trimmed)) {
            setLibraryDepthStatusMessage('Enter a whole number 0 or greater.');
            settingsLibraryDepthInput.focus();
            settingsLibraryDepthInput.select();
            return;
        }

        doCloseLibraryDepthDialog({
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

        doCloseScrobbleRuleDialog(nextRules[0], false);
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

        doCloseSendToActionDialog({ title, scope, commandTemplate }, false);
    });

    trigger.addEventListener('click', () => {
        open();
    });

    settingsBackdrop.addEventListener('click', () => {
        void requestClose();
    });

    settingsClose.addEventListener('click', () => {
        void requestClose();
    });

    settingsTabGeneral.addEventListener('click', () => {
        setActiveTab('general');
        if (context.libraryFolders.length > 0) {
            settingsLibraryFolderList.focus();
            return;
        }

        settingsAddLibraryFolder.focus();
    });

    settingsTabLibrary.addEventListener('click', () => {
        setActiveTab('library');
        settingsLocalLibraryFilesDatabaseEnabled.focus();
    });

    settingsTabNetwork.addEventListener('click', () => {
        setActiveTab('network');
        settingsListenBrainzToken.focus();
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

    settingsTabUi.addEventListener('click', () => {
        setActiveTab('ui');
        settingsPlayerCardLayout.focus();
    });

    settingsTabsScrollLeft.addEventListener('click', () => {
        scrollTabsBy(-context.settingsTabScrollStepPx);
    });

    settingsTabsScrollRight.addEventListener('click', () => {
        scrollTabsBy(context.settingsTabScrollStepPx);
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

    settingsLocalLibraryFilesDatabaseEnabled.addEventListener('change', () => {
        refreshLocalLibraryFilesDatabaseControls();
    });

    settingsLocalLibraryFilesDatabaseListenHistoryEnabled.addEventListener('change', () => {
        refreshLocalLibraryFilesDatabaseControls();
    });

    settingsMusicBrainzServerUrl.addEventListener('input', () => {
        refreshMusicBrainzRateControls();
    });

    settingsListenBrainzServerUrl.addEventListener('input', () => {
        refreshListenBrainzRateControls();
    });

    settingsVisualizerMode.addEventListener('change', () => {
        refreshEqualizerPositionControls();
    });

    settingsLissajousScale.addEventListener('input', () => {
        refreshEqualizerPositionControls();
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

            const refreshedAudioState = await options.applyAudioNow(formValues);
            refreshAudioOutputDevices(refreshedAudioState.devices, refreshedAudioState.selectedDevice || 'default');
            setSettingsStatusMessage(refreshedAudioState.message || 'Audio settings refreshed.');
        } catch (error) {
            console.error(error);
            const message = errorMessage(error).trim();
            setSettingsStatusMessage(message === ''
                ? 'Unable to refresh audio settings right now.'
                : `Unable to refresh audio settings right now: ${message}`);
        } finally {
            settingsApplyAudioNow.disabled = false;
        }
    });

    settingsLastFmSessionKeyFetch.addEventListener('click', async () => {
        if (settingsLastFmSessionKeyFetch.disabled || context.lastFmSessionFetchInProgress) {
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

        context.lastFmSessionFetchInProgress = true;
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
            context.lastFmSessionFetchInProgress = false;
            refreshLastFmSessionFetchButton();
        }
    });

    bindAccordionHeaderToggle(
        settingsShortcutAccordionToggle,
        settingsShortcutAccordionPanel,
        setShortcutAccordionExpanded,
        scrollShortcutAccordionIntoView,
    );

    bindAccordionHeaderToggle(
        settingsCoverArtPriorityAccordionToggle,
        settingsCoverArtPriorityAccordionPanel,
        setCoverArtPriorityAccordionExpanded,
        scrollCoverArtPriorityAccordionIntoView,
    );

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
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= context.favoritePlaylists.length) {
            return;
        }

        context.selectedFavoritePlaylistIndex = nextIndex;
        doRenderFavoritePlaylistList();
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
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= context.scrobbleRules.length) {
            return;
        }

        const isRepeatClick = nextIndex === context.lastScrobbleRuleClickIndex
            && event.timeStamp - context.lastScrobbleRuleClickAt <= context.libraryFolderRepeatClickWindowMs;

        context.lastScrobbleRuleClickIndex = nextIndex;
        context.lastScrobbleRuleClickAt = event.timeStamp;
        context.selectedScrobbleRuleIndex = nextIndex;
        doRenderScrobbleRuleList();

        if (!isRepeatClick) {
            return;
        }

        context.lastScrobbleRuleClickIndex = -1;
        context.lastScrobbleRuleClickAt = Number.NEGATIVE_INFINITY;
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
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= context.customSendToActions.length) {
            return;
        }

        const isRepeatClick = nextIndex === context.lastCustomSendToActionClickIndex
            && event.timeStamp - context.lastCustomSendToActionClickAt <= context.libraryFolderRepeatClickWindowMs;
        context.lastCustomSendToActionClickIndex = nextIndex;
        context.lastCustomSendToActionClickAt = event.timeStamp;
        setSelectedCustomSendToActionIndex(nextIndex);

        if (!isRepeatClick) {
            return;
        }

        context.lastCustomSendToActionClickIndex = -1;
        context.lastCustomSendToActionClickAt = Number.NEGATIVE_INFINITY;
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
        if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= context.libraryFolders.length) {
            return;
        }

        const isRepeatClick = nextIndex === context.lastLibraryFolderClickIndex
            && event.timeStamp - context.lastLibraryFolderClickAt <= context.libraryFolderRepeatClickWindowMs;

        context.lastLibraryFolderClickIndex = nextIndex;
        context.lastLibraryFolderClickAt = event.timeStamp;
        setSelectedLibraryFolderIndex(nextIndex);

        if (!isRepeatClick) {
            return;
        }

        context.lastLibraryFolderClickIndex = -1;
        context.lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
        void editLibraryFolderSettings(nextIndex);
    });

    settingsAddLibraryFolder.addEventListener('click', async () => {
        setSettingsStatusMessage('');

        try {
            const selectedFolder = await options.selectLibraryFolder();
            if (!selectedFolder) {
                return;
            }

            const selectedFolderKey = libraryFolderPathKey(selectedFolder);
            const existingIndex = context.libraryFolders.findIndex((folder) => libraryFolderPathKey(folder.path) === selectedFolderKey);
            const existingFolder = existingIndex >= 0 ? context.libraryFolders[existingIndex] : null;

            const nextValues = await doOpenLibraryDepthDialog(
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
                context.libraryFolders[existingIndex] = {
                    ...context.libraryFolders[existingIndex],
                    label: nextValues.label,
                    releaseDepth: nextValues.releaseDepth,
                };
                setSelectedLibraryFolderIndex(existingIndex);
                settingsLibraryFolderList.focus();
                return;
            }

            context.libraryFolders = normalizeLibraryFolders([...context.libraryFolders, {
                path: selectedFolder,
                label: nextValues.label,
                releaseDepth: nextValues.releaseDepth,
            }]);
            setSelectedLibraryFolderIndex(context.libraryFolders.findIndex((folder) => libraryFolderPathKey(folder.path) === selectedFolderKey));
            settingsLibraryFolderList.focus();
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage('Unable to open folder picker.');
        }
    });

    settingsRemoveLibraryFolder.addEventListener('click', () => {
        if (context.selectedLibraryFolderIndex < 0 || context.selectedLibraryFolderIndex >= context.libraryFolders.length) {
            return;
        }

        context.libraryFolders.splice(context.selectedLibraryFolderIndex, 1);
        if (context.libraryFolders.length === 0) {
            context.selectedLibraryFolderIndex = -1;
        } else if (context.selectedLibraryFolderIndex >= context.libraryFolders.length) {
            context.selectedLibraryFolderIndex = context.libraryFolders.length - 1;
        }

        doRenderLibraryFolderList();
    });

    settingsAddFavoritePlaylist.addEventListener('click', async () => {
        setSettingsStatusMessage('');

        try {
            const selectedPlaylist = await options.selectPlaylistFile();
            if (!selectedPlaylist) {
                return;
            }

            context.favoritePlaylists = normalizeFavoritePlaylists([...context.favoritePlaylists, selectedPlaylist]);
            context.selectedFavoritePlaylistIndex = context.favoritePlaylists.findIndex((playlistPath) => playlistPath === selectedPlaylist.trim());
            doRenderFavoritePlaylistList();
        } catch (error) {
            console.error(error);
            setSettingsStatusMessage('Unable to open playlist picker.');
        }
    });

    settingsAddScrobbleRule.addEventListener('click', async () => {
        setSettingsStatusMessage('');

        const nextRule = await doOpenScrobbleRuleDialog({ field: 'path', operator: 'starts_with', value: '' }, 'Add rule', 'Add scrobble rule');
        if (nextRule === null) {
            return;
        }

        context.scrobbleRules = normalizeScrobbleRules([...context.scrobbleRules, nextRule]);
        context.selectedScrobbleRuleIndex = context.scrobbleRules.findIndex((rule) => (
            rule.field === nextRule.field && rule.operator === nextRule.operator && rule.value === nextRule.value
        ));
        doRenderScrobbleRuleList();
    });

    settingsAddSendToAction.addEventListener('click', async () => {
        const nextAction = await doOpenSendToActionDialog({
            title: '',
            scope: 'track',
            commandTemplate: '',
        }, 'Add action', 'Add send to action');
        if (nextAction === null) {
            return;
        }

        context.customSendToActions = normalizeCustomSendToActions([...context.customSendToActions, {
            title: nextAction.title,
            scope: nextAction.scope,
            commandTemplate: nextAction.commandTemplate,
        }]);
        context.selectedCustomSendToActionIndex = context.customSendToActions.findIndex((candidate) => (
            candidate.title === nextAction.title
                && candidate.scope === nextAction.scope
                && candidate.commandTemplate === nextAction.commandTemplate
        ));
        doRenderCustomSendToActionList();
        setSettingsStatusMessage('');
        settingsSendToActionList.focus();
    });

    settingsRemoveFavoritePlaylist.addEventListener('click', () => {
        if (context.selectedFavoritePlaylistIndex < 0 || context.selectedFavoritePlaylistIndex >= context.favoritePlaylists.length) {
            return;
        }

        context.favoritePlaylists.splice(context.selectedFavoritePlaylistIndex, 1);
        context.selectedFavoritePlaylistIndex = -1;
        doRenderFavoritePlaylistList();
    });

    settingsRemoveScrobbleRule.addEventListener('click', () => {
        if (context.selectedScrobbleRuleIndex < 0 || context.selectedScrobbleRuleIndex >= context.scrobbleRules.length) {
            return;
        }

        context.scrobbleRules.splice(context.selectedScrobbleRuleIndex, 1);
        context.selectedScrobbleRuleIndex = -1;
        doRenderScrobbleRuleList();
    });

    settingsRemoveSendToAction.addEventListener('click', () => {
        if (context.selectedCustomSendToActionIndex < 0 || context.selectedCustomSendToActionIndex >= context.customSendToActions.length) {
            return;
        }

        context.customSendToActions.splice(context.selectedCustomSendToActionIndex, 1);
        context.selectedCustomSendToActionIndex = -1;
        doRenderCustomSendToActionList();
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
        if (!Number.isInteger(index) || index < 0 || index >= context.coverArtPriorityOrder.length) {
            return;
        }

        context.draggedCoverPriorityIndex = index;
        settingsCoverArtPriorityList.classList.add('is-dragging');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(index));
        }
    });

    settingsCoverArtPriorityList.addEventListener('dragover', (event) => {
        if (context.draggedCoverPriorityIndex < 0) {
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
        if (context.draggedCoverPriorityIndex < 0) {
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

        moveCoverArtPriority(context.draggedCoverPriorityIndex, destinationIndex);
        clearCoverArtDragState();
        doRenderCoverArtPriorityList();
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
        doRenderCoverArtPriorityList();
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

        context.forceReloadInProgress = true;
        context.forceReloadEtaSeconds = null;
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
            context.forceReloadInProgress = false;
            context.forceReloadEtaSeconds = null;
            setSettingsStatusMessage('Library reloaded.');
        } catch (error) {
            console.error(error);
            context.forceReloadInProgress = false;
            context.forceReloadEtaSeconds = null;
            setSettingsStatusMessage('Unable to force reload library.');
        } finally {
            settingsForceReload.disabled = false;
            settingsSave.disabled = false;
            refreshLastFmSessionFetchButton();
        }
    });
};