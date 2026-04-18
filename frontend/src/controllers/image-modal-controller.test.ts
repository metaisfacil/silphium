import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getImageFileModalElements, renderImageFileModal } from '../components/overlays/image-file-modal';
import { createImageModalController } from './image-modal-controller';

const dispatchPointerEvent = (
    target: EventTarget,
    type: string,
    init: Partial<{ button: number; clientX: number; clientY: number; pointerId: number }> = {},
): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
        button: { value: init.button ?? 0 },
        clientX: { value: init.clientX ?? 0 },
        clientY: { value: init.clientY ?? 0 },
        pointerId: { value: init.pointerId ?? 1 },
    });
    target.dispatchEvent(event);
};

const createControllerHarness = () => {
    document.body.innerHTML = renderImageFileModal();
    const elements = getImageFileModalElements(document);

    Object.defineProperties(elements.imageFileContent, {
        clientWidth: { configurable: true, value: 200 },
        clientHeight: { configurable: true, value: 200 },
        getBoundingClientRect: {
            configurable: true,
            value: () => new DOMRect(40, 60, 200, 200),
        },
    });

    Object.defineProperties(elements.imageFileDialog, {
        getBoundingClientRect: {
            configurable: true,
            value: () => new DOMRect(20, 20, 640, 480),
        },
    });

    Object.defineProperties(elements.imageFileTools, {
        getBoundingClientRect: {
            configurable: true,
            value: () => new DOMRect(0, 0, 640, 48),
        },
    });

    Object.defineProperties(elements.imageFileThumbs, {
        getBoundingClientRect: {
            configurable: true,
            value: () => new DOMRect(0, 0, 640, 0),
        },
    });

    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);

    Object.defineProperties(elements.imageFileContent, {
        setPointerCapture: { configurable: true, value: setPointerCapture },
        releasePointerCapture: { configurable: true, value: releasePointerCapture },
        hasPointerCapture: { configurable: true, value: hasPointerCapture },
    });

    const controller = createImageModalController({
        elements,
        readFileBase64: vi.fn(async () => ''),
        readImageThumbnail: vi.fn(async () => ({})),
    });

    return {
        controller,
        elements,
        setPointerCapture,
        releasePointerCapture,
        hasPointerCapture,
    };
};

describe('createImageModalController', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
            matches: true,
            media: '(prefers-reduced-motion: reduce)',
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => false),
        })));
        vi.stubGlobal('Image', class ImageMock {
            complete = true;
            naturalWidth = 400;
            naturalHeight = 200;
            decoding = 'async';
            src = '';

            addEventListener(): void {
                return undefined;
            }

            removeEventListener(): void {
                return undefined;
            }

            async decode(): Promise<void> {
                return Promise.resolve();
            }
        } as unknown as typeof Image);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('resets wheel zoom back to the fitted scale on double-click', async () => {
        const { controller, elements } = createControllerHarness();

        await controller.openPreview('data:image/png;base64,preview', 'Preview');

        elements.imageFileContent.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: -120,
            clientX: 140,
            clientY: 160,
        }));

        expect(elements.imageFilePreview.style.transform).toContain('scale(0.55)');

        elements.imageFileContent.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 140,
            clientY: 160,
        }));

        expect(elements.imageFilePreview.style.transform).toBe('translate(0px, 0px) rotate(0deg) scale(0.5)');
    });

    it('clears pan state and pointer capture when double-click reset runs during a drag', async () => {
        const { controller, elements, setPointerCapture, releasePointerCapture } = createControllerHarness();

        await controller.openPreview('data:image/png;base64,preview', 'Preview');

        elements.imageFileContent.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            deltaY: -120,
            clientX: 140,
            clientY: 160,
        }));

        dispatchPointerEvent(elements.imageFileContent, 'pointerdown', {
            pointerId: 7,
            clientX: 80,
            clientY: 90,
        });
        dispatchPointerEvent(elements.imageFileContent, 'pointermove', {
            pointerId: 7,
            clientX: 110,
            clientY: 120,
        });

        expect(setPointerCapture).toHaveBeenCalledWith(7);
        expect(elements.imageFileContent.classList.contains('is-panning')).toBe(true);
        expect(elements.imageFilePreview.style.transform).toBe('translate(30px, 30px) rotate(0deg) scale(0.55)');

        elements.imageFileContent.dispatchEvent(new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 110,
            clientY: 120,
        }));

        expect(releasePointerCapture).toHaveBeenCalledWith(7);
        expect(elements.imageFileContent.classList.contains('is-panning')).toBe(false);
        expect(elements.imageFilePreview.style.transform).toBe('translate(0px, 0px) rotate(0deg) scale(0.5)');
    });
});