import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    appendIndexedFilesToScanCollections,
    clearLibraryRuntimeData,
    createScanCollections,
    mapLibraryScanResult,
    mergePlaylistFilesIntoTracks,
} from './library-data-service';
import type { LibraryIndexedFile, LibraryScanResult, Track } from '../types/app-types';

const createIndexedFile = (path: string, name: string, overrides: Partial<LibraryIndexedFile> = {}): LibraryIndexedFile => ({
    path,
    name,
    relativePath: `Library/${name}`,
    folderPath: 'Library',
    rootPath: '/music',
    rootName: 'Library',
    ...overrides,
});

const createScanResult = (overrides: Partial<LibraryScanResult> = {}): LibraryScanResult => ({
    rootPath: '',
    rootName: '',
    trackFiles: [],
    textFiles: [],
    imageFiles: [],
    coverPathByFolder: {},
    totalEntries: 0,
    trackCount: 0,
    textFileCount: 0,
    imageFileCount: 0,
    truncated: false,
    entryLimit: 0,
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

describe('library data service', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('URL', {
            ...URL,
            revokeObjectURL: vi.fn(),
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('creates scan collections and maps indexed files into the right buckets', async () => {
        const scanCollections = createScanCollections(createScanResult({
            coverPathByFolder: { Library: '/music/cover.jpg' },
        }));

        expect(createScanCollections(createScanResult()).coverPathEntries).toEqual([]);

        expect(scanCollections.coverPathEntries).toEqual([['Library', '/music/cover.jpg']]);
        expect(scanCollections.tracks).toEqual([]);
        expect(scanCollections.textFiles).toEqual([]);
        expect(scanCollections.imageFiles).toEqual([]);

        await appendIndexedFilesToScanCollections(scanCollections, 'track', Array.from({ length: 400 }, (_, index) => (
            createIndexedFile(`/music/track-${index}.flac`, `track-${index}.flac`)
        )));
        await appendIndexedFilesToScanCollections(scanCollections, 'text-file', Array.from({ length: 400 }, (_, index) => (
            index === 0
                ? createIndexedFile(`/music/readme-${index}.txt`, `readme-${index}.txt`, { rootPath: undefined, rootName: undefined })
                : createIndexedFile(`/music/readme-${index}.txt`, `readme-${index}.txt`)
        )));
        await appendIndexedFilesToScanCollections(scanCollections, 'image-file', Array.from({ length: 400 }, (_, index) => (
            index === 0
                ? createIndexedFile(`/music/cover-${index}.jpg`, `cover-${index}.jpg`, { rootPath: undefined, rootName: undefined })
                : createIndexedFile(`/music/cover-${index}.jpg`, `cover-${index}.jpg`)
        )));

        expect(scanCollections.tracks).toHaveLength(400);
        expect(scanCollections.tracks[0]).toEqual(expect.objectContaining({
            title: 'track-0.flac',
            displayAlbum: 'Unknown Album',
            displayArtist: 'Unknown Artist',
            tagsResolved: false,
        }));
        expect(scanCollections.textFiles[0]).toEqual(expect.objectContaining({ path: '/music/readme-0.txt', rootName: '', rootPath: '' }));
        expect(scanCollections.imageFiles[0]).toEqual(expect.objectContaining({ path: '/music/cover-0.jpg', rootName: '', rootPath: '' }));
    });

    it('maps a full scan result into collections', async () => {
        const scanCollections = await mapLibraryScanResult(createScanResult({
            coverPathByFolder: { Library: '/music/cover.jpg' },
            trackFiles: [createIndexedFile('/music/track.flac', 'track.flac')],
            textFiles: [createIndexedFile('/music/readme.txt', 'readme.txt')],
            imageFiles: [createIndexedFile('/music/cover.jpg', 'cover.jpg')],
        }));

        expect(scanCollections.coverPathEntries).toEqual([['Library', '/music/cover.jpg']]);
        expect(scanCollections.tracks).toHaveLength(1);
        expect(scanCollections.textFiles).toHaveLength(1);
        expect(scanCollections.imageFiles).toHaveLength(1);

        const emptyCollections = await mapLibraryScanResult(createScanResult());
        expect(emptyCollections.tracks).toEqual([]);
        expect(emptyCollections.textFiles).toEqual([]);
        expect(emptyCollections.imageFiles).toEqual([]);
    });

    it('merges playlist files into tracks while preserving existing indexes and yielding between batches', async () => {
        const tracks = [createTrack()];

        const playlistFiles = Array.from({ length: 201 }, (_, index) => (
            index === 0
                ? createIndexedFile('/music/track-1.flac', 'track-1.flac')
                : index === 1
                    ? createIndexedFile('/music/new-track-1.flac', 'new-track-1.flac', {
                        relativePath: undefined,
                        folderPath: undefined,
                        rootPath: undefined,
                        rootName: undefined,
                    })
                : createIndexedFile(`/music/new-track-${index}.flac`, `new-track-${index}.flac`)
        ));

        const merged = await mergePlaylistFilesIntoTracks(tracks, playlistFiles);

        expect(merged.trackIndexes[0]).toBe(0);
        expect(merged.tracks).toHaveLength(201);
        expect(merged.trackIndexes).toHaveLength(201);
        expect(merged.tracks[1]).toEqual(expect.objectContaining({
            path: '/music/new-track-1.flac',
            relativePath: 'new-track-1.flac',
            folderPath: '',
            rootPath: '',
            rootName: '',
            displayTitle: 'new-track-1.flac',
        }));
    });

    it('applies cached listen-history labels to unresolved tracks', async () => {
        const tracks = [createTrack({
            path: '/music/history-track.flac',
            name: 'history-track.flac',
            title: 'history-track.flac',
            displayTitle: 'history-track.flac',
            displayArtist: 'Unknown Artist',
            tagsResolved: false,
        })];

        const merged = await mergePlaylistFilesIntoTracks(tracks, [
            createIndexedFile('/music/history-track.flac', 'history-track.flac', {
                cachedTrackTitle: 'Cached History Title',
                cachedAlbumTitle: 'Cached History Album',
                cachedArtistName: 'Cached History Artist',
                cachedTrackNumber: '7',
                cachedTrackTotal: '12',
                listenedAt: 1_700_000_000,
            }),
        ]);

        expect(merged.trackIndexes).toEqual([0]);
        expect(merged.tracks[0]).toEqual(expect.objectContaining({
            title: 'Cached History Title',
            displayTitle: 'Cached History Title',
            displayAlbum: 'Cached History Album',
            displayArtist: 'Cached History Artist',
            displayTrackNumber: '7',
            displayTrackTotal: '12',
        }));
    });

    it('reuses a caller-provided track path index when merging playlist files', async () => {
        const tracks = [createTrack()];
        const trackIndexByPath = new Map<string, number>([['/music/track-1.flac', 0]]);

        const merged = await mergePlaylistFilesIntoTracks(tracks, [
            createIndexedFile('/music/new-track.flac', 'new-track.flac', {
                cachedTrackTitle: 'Cached New Track',
                cachedArtistName: 'Cached Artist',
            }),
        ], trackIndexByPath);

        expect(merged.tracks).toBe(tracks);
        expect(merged.trackIndexes).toEqual([1]);
        expect(trackIndexByPath.get('/music/new-track.flac')).toBe(1);
        expect(tracks[1]).toEqual(expect.objectContaining({
            path: '/music/new-track.flac',
            displayTitle: 'Cached New Track',
            displayArtist: 'Cached Artist',
        }));
    });

    it('clears runtime data and optional caches', () => {
        const clearCoverArtCache = vi.fn();
        const clearArtistInfoCache = vi.fn();
        const clearImageModalCache = vi.fn();
        const resetLibraryState = vi.fn();
        const resetPlaylistState = vi.fn();

        const result = clearLibraryRuntimeData({
            objectUrls: ['blob:one', 'blob:two'],
            clearCoverArtCache,
            clearArtistInfoCache,
            clearImageModalCache,
            resetLibraryState,
            resetPlaylistState,
        });

        expect(result).toEqual([]);
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(clearCoverArtCache).toHaveBeenCalledTimes(1);
        expect(clearArtistInfoCache).toHaveBeenCalledTimes(1);
        expect(clearImageModalCache).toHaveBeenCalledTimes(1);
        expect(resetLibraryState).toHaveBeenCalledTimes(1);
        expect(resetPlaylistState).toHaveBeenCalledTimes(1);
    });

    it('clears runtime data without optional caches', () => {
        const clearArtistInfoCache = vi.fn();
        const resetLibraryState = vi.fn();
        const resetPlaylistState = vi.fn();

        clearLibraryRuntimeData({
            objectUrls: [],
            clearArtistInfoCache,
            resetLibraryState,
            resetPlaylistState,
        });

        expect(clearArtistInfoCache).toHaveBeenCalledTimes(1);
        expect(resetLibraryState).toHaveBeenCalledTimes(1);
        expect(resetPlaylistState).toHaveBeenCalledTimes(1);
    });
});