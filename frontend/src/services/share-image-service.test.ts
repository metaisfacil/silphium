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
    it('layers a full-background blurred cover wash before the cover block treatment', () => {
        const drawCalls: Array<{ call: unknown[]; filter: string; globalAlpha: number }> = [];
        let currentFilter = 'none';
        let currentGlobalAlpha = 1;
        const stateStack: Array<{ filter: string; globalAlpha: number }> = [];
        const drawImage = vi.fn((...call: unknown[]) => {
            drawCalls.push({ call, filter: currentFilter, globalAlpha: currentGlobalAlpha });
        });
        const context = {
            clearRect: vi.fn(),
            createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            arcTo: vi.fn(),
            closePath: vi.fn(),
            clip: vi.fn(),
            fillRect: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            fillText: vi.fn(),
            save: vi.fn(() => {
                stateStack.push({ filter: currentFilter, globalAlpha: currentGlobalAlpha });
            }),
            restore: vi.fn(() => {
                const previousState = stateStack.pop();
                currentFilter = previousState?.filter ?? 'none';
                currentGlobalAlpha = previousState?.globalAlpha ?? 1;
            }),
            measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
            drawImage,
            set fillStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set strokeStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set lineWidth(_value: number) { void _value; },
            set filter(value: string) {
                currentFilter = value;
            },
            set font(_value: string) { void _value; },
            set textAlign(_value: CanvasTextAlign) { void _value; },
            set textBaseline(_value: CanvasTextBaseline) { void _value; },
            set globalAlpha(value: number) {
                currentGlobalAlpha = value;
            },
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

        const fullBackgroundBlurCall = drawCalls.find(({ call, filter, globalAlpha }) => {
            const [source, x, y, width, height] = call;
            return source === coverImage
                && filter === 'blur(34px) brightness(0.76) saturate(0.88)'
                && Math.abs(globalAlpha - 0.18) < 0.001
                && Number(x) < 0
                && Math.abs(Number(y)) < 0.001
                && Number(width) > 600
                && Math.abs(Number(height) - 350) < 0.001;
        });
        expect(fullBackgroundBlurCall).toBeDefined();

        const blurredBackgroundCall = drawCalls.find(({ call }) => {
            const [source, x, y, width, height] = call;
            return source === coverImage
                && Number(x) < 34
                && Math.abs(Number(y) - 23) < 0.001
                && Number(width) > 194
                && Math.abs(Number(height) - 194) < 0.001;
        });
        expect(blurredBackgroundCall).toBeDefined();

        const containCall = drawCalls.find(({ call, filter, globalAlpha }) => {
            const [source, x, y, width, height] = call;
            return source === coverImage
                && filter === 'none'
                && Math.abs(globalAlpha - 1) < 0.001
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
            lineTo: vi.fn(),
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
            set globalAlpha(_value: number) { void _value; },
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

        const textDraws = drawCalls.filter((call) => call.x >= 262 && call.y >= 61 && call.y < 260);
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

    it('keeps shared shrink within the configured limit and ellipsizes within configured line limits', () => {
        const { canvas, drawCalls } = createTextContext();

        const veryLongText = 'extraordinarilylongword extraordinarilylongword extraordinarilylongword extraordinarilylongword';
        renderShareImagePreview(canvas, {
            title: veryLongText,
            album: veryLongText,
            artist: veryLongText,
            comment: '',
        });

        const metadataDraws = drawCalls.filter((call) => call.x >= 262 && call.y >= 61 && call.y < 260);
        const titleLines = metadataDraws.filter((call) => call.font.startsWith('700 '));
        const artistLines = metadataDraws.filter((call) => call.font.startsWith('600 '));
        const albumLines = metadataDraws.filter((call) => call.font.startsWith('500 '));

        const titleSize = titleLines[0]?.font.match(/\s(\d+)px\s/)?.[1];
        const artistSize = artistLines[0]?.font.match(/\s(\d+)px\s/)?.[1];
        const albumSize = albumLines[0]?.font.match(/\s(\d+)px\s/)?.[1];

        expect(titleSize).toBeDefined();
        expect(artistSize).toBeDefined();
        expect(albumSize).toBeDefined();

        const titleReduction = 31 - Number(titleSize);
        const artistReduction = 23 - Number(artistSize);
        const albumReduction = 18 - Number(albumSize);

        expect(titleLines.length).toBeLessThanOrEqual(3);
        expect(artistLines.length).toBeLessThanOrEqual(1);
        expect(albumLines.length).toBeLessThanOrEqual(2);

        expect(titleReduction).toBeGreaterThan(0);
        expect(titleReduction).toBe(artistReduction + 2);
        expect(titleReduction).toBe(albumReduction + 2);
        expect(titleReduction).toBeLessThanOrEqual(7);

        expect(titleLines.some((line) => line.text.includes('...'))).toBe(true);
        expect(artistLines.some((line) => line.text.includes('...'))).toBe(true);
        expect(albumLines.some((line) => line.text.includes('...'))).toBe(true);
    });

    it('slightly shrinks a title when it still needs three lines', () => {
        const { canvas, drawCalls } = createTextContext();

        renderShareImagePreview(canvas, {
            title: 'extraordinarilylongword extraordinarilylongword extraordinarilylongword extraordinarilylongword',
            album: 'Album',
            artist: 'Artist',
            comment: '',
        });

        const titleLines = drawCalls.filter((call) => call.font.startsWith('700 ') && call.x >= 262 && call.y >= 61 && call.y < 260);
        const titleSize = titleLines[0]?.font.match(/\s(\d+)px\s/)?.[1];

        expect(titleLines.length).toBe(3);
        expect(titleSize).toBeDefined();
        expect(Number(titleSize)).toBeLessThan(31);
        expect(titleLines.some((line) => line.text.includes('...'))).toBe(true);
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

    it('wraps long Japanese titles without spaces before using ellipsis', () => {
        const { canvas, drawCalls } = createTextContext();

        renderShareImagePreview(canvas, {
            title: 'バブリー革命~ばんばんバブル~バブリー革命~ばんばんバブル~',
            album: 'Album',
            artist: 'Artist',
            comment: '',
        });

        const titleLines = drawCalls.filter((call) => call.font.startsWith('700 '));
        expect(titleLines.length).toBeGreaterThan(1);
        expect(titleLines.some((line) => line.text.includes('...'))).toBe(false);
        expect(titleLines.slice(0, -1).some((line) => line.text.endsWith('~'))).toBe(true);
    });

    it('draws a subtle waveform flourish behind metadata', () => {
        const lineTo = vi.fn();
        const context = {
            clearRect: vi.fn(),
            createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo,
            arcTo: vi.fn(),
            closePath: vi.fn(),
            clip: vi.fn(),
            fillRect: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            drawImage: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 8 })),
            fillText: vi.fn(),
            set fillStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set strokeStyle(_value: string | CanvasGradient | CanvasPattern) { void _value; },
            set lineWidth(_value: number) { void _value; },
            set filter(_value: string) { void _value; },
            set font(_value: string) { void _value; },
            set textAlign(_value: CanvasTextAlign) { void _value; },
            set textBaseline(_value: CanvasTextBaseline) { void _value; },
            set globalAlpha(_value: number) { void _value; },
            set shadowColor(_value: string) { void _value; },
            set shadowBlur(_value: number) { void _value; },
            set shadowOffsetY(_value: number) { void _value; },
        } as unknown as CanvasRenderingContext2D;

        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        } as unknown as HTMLCanvasElement;

        renderShareImagePreview(canvas, {
            title: 'Track',
            album: 'Album',
            artist: 'Artist',
            comment: '',
            waveformSamples: new Array(64).fill(0).map((_, index) => (index % 7) / 6),
        });

        expect(lineTo).toHaveBeenCalled();
        expect(lineTo.mock.calls.length).toBeGreaterThan(50);
    });

    it('renders genre and style values as wrapped pills below album metadata', () => {
        const drawCalls: Array<{ text: string; x: number; y: number; font: string }> = [];
        let currentFont = '12px sans-serif';
        const context = {
            clearRect: vi.fn(),
            createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            arcTo: vi.fn(),
            closePath: vi.fn(),
            clip: vi.fn(),
            fillRect: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            drawImage: vi.fn(),
            measureText: vi.fn((text: string) => ({ width: text.length * 7.2 })),
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
            set globalAlpha(_value: number) { void _value; },
            set shadowColor(_value: string) { void _value; },
            set shadowBlur(_value: number) { void _value; },
            set shadowOffsetY(_value: number) { void _value; },
        } as unknown as CanvasRenderingContext2D;

        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
        } as unknown as HTMLCanvasElement;

        renderShareImagePreview(canvas, {
            title: 'Track',
            album: 'Album',
            artist: 'Artist',
            comment: '',
            genres: ['Electronic', 'Ambient', 'Synthwave', 'Post-rock'],
        });

        const expectedGenres = ['Electronic', 'Ambient', 'Synthwave', 'Post-rock'];
        const pillLabels = drawCalls
            .filter((call) => expectedGenres.includes(call.text))
            .map((call) => call.text);
        const albumCall = drawCalls.find((call) => call.text === 'Album');
        const genreCalls = drawCalls.filter((call) => expectedGenres.includes(call.text));

        expect(pillLabels).toEqual(expect.arrayContaining(expectedGenres));
        expect(albumCall).toBeDefined();
        expect(genreCalls.length).toBe(4);
        expect(genreCalls.every((call) => call.y > (albumCall?.y || 0))).toBe(true);
    });

    it('keeps genre pills at a fixed distance above the quote box regardless of metadata height', () => {
        const createCanvasWithDrawCalls = () => {
            const drawCalls: Array<{ text: string; x: number; y: number; font: string }> = [];
            let currentFont = '12px sans-serif';
            const context = {
                clearRect: vi.fn(),
                createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
                createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
                beginPath: vi.fn(),
                moveTo: vi.fn(),
                lineTo: vi.fn(),
                arcTo: vi.fn(),
                closePath: vi.fn(),
                clip: vi.fn(),
                fillRect: vi.fn(),
                fill: vi.fn(),
                stroke: vi.fn(),
                save: vi.fn(),
                restore: vi.fn(),
                drawImage: vi.fn(),
                measureText: vi.fn((text: string) => ({ width: text.length * 7.2 })),
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
                set globalAlpha(_value: number) { void _value; },
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

        const expectedGenres = ['ambient', 'downtempo'];

        const shortRender = createCanvasWithDrawCalls();
        renderShareImagePreview(shortRender.canvas, {
            title: 'Track',
            album: 'Album',
            artist: 'Artist',
            comment: 'Listening right now.',
            genres: expectedGenres,
        });

        const longRender = createCanvasWithDrawCalls();
        renderShareImagePreview(longRender.canvas, {
            title: 'Long title words long title words long title words long title words long title words',
            album: 'Long album words long album words long album words long album words',
            artist: 'Long artist words long artist words long artist words',
            comment: 'Listening right now.',
            genres: expectedGenres,
        });

        const shortGenreYs = shortRender.drawCalls
            .filter((call) => expectedGenres.includes(call.text))
            .map((call) => call.y);
        const longGenreYs = longRender.drawCalls
            .filter((call) => expectedGenres.includes(call.text))
            .map((call) => call.y);

        expect(shortGenreYs).toEqual(longGenreYs);
    });
});
