import { describe, expect, it, vi } from 'vitest';

import { deriveShareImageAccentPalette } from './share-image-service';

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
