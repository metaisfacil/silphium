import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    blobToBase64Mock,
    canvasToPngBlobMock,
    deriveShareImageAccentPaletteMock,
    loadShareCanvasImageMock,
    renderShareImagePreviewMock,
} = vi.hoisted(() => ({
    blobToBase64Mock: vi.fn(),
    canvasToPngBlobMock: vi.fn(),
    deriveShareImageAccentPaletteMock: vi.fn(),
    loadShareCanvasImageMock: vi.fn(),
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

vi.mock('../utils/display-helpers', () => ({
    blobToBase64: blobToBase64Mock,
    buildShareImageDefaultFilename: vi.fn(() => 'share-image.png'),
}));

import { createShareController } from './share-controller';
import type { Track } from '../types/app-types';

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

const createElements = () => {
    const sharePreview = document.createElement('canvas');
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

    return {
        shareModal: document.createElement('div') as HTMLDivElement,
        shareBackdrop: document.createElement('div'),
        shareDialog: document.createElement('div'),
        shareClose: document.createElement('button'),
        sharePreview,
        shareCommentInput: document.createElement('textarea'),
        shareStatus: document.createElement('p'),
        shareSave: document.createElement('button'),
        shareCopy: document.createElement('button'),
    };
};

describe('share-controller', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        canvasToPngBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
        blobToBase64Mock.mockResolvedValue('encoded-png');
        loadShareCanvasImageMock.mockResolvedValue({ close: vi.fn() });
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
        const elements = createElements();
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
            copyShareImageToClipboard,
            fetchVisualizationFrame: vi.fn(async () => ({
                loaded: false,
                playing: false,
                sourcePath: '',
                sampleRate: 0,
                channelCount: 0,
                frameCount: 0,
                sampleStride: 0,
                peak: 0,
                samples: [],
            })),
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
        const elements = createElements();
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
            copyShareImageToClipboard,
            fetchVisualizationFrame: vi.fn(async () => ({
                loaded: false,
                playing: false,
                sourcePath: '',
                sampleRate: 0,
                channelCount: 0,
                frameCount: 0,
                sampleStride: 0,
                peak: 0,
                samples: [],
            })),
        });

        await controller.open();
        await controller.copyPreview();

        expect(copyShareImageToClipboard).toHaveBeenCalledWith('encoded-png');
        expect(elements.shareStatus.textContent).toBe('Unable to copy the share image.');
        expect(elements.shareStatus.dataset.tone).toBe('error');
        consoleErrorSpy.mockRestore();
    });
});