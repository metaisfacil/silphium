import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSettingsModalElements, renderSettingsModal } from '../components/overlays/settings-modal';
import type { AudioOutputDevice, FocusedKeyboardShortcuts, MusicBrainzTagWorkerProgress, PlayerCardLayout } from '../types/app-types';
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

const createMusicBrainzTagWorkerProgress = (): MusicBrainzTagWorkerProgress => ({
    enabled: true,
    active: true,
    progress: 0.25,
    pendingTrackScans: 3,
    totalTrackScans: 8,
    completedTrackScans: 5,
    pendingEntityLookups: 12,
    totalEntityLookups: 20,
    completedEntityLookups: 8,
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
    musicBrainzTagWorkerProgress: createMusicBrainzTagWorkerProgress(),
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
    let scrollIntoViewMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-05T00:00:00Z'));
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        scrollIntoViewMock = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
            configurable: true,
            value: scrollIntoViewMock,
            writable: true,
        });
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
        expect(document.querySelector('#settings-tab-shortcuts')).toBeNull();

        elements.settingsFFmpegPath.value = 'D:/tools/ffmpeg.exe';
        elements.settingsAudioOutputBufferMs.value = '2500';
        elements.settingsTabUi.click();
        expect(document.activeElement).toBe(elements.settingsPlayerCardLayout);
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(true);

        elements.settingsShortcutAccordionToggle.click();
        expect(elements.settingsShortcutAccordionToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(false);

        elements.settingsShortcutNextTrack.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'k',
            code: 'KeyK',
            bubbles: true,
        }));
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
            keyboardShortcuts: expect.objectContaining({ nextTrack: 'K' }),
        }));
        expect(elements.settingsModal.classList.contains('is-visible')).toBe(false);
    });

    it('maps shortcut-tab opens to the UI tab with the shortcuts accordion expanded', () => {
        const { controller, elements } = mountSettingsController();

        controller.open('shortcuts');

        expect(elements.settingsTabUi.classList.contains('is-active')).toBe(true);
        expect(elements.settingsPanelUi.hidden).toBe(false);
        expect(elements.settingsPanelUi.classList.contains('is-shortcuts-expanded')).toBe(true);
        expect(elements.settingsShortcutAccordionToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(false);
        expect(document.activeElement).toBe(elements.settingsShortcutPlayPauseToggle);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('scrolls the shortcuts accordion into view when expanded from the UI tab', () => {
        const { controller, elements } = mountSettingsController();

        controller.open('ui');
        scrollIntoViewMock.mockClear();

        elements.settingsShortcutAccordionToggle.click();

        expect(elements.settingsPanelUi.classList.contains('is-shortcuts-expanded')).toBe(true);
        expect(elements.settingsShortcutAccordionToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(false);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('restores the compact UI panel layout when the shortcuts accordion is collapsed', () => {
        const { controller, elements } = mountSettingsController();

        controller.open('ui');

        elements.settingsShortcutAccordionToggle.click();
        expect(elements.settingsPanelUi.classList.contains('is-shortcuts-expanded')).toBe(true);

        elements.settingsShortcutAccordionToggle.click();

        expect(elements.settingsPanelUi.classList.contains('is-shortcuts-expanded')).toBe(false);
        expect(elements.settingsShortcutAccordionToggle.getAttribute('aria-expanded')).toBe('false');
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(false);

        vi.runAllTimers();

        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(true);
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

    it('renders and updates MusicBrainz tag worker progress in the database tab', () => {
        const { controller, elements } = mountSettingsController();

        controller.open('database');

        expect(elements.settingsMusicBrainzTagWorkerProgressValue.textContent).toBe('25%');
        expect(elements.settingsMusicBrainzTagWorkerProgressRemaining.textContent).toBe('8 entities processed • 12 entities still to look up.');

        controller.setMusicBrainzTagWorkerProgress({
            enabled: true,
            active: false,
            progress: 1,
            pendingTrackScans: 0,
            totalTrackScans: 8,
            completedTrackScans: 8,
            pendingEntityLookups: 0,
            totalEntityLookups: 20,
            completedEntityLookups: 20,
        });

        expect(elements.settingsMusicBrainzTagWorkerProgressValue.textContent).toBe('100%');
        expect(elements.settingsMusicBrainzTagWorkerProgressRemaining.textContent).toBe('20 entities processed • 0 entities still to look up.');
        expect(elements.settingsMusicBrainzTagWorkerProgressStatus.textContent).toBe('Background metadata index is up to date.');
    });

    it('appends an ETA to MusicBrainz tag worker progress once a pace is established', () => {
        const { controller, elements } = mountSettingsController({
            getValues: () => ({
                ...createSettingsViewValues(),
                musicBrainzTagWorkerProgress: {
                    enabled: true,
                    active: true,
                    progress: 0.5,
                    pendingTrackScans: 0,
                    totalTrackScans: 8,
                    completedTrackScans: 8,
                    pendingEntityLookups: 10,
                    totalEntityLookups: 20,
                    completedEntityLookups: 10,
                },
            }),
        });

        controller.open('database');
        expect(elements.settingsMusicBrainzTagWorkerProgressRemaining.textContent).toBe('10 entities processed • 10 entities still to look up.');

        vi.setSystemTime(new Date('2026-04-05T00:00:05Z'));
        controller.setMusicBrainzTagWorkerProgress({
            enabled: true,
            active: true,
            progress: 0.75,
            pendingTrackScans: 0,
            totalTrackScans: 8,
            completedTrackScans: 8,
            pendingEntityLookups: 5,
            totalEntityLookups: 20,
            completedEntityLookups: 15,
        });

        expect(elements.settingsMusicBrainzTagWorkerProgressRemaining.textContent).toBe('15 entities processed • 5 entities still to look up • ~5s remaining');
    });
});