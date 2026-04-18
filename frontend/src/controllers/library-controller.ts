import type {
    ImageLibraryFile,
    LibraryBrowserEntry,
    LibraryBrowserSortMode,
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
import { findSearchTreeNode } from './library-controller-search-tree';
import { relativeFolderSegmentsForTrack, releaseFolderPathForTrackAtDepth } from '../utils/main-helpers';

export type { LibraryControllerOptions } from './library-controller-types';

export type LibraryController = ReturnType<typeof createLibraryController>;

type ProgrammaticLibrarySearchOptions = {
    expandFilteredFolders?: boolean;
};

type AlbumGridEntry = {
    folderPath: string;
    albumTitle: string;
    albumArtist: string;
    coverFolderCandidates: string[];
};

type AlbumGridCardElements = {
    album: AlbumGridEntry;
    button: HTMLButtonElement;
    cover: HTMLSpanElement;
    image: HTMLImageElement;
};

const albumCoverThumbnailMaxEdgePx = 420;
const albumGridGroupingBatchSize = 400;
const albumGridBuildBatchSize = 200;
const albumGridMinColumnWidthPx = 75;
const albumGridOverscanRows = 3;
const albumGridInitialThumbnailBatchSize = 12;
const albumGridCoverResolutionBatchSize = 24;
const albumGridThumbnailLoadConcurrency = 4;
const albumGridMinimumThumbnailCacheSize = 32;
const albumGridThumbnailCacheWindowMultiplier = 2;
const unknownAlbumLabel = 'Unknown Album';
const unknownArtistLabel = 'Unknown Artist';

type RecursiveAlbumCoverCandidate = {
    path: string;
    descendantDistance: number;
    priority: number;
    sortKey: string;
};

type AlbumThumbnailLoadPriority = 'eager' | 'normal';

export const createLibraryController = (options: LibraryControllerOptions) => {
    const {
        app,
        sidebarToggle,
        librarySidebar,
        libraryScanYieldIndicator,
        libraryExpandToggle,
        libraryBack,
        libraryPath,
        librarySearch,
        librarySort,
        libraryBrowser,
    } = options;
    const controllerState = options.state ?? createLibraryControllerState();

    let librarySearchRequestVersion = 0;
    let librarySearchDebounceHandle: number | undefined;
    let expandFilteredFoldersOnNextSearchTree = false;
    let suppressNextLibrarySearchPasteInput = false;
    let activeSearchTreeRoot: SearchTreeNode | null = null;
    let pastedPathLookupCache: PastedPathLookupCache = createEmptyPastedPathLookupCache();
    let paneVersionCounter = 0;
    let hoveredBrowserEntryKey: string | null = null;
    let hoveredBrowserButton: HTMLButtonElement | null = null;
    let albumGridThumbnailObserver: IntersectionObserver | null = null;
    let albumGridPaneResizeObserver: ResizeObserver | null = null;
    let albumGridWindowResizeListener: (() => void) | null = null;
    let albumGridRenderVersion = 0;
    let cachedAlbumGridEntries: AlbumGridEntry[] | null = null;
    let cachedAlbumGridEntriesPromise: Promise<AlbumGridEntry[]> | null = null;
    let indexedRecursiveAlbumCoverPathByFolder: Map<string, string> | null = null;
    let albumGridThumbnailCacheLimit = albumGridMinimumThumbnailCacheSize;
    let albumThumbnailLoadsInFlight = 0;
    const eagerAlbumThumbnailLoadWaiters: Array<() => void> = [];
    const normalAlbumThumbnailLoadWaiters: Array<() => void> = [];
    const resolvedAlbumCoverPathByFolder = new Map<string, string>();
    const paneStateByElement = new WeakMap<HTMLUListElement, PaneState>();
    const albumThumbnailDataUrlByCoverPath = new Map<string, string | null>();
    const albumThumbnailLoadPromiseByCoverPath = new Map<string, Promise<string | null>>();
    const getTracks = (): Track[] => options.getTracks();
    const normalizeTrackPathKey = (path: string): string => path.trim().toLowerCase();
    const naturalOrderCollator = new Intl.Collator(undefined, {
        sensitivity: 'base',
        numeric: true,
    });

    const normalizedLibrarySearchQuery = (): string => controllerState.librarySearchQuery.trim().toLowerCase();
    const normalizedLoadingTrackPath = (): string => normalizeTrackPathKey(controllerState.loadingTrackPath);

    const normalizedLibraryBrowserSortMode = (): LibraryBrowserSortMode => {
        switch (controllerState.libraryBrowserSortMode) {
            case 'date-asc':
            case 'date-desc':
                return controllerState.libraryBrowserSortMode;
            default:
                return 'name';
        }
    };

    librarySort.value = normalizedLibraryBrowserSortMode();

    const isLibrarySearchActive = (): boolean => normalizedLibrarySearchQuery() !== '';

    const trimMeaningfulLabel = (value: string, fallbackLabel: string): string => {
        const trimmed = value.trim();
        return trimmed !== '' && trimmed.localeCompare(fallbackLabel, undefined, { sensitivity: 'base' }) !== 0
            ? trimmed
            : '';
    };

    const releaseFolderPathForTrack = (track: Track): string => {
        const releaseDepth = options.getReleaseDepthForTrack(track);
        return releaseFolderPathForTrackAtDepth(track, releaseDepth);
    };

    const firstTagValueIgnoreCase = (track: Track, ...keys: string[]): string => {
        const normalizedKeys = keys.map((key) => key.toLowerCase());
        for (const [key, values] of Object.entries(track.allFileTags || {})) {
            if (!normalizedKeys.includes(key.toLowerCase())) {
                continue;
            }

            for (const rawValue of values) {
                const trimmed = rawValue.trim();
                if (trimmed !== '') {
                    return trimmed;
                }
            }
        }

        return '';
    };

    const fallbackAlbumArtistFromSegments = (track: Track, releaseRelativeSegments: string[]): string => {
        const taggedAlbumArtist = trimMeaningfulLabel(
            firstTagValueIgnoreCase(track, 'albumartist', 'album artist', 'album_artist'),
            unknownArtistLabel,
        );
        if (taggedAlbumArtist) {
            return taggedAlbumArtist;
        }

        const displayArtist = trimMeaningfulLabel(track.displayArtist || '', unknownArtistLabel);
        if (displayArtist) {
            return displayArtist;
        }

        if (releaseRelativeSegments.length >= 2) {
            return releaseRelativeSegments[releaseRelativeSegments.length - 2];
        }

        return unknownArtistLabel;
    };

    const fallbackAlbumTitleFromSegments = (track: Track, releaseRelativeSegments: string[], preferReleaseFolderTitle = false): string => {
        const releaseFolderTitle = releaseRelativeSegments[releaseRelativeSegments.length - 1] || '';
        if (preferReleaseFolderTitle && releaseFolderTitle) {
            return releaseFolderTitle;
        }

        const displayAlbum = trimMeaningfulLabel(track.displayAlbum || '', unknownAlbumLabel);
        if (displayAlbum) {
            return displayAlbum;
        }

        return releaseFolderTitle || unknownAlbumLabel;
    };

    const isPreferredAlbumCoverImagePath = (path: string): boolean => {
        const lowerPath = path.trim().toLowerCase();
        return lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') || lowerPath.endsWith('.png');
    };

    const albumCoverPriority = (name: string): number => {
        const lowerName = name.trim().toLowerCase();
        switch (true) {
            case lowerName === 'cover.jpg':
                return 0;
            case lowerName === 'folder.jpg':
                return 1;
            case lowerName.startsWith('albumart') && !lowerName.endsWith('.png'):
                return 2;
            case lowerName === 'cover.png':
                return 3;
            case lowerName === 'folder.png':
                return 4;
            case lowerName.startsWith('albumart') && lowerName.endsWith('.png'):
                return 5;
            default:
                return 6;
        }
    };

    const normalizedFolderKey = (path: string): string => path.trim().toLowerCase();

    const folderPathSegments = (path: string): string[] => {
        return path
            .split('/')
            .map((segment) => segment.trim())
            .filter((segment) => segment !== '');
    };

    const shouldReplaceRecursiveAlbumCoverCandidate = (
        nextCandidate: RecursiveAlbumCoverCandidate,
        existingCandidate?: RecursiveAlbumCoverCandidate,
    ): boolean => {
        if (!existingCandidate) {
            return true;
        }
        if (nextCandidate.descendantDistance !== existingCandidate.descendantDistance) {
            return nextCandidate.descendantDistance < existingCandidate.descendantDistance;
        }
        if (nextCandidate.priority !== existingCandidate.priority) {
            return nextCandidate.priority < existingCandidate.priority;
        }

        return naturalOrderCollator.compare(nextCandidate.sortKey, existingCandidate.sortKey) < 0;
    };

    const recursiveAlbumCoverPathIndex = (): Map<string, string> => {
        if (indexedRecursiveAlbumCoverPathByFolder) {
            return indexedRecursiveAlbumCoverPathByFolder;
        }

        const bestCoverCandidateByFolder = new Map<string, RecursiveAlbumCoverCandidate>();
        for (const imageFile of options.getImageFiles()) {
            if (!isPreferredAlbumCoverImagePath(imageFile.path || imageFile.name || '')) {
                continue;
            }

            const imageFolderSegments = folderPathSegments(imageFile.folderPath || '');
            if (imageFolderSegments.length === 0) {
                continue;
            }

            const candidatePath = (imageFile.path || '').trim();
            if (candidatePath === '') {
                continue;
            }

            const priority = albumCoverPriority(imageFile.name || '');
            const sortKey = imageFile.relativePath || imageFile.path || imageFile.name || candidatePath;
            for (let ancestorLength = 1; ancestorLength <= imageFolderSegments.length; ancestorLength += 1) {
                const ancestorFolderPath = imageFolderSegments.slice(0, ancestorLength).join('/');
                const ancestorFolderKey = normalizedFolderKey(ancestorFolderPath);
                const nextCandidate: RecursiveAlbumCoverCandidate = {
                    path: candidatePath,
                    descendantDistance: imageFolderSegments.length - ancestorLength,
                    priority,
                    sortKey,
                };
                const existingCandidate = bestCoverCandidateByFolder.get(ancestorFolderKey);
                if (shouldReplaceRecursiveAlbumCoverCandidate(nextCandidate, existingCandidate)) {
                    bestCoverCandidateByFolder.set(ancestorFolderKey, nextCandidate);
                }
            }
        }

        indexedRecursiveAlbumCoverPathByFolder = new Map(
            Array.from(bestCoverCandidateByFolder.entries()).map(([folderKey, candidate]) => [folderKey, candidate.path]),
        );

        return indexedRecursiveAlbumCoverPathByFolder;
    };

    const resolveAlbumCoverPath = (albumFolderPath: string, candidateFolders: string[]): string => {
        const cacheKey = normalizedFolderKey(albumFolderPath);
        const cachedCoverPath = resolvedAlbumCoverPathByFolder.get(cacheKey);
        if (cachedCoverPath !== undefined) {
            return cachedCoverPath;
        }

        for (const folderPath of candidateFolders) {
            const coverPath = options.getFolderCoverPath(folderPath);
            if (coverPath) {
                resolvedAlbumCoverPathByFolder.set(cacheKey, coverPath);
                return coverPath;
            }
        }

        if (cacheKey !== '') {
            const recursiveCoverPath = recursiveAlbumCoverPathIndex().get(cacheKey) || '';
            resolvedAlbumCoverPathByFolder.set(cacheKey, recursiveCoverPath);
            return recursiveCoverPath;
        }

        resolvedAlbumCoverPathByFolder.set(cacheKey, '');
        return '';
    };

    const waitForNextAnimationFrame = async (): Promise<void> => {
        await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    };

    const acquireAlbumThumbnailLoadSlot = async (priority: AlbumThumbnailLoadPriority): Promise<void> => {
        while (albumThumbnailLoadsInFlight >= albumGridThumbnailLoadConcurrency) {
            await new Promise<void>((resolve) => {
                if (priority === 'eager') {
                    eagerAlbumThumbnailLoadWaiters.push(resolve);
                    return;
                }

                normalAlbumThumbnailLoadWaiters.push(resolve);
            });
        }

        albumThumbnailLoadsInFlight += 1;
    };

    const releaseAlbumThumbnailLoadSlot = (): void => {
        if (albumThumbnailLoadsInFlight > 0) {
            albumThumbnailLoadsInFlight -= 1;
        }

        const nextWaiter = eagerAlbumThumbnailLoadWaiters.shift() ?? normalAlbumThumbnailLoadWaiters.shift();
        if (nextWaiter) {
            nextWaiter();
        }
    };

    const invalidateAlbumGridCache = (): void => {
        cachedAlbumGridEntries = null;
        cachedAlbumGridEntriesPromise = null;
        indexedRecursiveAlbumCoverPathByFolder = null;
        resolvedAlbumCoverPathByFolder.clear();
        albumGridRenderVersion += 1;
    };

    const albumGridEntries = async (): Promise<AlbumGridEntry[]> => {
        if (cachedAlbumGridEntries) {
            return cachedAlbumGridEntries;
        }

        if (cachedAlbumGridEntriesPromise) {
            return await cachedAlbumGridEntriesPromise;
        }

        const buildPromise = (async () => {
            const groupedAlbums = new Map<string, { folderPath: string; tracks: Track[]; representativeTrack: Track }>();
            const tracks = getTracks();

            for (let index = 0; index < tracks.length; index += albumGridGroupingBatchSize) {
                const batchEnd = Math.min(index + albumGridGroupingBatchSize, tracks.length);
                for (const track of tracks.slice(index, batchEnd)) {
                    const albumFolderPath = releaseFolderPathForTrack(track);
                    const key = (albumFolderPath || track.path || '').trim().toLowerCase();
                    if (key === '') {
                        continue;
                    }

                    const existing = groupedAlbums.get(key);
                    if (!existing) {
                        groupedAlbums.set(key, {
                            folderPath: albumFolderPath,
                            tracks: [track],
                            representativeTrack: track,
                        });
                        continue;
                    }

                    existing.tracks.push(track);
                    if (naturalOrderCollator.compare(track.relativePath || track.path, existing.representativeTrack.relativePath || existing.representativeTrack.path) < 0) {
                        existing.representativeTrack = track;
                    }
                }

                if (batchEnd < tracks.length) {
                    await waitForNextAnimationFrame();
                }
            }

            const groupedAlbumValues = Array.from(groupedAlbums.values());
            const entries: AlbumGridEntry[] = [];
            for (let index = 0; index < groupedAlbumValues.length; index += albumGridBuildBatchSize) {
                const batchEnd = Math.min(index + albumGridBuildBatchSize, groupedAlbumValues.length);
                for (const { folderPath, tracks: albumTracks, representativeTrack } of groupedAlbumValues.slice(index, batchEnd)) {
                    const releaseRelativeSegments = relativeFolderSegmentsForTrack(folderPath, representativeTrack.rootName || '');
                    const preferReleaseFolderTitle = albumTracks.some((track) => (
                        (track.folderPath || '').trim().toLowerCase() !== folderPath.trim().toLowerCase()
                    ));

                    entries.push({
                        folderPath,
                        albumArtist: fallbackAlbumArtistFromSegments(representativeTrack, releaseRelativeSegments),
                        albumTitle: fallbackAlbumTitleFromSegments(representativeTrack, releaseRelativeSegments, preferReleaseFolderTitle),
                        coverFolderCandidates: Array.from(new Set([
                            folderPath,
                            ...albumTracks
                                .map((track) => track.folderPath || '')
                                .filter((candidateFolderPath) => candidateFolderPath.trim() !== ''),
                        ])),
                    });
                }

                if (batchEnd < groupedAlbumValues.length) {
                    await waitForNextAnimationFrame();
                }
            }

            entries.sort((left, right) => {
                const artistComparison = naturalOrderCollator.compare(left.albumArtist, right.albumArtist);
                if (artistComparison !== 0) {
                    return artistComparison;
                }

                const albumComparison = naturalOrderCollator.compare(left.albumTitle, right.albumTitle);
                if (albumComparison !== 0) {
                    return albumComparison;
                }

                return naturalOrderCollator.compare(left.folderPath, right.folderPath);
            });

            cachedAlbumGridEntries = entries;
            return entries;
        })().finally(() => {
            cachedAlbumGridEntriesPromise = null;
        });

        cachedAlbumGridEntriesPromise = buildPromise;
        return await buildPromise;
    };

    const disconnectAlbumGridThumbnailObserver = (): void => {
        albumGridThumbnailObserver?.disconnect();
        albumGridThumbnailObserver = null;
    };

    const disconnectAlbumGridViewportWatcher = (): void => {
        albumGridPaneResizeObserver?.disconnect();
        albumGridPaneResizeObserver = null;

        if (albumGridWindowResizeListener) {
            window.removeEventListener('resize', albumGridWindowResizeListener);
            albumGridWindowResizeListener = null;
        }
    };

    const isAlbumGridRenderCurrent = (version: number, pane?: HTMLElement): boolean => {
        return albumGridRenderVersion === version
            && controllerState.sidebarExpanded
            && !isLibrarySearchActive()
            && (!pane || pane.isConnected);
    };

    const touchAlbumThumbnailCacheEntry = (coverPath: string, dataUrl: string | null): void => {
        if (albumThumbnailDataUrlByCoverPath.has(coverPath)) {
            albumThumbnailDataUrlByCoverPath.delete(coverPath);
        }

        albumThumbnailDataUrlByCoverPath.set(coverPath, dataUrl);
    };

    const pruneAlbumThumbnailCache = (): void => {
        while (albumThumbnailDataUrlByCoverPath.size > albumGridThumbnailCacheLimit) {
            const oldestCoverPath = albumThumbnailDataUrlByCoverPath.keys().next().value;
            if (typeof oldestCoverPath !== 'string' || oldestCoverPath === '') {
                return;
            }

            albumThumbnailDataUrlByCoverPath.delete(oldestCoverPath);
        }
    };

    const updateAlbumThumbnailCacheLimit = (mountedAlbumCount: number): void => {
        albumGridThumbnailCacheLimit = Math.max(
            albumGridMinimumThumbnailCacheSize,
            mountedAlbumCount * albumGridThumbnailCacheWindowMultiplier,
        );
        pruneAlbumThumbnailCache();
    };

    const getCachedAlbumThumbnailDataUrl = (coverPath: string): string | null | undefined => {
        if (!albumThumbnailDataUrlByCoverPath.has(coverPath)) {
            return undefined;
        }

        const cachedDataUrl = albumThumbnailDataUrlByCoverPath.get(coverPath) ?? null;
        touchAlbumThumbnailCacheEntry(coverPath, cachedDataUrl);
        return cachedDataUrl;
    };

    const loadAlbumThumbnailDataUrl = async (coverPath: string, priority: AlbumThumbnailLoadPriority = 'normal'): Promise<string | null> => {
        const cachedDataUrl = getCachedAlbumThumbnailDataUrl(coverPath);
        if (cachedDataUrl !== undefined) {
            return cachedDataUrl;
        }

        const pendingLoad = albumThumbnailLoadPromiseByCoverPath.get(coverPath);
        if (pendingLoad) {
            return await pendingLoad;
        }

        const loadPromise = (async () => {
            await acquireAlbumThumbnailLoadSlot(priority);
            try {
                const thumbnail = await options.readImageThumbnail(coverPath, albumCoverThumbnailMaxEdgePx);
                const base64 = (thumbnail.base64 || '').trim();
                if (base64 === '') {
                    touchAlbumThumbnailCacheEntry(coverPath, null);
                    pruneAlbumThumbnailCache();
                    return null;
                }

                const mimeType = thumbnail.mimeType && thumbnail.mimeType.startsWith('image/')
                    ? thumbnail.mimeType
                    : 'image/jpeg';
                const dataUrl = `data:${mimeType};base64,${base64}`;
                touchAlbumThumbnailCacheEntry(coverPath, dataUrl);
                pruneAlbumThumbnailCache();
                return dataUrl;
            } catch {
                touchAlbumThumbnailCacheEntry(coverPath, null);
                pruneAlbumThumbnailCache();
                return null;
            } finally {
                releaseAlbumThumbnailLoadSlot();
                albumThumbnailLoadPromiseByCoverPath.delete(coverPath);
            }
        })();

        albumThumbnailLoadPromiseByCoverPath.set(coverPath, loadPromise);
        return await loadPromise;
    };

    const revealAlbumCoverImage = (coverElement: HTMLElement, image: HTMLImageElement): void => {
        if (!coverElement.isConnected || !image.isConnected || coverElement.classList.contains('has-image')) {
            return;
        }

        requestAnimationFrame(() => {
            if (!coverElement.isConnected || !image.isConnected || coverElement.classList.contains('has-image')) {
                return;
            }

            coverElement.classList.add('has-image');
            coverElement.classList.remove('is-unavailable');
            coverElement.classList.remove('is-loading');
        });
    };

    const hydrateAlbumCoverImage = async (image: HTMLImageElement, priority: AlbumThumbnailLoadPriority = 'normal'): Promise<void> => {
        const coverPath = (image.dataset.coverPath || '').trim();
        if (coverPath === '' || image.dataset.coverLoaded === 'true') {
            return;
        }

        image.dataset.coverLoaded = 'true';
        const coverElement = image.closest('.library-album-cover');
        const dataUrl = await loadAlbumThumbnailDataUrl(coverPath, priority);
        if (!(coverElement instanceof HTMLElement) || !image.isConnected) {
            return;
        }

        if (!dataUrl) {
            coverElement.classList.remove('is-loading');
            coverElement.classList.add('is-unavailable');
            return;
        }

        image.src = dataUrl;
        revealAlbumCoverImage(coverElement, image);
    };

    const hydrateAlbumGridThumbnailBatch = async (images: HTMLImageElement[]): Promise<void> => {
        await Promise.all(images.map(async (image) => {
            await hydrateAlbumCoverImage(image, 'eager');
        }));
    };

    const ensureAlbumGridThumbnailObserver = (pane: HTMLElement): IntersectionObserver | null => {
        if (typeof IntersectionObserver === 'undefined') {
            return null;
        }

        if (albumGridThumbnailObserver) {
            return albumGridThumbnailObserver;
        }

        albumGridThumbnailObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting || !(entry.target instanceof HTMLImageElement)) {
                    continue;
                }

                albumGridThumbnailObserver?.unobserve(entry.target);
                void hydrateAlbumCoverImage(entry.target);
            }
        }, {
            root: pane,
            rootMargin: '220px 0px',
        });

        return albumGridThumbnailObserver;
    };

    const queueAlbumGridThumbnailImages = (pane: HTMLElement, images: HTMLImageElement[]): void => {
        const pendingImages = images.filter((image) => image.dataset.coverLoaded !== 'true');
        if (pendingImages.length === 0) {
            return;
        }

        const thumbnailObserver = ensureAlbumGridThumbnailObserver(pane);
        if (!thumbnailObserver) {
            void Promise.all(pendingImages.map(async (image) => {
                await hydrateAlbumCoverImage(image);
            }));
            return;
        }

        pendingImages.forEach((image) => {
            thumbnailObserver.observe(image);
        });
    };

    const resolveAlbumCardCover = (cardElements: AlbumGridCardElements): HTMLImageElement | null => {
        const { album, cover, image } = cardElements;
        if (!cover.isConnected || !image.isConnected) {
            return null;
        }

        const resolvedCoverPath = resolveAlbumCoverPath(album.folderPath, album.coverFolderCandidates);
        if (!cover.isConnected || !image.isConnected) {
            return null;
        }

        if (!resolvedCoverPath) {
            cover.classList.remove('is-loading');
            cover.classList.add('is-unavailable');
            return null;
        }

        const cachedDataUrl = getCachedAlbumThumbnailDataUrl(resolvedCoverPath);
        if (cachedDataUrl === null) {
            cover.classList.remove('is-loading');
            cover.classList.add('is-unavailable');
            return null;
        }

        image.dataset.coverPath = resolvedCoverPath;
        if (cachedDataUrl) {
            image.src = cachedDataUrl;
            image.dataset.coverLoaded = 'true';
            revealAlbumCoverImage(cover, image);
            return null;
        }

        cover.classList.add('is-loading');
        cover.classList.remove('is-unavailable');
        return image;
    };

    const createAlbumCard = (album: AlbumGridEntry): AlbumGridCardElements => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'library-album-card folder';
        button.dataset.folderPath = album.folderPath;
        button.dataset.hoverKey = `folder:${album.folderPath}`;
        button.title = album.folderPath;

        const cover = document.createElement('span');
        cover.className = 'library-album-cover is-loading';

        const coverFallback = document.createElement('span');
        coverFallback.className = 'library-album-cover-fallback';
        coverFallback.setAttribute('aria-hidden', 'true');
        cover.append(coverFallback);

        const skeleton = document.createElement('span');
        skeleton.className = 'library-album-cover-skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        cover.append(skeleton);

        const image = document.createElement('img');
        image.className = 'library-album-cover-image';
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        cover.append(image);

        button.append(cover);
        return {
            album,
            button,
            cover,
            image,
        };
    };

    const disposeAlbumGridCard = (cardElements: AlbumGridCardElements): void => {
        const coverPath = (cardElements.image.dataset.coverPath || '').trim();
        albumGridThumbnailObserver?.unobserve(cardElements.image);
        cardElements.image.removeAttribute('src');
        delete cardElements.image.dataset.coverPath;
        delete cardElements.image.dataset.coverLoaded;
        cardElements.cover.classList.remove('has-image');
        cardElements.cover.classList.remove('is-unavailable');
        cardElements.cover.classList.add('is-loading');
        if (coverPath !== '') {
            albumThumbnailDataUrlByCoverPath.delete(coverPath);
            albumThumbnailLoadPromiseByCoverPath.delete(coverPath);
        }
    };

    const renderExpandedAlbumGrid = (direction: RenderDirection): void => {
        disconnectAlbumGridThumbnailObserver();
        disconnectAlbumGridViewportWatcher();
        const renderVersion = ++albumGridRenderVersion;

        const pane = document.createElement('div');
        pane.className = 'library-browser-pane library-album-grid-pane';
        const grid = document.createElement('div');
        grid.className = 'library-album-grid';
        pane.append(grid);

        const loading = document.createElement('div');
        loading.className = 'library-album-grid-empty';
        loading.textContent = 'Loading albums...';
        pane.append(loading);
        setViewportLoadingIndicatorVisible(true);
        mountBrowserPane(pane, direction);

        void (async () => {
            const albums = await albumGridEntries();
            if (!isAlbumGridRenderCurrent(renderVersion, pane)) {
                return;
            }

            loading.remove();
            if (albums.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'library-album-grid-empty';
                empty.textContent = 'No albums in library';
                pane.append(empty);
                setViewportLoadingIndicatorVisible(false);
                return;
            }

            let lastRenderKey = '';
            let renderScheduled = false;
            let renderedAlbumCardsByFolderPath = new Map<string, AlbumGridCardElements>();

            const topSpacer = document.createElement('div');
            topSpacer.className = 'library-album-grid-spacer';
            const bottomSpacer = document.createElement('div');
            bottomSpacer.className = 'library-album-grid-spacer';

            const updateAlbumGridPaneEdgeFade = (): void => {
                const remainingScrollPx = Math.max(0, pane.scrollHeight - pane.clientHeight - pane.scrollTop);
                const hasMoreBelow = remainingScrollPx > 2;
                pane.classList.toggle('has-bottom-fade', hasMoreBelow);
            };

            const computedGridMetrics = () => {
                const gridStyle = window.getComputedStyle(grid);
                const columnGap = Number.parseFloat(gridStyle.columnGap || gridStyle.gap || '0') || 0;
                const rowGap = Number.parseFloat(gridStyle.rowGap || gridStyle.gap || '0') || 0;
                const paneStyle = window.getComputedStyle(pane);
                const paddingLeft = Number.parseFloat(paneStyle.paddingLeft || '0') || 0;
                const paddingRight = Number.parseFloat(paneStyle.paddingRight || '0') || 0;
                const availableWidth = Math.max(1, (pane.clientWidth || 720) - paddingLeft - paddingRight);
                const columnCount = Math.max(1, Math.floor((availableWidth + columnGap) / (albumGridMinColumnWidthPx + columnGap)));
                const cardWidth = Math.max(albumGridMinColumnWidthPx, (availableWidth - ((columnCount - 1) * columnGap)) / columnCount);

                return {
                    columnCount,
                    cardWidth,
                    rowGap,
                    rowStride: cardWidth + rowGap,
                };
            };

            const renderVirtualizedAlbumRows = async (): Promise<void> => {
                if (!isAlbumGridRenderCurrent(renderVersion, pane)) {
                    return;
                }

                const { columnCount, cardWidth, rowGap, rowStride } = computedGridMetrics();
                const totalRows = Math.ceil(albums.length / columnCount);
                const viewportHeight = pane.clientHeight || 720;
                const visibleRowCount = Math.max(1, Math.ceil((viewportHeight + rowGap) / Math.max(1, rowStride)));
                const startRow = Math.max(0, Math.floor(pane.scrollTop / Math.max(1, rowStride)) - albumGridOverscanRows);
                const endRow = Math.min(totalRows, startRow + visibleRowCount + (albumGridOverscanRows * 2));
                const startIndex = startRow * columnCount;
                const endIndex = Math.min(albums.length, endRow * columnCount);
                const renderKey = `${columnCount}:${startRow}:${endRow}`;
                if (renderKey === lastRenderKey) {
                    updateAlbumGridPaneEdgeFade();
                    return;
                }
                lastRenderKey = renderKey;
                updateAlbumThumbnailCacheLimit(endIndex - startIndex);

                const totalHeight = totalRows <= 0 ? 0 : (totalRows * cardWidth) + ((totalRows - 1) * rowGap);
                const topHeight = startRow * rowStride;
                const renderedRowCount = Math.max(0, endRow - startRow);
                const renderedHeight = renderedRowCount <= 0 ? 0 : (renderedRowCount * cardWidth) + ((renderedRowCount - 1) * rowGap);
                const bottomHeight = Math.max(0, totalHeight - topHeight - renderedHeight);

                topSpacer.style.height = `${topHeight}px`;
                bottomSpacer.style.height = `${bottomHeight}px`;

                const fragment = document.createDocumentFragment();
                fragment.append(topSpacer);
                const nextRenderedAlbumCardsByFolderPath = new Map<string, AlbumGridCardElements>();
                const pendingCoverCards: AlbumGridCardElements[] = [];
                for (const album of albums.slice(startIndex, endIndex)) {
                    const cardElements = renderedAlbumCardsByFolderPath.get(album.folderPath) ?? createAlbumCard(album);
                    if (!renderedAlbumCardsByFolderPath.has(album.folderPath)) {
                        pendingCoverCards.push(cardElements);
                    }
                    nextRenderedAlbumCardsByFolderPath.set(album.folderPath, cardElements);
                    fragment.append(cardElements.button);
                }

                for (const [folderPath, cardElements] of renderedAlbumCardsByFolderPath) {
                    if (nextRenderedAlbumCardsByFolderPath.has(folderPath)) {
                        continue;
                    }

                    disposeAlbumGridCard(cardElements);
                }

                fragment.append(bottomSpacer);
                grid.replaceChildren(fragment);
                renderedAlbumCardsByFolderPath = nextRenderedAlbumCardsByFolderPath;
                syncHoveredBrowserButton(hoveredBrowserEntryKey);
                updateAlbumGridPaneEdgeFade();

                await waitForNextAnimationFrame();
                if (!isAlbumGridRenderCurrent(renderVersion, pane)) {
                    return;
                }

                const eagerThumbnailImages: HTMLImageElement[] = [];
                for (let index = 0; index < pendingCoverCards.length; index += albumGridCoverResolutionBatchSize) {
                    const batchEnd = Math.min(index + albumGridCoverResolutionBatchSize, pendingCoverCards.length);
                    for (const cardElements of pendingCoverCards.slice(index, batchEnd)) {
                        const image = resolveAlbumCardCover(cardElements);
                        if (image instanceof HTMLImageElement && eagerThumbnailImages.length < albumGridInitialThumbnailBatchSize) {
                            eagerThumbnailImages.push(image);
                        }
                    }

                    if (batchEnd < pendingCoverCards.length) {
                        await waitForNextAnimationFrame();
                        if (!isAlbumGridRenderCurrent(renderVersion, pane)) {
                            return;
                        }
                    }
                }

                if (eagerThumbnailImages.length > 0) {
                    void hydrateAlbumGridThumbnailBatch(eagerThumbnailImages);
                }

                const queuedImages = Array.from(grid.querySelectorAll('.library-album-cover-image[data-cover-path]')) as HTMLImageElement[];
                queueAlbumGridThumbnailImages(pane, queuedImages);

                loading.remove();
                setViewportLoadingIndicatorVisible(false);
                updateAlbumGridPaneEdgeFade();
            };

            const scheduleVirtualizedAlbumRender = (): void => {
                if (renderScheduled || !isAlbumGridRenderCurrent(renderVersion, pane)) {
                    return;
                }

                renderScheduled = true;
                requestAnimationFrame(() => {
                    renderScheduled = false;
                    void renderVirtualizedAlbumRows();
                });
            };

            const handlePaneScroll = (): void => {
                updateAlbumGridPaneEdgeFade();
                scheduleVirtualizedAlbumRender();
            };

            pane.addEventListener('scroll', handlePaneScroll, { passive: true });

            if (!isAlbumGridRenderCurrent(renderVersion, pane)) {
                return;
            }

            await renderVirtualizedAlbumRows();
            if (!isAlbumGridRenderCurrent(renderVersion, pane)) {
                return;
            }

            albumGridWindowResizeListener = () => {
                scheduleVirtualizedAlbumRender();
            };
            window.addEventListener('resize', albumGridWindowResizeListener, { passive: true });

            if (typeof ResizeObserver !== 'undefined') {
                albumGridPaneResizeObserver = new ResizeObserver(() => {
                    scheduleVirtualizedAlbumRender();
                });
                albumGridPaneResizeObserver.observe(pane);
            }

            syncHoveredBrowserButton(hoveredBrowserEntryKey);
        })();
    };

    const clearScheduledLibrarySearch = (): void => {
        if (librarySearchDebounceHandle === undefined) {
            return;
        }

        window.clearTimeout(librarySearchDebounceHandle);
        librarySearchDebounceHandle = undefined;
    };

    const cancelLibrarySearch = (): void => {
        librarySearchRequestVersion += 1;
        expandFilteredFoldersOnNextSearchTree = false;
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

    const currentBrowserPane = (): HTMLElement | null => {
        return libraryBrowser.querySelector('.library-browser-pane:last-of-type') as HTMLElement | null;
    };

    const sourceKey = (source: PaneSource): string => {
        return source.kind === 'folder'
            ? `folder:${source.folderPath}:${source.sortMode}`
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
            sortMode: normalizedLibraryBrowserSortMode(),
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
        libraryExpandToggle,
        libraryBack,
        libraryPath,
        libraryBrowser,
        get sidebarOpen() {
            return controllerState.sidebarOpen;
        },
        set sidebarOpen(value) {
            controllerState.sidebarOpen = value;
        },
        get sidebarExpanded() {
            return controllerState.sidebarExpanded;
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
        refreshSidebarExpandedState,
        refreshSidebarToggleState,
        setHoveredBrowserButton,
        syncHoveredBrowserButton,
        setLibraryLoading,
        setLibraryLoadingEtaSeconds,
        setLibraryLoadingStatusLabel,
        setLibraryPathLabel,
        setViewportLoadingIndicatorVisible,
    } = viewRuntime;
    refreshSidebarExpandedState();
    refreshSidebarToggleState();

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
            if (value && expandFilteredFoldersOnNextSearchTree) {
                const expandableFolderPaths = collectSearchTreeExpandableFolderPaths(value);
                for (const folderPath of expandableFolderPaths) {
                    if (folderPath === '') {
                        continue;
                    }

                    controllerState.expandedSearchFolders.add(folderPath);
                }
            }
            if (value) {
                expandFilteredFoldersOnNextSearchTree = false;
            }
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
            const isActiveTrack = trackIndex >= 0 && trackIndex === options.getCurrentTrackIndex();
            const isLoadingTrack = normalizedLoadingTrackPath() !== '' && normalizeTrackPathKey(entry.path) === normalizedLoadingTrackPath();
            button.className = `library-entry track${isActiveTrack ? ' active' : ''}${isLoadingTrack ? ' is-loading' : ''}`;
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
                ? await options.loadFolderPage(state.source.folderPath, state.source.sortMode, offset, serverPageSize)
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
        pane.className = `library-browser-pane library-list-pane${source.kind === 'search' ? ' library-search-pane' : ''}`;

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

    const mountBrowserPane = (nextPane: HTMLElement, direction: RenderDirection): void => {
        disconnectAlbumGridThumbnailObserver();
        disconnectAlbumGridViewportWatcher();
        const existingPanes = Array.from(libraryBrowser.querySelectorAll('.library-browser-pane')) as HTMLElement[];
        if (existingPanes.length > 1) {
            existingPanes.slice(0, -1).forEach((pane) => pane.remove());
        }

        const current = currentBrowserPane();
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

    const mountPane = (nextPane: HTMLUListElement, direction: RenderDirection): void => {
        mountBrowserPane(nextPane, direction);
    };

    const renderFolder = (direction: RenderDirection): void => {
        setLibraryPathLabel();

        if (!controllerState.libraryRootName) {
            disconnectAlbumGridThumbnailObserver();
            disconnectAlbumGridViewportWatcher();
            libraryBrowser.innerHTML = '';
            setViewportLoadingIndicatorVisible(false);
            return;
        }

        if (controllerState.sidebarExpanded && !isLibrarySearchActive()) {
            renderExpandedAlbumGrid(direction);
            return;
        }

        if (isLibrarySearchActive() && controllerState.librarySearchPending && (!controllerState.activeSearchResult || controllerState.activeSearchResult.entries.length === 0)) {
            disconnectAlbumGridThumbnailObserver();
            disconnectAlbumGridViewportWatcher();
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
            disconnectAlbumGridThumbnailObserver();
            disconnectAlbumGridViewportWatcher();
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
        if (controllerState.sidebarExpanded) {
            controllerState.sidebarExpanded = false;
            refreshSidebarExpandedState();
        }

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
        refreshSidebarExpandedState();
        refreshSidebarToggleState();
    };

    const setSidebarExpanded = (expanded: boolean): void => {
        if (expanded && (!controllerState.libraryRootName || isLibrarySearchActive())) {
            return;
        }

        if (controllerState.sidebarExpanded === expanded) {
            return;
        }

        controllerState.sidebarExpanded = expanded;
        refreshSidebarExpandedState();
        if (controllerState.sidebarOpen) {
            renderFolder(expanded ? 'forward' : 'back');
            return;
        }

        setLibraryPathLabel();
    };

    const setLibrarySearchQuery = (nextValue: string): void => {
        if (controllerState.librarySearchQuery === nextValue) {
            return;
        }

        if (controllerState.sidebarExpanded) {
            controllerState.sidebarExpanded = false;
            refreshSidebarExpandedState();
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

    const searchTreeNodeHasChildren = (node: SearchTreeNode): boolean => {
        return node.folders.length > 0
            || node.trackEntries.length > 0
            || node.textFileEntries.length > 0
            || node.imageFileEntries.length > 0;
    };

    const collectSearchTreeExpandableFolderPaths = (node: SearchTreeNode, paths: string[] = []): string[] => {
        if (searchTreeNodeHasChildren(node)) {
            paths.push(node.path);
        }

        for (const childFolder of node.folders) {
            collectSearchTreeExpandableFolderPaths(childFolder, paths);
        }

        return paths;
    };

    const startLibrarySearch = (query: string, options?: ProgrammaticLibrarySearchOptions): void => {
        const nextQuery = query.trim();
        expandFilteredFoldersOnNextSearchTree = !!options?.expandFilteredFolders && nextQuery !== '';
        librarySearch.value = nextQuery;
        setLibrarySearchQuery(nextQuery);

        if (expandFilteredFoldersOnNextSearchTree && activeSearchTreeRoot && normalizedLibrarySearchQuery() === nextQuery.toLowerCase()) {
            const expandableFolderPaths = collectSearchTreeExpandableFolderPaths(activeSearchTreeRoot);
            for (const folderPath of expandableFolderPaths) {
                if (folderPath === '') {
                    continue;
                }

                controllerState.expandedSearchFolders.add(folderPath);
            }
            expandFilteredFoldersOnNextSearchTree = false;
            renderFolder('none');
        }
    };

    const setSearchTreeSubtreeExpanded = (folderPath: string, expanded: boolean): void => {
        const cleanFolderPath = folderPath.trim();
        if (cleanFolderPath === '' || !isLibrarySearchActive() || !activeSearchTreeRoot) {
            return;
        }

        const searchFolderNode = findSearchTreeNode(activeSearchTreeRoot, cleanFolderPath);
        if (!searchFolderNode) {
            return;
        }

        const expandableFolderPaths = collectSearchTreeExpandableFolderPaths(searchFolderNode);
        if (expandableFolderPaths.length === 0) {
            return;
        }

        for (const expandableFolderPath of expandableFolderPaths) {
            if (expanded) {
                controllerState.expandedSearchFolders.add(expandableFolderPath);
                continue;
            }

            controllerState.expandedSearchFolders.delete(expandableFolderPath);
        }

        renderFolder('none');
    };

    const setLibraryBrowserSortMode = (sortMode: LibraryBrowserSortMode): void => {
        controllerState.libraryBrowserSortMode = sortMode;
        librarySort.value = normalizedLibraryBrowserSortMode();
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
        if (!normalizedPath) {
            return false;
        }

        const resolvedAbsoluteFolderPath = isLikelyAbsoluteLibraryPath(normalizedPath)
            ? await options.resolveLibraryFolderForAbsolutePath(normalizedPath)
            : '';
        const folderPath = resolvedAbsoluteFolderPath || doResolvePastedLibraryJumpFolder(normalizedPath);
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
        _tracks: Track[],
        _textFiles: TextLibraryFile[],
        _imageFiles: ImageLibraryFile[],
    ): Promise<void> => {
        controllerState.libraryRootName = rootName || defaultLibraryRootLabel;
        controllerState.libraryIndexTruncated = truncated;
        pastedPathLookupCache = createEmptyPastedPathLookupCache();
        invalidateAlbumGridCache();
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
        controllerState.loadingTrackPath = '';
        controllerState.sidebarExpanded = false;
        controllerState.loadingTrackPath = '';
        controllerState.sidebarExpanded = false;
        controllerState.libraryIndexTruncated = false;
        pastedPathLookupCache = createEmptyPastedPathLookupCache();
        invalidateAlbumGridCache();
        disconnectAlbumGridThumbnailObserver();
        disconnectAlbumGridViewportWatcher();
        albumThumbnailDataUrlByCoverPath.clear();
        albumThumbnailLoadPromiseByCoverPath.clear();
        clearLibrarySearch();
        libraryBrowser.innerHTML = '';
        refreshSidebarExpandedState();
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
        getLibraryBrowserSortMode: normalizedLibraryBrowserSortMode,
        setLibraryBrowserSortMode,
        getCurrentFolderPath: () => controllerState.currentFolderPath,
        setCurrentFolderPath: (path: string) => { controllerState.currentFolderPath = path; },
        isLibrarySearchActive,
        clearLibrarySearch,
        navigateToFolder,
        renderFolder,
        setSidebarOpen,
        isSidebarOpen: () => controllerState.sidebarOpen,
        getSidebarExpanded: () => controllerState.sidebarExpanded,
        setSidebarExpanded,
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
                const preservedScrollTop = pane.scrollTop;
                paneStateByElement.set(pane, {
                    source: state.source,
                    version: ++paneVersionCounter,
                    totalEntries: null,
                    loadedPages: new Map<number, LibraryBrowserEntry[]>(),
                    loadingPages: new Set<number>(),
                    rowHeightEstimate: state.rowHeightEstimate,
                    updateScheduled: false,
                    errorMessage: null,
                });
                renderPaneRows(pane);
                pane.scrollTop = preservedScrollTop;
                schedulePaneUpdate(pane);
                void requestPagesForPane(pane);
                return;
            }
        }
        renderFolder('none');
    };

    return {
        clearLibrarySearch,
        firstTrackIndexFromRandomAlbumFolder,
        getLibraryBrowserSortMode: normalizedLibraryBrowserSortMode,
        getLibrarySearchQuery: () => controllerState.librarySearchQuery,
        getLibrarySearchStateSnapshot,
        getLibraryRootName: () => controllerState.libraryRootName,
        getLoadingTrackPath: () => controllerState.loadingTrackPath,
        getSidebarAutoFolderPath: () => controllerState.sidebarAutoFolderPath,
        getCurrentFolderPath: () => controllerState.currentFolderPath,
        isLibrarySearchActive,
        isSidebarOpen: () => controllerState.sidebarOpen,
        isSidebarExpanded: () => controllerState.sidebarExpanded,
        navigateToFolder,
        refreshCurrentFolder,
        refreshSidebarExpandedState,
        refreshSidebarToggleState,
        rebuildLibraryTree,
        renderFolder,
        resetLibraryState,
        setCurrentFolderPath: (path: string) => {
            controllerState.currentFolderPath = path;
        },
        setLibraryBrowserSortMode,
        setSearchTreeSubtreeExpanded,
        startLibrarySearch,
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
        setLoadingTrackPath: (trackPath: string) => {
            if (controllerState.loadingTrackPath === trackPath) {
                return;
            }

            controllerState.loadingTrackPath = trackPath;
            if (controllerState.sidebarOpen) {
                renderFolder('none');
            }
        },
        setSidebarAutoFolderPath: (folderPath: string) => {
            controllerState.sidebarAutoFolderPath = folderPath;
        },
        setSidebarExpanded,
        setSidebarOpen,
    };
};
