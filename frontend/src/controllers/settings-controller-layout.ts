import { formatShortcutBindingFromKeyboardEvent } from '../utils/shortcut-bindings';
import type { SettingsPrimaryTab, SettingsTab } from './settings-controller-types';
import { resolvePrimaryTab } from './settings-controller-utils';

export interface SettingsTabRuntimeContext {
    settingsTabs: HTMLDivElement;
    settingsTabsShell: HTMLDivElement | null;
    settingsTabsScrollLeft: HTMLButtonElement;
    settingsTabsScrollRight: HTMLButtonElement;
    settingsTabButtons: Record<SettingsPrimaryTab, HTMLButtonElement>;
    settingsTabPanels: Record<SettingsPrimaryTab, HTMLDivElement>;
}

export const bindShortcutCaptureInput = (input: HTMLInputElement): void => {
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
        if (binding) {
            input.value = binding;
        }
    });

    input.addEventListener('keyup', (event) => {
        if (event.code === 'CapsLock') {
            event.preventDefault();
            event.stopPropagation();
        }
    });
};

export const createSettingsTabRuntime = (context: SettingsTabRuntimeContext) => {
    const updateTabScrollControls = (): void => {
        const maxScrollLeft = context.settingsTabs.scrollWidth - context.settingsTabs.clientWidth;
        const canScroll = maxScrollLeft > 1;
        context.settingsTabsScrollLeft.hidden = !canScroll;
        context.settingsTabsScrollRight.hidden = !canScroll;
        const hasLeftOverflow = canScroll && context.settingsTabs.scrollLeft > 1;
        const hasRightOverflow = canScroll && context.settingsTabs.scrollLeft < maxScrollLeft - 1;
        context.settingsTabsScrollLeft.disabled = !hasLeftOverflow;
        context.settingsTabsScrollRight.disabled = !hasRightOverflow;
        if (context.settingsTabsShell) {
            context.settingsTabsShell.classList.toggle('has-left-overflow', hasLeftOverflow);
            context.settingsTabsShell.classList.toggle('has-right-overflow', hasRightOverflow);
        }
    };

    const scrollTabsBy = (offsetPx: number): void => {
        context.settingsTabs.scrollBy({ left: offsetPx, behavior: 'smooth' });
    };

    const ensureTabIsVisible = (tabButton: HTMLButtonElement): void => {
        const tabLeft = tabButton.offsetLeft;
        const tabRight = tabLeft + tabButton.offsetWidth;
        const currentLeft = context.settingsTabs.scrollLeft;
        const currentRight = currentLeft + context.settingsTabs.clientWidth;

        if (tabLeft < currentLeft) {
            context.settingsTabs.scrollTo({ left: Math.max(0, tabLeft - 8), behavior: 'smooth' });
            return;
        }

        if (tabRight > currentRight) {
            const nextLeft = tabRight - context.settingsTabs.clientWidth + 8;
            context.settingsTabs.scrollTo({ left: Math.max(0, nextLeft), behavior: 'smooth' });
        }
    };

    const setActiveTab = (tab: SettingsTab): void => {
        const primaryTab = resolvePrimaryTab(tab);
        const activePanel = context.settingsTabPanels[primaryTab];
        for (const [tabName, button] of Object.entries(context.settingsTabButtons) as [SettingsPrimaryTab, HTMLButtonElement][]) {
            const isActive = tabName === primaryTab;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
            context.settingsTabPanels[tabName].hidden = !isActive;
        }

        // Always start each tab from the top when switching sections.
        activePanel.scrollTop = 0;

        ensureTabIsVisible(context.settingsTabButtons[primaryTab]);
    };

    return {
        scrollTabsBy,
        setActiveTab,
        updateTabScrollControls,
    };
};