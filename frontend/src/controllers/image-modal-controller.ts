import type { ImageFileModalElements } from '../components/overlays/image-file-modal';
import { UI_TIMINGS_MS } from '../constants/ui-timings';
import type { ImageLibraryFile } from '../types/app-types';
import { mimeTypeForFileName } from '../utils/main-helpers';

type ImageModalControllerOptions = {
    elements: ImageFileModalElements;
    readFileBase64: (path: string) => Promise<string>;
};

export type ImageModalController = ReturnType<typeof createImageModalController>;

export const createImageModalController = (options: ImageModalControllerOptions) => {
    const {
        imageFileModal,
        imageFileBackdrop,
        imageFileTools,
        imageFileRotateLeft,
        imageFileRotateRight,
        imageFileContent,
        imageFilePreview,
        imageFileThumbs,
        imageFileThumbsPrev,
        imageFileThumbsNext,
        imageFileThumbsViewport,
        imageFileThumbsRow,
    } = options.elements;

    const imageModalTransitionMs = UI_TIMINGS_MS.modalTransition;
    const imageModalThumbPageSize = 7;

    const imageFileDataUrlByPath = new Map<string, string>();

    let imageModalHideTimer: number | undefined;
    let imageModalLoadToken = 0;
    let imageModalGallery: ImageLibraryFile[] = [];
    let imageModalCurrentIndex = -1;
    let imageModalPage = 0;
    let imageModalRotation = 0;
    let imageModalZoom = 1;
    let imageModalBaseFitScale = 1;
    let imageModalPanX = 0;
    let imageModalPanY = 0;
    let imageModalPanDragging = false;
    let imageModalPanPointerId: number | undefined;
    let imageModalPanStartClientX = 0;
    let imageModalPanStartClientY = 0;
    let imageModalPanStartX = 0;
    let imageModalPanStartY = 0;

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

    const recalculateImageModalBaseFitScale = (): void => {
        const source = imageFilePreview.getAttribute('src');
        if (!source) {
            imageModalBaseFitScale = 1;
            return;
        }

        const viewportWidth = imageFileContent.clientWidth;
        const viewportHeight = imageFileContent.clientHeight;
        const naturalWidth = imageFilePreview.naturalWidth || imageFilePreview.width;
        const naturalHeight = imageFilePreview.naturalHeight || imageFilePreview.height;

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

    const setImageModalPan = (x: number, y: number): void => {
        imageModalPanX = x;
        imageModalPanY = y;
        applyImageModalTransform();
    };

    const setImageModalZoom = (zoom: number): void => {
        imageModalZoom = Math.min(5, Math.max(1, zoom));
        if (imageModalZoom <= 1) {
            imageModalPanX = 0;
            imageModalPanY = 0;
        }
        applyImageModalTransform();
    };

    const resetImageModalZoom = (): void => {
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
        imageModalRotation = ((degrees % 360) + 360) % 360;
        applyImageModalTransform();
    };

    const rotateImageModal = (deltaDegrees: number): void => {
        if (imageFileModal.hidden || !imageFilePreview.getAttribute('src')) {
            return;
        }

        setImageModalRotation(imageModalRotation + deltaDegrees);
    };

    const zoomImageModalFromWheel = (deltaY: number, clientX: number, clientY: number): void => {
        if (imageFileModal.hidden || !imageFilePreview.getAttribute('src')) {
            return;
        }

        const previousZoom = imageModalZoom;
        const unclampedNextZoom = deltaY > 0 ? previousZoom * 0.9 : previousZoom * 1.1;
        const nextZoom = Math.min(5, Math.max(1, unclampedNextZoom));
        if (Math.abs(nextZoom - previousZoom) < 0.0001) {
            return;
        }

        const contentBounds = imageFileContent.getBoundingClientRect();
        const cursorOffsetX = clientX - (contentBounds.left + contentBounds.width / 2);
        const cursorOffsetY = clientY - (contentBounds.top + contentBounds.height / 2);
        const zoomRatio = nextZoom / previousZoom;
        const nextPanX = (1 - zoomRatio) * cursorOffsetX + zoomRatio * imageModalPanX;
        const nextPanY = (1 - zoomRatio) * cursorOffsetY + zoomRatio * imageModalPanY;

        imageModalZoom = nextZoom;
        imageModalPanX = nextZoom <= 1 ? 0 : nextPanX;
        imageModalPanY = nextZoom <= 1 ? 0 : nextPanY;
        applyImageModalTransform();
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

            void resolveImageFileDataUrl(imageFile).then((source) => {
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

        imageModalCurrentIndex = index;
        imageModalPage = Math.floor(index / imageModalThumbPageSize);
        setImageModalRotation(0);
        resetImageModalZoom();
        const loadToken = ++imageModalLoadToken;
        renderImageModalThumbs(loadToken);

        const source = await resolveImageFileDataUrl(imageModalGallery[index]);
        if (loadToken !== imageModalLoadToken) {
            return;
        }

        if (source) {
            imageFilePreview.src = source;
            return;
        }

        imageFilePreview.removeAttribute('src');
    };

    const close = (): void => {
        imageModalGallery = [];
        imageModalCurrentIndex = -1;
        imageModalPage = 0;
        setImageModalRotation(0);
        resetImageModalZoom();
        imageModalLoadToken += 1;
        imageFileModal.classList.remove('is-visible');

        if (imageModalHideTimer !== undefined) {
            window.clearTimeout(imageModalHideTimer);
        }

        imageModalHideTimer = window.setTimeout(() => {
            imageFileModal.hidden = true;
            imageFilePreview.removeAttribute('src');
            imageFileThumbsRow.innerHTML = '';
            imageFileThumbs.hidden = true;
            imageFileThumbsViewport.hidden = true;
            imageFileThumbsPrev.hidden = true;
            imageFileThumbsNext.hidden = true;
            imageModalHideTimer = undefined;
        }, imageModalTransitionMs);
    };

    const openGallery = async (gallery: ImageLibraryFile[], selectedIndex: number): Promise<void> => {
        if (imageModalHideTimer !== undefined) {
            window.clearTimeout(imageModalHideTimer);
            imageModalHideTimer = undefined;
        }

        imageModalGallery = gallery;
        imageModalCurrentIndex = -1;
        imageModalPage = 0;
        setImageModalRotation(0);
        resetImageModalZoom();
        imageModalLoadToken += 1;

        imageFilePreview.removeAttribute('src');
        imageFileModal.hidden = false;
        window.requestAnimationFrame(() => {
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

            openPreview(source, imageFile.relativePath || imageFile.path || imageFile.name);
        } catch (error) {
            console.error(error);
        }
    };

    const openPreview = (source: string, title?: string): void => {
        if (imageModalHideTimer !== undefined) {
            window.clearTimeout(imageModalHideTimer);
            imageModalHideTimer = undefined;
        }

        imageModalGallery = [];
        imageModalCurrentIndex = -1;
        imageModalPage = 0;
        setImageModalRotation(0);
        resetImageModalZoom();
        imageModalLoadToken += 1;
        imageFileThumbsRow.innerHTML = '';
        imageFileThumbs.hidden = true;
        imageFileThumbsViewport.hidden = true;
        imageFileThumbsPrev.hidden = true;
        imageFileThumbsNext.hidden = true;

        imageFilePreview.src = source;
        imageFilePreview.title = title || '';
        imageFilePreview.setAttribute('aria-label', title || 'Image preview');
        imageFileModal.hidden = false;
        window.requestAnimationFrame(() => {
            imageFileModal.classList.add('is-visible');
        });
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
        applyImageModalTransform();
    });

    window.addEventListener('resize', () => {
        if (imageFileModal.hidden || !imageFilePreview.getAttribute('src')) {
            return;
        }

        applyImageModalTransform();
    });

    return {
        clearCachedDataUrls: (): void => {
            imageFileDataUrlByPath.clear();
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