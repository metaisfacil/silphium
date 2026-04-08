import type { LibraryControllerOptions, SearchTreeNode } from './library-controller-types';
import {
    hoverKeyForButton,
    setSearchFolderButtonExpanded,
} from './library-controller-dom-helpers';
import {
    collectSearchTreeTrackIndexes,
    findSearchTreeNode,
} from './library-controller-search-tree';
import {
    isLikelyAbsoluteLibraryPath,
    normalizePastedLibraryPath,
} from './library-controller-pasted-path';

export type LibraryEventDeps = {
    options: LibraryControllerOptions;
    getActiveSearchTreeRoot: () => SearchTreeNode | null;
    getExpandedSearchFolders: () => Set<string>;
    getHoveredBrowserEntryKey: () => string | null;
    setHoveredBrowserEntryKey: (key: string | null) => void;
    getSuppressNextLibrarySearchPasteInput: () => boolean;
    setSuppressNextLibrarySearchPasteInput: (value: boolean) => void;
    getLibrarySearchQuery: () => string;
    setLibrarySearchQueryValue: (value: string) => void;
    getCurrentFolderPath: () => string;
    setCurrentFolderPath: (path: string) => void;
    isLibrarySearchActive: () => boolean;
    clearLibrarySearch: () => void;
    navigateToFolder: (path: string) => void;
    renderFolder: (direction: 'none' | 'forward' | 'back') => void;
    setSidebarOpen: (open: boolean) => void;
    isSidebarOpen: () => boolean;
    setHoveredBrowserButton: (button: HTMLButtonElement | null) => void;
    showFolderEnumerationTooltip: (anchor: HTMLElement) => void;
    hideFolderEnumerationTooltip: () => void;
    expandSearchTreeFolder: (folderItem: HTMLLIElement, folder: SearchTreeNode) => void;
    collapseSearchTreeFolder: (folderItem: HTMLLIElement) => void;
    tryHandlePastedLibraryPath: (rawValue: string) => Promise<boolean>;
};

export const setupLibraryEventHandlers = (deps: LibraryEventDeps): void => {
    const {
        options,
        getActiveSearchTreeRoot,
        getExpandedSearchFolders,
        setHoveredBrowserEntryKey,
        getSuppressNextLibrarySearchPasteInput,
        setSuppressNextLibrarySearchPasteInput,
        getLibrarySearchQuery,
        setLibrarySearchQueryValue,
        getCurrentFolderPath,
        setCurrentFolderPath,
        isLibrarySearchActive,
        clearLibrarySearch,
        navigateToFolder,
        renderFolder,
        setSidebarOpen,
        isSidebarOpen,
        setHoveredBrowserButton,
        showFolderEnumerationTooltip,
        hideFolderEnumerationTooltip,
        expandSearchTreeFolder,
        collapseSearchTreeFolder,
        tryHandlePastedLibraryPath,
    } = deps;

    const {
        sidebarToggle,
        libraryBack,
        libraryPath,
        librarySearch,
        libraryBrowser,
    } = options;

    sidebarToggle.addEventListener('click', () => {
        setSidebarOpen(!isSidebarOpen());
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

        setSuppressNextLibrarySearchPasteInput(true);
        event.preventDefault();
        event.stopPropagation();
        void tryHandlePastedLibraryPath(pastedText);
    });

    librarySearch.addEventListener('input', (event) => {
        if (getSuppressNextLibrarySearchPasteInput()) {
            setSuppressNextLibrarySearchPasteInput(false);
            librarySearch.value = getLibrarySearchQuery();
            return;
        }

        if (event instanceof InputEvent && event.inputType === 'insertFromPaste') {
            const pastedValue = librarySearch.value;
            const normalizedPath = normalizePastedLibraryPath(pastedValue);
            if (!normalizedPath || !isLikelyAbsoluteLibraryPath(normalizedPath)) {
                setLibrarySearchQueryValue(pastedValue);
                return;
            }

            librarySearch.value = getLibrarySearchQuery();
            setSuppressNextLibrarySearchPasteInput(true);
            void tryHandlePastedLibraryPath(pastedValue);
            return;
        }

        setLibrarySearchQueryValue(librarySearch.value);
    });

    librarySearch.addEventListener('paste', (event) => {
        const pastedText = event.clipboardData?.getData('text') || '';
        const normalizedPath = normalizePastedLibraryPath(pastedText);
        if (!normalizedPath || !isLikelyAbsoluteLibraryPath(normalizedPath)) {
            return;
        }

        setSuppressNextLibrarySearchPasteInput(true);
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

            const expandedSearchFolders = getExpandedSearchFolders();
            const activeSearchTreeRoot = getActiveSearchTreeRoot();
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
            } else if (options.onTextFilePathChosen) {
                options.onTextFilePathChosen(textFilePath);
            }
            return;
        }

        const imageFilePath = button.dataset.imageFilePath;
        if (imageFilePath !== undefined) {
            const index = options.resolveImageFileIndex(imageFilePath);
            if (index >= 0) {
                options.onImageFileChosen(index);
            } else if (options.onImageFilePathChosen) {
                options.onImageFilePathChosen(imageFilePath);
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
            setHoveredBrowserEntryKey(null);
            setHoveredBrowserButton(null);
            return;
        }

        const hoverKey = hoverKeyForButton(button);
        if (!hoverKey) {
            setHoveredBrowserEntryKey(null);
            setHoveredBrowserButton(null);
            return;
        }

        setHoveredBrowserEntryKey(hoverKey);
        setHoveredBrowserButton(button);
    });

    libraryBrowser.addEventListener('mouseleave', () => {
        setHoveredBrowserEntryKey(null);
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

        const searchFolderPath = button.dataset.searchFolderPath;
        if (searchFolderPath !== undefined) {
            event.preventDefault();
            event.stopPropagation();

            const activeSearchTreeRoot = getActiveSearchTreeRoot();
            const searchFolderNode = activeSearchTreeRoot
                ? findSearchTreeNode(activeSearchTreeRoot, searchFolderPath)
                : null;
            const trackIndexes = searchFolderNode ? collectSearchTreeTrackIndexes(searchFolderNode, options.resolveTrackIndex) : [];
            options.onFolderQueueRequested(
                event.clientX,
                event.clientY,
                searchFolderPath,
                button.textContent?.trim() || searchFolderPath,
                trackIndexes,
            );
            return;
        }

        const isFolderButton = button.classList.contains('library-tree-folder')
            || button.classList.contains('folder');
        if (isFolderButton) {
            const folderPath = button.dataset.folderPath ?? '';
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
            options.onQueueRequested(event.clientX, event.clientY, [trackIndex], trackIndex, true, trackPath);
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

        const currentFolderPath = getCurrentFolderPath();
        if (!currentFolderPath) {
            return;
        }

        const segments = currentFolderPath.split('/');
        segments.pop();
        setCurrentFolderPath(segments.join('/'));
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
        if (nextPath === undefined || nextPath === getCurrentFolderPath()) {
            return;
        }

        navigateToFolder(nextPath);
    });
};
