import { describe, expect, it, vi } from 'vitest';

import { deriveShareImageAccentPalette } from '../utils/cover-accent-palette';
import { renderShareImagePreview } from './share-image-service';

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

describe('share image preview text fitting', () => {
    const createTextContext = () => {
        let currentFont = '12px sans-serif';
        const drawCalls: Array<{ text: string; x: number; y: number; font: string }> = [];

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
            save: vi.fn(),
            restore: vi.fn(),
            drawImage: vi.fn(),
            measureText: vi.fn((text: string) => {
                const parsedSize = /\s(\d+)px\s/.exec(currentFont);
                const fontSize = parsedSize ? Number(parsedSize[1]) : 12;
                return { width: text.length * fontSize * 0.52 };
            }),
            fillText: vi.fn((text: string, x: number, y: number) => {
                drawCalls.push({ text, x, y, font: currentFont });
            }),
            set fillStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set strokeStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set lineWidth(_value: number) { void _value; },
            set filter(_value: string) { void _value; },
            set font(value: string) {
                currentFont = value;
            },
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

        return { canvas, drawCalls };
    };

    it('shrinks title, artist, and album fonts together when content grows', () => {
        const { canvas, drawCalls } = createTextContext();

        renderShareImagePreview(canvas, {
            title: 'Track',
            album: 'Album',
            artist: 'Name Name Name Name Name Name',
            comment: '',
            coverImage: { width: 10, height: 10 } as unknown as CanvasImageSource,
        });

        const textDraws = drawCalls.filter((call) => call.x >= 262 && call.y >= 68 && call.y < 260);
        const titleSize = textDraws
            .find((call) => call.font.startsWith('700 '))
            ?.font.match(/\s(\d+)px\s/)?.[1];
        const artistSize = textDraws
            .find((call) => call.font.startsWith('600 '))
            ?.font.match(/\s(\d+)px\s/)?.[1];
        const albumSize = textDraws
            .find((call) => call.font.startsWith('500 '))
            ?.font.match(/\s(\d+)px\s/)?.[1];

        expect(titleSize).toBeDefined();
        expect(artistSize).toBeDefined();
        expect(albumSize).toBeDefined();

        const titleReduction = 31 - Number(titleSize);
        const artistReduction = 23 - Number(artistSize);
        const albumReduction = 18 - Number(albumSize);

        expect(titleReduction).toBeGreaterThan(0);
        expect(titleReduction).toBe(artistReduction);
        expect(titleReduction).toBe(albumReduction);
    });

    it('caps shared shrink at five points and ellipsizes within configured line limits', () => {
        const { canvas, drawCalls } = createTextContext();

        const veryLongText = 'extraordinarilylongword extraordinarilylongword extraordinarilylongword extraordinarilylongword';
        renderShareImagePreview(canvas, {
            title: veryLongText,
            album: veryLongText,
            artist: veryLongText,
            comment: '',
        });

        const titleLines = drawCalls.filter((call) => call.font === '700 26px "Nunito", "Segoe UI", sans-serif');
        const artistLines = drawCalls.filter((call) => call.font === '600 18px "Nunito", "Segoe UI", sans-serif');
        const albumLines = drawCalls.filter((call) => call.font === '500 13px "Nunito", "Segoe UI", sans-serif');

        expect(titleLines.length).toBeLessThanOrEqual(3);
        expect(artistLines.length).toBeLessThanOrEqual(1);
        expect(albumLines.length).toBeLessThanOrEqual(2);

        expect(titleLines.some((line) => line.text.includes('...'))).toBe(true);
        expect(artistLines.some((line) => line.text.includes('...'))).toBe(true);
        expect(albumLines.some((line) => line.text.includes('...'))).toBe(true);
    });

    it('keeps metadata block above the quote panel when content is dense', () => {
        const { canvas, drawCalls } = createTextContext();

        renderShareImagePreview(canvas, {
            title: 'Long title words long title words long title words long title words long title words long title words',
            album: 'Long album words long album words long album words long album words',
            artist: 'Long artist words long artist words long artist words long artist words',
            comment: 'Comment present',
            coverImage: { width: 10, height: 10 } as unknown as CanvasImageSource,
        });

        const metadataDraws = drawCalls.filter((call) => call.x >= 262 && call.y >= 68 && call.y < 228);
        expect(metadataDraws.length).toBeGreaterThan(0);

        const lowestMetadataY = Math.max(...metadataDraws.map((call) => call.y));
        expect(lowestMetadataY).toBeLessThan(220);
    });
});
