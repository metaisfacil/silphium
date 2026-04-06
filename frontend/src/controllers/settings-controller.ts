import type { SettingsModalElements } from '../components/overlays/settings-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { AppLibraryFolder, AudioOutputDevice, CoverArtPrioritySource, FocusedKeyboardShortcuts, PlayerCardLayout } from '../types/app-types';
import { asReleaseDepth, libraryFolderPathKey, normalizeLibraryFolderLabel, normalizeLibraryFolders } from '../utils/main-helpers';
import { formatShortcutBindingFromKeyboardEvent, normalizeFocusedKeyboardShortcuts } from '../utils/shortcut-bindings';

type LibraryFolderDialogValues = {
    label: string;
    releaseDepth: number;
};

export type SettingsFormValues = {
    libraryFolders: AppLibraryFolder[];
    ffmpegPath: string;
    listenBrainzUserToken: string;
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
    musicBrainzTagWorkerCores: number;
    keyboardShortcuts: FocusedKeyboardShortcuts;
};

export type SettingsViewValues = SettingsFormValues & {
    audioOutputDevices: AudioOutputDevice[];
};

type SettingsTab = 'general' | 'network' | 'playlists' | 'audio' | 'ui' | 'shortcuts';

const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];
const allCoverArtPrioritySources: CoverArtPrioritySource[] = ['file', 'embedded', 'musicbrainz'];

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
    applyAudioNow: (values: SettingsFormValues) => Promise<AudioOutputDevice[]>;
    forceReload: (values: SettingsFormValues) => Promise<void>;
    beforeClose?: () => Promise<string | null>;
    onCloseBlocked?: (message: string) => void;
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
        settingsTabNetwork,
        settingsTabPlaylists,
        settingsTabAudio,
        settingsTabUi,
        settingsTabShortcuts,
        settingsPanelGeneral,
        settingsPanelNetwork,
        settingsPanelPlaylists,
        settingsPanelAudio,
        settingsPanelUi,
        settingsPanelShortcuts,
        settingsLibraryFolderList,
        settingsAddLibraryFolder,
        settingsRemoveLibraryFolder,
        settingsFavoritePlaylistList,
        settingsAddFavoritePlaylist,
        settingsRemoveFavoritePlaylist,
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
        settingsFFmpegPath,
        settingsListenBrainzToken,
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
        settingsMusicBrainzTagWorkerCores,
        settingsPlayerCardLayout,
        settingsCoverArtPriorityList,
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
    let libraryFolders: AppLibraryFolder[] = [];
    let selectedLibraryFolderIndex = -1;
    let lastLibraryFolderClickIndex = -1;
    let lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
    let pendingLibraryDepthResolver: ((value: LibraryFolderDialogValues | null) => void) | null = null;
    let libraryDepthReturnFocusTarget: HTMLElement | null = null;
    let forceReloadInProgress = false;
    let forceReloadEtaSeconds: number | null = null;
    let audioOutputDevices: AudioOutputDevice[] = [];
    let coverArtPriority: CoverArtPrioritySource[] = [...defaultCoverArtPriority];
    let coverArtPriorityOrder: CoverArtPrioritySource[] = [...allCoverArtPrioritySources];
    let draggedCoverPriorityIndex = -1;
    const libraryFolderRepeatClickWindowMs = 400;

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

    const normalizeMusicBrainzTagWorkerCores = (value: string): number => {
        const parsed = Number.parseInt(value.trim(), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 0;
        }

        return Math.min(Math.floor(parsed), 128);
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
        musicBrainzTagWorkerCores: normalizeMusicBrainzTagWorkerCores(settingsMusicBrainzTagWorkerCores.value),
        keyboardShortcuts: getShortcutValues(),
    });

    const refreshMusicBrainzTagWorkerControls = (): void => {
        settingsMusicBrainzTagWorkerCores.disabled = !settingsMusicBrainzTagDatabaseEnabled.checked;
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
        settingsStatus.textContent = etaLabel
            ? `Reloading library... ${etaLabel} remaining`
            : 'Reloading library...';
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

    const closeLibraryDepthDialog = (value: LibraryFolderDialogValues | null, restoreFocus: boolean): void => {
        if (settingsLibraryDepthModal.hidden) {
            return;
        }

        settingsLibraryDepthModal.hidden = true;
	    settingsLibraryDepthTitle.textContent = 'Library Folder Settings';
	    settingsLibraryDepthLabelInput.value = '';
        settingsLibraryDepthInput.value = '';
        settingsLibraryDepthStatus.textContent = '';
        settingsLibraryDepthConfirm.textContent = 'Apply';

        const resolve = pendingLibraryDepthResolver;
        pendingLibraryDepthResolver = null;

        const focusTarget = libraryDepthReturnFocusTarget;
        libraryDepthReturnFocusTarget = null;

        resolve?.(value);

        if (restoreFocus && focusTarget) {
            window.requestAnimationFrame(() => {
                focusTarget.focus();
            });
        }
    };

    const openLibraryDepthDialog = (
        initialValues: LibraryFolderDialogValues,
        confirmLabel: string,
        title: string,
    ): Promise<LibraryFolderDialogValues | null> => {
        closeLibraryDepthDialog(null, false);

        settingsLibraryDepthTitle.textContent = title;
        settingsLibraryDepthLabelInput.value = initialValues.label;
        settingsLibraryDepthInput.value = initialValues.releaseDepth > 0 ? String(initialValues.releaseDepth) : '';
        settingsLibraryDepthStatus.textContent = '';
        settingsLibraryDepthConfirm.textContent = confirmLabel;
        libraryDepthReturnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        settingsLibraryDepthModal.hidden = false;

        window.requestAnimationFrame(() => {
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

	    const nextValues = await openLibraryDepthDialog({ label: folder.label, releaseDepth: folder.releaseDepth }, 'Save', 'Library Folder Settings');
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

    const setActiveTab = (tab: SettingsTab): void => {
        const generalActive = tab === 'general';
        const networkActive = tab === 'network';
        const playlistsActive = tab === 'playlists';
        const audioActive = tab === 'audio';
        const uiActive = tab === 'ui';
        const shortcutsActive = tab === 'shortcuts';
        settingsTabGeneral.classList.toggle('is-active', generalActive);
        settingsTabNetwork.classList.toggle('is-active', networkActive);
        settingsTabPlaylists.classList.toggle('is-active', playlistsActive);
        settingsTabAudio.classList.toggle('is-active', audioActive);
        settingsTabUi.classList.toggle('is-active', uiActive);
        settingsTabShortcuts.classList.toggle('is-active', shortcutsActive);
        settingsTabGeneral.setAttribute('aria-selected', generalActive ? 'true' : 'false');
        settingsTabNetwork.setAttribute('aria-selected', networkActive ? 'true' : 'false');
        settingsTabPlaylists.setAttribute('aria-selected', playlistsActive ? 'true' : 'false');
        settingsTabAudio.setAttribute('aria-selected', audioActive ? 'true' : 'false');
        settingsTabUi.setAttribute('aria-selected', uiActive ? 'true' : 'false');
        settingsTabShortcuts.setAttribute('aria-selected', shortcutsActive ? 'true' : 'false');
        settingsPanelGeneral.hidden = !generalActive;
        settingsPanelNetwork.hidden = !networkActive;
        settingsPanelPlaylists.hidden = !playlistsActive;
        settingsPanelAudio.hidden = !audioActive;
        settingsPanelUi.hidden = !uiActive;
        settingsPanelShortcuts.hidden = !shortcutsActive;
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

    settingsLibraryDepthLabelInput.addEventListener('input', () => {
        settingsLibraryDepthStatus.textContent = '';
    });

    settingsLibraryDepthInput.addEventListener('input', () => {
        settingsLibraryDepthStatus.textContent = '';
    });

    settingsFFmpegPath.addEventListener('input', () => {
        settingsStatus.textContent = '';
    });

    settingsLibraryDepthBackdrop.addEventListener('click', () => {
        closeLibraryDepthDialog(null, true);
    });

    settingsLibraryDepthCancel.addEventListener('click', () => {
        closeLibraryDepthDialog(null, true);
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
            settingsLibraryDepthStatus.textContent = 'Enter a whole number 0 or greater.';
            settingsLibraryDepthInput.focus();
            settingsLibraryDepthInput.select();
            return;
        }

        closeLibraryDepthDialog({
            label: normalizedLabel,
            releaseDepth: asReleaseDepth(Number.parseInt(trimmed, 10)),
        }, false);
    });

    const finalizeClose = (): void => {
        closeLibraryDepthDialog(null, false);
        settingsModal.classList.remove('is-visible');
        lastLibraryFolderClickIndex = -1;
        lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;

        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
        }

        hideTimer = window.setTimeout(() => {
            settingsModal.hidden = true;
            settingsStatus.textContent = '';
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
        settingsMusicBrainzTagWorkerCores.value = values.musicBrainzTagWorkerCores > 0 ? String(values.musicBrainzTagWorkerCores) : '';
        refreshMusicBrainzTagWorkerControls();
        settingsPlayerCardLayout.value = options.getPlayerCardLayout();
        setShortcutValues(normalizeFocusedKeyboardShortcuts(values.keyboardShortcuts));
        favoritePlaylists = normalizeFavoritePlaylists(values.favoritePlaylists);
        coverArtPriority = normalizeCoverArtPriority(values.coverArtPriority);
        coverArtPriorityOrder = normalizeCoverArtPriorityOrder(values.coverArtPriority);
        selectedLibraryFolderIndex = libraryFolders.length > 0 ? 0 : -1;
        selectedFavoritePlaylistIndex = -1;
        lastLibraryFolderClickIndex = -1;
        lastLibraryFolderClickAt = Number.NEGATIVE_INFINITY;
        renderLibraryFolderList();
        renderFavoritePlaylistList();
        renderCoverArtPriorityList();
        if (forceReloadInProgress) {
            refreshForceReloadStatus();
        } else {
            settingsStatus.textContent = '';
        }
        setActiveTab(initialTab);
        settingsModal.hidden = false;
        window.requestAnimationFrame(() => {
            settingsModal.classList.add('is-visible');
        });
        if (initialTab === 'general' && settingsFFmpegPath.value.trim() === '') {
            settingsFFmpegPath.focus();
            return;
        }
        if (libraryFolders.length > 0) {
            settingsLibraryFolderList.focus();
            return;
        }

        settingsAddLibraryFolder.focus();
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
        settingsStatus.textContent = '';

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
	            existingFolder ? 'Save' : 'Add Folder',
	            existingFolder ? 'Library Folder Settings' : 'Add Library Folder',
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
            settingsStatus.textContent = 'Unable to open folder picker.';
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

    settingsTabPlaylists.addEventListener('click', () => {
        setActiveTab('playlists');
        settingsFavoritePlaylistList.focus();
    });

    settingsTabAudio.addEventListener('click', () => {
        setActiveTab('audio');
        settingsAudioOutputDevice.focus();
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

        const formValues = buildFormValues();

        settingsApplyAudioNow.disabled = true;
        settingsStatus.textContent = 'Refreshing audio settings...';

        try {
            const refreshedDevices = await options.applyAudioNow(formValues);
            refreshAudioOutputDevices(refreshedDevices, formValues.audioOutputDevice || 'default');
            settingsStatus.textContent = 'Audio settings refreshed.';
        } catch (error) {
            console.error(error);
            settingsStatus.textContent = 'Unable to refresh audio settings right now.';
        } finally {
            settingsApplyAudioNow.disabled = false;
        }
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
        const formValues = buildFormValues();

        try {
            await options.save(formValues);
            finalizeClose();
        } catch (error) {
            console.error(error);
            settingsStatus.textContent = error instanceof Error && error.message.trim() !== ''
                ? error.message
                : 'Unable to save settings.';
        } finally {
            settingsSave.disabled = false;
            settingsForceReload.disabled = false;
        }
    });

    settingsForceReload.addEventListener('click', async () => {
        if (settingsForceReload.disabled || settingsSave.disabled) {
            return;
        }

        const formValues = buildFormValues();

        forceReloadInProgress = true;
        forceReloadEtaSeconds = null;
        refreshForceReloadStatus();
        settingsForceReload.disabled = true;
        settingsSave.disabled = true;

        try {
            await options.save(formValues);
            await options.forceReload(formValues);
            forceReloadInProgress = false;
            forceReloadEtaSeconds = null;
            settingsStatus.textContent = 'Library reloaded.';
        } catch (error) {
            console.error(error);
            forceReloadInProgress = false;
            forceReloadEtaSeconds = null;
            settingsStatus.textContent = 'Unable to force reload library.';
        } finally {
            settingsForceReload.disabled = false;
            settingsSave.disabled = false;
        }
    });

    return {
        close: finalizeClose,
        handleDocumentClick: (target: Node): boolean => settingsModal.contains(target),
        handleEscape: (): boolean => {
            if (settingsModal.hidden) {
                return false;
            }

            if (!settingsLibraryDepthModal.hidden) {
                closeLibraryDepthDialog(null, true);
                return true;
            }

            void requestClose();
            return true;
        },
        open,
        setForceReloadEtaSeconds,
    };
};