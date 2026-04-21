import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoverArtService } from './cover-art-service';
import type { Track } from '../types/app-types';

describe('createCoverArtService', () => {
    const originalCreateObjectUrl = URL.createObjectURL;

    beforeEach(() => {
        URL.createObjectURL = vi.fn(() => 'blob:test-cover-art');
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectUrl;
    });

    it('prefers image thumbnails for folder covers before falling back to full file reads', async () => {
        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));
        const readFileBase64 = vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl');

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getIndexedFolderCoverPath: () => undefined,
            getLibraryFolderCoverPath: async () => '/music/library/cover.jpg',
            readImageThumbnail,
            readFileBase64,
            readTrackEmbeddedCover: async () => ({}),
            registerObjectUrl: vi.fn(),
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        const coverUrl = await service.resolveForTrack(track);

        expect(coverUrl).toBe('blob:test-cover-art');
        expect(readImageThumbnail).toHaveBeenCalledWith('/music/library/cover.jpg', 512);
        expect(readFileBase64).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent folder cover requests for the same track folder', async () => {
        const coverPathDeferred = Promise.resolve('/music/library/cover.jpg');
        const thumbnailDeferred = Promise.resolve({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        });
        const getLibraryFolderCoverPath = vi.fn(async () => await coverPathDeferred);
        const readImageThumbnail = vi.fn(async () => await thumbnailDeferred);

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getIndexedFolderCoverPath: () => undefined,
            getLibraryFolderCoverPath,
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: async () => ({}),
            registerObjectUrl: vi.fn(),
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        const [firstCoverUrl, secondCoverUrl] = await Promise.all([
            service.resolveForTrack(track),
            service.resolveForTrack(track),
        ]);

        expect(firstCoverUrl).toBe('blob:test-cover-art');
        expect(secondCoverUrl).toBe('blob:test-cover-art');
        expect(getLibraryFolderCoverPath).toHaveBeenCalledTimes(1);
        expect(readImageThumbnail).toHaveBeenCalledTimes(1);
    });

    it('preserves folder cover paths when clearing resolved cover-art cache', async () => {
        const getLibraryFolderCoverPath = vi.fn(async () => '/music/library/cover.jpg');
        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getIndexedFolderCoverPath: () => undefined,
            getLibraryFolderCoverPath,
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: async () => ({}),
            registerObjectUrl: vi.fn(),
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        service.setFolderCoverPath(track.folderPath, '/music/library/cover.jpg');

        await service.resolveForTrack(track);
        service.clearResolvedCache();
        await service.resolveForTrack(track);

        expect(getLibraryFolderCoverPath).not.toHaveBeenCalled();
        expect(readImageThumbnail).toHaveBeenCalledTimes(2);
    });

    it('preserves folder cover paths when invalidating resolved track cover art', async () => {
        const getLibraryFolderCoverPath = vi.fn(async () => '/music/library/cover.jpg');
        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getIndexedFolderCoverPath: () => undefined,
            getLibraryFolderCoverPath,
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: async () => ({}),
            registerObjectUrl: vi.fn(),
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        service.setFolderCoverPath(track.folderPath, '/music/library/cover.jpg');

        await service.resolveForTrack(track);
        service.invalidateResolvedForTrack(track);
        await service.resolveForTrack(track);

        expect(getLibraryFolderCoverPath).not.toHaveBeenCalled();
        expect(readImageThumbnail).toHaveBeenCalledTimes(2);
    });

    it('uses indexed folder cover paths before falling back to the backend lookup', async () => {
        const getLibraryFolderCoverPath = vi.fn(async () => '/music/library/backend-cover.jpg');
        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getIndexedFolderCoverPath: (folderPath: string) => folderPath === 'Library/Artist/Album'
                ? '/music/library/indexed-cover.jpg'
                : undefined,
            getLibraryFolderCoverPath,
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: async () => ({}),
            registerObjectUrl: vi.fn(),
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        const coverUrl = await service.resolveForTrack(track);

        expect(coverUrl).toBe('blob:test-cover-art');
        expect(getLibraryFolderCoverPath).not.toHaveBeenCalled();
        expect(readImageThumbnail).toHaveBeenCalledWith('/music/library/indexed-cover.jpg', 512);
    });
});