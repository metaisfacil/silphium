import type { PlaylistMenuElements } from '../components/overlays/playlist-menu';
import type { PlaylistModalElements } from '../components/overlays/playlist-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { PlaybackSequenceSource, PlaybackSequencingService } from '../services/playback-sequencing-service';
import { isPlaybackQueueEligibleTrack } from '../utils/display-helpers';
import { hasExternalFileDragPayload } from '../utils/main-helpers';
import { createPlaylistControllerState, type LoadedListenHistoryItem, type LoadedPlaylistCachedItem, type PlaylistControllerState, type PlaylistSource } from './playlist-controller-state';

export type PlaylistDirection = -1 | 1;

export type PlaylistSequence = {
    indexes: number[];
    currentPosition: number;
};

export type PlaylistTrackView = {
    displayTitle: string;
    name: string;
    displayArtist: string;
    tagsResolved: boolean;
};

export type LoadedPlaylistData = {
    name: string;
    trackIndexes: number[];
    historyItems?: LoadedListenHistoryItem[];
    cachedItems?: LoadedPlaylistCachedItem[];
};

export type PlaylistTrackMetadataCacheEntry = {
    trackPath: string;
    trackName: string;
    artistName: string;
};

export type PlaylistTargetOption = {
    path: string;
    label: string;
};

type PlaylistSourceControlOption = {
    value: string;
    label: string;
    iconMarkup: string;
};

type RenderablePlaylistRow = {
    actualPosition: number;
    trackIndex: number;
};

type QueueDragState = {
    fromPosition: number;
    targetPosition: number;
    pointerId: number;
};

type ExternalTrackDropIndicator = {
    insertAt: number;
    rowPosition: number | null;
    edge: 'before' | 'after';
};

type PlaylistVisibleWindow = {
    start: number;
    end: number;
    rowHeight: number;
    topSpacerHeight: number;
    bottomSpacerHeight: number;
};

type PlaylistTrackChosenContext = {
    source: PlaylistSource;
    userInitiated: boolean;
};

export type { PlaylistTrackChosenContext };

type PlaylistControllerOptions = {
    trigger: HTMLButtonElement;
    menu: PlaylistMenuElements;
    modal: PlaylistModalElements;
    state?: PlaylistControllerState;
    backgroundHydrationEnabled?: boolean;
    getTrack: (index: number) => PlaylistTrackView | undefined;
    getTrackPath: (index: number) => string;
    getTrackCount: () => number;
    getCurrentTrackIndex: () => number;
    getPlaybackOrderLabel: () => string;
    getBaseSequence: () => PlaylistSequence;
    playbackSequencingService?: Pick<PlaybackSequencingService, 'baseSequenceIndexes' | 'nextTrackIndexForDirection' | 'peekNextTrackIndexForDirection' | 'getPlaybackOrderMode'>;
    ensureTrackTagsResolvedBatch: (indexes: number[]) => Promise<void>;
    selectPlaylistFile: () => Promise<string>;
    selectPlaylistSaveFile: () => Promise<string>;
    loadPlaylistData: (playlistPath: string) => Promise<LoadedPlaylistData | null>;
    loadListenHistoryData: () => Promise<LoadedPlaylistData | null>;
    savePlaylistTrackMetadataCache: (entries: PlaylistTrackMetadataCacheEntry[]) => Promise<boolean>;
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    openErrorModal: (title: string, message: string) => void;
    getFavoritePlaylists: () => string[];
    shouldAutoSavePlaylistsOnAddRemove?: () => boolean;
    hasListenHistoryPlaylist: () => boolean;
    onQueueRequested?: (
        clientX: number,
        clientY: number,
        trackIndexes: number[],
        feedbackTrackIndex?: number,
        includeFileActions?: boolean,
        fileActionPath?: string,
    ) => void;
    onTrackChosen: (index: number, context: PlaylistTrackChosenContext) => Promise<void>;
    onExternalPlaylistLoaded: () => void;
    onPlaybackSequenceMutated?: () => void | Promise<void>;
};

export type PlaylistController = ReturnType<typeof createPlaylistController>;

const playbackQueueSourceLabel = 'Playback Queue';
const listenHistorySourceLabel = 'Listen History';
const playbackQueueSourceIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4.75 6.5C4.75 5.81 5.31 5.25 6 5.25H19C19.69 5.25 20.25 5.81 20.25 6.5C20.25 7.19 19.69 7.75 19 7.75H6C5.31 7.75 4.75 7.19 4.75 6.5ZM4.75 12C4.75 11.31 5.31 10.75 6 10.75H15C15.69 10.75 16.25 11.31 16.25 12C16.25 12.69 15.69 13.25 15 13.25H6C5.31 13.25 4.75 12.69 4.75 12ZM4.75 17.5C4.75 16.81 5.31 16.25 6 16.25H12C12.69 16.25 13.25 16.81 13.25 17.5C13.25 18.19 12.69 18.75 12 18.75H6C5.31 18.75 4.75 18.19 4.75 17.5Z"/></svg>';
const listenHistorySourceIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 3.75C7.44 3.75 3.75 7.44 3.75 12C3.75 16.56 7.44 20.25 12 20.25C16.56 20.25 20.25 16.56 20.25 12C20.25 7.44 16.56 3.75 12 3.75ZM2.25 12C2.25 6.61 6.61 2.25 12 2.25C17.39 2.25 21.75 6.61 21.75 12C21.75 17.39 17.39 21.75 12 21.75C6.61 21.75 2.25 17.39 2.25 12ZM12 7.75C12.41 7.75 12.75 8.09 12.75 8.5V11.69L15.03 13.2C15.37 13.42 15.47 13.88 15.25 14.22C15.02 14.57 14.56 14.66 14.22 14.44L11.6 12.69C11.39 12.56 11.25 12.32 11.25 12.06V8.5C11.25 8.09 11.59 7.75 12 7.75Z"/></svg>';

export const createPlaylistController = (options: PlaylistControllerOptions) => {
    const { trigger, menu, modal } = options;
    const controllerState = options.state ?? createPlaylistControllerState();
    const backgroundHydrationEnabled = options.backgroundHydrationEnabled !== false;
    const { playlistMenu, playlistLoadBtn } = menu;
    const {
        playlistModal,
        playlistBackdrop,
        playlistDialog,
        playlistClose,
        playlistTitle,
        playlistSourceWrap,
        playlistSourceButton,
        playlistSourceIcon,
        playlistSourceLabel,
        playlistSource,
        playlistSourceMenu,
        playlistFilterToggle,
        playlistFilterInput,
        playlistHydrationProgress,
        playlistHydrationCount,
        playlistList,
        playlistPreventDuplicateWrap,
        playlistPreventDuplicateCheckbox,
        playlistOpen,
        playlistCreate,
        playlistAddCurrent,
        playlistSaveAs,
    } = modal;
    const playlistHeader = playlistHydrationProgress.closest('.playlist-header') as HTMLElement | null;

    let hydrationRunId = 0;
    let queueDragState: QueueDragState | null = null;
    let externalTrackDropIndicator: ExternalTrackDropIndicator | null = null;
    let externalTrackDropIndicatorRow: HTMLElement | null = null;
    let externalTrackDropIndicatorEdge: 'before' | 'after' | null = null;
    let deferredRenderDuringQueueDrag = false;
    let hydrationTotal = 0;
    let hydrationCompleted = 0;
    let hydrationHideToken = 0;
    let hydrationSignature = '';
    let pendingSourceLoadRequestId = 0;
    let pendingSourceLoadValue: string | null = null;
    let pendingSourceLoadMessage = '';
    const queueMutationChunkSize = 512;
    const playlistModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const playlistFilterTransitionMs = 170;
    const playlistViewTransitionMs = 220;
    const playlistFilterDebounceMs = 300;
    const playlistSourceMenuMaxHeightPx = 100;
    const queueVisiblePreviousCount = 50;
    const queueVisibleAheadCount = 50;
    const queueHydrationLookbehind = 50;
    const queueHydrationLookahead = 50;
    const playlistHydrationVisibleRows = 72;
    const playlistHydrationOverscan = 24;
    const playlistEstimatedRowHeightPx = 44;
    const playlistHydrationBatchSize = 24;
    const playlistHydrationWorkerCount = 1;
    const playlistHydrationTransitionMs = 220;
    let playlistModalHideTimer: number | undefined;
    let playlistFilterTransitionTimer: number | undefined;
    let playlistViewTransitionTimer: number | undefined;
    let playlistDialogResizeTimer: number | undefined;
    let playlistFilterDebounceTimer: number | undefined;
    let playlistHydrationHideTimer: number | undefined;
    let playlistFilterExpanded = false;
    let playlistFilterQuery = '';
    const playlistPrefixIcon = (state: 'active' | 'before' | 'after'): string => {
        if (state === 'active') {
            return '<svg class="playlist-inline-icon" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 7C9.24 7 7 9.24 7 12C7 14.76 9.24 17 12 17C14.76 17 17 14.76 17 12C17 9.24 14.76 7 12 7Z"/></svg>';
        }

        if (state === 'before') {
            return '<svg class="playlist-inline-icon" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M14.53 5.47C15.12 6.06 15.12 7.01 14.53 7.6L10.12 12L14.53 16.4C15.12 16.99 15.12 17.94 14.53 18.53C13.94 19.12 12.99 19.12 12.4 18.53L6.94 13.06C6.35 12.47 6.35 11.53 6.94 10.94L12.4 5.47C12.99 4.88 13.94 4.88 14.53 5.47Z"/></svg>';
        }

        return '<svg class="playlist-inline-icon" width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M9.47 5.47C10.06 4.88 11.01 4.88 11.6 5.47L17.06 10.94C17.65 11.53 17.65 12.47 17.06 13.06L11.6 18.53C11.01 19.12 10.06 19.12 9.47 18.53C8.88 17.94 8.88 16.99 9.47 16.4L13.88 12L9.47 7.6C8.88 7.01 8.88 6.06 9.47 5.47Z"/></svg>';
    };
    const playlistDragIcon = '<svg class="playlist-inline-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M9 6.5C9 7.33 8.33 8 7.5 8C6.67 8 6 7.33 6 6.5C6 5.67 6.67 5 7.5 5C8.33 5 9 5.67 9 6.5ZM18 6.5C18 7.33 17.33 8 16.5 8C15.67 8 15 7.33 15 6.5C15 5.67 15.67 5 16.5 5C17.33 5 18 5.67 18 6.5ZM9 12C9 12.83 8.33 13.5 7.5 13.5C6.67 13.5 6 12.83 6 12C6 11.17 6.67 10.5 7.5 10.5C8.33 10.5 9 11.17 9 12ZM18 12C18 12.83 17.33 13.5 16.5 13.5C15.67 13.5 15 12.83 15 12C15 11.17 15.67 10.5 16.5 10.5C17.33 10.5 18 11.17 18 12ZM9 17.5C9 18.33 8.33 19 7.5 19C6.67 19 6 18.33 6 17.5C6 16.67 6.67 16 7.5 16C8.33 16 9 16.67 9 17.5ZM18 17.5C18 18.33 17.33 19 16.5 19C15.67 19 15 18.33 15 17.5C15 16.67 15.67 16 16.5 16C17.33 16 18 16.67 18 17.5Z"/></svg>';
    const playlistRemoveIcon = '<svg class="playlist-inline-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg>';

    const notifyPlaybackQueueMutated = (): void => {
        void options.onPlaybackSequenceMutated?.();
    };

    const cancelPendingSourceLoad = (): void => {
        pendingSourceLoadRequestId += 1;
        pendingSourceLoadValue = null;
        pendingSourceLoadMessage = '';
    };

    const beginPendingSourceLoad = (value: string, message: string): number => {
        pendingSourceLoadRequestId += 1;
        pendingSourceLoadValue = value;
        pendingSourceLoadMessage = message;
        return pendingSourceLoadRequestId;
    };

    const isPendingSourceLoadCurrent = (requestId: number): boolean => requestId === pendingSourceLoadRequestId;

    const clearPendingSourceLoad = (requestId?: number): boolean => {
        if (requestId !== undefined && !isPendingSourceLoadCurrent(requestId)) {
            return false;
        }

        pendingSourceLoadValue = null;
        pendingSourceLoadMessage = '';
        return true;
    };

    const hasCachedPlaylistLabels = (item?: LoadedPlaylistCachedItem): boolean => (
        (item?.cachedTrackTitle || '').trim() !== ''
        && (item?.cachedArtistName || '').trim() !== ''
    );

    const cachedPlaylistItemsByTrackIndex = (): Map<number, LoadedPlaylistCachedItem> => {
        const cachedItemsByTrackIndex = new Map<number, LoadedPlaylistCachedItem>();
        if (!controllerState.loadedPlaylistTrackIndexes || !controllerState.loadedPlaylistCachedItems) {
            return cachedItemsByTrackIndex;
        }

        controllerState.loadedPlaylistTrackIndexes.forEach((trackIndex, position) => {
            const cachedItem = controllerState.loadedPlaylistCachedItems?.[position];
            if (!cachedItem || !hasCachedPlaylistLabels(cachedItem) || cachedItemsByTrackIndex.has(trackIndex)) {
                return;
            }

            cachedItemsByTrackIndex.set(trackIndex, cachedItem);
        });

        return cachedItemsByTrackIndex;
    };

    const persistPlaylistTrackMetadataCache = async (trackIndexes: number[]): Promise<void> => {
        if (!hasLoadedPlaylist() || controllerState.loadedPlaylistReadOnly) {
            return;
        }

        const uniqueTrackIndexes = Array.from(new Set(trackIndexes));
        const cacheEntries: PlaylistTrackMetadataCacheEntry[] = [];
        for (const trackIndex of uniqueTrackIndexes) {
            const track = options.getTrack(trackIndex);
            const trackPath = options.getTrackPath(trackIndex).trim();
            if (!track || !track.tagsResolved || trackPath === '') {
                continue;
            }

            const trackName = (track.displayTitle || track.name || '').trim();
            const artistName = (track.displayArtist || '').trim();
            if (trackName === '' || artistName === '') {
                continue;
            }

            cacheEntries.push({
                trackPath,
                trackName,
                artistName,
            });
        }
        if (cacheEntries.length === 0) {
            return;
        }

        const saved = await options.savePlaylistTrackMetadataCache(cacheEntries);
        if (!saved || !controllerState.loadedPlaylistTrackIndexes) {
            return;
        }

        const cacheEntryByPath = new Map(cacheEntries.map((entry) => [entry.trackPath, entry]));
        const nextCachedItems = controllerState.loadedPlaylistCachedItems
            ? controllerState.loadedPlaylistCachedItems.slice()
            : controllerState.loadedPlaylistTrackIndexes.map(() => ({}));

        controllerState.loadedPlaylistTrackIndexes.forEach((trackIndex, position) => {
            const trackPath = options.getTrackPath(trackIndex).trim();
            const cacheEntry = cacheEntryByPath.get(trackPath);
            if (!cacheEntry) {
                return;
            }

            nextCachedItems[position] = {
                cachedTrackTitle: cacheEntry.trackName,
                cachedArtistName: cacheEntry.artistName,
            };
        });
        controllerState.loadedPlaylistCachedItems = nextCachedItems;
    };

    const resetHydrationRequestState = (): void => {
        hydrationSignature = '';
        setHydrationProgress(0, 0);
    };

    const cancelHydration = (): void => {
        hydrationRunId += 1;
        resetHydrationRequestState();
    };

    const formatListenHistoryAge = (timestampSeconds: number): string => {
        if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
            return '';
        }

        const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(timestampSeconds));
        if (deltaSeconds < 45) {
            return 'just now';
        }

        if (deltaSeconds < 90) {
            return '1 minute ago';
        }

        const deltaMinutes = Math.floor(deltaSeconds / 60);
        if (deltaMinutes < 60) {
            return `${deltaMinutes} minutes ago`;
        }

        if (deltaMinutes < 120) {
            return '1 hour ago';
        }

        const deltaHours = Math.floor(deltaMinutes / 60);
        if (deltaHours < 24) {
            return `${deltaHours} hours ago`;
        }

        if (deltaHours < 48) {
            return '1 day ago';
        }

        const deltaDays = Math.floor(deltaHours / 24);
        if (deltaDays < 14) {
            return `${deltaDays} days ago`;
        }

        const deltaWeeks = Math.floor(deltaDays / 7);
        if (deltaWeeks < 8) {
            return deltaWeeks === 1 ? '1 week ago' : `${deltaWeeks} weeks ago`;
        }

        const deltaMonths = Math.floor(deltaDays / 30);
        if (deltaMonths < 12) {
            return deltaMonths === 1 ? '1 month ago' : `${deltaMonths} months ago`;
        }

        const deltaYears = Math.floor(deltaDays / 365);
        return deltaYears === 1 ? '1 year ago' : `${deltaYears} years ago`;
    };

    const formatListenHistoryPlayedPercent = (playedPercent: number | undefined): string => {
        if (!Number.isFinite(playedPercent || 0)) {
            return '';
        }

        const normalized = Math.max(0, Math.min(100, Math.round(playedPercent || 0)));
        if (normalized <= 0) {
            return '';
        }

        return `${normalized}% played`;
    };

    const formatListenHistoryMeta = (historyItem: LoadedListenHistoryItem | undefined): string => {
        const parts = [
            formatListenHistoryPlayedPercent(historyItem?.playedPercent),
            formatListenHistoryAge(historyItem?.listenedAt || 0),
        ].filter((part) => part !== '');
        return parts.join(', ');
    };

    const setHydrationProgress = (completed: number, total: number): void => {
        const setHydrationProgressSlotWidth = (widthPx: number): void => {
            if (!playlistHeader) {
                return;
            }

            playlistHeader.style.setProperty('--playlist-hydration-slot-width', `${Math.max(0, Math.ceil(widthPx))}px`);
        };

        const measureHydrationProgressWidth = (): number => {
            const measuredWidth = playlistHydrationProgress.scrollWidth;
            if (measuredWidth > 0) {
                return measuredWidth;
            }

            const previousVisibility = playlistHydrationProgress.style.visibility;
            const previousPosition = playlistHydrationProgress.style.position;
            playlistHydrationProgress.style.visibility = 'hidden';
            playlistHydrationProgress.style.position = 'absolute';
            playlistHydrationProgress.hidden = false;
            const fallbackWidth = playlistHydrationProgress.scrollWidth;
            playlistHydrationProgress.style.visibility = previousVisibility;
            playlistHydrationProgress.style.position = previousPosition;
            return fallbackWidth;
        };

        const clearHydrationHideTimer = (): void => {
            if (playlistHydrationHideTimer === undefined) {
                return;
            }

            window.clearTimeout(playlistHydrationHideTimer);
            playlistHydrationHideTimer = undefined;
        };

        const showHydrationProgress = (expectedHideToken: number): void => {
            clearHydrationHideTimer();
            playlistHydrationProgress.hidden = false;
            setHydrationProgressSlotWidth(measureHydrationProgressWidth());
            window.requestAnimationFrame(() => {
                if (expectedHideToken !== hydrationHideToken || hydrationTotal <= 0) {
                    return;
                }

                playlistDialog.classList.add('is-hydration-progress-visible');
            });
        };

        const hideHydrationProgress = (): void => {
            if (playlistHydrationProgress.hidden) {
                return;
            }

            if (!playlistDialog.classList.contains('is-hydration-progress-visible') && playlistHydrationHideTimer !== undefined) {
                return;
            }

            playlistDialog.classList.remove('is-hydration-progress-visible');
            clearHydrationHideTimer();
            playlistHydrationHideTimer = window.setTimeout(() => {
                if (playlistDialog.classList.contains('is-hydration-progress-visible')) {
                    return;
                }

                playlistHydrationProgress.hidden = true;
                setHydrationProgressSlotWidth(0);
                playlistHydrationHideTimer = undefined;
            }, playlistHydrationTransitionMs);
        };

        hydrationHideToken += 1;
        const activeHideToken = hydrationHideToken;

        hydrationCompleted = Math.max(0, completed);
        hydrationTotal = Math.max(0, total);

        if (hydrationTotal <= 0) {
            hideHydrationProgress();
            return;
        }

        const boundedCompleted = Math.min(hydrationCompleted, hydrationTotal);
        playlistHydrationCount.textContent = `${boundedCompleted} of ${hydrationTotal}`;
        showHydrationProgress(activeHideToken);

        if (boundedCompleted >= hydrationTotal) {
            // Keep the completed state visible for at least one paint, then hide.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (activeHideToken !== hydrationHideToken) {
                        return;
                    }

                    if (hydrationTotal > 0 && hydrationCompleted >= hydrationTotal) {
                        hideHydrationProgress();
                    }
                });
            });
        }
    };

    const hasLoadedPlaylist = (): boolean => controllerState.loadedPlaylistTrackIndexes !== null;

    const normalizePlaylistPath = (playlistPath: string): string => playlistPath.trim().toLowerCase();

    const loadedPlaylistPlaybackSequenceSource = (): PlaybackSequenceSource | null => {
        if (!controllerState.loadedPlaylistTrackIndexes) {
            return null;
        }

        const normalizedPath = normalizePlaylistPath(controllerState.loadedPlaylistPath);
        const sourceKind = normalizedPath === '__listen_history__' ? 'history' : 'playlist';
        return {
            key: normalizedPath !== '' ? `${sourceKind}::${normalizedPath}` : sourceKind,
            indexes: controllerState.loadedPlaylistTrackIndexes,
        };
    };

    const isQueueEligibleTrackIndex = (trackIndex: number): boolean => {
        if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= options.getTrackCount()) {
            return false;
        }

        const track = options.getTrack(trackIndex);
        return !!track && isPlaybackQueueEligibleTrack(track);
    };

    const normalizeQueueEligibleTrackIndexes = (trackIndexes: number[]): number[] => {
        return trackIndexes.filter((trackIndex) => isQueueEligibleTrackIndex(trackIndex));
    };

    const pruneHydratedSilenceTracksFromLoadedPlaylist = (silenceTrackIndexes: ReadonlySet<number>): boolean => {
        if (!controllerState.loadedPlaylistTrackIndexes || silenceTrackIndexes.size === 0) {
            return false;
        }

        const nextTrackIndexes: number[] = [];
        const nextCachedItems = controllerState.loadedPlaylistCachedItems ? [] as LoadedPlaylistCachedItem[] : null;
        const nextHistoryItems = controllerState.loadedPlaylistHistoryItems ? [] as LoadedListenHistoryItem[] : null;
        let changed = false;

        controllerState.loadedPlaylistTrackIndexes.forEach((trackIndex, position) => {
            if (silenceTrackIndexes.has(trackIndex)) {
                changed = true;
                return;
            }

            nextTrackIndexes.push(trackIndex);
            if (nextCachedItems) {
                nextCachedItems.push(controllerState.loadedPlaylistCachedItems?.[position] || {});
            }
            if (nextHistoryItems) {
                nextHistoryItems.push(controllerState.loadedPlaylistHistoryItems?.[position] || { listenedAt: 0, playedPercent: 0 });
            }
        });

        if (!changed) {
            return false;
        }

        controllerState.loadedPlaylistTrackIndexes = nextTrackIndexes;
        controllerState.loadedPlaylistCachedItems = nextCachedItems;
        controllerState.loadedPlaylistHistoryItems = nextHistoryItems;
        return true;
    };

    const pruneHydratedSilenceTracksFromEditableQueue = (silenceTrackIndexes: ReadonlySet<number>): boolean => {
        if (!controllerState.editableQueueTrackIndexes || silenceTrackIndexes.size === 0) {
            return false;
        }

        const nextQueueIndexes = controllerState.editableQueueTrackIndexes.filter((trackIndex) => !silenceTrackIndexes.has(trackIndex));
        if (nextQueueIndexes.length === controllerState.editableQueueTrackIndexes.length) {
            return false;
        }

        if (nextQueueIndexes.length === 0) {
            clearEditableQueueState();
            return true;
        }

        controllerState.editableQueueTrackIndexes = nextQueueIndexes;
        resolveEditableQueueCurrentPosition(nextQueueIndexes);
        return true;
    };

    const pruneHydratedSilenceTracksFromPlaybackState = (trackIndexes: number[]): boolean => {
        const silenceTrackIndexes = new Set(trackIndexes.filter((trackIndex) => !isQueueEligibleTrackIndex(trackIndex)));
        if (silenceTrackIndexes.size === 0) {
            return false;
        }

        const loadedPlaylistChanged = pruneHydratedSilenceTracksFromLoadedPlaylist(silenceTrackIndexes);
        const editableQueueChanged = pruneHydratedSilenceTracksFromEditableQueue(silenceTrackIndexes);
        if (!loadedPlaylistChanged && !editableQueueChanged) {
            return false;
        }

        if (editableQueueChanged || controllerState.playbackSource === 'playlist') {
            notifyPlaybackQueueMutated();
        }

        return true;
    };

    const sanitizeLoadedPlaylistData = (loadedPlaylist: LoadedPlaylistData): LoadedPlaylistData => {
        const nextTrackIndexes: number[] = [];
        const nextCachedItems = loadedPlaylist.cachedItems ? [] as LoadedPlaylistCachedItem[] : undefined;
        const nextHistoryItems = loadedPlaylist.historyItems ? [] as LoadedListenHistoryItem[] : undefined;

        loadedPlaylist.trackIndexes.forEach((trackIndex, position) => {
            if (!isQueueEligibleTrackIndex(trackIndex)) {
                return;
            }

            nextTrackIndexes.push(trackIndex);
            if (nextCachedItems) {
                nextCachedItems.push(loadedPlaylist.cachedItems?.[position] || {});
            }
            if (nextHistoryItems) {
                nextHistoryItems.push(loadedPlaylist.historyItems?.[position] || { listenedAt: 0, playedPercent: 0 });
            }
        });

        return {
            ...loadedPlaylist,
            cachedItems: nextCachedItems,
            historyItems: nextHistoryItems,
            trackIndexes: nextTrackIndexes,
        };
    };

    const isViewingReadOnlyPlaylist = (): boolean => controllerState.selectedSource === 'history' && controllerState.loadedPlaylistReadOnly;

    const clearEditableQueueState = (): void => {
        controllerState.editableQueueTrackIndexes = null;
        controllerState.editableQueueCurrentPosition = null;
    };

    const clampEditableQueuePosition = (queueIndexes: number[], position: number | null): number => {
        if (queueIndexes.length === 0) {
            return 0;
        }

        if (!Number.isInteger(position)) {
            return 0;
        }

        return Math.min(Math.max(position as number, 0), queueIndexes.length - 1);
    };

    const setEditableQueueState = (queueIndexes: number[], currentPosition: number): number[] => {
        if (queueIndexes.length === 0) {
            clearEditableQueueState();
            return [];
        }

        controllerState.editableQueueTrackIndexes = queueIndexes;
        controllerState.editableQueueCurrentPosition = clampEditableQueuePosition(queueIndexes, currentPosition);
        return queueIndexes;
    };

    const queueIndexesEqual = (left: number[] | null | undefined, right: number[]): boolean => {
        if (!left || left.length !== right.length) {
            return false;
        }

        return left.every((trackIndex, position) => trackIndex === right[position]);
    };

    const limitQueueIndexesToSourceOccurrences = (queueIndexes: number[], sourceIndexes: number[]): number[] => {
        if (sourceIndexes.length === 0) {
            return [];
        }

        const remainingCounts = new Map<number, number>();
        for (const trackIndex of sourceIndexes) {
            remainingCounts.set(trackIndex, (remainingCounts.get(trackIndex) || 0) + 1);
        }

        const limitedIndexes: number[] = [];
        for (const trackIndex of queueIndexes) {
            const remaining = remainingCounts.get(trackIndex) || 0;
            if (remaining <= 0) {
                continue;
            }

            limitedIndexes.push(trackIndex);
            remainingCounts.set(trackIndex, remaining - 1);
            if (limitedIndexes.length >= sourceIndexes.length) {
                return limitedIndexes;
            }
        }

        for (const trackIndex of sourceIndexes) {
            const remaining = remainingCounts.get(trackIndex) || 0;
            if (remaining <= 0) {
                continue;
            }

            limitedIndexes.push(trackIndex);
            remainingCounts.set(trackIndex, remaining - 1);
            if (limitedIndexes.length >= sourceIndexes.length) {
                break;
            }
        }

        return limitedIndexes;
    };

    const isShuffleQueuePlayback = (): boolean => {
        const playbackOrderMode = options.playbackSequencingService?.getPlaybackOrderMode?.();
        return controllerState.playbackSource === 'queue'
            && (playbackOrderMode === 'shuffle-library' || playbackOrderMode === 'shuffle-album');
    };

    const redrawPlaybackQueueFromBaseSequence = (currentPositionOverride?: number): boolean => {
        if (!isShuffleQueuePlayback()) {
            return false;
        }

        const nextSequence = options.getBaseSequence();
        if (nextSequence.indexes.length === 0) {
            clearEditableQueueState();
            return false;
        }

        const previousQueue = controllerState.editableQueueTrackIndexes?.slice();
        const previousPosition = controllerState.editableQueueCurrentPosition;
        const nextIndexes = nextSequence.indexes.slice();
        const nextPosition = clampEditableQueuePosition(nextIndexes, currentPositionOverride ?? nextSequence.currentPosition);

        controllerState.playbackSource = 'queue';
        setEditableQueueState(nextIndexes, nextPosition);
        return !queueIndexesEqual(previousQueue, nextIndexes) || previousPosition !== nextPosition;
    };

    const resolveEditableQueueCurrentPosition = (queueIndexes: number[]): number => {
        if (queueIndexes.length === 0) {
            controllerState.editableQueueCurrentPosition = null;
            return 0;
        }

        const storedPosition = controllerState.editableQueueCurrentPosition;
        const currentTrackIndex = options.getCurrentTrackIndex();
        const matchingPositions: number[] = [];
        for (let position = 0; position < queueIndexes.length; position += 1) {
            if (queueIndexes[position] === currentTrackIndex) {
                matchingPositions.push(position);
            }
        }

        if (matchingPositions.length > 0) {
            let resolvedPosition = matchingPositions[0];
            if (Number.isInteger(storedPosition)) {
                const targetPosition = storedPosition as number;
                for (const position of matchingPositions) {
                    const currentDistance = Math.abs(position - targetPosition);
                    const bestDistance = Math.abs(resolvedPosition - targetPosition);
                    if (currentDistance < bestDistance) {
                        resolvedPosition = position;
                    }
                }
            }

            controllerState.editableQueueCurrentPosition = resolvedPosition;
            return resolvedPosition;
        }

        const resolvedPosition = clampEditableQueuePosition(queueIndexes, storedPosition);
        controllerState.editableQueueCurrentPosition = resolvedPosition;
        return resolvedPosition;
    };

    const updateEditableQueueCurrentPositionAfterRemoval = (removePosition: number, queueLength: number): void => {
        if (!controllerState.editableQueueTrackIndexes) {
            return;
        }

        if (queueLength <= 0) {
            controllerState.editableQueueCurrentPosition = null;
            return;
        }

        let nextPosition = clampEditableQueuePosition(controllerState.editableQueueTrackIndexes, controllerState.editableQueueCurrentPosition);
        if (removePosition < nextPosition) {
            nextPosition -= 1;
        }

        controllerState.editableQueueCurrentPosition = Math.max(0, Math.min(nextPosition, queueLength - 1));
    };

    const updateEditableQueueCurrentPositionAfterMove = (fromPosition: number, toPosition: number, queueLength: number): void => {
        if (!controllerState.editableQueueTrackIndexes || queueLength <= 0) {
            return;
        }

        let nextPosition = clampEditableQueuePosition(controllerState.editableQueueTrackIndexes, controllerState.editableQueueCurrentPosition);
        if (fromPosition === nextPosition) {
            nextPosition = toPosition;
        } else if (fromPosition < nextPosition && toPosition >= nextPosition) {
            nextPosition -= 1;
        } else if (fromPosition > nextPosition && toPosition <= nextPosition) {
            nextPosition += 1;
        }

        controllerState.editableQueueCurrentPosition = Math.max(0, Math.min(nextPosition, queueLength - 1));
    };

    const clearQueueDragClasses = (): void => {
        playlistList.querySelectorAll('.playlist-row.is-dragging, .playlist-row.is-drop-target').forEach((row) => {
            row.classList.remove('is-dragging', 'is-drop-target');
        });
    };

    const clearExternalTrackDropIndicatorClasses = (): void => {
        if (!externalTrackDropIndicatorRow) {
            externalTrackDropIndicatorEdge = null;
            return;
        }

        externalTrackDropIndicatorRow.classList.remove('is-external-drop-target-before', 'is-external-drop-target-after');
        externalTrackDropIndicatorRow = null;
        externalTrackDropIndicatorEdge = null;
    };

    const applyExternalTrackDropIndicatorClass = (row: HTMLElement, edge: 'before' | 'after'): void => {
        if (externalTrackDropIndicatorRow === row && externalTrackDropIndicatorEdge === edge) {
            return;
        }

        if (externalTrackDropIndicatorRow) {
            externalTrackDropIndicatorRow.classList.remove('is-external-drop-target-before', 'is-external-drop-target-after');
        }

        row.classList.add(edge === 'before' ? 'is-external-drop-target-before' : 'is-external-drop-target-after');
        externalTrackDropIndicatorRow = row;
        externalTrackDropIndicatorEdge = edge;
    };

    const getLastPlaylistRow = (): HTMLElement | null => {
        for (let node = playlistList.lastElementChild; node; node = node.previousElementSibling) {
            if (node instanceof HTMLElement && node.classList.contains('playlist-row')) {
                return node;
            }
        }

        return null;
    };

    const syncExternalTrackDropIndicatorClasses = (): void => {
        if (!externalTrackDropIndicator || externalTrackDropIndicator.rowPosition === null) {
            clearExternalTrackDropIndicatorClasses();
            return;
        }

        const indicatorRow = playlistList.querySelector<HTMLElement>(`.playlist-row[data-playlist-position="${externalTrackDropIndicator.rowPosition}"]`);
        if (!indicatorRow) {
            clearExternalTrackDropIndicatorClasses();
            return;
        }

        applyExternalTrackDropIndicatorClass(indicatorRow, externalTrackDropIndicator.edge);
    };

    const clearExternalTrackDropIndicator = (): void => {
        externalTrackDropIndicator = null;
        clearExternalTrackDropIndicatorClasses();
    };

    const updateQueueDragTargetClasses = (): void => {
        clearQueueDragClasses();
        if (!queueDragState) {
            return;
        }

        const dragRow = playlistList.querySelector<HTMLElement>(`.playlist-row[data-playlist-position="${queueDragState.fromPosition}"]`);
        dragRow?.classList.add('is-dragging');

        const dropRow = playlistList.querySelector<HTMLElement>(`.playlist-row[data-playlist-position="${queueDragState.targetPosition}"]`);
        dropRow?.classList.add('is-drop-target');
    };

    const updateQueueDragTargetFromPoint = (clientX: number, clientY: number): void => {
        if (!queueDragState) {
            return;
        }

        const hovered = document.elementFromPoint(clientX, clientY);
        if (!(hovered instanceof Element)) {
            return;
        }

        const row = hovered.closest('.playlist-row');
        if (!(row instanceof HTMLElement) || !playlistList.contains(row)) {
            return;
        }

        const targetPosition = Number(row.dataset.playlistPosition);
        if (!Number.isInteger(targetPosition) || targetPosition === queueDragState.targetPosition) {
            return;
        }

        queueDragState.targetPosition = targetPosition;
        updateQueueDragTargetClasses();
    };

    const finalizeQueueDrag = (applyReorder: boolean): void => {
        const dragState = queueDragState;
        queueDragState = null;

        if (!dragState) {
            return;
        }

        clearQueueDragClasses();

        if (applyReorder) {
            const activeQueue = mutableCurrentSequence();
            const queueMutated = activeQueue === controllerState.editableQueueTrackIndexes;
            const { fromPosition, targetPosition } = dragState;
            let reordered = false;
            if (
                Number.isInteger(fromPosition)
                && Number.isInteger(targetPosition)
                && fromPosition >= 0
                && targetPosition >= 0
                && fromPosition < activeQueue.length
                && targetPosition < activeQueue.length
                && fromPosition !== targetPosition
            ) {
                const [moved] = activeQueue.splice(fromPosition, 1);
                activeQueue.splice(targetPosition, 0, moved);
                updateEditableQueueCurrentPositionAfterMove(fromPosition, targetPosition, activeQueue.length);
                reordered = true;
            }

            if (reordered && queueMutated) {
                notifyPlaybackQueueMutated();
            }
        }

        const shouldRender = deferredRenderDuringQueueDrag || applyReorder;
        deferredRenderDuringQueueDrag = false;
        if (shouldRender && !playlistModal.hidden) {
            renderPlaylist();
        }
    };

    const getPlaylistRowLabels = (
        trackIndex: number,
        cachedItemsByTrackIndex: Map<number, LoadedPlaylistCachedItem>,
    ): { label: string; secondary: string } => {
        const track = options.getTrack(trackIndex);
        const cachedItem = cachedItemsByTrackIndex.get(trackIndex);

        return {
            label: track?.displayTitle || track?.name || cachedItem?.cachedTrackTitle || 'Unknown track',
            secondary: track?.displayArtist || cachedItem?.cachedArtistName || '',
        };
    };

    const measurePlaylistRowHeight = (): number => {
        const measuredRowHeight = playlistList.querySelector<HTMLElement>('.playlist-row, .playlist-item-empty')?.getBoundingClientRect().height || 0;
        return measuredRowHeight > 0 ? measuredRowHeight : playlistEstimatedRowHeightPx;
    };

    const getPlaylistVisibleWindow = (indexes: number[]): PlaylistVisibleWindow => {
        const rowHeight = measurePlaylistRowHeight();
        if (indexes.length === 0) {
            return {
                start: 0,
                end: 0,
                rowHeight,
                topSpacerHeight: 0,
                bottomSpacerHeight: 0,
            };
        }

        const visibleRowCount = Math.max(1, Math.ceil((playlistList.clientHeight || 0) / rowHeight));
        const windowRowCount = Math.max(playlistHydrationVisibleRows, visibleRowCount + (playlistHydrationOverscan * 2));
        const firstVisibleRow = Math.max(0, Math.floor((playlistList.scrollTop || 0) / rowHeight));
        const maxStart = Math.max(0, indexes.length - windowRowCount);
        const start = Math.min(maxStart, Math.max(0, firstVisibleRow - playlistHydrationOverscan));
        const end = Math.min(indexes.length, start + windowRowCount);

        return {
            start,
            end,
            rowHeight,
            topSpacerHeight: start * rowHeight,
            bottomSpacerHeight: Math.max(0, (indexes.length - end) * rowHeight),
        };
    };

    const playlistHydrationWindow = (indexes: number[]): number[] => {
        const { start, end } = getPlaylistVisibleWindow(indexes);
        return indexes.slice(start, end);
    };

    const refreshRenderedPlaylistRows = (trackIndexes: number[]): void => {
        if (playlistModal.hidden || controllerState.selectedSource === 'queue' || !hasLoadedPlaylist()) {
            return;
        }

        const cachedItemsByTrackIndex = cachedPlaylistItemsByTrackIndex();
        const uniqueTrackIndexes = Array.from(new Set(trackIndexes));
        for (const trackIndex of uniqueTrackIndexes) {
            const { label, secondary } = getPlaylistRowLabels(trackIndex, cachedItemsByTrackIndex);
            const rowButtons = playlistList.querySelectorAll<HTMLButtonElement>(`[data-playlist-track-index="${trackIndex}"]`);
            rowButtons.forEach((rowButton) => {
                const labelElement = rowButton.querySelector<HTMLElement>('.playlist-item-label');
                const secondaryElement = rowButton.querySelector<HTMLElement>('.playlist-item-sub');
                if (labelElement && labelElement.textContent !== label) {
                    labelElement.textContent = label;
                }
                if (secondaryElement && secondaryElement.textContent !== secondary) {
                    secondaryElement.textContent = secondary;
                }
            });
        }
    };

    const requestTrackMetadataHydration = (trackIndexes: number[]): void => {
        if (!backgroundHydrationEnabled && controllerState.selectedSource !== 'queue') {
            resetHydrationRequestState();
            return;
        }

        if (playlistModal.hidden) {
            resetHydrationRequestState();
            return;
        }

        const normalizedTrackIndexes = Array.from(new Set(trackIndexes)).filter((index) => {
            return index >= 0 && index < options.getTrackCount();
        });
        if (normalizedTrackIndexes.length === 0) {
            hydrationSignature = '';
            setHydrationProgress(0, 0);
            return;
        }

        const nextSignature = normalizedTrackIndexes.join(',');
        if (nextSignature === hydrationSignature) {
            return;
        }

        hydrationSignature = nextSignature;
        hydrateTrackMetadataInBackground(normalizedTrackIndexes);
    };

    const playlistTargetLabel = (playlistPath: string, fallbackLabel = ''): string => {
        const cleanFallbackLabel = fallbackLabel.trim();
        if (cleanFallbackLabel !== '') {
            return cleanFallbackLabel;
        }

        const segments = playlistPath.split(/[\\/]/);
        return segments[segments.length - 1] || playlistPath;
    };

    const getAvailablePlaylistTargets = (): PlaylistTargetOption[] => {
        const targets: PlaylistTargetOption[] = [];
        const seen = new Set<string>();
        const appendTarget = (playlistPath: string, fallbackLabel = ''): void => {
            const cleanPath = playlistPath.trim();
            if (cleanPath === '') {
                return;
            }

            const normalizedPath = normalizePlaylistPath(cleanPath);
            if (seen.has(normalizedPath)) {
                return;
            }

            seen.add(normalizedPath);
            targets.push({
                path: cleanPath,
                label: playlistTargetLabel(cleanPath, fallbackLabel),
            });
        };

        options.getFavoritePlaylists().forEach((playlistPath) => {
            appendTarget(playlistPath);
        });
        if (!controllerState.loadedPlaylistReadOnly) {
            appendTarget(controllerState.loadedPlaylistPath, controllerState.loadedPlaylistName);
        }

        return targets;
    };

    const loadPlaylistByPath = async (playlistPath: string): Promise<boolean> => {
        const normalizedPath = playlistPath.trim();
        if (!normalizedPath) {
            return false;
        }

        cancelPendingSourceLoad();

        const loadedPlaylist = await options.loadPlaylistData(normalizedPath);
        if (!loadedPlaylist) {
            return false;
        }

        const sanitizedPlaylist = sanitizeLoadedPlaylistData(loadedPlaylist);

        controllerState.loadedPlaylistTrackIndexes = sanitizedPlaylist.trackIndexes;
        controllerState.loadedPlaylistName = sanitizedPlaylist.name || '';
        controllerState.loadedPlaylistPath = normalizedPath;
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = sanitizedPlaylist.cachedItems || null;
        clearEditableQueueState();
        controllerState.selectedSource = 'playlist';
        controllerState.playbackSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        finalizeQueueDrag(false);
        clearPlaylistFilter();
        playlistList.scrollTop = 0;
        resetHydrationRequestState();
        options.onExternalPlaylistLoaded();
        openModal();
        return true;
    };

    const loadListenHistoryPlaylist = async (openAfterLoad = false, sourceLoadRequestId?: number): Promise<boolean> => {
        const loadedPlaylist = await options.loadListenHistoryData();
        if (!loadedPlaylist) {
            return false;
        }

        if (sourceLoadRequestId !== undefined && !isPendingSourceLoadCurrent(sourceLoadRequestId)) {
            return false;
        }

        clearPendingSourceLoad(sourceLoadRequestId);

        const sanitizedPlaylist = sanitizeLoadedPlaylistData(loadedPlaylist);

        controllerState.loadedPlaylistTrackIndexes = sanitizedPlaylist.trackIndexes;
        controllerState.loadedPlaylistName = sanitizedPlaylist.name || 'Listen History';
        controllerState.loadedPlaylistPath = '__listen_history__';
        controllerState.loadedPlaylistReadOnly = true;
        controllerState.loadedPlaylistHistoryItems = sanitizedPlaylist.historyItems || [];
        controllerState.loadedPlaylistCachedItems = sanitizedPlaylist.cachedItems || null;
        clearEditableQueueState();
        controllerState.selectedSource = 'history';
        controllerState.playbackSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        finalizeQueueDrag(false);
        clearPlaylistFilter();
        playlistList.scrollTop = 0;
        resetHydrationRequestState();

        if (openAfterLoad) {
            openModal();
            return true;
        }

        hydrateCurrentViewTracks();
        renderPlaylist(true);

        return true;
    };

    const loadedPlaylistSequence = (): PlaylistSequence | null => {
        if (!controllerState.loadedPlaylistTrackIndexes) {
            return null;
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        const currentPosition = controllerState.loadedPlaylistTrackIndexes.indexOf(currentTrackIndex);
        return {
            indexes: controllerState.loadedPlaylistTrackIndexes,
            currentPosition: currentPosition >= 0 ? currentPosition : 0,
        };
    };

    const playbackOverrideSequence = (): PlaylistSequence | null => {
        const playbackSource = loadedPlaylistPlaybackSequenceSource();
        if (!playbackSource) {
            return null;
        }

        if (!options.playbackSequencingService) {
            return loadedPlaylistSequence();
        }

        return options.playbackSequencingService.baseSequenceIndexes(playbackSource);
    };

    const playbackOrderScopeLabel = (): string => {
        if (controllerState.playbackSource === 'playlist' && controllerState.loadedPlaylistTrackIndexes) {
            return normalizePlaylistPath(controllerState.loadedPlaylistPath) === '__listen_history__'
                ? 'Listen History'
                : 'Playlist';
        }

        if (controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length > 0) {
            return 'Queue';
        }

        return 'Library';
    };

    const queueSequence = (): PlaylistSequence => {
        if (controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length > 0) {
            const currentPosition = resolveEditableQueueCurrentPosition(controllerState.editableQueueTrackIndexes);
            return {
                indexes: controllerState.editableQueueTrackIndexes,
                currentPosition,
            };
        }

        const playlistSequence = loadedPlaylistSequence();
        if (controllerState.playbackSource === 'playlist' && playlistSequence && playlistSequence.indexes.length > 0) {
            return {
                indexes: playlistSequence.indexes,
                currentPosition: playlistSequence.currentPosition,
            };
        }

        return options.getBaseSequence();
    };

    const currentSequence = (): PlaylistSequence => {
        if (controllerState.selectedSource !== 'queue') {
            const playlistSequence = loadedPlaylistSequence();
            if (playlistSequence) {
                return playlistSequence;
            }
        }

        return queueSequence();
    };

    const playlistSourceIconMarkup = (selectedValue: string): string => {
        if (selectedValue === 'queue') {
            return playbackQueueSourceIcon;
        }

        if (selectedValue === 'history') {
            return listenHistorySourceIcon;
        }

        return '';
    };

    const updatePlaylistSourceIcon = (selectedValue: string): void => {
        const iconMarkup = playlistSourceIconMarkup(selectedValue);
        playlistSourceIcon.innerHTML = iconMarkup;
        if (iconMarkup !== '') {
            playlistSourceIcon.classList.add('is-visible');
            return;
        }

        playlistSourceIcon.innerHTML = '';
        playlistSourceIcon.classList.remove('is-visible');
    };

    const normalizePlaylistFilterQuery = (value: string): string => value.trim().toLocaleLowerCase();

    const syncPlaylistFilterUi = (): void => {
        playlistDialog.classList.toggle('is-filter-open', playlistFilterExpanded);
        playlistFilterToggle.setAttribute('aria-expanded', playlistFilterExpanded ? 'true' : 'false');
        playlistFilterInput.tabIndex = playlistFilterExpanded ? 0 : -1;
    };

    const setPlaylistFilterExpanded = (expanded: boolean, focusInput = false): void => {
        playlistFilterExpanded = expanded;
        syncPlaylistFilterUi();
        if (focusInput && playlistFilterExpanded) {
            window.requestAnimationFrame(() => {
                playlistFilterInput.focus();
                playlistFilterInput.select();
            });
        }
    };

    const cancelPendingPlaylistFilterUpdate = (): void => {
        if (playlistFilterDebounceTimer === undefined) {
            return;
        }

        window.clearTimeout(playlistFilterDebounceTimer);
        playlistFilterDebounceTimer = undefined;
    };

    const hasPlaylistFilterText = (): boolean => {
        return normalizePlaylistFilterQuery(playlistFilterInput.value) !== '' || normalizePlaylistFilterQuery(playlistFilterQuery) !== '';
    };

    const clearPlaylistFilter = (): void => {
        cancelPendingPlaylistFilterUpdate();
        playlistFilterQuery = '';
        playlistFilterInput.value = '';
        setPlaylistFilterExpanded(false);
    };

    const playlistFilterTerms = (): string[] => {
        const normalizedQuery = normalizePlaylistFilterQuery(playlistFilterQuery);
        if (normalizedQuery === '') {
            return [];
        }

        return normalizedQuery.split(/\s+/).filter((term) => term !== '');
    };

    const matchesPlaylistFilter = (
        trackIndex: number,
        cachedItemsByTrackIndex: Map<number, LoadedPlaylistCachedItem>,
        filterTerms: string[],
    ): boolean => {
        if (filterTerms.length === 0) {
            return true;
        }

        const track = options.getTrack(trackIndex);
        const cachedItem = cachedItemsByTrackIndex.get(trackIndex);
        const searchableText = [
            track?.displayTitle || '',
            track?.name || '',
            track?.displayArtist || '',
            cachedItem?.cachedTrackTitle || '',
            cachedItem?.cachedArtistName || '',
        ].join('\n').toLocaleLowerCase();

        return filterTerms.every((term) => searchableText.includes(term));
    };

    const getPlaylistSourceControlOptions = (): PlaylistSourceControlOption[] => {
        const favoritePlaylists = options.getFavoritePlaylists().filter((playlistPath) => playlistPath.trim() !== '');
        const expectedOptions: PlaylistSourceControlOption[] = [
            { value: 'queue', label: playbackQueueSourceLabel, iconMarkup: playbackQueueSourceIcon },
            ...(options.hasListenHistoryPlaylist() ? [{ value: 'history', label: listenHistorySourceLabel, iconMarkup: listenHistorySourceIcon }] : []),
            ...favoritePlaylists.map((playlistPath, index) => {
                const segments = playlistPath.split(/[\\/]/);
                const baseName = segments[segments.length - 1] || playlistPath;
                return {
                    value: `favorite:${index}`,
                    label: `Favorite: ${baseName}`,
                    iconMarkup: '',
                };
            }),
        ];

        const loadedPlaylistMatchesFavorite = hasLoadedPlaylist() && favoritePlaylists.some((playlistPath) => {
            return normalizePlaylistPath(playlistPath) === normalizePlaylistPath(controllerState.loadedPlaylistPath);
        });

        if (hasLoadedPlaylist() && !loadedPlaylistMatchesFavorite && !controllerState.loadedPlaylistReadOnly) {
            const playlistLabel = `Playlist: ${controllerState.loadedPlaylistName || 'M3U/M3U8'}`;
            expectedOptions.push({ value: 'playlist', label: playlistLabel, iconMarkup: '' });
        }

        return expectedOptions;
    };

    const buildPlaylistSourceOptionButton = (option: PlaylistSourceControlOption): HTMLButtonElement => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'playlist-source-option';
        optionButton.dataset.value = option.value;
        optionButton.setAttribute('role', 'option');

        const optionIcon = document.createElement('span');
        optionIcon.className = 'playlist-source-option-icon';
        if (option.iconMarkup === '') {
            optionIcon.classList.add('is-empty');
        } else {
            optionIcon.innerHTML = option.iconMarkup;
        }

        const optionLabel = document.createElement('span');
        optionLabel.className = 'playlist-source-option-label';
        optionLabel.textContent = option.label;

        optionButton.append(optionIcon, optionLabel);
        return optionButton;
    };

    const rebuildPlaylistSourceControl = (expectedOptions: PlaylistSourceControlOption[]): void => {
        playlistSource.innerHTML = '';
        playlistSourceMenu.innerHTML = '';

        expectedOptions.forEach((option) => {
            const nativeOption = document.createElement('option');
            nativeOption.value = option.value;
            nativeOption.text = option.label;
            playlistSource.append(nativeOption);
            playlistSourceMenu.append(buildPlaylistSourceOptionButton(option));
        });
    };

    const setPlaylistSourceSelection = (selectedValue: string): boolean => {
        const selectedOption = Array.from(playlistSource.options).find((option) => option.value === selectedValue);
        if (!selectedOption) {
            return false;
        }

        playlistSource.value = selectedValue;
        playlistSourceLabel.textContent = selectedOption.text;
        updatePlaylistSourceIcon(selectedValue);

        Array.from(playlistSourceMenu.querySelectorAll<HTMLButtonElement>('.playlist-source-option')).forEach((optionButton) => {
            const isSelected = optionButton.dataset.value === selectedValue;
            optionButton.classList.toggle('is-selected', isSelected);
            optionButton.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            optionButton.tabIndex = isSelected ? 0 : -1;
        });

        return true;
    };

    const closePlaylistSourceMenu = (restoreFocus = false): void => {
        playlistSourceMenu.hidden = true;
        playlistSourceWrap.classList.remove('is-open');
        playlistSourceWrap.classList.remove('opens-upward');
        playlistSourceMenu.style.maxHeight = '';
        playlistSourceButton.setAttribute('aria-expanded', 'false');
        if (restoreFocus) {
            playlistSourceButton.focus();
        }
    };

    const focusPlaylistSourceOption = (selectedValue?: string): void => {
        const selectedOption = selectedValue
            ? playlistSourceMenu.querySelector<HTMLButtonElement>(`.playlist-source-option[data-value="${selectedValue}"]`)
            : playlistSourceMenu.querySelector<HTMLButtonElement>('.playlist-source-option.is-selected');
        const firstOption = playlistSourceMenu.querySelector<HTMLButtonElement>('.playlist-source-option');
        (selectedOption ?? firstOption)?.focus();
    };

    const openPlaylistSourceMenu = (): void => {
        if (playlistSource.options.length === 0) {
            return;
        }

        const dialogRect = playlistDialog.getBoundingClientRect();
        const sourceWrapRect = playlistSourceWrap.getBoundingClientRect();
        const menuMargin = 8;
        const spaceBelow = Math.max(0, Math.floor(dialogRect.bottom - sourceWrapRect.bottom - menuMargin));
        const spaceAbove = Math.max(0, Math.floor(sourceWrapRect.top - dialogRect.top - menuMargin));
        const shouldOpenUpward = spaceBelow < 180 && spaceAbove > spaceBelow;

        playlistSourceWrap.classList.toggle('opens-upward', shouldOpenUpward);
        const availableMenuHeight = shouldOpenUpward ? spaceAbove : spaceBelow;
        if (availableMenuHeight > 0) {
            playlistSourceMenu.style.maxHeight = `${Math.min(availableMenuHeight, playlistSourceMenuMaxHeightPx)}px`;
        } else {
            playlistSourceMenu.style.maxHeight = '';
        }

        playlistSourceMenu.hidden = false;
        playlistSourceWrap.classList.add('is-open');
        playlistSourceButton.setAttribute('aria-expanded', 'true');
        focusPlaylistSourceOption(playlistSource.value);
    };

    const togglePlaylistSourceMenu = (): void => {
        if (playlistFilterExpanded) {
            return;
        }

        if (playlistSourceMenu.hidden) {
            openPlaylistSourceMenu();
            return;
        }

        closePlaylistSourceMenu(true);
    };

    const handlePlaylistSourceChange = (selectedValue: string): void => {
        if (!setPlaylistSourceSelection(selectedValue)) {
            return;
        }

        clearPlaylistFilter();

        if (selectedValue === 'queue') {
            cancelPendingSourceLoad();
            controllerState.selectedSource = 'queue';
            controllerState.selectedFavoriteIndex = null;
            hydrateCurrentViewTracks();
            renderPlaylist(true);
            return;
        }

        if (selectedValue === 'playlist') {
            cancelPendingSourceLoad();
            controllerState.selectedSource = 'playlist';
            controllerState.selectedFavoriteIndex = null;
            hydrateCurrentViewTracks();
            renderPlaylist(true);
            return;
        }

        if (selectedValue === 'history') {
            const requestId = beginPendingSourceLoad('history', 'Loading listen history…');
            renderPlaylist(true);
            void loadListenHistoryPlaylist(false, requestId).then((loaded) => {
                if (loaded) {
                    return;
                }

                if (!clearPendingSourceLoad(requestId)) {
                    return;
                }

                controllerState.selectedSource = 'queue';
                controllerState.selectedFavoriteIndex = null;
                setPlaylistSourceSelection('queue');
                hydrateCurrentViewTracks();
                renderPlaylist(true);
            }).catch((error) => {
                console.error(error);
                if (!clearPendingSourceLoad(requestId)) {
                    return;
                }
                controllerState.selectedSource = 'queue';
                controllerState.selectedFavoriteIndex = null;
                setPlaylistSourceSelection('queue');
                hydrateCurrentViewTracks();
                renderPlaylist(true);
            });
            return;
        }

        const favoriteMatch = /^favorite:(\d+)$/.exec(selectedValue);
        if (favoriteMatch) {
            const favoriteIndex = Number(favoriteMatch[1]);
            const requestId = beginPendingSourceLoad(selectedValue, 'Loading playlist…');
            renderPlaylist(true);
            void loadFavouritePlaylistByIndex(favoriteIndex, requestId).then((loaded) => {
                if (loaded) {
                    return;
                }

                if (!clearPendingSourceLoad(requestId)) {
                    return;
                }

                controllerState.selectedFavoriteIndex = null;
                controllerState.selectedSource = 'queue';
                setPlaylistSourceSelection('queue');
                hydrateCurrentViewTracks();
                renderPlaylist(true);
            }).catch((error) => {
                console.error(error);
                if (!clearPendingSourceLoad(requestId)) {
                    return;
                }

                controllerState.selectedFavoriteIndex = null;
                controllerState.selectedSource = 'queue';
                setPlaylistSourceSelection('queue');
                hydrateCurrentViewTracks();
                renderPlaylist(true);
            });
        }
    };

    const updateHeaderSourceControl = (): void => {
        rebuildPlaylistSourceControl(getPlaylistSourceControlOptions());
        playlistTitle.hidden = true;
        playlistSourceWrap.hidden = false;

        if (pendingSourceLoadValue !== null) {
            if (setPlaylistSourceSelection(pendingSourceLoadValue)) {
                return;
            }
        }

        if (controllerState.selectedSource === 'playlist' && hasLoadedPlaylist()) {
            if (setPlaylistSourceSelection('playlist')) {
                return;
            }
        }

        if (controllerState.selectedSource === 'history' && controllerState.loadedPlaylistReadOnly) {
            if (setPlaylistSourceSelection('history')) {
                return;
            }
        }

        if (controllerState.selectedFavoriteIndex !== null) {
            const favoriteValue = `favorite:${controllerState.selectedFavoriteIndex}`;
            if (setPlaylistSourceSelection(favoriteValue)) {
                return;
            }
        }

        controllerState.selectedSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        setPlaylistSourceSelection('queue');
    };

    const shouldDisablePlaylistMutationControls = (): boolean => {
        return pendingSourceLoadValue !== null || controllerState.selectedSource === 'queue' || controllerState.selectedSource === 'history';
    };

    const updatePlaylistMutationControlsState = (): void => {
        const controlsDisabled = shouldDisablePlaylistMutationControls();
        playlistAddCurrent.disabled = controlsDisabled;
        playlistAddCurrent.setAttribute('aria-disabled', controlsDisabled ? 'true' : 'false');
        playlistPreventDuplicateCheckbox.disabled = controlsDisabled;
        playlistPreventDuplicateWrap.setAttribute('aria-disabled', controlsDisabled ? 'true' : 'false');
    };

    const closeMenu = (): void => {
        playlistMenu.hidden = true;
    };

    const openMenu = (clientX: number, clientY: number): void => {
        playlistMenu.hidden = false;

        const margin = 10;
        const rect = playlistMenu.getBoundingClientRect();
        const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
        const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

        playlistMenu.style.left = `${Math.max(margin, clampedX)}px`;
        playlistMenu.style.top = `${Math.max(margin, clampedY)}px`;
    };

    const closeModal = (): void => {
        closePlaylistSourceMenu();
        clearPlaylistFilter();
        playlistModal.classList.remove('is-visible');
        cancelHydration();
        finalizeQueueDrag(false);
        clearExternalTrackDropIndicator();

        if (playlistModalHideTimer !== undefined) {
            window.clearTimeout(playlistModalHideTimer);
        }

        playlistModalHideTimer = window.setTimeout(() => {
            playlistModal.hidden = true;
            playlistModalHideTimer = undefined;
        }, playlistModalTransitionMs);

    };

    const prefersReducedMotion = (): boolean => {
        if (typeof window.matchMedia !== 'function') {
            return false;
        }

        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    };

    const animatePlaylistDialogResize = (previousHeight: number): void => {
        if (playlistModal.hidden || prefersReducedMotion()) {
            playlistDialog.style.height = '';
            playlistDialog.classList.remove('is-resizing');
            return;
        }

        const nextHeight = playlistDialog.getBoundingClientRect().height;
        if (!Number.isFinite(previousHeight) || previousHeight <= 0 || Math.abs(nextHeight - previousHeight) < 1) {
            playlistDialog.style.height = '';
            playlistDialog.classList.remove('is-resizing');
            return;
        }

        if (playlistDialogResizeTimer !== undefined) {
            window.clearTimeout(playlistDialogResizeTimer);
            playlistDialogResizeTimer = undefined;
        }

        playlistDialog.classList.add('is-resizing');
        playlistDialog.style.height = `${previousHeight}px`;
        void playlistDialog.offsetHeight;
        playlistDialog.style.height = `${nextHeight}px`;

        playlistDialogResizeTimer = window.setTimeout(() => {
            playlistDialog.style.height = '';
            playlistDialog.classList.remove('is-resizing');
            playlistDialogResizeTimer = undefined;
        }, playlistViewTransitionMs);
    };

    const animatePlaylistViewSwitch = (): void => {
        if (playlistModal.hidden) {
            return;
        }

        if (playlistViewTransitionTimer !== undefined) {
            window.clearTimeout(playlistViewTransitionTimer);
            playlistViewTransitionTimer = undefined;
        }

        playlistList.classList.remove('is-view-switching');
        void playlistList.offsetWidth;
        playlistList.classList.add('is-view-switching');

        playlistViewTransitionTimer = window.setTimeout(() => {
            playlistList.classList.remove('is-view-switching');
            playlistViewTransitionTimer = undefined;
        }, playlistViewTransitionMs);
    };

    const animatePlaylistFilterResults = (): void => {
        if (playlistModal.hidden || prefersReducedMotion()) {
            return;
        }

        if (playlistFilterTransitionTimer !== undefined) {
            window.clearTimeout(playlistFilterTransitionTimer);
            playlistFilterTransitionTimer = undefined;
        }

        playlistList.classList.remove('is-filtering');
        void playlistList.offsetWidth;
        playlistList.classList.add('is-filtering');

        playlistFilterTransitionTimer = window.setTimeout(() => {
            playlistList.classList.remove('is-filtering');
            playlistFilterTransitionTimer = undefined;
        }, playlistFilterTransitionMs);
    };

    const renderPlaylist = (animateViewSwitch = false, animateFilterResults = false): void => {
        if (queueDragState && controllerState.selectedSource === 'queue') {
            deferredRenderDuringQueueDrag = true;
            return;
        }

        const shouldAnimateDialog = animateViewSwitch;
        const previousDialogHeight = shouldAnimateDialog ? playlistDialog.getBoundingClientRect().height : 0;
        if (shouldAnimateDialog) {
            if (playlistDialogResizeTimer !== undefined) {
                window.clearTimeout(playlistDialogResizeTimer);
                playlistDialogResizeTimer = undefined;
            }
            playlistDialog.style.height = '';
            playlistDialog.classList.remove('is-resizing');
        }

        updateHeaderSourceControl();
        updatePlaylistMutationControlsState();

        if (pendingSourceLoadValue !== null) {
            playlistList.innerHTML = `<li class="playlist-item-empty">${pendingSourceLoadMessage || 'Loading playlist…'}</li>`;
            if (animateViewSwitch) {
                animatePlaylistDialogResize(previousDialogHeight);
                animatePlaylistViewSwitch();
            } else if (animateFilterResults) {
                animatePlaylistFilterResults();
            }
            return;
        }

        const { indexes, currentPosition } = currentSequence();
        const currentTrackIndex = options.getCurrentTrackIndex();
        const activePosition = currentPosition >= 0
            && currentPosition < indexes.length
            && indexes[currentPosition] === currentTrackIndex
            ? currentPosition
            : indexes.indexOf(currentTrackIndex);
        const anchorPosition = activePosition >= 0 ? activePosition : currentPosition;
        const viewingPlaylist = controllerState.selectedSource !== 'queue' && hasLoadedPlaylist();
        const playlistVisibleWindow = viewingPlaylist ? getPlaylistVisibleWindow(indexes) : null;
        const start = viewingPlaylist
            ? (playlistVisibleWindow?.start || 0)
            : Math.max(0, anchorPosition - queueVisiblePreviousCount);
        const end = viewingPlaylist
            ? (playlistVisibleWindow?.end || 0)
            : Math.min(indexes.length, anchorPosition + queueVisibleAheadCount + 1);
        const cachedItemsByTrackIndex = cachedPlaylistItemsByTrackIndex();
        const filterTerms = playlistFilterTerms();
        const usePlaylistWindowSpacers = viewingPlaylist && filterTerms.length === 0;

        let visibleRows: RenderablePlaylistRow[];
        if (viewingPlaylist) {
            requestTrackMetadataHydration(playlistHydrationWindow(indexes));
        }

        if (usePlaylistWindowSpacers) {
            visibleRows = indexes.slice(start, end).map((trackIndex, offset) => ({
                actualPosition: start + offset,
                trackIndex,
            }));
        } else if (viewingPlaylist || filterTerms.length > 0) {
            if (!viewingPlaylist) {
                const hydrationEnd = Math.min(indexes.length, end + queueHydrationLookahead);
                requestTrackMetadataHydration(indexes.slice(start, hydrationEnd));
            }

            const nextVisibleRows: RenderablePlaylistRow[] = [];
            for (let position = 0; position < indexes.length; position += 1) {
                const trackIndex = indexes[position];
                if (!matchesPlaylistFilter(trackIndex, cachedItemsByTrackIndex, filterTerms)) {
                    continue;
                }

                nextVisibleRows.push({
                    actualPosition: position,
                    trackIndex,
                });
            }

            visibleRows = nextVisibleRows;
        } else {
            const hydrationStart = Math.max(0, start - queueHydrationLookbehind);
            const hydrationEnd = Math.min(indexes.length, end + queueHydrationLookahead);
            requestTrackMetadataHydration(indexes.slice(hydrationStart, hydrationEnd));

            const nextVisibleRows: RenderablePlaylistRow[] = [];
            for (let position = start; position < indexes.length && nextVisibleRows.length < end - start; position += 1) {
                const trackIndex = indexes[position];
                nextVisibleRows.push({
                    actualPosition: position,
                    trackIndex,
                });
            }

            visibleRows = nextVisibleRows;
        }

        if (visibleRows.length === 0) {
            const emptyMessage = filterTerms.length > 0
                ? 'No matching tracks'
                : !viewingPlaylist && indexes.length > 0
                ? 'Loading queue metadata…'
                : 'No tracks available';
            playlistList.innerHTML = `<li class="playlist-item-empty">${emptyMessage}</li>`;
            if (animateViewSwitch) {
                animatePlaylistDialogResize(previousDialogHeight);
                animatePlaylistViewSwitch();
            } else if (animateFilterResults) {
                animatePlaylistFilterResults();
            }
            return;
        }

        const rows = visibleRows.map(({ trackIndex, actualPosition }) => {
            const activeClass = trackIndex === currentTrackIndex ? ' is-active' : '';
            const isActiveTrack = trackIndex === currentTrackIndex;
            const disableQueueDragHandle = controllerState.selectedSource === 'queue' && isActiveTrack;
            const prefix = isActiveTrack
                ? playlistPrefixIcon('active')
                : (activePosition >= 0 && actualPosition < activePosition ? playlistPrefixIcon('before') : playlistPrefixIcon('after'));
            const { label, secondary } = getPlaylistRowLabels(trackIndex, cachedItemsByTrackIndex);

            if (isViewingReadOnlyPlaylist()) {
                const historyItem = controllerState.loadedPlaylistHistoryItems?.[actualPosition];
                const metaLabel = formatListenHistoryMeta(historyItem);
                return `<li class="playlist-row playlist-row-read-only" data-playlist-position="${actualPosition}">
            <span class="playlist-position-indicator">#${actualPosition + 1}</span>
            <button class="playlist-item${activeClass}" data-playlist-track-index="${trackIndex}" data-playlist-position="${actualPosition}"><span class="playlist-item-topline"><span class="playlist-item-main"><span class="playlist-item-prefix">${prefix}</span><span class="playlist-item-label">${label}</span></span>${metaLabel ? `<span class="playlist-item-meta">${metaLabel}</span>` : ''}</span><span class="playlist-item-sub">${secondary}</span></button>
        </li>`;
            }

            return `<li class="playlist-row" data-playlist-position="${actualPosition}">
            <button class="playlist-drag-handle" type="button" ${disableQueueDragHandle ? 'disabled aria-disabled="true" title="Cannot move the currently playing track"' : 'title="Drag to reorder"'} aria-label="${disableQueueDragHandle ? 'Currently playing track cannot be reordered' : 'Drag track'}">${playlistDragIcon}</button>
            <span class="playlist-position-indicator">#${actualPosition + 1}</span>
            <button class="playlist-item${activeClass}" data-playlist-track-index="${trackIndex}" data-playlist-position="${actualPosition}"><span class="playlist-item-main"><span class="playlist-item-prefix">${prefix}</span><span class="playlist-item-label">${label}</span></span><span class="playlist-item-sub">${secondary}</span></button>
            <button class="playlist-remove" type="button" data-playlist-remove-position="${actualPosition}" aria-label="Remove track" title="Remove track">${playlistRemoveIcon}</button>
        </li>`;
        }).join('');

        const topSpacerMarkup = usePlaylistWindowSpacers && (playlistVisibleWindow?.topSpacerHeight || 0) > 0
            ? `<li class="playlist-window-spacer" aria-hidden="true" style="height: ${playlistVisibleWindow?.topSpacerHeight || 0}px"></li>`
            : '';
        const bottomSpacerMarkup = usePlaylistWindowSpacers && (playlistVisibleWindow?.bottomSpacerHeight || 0) > 0
            ? `<li class="playlist-window-spacer" aria-hidden="true" style="height: ${playlistVisibleWindow?.bottomSpacerHeight || 0}px"></li>`
            : '';

        playlistList.innerHTML = `${topSpacerMarkup}${rows}${bottomSpacerMarkup}`;
        syncExternalTrackDropIndicatorClasses();
        if (animateViewSwitch) {
            animatePlaylistDialogResize(previousDialogHeight);
            animatePlaylistViewSwitch();
        } else if (animateFilterResults) {
            animatePlaylistFilterResults();
        }
    };

    const scheduleRender = (() => {
        let scheduled = false;

        return (): void => {
            if (queueDragState && controllerState.selectedSource === 'queue') {
                deferredRenderDuringQueueDrag = true;
                return;
            }

            if (scheduled) {
                return;
            }

            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                if (!playlistModal.hidden) {
                    renderPlaylist();
                }
            });
        };
    })();

    const hydrateTrackMetadataInBackground = (trackIndexes: number[]): void => {
        if (!backgroundHydrationEnabled && controllerState.selectedSource !== 'queue') {
            resetHydrationRequestState();
            return;
        }

        if (playlistModal.hidden) {
            resetHydrationRequestState();
            return;
        }

        const runId = ++hydrationRunId;
        const scopedTrackIndexes = Array.from(new Set(trackIndexes)).filter((index) => {
            if (index < 0 || index >= options.getTrackCount()) {
                return false;
            }

            return true;
        });

        const cachedItemsByTrackIndex = cachedPlaylistItemsByTrackIndex();
        const resolvedIndexesMissingCache = scopedTrackIndexes.filter((index) => {
            const track = options.getTrack(index);
            return !!track?.tagsResolved && !hasCachedPlaylistLabels(cachedItemsByTrackIndex.get(index));
        });
        const resolvedIndexesForCache = resolvedIndexesMissingCache.slice();

        const pending = scopedTrackIndexes.filter((index) => {
            return !options.getTrack(index)?.tagsResolved && !hasCachedPlaylistLabels(cachedItemsByTrackIndex.get(index));
        });

        const totalTracks = scopedTrackIndexes.length;
        const alreadyResolved = totalTracks - pending.length;

        if (pending.length === 0) {
            if (resolvedIndexesForCache.length > 0) {
                void persistPlaylistTrackMetadataCache(resolvedIndexesForCache).catch((error) => {
                    console.error(error);
                });
            }
            setHydrationProgress(0, 0);
            return;
        }

        setHydrationProgress(alreadyResolved, totalTracks);

        const workerCount = Math.min(playlistHydrationWorkerCount, pending.length);
        const batchSize = playlistHydrationBatchSize;
        let cursor = 0;
        let completed = alreadyResolved;

        const worker = async (): Promise<void> => {
            while (true) {
                if (runId !== hydrationRunId || playlistModal.hidden) {
                    return;
                }

                const nextCursor = cursor;
                cursor += batchSize;
                if (nextCursor >= pending.length) {
                    return;
                }

                const batch = pending.slice(nextCursor, Math.min(nextCursor + batchSize, pending.length));
                await options.ensureTrackTagsResolvedBatch(batch);
                if (runId !== hydrationRunId || playlistModal.hidden) {
                    return;
                }

                resolvedIndexesForCache.push(...batch);

                const playbackStateChanged = pruneHydratedSilenceTracksFromPlaybackState(batch);

                completed += batch.length;
                setHydrationProgress(completed, totalTracks);

                if (playbackStateChanged) {
                    renderPlaylist(true);
                    continue;
                }

                if (controllerState.selectedSource !== 'queue' && hasLoadedPlaylist()) {
                    refreshRenderedPlaylistRows(batch);
                    continue;
                }

                scheduleRender();
            }
        };

        for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
            void worker().then(async () => {
                if (workerIndex !== 0) {
                    return;
                }

                if (runId !== hydrationRunId || playlistModal.hidden || resolvedIndexesForCache.length === 0) {
                    return;
                }

                await persistPlaylistTrackMetadataCache(resolvedIndexesForCache);
            }).catch((error) => {
                console.error(error);
            });
        }
    };

    const hydrateCurrentViewTracks = (): void => {
        const { indexes, currentPosition } = currentSequence();
        const viewingPlaylist = controllerState.selectedSource !== 'queue' && hasLoadedPlaylist();
        if (viewingPlaylist) {
            requestTrackMetadataHydration(playlistHydrationWindow(indexes));
            return;
        }

        const start = Math.max(0, currentPosition - queueVisiblePreviousCount - queueHydrationLookbehind);
        const end = Math.min(indexes.length, currentPosition + queueVisibleAheadCount + 1 + queueHydrationLookahead);
        requestTrackMetadataHydration(indexes.slice(start, end));
    };

    const openModal = (): void => {
        if (playlistModalHideTimer !== undefined) {
            window.clearTimeout(playlistModalHideTimer);
            playlistModalHideTimer = undefined;
        }

        if (controllerState.selectedSource === 'history' && options.hasListenHistoryPlaylist()) {
            void loadListenHistoryPlaylist(false).catch((error) => {
                console.error(error);
            });
        }

        playlistModal.hidden = false;
        hydrateCurrentViewTracks();
        renderPlaylist();
        window.requestAnimationFrame(() => {
            playlistModal.classList.add('is-visible');
        });
    };

    const refreshOpenModal = (): void => {
        if (playlistModal.hidden) {
            return;
        }

        hydrateCurrentViewTracks();
        renderPlaylist(true);
    };

    const mutableCurrentSequence = (): number[] => {
        if (isViewingReadOnlyPlaylist()) {
            return mutableQueueSequence();
        }

        if (controllerState.selectedSource === 'playlist' && controllerState.loadedPlaylistTrackIndexes) {
            return controllerState.loadedPlaylistTrackIndexes;
        }

        return mutableQueueSequence();
    };

    const mutableQueueSequence = (): number[] => {
        if (controllerState.editableQueueTrackIndexes) {
            return controllerState.editableQueueTrackIndexes;
        }

        const sequence = queueSequence();
        return setEditableQueueState(sequence.indexes.slice(), sequence.currentPosition);
    };

    const insertTrackIndexes = (queue: number[], insertAt: number, trackIndexes: number[]): void => {
        let offset = 0;
        while (offset < trackIndexes.length) {
            const chunk = trackIndexes.slice(offset, offset + queueMutationChunkSize);
            queue.splice(insertAt + offset, 0, ...chunk);
            offset += chunk.length;
        }
    };

    const appendTrackIndexes = (queue: number[], trackIndexes: number[]): void => {
        let offset = 0;
        while (offset < trackIndexes.length) {
            const chunk = trackIndexes.slice(offset, offset + queueMutationChunkSize);
            queue.push(...chunk);
            offset += chunk.length;
        }
    };

    const replaceTrackIndexes = (queue: number[], trackIndexes: number[]): void => {
        queue.length = 0;
        appendTrackIndexes(queue, trackIndexes);
    };

    const shouldAutoSaveLoadedPlaylistMutations = (): boolean => (
        options.shouldAutoSavePlaylistsOnAddRemove?.() === true
        && controllerState.selectedSource === 'playlist'
        && controllerState.loadedPlaylistReadOnly === false
        && controllerState.loadedPlaylistPath.trim() !== ''
        && !!controllerState.loadedPlaylistTrackIndexes
    );

    const persistLoadedPlaylistSequenceIfEnabled = async (trackIndexes: number[]): Promise<boolean> => {
        if (!shouldAutoSaveLoadedPlaylistMutations()) {
            return true;
        }

        const trackPaths = trackIndexes.map((trackIndex) => options.getTrackPath(trackIndex).trim());
        if (trackPaths.some((trackPath) => trackPath === '')) {
            return false;
        }

        return await options.savePlaylistData(controllerState.loadedPlaylistPath, trackPaths);
    };

    const appendTracksToPlaylist = async (playlistPath: string, trackIndexes: number[]): Promise<boolean> => {
        const cleanPlaylistPath = playlistPath.trim();
        if (cleanPlaylistPath === '') {
            return false;
        }

        const normalizedTrackIndexes = normalizeQueueEligibleTrackIndexes(trackIndexes);
        if (normalizedTrackIndexes.length === 0) {
            return false;
        }

        const validTracks = normalizedTrackIndexes
            .map((trackIndex) => ({
                trackIndex,
                trackPath: options.getTrackPath(trackIndex).trim(),
            }))
            .filter(({ trackPath }) => trackPath !== '');
        if (validTracks.length === 0) {
            return false;
        }

        const validTrackIndexes = validTracks.map(({ trackIndex }) => trackIndex);
        const trackPaths = validTracks.map(({ trackPath }) => trackPath);

        const appended = await options.appendTracksToPlaylistData(cleanPlaylistPath, trackPaths);
        if (!appended) {
            return false;
        }

        if (normalizePlaylistPath(controllerState.loadedPlaylistPath) === normalizePlaylistPath(cleanPlaylistPath)) {
            if (!controllerState.loadedPlaylistTrackIndexes) {
                controllerState.loadedPlaylistTrackIndexes = [];
            }

            appendTrackIndexes(controllerState.loadedPlaylistTrackIndexes, validTrackIndexes);
            if (!controllerState.loadedPlaylistName.trim()) {
                controllerState.loadedPlaylistName = playlistTargetLabel(cleanPlaylistPath);
            }

            hydrateTrackMetadataInBackground(validTrackIndexes);
            updateHeaderSourceControl();
            scheduleRender();
        }

        return true;
    };

    const isTrackAlreadyInLoadedPlaylist = (playlistPath: string, trackIndex: number): boolean => {
        const cleanPlaylistPath = playlistPath.trim();
        if (cleanPlaylistPath === '') {
            return false;
        }

        if (!Number.isInteger(trackIndex) || trackIndex < 0 || !controllerState.loadedPlaylistTrackIndexes) {
            return false;
        }

        if (normalizePlaylistPath(controllerState.loadedPlaylistPath) !== normalizePlaylistPath(cleanPlaylistPath)) {
            return false;
        }

        return controllerState.loadedPlaylistTrackIndexes.includes(trackIndex);
    };

    const enqueueTracks = (trackIndexes: number[], placement: 'next' | 'end'): void => {
        const normalizedTrackIndexes = normalizeQueueEligibleTrackIndexes(trackIndexes);

        if (normalizedTrackIndexes.length === 0) {
            return;
        }

        const queue = mutableQueueSequence();
        if (placement === 'next') {
            const currentPosition = resolveEditableQueueCurrentPosition(queue);
            const insertAt = currentPosition >= 0 ? currentPosition + 1 : 0;
            insertTrackIndexes(queue, insertAt, normalizedTrackIndexes);
        } else {
            appendTrackIndexes(queue, normalizedTrackIndexes);
        }

        controllerState.playbackSource = 'queue';
        hydrateTrackMetadataInBackground(normalizedTrackIndexes);
        scheduleRender();
        notifyPlaybackQueueMutated();
    };

    const replacePlaybackQueue = (trackIndexes: number[], currentPosition = 0): void => {
        const normalizedTrackIndexes = normalizeQueueEligibleTrackIndexes(trackIndexes);
        const previousQueue = controllerState.editableQueueTrackIndexes?.slice() || null;
        const previousPosition = controllerState.editableQueueCurrentPosition;
        const previousPlaybackSource = controllerState.playbackSource;

        controllerState.playbackSource = 'queue';
        setEditableQueueState(normalizedTrackIndexes.slice(), currentPosition);
        if (normalizedTrackIndexes.length > 0) {
            hydrateTrackMetadataInBackground(normalizedTrackIndexes);
        }

        scheduleRender();

        const nextQueue = controllerState.editableQueueTrackIndexes || [];
        const nextPosition = controllerState.editableQueueCurrentPosition;
        if (
            previousPlaybackSource !== 'queue'
            || !queueIndexesEqual(previousQueue, nextQueue)
            || previousPosition !== nextPosition
        ) {
            notifyPlaybackQueueMutated();
        }
    };

    const insertTrackIndexesIntoCurrentView = async (trackIndexes: number[], insertAt: number): Promise<boolean> => {
        if (isViewingReadOnlyPlaylist()) {
            return false;
        }

        const normalizedTrackIndexes = normalizeQueueEligibleTrackIndexes(trackIndexes);
        if (normalizedTrackIndexes.length === 0) {
            return false;
        }

        const activeQueue = mutableCurrentSequence();
        const queueMutated = activeQueue === controllerState.editableQueueTrackIndexes;
        const previousQueue = activeQueue.slice();
        const boundedInsertAt = Math.min(Math.max(insertAt, 0), activeQueue.length);

        insertTrackIndexes(activeQueue, boundedInsertAt, normalizedTrackIndexes);
        if (!(await persistLoadedPlaylistSequenceIfEnabled(activeQueue))) {
            replaceTrackIndexes(activeQueue, previousQueue);
            options.openErrorModal(
                'Playlist save failed',
                'Silphium could not save the playlist after adding dropped tracks, so the change was reverted.',
            );
            renderPlaylist(true);
            return false;
        }

        hydrateTrackMetadataInBackground(normalizedTrackIndexes);
        renderPlaylist(true);
        if (queueMutated) {
            notifyPlaybackQueueMutated();
        }

        return true;
    };

    const resolveExternalTrackDropTargetFromElement = (dropTarget: Element | null, clientY: number): ExternalTrackDropIndicator | null => {
        if (!(dropTarget instanceof Element) || !playlistList.contains(dropTarget)) {
            return null;
        }

        const row = dropTarget.closest('.playlist-row');
        if (!(row instanceof HTMLElement) || !playlistList.contains(row)) {
            const sequenceLength = controllerState.selectedSource === 'playlist' && controllerState.loadedPlaylistTrackIndexes
                ? controllerState.loadedPlaylistTrackIndexes.length
                : controllerState.editableQueueTrackIndexes
                ? controllerState.editableQueueTrackIndexes.length
                : currentSequence().indexes.length;
            const lastRow = getLastPlaylistRow();
            const lastRowPosition = lastRow ? Number(lastRow.dataset.playlistPosition) : NaN;
            return {
                insertAt: sequenceLength,
                rowPosition: Number.isInteger(lastRowPosition) ? lastRowPosition : null,
                edge: 'after',
            };
        }

        const rowPosition = Number(row.dataset.playlistPosition);
        if (!Number.isInteger(rowPosition)) {
            const sequenceLength = controllerState.selectedSource === 'playlist' && controllerState.loadedPlaylistTrackIndexes
                ? controllerState.loadedPlaylistTrackIndexes.length
                : controllerState.editableQueueTrackIndexes
                ? controllerState.editableQueueTrackIndexes.length
                : currentSequence().indexes.length;
            return {
                insertAt: sequenceLength,
                rowPosition: null,
                edge: 'after',
            };
        }

        const rowRect = row.getBoundingClientRect();
        if (rowRect.height <= 0) {
            return {
                insertAt: rowPosition,
                rowPosition,
                edge: 'before',
            };
        }

        const insertAfterRow = clientY >= rowRect.top + (rowRect.height / 2);
        return {
            insertAt: rowPosition + (insertAfterRow ? 1 : 0),
            rowPosition,
            edge: insertAfterRow ? 'after' : 'before',
        };
    };

    const resolveExternalTrackDropTarget = (clientX: number, clientY: number): ExternalTrackDropIndicator | null => {
        if (playlistModal.hidden) {
            return null;
        }

        const ownerDocument = playlistList.ownerDocument;
        if (typeof ownerDocument.elementFromPoint !== 'function') {
            return null;
        }

        const dropTarget = ownerDocument.elementFromPoint(clientX, clientY);
        return resolveExternalTrackDropTargetFromElement(dropTarget, clientY);
    };

    const updateExternalTrackDropIndicatorFromTarget = (dropTarget: Element | null, clientY: number): void => {
        const nextIndicator = resolveExternalTrackDropTargetFromElement(dropTarget, clientY);
        if (!nextIndicator) {
            clearExternalTrackDropIndicator();
            return;
        }

        if (
            externalTrackDropIndicator
            && externalTrackDropIndicator.insertAt === nextIndicator.insertAt
            && externalTrackDropIndicator.rowPosition === nextIndicator.rowPosition
            && externalTrackDropIndicator.edge === nextIndicator.edge
        ) {
            return;
        }

        externalTrackDropIndicator = nextIndicator;
        syncExternalTrackDropIndicatorClasses();
    };

    const resolveExternalTrackDropInsertPosition = (clientX: number, clientY: number): number | null => {
        const indicator = resolveExternalTrackDropTarget(clientX, clientY);
        return indicator?.insertAt ?? null;
    };

    const handleExternalTrackDrop = async (clientX: number, clientY: number, trackIndexes: number[]): Promise<boolean> => {
        clearExternalTrackDropIndicator();
        const insertAt = resolveExternalTrackDropInsertPosition(clientX, clientY);
        if (insertAt === null) {
            return false;
        }

        return await insertTrackIndexesIntoCurrentView(trackIndexes, insertAt);
    };

    const resolveNextTrackIndex = (direction: PlaylistDirection, mutateState: boolean): number | undefined => {
        const currentTrackIndex = options.getCurrentTrackIndex();

        if (controllerState.playbackSource === 'playlist') {
            const playbackSource = loadedPlaylistPlaybackSequenceSource();
            if (playbackSource) {
                if (options.playbackSequencingService) {
                    return mutateState
                        ? options.playbackSequencingService.nextTrackIndexForDirection(direction, playbackSource)
                        : options.playbackSequencingService.peekNextTrackIndexForDirection(direction, playbackSource);
                }

                const playlistSequence = loadedPlaylistSequence();
                if (playlistSequence) {
                    const { indexes } = playlistSequence;
                    const currentPosition = indexes.indexOf(currentTrackIndex);
                    if (currentPosition < 0) {
                        return indexes[0];
                    }

                    const nextPosition = (currentPosition + direction + indexes.length) % indexes.length;
                    return indexes[nextPosition];
                }
            }
        }

        const queue = queueSequence();
        const queueIndexes = queue.indexes;
        if ((controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length > 0) || hasLoadedPlaylist()) {
            const currentPosition = queue.currentPosition;
            if (currentPosition < 0 || currentPosition >= queueIndexes.length) {
                return queueIndexes[0];
            }

            if (direction > 0 && controllerState.editableQueueTrackIndexes && currentPosition >= queueIndexes.length - 1) {
                if (isShuffleQueuePlayback()) {
                    const nextQueue = options.getBaseSequence();
                    const nextPosition = nextQueue.currentPosition + 1;
                    if (nextPosition < nextQueue.indexes.length) {
                        if (mutateState) {
                            const queueChanged = redrawPlaybackQueueFromBaseSequence(nextPosition);
                            scheduleRender();
                            if (queueChanged) {
                                notifyPlaybackQueueMutated();
                            }
                        }

                        return nextQueue.indexes[nextPosition];
                    }
                }

	            if (!mutateState) {
	                return undefined;
	            }

                clearEditableQueueState();
                scheduleRender();
                return undefined;
            }

            const nextPosition = (currentPosition + direction + queueIndexes.length) % queueIndexes.length;
            if (mutateState && controllerState.editableQueueTrackIndexes) {
                controllerState.editableQueueCurrentPosition = nextPosition;
            }
            return queueIndexes[nextPosition];
        }

        return undefined;
    };

    const getNextTrackIndex = (direction: PlaylistDirection): number | undefined => {
        return resolveNextTrackIndex(direction, true);
    };

    const peekNextTrackIndex = (direction: PlaylistDirection): number | undefined => {
        return resolveNextTrackIndex(direction, false);
    };

    const clearEditableQueue = (): void => {
        clearEditableQueueState();
        scheduleRender();
    };

    const redrawPlaybackQueueFollowingCurrent = (): void => {
        if (!options.playbackSequencingService) {
            return;
        }

        if (!controllerState.editableQueueTrackIndexes || controllerState.editableQueueTrackIndexes.length === 0) {
            if (controllerState.playbackSource !== 'queue') {
                return;
            }

	        const queueChanged = redrawPlaybackQueueFromBaseSequence();

            scheduleRender();
            if (queueChanged) {
                notifyPlaybackQueueMutated();
            }
            return;
        }

        const queueIndexes = controllerState.editableQueueTrackIndexes.slice();
        const currentPosition = resolveEditableQueueCurrentPosition(queueIndexes);
        if (currentPosition < 0 || currentPosition >= queueIndexes.length) {
            return;
        }

        const prefix = queueIndexes.slice(0, currentPosition);
        const redrawTail = queueIndexes.slice(currentPosition);
        const redrawSource = {
            key: 'queue::editable',
            indexes: redrawTail,
        };
        const redrawnSequence = options.playbackSequencingService.baseSequenceIndexes(redrawSource);
        if (redrawnSequence.indexes.length === 0) {
            return;
        }

        const limitedRedrawIndexes = isShuffleQueuePlayback()
            ? limitQueueIndexesToSourceOccurrences(redrawnSequence.indexes, redrawTail)
            : redrawnSequence.indexes;
        const limitedCurrentPosition = Math.min(
            redrawnSequence.currentPosition,
            Math.max(0, limitedRedrawIndexes.length - 1),
        );
        if (limitedRedrawIndexes.length === 0) {
            return;
        }

        const nextQueueIndexes = prefix.concat(limitedRedrawIndexes);
        const queueChanged = nextQueueIndexes.length !== queueIndexes.length
            || nextQueueIndexes.some((trackIndex, position) => trackIndex !== queueIndexes[position]);

        controllerState.playbackSource = 'queue';
        setEditableQueueState(nextQueueIndexes, prefix.length + limitedCurrentPosition);
        scheduleRender();
        if (queueChanged) {
            notifyPlaybackQueueMutated();
        }
    };

    const activatePlaybackQueueSource = (): void => {
        controllerState.playbackSource = 'queue';
        clearEditableQueueState();
        scheduleRender();
    };

    const resetState = (): void => {
        cancelPendingSourceLoad();
        controllerState.loadedPlaylistTrackIndexes = null;
        controllerState.loadedPlaylistName = '';
        controllerState.loadedPlaylistPath = '';
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = null;
        clearEditableQueueState();
        controllerState.selectedSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        controllerState.playbackSource = 'queue';
        cancelHydration();
        finalizeQueueDrag(false);
        clearPlaylistFilter();
        scheduleRender();
    };

    const loadSelectedPlaylist = async (): Promise<void> => {
        closeMenu();

        try {
            const selectedPath = await options.selectPlaylistFile();
            if (!selectedPath) {
                return;
            }

            await loadPlaylistByPath(selectedPath);
        } catch (error) {
            console.error(error);
        }
    };

    const addCurrentTrackToEnd = async (): Promise<void> => {
        if (shouldDisablePlaylistMutationControls()) {
            return;
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        if (!isQueueEligibleTrackIndex(currentTrackIndex)) {
            return;
        }

        const activeQueue = mutableCurrentSequence();
        const queueMutated = activeQueue === controllerState.editableQueueTrackIndexes;
        const previousQueue = activeQueue.slice();
        if (playlistPreventDuplicateCheckbox.checked && activeQueue.includes(currentTrackIndex)) {
            options.openErrorModal(
                'Track already in playlist',
                'The current track is already in the active playlist. Disable duplicate prevention to add it again.',
            );
            return;
        }

        activeQueue.push(currentTrackIndex);
        if (!(await persistLoadedPlaylistSequenceIfEnabled(activeQueue))) {
            replaceTrackIndexes(activeQueue, previousQueue);
            options.openErrorModal(
                'Playlist save failed',
                'Silphium could not save the playlist after adding a track, so the change was reverted.',
            );
            renderPlaylist(true);
            return;
        }

        hydrateTrackMetadataInBackground([currentTrackIndex]);
        renderPlaylist(true);
        if (queueMutated) {
            notifyPlaybackQueueMutated();
        }
    };

    const saveCurrentSequenceAsPlaylist = async (): Promise<void> => {
        const selectedPath = await options.selectPlaylistSaveFile();
        if (!selectedPath) {
            return;
        }

        const trackPaths = currentSequence().indexes
            .map((trackIndex) => options.getTrackPath(trackIndex))
            .filter((path) => path !== '');

        if (trackPaths.length === 0) {
            return;
        }

        const saved = await options.savePlaylistData(selectedPath, trackPaths);
        if (!saved) {
            return;
        }

        controllerState.loadedPlaylistName = selectedPath.split(/[\\/]/).pop() || selectedPath;
        controllerState.loadedPlaylistPath = selectedPath;
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = null;
        controllerState.selectedFavoriteIndex = null;
        updateHeaderSourceControl();
    };

    const createNewPlaylist = async (): Promise<void> => {
        const selectedPath = await options.selectPlaylistSaveFile();
        if (!selectedPath) {
            return;
        }

        const saved = await options.savePlaylistData(selectedPath, []);
        if (!saved) {
            return;
        }

        controllerState.loadedPlaylistName = selectedPath.split(/[\\/]/).pop() || selectedPath;
        controllerState.loadedPlaylistPath = selectedPath;
        controllerState.loadedPlaylistTrackIndexes = [];
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = null;
        cancelPendingSourceLoad();
        controllerState.selectedSource = 'playlist';
        controllerState.playbackSource = 'queue';
        clearEditableQueueState();
        controllerState.selectedFavoriteIndex = null;
        clearPlaylistFilter();
        playlistList.scrollTop = 0;
        resetHydrationRequestState();
        renderPlaylist(true);
    };

    const loadFavouritePlaylist = async (playlistPath: string, sourceLoadRequestId?: number): Promise<boolean> => {
        if (!playlistPath) {
            return false;
        }

        const loadedPlaylist = await options.loadPlaylistData(playlistPath);
        if (!loadedPlaylist) {
            return false;
        }

        if (sourceLoadRequestId !== undefined && !isPendingSourceLoadCurrent(sourceLoadRequestId)) {
            return false;
        }

        clearPendingSourceLoad(sourceLoadRequestId);

        const sanitizedPlaylist = sanitizeLoadedPlaylistData(loadedPlaylist);

        controllerState.loadedPlaylistTrackIndexes = sanitizedPlaylist.trackIndexes;
        controllerState.loadedPlaylistName = sanitizedPlaylist.name || '';
        controllerState.loadedPlaylistPath = playlistPath;
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = sanitizedPlaylist.cachedItems || null;
        controllerState.selectedSource = 'playlist';
        controllerState.playbackSource = 'queue';
        finalizeQueueDrag(false);
        clearPlaylistFilter();
        playlistList.scrollTop = 0;
        resetHydrationRequestState();
        hydrateCurrentViewTracks();
        renderPlaylist(true);
        return true;
    };

    const openPlaylistTarget = async (): Promise<PlaylistTargetOption | null> => {
        const selectedPath = await options.selectPlaylistFile();
        if (!selectedPath) {
            return null;
        }

        const normalizedPath = selectedPath.trim();
        if (!normalizedPath) {
            return null;
        }

        const loadedPlaylist = await options.loadPlaylistData(normalizedPath);
        if (!loadedPlaylist) {
            return null;
        }

        const sanitizedPlaylist = sanitizeLoadedPlaylistData(loadedPlaylist);

        controllerState.loadedPlaylistTrackIndexes = sanitizedPlaylist.trackIndexes;
        controllerState.loadedPlaylistName = sanitizedPlaylist.name || '';
        controllerState.loadedPlaylistPath = normalizedPath;
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = sanitizedPlaylist.cachedItems || null;
        controllerState.selectedFavoriteIndex = null;
        clearPlaylistFilter();
        playlistList.scrollTop = 0;
        resetHydrationRequestState();
        updateHeaderSourceControl();
        scheduleRender();

        return {
            path: normalizedPath,
            label: playlistTargetLabel(normalizedPath, controllerState.loadedPlaylistName),
        };
    };

    const createPlaylistTarget = async (): Promise<PlaylistTargetOption | null> => {
        await createNewPlaylist();
        if (!controllerState.loadedPlaylistPath) {
            return null;
        }

        return {
            path: controllerState.loadedPlaylistPath,
            label: playlistTargetLabel(controllerState.loadedPlaylistPath, controllerState.loadedPlaylistName),
        };
    };

    const commitPlaybackSourceFromCurrentView = (): void => {
        if (controllerState.selectedSource !== 'queue' && hasLoadedPlaylist()) {
            controllerState.playbackSource = 'playlist';
            return;
        }

        controllerState.playbackSource = 'queue';
    };

    const loadFavouritePlaylistByIndex = async (favoriteIndex: number, sourceLoadRequestId?: number): Promise<boolean> => {
        const favoritePlaylists = options.getFavoritePlaylists().filter((playlistPath) => playlistPath.trim() !== '');
        if (!Number.isInteger(favoriteIndex) || favoriteIndex < 0 || favoriteIndex >= favoritePlaylists.length) {
            return false;
        }

        controllerState.selectedFavoriteIndex = favoriteIndex;
        const loaded = await loadFavouritePlaylist(favoritePlaylists[favoriteIndex], sourceLoadRequestId);
        if (!loaded) {
            return false;
        }

        updateHeaderSourceControl();
        const favoriteValue = `favorite:${favoriteIndex}`;
        setPlaylistSourceSelection(favoriteValue);
        return true;
    };

    syncPlaylistFilterUi();

    trigger.addEventListener('click', () => {
        openModal();
    });

    trigger.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMenu(event.clientX, event.clientY);
    });

    playlistSource.addEventListener('change', () => {
        handlePlaylistSourceChange(playlistSource.value);
    });

    playlistSourceButton.addEventListener('click', () => {
        togglePlaylistSourceMenu();
    });

    playlistSourceButton.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openPlaylistSourceMenu();
            return;
        }

        if (event.key === 'Escape' && !playlistSourceMenu.hidden) {
            event.preventDefault();
            closePlaylistSourceMenu(true);
        }
    });

    playlistSourceMenu.addEventListener('click', (event) => {
        const optionButton = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('.playlist-source-option');
        if (!optionButton) {
            return;
        }

        const { value } = optionButton.dataset;
        if (!value) {
            return;
        }

        closePlaylistSourceMenu();
        handlePlaylistSourceChange(value);
    });

    playlistSourceMenu.addEventListener('keydown', (event) => {
        const optionButtons = Array.from(playlistSourceMenu.querySelectorAll<HTMLButtonElement>('.playlist-source-option'));
        if (optionButtons.length === 0) {
            return;
        }

        const activeElement = document.activeElement as HTMLButtonElement | null;
        const currentIndex = activeElement ? optionButtons.indexOf(activeElement) : -1;

        if (event.key === 'Escape') {
            event.preventDefault();
            closePlaylistSourceMenu(true);
            return;
        }

        if (event.key === 'Tab') {
            closePlaylistSourceMenu();
            return;
        }

        if (event.key === 'Home') {
            event.preventDefault();
            optionButtons[0]?.focus();
            return;
        }

        if (event.key === 'End') {
            event.preventDefault();
            optionButtons[optionButtons.length - 1]?.focus();
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            const nextIndex = currentIndex >= 0 ? Math.min(optionButtons.length - 1, currentIndex + 1) : 0;
            optionButtons[nextIndex]?.focus();
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            const nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : optionButtons.length - 1;
            optionButtons[nextIndex]?.focus();
            return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activeElement?.click();
        }
    });

    playlistFilterToggle.addEventListener('click', () => {
        if (playlistFilterExpanded) {
            const hadActiveQuery = hasPlaylistFilterText();
            clearPlaylistFilter();
            if (hadActiveQuery) {
                renderPlaylist(false, true);
            }
            playlistFilterToggle.focus();
            return;
        }

        closePlaylistSourceMenu();
        setPlaylistFilterExpanded(true, true);
    });

    playlistFilterInput.addEventListener('input', () => {
        cancelPendingPlaylistFilterUpdate();
        const nextFilterQuery = playlistFilterInput.value;
        playlistFilterDebounceTimer = window.setTimeout(() => {
            playlistFilterDebounceTimer = undefined;
            playlistFilterQuery = nextFilterQuery;
            renderPlaylist(false, true);
        }, playlistFilterDebounceMs);
    });

    playlistFilterInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }

        event.preventDefault();
        const hadActiveQuery = hasPlaylistFilterText();
        clearPlaylistFilter();
        if (hadActiveQuery) {
            renderPlaylist(false, true);
        }
        playlistFilterToggle.focus();
    });

    document.addEventListener('pointerdown', (event) => {
        if (playlistSourceMenu.hidden) {
            return;
        }

        const eventTarget = event.target;
        if (!(eventTarget instanceof Node)) {
            return;
        }

        if (playlistSourceWrap.contains(eventTarget)) {
            return;
        }

        closePlaylistSourceMenu();
    });

    playlistLoadBtn.addEventListener('click', () => {
        void loadSelectedPlaylist();
    });

    playlistOpen.addEventListener('click', () => {
        void loadSelectedPlaylist();
    });

    playlistBackdrop.addEventListener('click', () => {
        closeModal();
    });

    playlistClose.addEventListener('click', () => {
        closeModal();
    });

    playlistAddCurrent.addEventListener('click', () => {
        void addCurrentTrackToEnd().catch((error) => {
            console.error(error);
        });
    });

    playlistCreate.addEventListener('click', () => {
        void createNewPlaylist().catch((error) => {
            console.error(error);
        });
    });

    playlistSaveAs.addEventListener('click', () => {
        void saveCurrentSequenceAsPlaylist().catch((error) => {
            console.error(error);
        });
    });

    const scheduleVisiblePlaylistWindowUpdate = (() => {
        let scheduled = false;

        return (): void => {
            if (scheduled) {
                return;
            }

            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                if (playlistModal.hidden || controllerState.selectedSource === 'queue' || !hasLoadedPlaylist()) {
                    return;
                }

                renderPlaylist();
            });
        };
    })();

    playlistList.addEventListener('scroll', () => {
        scheduleVisiblePlaylistWindowUpdate();
    }, { passive: true });

    playlistList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const removeButton = target.closest('[data-playlist-remove-position]');
        if (removeButton instanceof HTMLButtonElement) {
            if (isViewingReadOnlyPlaylist()) {
                return;
            }

            const activeQueue = mutableCurrentSequence();
            const queueMutated = activeQueue === controllerState.editableQueueTrackIndexes;
            const removePosition = Number(removeButton.dataset.playlistRemovePosition);
            if (!Number.isInteger(removePosition)) {
                return;
            }

            const previousQueue = activeQueue.slice();
            activeQueue.splice(removePosition, 1);
            void (async () => {
                if (!(await persistLoadedPlaylistSequenceIfEnabled(activeQueue))) {
                    replaceTrackIndexes(activeQueue, previousQueue);
                    options.openErrorModal(
                        'Playlist save failed',
                        'Silphium could not save the playlist after removing a track, so the change was reverted.',
                    );
                    renderPlaylist();
                    return;
                }

                if (controllerState.loadedPlaylistTrackIndexes && controllerState.loadedPlaylistTrackIndexes.length === 0) {
                    controllerState.loadedPlaylistTrackIndexes = null;
                    controllerState.loadedPlaylistName = '';
                    controllerState.selectedSource = 'queue';
                }

                if (controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length === 0) {
                    if (!redrawPlaybackQueueFromBaseSequence()) {
                        clearEditableQueueState();
                    }
                } else {
                    updateEditableQueueCurrentPositionAfterRemoval(removePosition, activeQueue.length);
                }

                renderPlaylist();
                if (queueMutated) {
                    notifyPlaybackQueueMutated();
                }
            })().catch((error) => {
                console.error(error);
                replaceTrackIndexes(activeQueue, previousQueue);
                options.openErrorModal(
                    'Playlist save failed',
                    'Silphium could not save the playlist after removing a track, so the change was reverted.',
                );
                renderPlaylist();
            });
            return;
        }

        const button = target.closest('[data-playlist-track-index]');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const trackIndex = Number(button.dataset.playlistTrackIndex);
        if (!Number.isInteger(trackIndex)) {
            return;
        }

        const chosenPosition = Number(button.dataset.playlistPosition);
        if (controllerState.editableQueueTrackIndexes && Number.isInteger(chosenPosition)) {
            controllerState.editableQueueCurrentPosition = clampEditableQueuePosition(controllerState.editableQueueTrackIndexes, chosenPosition);
        }

        commitPlaybackSourceFromCurrentView();
        void options.onTrackChosen(trackIndex, {
            source: controllerState.selectedSource,
            userInitiated: true,
        }).then(() => {
            renderPlaylist();
        });
    });

    playlistList.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const row = target.closest('.playlist-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const button = row.querySelector<HTMLButtonElement>('[data-playlist-track-index]');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const trackIndex = Number(button.dataset.playlistTrackIndex);
        if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= options.getTrackCount()) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const trackPath = options.getTrackPath(trackIndex).trim();
        options.onQueueRequested?.(
            event.clientX,
            event.clientY,
            [trackIndex],
            trackIndex,
            trackPath !== '',
            trackPath,
        );
    });

    playlistList.addEventListener('pointerdown', (event) => {
        if (isViewingReadOnlyPlaylist()) {
            return;
        }

        if (event.button !== 0) {
            return;
        }

        const sequence = currentSequence().indexes;
        if (sequence.length === 0) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const dragHandle = target.closest('.playlist-drag-handle');
        if (!(dragHandle instanceof HTMLButtonElement)) {
            return;
        }

        if (dragHandle.disabled) {
            return;
        }

        const row = target.closest('.playlist-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const fromPosition = Number(row.dataset.playlistPosition);
        if (!Number.isInteger(fromPosition)) {
            return;
        }

        event.preventDefault();
        deferredRenderDuringQueueDrag = false;
        queueDragState = {
            fromPosition,
            targetPosition: fromPosition,
            pointerId: event.pointerId,
        };
        if (typeof dragHandle.setPointerCapture === 'function') {
            dragHandle.setPointerCapture(event.pointerId);
        }
        updateQueueDragTargetClasses();
    });

    window.addEventListener('pointermove', (event) => {
        if (!queueDragState || event.pointerId !== queueDragState.pointerId) {
            return;
        }

        event.preventDefault();
        updateQueueDragTargetFromPoint(event.clientX, event.clientY);
    });

    window.addEventListener('pointerup', (event) => {
        if (!queueDragState || event.pointerId !== queueDragState.pointerId) {
            return;
        }

        event.preventDefault();
        finalizeQueueDrag(true);
    });

    window.addEventListener('pointercancel', (event) => {
        if (!queueDragState || event.pointerId !== queueDragState.pointerId) {
            return;
        }

        finalizeQueueDrag(false);
    });

    playlistList.addEventListener('dragover', (event) => {
        if (playlistModal.hidden || isViewingReadOnlyPlaylist() || !hasExternalFileDragPayload(event.dataTransfer)) {
            clearExternalTrackDropIndicator();
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        updateExternalTrackDropIndicatorFromTarget(event.target instanceof Element ? event.target : null, event.clientY);
    });

    playlistList.addEventListener('dragleave', (event) => {
        if (!hasExternalFileDragPayload(event.dataTransfer)) {
            return;
        }

        const ownerDocument = playlistList.ownerDocument;
        const nextTarget = typeof ownerDocument.elementFromPoint === 'function'
            ? ownerDocument.elementFromPoint(event.clientX, event.clientY)
            : null;
        if (nextTarget instanceof Element && playlistList.contains(nextTarget)) {
            return;
        }

        clearExternalTrackDropIndicator();
    });

    playlistList.addEventListener('drop', () => {
        clearExternalTrackDropIndicator();
    });

    return {
        activatePlaybackQueueSource,
        clearEditableQueue,
        closeMenu,
        closeModal,
        getPlaybackOrderScopeLabel: (): string => playbackOrderScopeLabel(),
        getNextTrackIndex,
        peekNextTrackIndex,
        getSequenceOverride: (): PlaylistSequence | null => {
            if (controllerState.playbackSource === 'playlist') {
                return playbackOverrideSequence();
            }

            if (controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length > 0) {
                return queueSequence();
            }

            return null;
        },
        addToQueueEnd: (trackIndexes: number[]) => {
            enqueueTracks(trackIndexes, 'end');
        },
        addToQueueNext: (trackIndexes: number[]) => {
            enqueueTracks(trackIndexes, 'next');
        },
        replacePlaybackQueue,
        handleDocumentClick: (target: Node): boolean => {
            if (!playlistMenu.hidden && !playlistMenu.contains(target)) {
                closeMenu();
            }

            return playlistMenu.contains(target) || playlistModal.contains(target);
        },
        handleEscape: (): boolean => {
            if (playlistModal.hidden) {
                return false;
            }

            closeModal();
            return true;
        },
        openModal,
        refreshOpenModal,
        resetState,
        redrawPlaybackQueueFollowingCurrent,
        scheduleRender,
        refreshFavorites: () => {
            updateHeaderSourceControl();
        },
        getAvailablePlaylistTargets,
        isTrackAlreadyInLoadedPlaylist,
        appendTracksToPlaylist,
        openPlaylistTarget,
        createPlaylistTarget,
        handleExternalTrackDrop,
        loadPlaylistByPath,
    };
};

