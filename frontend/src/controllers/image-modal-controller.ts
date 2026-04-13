import type { ImageFileModalElements } from '../components/overlays/image-file-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { ImageLibraryFile } from '../types/app-types';
import { mimeTypeForFileName } from '../utils/main-helpers';

type ImageModalControllerOptions = {
    elements: ImageFileModalElements;
    readFileBase64: (path: string) => Promise<string>;
    readImageThumbnail: (path: string, maxEdge: number) => Promise<{ base64?: string; mimeType?: string }>;
};

type DecodedImageDimensions = {
    naturalWidth: number;
    naturalHeight: number;
};

export type ImageModalController = ReturnType<typeof createImageModalController>;

export const createImageModalController = (options: ImageModalControllerOptions) => {
    const {
        imageFileModal,
        imageFileBackdrop,
        imageFileDialog,
        imageFileTools,
        imageFileRotateLeft,
        imageFileRotateRight,
        imageFileContent,
        imageFileLoading,
        imageFilePreview,
        imageFileThumbs,
        imageFileThumbsPrev,
        imageFileThumbsNext,
        imageFileThumbsViewport,
        imageFileThumbsRow,
    } = options.elements;

    const imageModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const imageModalThumbPageSize = 7;
    const imageModalThumbnailMaxEdge = 96;

    const imageFileDataUrlByPath = new Map<string, string>();
    const imageFileThumbnailDataUrlByPath = new Map<string, string>();

    let imageModalHideTimer: number | undefined;
    let imageModalLoadToken = 0;
    let imageModalGallery: ImageLibraryFile[] = [];
    let imageModalCurrentIndex = -1;
    let imageModalPage = 0;
    let imageModalRotation = 0;
    let imageModalZoom = 1;
    let imageModalTargetZoom = 1;
    let imageModalBaseFitScale = 1;
    let imageModalPanX = 0;
    let imageModalPanY = 0;
    let imageModalTargetPanX = 0;
    let imageModalTargetPanY = 0;
    let imageModalPanDragging = false;
    let imageModalPanPointerId: number | undefined;
    let imageModalPanStartClientX = 0;
    let imageModalPanStartClientY = 0;
    let imageModalPanStartX = 0;
    let imageModalPanStartY = 0;
    let imageModalResizeCleanupTimer: number | undefined;
    let imageModalResizeTransitionEndHandler: ((event: TransitionEvent) => void) | undefined;
    let imageModalSkipNextResizeAnimation = false;
    let imageModalZoomEasingFrame: number | undefined;
    let imageModalRotateAnimationTimer: number | undefined;
    let imageModalResizeSyncFrame: number | undefined;
    let imageModalNaturalWidth = 0;
    let imageModalNaturalHeight = 0;

    const imageModalZoomEasingFactor = 0.24;
    const imageModalRotateAnimationMs = 220;

    const stopImageModalZoomEasing = (): void => {
        if (imageModalZoomEasingFrame === undefined) {
            return;
        }

        window.cancelAnimationFrame(imageModalZoomEasingFrame);
        imageModalZoomEasingFrame = undefined;
    };

    const stopImageModalResizeSync = (): void => {
        if (imageModalResizeSyncFrame === undefined) {
            return;
        }

        window.cancelAnimationFrame(imageModalResizeSyncFrame);
        imageModalResizeSyncFrame = undefined;
    };

    const runImageModalResizeSync = (): void => {
        imageModalResizeSyncFrame = undefined;

        if (imageFileModal.hidden || !imageFileDialog.classList.contains('is-resizing') || !imageFilePreview.getAttribute('src')) {
            return;
        }

        applyImageModalTransform();
        imageModalResizeSyncFrame = window.requestAnimationFrame(runImageModalResizeSync);
    };

    const startImageModalResizeSync = (): void => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        stopImageModalResizeSync();
        imageModalResizeSyncFrame = window.requestAnimationFrame(runImageModalResizeSync);
    };

    const clearImageModalRotateAnimation = (): void => {
        if (imageModalRotateAnimationTimer !== undefined) {
            window.clearTimeout(imageModalRotateAnimationTimer);
            imageModalRotateAnimationTimer = undefined;
        }

        imageFilePreview.classList.remove('is-rotating');
    };

    const triggerImageModalRotateAnimation = (): void => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            clearImageModalRotateAnimation();
            return;
        }

        clearImageModalRotateAnimation();
        imageFilePreview.classList.add('is-rotating');
        imageModalRotateAnimationTimer = window.setTimeout(() => {
            imageFilePreview.classList.remove('is-rotating');
            imageModalRotateAnimationTimer = undefined;
        }, imageModalRotateAnimationMs);
    };

    const resetImageModalEnterAnimation = (): void => {
        imageFileDialog.style.setProperty('--image-modal-enter-x', '0px');
        imageFileDialog.style.setProperty('--image-modal-enter-y', '8px');
        imageFileDialog.style.setProperty('--image-modal-enter-scale', '0.985');
        imageFileDialog.style.setProperty('--image-modal-origin-x', '50%');
        imageFileDialog.style.setProperty('--image-modal-origin-y', '50%');
    };

    const resolveVisualRect = (element: HTMLElement): DOMRect | undefined => {
        const bounds = element.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) {
            return undefined;
        }

        if (!(element instanceof HTMLImageElement)) {
            return bounds;
        }

        const naturalWidth = element.naturalWidth;
        const naturalHeight = element.naturalHeight;
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            return bounds;
        }

        const widthScale = bounds.width / naturalWidth;
        const heightScale = bounds.height / naturalHeight;
        const fitScale = Math.min(widthScale, heightScale);
        const renderedWidth = naturalWidth * fitScale;
        const renderedHeight = naturalHeight * fitScale;
        const x = bounds.left + (bounds.width - renderedWidth) / 2;
        const y = bounds.top + (bounds.height - renderedHeight) / 2;

        return new DOMRect(x, y, renderedWidth, renderedHeight);
    };

    const prepareImageModalEnterAnimation = (originElement?: HTMLElement): void => {
        if (!originElement) {
            resetImageModalEnterAnimation();
            return;
        }

        const targetBounds = imageFileDialog.getBoundingClientRect();
        const originBounds = resolveVisualRect(originElement);
        if (!originBounds || targetBounds.width <= 0 || targetBounds.height <= 0) {
            resetImageModalEnterAnimation();
            return;
        }

        const originCenterX = originBounds.left + (originBounds.width / 2);
        const originCenterY = originBounds.top + (originBounds.height / 2);
        const deltaX = originCenterX - (targetBounds.left + (targetBounds.width / 2));
        const deltaY = originCenterY - (targetBounds.top + (targetBounds.height / 2));
        const scale = Math.min(originBounds.width / targetBounds.width, originBounds.height / targetBounds.height);
        const clampedScale = Number.isFinite(scale) ? Math.min(1, Math.max(0.05, scale)) : 0.985;
        const translationDamping = 0.42;
        const dampedDeltaX = deltaX * translationDamping;
        const dampedDeltaY = deltaY * translationDamping;
        const originXPercent = Math.min(100, Math.max(0, ((originCenterX - targetBounds.left) / targetBounds.width) * 100));
        const originYPercent = Math.min(100, Math.max(0, ((originCenterY - targetBounds.top) / targetBounds.height) * 100));

        imageFileDialog.style.setProperty('--image-modal-enter-x', `${Math.round(dampedDeltaX)}px`);
        imageFileDialog.style.setProperty('--image-modal-enter-y', `${Math.round(dampedDeltaY)}px`);
        imageFileDialog.style.setProperty('--image-modal-enter-scale', clampedScale.toFixed(4));
        imageFileDialog.style.setProperty('--image-modal-origin-x', `${originXPercent.toFixed(2)}%`);
        imageFileDialog.style.setProperty('--image-modal-origin-y', `${originYPercent.toFixed(2)}%`);
    };

    const clearImageModalDialogResize = (): void => {
        if (imageModalResizeCleanupTimer !== undefined) {
            window.clearTimeout(imageModalResizeCleanupTimer);
            imageModalResizeCleanupTimer = undefined;
        }

        stopImageModalResizeSync();

        if (imageModalResizeTransitionEndHandler) {
            imageFileDialog.removeEventListener('transitionend', imageModalResizeTransitionEndHandler);
            imageModalResizeTransitionEndHandler = undefined;
        }

        imageFileDialog.classList.remove('is-resizing');
        imageFileDialog.style.width = '';
        imageFileDialog.style.height = '';
        imageFileThumbsViewport.style.width = '';

        // Re-sync once transient resize constraints are removed so image switches
        // do not retain temporary letterbox borders until the next zoom change.
        if (!imageFileModal.hidden && imageFilePreview.getAttribute('src')) {
            syncImageModalContentViewportSize();
            applyImageModalTransform();
        }
    };

    const syncImageModalContentViewportSize = (): void => {
        const source = imageFilePreview.getAttribute('src');
        if (!source) {
            imageFileContent.style.width = '';
            imageFileContent.style.height = '';
            return;
        }

        const naturalWidth = imageModalNaturalWidth || imageFilePreview.naturalWidth || imageFilePreview.width;
        const naturalHeight = imageModalNaturalHeight || imageFilePreview.naturalHeight || imageFilePreview.height;
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            return;
        }

        const dialogInset = 8;
        const toolsHeight = imageFileTools.getBoundingClientRect().height;
        const thumbsHeight = imageFileThumbs.hidden ? 0 : imageFileThumbs.getBoundingClientRect().height;
        const availableWidth = Math.max(1, window.innerWidth - dialogInset);
        const availableHeight = Math.max(1, window.innerHeight - dialogInset - toolsHeight - thumbsHeight);

        const radians = (imageModalRotation * Math.PI) / 180;
        const cosTheta = Math.abs(Math.cos(radians));
        const sinTheta = Math.abs(Math.sin(radians));
        const rotatedBoundsWidth = (naturalWidth * cosTheta) + (naturalHeight * sinTheta);
        const rotatedBoundsHeight = (naturalWidth * sinTheta) + (naturalHeight * cosTheta);
        if (rotatedBoundsWidth <= 0 || rotatedBoundsHeight <= 0) {
            return;
        }

        const fitScale = Math.min(availableWidth / rotatedBoundsWidth, availableHeight / rotatedBoundsHeight);
        imageFileContent.style.width = `${Math.max(1, Math.round(rotatedBoundsWidth * fitScale))}px`;
        imageFileContent.style.height = `${Math.max(1, Math.round(rotatedBoundsHeight * fitScale))}px`;
    };

    const animateImageModalDialogResize = (startSizeOverride?: { width: number; height: number; lockWidth?: boolean; lockThumbViewport?: boolean; disableWidthShrink?: boolean }): void => {
        const modalVisible = !imageFileModal.hidden && imageFileModal.classList.contains('is-visible');
        if (!modalVisible) {
            clearImageModalDialogResize();
            return;
        }

        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const startRect = imageFileDialog.getBoundingClientRect();
        const startWidth = startSizeOverride ? Math.ceil(startSizeOverride.width) : Math.ceil(startRect.width);
        const startHeight = startSizeOverride ? Math.ceil(startSizeOverride.height) : Math.ceil(startRect.height);

        imageFileDialog.style.width = '';
        imageFileDialog.style.height = '';

        const targetRect = imageFileDialog.getBoundingClientRect();
        const targetWidth = Math.ceil(targetRect.width);
        const targetHeight = Math.ceil(targetRect.height);

        const lockWidth = startSizeOverride?.lockWidth === true;
        const lockThumbViewport = startSizeOverride?.lockThumbViewport === true;
        const disableWidthShrink = startSizeOverride?.disableWidthShrink === true;
        const stableWidth = lockWidth ? Math.max(startWidth, targetWidth) : undefined;
        const nextStartWidth = stableWidth ?? startWidth;
        const nextTargetWidth = stableWidth ?? targetWidth;
        const nextAnimatedStartWidth = (disableWidthShrink && nextTargetWidth < nextStartWidth)
            ? nextTargetWidth
            : nextStartWidth;
        const nextAnimatedTargetWidth = nextTargetWidth;

        if (lockThumbViewport && !imageFileThumbs.hidden) {
            const thumbsViewportRect = imageFileThumbsViewport.getBoundingClientRect();
            if (thumbsViewportRect.width > 0) {
                imageFileThumbsViewport.style.width = `${Math.ceil(thumbsViewportRect.width)}px`;
            }
        }

        if (
            prefersReducedMotion
            || startWidth <= 0
            || startHeight <= 0
            || targetWidth <= 0
            || targetHeight <= 0
            || (Math.abs(nextAnimatedTargetWidth - nextAnimatedStartWidth) < 2 && Math.abs(targetHeight - startHeight) < 2)
        ) {
            clearImageModalDialogResize();
            return;
        }

        clearImageModalDialogResize();
        imageFileDialog.classList.add('is-resizing');
        imageFileDialog.style.width = `${nextAnimatedStartWidth}px`;
        imageFileDialog.style.height = `${startHeight}px`;
        applyImageModalTransform();
        void imageFileDialog.offsetWidth;
        imageFileDialog.style.width = `${nextAnimatedTargetWidth}px`;
        imageFileDialog.style.height = `${targetHeight}px`;
        startImageModalResizeSync();

        imageModalResizeTransitionEndHandler = (event: TransitionEvent): void => {
            if (event.target !== imageFileDialog) {
                return;
            }

            if (event.propertyName !== 'width' && event.propertyName !== 'height') {
                return;
            }

            clearImageModalDialogResize();
        };

        imageFileDialog.addEventListener('transitionend', imageModalResizeTransitionEndHandler);
        imageModalResizeCleanupTimer = window.setTimeout(() => {
            clearImageModalDialogResize();
        }, imageModalTransitionMs + 120);
    };

    const setImageModalLoadingState = (isLoading: boolean): void => {
        imageFileContent.classList.toggle('is-loading', isLoading);
        imageFileLoading.hidden = !isLoading;
        imageFilePreview.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    };

    const waitForImageSource = async (source: string): Promise<DecodedImageDimensions> => {
        const loader = new Image();
        loader.decoding = 'async';
        loader.src = source;

        if (loader.complete) {
            if (typeof loader.decode === 'function') {
                try {
                    await loader.decode();
                } catch {
                    // Ignore decode failures and fall back to the loaded image.
                }
            }
            return {
                naturalWidth: loader.naturalWidth,
                naturalHeight: loader.naturalHeight,
            };
        }

        await new Promise<void>((resolve, reject) => {
            loader.addEventListener('load', () => {
                resolve();
            }, { once: true });
            loader.addEventListener('error', () => {
                reject(new Error('Failed to load image preview source.'));
            }, { once: true });
        });

        if (typeof loader.decode === 'function') {
            try {
                await loader.decode();
            } catch {
                // Ignore decode failures and fall back to the loaded image.
            }
        }

        return {
            naturalWidth: loader.naturalWidth,
            naturalHeight: loader.naturalHeight,
        };
    };

    const showImageModalPreviewSource = async (
        loadToken: number,
        source: string | undefined,
        title?: string,
        startSizeOverride?: { width: number; height: number; lockThumbViewport?: boolean; disableWidthShrink?: boolean },
    ): Promise<void> => {
        imageFilePreview.removeAttribute('src');
        imageFilePreview.title = title || '';
        imageFilePreview.setAttribute('aria-label', title || 'Image preview');

        if (!source) {
            imageModalNaturalWidth = 0;
            imageModalNaturalHeight = 0;
            setImageModalLoadingState(false);
            return;
        }

        setImageModalLoadingState(true);

        try {
            const decodedDimensions = await waitForImageSource(source);
            if (loadToken !== imageModalLoadToken) {
                return;
            }

            imageModalNaturalWidth = decodedDimensions.naturalWidth;
            imageModalNaturalHeight = decodedDimensions.naturalHeight;
            imageFilePreview.src = source;
            syncImageModalContentViewportSize();
            applyImageModalTransform();
            if (imageModalSkipNextResizeAnimation) {
                imageModalSkipNextResizeAnimation = false;
            } else {
                animateImageModalDialogResize(startSizeOverride);
            }
        } catch (error) {
            if (loadToken === imageModalLoadToken) {
                imageModalNaturalWidth = 0;
                imageModalNaturalHeight = 0;
                imageFilePreview.removeAttribute('src');
                clearImageModalDialogResize();
            }
            console.error(error);
        } finally {
            if (loadToken === imageModalLoadToken) {
                setImageModalLoadingState(false);
            }
        }
    };

    const resolveImageFileDataUrl = async (imageFile: ImageLibraryFile): Promise<string | undefined> => {
        const cacheKey = imageFile.path.toLowerCase();
        const cached = imageFileDataUrlByPath.get(cacheKey);
        if (cached) {
            return cached;
        }

        const base64 = await options.readFileBase64(imageFile.path);
        if (!base64) {
            return undefined;
        }

        const source = `data:${mimeTypeForFileName(imageFile.name)};base64,${base64}`;
        imageFileDataUrlByPath.set(cacheKey, source);
        return source;
    };

    const resolveImageFileThumbnailDataUrl = async (imageFile: ImageLibraryFile): Promise<string | undefined> => {
        const cacheKey = imageFile.path.toLowerCase();
        const cached = imageFileThumbnailDataUrlByPath.get(cacheKey);
        if (cached) {
            return cached;
        }

        const thumbnail = await options.readImageThumbnail(imageFile.path, imageModalThumbnailMaxEdge);
        const base64 = thumbnail.base64 || '';
        if (!base64) {
            return undefined;
        }

        const mimeType = thumbnail.mimeType && thumbnail.mimeType.startsWith('image/')
            ? thumbnail.mimeType
            : mimeTypeForFileName(imageFile.name);
        const source = `data:${mimeType};base64,${base64}`;
        imageFileThumbnailDataUrlByPath.set(cacheKey, source);
        return source;
    };

    const recalculateImageModalBaseFitScale = (): void => {
        const source = imageFilePreview.getAttribute('src');
        if (!source) {
            imageModalBaseFitScale = 1;
            return;
        }

        const viewportWidth = imageFileContent.clientWidth;
        const viewportHeight = imageFileContent.clientHeight;
        const naturalWidth = imageModalNaturalWidth || imageFilePreview.naturalWidth || imageFilePreview.width;
        const naturalHeight = imageModalNaturalHeight || imageFilePreview.naturalHeight || imageFilePreview.height;

        if (viewportWidth <= 0 || viewportHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
            imageModalBaseFitScale = 1;
            return;
        }

        const radians = (imageModalRotation * Math.PI) / 180;
        const cosTheta = Math.abs(Math.cos(radians));
        const sinTheta = Math.abs(Math.sin(radians));

        const rotatedBoundsWidth = (naturalWidth * cosTheta) + (naturalHeight * sinTheta);
        const rotatedBoundsHeight = (naturalWidth * sinTheta) + (naturalHeight * cosTheta);

        if (rotatedBoundsWidth <= 0 || rotatedBoundsHeight <= 0) {
            imageModalBaseFitScale = 1;
            return;
        }

        imageModalBaseFitScale = Math.min(
            viewportWidth / rotatedBoundsWidth,
            viewportHeight / rotatedBoundsHeight,
        );
    };

    const applyImageModalTransform = (): void => {
        recalculateImageModalBaseFitScale();
        imageFilePreview.style.transformOrigin = 'center center';
        imageFilePreview.style.transform = `translate(${imageModalPanX}px, ${imageModalPanY}px) rotate(${imageModalRotation}deg) scale(${imageModalBaseFitScale * imageModalZoom})`;
    };

    const runImageModalZoomEasing = (): void => {
        imageModalZoomEasingFrame = undefined;

        const nextZoom = imageModalZoom + ((imageModalTargetZoom - imageModalZoom) * imageModalZoomEasingFactor);
        const nextPanX = imageModalPanX + ((imageModalTargetPanX - imageModalPanX) * imageModalZoomEasingFactor);
        const nextPanY = imageModalPanY + ((imageModalTargetPanY - imageModalPanY) * imageModalZoomEasingFactor);

        const zoomCloseEnough = Math.abs(imageModalTargetZoom - nextZoom) < 0.001;
        const panXCloseEnough = Math.abs(imageModalTargetPanX - nextPanX) < 0.25;
        const panYCloseEnough = Math.abs(imageModalTargetPanY - nextPanY) < 0.25;

        imageModalZoom = zoomCloseEnough ? imageModalTargetZoom : nextZoom;
        imageModalPanX = panXCloseEnough ? imageModalTargetPanX : nextPanX;
        imageModalPanY = panYCloseEnough ? imageModalTargetPanY : nextPanY;

        if (imageModalZoom <= 1.001) {
            imageModalZoom = 1;
            imageModalPanX = 0;
            imageModalPanY = 0;
            imageModalTargetZoom = 1;
            imageModalTargetPanX = 0;
            imageModalTargetPanY = 0;
            syncImageModalContentViewportSize();
        }

        applyImageModalTransform();

        if (!zoomCloseEnough || !panXCloseEnough || !panYCloseEnough) {
            imageModalZoomEasingFrame = window.requestAnimationFrame(runImageModalZoomEasing);
        }
    };

    const queueImageModalZoomEasing = (): void => {
        if (imageModalZoomEasingFrame !== undefined) {
            return;
        }

        imageModalZoomEasingFrame = window.requestAnimationFrame(runImageModalZoomEasing);
    };

    const setImageModalPan = (x: number, y: number): void => {
        stopImageModalZoomEasing();
        imageModalPanX = x;
        imageModalPanY = y;
        imageModalTargetPanX = x;
        imageModalTargetPanY = y;
        applyImageModalTransform();
    };

    const setImageModalZoom = (zoom: number): void => {
        stopImageModalZoomEasing();
        imageModalZoom = Math.min(5, Math.max(1, zoom));
        imageModalTargetZoom = imageModalZoom;
        if (imageModalZoom <= 1) {
            imageModalPanX = 0;
            imageModalPanY = 0;
            imageModalTargetPanX = 0;
            imageModalTargetPanY = 0;
            syncImageModalContentViewportSize();
        }
        applyImageModalTransform();
    };

    const resetImageModalZoom = (): void => {
        stopImageModalZoomEasing();
        imageModalPanDragging = false;
        imageModalPanPointerId = undefined;
        imageModalPanStartClientX = 0;
        imageModalPanStartClientY = 0;
        imageModalPanStartX = 0;
        imageModalPanStartY = 0;
        imageModalPanX = 0;
        imageModalPanY = 0;
        imageFileContent.classList.remove('is-panning');
        setImageModalZoom(1);
    };

    const setImageModalRotation = (degrees: number): void => {
        imageModalRotation = degrees;
        if (imageModalZoom <= 1) {
            syncImageModalContentViewportSize();
        }
        applyImageModalTransform();
    };

    const rotateImageModal = (deltaDegrees: number): void => {
        if (imageFileModal.hidden || !imageFilePreview.getAttribute('src')) {
            return;
        }

        const startRect = imageFileDialog.getBoundingClientRect();
        triggerImageModalRotateAnimation();
        setImageModalRotation(imageModalRotation + deltaDegrees);
        animateImageModalDialogResize({
            width: startRect.width,
            height: startRect.height,
            lockThumbViewport: true,
        });
    };

    const zoomImageModalFromWheel = (deltaY: number, clientX: number, clientY: number): void => {
        if (imageFileModal.hidden || !imageFilePreview.getAttribute('src')) {
            return;
        }

        const previousZoom = imageModalZoom;
        const previousTargetZoom = imageModalTargetZoom;
        const unclampedNextZoom = deltaY > 0 ? previousTargetZoom * 0.9 : previousTargetZoom * 1.1;
        const nextZoom = Math.min(5, Math.max(1, unclampedNextZoom));
        if (Math.abs(nextZoom - previousTargetZoom) < 0.0001) {
            return;
        }

        const contentBounds = imageFileContent.getBoundingClientRect();
        const cursorOffsetX = clientX - (contentBounds.left + contentBounds.width / 2);
        const cursorOffsetY = clientY - (contentBounds.top + contentBounds.height / 2);
        const zoomRatio = nextZoom / previousTargetZoom;
        const nextPanX = (1 - zoomRatio) * cursorOffsetX + zoomRatio * imageModalTargetPanX;
        const nextPanY = (1 - zoomRatio) * cursorOffsetY + zoomRatio * imageModalTargetPanY;

        imageModalTargetZoom = nextZoom;
        imageModalTargetPanX = nextZoom <= 1 ? 0 : nextPanX;
        imageModalTargetPanY = nextZoom <= 1 ? 0 : nextPanY;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            imageModalZoom = imageModalTargetZoom;
            imageModalPanX = imageModalTargetPanX;
            imageModalPanY = imageModalTargetPanY;
            if (imageModalZoom <= 1) {
                imageModalPanX = 0;
                imageModalPanY = 0;
                syncImageModalContentViewportSize();
            }
            applyImageModalTransform();
            return;
        }

        if (Math.abs(previousZoom - imageModalTargetZoom) < 0.0001 && Math.abs(imageModalPanX - imageModalTargetPanX) < 0.25 && Math.abs(imageModalPanY - imageModalTargetPanY) < 0.25) {
            return;
        }

        queueImageModalZoomEasing();
    };

    const renderImageModalThumbs = (loadToken: number): void => {
        imageFileThumbsRow.innerHTML = '';

        if (imageModalGallery.length === 0 || imageModalCurrentIndex < 0) {
            imageFileThumbs.hidden = true;
            imageFileThumbsViewport.hidden = true;
            imageFileThumbsPrev.hidden = true;
            imageFileThumbsNext.hidden = true;
            return;
        }

        imageFileThumbs.hidden = false;
        imageFileThumbsViewport.hidden = false;

        const pageCount = Math.max(1, Math.ceil(imageModalGallery.length / imageModalThumbPageSize));
        imageModalPage = Math.max(0, Math.min(imageModalPage, pageCount - 1));

        const hasMultiplePages = pageCount > 1;
        imageFileThumbsPrev.hidden = !hasMultiplePages;
        imageFileThumbsNext.hidden = !hasMultiplePages;
        imageFileThumbsPrev.disabled = !hasMultiplePages || imageModalPage <= 0;
        imageFileThumbsNext.disabled = !hasMultiplePages || imageModalPage >= pageCount - 1;

        const start = imageModalPage * imageModalThumbPageSize;
        const end = Math.min(imageModalGallery.length, start + imageModalThumbPageSize);

        for (let index = start; index < end; index += 1) {
            const imageFile = imageModalGallery[index];
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `image-file-thumb${index === imageModalCurrentIndex ? ' is-active' : ''}`;
            button.dataset.imageModalIndex = String(index);
            button.title = imageFile.relativePath || imageFile.name;
            button.setAttribute('aria-label', imageFile.relativePath || imageFile.name);
            button.setAttribute('aria-current', index === imageModalCurrentIndex ? 'true' : 'false');

            const fallback = document.createElement('span');
            fallback.className = 'image-file-thumb-fallback';
            fallback.textContent = '...';
            button.append(fallback);

            void resolveImageFileThumbnailDataUrl(imageFile).then((source) => {
                if (loadToken !== imageModalLoadToken || !source || !button.isConnected) {
                    return;
                }

                const thumbnail = document.createElement('img');
                thumbnail.src = source;
                thumbnail.alt = imageFile.name;
                button.replaceChildren(thumbnail);
            }).catch((error) => {
                console.error(error);
            });

            imageFileThumbsRow.append(button);
        }
    };

    const setImageModalActiveIndex = async (index: number): Promise<void> => {
        if (imageModalGallery.length === 0 || index < 0 || index >= imageModalGallery.length) {
            return;
        }

        const startRect = imageFileDialog.getBoundingClientRect();
        imageModalCurrentIndex = index;
        imageModalPage = Math.floor(index / imageModalThumbPageSize);
        setImageModalRotation(0);
        resetImageModalZoom();
        const loadToken = ++imageModalLoadToken;
        renderImageModalThumbs(loadToken);

        const title = imageModalGallery[index].relativePath || imageModalGallery[index].path || imageModalGallery[index].name;
        setImageModalLoadingState(true);
        imageModalNaturalWidth = 0;
        imageModalNaturalHeight = 0;
        imageFilePreview.removeAttribute('src');
        imageFilePreview.title = title;
        imageFilePreview.setAttribute('aria-label', title);

        const source = await resolveImageFileDataUrl(imageModalGallery[index]);
        if (loadToken !== imageModalLoadToken) {
            return;
        }

        await showImageModalPreviewSource(loadToken, source, title, {
            width: startRect.width,
            height: startRect.height,
            lockThumbViewport: true,
            disableWidthShrink: true,
        });
    };

    const close = (): void => {
        stopImageModalZoomEasing();
        clearImageModalRotateAnimation();
        imageModalGallery = [];
        imageModalCurrentIndex = -1;
        imageModalPage = 0;
        setImageModalRotation(0);
        resetImageModalZoom();
        imageModalLoadToken += 1;
        clearImageModalDialogResize();
        imageModalNaturalWidth = 0;
        imageModalNaturalHeight = 0;
        imageFileModal.classList.remove('is-visible');

        if (imageModalHideTimer !== undefined) {
            window.clearTimeout(imageModalHideTimer);
        }

        imageModalHideTimer = window.setTimeout(() => {
            imageFileModal.hidden = true;
            setImageModalLoadingState(false);
            imageFilePreview.removeAttribute('src');
            imageFileThumbsRow.innerHTML = '';
            imageFileThumbs.hidden = true;
            imageFileThumbsViewport.hidden = true;
            imageFileThumbsPrev.hidden = true;
            imageFileThumbsNext.hidden = true;
            imageFileModal.classList.remove('is-single-preview');
            imageModalHideTimer = undefined;
        }, imageModalTransitionMs);
    };

    const openGallery = async (gallery: ImageLibraryFile[], selectedIndex: number, originElement?: HTMLElement): Promise<void> => {
        if (imageModalHideTimer !== undefined) {
            window.clearTimeout(imageModalHideTimer);
            imageModalHideTimer = undefined;
        }

        imageModalGallery = gallery;
        imageModalCurrentIndex = -1;
        imageModalPage = 0;
        clearImageModalRotateAnimation();
        setImageModalRotation(0);
        resetImageModalZoom();
        imageModalLoadToken += 1;
        clearImageModalDialogResize();

        imageFileThumbs.hidden = false;
        imageFileThumbsViewport.hidden = false;
        imageFileModal.classList.remove('is-single-preview');
        imageFilePreview.removeAttribute('src');
        imageModalSkipNextResizeAnimation = true;
        imageFileModal.hidden = false;
        window.requestAnimationFrame(() => {
            prepareImageModalEnterAnimation(originElement);
            imageFileModal.classList.add('is-visible');
        });

        if (gallery.length === 0) {
            renderImageModalThumbs(imageModalLoadToken);
            return;
        }

        const clampedIndex = Math.max(0, Math.min(selectedIndex, gallery.length - 1));
        await setImageModalActiveIndex(clampedIndex);
    };

    const openImageFile = async (imageFile: ImageLibraryFile): Promise<void> => {
        try {
            const source = await resolveImageFileDataUrl(imageFile);
            if (!source) {
                return;
            }

            await openPreview(source, imageFile.relativePath || imageFile.path || imageFile.name);
        } catch (error) {
            console.error(error);
        }
    };

    const openPreview = async (source: string, title?: string, originElement?: HTMLElement): Promise<void> => {
        if (imageModalHideTimer !== undefined) {
            window.clearTimeout(imageModalHideTimer);
            imageModalHideTimer = undefined;
        }

        imageModalGallery = [];
        imageModalCurrentIndex = -1;
        imageModalPage = 0;
        clearImageModalRotateAnimation();
        setImageModalRotation(0);
        resetImageModalZoom();
        imageModalLoadToken += 1;
        clearImageModalDialogResize();
        imageFileThumbsRow.innerHTML = '';
        imageFileThumbs.hidden = true;
        imageFileThumbsViewport.hidden = true;
        imageFileThumbsPrev.hidden = true;
        imageFileThumbsNext.hidden = true;
        imageFileModal.classList.add('is-single-preview');
        const loadToken = ++imageModalLoadToken;
        setImageModalLoadingState(true);
        imageFilePreview.removeAttribute('src');
        imageFilePreview.title = title || '';
        imageFilePreview.setAttribute('aria-label', title || 'Image preview');

        imageModalSkipNextResizeAnimation = true;
        imageFileModal.hidden = false;
        window.requestAnimationFrame(() => {
            prepareImageModalEnterAnimation(originElement);
            imageFileModal.classList.add('is-visible');
        });

        await showImageModalPreviewSource(loadToken, source, title);
    };

    const stopImageModalPan = (event: PointerEvent): void => {
        if (!imageModalPanDragging || imageModalPanPointerId !== event.pointerId) {
            return;
        }

        imageModalPanDragging = false;
        imageModalPanPointerId = undefined;
        imageFileContent.classList.remove('is-panning');
        if (imageFileContent.hasPointerCapture(event.pointerId)) {
            imageFileContent.releasePointerCapture(event.pointerId);
        }
    };

    imageFileBackdrop.addEventListener('click', () => {
        close();
    });

    imageFileTools.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    imageFileRotateLeft.addEventListener('click', () => {
        rotateImageModal(-90);
    });

    imageFileRotateRight.addEventListener('click', () => {
        rotateImageModal(90);
    });

    imageFileContent.addEventListener('wheel', (event) => {
        event.preventDefault();
        zoomImageModalFromWheel(event.deltaY, event.clientX, event.clientY);
    }, { passive: false });

    imageFileContent.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || imageModalZoom <= 1 || !imageFilePreview.getAttribute('src')) {
            return;
        }

        event.preventDefault();
        imageModalPanDragging = true;
        imageModalPanPointerId = event.pointerId;
        imageModalPanStartClientX = event.clientX;
        imageModalPanStartClientY = event.clientY;
        imageModalPanStartX = imageModalPanX;
        imageModalPanStartY = imageModalPanY;
        imageFileContent.setPointerCapture(event.pointerId);
        imageFileContent.classList.add('is-panning');
    });

    imageFileContent.addEventListener('pointermove', (event) => {
        if (!imageModalPanDragging || imageModalPanPointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        const deltaX = event.clientX - imageModalPanStartClientX;
        const deltaY = event.clientY - imageModalPanStartClientY;
        setImageModalPan(imageModalPanStartX + deltaX, imageModalPanStartY + deltaY);
    });

    imageFileContent.addEventListener('pointerup', stopImageModalPan);
    imageFileContent.addEventListener('pointercancel', stopImageModalPan);

    imageFileThumbsPrev.addEventListener('click', () => {
        if (imageModalGallery.length === 0 || imageModalPage <= 0) {
            return;
        }

        imageModalPage -= 1;
        renderImageModalThumbs(imageModalLoadToken);
    });

    imageFileThumbsNext.addEventListener('click', () => {
        if (imageModalGallery.length === 0) {
            return;
        }

        const pageCount = Math.ceil(imageModalGallery.length / imageModalThumbPageSize);
        if (imageModalPage >= pageCount - 1) {
            return;
        }

        imageModalPage += 1;
        renderImageModalThumbs(imageModalLoadToken);
    });

    imageFileThumbsRow.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const button = target.closest('button.image-file-thumb');
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const rawIndex = button.dataset.imageModalIndex;
        if (rawIndex === undefined) {
            return;
        }

        const index = Number(rawIndex);
        if (!Number.isInteger(index)) {
            return;
        }

        void setImageModalActiveIndex(index);
    });

    imageFilePreview.addEventListener('load', () => {
        const naturalWidth = imageFilePreview.naturalWidth || imageFilePreview.width;
        const naturalHeight = imageFilePreview.naturalHeight || imageFilePreview.height;
        if (naturalWidth > 0 && naturalHeight > 0) {
            imageModalNaturalWidth = naturalWidth;
            imageModalNaturalHeight = naturalHeight;
            syncImageModalContentViewportSize();
        }
        applyImageModalTransform();
    });

    window.addEventListener('resize', () => {
        if (imageFileModal.hidden || !imageFilePreview.getAttribute('src')) {
            return;
        }

        syncImageModalContentViewportSize();
        applyImageModalTransform();
    });

    return {
        clearCachedDataUrls: (): void => {
            imageFileDataUrlByPath.clear();
            imageFileThumbnailDataUrlByPath.clear();
        },
        close,
        contains: (target: Node): boolean => imageFileModal.contains(target),
        handleEscape: (): boolean => {
            if (imageFileModal.hidden) {
                return false;
            }

            close();
            return true;
        },
        openGallery,
        openImageFile,
        openPreview,
    };
};