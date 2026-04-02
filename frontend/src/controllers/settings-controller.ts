import type { SettingsModalElements } from '../components/overlays/settings-modal';

export type SettingsFormValues = {
    libraryPath: string;
    listenBrainzUserToken: string;
    releaseDepth: number;
    favoritePlaylists: string[];
};

type SettingsControllerOptions = {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    getValues: () => SettingsFormValues;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    save: (values: SettingsFormValues) => Promise<void>;
};

export type SettingsController = ReturnType<typeof createSettingsController>;

export const createSettingsController = (options: SettingsControllerOptions) => {
    const { trigger, elements } = options;
    const {
        settingsModal,
        settingsBackdrop,
        settingsClose,
        settingsTabGeneral,
        settingsTabPlaylists,
        settingsPanelGeneral,
        settingsPanelPlaylists,
        settingsBrowse,
        settingsAddFavoritePlaylist,
        settingsSave,
        settingsLibraryPath,
        settingsListenBrainzToken,
        settingsReleaseDepth,
        settingsFavoritePlaylists,
        settingsStatus,
    } = elements;

    const normalizeFavoritePlaylists = (rawText: string): string[] => {
        const deduped = new Set<string>();
        const lines = rawText
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter((line) => line !== '');

        lines.forEach((line) => {
            deduped.add(line);
        });

        return Array.from(deduped);
    };

    const setActiveTab = (tab: 'general' | 'playlists'): void => {
        const generalActive = tab === 'general';
        settingsTabGeneral.classList.toggle('is-active', generalActive);
        settingsTabPlaylists.classList.toggle('is-active', !generalActive);
        settingsTabGeneral.setAttribute('aria-selected', generalActive ? 'true' : 'false');
        settingsTabPlaylists.setAttribute('aria-selected', generalActive ? 'false' : 'true');
        settingsPanelGeneral.hidden = !generalActive;
        settingsPanelPlaylists.hidden = generalActive;
    };

    const close = (): void => {
        settingsModal.hidden = true;
        settingsStatus.textContent = '';
    };

    const open = (): void => {
        const values = options.getValues();
        settingsLibraryPath.value = values.libraryPath || '';
        settingsListenBrainzToken.value = values.listenBrainzUserToken || '';
        settingsReleaseDepth.value = values.releaseDepth > 0 ? String(values.releaseDepth) : '';
        settingsFavoritePlaylists.value = values.favoritePlaylists.join('\n');
        settingsStatus.textContent = '';
        setActiveTab('general');
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

    settingsTabGeneral.addEventListener('click', () => {
        setActiveTab('general');
    });

    settingsTabPlaylists.addEventListener('click', () => {
        setActiveTab('playlists');
        settingsFavoritePlaylists.focus();
    });

    settingsAddFavoritePlaylist.addEventListener('click', async () => {
        settingsStatus.textContent = '';

        try {
            const selectedPlaylist = await options.selectPlaylistFile();
            if (!selectedPlaylist) {
                return;
            }

            const next = new Set(normalizeFavoritePlaylists(settingsFavoritePlaylists.value));
            next.add(selectedPlaylist.trim());
            settingsFavoritePlaylists.value = Array.from(next).join('\n');
        } catch (error) {
            console.error(error);
            settingsStatus.textContent = 'Unable to open playlist picker.';
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
            favoritePlaylists: normalizeFavoritePlaylists(settingsFavoritePlaylists.value),
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