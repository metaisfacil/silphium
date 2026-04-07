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
    lastFmApiKey: '',
    lastFmApiSecret: '',
    lastFmSessionKey: '',
    scrobbleFilterMode: 'blacklist',
    scrobbleRules: [{ field: 'path', operator: 'starts_with', value: '/music/private' }],
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
    musicBrainzTagStaleDays: 30,
    musicBrainzTagRequestStaggeringEnabled: false,
    musicBrainzTagWorkerCores: 4,
    lissajousEnabled: true,
    uiDitheringEnabled: true,
    minimizeToTrayOnClose: false,
    customSendToActions: [],
    musicBrainzTagWorkerProgress: createMusicBrainzTagWorkerProgress(),
    keyboardShortcuts: createKeyboardShortcuts(),
    audioOutputDevices: createAudioDevices(),
});

const mountSettingsController = (options: {
    getValues?: () => SettingsViewValues;
    save?: (values: SettingsFormValues) => Promise<void>;
    forceReload?: (values: SettingsFormValues) => Promise<void>;
    fetchLastFmSessionKey?: (apiKey: string, apiSecret: string) => Promise<string>;
} = {}) => {
    document.body.innerHTML = renderSettingsModal();
    const trigger = document.createElement('button');
    document.body.append(trigger);

    const elements = getSettingsModalElements(document);
    const save = options.save ?? vi.fn(async () => undefined);
    const forceReload = options.forceReload ?? vi.fn(async () => undefined);
    const fetchLastFmSessionKey = options.fetchLastFmSessionKey ?? vi.fn(async () => 'session-key');
    const applyAudioNow = vi.fn(async () => createAudioDevices());
    const setPlayerCardLayout = vi.fn((_layout: PlayerCardLayout) => undefined);

    const controller = createSettingsController({
        trigger,
        elements,
        getValues: options.getValues ?? createSettingsViewValues,
        selectLibraryFolder: vi.fn(async () => ''),
        selectPlaylistFile: vi.fn(async () => ''),
        save,
        fetchLastFmSessionKey,
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
        fetchLastFmSessionKey,
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

    it('renders settings titles in sentence case', () => {
        document.body.innerHTML = renderSettingsModal();

        expect(document.querySelector('label[for="settings-library-folder-list"]')?.textContent).toBe('Library folders');
        expect(document.querySelector('label[for="settings-ffmpeg-path"]')?.textContent).toBe('FFmpeg executable path');
        expect(document.querySelector('label[for="settings-listenbrainz-token"]')?.textContent).toBe('ListenBrainz user token');
        expect(document.querySelector('label[for="settings-lastfm-api-key"]')?.textContent).toBe('Last.fm API key');
        expect(document.querySelector('label[for="settings-lastfm-api-secret"]')?.textContent).toBe('Last.fm shared secret');
        expect(document.querySelector('label[for="settings-lastfm-session-key"]')?.textContent).toBe('Last.fm session key');
        expect(document.querySelector('#settings-lastfm-session-key-fetch')?.textContent).toBe('Fetch');
        expect(document.querySelector('label[for="settings-musicbrainz-server-url"]')?.textContent).toBe('MusicBrainz server URL');
        expect(document.querySelector('label[for="settings-listenbrainz-server-url"]')?.textContent).toBe('ListenBrainz server URL');
        expect(document.querySelector('label[for="settings-musicbrainz-tag-worker-cores"]')?.textContent).toBe('MusicBrainz tag worker cores');
        expect(document.querySelector('label[for="settings-favourite-playlist-list"]')?.textContent).toBe('Favourite playlists');
        expect(document.querySelector('label[for="settings-scrobble-filter-mode"]')?.textContent).toBe('Scrobble mode');
        expect(document.querySelector('label[for="settings-scrobble-rule-list"]')?.textContent).toBe('Scrobble rules');
        expect(document.querySelector('label[for="settings-audio-output-device"]')?.textContent).toBe('Audio output device');
        expect(document.querySelector('label[for="settings-audio-output-buffer-ms"]')?.textContent).toBe('Audio output buffer (ms)');
        expect(document.querySelector('label[for="settings-player-card-layout"]')?.textContent).toBe('Player card layout');
        expect(document.querySelector('label[for="settings-lissajous-enabled"]')?.textContent?.trim()).toBe('Show lissajous visualizer');
        expect(document.querySelector('label[for="settings-ui-dithering-enabled"]')?.textContent?.trim()).toBe('Enable pseudo-dithering');
        expect(document.querySelector('#settings-cover-art-priority-accordion-toggle')?.textContent).toBe('Cover art source priority');
        expect(document.querySelector('#settings-shortcut-accordion-toggle')?.textContent).toBe('Keyboard shortcuts');
        expect(document.querySelector('label[for="settings-shortcut-play-pause"]')?.textContent).toBe('Play/pause toggle');
        expect(document.querySelector('#settings-apply-audio-now')?.getAttribute('aria-label')).toBe('Refresh audio settings');
        expect(document.querySelector('#settings-force-reload')?.textContent).toBe('Force reload');
        expect(document.querySelector('#settings-library-depth-title')?.textContent).toBe('Library folder settings');
        expect(document.querySelector('label[for="settings-library-depth-label-input"]')?.textContent).toBe('Custom label');
        expect(document.querySelector('label[for="settings-library-depth-input"]')?.textContent).toBe('Release folder depth');
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
        expect(elements.settingsCoverArtPriorityAccordionPanel.hidden).toBe(true);
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(true);

        elements.settingsCoverArtPriorityAccordionToggle.click();
        expect(elements.settingsCoverArtPriorityAccordionToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.settingsCoverArtPriorityAccordionPanel.hidden).toBe(false);

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
            scrobbleFilterMode: 'blacklist',
            scrobbleRules: [{ field: 'path', operator: 'starts_with', value: '/music/private' }],
            favoritePlaylists: ['/playlists/favorites.m3u8'],
            coverArtPriority: ['embedded', 'file'],
            audioOutputDevice: 'device-1',
            audioOutputBufferMs: 1000,
            musicBrainzTagStaleDays: 30,
            musicBrainzTagRequestStaggeringEnabled: false,
            lissajousEnabled: true,
            uiDitheringEnabled: true,
            keyboardShortcuts: expect.objectContaining({ nextTrack: 'K' }),
        }));
        expect(elements.settingsModal.classList.contains('is-visible')).toBe(false);
    });

    it('opens the modal when the trigger button is clicked', async () => {
        const { controller, elements } = mountSettingsController();

        controller.close();
        const trigger = document.querySelector('body > button') as HTMLButtonElement | null;
        expect(trigger).not.toBeNull();

        trigger?.click();
        await flushPromises();

        expect(elements.settingsModal.hidden).toBe(false);
        expect(elements.settingsModal.classList.contains('is-visible')).toBe(true);
        expect(document.activeElement).toBe(elements.settingsFFmpegPath);
    });

    it('fetches Last.fm session key and fills the field', async () => {
        const fetchLastFmSessionKey = vi.fn(async () => 'session-key-from-fetch');
        const { controller, elements } = mountSettingsController({ fetchLastFmSessionKey });

        controller.open('network');

        elements.settingsLastFmApiKey.value = 'api-key';
        elements.settingsLastFmApiSecret.value = 'shared-secret';
        elements.settingsLastFmSessionKeyFetch.click();

        await flushPromises();

        expect(fetchLastFmSessionKey).toHaveBeenCalledWith('api-key', 'shared-secret');
        expect(elements.settingsLastFmSessionKey.value).toBe('session-key-from-fetch');
        expect(elements.settingsStatus.textContent).toBe('Last.fm session key fetched. Save settings to keep it.');
    });

    it('adds a scrobble rule through the rule dialog', async () => {
        const { controller, elements, save } = mountSettingsController({
            getValues: () => ({
                ...createSettingsViewValues(),
                scrobbleRules: [],
            }),
        });

        controller.open('scrobbling');

        elements.settingsAddScrobbleRule.click();
        expect(elements.settingsScrobbleRuleModal.hidden).toBe(false);

        elements.settingsScrobbleRuleField.value = 'trackTitle';
        elements.settingsScrobbleRuleField.dispatchEvent(new Event('change', { bubbles: true }));
        elements.settingsScrobbleRuleOperator.value = 'regex';
        elements.settingsScrobbleRuleOperator.dispatchEvent(new Event('change', { bubbles: true }));
        elements.settingsScrobbleRuleValue.value = '/live/i';
        elements.settingsScrobbleRuleForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        vi.runAllTimers();
        await flushPromises();

        expect(elements.settingsScrobbleRuleModal.classList.contains('is-visible')).toBe(false);

        elements.settingsSave.click();
        await flushPromises();

        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            scrobbleRules: [{ field: 'trackTitle', operator: 'regex', value: '/live/i' }],
        }));
    });

    it('saves MusicBrainz stale days and staggering from the database tab', async () => {
        const { controller, elements, save } = mountSettingsController();

        controller.open('database');

        elements.settingsMusicBrainzTagStaleDays.value = '0';
        elements.settingsMusicBrainzTagRequestStaggeringEnabled.checked = true;
        elements.settingsSave.click();

        await flushPromises();

        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            musicBrainzTagStaleDays: 0,
            musicBrainzTagRequestStaggeringEnabled: true,
        }));
    });

    it('maps shortcut-tab opens to the UI tab with the shortcuts accordion expanded', () => {
        const { controller, elements } = mountSettingsController();
        const shortcutAccordion = elements.settingsShortcutAccordionToggle.closest('.settings-accordion');

        controller.open('shortcuts');

        expect(elements.settingsTabUi.classList.contains('is-active')).toBe(true);
        expect(elements.settingsPanelUi.hidden).toBe(false);
        expect(shortcutAccordion?.classList.contains('is-expanded')).toBe(true);
        expect(elements.settingsShortcutAccordionToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(false);
        expect(document.activeElement).toBe(elements.settingsShortcutPlayPauseToggle);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('scrolls the shortcuts accordion into view when expanded from the UI tab', () => {
        const { controller, elements } = mountSettingsController();
        const shortcutAccordion = elements.settingsShortcutAccordionToggle.closest('.settings-accordion');

        controller.open('ui');
        scrollIntoViewMock.mockClear();

        elements.settingsShortcutAccordionToggle.click();

        expect(shortcutAccordion?.classList.contains('is-expanded')).toBe(true);
        expect(elements.settingsShortcutAccordionToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.settingsShortcutAccordionPanel.hidden).toBe(false);
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('restores the compact UI panel layout when the shortcuts accordion is collapsed', () => {
        const { controller, elements } = mountSettingsController();
        const shortcutAccordion = elements.settingsShortcutAccordionToggle.closest('.settings-accordion');

        controller.open('ui');

        elements.settingsShortcutAccordionToggle.click();
        expect(shortcutAccordion?.classList.contains('is-expanded')).toBe(true);

        elements.settingsShortcutAccordionToggle.click();

        expect(shortcutAccordion?.classList.contains('is-expanded')).toBe(false);
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