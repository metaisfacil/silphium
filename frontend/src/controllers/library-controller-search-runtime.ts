import type { LibraryBrowserEntry } from '../types/app-types';
import {
    clearSearchTreeListAnimation,
    compareLibraryLabels,
    createSearchMessageRow,
    getSearchTreeChildList,
    prefersReducedSearchTreeMotion,
    scheduleSearchTreeListCleanup,
    searchEntryLabel,
    setLibraryEntryButtonContent,
    setSearchFolderButtonExpanded,
} from './library-controller-dom-helpers';
import { buildSearchTree } from './library-controller-search-tree';
import type {
    LibraryControllerOptions,
    SearchResultState,
    SearchTreeNode,
} from './library-controller-types';

export interface LibraryControllerSearchContext {
    options: Pick<LibraryControllerOptions, 'getCurrentTrackIndex' | 'resolveTrackIndex' | 'searchLibrary' | 'getHighlightMusicBrainzTaggedAlbumFolders'>;
    expandedSearchFolders: Set<string>;
    getActiveSearchResult: () => SearchResultState | null;
    setActiveSearchResult: (value: SearchResultState | null) => void;
    setActiveSearchTreeRoot: (value: SearchTreeNode | null) => void;
    getHoveredBrowserEntryKey: () => string | null;
    getLibraryRootName: () => string;
    getLibrarySearchPending: () => boolean;
    setLibrarySearchPending: (value: boolean) => void;
    isSearchRequestCurrent: (query: string, requestVersion: number) => boolean;
    normalizedLibrarySearchQuery: () => string;
    rerenderCurrentFolder: () => void;
    serverPageSize: number;
    syncHoveredBrowserButton: () => void;
}

export const createLibraryControllerSearchRuntime = (context: LibraryControllerSearchContext) => {
    function appendSearchTreeRows(list: HTMLUListElement, node: SearchTreeNode): void {
        const sortedFolders = [...node.folders].sort((left, right) => compareLibraryLabels(left.name, right.name));

        for (const folder of sortedFolders) {
            const folderItem = document.createElement('li');
            folderItem.className = 'library-tree-node';

            const hasChildren = folder.folders.length > 0
                || folder.trackEntries.length > 0
                || folder.textFileEntries.length > 0
                || folder.imageFileEntries.length > 0;
            const isExpanded = hasChildren && context.expandedSearchFolders.has(folder.path);

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-tree-folder';
            button.dataset.searchFolderPath = folder.path;
            button.dataset.searchFolderExpandable = hasChildren ? 'true' : 'false';
            button.dataset.hoverKey = `search-folder:${folder.path}`;
            if (context.getHoveredBrowserEntryKey() === button.dataset.hoverKey) {
                button.classList.add('is-hovered');
            }

            setSearchFolderButtonExpanded(
                button,
                folder.name,
                hasChildren,
                isExpanded,
                folder.musicBrainzTaggedAlbumDir && context.options.getHighlightMusicBrainzTaggedAlbumFolders(),
            );
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
            const sortedEntries = [...entries].sort((left, right) => compareLibraryLabels(left.name, right.name));

            for (const entry of sortedEntries) {
                const row = document.createElement('li');
                row.className = 'library-tree-entry';

                const button = document.createElement('button');
                button.type = 'button';
                button.className = `library-entry ${kind}`;
                button.title = entry.relativePath || entry.path || entry.name;

                if (kind === 'track') {
                    const trackIndex = context.options.resolveTrackIndex(entry.path);
                    if (trackIndex >= 0 && trackIndex === context.options.getCurrentTrackIndex()) {
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

        if (prefersReducedSearchTreeMotion()) {
            clearSearchTreeListAnimation(childList);
            return;
        }

        const currentHeight = childList.getBoundingClientRect().height;
        clearSearchTreeListAnimation(childList);
        childList.classList.add('is-collapsible', 'is-animating');
        childList.style.height = `${Math.max(currentHeight, 0)}px`;
        childList.style.opacity = currentHeight > 0 ? '1' : '0';
        void childList.offsetHeight;

        childList.style.height = `${childList.scrollHeight}px`;
        childList.style.opacity = '1';

        scheduleSearchTreeListCleanup(childList, () => {
            childList.classList.remove('is-collapsible', 'is-animating');
            childList.style.height = '';
            childList.style.opacity = '';
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

    const renderSearchPaneContents = (pane: HTMLUListElement): void => {
        const previousScrollTop = pane.scrollTop;
        const previousScrollLeft = pane.scrollLeft;
        const activeSearchResult = context.getActiveSearchResult();

        pane.dataset.searchQuery = context.normalizedLibrarySearchQuery();
        context.setActiveSearchTreeRoot(null);

        if (!activeSearchResult) {
            pane.replaceChildren(createSearchMessageRow(
                context.getLibrarySearchPending() ? 'Searching...' : 'No files match your search',
                `empty${context.getLibrarySearchPending() ? ' is-searching' : ''}`,
            ));
            pane.scrollTop = previousScrollTop;
            pane.scrollLeft = previousScrollLeft;
            return;
        }

        if (activeSearchResult.errorMessage && activeSearchResult.entries.length === 0) {
            pane.replaceChildren(createSearchMessageRow(activeSearchResult.errorMessage));
            pane.scrollTop = previousScrollTop;
            pane.scrollLeft = previousScrollLeft;
            return;
        }

        if (activeSearchResult.entries.length === 0 && !activeSearchResult.loading) {
            pane.replaceChildren(createSearchMessageRow('No files match your search'));
            pane.scrollTop = previousScrollTop;
            pane.scrollLeft = previousScrollLeft;
            return;
        }

        const fragment = document.createDocumentFragment();
        const rootList = document.createElement('ul');
        rootList.className = 'library-tree-list library-tree-root';
        const activeSearchTreeRoot = buildSearchTree(activeSearchResult.entries, context.getLibraryRootName());
        context.setActiveSearchTreeRoot(activeSearchTreeRoot);
        appendSearchTreeRows(rootList, activeSearchTreeRoot);

        if (rootList.childElementCount === 0) {
            fragment.append(createSearchMessageRow(
                activeSearchResult.loading ? 'Searching...' : 'No files match your search',
                `empty${activeSearchResult.loading ? ' is-searching' : ''}`,
            ));
            pane.replaceChildren(fragment);
            pane.scrollTop = previousScrollTop;
            pane.scrollLeft = previousScrollLeft;
            return;
        }

        if (activeSearchResult.loading || activeSearchResult.errorMessage) {
            fragment.append(createSearchMessageRow(
                activeSearchResult.loading
                    ? 'Searching...'
                    : activeSearchResult.errorMessage as string,
                activeSearchResult.loading ? 'empty is-searching' : 'empty',
            ));
        }

        fragment.append(rootList);
        pane.replaceChildren(fragment);
        pane.scrollTop = previousScrollTop;
        pane.scrollLeft = previousScrollLeft;
        context.syncHoveredBrowserButton();
    };

    const createSearchPane = (): HTMLUListElement => {
        const pane = document.createElement('ul');
        pane.className = 'library-list-pane library-search-pane';
        renderSearchPaneContents(pane);
        return pane;
    };

    const loadSearchResults = async (query: string, requestVersion: number): Promise<void> => {
        const searchResult: SearchResultState = {
            entries: [],
            entryKeys: new Set<string>(),
            loading: true,
            errorMessage: null,
        };

        context.setActiveSearchResult(searchResult);
        context.rerenderCurrentFolder();

        let offset = 0;

        try {
            while (true) {
                const page = await context.options.searchLibrary(query, offset, context.serverPageSize);
                if (!context.isSearchRequestCurrent(query, requestVersion)) {
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

                context.rerenderCurrentFolder();

                const nextOffset = page.offset + (page.entries?.length ?? 0);
                if (nextOffset >= page.totalEntries || (page.entries?.length ?? 0) === 0) {
                    break;
                }

                offset = nextOffset;
            }

            if (!context.isSearchRequestCurrent(query, requestVersion)) {
                return;
            }

            searchResult.loading = false;
            context.setLibrarySearchPending(false);
            context.rerenderCurrentFolder();
        } catch (error) {
            if (!context.isSearchRequestCurrent(query, requestVersion)) {
                return;
            }

            console.error(error);
            searchResult.loading = false;
            searchResult.errorMessage = searchResult.entries.length > 0
                ? 'Unable to load complete search results.'
                : 'Unable to search library.';
            context.setLibrarySearchPending(false);
            context.rerenderCurrentFolder();
        }
    };

    return {
        collapseSearchTreeFolder,
        createSearchPane,
        expandSearchTreeFolder,
        loadSearchResults,
        renderSearchPaneContents,
    };
};