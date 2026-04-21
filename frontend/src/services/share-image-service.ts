import { defaultShareImageAccents, type ShareImageAccentPalette } from '../utils/cover-accent-palette';

export type ShareImagePreviewData = {
    title: string;
    album: string;
    artist: string;
    comment: string;
    coverImage?: CanvasImageSource;
    accents?: ShareImageAccentPalette;
    waveformSamples?: number[];
};

const shareImageWidth = 600;
const shareImageHeight = 350;
const shareQuoteBoxY = 228;
const shareQuoteBoxHeight = 76;

type RgbColor = {
    r: number;
    g: number;
    b: number;
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

const splitTokenByWidth = (ctx: CanvasRenderingContext2D, token: string, maxWidth: number): string[] => {
    const graphemes = Array.from(token);
    if (graphemes.length === 0) {
        return [];
    }

    const preferredBreakCharacters = new Set(['~', '〜', '・', '/', '／', '-', '—', '–', ':', '：']);
    const chunks: string[] = [];
    let remaining = graphemes;

    while (remaining.length > 0) {
        let current = '';
        let overflowIndex = -1;
        let lastPreferredBreak = -1;

        for (let index = 0; index < remaining.length; index += 1) {
            const grapheme = remaining[index];
            const candidate = `${current}${grapheme}`;
            if (current !== '' && ctx.measureText(candidate).width > maxWidth) {
                overflowIndex = index;
                break;
            }

            current = candidate;
            if (preferredBreakCharacters.has(grapheme)) {
                lastPreferredBreak = index + 1;
            }
        }

        if (overflowIndex === -1) {
            chunks.push(current);
            break;
        }

        if (lastPreferredBreak > 0) {
            chunks.push(remaining.slice(0, lastPreferredBreak).join(''));
            remaining = remaining.slice(lastPreferredBreak);
            continue;
        }

        if (current !== '') {
            chunks.push(current);
            remaining = remaining.slice(overflowIndex);
            continue;
        }

        chunks.push(remaining[0]);
        remaining = remaining.slice(1);
    }

    return chunks;
};

type WrappedTextResult = {
    lines: string[];
    truncated: boolean;
};

const wrapTextLinesDetailed = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): WrappedTextResult => {
    const paragraphs = text
        .split(/\r?\n/)
        .map((paragraph) => normalizeWhitespace(paragraph))
        .filter((paragraph) => paragraph !== '');

    if (paragraphs.length === 0) {
        return {
            lines: [],
            truncated: false,
        };
    }

    const lines: string[] = [];
    let truncated = false;
    for (const paragraph of paragraphs) {
        const words = paragraph.split(' ');
        let currentLine = '';

        for (const word of words) {
            let remaining = word;
            let tokenNeedsSpace = currentLine !== '';
            while (remaining !== '') {
                const candidate = tokenNeedsSpace ? `${currentLine} ${remaining}` : `${currentLine}${remaining}`;
                if (ctx.measureText(candidate).width <= maxWidth) {
                    currentLine = candidate;
                    remaining = '';
                    break;
                }

                if (currentLine !== '') {
                    lines.push(currentLine);
                    if (lines.length === maxLines) {
                        const overflowText = tokenNeedsSpace ? `${lines[maxLines - 1]} ${remaining}`.trim() : `${lines[maxLines - 1]}${remaining}`;
                        lines[maxLines - 1] = fitTextWithEllipsis(ctx, overflowText, maxWidth);
                        truncated = true;
                        return {
                            lines,
                            truncated,
                        };
                    }

                    currentLine = '';
                    tokenNeedsSpace = false;
                    continue;
                }

                const segments = splitTokenByWidth(ctx, remaining, maxWidth);
                if (segments.length <= 1) {
                    currentLine = fitTextWithEllipsis(ctx, remaining, maxWidth);
                    if (currentLine !== remaining) {
                        truncated = true;
                    }
                    remaining = '';
                    break;
                }

                for (let index = 0; index < segments.length - 1; index += 1) {
                    lines.push(segments[index]);
                    if (lines.length === maxLines) {
                        const tail = segments.slice(index + 1).join('');
                        lines[maxLines - 1] = fitTextWithEllipsis(ctx, `${lines[maxLines - 1]}${tail}`, maxWidth);
                        truncated = true;
                        return {
                            lines,
                            truncated,
                        };
                    }
                }

                currentLine = segments[segments.length - 1];
                remaining = '';
            }
        }

        if (currentLine) {
            lines.push(currentLine);
            if (lines.length === maxLines) {
                continue;
            }
        }
    }

    if (lines.length > maxLines) {
        truncated = true;
    }

    return {
        lines: lines.slice(0, maxLines),
        truncated,
    };
};

const wrapTextLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] => {
    return wrapTextLinesDetailed(ctx, text, maxWidth, maxLines).lines;
};

const hashString = (text: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

const generateWaveformSignature = (seedText: string, sampleCount: number): number[] => {
    const minimumSampleCount = Math.max(24, sampleCount);
    let state = hashString(seedText || 'silphium-share-waveform');
    const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967295;
    };

    const envelope = new Array<number>(minimumSampleCount);
    for (let index = 0; index < minimumSampleCount; index += 1) {
        const progress = minimumSampleCount <= 1 ? 0 : index / (minimumSampleCount - 1);
        const edgeFade = Math.sin(Math.PI * progress) ** 0.66;
        const base = 0.2 + (next() * 0.72);
        envelope[index] = clampUnit(base * edgeFade);
    }

    // Light smoothing keeps the shape organic instead of jagged noise.
    const smoothed = new Array<number>(minimumSampleCount);
    for (let index = 0; index < minimumSampleCount; index += 1) {
        const previous = envelope[Math.max(0, index - 1)];
        const current = envelope[index];
        const following = envelope[Math.min(minimumSampleCount - 1, index + 1)];
        smoothed[index] = clampUnit((previous * 0.24) + (current * 0.52) + (following * 0.24));
    }

    return smoothed;
};

const normalizeWaveformSamples = (samples: number[] | undefined, seedText: string): number[] => {
    const usable = (samples || []).filter((sample) => Number.isFinite(sample));
    if (usable.length >= 24) {
        return usable.map((sample) => clampUnit(sample));
    }

    return generateWaveformSignature(seedText, 84);
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

const drawWaveformFlourish = (ctx: CanvasRenderingContext2D, accents: ShareImageAccentPalette, samples: number[]): void => {
    if (samples.length < 2) {
        return;
    }

    const primary = parseHexColor(accents.primary);
    const secondary = parseHexColor(accents.secondary);
    const startX = 16;
    const endX = shareImageWidth - 16;
    const width = endX - startX;
    const centerY = shareQuoteBoxY + (shareQuoteBoxHeight / 2);
    const amplitude = 26;
    const fadeInStop = 0.08;
    const fadeOutStop = 0.92;

    const strokeGradient = ctx.createLinearGradient(startX, 0, endX, 0);
    strokeGradient.addColorStop(0, rgbToCss(primary, 0));
    strokeGradient.addColorStop(fadeInStop, rgbToCss(primary, 0.05));
    strokeGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    strokeGradient.addColorStop(fadeOutStop, rgbToCss(secondary, 0.05));
    strokeGradient.addColorStop(1, rgbToCss(secondary, 0));

    const glowGradient = ctx.createLinearGradient(startX, 0, endX, 0);
    glowGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glowGradient.addColorStop(fadeInStop, 'rgba(255, 255, 255, 0.025)');
    glowGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.03)');
    glowGradient.addColorStop(fadeOutStop, 'rgba(255, 255, 255, 0.025)');
    glowGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

    const sampleCount = samples.length;

    ctx.save();
    ctx.beginPath();
    for (let index = 0; index < sampleCount; index += 1) {
        const progress = sampleCount <= 1 ? 0 : index / (sampleCount - 1);
        const x = startX + (width * progress);
        const centered = (samples[index] * 2) - 1;
        const y = centerY - (centered * amplitude);
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.strokeStyle = glowGradient;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = strokeGradient;
    ctx.lineWidth = 1.85;
    ctx.stroke();
    ctx.restore();
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

const drawBackgroundCoverOverlay = (ctx: CanvasRenderingContext2D, coverImage: CanvasImageSource | undefined): void => {
    if (!coverImage) {
        return;
    }

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.filter = 'blur(34px) brightness(0.76) saturate(0.88)';
    drawImageCover(ctx, coverImage, 0, 0, shareImageWidth, shareImageHeight);
    ctx.restore();

    ctx.save();
    const vignette = ctx.createLinearGradient(0, 0, 0, shareImageHeight);
    vignette.addColorStop(0, 'rgba(8, 10, 14, 0.18)');
    vignette.addColorStop(0.32, 'rgba(8, 10, 14, 0.08)');
    vignette.addColorStop(1, 'rgba(8, 10, 14, 0.24)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);
    ctx.restore();
};

const drawCoverBlock = (ctx: CanvasRenderingContext2D, coverImage: CanvasImageSource | undefined): void => {
    const coverX = 34;
    const coverY = 23;
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
    const trackTitle = normalizeWhitespace(data.title) || 'Unknown Title';
    const trackArtist = normalizeWhitespace(data.artist) || 'Unknown Artist';
    const trackAlbum = normalizeWhitespace(data.album) || 'Unknown Album';
    const waveformSamples = normalizeWaveformSamples(data.waveformSamples, `${trackTitle}|${trackArtist}|${trackAlbum}`);

    fillCanvasBackground(ctx, data.accents || defaultShareImageAccents);
    drawBackgroundCoverOverlay(ctx, data.coverImage);
    drawWaveformFlourish(ctx, data.accents || defaultShareImageAccents, waveformSamples);
    drawCoverBlock(ctx, data.coverImage);

    const contentStartY = 35;
    const textX = 262;
    const textWidth = shareImageWidth - textX - 34;

    drawLabel(ctx, 'Now playing', textX, contentStartY);

    const textFieldConfigs = [
        {
            text: trackTitle,
            baseSize: 31,
            maxReduction: 5,
            maxLines: 3,
            font: (size: number) => `700 ${size}px "Nunito", "Segoe UI", sans-serif`,
        },
        {
            text: trackArtist,
            baseSize: 23,
            maxReduction: 5,
            maxLines: 1,
            font: (size: number) => `600 ${size}px "Nunito", "Segoe UI", sans-serif`,
        },
        {
            text: trackAlbum,
            baseSize: 18,
            maxReduction: 5,
            maxLines: 2,
            font: (size: number) => `500 ${size}px "Nunito", "Segoe UI", sans-serif`,
        },
    ];

    const metadataStartY = contentStartY + 26;
    const commentTopY = contentStartY + 193;
    const metadataBottomPadding = 8;
    const metadataHeightBudget = commentTopY - metadataStartY - metadataBottomPadding;
    const maxSharedReduction = Math.min(...textFieldConfigs.map((field) => field.maxReduction));

    let sharedReduction = maxSharedReduction;
    let bestWithNoTruncation: number | undefined;
    let bestThatFitsVertically: number | undefined;
    for (let reduction = 0; reduction <= maxSharedReduction; reduction += 1) {
        const titleFontSize = textFieldConfigs[0].baseSize - reduction;
        const artistFontSize = textFieldConfigs[1].baseSize - reduction;
        const albumFontSize = textFieldConfigs[2].baseSize - reduction;

        const titleLineHeight = 34 - reduction;
        const artistLineHeight = 27 - reduction;
        const albumLineHeight = 22 - reduction;

        const titleGap = Math.max(4, 10 - reduction);
        const artistGap = Math.max(3, 8 - reduction);

        ctx.font = textFieldConfigs[0].font(titleFontSize);
        const titleLayout = wrapTextLinesDetailed(ctx, trackTitle, textWidth, textFieldConfigs[0].maxLines);
        ctx.font = textFieldConfigs[1].font(artistFontSize);
        const artistLayout = wrapTextLinesDetailed(ctx, trackArtist, textWidth, textFieldConfigs[1].maxLines);
        ctx.font = textFieldConfigs[2].font(albumFontSize);
        const albumLayout = wrapTextLinesDetailed(ctx, trackAlbum, textWidth, textFieldConfigs[2].maxLines);

        const metadataHeight = (titleLayout.lines.length * titleLineHeight)
            + titleGap
            + (artistLayout.lines.length * artistLineHeight)
            + artistGap
            + (albumLayout.lines.length * albumLineHeight);
        const hasTruncation = titleLayout.truncated || artistLayout.truncated || albumLayout.truncated;
        const fitsVertically = metadataHeight <= metadataHeightBudget;

        if (fitsVertically && bestThatFitsVertically === undefined) {
            bestThatFitsVertically = reduction;
        }

        if (fitsVertically && !hasTruncation) {
            bestWithNoTruncation = reduction;
            break;
        }

        sharedReduction = reduction;
    }

    if (bestWithNoTruncation !== undefined) {
        sharedReduction = bestWithNoTruncation;
    } else if (bestThatFitsVertically !== undefined) {
        sharedReduction = bestThatFitsVertically;
    }

    const titleFontSize = textFieldConfigs[0].baseSize - sharedReduction;
    const artistFontSize = textFieldConfigs[1].baseSize - sharedReduction;
    const albumFontSize = textFieldConfigs[2].baseSize - sharedReduction;

    const titleLineHeight = 34 - sharedReduction;
    const artistLineHeight = 27 - sharedReduction;
    const albumLineHeight = 22 - sharedReduction;
    const titleGap = Math.max(4, 10 - sharedReduction);
    const artistGap = Math.max(3, 8 - sharedReduction);

    ctx.save();
    ctx.fillStyle = '#f7f4ef';
    ctx.textBaseline = 'top';

    ctx.font = textFieldConfigs[0].font(titleFontSize);
    const titleLines = wrapTextLines(ctx, trackTitle, textWidth, 3);
    let cursorY = metadataStartY;
    for (const line of titleLines) {
        ctx.fillText(line, textX, cursorY);
        cursorY += titleLineHeight;
    }

    cursorY += titleGap;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.font = textFieldConfigs[1].font(artistFontSize);
    const artistLines = wrapTextLines(ctx, trackArtist, textWidth, 1);
    for (const line of artistLines) {
        ctx.fillText(line, textX, cursorY);
        cursorY += artistLineHeight;
    }

    cursorY += artistGap;
    ctx.fillStyle = 'rgba(214, 223, 236, 0.78)';
    ctx.font = textFieldConfigs[2].font(albumFontSize);
    const albumLines = wrapTextLines(ctx, trackAlbum, textWidth, 2);
    for (const line of albumLines) {
        ctx.fillText(line, textX, cursorY);
        cursorY += albumLineHeight;
    }
    ctx.restore();

    const normalizedComment = normalizeWhitespace(data.comment);
    if (normalizedComment !== '') {
        const quoteBoxX = 262;
        const quoteBoxY = shareQuoteBoxY;
        const quoteBoxWidth = shareImageWidth - quoteBoxX - 34;
        const quoteBoxHeight = shareQuoteBoxHeight;

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
    ctx.fillText('Shared from Silphium', shareImageWidth - 34, (shareImageHeight - 22) + (contentStartY - 35));
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