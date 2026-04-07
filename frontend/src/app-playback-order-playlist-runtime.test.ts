import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppSettings, PlaybackOrderMode, Track } from './types/app-types';
import { createPlaybackOrderPlaylistRuntime } from './app-playback-order-playlist-runtime';

const {
    createFromMock,
    loadPlaylistFileMock,
    mergePlaylistFilesIntoTracksMock,
    normalizeAppSettingsMock,
    saveSettingsMock,
} = vi.hoisted(() => ({
    createFromMock: vi.fn((value) => value),
    loadPlaylistFileMock: vi.fn(),
    mergePlaylistFilesIntoTracksMock: vi.fn(),
    normalizeAppSettingsMock: vi.fn((value) => value),
    saveSettingsMock: vi.fn(),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    LoadPlaylistFile: loadPlaylistFileMock,
    SaveSettings: saveSettingsMock,
}));

vi.mock('../wailsjs/go/models', () => ({
    main: {
        AppSettings: {
            createFrom: createFromMock,
        },
    },
}));

vi.mock('./services/library-data-service', () => ({
    mergePlaylistFilesIntoTracks: mergePlaylistFilesIntoTracksMock,
}));

vi.mock('./utils/settings-normalization', () => ({
    normalizeAppSettings: normalizeAppSettingsMock,
}));

const createSettings = (overrides: Partial<AppSettings> = {}): AppSettings => ({
    libraryFolders: [{ path: '/music', label: 'Library', releaseDepth: 2 }],
    libraryPath: '/music',
    ffmpegPath: '/tools/ffmpeg',
    listenBrainzUserToken: 'lb-token',
    lastFmApiKey: 'lastfm-key',
    lastFmApiSecret: 'lastfm-secret',
    lastFmSessionKey: 'lastfm-session',
    scrobbleFilterMode: 'blacklist',
    scrobbleRules: [],
    musicBrainzServerUrl: 'https://musicbrainz.org',
    musicBrainzRequestRateMs: 1000,
    listenBrainzServerUrl: 'https://api.listenbrainz.org',
    listenBrainzRequestRateMs: 1000,
    playbackOrder: 'ordered-library',
    releaseDepth: 2,
    favoritePlaylists: ['/playlists/favorites.m3u8'],
    coverArtPriority: ['embedded', 'file'],
    audio: {
        outputDevice: 'default',
        outputBufferMs: 0,
        gaplessPlayback: true,
        replayGainEnabled: true,
    },
    preferMusicBrainzMetadata: true,
    musicBrainzTagDatabaseEnabled: true,
    musicBrainzTagStaleDays: 30,
    musicBrainzTagRequestStaggeringEnabled: false,
    musicBrainzTagWorkerCores: 4,
    lissajousEnabled: true,
    uiDitheringEnabled: true,
    minimizeToTrayOnClose: false,
    customSendToActions: [],
    keyboardShortcuts: {
        playPauseToggle: 'Space',
        nextTrack: 'N',
        previousTrack: 'P',
        stopPlayback: 'S',
        focusLibraryFilter: 'Ctrl+F',
        openSettings: 'Ctrl+,',
    },
    ...overrides,
});

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Track 1',
    name: 'Track 1',
    path: '/music/track-1.flac',
    relativePath: 'Library/track-1.flac',
    folderPath: 'Library',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Track 1',
    displayAlbum: 'Album',
    displayArtist: 'Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: true,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
    ...overrides,
});

describe('createPlaybackOrderPlaylistRuntime', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('updates queue state only when the playback order actually changes', () => {
        const setPlaybackOrderMode = vi
            .fn<[PlaybackOrderMode], boolean>()
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const context = {
            currentSettings: createSettings(),
            playbackSequencingService: {
                setPlaybackOrderMode,
                getPlaybackOrderMode: vi.fn<[], PlaybackOrderMode>(() => 'shuffle-library'),
            },
            playlistController: {
                clearEditableQueue: vi.fn(),
            },
            updatePlayOrderMenuState: vi.fn(),
        };

        const runtime = createPlaybackOrderPlaylistRuntime(context);

        runtime.setPlaybackOrderMode('ordered-library');

        expect(context.currentSettings.playbackOrder).toBe('ordered-library');
        expect(context.playlistController.clearEditableQueue).not.toHaveBeenCalled();
        expect(context.updatePlayOrderMenuState).not.toHaveBeenCalled();

        runtime.setPlaybackOrderMode('shuffle-library');

        expect(context.currentSettings.playbackOrder).toBe('shuffle-library');
        expect(context.playlistController.clearEditableQueue).toHaveBeenCalledTimes(1);
        expect(context.updatePlayOrderMenuState).toHaveBeenCalledTimes(1);
    });

    it('persists playback-order settings and reapplies normalized UI state', async () => {
        const normalizedSettings = createSettings({
            playbackOrder: 'shuffle-library',
            lissajousEnabled: false,
            uiDitheringEnabled: false,
        });
        saveSettingsMock.mockResolvedValue(normalizedSettings);
        normalizeAppSettingsMock.mockReturnValue(normalizedSettings);

        const context = {
            currentSettings: createSettings(),
            playbackSequencingService: {
                getPlaybackOrderMode: vi.fn<[], PlaybackOrderMode>(() => 'shuffle-library'),
                setPlaybackOrderMode: vi.fn(() => true),
            },
            playlistController: {
                clearEditableQueue: vi.fn(),
            },
            updatePlayOrderMenuState: vi.fn(),
            lissajousVisualizerController: {
                setEnabled: vi.fn(),
            },
            applyUiDitheringSetting: vi.fn(),
        };

        const runtime = createPlaybackOrderPlaylistRuntime(context);

        await runtime.savePlaybackOrderSetting();

        expect(createFromMock).toHaveBeenCalledWith(expect.objectContaining({
            playbackOrder: 'shuffle-library',
            releaseDepth: 2,
            libraryFolders: context.currentSettings.libraryFolders,
        }));
        expect(saveSettingsMock).toHaveBeenCalledTimes(1);
        expect(normalizeAppSettingsMock).toHaveBeenCalledWith(normalizedSettings);
        expect(context.currentSettings).toBe(normalizedSettings);
        expect(context.lissajousVisualizerController.setEnabled).toHaveBeenCalledWith(false);
        expect(context.applyUiDitheringSetting).toHaveBeenCalledTimes(1);
        expect(context.playlistController.clearEditableQueue).toHaveBeenCalledTimes(1);
        expect(context.updatePlayOrderMenuState).toHaveBeenCalledTimes(1);
    });

    it('loads playlist tracks, merges them into the library, and rebuilds the path index', async () => {
        loadPlaylistFileMock.mockResolvedValue({
            name: 'Road Trip',
            trackFiles: [{ path: '/music/new-track.flac' }],
        });
        const mergedTracks = [
            createTrack({ path: '/music/existing.flac', name: 'Existing', title: 'Existing', relativePath: 'Library/existing.flac' }),
            createTrack({ path: '/music/new-track.flac', name: 'New Track', title: 'New Track', relativePath: 'Library/new-track.flac' }),
        ];
        mergePlaylistFilesIntoTracksMock.mockResolvedValue({
            tracks: mergedTracks,
            trackIndexes: [1, 0],
        });
        const context = {
            currentSettings: createSettings(),
            tracks: [createTrack({ path: '/music/existing.flac', name: 'Existing', title: 'Existing', relativePath: 'Library/existing.flac' })],
            playbackSequencingService: {
                getPlaybackOrderMode: vi.fn<[], PlaybackOrderMode>(() => 'ordered-library'),
                setPlaybackOrderMode: vi.fn<[PlaybackOrderMode], boolean>(() => true),
            },
            playlistController: {
                clearEditableQueue: vi.fn(),
            },
            updatePlayOrderMenuState: vi.fn(),
            rebuildTrackPathIndex: vi.fn(),
        };

        const runtime = createPlaybackOrderPlaylistRuntime(context);

        await expect(runtime.loadPlaylistData('/playlists/road-trip.m3u8')).resolves.toEqual({
            name: 'Road Trip',
            trackIndexes: [1, 0],
        });
        expect(loadPlaylistFileMock).toHaveBeenCalledWith('/playlists/road-trip.m3u8');
        expect(mergePlaylistFilesIntoTracksMock).toHaveBeenCalledWith(
            [createTrack({ path: '/music/existing.flac', name: 'Existing', title: 'Existing', relativePath: 'Library/existing.flac' })],
            [{ path: '/music/new-track.flac' }],
        );
        expect(context.tracks).toBe(mergedTracks);
        expect(context.rebuildTrackPathIndex).toHaveBeenCalledTimes(1);
    });
});