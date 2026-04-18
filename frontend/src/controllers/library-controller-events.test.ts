import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupLibraryEventHandlers, type LibraryEventDeps } from './library-controller-events';
import type { LibraryControllerOptions } from './library-controller-types';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const createDeps = () => {
    document.body.innerHTML = `
        <button id="sidebar-toggle" type="button"></button>
        <button id="library-expand-toggle" type="button"></button>
        <button id="library-back" type="button"></button>
        <p id="library-path"></p>
        <input id="library-search" type="text">
        <select id="library-sort"><option value="name">Name</option><option value="date-desc">Newest</option><option value="date-asc">Oldest</option></select>
        <div id="library-browser"></div>
    `;

    const sidebarToggle = document.querySelector('#sidebar-toggle') as HTMLButtonElement;
    const libraryExpandToggle = document.querySelector('#library-expand-toggle') as HTMLButtonElement;
    const libraryBack = document.querySelector('#library-back') as HTMLButtonElement;
    const libraryPath = document.querySelector('#library-path') as HTMLParagraphElement;
    const librarySearch = document.querySelector('#library-search') as HTMLInputElement;
    const librarySort = document.querySelector('#library-sort') as HTMLSelectElement;
    const libraryBrowser = document.querySelector('#library-browser') as HTMLElement;

    let suppressNextPaste = false;
    let librarySearchQuery = '';
    let libraryBrowserSortMode: 'name' | 'date-desc' | 'date-asc' = 'name';
    let currentFolderPath = 'Library/Artist';
    let librarySearchActive = false;
        let sidebarExpanded = false;
    const expandedSearchFolders = new Set<string>();

    const options: LibraryControllerOptions = {
            sidebarToggle,
            app: document.createElement('div'),
            librarySidebar: document.createElement('div'),
            libraryBack,
            libraryExpandToggle,
            libraryPath,
            librarySearch,
            librarySort,
            libraryBrowser,
            libraryScanYieldIndicator: document.createElement('span'),
            getTracks: () => [],
            getTextFiles: () => [],
            getImageFiles: () => [],
            getCurrentTrackIndex: () => -1,
            loadFolderPage: vi.fn(async () => ({ folderPath: '', offset: 0, limit: 0, totalEntries: 0, entries: [] })),
            resolveLibraryFolderForAbsolutePath: vi.fn(async () => ''),
            isFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
            searchLibrary: vi.fn(async () => ({ query: '', offset: 0, limit: 0, totalEntries: 0, entries: [] })),
            getReleaseDepthForTrack: vi.fn(() => 1),
            getFolderCoverPath: vi.fn(() => ''),
            readImageThumbnail: vi.fn(async () => ({})),
            getHighlightMusicBrainzTaggedAlbumFolders: () => false,
            resolveTrackIndex: vi.fn(() => -1),
            resolveTextFileIndex: vi.fn(() => -1),
            resolveImageFileIndex: vi.fn(() => -1),
            onTrackChosen: vi.fn(),
            onTrackPathChosen: vi.fn(),
            onTextFileChosen: vi.fn(),
            onImageFileChosen: vi.fn(),
            onQueueRequested: vi.fn(),
            onFolderQueueRequested: vi.fn(),
            onSidebarClosed: vi.fn(),
        };

    const deps: LibraryEventDeps = {
        options,
        getActiveSearchTreeRoot: vi.fn(() => null),
        getExpandedSearchFolders: () => expandedSearchFolders,
        getHoveredBrowserEntryKey: vi.fn(() => null),
        setHoveredBrowserEntryKey: vi.fn(),
        getSuppressNextLibrarySearchPasteInput: () => suppressNextPaste,
        setSuppressNextLibrarySearchPasteInput: (value: boolean) => {
            suppressNextPaste = value;
        },
        getLibrarySearchQuery: () => librarySearchQuery,
        setLibrarySearchQueryValue: (value: string) => {
            librarySearchQuery = value;
        },
        getLibraryBrowserSortMode: () => libraryBrowserSortMode,
        setLibraryBrowserSortMode: (value) => {
            libraryBrowserSortMode = value;
        },
        getCurrentFolderPath: () => currentFolderPath,
        setCurrentFolderPath: (path: string) => {
            currentFolderPath = path;
        },
        isLibrarySearchActive: () => librarySearchActive,
        clearLibrarySearch: vi.fn(() => {
            librarySearchActive = false;
            librarySearchQuery = '';
            librarySearch.value = '';
        }),
        navigateToFolder: vi.fn(),
        renderFolder: vi.fn(),
        setSidebarOpen: vi.fn(),
        isSidebarOpen: vi.fn(() => true),
        getSidebarExpanded: () => sidebarExpanded,
        setSidebarExpanded: vi.fn((expanded: boolean) => {
            sidebarExpanded = expanded;
        }),
        setHoveredBrowserButton: vi.fn(),
        showFolderEnumerationTooltip: vi.fn(),
        hideFolderEnumerationTooltip: vi.fn(),
        expandSearchTreeFolder: vi.fn(),
        collapseSearchTreeFolder: vi.fn(),
        tryHandlePastedLibraryPath: vi.fn(async () => true),
    };

    return {
        deps,
        libraryBack,
        libraryExpandToggle,
        librarySearch,
        libraryBrowser,
        setLibrarySearchActive: (value: boolean) => {
            librarySearchActive = value;
        },
        setSidebarExpanded: (value: boolean) => {
            sidebarExpanded = value;
        },
    };
};

describe('setupLibraryEventHandlers', () => {
    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('intercepts absolute-path paste before input and delegates path handling', () => {
        const { deps, librarySearch } = createDeps();
        setupLibraryEventHandlers(deps);

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'C:\\Music\\Artist\\Album',
            inputType: 'insertFromPaste',
        });
        librarySearch.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(deps.tryHandlePastedLibraryPath).toHaveBeenCalledWith('C:\\Music\\Artist\\Album');
    });

    it('toggles expanded mode from the expand button', () => {
        const { deps, libraryExpandToggle } = createDeps();
        setupLibraryEventHandlers(deps);

        libraryExpandToggle.click();

        expect(deps.setSidebarExpanded).toHaveBeenCalledWith(true);
    });

    it('treats pasted library-relative paths as jump candidates from the input event', async () => {
        const { deps, librarySearch } = createDeps();
        setupLibraryEventHandlers(deps);

        librarySearch.value = 'Library/Artist/Album';
        librarySearch.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertFromPaste',
        }));
        await flushPromises();

        expect(deps.tryHandlePastedLibraryPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(librarySearch.value).toBe('');
    });

    it('restores pasted text when delegated path handling cannot resolve it', async () => {
        const { deps, librarySearch } = createDeps();
        deps.tryHandlePastedLibraryPath = vi.fn(async () => false);
        setupLibraryEventHandlers(deps);

        const event = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'C:\\Music\\Missing\\Album',
            inputType: 'insertFromPaste',
        });
        librarySearch.dispatchEvent(event);
        await flushPromises();

        expect(event.defaultPrevented).toBe(true);
        expect(deps.tryHandlePastedLibraryPath).toHaveBeenCalledWith('C:\\Music\\Missing\\Album');
        expect(librarySearch.value).toBe('C:\\Music\\Missing\\Album');
    });

    it('clears active search results when the back button is pressed during search mode', () => {
        const { deps, libraryBack, setLibrarySearchActive } = createDeps();
        setupLibraryEventHandlers(deps);
        setLibrarySearchActive(true);

        libraryBack.click();

        expect(deps.clearLibrarySearch).toHaveBeenCalledTimes(1);
        expect(deps.renderFolder).toHaveBeenCalledWith('none');
    });

    it('shrinks expanded mode when the library search input changes', () => {
        const { deps, librarySearch, setSidebarExpanded } = createDeps();
        setupLibraryEventHandlers(deps);
        setSidebarExpanded(true);

        librarySearch.value = 'album';
        librarySearch.dispatchEvent(new Event('input', { bubbles: true }));

        expect(deps.setSidebarExpanded).toHaveBeenCalledWith(false);
    });

    it('preserves tagged album folder highlighting when toggling a search-tree folder', () => {
        const { deps, libraryBrowser } = createDeps();
        deps.options.getHighlightMusicBrainzTaggedAlbumFolders = () => true;
        deps.getActiveSearchTreeRoot = vi.fn(() => ({
            name: 'Library',
            path: '',
            musicBrainzTaggedAlbumDir: false,
            folders: [{
                name: 'Library',
                path: 'Library',
                musicBrainzTaggedAlbumDir: false,
                folders: [{
                    name: 'Artist One',
                    path: 'Library/Artist One',
                    musicBrainzTaggedAlbumDir: false,
                    folders: [{
                        name: 'Album One',
                        path: 'Library/Artist One/Album One',
                        musicBrainzTaggedAlbumDir: true,
                        folders: [],
                        trackEntries: [],
                        textFileEntries: [],
                        imageFileEntries: [],
                    }],
                    trackEntries: [],
                    textFileEntries: [],
                    imageFileEntries: [],
                }],
                trackEntries: [],
                textFileEntries: [],
                imageFileEntries: [],
            }],
            trackEntries: [],
            textFileEntries: [],
            imageFileEntries: [],
        }));
        setupLibraryEventHandlers(deps);

        libraryBrowser.innerHTML = `
            <li class="library-tree-node">
                <button
                    type="button"
                    class="library-tree-folder"
                    data-search-folder-path="Library/Artist One/Album One"
                    data-search-folder-expandable="true"
                >Album One</button>
            </li>
        `;

        const button = libraryBrowser.querySelector('button') as HTMLButtonElement;
        button.click();

        expect(button.querySelector('.library-entry-icon.folder.musicbrainz-tagged-album')).not.toBeNull();

        button.click();

        expect(button.querySelector('.library-entry-icon.folder.musicbrainz-tagged-album')).not.toBeNull();
    });

    it('shows the enumeration tooltip instead of navigating when descendants are not ready', async () => {
        const { deps, libraryBrowser } = createDeps();
        deps.options.isFolderImmediateDescendantsEnumerated = vi.fn(async () => false);
        setupLibraryEventHandlers(deps);

        const folderButton = document.createElement('button');
        folderButton.dataset.folderPath = 'Library/Artist/Album';
        libraryBrowser.append(folderButton);

        folderButton.click();
        await flushPromises();

        expect(deps.showFolderEnumerationTooltip).toHaveBeenCalledWith(folderButton);
        expect(deps.navigateToFolder).not.toHaveBeenCalled();
    });
});