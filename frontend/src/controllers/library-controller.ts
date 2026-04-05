import type {
    ImageLibraryFile,
    LibraryBrowserEntry,
    LibraryFolderPage,
    LibrarySearchPage,
    TextLibraryFile,
    Track,
} from '../types/app-types';
import { libraryFolderPathKey } from '../utils/main-helpers';

type RenderDirection = 'none' | 'forward' | 'back';

type PaneSource =
    | { kind: 'folder'; folderPath: string }
    | { kind: 'search'; query: string };

type PaneState = {
    source: PaneSource;
    version: number;
    totalEntries: number | null;
    loadedPages: Map<number, LibraryBrowserEntry[]>;
    loadingPages: Set<number>;
    rowHeightEstimate: number;
    updateScheduled: boolean;
    errorMessage: string | null;
};

type SearchTreeNode = {
    name: string;
    path: string;
    folders: SearchTreeNode[];
    trackEntries: LibraryBrowserEntry[];
    textFileEntries: LibraryBrowserEntry[];
    imageFileEntries: LibraryBrowserEntry[];
};

type SearchResultState = {
    entries: LibraryBrowserEntry[];
    entryKeys: Set<string>;
    loading: boolean;
    errorMessage: string | null;
};

type LibrarySearchStateSnapshot = {
    query: string;
    pending: boolean;
    result: SearchResultState | null;
    expandedFolderPaths: string[];
};

type PastedPathLookupCache = {
    indexedFolderPathByKey: Map<string, string>;
    indexedFileFolderPathByKey: Map<string, string>;
    monitoredRoots: Array<{ path: string; name: string }>;
};

type LibraryControllerOptions = {
    app: HTMLElement;
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryScanYieldIndicator: HTMLSpanElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    librarySearch: HTMLInputElement;
    libraryBrowser: HTMLElement;
    getTracks: () => Track[];
    getTextFiles: () => TextLibraryFile[];
    getImageFiles: () => ImageLibraryFile[];
    getCurrentTrackIndex: () => number;
    loadFolderPage: (folderPath: string, offset: number, limit: number) => Promise<LibraryFolderPage>;
    resolveLibraryFolderForAbsolutePath: (path: string) => Promise<string>;
    isFolderImmediateDescendantsEnumerated: (folderPath: string) => Promise<boolean>;
    searchLibrary: (query: string, offset: number, limit: number) => Promise<LibrarySearchPage>;
    resolveTrackIndex: (path: string) => number;
    resolveTextFileIndex: (path: string) => number;
    resolveImageFileIndex: (path: string) => number;
    onTrackChosen: (index: number) => void;
    onTrackPathChosen?: (path: string) => void;
    onTextFileChosen: (index: number) => void;
    onImageFileChosen: (index: number) => void;
    onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[], feedbackTrackIndex?: number) => void;
    onFolderQueueRequested: (clientX: number, clientY: number, folderPath: string, folderLabel: string) => void;
    onSidebarClosed: () => void;
};

export type LibraryController = ReturnType<typeof createLibraryController>;

const serverPageSize = 100;
const searchDebounceMs = 180;
const rowOverscanCount = 30;
const initialRowHeightEstimatePx = 28;
const defaultLibraryRootLabel = 'Selected folders';
const searchTreeToggleDurationMs = 180;
const sidebarToggleIconMarkup = '<svg class="sidebar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 6.5C4 5.67 4.67 5 5.5 5H18.5C19.33 5 20 5.67 20 6.5C20 7.33 19.33 8 18.5 8H5.5C4.67 8 4 7.33 4 6.5ZM4 12C4 11.17 4.67 10.5 5.5 10.5H18.5C19.33 10.5 20 11.17 20 12C20 12.83 19.33 13.5 18.5 13.5H5.5C4.67 13.5 4 12.83 4 12ZM4 17.5C4 16.67 4.67 16 5.5 16H18.5C19.33 16 20 16.67 20 17.5C20 18.33 19.33 19 18.5 19H5.5C4.67 19 4 18.33 4 17.5Z"/></svg>';

export const createLibraryController = (options: LibraryControllerOptions) => {
    const {
        app,
        sidebarToggle,
        librarySidebar,
        libraryScanYieldIndicator,
        libraryBack,
        libraryPath,
        librarySearch,
        libraryBrowser,
    } = options;

    let sidebarOpen = false;
    let libraryRootName = '';
    let currentFolderPath = '';
    let sidebarAutoFolderPath = '';
    let libraryIndexTruncated = false;
    let libraryLoading = false;
    let libraryLoadingEtaSeconds: number | null = null;
    let libraryLoadingStatusLabel = '';
    let librarySearchQuery = '';
    let librarySearchPending = false;
    let librarySearchRequestVersion = 0;
    let librarySearchDebounceHandle: number | undefined;
    let suppressNextLibrarySearchPasteInput = false;
    let activeSearchResult: SearchResultState | null = null;
    let activeSearchTreeRoot: SearchTreeNode | null = null;
    let pastedPathLookupCache: PastedPathLookupCache = {
        indexedFolderPathByKey: new Map<string, string>(),
        indexedFileFolderPathByKey: new Map<string, string>(),
        monitoredRoots: [],
    };
    let paneVersionCounter = 0;
    let hoveredBrowserEntryKey: string | null = null;
    let hoveredBrowserButton: HTMLButtonElement | null = null;
    const expandedSearchFolders = new Set<string>();
    const paneStateByElement = new WeakMap<HTMLUListElement, PaneState>();
    const viewportLoadingIndicator = document.createElement('div');
    viewportLoadingIndicator.className = 'library-viewport-loading-indicator';
    viewportLoadingIndicator.setAttribute('aria-hidden', 'true');
    libraryBrowser.append(viewportLoadingIndicator);
    const folderEnumerationTooltip = document.createElement('div');
    folderEnumerationTooltip.className = 'library-folder-enumeration-tooltip';
    folderEnumerationTooltip.setAttribute('aria-hidden', 'true');
    folderEnumerationTooltip.textContent = 'This folder is still being enumerated!';
    libraryBrowser.append(folderEnumerationTooltip);
    let folderEnumerationTooltipFadeHandle: number | undefined;
    let folderEnumerationTooltipHideHandle: number | undefined;

    const ensureViewportLoadingIndicatorMounted = (): void => {
        if (!libraryBrowser.contains(viewportLoadingIndicator)) {
            libraryBrowser.append(viewportLoadingIndicator);
        }
    };

    const ensureFolderEnumerationTooltipMounted = (): void => {
        if (!libraryBrowser.contains(folderEnumerationTooltip)) {
            libraryBrowser.append(folderEnumerationTooltip);
        }
    };

    const hideFolderEnumerationTooltip = (): void => {
        folderEnumerationTooltip.classList.remove('is-visible');
        folderEnumerationTooltip.classList.remove('is-below');
        folderEnumerationTooltip.setAttribute('aria-hidden', 'true');
    };

    const showFolderEnumerationTooltip = (anchor: HTMLElement): void => {
        ensureFolderEnumerationTooltipMounted();

        if (folderEnumerationTooltipFadeHandle !== undefined) {
            window.clearTimeout(folderEnumerationTooltipFadeHandle);
            folderEnumerationTooltipFadeHandle = undefined;
        }

        if (folderEnumerationTooltipHideHandle !== undefined) {
            window.clearTimeout(folderEnumerationTooltipHideHandle);
            folderEnumerationTooltipHideHandle = undefined;
        }

        const browserRect = libraryBrowser.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const tooltipWidth = Math.max(120, folderEnumerationTooltip.offsetWidth || 120);
        const horizontalInset = Math.max(12, (tooltipWidth / 2) + 8);
        const minInset = horizontalInset;
        const maxInset = Math.max(minInset, browserRect.width - horizontalInset);
        let left = anchorRect.left - browserRect.left + (anchorRect.width / 2);
        left = Math.max(minInset, Math.min(maxInset, left));

        const tooltipHeight = Math.max(28, folderEnumerationTooltip.offsetHeight || 28);
        const verticalInset = 8;
        const availableAbove = anchorRect.top - browserRect.top;
        const availableBelow = browserRect.bottom - anchorRect.bottom;
        const renderBelow = availableBelow >= (tooltipHeight + verticalInset)
            || availableBelow >= availableAbove;
        folderEnumerationTooltip.classList.toggle('is-below', renderBelow);

        let top = renderBelow
            ? anchorRect.bottom - browserRect.top
            : anchorRect.top - browserRect.top;

        const minTop = renderBelow
            ? verticalInset
            : tooltipHeight + verticalInset;
        const maxTop = Math.max(minTop, browserRect.height - verticalInset);
        top = Math.max(minTop, Math.min(maxTop, top));

        folderEnumerationTooltip.style.left = `${left}px`;
        folderEnumerationTooltip.style.top = `${top}px`;
        folderEnumerationTooltip.classList.add('is-visible');
        folderEnumerationTooltip.setAttribute('aria-hidden', 'false');

        // Show briefly, then fade; total on-screen time stays under one second.
        folderEnumerationTooltipFadeHandle = window.setTimeout(() => {
            hideFolderEnumerationTooltip();
            folderEnumerationTooltipFadeHandle = undefined;
        }, 760);

        folderEnumerationTooltipHideHandle = window.setTimeout(() => {
            hideFolderEnumerationTooltip();
            folderEnumerationTooltipHideHandle = undefined;
        }, 980);
    };

    const getTracks = (): Track[] => options.getTracks();

    const formatLibraryLoadingEtaLabel = (): string => {
        if (libraryLoadingEtaSeconds === null || !Number.isFinite(libraryLoadingEtaSeconds) || libraryLoadingEtaSeconds <= 0) {
            return '';
        }

        const wholeSeconds = Math.max(1, Math.ceil(libraryLoadingEtaSeconds));
        if (wholeSeconds < 60) {
            return `~${wholeSeconds}s`;
        }

        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        if (seconds === 0) {
            return `~${minutes}m`;
        }

        return `~${minutes}m ${seconds}s`;
    };

    const loadingIndicatorLabel = (): string => {
        if (libraryLoadingStatusLabel) {
            return libraryLoadingStatusLabel;
        }

        return formatLibraryLoadingEtaLabel();
    };

    const refreshSidebarToggleState = (): void => {
        sidebarToggle.classList.toggle('is-loading', libraryLoading);
        libraryScanYieldIndicator.classList.toggle('is-visible', libraryLoading);
        libraryScanYieldIndicator.setAttribute('aria-hidden', libraryLoading ? 'false' : 'true');
        const loadingEtaLabel = libraryLoading && !sidebarOpen ? loadingIndicatorLabel() : '';
        sidebarToggle.classList.toggle('has-loading-eta', loadingEtaLabel !== '');
        sidebarToggle.innerHTML = libraryLoading ? loadingEtaLabel : sidebarToggleIconMarkup;

        if (libraryLoading) {
            const ariaLabel = loadingEtaLabel
                ? `Loading library, ${loadingEtaLabel.startsWith('~') ? `about ${loadingEtaLabel.slice(1)} remaining` : loadingEtaLabel}`
                : 'Loading library';
            sidebarToggle.setAttribute('aria-label', ariaLabel);
            sidebarToggle.setAttribute('aria-busy', 'true');
            return;
        }

        sidebarToggle.setAttribute('aria-busy', 'false');
        sidebarToggle.setAttribute('aria-label', sidebarOpen ? 'Close library' : 'Open library');
    };

    const setLibraryLoading = (loading: boolean): void => {
        if (libraryLoading === loading) {
            return;
        }

        libraryLoading = loading;
        if (!loading) {
            libraryLoadingEtaSeconds = null;
            libraryLoadingStatusLabel = '';
        }
        refreshSidebarToggleState();
    };

    const setLibraryLoadingEtaSeconds = (secondsRemaining: number | null): void => {
        const normalized = (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining <= 0)
            ? null
            : Math.ceil(secondsRemaining);

        if (libraryLoadingEtaSeconds === normalized) {
            return;
        }

        libraryLoadingEtaSeconds = normalized;
        refreshSidebarToggleState();
    };

    const setLibraryLoadingStatusLabel = (label: string): void => {
        const normalized = label.trim();
        if (libraryLoadingStatusLabel === normalized) {
            return;
        }

        libraryLoadingStatusLabel = normalized;
        refreshSidebarToggleState();
    };

    const normalizedLibrarySearchQuery = (): string => librarySearchQuery.trim().toLowerCase();

    const isLibrarySearchActive = (): boolean => normalizedLibrarySearchQuery() !== '';

    const clearScheduledLibrarySearch = (): void => {
        if (librarySearchDebounceHandle === undefined) {
            return;
        }

        window.clearTimeout(librarySearchDebounceHandle);
        librarySearchDebounceHandle = undefined;
    };

    const cancelLibrarySearch = (): void => {
        librarySearchRequestVersion += 1;
        librarySearchPending = false;
        activeSearchResult = null;
        expandedSearchFolders.clear();
        clearScheduledLibrarySearch();
    };

    const clearLibrarySearch = (): void => {
        librarySearchQuery = '';
        librarySearch.value = '';
        cancelLibrarySearch();
    };

    const cloneSearchResultState = (state: SearchResultState | null): SearchResultState | null => {
        if (!state) {
            return null;
        }

        return {
            entries: [...state.entries],
            entryKeys: new Set(state.entryKeys),
            loading: state.loading,
            errorMessage: state.errorMessage,
        };
    };

    const getLibrarySearchStateSnapshot = (): LibrarySearchStateSnapshot => {
        return {
            query: librarySearchQuery,
            pending: librarySearchPending,
            result: cloneSearchResultState(activeSearchResult),
            expandedFolderPaths: Array.from(expandedSearchFolders),
        };
    };

    const restoreLibrarySearchState = (snapshot: LibrarySearchStateSnapshot): void => {
        clearScheduledLibrarySearch();
        librarySearchRequestVersion += 1;

        librarySearchQuery = snapshot.query || '';
        librarySearch.value = librarySearchQuery;

        expandedSearchFolders.clear();
        for (const folderPath of snapshot.expandedFolderPaths || []) {
            expandedSearchFolders.add(folderPath);
        }

        if (normalizedLibrarySearchQuery() === '') {
            librarySearchPending = false;
            activeSearchResult = null;
        } else {
            librarySearchPending = !!snapshot.pending;
            activeSearchResult = cloneSearchResultState(snapshot.result);
        }

        if (sidebarOpen) {
            renderFolder('none');
        }
    };

    const currentPane = (): HTMLUListElement | null => {
        return libraryBrowser.querySelector('.library-list-pane:last-of-type') as HTMLUListElement | null;
    };

    const sourceKey = (source: PaneSource): string => {
        return source.kind === 'folder'
            ? `folder:${source.folderPath}`
            : `search:${source.query}`;
    };

    const activeSource = (): PaneSource | null => {
        if (!libraryRootName) {
            return null;
        }

        if (isLibrarySearchActive()) {
            return {
                kind: 'search',
                query: normalizedLibrarySearchQuery(),
            };
        }

        return {
            kind: 'folder',
            folderPath: currentFolderPath,
        };
    };

    const firstTrackIndexFromRandomAlbumFolder = (): number => {
        const tracks = getTracks();
        const folderTrackIndexes = new Map<string, number[]>();

        tracks.forEach((track, trackIndex) => {
            const key = track.folderPath || '';
            const existing = folderTrackIndexes.get(key);
            if (existing) {
                existing.push(trackIndex);
                return;
            }

            folderTrackIndexes.set(key, [trackIndex]);
        });

        const folderCandidates = Array.from(folderTrackIndexes.values()).filter((indexes) => indexes.length > 0);
        if (folderCandidates.length === 0) {
            return 0;
        }

        const randomFolder = folderCandidates[Math.floor(Math.random() * folderCandidates.length)];
        randomFolder.sort((leftIndex, rightIndex) => (
            tracks[leftIndex].name.localeCompare(tracks[rightIndex].name, undefined, {
                sensitivity: 'base',
                numeric: true,
            })
        ));

        return randomFolder[0] ?? 0;
    };

    const setLibraryPathLabel = (): void => {
        const partialSuffix = libraryIndexTruncated ? ' (partial)' : '';
        const folderSegments = currentFolderPath
            .split('/')
            .filter((segment) => segment !== '');

        const appendText = (value: string): void => {
            libraryPath.append(document.createTextNode(value));
        };

        const appendFolderButton = (label: string, folderPath: string): void => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-path-segment';
            button.dataset.folderPath = folderPath;
            button.textContent = label;
            libraryPath.append(button);
        };

        const appendSeparator = (): void => {
            const separator = document.createElement('span');
            separator.className = 'library-path-separator';
            separator.textContent = ' / ';
            libraryPath.append(separator);
        };

        if (!libraryRootName) {
            libraryPath.innerHTML = '';
            libraryPath.textContent = 'No folder selected';
            libraryBack.disabled = true;
            return;
        }

        libraryPath.innerHTML = '';

        if (isLibrarySearchActive()) {
            appendText(`${libraryRootName}${partialSuffix} · Search: "${librarySearchQuery.trim()}"`);
            libraryBack.disabled = true;
            return;
        }

        if (!currentFolderPath) {
            appendText(`${libraryRootName}${partialSuffix}`);
            libraryBack.disabled = true;
            return;
        }

        appendFolderButton(`${libraryRootName}${partialSuffix}`, '');

        let cumulativePath = '';
        for (const segment of folderSegments) {
            appendSeparator();
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            appendFolderButton(segment, cumulativePath);
        }

        libraryBack.disabled = false;
    };

    const createSpacerRow = (height: number): HTMLLIElement => {
        const spacer = document.createElement('li');
        spacer.className = 'library-list-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        spacer.style.height = `${Math.max(0, height)}px`;
        spacer.style.marginBottom = '0';
        spacer.style.pointerEvents = 'none';
        return spacer;
    };

    const setViewportLoadingIndicatorVisible = (visible: boolean): void => {
        ensureViewportLoadingIndicatorMounted();
        viewportLoadingIndicator.classList.toggle('is-visible', visible);
        viewportLoadingIndicator.setAttribute('aria-hidden', visible ? 'false' : 'true');
    };

    const hoverKeyForBrowserEntry = (entry: LibraryBrowserEntry): string => {
        if (entry.kind === 'folder') {
            return `folder:${entry.path}`;
        }

        if (entry.kind === 'track') {
            return `track:${entry.path}`;
        }

        if (entry.kind === 'text-file') {
            return `text-file:${entry.path}`;
        }

        return `image-file:${entry.path}`;
    };

    const hoverKeyForButton = (button: HTMLButtonElement): string | null => {
        if (button.dataset.hoverKey) {
            return button.dataset.hoverKey;
        }

        if (button.dataset.searchFolderPath !== undefined) {
            return `search-folder:${button.dataset.searchFolderPath}`;
        }

        if (button.dataset.folderPath !== undefined) {
            return `folder:${button.dataset.folderPath}`;
        }

        if (button.dataset.trackPath !== undefined) {
            return `track:${button.dataset.trackPath}`;
        }

        if (button.dataset.textFilePath !== undefined) {
            return `text-file:${button.dataset.textFilePath}`;
        }

        if (button.dataset.imageFilePath !== undefined) {
            return `image-file:${button.dataset.imageFilePath}`;
        }

        return null;
    };

    const setHoveredBrowserButton = (button: HTMLButtonElement | null): void => {
        if (hoveredBrowserButton === button) {
            return;
        }

        if (hoveredBrowserButton) {
            hoveredBrowserButton.classList.remove('is-hovered');
        }

        hoveredBrowserButton = button;
        if (hoveredBrowserButton) {
            hoveredBrowserButton.classList.add('is-hovered');
        }
    };

    const syncHoveredBrowserButton = (): void => {
        const pane = currentPane();
        if (!pane || !hoveredBrowserEntryKey) {
            setHoveredBrowserButton(null);
            return;
        }

        const candidates = Array.from(pane.querySelectorAll('button[data-hover-key]')) as HTMLButtonElement[];
        const matching = candidates.find((candidate) => candidate.dataset.hoverKey === hoveredBrowserEntryKey) || null;
        setHoveredBrowserButton(matching);
    };

    const isFocusPageLoaded = (pane: HTMLUListElement, state: PaneState, totalEntries: number | null): boolean => {
        if (totalEntries !== null && totalEntries <= 0) {
            return true;
        }

        const rowHeight = Math.max(1, state.rowHeightEstimate);
        const focusRow = Math.max(0, Math.floor(pane.scrollTop / rowHeight));
        if (totalEntries !== null && focusRow >= totalEntries) {
            return true;
        }

        const focusPage = Math.max(0, Math.floor(focusRow / serverPageSize));
        return state.loadedPages.has(focusPage);
    };

    const compareLibraryLabels = (left: string, right: string): number => {
        return left.localeCompare(right, undefined, {
            sensitivity: 'base',
            numeric: true,
        });
    };

    const createSearchTreeNode = (name: string, path: string): SearchTreeNode => ({
        name,
        path,
        folders: [],
        trackEntries: [],
        textFileEntries: [],
        imageFileEntries: [],
    });

    const buildSearchTree = (entries: LibraryBrowserEntry[]): SearchTreeNode => {
        const root = createSearchTreeNode(libraryRootName, '');
        const nodeByPath = new Map<string, SearchTreeNode>();
        nodeByPath.set('', root);

        const ensureNode = (path: string): SearchTreeNode => {
            const normalizedPath = path.trim();
            if (!normalizedPath) {
                return root;
            }

            const existing = nodeByPath.get(normalizedPath);
            if (existing) {
                return existing;
            }

            const segments = normalizedPath.split('/').filter((segment) => segment !== '');
            let cumulativePath = '';
            let parent = root;

            for (const segment of segments) {
                cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
                const cached = nodeByPath.get(cumulativePath);
                if (cached) {
                    parent = cached;
                    continue;
                }

                const created = createSearchTreeNode(segment, cumulativePath);
                nodeByPath.set(cumulativePath, created);
                parent.folders.push(created);
                parent = created;
            }

            return parent;
        };

        for (const entry of entries) {
            if (entry.kind === 'folder') {
                ensureNode(entry.path);
                continue;
            }

            const folderNode = ensureNode(entry.folderPath);
            if (entry.kind === 'track') {
                folderNode.trackEntries.push(entry);
                continue;
            }

            if (entry.kind === 'text-file') {
                folderNode.textFileEntries.push(entry);
                continue;
            }

            folderNode.imageFileEntries.push(entry);
        }

        return root;
    };

    const findSearchTreeNode = (root: SearchTreeNode, path: string): SearchTreeNode | null => {
        if (path.trim() === '') {
            return root;
        }

        const segments = path.split('/').filter((segment) => segment !== '');
        let current: SearchTreeNode | null = root;

        for (const segment of segments) {
            current = current.folders.find((folder) => folder.name === segment) || null;
            if (!current) {
                return null;
            }
        }

        return current;
    };

    const createLibraryIconElement = (kind: 'folder' | 'track' | 'text-file' | 'image-file'): HTMLSpanElement => {
        const icon = document.createElement('span');
        icon.className = `library-entry-icon ${kind}`;

        if (kind === 'folder') {
            icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M3 6.5C3 5.12 4.12 4 5.5 4H9.09C9.75 4 10.37 4.26 10.83 4.72L12.11 6H18.5C19.88 6 21 7.12 21 8.5V17.5C21 18.88 19.88 20 18.5 20H5.5C4.12 20 3 18.88 3 17.5V6.5Z"/></svg>';
            return icon;
        }

        if (kind === 'track') {
            icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M16.75 4.5V13.33C16.17 12.98 15.49 12.78 14.75 12.78C12.68 12.78 11 14.26 11 16.08C11 17.9 12.68 19.38 14.75 19.38C16.82 19.38 18.5 17.9 18.5 16.08V8.26L21 7.43V4.62L16.75 6.02V4.5ZM3 6.75H13V8.5H3V6.75ZM3 10.5H13V12.25H3V10.5ZM3 14.25H9.5V16H3V14.25Z"/></svg>';
            return icon;
        }

        if (kind === 'text-file') {
            icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6 3.5C4.9 3.5 4 4.4 4 5.5V18.5C4 19.6 4.9 20.5 6 20.5H18C19.1 20.5 20 19.6 20 18.5V9L14.5 3.5H6ZM14 5.6L17.9 9.5H14V5.6ZM7.5 11H16.5V12.5H7.5V11ZM7.5 14H16.5V15.5H7.5V14Z"/></svg>';
            return icon;
        }

        icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M5.5 4C4.67 4 4 4.67 4 5.5V18.5C4 19.33 4.67 20 5.5 20H18.5C19.33 20 20 19.33 20 18.5V5.5C20 4.67 19.33 4 18.5 4H5.5ZM7 8.5C7 7.67 7.67 7 8.5 7C9.33 7 10 7.67 10 8.5C10 9.33 9.33 10 8.5 10C7.67 10 7 9.33 7 8.5ZM6.5 17L10 12.5L12.8 16L14.6 13.8L17.5 17H6.5Z"/></svg>';
        return icon;
    };

    const setLibraryEntryButtonContent = (
        button: HTMLButtonElement,
        kind: 'folder' | 'track' | 'text-file' | 'image-file',
        label: string,
        prefix?: string,
    ): void => {
        button.textContent = '';

        if (prefix) {
            const prefixSpan = document.createElement('span');
            prefixSpan.className = 'library-entry-prefix';
            prefixSpan.textContent = `${prefix} `;
            button.append(prefixSpan);
        }

        button.append(createLibraryIconElement(kind));

        const labelSpan = document.createElement('span');
        labelSpan.className = 'library-entry-label';
        labelSpan.textContent = label;
        button.append(labelSpan);
    };

    const searchEntryLabel = (entry: LibraryBrowserEntry): string => {
        return entry.name;
    };

    const prefersReducedSearchTreeMotion = (): boolean => {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    };

    const getSearchTreeChildList = (folderItem: HTMLLIElement): HTMLUListElement | null => {
        for (const child of Array.from(folderItem.children)) {
            if (child instanceof HTMLUListElement && child.classList.contains('library-tree-list')) {
                return child;
            }
        }

        return null;
    };

    const clearSearchTreeListAnimation = (list: HTMLUListElement): void => {
        const cleanupHandle = Number(list.dataset.searchTreeAnimationHandle || '');
        if (!Number.isNaN(cleanupHandle) && cleanupHandle > 0) {
            window.clearTimeout(cleanupHandle);
        }

        delete list.dataset.searchTreeAnimationHandle;
        list.classList.remove('is-collapsible', 'is-animating');
        list.style.height = '';
        list.style.opacity = '';
    };

    const scheduleSearchTreeListCleanup = (
        list: HTMLUListElement,
        cleanup: () => void,
    ): void => {
        const cleanupHandle = Number(list.dataset.searchTreeAnimationHandle || '');
        if (!Number.isNaN(cleanupHandle) && cleanupHandle > 0) {
            window.clearTimeout(cleanupHandle);
        }

        const nextCleanupHandle = window.setTimeout(() => {
            delete list.dataset.searchTreeAnimationHandle;
            cleanup();
        }, searchTreeToggleDurationMs);

        list.dataset.searchTreeAnimationHandle = String(nextCleanupHandle);
    };

    const setSearchFolderButtonExpanded = (
        button: HTMLButtonElement,
        folderName: string,
        expandable: boolean,
        expanded: boolean,
    ): void => {
        setLibraryEntryButtonContent(
            button,
            'folder',
            folderName,
            expandable ? (expanded ? '▾' : '▸') : '•',
        );

        button.classList.toggle('is-leaf', !expandable);
        button.classList.toggle('is-expanded', expandable && expanded);
        button.setAttribute('aria-expanded', expandable ? String(expanded) : 'false');
    };

    function appendSearchTreeRows(list: HTMLUListElement, node: SearchTreeNode): void {
        const sortedFolders = [...node.folders].sort((left, right) => compareLibraryLabels(left.name, right.name));

        for (const folder of sortedFolders) {
            const folderItem = document.createElement('li');
            folderItem.className = 'library-tree-node';

            const hasChildren = folder.folders.length > 0
                || folder.trackEntries.length > 0
                || folder.textFileEntries.length > 0
                || folder.imageFileEntries.length > 0;
            const isExpanded = hasChildren && expandedSearchFolders.has(folder.path);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-tree-folder';
            button.dataset.searchFolderPath = folder.path;
            button.dataset.searchFolderExpandable = hasChildren ? 'true' : 'false';
            button.dataset.hoverKey = `search-folder:${folder.path}`;
            if (hoveredBrowserEntryKey === button.dataset.hoverKey) {
                button.classList.add('is-hovered');
            }

            setSearchFolderButtonExpanded(button, folder.name, hasChildren, isExpanded);
            folderItem.append(button);

            if (hasChildren && isExpanded) {
                const childList = createSearchTreeChildList(folder);
                if (childList) {
                    folderItem.append(childList);
                }
            }

            list.append(folderItem);
        }

        const appendFileRows = (entries: LibraryBrowserEntry[], kind: 'track' | 'text-file' | 'image-file'): void => {
            const sortedEntries = [...entries].sort((left, right) => {
                const leftLabel = left.name;
                const rightLabel = right.name;
                return compareLibraryLabels(leftLabel, rightLabel);
            });

            for (const entry of sortedEntries) {
                const row = document.createElement('li');
                row.className = 'library-tree-entry';

                const button = document.createElement('button');
                button.type = 'button';
                button.className = `library-entry ${kind}`;
                button.title = entry.relativePath || entry.path || entry.name;

                if (kind === 'track') {
                    const trackIndex = options.resolveTrackIndex(entry.path);
                    if (trackIndex >= 0 && trackIndex === options.getCurrentTrackIndex()) {
                        button.classList.add('active');
                    }
                    button.dataset.trackPath = entry.path;
                } else if (kind === 'text-file') {
                    button.dataset.textFilePath = entry.path;
                } else {
                    button.dataset.imageFilePath = entry.path;
                }

                setLibraryEntryButtonContent(button, kind, searchEntryLabel(entry));
                row.append(button);
                list.append(row);
            }
        };

        appendFileRows(node.trackEntries, 'track');
        appendFileRows(node.textFileEntries, 'text-file');
        appendFileRows(node.imageFileEntries, 'image-file');
    }

    function createSearchTreeChildList(node: SearchTreeNode): HTMLUListElement | null {
        const childList = document.createElement('ul');
        childList.className = 'library-tree-list';
        appendSearchTreeRows(childList, node);
        return childList.childElementCount > 0 ? childList : null;
    }

    const expandSearchTreeFolder = (folderItem: HTMLLIElement, folder: SearchTreeNode): void => {
        let childList = getSearchTreeChildList(folderItem);
        if (!childList) {
            childList = createSearchTreeChildList(folder);
            if (!childList) {
                return;
            }

            folderItem.append(childList);
        }

        const listToAnimate = childList;

        if (prefersReducedSearchTreeMotion()) {
            clearSearchTreeListAnimation(listToAnimate);
            return;
        }

        const currentHeight = listToAnimate.getBoundingClientRect().height;
        clearSearchTreeListAnimation(listToAnimate);
        listToAnimate.classList.add('is-collapsible', 'is-animating');
        listToAnimate.style.height = `${Math.max(currentHeight, 0)}px`;
        listToAnimate.style.opacity = currentHeight > 0 ? '1' : '0';
        void listToAnimate.offsetHeight;

        listToAnimate.style.height = `${listToAnimate.scrollHeight}px`;
        listToAnimate.style.opacity = '1';

        scheduleSearchTreeListCleanup(listToAnimate, () => {
            listToAnimate.classList.remove('is-collapsible', 'is-animating');
            listToAnimate.style.height = '';
            listToAnimate.style.opacity = '';
        });
    };

    const collapseSearchTreeFolder = (folderItem: HTMLLIElement): void => {
        const childList = getSearchTreeChildList(folderItem);
        if (!childList) {
            return;
        }

        if (prefersReducedSearchTreeMotion()) {
            clearSearchTreeListAnimation(childList);
            childList.remove();
            return;
        }

        const currentHeight = childList.getBoundingClientRect().height || childList.scrollHeight;
        clearSearchTreeListAnimation(childList);
        childList.classList.add('is-collapsible', 'is-animating');
        childList.style.height = `${currentHeight}px`;
        childList.style.opacity = '1';
        void childList.offsetHeight;

        childList.style.height = '0px';
        childList.style.opacity = '0';

        scheduleSearchTreeListCleanup(childList, () => {
            childList.remove();
        });
    };

    const createSearchPane = (): HTMLUListElement => {
        const pane = document.createElement('ul');
        pane.className = 'library-list-pane library-search-pane';

        activeSearchTreeRoot = null;

        if (!activeSearchResult) {
            pane.innerHTML = `<li class="empty${librarySearchPending ? ' is-searching' : ''}">${librarySearchPending ? 'Searching...' : 'No files match your search'}</li>`;
            return pane;
        }

        if (activeSearchResult.errorMessage && activeSearchResult.entries.length === 0) {
            pane.innerHTML = `<li class="empty">${activeSearchResult.errorMessage}</li>`;
            return pane;
        }

        if (activeSearchResult.entries.length === 0 && !activeSearchResult.loading) {
            pane.innerHTML = '<li class="empty">No files match your search</li>';
            return pane;
        }

        const rootList = document.createElement('ul');
        rootList.className = 'library-tree-list library-tree-root';
        activeSearchTreeRoot = buildSearchTree(activeSearchResult.entries);
        appendSearchTreeRows(rootList, activeSearchTreeRoot);

        if (rootList.childElementCount === 0) {
            pane.innerHTML = `<li class="empty${activeSearchResult.loading ? ' is-searching' : ''}">${activeSearchResult.loading ? 'Searching...' : 'No files match your search'}</li>`;
            return pane;
        }

        if (activeSearchResult.loading || activeSearchResult.errorMessage) {
            const statusRow = document.createElement('li');
            statusRow.className = activeSearchResult.loading ? 'empty is-searching' : 'empty';
            statusRow.textContent = activeSearchResult.loading
                ? 'Searching...'
                : activeSearchResult.errorMessage as string;
            pane.append(statusRow);
        }

        pane.append(rootList);

        return pane;
    };

    const isSearchRequestCurrent = (query: string, requestVersion: number): boolean => {
        return requestVersion === librarySearchRequestVersion && query === normalizedLibrarySearchQuery();
    };

    const loadSearchResults = async (query: string, requestVersion: number): Promise<void> => {
        const searchResult: SearchResultState = {
            entries: [],
            entryKeys: new Set<string>(),
            loading: true,
            errorMessage: null,
        };

        activeSearchResult = searchResult;
        renderFolder('none');

        let offset = 0;

        try {
            while (true) {
                const page = await options.searchLibrary(query, offset, serverPageSize);
                if (!isSearchRequestCurrent(query, requestVersion)) {
                    return;
                }

                for (const entry of page.entries || []) {
                    const key = `${entry.kind}:${entry.path}`;
                    if (searchResult.entryKeys.has(key)) {
                        continue;
                    }

                    searchResult.entryKeys.add(key);
                    searchResult.entries.push(entry);
                }

                renderFolder('none');

                const nextOffset = page.offset + (page.entries?.length ?? 0);
                if (nextOffset >= page.totalEntries || (page.entries?.length ?? 0) === 0) {
                    break;
                }

                offset = nextOffset;
            }

            if (!isSearchRequestCurrent(query, requestVersion)) {
                return;
            }

            searchResult.loading = false;
            librarySearchPending = false;
            renderFolder('none');
        } catch (error) {
            if (!isSearchRequestCurrent(query, requestVersion)) {
                return;
            }

            console.error(error);
            searchResult.loading = false;
            searchResult.errorMessage = searchResult.entries.length > 0
                ? 'Unable to load complete search results.'
                : 'Unable to search library.';
            librarySearchPending = false;
            renderFolder('none');
        }
    };

    const entryLabel = (entry: LibraryBrowserEntry, source: PaneSource): string => {
        if (entry.kind === 'folder') {
            return source.kind === 'search'
                ? (entry.relativePath || entry.path || entry.name)
                : entry.name;
        }

        if (entry.kind === 'track') {
            return source.kind === 'search'
                ? (entry.relativePath || entry.name)
                : entry.name;
        }

        if (entry.kind === 'text-file') {
            return source.kind === 'search'
                ? (entry.relativePath || entry.name)
                : entry.name;
        }

        return source.kind === 'search'
            ? (entry.relativePath || entry.name)
            : entry.name;
    };

    const createEntryRow = (entry: LibraryBrowserEntry, source: PaneSource): HTMLLIElement => {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.title = entry.relativePath || entry.path || entry.name;

        if (entry.kind === 'folder') {
            button.className = 'library-entry folder';
            button.dataset.folderPath = entry.path;
        } else if (entry.kind === 'track') {
            const trackIndex = options.resolveTrackIndex(entry.path);
            button.className = `library-entry track${trackIndex >= 0 && trackIndex === options.getCurrentTrackIndex() ? ' active' : ''}`;
            button.dataset.trackPath = entry.path;
        } else if (entry.kind === 'text-file') {
            button.className = 'library-entry text-file';
            button.dataset.textFilePath = entry.path;
        } else {
            button.className = 'library-entry image-file';
            button.dataset.imageFilePath = entry.path;
        }

        const hoverKey = hoverKeyForBrowserEntry(entry);
        button.dataset.hoverKey = hoverKey;
        if (hoveredBrowserEntryKey === hoverKey) {
            button.classList.add('is-hovered');
        }

        setLibraryEntryButtonContent(button, entry.kind, entryLabel(entry, source));
        row.append(button);
        return row;
    };

    const emptyMessageForSource = (source: PaneSource): string => {
        return source.kind === 'search' ? 'No files match your search' : 'Folder is empty';
    };

    const desiredPageRange = (pane: HTMLUListElement, state: PaneState): { startPage: number; endPage: number } => {
        if (state.totalEntries === null || state.totalEntries <= 0) {
            return { startPage: 0, endPage: 0 };
        }

        const viewportHeight = pane.clientHeight > 0 ? pane.clientHeight : state.rowHeightEstimate * serverPageSize;
        const startRow = Math.max(0, Math.floor(pane.scrollTop / state.rowHeightEstimate) - rowOverscanCount);
        const endRow = Math.min(
            state.totalEntries,
            Math.ceil((pane.scrollTop + viewportHeight) / state.rowHeightEstimate) + rowOverscanCount,
        );

        const totalPages = Math.max(1, Math.ceil(state.totalEntries / serverPageSize));
        const startPage = Math.max(0, Math.floor(startRow / serverPageSize));
        const endPage = Math.min(totalPages - 1, Math.floor(Math.max(endRow - 1, 0) / serverPageSize));
        return {
            startPage,
            endPage,
        };
    };

    const renderPaneRows = (pane: HTMLUListElement): void => {
        const state = paneStateByElement.get(pane);
        if (!state) {
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        const previousScrollTop = pane.scrollTop;
        const emptyMessage = emptyMessageForSource(state.source);

        if (state.errorMessage && state.loadedPages.size === 0) {
            pane.innerHTML = `<li class="empty">${state.errorMessage}</li>`;
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        if (state.totalEntries === 0 && state.loadingPages.size === 0) {
            pane.innerHTML = `<li class="empty">${emptyMessage}</li>`;
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        if (state.loadedPages.size === 0) {
            pane.innerHTML = '';
            setViewportLoadingIndicatorVisible(true);
            return;
        }

        const fragment = document.createDocumentFragment();
        const totalEntries = state.totalEntries ?? (Math.max(...state.loadedPages.keys()) + 1) * serverPageSize;
        const pageRange = desiredPageRange(pane, state);
        const pageIndexes = Array.from(state.loadedPages.keys())
            .filter((pageIndex) => pageIndex >= pageRange.startPage && pageIndex <= pageRange.endPage)
            .sort((left, right) => left - right);

        if (pageIndexes.length === 0) {
            const loadingStartIndex = pageRange.startPage * serverPageSize;
            if (loadingStartIndex > 0) {
                fragment.append(createSpacerRow(loadingStartIndex * state.rowHeightEstimate));
            }

            const remainingRows = Math.max(0, totalEntries - loadingStartIndex);
            if (remainingRows > 0) {
                fragment.append(createSpacerRow(remainingRows * state.rowHeightEstimate));
            }

            pane.replaceChildren(fragment);
            pane.scrollTop = previousScrollTop;
            setViewportLoadingIndicatorVisible(true);
            return;
        }

        let renderedCursor = pageIndexes[0] * serverPageSize;
        if (renderedCursor > 0) {
            fragment.append(createSpacerRow(renderedCursor * state.rowHeightEstimate));
        }

        for (const pageIndex of pageIndexes) {
            const pageEntries = state.loadedPages.get(pageIndex) || [];
            const pageStartIndex = pageIndex * serverPageSize;
            if (pageStartIndex > renderedCursor) {
                fragment.append(createSpacerRow((pageStartIndex - renderedCursor) * state.rowHeightEstimate));
            }

            for (const entry of pageEntries) {
                fragment.append(createEntryRow(entry, state.source));
            }

            renderedCursor = pageStartIndex + pageEntries.length;
        }

        if (renderedCursor < totalEntries) {
            fragment.append(createSpacerRow((totalEntries - renderedCursor) * state.rowHeightEstimate));
        }

        pane.replaceChildren(fragment);
        pane.scrollTop = previousScrollTop;
        setViewportLoadingIndicatorVisible(!isFocusPageLoaded(pane, state, totalEntries));
        syncHoveredBrowserButton();

        const firstEntryRow = Array.from(pane.children).find((child) => !child.classList.contains('library-list-spacer') && !child.classList.contains('empty')) as HTMLLIElement | undefined;
        if (firstEntryRow) {
            const style = window.getComputedStyle(firstEntryRow);
            const marginBottom = Number.parseFloat(style.marginBottom || '0');
            const measuredHeight = firstEntryRow.getBoundingClientRect().height + (Number.isNaN(marginBottom) ? 0 : marginBottom);
            if (measuredHeight > 0) {
                state.rowHeightEstimate = measuredHeight;
            }
        }
    };

    const schedulePaneUpdate = (pane: HTMLUListElement): void => {
        const state = paneStateByElement.get(pane);
        if (!state || state.updateScheduled) {
            return;
        }

        state.updateScheduled = true;
        requestAnimationFrame(() => {
            const nextState = paneStateByElement.get(pane);
            if (!nextState) {
                return;
            }

            nextState.updateScheduled = false;
            renderPaneRows(pane);
            void requestPagesForPane(pane);
        });
    };

    const areEntriesEquivalent = (left: LibraryBrowserEntry, right: LibraryBrowserEntry): boolean => {
        return left.kind === right.kind
            && left.path === right.path
            && left.name === right.name
            && left.folderPath === right.folderPath
            && left.relativePath === right.relativePath;
    };

    const areEntryPagesEquivalent = (left: LibraryBrowserEntry[], right: LibraryBrowserEntry[]): boolean => {
        if (left.length !== right.length) {
            return false;
        }

        for (let index = 0; index < left.length; index += 1) {
            if (!areEntriesEquivalent(left[index], right[index])) {
                return false;
            }
        }

        return true;
    };

    const fetchPageForPane = async (pane: HTMLUListElement, pageIndex: number, forceRefresh = false): Promise<void> => {
        const state = paneStateByElement.get(pane);
        if (!state || state.loadingPages.has(pageIndex) || (!forceRefresh && state.loadedPages.has(pageIndex))) {
            return;
        }

        const hasCachedPage = state.loadedPages.has(pageIndex);
        const showLoadingState = !(forceRefresh && hasCachedPage);
        let shouldScheduleUpdate = false;

        if (showLoadingState) {
            state.loadingPages.add(pageIndex);
            shouldScheduleUpdate = true;
            schedulePaneUpdate(pane);
        }

        try {
            const offset = pageIndex * serverPageSize;
            const page = state.source.kind === 'folder'
                ? await options.loadFolderPage(state.source.folderPath, offset, serverPageSize)
                : await options.searchLibrary(state.source.query, offset, serverPageSize);

            const latestState = paneStateByElement.get(pane);
            if (!latestState || latestState.version !== state.version) {
                return;
            }

            const nextEntries = page.entries || [];
            const previousEntries = latestState.loadedPages.get(pageIndex) || [];
            if (latestState.totalEntries !== page.totalEntries || !areEntryPagesEquivalent(previousEntries, nextEntries)) {
                shouldScheduleUpdate = true;
            }

            latestState.totalEntries = page.totalEntries;
            latestState.loadedPages.set(pageIndex, nextEntries);
            if (Number.isFinite(page.totalEntries) && page.totalEntries >= 0) {
                const pageCount = Math.max(1, Math.ceil(page.totalEntries / serverPageSize));
                for (const loadedPageIndex of Array.from(latestState.loadedPages.keys())) {
                    if (loadedPageIndex >= pageCount) {
                        latestState.loadedPages.delete(loadedPageIndex);
                        shouldScheduleUpdate = true;
                    }
                }
            }
            if (latestState.errorMessage) {
                shouldScheduleUpdate = true;
            }
            latestState.errorMessage = null;
        } catch (error) {
            const latestState = paneStateByElement.get(pane);
            if (!latestState || latestState.version !== state.version) {
                return;
            }

            console.error(error);
            if (latestState.errorMessage !== 'Unable to load library entries.') {
                shouldScheduleUpdate = true;
                latestState.errorMessage = 'Unable to load library entries.';
            }
        } finally {
            const latestState = paneStateByElement.get(pane);
            if (latestState && latestState.version === state.version) {
                if (showLoadingState && latestState.loadingPages.has(pageIndex)) {
                    latestState.loadingPages.delete(pageIndex);
                    shouldScheduleUpdate = true;
                }

                if (shouldScheduleUpdate) {
                    schedulePaneUpdate(pane);
                }
            }
        }
    };

    const requestPagesForPane = async (pane: HTMLUListElement, forceRefresh = false): Promise<void> => {
        const state = paneStateByElement.get(pane);
        if (!state) {
            return;
        }

        const pageRange = desiredPageRange(pane, state);
        const requestedPages: Promise<void>[] = [];
        for (let pageIndex = pageRange.startPage; pageIndex <= pageRange.endPage; pageIndex += 1) {
            requestedPages.push(fetchPageForPane(pane, pageIndex, forceRefresh));
        }

        if (requestedPages.length === 0) {
            requestedPages.push(fetchPageForPane(pane, 0, forceRefresh));
        }

        await Promise.all(requestedPages);
    };

    const createPagedPane = (source: PaneSource): HTMLUListElement => {
        const pane = document.createElement('ul');
        pane.className = `library-list-pane${source.kind === 'search' ? ' library-search-pane' : ''}`;

        paneStateByElement.set(pane, {
            source,
            version: ++paneVersionCounter,
            totalEntries: null,
            loadedPages: new Map<number, LibraryBrowserEntry[]>(),
            loadingPages: new Set<number>(),
            rowHeightEstimate: initialRowHeightEstimatePx,
            updateScheduled: false,
            errorMessage: null,
        });

        pane.addEventListener('scroll', () => {
            schedulePaneUpdate(pane);
        });

        renderPaneRows(pane);
        void requestPagesForPane(pane);
        return pane;
    };

    const mountPane = (nextPane: HTMLUListElement, direction: RenderDirection): void => {
        const existingPanes = Array.from(libraryBrowser.querySelectorAll('.library-list-pane')) as HTMLUListElement[];
        if (existingPanes.length > 1) {
            existingPanes.slice(0, -1).forEach((pane) => pane.remove());
        }

        const current = currentPane();
        if (current) {
            current.classList.remove('from-right', 'from-left', 'to-left', 'to-right');
            current.classList.add('current');
        }

        if (!current || direction === 'none') {
            libraryBrowser.innerHTML = '';
            nextPane.classList.add('current');
            libraryBrowser.append(nextPane);
            ensureViewportLoadingIndicatorMounted();
            ensureFolderEnumerationTooltipMounted();
            syncHoveredBrowserButton();
            return;
        }

        current.classList.remove('current');
        nextPane.classList.add('current');
        if (direction === 'forward') {
            nextPane.classList.add('from-right');
            current.classList.add('to-left');
        } else {
            nextPane.classList.add('from-left');
            current.classList.add('to-right');
        }

        libraryBrowser.append(nextPane);
        ensureViewportLoadingIndicatorMounted();
        ensureFolderEnumerationTooltipMounted();
        syncHoveredBrowserButton();

        requestAnimationFrame(() => {
            nextPane.classList.remove('from-right', 'from-left');
        });

        const cleanup = (): void => {
            current.remove();
        };

        nextPane.addEventListener('transitionend', cleanup, { once: true });
        window.setTimeout(cleanup, 260);
    };

    const renderFolder = (direction: RenderDirection): void => {
        ensureViewportLoadingIndicatorMounted();
        setLibraryPathLabel();

        if (!libraryRootName) {
            libraryBrowser.innerHTML = '';
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        if (isLibrarySearchActive() && librarySearchPending && (!activeSearchResult || activeSearchResult.entries.length === 0)) {
            libraryBrowser.innerHTML = '';
            const loadingPane = document.createElement('ul');
            loadingPane.className = 'library-list-pane library-search-pane current';
            loadingPane.innerHTML = '<li class="empty is-searching">Searching...</li>';
            libraryBrowser.append(loadingPane);
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        const source = activeSource();
        if (!source) {
            libraryBrowser.innerHTML = '';
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        if (source.kind === 'search') {
            const nextPane = createSearchPane();
            mountPane(nextPane, 'none');
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        const current = currentPane();
        const currentState = current ? paneStateByElement.get(current) : undefined;
        if (direction === 'none' && current && currentState && sourceKey(currentState.source) === sourceKey(source)) {
            renderPaneRows(current);
            void requestPagesForPane(current);
            return;
        }

        const nextPane = createPagedPane(source);
        mountPane(nextPane, direction);
    };

    const navigateToFolder = (nextFolderPath: string): void => {
        const hadSearch = isLibrarySearchActive();
        if (hadSearch) {
            clearLibrarySearch();
        }

        if (nextFolderPath === currentFolderPath) {
            renderFolder('none');
            return;
        }

        const segmentCount = (path: string): number => path.split('/').filter((segment) => segment !== '').length;
        const nextDepth = segmentCount(nextFolderPath);
        const currentDepth = segmentCount(currentFolderPath);

        currentFolderPath = nextFolderPath;
        if (nextDepth < currentDepth) {
            renderFolder('back');
            return;
        }

        if (nextDepth > currentDepth) {
            renderFolder('forward');
            return;
        }

        renderFolder('none');
    };

    const setSidebarOpen = (open: boolean): void => {
        const wasOpen = sidebarOpen;

        if (!open && wasOpen) {
            options.onSidebarClosed();
            sidebarAutoFolderPath = currentFolderPath;
        }

        sidebarOpen = open;

        if (sidebarOpen && !wasOpen) {
            currentFolderPath = sidebarAutoFolderPath;
            renderFolder('none');
        }

        app.classList.toggle('sidebar-open', sidebarOpen);
        librarySidebar.setAttribute('aria-hidden', sidebarOpen ? 'false' : 'true');
        refreshSidebarToggleState();
    };

    const setLibrarySearchQuery = (nextValue: string): void => {
        if (librarySearchQuery === nextValue) {
            return;
        }

        librarySearchQuery = nextValue;
        const normalizedQuery = normalizedLibrarySearchQuery();
        if (!normalizedQuery) {
            cancelLibrarySearch();
            renderFolder('none');
            return;
        }

        clearScheduledLibrarySearch();
        librarySearchPending = true;
        activeSearchResult = null;
        expandedSearchFolders.clear();
        const requestVersion = ++librarySearchRequestVersion;
        renderFolder('none');
        librarySearchDebounceHandle = window.setTimeout(() => {
            librarySearchDebounceHandle = undefined;
            if (requestVersion != librarySearchRequestVersion || normalizedQuery != normalizedLibrarySearchQuery()) {
                return;
            }

            void loadSearchResults(normalizedQuery, requestVersion);
        }, searchDebounceMs);
    };

    const normalizePastedLibraryPath = (value: string): string => {
        const trimmed = value.trim().replace(/^["']+|["']+$/g, '').trim();
        if (!trimmed) {
            return '';
        }

        return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
    };

    const isLikelyAbsoluteLibraryPath = (value: string): boolean => {
        return /^[a-z]:\//i.test(value) || value.startsWith('//');
    };

    const rebuildPastedPathLookupCache = (
        tracks: Track[] = options.getTracks(),
        textFiles: TextLibraryFile[] = options.getTextFiles(),
        imageFiles: ImageLibraryFile[] = options.getImageFiles(),
    ): void => {
        const indexedFolderPathByKey = new Map<string, string>();
        const indexedFileFolderPathByKey = new Map<string, string>();
        const monitoredRootByKey = new Map<string, { path: string; name: string }>();

        const rememberFolderPath = (folderPath: string): void => {
            const normalizedPath = normalizePastedLibraryPath(folderPath);
            const key = libraryFolderPathKey(normalizedPath);
            if (!key || indexedFolderPathByKey.has(key)) {
                return;
            }

            indexedFolderPathByKey.set(key, normalizedPath);
        };

        const rememberFolderHierarchy = (folderPath: string): void => {
            const normalizedFolderPath = normalizePastedLibraryPath(folderPath);
            if (!normalizedFolderPath) {
                return;
            }

            const segments = normalizedFolderPath.split('/').filter((segment) => segment !== '');
            let cumulativePath = '';
            for (const segment of segments) {
                cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
                rememberFolderPath(cumulativePath);
            }
        };

        const rememberIndexedFile = (path: string, folderPath: string, rootPath: string): void => {
            const normalizedFolderPath = normalizePastedLibraryPath(folderPath);
            const normalizedFilePath = normalizePastedLibraryPath(path);
            const normalizedRootPath = normalizePastedLibraryPath(rootPath);
            const fileKey = libraryFolderPathKey(normalizedFilePath);
            if (fileKey && !indexedFileFolderPathByKey.has(fileKey)) {
                indexedFileFolderPathByKey.set(fileKey, normalizedFolderPath);
            }

            const rootKey = libraryFolderPathKey(normalizedRootPath);
            if (rootKey && !monitoredRootByKey.has(rootKey)) {
                const rootSegments = normalizedFolderPath.split('/').filter((segment) => segment !== '');
                monitoredRootByKey.set(rootKey, {
                    path: normalizedRootPath,
                    name: rootSegments[0] || '',
                });
            }

            rememberFolderHierarchy(normalizedFolderPath);
        };

        for (const track of tracks) {
            rememberIndexedFile(track.path, track.folderPath, track.rootPath);
        }

        for (const textFile of textFiles) {
            rememberIndexedFile(textFile.path, textFile.folderPath, textFile.rootPath);
        }

        for (const imageFile of imageFiles) {
            rememberIndexedFile(imageFile.path, imageFile.folderPath, imageFile.rootPath);
        }

        pastedPathLookupCache = {
            indexedFolderPathByKey,
            indexedFileFolderPathByKey,
            monitoredRoots: Array.from(monitoredRootByKey.values()).sort((left, right) => right.path.length - left.path.length),
        };
    };

    const resolvePastedLibraryJumpFolder = (value: string): string | null => {
        const normalizedPath = normalizePastedLibraryPath(value);
        if (!normalizedPath || !isLikelyAbsoluteLibraryPath(normalizedPath)) {
            return null;
        }

        const pathKey = libraryFolderPathKey(normalizedPath);
        if (!pathKey) {
            return null;
        }

        if (
            pastedPathLookupCache.monitoredRoots.length === 0
            && pastedPathLookupCache.indexedFolderPathByKey.size === 0
            && pastedPathLookupCache.indexedFileFolderPathByKey.size === 0
        ) {
            rebuildPastedPathLookupCache();
        }

        const {
            indexedFolderPathByKey,
            indexedFileFolderPathByKey,
            monitoredRoots,
        } = pastedPathLookupCache;

        const exactFileFolderPath = indexedFileFolderPathByKey.get(pathKey);
        if (exactFileFolderPath !== undefined) {
            return exactFileFolderPath;
        }

        const exactFolderPath = indexedFolderPathByKey.get(pathKey);
        if (exactFolderPath !== undefined) {
            return exactFolderPath;
        }

        for (const monitoredRoot of monitoredRoots) {
            const rootKey = libraryFolderPathKey(monitoredRoot.path);
            if (!rootKey) {
                continue;
            }

            let virtualFolderPath = monitoredRoot.name;
            if (pathKey === rootKey) {
                virtualFolderPath = monitoredRoot.name;
            } else if (pathKey.startsWith(`${rootKey}/`)) {
                const relativeFolderPath = normalizedPath.slice(monitoredRoot.path.length + 1);
                virtualFolderPath = monitoredRoot.name
                    ? `${monitoredRoot.name}/${relativeFolderPath}`
                    : relativeFolderPath;
            } else {
                continue;
            }

            const indexedFolderPath = indexedFolderPathByKey.get(libraryFolderPathKey(virtualFolderPath));
            if (indexedFolderPath !== undefined) {
                return indexedFolderPath;
            }
        }

        return null;
    };

    const jumpToFolderFromPastedPath = (folderPath: string): void => {
        const preservedValue = librarySearch.value;
        const preservedSelectionStart = librarySearch.selectionStart;
        const preservedSelectionEnd = librarySearch.selectionEnd;
        const preservedSelectionDirection = librarySearch.selectionDirection;

        if (isLibrarySearchActive()) {
            cancelLibrarySearch();
            librarySearchQuery = '';
        }

        const segmentCount = (path: string): number => path.split('/').filter((segment) => segment !== '').length;
        const nextDepth = segmentCount(folderPath);
        const currentDepth = segmentCount(currentFolderPath);
        currentFolderPath = folderPath;
        if (nextDepth < currentDepth) {
            renderFolder('back');
        } else if (nextDepth > currentDepth) {
            renderFolder('forward');
        } else {
            renderFolder('none');
        }

        librarySearch.value = preservedValue;
        if (preservedSelectionStart !== null && preservedSelectionEnd !== null) {
            librarySearch.setSelectionRange(
                preservedSelectionStart,
                preservedSelectionEnd,
                preservedSelectionDirection || undefined,
            );
        }
    };

    const tryHandlePastedLibraryPath = async (rawValue: string): Promise<boolean> => {
        const normalizedPath = normalizePastedLibraryPath(rawValue);
        if (!normalizedPath || !isLikelyAbsoluteLibraryPath(normalizedPath)) {
            return false;
        }

        const folderPath = (await options.resolveLibraryFolderForAbsolutePath(normalizedPath)) || resolvePastedLibraryJumpFolder(normalizedPath);
        if (folderPath === null || folderPath === '') {
            suppressNextLibrarySearchPasteInput = false;
            return false;
        }

        suppressNextLibrarySearchPasteInput = true;
        jumpToFolderFromPastedPath(folderPath);
        return true;
    };

    const rebuildLibraryTree = (
        rootName: string,
        truncated: boolean,
        tracks: Track[],
        textFiles: TextLibraryFile[],
        imageFiles: ImageLibraryFile[],
    ): Promise<void> => {
        libraryRootName = rootName || defaultLibraryRootLabel;
        libraryIndexTruncated = truncated;
        rebuildPastedPathLookupCache(tracks, textFiles, imageFiles);
        cancelLibrarySearch();
        if (sidebarOpen) {
            renderFolder('none');
        }
        return Promise.resolve();
    };

    const resetLibraryState = (): void => {
        libraryRootName = '';
        currentFolderPath = '';
        sidebarAutoFolderPath = '';
        libraryIndexTruncated = false;
        pastedPathLookupCache = {
            indexedFolderPathByKey: new Map<string, string>(),
            indexedFileFolderPathByKey: new Map<string, string>(),
            monitoredRoots: [],
        };
        clearLibrarySearch();
        libraryBrowser.innerHTML = '';
        setViewportLoadingIndicatorVisible(false);
        hideFolderEnumerationTooltip();
    };

    sidebarToggle.addEventListener('click', () => {
        setSidebarOpen(!sidebarOpen);
    });

    librarySearch.addEventListener('beforeinput', (event) => {
        if (!(event instanceof InputEvent) || event.inputType !== 'insertFromPaste') {
            return;
        }

        const pastedText = event.dataTransfer?.getData('text/plain') || event.data || '';
        const normalizedPath = normalizePastedLibraryPath(pastedText);
        if (!normalizedPath || !isLikelyAbsoluteLibraryPath(normalizedPath)) {
            return;
        }

        suppressNextLibrarySearchPasteInput = true;
        event.preventDefault();
        event.stopPropagation();
        void tryHandlePastedLibraryPath(pastedText);
    });

    librarySearch.addEventListener('input', (event) => {
        if (suppressNextLibrarySearchPasteInput) {
            suppressNextLibrarySearchPasteInput = false;
            librarySearch.value = librarySearchQuery;
            return;
        }

        if (event instanceof InputEvent && event.inputType === 'insertFromPaste') {
            const pastedValue = librarySearch.value;
            librarySearch.value = librarySearchQuery;
            suppressNextLibrarySearchPasteInput = true;
            void tryHandlePastedLibraryPath(pastedValue);
            return;
        }

        setLibrarySearchQuery(librarySearch.value);
    });

    librarySearch.addEventListener('paste', (event) => {
        const pastedText = event.clipboardData?.getData('text') || '';
        const normalizedPath = normalizePastedLibraryPath(pastedText);
        if (!normalizedPath || !isLikelyAbsoluteLibraryPath(normalizedPath)) {
            return;
        }

        suppressNextLibrarySearchPasteInput = true;
        event.preventDefault();
        event.stopPropagation();
        void tryHandlePastedLibraryPath(pastedText);
    });

    librarySearch.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || librarySearch.value === '') {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        clearLibrarySearch();
        renderFolder('none');
    });

    libraryBrowser.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('button');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const searchFolderPath = button.dataset.searchFolderPath;
        if (searchFolderPath !== undefined) {
            if (button.dataset.searchFolderExpandable !== 'true') {
                return;
            }

            const folderItem = button.closest('.library-tree-node');
            if (!(folderItem instanceof HTMLLIElement) || !activeSearchTreeRoot) {
                if (expandedSearchFolders.has(searchFolderPath)) {
                    expandedSearchFolders.delete(searchFolderPath);
                } else {
                    expandedSearchFolders.add(searchFolderPath);
                }

                renderFolder('none');
                return;
            }

            const folder = findSearchTreeNode(activeSearchTreeRoot, searchFolderPath);
            if (!folder) {
                renderFolder('none');
                return;
            }

            if (expandedSearchFolders.has(searchFolderPath)) {
                expandedSearchFolders.delete(searchFolderPath);
                setSearchFolderButtonExpanded(button, folder.name, true, false);
                collapseSearchTreeFolder(folderItem);
            } else {
                expandedSearchFolders.add(searchFolderPath);
                setSearchFolderButtonExpanded(button, folder.name, true, true);
                expandSearchTreeFolder(folderItem, folder);
            }
            return;
        }

        const nextFolder = button.dataset.folderPath;
        if (nextFolder !== undefined) {
            void options.isFolderImmediateDescendantsEnumerated(nextFolder).then((isEnumerated) => {
                if (!isEnumerated) {
                    showFolderEnumerationTooltip(button);
                    return;
                }

                hideFolderEnumerationTooltip();
                navigateToFolder(nextFolder);
            }).catch((error) => {
                console.error(error);
            });
            return;
        }

        const trackPath = button.dataset.trackPath;
        if (trackPath !== undefined) {
            const index = options.resolveTrackIndex(trackPath);
            if (index >= 0) {
                options.onTrackChosen(index);
            } else if (options.onTrackPathChosen) {
                options.onTrackPathChosen(trackPath);
            }
            return;
        }

        const textFilePath = button.dataset.textFilePath;
        if (textFilePath !== undefined) {
            const index = options.resolveTextFileIndex(textFilePath);
            if (index >= 0) {
                options.onTextFileChosen(index);
            }
            return;
        }

        const imageFilePath = button.dataset.imageFilePath;
        if (imageFilePath !== undefined) {
            const index = options.resolveImageFileIndex(imageFilePath);
            if (index >= 0) {
                options.onImageFileChosen(index);
            }
        }
    });

    libraryBrowser.addEventListener('mousemove', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('button');
        if (!(button instanceof HTMLButtonElement)) {
            hoveredBrowserEntryKey = null;
            setHoveredBrowserButton(null);
            return;
        }

        const hoverKey = hoverKeyForButton(button);
        if (!hoverKey) {
            hoveredBrowserEntryKey = null;
            setHoveredBrowserButton(null);
            return;
        }

        hoveredBrowserEntryKey = hoverKey;
        setHoveredBrowserButton(button);
    });

    libraryBrowser.addEventListener('mouseleave', () => {
        hoveredBrowserEntryKey = null;
        setHoveredBrowserButton(null);
    });

    libraryBrowser.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('button');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const isFolderButton = button.classList.contains('library-tree-folder')
            || button.classList.contains('folder');
        if (isFolderButton) {
            const folderPath = button.dataset.searchFolderPath ?? button.dataset.folderPath ?? '';
            event.preventDefault();
            event.stopPropagation();
            options.onFolderQueueRequested(
                event.clientX,
                event.clientY,
                folderPath,
                button.textContent?.trim() || folderPath,
            );
            return;
        }

        const trackPath = button.dataset.trackPath;
        if (trackPath !== undefined) {
            const trackIndex = options.resolveTrackIndex(trackPath);
            if (trackIndex < 0) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            options.onQueueRequested(event.clientX, event.clientY, [trackIndex], trackIndex);
            return;
        }

        const searchFolderPath = button.dataset.searchFolderPath;
        if (searchFolderPath !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            options.onFolderQueueRequested(
                event.clientX,
                event.clientY,
                searchFolderPath,
                button.textContent?.trim() || searchFolderPath,
            );
            return;
        }

        const folderPath = button.dataset.folderPath;
        if (folderPath === undefined) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        options.onFolderQueueRequested(
            event.clientX,
            event.clientY,
            folderPath,
            button.textContent?.trim() || folderPath,
        );
    });

    libraryBack.addEventListener('click', () => {
        if (isLibrarySearchActive()) {
            clearLibrarySearch();
            renderFolder('none');
            return;
        }

        if (!currentFolderPath) {
            return;
        }

        const segments = currentFolderPath.split('/');
        segments.pop();
        currentFolderPath = segments.join('/');
        renderFolder('back');
    });

    libraryPath.addEventListener('click', (event) => {
        if (isLibrarySearchActive()) {
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        const nextPath = target.dataset.folderPath;
        if (nextPath === undefined || nextPath === currentFolderPath) {
            return;
        }

        navigateToFolder(nextPath);
    });

    const refreshCurrentFolder = (): void => {
        const pane = currentPane();
        if (pane) {
            const state = paneStateByElement.get(pane);
            if (state && state.source.kind === 'folder' && state.source.folderPath === currentFolderPath) {
                // Keep current rows visible while refreshing to avoid loading-overlay flicker.
                state.errorMessage = null;
                schedulePaneUpdate(pane);
                void requestPagesForPane(pane, true);
                return;
            }
        }
        renderFolder('none');
    };

    return {
        clearLibrarySearch,
        firstTrackIndexFromRandomAlbumFolder,
        getLibrarySearchQuery: () => librarySearchQuery,
        getLibrarySearchStateSnapshot,
        getLibraryRootName: () => libraryRootName,
        getSidebarAutoFolderPath: () => sidebarAutoFolderPath,
        getCurrentFolderPath: () => currentFolderPath,
        isLibrarySearchActive,
        isSidebarOpen: () => sidebarOpen,
        navigateToFolder,
        refreshCurrentFolder,
        refreshSidebarToggleState,
        rebuildLibraryTree,
        renderFolder,
        resetLibraryState,
        setCurrentFolderPath: (path: string) => {
            currentFolderPath = path;
        },
        setLibraryLoading,
        setLibraryLoadingEtaSeconds,
        setLibraryLoadingStatusLabel,
        setLibraryPathMessage: (message: string) => {
            libraryPath.innerHTML = '';
            libraryPath.textContent = message;
        },
        restoreLibrarySearchQuery: (query: string) => {
            restoreLibrarySearchState({
                query,
                pending: false,
                result: null,
                expandedFolderPaths: [],
            });
        },
        restoreLibrarySearchState,
        setLibraryRootName: (rootName: string) => {
            libraryRootName = rootName;
        },
        setLibraryIndexTruncated: (truncated: boolean) => {
            libraryIndexTruncated = truncated;
        },
        setSidebarAutoFolderPath: (folderPath: string) => {
            sidebarAutoFolderPath = folderPath;
        },
        setSidebarOpen,
    };
};