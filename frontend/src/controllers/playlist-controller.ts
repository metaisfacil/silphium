import type { PlaylistMenuElements } from '../components/overlays/playlist-menu';
import type { PlaylistModalElements } from '../components/overlays/playlist-modal';

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
    ensureTrackTagsResolved: (index: number) => Promise<void>;
    selectPlaylistFile: () => Promise<string>;
    selectPlaylistSaveFile: () => Promise<string>;
    loadPlaylistData: (playlistPath: string) => Promise<LoadedPlaylistData | null>;
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => Promise<boolean>;
    onTrackChosen: (index: number) => Promise<void>;
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
        playlistList,
        playlistAddCurrent,
        playlistSaveAs,
    } = modal;

    let loadedPlaylistTrackIndexes: number[] | null = null;
    let loadedPlaylistName = '';
    let editableQueueTrackIndexes: number[] | null = null;
    let hydrationRunId = 0;
    let dragFromPosition: number | null = null;
    let selectedSource: PlaylistSource = 'queue';

    const hasLoadedPlaylist = (): boolean => Boolean(loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length > 0);

    const loadedPlaylistSequence = (): PlaylistSequence | null => {
        if (!loadedPlaylistTrackIndexes || loadedPlaylistTrackIndexes.length === 0) {
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
        if (playlistSequence) {
            return {
                indexes: playlistSequence.indexes,
                currentPosition: playlistSequence.currentPosition,
            };
        }

        return options.getBaseSequence();
    };

    const currentSequence = (): PlaylistSequence => {
        if (selectedSource === 'playlist') {
            const playlistSequence = loadedPlaylistSequence();
            if (playlistSequence) {
                return playlistSequence;
            }
        }

        return queueSequence();
    };

    const updateHeaderSourceControl = (): void => {
        const queueLabel = `Playback Queue (${options.getPlaybackOrderLabel()})`;

        if (!hasLoadedPlaylist()) {
            selectedSource = 'queue';
            playlistSource.hidden = true;
            playlistTitle.hidden = false;
            playlistTitle.textContent = queueLabel;
            return;
        }

        const playlistLabel = `Playlist: ${loadedPlaylistName || 'M3U/M3U8'}`;
        const expectedOptions = [
            { value: 'queue', label: queueLabel },
            { value: 'playlist', label: playlistLabel },
        ];

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
        playlistSource.value = selectedSource;
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
        playlistModal.hidden = true;
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
                ? '• '
                : (activePosition >= 0 && actualPosition < activePosition ? '◀ ' : '▶ ');
            const label = track?.displayTitle || track?.name || 'Unknown track';
            const secondary = track?.displayArtist || '';

            return `<li class="playlist-row" draggable="true" data-playlist-position="${actualPosition}">
            <button class="playlist-drag-handle" type="button" aria-label="Drag track" title="Drag to reorder">☰</button>
            <span class="playlist-position-indicator">#${actualPosition + 1}</span>
            <button class="playlist-item${activeClass}" data-playlist-track-index="${trackIndex}" data-playlist-position="${actualPosition}"><span class="playlist-item-main"><span class="playlist-item-prefix">${prefix}</span><span class="playlist-item-label">${label}</span></span><span class="playlist-item-sub">${secondary}</span></button>
            <button class="playlist-remove" type="button" data-playlist-remove-position="${actualPosition}" aria-label="Remove track" title="Remove track">✕</button>
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
        const pending = Array.from(new Set(trackIndexes)).filter((index) => {
            if (index < 0 || index >= options.getTrackCount()) {
                return false;
            }

            return !options.getTrack(index)?.tagsResolved;
        });

        if (pending.length === 0) {
            return;
        }

        const workerCount = Math.min(4, pending.length);
        let cursor = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                if (runId !== hydrationRunId) {
                    return;
                }

                const nextCursor = cursor;
                cursor += 1;
                if (nextCursor >= pending.length) {
                    return;
                }

                await options.ensureTrackTagsResolved(pending[nextCursor]);
                if (runId !== hydrationRunId) {
                    return;
                }

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
        hydrateCurrentViewTracks();
        renderPlaylist();
        playlistModal.hidden = false;
    };

    const mutableCurrentSequence = (): number[] => {
        if (selectedSource === 'playlist' && loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length > 0) {
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
            queue.splice(insertAt, 0, ...normalizedTrackIndexes);
        } else {
            queue.push(...normalizedTrackIndexes);
        }

        hydrateTrackMetadataInBackground(normalizedTrackIndexes);
        scheduleRender();
    };

    const getNextTrackIndex = (direction: PlaylistDirection): number | undefined => {
        const currentTrackIndex = options.getCurrentTrackIndex();

        if (selectedSource === 'playlist') {
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

            const nextPosition = (currentPosition + direction + queueIndexes.length) % queueIndexes.length;
            return queueIndexes[nextPosition];
        }

        return undefined;
    };

    const clearEditableQueue = (): void => {
        editableQueueTrackIndexes = null;
        scheduleRender();
    };

    const resetState = (): void => {
        loadedPlaylistTrackIndexes = null;
        loadedPlaylistName = '';
        editableQueueTrackIndexes = null;
        selectedSource = 'queue';
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

            const loadedPlaylist = await options.loadPlaylistData(selectedPath);
            if (!loadedPlaylist || loadedPlaylist.trackIndexes.length === 0) {
                return;
            }

            loadedPlaylistTrackIndexes = loadedPlaylist.trackIndexes;
            loadedPlaylistName = loadedPlaylist.name || '';
            editableQueueTrackIndexes = null;
            selectedSource = 'playlist';
            dragFromPosition = null;
            options.onExternalPlaylistLoaded();
            hydrateTrackMetadataInBackground(loadedPlaylist.trackIndexes);
            await options.onTrackChosen(loadedPlaylist.trackIndexes[0]);
            openModal();
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
        updateHeaderSourceControl();
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
        selectedSource = playlistSource.value === 'playlist' ? 'playlist' : 'queue';
        hydrateCurrentViewTracks();
        renderPlaylist();
    });

    playlistLoadBtn.addEventListener('click', () => {
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

        void options.onTrackChosen(trackIndex).then(() => {
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
        clearEditableQueue,
        closeMenu,
        closeModal,
        getNextTrackIndex,
        getSequenceOverride: (): PlaylistSequence | null => {
            if (selectedSource === 'playlist') {
                return loadedPlaylistSequence();
            }

            if ((editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) || hasLoadedPlaylist()) {
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
        resetState,
        scheduleRender,
    };
};
