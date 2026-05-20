import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    blobToBase64Mock,
    canvasToPngBlobMock,
    deriveShareImageAccentPaletteMock,
    loadShareCanvasImageMock,
    lookupMusicBrainzEntityMock,
    renderShareImagePreviewMock,
} = vi.hoisted(() => ({
    blobToBase64Mock: vi.fn(),
    canvasToPngBlobMock: vi.fn(),
    deriveShareImageAccentPaletteMock: vi.fn(),
    loadShareCanvasImageMock: vi.fn(),
    lookupMusicBrainzEntityMock: vi.fn(),
    renderShareImagePreviewMock: vi.fn(),
}));

vi.mock('../services/share-image-service', () => ({
    canvasToPngBlob: canvasToPngBlobMock,
    loadShareCanvasImage: loadShareCanvasImageMock,
    renderShareImagePreview: renderShareImagePreviewMock,
}));

vi.mock('../utils/cover-accent-palette', () => ({
    deriveShareImageAccentPalette: deriveShareImageAccentPaletteMock,
}));

vi.mock('../utils/musicbrainz-entity-helpers', () => ({
    faviconUrlForResource: vi.fn(() => undefined),
    lookupMusicBrainzEntity: lookupMusicBrainzEntityMock,
}));

vi.mock('../utils/display-helpers', () => ({
    blobToBase64: blobToBase64Mock,
    buildShareImageDefaultFilename: vi.fn(() => 'share-image.png'),
}));

import { createShareController } from './share-controller';
import type { ArtistExternalUrl, Track } from '../types/app-types';

const createTrack = (): Track => ({
    title: 'Track',
    name: 'Track',
    path: '/music/track.flac',
    relativePath: 'Library/track.flac',
    folderPath: 'Library',
    rootPath: '/music',
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
});

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const createElements = () => {
    const sharePreview = document.createElement('canvas');
    const shareStreamingLinksRegion = document.createElement('div');
    const shareStreamingLinks = document.createElement('div');
    const drawingContext = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        fillStyle: '',
        font: '',
        textAlign: 'center',
        textBaseline: 'middle',
    } as unknown as CanvasRenderingContext2D;

    Object.defineProperty(sharePreview, 'getContext', {
        configurable: true,
        value: vi.fn(() => drawingContext),
    });

    shareStreamingLinksRegion.hidden = true;
    shareStreamingLinksRegion.append(shareStreamingLinks);

    return {
        shareModal: document.createElement('div') as HTMLDivElement,
        shareBackdrop: document.createElement('div'),
        shareDialog: document.createElement('div'),
        shareClose: document.createElement('button'),
        sharePreview,
        shareStreamingLinksRegion,
        shareStreamingLinks,
        shareCommentInput: document.createElement('textarea'),
        shareStatus: document.createElement('p'),
        shareSave: document.createElement('button'),
        shareCopy: document.createElement('button'),
    };
};

const defaultVisualizationFrame = {
    loaded: false,
    playing: false,
    sourcePath: '',
    sampleRate: 0,
    channelCount: 0,
    frameCount: 0,
    sampleStride: 0,
    peak: 0,
    samples: [],
};

const createController = (
    track: Track,
    overrides: Partial<Parameters<typeof createShareController>[0]> = {},
) => {
    const elements = createElements();
    const controller = createShareController({
        elements,
        getCurrentTrack: () => ({ track, index: 0 }),
        ensureTrackTagsResolved: vi.fn(async () => undefined),
        trackIndexForPath: vi.fn(() => 0),
        getTrack: vi.fn(() => track),
        resolveCoverForTrack: vi.fn(async () => undefined),
        getCachedMediaArtwork: vi.fn(() => undefined),
        getCoverArtSrc: vi.fn(() => undefined),
        closeOtherMenus: vi.fn(),
        selectShareImageSaveFile: vi.fn(async () => ''),
        saveShareImageFile: vi.fn(async () => true),
        copyShareImageToClipboard: vi.fn(async () => true),
        lookupMusicBrainzRecordingURLs: vi.fn(async () => []),
        openUrl: vi.fn(async () => undefined),
        fetchVisualizationFrame: vi.fn(async () => defaultVisualizationFrame),
        ...overrides,
    });

    return { controller, elements };
};

const createDeferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

describe('share-controller', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        canvasToPngBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
        blobToBase64Mock.mockResolvedValue('encoded-png');
        loadShareCanvasImageMock.mockResolvedValue({ close: vi.fn() });
        lookupMusicBrainzEntityMock.mockResolvedValue({ tags: [] });
        renderShareImagePreviewMock.mockImplementation(() => undefined);
        deriveShareImageAccentPaletteMock.mockReturnValue({});
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('falls back to the backend clipboard copy when browser clipboard image writes fail', async () => {
        const track = createTrack();
        const browserWrite = vi.fn().mockRejectedValue(new Error('clipboard denied'));
        const copyShareImageToClipboard = vi.fn(async () => true);

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { write: browserWrite },
        });
        Object.defineProperty(window, 'ClipboardItem', {
            configurable: true,
            value: class ClipboardItemMock {
                constructor(readonly items: Record<string, Blob>) {
                    void items;
                }
            },
        });

        const { controller, elements } = createController(track, {
            copyShareImageToClipboard,
        });

        await controller.open();
        await controller.copyPreview();

        expect(browserWrite).toHaveBeenCalledTimes(1);
        expect(copyShareImageToClipboard).toHaveBeenCalledWith('encoded-png');
        expect(elements.shareStatus.textContent).toBe('Copied image to clipboard.');
        expect(elements.shareStatus.dataset.tone).toBe('success');
    });

    it('shows an error when browser and backend clipboard image copy both fail', async () => {
        const track = createTrack();
        const copyShareImageToClipboard = vi.fn(async () => false);

        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {},
        });
        Object.defineProperty(window, 'ClipboardItem', {
            configurable: true,
            value: undefined,
        });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { controller, elements } = createController(track, {
            copyShareImageToClipboard,
        });

        await controller.open();
        await controller.copyPreview();

        expect(copyShareImageToClipboard).toHaveBeenCalledWith('encoded-png');
        expect(elements.shareStatus.textContent).toBe('Unable to copy the share image.');
        expect(elements.shareStatus.dataset.tone).toBe('error');
        consoleErrorSpy.mockRestore();
    });

    it('loads streaming links asynchronously without blocking the modal opening', async () => {
        const track = createTrack();
        track.mbIds.recordingId = '99999999-9999-4999-8999-999999999999';
        const lookupDeferred = createDeferred<ArtistExternalUrl[]>();
        const { controller, elements } = createController(track, {
            lookupMusicBrainzRecordingURLs: vi.fn(() => lookupDeferred.promise),
        });

        void controller.open();

        await flushPromises();
        expect(elements.shareModal.hidden).toBe(false);
        expect(elements.shareStreamingLinksRegion.hidden).toBe(true);

        lookupDeferred.resolve([
            { type: 'streaming', resource: 'https://open.spotify.com/track/example' },
            { type: 'official homepage', resource: 'https://example.com' },
        ]);
        await flushPromises();
        await flushPromises();

        expect(elements.shareStreamingLinksRegion.hidden).toBe(false);
        expect(elements.shareStreamingLinks.querySelectorAll('.artist-link-btn')).toHaveLength(1);
    });

    it('prefers local genre and style tags when rendering the share preview', async () => {
        const track = createTrack();
        track.allFileTags = {
            GENRE: ['Electronic; Ambient'],
            STYLE: ['Synthwave', 'Ambient'],
        };

        const { controller } = createController(track);

        await controller.open();

        expect(lookupMusicBrainzEntityMock).not.toHaveBeenCalled();
        expect(renderShareImagePreviewMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            genres: ['Electronic', 'Ambient', 'Synthwave'],
        }));
    });

    it('falls back to MusicBrainz recording tags when file tags do not provide genres', async () => {
        const track = createTrack();
        track.mbIds.recordingId = '99999999-9999-4999-8999-999999999999';
        lookupMusicBrainzEntityMock.mockResolvedValue({
            found: true,
            entityType: 'recording',
            mbid: track.mbIds.recordingId,
            title: 'Track',
            subtitle: '',
            summary: '',
            facts: [],
            tags: ['Darkwave', 'Post-punk', 'Darkwave'],
            urls: [],
            rawJson: '{}',
        });

        const { controller } = createController(track);

        await controller.open();

        expect(lookupMusicBrainzEntityMock).toHaveBeenCalledWith('recording', track.mbIds.recordingId);
        expect(renderShareImagePreviewMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            genres: ['Darkwave', 'Post-punk'],
        }));
    });

    it('offers copy link and copy all actions for share-modal streaming links', async () => {
        const track = createTrack();
        track.mbIds.recordingId = 'abababab-abab-4bab-8bab-abababababab';
        const clipboardWriteText = vi.fn(async () => undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWriteText },
        });

        const { controller, elements } = createController(track, {
            lookupMusicBrainzRecordingURLs: vi.fn(async () => [
                { type: 'streaming', resource: 'https://open.spotify.com/track/example' },
                { type: 'apple music', resource: 'https://music.apple.com/album/example' },
            ]),
        });

        await controller.open();
        await flushPromises();

        const firstLink = elements.shareStreamingLinks.querySelector<HTMLButtonElement>('.artist-link-btn');
        expect(firstLink).not.toBeNull();

        firstLink?.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 40,
            clientY: 60,
        }));

        const menuItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.artist-info-links-context-menu-item'));
        expect(menuItems.map((item) => item.textContent)).toEqual(['Copy link', 'Copy all']);

        menuItems[0]?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        }));
        await flushPromises();
        expect(clipboardWriteText).toHaveBeenNthCalledWith(1, 'https://open.spotify.com/track/example');

        firstLink?.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 45,
            clientY: 65,
        }));

        Array.from(document.querySelectorAll<HTMLButtonElement>('.artist-info-links-context-menu-item'))[1]?.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        }));
        await flushPromises();
        expect(clipboardWriteText).toHaveBeenNthCalledWith(2, [
            'https://open.spotify.com/track/example',
            'https://music.apple.com/album/example',
        ].join('\n'));
    });
});