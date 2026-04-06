import { describe, expect, it } from 'vitest';

import type { Track } from '../types/app-types';
import {
    asScrobbleFilterMode,
    buildDisplayMetadata,
    buildLibraryRootNameByPath,
    findLibraryFolderForFilePath,
    formatTechnicalMetadata,
    isTrackPathScrobbleAllowed,
    libraryFolderPathKey,
    normalizeLibraryFolders,
    normalizeScrobbleFolders,
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
    });

    it('formats technical metadata for lossless and lossy codecs', () => {
        expect(formatTechnicalMetadata(24, 48_000, 'flac', 0)).toBe('24/48 • FLAC');
        expect(formatTechnicalMetadata(24, 44_100, 'mp3', 320_000)).toBe('320k/44.1 • MP3');
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

        expect(normalizeScrobbleFolders([
            ' C:\\Music\\Main ',
            'c:/music/main',
            '',
            '   ',
            '/music/archive',
            '/music/archive/',
        ])).toEqual([
            'C:\\Music\\Main',
            '/music/archive',
        ]);
    });

    it('applies scrobble blacklist and whitelist path matching', () => {
        expect(isTrackPathScrobbleAllowed(
            'C:/Music/Main/Artist/Album/track.flac',
            'blacklist',
            ['C:/Music/Main'],
        )).toBe(false);

        expect(isTrackPathScrobbleAllowed(
            'C:/Music/Other/Artist/Album/track.flac',
            'blacklist',
            ['C:/Music/Main'],
        )).toBe(true);

        expect(isTrackPathScrobbleAllowed(
            'C:/Music/Main/Artist/Album/track.flac',
            'whitelist',
            ['C:/Music/Main'],
        )).toBe(true);

        expect(isTrackPathScrobbleAllowed(
            'C:/Music/Other/Artist/Album/track.flac',
            'whitelist',
            ['C:/Music/Main'],
        )).toBe(false);

        expect(isTrackPathScrobbleAllowed(
            'C:/Music/Main/track.flac',
            'whitelist',
            [],
        )).toBe(false);
    });
});