import { describe, expect, it, vi } from 'vitest';

import { deriveShareImageAccentPalette, renderShareImagePreview } from './share-image-service';

describe('share image accents', () => {
    it('returns default accents when no cover image exists', () => {
        expect(deriveShareImageAccentPalette(undefined)).toEqual({
            primary: '#68b4ff',
            secondary: '#ff9a73',
        });
    });

    it('derives palette accents from sampled cover pixels', () => {
        const samplePixels = new Uint8ClampedArray([
            236, 61, 73, 255,
            236, 61, 73, 255,
            236, 61, 73, 255,
            34, 174, 152, 255,
            34, 174, 152, 255,
            34, 174, 152, 255,
            83, 126, 235, 255,
            83, 126, 235, 255,
            83, 126, 235, 255,
            18, 21, 29, 255,
            18, 21, 29, 255,
            18, 21, 29, 255,
        ]);

        const mockContext = {
            clearRect: vi.fn(),
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({ data: samplePixels })),
        };

        const mockCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => mockContext),
        } as unknown as HTMLCanvasElement;

        const createElementSpy = vi
            .spyOn(document, 'createElement')
            .mockImplementation((tagName: string): HTMLElement => {
                if (tagName.toLowerCase() === 'canvas') {
                    return mockCanvas as unknown as HTMLElement;
                }
                return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as unknown as HTMLElement;
            });

        const coverImage = { width: 12, height: 12 } as unknown as CanvasImageSource;
        const palette = deriveShareImageAccentPalette(coverImage);

        expect(palette.primary).toMatch(/^#[0-9a-f]{6}$/i);
        expect(palette.secondary).toMatch(/^#[0-9a-f]{6}$/i);
        expect(palette.primary).not.toBe('#68b4ff');
        expect(palette.secondary).not.toBe('#ff9a73');

        createElementSpy.mockRestore();
    });
});

describe('share image preview cover rendering', () => {
    it('uses a blurred cover-fit background plus contained foreground for non-square covers', () => {
        const drawImage = vi.fn();
        const context = {
            clearRect: vi.fn(),
            createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            arcTo: vi.fn(),
            closePath: vi.fn(),
            clip: vi.fn(),
            fillRect: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            fillText: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
            drawImage,
            set fillStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set strokeStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set lineWidth(_value: number) { void _value; },
            set filter(_value: string) { void _value; },
            set font(_value: string) { void _value; },
            set textAlign(_value: CanvasTextAlign) { void _value; },
            set textBaseline(_value: CanvasTextBaseline) { void _value; },
            set shadowColor(_value: string) { void _value; },
            set shadowBlur(_value: number) { void _value; },
            set shadowOffsetY(_value: number) { void _value; },
        } as unknown as CanvasRenderingContext2D;

        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        } as unknown as HTMLCanvasElement;

        const coverImage = {
            width: 320,
            height: 180,
        } as unknown as CanvasImageSource;

        renderShareImagePreview(canvas, {
            title: 'Track',
            album: 'Album',
            artist: 'Artist',
            comment: '',
            coverImage,
        });

        const blurredBackgroundCall = drawImage.mock.calls.find((call) => {
            const [source, x, y, width, height] = call;
            return source === coverImage
            && Number(x) < 34
                && Math.abs(Number(y) - 30) < 0.001
            && Number(width) > 194
                && Math.abs(Number(height) - 194) < 0.001;
        });
        expect(blurredBackgroundCall).toBeDefined();

        const containCall = drawImage.mock.calls.find((call) => {
            const [source, x, y, width, height] = call;
            return source === coverImage
                && Number(x) >= 33.99
                && Number(y) >= 29.99
                && Number(width) <= 194.01
                && Number(height) > 0
                && Number(height) < 194;
        });
        expect(containCall).toBeDefined();
    });
});
