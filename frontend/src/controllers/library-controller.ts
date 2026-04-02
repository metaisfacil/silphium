import type {
    ImageLibraryFile,
    LibraryBrowserEntry,
    LibraryFolderPage,
    LibrarySearchPage,
    TextLibraryFile,
    Track,
} from '../types/app-types';

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

type LibraryControllerOptions = {
    app: HTMLElement;
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    librarySearch: HTMLInputElement;
    libraryBrowser: HTMLElement;
    getTracks: () => Track[];
    getTextFiles: () => TextLibraryFile[];
    getImageFiles: () => ImageLibraryFile[];
    getCurrentTrackIndex: () => number;
    loadFolderPage: (folderPath: string, offset: number, limit: number) => Promise<LibraryFolderPage>;
    searchLibrary: (query: string, offset: number, limit: number) => Promise<LibrarySearchPage>;
    resolveTrackIndex: (path: string) => number;
    resolveTextFileIndex: (path: string) => number;
    resolveImageFileIndex: (path: string) => number;
    getFolderTrackIndexes: (folderPath: string) => Promise<number[]>;
    onTrackChosen: (index: number) => void;
    onTextFileChosen: (index: number) => void;
    onImageFileChosen: (index: number) => void;
    onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[]) => void;
    onSidebarClosed: () => void;
};

export type LibraryController = ReturnType<typeof createLibraryController>;

const serverPageSize = 100;
const searchDebounceMs = 180;
const rowOverscanCount = 30;
const initialRowHeightEstimatePx = 28;

export const createLibraryController = (options: LibraryControllerOptions) => {
    const {
        app,
        sidebarToggle,
        librarySidebar,
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
    let activeSearchResult: SearchResultState | null = null;
    let paneVersionCounter = 0;
    const expandedSearchFolders = new Set<string>();
    const paneStateByElement = new WeakMap<HTMLUListElement, PaneState>();

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
        const loadingEtaLabel = libraryLoading && !sidebarOpen ? loadingIndicatorLabel() : '';
        sidebarToggle.classList.toggle('has-loading-eta', loadingEtaLabel !== '');
        sidebarToggle.textContent = libraryLoading ? loadingEtaLabel : '‣‣‣';

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

    const queueIndexesForFolder = async (folderPath: string): Promise<number[]> => {
        const trackIndexes = await options.getFolderTrackIndexes(folderPath);
        return trackIndexes.filter((trackIndex) => Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < getTracks().length);
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

    const searchEntryLabel = (entry: LibraryBrowserEntry): string => {
        if (entry.kind === 'track') {
            return `🎵 ${entry.name}`;
        }

        if (entry.kind === 'text-file') {
            return `📄 ${entry.name}`;
        }

        return `🖼️ ${entry.name}`;
    };

    const appendSearchTreeRows = (list: HTMLUListElement, node: SearchTreeNode): void => {
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
            button.textContent = `${hasChildren ? (isExpanded ? '▾' : '▸') : '•'} 📁 ${folder.name}`;

            if (!hasChildren) {
                button.classList.add('is-leaf');
            }

            folderItem.append(button);

            if (hasChildren && isExpanded) {
                const childList = document.createElement('ul');
                childList.className = 'library-tree-list';
                appendSearchTreeRows(childList, folder);
                if (childList.childElementCount > 0) {
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
                    if (trackIndex === options.getCurrentTrackIndex()) {
                        button.classList.add('active');
                    }
                    button.dataset.trackPath = entry.path;
                } else if (kind === 'text-file') {
                    button.dataset.textFilePath = entry.path;
                } else {
                    button.dataset.imageFilePath = entry.path;
                }

                button.textContent = searchEntryLabel(entry);
                row.append(button);
                list.append(row);
            }
        };

        appendFileRows(node.trackEntries, 'track');
        appendFileRows(node.textFileEntries, 'text-file');
        appendFileRows(node.imageFileEntries, 'image-file');
    };

    const createSearchPane = (): HTMLUListElement => {
        const pane = document.createElement('ul');
        pane.className = 'library-list-pane library-search-pane';

        if (!activeSearchResult) {
            pane.innerHTML = `<li class="empty">${librarySearchPending ? 'Searching...' : 'No files match your search'}</li>`;
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
        appendSearchTreeRows(rootList, buildSearchTree(activeSearchResult.entries));

        if (rootList.childElementCount === 0) {
            pane.innerHTML = `<li class="empty">${activeSearchResult.loading ? 'Searching...' : 'No files match your search'}</li>`;
            return pane;
        }

        if (activeSearchResult.loading || activeSearchResult.errorMessage) {
            const statusRow = document.createElement('li');
            statusRow.className = 'empty';
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
                ? `📁 ${entry.relativePath || entry.path || entry.name}`
                : `📁 ${entry.name}`;
        }

        if (entry.kind === 'track') {
            return source.kind === 'search'
                ? `🎵 ${entry.relativePath || entry.name}`
                : `🎵 ${entry.name}`;
        }

        if (entry.kind === 'text-file') {
            return source.kind === 'search'
                ? `📄 ${entry.relativePath || entry.name}`
                : `📄 ${entry.name}`;
        }

        return source.kind === 'search'
            ? `🖼️ ${entry.relativePath || entry.name}`
            : `🖼️ ${entry.name}`;
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
            button.className = `library-entry track${trackIndex === options.getCurrentTrackIndex() ? ' active' : ''}`;
            button.dataset.trackPath = entry.path;
        } else if (entry.kind === 'text-file') {
            button.className = 'library-entry text-file';
            button.dataset.textFilePath = entry.path;
        } else {
            button.className = 'library-entry image-file';
            button.dataset.imageFilePath = entry.path;
        }

        button.textContent = entryLabel(entry, source);
        row.append(button);
        return row;
    };

    const emptyMessageForSource = (source: PaneSource): string => {
        return source.kind === 'search' ? 'No files match your search' : 'Folder is empty';
    };

    const loadingMessageForSource = (source: PaneSource): string => {
        return source.kind === 'search' ? 'Searching...' : 'Loading...';
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
            return;
        }

        const previousScrollTop = pane.scrollTop;
        const emptyMessage = emptyMessageForSource(state.source);
        const loadingMessage = loadingMessageForSource(state.source);

        if (state.errorMessage && state.loadedPages.size === 0) {
            pane.innerHTML = `<li class="empty">${state.errorMessage}</li>`;
            return;
        }

        if (state.totalEntries === 0 && state.loadingPages.size === 0) {
            pane.innerHTML = `<li class="empty">${emptyMessage}</li>`;
            return;
        }

        if (state.loadedPages.size === 0) {
            pane.innerHTML = `<li class="empty">${loadingMessage}</li>`;
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

            const loadingRow = document.createElement('li');
            loadingRow.className = 'empty';
            loadingRow.textContent = loadingMessage;
            fragment.append(loadingRow);

            const remainingRows = Math.max(0, totalEntries - loadingStartIndex - 1);
            if (remainingRows > 0) {
                fragment.append(createSpacerRow(remainingRows * state.rowHeightEstimate));
            }

            pane.replaceChildren(fragment);
            pane.scrollTop = previousScrollTop;
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

    const fetchPageForPane = async (pane: HTMLUListElement, pageIndex: number): Promise<void> => {
        const state = paneStateByElement.get(pane);
        if (!state || state.loadedPages.has(pageIndex) || state.loadingPages.has(pageIndex)) {
            return;
        }

        state.loadingPages.add(pageIndex);
        schedulePaneUpdate(pane);

        try {
            const offset = pageIndex * serverPageSize;
            const page = state.source.kind === 'folder'
                ? await options.loadFolderPage(state.source.folderPath, offset, serverPageSize)
                : await options.searchLibrary(state.source.query, offset, serverPageSize);

            const latestState = paneStateByElement.get(pane);
            if (!latestState || latestState.version !== state.version) {
                return;
            }

            latestState.totalEntries = page.totalEntries;
            latestState.loadedPages.set(pageIndex, page.entries || []);
            latestState.errorMessage = null;
        } catch (error) {
            const latestState = paneStateByElement.get(pane);
            if (!latestState || latestState.version !== state.version) {
                return;
            }

            console.error(error);
            latestState.errorMessage = 'Unable to load library entries.';
        } finally {
            const latestState = paneStateByElement.get(pane);
            if (!latestState || latestState.version !== state.version) {
                return;
            }

            latestState.loadingPages.delete(pageIndex);
            schedulePaneUpdate(pane);
        }
    };

    const requestPagesForPane = async (pane: HTMLUListElement): Promise<void> => {
        const state = paneStateByElement.get(pane);
        if (!state) {
            return;
        }

        const pageRange = desiredPageRange(pane, state);
        const requestedPages: Promise<void>[] = [];
        for (let pageIndex = pageRange.startPage; pageIndex <= pageRange.endPage; pageIndex += 1) {
            requestedPages.push(fetchPageForPane(pane, pageIndex));
        }

        if (requestedPages.length === 0) {
            requestedPages.push(fetchPageForPane(pane, 0));
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
        setLibraryPathLabel();

        if (!libraryRootName) {
            libraryBrowser.innerHTML = '';
            return;
        }

        if (isLibrarySearchActive() && librarySearchPending && (!activeSearchResult || activeSearchResult.entries.length === 0)) {
            libraryBrowser.innerHTML = '';
            const loadingPane = document.createElement('ul');
            loadingPane.className = 'library-list-pane library-search-pane current';
            loadingPane.innerHTML = '<li class="empty">Searching...</li>';
            libraryBrowser.append(loadingPane);
            return;
        }

        const source = activeSource();
        if (!source) {
            libraryBrowser.innerHTML = '';
            return;
        }

        if (source.kind === 'search') {
            const nextPane = createSearchPane();
            mountPane(nextPane, 'none');
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
            if (requestVersion !== librarySearchRequestVersion || normalizedQuery !== normalizedLibrarySearchQuery()) {
                return;
            }

            void loadSearchResults(normalizedQuery, requestVersion);
        }, searchDebounceMs);
    };

    const rebuildLibraryTree = (
        rootName: string,
        truncated: boolean,
        _tracks: Track[],
        _textFiles: TextLibraryFile[],
        _imageFiles: ImageLibraryFile[],
    ): Promise<void> => {
        libraryRootName = rootName || 'Selected folder';
        libraryIndexTruncated = truncated;
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
        clearLibrarySearch();
        libraryBrowser.innerHTML = '';
    };

    sidebarToggle.addEventListener('click', () => {
        setSidebarOpen(!sidebarOpen);
    });

    librarySearch.addEventListener('input', () => {
        setLibrarySearchQuery(librarySearch.value);
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

            if (expandedSearchFolders.has(searchFolderPath)) {
                expandedSearchFolders.delete(searchFolderPath);
            } else {
                expandedSearchFolders.add(searchFolderPath);
            }

            renderFolder('none');
            return;
        }

        const nextFolder = button.dataset.folderPath;
        if (nextFolder !== undefined) {
            navigateToFolder(nextFolder);
            return;
        }

        const trackPath = button.dataset.trackPath;
        if (trackPath !== undefined) {
            const index = options.resolveTrackIndex(trackPath);
            if (index >= 0) {
                options.onTrackChosen(index);
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

    libraryBrowser.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('button');
        if (!(button instanceof HTMLButtonElement)) {
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
            options.onQueueRequested(event.clientX, event.clientY, [trackIndex]);
            return;
        }

        const searchFolderPath = button.dataset.searchFolderPath;
        if (searchFolderPath !== undefined) {
            event.preventDefault();
            event.stopPropagation();
            void queueIndexesForFolder(searchFolderPath).then((trackIndexes) => {
                if (trackIndexes.length === 0) {
                    return;
                }

                options.onQueueRequested(event.clientX, event.clientY, trackIndexes);
            }).catch((error) => {
                console.error(error);
            });
            return;
        }

        const folderPath = button.dataset.folderPath;
        if (folderPath === undefined) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void queueIndexesForFolder(folderPath).then((trackIndexes) => {
            if (trackIndexes.length === 0) {
                return;
            }

            options.onQueueRequested(event.clientX, event.clientY, trackIndexes);
        }).catch((error) => {
            console.error(error);
        });
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

    return {
        clearLibrarySearch,
        firstTrackIndexFromRandomAlbumFolder,
        getLibraryRootName: () => libraryRootName,
        getSidebarAutoFolderPath: () => sidebarAutoFolderPath,
        getCurrentFolderPath: () => currentFolderPath,
        isLibrarySearchActive,
        isSidebarOpen: () => sidebarOpen,
        navigateToFolder,
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