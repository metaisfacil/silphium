import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlaylistMenuElements, renderPlaylistMenu } from '../components/overlays/playlist-menu';
import { getPlaylistModalElements, renderPlaylistModal } from '../components/overlays/playlist-modal';
import type { PlaylistTrackView } from './playlist-controller';
import { createPlaylistController } from './playlist-controller';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const createTrackView = (index: number): PlaylistTrackView => ({
    displayTitle: `Track ${index}`,
    name: `Track ${index}`,
    displayArtist: `Artist ${index}`,
    tagsResolved: true,
});

const mountPlaylistController = () => {
    document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
    const trigger = document.createElement('button');
    document.body.append(trigger);

    const menu = getPlaylistMenuElements(document);
    const modal = getPlaylistModalElements(document);
    const trackViews = [createTrackView(0), createTrackView(1), createTrackView(2)];
    let currentTrackIndex = 0;
    let favoritePlaylists = ['/playlists/favorite.m3u8'];
    let selectedPlaylistPath = '';
    let selectedPlaylistSavePath = '';

    const onTrackChosen = vi.fn(async (trackIndex: number) => {
        currentTrackIndex = trackIndex;
    });
    const loadPlaylistData = vi.fn(async (playlistPath: string) => {
        if (playlistPath.endsWith('demo.m3u8')) {
            return { name: 'demo.m3u8', trackIndexes: [2, 1] };
        }

        if (playlistPath.endsWith('favorite.m3u8')) {
            return { name: 'favorite.m3u8', trackIndexes: [1, 0] };
        }

        if (playlistPath.endsWith('empty.m3u8')) {
            return { name: 'empty.m3u8', trackIndexes: [] };
        }

        return null;
    });
    const appendTracksToPlaylistData = vi.fn(async () => true);
    const savePlaylistData = vi.fn(async () => true);

    const controller = createPlaylistController({
        trigger,
        menu,
        modal,
        getTrack: (index: number) => trackViews[index],
        getTrackPath: (index: number) => `/music/track-${index}.flac`,
        getTrackCount: () => trackViews.length,
        getCurrentTrackIndex: () => currentTrackIndex,
        getPlaybackOrderLabel: () => 'Ordered',
        getBaseSequence: () => ({
            indexes: [0, 1, 2],
            currentPosition: Math.max(0, [0, 1, 2].indexOf(currentTrackIndex)),
        }),
        ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
        selectPlaylistFile: vi.fn(async () => selectedPlaylistPath),
        selectPlaylistSaveFile: vi.fn(async () => selectedPlaylistSavePath),
        loadPlaylistData,
        savePlaylistData,
        appendTracksToPlaylistData,
        getFavoritePlaylists: () => favoritePlaylists,
        onTrackChosen,
        onExternalPlaylistLoaded: vi.fn(() => undefined),
    });

    return {
        controller,
        elements: modal,
        appendTracksToPlaylistData,
        loadPlaylistData,
        onTrackChosen,
        savePlaylistData,
        setSelectedPlaylistPath: (nextPath: string) => {
            selectedPlaylistPath = nextPath;
        },
        setSelectedPlaylistSavePath: (nextPath: string) => {
            selectedPlaylistSavePath = nextPath;
        },
        setFavoritePlaylists: (nextFavoritePlaylists: string[]) => {
            favoritePlaylists = nextFavoritePlaylists;
        },
    };
};

describe('createPlaylistController', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('loads an external playlist and commits it into the queue view when a track is chosen', async () => {
        const { controller, elements, onTrackChosen } = mountPlaylistController();

        const loaded = await controller.loadPlaylistByPath('/playlists/demo.m3u8');

        expect(loaded).toBe(true);
        expect(elements.playlistModal.hidden).toBe(false);
        expect(elements.playlistSource.value).toBe('playlist');
        expect(controller.getSequenceOverride()).toEqual({ indexes: [2, 1], currentPosition: 0 });

        const playlistTrackButton = elements.playlistList.querySelector('[data-playlist-track-index="1"]') as HTMLButtonElement | null;
        expect(playlistTrackButton).not.toBeNull();
        playlistTrackButton?.click();
        await flushPromises();

        elements.playlistSource.value = 'queue';
        elements.playlistSource.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onTrackChosen).toHaveBeenLastCalledWith(1);
        expect(controller.getSequenceOverride()).toEqual({ indexes: [2, 1], currentPosition: 1 });
    });

    it('switches to a favorite playlist from the source selector and resets back to the queue state', async () => {
        const { controller, elements, loadPlaylistData } = mountPlaylistController();

        controller.openModal();

        const firstQueueTrackButton = elements.playlistList.querySelector('[data-playlist-track-index]') as HTMLButtonElement | null;
        expect(firstQueueTrackButton?.dataset.playlistTrackIndex).toBe('0');

        elements.playlistSource.value = 'favorite:0';
        elements.playlistSource.dispatchEvent(new Event('change', { bubbles: true }));
        await flushPromises();

        expect(loadPlaylistData).toHaveBeenCalledWith('/playlists/favorite.m3u8');
        expect(elements.playlistSource.value).toBe('favorite:0');

        const firstFavoriteTrackButton = elements.playlistList.querySelector('[data-playlist-track-index]') as HTMLButtonElement | null;
        expect(firstFavoriteTrackButton?.dataset.playlistTrackIndex).toBe('1');

        controller.resetState();
        controller.refreshOpenModal();

        expect(controller.getSequenceOverride()).toBeNull();
        expect(elements.playlistSource.value).toBe('queue');
    });

    it('lists playlist targets without the queue and appends to the loaded playlist state', async () => {
        const { controller, appendTracksToPlaylistData } = mountPlaylistController();

        expect(controller.getAvailablePlaylistTargets()).toEqual([
            { path: '/playlists/favorite.m3u8', label: 'favorite.m3u8' },
        ]);

        const loaded = await controller.loadPlaylistByPath('/playlists/demo.m3u8');

        expect(loaded).toBe(true);
        expect(controller.getAvailablePlaylistTargets()).toEqual([
            { path: '/playlists/favorite.m3u8', label: 'favorite.m3u8' },
            { path: '/playlists/demo.m3u8', label: 'demo.m3u8' },
        ]);

        const appended = await controller.appendTracksToPlaylist('/playlists/demo.m3u8', [0, 2, 99]);

        expect(appended).toBe(true);
        expect(appendTracksToPlaylistData).toHaveBeenCalledWith('/playlists/demo.m3u8', [
            '/music/track-0.flac',
            '/music/track-2.flac',
        ]);
        expect(controller.getSequenceOverride()).toEqual({ indexes: [2, 1, 0, 2], currentPosition: 0 });
    });

    it('loads empty playlists without forcing playback and keeps them available as targets', async () => {
        const { controller, elements, onTrackChosen } = mountPlaylistController();

        const loaded = await controller.loadPlaylistByPath('/playlists/empty.m3u8');

        expect(loaded).toBe(true);
        expect(onTrackChosen).not.toHaveBeenCalled();
        expect(elements.playlistModal.hidden).toBe(false);
        expect(elements.playlistSource.value).toBe('playlist');
        expect(elements.playlistList.textContent).toContain('No tracks available');
        expect(controller.getAvailablePlaylistTargets()).toContainEqual({ path: '/playlists/empty.m3u8', label: 'empty.m3u8' });
    });

    it('creates an empty playlist target and exposes it to the custom modal flow', async () => {
        const { controller, elements, savePlaylistData, setSelectedPlaylistSavePath } = mountPlaylistController();

        controller.openModal();
        setSelectedPlaylistSavePath('/playlists/new-empty.m3u8');

        const created = await controller.createPlaylistTarget();

        expect(savePlaylistData).toHaveBeenCalledWith('/playlists/new-empty.m3u8', []);
        expect(created).toEqual({ path: '/playlists/new-empty.m3u8', label: 'new-empty.m3u8' });
        expect(elements.playlistSource.value).toBe('playlist');
        expect(elements.playlistList.textContent).toContain('No tracks available');
    });

    it('opens a playlist target through the file picker flow', async () => {
        const { controller, setSelectedPlaylistPath } = mountPlaylistController();

        setSelectedPlaylistPath('/playlists/empty.m3u8');

        await expect(controller.openPlaylistTarget()).resolves.toEqual({ path: '/playlists/empty.m3u8', label: 'empty.m3u8' });
    });
});