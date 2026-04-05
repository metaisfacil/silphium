export type ShareImagePreviewData = {
    title: string;
    album: string;
    artist: string;
    comment: string;
    coverImage?: CanvasImageSource;
};

const shareImageWidth = 600;
const shareImageHeight = 350;

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

const fillCanvasBackground = (ctx: CanvasRenderingContext2D): void => {
    const gradient = ctx.createLinearGradient(0, 0, shareImageWidth, shareImageHeight);
    gradient.addColorStop(0, '#12151d');
    gradient.addColorStop(0.55, '#1a1f2b');
    gradient.addColorStop(1, '#21181f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);

    const glowA = ctx.createRadialGradient(110, 64, 0, 110, 64, 210);
    glowA.addColorStop(0, 'rgba(104, 180, 255, 0.28)');
    glowA.addColorStop(1, 'rgba(104, 180, 255, 0)');
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);

    const glowB = ctx.createRadialGradient(510, 280, 0, 510, 280, 240);
    glowB.addColorStop(0, 'rgba(255, 154, 115, 0.2)');
    glowB.addColorStop(1, 'rgba(255, 154, 115, 0)');
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, shareImageWidth, shareImageHeight);
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

    if (coverImage) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.filter = 'blur(28px) saturate(1.08)';
        drawRoundedRect(ctx, -8, 16, 244, 244, 36);
        ctx.clip();
        drawImageCover(ctx, coverImage, -8, 16, 244, 244);
        ctx.restore();
    }

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
    fillCanvasBackground(ctx);
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