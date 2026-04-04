import type { SettingsModalElements } from '../components/overlays/settings-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { FocusedKeyboardShortcuts, PlayerCardLayout } from '../types/app-types';
import { formatShortcutBindingFromKeyboardEvent, normalizeFocusedKeyboardShortcuts } from '../utils/shortcut-bindings';

export type SettingsFormValues = {
    libraryPath: string;
    listenBrainzUserToken: string;
    releaseDepth: number;
    favoritePlaylists: string[];
    preferMusicBrainzMetadata: boolean;
    keyboardShortcuts: FocusedKeyboardShortcuts;
};

type SettingsControllerOptions = {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    getValues: () => SettingsFormValues;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    save: (values: SettingsFormValues) => Promise<void>;
    forceReload: (values: SettingsFormValues) => Promise<void>;
    getPlayerCardLayout: () => PlayerCardLayout;
    setPlayerCardLayout: (layout: PlayerCardLayout) => void;
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
        settingsTabUi,
        settingsTabShortcuts,
        settingsPanelGeneral,
        settingsPanelPlaylists,
        settingsPanelUi,
        settingsPanelShortcuts,
        settingsBrowse,
        settingsFavoritePlaylistList,
        settingsAddFavoritePlaylist,
        settingsRemoveFavoritePlaylist,
        settingsForceReload,
        settingsSave,
        settingsLibraryPath,
        settingsListenBrainzToken,
        settingsReleaseDepth,
        settingsPreferMusicBrainzMetadata,
        settingsPlayerCardLayout,
        settingsShortcutPlayPauseToggle,
        settingsShortcutNextTrack,
        settingsShortcutPreviousTrack,
        settingsShortcutStopPlayback,
        settingsShortcutFocusLibraryFilter,
        settingsShortcutOpenSettings,
        settingsStatus,
    } = elements;

    const settingsModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    let hideTimer: number | undefined;

    let favoritePlaylists: string[] = [];
    let selectedFavoritePlaylistIndex = -1;

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

    const setActiveTab = (tab: 'general' | 'playlists' | 'ui' | 'shortcuts'): void => {
        const generalActive = tab === 'general';
        const playlistsActive = tab === 'playlists';
        const uiActive = tab === 'ui';
        const shortcutsActive = tab === 'shortcuts';
        settingsTabGeneral.classList.toggle('is-active', generalActive);
        settingsTabPlaylists.classList.toggle('is-active', playlistsActive);
        settingsTabUi.classList.toggle('is-active', uiActive);
        settingsTabShortcuts.classList.toggle('is-active', shortcutsActive);
        settingsTabGeneral.setAttribute('aria-selected', generalActive ? 'true' : 'false');
        settingsTabPlaylists.setAttribute('aria-selected', playlistsActive ? 'true' : 'false');
        settingsTabUi.setAttribute('aria-selected', uiActive ? 'true' : 'false');
        settingsTabShortcuts.setAttribute('aria-selected', shortcutsActive ? 'true' : 'false');
        settingsPanelGeneral.hidden = !generalActive;
        settingsPanelPlaylists.hidden = !playlistsActive;
        settingsPanelUi.hidden = !uiActive;
        settingsPanelShortcuts.hidden = !shortcutsActive;
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

    const close = (): void => {
        settingsModal.classList.remove('is-visible');

        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
        }

        hideTimer = window.setTimeout(() => {
            settingsModal.hidden = true;
            settingsStatus.textContent = '';
            hideTimer = undefined;
        }, settingsModalTransitionMs);
    };

    const open = (): void => {
        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
            hideTimer = undefined;
        }

        const values = options.getValues();
        settingsLibraryPath.value = values.libraryPath || '';
        settingsListenBrainzToken.value = values.listenBrainzUserToken || '';
        settingsReleaseDepth.value = values.releaseDepth > 0 ? String(values.releaseDepth) : '';
        settingsPreferMusicBrainzMetadata.checked = !!values.preferMusicBrainzMetadata;
        settingsPlayerCardLayout.value = options.getPlayerCardLayout();
        setShortcutValues(normalizeFocusedKeyboardShortcuts(values.keyboardShortcuts));
        favoritePlaylists = normalizeFavoritePlaylists(values.favoritePlaylists);
        selectedFavoritePlaylistIndex = -1;
        renderFavoritePlaylistList();
        settingsStatus.textContent = '';
        setActiveTab('general');
        settingsModal.hidden = false;
        window.requestAnimationFrame(() => {
            settingsModal.classList.add('is-visible');
        });
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
        settingsFavoritePlaylistList.focus();
    });

    settingsTabUi.addEventListener('click', () => {
        setActiveTab('ui');
    });

    settingsTabShortcuts.addEventListener('click', () => {
        setActiveTab('shortcuts');
        settingsShortcutPlayPauseToggle.focus();
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

    settingsAddFavoritePlaylist.addEventListener('click', async () => {
        settingsStatus.textContent = '';

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
            settingsStatus.textContent = 'Unable to open playlist picker.';
        }
    });

    settingsRemoveFavoritePlaylist.addEventListener('click', () => {
        if (selectedFavoritePlaylistIndex < 0 || selectedFavoritePlaylistIndex >= favoritePlaylists.length) {
            return;
        }

        favoritePlaylists.splice(selectedFavoritePlaylistIndex, 1);
        selectedFavoritePlaylistIndex = -1;
        renderFavoritePlaylistList();
    });

    settingsSave.addEventListener('click', async () => {
        if (settingsSave.disabled) {
            return;
        }

        settingsSave.disabled = true;
        settingsForceReload.disabled = true;
        const formValues: SettingsFormValues = {
            libraryPath: settingsLibraryPath.value,
            listenBrainzUserToken: settingsListenBrainzToken.value,
            releaseDepth: Number.parseInt(settingsReleaseDepth.value, 10) || 0,
            favoritePlaylists: favoritePlaylists.slice(),
            preferMusicBrainzMetadata: settingsPreferMusicBrainzMetadata.checked,
            keyboardShortcuts: getShortcutValues(),
        };
        close();

        try {
            await options.save(formValues);
        } finally {
            settingsSave.disabled = false;
            settingsForceReload.disabled = false;
        }
    });

    settingsForceReload.addEventListener('click', async () => {
        if (settingsForceReload.disabled || settingsSave.disabled) {
            return;
        }

        const formValues: SettingsFormValues = {
            libraryPath: settingsLibraryPath.value,
            listenBrainzUserToken: settingsListenBrainzToken.value,
            releaseDepth: Number.parseInt(settingsReleaseDepth.value, 10) || 0,
            favoritePlaylists: favoritePlaylists.slice(),
            preferMusicBrainzMetadata: settingsPreferMusicBrainzMetadata.checked,
            keyboardShortcuts: getShortcutValues(),
        };

        settingsStatus.textContent = 'Reloading library...';
        settingsForceReload.disabled = true;
        settingsSave.disabled = true;

        try {
            await options.save(formValues);
            await options.forceReload(formValues);
            settingsStatus.textContent = 'Library reloaded.';
        } catch (error) {
            console.error(error);
            settingsStatus.textContent = 'Unable to force reload library.';
        } finally {
            settingsForceReload.disabled = false;
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