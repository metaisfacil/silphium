import type { PlaylistTargetModalElements } from '../components/overlays/playlist-target-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { PlaylistTargetOption } from './playlist-controller';

type PlaylistTargetModalRequest = {
    title: string;
    message: string;
    confirmLabel?: string;
    getPlaylists: () => PlaylistTargetOption[];
    onOpenPlaylist?: () => Promise<PlaylistTargetOption | null>;
    onCreatePlaylist?: () => Promise<PlaylistTargetOption | null>;
    emptyStateMessage?: string;
    duplicatePreventionLabel?: string;
    duplicatePreventionCheckedByDefault?: boolean;
};

export type PlaylistTargetModalPromptResult = {
    selectedPath: string;
    duplicatePreventionEnabled: boolean;
};

export type PlaylistTargetModalController = ReturnType<typeof createPlaylistTargetModalController>;

export const createPlaylistTargetModalController = (elements: PlaylistTargetModalElements) => {
    const {
        playlistTargetModal,
        playlistTargetBackdrop,
        playlistTargetClose,
        playlistTargetTitle,
        playlistTargetMessage,
        playlistTargetSelect,
        playlistTargetDuplicateWrap,
        playlistTargetDuplicateCheckbox,
        playlistTargetHint,
        playlistTargetOpen,
        playlistTargetCreate,
        playlistTargetCancel,
        playlistTargetConfirm,
    } = elements;

    const modalTransitionMs = UI_TIMINGS_MS.modalTransition;
    let playlistTargetModalHideTimer: number | undefined;
    let promptResolver: ((result: PlaylistTargetModalPromptResult | null) => void) | null = null;
    let activeRequest: PlaylistTargetModalRequest | null = null;
    let actionPending = false;

    const syncActionButtons = (): void => {
        const openAvailable = activeRequest !== null && typeof activeRequest.onOpenPlaylist === 'function';
        const createAvailable = activeRequest !== null && typeof activeRequest.onCreatePlaylist === 'function';
        playlistTargetOpen.hidden = !openAvailable;
        playlistTargetCreate.hidden = !createAvailable;
        playlistTargetOpen.disabled = actionPending;
        playlistTargetCreate.disabled = actionPending;
    };

    const populatePlaylistOptions = (playlists: PlaylistTargetOption[], selectedPath = ''): void => {
        playlistTargetSelect.innerHTML = '';

        playlists.forEach((playlist) => {
            const option = document.createElement('option');
            option.value = playlist.path;
            option.text = playlist.label;
            playlistTargetSelect.append(option);
        });

        const hasPlaylists = playlists.length > 0;
        playlistTargetSelect.disabled = !hasPlaylists;
        playlistTargetConfirm.disabled = !hasPlaylists || actionPending;
        playlistTargetConfirm.setAttribute('aria-disabled', (!hasPlaylists || actionPending) ? 'true' : 'false');

        if (!hasPlaylists) {
            playlistTargetHint.hidden = false;
            playlistTargetHint.textContent = activeRequest?.emptyStateMessage?.trim() || 'No playlists are available yet.';
            return;
        }

        const normalizedSelectedPath = selectedPath.trim();
        const hasSelectedOption = normalizedSelectedPath !== '' && playlists.some((playlist) => playlist.path === normalizedSelectedPath);
        playlistTargetSelect.value = hasSelectedOption ? normalizedSelectedPath : playlists[0].path;
        playlistTargetHint.hidden = true;
        playlistTargetHint.textContent = '';
    };

    const refreshPlaylistOptions = (selectedPath = ''): void => {
        populatePlaylistOptions(activeRequest?.getPlaylists() || [], selectedPath);
    };

    const resolvePrompt = (result: PlaylistTargetModalPromptResult | null): void => {
        if (!promptResolver) {
            return;
        }

        const resolver = promptResolver;
        promptResolver = null;
        resolver(result);
    };

    const close = (result: PlaylistTargetModalPromptResult | null = null): void => {
        playlistTargetModal.classList.remove('is-visible');
        activeRequest = null;
        actionPending = false;
        syncActionButtons();

        if (playlistTargetModalHideTimer !== undefined) {
            window.clearTimeout(playlistTargetModalHideTimer);
        }

        playlistTargetModalHideTimer = window.setTimeout(() => {
            playlistTargetModal.hidden = true;
            playlistTargetModalHideTimer = undefined;
        }, modalTransitionMs);

        resolvePrompt(result);
    };

    const prompt = (request: PlaylistTargetModalRequest): Promise<PlaylistTargetModalPromptResult | null> => {
        resolvePrompt(null);

        if (playlistTargetModalHideTimer !== undefined) {
            window.clearTimeout(playlistTargetModalHideTimer);
            playlistTargetModalHideTimer = undefined;
        }

        activeRequest = request;
        actionPending = false;
        playlistTargetTitle.textContent = request.title.trim() || 'Add to playlist';
        playlistTargetMessage.textContent = request.message.trim() || 'Choose a playlist.';
        playlistTargetConfirm.textContent = request.confirmLabel?.trim() || 'Add';
        const duplicatePreventionLabel = request.duplicatePreventionLabel?.trim() || '';
        playlistTargetDuplicateWrap.hidden = duplicatePreventionLabel === '';
        playlistTargetDuplicateCheckbox.checked = request.duplicatePreventionCheckedByDefault === true;
        const duplicateLabel = playlistTargetDuplicateWrap.querySelector('#playlist-target-duplicate-label');
        if (duplicateLabel instanceof HTMLSpanElement) {
            duplicateLabel.textContent = duplicatePreventionLabel;
        }
        syncActionButtons();
        refreshPlaylistOptions();

        playlistTargetModal.hidden = false;
        window.requestAnimationFrame(() => {
            playlistTargetModal.classList.add('is-visible');
            if (playlistTargetSelect.disabled) {
                playlistTargetCancel.focus();
                return;
            }

            playlistTargetSelect.focus();
        });

        return new Promise<PlaylistTargetModalPromptResult | null>((resolve) => {
            promptResolver = resolve;
        });
    };

    playlistTargetBackdrop.addEventListener('click', () => {
        close(null);
    });

    playlistTargetClose.addEventListener('click', () => {
        close(null);
    });

    playlistTargetCancel.addEventListener('click', () => {
        close(null);
    });

    const runPlaylistAction = async (action: (() => Promise<PlaylistTargetOption | null>) | undefined): Promise<void> => {
        if (!action || !activeRequest || actionPending) {
            return;
        }

        actionPending = true;
        syncActionButtons();
        playlistTargetConfirm.disabled = true;
        playlistTargetConfirm.setAttribute('aria-disabled', 'true');

        try {
            const selectedPlaylist = await action();
            if (!activeRequest) {
                return;
            }

            refreshPlaylistOptions(selectedPlaylist?.path || playlistTargetSelect.value);
            if (!playlistTargetSelect.disabled) {
                playlistTargetSelect.focus();
            }
        } finally {
            actionPending = false;
            syncActionButtons();
            const hasPlaylists = !playlistTargetSelect.disabled;
            playlistTargetConfirm.disabled = !hasPlaylists;
            playlistTargetConfirm.setAttribute('aria-disabled', hasPlaylists ? 'false' : 'true');
        }
    };

    playlistTargetOpen.addEventListener('click', () => {
        void runPlaylistAction(activeRequest?.onOpenPlaylist).catch((error) => {
            console.error(error);
        });
    });

    playlistTargetCreate.addEventListener('click', () => {
        void runPlaylistAction(activeRequest?.onCreatePlaylist).catch((error) => {
            console.error(error);
        });
    });

    playlistTargetConfirm.addEventListener('click', () => {
        if (playlistTargetConfirm.disabled) {
            return;
        }

        const selectedPath = playlistTargetSelect.value.trim();
        if (selectedPath === '') {
            return;
        }

        close({
            selectedPath,
            duplicatePreventionEnabled: !playlistTargetDuplicateWrap.hidden && playlistTargetDuplicateCheckbox.checked,
        });
    });

    return {
        close,
        prompt,
        handleEscape: (): boolean => {
            if (playlistTargetModal.hidden) {
                return false;
            }

            close(null);
            return true;
        },
        handleDocumentClick: (target: Node): boolean => {
            return !playlistTargetModal.hidden && playlistTargetModal.contains(target);
        },
    };
};