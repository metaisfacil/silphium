import { describe, expect, it } from 'vitest';

import { createSettingsTabRuntime } from './settings-controller-layout';
import type { SettingsPrimaryTab } from './settings-controller-types';

const createTabButton = (): HTMLButtonElement => {
    const button = document.createElement('button');
    button.className = 'settings-tab';
    return button;
};

const createPanel = (): HTMLDivElement => {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    return panel;
};

const createRuntime = () => {
    const settingsTabs = document.createElement('div') as HTMLDivElement;
    const settingsTabsShell = document.createElement('div') as HTMLDivElement;
    settingsTabsShell.append(settingsTabs);

    const settingsTabsScrollLeft = document.createElement('button') as HTMLButtonElement;
    const settingsTabsScrollRight = document.createElement('button') as HTMLButtonElement;

    const settingsTabButtons: Record<SettingsPrimaryTab, HTMLButtonElement> = {
        general: createTabButton(),
        network: createTabButton(),
        database: createTabButton(),
        playlists: createTabButton(),
        scrobbling: createTabButton(),
        audio: createTabButton(),
        ui: createTabButton(),
        actions: createTabButton(),
    };

    const settingsTabPanels: Record<SettingsPrimaryTab, HTMLDivElement> = {
        general: createPanel(),
        network: createPanel(),
        database: createPanel(),
        playlists: createPanel(),
        scrobbling: createPanel(),
        audio: createPanel(),
        ui: createPanel(),
        actions: createPanel(),
    };

    return {
        runtime: createSettingsTabRuntime({
            settingsTabs,
            settingsTabsShell,
            settingsTabsScrollLeft,
            settingsTabsScrollRight,
            settingsTabButtons,
            settingsTabPanels,
        }),
        settingsTabPanels,
    };
};

describe('createSettingsTabRuntime', () => {
    it('resets the active panel scroll position when switching tabs', () => {
        const { runtime, settingsTabPanels } = createRuntime();

        settingsTabPanels.network.scrollTop = 128;
        runtime.setActiveTab('network');

        expect(settingsTabPanels.network.scrollTop).toBe(0);
    });
});
