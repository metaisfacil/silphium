export type ShareImageAccentPalette = {
    primary: string;
    secondary: string;
};

const coverPaletteSampleSize = 48;

export const defaultShareImageAccents: ShareImageAccentPalette = {
    primary: '#68b4ff',
    secondary: '#ff9a73',
};

type RgbColor = {
    r: number;
    g: number;
    b: number;
};

type HslColor = {
    h: number;
    s: number;
    l: number;
};

type QuantizedColorBucket = {
    count: number;
    sumR: number;
    sumG: number;
    sumB: number;
    sumS: number;
    sumL: number;
    sumH: number;
};

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const clampColorByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

const rgbToHex = (color: RgbColor): string => {
    const toHex = (channel: number): string => channel.toString(16).padStart(2, '0');
    return `#${toHex(clampColorByte(color.r))}${toHex(clampColorByte(color.g))}${toHex(clampColorByte(color.b))}`;
};

const rgbToHsl = (color: RgbColor): HslColor => {
    const r = clampUnit(color.r / 255);
    const g = clampUnit(color.g / 255);
    const b = clampUnit(color.b / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const lightness = (max + min) / 2;

    if (delta === 0) {
        return { h: 0, s: 0, l: lightness };
    }

    const saturation = delta / (1 - Math.abs((2 * lightness) - 1));
    let hue = 0;
    if (max === r) {
        hue = ((g - b) / delta) % 6;
    } else if (max === g) {
        hue = ((b - r) / delta) + 2;
    } else {
        hue = ((r - g) / delta) + 4;
    }

    return {
        h: ((hue * 60) + 360) % 360,
        s: clampUnit(saturation),
        l: clampUnit(lightness),
    };
};

const hslToRgb = (color: HslColor): RgbColor => {
    const hue = ((color.h % 360) + 360) % 360;
    const saturation = clampUnit(color.s);
    const lightness = clampUnit(color.l);

    if (saturation === 0) {
        const gray = clampColorByte(lightness * 255);
        return { r: gray, g: gray, b: gray };
    }

    const chroma = (1 - Math.abs((2 * lightness) - 1)) * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = lightness - (chroma / 2);

    let rPrime = 0;
    let gPrime = 0;
    let bPrime = 0;

    if (hue < 60) {
        rPrime = chroma;
        gPrime = x;
    } else if (hue < 120) {
        rPrime = x;
        gPrime = chroma;
    } else if (hue < 180) {
        gPrime = chroma;
        bPrime = x;
    } else if (hue < 240) {
        gPrime = x;
        bPrime = chroma;
    } else if (hue < 300) {
        rPrime = x;
        bPrime = chroma;
    } else {
        rPrime = chroma;
        bPrime = x;
    }

    return {
        r: (rPrime + m) * 255,
        g: (gPrime + m) * 255,
        b: (bPrime + m) * 255,
    };
};

const enforceAccentRange = (color: RgbColor, targetLightness: number): RgbColor => {
    const hsl = rgbToHsl(color);
    return hslToRgb({
        h: hsl.h,
        s: Math.max(0.34, hsl.s),
        l: clampUnit((hsl.l * 0.5) + (targetLightness * 0.5)),
    });
};

const hueDistance = (a: number, b: number): number => {
    const diff = Math.abs(a - b) % 360;
    return Math.min(diff, 360 - diff) / 180;
};

const quantizeColors = (source: Uint8ClampedArray): QuantizedColorBucket[] => {
    const buckets = new Map<string, QuantizedColorBucket>();

    for (let index = 0; index < source.length; index += 4) {
        const alpha = source[index + 3] / 255;
        if (alpha < 0.15) {
            continue;
        }

        const r = source[index];
        const g = source[index + 1];
        const b = source[index + 2];
        const hsl = rgbToHsl({ r, g, b });
        const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
        const bucket = buckets.get(key) || {
            count: 0,
            sumR: 0,
            sumG: 0,
            sumB: 0,
            sumS: 0,
            sumL: 0,
            sumH: 0,
        };

        bucket.count += alpha;
        bucket.sumR += r * alpha;
        bucket.sumG += g * alpha;
        bucket.sumB += b * alpha;
        bucket.sumS += hsl.s * alpha;
        bucket.sumL += hsl.l * alpha;
        bucket.sumH += hsl.h * alpha;
        buckets.set(key, bucket);
    }

    return Array.from(buckets.values())
        .filter((bucket) => bucket.count > 0)
        .sort((a, b) => b.count - a.count);
};

const averageBucketColor = (bucket: QuantizedColorBucket): { rgb: RgbColor; hsl: HslColor; score: number } => {
    const count = Math.max(1, bucket.count);
    const avgColor = {
        r: bucket.sumR / count,
        g: bucket.sumG / count,
        b: bucket.sumB / count,
    };
    const avgHsl = {
        h: bucket.sumH / count,
        s: bucket.sumS / count,
        l: bucket.sumL / count,
    };
    const balancedLightness = 1 - Math.abs(avgHsl.l - 0.5);
    const score = count * (0.55 + (avgHsl.s * 1.15)) * (0.7 + (balancedLightness * 0.5));
    return {
        rgb: avgColor,
        hsl: avgHsl,
        score,
    };
};

const getCanvasImageSourceSize = (source: CanvasImageSource): { width: number; height: number } | undefined => {
    const candidate = source as {
        naturalWidth?: number;
        naturalHeight?: number;
        videoWidth?: number;
        videoHeight?: number;
        displayWidth?: number;
        displayHeight?: number;
        width?: number;
        height?: number;
    };

    const width = candidate.naturalWidth
        || candidate.videoWidth
        || candidate.displayWidth
        || candidate.width
        || 0;
    const height = candidate.naturalHeight
        || candidate.videoHeight
        || candidate.displayHeight
        || candidate.height
        || 0;

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined;
    }

    return { width, height };
};

const drawImageCover = (
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
): void => {
    const sourceSize = getCanvasImageSourceSize(source);
    if (!sourceSize) {
        ctx.drawImage(source, x, y, width, height);
        return;
    }

    const scale = Math.max(width / sourceSize.width, height / sourceSize.height);
    const drawWidth = sourceSize.width * scale;
    const drawHeight = sourceSize.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
};

const sampleCoverArtPixels = (coverImage: CanvasImageSource): Uint8ClampedArray | undefined => {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = coverPaletteSampleSize;
    sampleCanvas.height = coverPaletteSampleSize;

    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
        return undefined;
    }

    context.clearRect(0, 0, coverPaletteSampleSize, coverPaletteSampleSize);
    drawImageCover(context, coverImage, 0, 0, coverPaletteSampleSize, coverPaletteSampleSize);
    const imageData = context.getImageData(0, 0, coverPaletteSampleSize, coverPaletteSampleSize);
    return imageData.data;
};

export const deriveShareImageAccentPalette = (coverImage: CanvasImageSource | undefined): ShareImageAccentPalette => {
    if (!coverImage) {
        return defaultShareImageAccents;
    }

    try {
        const sampledPixels = sampleCoverArtPixels(coverImage);
        if (!sampledPixels || sampledPixels.length === 0) {
            return defaultShareImageAccents;
        }

        const buckets = quantizeColors(sampledPixels);
        if (buckets.length === 0) {
            return defaultShareImageAccents;
        }

        const analyzed = buckets
            .map((bucket) => averageBucketColor(bucket))
            .sort((a, b) => b.score - a.score);
        const primaryColor = analyzed[0];
        if (!primaryColor) {
            return defaultShareImageAccents;
        }

        const secondaryColor = analyzed
            .slice(1)
            .map((candidate) => {
                const hueGap = hueDistance(primaryColor.hsl.h, candidate.hsl.h);
                const lightnessGap = Math.abs(primaryColor.hsl.l - candidate.hsl.l);
                const saturationGap = Math.abs(primaryColor.hsl.s - candidate.hsl.s);
                const separation = (hueGap * 0.65) + (lightnessGap * 0.25) + (saturationGap * 0.1);
                return {
                    candidate,
                    rank: candidate.score * (0.85 + separation),
                    separation,
                };
            })
            .filter((entry) => entry.separation >= 0.12)
            .sort((a, b) => b.rank - a.rank)[0]?.candidate;

        const primaryAccent = enforceAccentRange(primaryColor.rgb, 0.56);
        const secondaryAccent = secondaryColor
            ? enforceAccentRange(secondaryColor.rgb, 0.62)
            : hslToRgb({
                h: (primaryColor.hsl.h + 34) % 360,
                s: Math.max(0.38, primaryColor.hsl.s * 0.82),
                l: clampUnit(primaryColor.hsl.l * 0.9 + 0.2),
            });

        return {
            primary: rgbToHex(primaryAccent),
            secondary: rgbToHex(secondaryAccent),
        };
    } catch {
        return defaultShareImageAccents;
    }
};
