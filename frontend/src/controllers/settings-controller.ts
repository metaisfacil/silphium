import type { SettingsModalElements } from '../components/overlays/settings-modal';

export type SettingsFormValues = {
    libraryPath: string;
    listenBrainzUserToken: string;
    releaseDepth: number;
};

type SettingsControllerOptions = {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    getValues: () => SettingsFormValues;
    selectLibraryFolder: () => Promise<string>;
    save: (values: SettingsFormValues) => Promise<void>;
};

export type SettingsController = ReturnType<typeof createSettingsController>;

export const createSettingsController = (options: SettingsControllerOptions) => {
    const { trigger, elements } = options;
    const {
        settingsModal,
        settingsBackdrop,
        settingsClose,
        settingsBrowse,
        settingsSave,
        settingsLibraryPath,
        settingsListenBrainzToken,
        settingsReleaseDepth,
        settingsStatus,
    } = elements;

    const close = (): void => {
        settingsModal.hidden = true;
        settingsStatus.textContent = '';
    };

    const open = (): void => {
        const values = options.getValues();
        settingsLibraryPath.value = values.libraryPath || '';
        settingsListenBrainzToken.value = values.listenBrainzUserToken || '';
        settingsReleaseDepth.value = values.releaseDepth > 0 ? String(values.releaseDepth) : '';
        settingsStatus.textContent = '';
        settingsModal.hidden = false;
        settingsLibraryPath.focus();
    };

    trigger.addEventListener('click', () => {
        open();
    });

    settingsBackdrop.addEventListener('click', () => {
        close();
    });

    settingsClose.addEventListener('click', () => {
        close();
    });

    settingsBrowse.addEventListener('click', async () => {
        settingsStatus.textContent = '';

        try {
            const selectedFolder = await options.selectLibraryFolder();
            if (!selectedFolder) {
                return;
            }

            settingsLibraryPath.value = selectedFolder;
        } catch (error) {
            console.error(error);
            settingsStatus.textContent = 'Unable to open folder picker.';
        }
    });

    settingsSave.addEventListener('click', async () => {
        if (settingsSave.disabled) {
            return;
        }

        settingsSave.disabled = true;
        const formValues: SettingsFormValues = {
            libraryPath: settingsLibraryPath.value,
            listenBrainzUserToken: settingsListenBrainzToken.value,
            releaseDepth: Number.parseInt(settingsReleaseDepth.value, 10) || 0,
        };
        close();

        try {
            await options.save(formValues);
        } finally {
            settingsSave.disabled = false;
        }
    });

    return {
        close,
        handleDocumentClick: (target: Node): boolean => settingsModal.contains(target),
        handleEscape: (): boolean => {
            if (settingsModal.hidden) {
                return false;
            }

            close();
            return true;
        },
        open,
    };
};