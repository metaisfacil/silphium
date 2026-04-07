import type {
    ImageLibraryFile,
    LibraryBrowserEntry,
    TextLibraryFile,
    Track,
} from '../types/app-types';
import {
    areEntryPagesEquivalent,
    cloneSearchResultState,
    createSpacerRow,
    desiredPageRange,
    emptyMessageForSource,
    entryLabel,
    hoverKeyForBrowserEntry,
    isFocusPageLoaded,
    setLibraryEntryButtonContent,
} from './library-controller-dom-helpers';
import { setupLibraryEventHandlers } from './library-controller-events';
import {
    createEmptyPastedPathLookupCache,
    isLikelyAbsoluteLibraryPath,
    normalizePastedLibraryPath,
    rebuildPastedPathLookupCache,
    resolvePastedLibraryJumpFolder,
} from './library-controller-pasted-path';
import type {
    LibraryControllerOptions,
    PaneSource,
    PaneState,
    SearchResultState,
    SearchTreeNode,
    LibrarySearchStateSnapshot,
    PastedPathLookupCache,
    RenderDirection,
} from './library-controller-types';
import {
    serverPageSize,
    searchDebounceMs,
    initialRowHeightEstimatePx,
    defaultLibraryRootLabel,
} from './library-controller-types';
import { createLibraryControllerViewRuntime } from './library-controller-view-runtime';
import { createLibraryControllerSearchRuntime } from './library-controller-search-runtime';

export type { LibraryControllerOptions } from './library-controller-types';

export type LibraryController = ReturnType<typeof createLibraryController>;

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
    let pastedPathLookupCache: PastedPathLookupCache = createEmptyPastedPathLookupCache();
    let paneVersionCounter = 0;
    let hoveredBrowserEntryKey: string | null = null;
    let hoveredBrowserButton: HTMLButtonElement | null = null;
    const expandedSearchFolders = new Set<string>();
    const paneStateByElement = new WeakMap<HTMLUListElement, PaneState>();
    const getTracks = (): Track[] => options.getTracks();

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

    const viewRuntime = createLibraryControllerViewRuntime({
        app,
        sidebarToggle,
        librarySidebar,
        libraryScanYieldIndicator,
        libraryBack,
        libraryPath,
        libraryBrowser,
        get sidebarOpen() {
            return sidebarOpen;
        },
        set sidebarOpen(value) {
            sidebarOpen = value;
        },
        get libraryRootName() {
            return libraryRootName;
        },
        set libraryRootName(value) {
            libraryRootName = value;
        },
        get currentFolderPath() {
            return currentFolderPath;
        },
        set currentFolderPath(value) {
            currentFolderPath = value;
        },
        get libraryIndexTruncated() {
            return libraryIndexTruncated;
        },
        set libraryIndexTruncated(value) {
            libraryIndexTruncated = value;
        },
        get libraryLoading() {
            return libraryLoading;
        },
        set libraryLoading(value) {
            libraryLoading = value;
        },
        get libraryLoadingEtaSeconds() {
            return libraryLoadingEtaSeconds;
        },
        set libraryLoadingEtaSeconds(value) {
            libraryLoadingEtaSeconds = value;
        },
        get libraryLoadingStatusLabel() {
            return libraryLoadingStatusLabel;
        },
        set libraryLoadingStatusLabel(value) {
            libraryLoadingStatusLabel = value;
        },
        get hoveredBrowserButton() {
            return hoveredBrowserButton;
        },
        set hoveredBrowserButton(value) {
            hoveredBrowserButton = value;
        },
        isLibrarySearchActive,
        getLibrarySearchQuery: () => librarySearchQuery,
        currentPane,
    });
    const {
        hideFolderEnumerationTooltip,
        showFolderEnumerationTooltip,
        refreshSidebarToggleState,
        setHoveredBrowserButton,
        syncHoveredBrowserButton,
        setLibraryLoading,
        setLibraryLoadingEtaSeconds,
        setLibraryLoadingStatusLabel,
        setLibraryPathLabel,
        setViewportLoadingIndicatorVisible,
    } = viewRuntime;

    const isSearchRequestCurrent = (query: string, requestVersion: number): boolean => {
        return requestVersion === librarySearchRequestVersion && query === normalizedLibrarySearchQuery();
    };
    const {
        collapseSearchTreeFolder,
        createSearchPane,
        expandSearchTreeFolder,
        loadSearchResults,
        renderSearchPaneContents,
    } = createLibraryControllerSearchRuntime({
        options,
        expandedSearchFolders,
        getActiveSearchResult: () => activeSearchResult,
        setActiveSearchResult: (value) => {
            activeSearchResult = value;
        },
        setActiveSearchTreeRoot: (value) => {
            activeSearchTreeRoot = value;
        },
        getHoveredBrowserEntryKey: () => hoveredBrowserEntryKey,
        getLibraryRootName: () => libraryRootName,
        getLibrarySearchPending: () => librarySearchPending,
        setLibrarySearchPending: (value) => {
            librarySearchPending = value;
        },
        isSearchRequestCurrent,
        normalizedLibrarySearchQuery,
        rerenderCurrentFolder: () => {
            renderFolder('none');
        },
        serverPageSize,
        syncHoveredBrowserButton: () => {
            syncHoveredBrowserButton(hoveredBrowserEntryKey);
        },
    });

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
        syncHoveredBrowserButton(hoveredBrowserEntryKey);

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
            syncHoveredBrowserButton(hoveredBrowserEntryKey);
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
    syncHoveredBrowserButton(hoveredBrowserEntryKey);

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
            const existingPane = currentPane();
            if (
                direction === 'none'
                && existingPane
                && existingPane.classList.contains('library-search-pane')
                && existingPane.dataset.searchQuery === source.query
            ) {
                renderSearchPaneContents(existingPane);
                setViewportLoadingIndicatorVisible(false);
                return;
            }

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

    const doRebuildPastedPathLookupCache = (
        tracks: Track[] = options.getTracks(),
        textFiles: TextLibraryFile[] = options.getTextFiles(),
        imageFiles: ImageLibraryFile[] = options.getImageFiles(),
    ): void => {
        pastedPathLookupCache = rebuildPastedPathLookupCache(tracks, textFiles, imageFiles);
    };

    const doResolvePastedLibraryJumpFolder = (value: string): string | null => {
        if (
            pastedPathLookupCache.monitoredRoots.length === 0
            && pastedPathLookupCache.indexedFolderPathByKey.size === 0
            && pastedPathLookupCache.indexedFileFolderPathByKey.size === 0
        ) {
            doRebuildPastedPathLookupCache();
        }

        return resolvePastedLibraryJumpFolder(value, pastedPathLookupCache);
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

        const folderPath = (await options.resolveLibraryFolderForAbsolutePath(normalizedPath)) || doResolvePastedLibraryJumpFolder(normalizedPath);
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
        doRebuildPastedPathLookupCache(tracks, textFiles, imageFiles);
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
        pastedPathLookupCache = createEmptyPastedPathLookupCache();
        clearLibrarySearch();
        libraryBrowser.innerHTML = '';
        setViewportLoadingIndicatorVisible(false);
        hideFolderEnumerationTooltip();
    };

    setupLibraryEventHandlers({
        options,
        getActiveSearchTreeRoot: () => activeSearchTreeRoot,
        getExpandedSearchFolders: () => expandedSearchFolders,
        getHoveredBrowserEntryKey: () => hoveredBrowserEntryKey,
        setHoveredBrowserEntryKey: (key: string | null) => { hoveredBrowserEntryKey = key; },
        getSuppressNextLibrarySearchPasteInput: () => suppressNextLibrarySearchPasteInput,
        setSuppressNextLibrarySearchPasteInput: (value: boolean) => { suppressNextLibrarySearchPasteInput = value; },
        getLibrarySearchQuery: () => librarySearchQuery,
        setLibrarySearchQueryValue: setLibrarySearchQuery,
        getCurrentFolderPath: () => currentFolderPath,
        setCurrentFolderPath: (path: string) => { currentFolderPath = path; },
        isLibrarySearchActive,
        clearLibrarySearch,
        navigateToFolder,
        renderFolder,
        setSidebarOpen,
        isSidebarOpen: () => sidebarOpen,
        setHoveredBrowserButton,
        showFolderEnumerationTooltip,
        hideFolderEnumerationTooltip,
        expandSearchTreeFolder,
        collapseSearchTreeFolder,
        tryHandlePastedLibraryPath,
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
