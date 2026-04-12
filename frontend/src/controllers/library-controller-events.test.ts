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
        <button id="library-back" type="button"></button>
        <p id="library-path"></p>
        <input id="library-search" type="text">
        <select id="library-sort"><option value="name">Name</option><option value="date-desc">Newest</option><option value="date-asc">Oldest</option></select>
        <div id="library-browser"></div>
    `;

    const sidebarToggle = document.querySelector('#sidebar-toggle') as HTMLButtonElement;
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
    const expandedSearchFolders = new Set<string>();

    const options: LibraryControllerOptions = {
            sidebarToggle,
            app: document.createElement('div'),
            librarySidebar: document.createElement('div'),
            libraryBack,
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
        librarySearch,
        libraryBrowser,
        setLibrarySearchActive: (value: boolean) => {
            librarySearchActive = value;
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

    it('clears active search results when the back button is pressed during search mode', () => {
        const { deps, libraryBack, setLibrarySearchActive } = createDeps();
        setupLibraryEventHandlers(deps);
        setLibrarySearchActive(true);

        libraryBack.click();

        expect(deps.clearLibrarySearch).toHaveBeenCalledTimes(1);
        expect(deps.renderFolder).toHaveBeenCalledWith('none');
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