import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSettingsModalElements, renderSettingsModal } from '../components/overlays/settings-modal';
import type { AudioOutputDevice, FocusedKeyboardShortcuts, PlayerCardLayout } from '../types/app-types';
import { createSettingsController, type SettingsFormValues, type SettingsViewValues } from './settings-controller';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const createAudioDevices = (): AudioOutputDevice[] => ([
    { id: 'device-1', name: 'USB DAC', backend: 'wasapi', isDefault: false },
]);

const createKeyboardShortcuts = (): FocusedKeyboardShortcuts => ({
    playPauseToggle: 'Space',
    nextTrack: 'N',
    previousTrack: 'P',
    stopPlayback: 'Z',
    focusLibraryFilter: 'Ctrl+F',
    openSettings: 'Ctrl+P',
});

const createSettingsViewValues = (): SettingsViewValues => ({
    libraryFolders: [{ path: '/music/main', label: 'Main Library', releaseDepth: 2 }],
    ffmpegPath: '',
    listenBrainzUserToken: '',
    musicBrainzServerUrl: 'https://musicbrainz.org',
    musicBrainzRequestRateMs: 0,
    listenBrainzServerUrl: '',
    listenBrainzRequestRateMs: 0,
    favoritePlaylists: ['/playlists/favorites.m3u8', '/playlists/favorites.m3u8', ''],
    coverArtPriority: ['embedded', 'file'],
    audioOutputDevice: 'device-1',
    audioOutputBufferMs: 128,
    gaplessPlayback: true,
    replayGainEnabled: false,
    preferMusicBrainzMetadata: true,
    musicBrainzTagDatabaseEnabled: true,
    musicBrainzTagWorkerCores: 4,
    keyboardShortcuts: createKeyboardShortcuts(),
    audioOutputDevices: createAudioDevices(),
});

const mountSettingsController = (options: {
    getValues?: () => SettingsViewValues;
    save?: (values: SettingsFormValues) => Promise<void>;
    forceReload?: (values: SettingsFormValues) => Promise<void>;
} = {}) => {
    document.body.innerHTML = renderSettingsModal();
    const trigger = document.createElement('button');
    document.body.append(trigger);

    const elements = getSettingsModalElements(document);
    const save = options.save ?? vi.fn(async () => undefined);
    const forceReload = options.forceReload ?? vi.fn(async () => undefined);
    const applyAudioNow = vi.fn(async () => createAudioDevices());
    const setPlayerCardLayout = vi.fn((_layout: PlayerCardLayout) => undefined);

    const controller = createSettingsController({
        trigger,
        elements,
        getValues: options.getValues ?? createSettingsViewValues,
        selectLibraryFolder: vi.fn(async () => ''),
        selectPlaylistFile: vi.fn(async () => ''),
        save,
        applyAudioNow,
        forceReload,
        getPlayerCardLayout: () => 'release',
        setPlayerCardLayout,
    });

    return {
        controller,
        elements,
        save,
        forceReload,
    };
};

describe('createSettingsController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('hydrates the modal and saves the edited form state', async () => {
        const { controller, elements, save } = mountSettingsController();

        controller.open();

        expect(elements.settingsModal.hidden).toBe(false);
        expect(elements.settingsModal.classList.contains('is-visible')).toBe(true);
        expect(elements.settingsLibraryFolderList.querySelectorAll('[data-library-folder-index]')).toHaveLength(1);
        expect(elements.settingsFavoritePlaylistList.querySelectorAll('[data-favorite-playlist-index]')).toHaveLength(1);

        elements.settingsFFmpegPath.value = 'D:/tools/ffmpeg.exe';
        elements.settingsAudioOutputBufferMs.value = '2500';
        elements.settingsSave.click();

        await flushPromises();

        expect(save).toHaveBeenCalledTimes(1);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            libraryFolders: [{ path: '/music/main', label: 'Main Library', releaseDepth: 2 }],
            ffmpegPath: 'D:/tools/ffmpeg.exe',
            favoritePlaylists: ['/playlists/favorites.m3u8'],
            coverArtPriority: ['embedded', 'file'],
            audioOutputDevice: 'device-1',
            audioOutputBufferMs: 1000,
        }));
        expect(elements.settingsModal.classList.contains('is-visible')).toBe(false);
    });

    it('tracks force-reload progress and restores controls after completion', async () => {
        let resolveForceReload: (() => void) | undefined;
        const save = vi.fn(async () => undefined);
        const forceReload = vi.fn(() => new Promise<void>((resolve) => {
            resolveForceReload = resolve;
        }));
        const { controller, elements } = mountSettingsController({ save, forceReload });

        controller.open();
        elements.settingsForceReload.click();

        await flushPromises();

        controller.setForceReloadEtaSeconds(14.2);

        expect(save).toHaveBeenCalledTimes(1);
        expect(forceReload).toHaveBeenCalledTimes(1);
        expect(save.mock.invocationCallOrder[0]).toBeLessThan(forceReload.mock.invocationCallOrder[0]);
        expect(elements.settingsStatus.textContent).toBe('Reloading library... ~15s remaining');
        expect(elements.settingsForceReload.disabled).toBe(true);
        expect(elements.settingsSave.disabled).toBe(true);

        resolveForceReload?.();
        await flushPromises();

        expect(elements.settingsStatus.textContent).toBe('Library reloaded.');
        expect(elements.settingsForceReload.disabled).toBe(false);
        expect(elements.settingsSave.disabled).toBe(false);
    });
});