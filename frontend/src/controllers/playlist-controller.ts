import type { PlaylistMenuElements } from '../components/overlays/playlist-menu';
import type { PlaylistModalElements } from '../components/overlays/playlist-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import { isPlaybackQueueEligibleTrack } from '../utils/display-helpers';
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
    getTrack: (index: number) => PlaylistTrackView | undefined;
    getTrackPath: (index: number) => string;
    getTrackCount: () => number;
    getCurrentTrackIndex: () => number;
    getPlaybackOrderLabel: () => string;
    getBaseSequence: () => PlaylistSequence;
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
    hasListenHistoryPlaylist: () => boolean;
    onTrackChosen: (index: number, context: PlaylistTrackChosenContext) => Promise<void>;
    onExternalPlaylistLoaded: () => void;
};

export type PlaylistController = ReturnType<typeof createPlaylistController>;

const playbackQueueSourceLabel = 'Playback Queue';
const listenHistorySourceLabel = 'Listen History';
const playbackQueueSourceIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4.75 6.5C4.75 5.81 5.31 5.25 6 5.25H19C19.69 5.25 20.25 5.81 20.25 6.5C20.25 7.19 19.69 7.75 19 7.75H6C5.31 7.75 4.75 7.19 4.75 6.5ZM4.75 12C4.75 11.31 5.31 10.75 6 10.75H15C15.69 10.75 16.25 11.31 16.25 12C16.25 12.69 15.69 13.25 15 13.25H6C5.31 13.25 4.75 12.69 4.75 12ZM4.75 17.5C4.75 16.81 5.31 16.25 6 16.25H12C12.69 16.25 13.25 16.81 13.25 17.5C13.25 18.19 12.69 18.75 12 18.75H6C5.31 18.75 4.75 18.19 4.75 17.5Z"/></svg>';
const listenHistorySourceIcon = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 3.75C7.44 3.75 3.75 7.44 3.75 12C3.75 16.56 7.44 20.25 12 20.25C16.56 20.25 20.25 16.56 20.25 12C20.25 7.44 16.56 3.75 12 3.75ZM2.25 12C2.25 6.61 6.61 2.25 12 2.25C17.39 2.25 21.75 6.61 21.75 12C21.75 17.39 17.39 21.75 12 21.75C6.61 21.75 2.25 17.39 2.25 12ZM12 7.75C12.41 7.75 12.75 8.09 12.75 8.5V11.69L15.03 13.2C15.37 13.42 15.47 13.88 15.25 14.22C15.02 14.57 14.56 14.66 14.22 14.44L11.6 12.69C11.39 12.56 11.25 12.32 11.25 12.06V8.5C11.25 8.09 11.59 7.75 12 7.75Z"/></svg>';

export const createPlaylistController = (options: PlaylistControllerOptions) => {
    const { trigger, menu, modal } = options;
    const controllerState = options.state ?? createPlaylistControllerState();
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
        playlistHydrationProgress,
        playlistHydrationCount,
        playlistList,
        playlistPreventDuplicateCheckbox,
        playlistOpen,
        playlistCreate,
        playlistAddCurrent,
        playlistSaveAs,
    } = modal;

    let hydrationRunId = 0;
    let dragFromPosition: number | null = null;
    let hydrationTotal = 0;
    let hydrationCompleted = 0;
    let hydrationHideToken = 0;
    let hydrationSignature = '';
    const queueMutationChunkSize = 512;
    const playlistModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const playlistViewTransitionMs = 220;
    const playlistSourceMenuMaxHeightPx = 100;
    const queueVisibleRadius = 50;
    const queueHydrationLookahead = 50;
    let playlistModalHideTimer: number | undefined;
    let playlistViewTransitionTimer: number | undefined;
    let playlistDialogResizeTimer: number | undefined;
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

    const setHydrationProgress = (completed: number, total: number): void => {
        hydrationHideToken += 1;

        hydrationCompleted = Math.max(0, completed);
        hydrationTotal = Math.max(0, total);

        if (hydrationTotal <= 0) {
            playlistHydrationProgress.hidden = true;
            return;
        }

        const boundedCompleted = Math.min(hydrationCompleted, hydrationTotal);
        playlistHydrationCount.textContent = `${boundedCompleted} of ${hydrationTotal}`;
        playlistHydrationProgress.hidden = false;

        if (boundedCompleted >= hydrationTotal) {
            // Keep the completed state visible for at least one paint, then hide.
            const activeHideToken = hydrationHideToken;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (activeHideToken !== hydrationHideToken) {
                        return;
                    }

                    if (hydrationTotal > 0 && hydrationCompleted >= hydrationTotal) {
                        playlistHydrationProgress.hidden = true;
                    }
                });
            });
        }
    };

    const hasLoadedPlaylist = (): boolean => controllerState.loadedPlaylistTrackIndexes !== null;

    const normalizePlaylistPath = (playlistPath: string): string => playlistPath.trim().toLowerCase();

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
                nextHistoryItems.push(loadedPlaylist.historyItems?.[position] || { listenedAt: 0 });
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

    const hasAuthoritativeTrackLabels = (trackIndex: number, cachedItemsByTrackIndex: Map<number, LoadedPlaylistCachedItem>): boolean => {
        const track = options.getTrack(trackIndex);
        if (!track) {
            return false;
        }

        return track.tagsResolved || hasCachedPlaylistLabels(cachedItemsByTrackIndex.get(trackIndex));
    };

    const requestTrackMetadataHydration = (trackIndexes: number[]): void => {
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
        controllerState.editableQueueTrackIndexes = null;
        controllerState.selectedSource = 'playlist';
        controllerState.playbackSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        dragFromPosition = null;
        options.onExternalPlaylistLoaded();
        hydrateTrackMetadataInBackground(sanitizedPlaylist.trackIndexes);

        renderPlaylist(true);
        openModal();
        return true;
    };

    const loadListenHistoryPlaylist = async (openAfterLoad = false): Promise<boolean> => {
        const loadedPlaylist = await options.loadListenHistoryData();
        if (!loadedPlaylist) {
            return false;
        }

        const sanitizedPlaylist = sanitizeLoadedPlaylistData(loadedPlaylist);

        controllerState.loadedPlaylistTrackIndexes = sanitizedPlaylist.trackIndexes;
        controllerState.loadedPlaylistName = sanitizedPlaylist.name || 'Listen History';
        controllerState.loadedPlaylistPath = '__listen_history__';
        controllerState.loadedPlaylistReadOnly = true;
        controllerState.loadedPlaylistHistoryItems = sanitizedPlaylist.historyItems || [];
        controllerState.loadedPlaylistCachedItems = sanitizedPlaylist.cachedItems || null;
        controllerState.editableQueueTrackIndexes = null;
        controllerState.selectedSource = 'history';
        controllerState.playbackSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        dragFromPosition = null;
        hydrateTrackMetadataInBackground(sanitizedPlaylist.trackIndexes);

        renderPlaylist(true);
        if (openAfterLoad) {
            openModal();
        }

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

    const queueSequence = (): PlaylistSequence => {
        if (controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length > 0) {
            const currentTrackIndex = options.getCurrentTrackIndex();
            const currentPosition = controllerState.editableQueueTrackIndexes.indexOf(currentTrackIndex);
            return {
                indexes: controllerState.editableQueueTrackIndexes,
                currentPosition: currentPosition >= 0 ? currentPosition : 0,
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

        if (selectedValue === 'queue') {
            controllerState.selectedSource = 'queue';
            controllerState.selectedFavoriteIndex = null;
            controllerState.playbackSource = 'queue';
            hydrateCurrentViewTracks();
            renderPlaylist(true);
            return;
        }

        if (selectedValue === 'playlist') {
            controllerState.selectedSource = 'playlist';
            controllerState.selectedFavoriteIndex = null;
            hydrateCurrentViewTracks();
            renderPlaylist(true);
            return;
        }

        if (selectedValue === 'history') {
            void loadListenHistoryPlaylist(false).then((loaded) => {
                if (loaded) {
                    return;
                }

                controllerState.selectedSource = 'queue';
                controllerState.selectedFavoriteIndex = null;
                setPlaylistSourceSelection('queue');
                hydrateCurrentViewTracks();
                renderPlaylist(true);
            }).catch((error) => {
                console.error(error);
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
            void loadFavouritePlaylistByIndex(favoriteIndex).catch((error) => {
                console.error(error);
            });
        }
    };

    const updateHeaderSourceControl = (): void => {
        rebuildPlaylistSourceControl(getPlaylistSourceControlOptions());
        playlistTitle.hidden = true;
        playlistSourceWrap.hidden = false;

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
        playlistModal.classList.remove('is-visible');

        if (playlistModalHideTimer !== undefined) {
            window.clearTimeout(playlistModalHideTimer);
        }

        playlistModalHideTimer = window.setTimeout(() => {
            playlistModal.hidden = true;
            playlistModalHideTimer = undefined;
        }, playlistModalTransitionMs);

        dragFromPosition = null;
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

    const renderPlaylist = (animateViewSwitch = false): void => {
        const previousDialogHeight = animateViewSwitch ? playlistDialog.getBoundingClientRect().height : 0;
        if (animateViewSwitch) {
            if (playlistDialogResizeTimer !== undefined) {
                window.clearTimeout(playlistDialogResizeTimer);
                playlistDialogResizeTimer = undefined;
            }
            playlistDialog.style.height = '';
            playlistDialog.classList.remove('is-resizing');
        }

        updateHeaderSourceControl();

        const { indexes, currentPosition } = currentSequence();
        const currentTrackIndex = options.getCurrentTrackIndex();
        const activePosition = indexes.indexOf(currentTrackIndex);
        const anchorPosition = activePosition >= 0 ? activePosition : currentPosition;
        const viewingPlaylist = controllerState.selectedSource !== 'queue' && hasLoadedPlaylist();
        const start = viewingPlaylist ? 0 : Math.max(0, anchorPosition - queueVisibleRadius);
        const end = viewingPlaylist ? indexes.length : Math.min(indexes.length, anchorPosition + queueVisibleRadius + 1);
        const cachedItemsByTrackIndex = cachedPlaylistItemsByTrackIndex();

        let visibleRows: RenderablePlaylistRow[];
        if (viewingPlaylist) {
            visibleRows = indexes.slice(start, end).map((trackIndex, offset) => ({
                actualPosition: start + offset,
                trackIndex,
            }));
        } else {
            const hydrationEnd = Math.min(indexes.length, end + queueHydrationLookahead);
            requestTrackMetadataHydration(indexes.slice(start, hydrationEnd));

            const nextVisibleRows: RenderablePlaylistRow[] = [];
            for (let position = start; position < indexes.length && nextVisibleRows.length < end - start; position += 1) {
                const trackIndex = indexes[position];
                if (trackIndex !== currentTrackIndex && !hasAuthoritativeTrackLabels(trackIndex, cachedItemsByTrackIndex)) {
                    continue;
                }

                nextVisibleRows.push({
                    actualPosition: position,
                    trackIndex,
                });
            }

            visibleRows = nextVisibleRows;
        }

        if (visibleRows.length === 0) {
            const emptyMessage = !viewingPlaylist && indexes.length > 0
                ? 'Loading queue metadata…'
                : 'No tracks available';
            playlistList.innerHTML = `<li class="playlist-item-empty">${emptyMessage}</li>`;
            if (animateViewSwitch) {
                animatePlaylistDialogResize(previousDialogHeight);
                animatePlaylistViewSwitch();
            }
            return;
        }

        const rows = visibleRows.map(({ trackIndex, actualPosition }) => {
            const track = options.getTrack(trackIndex);
            const activeClass = trackIndex === currentTrackIndex ? ' is-active' : '';
            const isActiveTrack = trackIndex === currentTrackIndex;
            const prefix = isActiveTrack
                ? playlistPrefixIcon('active')
                : (activePosition >= 0 && actualPosition < activePosition ? playlistPrefixIcon('before') : playlistPrefixIcon('after'));
            const label = track?.displayTitle || track?.name || 'Unknown track';
            const secondary = track?.displayArtist || '';

            if (isViewingReadOnlyPlaylist()) {
                const historyItem = controllerState.loadedPlaylistHistoryItems?.[actualPosition];
                const ageLabel = formatListenHistoryAge(historyItem?.listenedAt || 0);
                return `<li class="playlist-row playlist-row-read-only" data-playlist-position="${actualPosition}">
            <span class="playlist-position-indicator">#${actualPosition + 1}</span>
            <button class="playlist-item${activeClass}" data-playlist-track-index="${trackIndex}" data-playlist-position="${actualPosition}"><span class="playlist-item-topline"><span class="playlist-item-main"><span class="playlist-item-prefix">${prefix}</span><span class="playlist-item-label">${label}</span></span>${ageLabel ? `<span class="playlist-item-meta">${ageLabel}</span>` : ''}</span><span class="playlist-item-sub">${secondary}</span></button>
        </li>`;
            }

            return `<li class="playlist-row" draggable="true" data-playlist-position="${actualPosition}">
            <button class="playlist-drag-handle" type="button" aria-label="Drag track" title="Drag to reorder">${playlistDragIcon}</button>
            <span class="playlist-position-indicator">#${actualPosition + 1}</span>
            <button class="playlist-item${activeClass}" data-playlist-track-index="${trackIndex}" data-playlist-position="${actualPosition}"><span class="playlist-item-main"><span class="playlist-item-prefix">${prefix}</span><span class="playlist-item-label">${label}</span></span><span class="playlist-item-sub">${secondary}</span></button>
            <button class="playlist-remove" type="button" data-playlist-remove-position="${actualPosition}" aria-label="Remove track" title="Remove track">${playlistRemoveIcon}</button>
        </li>`;
        }).join('');

        playlistList.innerHTML = rows;
        if (animateViewSwitch) {
            animatePlaylistDialogResize(previousDialogHeight);
            animatePlaylistViewSwitch();
        }
    };

    const scheduleRender = (() => {
        let scheduled = false;

        return (): void => {
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
        if (resolvedIndexesMissingCache.length > 0) {
            void persistPlaylistTrackMetadataCache(resolvedIndexesMissingCache).catch((error) => {
                console.error(error);
            });
        }

        const pending = scopedTrackIndexes.filter((index) => {
            return !options.getTrack(index)?.tagsResolved && !hasCachedPlaylistLabels(cachedItemsByTrackIndex.get(index));
        });

        const totalTracks = scopedTrackIndexes.length;
        const alreadyResolved = totalTracks - pending.length;

        if (pending.length === 0) {
            setHydrationProgress(0, 0);
            return;
        }

        setHydrationProgress(alreadyResolved, totalTracks);

        const workerCount = Math.min(4, pending.length);
        const batchSize = 12;
        let cursor = 0;
        let completed = alreadyResolved;

        const worker = async (): Promise<void> => {
            while (true) {
                if (runId !== hydrationRunId) {
                    return;
                }

                const nextCursor = cursor;
                cursor += batchSize;
                if (nextCursor >= pending.length) {
                    return;
                }

                const batch = pending.slice(nextCursor, Math.min(nextCursor + batchSize, pending.length));
                await options.ensureTrackTagsResolvedBatch(batch);
                if (runId !== hydrationRunId) {
                    return;
                }

                await persistPlaylistTrackMetadataCache(batch);
                if (runId !== hydrationRunId) {
                    return;
                }

                completed += batch.length;
                setHydrationProgress(completed, totalTracks);

                scheduleRender();
            }
        };

        for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
            void worker();
        }
    };

    const hydrateCurrentViewTracks = (): void => {
        const { indexes, currentPosition } = currentSequence();
        const viewingPlaylist = controllerState.selectedSource !== 'queue' && hasLoadedPlaylist();
        if (viewingPlaylist) {
            requestTrackMetadataHydration(indexes);
            return;
        }

        const start = Math.max(0, currentPosition - queueVisibleRadius);
        const end = Math.min(indexes.length, currentPosition + queueVisibleRadius + 1 + queueHydrationLookahead);
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

        hydrateCurrentViewTracks();
        renderPlaylist();
        playlistModal.hidden = false;
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

        controllerState.editableQueueTrackIndexes = queueSequence().indexes.slice();
        return controllerState.editableQueueTrackIndexes;
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

    const appendTracksToPlaylist = async (playlistPath: string, trackIndexes: number[]): Promise<boolean> => {
        const cleanPlaylistPath = playlistPath.trim();
        if (cleanPlaylistPath === '') {
            return false;
        }

        const normalizedTrackIndexes = trackIndexes.filter((trackIndex) => (
            Number.isInteger(trackIndex)
            && trackIndex >= 0
            && trackIndex < options.getTrackCount()
        ));
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
            const currentTrackIndex = options.getCurrentTrackIndex();
            const currentPosition = queue.indexOf(currentTrackIndex);
            const insertAt = currentPosition >= 0 ? currentPosition + 1 : 0;
            insertTrackIndexes(queue, insertAt, normalizedTrackIndexes);
        } else {
            appendTrackIndexes(queue, normalizedTrackIndexes);
        }

        hydrateTrackMetadataInBackground(normalizedTrackIndexes);
        scheduleRender();
    };

    const resolveNextTrackIndex = (direction: PlaylistDirection, mutateState: boolean): number | undefined => {
        const currentTrackIndex = options.getCurrentTrackIndex();

        if (controllerState.playbackSource === 'playlist') {
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

        const queueIndexes = queueSequence().indexes;
        if ((controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length > 0) || hasLoadedPlaylist()) {
            const currentPosition = queueIndexes.indexOf(currentTrackIndex);
            if (currentPosition < 0) {
                return queueIndexes[0];
            }

            if (direction > 0 && controllerState.editableQueueTrackIndexes && currentPosition >= queueIndexes.length - 1) {
	            if (!mutateState) {
	                return undefined;
	            }

                controllerState.editableQueueTrackIndexes = null;
                scheduleRender();
                return undefined;
            }

            const nextPosition = (currentPosition + direction + queueIndexes.length) % queueIndexes.length;
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
        controllerState.editableQueueTrackIndexes = null;
        scheduleRender();
    };

    const activatePlaybackQueueSource = (): void => {
        controllerState.playbackSource = 'queue';
        controllerState.editableQueueTrackIndexes = null;
        scheduleRender();
    };

    const resetState = (): void => {
        controllerState.loadedPlaylistTrackIndexes = null;
        controllerState.loadedPlaylistName = '';
        controllerState.loadedPlaylistPath = '';
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = null;
        controllerState.editableQueueTrackIndexes = null;
        controllerState.selectedSource = 'queue';
        controllerState.selectedFavoriteIndex = null;
        controllerState.playbackSource = 'queue';
        hydrationRunId += 1;
        dragFromPosition = null;
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

    const addCurrentTrackToEnd = (): void => {
        const currentTrackIndex = options.getCurrentTrackIndex();
        if (!isQueueEligibleTrackIndex(currentTrackIndex)) {
            return;
        }

        const activeQueue = mutableCurrentSequence();
        if (playlistPreventDuplicateCheckbox.checked && activeQueue.includes(currentTrackIndex)) {
            options.openErrorModal(
                'Track already in playlist',
                'The current track is already in the active playlist. Disable duplicate prevention to add it again.',
            );
            return;
        }

        activeQueue.push(currentTrackIndex);
        hydrateTrackMetadataInBackground([currentTrackIndex]);
        renderPlaylist(true);
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
        controllerState.selectedSource = 'playlist';
        controllerState.playbackSource = 'queue';
        controllerState.editableQueueTrackIndexes = null;
        controllerState.selectedFavoriteIndex = null;
        hydrateTrackMetadataInBackground([]);
        renderPlaylist(true);
    };

    const loadFavouritePlaylist = async (playlistPath: string): Promise<void> => {
        if (!playlistPath) {
            return;
        }

        const loadedPlaylist = await options.loadPlaylistData(playlistPath);
        if (!loadedPlaylist) {
            return;
        }

        const sanitizedPlaylist = sanitizeLoadedPlaylistData(loadedPlaylist);

        controllerState.loadedPlaylistTrackIndexes = sanitizedPlaylist.trackIndexes;
        controllerState.loadedPlaylistName = sanitizedPlaylist.name || '';
        controllerState.loadedPlaylistPath = playlistPath;
        controllerState.loadedPlaylistReadOnly = false;
        controllerState.loadedPlaylistHistoryItems = null;
        controllerState.loadedPlaylistCachedItems = sanitizedPlaylist.cachedItems || null;
        controllerState.selectedSource = 'playlist';
        controllerState.playbackSource = 'queue';
        dragFromPosition = null;
        hydrateTrackMetadataInBackground(sanitizedPlaylist.trackIndexes);
        renderPlaylist(true);
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
            const playlistSequence = loadedPlaylistSequence();
            if (playlistSequence) {
                controllerState.editableQueueTrackIndexes = playlistSequence.indexes.slice();
            }
            controllerState.playbackSource = 'queue';
            return;
        }

        controllerState.playbackSource = 'queue';
    };

    const loadFavouritePlaylistByIndex = async (favoriteIndex: number): Promise<void> => {
        const favoritePlaylists = options.getFavoritePlaylists().filter((playlistPath) => playlistPath.trim() !== '');
        if (!Number.isInteger(favoriteIndex) || favoriteIndex < 0 || favoriteIndex >= favoritePlaylists.length) {
            return;
        }

        controllerState.selectedFavoriteIndex = favoriteIndex;
        await loadFavouritePlaylist(favoritePlaylists[favoriteIndex]);
        updateHeaderSourceControl();
        const favoriteValue = `favorite:${favoriteIndex}`;
        setPlaylistSourceSelection(favoriteValue);
    };

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
        addCurrentTrackToEnd();
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
            const removePosition = Number(removeButton.dataset.playlistRemovePosition);
            if (!Number.isInteger(removePosition)) {
                return;
            }

            activeQueue.splice(removePosition, 1);
            if (controllerState.loadedPlaylistTrackIndexes && controllerState.loadedPlaylistTrackIndexes.length === 0) {
                controllerState.loadedPlaylistTrackIndexes = null;
                controllerState.loadedPlaylistName = '';
                controllerState.selectedSource = 'queue';
            }

            if (controllerState.editableQueueTrackIndexes && controllerState.editableQueueTrackIndexes.length === 0) {
                controllerState.editableQueueTrackIndexes = null;
            }

            renderPlaylist();
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

        commitPlaybackSourceFromCurrentView();
        void options.onTrackChosen(trackIndex, {
            source: controllerState.selectedSource,
            userInitiated: true,
        }).then(() => {
            renderPlaylist();
        });
    });

    playlistList.addEventListener('dragstart', (event) => {
        if (isViewingReadOnlyPlaylist()) {
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

        const row = target.closest('.playlist-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        const fromPosition = Number(row.dataset.playlistPosition);
        if (!Number.isInteger(fromPosition)) {
            return;
        }

        dragFromPosition = fromPosition;
        row.classList.add('is-dragging');

        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(fromPosition));
        }
    });

    playlistList.addEventListener('dragend', () => {
        dragFromPosition = null;
        const rows = playlistList.querySelectorAll('.playlist-row.is-dragging');
        rows.forEach((row) => row.classList.remove('is-dragging'));
    });

    playlistList.addEventListener('dragover', (event) => {
        if (isViewingReadOnlyPlaylist()) {
            return;
        }

        const activeQueue = currentSequence().indexes;
        if (activeQueue.length === 0) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const row = target.closest('.playlist-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }
    });

    playlistList.addEventListener('drop', (event) => {
        if (isViewingReadOnlyPlaylist()) {
            return;
        }

        const activeQueue = mutableCurrentSequence();
        if (activeQueue.length === 0) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const row = target.closest('.playlist-row');
        if (!(row instanceof HTMLElement)) {
            return;
        }

        event.preventDefault();

        const toPosition = Number(row.dataset.playlistPosition);
        const fromPosition = dragFromPosition ?? Number(event.dataTransfer?.getData('text/plain'));
        if (!Number.isInteger(fromPosition) || !Number.isInteger(toPosition) || fromPosition === toPosition) {
            return;
        }

        if (fromPosition < 0 || toPosition < 0 || fromPosition >= activeQueue.length || toPosition >= activeQueue.length) {
            return;
        }

        const [moved] = activeQueue.splice(fromPosition, 1);
        activeQueue.splice(toPosition, 0, moved);
        renderPlaylist();
    });

    return {
        activatePlaybackQueueSource,
        clearEditableQueue,
        closeMenu,
        closeModal,
        getNextTrackIndex,
        peekNextTrackIndex,
        getSequenceOverride: (): PlaylistSequence | null => {
            if (controllerState.playbackSource === 'playlist') {
                return loadedPlaylistSequence();
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
        scheduleRender,
        refreshFavorites: () => {
            updateHeaderSourceControl();
        },
        getAvailablePlaylistTargets,
        isTrackAlreadyInLoadedPlaylist,
        appendTracksToPlaylist,
        openPlaylistTarget,
        createPlaylistTarget,
        loadPlaylistByPath,
    };
};

