import {
    canvasToPngBlob,
    loadShareCanvasImage,
    renderShareImagePreview,
} from '../services/share-image-service';
import { deriveShareImageAccentPalette, type ShareImageAccentPalette } from '../utils/cover-accent-palette';
import { buildShareImageDefaultFilename, blobToBase64 } from '../utils/display-helpers';
import type { Track } from '../types/app-types';
import { UI_TIMINGS_MS } from '../constants/ui-timings';

export interface ShareControllerElements {
    shareModal: HTMLDivElement;
    shareBackdrop: HTMLElement;
    shareDialog: HTMLElement;
    shareClose: HTMLElement;
    sharePreview: HTMLCanvasElement;
    shareCommentInput: HTMLTextAreaElement;
    shareStatus: HTMLElement;
    shareSave: HTMLButtonElement;
    shareCopy: HTMLButtonElement;
}

export interface ShareControllerOptions {
    elements: ShareControllerElements;
    getCurrentTrack: () => { track: Track; index: number } | undefined;
    ensureTrackTagsResolved: (index: number) => Promise<void>;
    trackIndexForPath: (path: string) => number;
    getTrack: (index: number) => Track | undefined;
    resolveCoverForTrack: (track: Track) => Promise<string | undefined>;
    getCachedMediaArtwork: (track: Track) => { src: string } | undefined;
    getCoverArtSrc: () => string | undefined;
    closeOtherMenus: () => void;
    selectShareImageSaveFile: (defaultName: string) => Promise<string>;
    saveShareImageFile: (path: string, base64: string) => Promise<boolean>;
}

export interface ShareController {
    open: () => Promise<void>;
    close: () => void;
    renderPreview: () => void;
    savePreview: () => Promise<void>;
    copyPreview: () => Promise<void>;
    setStatus: (message: string, tone?: '' | 'success' | 'error') => void;
}

export const createShareController = (options: ShareControllerOptions): ShareController => {
    const {
        elements: {
            shareModal, shareDialog, sharePreview, shareCommentInput,
            shareStatus, shareSave, shareCopy,
        },
    } = options;

    const shareModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const defaultShareImageComment = 'Listening right now.';
    let shareModalHideTimer: number | undefined;
    let sharePreviewRequestVersion = 0;
    let sharePreviewSnapshot: {
        title: string;
        album: string;
        artist: string;
        trackPath: string;
        coverImage?: ImageBitmap;
        accents: ShareImageAccentPalette;
    } | null = null;

    const clearSharePreviewSnapshot = (): void => {
        if (sharePreviewSnapshot?.coverImage) {
            sharePreviewSnapshot.coverImage.close();
        }
        sharePreviewSnapshot = null;
    };

    const clearSharePreviewCanvas = (message = 'Generating preview...'): void => {
        const context = sharePreview.getContext('2d');
        if (!context) {
            return;
        }
        context.clearRect(0, 0, sharePreview.width, sharePreview.height);
        context.fillStyle = '#12151d';
        context.fillRect(0, 0, sharePreview.width, sharePreview.height);
        context.fillStyle = 'rgba(255, 255, 255, 0.72)';
        context.font = '600 20px "Nunito", "Segoe UI", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(message, sharePreview.width / 2, sharePreview.height / 2);
    };

    const setShareActionsDisabled = (disabled: boolean): void => {
        shareSave.disabled = disabled;
        shareCopy.disabled = disabled;
    };

    const setShareStatus = (message: string, tone: '' | 'success' | 'error' = ''): void => {
        shareStatus.textContent = message;
        if (tone) {
            shareStatus.dataset.tone = tone;
            return;
        }
        delete shareStatus.dataset.tone;
    };

    const renderSharePreviewSnapshot = (): void => {
        if (!sharePreviewSnapshot) {
            return;
        }
        renderShareImagePreview(sharePreview, {
            title: sharePreviewSnapshot.title,
            album: sharePreviewSnapshot.album,
            artist: sharePreviewSnapshot.artist,
            comment: shareCommentInput.value,
            coverImage: sharePreviewSnapshot.coverImage,
            accents: sharePreviewSnapshot.accents,
        });
    };

    const resolveShareCoverSource = async (track: Track): Promise<string | undefined> => {
        const coverArtSrc = options.getCoverArtSrc();
        const current = options.getCurrentTrack();
        if (current && current.track.path === track.path && coverArtSrc) {
            return coverArtSrc;
        }
        const resolved = await options.resolveCoverForTrack(track);
        return options.getCachedMediaArtwork(track)?.src || resolved;
    };

    const close = (): void => {
        sharePreviewRequestVersion += 1;
        shareModal.classList.remove('is-visible');

        if (shareModalHideTimer !== undefined) {
            window.clearTimeout(shareModalHideTimer);
        }

        shareModalHideTimer = window.setTimeout(() => {
            clearSharePreviewSnapshot();
            clearSharePreviewCanvas('Share current track');
            shareModal.hidden = true;
            shareModalHideTimer = undefined;
        }, shareModalTransitionMs);
    };

    const open = async (): Promise<void> => {
        const current = options.getCurrentTrack();
        if (!current) {
            return;
        }

        options.closeOtherMenus();

        if (shareModalHideTimer !== undefined) {
            window.clearTimeout(shareModalHideTimer);
            shareModalHideTimer = undefined;
        }

        const selectedTrack = current.track;
        const requestVersion = ++sharePreviewRequestVersion;
        clearSharePreviewSnapshot();
        shareCommentInput.value = defaultShareImageComment;
        clearSharePreviewCanvas();
        setShareStatus('Generating preview...');
        setShareActionsDisabled(true);
        shareDialog.scrollTop = 0;
        shareModal.hidden = false;
        window.requestAnimationFrame(() => {
            shareModal.classList.add('is-visible');
            shareCommentInput.focus({ preventScroll: true });
            shareCommentInput.setSelectionRange(shareCommentInput.value.length, shareCommentInput.value.length);
        });

        try {
            const selectedTrackPath = selectedTrack.path;
            try {
                await options.ensureTrackTagsResolved(current.index);
            } catch (error) {
                console.error(error);
            }

            const resolvedIndex = options.trackIndexForPath(selectedTrackPath);
            const track = resolvedIndex >= 0 ? (options.getTrack(resolvedIndex) || selectedTrack) : selectedTrack;
            const coverSource = await resolveShareCoverSource(track);
            const coverImage = await loadShareCanvasImage(coverSource);
            if (requestVersion !== sharePreviewRequestVersion) {
                coverImage?.close();
                return;
            }
            const accents = deriveShareImageAccentPalette(coverImage);

            sharePreviewSnapshot = {
                title: track.displayTitle || track.title || track.name || 'Unknown Title',
                album: track.displayAlbum || 'Unknown Album',
                artist: track.displayArtist || 'Unknown Artist',
                trackPath: track.path,
                coverImage,
                accents,
            };
            renderSharePreviewSnapshot();
            setShareStatus('');
        } catch (error) {
            console.error(error);
            clearSharePreviewSnapshot();
            clearSharePreviewCanvas('Unable to render preview');
            setShareStatus('Unable to generate share preview.', 'error');
        } finally {
            if (requestVersion === sharePreviewRequestVersion) {
                setShareActionsDisabled(false);
            }
        }
    };

    const savePreview = async (): Promise<void> => {
        if (!sharePreviewSnapshot) {
            return;
        }

        setShareActionsDisabled(true);
        setShareStatus('Saving image...');

        try {
            const blob = await canvasToPngBlob(sharePreview);
            const targetPath = await options.selectShareImageSaveFile(buildShareImageDefaultFilename(
                sharePreviewSnapshot.artist,
                sharePreviewSnapshot.album,
                sharePreviewSnapshot.title,
            ));
            if (targetPath === '') {
                setShareStatus('');
                return;
            }

            const saved = await options.saveShareImageFile(targetPath, await blobToBase64(blob));
            if (!saved) {
                setShareStatus('Unable to save the share image.', 'error');
                return;
            }

            setShareStatus('Saved image.', 'success');
        } catch (error) {
            console.error(error);
            setShareStatus('Unable to save the share image.', 'error');
        } finally {
            setShareActionsDisabled(false);
        }
    };

    const copyPreview = async (): Promise<void> => {
        if (!sharePreviewSnapshot) {
            return;
        }

        setShareActionsDisabled(true);
        setShareStatus('Copying image...');

        try {
            const blob = await canvasToPngBlob(sharePreview);
            const clipboard = navigator.clipboard as Clipboard & { write?: (items: unknown[]) => Promise<void> };
            const clipboardItemCtor = (window as Window & {
                ClipboardItem?: new (items: Record<string, Blob>) => unknown;
            }).ClipboardItem;

            if (!clipboard.write || !clipboardItemCtor) {
                throw new Error('Clipboard image copy is not available in this environment');
            }

            await clipboard.write([new clipboardItemCtor({ 'image/png': blob })]);
            setShareStatus('Copied image to clipboard.', 'success');
        } catch (error) {
            console.error(error);
            setShareStatus('Unable to copy the share image.', 'error');
        } finally {
            setShareActionsDisabled(false);
        }
    };

    return {
        open,
        close,
        renderPreview: renderSharePreviewSnapshot,
        savePreview,
        copyPreview,
        setStatus: setShareStatus,
    };
};
