import { describe, expect, it } from 'vitest';

import {
    asPlayerVisualizerMode,
    asPlayerEqualizerPosition,
    asCustomSendToActionScope,
    defaultLissajousScale,
    defaultAppSettings,
    defaultCoverArtPriority,
    defaultCustomSendToActions,
    defaultListenHistoryThresholdSeconds,
    defaultMusicBrainzTagStaleDays,
    defaultMusicBrainzTagWorkerProgress,
    minLissajousScale,
    maxMusicBrainzTagStaleDays,
    normalizeLissajousScale,
    normalizeAppSettings,
    normalizeCoverArtPriority,
    normalizeCustomSendToActions,
    normalizeMusicBrainzTagWorkerProgress,
} from './settings-normalization';

describe('settings normalization', () => {
    it('normalizes worker progress values and defaults', () => {
        expect(normalizeMusicBrainzTagWorkerProgress()).toEqual(defaultMusicBrainzTagWorkerProgress);

        expect(normalizeMusicBrainzTagWorkerProgress({
            enabled: 1 as unknown as boolean,
            active: 'true' as unknown as boolean,
            progress: 1.5,
            pendingTrackScans: 3.9,
            totalTrackScans: -1,
            completedTrackScans: '5' as unknown as number,
            pendingEntityLookups: Number.NaN,
            totalEntityLookups: 2.2,
            completedEntityLookups: 0,
        })).toEqual({
            enabled: true,
            active: true,
            progress: 1,
            pendingTrackScans: 3,
            totalTrackScans: 0,
            completedTrackScans: 5,
            pendingEntityLookups: 0,
            totalEntityLookups: 2,
            completedEntityLookups: 0,
        });
    });

    it('normalizes cover art priority and action scopes', () => {
        expect(normalizeCoverArtPriority(undefined)).toEqual(defaultCoverArtPriority);
        expect(normalizeCoverArtPriority(['embedded', 'file', 'embedded', 'invalid'])).toEqual(['embedded', 'file']);
        expect(normalizeCoverArtPriority(['invalid'])).toEqual(defaultCoverArtPriority);
        expect(normalizeCoverArtPriority([])).toEqual([]);
        expect(asPlayerVisualizerMode('equalizer')).toBe('equalizer');
        expect(asPlayerVisualizerMode('scope')).toBe('lissajous');
        expect(asPlayerEqualizerPosition('top')).toBe('top');
        expect(asPlayerEqualizerPosition('sideways')).toBe('bottom');
        expect(asCustomSendToActionScope('album')).toBe('album');
        expect(asCustomSendToActionScope('unsupported')).toBeNull();
    });

    it('normalizes Lissajous scale values', () => {
        expect(normalizeLissajousScale(undefined)).toBe(defaultLissajousScale);
        expect(normalizeLissajousScale(0)).toBe(defaultLissajousScale);
        expect(normalizeLissajousScale('0.01')).toBe(minLissajousScale);
        expect(normalizeLissajousScale(0.4)).toBe(0.4);
        expect(normalizeLissajousScale(2)).toBe(1);
    });

    it('normalizes custom send-to actions and removes duplicates', () => {
        expect(normalizeCustomSendToActions(undefined)).toEqual(defaultCustomSendToActions);

        expect(normalizeCustomSendToActions([
            { title: ' Open ', scope: 'track', commandTemplate: '  cmd {path} ' },
            { title: 'open', scope: 'track', commandTemplate: 'cmd {path}' },
            {},
            { title: '', scope: 'track', commandTemplate: 'ignored' },
            { title: 'Missing Scope', scope: 'unsupported', commandTemplate: 'ignored' },
            { title: 'Missing Command', scope: 'folder', commandTemplate: '   ' },
        ])).toEqual([
            { title: 'Open', scope: 'track', commandTemplate: 'cmd {path}' },
        ]);
    });

    it('normalizes app settings with explicit values and clamps numeric fields', () => {
        const normalized = normalizeAppSettings({
            libraryPath: ' /music/library ',
            releaseDepth: 2,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 45,
            ffmpegPath: ' ffmpeg ',
            librarySharingEnabled: true,
            librarySharingPort: 5005,
            listenBrainzUserToken: 'token',
            lastFmApiKey: ' api-key ',
            lastFmApiSecret: ' api-secret ',
            lastFmSessionKey: ' session-key ',
            scrobblingEnabled: false,
            scrobbleFilterMode: 'whitelist',
            musicBrainzServerUrl: ' https://musicbrainz.example ',
            musicBrainzRequestRateMs: 2000.9,
            listenBrainzServerUrl: ' https://listenbrainz.example ',
            listenBrainzRequestRateMs: 1500.2,
            playbackOrder: 'shuffle-library',
            favoritePlaylists: ['favorites.m3u'],
            coverArtPriority: ['musicbrainz', 'embedded', 'musicbrainz'],
            audio: {
                outputDevice: ' usb-dac ',
                outputBufferMs: 1000.8,
                gaplessPlayback: true,
                replayGainEnabled: true,
            },
            preferMusicBrainzMetadata: true,
            musicBrainzTagDatabaseEnabled: true,
            highlightMusicBrainzTaggedAlbumFolders: true,
            musicBrainzTagStaleDays: 999999,
            musicBrainzTagRequestStaggeringEnabled: true,
            musicBrainzTagWorkerCores: 999,
            lissajousEnabled: false,
            lissajousScale: 0.4,
            visualizerMode: 'equalizer',
            equalizerPosition: 'top',
            uiDitheringEnabled: false,
            minimizeToTrayOnClose: true,
            customSendToActions: [{ title: ' Send ', scope: 'folder', commandTemplate: ' run {path} ' }],
            keyboardShortcuts: {
                playPauseToggle: 'spacebar',
                openSettings: 'cmd+p',
            },
        } as Parameters<typeof normalizeAppSettings>[0]);

        expect(normalized.libraryFolders).toEqual([{ path: '/music/library', label: '', releaseDepth: 2 }]);
        expect(normalized.libraryPath).toBe('/music/library');
        expect(normalized.ffmpegPath).toBe('ffmpeg');
        expect(normalized.librarySharingEnabled).toBe(true);
        expect(normalized.librarySharingPort).toBe(5005);
        expect(normalized.lastFmApiKey).toBe('api-key');
        expect(normalized.lastFmApiSecret).toBe('api-secret');
        expect(normalized.lastFmSessionKey).toBe('session-key');
        expect(normalized.scrobblingEnabled).toBe(false);
        expect(normalized.scrobbleFilterMode).toBe('whitelist');
        expect(normalized.scrobbleRules).toEqual([]);
        expect(normalized.musicBrainzServerUrl).toBe('https://musicbrainz.example');
        expect(normalized.musicBrainzRequestRateMs).toBe(2000);
        expect(normalized.listenBrainzServerUrl).toBe('https://listenbrainz.example');
        expect(normalized.listenBrainzRequestRateMs).toBe(1500);
        expect(normalized.playbackOrder).toBe('shuffle-library');
        expect(normalized.favoritePlaylists).toEqual(['favorites.m3u']);
        expect(normalized.coverArtPriority).toEqual(['musicbrainz', 'embedded']);
        expect(normalized.audio).toEqual({
            outputDevice: 'usb-dac',
            outputBufferMs: 1000,
            gaplessPlayback: true,
            replayGainEnabled: true,
        });
        expect(normalized.preferMusicBrainzMetadata).toBe(true);
        expect(normalized.localLibraryFilesDatabaseEnabled).toBe(true);
        expect(normalized.localLibraryFilesDatabaseLoadOnStartup).toBe(true);
        expect(normalized.localLibraryFilesDatabaseListenHistoryThresholdSeconds).toBe(45);
        expect(normalized.musicBrainzTagDatabaseEnabled).toBe(true);
        expect(normalized.highlightMusicBrainzTaggedAlbumFolders).toBe(true);
        expect(normalized.musicBrainzTagStaleDays).toBe(maxMusicBrainzTagStaleDays);
        expect(normalized.musicBrainzTagRequestStaggeringEnabled).toBe(true);
        expect(normalized.musicBrainzTagWorkerCores).toBe(128);
        expect(normalized.lissajousEnabled).toBe(false);
        expect(normalized.lissajousScale).toBe(0.4);
        expect(normalized.visualizerMode).toBe('equalizer');
        expect(normalized.equalizerPosition).toBe('top');
        expect(normalized.uiDitheringEnabled).toBe(false);
        expect(normalized.minimizeToTrayOnClose).toBe(true);
        expect(normalized.customSendToActions).toEqual([{ title: 'Send', scope: 'folder', commandTemplate: 'run {path}' }]);
        expect(normalized.keyboardShortcuts.playPauseToggle).toBe('Space');
        expect(normalized.keyboardShortcuts.openSettings).toBe('Meta+P');
    });

    it('falls back for invalid app settings inputs and legacy scrobble folders', () => {
        const normalized = normalizeAppSettings({
            libraryFolders: [
                { path: '/music/library', label: ' Main ', releaseDepth: 3 },
                { path: ' /MUSIC/LIBRARY ', label: 'Duplicate', releaseDepth: 99 },
            ],
            librarySharingPort: -1,
            scrobbleFilterMode: 'invalid',
            scrobbleFolders: [' /music/skip ', '/music/keep', '/music/keep '],
            musicBrainzRequestRateMs: -1,
            listenBrainzRequestRateMs: Number.NaN,
            favoritePlaylists: 'favorites.m3u' as unknown as string[],
            audio: {
                outputDevice: '   ',
                outputBufferMs: -5,
                gaplessPlayback: false,
                replayGainEnabled: true,
            },
            musicBrainzTagStaleDays: -1,
            musicBrainzTagWorkerCores: 0,
            lissajousScale: 0.01,
            visualizerMode: 'vector-scope',
            equalizerPosition: 'sideways',
            keyboardShortcuts: {
                nextTrack: 'bad+shortcut+value',
            },
        } as unknown as Parameters<typeof normalizeAppSettings>[0] & { scrobbleFolders: string[] });

        expect(normalized.libraryFolders).toEqual([{ path: '/music/library', label: 'Main', releaseDepth: 3 }]);
        expect(normalized.librarySharingEnabled).toBe(false);
        expect(normalized.librarySharingPort).toBe(defaultAppSettings.librarySharingPort);
        expect(normalized.scrobbleFilterMode).toBe('blacklist');
        expect(normalized.scrobbleRules).toEqual([
            { field: 'path', operator: 'starts_with', value: '/music/skip' },
            { field: 'path', operator: 'starts_with', value: '/music/keep' },
        ]);
        expect(normalized.favoritePlaylists).toEqual([]);
        expect(normalized.musicBrainzRequestRateMs).toBe(0);
        expect(normalized.listenBrainzRequestRateMs).toBe(0);
        expect(normalized.audio).toEqual({
            outputDevice: 'default',
            outputBufferMs: 0,
            gaplessPlayback: false,
            replayGainEnabled: true,
        });
        expect(normalized.musicBrainzTagStaleDays).toBe(defaultMusicBrainzTagStaleDays);
        expect(normalized.musicBrainzTagWorkerCores).toBe(1);
        expect(normalized.lissajousScale).toBe(minLissajousScale);
        expect(normalized.visualizerMode).toBe('lissajous');
        expect(normalized.equalizerPosition).toBe('bottom');
        expect(normalized.keyboardShortcuts.nextTrack).toBe(defaultAppSettings.keyboardShortcuts.nextTrack);
    });

    it('keeps default boolean toggles and array fallbacks when values are omitted', () => {
        const normalized = normalizeAppSettings({
            favoritePlaylists: null as unknown as string[],
            lissajousEnabled: undefined,
            lissajousScale: undefined,
            visualizerMode: undefined,
            equalizerPosition: undefined,
            uiDitheringEnabled: undefined,
            audio: {
                outputDevice: undefined as unknown as string,
                outputBufferMs: Number.NaN,
                gaplessPlayback: false,
                replayGainEnabled: false,
            },
            musicBrainzRequestRateMs: 0,
            listenBrainzRequestRateMs: 0,
            musicBrainzTagStaleDays: 0,
        });

        expect(normalized.favoritePlaylists).toEqual([]);
        expect(normalized.localLibraryFilesDatabaseEnabled).toBe(true);
        expect(normalized.localLibraryFilesDatabaseLoadOnStartup).toBe(true);
        expect(normalized.localLibraryFilesDatabaseListenHistoryThresholdSeconds).toBe(defaultListenHistoryThresholdSeconds);
        expect(normalized.scrobblingEnabled).toBe(true);
        expect(normalized.lissajousEnabled).toBe(true);
        expect(normalized.lissajousScale).toBe(defaultLissajousScale);
        expect(normalized.visualizerMode).toBe('lissajous');
        expect(normalized.equalizerPosition).toBe('bottom');
        expect(normalized.uiDitheringEnabled).toBe(true);
        expect(normalized.audio.outputBufferMs).toBe(0);
        expect(normalized.audio.outputDevice).toBe('default');
        expect(normalized.musicBrainzRequestRateMs).toBe(0);
        expect(normalized.listenBrainzRequestRateMs).toBe(0);
        expect(normalized.musicBrainzTagStaleDays).toBe(0);
    });

    it('uses default app settings when optional values are omitted entirely', () => {
        const normalized = normalizeAppSettings({});

        expect(normalized.librarySharingEnabled).toBe(false);
        expect(normalized.librarySharingPort).toBe(defaultAppSettings.librarySharingPort);
        expect(normalized.musicBrainzRequestRateMs).toBe(0);
        expect(normalized.listenBrainzRequestRateMs).toBe(0);
        expect(normalized.audio).toEqual(defaultAppSettings.audio);
        expect(normalized.localLibraryFilesDatabaseEnabled).toBe(true);
        expect(normalized.localLibraryFilesDatabaseLoadOnStartup).toBe(true);
        expect(normalized.localLibraryFilesDatabaseListenHistoryThresholdSeconds).toBe(defaultListenHistoryThresholdSeconds);
        expect(normalized.scrobblingEnabled).toBe(true);
        expect(normalized.musicBrainzTagStaleDays).toBe(defaultMusicBrainzTagStaleDays);
        expect(normalized.customSendToActions).toEqual([]);
        expect(normalized.visualizerMode).toBe(defaultAppSettings.visualizerMode);
    });

    it('normalizes remote library folders in settings payloads', () => {
        const normalized = normalizeAppSettings({
            libraryFolders: [
                { path: '', kind: 'remote', host: ' http://example.com:5005/share ', port: 0, label: ' Friend ', releaseDepth: 2 },
            ],
        });

        expect(normalized.libraryFolders).toEqual([
            { path: 'silphium-remote://example.com:5005', kind: 'remote', host: 'example.com', port: 5005, label: 'Friend', releaseDepth: 2 },
        ]);
        expect(normalized.libraryPath).toBe('silphium-remote://example.com:5005');
    });

    it('preserves disabled local library database settings', () => {
        const normalized = normalizeAppSettings({
            localLibraryFilesDatabaseEnabled: false,
            localLibraryFilesDatabaseLoadOnStartup: false,
        });

        expect(normalized.localLibraryFilesDatabaseEnabled).toBe(false);
        expect(normalized.localLibraryFilesDatabaseLoadOnStartup).toBe(false);
    });
});