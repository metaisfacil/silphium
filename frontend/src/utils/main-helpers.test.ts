import { describe, expect, it } from 'vitest';

import type { Track } from '../types/app-types';
import {
    asScrobbleFilterMode,
    buildDisplayMetadata,
    describeScrobbleRule,
    effectivePlaybackTechnicalMetadata,
    buildLibraryRootNameByPath,
    findLibraryFolderForFilePath,
    findLibraryFolderForTrack,
    relativeFolderSegmentsForTrack,
    releaseFolderPathForTrackAtDepth,
    formatTechnicalMetadata,
    hasExternalFileDragPayload,
    isSupportedAudioFilePath,
    isTrackScrobbleAllowed,
    libraryFolderPathKey,
    normalizeLibraryFolders,
    normalizeScrobbleRules,
    validateScrobbleRules,
} from './main-helpers';

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Fallback Title',
    name: 'Fallback Title',
    path: '/music/artist/album/fallback.flac',
    relativePath: 'artist/album/fallback.flac',
    folderPath: 'Library/Artist/Album',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Fallback Title',
    displayAlbum: 'Fallback Album',
    displayArtist: 'Fallback Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: false,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
    ...overrides,
});

describe('main helpers', () => {
    it('normalizes library folders and falls back to the legacy single-folder setting', () => {
        expect(normalizeLibraryFolders(undefined, ' /music/archive ', 99)).toEqual([
            { path: '/music/archive', label: '', releaseDepth: 64 },
        ]);

        expect(normalizeLibraryFolders([
            { path: ' C:\\Music\\Main\\ ', label: ' Main / Library ', releaseDepth: 80 },
            { path: 'c:/music/main', label: 'Duplicate', releaseDepth: 1 },
            { path: '   ', label: 'Ignored', releaseDepth: 1 },
        ])).toEqual([
            { path: 'C:\\Music\\Main\\', label: 'Main Library', releaseDepth: 64 },
        ]);

        expect(normalizeLibraryFolders([
            { path: '', kind: 'remote', host: ' HTTP://Example.com:5005/library ', port: 0, label: ' Friend ', releaseDepth: 7 },
            { path: 'silphium-remote://example.com:5005', label: 'Duplicate', releaseDepth: 0 },
        ])).toEqual([
            { path: 'silphium-remote://example.com:5005', kind: 'remote', host: 'example.com', port: 5005, label: 'Friend', releaseDepth: 7 },
        ]);
    });

    it('creates stable root names and prefers the deepest folder match', () => {
        const folders = [
            { path: '/music/library-a', label: 'Road Trip', releaseDepth: 0 },
            { path: '/music/library-b', label: 'Road Trip', releaseDepth: 0 },
            { path: '/music/library-b/live', label: '', releaseDepth: 0 },
        ];
        const names = buildLibraryRootNameByPath(folders);

        expect(names.get(libraryFolderPathKey('/music/library-a'))).toBe('Road Trip (1)');
        expect(names.get(libraryFolderPathKey('/music/library-b'))).toBe('Road Trip (2)');
        expect(findLibraryFolderForFilePath('/music/library-b/live/show/track.flac', folders)).toEqual(folders[2]);

        const remoteFolders = normalizeLibraryFolders([
            { path: '', kind: 'remote', host: 'example.com', port: 5005, label: 'Shared', releaseDepth: 0 },
        ]);
        expect(findLibraryFolderForFilePath('silphium-remote://example.com:5005/Shared Root/album/track.flac', remoteFolders)).toEqual(remoteFolders[0]);
        expect(findLibraryFolderForTrack({ rootPath: '/missing-root', path: '/music/library-b/live/show/track.flac' }, folders)).toEqual(folders[2]);
    });

    it('only strips the leading folder segment when it actually matches the root label', () => {
        expect(relativeFolderSegmentsForTrack('Library/Artist/Album/Disc 1', 'Library')).toEqual(['Artist', 'Album', 'Disc 1']);
        expect(relativeFolderSegmentsForTrack('Artist/Album/Disc 1', 'Selected folders')).toEqual(['Artist', 'Album', 'Disc 1']);
        expect(releaseFolderPathForTrackAtDepth({ folderPath: 'Artist/Album/Disc 1', rootName: 'Selected folders' }, 2)).toBe('Artist/Album');
        expect(releaseFolderPathForTrackAtDepth({ folderPath: 'Library/Artist/Album/Disc 1', rootName: 'Library' }, 2)).toBe('Library/Artist/Album');
    });

    it('formats technical metadata for lossless and lossy codecs', () => {
        expect(formatTechnicalMetadata(24, 48_000, 'flac', 0)).toBe('24/48 • FLAC');
        expect(formatTechnicalMetadata(24, 44_100, 'mp3', 320_000)).toBe('320k/44.1 • MP3');
    });

    it('prefers effective remote stream metadata for transcoded playback captions', () => {
        expect(effectivePlaybackTechnicalMetadata(createTrack({
            path: 'silphium-remote://friend:5005/Friend/Artist/Album/01 Remote Song.flac',
            displayTechnical: '24/96 • FLAC',
        }), {
            remoteLibraryTranscodingEnabled: true,
            remoteLibraryTranscodingBitrateKbps: 256,
        })).toBe('256k • OPUS');

        expect(effectivePlaybackTechnicalMetadata(createTrack({
            path: 'silphium-remote://friend:5005/Friend/Artist/Album/01 Remote Song.flac',
            displayTechnical: '24/96 • FLAC',
        }), {
            remoteLibraryTranscodingEnabled: false,
            remoteLibraryTranscodingBitrateKbps: 256,
        })).toBe('24/96 • FLAC');

        expect(effectivePlaybackTechnicalMetadata(createTrack({
            path: '/music/Artist/Album/01 Local Song.flac',
            displayTechnical: '24/96 • FLAC',
        }), {
            remoteLibraryTranscodingEnabled: true,
            remoteLibraryTranscodingBitrateKbps: 256,
        })).toBe('24/96 • FLAC');
    });

    it('detects external file drag payloads', () => {
        expect(hasExternalFileDragPayload({ types: ['Files'] })).toBe(true);
        expect(hasExternalFileDragPayload({ types: ['text/plain', 'Files'] })).toBe(true);
        expect(hasExternalFileDragPayload({ types: ['text/plain'] })).toBe(false);
        expect(hasExternalFileDragPayload(null)).toBe(false);
    });

    it('recognizes supported audio file paths', () => {
        expect(isSupportedAudioFilePath('C:/Music/Artist/Album/track.flac')).toBe(true);
        expect(isSupportedAudioFilePath('C:/Music/Artist/Album/track.FLAC')).toBe(true);
        expect(isSupportedAudioFilePath('C:/Music/playlist.m3u8')).toBe(false);
        expect(isSupportedAudioFilePath('C:/Music/Artist/Album')).toBe(false);
        expect(isSupportedAudioFilePath('')).toBe(false);
    });

    it('builds display metadata from cleaned tag values and versions', () => {
        const track = createTrack();

        expect(buildDisplayMetadata(track, {
            title: '  Chosen Title  ',
            album: '  Album Name  ',
            artist: '  ',
            allTags: {
                VERSION: [' Deluxe Edition '],
            },
        })).toEqual({
            title: 'Chosen Title',
            album: 'Album Name (Deluxe Edition)',
            artist: 'Unknown Artist',
        });
    });

    it('normalizes scrobble filter mode and folder rules', () => {
        expect(asScrobbleFilterMode('whitelist')).toBe('whitelist');
        expect(asScrobbleFilterMode('')).toBe('blacklist');

        expect(normalizeScrobbleRules([
            { field: 'path', operator: 'starts_with', value: ' C:\\Music\\Main ' },
            { field: 'path', operator: 'starts_with', value: 'c:/music/main' },
            { field: 'anyTag', operator: 'contains', value: '  ambient  ' },
            { field: 'anyTag', operator: 'contains', value: 'ambient' },
            { field: 'trackLength', operator: 'less_than', value: '240' },
            { field: 'trackLength', operator: 'less_than', value: '-10' },
        ])).toEqual([
            { field: 'path', operator: 'starts_with', value: 'C:\\Music\\Main' },
            { field: 'anyTag', operator: 'contains', value: 'ambient' },
            { field: 'trackLength', operator: 'less_than', value: '240' },
        ]);

        expect(normalizeScrobbleRules(undefined, [
            '/music/archive',
            '/music/archive/',
        ])).toEqual([
            { field: 'path', operator: 'starts_with', value: '/music/archive' },
        ]);
    });

    it('validates and describes regex scrobble rules', () => {
        expect(validateScrobbleRules([
            { field: 'trackArtist', operator: 'regex', value: '(/invalid' },
        ])).toContain('Invalid RegEx');

        expect(validateScrobbleRules([
            { field: 'trackArtist', operator: 'regex', value: '/artist/i' },
        ])).toBeNull();

        expect(describeScrobbleRule({ field: 'trackLength', operator: 'greater_than', value: '240' })).toBe('Track length is longer than 240s');
        expect(describeScrobbleRule({ field: 'anyTag', operator: 'contains', value: 'live' })).toBe('Any tag contains live');
    });

    it('matches scrobble rules against metadata fields and duration', () => {
        const track = createTrack({
            path: 'C:/Music/Main/Artist/Album/track.flac',
            displayTitle: 'Signal Bloom',
            displayAlbum: 'Night Archive',
            displayArtist: 'Guest Singer',
            allFileTags: {
                albumartist: ['Various Artists'],
                artist: ['Guest Singer'],
                genre: ['Ambient', 'Drone'],
            },
            technicalDetails: {
                durationSeconds: 301,
            },
            mbIds: {
                artistId: 'artist-1',
                releaseId: 'release-1',
            },
            artistMbids: ['artist-1', 'artist-2'],
        });

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'whitelist',
            [{ field: 'albumArtist', operator: 'regex', value: '/various/i' }],
        )).toBe(true);

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'whitelist',
            [{ field: 'genre', operator: 'contains', value: 'ambient' }],
        )).toBe(true);

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'whitelist',
            [{ field: 'anyTag', operator: 'contains', value: 'drone' }],
        )).toBe(true);

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'whitelist',
            [{ field: 'artistMbid', operator: 'equals', value: 'artist-2' }],
        )).toBe(true);

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'whitelist',
            [{ field: 'trackLength', operator: 'greater_than', value: '240' }],
        )).toBe(true);

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'blacklist',
            [{ field: 'path', operator: 'starts_with', value: 'C:/Music/Main' }],
        )).toBe(false);

        expect(isTrackScrobbleAllowed(
            track,
            301,
            'whitelist',
            [],
        )).toBe(false);
    });
});