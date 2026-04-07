import type { PlaylistMenuElements } from '../components/overlays/playlist-menu';
import type { PlaylistModalElements } from '../components/overlays/playlist-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';

export type PlaylistDirection = -1 | 1;

type PlaylistSource = 'queue' | 'playlist';

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
};

export type PlaylistTargetOption = {
    path: string;
    label: string;
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
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    getFavoritePlaylists: () => string[];
    onTrackChosen: (index: number, context: PlaylistTrackChosenContext) => Promise<void>;
    onExternalPlaylistLoaded: () => void;
};

export type PlaylistController = ReturnType<typeof createPlaylistController>;

export const createPlaylistController = (options: PlaylistControllerOptions) => {
    const { trigger, menu, modal } = options;
    const { playlistMenu, playlistLoadBtn } = menu;
    const {
        playlistModal,
        playlistBackdrop,
        playlistClose,
        playlistTitle,
        playlistSource,
        playlistHydrationProgress,
        playlistHydrationCount,
        playlistList,
        playlistOpen,
        playlistCreate,
        playlistAddCurrent,
        playlistSaveAs,
    } = modal;

    let loadedPlaylistTrackIndexes: number[] | null = null;
    let loadedPlaylistName = '';
    let loadedPlaylistPath = '';
    let editableQueueTrackIndexes: number[] | null = null;
    let hydrationRunId = 0;
    let dragFromPosition: number | null = null;
    let selectedSource: PlaylistSource = 'queue';
    let selectedFavoriteIndex: number | null = null;
    let playbackSource: PlaylistSource = 'queue';
    let hydrationTotal = 0;
    let hydrationCompleted = 0;
    let hydrationHideToken = 0;
    const queueMutationChunkSize = 512;
    const playlistModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    let playlistModalHideTimer: number | undefined;
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

    const hasLoadedPlaylist = (): boolean => loadedPlaylistTrackIndexes !== null;

    const normalizePlaylistPath = (playlistPath: string): string => playlistPath.trim().toLowerCase();

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
        appendTarget(loadedPlaylistPath, loadedPlaylistName);

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

        loadedPlaylistTrackIndexes = loadedPlaylist.trackIndexes;
        loadedPlaylistName = loadedPlaylist.name || '';
        loadedPlaylistPath = normalizedPath;
        editableQueueTrackIndexes = null;
        selectedSource = 'playlist';
        playbackSource = loadedPlaylist.trackIndexes.length > 0 ? 'playlist' : 'queue';
        selectedFavoriteIndex = null;
        dragFromPosition = null;
        options.onExternalPlaylistLoaded();
        hydrateTrackMetadataInBackground(loadedPlaylist.trackIndexes);
        if (loadedPlaylist.trackIndexes.length > 0) {
            await options.onTrackChosen(loadedPlaylist.trackIndexes[0], {
                source: 'playlist',
                userInitiated: false,
            });
        }

        renderPlaylist();
        openModal();
        return true;
    };

    const loadedPlaylistSequence = (): PlaylistSequence | null => {
        if (!loadedPlaylistTrackIndexes) {
            return null;
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        const currentPosition = loadedPlaylistTrackIndexes.indexOf(currentTrackIndex);
        return {
            indexes: loadedPlaylistTrackIndexes,
            currentPosition: currentPosition >= 0 ? currentPosition : 0,
        };
    };

    const queueSequence = (): PlaylistSequence => {
        if (editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) {
            const currentTrackIndex = options.getCurrentTrackIndex();
            const currentPosition = editableQueueTrackIndexes.indexOf(currentTrackIndex);
            return {
                indexes: editableQueueTrackIndexes,
                currentPosition: currentPosition >= 0 ? currentPosition : 0,
            };
        }

        const playlistSequence = loadedPlaylistSequence();
        if (playbackSource === 'playlist' && playlistSequence && playlistSequence.indexes.length > 0) {
            return {
                indexes: playlistSequence.indexes,
                currentPosition: playlistSequence.currentPosition,
            };
        }

        return options.getBaseSequence();
    };

    const currentSequence = (): PlaylistSequence => {
        if (selectedSource !== 'queue') {
            const playlistSequence = loadedPlaylistSequence();
            if (playlistSequence) {
                return playlistSequence;
            }
        }

        return queueSequence();
    };

    const updateHeaderSourceControl = (): void => {
        const queueLabel = `Playback Queue (${options.getPlaybackOrderLabel()})`;
        const favoritePlaylists = options.getFavoritePlaylists().filter((playlistPath) => playlistPath.trim() !== '');

        const expectedOptions: Array<{ value: string; label: string }> = [
            { value: 'queue', label: queueLabel },
            ...favoritePlaylists.map((playlistPath, index) => {
                const segments = playlistPath.split(/[\\/]/);
                const baseName = segments[segments.length - 1] || playlistPath;
                return {
                    value: `favorite:${index}`,
                    label: `Favorite: ${baseName}`,
                };
            }),
        ];

        const loadedPlaylistMatchesFavorite = hasLoadedPlaylist() && favoritePlaylists.some((playlistPath) => {
            return normalizePlaylistPath(playlistPath) === normalizePlaylistPath(loadedPlaylistPath);
        });

        if (hasLoadedPlaylist() && !loadedPlaylistMatchesFavorite) {
            const playlistLabel = `Playlist: ${loadedPlaylistName || 'M3U/M3U8'}`;
            expectedOptions.push({ value: 'playlist', label: playlistLabel });
        }

        const shouldRebuildOptions = playlistSource.options.length !== expectedOptions.length
            || expectedOptions.some((option, index) => {
                const currentOption = playlistSource.options.item(index);
                return !currentOption || currentOption.value !== option.value || currentOption.text !== option.label;
            });

        if (shouldRebuildOptions) {
            playlistSource.innerHTML = '';
            expectedOptions.forEach((option) => {
                const nextOption = document.createElement('option');
                nextOption.value = option.value;
                nextOption.text = option.label;
                playlistSource.append(nextOption);
            });
        }

        playlistTitle.hidden = true;
        playlistSource.hidden = false;

        if (selectedSource === 'playlist' && hasLoadedPlaylist()) {
            const hasPlaylistOption = Array.from(playlistSource.options).some((option) => option.value === 'playlist');
            if (hasPlaylistOption) {
                playlistSource.value = 'playlist';
                return;
            }
        }

        if (selectedFavoriteIndex !== null) {
            const favoriteValue = `favorite:${selectedFavoriteIndex}`;
            if (Array.from(playlistSource.options).some((option) => option.value === favoriteValue)) {
                playlistSource.value = favoriteValue;
                return;
            }
        }

        selectedSource = 'queue';
        selectedFavoriteIndex = null;
        playlistSource.value = 'queue';
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

    const renderPlaylist = (): void => {
        updateHeaderSourceControl();

        const { indexes, currentPosition } = currentSequence();
        const currentTrackIndex = options.getCurrentTrackIndex();
        const activePosition = indexes.indexOf(currentTrackIndex);
        const anchorPosition = activePosition >= 0 ? activePosition : currentPosition;
        const viewingPlaylist = selectedSource === 'playlist' && hasLoadedPlaylist();
        const start = viewingPlaylist ? 0 : Math.max(0, anchorPosition - 50);
        const end = viewingPlaylist ? indexes.length : Math.min(indexes.length, anchorPosition + 51);
        const visibleIndexes = indexes.slice(start, end);

        if (visibleIndexes.length === 0) {
            playlistList.innerHTML = '<li class="playlist-item-empty">No tracks available</li>';
            return;
        }

        const rows = visibleIndexes.map((trackIndex, offset) => {
            const track = options.getTrack(trackIndex);
            const actualPosition = start + offset;
            const activeClass = trackIndex === currentTrackIndex ? ' is-active' : '';
            const isActiveTrack = trackIndex === currentTrackIndex;
            const prefix = isActiveTrack
                ? playlistPrefixIcon('active')
                : (activePosition >= 0 && actualPosition < activePosition ? playlistPrefixIcon('before') : playlistPrefixIcon('after'));
            const label = track?.displayTitle || track?.name || 'Unknown track';
            const secondary = track?.displayArtist || '';

            return `<li class="playlist-row" draggable="true" data-playlist-position="${actualPosition}">
            <button class="playlist-drag-handle" type="button" aria-label="Drag track" title="Drag to reorder">${playlistDragIcon}</button>
            <span class="playlist-position-indicator">#${actualPosition + 1}</span>
            <button class="playlist-item${activeClass}" data-playlist-track-index="${trackIndex}" data-playlist-position="${actualPosition}"><span class="playlist-item-main"><span class="playlist-item-prefix">${prefix}</span><span class="playlist-item-label">${label}</span></span><span class="playlist-item-sub">${secondary}</span></button>
            <button class="playlist-remove" type="button" data-playlist-remove-position="${actualPosition}" aria-label="Remove track" title="Remove track">${playlistRemoveIcon}</button>
        </li>`;
        }).join('');

        playlistList.innerHTML = rows;
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

        const pending = scopedTrackIndexes.filter((index) => {
            return !options.getTrack(index)?.tagsResolved;
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
        const viewingPlaylist = selectedSource === 'playlist' && hasLoadedPlaylist();
        if (viewingPlaylist) {
            hydrateTrackMetadataInBackground(indexes);
            return;
        }

        const start = Math.max(0, currentPosition - 50);
        const end = Math.min(indexes.length, currentPosition + 51);
        hydrateTrackMetadataInBackground(indexes.slice(start, end));
    };

    const openModal = (): void => {
        if (playlistModalHideTimer !== undefined) {
            window.clearTimeout(playlistModalHideTimer);
            playlistModalHideTimer = undefined;
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
        renderPlaylist();
    };

    const mutableCurrentSequence = (): number[] => {
        if (selectedSource === 'playlist' && loadedPlaylistTrackIndexes) {
            return loadedPlaylistTrackIndexes;
        }

        return mutableQueueSequence();
    };

    const mutableQueueSequence = (): number[] => {
        if (editableQueueTrackIndexes) {
            return editableQueueTrackIndexes;
        }

        editableQueueTrackIndexes = queueSequence().indexes.slice();
        return editableQueueTrackIndexes;
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

        if (normalizePlaylistPath(loadedPlaylistPath) === normalizePlaylistPath(cleanPlaylistPath)) {
            if (!loadedPlaylistTrackIndexes) {
                loadedPlaylistTrackIndexes = [];
            }

            appendTrackIndexes(loadedPlaylistTrackIndexes, validTrackIndexes);
            if (!loadedPlaylistName.trim()) {
                loadedPlaylistName = playlistTargetLabel(cleanPlaylistPath);
            }

            hydrateTrackMetadataInBackground(validTrackIndexes);
            updateHeaderSourceControl();
            scheduleRender();
        }

        return true;
    };

    const enqueueTracks = (trackIndexes: number[], placement: 'next' | 'end'): void => {
        const normalizedTrackIndexes = trackIndexes.filter((trackIndex) => (
            Number.isInteger(trackIndex)
            && trackIndex >= 0
            && trackIndex < options.getTrackCount()
        ));

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

        if (playbackSource === 'playlist') {
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
        if ((editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) || hasLoadedPlaylist()) {
            const currentPosition = queueIndexes.indexOf(currentTrackIndex);
            if (currentPosition < 0) {
                return queueIndexes[0];
            }

            if (direction > 0 && editableQueueTrackIndexes && currentPosition >= queueIndexes.length - 1) {
	            if (!mutateState) {
	                return undefined;
	            }

                editableQueueTrackIndexes = null;
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
        editableQueueTrackIndexes = null;
        scheduleRender();
    };

    const activatePlaybackQueueSource = (): void => {
        playbackSource = 'queue';
        editableQueueTrackIndexes = null;
        scheduleRender();
    };

    const resetState = (): void => {
        loadedPlaylistTrackIndexes = null;
        loadedPlaylistName = '';
        loadedPlaylistPath = '';
        editableQueueTrackIndexes = null;
        selectedSource = 'queue';
        selectedFavoriteIndex = null;
        playbackSource = 'queue';
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
        if (currentTrackIndex < 0 || currentTrackIndex >= options.getTrackCount()) {
            return;
        }

        const activeQueue = mutableCurrentSequence();
        activeQueue.push(currentTrackIndex);
        hydrateTrackMetadataInBackground([currentTrackIndex]);
        renderPlaylist();
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

        loadedPlaylistName = selectedPath.split(/[\\/]/).pop() || selectedPath;
        loadedPlaylistPath = selectedPath;
        selectedFavoriteIndex = null;
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

        loadedPlaylistName = selectedPath.split(/[\\/]/).pop() || selectedPath;
        loadedPlaylistPath = selectedPath;
        loadedPlaylistTrackIndexes = [];
        selectedSource = 'playlist';
        playbackSource = 'queue';
        editableQueueTrackIndexes = null;
        selectedFavoriteIndex = null;
        hydrateTrackMetadataInBackground([]);
        renderPlaylist();
    };

    const loadFavouritePlaylist = async (playlistPath: string): Promise<void> => {
        if (!playlistPath) {
            return;
        }

        const loadedPlaylist = await options.loadPlaylistData(playlistPath);
        if (!loadedPlaylist) {
            return;
        }

        loadedPlaylistTrackIndexes = loadedPlaylist.trackIndexes;
        loadedPlaylistName = loadedPlaylist.name || '';
        loadedPlaylistPath = playlistPath;
        selectedSource = 'playlist';
        playbackSource = loadedPlaylist.trackIndexes.length > 0 ? 'playlist' : 'queue';
        dragFromPosition = null;
        hydrateTrackMetadataInBackground(loadedPlaylist.trackIndexes);
        renderPlaylist();
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

        loadedPlaylistTrackIndexes = loadedPlaylist.trackIndexes;
        loadedPlaylistName = loadedPlaylist.name || '';
        loadedPlaylistPath = normalizedPath;
        selectedFavoriteIndex = null;
        updateHeaderSourceControl();
        scheduleRender();

        return {
            path: normalizedPath,
            label: playlistTargetLabel(normalizedPath, loadedPlaylistName),
        };
    };

    const createPlaylistTarget = async (): Promise<PlaylistTargetOption | null> => {
        await createNewPlaylist();
        if (!loadedPlaylistPath) {
            return null;
        }

        return {
            path: loadedPlaylistPath,
            label: playlistTargetLabel(loadedPlaylistPath, loadedPlaylistName),
        };
    };

    const commitPlaybackSourceFromCurrentView = (): void => {
        if (selectedSource === 'playlist' && hasLoadedPlaylist()) {
            const playlistSequence = loadedPlaylistSequence();
            if (playlistSequence) {
                editableQueueTrackIndexes = playlistSequence.indexes.slice();
            }
            playbackSource = 'queue';
            return;
        }

        playbackSource = 'queue';
    };

    const loadFavouritePlaylistByIndex = async (favoriteIndex: number): Promise<void> => {
        const favoritePlaylists = options.getFavoritePlaylists().filter((playlistPath) => playlistPath.trim() !== '');
        if (!Number.isInteger(favoriteIndex) || favoriteIndex < 0 || favoriteIndex >= favoritePlaylists.length) {
            return;
        }

        selectedFavoriteIndex = favoriteIndex;
        await loadFavouritePlaylist(favoritePlaylists[favoriteIndex]);
        updateHeaderSourceControl();
        const favoriteValue = `favorite:${favoriteIndex}`;
        if (Array.from(playlistSource.options).some((option) => option.value === favoriteValue)) {
            playlistSource.value = favoriteValue;
        }
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
        const selectedValue = playlistSource.value;
        if (selectedValue === 'queue') {
            selectedSource = 'queue';
            selectedFavoriteIndex = null;
            playbackSource = 'queue';
            hydrateCurrentViewTracks();
            renderPlaylist();
            return;
        }

        if (selectedValue === 'playlist') {
            selectedSource = 'playlist';
            selectedFavoriteIndex = null;
            hydrateCurrentViewTracks();
            renderPlaylist();
            return;
        }

        const favoriteMatch = /^favorite:(\d+)$/.exec(selectedValue);
        if (favoriteMatch) {
            const favoriteIndex = Number(favoriteMatch[1]);
            void loadFavouritePlaylistByIndex(favoriteIndex).catch((error) => {
                console.error(error);
            });
        }
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
            const activeQueue = mutableCurrentSequence();
            const removePosition = Number(removeButton.dataset.playlistRemovePosition);
            if (!Number.isInteger(removePosition)) {
                return;
            }

            activeQueue.splice(removePosition, 1);
            if (loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length === 0) {
                loadedPlaylistTrackIndexes = null;
                loadedPlaylistName = '';
                selectedSource = 'queue';
            }

            if (editableQueueTrackIndexes && editableQueueTrackIndexes.length === 0) {
                editableQueueTrackIndexes = null;
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
            source: selectedSource,
            userInitiated: true,
        }).then(() => {
            renderPlaylist();
        });
    });

    playlistList.addEventListener('dragstart', (event) => {
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
            if (playbackSource === 'playlist') {
                return loadedPlaylistSequence();
            }

            if (editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) {
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
        appendTracksToPlaylist,
        openPlaylistTarget,
        createPlaylistTarget,
        loadPlaylistByPath,
    };
};

