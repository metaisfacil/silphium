import { describe, expect, it } from 'vitest';

import type { Track } from '../types/app-types';
import {
    createEmptyPastedPathLookupCache,
    isLikelyAbsoluteLibraryPath,
    normalizePastedLibraryPath,
    rebuildPastedPathLookupCache,
    resolvePastedLibraryJumpFolder,
} from './library-controller-pasted-path';

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Track',
    name: 'Track',
    path: 'C:/Music/Artist/Album/01 Track.flac',
    relativePath: 'Library/Artist/Album/01 Track.flac',
    folderPath: 'Library/Artist/Album',
    rootPath: 'C:/Music',
    rootName: 'Library',
    displayTitle: 'Track',
    displayAlbum: 'Album',
    displayArtist: 'Artist',
    displayTrackNumber: '1',
    displayTrackTotal: '1',
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

describe('library-controller pasted-path helpers', () => {
    it('normalizes pasted paths and detects absolute library paths', () => {
        expect(normalizePastedLibraryPath('  "C:\\Music\\Artist\\Album\\"  ')).toBe('C:/Music/Artist/Album');
        expect(normalizePastedLibraryPath("  '/srv/music/artist/'  ")).toBe('/srv/music/artist');
        expect(normalizePastedLibraryPath('   ')).toBe('');
        expect(isLikelyAbsoluteLibraryPath('C:/Music/Artist')).toBe(true);
        expect(isLikelyAbsoluteLibraryPath('//server/share/Music')).toBe(true);
        expect(isLikelyAbsoluteLibraryPath('Library/Artist/Album')).toBe(false);
    });

    it('rebuilds the lookup cache and resolves file, folder, and root-relative jumps', () => {
        const cache = rebuildPastedPathLookupCache(
            [createTrack()],
            [{
                name: 'info.txt',
                path: 'C:/Music/Artist/Album/info.txt',
                relativePath: 'Library/Artist/Album/info.txt',
                folderPath: 'Library/Artist/Album',
                rootPath: 'C:/Music',
                rootName: 'Library',
            }],
            [{
                name: 'cover.jpg',
                path: 'C:/Music/Artist/Album/cover.jpg',
                relativePath: 'Library/Artist/Album/cover.jpg',
                folderPath: 'Library/Artist/Album',
                rootPath: 'C:/Music',
                rootName: 'Library',
            }],
        );

        expect(resolvePastedLibraryJumpFolder('C:/Music/Artist/Album/01 Track.flac', cache)).toBe('Library/Artist/Album');
        expect(resolvePastedLibraryJumpFolder('Library/Artist/Album/01 Track.flac', cache)).toBe('Library/Artist/Album');
        expect(resolvePastedLibraryJumpFolder('C:/Music/Artist/Album', cache)).toBe('Library/Artist/Album');
        expect(resolvePastedLibraryJumpFolder('Library/Artist/Album', cache)).toBe('Library/Artist/Album');
        expect(resolvePastedLibraryJumpFolder('C:/Music', cache)).toBe('Library');
        expect(resolvePastedLibraryJumpFolder('D:/Other/Artist', cache)).toBeNull();
    });

    it('starts from an empty cache when no indexed files are present', () => {
        expect(createEmptyPastedPathLookupCache()).toEqual({
            indexedFolderPathByKey: new Map(),
            indexedFileFolderPathByKey: new Map(),
            monitoredRoots: [],
        });
    });
});