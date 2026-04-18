import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageLibraryFile, LibraryBrowserEntry, LibraryFolderPage, LibrarySearchPage, TextLibraryFile, Track } from '../types/app-types';
import { createLibraryController } from './library-controller';
import { createLibraryControllerState, type LibraryControllerOptions, type LibraryControllerState } from './library-controller-types';

const flushPromises = async (): Promise<void> => {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }
};

const waitForCondition = async (assertion: () => void): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            assertion();
            return;
        } catch (error) {
            lastError = error;
            await flushPromises();
        }
    }

    throw lastError;
};

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Track 0',
    name: 'Track 0',
    path: '/music/library/artist-one/album-one/01 Intro.flac',
    relativePath: 'Library/Artist One/Album One/01 Intro.flac',
    folderPath: 'Library/Artist One/Album One',
    rootPath: '/music/library',
    rootName: 'Library',
    displayTitle: 'Track 0',
    displayAlbum: 'Album One',
    displayArtist: 'Artist One',
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
    ...overrides,
});

const createFolderPage = (folderPath: string, entries: LibraryBrowserEntry[]): LibraryFolderPage => ({
    folderPath,
    offset: 0,
    limit: 100,
    totalEntries: entries.length,
    entries,
});

const createSearchPage = (query: string, entries: LibraryBrowserEntry[]): LibrarySearchPage => ({
    query,
    offset: 0,
    limit: 100,
    totalEntries: entries.length,
    entries,
});

const createSearchPageSlice = (query: string, entries: LibraryBrowserEntry[], offset: number, totalEntries: number): LibrarySearchPage => ({
    query,
    offset,
    limit: 100,
    totalEntries,
    entries,
});

const mountLibraryController = (overrides?: {
    loadFolderPage?: (folderPath: string, sortMode: LibraryControllerOptions['loadFolderPage'] extends (folderPath: string, sortMode: infer T, offset: number, limit: number) => Promise<LibraryFolderPage> ? T : never, offset: number, limit: number) => Promise<LibraryFolderPage>;
    searchLibrary?: (query: string, offset: number, limit: number) => Promise<LibrarySearchPage>;
    state?: LibraryControllerState;
    tracks?: Track[];
    imageFiles?: ImageLibraryFile[];
    readImageThumbnail?: LibraryControllerOptions['readImageThumbnail'];
    getFolderCoverPath?: (folderPath: string) => string;
    getReleaseDepthForTrack?: (track: Track) => number;
}) => {
    document.body.innerHTML = `
        <div id="app">
            <button id="sidebar-toggle" type="button"></button>
            <aside id="library-sidebar"></aside>
            <span id="library-scan-yield"></span>
            <button id="library-expand-toggle" type="button"></button>
            <button id="library-back" type="button"></button>
            <p id="library-path"></p>
            <input id="library-search" type="text">
               <select id="library-sort"><option value="name">Name</option><option value="date-desc">Newest</option><option value="date-asc">Oldest</option></select>
            <div id="library-browser"></div>
        </div>
    `;

    const app = document.querySelector('#app') as HTMLElement;
    const sidebarToggle = document.querySelector('#sidebar-toggle') as HTMLButtonElement;
    const librarySidebar = document.querySelector('#library-sidebar') as HTMLElement;
    const libraryScanYieldIndicator = document.querySelector('#library-scan-yield') as HTMLSpanElement;
    const libraryExpandToggle = document.querySelector('#library-expand-toggle') as HTMLButtonElement;
    const libraryBack = document.querySelector('#library-back') as HTMLButtonElement;
    const libraryPath = document.querySelector('#library-path') as HTMLParagraphElement;
    const librarySearch = document.querySelector('#library-search') as HTMLInputElement;
    const librarySort = document.querySelector('#library-sort') as HTMLSelectElement;
    const libraryBrowser = document.querySelector('#library-browser') as HTMLElement;

    const tracks: Track[] = overrides?.tracks || [
        createTrack(),
        createTrack({
            title: 'Track 1',
            name: 'Track 1',
            path: '/music/library/artist-two/album-two/02 Outro.flac',
            relativePath: 'Library/Artist Two/Album Two/02 Outro.flac',
            folderPath: 'Library/Artist Two/Album Two',
            displayTitle: 'Track 1',
            displayAlbum: 'Album Two',
            displayArtist: 'Artist Two',
        }),
    ];

    const textFiles: TextLibraryFile[] = [];
    const imageFiles: ImageLibraryFile[] = overrides?.imageFiles || [];

    const folderTrackEntry: LibraryBrowserEntry = {
        kind: 'track',
        name: '01 Intro.flac',
        path: tracks[0].path,
        folderPath: 'Library/Artist One',
        relativePath: tracks[0].relativePath,
    };
    const folderChildEntry: LibraryBrowserEntry = {
        kind: 'folder',
        name: 'Album One',
        path: 'Library/Artist One/Album One',
        folderPath: 'Library/Artist One',
        relativePath: 'Library/Artist One/Album One',
    };
    const searchTrackEntry: LibraryBrowserEntry = {
        kind: 'track',
        name: '01 Intro.flac',
        path: tracks[0].path,
        folderPath: 'Library/Artist One/Album One',
        relativePath: tracks[0].relativePath,
    };
    const searchTrackEntryTwo: LibraryBrowserEntry = {
        kind: 'track',
        name: '02 Outro.flac',
        path: tracks[1].path,
        folderPath: 'Library/Artist Two/Album Two',
        relativePath: tracks[1].relativePath,
    };

    const loadFolderPage = overrides?.loadFolderPage
        ? vi.fn(overrides.loadFolderPage)
        : vi.fn(async (folderPath: string) => {
            if (folderPath === 'Library/Artist One') {
                return createFolderPage(folderPath, [folderChildEntry, folderTrackEntry]);
            }

            if (folderPath === 'Library/Artist Two') {
                return createFolderPage(folderPath, []);
            }

            return createFolderPage(folderPath, []);
        });
    const searchLibrary = overrides?.searchLibrary || vi.fn(async (query: string) => {
        const normalizedQuery = query.trim().toLowerCase();
        if (normalizedQuery === 'intro') {
            return createSearchPage(query, [searchTrackEntry]);
        }

        if (normalizedQuery === 'artist') {
            return createSearchPage(query, [searchTrackEntry, searchTrackEntryTwo]);
        }

        return createSearchPage(query, []);
    });
    const onFolderQueueRequested = vi.fn(() => undefined);
    const onSidebarClosed = vi.fn(() => undefined);

    const readImageThumbnailMock = overrides?.readImageThumbnail
        ? vi.fn(overrides.readImageThumbnail)
        : vi.fn(async (_path: string, _maxEdge: number) => ({
            base64: 'thumb',
            mimeType: 'image/jpeg',
        }));

    const controller = createLibraryController({
        app,
        sidebarToggle,
        librarySidebar,
        libraryScanYieldIndicator,
        libraryExpandToggle,
        libraryBack,
        libraryPath,
        librarySearch,
           librarySort,
        libraryBrowser,
        state: overrides?.state,
        getTracks: () => tracks,
        getTextFiles: () => textFiles,
        getImageFiles: () => imageFiles,
        getCurrentTrackIndex: () => 0,
        loadFolderPage,
        resolveLibraryFolderForAbsolutePath: vi.fn(async () => ''),
        isFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
        searchLibrary,
        getReleaseDepthForTrack: overrides?.getReleaseDepthForTrack || (() => 2),
        getFolderCoverPath: overrides?.getFolderCoverPath || ((folderPath: string) => folderPath === 'Library/Artist One/Album One' ? '/music/library/artist-one/album-one/cover.jpg' : ''),
        readImageThumbnail: async (path: string, maxEdge: number) => await readImageThumbnailMock(path, maxEdge),
        getHighlightMusicBrainzTaggedAlbumFolders: () => false,
        resolveTrackIndex: (path: string) => tracks.findIndex((track) => track.path === path),
        resolveTextFileIndex: () => -1,
        resolveImageFileIndex: () => -1,
        onTrackChosen: vi.fn(() => undefined),
        onTextFileChosen: vi.fn(() => undefined),
        onImageFileChosen: vi.fn(() => undefined),
        onQueueRequested: vi.fn(() => undefined),
        onFolderQueueRequested,
        onSidebarClosed,
    });

    return {
        controller,
        librarySearch,
        librarySort,
        libraryBrowser,
        readImageThumbnail: readImageThumbnailMock,
        searchLibrary,
        loadFolderPage,
        onFolderQueueRequested,
        onSidebarClosed,
        trackPath: searchTrackEntry.path,
    };
};

describe('createLibraryController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
            matches: false,
            media: '(prefers-reduced-motion: reduce)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => false),
        })));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('opens the sidebar, runs a debounced search, and clears it with Escape', async () => {
        const { controller, librarySearch, libraryBrowser, loadFolderPage, searchLibrary, trackPath } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        expect(loadFolderPage).toHaveBeenCalledWith('Library/Artist One', 'name', 0, 100);
        expect(controller.isSidebarOpen()).toBe(true);
        expect(controller.getCurrentFolderPath()).toBe('Library/Artist One');
        expect(libraryBrowser.querySelector(`[data-track-path="${trackPath}"]`)).not.toBeNull();

        librarySearch.value = 'intro';
        librarySearch.dispatchEvent(new Event('input', { bubbles: true }));

        expect(controller.getLibrarySearchStateSnapshot()).toMatchObject({ query: 'intro', pending: true });
        expect(libraryBrowser.textContent).toContain('Searching...');

        await vi.advanceTimersByTimeAsync(180);
        await flushPromises();

        expect(searchLibrary).toHaveBeenCalledWith('intro', 0, 100);
        expect(controller.isLibrarySearchActive()).toBe(true);
        expect(controller.getLibrarySearchStateSnapshot().result?.entries).toHaveLength(1);

        librarySearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await flushPromises();

        expect(controller.getLibrarySearchQuery()).toBe('');
        expect(controller.isLibrarySearchActive()).toBe(false);
        expect(libraryBrowser.querySelector(`[data-track-path="${trackPath}"]`)).not.toBeNull();
    });

    it('starts a programmatic library search and updates the input value', async () => {
        const { controller, librarySearch, searchLibrary } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.startLibrarySearch('Track 0');

        expect(librarySearch.value).toBe('Track 0');
        expect(controller.getLibrarySearchQuery()).toBe('Track 0');
        expect(controller.isLibrarySearchActive()).toBe(true);

        await vi.advanceTimersByTimeAsync(180);
        await flushPromises();

        expect(searchLibrary).toHaveBeenCalledWith('track 0', 0, 100);
    });

    it('can expand all filtered folders for a programmatic library search', async () => {
        const { controller } = mountLibraryController({
            searchLibrary: async (query: string) => createSearchPage(query, [
                {
                    kind: 'folder',
                    path: 'Library/Artist One',
                    name: 'Artist One',
                    folderPath: 'Library',
                    relativePath: 'Library/Artist One',
                    modifiedAtMs: 0,
                },
                {
                    kind: 'folder',
                    path: 'Library/Artist One/Album One',
                    name: 'Album One',
                    folderPath: 'Library/Artist One',
                    relativePath: 'Library/Artist One/Album One',
                    modifiedAtMs: 0,
                },
                {
                    kind: 'track',
                    path: '/music/library/artist-one/album-one/01 Intro.flac',
                    name: '01 Intro.flac',
                    folderPath: 'Library/Artist One/Album One',
                    relativePath: 'Library/Artist One/Album One/01 Intro.flac',
                    modifiedAtMs: 0,
                },
            ]),
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.startLibrarySearch('mbid-artist:test', { expandFilteredFolders: true });

        await vi.advanceTimersByTimeAsync(220);
        await flushPromises();

        expect(controller.getLibrarySearchStateSnapshot().expandedFolderPaths).toEqual([
            'Library',
            'Library/Artist One',
            'Library/Artist One/Album One',
        ]);
    });

    it('renders an expanded album grid and shrinks back when the search input is used', async () => {
        const { controller, libraryBrowser, librarySearch } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        expect(controller.isSidebarExpanded()).toBe(true);
        const albumButton = libraryBrowser.querySelector('[data-folder-path="Library/Artist One/Album One"]') as HTMLButtonElement | null;
        expect(albumButton).not.toBeNull();
        expect(albumButton?.title).toBe('Library/Artist One/Album One');
        expect(libraryBrowser.querySelector('.library-album-title')).toBeNull();
        expect(libraryBrowser.querySelector('.library-album-artist')).toBeNull();

        librarySearch.value = 'intro';
        librarySearch.dispatchEvent(new Event('input', { bubbles: true }));

        expect(controller.isSidebarExpanded()).toBe(false);
    });

    it('eagerly hydrates the first expanded album covers', async () => {
        const { controller, libraryBrowser, readImageThumbnail } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        const firstCoverImage = libraryBrowser.querySelector('.library-album-cover-image') as HTMLImageElement | null;
        expect(firstCoverImage).not.toBeNull();
        await waitForCondition(() => {
            expect(readImageThumbnail).toHaveBeenCalledWith('/music/library/artist-one/album-one/cover.jpg', 420);
            expect(firstCoverImage?.getAttribute('src')).toBe('data:image/jpeg;base64,thumb');
            expect(firstCoverImage?.dataset.coverLoaded).toBe('true');
            expect(firstCoverImage?.closest('.library-album-cover')?.classList.contains('has-image')).toBe(true);
        });
    });

    it('shows a cover skeleton until a thumbnail finishes loading', async () => {
        let resolveThumbnail: ((value: { base64: string; mimeType: string }) => void) | null = null;
        const readImageThumbnail = vi.fn(async (_path: string, _maxEdge: number) => {
            return await new Promise<{ base64: string; mimeType: string }>((resolve) => {
                resolveThumbnail = resolve;
            });
        });
        const { controller, libraryBrowser } = mountLibraryController({
            readImageThumbnail,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        const firstCover = libraryBrowser.querySelector('.library-album-cover') as HTMLElement | null;
        const firstCoverImage = libraryBrowser.querySelector('.library-album-cover-image') as HTMLImageElement | null;
        const firstCoverSkeleton = libraryBrowser.querySelector('.library-album-cover-skeleton') as HTMLElement | null;
        expect(firstCover).not.toBeNull();
        expect(firstCoverImage).not.toBeNull();
        expect(firstCoverSkeleton).not.toBeNull();
        expect(firstCover?.classList.contains('is-loading')).toBe(true);
        expect(firstCoverImage?.getAttribute('src')).toBeNull();

        expect(resolveThumbnail).not.toBeNull();
        resolveThumbnail!({
            base64: 'thumb',
            mimeType: 'image/jpeg',
        });
        await flushPromises();

        await waitForCondition(() => {
            expect(firstCover?.classList.contains('is-loading')).toBe(false);
            expect(firstCover?.classList.contains('has-image')).toBe(true);
            expect(firstCoverImage?.getAttribute('src')).toBe('data:image/jpeg;base64,thumb');
        });
    });

    it('animates into album view by mounting a transitional browser pane', async () => {
        const { controller, libraryBrowser } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        expect(libraryBrowser.querySelectorAll('.library-browser-pane')).toHaveLength(1);

        controller.setSidebarExpanded(true);
        await flushPromises();

        expect(libraryBrowser.querySelectorAll('.library-browser-pane')).toHaveLength(2);
        expect(libraryBrowser.querySelector('.library-album-grid-pane')).not.toBeNull();

        await vi.advanceTimersByTimeAsync(260);
        await flushPromises();

        expect(libraryBrowser.querySelectorAll('.library-browser-pane')).toHaveLength(1);
        expect(libraryBrowser.querySelector('.library-album-grid-pane')).not.toBeNull();
    });

    it('only hydrates mounted album covers instead of the full library upfront', async () => {
        const tracks = Array.from({ length: 160 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        const readImageThumbnail = vi.fn(async (_path: string, _maxEdge: number) => ({
            base64: 'thumb',
            mimeType: 'image/jpeg',
        }));
        const { controller } = mountLibraryController({
            tracks,
            readImageThumbnail,
            getFolderCoverPath: (folderPath: string) => `/covers/${folderPath.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        await waitForCondition(() => {
            expect(readImageThumbnail).toHaveBeenCalled();
        });

        expect(readImageThumbnail.mock.calls.length).toBeLessThan(tracks.length);
    });

    it('limits concurrent album thumbnail loads while browsing album view', async () => {
        const tracks = Array.from({ length: 40 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        let activeThumbnailLoads = 0;
        let maxConcurrentThumbnailLoads = 0;
        const pendingThumbnailResolvers: Array<() => void> = [];
        const readImageThumbnail = vi.fn(async (_path: string, _maxEdge: number) => {
            activeThumbnailLoads += 1;
            maxConcurrentThumbnailLoads = Math.max(maxConcurrentThumbnailLoads, activeThumbnailLoads);

            await new Promise<void>((resolve) => {
                pendingThumbnailResolvers.push(() => {
                    activeThumbnailLoads -= 1;
                    resolve();
                });
            });

            return {
                base64: 'thumb',
                mimeType: 'image/jpeg',
            };
        });
        const { controller } = mountLibraryController({
            tracks,
            readImageThumbnail,
            getFolderCoverPath: (folderPath: string) => `/covers/${folderPath.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        await waitForCondition(() => {
            expect(readImageThumbnail).toHaveBeenCalledTimes(4);
        });

        expect(maxConcurrentThumbnailLoads).toBe(4);

        while (pendingThumbnailResolvers.length > 0) {
            const resolvers = pendingThumbnailResolvers.splice(0, pendingThumbnailResolvers.length);
            resolvers.forEach((resolve) => {
                resolve();
            });
            await flushPromises();
        }
    });

    it('reuses overlapping album card elements when the virtualized window shifts', async () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });

        const tracks = Array.from({ length: 160 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            getFolderCoverPath: (folderPath: string) => `/covers/${folderPath.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        const persistentAlbumSelector = '[data-folder-path="Library/Artist 12/Album 12"]';
        await waitForCondition(() => {
            expect(libraryBrowser.querySelector(persistentAlbumSelector)).not.toBeNull();
        });

        const albumPane = libraryBrowser.querySelector('.library-album-grid-pane') as HTMLDivElement | null;
        const albumButtonBeforeScroll = libraryBrowser.querySelector(persistentAlbumSelector) as HTMLButtonElement | null;
        const albumImageBeforeScroll = albumButtonBeforeScroll?.querySelector('.library-album-cover-image') as HTMLImageElement | null;
        expect(albumPane).not.toBeNull();
        expect(albumButtonBeforeScroll).not.toBeNull();
        expect(albumImageBeforeScroll).not.toBeNull();

        albumPane!.scrollTop = 320;
        albumPane!.dispatchEvent(new Event('scroll'));
        await flushPromises();

        await waitForCondition(() => {
            expect(libraryBrowser.querySelector(persistentAlbumSelector)).toBe(albumButtonBeforeScroll);
        });

        const albumButtonAfterScroll = libraryBrowser.querySelector(persistentAlbumSelector) as HTMLButtonElement | null;
        const albumImageAfterScroll = albumButtonAfterScroll?.querySelector('.library-album-cover-image') as HTMLImageElement | null;
        expect(albumButtonAfterScroll).toBe(albumButtonBeforeScroll);
        expect(albumImageAfterScroll).toBe(albumImageBeforeScroll);
    });

    it('disposes album card image bindings once a card leaves the virtualized window', async () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });

        const tracks = Array.from({ length: 160 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            getFolderCoverPath: (folderPath: string) => `/covers/${folderPath.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        const albumPane = libraryBrowser.querySelector('.library-album-grid-pane') as HTMLDivElement | null;
        const firstAlbumButton = libraryBrowser.querySelector('[data-folder-path="Library/Artist 0/Album 0"]') as HTMLButtonElement | null;
        const firstAlbumImage = firstAlbumButton?.querySelector('.library-album-cover-image') as HTMLImageElement | null;
        expect(albumPane).not.toBeNull();
        expect(firstAlbumButton).not.toBeNull();
        expect(firstAlbumImage).not.toBeNull();

        await waitForCondition(() => {
            expect(firstAlbumImage?.getAttribute('src')).toBe('data:image/jpeg;base64,thumb');
        });

        albumPane!.scrollTop = 1500;
        albumPane!.dispatchEvent(new Event('scroll'));
        await flushPromises();

        await waitForCondition(() => {
            expect(firstAlbumButton?.isConnected).toBe(false);
        });

        expect(firstAlbumImage?.hasAttribute('src')).toBe(false);
        expect(firstAlbumImage?.dataset.coverPath).toBeUndefined();
    });

    it('mounts more album cards when the expanded cover viewport grows', async () => {
        let paneHeight = 240;
        let resizeObserverCallback: ResizeObserverCallback | null = null;
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback: ResizeObserverCallback) {
                resizeObserverCallback = callback;
            }

            observe(): void {
                return undefined;
            }

            disconnect(): void {
                return undefined;
            }

            unobserve(): void {
                return undefined;
            }
        });
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return paneHeight;
            }

            return 720;
        });

        const tracks = Array.from({ length: 160 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            getFolderCoverPath: (folderPath: string) => `/covers/${folderPath.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        await waitForCondition(() => {
            expect(libraryBrowser.querySelectorAll('.library-album-card').length).toBeGreaterThan(0);
        });

        const initialCardCount = libraryBrowser.querySelectorAll('.library-album-card').length;
        await waitForCondition(() => {
            expect(resizeObserverCallback).not.toBeNull();
        });
        paneHeight = 480;
        resizeObserverCallback!([], {} as ResizeObserver);
        await flushPromises();

        await waitForCondition(() => {
            expect(libraryBrowser.querySelectorAll('.library-album-card').length).toBeGreaterThan(initialCardCount);
        });
    });

    it('disables the album-view bottom fade once the pane reaches the end of the scroll range', async () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });

        const tracks = Array.from({ length: 160 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            getFolderCoverPath: (folderPath: string) => `/covers/${folderPath.replace(/\s+/g, '-').toLowerCase()}.jpg`,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        const albumPane = libraryBrowser.querySelector('.library-album-grid-pane') as HTMLDivElement | null;
        expect(albumPane).not.toBeNull();
        Object.defineProperty(albumPane!, 'scrollHeight', {
            configurable: true,
            get: () => 1200,
        });
        albumPane!.dispatchEvent(new Event('scroll'));
        await flushPromises();

        await waitForCondition(() => {
            expect(albumPane?.classList.contains('has-bottom-fade')).toBe(true);
        });

        albumPane!.scrollTop = 960;
        albumPane!.dispatchEvent(new Event('scroll'));
        await flushPromises();

        await waitForCondition(() => {
            expect(albumPane?.classList.contains('has-bottom-fade')).toBe(false);
        });
    });

    it('restores the first album cover after scrolling away and back again', async () => {
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function(this: HTMLElement) {
            if (this.classList.contains('library-album-grid-pane')) {
                return 240;
            }

            return 720;
        });

        const tracks = Array.from({ length: 800 }, (_, index) => createTrack({
            title: `Track ${index}`,
            name: `Track ${index}`,
            path: `/music/library/artist-${index}/album-${index}/01 Track.flac`,
            relativePath: `Library/Artist ${index}/Album ${index}/01 Track.flac`,
            folderPath: `Library/Artist ${index}/Album ${index}`,
            displayAlbum: `Album ${index}`,
            displayArtist: `Artist ${index}`,
        }));
        const firstCoverPath = '/covers/artist-0/album-0.jpg';
        const readImageThumbnail = vi.fn(async (_path: string, _maxEdge: number) => ({
            base64: 'thumb',
            mimeType: 'image/jpeg',
        }));
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            readImageThumbnail,
            getFolderCoverPath: (folderPath: string) => {
                const normalizedFolderPath = folderPath
                    .replace(/^Library\//, '')
                    .replace(/\s+/g, '-')
                    .replace(/\/+/g, '/')
                    .toLowerCase();
                return `/covers/${normalizedFolderPath}.jpg`;
            },
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist 0');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        const countCallsForCoverPath = (coverPath: string): number => {
            return readImageThumbnail.mock.calls.filter(([path]) => path === coverPath).length;
        };

        await waitForCondition(() => {
            expect(countCallsForCoverPath(firstCoverPath)).toBe(1);
        });
        const initialThumbnailLoadCount = readImageThumbnail.mock.calls.length;

        const albumPane = libraryBrowser.querySelector('.library-album-grid-pane') as HTMLDivElement | null;
        expect(albumPane).not.toBeNull();
        let lastThumbnailLoadCount = initialThumbnailLoadCount;
        for (const scrollTop of [1500, 3000, 4500, 6000, 7500, 9000]) {
            albumPane!.scrollTop = scrollTop;
            albumPane!.dispatchEvent(new Event('scroll'));
            await flushPromises();

            await waitForCondition(() => {
                expect(readImageThumbnail.mock.calls.length).toBeGreaterThan(lastThumbnailLoadCount);
            });
            lastThumbnailLoadCount = readImageThumbnail.mock.calls.length;
        }

        albumPane!.scrollTop = 0;
        albumPane!.dispatchEvent(new Event('scroll'));
        await flushPromises();

        await waitForCondition(() => {
            const firstAlbumImage = libraryBrowser.querySelector('[data-folder-path="Library/Artist 0/Album 0"] .library-album-cover-image') as HTMLImageElement | null;
            expect(firstAlbumImage?.dataset.coverLoaded).toBe('true');
            expect(firstAlbumImage?.getAttribute('src')).toBe('data:image/jpeg;base64,thumb');
        });
    });

    it('groups multi-disc releases into one card at the configured release depth', async () => {
        const tracks = [
            createTrack({
                path: '/music/library/artist-one/album-one/disc-1/01 Intro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 1/01 Intro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 1',
                displayAlbum: 'Disc 1',
            }),
            createTrack({
                title: 'Track 1',
                name: 'Track 1',
                path: '/music/library/artist-one/album-one/disc-2/02 Outro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 2/02 Outro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 2',
                displayAlbum: 'Disc 2',
            }),
        ];
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            getReleaseDepthForTrack: () => 2,
            getFolderCoverPath: (folderPath: string) => folderPath === 'Library/Artist One/Album One' ? '/music/library/artist-one/album-one/cover.jpg' : '',
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        await waitForCondition(() => {
            expect(libraryBrowser.querySelectorAll('.library-album-card')).toHaveLength(1);
        });

        const albumButton = libraryBrowser.querySelector('[data-folder-path="Library/Artist One/Album One"]') as HTMLButtonElement | null;
        expect(albumButton).not.toBeNull();
        expect(albumButton?.title).toBe('Library/Artist One/Album One');
    });

    it('recursively finds a cover image inside a grouped multi-disc album subtree', async () => {
        const tracks = [
            createTrack({
                path: '/music/library/artist-one/album-one/disc-1/01 Intro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 1/01 Intro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 1',
                displayAlbum: 'Disc 1',
            }),
            createTrack({
                title: 'Track 1',
                name: 'Track 1',
                path: '/music/library/artist-one/album-one/disc-2/02 Outro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 2/02 Outro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 2',
                displayAlbum: 'Disc 2',
            }),
        ];
        const imageFiles: ImageLibraryFile[] = [{
            name: 'cover.jpg',
            path: '/music/library/artist-one/album-one/disc-1/cover.jpg',
            relativePath: 'Library/Artist One/Album One/Disc 1/cover.jpg',
            folderPath: 'Library/Artist One/Album One/Disc 1',
            rootPath: '/music/library',
            rootName: 'Library',
        }];
        const readImageThumbnail = vi.fn(async (_path: string, _maxEdge: number) => ({
            base64: 'thumb',
            mimeType: 'image/jpeg',
        }));
        const { controller, libraryBrowser } = mountLibraryController({
            tracks,
            imageFiles,
            readImageThumbnail,
            getReleaseDepthForTrack: () => 2,
            getFolderCoverPath: () => '',
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setSidebarExpanded(true);
        await flushPromises();

        await waitForCondition(() => {
            expect(readImageThumbnail).toHaveBeenCalledWith('/music/library/artist-one/album-one/disc-1/cover.jpg', 420);
        });

        expect(libraryBrowser.querySelector('[data-folder-path="Library/Artist One/Album One"]')).not.toBeNull();
    });

    it('reloads the current folder when the browser sort mode changes', async () => {
        const { controller, librarySort, loadFolderPage } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        expect(loadFolderPage).toHaveBeenCalledWith('Library/Artist One', 'name', 0, 100);

        librarySort.value = 'date-desc';
        librarySort.dispatchEvent(new Event('change', { bubbles: true }));
        await flushPromises();

        expect(loadFolderPage).toHaveBeenLastCalledWith('Library/Artist One', 'date-desc', 0, 100);
        expect(controller.getLibraryBrowserSortMode()).toBe('date-desc');
    });

    it('restarts a stuck current-folder refresh with a fresh page request', async () => {
        let resolveSecondPageLoad!: (page: LibraryFolderPage) => void;
        let secondPageLoadPending = false;
        const loadFolderPage = vi.fn(() => {
            if (loadFolderPage.mock.calls.length === 1) {
                return new Promise<LibraryFolderPage>(() => undefined);
            }

            return new Promise<LibraryFolderPage>((resolve) => {
                secondPageLoadPending = true;
                resolveSecondPageLoad = resolve;
            });
        });

        const { controller, libraryBrowser } = mountLibraryController({
            loadFolderPage,
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        expect(loadFolderPage).toHaveBeenCalledTimes(1);

        controller.refreshCurrentFolder();
        await flushPromises();

        expect(loadFolderPage).toHaveBeenCalledTimes(2);

        if (!secondPageLoadPending) {
            throw new Error('Expected second folder page load to be pending');
        }

        resolveSecondPageLoad(createFolderPage('Library/Artist One', [{
            kind: 'folder',
            name: 'Album One',
            path: 'Library/Artist One/Album One',
            folderPath: 'Library/Artist One',
            relativePath: 'Library/Artist One/Album One',
        }]));
        await flushPromises();

        expect(libraryBrowser.querySelector('[data-folder-path="Library/Artist One/Album One"]')).not.toBeNull();
    });

    it('preserves the last folder on close and clears restored search state when navigating', async () => {
        const { controller, onSidebarClosed } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setCurrentFolderPath('Library/Artist One/Album One');
        controller.setSidebarOpen(false);

        expect(onSidebarClosed).toHaveBeenCalledTimes(1);
        expect(controller.getSidebarAutoFolderPath()).toBe('Library/Artist One/Album One');

        controller.restoreLibrarySearchState({
            query: 'artist',
            pending: false,
            result: {
                entries: [{
                    kind: 'folder',
                    name: 'Artist One',
                    path: 'Library/Artist One',
                    folderPath: 'Library',
                    relativePath: 'Library/Artist One',
                }],
                entryKeys: new Set<string>(['Library/Artist One']),
                loading: false,
                errorMessage: null,
            },
            expandedFolderPaths: [],
        });

        expect(controller.getLibrarySearchQuery()).toBe('artist');
        expect(controller.isLibrarySearchActive()).toBe(true);

        controller.navigateToFolder('Library/Artist Two');

        expect(controller.getLibrarySearchQuery()).toBe('');
	    expect(controller.isLibrarySearchActive()).toBe(false);
        expect(controller.getCurrentFolderPath()).toBe('Library/Artist Two');
    });

    it('expands and collapses a search-tree subtree programmatically', async () => {
        const { controller, librarySearch, libraryBrowser } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        librarySearch.value = 'artist';
        librarySearch.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(180);
        await flushPromises();

        expect(libraryBrowser.querySelector('[data-search-folder-path="Library/Artist One/Album One"]')).toBeNull();

        controller.setSearchTreeSubtreeExpanded('Library', true);

        expect(libraryBrowser.querySelector('[data-search-folder-path="Library/Artist One/Album One"]')).not.toBeNull();

        controller.setSearchTreeSubtreeExpanded('Library', false);

        expect(libraryBrowser.querySelector('[data-search-folder-path="Library/Artist One/Album One"]')).toBeNull();
    });

    it('right-clicks a filtered search folder with only that subtree track indexes', async () => {
        const { controller, librarySearch, libraryBrowser, onFolderQueueRequested } = mountLibraryController();

        controller.setLibraryRootName('Library');
        controller.setSidebarOpen(true);
        await flushPromises();

        librarySearch.value = 'artist';
        librarySearch.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(180);
        await flushPromises();

        const rootFolderButton = libraryBrowser.querySelector('[data-search-folder-path="Library"]') as HTMLButtonElement | null;
        expect(rootFolderButton).not.toBeNull();
        rootFolderButton?.click();

        const artistFolderButton = libraryBrowser.querySelector('[data-search-folder-path="Library/Artist One"]') as HTMLButtonElement | null;
        expect(artistFolderButton).not.toBeNull();

        artistFolderButton?.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 21,
            clientY: 34,
        }));

        expect(onFolderQueueRequested).toHaveBeenCalledWith(
            21,
            34,
            'Library/Artist One',
            expect.stringContaining('Artist One'),
            [0],
            true,
        );
    });

    it('marks the loading remote track row while buffering', async () => {
        const { controller, libraryBrowser, trackPath } = mountLibraryController({
            state: createLibraryControllerState(),
        });

        controller.setLibraryRootName('Library');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        controller.setLoadingTrackPath(trackPath);
        await flushPromises();

        const loadingButton = libraryBrowser.querySelector(`[data-track-path="${trackPath}"]`) as HTMLButtonElement | null;
        expect(loadingButton?.classList.contains('is-loading')).toBe(true);
        expect(controller.getLoadingTrackPath()).toBe(trackPath);

        controller.setLoadingTrackPath('');
        await flushPromises();

        const clearedButton = libraryBrowser.querySelector(`[data-track-path="${trackPath}"]`) as HTMLButtonElement | null;
        expect(clearedButton?.classList.contains('is-loading')).toBe(false);
        expect(controller.getLoadingTrackPath()).toBe('');
    });

    it('preserves tree scroll position while search pages stream in', async () => {
        let resolveSecondPage: ((page: LibrarySearchPage) => void) | undefined;
        const createPagedEntry = (index: number): LibraryBrowserEntry => ({
            kind: 'track',
            name: `Track ${index}.flac`,
            path: `/music/search/track-${index}.flac`,
            folderPath: `Library/Artist ${Math.floor(index / 10)}/Album ${Math.floor(index / 10)}`,
            relativePath: `Library/Artist ${Math.floor(index / 10)}/Album ${Math.floor(index / 10)}/Track ${index}.flac`,
        });
        const firstPageEntries = Array.from({ length: 100 }, (_, index) => createPagedEntry(index));
        const secondPageEntries = Array.from({ length: 50 }, (_, index) => createPagedEntry(index + 100));
        const searchLibrary = vi.fn(async (query: string, offset: number) => {
            if (offset === 0) {
                return createSearchPageSlice(query, firstPageEntries, 0, 150);
            }

            if (offset === 100) {
                return await new Promise<LibrarySearchPage>((resolve) => {
                    resolveSecondPage = resolve;
                });
            }

            return createSearchPageSlice(query, [], offset, 150);
        });
        const { controller, librarySearch: librarySearchInput, libraryBrowser } = mountLibraryController({ searchLibrary });

        controller.setLibraryRootName('Library');
        controller.setSidebarOpen(true);
        await flushPromises();

        librarySearchInput.value = 'paged';
        librarySearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(180);
        await flushPromises();

        const firstPane = libraryBrowser.querySelector('.library-search-pane') as HTMLUListElement | null;
        expect(firstPane).not.toBeNull();
        firstPane!.scrollTop = 240;

        if (!resolveSecondPage) {
            throw new Error('Expected second-page resolver to be initialized');
        }

        resolveSecondPage(createSearchPageSlice('paged', secondPageEntries, 100, 150));
        await flushPromises();

        const updatedPane = libraryBrowser.querySelector('.library-search-pane') as HTMLUListElement | null;
        expect(updatedPane).not.toBeNull();
        expect(updatedPane).toBe(firstPane);
        expect(updatedPane!.scrollTop).toBe(240);
    });

    it('persists library/search state through an injected controller substate', async () => {
        const state = createLibraryControllerState();
        const { controller, librarySearch } = mountLibraryController({ state });

        controller.setLibraryRootName('Library');
        controller.setCurrentFolderPath('Library/Artist One');
        controller.setSidebarAutoFolderPath('Library/Artist One');
        controller.setSidebarOpen(true);
        await flushPromises();

        librarySearch.value = 'intro';
        librarySearch.dispatchEvent(new Event('input', { bubbles: true }));

        expect(state.libraryRootName).toBe('Library');
        expect(state.currentFolderPath).toBe('Library/Artist One');
        expect(state.sidebarOpen).toBe(true);
        expect(state.sidebarExpanded).toBe(false);
        expect(state.librarySearchQuery).toBe('intro');
        expect(state.librarySearchPending).toBe(true);

        await vi.advanceTimersByTimeAsync(180);
        await flushPromises();

        expect(state.activeSearchResult?.entries).toHaveLength(1);

        controller.resetLibraryState();

        expect(state.libraryRootName).toBe('');
        expect(state.currentFolderPath).toBe('');
        expect(state.sidebarAutoFolderPath).toBe('');
        expect(state.sidebarExpanded).toBe(false);
        expect(state.librarySearchQuery).toBe('');
        expect(state.librarySearchPending).toBe(false);
        expect(state.activeSearchResult).toBeNull();
        expect(Array.from(state.expandedSearchFolders)).toEqual([]);
    });
});