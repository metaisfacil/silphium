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
    SearchTreeNode,
    LibrarySearchStateSnapshot,
    PastedPathLookupCache,
    RenderDirection,
} from './library-controller-types';
import {
    createLibraryControllerState,
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
    const controllerState = options.state ?? createLibraryControllerState();

    let librarySearchRequestVersion = 0;
    let librarySearchDebounceHandle: number | undefined;
    let suppressNextLibrarySearchPasteInput = false;
    let activeSearchTreeRoot: SearchTreeNode | null = null;
    let pastedPathLookupCache: PastedPathLookupCache = createEmptyPastedPathLookupCache();
    let paneVersionCounter = 0;
    let hoveredBrowserEntryKey: string | null = null;
    let hoveredBrowserButton: HTMLButtonElement | null = null;
    const paneStateByElement = new WeakMap<HTMLUListElement, PaneState>();
    const getTracks = (): Track[] => options.getTracks();

    const normalizedLibrarySearchQuery = (): string => controllerState.librarySearchQuery.trim().toLowerCase();

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
        controllerState.librarySearchPending = false;
        controllerState.activeSearchResult = null;
        controllerState.expandedSearchFolders.clear();
        clearScheduledLibrarySearch();
    };

    const clearLibrarySearch = (): void => {
        controllerState.librarySearchQuery = '';
        librarySearch.value = '';
        cancelLibrarySearch();
    };

    const getLibrarySearchStateSnapshot = (): LibrarySearchStateSnapshot => {
        return {
            query: controllerState.librarySearchQuery,
            pending: controllerState.librarySearchPending,
            result: cloneSearchResultState(controllerState.activeSearchResult),
            expandedFolderPaths: Array.from(controllerState.expandedSearchFolders),
        };
    };

    const restoreLibrarySearchState = (snapshot: LibrarySearchStateSnapshot): void => {
        clearScheduledLibrarySearch();
        librarySearchRequestVersion += 1;

        controllerState.librarySearchQuery = snapshot.query || '';
        librarySearch.value = controllerState.librarySearchQuery;

        controllerState.expandedSearchFolders.clear();
        for (const folderPath of snapshot.expandedFolderPaths || []) {
            controllerState.expandedSearchFolders.add(folderPath);
        }

        if (normalizedLibrarySearchQuery() === '') {
            controllerState.librarySearchPending = false;
            controllerState.activeSearchResult = null;
        } else {
            controllerState.librarySearchPending = !!snapshot.pending;
            controllerState.activeSearchResult = cloneSearchResultState(snapshot.result);
        }

        if (controllerState.sidebarOpen) {
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
        if (!controllerState.libraryRootName) {
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
            folderPath: controllerState.currentFolderPath,
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
            return controllerState.sidebarOpen;
        },
        set sidebarOpen(value) {
            controllerState.sidebarOpen = value;
        },
        get libraryRootName() {
            return controllerState.libraryRootName;
        },
        set libraryRootName(value) {
            controllerState.libraryRootName = value;
        },
        get currentFolderPath() {
            return controllerState.currentFolderPath;
        },
        set currentFolderPath(value) {
            controllerState.currentFolderPath = value;
        },
        get libraryIndexTruncated() {
            return controllerState.libraryIndexTruncated;
        },
        set libraryIndexTruncated(value) {
            controllerState.libraryIndexTruncated = value;
        },
        get libraryLoading() {
            return controllerState.libraryLoading;
        },
        set libraryLoading(value) {
            controllerState.libraryLoading = value;
        },
        get libraryLoadingEtaSeconds() {
            return controllerState.libraryLoadingEtaSeconds;
        },
        set libraryLoadingEtaSeconds(value) {
            controllerState.libraryLoadingEtaSeconds = value;
        },
        get libraryLoadingStatusLabel() {
            return controllerState.libraryLoadingStatusLabel;
        },
        set libraryLoadingStatusLabel(value) {
            controllerState.libraryLoadingStatusLabel = value;
        },
        get hoveredBrowserButton() {
            return hoveredBrowserButton;
        },
        set hoveredBrowserButton(value) {
            hoveredBrowserButton = value;
        },
        isLibrarySearchActive,
        getLibrarySearchQuery: () => controllerState.librarySearchQuery,
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
        expandedSearchFolders: controllerState.expandedSearchFolders,
        getActiveSearchResult: () => controllerState.activeSearchResult,
        setActiveSearchResult: (value) => {
            controllerState.activeSearchResult = value;
        },
        setActiveSearchTreeRoot: (value) => {
            activeSearchTreeRoot = value;
        },
        getHoveredBrowserEntryKey: () => hoveredBrowserEntryKey,
        getLibraryRootName: () => controllerState.libraryRootName,
        getLibrarySearchPending: () => controllerState.librarySearchPending,
        setLibrarySearchPending: (value) => {
            controllerState.librarySearchPending = value;
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

        setLibraryEntryButtonContent(button, entry.kind, entryLabel(entry, source), undefined, {
            highlightMusicBrainzTaggedAlbumFolder: entry.kind === 'folder'
                && !!entry.musicBrainzTaggedAlbumDir
                && options.getHighlightMusicBrainzTaggedAlbumFolders(),
        });
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

        if (!controllerState.libraryRootName) {
            libraryBrowser.innerHTML = '';
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        if (isLibrarySearchActive() && controllerState.librarySearchPending && (!controllerState.activeSearchResult || controllerState.activeSearchResult.entries.length === 0)) {
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

        if (nextFolderPath === controllerState.currentFolderPath) {
            renderFolder('none');
            return;
        }

        const segmentCount = (path: string): number => path.split('/').filter((segment) => segment !== '').length;
        const nextDepth = segmentCount(nextFolderPath);
        const currentDepth = segmentCount(controllerState.currentFolderPath);

        controllerState.currentFolderPath = nextFolderPath;
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
        const wasOpen = controllerState.sidebarOpen;

        if (!open && wasOpen) {
            options.onSidebarClosed();
            controllerState.sidebarAutoFolderPath = controllerState.currentFolderPath;
        }

        controllerState.sidebarOpen = open;

        if (controllerState.sidebarOpen && !wasOpen) {
            controllerState.currentFolderPath = controllerState.sidebarAutoFolderPath;
            renderFolder('none');
        }

        app.classList.toggle('sidebar-open', controllerState.sidebarOpen);
        librarySidebar.setAttribute('aria-hidden', controllerState.sidebarOpen ? 'false' : 'true');
        refreshSidebarToggleState();
    };

    const setLibrarySearchQuery = (nextValue: string): void => {
        if (controllerState.librarySearchQuery === nextValue) {
            return;
        }

        controllerState.librarySearchQuery = nextValue;
        const normalizedQuery = normalizedLibrarySearchQuery();
        if (!normalizedQuery) {
            cancelLibrarySearch();
            renderFolder('none');
            return;
        }

        clearScheduledLibrarySearch();
    controllerState.librarySearchPending = true;
    controllerState.activeSearchResult = null;
    controllerState.expandedSearchFolders.clear();
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
            controllerState.librarySearchQuery = '';
        }

        const segmentCount = (path: string): number => path.split('/').filter((segment) => segment !== '').length;
        const nextDepth = segmentCount(folderPath);
        const currentDepth = segmentCount(controllerState.currentFolderPath);
        controllerState.currentFolderPath = folderPath;
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
        controllerState.libraryRootName = rootName || defaultLibraryRootLabel;
        controllerState.libraryIndexTruncated = truncated;
        doRebuildPastedPathLookupCache(tracks, textFiles, imageFiles);
        cancelLibrarySearch();
        if (controllerState.sidebarOpen) {
            renderFolder('none');
        }
        return Promise.resolve();
    };

    const resetLibraryState = (): void => {
        controllerState.libraryRootName = '';
        controllerState.currentFolderPath = '';
        controllerState.sidebarAutoFolderPath = '';
        controllerState.libraryIndexTruncated = false;
        pastedPathLookupCache = createEmptyPastedPathLookupCache();
        clearLibrarySearch();
        libraryBrowser.innerHTML = '';
        setViewportLoadingIndicatorVisible(false);
        hideFolderEnumerationTooltip();
    };

    setupLibraryEventHandlers({
        options,
        getActiveSearchTreeRoot: () => activeSearchTreeRoot,
        getExpandedSearchFolders: () => controllerState.expandedSearchFolders,
        getHoveredBrowserEntryKey: () => hoveredBrowserEntryKey,
        setHoveredBrowserEntryKey: (key: string | null) => { hoveredBrowserEntryKey = key; },
        getSuppressNextLibrarySearchPasteInput: () => suppressNextLibrarySearchPasteInput,
        setSuppressNextLibrarySearchPasteInput: (value: boolean) => { suppressNextLibrarySearchPasteInput = value; },
        getLibrarySearchQuery: () => controllerState.librarySearchQuery,
        setLibrarySearchQueryValue: setLibrarySearchQuery,
        getCurrentFolderPath: () => controllerState.currentFolderPath,
        setCurrentFolderPath: (path: string) => { controllerState.currentFolderPath = path; },
        isLibrarySearchActive,
        clearLibrarySearch,
        navigateToFolder,
        renderFolder,
        setSidebarOpen,
        isSidebarOpen: () => controllerState.sidebarOpen,
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
            if (state && state.source.kind === 'folder' && state.source.folderPath === controllerState.currentFolderPath) {
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
        getLibrarySearchQuery: () => controllerState.librarySearchQuery,
        getLibrarySearchStateSnapshot,
        getLibraryRootName: () => controllerState.libraryRootName,
        getSidebarAutoFolderPath: () => controllerState.sidebarAutoFolderPath,
        getCurrentFolderPath: () => controllerState.currentFolderPath,
        isLibrarySearchActive,
        isSidebarOpen: () => controllerState.sidebarOpen,
        navigateToFolder,
        refreshCurrentFolder,
        refreshSidebarToggleState,
        rebuildLibraryTree,
        renderFolder,
        resetLibraryState,
        setCurrentFolderPath: (path: string) => {
            controllerState.currentFolderPath = path;
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
            controllerState.libraryRootName = rootName;
        },
        setLibraryIndexTruncated: (truncated: boolean) => {
            controllerState.libraryIndexTruncated = truncated;
        },
        setSidebarAutoFolderPath: (folderPath: string) => {
            controllerState.sidebarAutoFolderPath = folderPath;
        },
        setSidebarOpen,
    };
};
