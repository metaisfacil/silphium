import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlaylistMenuElements, renderPlaylistMenu } from '../components/overlays/playlist-menu';
import { getPlaylistModalElements, renderPlaylistModal } from '../components/overlays/playlist-modal';
import type { LoadedPlaylistData, PlaylistTrackView } from './playlist-controller';
import { createPlaylistController } from './playlist-controller';
import { createPlaylistControllerState, type PlaylistControllerState } from './playlist-controller-state';

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

const mountPlaylistController = (options: { state?: PlaylistControllerState } = {}) => {
    document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
    const trigger = document.createElement('button');
    document.body.append(trigger);

    const menu = getPlaylistMenuElements(document);
    const modal = getPlaylistModalElements(document);
    const trackViews = [createTrackView(0), createTrackView(1), createTrackView(2)];
    let currentTrackIndex = 0;
    let favoritePlaylists = ['/playlists/favorite.m3u8'];
    let listenHistoryEnabled = true;
    let selectedPlaylistPath = '';
    let selectedPlaylistSavePath = '';

    const onTrackChosen = vi.fn(async (trackIndex: number) => {
        currentTrackIndex = trackIndex;
    });
    const loadPlaylistData = vi.fn(async (playlistPath: string): Promise<LoadedPlaylistData | null> => {
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
    const loadListenHistoryData = vi.fn(async () => ({
        name: 'Listen History',
        trackIndexes: [2, 0],
        historyItems: [
            { listenedAt: 1_699_963_200 },
            { listenedAt: 1_698_840_000 },
        ],
    }));
    const ensureTrackTagsResolvedBatch = vi.fn(async () => undefined);
    const savePlaylistTrackMetadataCache = vi.fn(async () => true);
    const savePlaylistData = vi.fn(async () => true);

    const controller = createPlaylistController({
        trigger,
        menu,
        modal,
        state: options.state,
        getTrack: (index: number) => trackViews[index],
        getTrackPath: (index: number) => `/music/track-${index}.flac`,
        getTrackCount: () => trackViews.length,
        getCurrentTrackIndex: () => currentTrackIndex,
        getPlaybackOrderLabel: () => 'Ordered',
        getBaseSequence: () => ({
            indexes: [0, 1, 2],
            currentPosition: Math.max(0, [0, 1, 2].indexOf(currentTrackIndex)),
        }),
        ensureTrackTagsResolvedBatch,
        selectPlaylistFile: vi.fn(async () => selectedPlaylistPath),
        selectPlaylistSaveFile: vi.fn(async () => selectedPlaylistSavePath),
        loadListenHistoryData,
        loadPlaylistData,
        savePlaylistTrackMetadataCache,
        savePlaylistData,
        appendTracksToPlaylistData,
        getFavoritePlaylists: () => favoritePlaylists,
        hasListenHistoryPlaylist: () => listenHistoryEnabled,
        onTrackChosen,
        onExternalPlaylistLoaded: vi.fn(() => undefined),
    });

    return {
        controller,
        elements: modal,
        appendTracksToPlaylistData,
        ensureTrackTagsResolvedBatch,
        loadListenHistoryData,
        loadPlaylistData,
        onTrackChosen,
        savePlaylistTrackMetadataCache,
        savePlaylistData,
        setListenHistoryEnabled: (enabled: boolean) => {
            listenHistoryEnabled = enabled;
        },
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
        const { controller, elements, onTrackChosen, savePlaylistTrackMetadataCache } = mountPlaylistController();

        const loaded = await controller.loadPlaylistByPath('/playlists/demo.m3u8');
        await flushPromises();

        expect(loaded).toBe(true);
        expect(elements.playlistModal.hidden).toBe(false);
        expect(elements.playlistSource.value).toBe('playlist');
        expect(controller.getSequenceOverride()).toBeNull();
        expect(onTrackChosen).not.toHaveBeenCalled();
        expect(savePlaylistTrackMetadataCache).toHaveBeenCalledWith([
            { trackPath: '/music/track-2.flac', trackName: 'Track 2', artistName: 'Artist 2' },
            { trackPath: '/music/track-1.flac', trackName: 'Track 1', artistName: 'Artist 1' },
        ]);

        const playlistTrackButton = elements.playlistList.querySelector('[data-playlist-track-index="1"]') as HTMLButtonElement | null;
        expect(playlistTrackButton).not.toBeNull();
        playlistTrackButton?.click();
        await flushPromises();

        elements.playlistSource.value = 'queue';
        elements.playlistSource.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onTrackChosen).toHaveBeenLastCalledWith(1, {
            source: 'playlist',
            userInitiated: true,
        });
        expect(controller.getSequenceOverride()).toEqual({ indexes: [2, 1], currentPosition: 1 });
    });

    it('switches to a favorite playlist from the source selector and resets back to the queue state', async () => {
        const { controller, elements, loadPlaylistData, onTrackChosen } = mountPlaylistController();

        controller.openModal();

        const firstQueueTrackButton = elements.playlistList.querySelector('[data-playlist-track-index]') as HTMLButtonElement | null;
        expect(firstQueueTrackButton?.dataset.playlistTrackIndex).toBe('0');

        elements.playlistSource.value = 'favorite:0';
        elements.playlistSource.dispatchEvent(new Event('change', { bubbles: true }));
        await flushPromises();

        expect(loadPlaylistData).toHaveBeenCalledWith('/playlists/favorite.m3u8');
        expect(elements.playlistSource.value).toBe('favorite:0');
        expect(onTrackChosen).not.toHaveBeenCalled();
        expect(elements.playlistList.classList.contains('is-view-switching')).toBe(true);

        const firstFavoriteTrackButton = elements.playlistList.querySelector('[data-playlist-track-index]') as HTMLButtonElement | null;
        expect(firstFavoriteTrackButton?.dataset.playlistTrackIndex).toBe('1');

        controller.resetState();
        controller.refreshOpenModal();

        expect(controller.getSequenceOverride()).toBeNull();
        expect(elements.playlistSource.value).toBe('queue');
    });

    it('loads listen history as a read-only playlist source', async () => {
        const { controller, elements, loadListenHistoryData, onTrackChosen } = mountPlaylistController();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2023-11-15T12:00:00Z'));

        controller.openModal();
        elements.playlistSource.value = 'history';
        elements.playlistSource.dispatchEvent(new Event('change', { bubbles: true }));
        await flushPromises();

        expect(loadListenHistoryData).toHaveBeenCalledTimes(1);
        expect(elements.playlistSource.value).toBe('history');
        expect(Array.from(elements.playlistSource.options).map((option) => option.text)).toEqual([
            'Playback Queue (Ordered)',
            'Listen History',
            'Favorite: favorite.m3u8',
        ]);
        expect(elements.playlistList.querySelector('[data-playlist-remove-position]')).toBeNull();
        expect(elements.playlistList.querySelector('.playlist-drag-handle')).toBeNull();
        expect(elements.playlistList.querySelector('.playlist-row-read-only')).not.toBeNull();
        expect(elements.playlistList.classList.contains('is-view-switching')).toBe(true);
        expect(elements.playlistList.textContent).toContain('1 day ago');
        expect(elements.playlistList.textContent).toContain('2 weeks ago');

        const historyTrackButton = elements.playlistList.querySelector('[data-playlist-track-index="2"]') as HTMLButtonElement | null;
        expect(historyTrackButton).not.toBeNull();
        historyTrackButton?.click();
        await flushPromises();

        expect(onTrackChosen).toHaveBeenLastCalledWith(2, {
            source: 'history',
            userInitiated: true,
        });
        expect(controller.getSequenceOverride()).toEqual({ indexes: [2, 0], currentPosition: 0 });
        vi.useRealTimers();
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
        expect(controller.getSequenceOverride()).toBeNull();
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

    it('persists playlist source state through an injected controller substate', async () => {
        const state = createPlaylistControllerState();
        const { controller, elements } = mountPlaylistController({ state });

        const loaded = await controller.loadPlaylistByPath('/playlists/demo.m3u8');
        await flushPromises();

        expect(loaded).toBe(true);
        expect(state.loadedPlaylistTrackIndexes).toEqual([2, 1]);
        expect(state.loadedPlaylistName).toBe('demo.m3u8');
        expect(state.loadedPlaylistPath).toBe('/playlists/demo.m3u8');
        expect(state.loadedPlaylistReadOnly).toBe(false);
        expect(state.loadedPlaylistHistoryItems).toBeNull();
        expect(state.loadedPlaylistCachedItems).toEqual([
            { cachedArtistName: 'Artist 2', cachedTrackTitle: 'Track 2' },
            { cachedArtistName: 'Artist 1', cachedTrackTitle: 'Track 1' },
        ]);
        expect(state.selectedSource).toBe('playlist');
        expect(state.playbackSource).toBe('queue');
        expect(elements.playlistSource.value).toBe('playlist');

        controller.resetState();

        expect(state).toEqual(createPlaylistControllerState());
    });

    it('skips hydration and cache writes for playlist rows that already have cached labels', async () => {
        const { controller, ensureTrackTagsResolvedBatch, loadPlaylistData, savePlaylistTrackMetadataCache } = mountPlaylistController();
        loadPlaylistData.mockResolvedValueOnce({
            name: 'cached.m3u8',
            trackIndexes: [0, 2],
            cachedItems: [
                { cachedTrackTitle: 'Cached Track 0', cachedArtistName: 'Cached Artist 0' },
                { cachedTrackTitle: 'Cached Track 2', cachedArtistName: 'Cached Artist 2' },
            ],
        });

        await expect(controller.loadPlaylistByPath('/playlists/cached.m3u8')).resolves.toBe(true);
        await flushPromises();

        expect(ensureTrackTagsResolvedBatch).not.toHaveBeenCalled();
        expect(savePlaylistTrackMetadataCache).not.toHaveBeenCalled();
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

    it('keeps playback queue sequencing while viewing an external playlist', async () => {
        const { controller } = mountPlaylistController();

        const loaded = await controller.loadPlaylistByPath('/playlists/demo.m3u8');
        expect(loaded).toBe(true);
        expect(controller.getSequenceOverride()).toBeNull();
        expect(controller.getNextTrackIndex(1)).toBe(1);

        controller.activatePlaybackQueueSource();

        expect(controller.getSequenceOverride()).toBeNull();
    });
});