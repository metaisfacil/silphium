import type {
    ImageLibraryFile,
    LibraryBrowserEntry,
    LibraryBrowserSortMode,
    LibraryFolderPage,
    LibrarySearchPage,
    TextLibraryFile,
    Track,
} from '../types/app-types';

export type RenderDirection = 'none' | 'forward' | 'back';

export type PaneSource =
    | { kind: 'folder'; folderPath: string; sortMode: LibraryBrowserSortMode }
    | { kind: 'search'; query: string };

export type PaneState = {
    source: PaneSource;
    version: number;
    totalEntries: number | null;
    loadedPages: Map<number, LibraryBrowserEntry[]>;
    loadingPages: Set<number>;
    rowHeightEstimate: number;
    updateScheduled: boolean;
    errorMessage: string | null;
};

export type SearchTreeNode = {
    name: string;
    path: string;
    musicBrainzTaggedAlbumDir: boolean;
    folders: SearchTreeNode[];
    trackEntries: LibraryBrowserEntry[];
    textFileEntries: LibraryBrowserEntry[];
    imageFileEntries: LibraryBrowserEntry[];
};

export type SearchResultState = {
    entries: LibraryBrowserEntry[];
    entryKeys: Set<string>;
    loading: boolean;
    errorMessage: string | null;
};

export type LibraryControllerState = {
    sidebarOpen: boolean;
    libraryRootName: string;
    currentFolderPath: string;
    sidebarAutoFolderPath: string;
    libraryIndexTruncated: boolean;
    libraryLoading: boolean;
    libraryLoadingEtaSeconds: number | null;
    libraryLoadingStatusLabel: string;
    libraryBrowserSortMode: LibraryBrowserSortMode;
    librarySearchQuery: string;
    librarySearchPending: boolean;
    activeSearchResult: SearchResultState | null;
    expandedSearchFolders: Set<string>;
};

export const createLibraryControllerState = (): LibraryControllerState => ({
    sidebarOpen: false,
    libraryRootName: '',
    currentFolderPath: '',
    sidebarAutoFolderPath: '',
    libraryIndexTruncated: false,
    libraryLoading: false,
    libraryLoadingEtaSeconds: null,
    libraryLoadingStatusLabel: '',
    libraryBrowserSortMode: 'name',
    librarySearchQuery: '',
    librarySearchPending: false,
    activeSearchResult: null,
    expandedSearchFolders: new Set<string>(),
});

export type LibrarySearchStateSnapshot = {
    query: string;
    pending: boolean;
    result: SearchResultState | null;
    expandedFolderPaths: string[];
};

export type PastedPathLookupCache = {
    indexedFolderPathByKey: Map<string, string>;
    indexedFileFolderPathByKey: Map<string, string>;
    monitoredRoots: Array<{ path: string; name: string }>;
};

export type LibraryControllerOptions = {
    app: HTMLElement;
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryScanYieldIndicator: HTMLSpanElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    librarySearch: HTMLInputElement;
    librarySort: HTMLSelectElement;
    libraryBrowser: HTMLElement;
    state?: LibraryControllerState;
    getTracks: () => Track[];
    getTextFiles: () => TextLibraryFile[];
    getImageFiles: () => ImageLibraryFile[];
    getCurrentTrackIndex: () => number;
    loadFolderPage: (folderPath: string, sortMode: LibraryBrowserSortMode, offset: number, limit: number) => Promise<LibraryFolderPage>;
    resolveLibraryFolderForAbsolutePath: (path: string) => Promise<string>;
    isFolderImmediateDescendantsEnumerated: (folderPath: string) => Promise<boolean>;
    searchLibrary: (query: string, offset: number, limit: number) => Promise<LibrarySearchPage>;
    getHighlightMusicBrainzTaggedAlbumFolders: () => boolean;
    resolveTrackIndex: (path: string) => number;
    resolveTextFileIndex: (path: string) => number;
    resolveImageFileIndex: (path: string) => number;
    onTrackChosen: (index: number) => void;
    onTrackPathChosen?: (path: string) => void;
    onTextFileChosen: (index: number) => void;
    onTextFilePathChosen?: (path: string) => void;
    onImageFileChosen: (index: number) => void;
    onImageFilePathChosen?: (path: string) => void;
    onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[], feedbackTrackIndex?: number, includeFileActions?: boolean, fileActionPath?: string) => void;
    onFolderQueueRequested: (clientX: number, clientY: number, folderPath: string, folderLabel: string, trackIndexes?: number[]) => void;
    onSidebarClosed: () => void;
};

export const serverPageSize = 100;
export const searchDebounceMs = 180;
export const rowOverscanCount = 30;
export const initialRowHeightEstimatePx = 28;
export const defaultLibraryRootLabel = 'Selected folders';
export const searchTreeToggleDurationMs = 180;
export const sidebarToggleIconMarkup = '<svg class="sidebar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 6.5C4 5.67 4.67 5 5.5 5H18.5C19.33 5 20 5.67 20 6.5C20 7.33 19.33 8 18.5 8H5.5C4.67 8 4 7.33 4 6.5ZM4 12C4 11.17 4.67 10.5 5.5 10.5H18.5C19.33 10.5 20 11.17 20 12C20 12.83 19.33 13.5 18.5 13.5H5.5C4.67 13.5 4 12.83 4 12ZM4 17.5C4 16.67 4.67 16 5.5 16H18.5C19.33 16 20 16.67 20 17.5C20 18.33 19.33 19 18.5 19H5.5C4.67 19 4 18.33 4 17.5Z"/></svg>';
