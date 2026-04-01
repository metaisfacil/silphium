import type { PlaylistMenuElements } from '../components/overlays/playlist-menu';
import type { PlaylistModalElements } from '../components/overlays/playlist-modal';

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
};

type PlaylistControllerOptions = {
    trigger: HTMLButtonElement;
    menu: PlaylistMenuElements;
    modal: PlaylistModalElements;
    getTrack: (index: number) => PlaylistTrackView | undefined;
    getTrackCount: () => number;
    getCurrentTrackIndex: () => number;
    getPlaybackOrderLabel: () => string;
    getBaseSequence: () => PlaylistSequence;
    ensureTrackTagsResolved: (index: number) => Promise<void>;
    selectPlaylistFile: () => Promise<string>;
    loadPlaylistData: (playlistPath: string) => Promise<LoadedPlaylistData | null>;
    onTrackChosen: (index: number) => Promise<void>;
    onExternalPlaylistLoaded: () => void;
};

export type PlaylistController = ReturnType<typeof createPlaylistController>;

export const createPlaylistController = (options: PlaylistControllerOptions) => {
    const { trigger, menu, modal } = options;
    const { playlistMenu, playlistLoadBtn } = menu;
    const { playlistModal, playlistBackdrop, playlistClose, playlistTitle, playlistList } = modal;

    let loadedPlaylistTrackIndexes: number[] | null = null;
    let loadedPlaylistName = '';
    let editableQueueTrackIndexes: number[] | null = null;
    let hydrationRunId = 0;
    let dragFromPosition: number | null = null;

    const getSequenceOverride = (): PlaylistSequence | null => {
        const currentTrackIndex = options.getCurrentTrackIndex();

        if (loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length > 0) {
            const currentPosition = loadedPlaylistTrackIndexes.indexOf(currentTrackIndex);
            return {
                indexes: loadedPlaylistTrackIndexes,
                currentPosition: currentPosition >= 0 ? currentPosition : 0,
            };
        }

        if (editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) {
            const currentPosition = editableQueueTrackIndexes.indexOf(currentTrackIndex);
            return {
                indexes: editableQueueTrackIndexes,
                currentPosition: currentPosition >= 0 ? currentPosition : 0,
            };
        }

        return null;
    };

    const currentSequence = (): PlaylistSequence => getSequenceOverride() ?? options.getBaseSequence();

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
        const { indexes, currentPosition } = currentSequence();
        const currentTrackIndex = options.getCurrentTrackIndex();
        const activePosition = indexes.indexOf(currentTrackIndex);
        const anchorPosition = activePosition >= 0 ? activePosition : currentPosition;
        const isExternalPlaylist = loadedPlaylistTrackIndexes !== null;
        const start = isExternalPlaylist ? 0 : Math.max(0, anchorPosition - 50);
        const end = isExternalPlaylist ? indexes.length : Math.min(indexes.length, anchorPosition + 51);
        const visibleIndexes = indexes.slice(start, end);

        playlistTitle.textContent = isExternalPlaylist
            ? `Playlist: ${loadedPlaylistName || 'M3U/M3U8'}`
            : `Playback Queue (${options.getPlaybackOrderLabel()})`;

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

    const openModal = (): void => {
        if (loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length > 0) {
            hydrateTrackMetadataInBackground(loadedPlaylistTrackIndexes);
        } else if (editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) {
            hydrateTrackMetadataInBackground(editableQueueTrackIndexes);
        } else {
            const { indexes, currentPosition } = currentSequence();
            const start = Math.max(0, currentPosition - 50);
            const end = Math.min(indexes.length, currentPosition + 51);
            hydrateTrackMetadataInBackground(indexes.slice(start, end));
        }

        renderPlaylist();
        playlistModal.hidden = false;
    };

    const ensureEditableQueue = (): number[] => {
        if (loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length > 0) {
            return loadedPlaylistTrackIndexes;
        }

        if (editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) {
            return editableQueueTrackIndexes;
        }

        editableQueueTrackIndexes = options.getBaseSequence().indexes.slice();
        return editableQueueTrackIndexes;
    };

    const getNextTrackIndex = (direction: PlaylistDirection): number | undefined => {
        const currentTrackIndex = options.getCurrentTrackIndex();

        if (loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length > 0) {
            const currentPosition = loadedPlaylistTrackIndexes.indexOf(currentTrackIndex);
            if (currentPosition < 0) {
                return loadedPlaylistTrackIndexes[0];
            }

            const nextPosition = (currentPosition + direction + loadedPlaylistTrackIndexes.length) % loadedPlaylistTrackIndexes.length;
            return loadedPlaylistTrackIndexes[nextPosition];
        }

        if (editableQueueTrackIndexes && editableQueueTrackIndexes.length > 0) {
            const currentPosition = editableQueueTrackIndexes.indexOf(currentTrackIndex);
            if (currentPosition < 0) {
                return editableQueueTrackIndexes[0];
            }

            const nextPosition = (currentPosition + direction + editableQueueTrackIndexes.length) % editableQueueTrackIndexes.length;
            return editableQueueTrackIndexes[nextPosition];
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
            dragFromPosition = null;
            options.onExternalPlaylistLoaded();
            hydrateTrackMetadataInBackground(loadedPlaylist.trackIndexes);
            await options.onTrackChosen(loadedPlaylist.trackIndexes[0]);
            openModal();
        } catch (error) {
            console.error(error);
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

    playlistLoadBtn.addEventListener('click', () => {
        void loadSelectedPlaylist();
    });

    playlistBackdrop.addEventListener('click', () => {
        closeModal();
    });

    playlistClose.addEventListener('click', () => {
        closeModal();
    });

    playlistList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const removeButton = target.closest('[data-playlist-remove-position]');
        if (removeButton instanceof HTMLButtonElement) {
            const activeQueue = ensureEditableQueue();
            const removePosition = Number(removeButton.dataset.playlistRemovePosition);
            if (!Number.isInteger(removePosition)) {
                return;
            }

            activeQueue.splice(removePosition, 1);
            if (loadedPlaylistTrackIndexes && loadedPlaylistTrackIndexes.length === 0) {
                loadedPlaylistTrackIndexes = null;
                loadedPlaylistName = '';
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
        const activeQueue = ensureEditableQueue();
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
        const activeQueue = loadedPlaylistTrackIndexes ?? editableQueueTrackIndexes;
        if (!activeQueue || activeQueue.length === 0) {
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
        const activeQueue = ensureEditableQueue();
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
        getSequenceOverride,
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