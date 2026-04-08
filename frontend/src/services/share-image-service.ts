export type ShareImagePreviewData = {
    title: string;
    album: string;
    artist: string;
    comment: string;
    coverImage?: CanvasImageSource;
    accents?: ShareImageAccentPalette;
};

export type ShareImageAccentPalette = {
    primary: string;
    secondary: string;
};

const shareImageWidth = 600;
const shareImageHeight = 350;
const coverPaletteSampleSize = 48;
const defaultShareImageAccents: ShareImageAccentPalette = {
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

const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void => {
    const cappedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + cappedRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, cappedRadius);
    ctx.arcTo(x + width, y + height, x, y + height, cappedRadius);
    ctx.arcTo(x, y + height, x, y, cappedRadius);
    ctx.arcTo(x, y, x + width, y, cappedRadius);
    ctx.closePath();
};

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const clampColorByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));

const rgbToHex = (color: RgbColor): string => {
    const toHex = (channel: number): string => channel.toString(16).padStart(2, '0');
    return `#${toHex(clampColorByte(color.r))}${toHex(clampColorByte(color.g))}${toHex(clampColorByte(color.b))}`;
};

const rgbToCss = (color: RgbColor, alpha: number): string => `rgba(${clampColorByte(color.r)}, ${clampColorByte(color.g)}, ${clampColorByte(color.b)}, ${clampUnit(alpha)})`;

const mixRgb = (first: RgbColor, second: RgbColor, ratio: number): RgbColor => {
    const t = clampUnit(ratio);
    return {
        r: first.r + (second.r - first.r) * t,
        g: first.g + (second.g - first.g) * t,
        b: first.b + (second.b - first.b) * t,
    };
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

const parseHexColor = (value: string): RgbColor => {
    const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
    if (!match) {
        return { r: 0, g: 0, b: 0 };
    }

    const intColor = Number.parseInt(match[1], 16);
    return {
        r: (intColor >> 16) & 255,
        g: (intColor >> 8) & 255,
        b: intColor & 255,
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

const fitTextWithEllipsis = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
    const trimmed = text.trim();
    if (trimmed === '' || ctx.measureText(trimmed).width <= maxWidth) {
        return trimmed;
    }

    let next = trimmed;
    while (next.length > 1 && ctx.measureText(`${next}...`).width > maxWidth) {
        next = next.slice(0, -1).trimEnd();
    }

    return `${next}...`;
};

const wrapTextLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] => {
    const paragraphs = text
        .split(/\r?\n/)
        .map((paragraph) => normalizeWhitespace(paragraph))
        .filter((paragraph) => paragraph !== '');

    if (paragraphs.length === 0) {
        return [];
    }

    const lines: string[] = [];
    for (const paragraph of paragraphs) {
        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
            const candidate = currentLine ? `${currentLine} ${word}` : word;
            if (ctx.measureText(candidate).width <= maxWidth) {
                currentLine = candidate;
                continue;
            }

            if (currentLine) {
                lines.push(currentLine);
                if (lines.length === maxLines) {
                    lines[maxLines - 1] = fitTextWithEllipsis(ctx, `${lines[maxLines - 1]} ${word}`.trim(), maxWidth);
                    return lines;
                }
            }

            currentLine = fitTextWithEllipsis(ctx, word, maxWidth);
        }

        if (currentLine) {
            lines.push(currentLine);
            if (lines.length === maxLines) {
                return lines;
            }
        }
    }

    return lines.slice(0, maxLines);
};

const fillCanvasBackground = (ctx: CanvasRenderingContext2D, accents: ShareImageAccentPalette): void => {
    const primary = parseHexColor(accents.primary);
    const secondary = parseHexColor(accents.secondary);
    const deepBase = { r: 18, g: 21, b: 29 };

    const gradientStart = mixRgb(deepBase, primary, 0.3);
    const gradientMid = mixRgb(deepBase, mixRgb(primary, secondary, 0.36), 0.34);
    const gradientEnd = mixRgb(deepBase, secondary, 0.28);

    const gradient = ctx.createLinearGradient(0, 0, shareImageWidth, shareImageHeight);
    gradient.addColorStop(0, rgbToHex(gradientStart));
    gradient.addColorStop(0.55, rgbToHex(gradientMid));
    gradient.addColorStop(1, rgbToHex(gradientEnd));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);

    const glowA = ctx.createRadialGradient(110, 64, 0, 110, 64, 210);
    glowA.addColorStop(0, rgbToCss(primary, 0.28));
    glowA.addColorStop(1, rgbToCss(primary, 0));
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);

    const glowB = ctx.createRadialGradient(510, 280, 0, 510, 280, 240);
    glowB.addColorStop(0, rgbToCss(secondary, 0.2));
    glowB.addColorStop(1, rgbToCss(secondary, 0));
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);
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

const drawImageContain = (
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

    const scale = Math.min(width / sourceSize.width, height / sourceSize.height);
    const drawWidth = sourceSize.width * scale;
    const drawHeight = sourceSize.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;

    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
};

const drawCoverBlock = (ctx: CanvasRenderingContext2D, coverImage: CanvasImageSource | undefined): void => {
    const coverX = 34;
    const coverY = 30;
    const coverSize = 194;
    const coverRadius = 24;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 18;
    drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
    ctx.restore();

    if (coverImage) {
        ctx.save();
        drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius);
        ctx.clip();

        // Match player-card behavior: a blurred cover-fit backdrop fills letterboxing/pillarboxing.
        ctx.filter = 'blur(10px) brightness(0.9) saturate(0.9)';
        drawImageCover(ctx, coverImage, coverX, coverY, coverSize, coverSize);
        ctx.filter = 'none';

        ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(coverX, coverY, coverSize, coverSize);

        drawImageContain(ctx, coverImage, coverX, coverY, coverSize, coverSize);
        ctx.restore();
        return;
    }

    const placeholderGradient = ctx.createLinearGradient(coverX, coverY, coverX + coverSize, coverY + coverSize);
    placeholderGradient.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    placeholderGradient.addColorStop(1, 'rgba(255, 255, 255, 0.03)');
    ctx.save();
    drawRoundedRect(ctx, coverX, coverY, coverSize, coverSize, coverRadius);
    ctx.fillStyle = placeholderGradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.font = '700 72px "Nunito", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', coverX + coverSize / 2, coverY + coverSize / 2 + 6);
    ctx.restore();
};

const drawLabel = (ctx: CanvasRenderingContext2D, label: string, x: number, y: number): void => {
    ctx.save();
    ctx.fillStyle = 'rgba(214, 223, 236, 0.66)';
    ctx.font = '700 13px "Nunito", "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(label.toUpperCase(), x, y);
    ctx.restore();
};

export const renderShareImagePreview = (canvas: HTMLCanvasElement, data: ShareImagePreviewData): void => {
    const context = canvas.getContext('2d');
    if (!context) {
        throw new Error('Share preview canvas is unavailable');
    }

    canvas.width = shareImageWidth;
    canvas.height = shareImageHeight;

    const ctx = context;
    ctx.clearRect(0, 0, shareImageWidth, shareImageHeight);
    fillCanvasBackground(ctx, data.accents || defaultShareImageAccents);
    drawCoverBlock(ctx, data.coverImage);

    const textX = 262;
    const textWidth = shareImageWidth - textX - 34;

    drawLabel(ctx, 'Now playing', textX, 42);

    ctx.save();
    ctx.fillStyle = '#f7f4ef';
    ctx.textBaseline = 'top';

    ctx.font = '700 31px "Nunito", "Segoe UI", sans-serif';
    const titleLines = wrapTextLines(ctx, normalizeWhitespace(data.title) || 'Unknown Title', textWidth, 3);
    let cursorY = 68;
    for (const line of titleLines) {
        ctx.fillText(line, textX, cursorY);
        cursorY += 34;
    }

    cursorY += 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = '600 23px "Nunito", "Segoe UI", sans-serif';
    const artistLines = wrapTextLines(ctx, normalizeWhitespace(data.artist) || 'Unknown Artist', textWidth, 2);
    for (const line of artistLines) {
        ctx.fillText(line, textX, cursorY);
        cursorY += 27;
    }

    cursorY += 8;
    ctx.fillStyle = 'rgba(214, 223, 236, 0.78)';
    ctx.font = '500 18px "Nunito", "Segoe UI", sans-serif';
    const albumLines = wrapTextLines(ctx, normalizeWhitespace(data.album) || 'Unknown Album', textWidth, 2);
    for (const line of albumLines) {
        ctx.fillText(line, textX, cursorY);
        cursorY += 22;
    }
    ctx.restore();

    const normalizedComment = normalizeWhitespace(data.comment);
    if (normalizedComment !== '') {
        const quoteBoxX = 262;
        const quoteBoxY = 228;
        const quoteBoxWidth = shareImageWidth - quoteBoxX - 34;
        const quoteBoxHeight = 76;

        ctx.save();
        drawRoundedRect(ctx, quoteBoxX, quoteBoxY, quoteBoxWidth, quoteBoxHeight, 20);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'italic 21px Georgia, "Times New Roman", serif';
        ctx.textBaseline = 'top';
        const quoteLines = wrapTextLines(ctx, `“${normalizedComment}”`, quoteBoxWidth - 30, 3);
        let quoteY = quoteBoxY + 16;
        for (const line of quoteLines) {
            ctx.fillText(line, quoteBoxX + 15, quoteY);
            quoteY += 24;
        }
        ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = 'rgba(214, 223, 236, 0.58)';
    ctx.font = '600 12px "Nunito", "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Shared from Silphium', shareImageWidth - 34, shareImageHeight - 22);
    ctx.restore();
};

export const loadShareCanvasImage = async (src: string | undefined): Promise<ImageBitmap | undefined> => {
    const normalizedSource = (src || '').trim();
    if (normalizedSource === '') {
        return undefined;
    }

    try {
        const response = await fetch(normalizedSource);
        if (!response.ok) {
            return undefined;
        }

        const blob = await response.blob();
        if (blob.size === 0) {
            return undefined;
        }

        return await createImageBitmap(blob);
    } catch {
        return undefined;
    }
};

export const canvasToPngBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
    return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }

            reject(new Error('Unable to encode share preview as PNG'));
        }, 'image/png');
    });
};