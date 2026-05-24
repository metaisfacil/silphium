import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    openFolderInFileBrowserMock,
} = vi.hoisted(() => ({
    openFolderInFileBrowserMock: vi.fn(async () => true),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    OpenFolderInFileBrowser: openFolderInFileBrowserMock,
    ResolveLibraryFolderForPath: vi.fn(async () => ''),
    RunCustomSendToAction: vi.fn(async () => true),
    GetLibraryFolderTrackCount: vi.fn(async () => 0),
    GetLibraryFolderTrackPaths: vi.fn(async () => []),
}));

import { createAppQueueMenuRuntime } from './app-queue-menu-runtime';

const createPlayOrderMenu = (): HTMLDivElement => {
    const menu = document.createElement('div');
    for (const mode of ['ordered-album', 'ordered-library', 'shuffle-album', 'shuffle-library']) {
        const item = document.createElement('button');
        item.className = 'play-order-item';
        item.dataset.playOrder = mode;
        menu.append(item);
    }

    return menu;
};

const createContext = ({ sidebarOpen }: { sidebarOpen: boolean }) => {
    const libraryController = {
        setSidebarAutoFolderPath: vi.fn(),
        isSidebarOpen: vi.fn(() => sidebarOpen),
        setSidebarOpen: vi.fn(),
        navigateToFolder: vi.fn(),
    };

    const sidebarController = {
        showLibrary: vi.fn(),
    };

    const context = {
        currentTrackIndex: 0,
        tracks: [{ folderPath: 'Library/Artist/Album', path: 'Library/Artist/Album/track.flac' }],
        libraryController,
        sidebarController,
    };

    return {
        context: context as unknown as Parameters<typeof createAppQueueMenuRuntime>[0],
        libraryController,
        sidebarController,
    };
};

describe('createAppQueueMenuRuntime openCurrentTrackFolderInSidebar', () => {
    it('switches to Library and opens the sidebar when closed', () => {
        const { context, libraryController, sidebarController } = createContext({ sidebarOpen: false });
        const runtime = createAppQueueMenuRuntime(context);

        runtime.openCurrentTrackFolderInSidebar();

        expect(sidebarController.showLibrary).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarAutoFolderPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(libraryController.setSidebarOpen).toHaveBeenCalledWith(true);
        expect(libraryController.navigateToFolder).not.toHaveBeenCalled();
    });

    it('switches to Library and navigates when the sidebar is already open', () => {
        const { context, libraryController, sidebarController } = createContext({ sidebarOpen: true });
        const runtime = createAppQueueMenuRuntime(context);

        runtime.openCurrentTrackFolderInSidebar();

        expect(sidebarController.showLibrary).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarAutoFolderPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(libraryController.setSidebarOpen).not.toHaveBeenCalled();
        expect(libraryController.navigateToFolder).toHaveBeenCalledWith('Library/Artist/Album');
    });
});

describe('createAppQueueMenuRuntime addSidebarSelectionToPlaylist', () => {
    it('shows an error and blocks append when duplicate prevention is enabled for the current track', async () => {
        const appendTracksToPlaylist = vi.fn(async () => true);
        const openErrorModal = vi.fn();
        const prompt = vi.fn(async () => ({
            selectedPath: '/playlists/demo.m3u8',
            duplicatePreventionEnabled: true,
        }));

        const context = {
            currentTrackIndex: 0,
            tracks: [
                { path: '/music/track-0.flac', folderPath: '/music' },
                { path: '/music/track-1.flac', folderPath: '/music' },
            ],
            playlistTargetModalController: { prompt },
            playlistController: {
                getAvailablePlaylistTargets: vi.fn(() => [{ path: '/playlists/demo.m3u8', label: 'demo.m3u8' }]),
                openPlaylistTarget: vi.fn(async () => null),
                createPlaylistTarget: vi.fn(async () => null),
                isTrackAlreadyInLoadedPlaylist: vi.fn(() => true),
                appendTracksToPlaylist,
            },
            openErrorModal,
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);

        await runtime.addSidebarSelectionToPlaylist({
            trackIndexes: [0],
            folderPath: '',
            folderLabel: '',
            folderTarget: false,
            trackIndexesScopedToSelection: true,
        });

        expect(openErrorModal).toHaveBeenCalledWith(
            'Track already in playlist',
            'The current track is already in the active playlist. Disable duplicate prevention to add it again.',
        );
        expect(appendTracksToPlaylist).not.toHaveBeenCalled();
    });

    it('allows append when duplicate prevention is disabled', async () => {
        const appendTracksToPlaylist = vi.fn(async () => true);
        const openErrorModal = vi.fn();
        const prompt = vi.fn(async () => ({
            selectedPath: '/playlists/demo.m3u8',
            duplicatePreventionEnabled: false,
        }));

        const context = {
            currentTrackIndex: 0,
            tracks: [
                { path: '/music/track-0.flac', folderPath: '/music' },
                { path: '/music/track-1.flac', folderPath: '/music' },
            ],
            playlistTargetModalController: { prompt },
            playlistController: {
                getAvailablePlaylistTargets: vi.fn(() => [{ path: '/playlists/demo.m3u8', label: 'demo.m3u8' }]),
                openPlaylistTarget: vi.fn(async () => null),
                createPlaylistTarget: vi.fn(async () => null),
                isTrackAlreadyInLoadedPlaylist: vi.fn(() => true),
                appendTracksToPlaylist,
            },
            openErrorModal,
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);

        await runtime.addSidebarSelectionToPlaylist({
            trackIndexes: [0],
            folderPath: '',
            folderLabel: '',
            folderTarget: false,
            trackIndexesScopedToSelection: true,
        });

        expect(appendTracksToPlaylist).toHaveBeenCalledWith('/playlists/demo.m3u8', [0]);
        expect(openErrorModal).not.toHaveBeenCalled();
    });
});

describe('createAppQueueMenuRuntime playSidebarQueueSelection', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('replaces the playback queue with the played selection so the first chosen track becomes queue position 0', async () => {
        const loadTrack = vi.fn(async () => undefined);
        const replacePlaybackQueue = vi.fn();
        const queueGaplessNextTrack = vi.fn(async () => undefined);
        const playCurrentTrack = vi.fn(async () => undefined);

        const context = {
            currentTrackIndex: 0,
            tracks: [
                { path: '/music/startup.flac', folderPath: '/music' },
                { path: '/music/album-1.flac', folderPath: '/music/album' },
                { path: '/music/album-2.flac', folderPath: '/music/album' },
                { path: '/music/album-3.flac', folderPath: '/music/album' },
            ],
            fullLibraryScanLoadActive: false,
            suppressAutoSelectAfterFullLibraryScan: false,
            playlistController: {
                replacePlaybackQueue,
            },
            loadTrack,
            queueGaplessNextTrack,
            playCurrentTrack,
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);
        await runtime.playSidebarQueueSelection([1, 2, 3]);

        expect(loadTrack).toHaveBeenCalledWith(1, true, [1, 2, 3], true);
        expect(replacePlaybackQueue).toHaveBeenCalledWith([1, 2, 3], 0);
        expect(queueGaplessNextTrack).toHaveBeenCalledWith(undefined, [1, 2, 3]);
        expect(playCurrentTrack).toHaveBeenCalledTimes(1);
        expect(loadTrack.mock.invocationCallOrder[0]).toBeLessThan(replacePlaybackQueue.mock.invocationCallOrder[0]);
        expect(replacePlaybackQueue.mock.invocationCallOrder[0]).toBeLessThan(playCurrentTrack.mock.invocationCallOrder[0]);
    });
});

describe('createAppQueueMenuRuntime menu positioning', () => {
    let animationFrameCallback: FrameRequestCallback | undefined;

    beforeEach(() => {
        animationFrameCallback = undefined;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback): number => {
            animationFrameCallback = callback;
            return 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('defers play-order menu measurement until the next animation frame', () => {
        const playOrderMenu = document.createElement('div');
        playOrderMenu.hidden = true;
        const getBoundingClientRect = vi.fn(() => ({
            width: 120,
            height: 40,
            top: 0,
            left: 0,
            right: 120,
            bottom: 40,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }));
        Object.defineProperty(playOrderMenu, 'getBoundingClientRect', {
            configurable: true,
            value: getBoundingClientRect,
        });

        const playPause = document.createElement('button');
        const context = {
            currentTrackIndex: 0,
            tracks: [{ folderPath: 'Library/Artist/Album', path: 'Library/Artist/Album/track.flac' }],
            playOrderMenu,
            playPause,
            trackMetaMenu: document.createElement('div'),
            trackMetaSendToList: document.createElement('div'),
            trackMetaSendToDivider: document.createElement('div'),
            trackMetaMenuTarget: null,
            trackMetaMenuActionScope: null,
            trackMetaMenuActionPath: '',
            trackMetaArtistFilterQuery: '',
            trackMetaFilterArtistBtn: document.createElement('button'),
            trackMetaArtistDivider: document.createElement('div'),
            closeListenBrainzFeedbackMenu: vi.fn(),
            playlistController: {
                getPlaybackOrderScopeLabel: () => 'Library',
            },
            playbackSequencingService: {
                getPlaybackOrderMode: vi.fn(() => 'ordered-library'),
                getPlaybackOrderLabel: vi.fn(() => 'Ordered'),
            },
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);
        runtime.openPlayOrderMenu(300, 200);

        expect(getBoundingClientRect).not.toHaveBeenCalled();
        expect(playOrderMenu.hidden).toBe(false);
        expect(animationFrameCallback).toBeTypeOf('function');

        animationFrameCallback?.(16);

        expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
        expect(playOrderMenu.style.left).toBe('300px');
        expect(playOrderMenu.style.top).toBe('200px');
    });

    it('relabels source-wide playback-order menu items for playlist playback', () => {
        const playOrderMenu = createPlayOrderMenu();
        const playPause = document.createElement('button');
        const context = {
            currentTrackIndex: 0,
            tracks: [{ folderPath: 'Library/Artist/Album', path: 'Library/Artist/Album/track.flac' }],
            playOrderMenu,
            playPause,
            trackMetaMenu: document.createElement('div'),
            trackMetaSendToList: document.createElement('div'),
            trackMetaSendToDivider: document.createElement('div'),
            trackMetaMenuTarget: null,
            trackMetaMenuActionScope: null,
            trackMetaMenuActionPath: '',
            trackMetaArtistFilterQuery: '',
            trackMetaFilterArtistBtn: document.createElement('button'),
            trackMetaArtistDivider: document.createElement('div'),
            closeListenBrainzFeedbackMenu: vi.fn(),
            playlistController: {
                getPlaybackOrderScopeLabel: () => 'Playlist',
            },
            playbackSequencingService: {
                getPlaybackOrderMode: vi.fn(() => 'shuffle-library'),
            },
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);
        runtime.updatePlayOrderMenuState();

        const labels = Array.from(playOrderMenu.querySelectorAll<HTMLButtonElement>('.play-order-item')).map((item) => item.textContent);
        expect(labels).toEqual([
            'Ordered: Album',
            'Ordered: Playlist',
            'Shuffle: Album',
            'Shuffle: Playlist',
        ]);
        expect(playPause.title).toBe('Playback order: Shuffle: Playlist (right-click to change)');
        expect(playOrderMenu.querySelector<HTMLButtonElement>('[data-play-order="shuffle-library"]')?.dataset.selected).toBe('true');
    });
});

describe('createAppQueueMenuRuntime sidebar open-in-browser action', () => {
    afterEach(() => {
        vi.clearAllMocks();
        delete (window as typeof window & { go?: unknown }).go;
    });

    it('shows a file browser action for file targets without track actions', () => {
        const context = {
            tracks: [],
            currentSettings: { customSendToActions: [] },
            sidebarQueueTrackIndexes: [],
            sidebarQueueFeedbackTrackIndex: null,
            sidebarQueueFolderPath: '',
            sidebarQueueFolderLabel: '',
            sidebarQueueFolderTarget: false,
            sidebarQueueTrackIndexesScopedToSelection: false,
            sidebarQueueFileActionPath: '',
            sidebarQueueIncludeFileActions: false,
            sidebarQueueSendToActionScope: null,
            queueConfirmResolver: null,
            trackMetaMenuTarget: null,
            trackMetaMenuActionScope: null,
            trackMetaMenuActionPath: '',
            trackMetaArtistFilterQuery: '',
            playOrderMenu: document.createElement('div'),
            trackMetaMenu: document.createElement('div'),
            trackMetaSendToList: document.createElement('div'),
            trackMetaSendToDivider: document.createElement('div'),
            trackMetaCopyFilePathBtn: document.createElement('button'),
            trackMetaCopyFolderPathBtn: document.createElement('button'),
            trackMetaCopyDivider: document.createElement('div'),
            trackMetaFilterArtistBtn: document.createElement('button'),
            trackMetaArtistDivider: document.createElement('div'),
            trackMetaParentFolderBtn: document.createElement('button'),
            trackMetaBrowserFolderBtn: document.createElement('button'),
            sidebarQueueMenu: document.createElement('div'),
            sidebarQueuePlay: document.createElement('button'),
            sidebarQueueAddNext: document.createElement('button'),
            sidebarQueueEnd: document.createElement('button'),
            sidebarQueueAddToPlaylist: document.createElement('button'),
            sidebarQueueBrowserActionsDivider: document.createElement('div'),
            sidebarQueueOpenInBrowser: document.createElement('button'),
            sidebarQueueTreeToggleDivider: document.createElement('div'),
            sidebarQueueTreeToggleBtn: document.createElement('button'),
            sidebarQueueSendToList: document.createElement('div'),
            sidebarQueueSendToDivider: document.createElement('div'),
            sidebarQueueFeedbackDivider: document.createElement('div'),
            sidebarQueueLove: document.createElement('button'),
            sidebarQueueHate: document.createElement('button'),
            playPause: document.createElement('button'),
            queueConfirmModal: document.createElement('div'),
            queueConfirmTitle: document.createElement('div'),
            queueConfirmMessage: document.createElement('div'),
            libraryBrowser: document.createElement('div'),
            libraryController: { navigateToFolder: vi.fn() },
            playlistController: { closeMenu: vi.fn() },
            playlistTargetModalController: { prompt: vi.fn() },
            sidebarController: { showLibrary: vi.fn() },
            socialController: { clearSelection: vi.fn() },
            playbackSequencingService: { getPlaybackOrderMode: vi.fn(() => 'ordered-library'), getPlaybackOrderLabel: vi.fn(() => 'Ordered') },
            sidebarQueueDescendantPromptThreshold: 200,
            closeListenBrainzFeedbackMenu: vi.fn(),
            hasListenBrainzScrobbling: vi.fn(() => false),
            ensureTrackIndexForPath: vi.fn(() => -1),
            ensureTrackTagsResolved: vi.fn(async () => undefined),
            submitListenBrainzFeedbackForTrack: vi.fn(async () => undefined),
            openErrorModal: vi.fn(),
            logFrontendMessage: vi.fn(async () => undefined),
            loadTrack: vi.fn(async () => undefined),
            queueGaplessNextTrack: vi.fn(async () => undefined),
            playCurrentTrack: vi.fn(async () => undefined),
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);
        runtime.openSidebarQueueMenu(15, 25, [], undefined, true, '/music/library/notes.txt');

        expect(context.sidebarQueuePlay.hidden).toBe(true);
        expect(context.sidebarQueueAddNext.hidden).toBe(true);
        expect(context.sidebarQueueEnd.hidden).toBe(true);
        expect(context.sidebarQueueAddToPlaylist.hidden).toBe(true);
        expect(context.sidebarQueueBrowserActionsDivider.hidden).toBe(true);
        expect(context.sidebarQueueOpenInBrowser.hidden).toBe(false);
        expect(context.sidebarQueueOpenInBrowser.textContent).toBe('Open file in browser');
    });

    it('routes the sidebar browser action to the backend file reveal method', async () => {
        const openFileInFileBrowser = vi.fn(async () => true);
        (window as typeof window & {
            go?: {
                main?: {
                    App?: {
                        OpenFileInFileBrowser?: (path: string) => Promise<boolean>;
                    };
                };
            };
        }).go = {
            main: {
                App: {
                    OpenFileInFileBrowser: openFileInFileBrowser,
                },
            },
        };

        const context = {
            sidebarQueueFolderTarget: false,
            sidebarQueueFolderPath: '',
            sidebarQueueFileActionPath: '/music/library/notes.txt',
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);
        await runtime.openSidebarQueueItemInFileBrowser();

        expect(openFileInFileBrowser).toHaveBeenCalledWith('/music/library/notes.txt');
        expect(openFolderInFileBrowserMock).not.toHaveBeenCalled();
    });

    it('shows the artist filter action only for artist menus and always shows its divider when visible', () => {
        const context = {
            currentTrackIndex: 0,
            tracks: [{ folderPath: 'Library/Artist/Album', path: 'Library/Artist/Album/track.flac' }],
            currentSettings: { customSendToActions: [] },
            sidebarQueueTrackIndexes: [],
            sidebarQueueFeedbackTrackIndex: null,
            sidebarQueueFolderPath: '',
            sidebarQueueFolderLabel: '',
            sidebarQueueFolderTarget: false,
            sidebarQueueTrackIndexesScopedToSelection: false,
            sidebarQueueFileActionPath: '',
            sidebarQueueIncludeFileActions: false,
            sidebarQueueSendToActionScope: null,
            queueConfirmResolver: null,
            trackMetaMenuTarget: null,
            trackMetaMenuActionScope: null,
            trackMetaMenuActionPath: '',
            trackMetaArtistFilterQuery: '',
            playOrderMenu: document.createElement('div'),
            trackMetaMenu: document.createElement('div'),
            trackMetaSendToList: document.createElement('div'),
            trackMetaSendToDivider: document.createElement('div'),
            trackMetaCopyFilePathBtn: document.createElement('button'),
            trackMetaCopyFolderPathBtn: document.createElement('button'),
            trackMetaCopyDivider: document.createElement('div'),
            trackMetaFilterArtistBtn: document.createElement('button'),
            trackMetaArtistDivider: document.createElement('div'),
            trackMetaParentFolderBtn: document.createElement('button'),
            trackMetaBrowserFolderBtn: document.createElement('button'),
            trackMetaOpenMbBtn: document.createElement('button'),
            sidebarQueueMenu: document.createElement('div'),
            sidebarQueuePlay: document.createElement('button'),
            sidebarQueueAddNext: document.createElement('button'),
            sidebarQueueEnd: document.createElement('button'),
            sidebarQueueAddToPlaylist: document.createElement('button'),
            sidebarQueueBrowserActionsDivider: document.createElement('div'),
            sidebarQueueOpenInBrowser: document.createElement('button'),
            sidebarQueueTreeToggleDivider: document.createElement('div'),
            sidebarQueueTreeToggleBtn: document.createElement('button'),
            sidebarQueueSendToList: document.createElement('div'),
            sidebarQueueSendToDivider: document.createElement('div'),
            sidebarQueueFeedbackDivider: document.createElement('div'),
            sidebarQueueLove: document.createElement('button'),
            sidebarQueueHate: document.createElement('button'),
            playPause: document.createElement('button'),
            queueConfirmModal: document.createElement('div'),
            queueConfirmTitle: document.createElement('div'),
            queueConfirmMessage: document.createElement('div'),
            libraryBrowser: document.createElement('div'),
            libraryController: { navigateToFolder: vi.fn() },
            playlistController: { closeMenu: vi.fn(), getPlaybackOrderScopeLabel: () => 'Library' },
            playlistTargetModalController: { prompt: vi.fn() },
            sidebarController: { showLibrary: vi.fn() },
            socialController: { clearSelection: vi.fn() },
            playbackSequencingService: { getPlaybackOrderMode: vi.fn(() => 'ordered-library'), getPlaybackOrderLabel: vi.fn(() => 'Ordered') },
            sidebarQueueDescendantPromptThreshold: 200,
            closeListenBrainzFeedbackMenu: vi.fn(),
            hasListenBrainzScrobbling: vi.fn(() => false),
            ensureTrackIndexForPath: vi.fn(() => -1),
            ensureTrackTagsResolved: vi.fn(async () => undefined),
            submitListenBrainzFeedbackForTrack: vi.fn(async () => undefined),
            openErrorModal: vi.fn(),
            logFrontendMessage: vi.fn(async () => undefined),
            loadTrack: vi.fn(async () => undefined),
            queueGaplessNextTrack: vi.fn(async () => undefined),
            playCurrentTrack: vi.fn(async () => undefined),
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);

        runtime.openTrackMetaMenu(12, 18, false, 'none', null, '', 'mbid-artist:artist-id', false);
        expect(context.trackMetaFilterArtistBtn.hidden).toBe(true);
        expect(context.trackMetaArtistDivider.hidden).toBe(true);

        runtime.openTrackMetaMenu(12, 18, false, 'none', null, '', 'mbid-artist:artist-id', true);
        expect(context.trackMetaFilterArtistBtn.hidden).toBe(false);
        expect(context.trackMetaArtistDivider.hidden).toBe(false);

        runtime.openTrackMetaMenu(12, 18, true, 'none', null, '', '', true);
        expect(context.trackMetaFilterArtistBtn.hidden).toBe(true);
        expect(context.trackMetaArtistDivider.hidden).toBe(true);

        runtime.closeTrackMetaMenu();
        expect(context.trackMetaFilterArtistBtn.hidden).toBe(true);
        expect(context.trackMetaArtistDivider.hidden).toBe(true);
    });
});
