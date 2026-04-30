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

const dispatchPointerEvent = (
    target: EventTarget,
    type: string,
    init: Partial<{ button: number; clientX: number; clientY: number; pointerId: number }> = {},
): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
        button: { value: init.button ?? 0 },
        clientX: { value: init.clientX ?? 0 },
        clientY: { value: init.clientY ?? 0 },
        pointerId: { value: init.pointerId ?? 1 },
    });
    target.dispatchEvent(event);
};

const selectCustomPlaylistSource = async (
    elements: ReturnType<typeof getPlaylistModalElements>,
    value: string,
): Promise<void> => {
    elements.playlistSourceButton.click();
    const optionButton = elements.playlistSourceMenu.querySelector(`[data-value="${value}"]`) as HTMLButtonElement | null;
    expect(optionButton).not.toBeNull();
    optionButton?.click();
    await flushPromises();
};

const createTrackView = (index: number): PlaylistTrackView => ({
    displayTitle: `Track ${index}`,
    name: `Track ${index}`,
    displayArtist: `Artist ${index}`,
    tagsResolved: true,
});

const mountPlaylistController = (options: { state?: PlaylistControllerState; shouldAutoSavePlaylistsOnAddRemove?: boolean } = {}) => {
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
            { listenedAt: 1_699_963_200, playedPercent: 83 },
            { listenedAt: 1_698_840_000, playedPercent: 100 },
        ],
    }));
    const ensureTrackTagsResolvedBatch = vi.fn(async () => undefined);
    const savePlaylistTrackMetadataCache = vi.fn(async () => true);
    const savePlaylistData = vi.fn(async () => true);
    const openErrorModal = vi.fn();
    const onPlaybackSequenceMutated = vi.fn(async () => undefined);

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
        openErrorModal,
        getFavoritePlaylists: () => favoritePlaylists,
        shouldAutoSavePlaylistsOnAddRemove: () => options.shouldAutoSavePlaylistsOnAddRemove === true,
        hasListenHistoryPlaylist: () => listenHistoryEnabled,
        onTrackChosen,
        onExternalPlaylistLoaded: vi.fn(() => undefined),
        onPlaybackSequenceMutated,
    });

    return {
        controller,
        elements: modal,
        appendTracksToPlaylistData,
        ensureTrackTagsResolvedBatch,
        loadListenHistoryData,
        loadPlaylistData,
        onPlaybackSequenceMutated,
        onTrackChosen,
        openErrorModal,
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
        vi.useRealTimers();
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

    it('filters silence-titled tracks out of loaded playlists before they enter the queue state', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews: PlaylistTrackView[] = [
            createTrackView(0),
            { displayTitle: '[silence]', name: 'silence.flac', displayArtist: 'Artist 1', tagsResolved: true },
            createTrackView(2),
        ];
        let currentTrackIndex = 0;
        const onTrackChosen = vi.fn(async (trackIndex: number) => {
            currentTrackIndex = trackIndex;
        });

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
                indexes: [0, 2],
                currentPosition: 0,
            }),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => ({
                name: 'filtered.m3u8',
                trackIndexes: [2, 1, 0],
                cachedItems: [
                    { cachedTrackTitle: 'Track 2', cachedArtistName: 'Artist 2' },
                    { cachedTrackTitle: '[silence]', cachedArtistName: 'Artist 1' },
                    { cachedTrackTitle: 'Track 0', cachedArtistName: 'Artist 0' },
                ],
            })),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen,
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        const loaded = await controller.loadPlaylistByPath('/playlists/filtered.m3u8');
        await flushPromises();

        expect(loaded).toBe(true);
        expect(controller.getSequenceOverride()).toBeNull();

        const playlistTrackButtons = Array.from(modal.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]'));
        expect(playlistTrackButtons.map((button) => button.dataset.playlistTrackIndex)).toEqual(['2', '0']);

        modal.playlistSource.value = 'queue';
        modal.playlistSource.dispatchEvent(new Event('change', { bubbles: true }));

        const queueTrackButtons = Array.from(modal.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]'));
        expect(queueTrackButtons.map((button) => button.dataset.playlistTrackIndex)).toEqual(['0', '2']);
    });

    it('ignores silence-titled tracks when adding directly to the playback queue', () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews: PlaylistTrackView[] = [
            createTrackView(0),
            { displayTitle: '(silence)', name: 'silence.flac', displayArtist: 'Artist 1', tagsResolved: true },
            createTrackView(2),
        ];
        let currentTrackIndex = 0;

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
                indexes: [0, 2],
                currentPosition: 0,
            }),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => null),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async (trackIndex: number) => {
                currentTrackIndex = trackIndex;
            }),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        controller.addToQueueEnd([1]);
        expect(controller.getSequenceOverride()).toBeNull();

        controller.addToQueueEnd([2]);
        expect(controller.getSequenceOverride()).toEqual({
            indexes: [0, 2, 2],
            currentPosition: 0,
        });
    });

    it('switches to a favorite playlist from the source selector and resets back to the queue state', async () => {
        const { controller, elements, loadPlaylistData, onTrackChosen } = mountPlaylistController();

        controller.openModal();

        const firstQueueTrackButton = elements.playlistList.querySelector('[data-playlist-track-index]') as HTMLButtonElement | null;
        expect(firstQueueTrackButton?.dataset.playlistTrackIndex).toBe('0');

        await selectCustomPlaylistSource(elements, 'favorite:0');

        expect(loadPlaylistData).toHaveBeenCalledWith('/playlists/favorite.m3u8');
        expect(elements.playlistSource.value).toBe('favorite:0');
        expect(elements.playlistSourceLabel.textContent).toBe('Favorite: favorite.m3u8');
        expect(onTrackChosen).not.toHaveBeenCalled();
        expect(elements.playlistList.classList.contains('is-view-switching')).toBe(true);

        const firstFavoriteTrackButton = elements.playlistList.querySelector('[data-playlist-track-index]') as HTMLButtonElement | null;
        expect(firstFavoriteTrackButton?.dataset.playlistTrackIndex).toBe('1');

        controller.resetState();
        controller.refreshOpenModal();

        expect(controller.getSequenceOverride()).toBeNull();
        expect(elements.playlistSource.value).toBe('queue');
    });

    it('filters the current playlist view and clears the filter when the modal closes', () => {
        const { controller, elements } = mountPlaylistController();
        vi.useFakeTimers();

        controller.openModal();
        elements.playlistFilterToggle.click();
        expect(elements.playlistFilterToggle.getAttribute('aria-expanded')).toBe('true');
        expect(elements.playlistDialog.classList.contains('is-filter-open')).toBe(true);
        elements.playlistFilterInput.value = 'Track 2';
        elements.playlistFilterInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(300);

        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => button.dataset.playlistTrackIndex)).toEqual(['2']);

        controller.closeModal();
        controller.openModal();

        expect(elements.playlistFilterToggle.getAttribute('aria-expanded')).toBe('false');
        expect(elements.playlistDialog.classList.contains('is-filter-open')).toBe(false);
        expect(elements.playlistFilterInput.value).toBe('');
        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => button.dataset.playlistTrackIndex)).toEqual(['0', '1', '2']);
        vi.useRealTimers();
    });

    it('waits 300ms after the last typed character before applying the filter', () => {
        const { controller, elements } = mountPlaylistController();
        vi.useFakeTimers();

        controller.openModal();
        elements.playlistFilterToggle.click();
        elements.playlistFilterInput.value = 'Track 2';
        elements.playlistFilterInput.dispatchEvent(new Event('input', { bubbles: true }));

        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => button.dataset.playlistTrackIndex)).toEqual(['0', '1', '2']);

        vi.advanceTimersByTime(299);
        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => button.dataset.playlistTrackIndex)).toEqual(['0', '1', '2']);
        expect(elements.playlistList.classList.contains('is-filtering')).toBe(false);

        vi.advanceTimersByTime(1);
        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => button.dataset.playlistTrackIndex)).toEqual(['2']);
        expect(elements.playlistList.classList.contains('is-filtering')).toBe(true);

        vi.advanceTimersByTime(170);
        expect(elements.playlistList.classList.contains('is-filtering')).toBe(false);
        vi.useRealTimers();
    });

    it('clears the filter when the playlist source is switched', async () => {
        const { controller, elements } = mountPlaylistController();
        vi.useFakeTimers();

        controller.openModal();
        elements.playlistFilterToggle.click();
        elements.playlistFilterInput.value = 'Track 2';
        elements.playlistFilterInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(300);
        await selectCustomPlaylistSource(elements, 'favorite:0');

        expect(elements.playlistFilterToggle.getAttribute('aria-expanded')).toBe('false');
        expect(elements.playlistFilterInput.value).toBe('');
        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => button.dataset.playlistTrackIndex)).toEqual(['1', '0']);
        vi.useRealTimers();
    });

    it('clears the filter when a different playlist path is loaded directly', async () => {
        const { controller, elements } = mountPlaylistController();
        vi.useFakeTimers();

        await expect(controller.loadPlaylistByPath('/playlists/demo.m3u8')).resolves.toBe(true);
        elements.playlistFilterToggle.click();
        elements.playlistFilterInput.value = 'Track 2';
        elements.playlistFilterInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(300);

        await expect(controller.loadPlaylistByPath('/playlists/empty.m3u8')).resolves.toBe(true);

        expect(elements.playlistFilterToggle.getAttribute('aria-expanded')).toBe('false');
        expect(elements.playlistFilterInput.value).toBe('');
        expect(elements.playlistList.textContent).toContain('No tracks available');
        vi.useRealTimers();
    });

    it('loads listen history as a read-only playlist source', async () => {
        const { controller, elements, loadListenHistoryData, onTrackChosen } = mountPlaylistController();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2023-11-15T12:00:00Z'));

        controller.openModal();
        await selectCustomPlaylistSource(elements, 'history');

        expect(loadListenHistoryData).toHaveBeenCalledTimes(1);
        expect(elements.playlistSource.value).toBe('history');
        expect(elements.playlistSourceLabel.textContent).toBe('Listen History');
        expect(elements.playlistSourceIcon.innerHTML).toContain('<svg');
        expect(elements.playlistAddCurrent.disabled).toBe(true);
        expect(elements.playlistPreventDuplicateCheckbox.disabled).toBe(true);
        expect(Array.from(elements.playlistSource.options).map((option) => option.text)).toEqual([
            'Playback Queue',
            'Listen History',
            'Favorite: favorite.m3u8',
        ]);
        expect(elements.playlistList.querySelector('[data-playlist-remove-position]')).toBeNull();
        expect(elements.playlistList.querySelector('.playlist-drag-handle')).toBeNull();
        expect(elements.playlistList.querySelector('.playlist-row-read-only')).not.toBeNull();
        expect(elements.playlistList.classList.contains('is-view-switching')).toBe(true);
        expect(elements.playlistList.textContent).toContain('83% played');
        expect(elements.playlistList.textContent).toContain('100% played');
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

    it('disables add-current and duplicate prevention while viewing the playback queue', () => {
        const { controller, elements } = mountPlaylistController();

        controller.openModal();

        expect(elements.playlistSource.value).toBe('queue');
        expect(elements.playlistAddCurrent.disabled).toBe(true);
        expect(elements.playlistPreventDuplicateCheckbox.disabled).toBe(true);
    });

    it('keeps add-current and duplicate prevention enabled for editable playlist views', async () => {
        const { controller, elements } = mountPlaylistController();

        controller.openModal();
        await selectCustomPlaylistSource(elements, 'favorite:0');

        expect(elements.playlistSource.value).toBe('favorite:0');
        expect(elements.playlistAddCurrent.disabled).toBe(false);
        expect(elements.playlistPreventDuplicateCheckbox.disabled).toBe(false);

        await expect(controller.loadPlaylistByPath('/playlists/demo.m3u8')).resolves.toBe(true);
        await flushPromises();

        expect(elements.playlistSource.value).toBe('playlist');
        expect(elements.playlistAddCurrent.disabled).toBe(false);
        expect(elements.playlistPreventDuplicateCheckbox.disabled).toBe(false);
    });

    it('renders svg icons for queue and history inside the custom source menu', () => {
        const { controller, elements } = mountPlaylistController();

        controller.openModal();
        elements.playlistSourceButton.click();

        const queueOption = elements.playlistSourceMenu.querySelector('[data-value="queue"] .playlist-source-option-icon') as HTMLSpanElement | null;
        const historyOption = elements.playlistSourceMenu.querySelector('[data-value="history"] .playlist-source-option-icon') as HTMLSpanElement | null;
        const favoriteOption = elements.playlistSourceMenu.querySelector('[data-value="favorite:0"] .playlist-source-option-icon') as HTMLSpanElement | null;

        expect(queueOption?.innerHTML).toContain('<svg');
        expect(historyOption?.innerHTML).toContain('<svg');
        expect(favoriteOption?.classList.contains('is-empty')).toBe(true);
    });

    it('constrains the source menu to the dialog and opens it upward when space below is limited', () => {
        const { controller, elements } = mountPlaylistController();

        vi.spyOn(elements.playlistDialog, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 100,
            right: 700,
            bottom: 260,
            left: 100,
            width: 600,
            height: 160,
            toJSON: () => ({}),
        });
        vi.spyOn(elements.playlistSourceWrap, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 180,
            right: 500,
            bottom: 212,
            left: 180,
            width: 320,
            height: 32,
            toJSON: () => ({}),
        });

        controller.openModal();
        elements.playlistSourceButton.click();

        expect(elements.playlistSourceWrap.classList.contains('opens-upward')).toBe(true);
        expect(elements.playlistSourceMenu.style.maxHeight).toBe('72px');
    });

    it('caps the source menu height to roughly three visible items even when more space is available', () => {
        const { controller, elements } = mountPlaylistController();

        vi.spyOn(elements.playlistDialog, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 100,
            right: 700,
            bottom: 520,
            left: 100,
            width: 600,
            height: 420,
            toJSON: () => ({}),
        });
        vi.spyOn(elements.playlistSourceWrap, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            top: 140,
            right: 500,
            bottom: 172,
            left: 180,
            width: 320,
            height: 32,
            toJSON: () => ({}),
        });

        controller.openModal();
        elements.playlistSourceButton.click();

        expect(elements.playlistSourceWrap.classList.contains('opens-upward')).toBe(false);
        expect(elements.playlistSourceMenu.style.maxHeight).toBe('100px');
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
        expect(controller.isTrackAlreadyInLoadedPlaylist('/playlists/demo.m3u8', 0)).toBe(true);
        expect(controller.isTrackAlreadyInLoadedPlaylist('/playlists/demo.m3u8', 2)).toBe(true);
        expect(controller.isTrackAlreadyInLoadedPlaylist('/playlists/favorite.m3u8', 2)).toBe(false);
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

    it('shows an error when prevent duplicates is checked and current track is already in an editable playlist', async () => {
        const { controller, elements, openErrorModal } = mountPlaylistController();

        controller.openModal();
        await selectCustomPlaylistSource(elements, 'favorite:0');
        elements.playlistPreventDuplicateCheckbox.checked = true;
        elements.playlistAddCurrent.click();

        expect(openErrorModal).toHaveBeenCalledWith(
            'Track already in playlist',
            'The current track is already in the active playlist. Disable duplicate prevention to add it again.',
        );
    });

    it('saves the loaded playlist immediately after adding a track when enabled', async () => {
        const state = createPlaylistControllerState();
        const { controller, elements, savePlaylistData } = mountPlaylistController({
            state,
            shouldAutoSavePlaylistsOnAddRemove: true,
        });

        await expect(controller.loadPlaylistByPath('/playlists/demo.m3u8')).resolves.toBe(true);
        await flushPromises();

        elements.playlistAddCurrent.click();
        await flushPromises();

        expect(savePlaylistData).toHaveBeenCalledWith('/playlists/demo.m3u8', [
            '/music/track-2.flac',
            '/music/track-1.flac',
            '/music/track-0.flac',
        ]);
        expect(state.loadedPlaylistTrackIndexes).toEqual([2, 1, 0]);
    });

    it('saves the loaded playlist immediately after removing a track when enabled', async () => {
        const state = createPlaylistControllerState();
        const { controller, elements, onPlaybackSequenceMutated, savePlaylistData } = mountPlaylistController({
            state,
            shouldAutoSavePlaylistsOnAddRemove: true,
        });

        await expect(controller.loadPlaylistByPath('/playlists/demo.m3u8')).resolves.toBe(true);
        await flushPromises();

        const removeButton = elements.playlistList.querySelector('[data-playlist-remove-position="0"]') as HTMLButtonElement | null;
        expect(removeButton).not.toBeNull();

        removeButton?.click();
        await flushPromises();

        expect(savePlaylistData).toHaveBeenCalledWith('/playlists/demo.m3u8', [
            '/music/track-1.flac',
        ]);
        expect(state.loadedPlaylistTrackIndexes).toEqual([1]);
        expect(onPlaybackSequenceMutated).not.toHaveBeenCalled();
    });

    it('notifies playback-sequence listeners after removing the queued next track', async () => {
        const state = createPlaylistControllerState();
        state.editableQueueTrackIndexes = [0, 1, 2];
        state.editableQueueCurrentPosition = 0;
        state.selectedSource = 'queue';
        state.playbackSource = 'queue';

        const { controller, elements, onPlaybackSequenceMutated } = mountPlaylistController({ state });

        controller.openModal();

        const removeButton = elements.playlistList.querySelector('[data-playlist-remove-position="1"]') as HTMLButtonElement | null;
        expect(removeButton).not.toBeNull();

        removeButton?.click();
        await flushPromises();

        expect(state.editableQueueTrackIndexes).toEqual([0, 2]);
        expect(state.editableQueueCurrentPosition).toBe(0);
        expect(onPlaybackSequenceMutated).toHaveBeenCalledTimes(1);
    });

    it('reverts a loaded playlist add when immediate save fails', async () => {
        const state = createPlaylistControllerState();
        const { controller, elements, openErrorModal, savePlaylistData } = mountPlaylistController({
            state,
            shouldAutoSavePlaylistsOnAddRemove: true,
        });
        savePlaylistData.mockResolvedValue(false);

        await expect(controller.loadPlaylistByPath('/playlists/demo.m3u8')).resolves.toBe(true);
        await flushPromises();

        elements.playlistAddCurrent.click();
        await flushPromises();
        await flushPromises();

        expect(openErrorModal).toHaveBeenCalledWith(
            'Playlist save failed',
            'Silphium could not save the playlist after adding a track, so the change was reverted.',
        );
        expect(state.loadedPlaylistTrackIndexes).toEqual([2, 1]);
    });

    it('starts queue dragging from the handle instead of the full row', () => {
        const { controller, elements } = mountPlaylistController();

        controller.openModal();

        const rows = Array.from(elements.playlistList.querySelectorAll<HTMLLIElement>('.playlist-row'));
        const row = rows[0] || null;
        const handle = row?.querySelector('.playlist-drag-handle') as HTMLButtonElement | null;
        const nextHandle = rows[1]?.querySelector('.playlist-drag-handle') as HTMLButtonElement | null;

        expect(row).not.toBeNull();
        expect(handle).not.toBeNull();
        expect(row?.draggable).toBe(false);
        expect(handle?.draggable).toBe(false);
        expect(handle?.disabled).toBe(true);
        expect(nextHandle?.disabled).toBe(false);
    });

    it('does not allow dragging the currently playing track in the playback queue', () => {
        const { controller, elements } = mountPlaylistController();

        controller.openModal();

        const sourceRow = elements.playlistList.querySelector('[data-playlist-position="0"]') as HTMLLIElement | null;
        const targetRow = elements.playlistList.querySelector('[data-playlist-position="1"]') as HTMLLIElement | null;
        const handle = sourceRow?.querySelector('.playlist-drag-handle') as HTMLButtonElement | null;

        expect(sourceRow).not.toBeNull();
        expect(targetRow).not.toBeNull();
        expect(handle).not.toBeNull();
        expect(handle?.disabled).toBe(true);

        Object.defineProperty(document, 'elementFromPoint', {
            value: vi.fn(() => targetRow),
            configurable: true,
        });

        dispatchPointerEvent(handle as HTMLButtonElement, 'pointerdown', { pointerId: 5, clientX: 10, clientY: 10 });
        dispatchPointerEvent(window, 'pointermove', { pointerId: 5, clientX: 20, clientY: 20 });
        dispatchPointerEvent(window, 'pointerup', { pointerId: 5, clientX: 20, clientY: 20 });

        expect(controller.getSequenceOverride()).toBeNull();
        expect(Array.from(elements.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => Number(button.dataset.playlistTrackIndex))).toEqual([0, 1, 2]);
    });

    it('preserves the active queue cursor when pointer-dragging a shuffled queue with duplicate track indexes', () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = [createTrackView(0), createTrackView(1), createTrackView(2), createTrackView(3), createTrackView(4)];

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 1,
            getPlaybackOrderLabel: () => 'Shuffle',
            getBaseSequence: () => ({
                indexes: [2, 1, 3, 1, 4],
                currentPosition: 3,
            }),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => null),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        controller.openModal();

    const sourceRow = modal.playlistList.querySelector('[data-playlist-position="4"]') as HTMLLIElement | null;
    const targetRow = modal.playlistList.querySelector('[data-playlist-position="3"]') as HTMLLIElement | null;
        const handle = sourceRow?.querySelector('.playlist-drag-handle') as HTMLButtonElement | null;

        expect(sourceRow).not.toBeNull();
        expect(targetRow).not.toBeNull();
        expect(handle).not.toBeNull();
        Object.defineProperty(document, 'elementFromPoint', {
            value: vi.fn(() => targetRow),
            configurable: true,
        });

        dispatchPointerEvent(handle as HTMLButtonElement, 'pointerdown', { pointerId: 7, clientX: 10, clientY: 10 });
        dispatchPointerEvent(window, 'pointermove', { pointerId: 7, clientX: 20, clientY: 20 });
        dispatchPointerEvent(window, 'pointerup', { pointerId: 7, clientX: 20, clientY: 20 });

        expect(controller.getSequenceOverride()).toEqual({
            indexes: [2, 1, 3, 4, 1],
            currentPosition: 4,
        });
        expect(Array.from(modal.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]')).map((button) => Number(button.dataset.playlistTrackIndex))).toEqual([2, 1, 3, 4, 1]);
    });

    it('renders the playback queue with up to 50 previous and 50 next tracks around the current cursor', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = Array.from({ length: 120 }, (_, index) => ({
            displayTitle: `Track ${index}`,
            name: `Track ${index}`,
            displayArtist: `Artist ${index}`,
            tagsResolved: true,
        }));

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 50,
            getPlaybackOrderLabel: () => 'Ordered',
            getBaseSequence: () => ({
                indexes: trackViews.map((_, index) => index),
                currentPosition: 50,
            }),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => null),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        controller.openModal();
        await flushPromises();

        const renderedIndexes = Array.from(modal.playlistList.querySelectorAll<HTMLButtonElement>('[data-playlist-track-index]'))
            .map((button) => Number(button.dataset.playlistTrackIndex));

        expect(renderedIndexes).toEqual(Array.from({ length: 101 }, (_, index) => index));
    });

    it('hydrates newly visible queue rows after the queue advances', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = Array.from({ length: 153 }, (_, index) => ({
            displayTitle: `Track ${index}`,
            name: `Track ${index}`,
            displayArtist: `Artist ${index}`,
            tagsResolved: index !== 151,
        }));
        let currentTrackIndex = 50;
        const ensureTrackTagsResolvedBatch = vi.fn(async (indexes: number[]) => {
            indexes.forEach((index) => {
                trackViews[index].tagsResolved = true;
            });
        });

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
                indexes: trackViews.map((_, index) => index),
                currentPosition: currentTrackIndex,
            }),
            ensureTrackTagsResolvedBatch,
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => null),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        controller.openModal();
        await flushPromises();
        expect(ensureTrackTagsResolvedBatch).not.toHaveBeenCalled();

        currentTrackIndex = 51;
        controller.scheduleRender();
        await flushPromises();

        expect(ensureTrackTagsResolvedBatch).toHaveBeenCalledWith([151]);
    });

    it('hydrates future queue rows even when non-queue background hydration is disabled', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = Array.from({ length: 103 }, (_, index) => ({
            displayTitle: `Track ${index}`,
            name: `Track ${index}`,
            displayArtist: `Artist ${index}`,
            tagsResolved: index !== 101,
        }));
        const ensureTrackTagsResolvedBatch = vi.fn(async (indexes: number[]) => {
            indexes.forEach((index) => {
                trackViews[index].displayTitle = `Hydrated ${index}`;
                trackViews[index].displayArtist = `Hydrated Artist ${index}`;
                trackViews[index].tagsResolved = true;
            });
        });

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            backgroundHydrationEnabled: false,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 51,
            getPlaybackOrderLabel: () => 'Ordered',
            getBaseSequence: () => ({
                indexes: trackViews.map((_, index) => index),
                currentPosition: 51,
            }),
            ensureTrackTagsResolvedBatch,
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => null),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        controller.openModal();
        await flushPromises();

        expect(ensureTrackTagsResolvedBatch).toHaveBeenCalledWith([101]);
        expect(modal.playlistList.querySelector('[data-playlist-track-index="101"]')).not.toBeNull();
        expect(modal.playlistList.textContent).toContain('Hydrated 101');
        expect(modal.playlistList.textContent).toContain('Hydrated Artist 101');
    });

    it('fades hydration progress out after queue hydration completes', async () => {
        vi.useFakeTimers();

        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = Array.from({ length: 60 }, (_, index) => ({
            displayTitle: `Track ${index}`,
            name: `Track ${index}`,
            displayArtist: `Artist ${index}`,
            tagsResolved: index !== 10,
        }));

        let resolveHydrationBatch: (() => void) | undefined;
        const ensureTrackTagsResolvedBatch = vi.fn(() => new Promise<void>((resolve) => {
            resolveHydrationBatch = () => {
                trackViews[10].tagsResolved = true;
                resolve();
            };
        }));

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 0,
            getPlaybackOrderLabel: () => 'Ordered',
            getBaseSequence: () => ({
                indexes: trackViews.map((_, index) => index),
                currentPosition: 0,
            }),
            ensureTrackTagsResolvedBatch,
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => null),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        controller.openModal();
        await flushPromises();

        expect(ensureTrackTagsResolvedBatch).toHaveBeenCalledWith([10]);
        expect(modal.playlistHydrationProgress.hidden).toBe(false);
        expect(modal.playlistDialog.classList.contains('is-hydration-progress-visible')).toBe(true);

        expect(resolveHydrationBatch).toBeDefined();
        resolveHydrationBatch?.();
        await flushPromises();

        expect(modal.playlistDialog.classList.contains('is-hydration-progress-visible')).toBe(false);
        expect(modal.playlistHydrationProgress.hidden).toBe(false);

        vi.advanceTimersByTime(220);

        expect(modal.playlistHydrationProgress.hidden).toBe(true);
    });

    it('hydrates only the visible loaded playlist window and requests more as the user scrolls', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        Object.defineProperty(modal.playlistList, 'clientHeight', {
            configurable: true,
            value: 44 * 3,
        });
        const trackViews = Array.from({ length: 260 }, (_, index) => ({
            displayTitle: `Track ${index}`,
            name: `Track ${index}`,
            displayArtist: `Artist ${index}`,
            tagsResolved: false,
        }));
        const ensureTrackTagsResolvedBatch = vi.fn(async (indexes: number[]) => {
            indexes.forEach((index) => {
                trackViews[index].tagsResolved = true;
            });
        });

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 0,
            getPlaybackOrderLabel: () => 'Ordered',
            getBaseSequence: () => ({
                indexes: trackViews.map((_, index) => index),
                currentPosition: 0,
            }),
            ensureTrackTagsResolvedBatch,
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => ({
                name: 'large.m3u8',
                trackIndexes: trackViews.map((_, index) => index),
            })),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        await expect(controller.loadPlaylistByPath('/playlists/large.m3u8')).resolves.toBe(true);
        await flushPromises();

        const initiallyHydratedIndexes = ensureTrackTagsResolvedBatch.mock.calls.flatMap(([indexes]) => indexes as number[]);
        expect(initiallyHydratedIndexes.length).toBeGreaterThan(0);
        expect(initiallyHydratedIndexes.some((index) => index >= 120)).toBe(false);
        expect(modal.playlistList.querySelectorAll('.playlist-row')).toHaveLength(72);
        expect(modal.playlistList.querySelector('[data-playlist-track-index="71"]')).not.toBeNull();
        expect(modal.playlistList.querySelector('[data-playlist-track-index="72"]')).toBeNull();

        modal.playlistList.scrollTop = 44 * 170;
        modal.playlistList.dispatchEvent(new Event('scroll'));
        await flushPromises();

        const hydratedAfterScroll = ensureTrackTagsResolvedBatch.mock.calls.flatMap(([indexes]) => indexes as number[]);
        expect(hydratedAfterScroll.some((index) => index >= 140)).toBe(true);
        expect(modal.playlistList.querySelectorAll('.playlist-row')).toHaveLength(72);
        expect(modal.playlistList.querySelector('[data-playlist-track-index="0"]')).toBeNull();
        expect(modal.playlistList.querySelector('[data-playlist-track-index="146"]')).not.toBeNull();
    });

    it('updates visible loaded playlist labels in place as hydration completes', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = [
            { displayTitle: 'Placeholder 0', name: 'Track 0', displayArtist: 'Unknown Artist', tagsResolved: false },
            { displayTitle: 'Placeholder 1', name: 'Track 1', displayArtist: 'Unknown Artist', tagsResolved: false },
        ];
        const ensureTrackTagsResolvedBatch = vi.fn(async (indexes: number[]) => {
            indexes.forEach((index) => {
                trackViews[index].displayTitle = `Hydrated ${index}`;
                trackViews[index].displayArtist = `Artist ${index}`;
                trackViews[index].tagsResolved = true;
            });
        });

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 0,
            getPlaybackOrderLabel: () => 'Ordered',
            getBaseSequence: () => ({
                indexes: [0, 1],
                currentPosition: 0,
            }),
            ensureTrackTagsResolvedBatch,
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => ({
                name: 'visible.m3u8',
                trackIndexes: [0, 1],
            })),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache: vi.fn(async () => true),
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        await expect(controller.loadPlaylistByPath('/playlists/visible.m3u8')).resolves.toBe(true);
        await flushPromises();

        expect(ensureTrackTagsResolvedBatch).toHaveBeenCalled();
        expect(modal.playlistList.textContent).toContain('Hydrated 0');
        expect(modal.playlistList.textContent).toContain('Artist 0');
        expect(modal.playlistList.textContent).toContain('Hydrated 1');
        expect(modal.playlistList.textContent).toContain('Artist 1');
    });

    it('cancels loaded playlist hydration work after the modal closes', async () => {
        document.body.innerHTML = `${renderPlaylistMenu()}${renderPlaylistModal()}`;
        const trigger = document.createElement('button');
        document.body.append(trigger);

        const menu = getPlaylistMenuElements(document);
        const modal = getPlaylistModalElements(document);
        const trackViews = Array.from({ length: 120 }, (_, index) => ({
            displayTitle: `Track ${index}`,
            name: `Track ${index}`,
            displayArtist: `Artist ${index}`,
            tagsResolved: false,
        }));
        let resolveBatch: (() => void) | undefined;
        const ensureTrackTagsResolvedBatch = vi.fn(() => new Promise<void>((resolve) => {
            resolveBatch = () => {
                trackViews.forEach((track) => {
                    track.tagsResolved = true;
                });
                resolve();
            };
        }));
        const savePlaylistTrackMetadataCache = vi.fn(async () => true);

        const controller = createPlaylistController({
            trigger,
            menu,
            modal,
            getTrack: (index: number) => trackViews[index],
            getTrackPath: (index: number) => `/music/track-${index}.flac`,
            getTrackCount: () => trackViews.length,
            getCurrentTrackIndex: () => 0,
            getPlaybackOrderLabel: () => 'Ordered',
            getBaseSequence: () => ({
                indexes: trackViews.map((_, index) => index),
                currentPosition: 0,
            }),
            ensureTrackTagsResolvedBatch,
            selectPlaylistFile: vi.fn(async () => ''),
            selectPlaylistSaveFile: vi.fn(async () => ''),
            loadPlaylistData: vi.fn(async () => ({
                name: 'cancel.m3u8',
                trackIndexes: trackViews.map((_, index) => index),
            })),
            loadListenHistoryData: vi.fn(async () => null),
            savePlaylistTrackMetadataCache,
            savePlaylistData: vi.fn(async () => true),
            appendTracksToPlaylistData: vi.fn(async () => true),
            openErrorModal: vi.fn(),
            getFavoritePlaylists: () => [],
            hasListenHistoryPlaylist: () => false,
            onTrackChosen: vi.fn(async () => undefined),
            onExternalPlaylistLoaded: vi.fn(() => undefined),
        });

        await expect(controller.loadPlaylistByPath('/playlists/cancel.m3u8')).resolves.toBe(true);
        expect(ensureTrackTagsResolvedBatch).toHaveBeenCalledTimes(1);

        controller.closeModal();
        if (resolveBatch) {
            resolveBatch();
        }
        await flushPromises();

        expect(ensureTrackTagsResolvedBatch).toHaveBeenCalledTimes(1);
        expect(savePlaylistTrackMetadataCache).not.toHaveBeenCalled();
    });
});