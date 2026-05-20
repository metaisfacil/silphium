import {
    canvasToPngBlob,
    loadShareCanvasImage,
    renderShareImagePreview,
} from '../services/share-image-service';
import { deriveShareImageAccentPalette, type ShareImageAccentPalette } from '../utils/cover-accent-palette';
import { buildShareImageDefaultFilename, blobToBase64 } from '../utils/display-helpers';
import { lookupMusicBrainzEntity } from '../utils/musicbrainz-entity-helpers';
import type { ArtistExternalUrl, AudioVisualizationFrame, Track } from '../types/app-types';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import { faviconUrlForResource } from '../utils/musicbrainz-entity-helpers';

const shareLinkFallbackIconMarkup = '<svg class="overlay-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M8.71 15.29C7.93 14.51 7.93 13.24 8.71 12.46L12.46 8.71C13.24 7.93 14.51 7.93 15.29 8.71C16.07 9.49 16.07 10.76 15.29 11.54L14.37 12.46C13.98 12.85 13.98 13.48 14.37 13.87C14.76 14.26 15.39 14.26 15.78 13.87L16.7 12.95C18.27 11.39 18.27 8.86 16.7 7.29C15.14 5.73 12.61 5.73 11.05 7.29L7.29 11.05C5.73 12.61 5.73 15.14 7.29 16.7C8.86 18.27 11.39 18.27 12.95 16.7L13.87 15.78C14.26 15.39 14.26 14.76 13.87 14.37C13.48 13.98 12.85 13.98 12.46 14.37L11.54 15.29C10.76 16.07 9.49 16.07 8.71 15.29Z"/></svg>';

const shareStreamingRelationTypes = new Set([
    'apple music',
    'bandcamp',
    'free streaming',
    'streaming',
    'youtube music',
]);

const shareStreamingServiceHosts = [
    { host: 'open.spotify.com', label: 'Spotify' },
    { host: 'spotify.link', label: 'Spotify' },
    { host: 'music.apple.com', label: 'Apple Music' },
    { host: 'music.youtube.com', label: 'YouTube Music' },
    { host: 'deezer.com', label: 'Deezer' },
    { host: 'tidal.com', label: 'TIDAL' },
    { host: 'listen.tidal.com', label: 'TIDAL' },
    { host: 'bandcamp.com', label: 'Bandcamp' },
    { host: 'soundcloud.com', label: 'SoundCloud' },
    { host: 'music.amazon.com', label: 'Amazon Music' },
    { host: 'audiomack.com', label: 'Audiomack' },
] as const;

const normalizeShareUrlType = (rawType?: string): string => {
    const trimmed = (rawType || '').trim();
    return trimmed.toLowerCase();
};

const hostForShareUrl = (resource: string): string => {
    const trimmed = resource.trim();
    if (trimmed === '') {
        return '';
    }

    try {
        const parsed = new URL(trimmed);
        return parsed.hostname.toLowerCase();
    } catch {
        return '';
    }
};

const matchStreamingServiceHost = (host: string): (typeof shareStreamingServiceHosts)[number] | undefined => (
    shareStreamingServiceHosts.find((candidate) => host === candidate.host || host.endsWith(`.${candidate.host}`))
);

const shareUrlLabel = (url: ArtistExternalUrl): string => {
    const normalizedType = normalizeShareUrlType(url.type);
    const rawType = (url.type || '').trim();
    if (rawType !== '' && normalizedType !== 'streaming' && normalizedType !== 'free streaming') {
        return rawType;
    }

    const host = hostForShareUrl(url.resource);
    return matchStreamingServiceHost(host)?.label || rawType || 'Streaming link';
};

const isStreamingServiceUrl = (url: ArtistExternalUrl): boolean => {
    const normalizedType = normalizeShareUrlType(url.type);
    if (shareStreamingRelationTypes.has(normalizedType)) {
        return true;
    }

    const host = hostForShareUrl(url.resource);
    return host !== '' && matchStreamingServiceHost(host) !== undefined;
};

const filterShareStreamingUrls = (urls: ArtistExternalUrl[]): ArtistExternalUrl[] => {
    const dedupedUrls: ArtistExternalUrl[] = [];
    const seenResources = new Set<string>();

    for (const url of urls) {
        const resource = url.resource.trim();
        if (resource === '' || !isStreamingServiceUrl(url)) {
            continue;
        }

        const dedupeKey = resource.toLowerCase();
        if (seenResources.has(dedupeKey)) {
            continue;
        }

        seenResources.add(dedupeKey);
        dedupedUrls.push({
            type: (url.type || '').trim(),
            resource,
        });
    }

    return dedupedUrls;
};

const copyableShareResources = (urls: ArtistExternalUrl[]): string => (
    urls
        .map(({ resource }) => resource.trim())
        .filter((resource) => resource !== '')
        .join('\n')
);

const splitShareGenreTagValues = (values: string[]): string[] => values
    .flatMap((value) => value.split(';'))
    .map((value) => value.trim())
    .filter((value) => value !== '');

const normalizeShareGenreList = (values: string[]): string[] => {
    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
        const cleanValue = value.trim();
        if (cleanValue === '') {
            continue;
        }

        const dedupeKey = cleanValue.toLowerCase();
        if (seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        normalized.push(cleanValue);
    }

    return normalized;
};

const extractShareGenresFromTrackTags = (track: Track): string[] => {
    const genreTagValues: string[] = [];

    for (const [tagName, values] of Object.entries(track.allFileTags || {})) {
        const normalizedTagName = tagName.trim().toLowerCase();
        if (normalizedTagName !== 'genre' && normalizedTagName !== 'style') {
            continue;
        }

        genreTagValues.push(...splitShareGenreTagValues(values || []));
    }

    return normalizeShareGenreList(genreTagValues);
};

const resolveSharePreviewGenres = async (track: Track): Promise<string[]> => {
    const trackGenres = extractShareGenresFromTrackTags(track);
    if (trackGenres.length > 0) {
        return trackGenres;
    }

    const recordingID = track.mbIds.recordingId?.trim() || '';
    if (recordingID === '') {
        return [];
    }

    try {
        const recordingEntity = await lookupMusicBrainzEntity('recording', recordingID);
        return normalizeShareGenreList(recordingEntity.tags || []);
    } catch (error) {
        console.error(error);
        return [];
    }
};

export interface ShareControllerElements {
    shareModal: HTMLDivElement;
    shareBackdrop: HTMLElement;
    shareDialog: HTMLElement;
    shareClose: HTMLElement;
    sharePreview: HTMLCanvasElement;
    shareStreamingLinksRegion: HTMLDivElement;
    shareStreamingLinks: HTMLDivElement;
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
    copyShareImageToClipboard: (base64: string) => Promise<boolean>;
    lookupMusicBrainzRecordingURLs: (mbid: string) => Promise<ArtistExternalUrl[]>;
    openUrl: (url: string) => unknown;
    fetchVisualizationFrame: (frameCount: number) => Promise<AudioVisualizationFrame>;
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
            shareModal, shareDialog, sharePreview, shareStreamingLinksRegion,
            shareStreamingLinks, shareCommentInput,
            shareStatus, shareSave, shareCopy,
        },
    } = options;
    const ownerDocument = shareModal.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;

    const shareModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const shareStreamingLinksTransitionMs = 180;
    const defaultShareImageComment = 'Listening right now.';
    const shareWaveformFrameCount = 1536;
    let shareModalHideTimer: number | undefined;
    let shareStreamingLinksResetTimer: number | undefined;
    let sharePreviewRequestVersion = 0;
    let shareStreamingUrls: ArtistExternalUrl[] = [];
    let shareLinksContextMenuLinkText = '';
    let sharePreviewSnapshot: {
        title: string;
        album: string;
        artist: string;
        genres: string[];
        trackPath: string;
        coverImage?: ImageBitmap;
        accents: ShareImageAccentPalette;
        waveformSamples?: number[];
    } | null = null;
    const shareLinksContextMenu = ownerDocument.createElement('div');

    shareLinksContextMenu.className = 'artist-info-links-context-menu';
    shareLinksContextMenu.hidden = true;
    shareLinksContextMenu.setAttribute('role', 'menu');
    shareLinksContextMenu.setAttribute('aria-label', 'Share link actions');
    ownerDocument.body.append(shareLinksContextMenu);

    const clearSharePreviewSnapshot = (): void => {
        if (sharePreviewSnapshot?.coverImage) {
            sharePreviewSnapshot.coverImage.close();
        }
        sharePreviewSnapshot = null;
    };

    const clearShareStreamingLinksResetTimer = (): void => {
        if (shareStreamingLinksResetTimer !== undefined) {
            ownerWindow.clearTimeout(shareStreamingLinksResetTimer);
            shareStreamingLinksResetTimer = undefined;
        }
    };

    const closeShareLinksContextMenu = (): void => {
        shareLinksContextMenu.hidden = true;
        shareLinksContextMenu.replaceChildren();
        shareLinksContextMenuLinkText = '';
    };

    const fallbackCopyTextToClipboard = (text: string): void => {
        const textarea = ownerDocument.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        ownerDocument.body.append(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        const copied = typeof ownerDocument.execCommand === 'function'
            ? ownerDocument.execCommand('copy')
            : false;

        textarea.remove();

        if (!copied) {
            throw new Error('Clipboard text copy is not available in this environment');
        }
    };

    const copyTextToClipboard = async (text: string): Promise<void> => {
        const clipboard = ownerWindow.navigator.clipboard as Clipboard | undefined;
        let browserClipboardError: unknown;

        if (clipboard?.writeText) {
            try {
                await clipboard.writeText(text);
                return;
            } catch (error) {
                browserClipboardError = error;
            }
        }

        try {
            fallbackCopyTextToClipboard(text);
        } catch (fallbackError) {
            if (browserClipboardError) {
                throw browserClipboardError;
            }

            throw fallbackError;
        }
    };

    const positionShareLinksContextMenu = (clientX: number, clientY: number): void => {
        const margin = 10;
        const rect = shareLinksContextMenu.getBoundingClientRect();
        const clampedX = Math.min(clientX, ownerWindow.innerWidth - rect.width - margin);
        const clampedY = Math.min(clientY, ownerWindow.innerHeight - rect.height - margin);

        shareLinksContextMenu.style.left = `${Math.max(margin, clampedX)}px`;
        shareLinksContextMenu.style.top = `${Math.max(margin, clampedY)}px`;
    };

    const openShareLinksContextMenu = (clientX: number, clientY: number, linkText: string): void => {
        shareLinksContextMenuLinkText = linkText.trim();
        const copyAllText = copyableShareResources(shareStreamingUrls);

        const handleShareContextAction = (action: 'copy-link' | 'copy-all'): void => {
            const copyText = action === 'copy-all'
                ? copyableShareResources(shareStreamingUrls)
                : shareLinksContextMenuLinkText;
            const successMessage = action === 'copy-all' ? 'Copied all links.' : 'Copied link.';
            if (copyText === '') {
                closeShareLinksContextMenu();
                return;
            }

            closeShareLinksContextMenu();
            void copyTextToClipboard(copyText).then(() => {
                setShareStatus(successMessage, 'success');
            }).catch((error) => {
                console.error(error);
                setShareStatus('Unable to copy the link.', 'error');
            });
        };

        const copyLinkButton = ownerDocument.createElement('button');
        copyLinkButton.className = 'artist-info-links-context-menu-item';
        copyLinkButton.type = 'button';
        copyLinkButton.setAttribute('role', 'menuitem');
        copyLinkButton.dataset.shareContextAction = 'copy-link';
        copyLinkButton.textContent = 'Copy link';
        copyLinkButton.disabled = shareLinksContextMenuLinkText === '';
        copyLinkButton.addEventListener('click', () => {
            handleShareContextAction('copy-link');
        });

        const copyAllButton = ownerDocument.createElement('button');
        copyAllButton.className = 'artist-info-links-context-menu-item';
        copyAllButton.type = 'button';
        copyAllButton.setAttribute('role', 'menuitem');
        copyAllButton.dataset.shareContextAction = 'copy-all';
        copyAllButton.textContent = 'Copy all';
        copyAllButton.disabled = copyAllText === '';
        copyAllButton.addEventListener('click', () => {
            handleShareContextAction('copy-all');
        });

        shareLinksContextMenu.replaceChildren(copyLinkButton, copyAllButton);
        shareLinksContextMenu.hidden = false;
        positionShareLinksContextMenu(clientX, clientY);
    };

    const resetShareStreamingLinks = (immediate = false): void => {
        clearShareStreamingLinksResetTimer();
        closeShareLinksContextMenu();
        shareStreamingUrls = [];
        shareStreamingLinks.replaceChildren();

        if (immediate || shareStreamingLinksRegion.hidden) {
            shareStreamingLinksRegion.classList.remove('is-visible');
            shareStreamingLinksRegion.hidden = true;
            shareStreamingLinksRegion.style.height = '0px';
            shareStreamingLinksRegion.style.opacity = '0';
            shareStreamingLinksRegion.style.marginBottom = '0px';
            return;
        }

        const currentHeight = shareStreamingLinksRegion.getBoundingClientRect().height || shareStreamingLinksRegion.scrollHeight;
        shareStreamingLinksRegion.style.height = `${currentHeight}px`;
        shareStreamingLinksRegion.style.opacity = '1';
        shareStreamingLinksRegion.style.marginBottom = '';

        void shareStreamingLinksRegion.offsetHeight;

        shareStreamingLinksRegion.classList.remove('is-visible');
        shareStreamingLinksRegion.style.height = '0px';
        shareStreamingLinksRegion.style.opacity = '0';
        shareStreamingLinksRegion.style.marginBottom = '0px';

        shareStreamingLinksResetTimer = ownerWindow.setTimeout(() => {
            if (!shareStreamingLinksRegion.classList.contains('is-visible')) {
                shareStreamingLinksRegion.hidden = true;
            }
            shareStreamingLinksResetTimer = undefined;
        }, shareStreamingLinksTransitionMs);
    };

    const animateShareStreamingLinksRegion = (): void => {
        clearShareStreamingLinksResetTimer();
        shareStreamingLinksRegion.hidden = false;
        shareStreamingLinksRegion.style.height = '0px';
        shareStreamingLinksRegion.style.opacity = '0';
        shareStreamingLinksRegion.style.marginBottom = '0px';

        ownerWindow.requestAnimationFrame(() => {
            const targetHeight = shareStreamingLinksRegion.scrollHeight;
            shareStreamingLinksRegion.classList.add('is-visible');
            shareStreamingLinksRegion.style.opacity = '1';
            shareStreamingLinksRegion.style.height = `${targetHeight}px`;

            shareStreamingLinksResetTimer = ownerWindow.setTimeout(() => {
                if (shareStreamingLinksRegion.classList.contains('is-visible')) {
                    shareStreamingLinksRegion.style.height = 'auto';
                }
                shareStreamingLinksResetTimer = undefined;
            }, shareStreamingLinksTransitionMs);
        });
    };

    const createShareStreamingLinkButton = (url: ArtistExternalUrl): HTMLButtonElement => {
        const button = ownerDocument.createElement('button');
        button.className = 'artist-link-btn';
        button.type = 'button';
        button.dataset.shareStreamingResource = url.resource;

        const fallback = ownerDocument.createElement('span');
        fallback.className = 'artist-link-fallback';
        fallback.innerHTML = shareLinkFallbackIconMarkup;

        const faviconUrl = faviconUrlForResource(url.resource);
        if (faviconUrl) {
            const icon = ownerDocument.createElement('img');
            icon.className = 'artist-link-icon';
            icon.alt = '';
            icon.loading = 'lazy';
            icon.decoding = 'async';
            icon.referrerPolicy = 'no-referrer';
            icon.src = faviconUrl;
            icon.addEventListener('error', () => {
                icon.remove();
                fallback.hidden = false;
            });
            fallback.hidden = true;
            button.append(icon, fallback);
        } else {
            fallback.hidden = false;
            button.append(fallback);
        }

        const label = shareUrlLabel(url);
        button.title = `${label}: ${url.resource}`;
        button.setAttribute('aria-label', button.title);
        button.setAttribute('role', 'listitem');
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            closeShareLinksContextMenu();
            void options.openUrl(url.resource);
        });
        button.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            openShareLinksContextMenu(event.clientX, event.clientY, url.resource);
        });

        return button;
    };

    const renderShareStreamingLinks = (urls: ArtistExternalUrl[]): void => {
        shareStreamingLinks.replaceChildren(...urls.map((url) => createShareStreamingLinkButton(url)));
        animateShareStreamingLinksRegion();
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
            genres: sharePreviewSnapshot.genres,
            comment: shareCommentInput.value,
            coverImage: sharePreviewSnapshot.coverImage,
            accents: sharePreviewSnapshot.accents,
            waveformSamples: sharePreviewSnapshot.waveformSamples,
        });
    };

    const resolvePreparedTrack = async (
        selectedTrack: Track,
        selectedIndex: number,
        requestVersion: number,
    ): Promise<Track | undefined> => {
        const selectedTrackPath = selectedTrack.path;

        try {
            await options.ensureTrackTagsResolved(selectedIndex);
        } catch (error) {
            console.error(error);
        }

        if (requestVersion !== sharePreviewRequestVersion) {
            return undefined;
        }

        const resolvedIndex = options.trackIndexForPath(selectedTrackPath);
        return resolvedIndex >= 0 ? (options.getTrack(resolvedIndex) || selectedTrack) : selectedTrack;
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

    const resolveShareWaveformSamples = async (trackPath: string): Promise<number[] | undefined> => {
        try {
            const frame = await options.fetchVisualizationFrame(shareWaveformFrameCount);
            if (!frame.loaded || frame.frameCount <= 0 || frame.samples.length < 2) {
                return undefined;
            }

            if (frame.sourcePath && frame.sourcePath !== trackPath) {
                return undefined;
            }

            const monoSamples: number[] = [];
            for (let index = 0; index + 1 < frame.samples.length; index += 2) {
                const left = frame.samples[index] || 0;
                const right = frame.samples[index + 1] || 0;
                const mono = (left + right) / 2;
                monoSamples.push(Math.max(0, Math.min(1, ((mono / 32768) * 0.5) + 0.5)));
            }

            return monoSamples.length >= 24 ? monoSamples : undefined;
        } catch {
            return undefined;
        }
    };

    const loadShareStreamingLinks = async (trackPromise: Promise<Track | undefined>, requestVersion: number): Promise<void> => {
        try {
            const track = await trackPromise;
            if (!track || requestVersion !== sharePreviewRequestVersion) {
                return;
            }

            const recordingID = track.mbIds.recordingId?.trim() || '';
            if (recordingID === '') {
                return;
            }

            const urls = filterShareStreamingUrls(await options.lookupMusicBrainzRecordingURLs(recordingID));
            if (requestVersion !== sharePreviewRequestVersion || urls.length === 0) {
                return;
            }

            shareStreamingUrls = urls;
            renderShareStreamingLinks(urls);
        } catch (error) {
            console.error(error);
        }
    };

    const close = (): void => {
        sharePreviewRequestVersion += 1;
        shareModal.classList.remove('is-visible');
        resetShareStreamingLinks(true);

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
        resetShareStreamingLinks(true);
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

        const preparedTrackPromise = resolvePreparedTrack(selectedTrack, current.index, requestVersion);
        void loadShareStreamingLinks(preparedTrackPromise, requestVersion);

        try {
            const track = await preparedTrackPromise;
            if (!track) {
                return;
            }

            const [coverSource, waveformSamples, genres] = await Promise.all([
                resolveShareCoverSource(track),
                resolveShareWaveformSamples(track.path),
                resolveSharePreviewGenres(track),
            ]);
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
                genres,
                trackPath: track.path,
                coverImage,
                accents,
                waveformSamples,
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

    const copyShareImageBlob = async (blob: Blob): Promise<void> => {
        const clipboard = navigator.clipboard as Clipboard & { write?: (items: unknown[]) => Promise<void> };
        const clipboardItemCtor = (window as Window & {
            ClipboardItem?: new (items: Record<string, Blob>) => unknown;
        }).ClipboardItem;
        let browserClipboardError: unknown;

        if (clipboard.write && clipboardItemCtor) {
            try {
                await clipboard.write([new clipboardItemCtor({ 'image/png': blob })]);
                return;
            } catch (error) {
                browserClipboardError = error;
            }
        }

        if (await options.copyShareImageToClipboard(await blobToBase64(blob))) {
            return;
        }

        if (browserClipboardError) {
            throw browserClipboardError;
        }

        throw new Error('Clipboard image copy is not available in this environment');
    };

    const copyPreview = async (): Promise<void> => {
        if (!sharePreviewSnapshot) {
            return;
        }

        setShareActionsDisabled(true);
        setShareStatus('Copying image...');

        try {
            const blob = await canvasToPngBlob(sharePreview);
            await copyShareImageBlob(blob);
            setShareStatus('Copied image to clipboard.', 'success');
        } catch (error) {
            console.error(error);
            setShareStatus('Unable to copy the share image.', 'error');
        } finally {
            setShareActionsDisabled(false);
        }
    };

    ownerDocument.addEventListener('pointerdown', (event) => {
        if (shareLinksContextMenu.hidden) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target?.closest('.artist-info-links-context-menu, .share-streaming-links .artist-link-btn')) {
            return;
        }

        closeShareLinksContextMenu();
    });

    ownerDocument.addEventListener('contextmenu', (event) => {
        if (shareLinksContextMenu.hidden) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target?.closest('.artist-info-links-context-menu, .share-streaming-links .artist-link-btn')) {
            return;
        }

        closeShareLinksContextMenu();
    });

    ownerDocument.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeShareLinksContextMenu();
        }
    });

    return {
        open,
        close,
        renderPreview: renderSharePreviewSnapshot,
        savePreview,
        copyPreview,
        setStatus: setShareStatus,
    };
};
