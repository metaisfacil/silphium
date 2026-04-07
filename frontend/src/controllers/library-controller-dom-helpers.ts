import type { LibraryBrowserEntry } from '../types/app-types';
import type { PaneSource, PaneState, SearchResultState } from './library-controller-types';
import { searchTreeToggleDurationMs, serverPageSize } from './library-controller-types';

export const createSpacerRow = (height: number): HTMLLIElement => {
    const spacer = document.createElement('li');
    spacer.className = 'library-list-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${Math.max(0, height)}px`;
    spacer.style.marginBottom = '0';
    spacer.style.pointerEvents = 'none';
    return spacer;
};

export const hoverKeyForBrowserEntry = (entry: LibraryBrowserEntry): string => {
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

export const hoverKeyForButton = (button: HTMLButtonElement): string | null => {
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

export const compareLibraryLabels = (left: string, right: string): number => {
    return left.localeCompare(right, undefined, {
        sensitivity: 'base',
        numeric: true,
    });
};

export const createLibraryIconElement = (kind: 'folder' | 'track' | 'text-file' | 'image-file'): HTMLSpanElement => {
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

export const setLibraryEntryButtonContent = (
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

export const searchEntryLabel = (entry: LibraryBrowserEntry): string => {
    return entry.name;
};

export const prefersReducedSearchTreeMotion = (): boolean => {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export const getSearchTreeChildList = (folderItem: HTMLLIElement): HTMLUListElement | null => {
    for (const child of Array.from(folderItem.children)) {
        if (child instanceof HTMLUListElement && child.classList.contains('library-tree-list')) {
            return child;
        }
    }

    return null;
};

export const clearSearchTreeListAnimation = (list: HTMLUListElement): void => {
    const cleanupHandle = Number(list.dataset.searchTreeAnimationHandle || '');
    if (!Number.isNaN(cleanupHandle) && cleanupHandle > 0) {
        window.clearTimeout(cleanupHandle);
    }

    delete list.dataset.searchTreeAnimationHandle;
    list.classList.remove('is-collapsible', 'is-animating');
    list.style.height = '';
    list.style.opacity = '';
};

export const scheduleSearchTreeListCleanup = (
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

export const setSearchFolderButtonExpanded = (
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

export const createSearchMessageRow = (message: string, className = 'empty'): HTMLLIElement => {
    const row = document.createElement('li');
    row.className = className;
    row.textContent = message;
    return row;
};

export const entryLabel = (entry: LibraryBrowserEntry, source: PaneSource): string => {
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

export const emptyMessageForSource = (source: PaneSource): string => {
    return source.kind === 'search' ? 'No files match your search' : 'Folder is empty';
};

export const areEntriesEquivalent = (left: LibraryBrowserEntry, right: LibraryBrowserEntry): boolean => {
    return left.kind === right.kind
        && left.path === right.path
        && left.name === right.name
        && left.folderPath === right.folderPath
        && left.relativePath === right.relativePath;
};

export const areEntryPagesEquivalent = (left: LibraryBrowserEntry[], right: LibraryBrowserEntry[]): boolean => {
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

export const isFocusPageLoaded = (pane: HTMLUListElement, state: PaneState, totalEntries: number | null): boolean => {
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

export const desiredPageRange = (pane: HTMLUListElement, state: PaneState): { startPage: number; endPage: number } => {
    if (state.totalEntries === null || state.totalEntries <= 0) {
        return { startPage: 0, endPage: 0 };
    }

    const viewportHeight = pane.clientHeight > 0 ? pane.clientHeight : state.rowHeightEstimate * serverPageSize;
    const startRow = Math.max(0, Math.floor(pane.scrollTop / state.rowHeightEstimate) - 30);
    const endRow = Math.min(
        state.totalEntries,
        Math.ceil((pane.scrollTop + viewportHeight) / state.rowHeightEstimate) + 30,
    );

    const totalPages = Math.max(1, Math.ceil(state.totalEntries / serverPageSize));
    const startPage = Math.max(0, Math.floor(startRow / serverPageSize));
    const endPage = Math.min(totalPages - 1, Math.floor(Math.max(endRow - 1, 0) / serverPageSize));
    return {
        startPage,
        endPage,
    };
};

export const cloneSearchResultState = (state: SearchResultState | null): SearchResultState | null => {
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
