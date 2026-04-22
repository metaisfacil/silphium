import { afterEach, describe, expect, it, vi } from 'vitest';

const { readTextFileMock, audioWriteReplayGainTagsMock } = vi.hoisted(() => ({
    readTextFileMock: vi.fn(),
    audioWriteReplayGainTagsMock: vi.fn(),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    ReadTextFile: readTextFileMock,
    AudioWriteReplayGainTags: audioWriteReplayGainTagsMock,
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
        refreshTrack: vi.fn(async () => ({ updatedTags: false, updatedMusicBrainz: false })),
        refreshTrackTags: vi.fn(async () => undefined),
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
        title: 'Track',
        name: 'track.flac',
        path: '/music/Artist/Album/track.flac',
        relativePath: 'Library/Artist/Album/track.flac',
        folderPath: '/music/Artist/Album',
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
    replayGainReleaseTrackPathsForIndex: vi.fn(() => [
        '/music/Artist/Album/track.flac',
        '/music/Artist/Album/track-02.flac',
    ]),
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

    it('does not restart the background crossfade for the same cover image', () => {
        const context = createContext();
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        runtime.setBackgroundCover('/art/cover.jpg');
        const activeLayerAfterFirstApply = context.activeBackgroundLayer;
        const bgLayerAVisible = context.bgLayerA.classList.contains('is-visible');
        const bgLayerBVisible = context.bgLayerB.classList.contains('is-visible');

        runtime.setBackgroundCover('/art/cover.jpg');

        expect(context.activeBackgroundLayer).toBe(activeLayerAfterFirstApply);
        expect(context.bgLayerA.classList.contains('is-visible')).toBe(bgLayerAVisible);
        expect(context.bgLayerB.classList.contains('is-visible')).toBe(bgLayerBVisible);
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
        ], 0, context.coverArt);
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
            context.coverArt,
        );
        expect(context.imageModalController.openGallery).not.toHaveBeenCalled();
    });

    it('keeps the manual ReplayGain write option hidden in the technical-info modal', async () => {
        const context = createContext();
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        await runtime.openTechnicalInfoModal();

        expect(context.ensureTrackTagsResolved).toHaveBeenCalledWith(0);
        expect(context.trackMetadataService.refreshTrackTags).toHaveBeenCalledWith(['/music/Artist/Album/track.flac']);
        expect(context.refreshNowPlayingLabel).toHaveBeenCalledTimes(1);
        expect(context.libraryController.renderFolder).toHaveBeenCalledWith('none');
        const actionButton = context.technicalInfoContent.querySelector('.technical-info-action-btn');
        expect(actionButton).toBeNull();
        expect(audioWriteReplayGainTagsMock).not.toHaveBeenCalled();
    });

    it('does not force-refresh file tags when opening technical info for a remote track', async () => {
        const context = createContext();
        context.tracks[0] = {
            ...context.tracks[0],
            path: 'silphium-remote://friend:41637/Library/Artist/Album/track.flac',
        };
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        await runtime.openTechnicalInfoModal();

        expect(context.ensureTrackTagsResolved).toHaveBeenCalledWith(0);
        expect(context.trackMetadataService.refreshTrackTags).not.toHaveBeenCalled();
        expect(context.refreshNowPlayingLabel).not.toHaveBeenCalled();
        expect(context.libraryController.renderFolder).not.toHaveBeenCalled();
    });

    it('force-refreshes local current-track metadata when hydrating the now-playing track', async () => {
        const context = createContext();
        context.trackMetadataService.refreshTrack.mockResolvedValue({ updatedTags: true, updatedMusicBrainz: false });
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        await runtime.hydrateCurrentTrackTag(0, 1);

        expect(context.trackMetadataService.refreshTrack).toHaveBeenCalledWith(0, 1);
        expect(context.trackMetadataService.hydrateTrack).not.toHaveBeenCalled();
        expect(context.refreshNowPlayingLabel).toHaveBeenCalledTimes(1);
        expect(context.libraryController.renderFolder).toHaveBeenCalledWith('none');
        expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0);
    });

    it('renders refreshed file technical details and all file tags when the modal opens', async () => {
        const context = createContext();
        context.trackMetadataService.refreshTrackTags.mockImplementation(async () => {
            context.tracks[0] = {
                ...context.tracks[0],
                displayTechnical: '24/96 • FLAC',
                technicalDetails: {
                    codec: 'FLAC',
                    bitDepth: 24,
                    sampleRate: 96000,
                    fileSizeBytes: 123456789,
                },
                allFileTags: {
                    ARTIST: ['File Artist'],
                    CUSTOM: ['Value One', 'Value Two'],
                },
            };
        });
        const runtime = createAppModalRuntime(context as unknown as AppModalRuntimeContext);

        await runtime.openTechnicalInfoModal();

        expect(context.technicalInfoContent.textContent).toContain('Codec');
        expect(context.technicalInfoContent.textContent).toContain('FLAC');
        expect(context.technicalInfoContent.textContent).toContain('All file tags');
        expect(context.technicalInfoContent.textContent).toContain('ARTIST');
        expect(context.technicalInfoContent.textContent).toContain('File Artist');
        expect(context.technicalInfoContent.textContent).toContain('CUSTOM');
        expect(context.technicalInfoContent.textContent).toContain('Value One');
        expect(context.technicalInfoContent.textContent).toContain('Value Two');
    });
});