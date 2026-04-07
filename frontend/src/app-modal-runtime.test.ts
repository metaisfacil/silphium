import { afterEach, describe, expect, it, vi } from 'vitest';

const { readTextFileMock } = vi.hoisted(() => ({
    readTextFileMock: vi.fn(),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    ReadTextFile: readTextFileMock,
}));

import { createAppModalRuntime } from './app-modal-runtime';
import type { AppModalRuntimeContext } from './app-runtime-setup';

const createContext = () => ({
    artistInfoController: {
        reset: vi.fn(),
        hydrate: vi.fn(async () => undefined),
    },
    activeBackgroundLayer: 0,
    bgLayerA: document.createElement('div'),
    bgLayerB: document.createElement('div'),
    trackMetadataService: {
        hydrateTrack: vi.fn(async () => ({ updatedTags: false, updatedMusicBrainz: false })),
    },
    currentTrackIndex: 0,
    refreshNowPlayingLabel: vi.fn(),
    libraryController: {
        renderFolder: vi.fn(),
    },
    applyCoverArtForTrack: vi.fn(async () => undefined),
    artistInfoRequestVersion: 0,
    textFileModal: Object.assign(document.createElement('div'), { hidden: true }),
    textFileTitle: document.createElement('div'),
    textFileCode: document.createElement('pre'),
    coverArt: Object.assign(document.createElement('img'), { src: '/cover/current.jpg' }),
    tracks: [{
        path: '/music/Artist/Album/track.flac',
        folderPath: '/music/Artist/Album',
    }],
    coverArtService: {
        getResolvedSourceForTrack: vi.fn(() => 'file'),
        getMusicBrainzCoverUrlForTrack: vi.fn(() => 'https://coverartarchive.org/release/front.jpg'),
        getFolderCoverPath: vi.fn(() => '/music/Artist/Album/front.jpg'),
    },
    imageModalController: {
        openPreview: vi.fn(),
        openGallery: vi.fn(async () => undefined),
    },
    collectReleaseImageFiles: vi.fn(() => [{ path: '/music/Artist/Album/front.jpg' }]),
    indexOfImageByPath: vi.fn(() => 0),
    aboutModal: Object.assign(document.createElement('div'), { hidden: true }),
    aboutModalHideTimer: undefined,
    aboutModalTransitionMs: 180,
    errorModal: Object.assign(document.createElement('div'), { hidden: true }),
    errorTitle: document.createElement('div'),
    errorModalMessage: document.createElement('div'),
    errorModalHideTimer: undefined,
    errorModalTransitionMs: 180,
    musicBrainzEntityModal: Object.assign(document.createElement('div'), { hidden: true }),
    musicBrainzEntityDialog: document.createElement('div'),
    musicBrainzEntityTitle: document.createElement('div'),
    musicBrainzEntityContent: document.createElement('div'),
    musicBrainzEntityModalHideTimer: undefined,
    musicBrainzEntityModalTransitionMs: 180,
    ensureTrackTagsResolved: vi.fn(async () => undefined),
    technicalInfoModal: Object.assign(document.createElement('div'), { hidden: true }),
    technicalInfoTitle: document.createElement('div'),
    technicalInfoContent: document.createElement('div'),
    technicalInfoModalHideTimer: undefined,
    technicalInfoModalTransitionMs: 180,
});

describe('createAppModalRuntime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('swaps the visible background layer and clears both layers when cover art is removed', () => {
        const context = createContext();
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        runtime.setBackgroundCover('/art/cover.jpg');

        expect(context.bgLayerB.style.backgroundImage).toContain('/art/cover.jpg');
        expect(context.bgLayerB.classList.contains('is-visible')).toBe(true);
        expect(context.activeBackgroundLayer).toBe(1);

        runtime.setBackgroundCover();

        expect(context.bgLayerA.classList.contains('is-visible')).toBe(false);
        expect(context.bgLayerB.classList.contains('is-visible')).toBe(false);
        expect(context.bgLayerA.style.backgroundImage).toBe('');
        expect(context.bgLayerB.style.backgroundImage).toBe('');
    });

    it('loads text file content into the modal and shows a fallback on read failure', async () => {
        const context = createContext();
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        readTextFileMock.mockResolvedValueOnce('Track notes');
        await runtime.openTextFileModal({
            path: '/music/Artist/Album/notes.txt',
            relativePath: 'Library/Artist/Album/notes.txt',
            folderPath: '/music/Artist/Album',
            rootPath: '/music',
            rootName: 'Library',
            name: 'notes.txt',
        });

        expect(context.textFileModal.hidden).toBe(false);
        expect(context.textFileTitle.textContent).toBe('Library/Artist/Album/notes.txt');
        expect(context.textFileCode.textContent).toBe('Track notes');

        readTextFileMock.mockRejectedValueOnce(new Error('missing'));
        await runtime.openTextFileModal({
            path: '/music/Artist/Album/missing.txt',
            relativePath: '',
            folderPath: '/music/Artist/Album',
            rootPath: '/music',
            rootName: 'Library',
            name: 'missing.txt',
        });

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(context.textFileTitle.textContent).toBe('missing.txt');
        expect(context.textFileCode.textContent).toBe('Unable to read this file.');
    });

    it('opens the release gallery when cover art comes from a release image file', () => {
        const context = createContext();
        context.coverArt.classList.add('is-visible');
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        runtime.openCoverImageModal();

        expect(context.imageModalController.openGallery).toHaveBeenCalledWith([
            { path: '/music/Artist/Album/front.jpg' },
        ], 0);
        expect(context.imageModalController.openPreview).not.toHaveBeenCalled();
    });

    it('opens a direct preview when the resolved cover source is embedded artwork', () => {
        const context = createContext();
        context.coverArt.classList.add('is-visible');
        context.coverArtService.getResolvedSourceForTrack.mockReturnValue('embedded');
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        runtime.openCoverImageModal();

        expect(context.imageModalController.openPreview).toHaveBeenCalledWith(
            context.coverArt.src,
            '/music/Artist/Album/track.flac',
        );
        expect(context.imageModalController.openGallery).not.toHaveBeenCalled();
    });
});