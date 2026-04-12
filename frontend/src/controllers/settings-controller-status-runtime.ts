import { formatEtaLabel, isLocalDevelopmentServer, normalizeServerRequestRateMs, PUBLIC_MIN_RATE_LIMIT_MS } from './settings-controller-utils';

export interface SettingsControllerStatusRuntimeContext {
    settingsModalTransitionMs: number;
    settingsShortcutAccordionTransitionMs: number;
    statusFadeDelayMs: number;
    settingsShortcutAccordionToggle: HTMLButtonElement;
    settingsShortcutAccordionPanel: HTMLDivElement;
    settingsCoverArtPriorityAccordionToggle: HTMLButtonElement;
    settingsCoverArtPriorityAccordionPanel: HTMLDivElement;
    settingsStatus: HTMLParagraphElement;
    settingsLibraryDepthStatus: HTMLParagraphElement;
    settingsScrobbleRuleStatus: HTMLParagraphElement;
    settingsSendToActionStatus: HTMLParagraphElement;
    settingsMusicBrainzServerUrl: HTMLInputElement;
    settingsMusicBrainzRequestRateMs: HTMLInputElement;
    settingsListenBrainzServerUrl: HTMLInputElement;
    settingsListenBrainzRequestRateMs: HTMLInputElement;
    settingsLocalLibraryFilesDatabaseEnabled: HTMLInputElement;
    settingsLocalLibraryFilesDatabaseLoadOnStartup: HTMLInputElement;
    settingsLocalLibraryFilesDatabaseListenHistoryEnabled: HTMLInputElement;
    settingsLocalLibraryFilesDatabaseListenHistoryLimit: HTMLInputElement;
    settingsMusicBrainzTagDatabaseEnabled: HTMLInputElement;
    settingsHighlightMusicBrainzTaggedAlbumFolders: HTMLInputElement;
    settingsMusicBrainzTagStaleDays: HTMLInputElement;
    settingsMusicBrainzTagRequestStaggeringEnabled: HTMLInputElement;
    settingsMusicBrainzTagWorkerCores: HTMLInputElement;
    settingsLastFmSessionKeyFetch: HTMLButtonElement;
    settingsSave: HTMLButtonElement;
    settingsForceReload: HTMLButtonElement;
    shortcutAccordionHideTimer: number | undefined;
    coverArtPriorityAccordionHideTimer: number | undefined;
    settingsStatusFadeTimer: number | undefined;
    libraryDepthStatusFadeTimer: number | undefined;
    forceReloadInProgress: boolean;
    forceReloadEtaSeconds: number | null;
    lastFmSessionFetchInProgress: boolean;
}

export const createSettingsControllerStatusRuntime = (context: SettingsControllerStatusRuntimeContext) => {
    const clearAccordionHideTimer = (key: 'shortcutAccordionHideTimer' | 'coverArtPriorityAccordionHideTimer'): void => {
        const timer = context[key];
        if (timer !== undefined) {
            window.clearTimeout(timer);
            context[key] = undefined;
        }
    };

    const setAccordionExpanded = (
        toggle: HTMLButtonElement,
        panel: HTMLDivElement,
        expanded: boolean,
        animate: boolean,
        hideTimerKey: 'shortcutAccordionHideTimer' | 'coverArtPriorityAccordionHideTimer',
    ): void => {
        clearAccordionHideTimer(hideTimerKey);
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
        context[hideTimerKey] = window.setTimeout(() => {
            panel.hidden = true;
            context[hideTimerKey] = undefined;
        }, context.settingsShortcutAccordionTransitionMs);
    };

    const scrollAccordionIntoView = (toggle: HTMLButtonElement, panel: HTMLDivElement): void => {
        const accordion = toggle.closest('.settings-accordion');
        const target = accordion instanceof HTMLElement ? accordion : panel;
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    const setStatusMessageWithFade = (
        element: HTMLParagraphElement,
        message: string,
        timerKey: 'settingsStatusFadeTimer' | 'libraryDepthStatusFadeTimer',
    ): void => {
        const activeTimer = context[timerKey];
        if (activeTimer !== undefined) {
            window.clearTimeout(activeTimer);
            context[timerKey] = undefined;
        }

        element.classList.remove('is-faded');
        element.textContent = message;

        if (message.trim() === '') {
            return;
        }

        context[timerKey] = window.setTimeout(() => {
            element.classList.add('is-faded');
            context[timerKey] = window.setTimeout(() => {
                element.textContent = '';
                element.classList.remove('is-faded');
                context[timerKey] = undefined;
            }, context.settingsModalTransitionMs);
        }, context.statusFadeDelayMs);
    };

    const normalizedMusicBrainzRequestRateMs = (): number => normalizeServerRequestRateMs(
        context.settingsMusicBrainzRequestRateMs.value,
        context.settingsMusicBrainzServerUrl.value,
    );

    const normalizedListenBrainzRequestRateMs = (): number => normalizeServerRequestRateMs(
        context.settingsListenBrainzRequestRateMs.value,
        context.settingsListenBrainzServerUrl.value,
    );

    const setSettingsStatusMessage = (message: string): void => {
        setStatusMessageWithFade(context.settingsStatus, message, 'settingsStatusFadeTimer');
    };

    const setLibraryDepthStatusMessage = (message: string): void => {
        setStatusMessageWithFade(context.settingsLibraryDepthStatus, message, 'libraryDepthStatusFadeTimer');
    };

    const setScrobbleRuleStatusMessage = (message: string): void => {
        context.settingsScrobbleRuleStatus.textContent = message;
    };

    const setSendToActionStatusMessage = (message: string): void => {
        context.settingsSendToActionStatus.textContent = message;
    };

    const refreshMusicBrainzRateControls = (): void => {
        const isLocal = isLocalDevelopmentServer(context.settingsMusicBrainzServerUrl.value);
        context.settingsMusicBrainzRequestRateMs.disabled = !isLocal;
        context.settingsMusicBrainzRequestRateMs.min = isLocal ? '0' : String(PUBLIC_MIN_RATE_LIMIT_MS);
        if (!isLocal) {
            context.settingsMusicBrainzRequestRateMs.value = String(normalizedMusicBrainzRequestRateMs());
        }
    };

    const refreshListenBrainzRateControls = (): void => {
        const isLocal = isLocalDevelopmentServer(context.settingsListenBrainzServerUrl.value);
        context.settingsListenBrainzRequestRateMs.disabled = !isLocal;
        context.settingsListenBrainzRequestRateMs.min = isLocal ? '0' : String(PUBLIC_MIN_RATE_LIMIT_MS);
        if (!isLocal) {
            context.settingsListenBrainzRequestRateMs.value = String(normalizedListenBrainzRequestRateMs());
        }
    };

    const refreshMusicBrainzTagWorkerControls = (): void => {
        const disabled = !context.settingsMusicBrainzTagDatabaseEnabled.checked;
        context.settingsHighlightMusicBrainzTaggedAlbumFolders.disabled = disabled;
        context.settingsMusicBrainzTagStaleDays.disabled = disabled;
        context.settingsMusicBrainzTagRequestStaggeringEnabled.disabled = disabled;
        context.settingsMusicBrainzTagWorkerCores.disabled = disabled;
    };

    const refreshLocalLibraryFilesDatabaseControls = (): void => {
        const disabled = !context.settingsLocalLibraryFilesDatabaseEnabled.checked;
        context.settingsLocalLibraryFilesDatabaseLoadOnStartup.disabled = disabled;
        context.settingsLocalLibraryFilesDatabaseListenHistoryEnabled.disabled = disabled;
        context.settingsLocalLibraryFilesDatabaseListenHistoryLimit.disabled = disabled || !context.settingsLocalLibraryFilesDatabaseListenHistoryEnabled.checked;
    };

    const refreshForceReloadStatus = (): void => {
        if (!context.forceReloadInProgress) {
            return;
        }

        const etaLabel = formatEtaLabel(context.forceReloadEtaSeconds);
        setSettingsStatusMessage(etaLabel
            ? `Reloading library... ${etaLabel} remaining`
            : 'Reloading library...');
    };

    const refreshLastFmSessionFetchButton = (): void => {
        context.settingsLastFmSessionKeyFetch.disabled = context.lastFmSessionFetchInProgress
            || context.settingsSave.disabled
            || context.settingsForceReload.disabled;
        context.settingsLastFmSessionKeyFetch.textContent = context.lastFmSessionFetchInProgress ? 'Fetching...' : 'Fetch';
    };

    const setForceReloadEtaSeconds = (secondsRemaining: number | null): void => {
        if (!context.forceReloadInProgress) {
            return;
        }

        const normalized = (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining <= 0)
            ? null
            : Math.ceil(secondsRemaining);

        if (context.forceReloadEtaSeconds === normalized) {
            return;
        }

        context.forceReloadEtaSeconds = normalized;
        refreshForceReloadStatus();
    };

    const setShortcutAccordionExpanded = (expanded: boolean, animate = true): void => {
        setAccordionExpanded(
            context.settingsShortcutAccordionToggle,
            context.settingsShortcutAccordionPanel,
            expanded,
            animate,
            'shortcutAccordionHideTimer',
        );
    };

    const setCoverArtPriorityAccordionExpanded = (expanded: boolean, animate = true): void => {
        setAccordionExpanded(
            context.settingsCoverArtPriorityAccordionToggle,
            context.settingsCoverArtPriorityAccordionPanel,
            expanded,
            animate,
            'coverArtPriorityAccordionHideTimer',
        );
    };

    return {
        normalizedListenBrainzRequestRateMs,
        normalizedMusicBrainzRequestRateMs,
        refreshForceReloadStatus,
        refreshLastFmSessionFetchButton,
        refreshLocalLibraryFilesDatabaseControls,
        refreshListenBrainzRateControls,
        refreshMusicBrainzRateControls,
        refreshMusicBrainzTagWorkerControls,
        scrollCoverArtPriorityAccordionIntoView: () => {
            scrollAccordionIntoView(context.settingsCoverArtPriorityAccordionToggle, context.settingsCoverArtPriorityAccordionPanel);
        },
        scrollShortcutAccordionIntoView: () => {
            scrollAccordionIntoView(context.settingsShortcutAccordionToggle, context.settingsShortcutAccordionPanel);
        },
        setCoverArtPriorityAccordionExpanded,
        setForceReloadEtaSeconds,
        setLibraryDepthStatusMessage,
        setScrobbleRuleStatusMessage,
        setSendToActionStatusMessage,
        setSettingsStatusMessage,
        setShortcutAccordionExpanded,
    };
};