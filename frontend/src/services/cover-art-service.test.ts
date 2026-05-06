import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCoverArtService } from './cover-art-service';
import type { Track } from '../types/app-types';

describe('createCoverArtService', () => {
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const originalImage = globalThis.Image;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        URL.createObjectURL = vi.fn(() => 'blob:test-cover-art');
        URL.revokeObjectURL = vi.fn();
        vi.stubGlobal('Image', class MockImage {
            onload: null | (() => void) = null;
            onerror: null | (() => void) = null;

            set src(_value: string) {
                queueMicrotask(() => {
                    this.onload?.();
                });
            }
        });
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectUrl;
        URL.revokeObjectURL = originalRevokeObjectUrl;
        vi.stubGlobal('Image', originalImage);
        vi.stubGlobal('fetch', originalFetch);
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

    it('prefers internal loopback URLs for folder covers when available', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            blob: async () => new Blob(['folder-cover'], { type: 'image/png' }),
            headers: {
                get: () => 'image/png',
            },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));
        const registerObjectUrl = vi.fn();

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getInternalCoverArtConfig: async () => ({
                baseUrl: 'http://127.0.0.1:4041',
                token: 'secret-token',
            }),
            getIndexedFolderCoverPath: () => '/music/library/cover.jpg',
            getLibraryFolderCoverPath: async () => '/music/library/cover.jpg',
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: vi.fn(async () => ({})),
            registerObjectUrl,
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            relativePath: 'Library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        const coverUrl = await service.resolveForTrack(track);
        const firstFetchCall = fetchMock.mock.calls[0] as unknown[] | undefined;
        const firstFetchUrl = String(firstFetchCall?.[0] ?? '');

        expect(coverUrl).toBe('blob:test-cover-art');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(firstFetchUrl).toContain('http://127.0.0.1:4041/internal/cover?');
        expect(firstFetchUrl).toContain('token=secret-token');
        expect(firstFetchUrl).toContain('size=512');
        expect(registerObjectUrl).toHaveBeenCalledWith('blob:test-cover-art');
        expect(readImageThumbnail).not.toHaveBeenCalled();
    });

    it('prefers internal loopback URLs for embedded covers when available', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true,
            blob: async () => new Blob(['embedded-cover'], { type: 'image/jpeg' }),
            headers: {
                get: () => 'image/jpeg',
            },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const readTrackEmbeddedCover = vi.fn(async () => ({
            base64: 'ZmFrZS1lbWJlZGRlZA==',
            mimeType: 'image/jpeg',
        }));
        const registerObjectUrl = vi.fn();

        const service = createCoverArtService({
            getCoverArtPriority: () => ['embedded'],
            getInternalCoverArtConfig: async () => ({
                baseUrl: 'http://127.0.0.1:4041',
                token: 'secret-token',
            }),
            getIndexedFolderCoverPath: () => undefined,
            getLibraryFolderCoverPath: async () => '',
            readImageThumbnail: vi.fn(async () => ({
                base64: 'ZmFrZS10aHVtYm5haWw=',
                mimeType: 'image/png',
            })),
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover,
            registerObjectUrl,
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            relativePath: 'Library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        const coverUrl = await service.resolveForTrack(track);
        const firstFetchCall = fetchMock.mock.calls[0] as unknown[] | undefined;
        const firstFetchUrl = String(firstFetchCall?.[0] ?? '');

        expect(coverUrl).toBe('blob:test-cover-art');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(firstFetchUrl).toContain('http://127.0.0.1:4041/internal/cover?');
        expect(firstFetchUrl).toContain('token=secret-token');
        expect(registerObjectUrl).toHaveBeenCalledWith('blob:test-cover-art');
        expect(readTrackEmbeddedCover).not.toHaveBeenCalled();
    });

    it('falls back to bridge thumbnails and disables internal loopback after repeated failures', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('loopback fetch failed');
        });
        vi.stubGlobal('fetch', fetchMock);

        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getInternalCoverArtConfig: async () => ({
                baseUrl: 'http://127.0.0.1:4041',
                token: 'secret-token',
            }),
            getIndexedFolderCoverPath: (folderPath: string) => `/music/${folderPath}/cover.jpg`,
            getLibraryFolderCoverPath: async () => '',
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: vi.fn(async () => ({})),
            registerObjectUrl: vi.fn(),
        });

        const firstTrack = {
            path: '/music/library/Artist/Album 1/01 Track.flac',
            relativePath: 'Library/Artist/Album 1/01 Track.flac',
            folderPath: 'Library/Artist/Album 1',
            mbIds: {},
        } as Track;
        const secondTrack = {
            path: '/music/library/Artist/Album 2/01 Track.flac',
            relativePath: 'Library/Artist/Album 2/01 Track.flac',
            folderPath: 'Library/Artist/Album 2',
            mbIds: {},
        } as Track;
        const thirdTrack = {
            path: '/music/library/Artist/Album 3/01 Track.flac',
            relativePath: 'Library/Artist/Album 3/01 Track.flac',
            folderPath: 'Library/Artist/Album 3',
            mbIds: {},
        } as Track;

        expect(await service.resolveForTrack(firstTrack)).toBe('blob:test-cover-art');
        expect(await service.resolveForTrack(secondTrack)).toBe('blob:test-cover-art');
        expect(await service.resolveForTrack(thirdTrack)).toBe('blob:test-cover-art');

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(readImageThumbnail).toHaveBeenCalledTimes(3);
    });

    it('falls back to bridge thumbnails when the internal loopback fetch hangs', async () => {
        vi.useFakeTimers();

        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new Error('loopback fetch aborted'));
                }, { once: true });
            });
        });
        vi.stubGlobal('fetch', fetchMock as typeof fetch);

        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));

        const service = createCoverArtService({
            getCoverArtPriority: () => ['file'],
            getInternalCoverArtConfig: async () => ({
                baseUrl: 'http://127.0.0.1:4041',
                token: 'secret-token',
            }),
            getIndexedFolderCoverPath: () => '/music/library/cover.jpg',
            getLibraryFolderCoverPath: async () => '/music/library/cover.jpg',
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover: vi.fn(async () => ({})),
            registerObjectUrl: vi.fn(),
        });

        const track = {
            path: '/music/library/Artist/Album/01 Track.flac',
            relativePath: 'Library/Artist/Album/01 Track.flac',
            folderPath: 'Library/Artist/Album',
            mbIds: {},
        } as Track;

        const coverUrlPromise = service.resolveForTrack(track);
        await vi.advanceTimersByTimeAsync(3000);

        await expect(coverUrlPromise).resolves.toBe('blob:test-cover-art');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(readImageThumbnail).toHaveBeenCalledWith('/music/library/cover.jpg', 512);

        vi.useRealTimers();
    });

    it('does not disable internal loopback after repeated cover misses', async () => {
        const fetchMock = vi
            .fn()
            .mockImplementationOnce(async () => ({
                ok: false,
                blob: async () => new Blob([], { type: 'image/jpeg' }),
                headers: {
                    get: () => 'image/jpeg',
                },
            }))
            .mockImplementationOnce(async () => ({
                ok: false,
                blob: async () => new Blob([], { type: 'image/jpeg' }),
                headers: {
                    get: () => 'image/jpeg',
                },
            }))
            .mockImplementationOnce(async () => ({
                ok: true,
                blob: async () => new Blob(['folder-cover'], { type: 'image/png' }),
                headers: {
                    get: () => 'image/png',
                },
            }));
        vi.stubGlobal('fetch', fetchMock);

        const readImageThumbnail = vi.fn(async () => ({
            base64: 'ZmFrZS10aHVtYm5haWw=',
            mimeType: 'image/png',
        }));
        const readTrackEmbeddedCover = vi.fn(async () => ({}));
        const registerObjectUrl = vi.fn();
        let priority: Array<'file' | 'embedded'> = ['embedded', 'file'];

        const service = createCoverArtService({
            getCoverArtPriority: () => priority,
            getInternalCoverArtConfig: async () => ({
                baseUrl: 'http://127.0.0.1:4041',
                token: 'secret-token',
            }),
            getIndexedFolderCoverPath: (folderPath: string) => folderPath === 'Library/Artist/Album 3'
                ? '/music/library/Artist/Album 3/cover.jpg'
                : undefined,
            getLibraryFolderCoverPath: async () => '',
            readImageThumbnail,
            readFileBase64: vi.fn(async () => 'ZmFrZS1mdWxsLWltYWdl'),
            readTrackEmbeddedCover,
            registerObjectUrl,
        });

        const firstTrack = {
            path: '/music/library/Artist/Album 1/01 Track.flac',
            relativePath: 'Library/Artist/Album 1/01 Track.flac',
            folderPath: 'Library/Artist/Album 1',
            mbIds: {},
        } as Track;
        const secondTrack = {
            path: '/music/library/Artist/Album 2/01 Track.flac',
            relativePath: 'Library/Artist/Album 2/01 Track.flac',
            folderPath: 'Library/Artist/Album 2',
            mbIds: {},
        } as Track;

        expect(await service.resolveForTrack(firstTrack)).toBeUndefined();
        expect(await service.resolveForTrack(secondTrack)).toBeUndefined();
        expect(readTrackEmbeddedCover).toHaveBeenCalledTimes(2);

        priority = ['file'];
        const thirdTrack = {
            path: '/music/library/Artist/Album 3/01 Track.flac',
            relativePath: 'Library/Artist/Album 3/01 Track.flac',
            folderPath: 'Library/Artist/Album 3',
            mbIds: {},
        } as Track;

        expect(await service.resolveForTrack(thirdTrack)).toBe('blob:test-cover-art');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(readImageThumbnail).not.toHaveBeenCalled();
        expect(registerObjectUrl).toHaveBeenCalledWith('blob:test-cover-art');
    });
});