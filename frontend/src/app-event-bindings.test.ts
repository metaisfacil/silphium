import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: vi.fn(async () => undefined),
    EventsOn: vi.fn(),
    OnFileDrop: vi.fn(),
}));

import { canInteractWithCoverFrame, handleExternalFileDrop, openOverviewAlbumContextMenu, resolveOverviewAlbumTrackIndex, setupSidebarShellBindings, setupTrackNavigationBindings, setupVolumeControlBindings, toggleTaskbarCoverView, triggerSidebarOpenInBrowserAction, triggerTrackMetaArtistFilterAction } from './app-event-bindings';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const volumeControlMarkup = (value: number): string => `
    <div class="volume-wrap">
        <button id="volume-btn" type="button"><svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"></svg></button>
        <div class="volume-popout"><input id="volume" type="range" min="0" max="1" value="${value}" step="0.01"></div>
    </div>
`;

describe('setupVolumeControlBindings', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('mutes and restores volume on button click without toggling popout state', async () => {
        document.body.innerHTML = volumeControlMarkup(0.8);

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
        const audioSetVolume = vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 }));
        const applyPlaybackState = vi.fn();
        const handleAudioError = vi.fn();

        const volumeRow = setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume,
            applyPlaybackState,
            handleAudioError,
        });

        expect(volumeRow.classList.contains('open')).toBe(false);
        expect(volumeBtn.classList.contains('is-muted')).toBe(false);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Mute');

        volumeBtn.click();
        await flushPromises();
        expect(Number(volume.value)).toBe(0);
        expect(volumeBtn.classList.contains('is-muted')).toBe(true);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Unmute');
        expect(volumeRow.classList.contains('open')).toBe(false);

        volumeBtn.click();
        await flushPromises();
        expect(Number(volume.value)).toBe(0.8);
        expect(volumeBtn.classList.contains('is-muted')).toBe(false);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Mute');
        expect(audioSetVolume).toHaveBeenNthCalledWith(1, 0);
        expect(audioSetVolume).toHaveBeenNthCalledWith(2, 0.8);
        expect(applyPlaybackState).toHaveBeenCalledTimes(2);
        expect(handleAudioError).not.toHaveBeenCalled();

        volume.value = '0';
        volume.dispatchEvent(new Event('input', { bubbles: true }));
        await flushPromises();
        expect(volumeBtn.classList.contains('is-muted')).toBe(true);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Unmute');
    });

    it('opens only from the icon hitbox, then keeps the wider hover area until hidden', () => {
        document.body.innerHTML = volumeControlMarkup(0.6);

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
        const volumeIcon = volumeBtn.querySelector('.control-icon') as SVGElement;

        const volumeRow = setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume: vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 })),
            applyPlaybackState: vi.fn(),
            handleAudioError: vi.fn(),
        });

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(false);

        volumeIcon.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        vi.advanceTimersByTime(250);
        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        vi.advanceTimersByTime(400);
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        vi.advanceTimersByTime(510);
        expect(volumeRow.classList.contains('open')).toBe(false);

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(false);
    });

    it('adjusts volume with mouse wheel over the volume button', async () => {
        document.body.innerHTML = volumeControlMarkup(0.5);

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
        const audioSetVolume = vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 }));

        setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume,
            applyPlaybackState: vi.fn(),
            handleAudioError: vi.fn(),
        });

        volumeBtn.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
        await flushPromises();
        expect(Number(volume.value)).toBeCloseTo(0.55, 5);

        volumeBtn.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        await flushPromises();
        expect(Number(volume.value)).toBeCloseTo(0.5, 5);

        expect(audioSetVolume).toHaveBeenNthCalledWith(1, 0.55);
        expect(audioSetVolume).toHaveBeenNthCalledWith(2, 0.5);
    });
});

describe('setupTrackNavigationBindings', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('logs and navigates for back and forward player control clicks', () => {
        const back = document.createElement('button');
        const forward = document.createElement('button');
        const unlockMediaSessionAnchorFromUserGesture = vi.fn();
        const goToTrack = vi.fn();
        const logTransportGesture = vi.fn();

        setupTrackNavigationBindings({
            back,
            forward,
            unlockMediaSessionAnchorFromUserGesture,
            goToTrack,
            logTransportGesture,
        });

        back.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        back.click();
        forward.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        forward.click();

        expect(logTransportGesture).toHaveBeenNthCalledWith(1, 'back pointerdown', back);
        expect(logTransportGesture).toHaveBeenNthCalledWith(2, 'back click', back);
        expect(logTransportGesture).toHaveBeenNthCalledWith(3, 'forward pointerdown', forward);
        expect(logTransportGesture).toHaveBeenNthCalledWith(4, 'forward click', forward);
        expect(unlockMediaSessionAnchorFromUserGesture).toHaveBeenCalledTimes(2);
        expect(goToTrack).toHaveBeenNthCalledWith(1, -1);
        expect(goToTrack).toHaveBeenNthCalledWith(2, 1);
    });
});

describe('triggerSidebarOpenInBrowserAction', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts the browser action before clearing the sidebar menu state', async () => {
        const callOrder: string[] = [];
        const openSidebarQueueItemInFileBrowser = vi.fn(async () => {
            callOrder.push('open');
        });
        const closeSidebarQueueMenu = vi.fn(() => {
            callOrder.push('close');
        });

        triggerSidebarOpenInBrowserAction(openSidebarQueueItemInFileBrowser, closeSidebarQueueMenu);
        await flushPromises();

        expect(callOrder).toEqual(['open', 'close']);
    });
});

describe('triggerTrackMetaArtistFilterAction', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('closes the menu and opens the sidebar search when a query is available', () => {
        const openLibrarySearch = vi.fn();
        const closeTrackMetaMenu = vi.fn();

        triggerTrackMetaArtistFilterAction('mbid-artist:artist-id', openLibrarySearch, closeTrackMetaMenu);

        expect(closeTrackMetaMenu).toHaveBeenCalledTimes(1);
        expect(openLibrarySearch).toHaveBeenCalledWith('mbid-artist:artist-id', { expandFilteredFolders: true });
    });

    it('still closes the menu when the artist query is empty', () => {
        const openLibrarySearch = vi.fn();
        const closeTrackMetaMenu = vi.fn();

        triggerTrackMetaArtistFilterAction('   ', openLibrarySearch, closeTrackMetaMenu);

        expect(closeTrackMetaMenu).toHaveBeenCalledTimes(1);
        expect(openLibrarySearch).not.toHaveBeenCalled();
    });
});

describe('setupSidebarShellBindings', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('keeps Library and Social navigation confined to the sidebar panes', () => {
        const sidebarToggle = document.createElement('button');
        const sidebarNavOverview = document.createElement('button');
        const sidebarNavLibrary = document.createElement('button');
        const sidebarNavSocial = document.createElement('button');
        const showOverviewPage = vi.fn();
        const libraryController = {
            setSidebarOpen: vi.fn(),
            isSidebarOpen: vi.fn(() => true),
        };
        let activeView: 'nav' | 'library' | 'social' = 'nav';
        const sidebarController = {
            showNavigation: vi.fn(() => {
                activeView = 'nav';
            }),
            showLibrary: vi.fn(() => {
                activeView = 'library';
            }),
            showSocial: vi.fn(() => {
                activeView = 'social';
            }),
            getActiveView: () => activeView,
        };

        setupSidebarShellBindings({
            libraryController,
            sidebarController,
            sidebarToggle,
            sidebarNavLibrary,
            sidebarNavOverview,
            sidebarNavSocial,
            showOverviewPage,
        } as never);

        sidebarNavLibrary.click();
        sidebarNavSocial.click();

        expect(libraryController.setSidebarOpen).toHaveBeenNthCalledWith(1, true);
        expect(libraryController.setSidebarOpen).toHaveBeenNthCalledWith(2, true);
        expect(sidebarController.showLibrary).toHaveBeenCalledTimes(1);
        expect(sidebarController.showSocial).toHaveBeenCalledTimes(1);
        expect(showOverviewPage).not.toHaveBeenCalled();
    });

    it('uses the sidebar toggle as the back action while a section is open', () => {
        const sidebarToggle = document.createElement('button');
        const sidebarNavOverview = document.createElement('button');
        const sidebarNavLibrary = document.createElement('button');
        const sidebarNavSocial = document.createElement('button');
        const showOverviewPage = vi.fn();
        const libraryController = {
            setSidebarOpen: vi.fn(),
            isSidebarOpen: vi.fn(() => true),
        };
        let activeView: 'nav' | 'library' | 'social' = 'nav';
        const sidebarController = {
            showNavigation: vi.fn(() => {
                activeView = 'nav';
            }),
            showLibrary: vi.fn(() => {
                activeView = 'library';
            }),
            showSocial: vi.fn(() => {
                activeView = 'social';
            }),
            getActiveView: () => activeView,
        };

        setupSidebarShellBindings({
            libraryController,
            sidebarController,
            sidebarToggle,
            sidebarNavLibrary,
            sidebarNavOverview,
            sidebarNavSocial,
            showOverviewPage,
        } as never);

        sidebarNavOverview.click();
        activeView = 'library';
        sidebarToggle.click();

        expect(showOverviewPage).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarOpen).toHaveBeenCalledWith(false);
        expect(sidebarController.showNavigation).toHaveBeenCalledTimes(2);
    });
});

describe('canInteractWithCoverFrame', () => {
    it('returns false while overview is showing even if the cover art has loaded', () => {
        const app = document.createElement('div');
        const coverArt = document.createElement('img');
        const playerLane = document.createElement('div');

        app.classList.add('showing-overview');
        coverArt.classList.add('is-visible');
        coverArt.setAttribute('src', '/art/cover.jpg');

        expect(canInteractWithCoverFrame({ app, coverArt, playerLane } as never)).toBe(false);
    });

    it('returns false when the player lane is hidden or the cover art is not visible', () => {
        const app = document.createElement('div');
        const coverArt = document.createElement('img');
        const playerLane = document.createElement('div');

        playerLane.hidden = true;
        coverArt.classList.add('is-visible');
        coverArt.setAttribute('src', '/art/cover.jpg');
        expect(canInteractWithCoverFrame({ app, coverArt, playerLane } as never)).toBe(false);

        playerLane.hidden = false;
        coverArt.classList.remove('is-visible');
        expect(canInteractWithCoverFrame({ app, coverArt, playerLane } as never)).toBe(false);
    });

    it('returns true only when now playing is active and the cover art is visible', () => {
        const app = document.createElement('div');
        const coverArt = document.createElement('img');
        const playerLane = document.createElement('div');

        coverArt.classList.add('is-visible');
        coverArt.setAttribute('src', '/art/cover.jpg');

        expect(canInteractWithCoverFrame({ app, coverArt, playerLane } as never)).toBe(true);
    });
});

describe('overview album actions', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('resolves the overview track index from nested card content', () => {
        document.body.innerHTML = `
            <div id="overview-list">
                <button class="overview-album-card" data-overview-track-index="7" type="button">
                    <span class="overview-album-meta">
                        <span class="overview-album-title">Example Album</span>
                    </span>
                </button>
            </div>
        `;

        const container = document.querySelector('#overview-list') as HTMLDivElement;
        const nestedTitle = document.querySelector('.overview-album-title') as HTMLSpanElement;

        expect(resolveOverviewAlbumTrackIndex(container, nestedTitle)).toBe(7);
        expect(resolveOverviewAlbumTrackIndex(container, document.createElement('div'))).toBeNull();
    });

    it('opens the shared queue menu for overview album cards', () => {
        document.body.innerHTML = `
            <div id="overview-list">
                <button class="overview-album-card" data-overview-track-index="1" type="button">
                    <span class="overview-album-title">Second Album</span>
                </button>
            </div>
        `;

        const container = document.querySelector('#overview-list') as HTMLDivElement;
        const target = document.querySelector('.overview-album-title') as HTMLSpanElement;
        const openSidebarQueueMenu = vi.fn();
        const event = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 44,
            clientY: 88,
        });
        const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
        Object.defineProperty(event, 'target', { value: target });

        openOverviewAlbumContextMenu({
            tracks: [
                { path: '/music/library/first.flac' },
                { path: '/music/library/second.flac' },
            ] as never,
            openSidebarQueueMenu,
        }, container, event);

        expect(event.defaultPrevented).toBe(true);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(openSidebarQueueMenu).toHaveBeenCalledWith(44, 88, [1], 1, true, '/music/library/second.flac');
    });

    it('opens the shared queue menu for overview album grid cards', () => {
        document.body.innerHTML = `
            <div id="overview-grid">
                <div class="library-album-card overview-library-album-card" data-overview-grid-track-index="2">
                    <span class="library-album-cover">
                        <img class="library-album-cover-image" alt="Album cover">
                    </span>
                </div>
            </div>
        `;

        const container = document.querySelector('#overview-grid') as HTMLDivElement;
        const target = document.querySelector('.library-album-cover-image') as HTMLImageElement;
        const openSidebarQueueMenu = vi.fn();
        const event = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 52,
            clientY: 96,
        });
        const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
        Object.defineProperty(event, 'target', { value: target });

        openOverviewAlbumContextMenu({
            tracks: [
                { path: '/music/library/first.flac' },
                { path: '/music/library/second.flac' },
                { path: '/music/library/third.flac' },
            ] as never,
            openSidebarQueueMenu,
        }, container, event);

        expect(event.defaultPrevented).toBe(true);
        expect(stopPropagationSpy).toHaveBeenCalledTimes(1);
        expect(openSidebarQueueMenu).toHaveBeenCalledWith(52, 96, [2], 2, true, '/music/library/third.flac');
    });
});

describe('toggleTaskbarCoverView', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('switches from track view to overview and shows sidebar navigation', () => {
        const app = document.createElement('div');
        const libraryController = {
            setSidebarOpen: vi.fn(),
        };
        const sidebarController = {
            showNavigation: vi.fn(),
        };
        const showOverviewPage = vi.fn();
        const showNowPlayingPage = vi.fn();
        const refreshCurrentTrackMetadata = vi.fn(async () => undefined);

        toggleTaskbarCoverView({
            app,
            libraryController,
            sidebarController,
            showOverviewPage,
            showNowPlayingPage,
            refreshCurrentTrackMetadata,
        } as never);

        expect(showOverviewPage).toHaveBeenCalledTimes(1);
        expect(sidebarController.showNavigation).toHaveBeenCalledTimes(1);
        expect(showNowPlayingPage).not.toHaveBeenCalled();
        expect(libraryController.setSidebarOpen).not.toHaveBeenCalled();
        expect(refreshCurrentTrackMetadata).not.toHaveBeenCalled();
    });

    it('switches from overview back to track view and refreshes metadata', async () => {
        const app = document.createElement('div');
        app.classList.add('showing-overview');
        const libraryController = {
            setSidebarOpen: vi.fn(),
        };
        const sidebarController = {
            showNavigation: vi.fn(),
        };
        const showOverviewPage = vi.fn();
        const showNowPlayingPage = vi.fn();
        const refreshCurrentTrackMetadata = vi.fn(async () => undefined);

        toggleTaskbarCoverView({
            app,
            libraryController,
            sidebarController,
            showOverviewPage,
            showNowPlayingPage,
            refreshCurrentTrackMetadata,
        } as never);
        await flushPromises();

        expect(libraryController.setSidebarOpen).toHaveBeenCalledWith(false);
        expect(showNowPlayingPage).toHaveBeenCalledTimes(1);
        expect(refreshCurrentTrackMetadata).toHaveBeenCalledTimes(1);
        expect(showOverviewPage).not.toHaveBeenCalled();
        expect(sidebarController.showNavigation).not.toHaveBeenCalled();
    });
});

describe('handleExternalFileDrop', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('inserts dropped audio into the playlist before falling back to the play handler', async () => {
        const ensureTrackIndexForPath = vi.fn((path: string) => path.endsWith('drop.flac') ? 7 : -1);
        const playlistControllerHandleExternalTrackDrop = vi.fn(async () => true);
        const playlistControllerLoadPlaylistByPath = vi.fn(async () => true);
        const playDroppedTrackPath = vi.fn(async () => undefined);
        const handleDroppedFolderPath = vi.fn(async () => undefined);

        await handleExternalFileDrop({
            ensureTrackIndexForPath,
            handleDroppedFolderPath,
            playDroppedTrackPath,
            playlistControllerHandleExternalTrackDrop,
            playlistControllerLoadPlaylistByPath,
        }, 24, 48, ['C:/music/drop.flac']);

        expect(ensureTrackIndexForPath).toHaveBeenCalledWith('C:/music/drop.flac');
        expect(playlistControllerHandleExternalTrackDrop).toHaveBeenCalledWith(24, 48, [7]);
        expect(playDroppedTrackPath).not.toHaveBeenCalled();
        expect(playlistControllerLoadPlaylistByPath).not.toHaveBeenCalled();
        expect(handleDroppedFolderPath).not.toHaveBeenCalled();
    });

    it('falls back to playing dropped audio when the playlist does not handle the drop', async () => {
        const playlistControllerHandleExternalTrackDrop = vi.fn(async () => false);
        const playDroppedTrackPath = vi.fn(async () => undefined);

        await handleExternalFileDrop({
            ensureTrackIndexForPath: vi.fn(() => 3),
            handleDroppedFolderPath: vi.fn(async () => undefined),
            playDroppedTrackPath,
            playlistControllerHandleExternalTrackDrop,
            playlistControllerLoadPlaylistByPath: vi.fn(async () => true),
        }, 8, 16, ['C:/music/queued.flac']);

        expect(playlistControllerHandleExternalTrackDrop).toHaveBeenCalledWith(8, 16, [3]);
        expect(playDroppedTrackPath).toHaveBeenCalledWith('C:/music/queued.flac');
    });
});
