import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImageLibraryFile, Track } from './types/app-types';
import { createAppReleaseRuntime } from './app-release-runtime';

const { audioGetReplayGainReleaseDynamicRangeMock } = vi.hoisted(() => ({
    audioGetReplayGainReleaseDynamicRangeMock: vi.fn(),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    AudioGetReplayGainReleaseDynamicRange: audioGetReplayGainReleaseDynamicRangeMock,
}));

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Track',
    name: 'Track',
    path: '/music/library/artist/album/disc-1/01.flac',
    relativePath: 'Library/Artist/Album/Disc 1/01.flac',
    folderPath: 'Library/Artist/Album/Disc 1',
    rootPath: '/music/library',
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

const createImage = (overrides: Partial<ImageLibraryFile> = {}): ImageLibraryFile => ({
    name: 'cover.jpg',
    path: '/music/library/artist/album/cover.jpg',
    relativePath: 'Library/Artist/Album/cover.jpg',
    folderPath: 'Library/Artist/Album',
    rootPath: '/music/library',
    rootName: 'Library',
    ...overrides,
});

describe('createAppReleaseRuntime', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('derives release roots from library depth and root names', () => {
        const tracks = [createTrack()];
        const runtime = createAppReleaseRuntime({
            tracks,
            imageFiles: [],
            currentTrackIndex: 0,
            currentSettings: { audio: { replayGainEnabled: true } },
            activeReplayGainReleaseTrackPaths: [],
            replayGainReleaseDynamicRangeLabelByKey: new Map(),
            replayGainReleaseDynamicRangePendingByKey: new Map(),
            replayGainReleaseDynamicRangeRequestVersion: 0,
            releaseDepthForTrack: vi.fn(() => 2),
            playlistController: { getSequenceOverride: vi.fn(() => null) },
            baseSequenceIndexes: () => ({ indexes: [0], currentPosition: 0 }),
            trackPathKey: (path: string) => path.trim().toLowerCase(),
            updateNowPlayingTechnicalLabels: vi.fn(),
        });

        expect(runtime.releaseRootPathForTrack(tracks[0])).toBe('Library/Artist/Album');
        expect(runtime.replayGainReleaseKeyForTrack(tracks[0])).toContain('::library/artist/album');
    });

    it('only returns replay-gain release paths when the full release is contiguous in sequence order', () => {
        const tracks = [
            createTrack({ path: '/music/library/artist/album/disc-1/01.flac', relativePath: 'Library/Artist/Album/Disc 1/01.flac' }),
            createTrack({ path: '/music/library/artist/album/disc-1/02.flac', relativePath: 'Library/Artist/Album/Disc 1/02.flac' }),
            createTrack({ path: '/music/library/artist/album/disc-2/03.flac', relativePath: 'Library/Artist/Album/Disc 2/03.flac', folderPath: 'Library/Artist/Album/Disc 2' }),
            createTrack({ path: '/music/library/artist/other-album/01.flac', relativePath: 'Library/Artist/Other Album/01.flac', folderPath: 'Library/Artist/Other Album' }),
        ];
        const runtime = createAppReleaseRuntime({
            tracks,
            imageFiles: [],
            currentTrackIndex: 0,
            currentSettings: { audio: { replayGainEnabled: true } },
            activeReplayGainReleaseTrackPaths: [],
            replayGainReleaseDynamicRangeLabelByKey: new Map(),
            replayGainReleaseDynamicRangePendingByKey: new Map(),
            replayGainReleaseDynamicRangeRequestVersion: 0,
            releaseDepthForTrack: vi.fn(() => 2),
            playlistController: { getSequenceOverride: vi.fn(() => null) },
            baseSequenceIndexes: () => ({ indexes: [0, 1, 2, 3], currentPosition: 0 }),
            trackPathKey: (path: string) => path.trim().toLowerCase(),
            updateNowPlayingTechnicalLabels: vi.fn(),
        });

        expect(runtime.collectReplayGainReleaseTrackPathsForIndex(1, [0, 1, 2, 3])).toEqual([
            '/music/library/artist/album/disc-1/01.flac',
            '/music/library/artist/album/disc-1/02.flac',
            '/music/library/artist/album/disc-2/03.flac',
        ]);
        expect(runtime.collectReplayGainReleaseTrackPathsForIndex(1, [0, 1, 3])).toEqual([]);
    });

    it('caches dynamic-range lookups and reuses them for the current release', async () => {
        audioGetReplayGainReleaseDynamicRangeMock.mockResolvedValue(12);
        const updateNowPlayingTechnicalLabels = vi.fn();
        const tracks = [
            createTrack({ path: '/music/library/artist/album/disc-1/01.flac', relativePath: 'Library/Artist/Album/Disc 1/01.flac' }),
            createTrack({ path: '/music/library/artist/album/disc-1/02.flac', relativePath: 'Library/Artist/Album/Disc 1/02.flac' }),
        ];
        const replayGainReleaseDynamicRangeLabelByKey = new Map<string, string>();
        const runtime = createAppReleaseRuntime({
            tracks,
            imageFiles: [],
            currentTrackIndex: 0,
            currentSettings: { audio: { replayGainEnabled: true } },
            activeReplayGainReleaseTrackPaths: [],
            replayGainReleaseDynamicRangeLabelByKey,
            replayGainReleaseDynamicRangePendingByKey: new Map(),
            replayGainReleaseDynamicRangeRequestVersion: 0,
            releaseDepthForTrack: vi.fn(() => 2),
            playlistController: { getSequenceOverride: vi.fn(() => null) },
            baseSequenceIndexes: () => ({ indexes: [0, 1], currentPosition: 0 }),
            trackPathKey: (path: string) => path.trim().toLowerCase(),
            updateNowPlayingTechnicalLabels,
        });

        await runtime.refreshReplayGainReleaseDynamicRangeIndicator();

        expect(audioGetReplayGainReleaseDynamicRangeMock).toHaveBeenCalledTimes(1);
        expect(runtime.cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack()).toBe('DR12');

        await runtime.refreshReplayGainReleaseDynamicRangeIndicator();

        expect(audioGetReplayGainReleaseDynamicRangeMock).toHaveBeenCalledTimes(1);
        expect(updateNowPlayingTechnicalLabels).toHaveBeenCalledTimes(2);
        expect(Array.from(replayGainReleaseDynamicRangeLabelByKey.values())).toEqual(['DR12']);
    });

    it('collects release images from the current release root and matching library root only', () => {
        const track = createTrack();
        const runtime = createAppReleaseRuntime({
            tracks: [track],
            imageFiles: [
                createImage({ path: '/music/library/artist/album/cover.jpg', relativePath: 'Library/Artist/Album/cover.jpg', folderPath: 'Library/Artist/Album' }),
                createImage({ path: '/music/library/artist/album/disc-1/booklet.jpg', relativePath: 'Library/Artist/Album/Disc 1/booklet.jpg', folderPath: 'Library/Artist/Album/Disc 1' }),
                createImage({ path: '/music/library/artist/other-album/cover.jpg', relativePath: 'Library/Artist/Other Album/cover.jpg', folderPath: 'Library/Artist/Other Album' }),
                createImage({ path: '/other-root/artist/album/cover.jpg', relativePath: 'Other/Artist/Album/cover.jpg', folderPath: 'Library/Artist/Album', rootPath: '/other-root', rootName: 'Other' }),
            ],
            currentTrackIndex: 0,
            currentSettings: { audio: { replayGainEnabled: true } },
            activeReplayGainReleaseTrackPaths: [],
            replayGainReleaseDynamicRangeLabelByKey: new Map(),
            replayGainReleaseDynamicRangePendingByKey: new Map(),
            replayGainReleaseDynamicRangeRequestVersion: 0,
            releaseDepthForTrack: vi.fn(() => 2),
            playlistController: { getSequenceOverride: vi.fn(() => null) },
            baseSequenceIndexes: () => ({ indexes: [0], currentPosition: 0 }),
            trackPathKey: (path: string) => path.trim().toLowerCase(),
            updateNowPlayingTechnicalLabels: vi.fn(),
        });

        expect(runtime.collectReleaseImageFiles(track).map((image) => image.path)).toEqual([
            '/music/library/artist/album/cover.jpg',
            '/music/library/artist/album/disc-1/booklet.jpg',
        ]);
        expect(runtime.indexOfImageByPath(runtime.collectReleaseImageFiles(track), '/music/library/artist/album/disc-1/booklet.jpg')).toBe(1);
    });
});