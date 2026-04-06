import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ImageLibraryFile, LibraryBrowserEntry, LibraryFolderPage, LibrarySearchPage, TextLibraryFile, Track } from '../types/app-types';
import { createLibraryController } from './library-controller';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
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

const mountLibraryController = () => {
    document.body.innerHTML = `
        <div id="app">
            <button id="sidebar-toggle" type="button"></button>
            <aside id="library-sidebar"></aside>
            <span id="library-scan-yield"></span>
            <button id="library-back" type="button"></button>
            <p id="library-path"></p>
            <input id="library-search" type="text">
            <div id="library-browser"></div>
        </div>
    `;

    const app = document.querySelector('#app') as HTMLElement;
    const sidebarToggle = document.querySelector('#sidebar-toggle') as HTMLButtonElement;
    const librarySidebar = document.querySelector('#library-sidebar') as HTMLElement;
    const libraryScanYieldIndicator = document.querySelector('#library-scan-yield') as HTMLSpanElement;
    const libraryBack = document.querySelector('#library-back') as HTMLButtonElement;
    const libraryPath = document.querySelector('#library-path') as HTMLParagraphElement;
    const librarySearch = document.querySelector('#library-search') as HTMLInputElement;
    const libraryBrowser = document.querySelector('#library-browser') as HTMLElement;

    const tracks: Track[] = [
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
    const imageFiles: ImageLibraryFile[] = [];

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

    const loadFolderPage = vi.fn(async (folderPath: string) => {
        if (folderPath === 'Library/Artist One') {
            return createFolderPage(folderPath, [folderChildEntry, folderTrackEntry]);
        }

        if (folderPath === 'Library/Artist Two') {
            return createFolderPage(folderPath, []);
        }

        return createFolderPage(folderPath, []);
    });
    const searchLibrary = vi.fn(async (query: string) => {
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

    const controller = createLibraryController({
        app,
        sidebarToggle,
        librarySidebar,
        libraryScanYieldIndicator,
        libraryBack,
        libraryPath,
        librarySearch,
        libraryBrowser,
        getTracks: () => tracks,
        getTextFiles: () => textFiles,
        getImageFiles: () => imageFiles,
        getCurrentTrackIndex: () => 0,
        loadFolderPage,
        resolveLibraryFolderForAbsolutePath: vi.fn(async () => ''),
        isFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
        searchLibrary,
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
        libraryBrowser,
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

        expect(loadFolderPage).toHaveBeenCalledWith('Library/Artist One', 0, 100);
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
        );
    });
});