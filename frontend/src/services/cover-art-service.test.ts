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
        expect(readImageThumbnail).toHaveBeenCalledWith('/music/library/cover.jpg', 960);
        expect(readFileBase64).not.toHaveBeenCalled();
    });
});