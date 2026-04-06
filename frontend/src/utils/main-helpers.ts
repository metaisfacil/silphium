import type {
    AppLibraryFolder,
    PlaybackOrderMode,
    ScrobbleFilterMode,
    Track,
    TrackTags,
    TrackTechnicalDetails,
} from '../types/app-types';

export const asPlaybackOrderMode = (value: string): PlaybackOrderMode => {
    if (value === 'ordered-album' || value === 'ordered-library' || value === 'shuffle-album' || value === 'shuffle-library') {
        return value;
    }

    return 'ordered-library';
};

export const asScrobbleFilterMode = (value: string): ScrobbleFilterMode => {
    return value === 'whitelist' ? 'whitelist' : 'blacklist';
};

export const asReleaseDepth = (value: unknown): number => {
    const numeric = typeof value === 'number'
        ? value
        : Number.parseInt(String(value ?? ''), 10);

    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }

    return Math.min(Math.floor(numeric), 64);
};

export const libraryFolderPathKey = (path: string): string => path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
export const normalizeScrobbleFolders = (folders: string[] | undefined): string[] => {
    if (!Array.isArray(folders)) {
        return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const folder of folders) {
        const cleaned = String(folder || '').trim();
        if (cleaned === '') {
            continue;
        }

        const key = libraryFolderPathKey(cleaned);
        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push(cleaned);
    }

    return normalized;
};

export const isTrackPathScrobbleAllowed = (
    trackPath: string,
    mode: ScrobbleFilterMode,
    scrobbleFolders: string[],
): boolean => {
    const pathKey = libraryFolderPathKey(trackPath);
    if (!pathKey) {
        return false;
    }

    const hasMatch = scrobbleFolders.some((folderPath) => {
        const folderKey = libraryFolderPathKey(folderPath);
        return folderKey !== '' && (pathKey === folderKey || pathKey.startsWith(`${folderKey}/`));
    });

    return mode === 'whitelist' ? hasMatch : !hasMatch;
};
export const normalizeLibraryFolderLabel = (value: unknown): string => String(value || '')
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const libraryFolderBaseName = (path: string): string => {
    const normalized = path.trim().replace(/\\/g, '/');
    const segments = normalized.split('/').filter((segment) => segment !== '');
    return segments[segments.length - 1] || 'Library';
};

const libraryFolderDisplayBase = (folder: AppLibraryFolder): string => normalizeLibraryFolderLabel(folder.label) || libraryFolderBaseName(folder.path);

export const normalizeLibraryFolders = (
    folders: AppLibraryFolder[] | undefined,
    legacyPath?: string,
    legacyReleaseDepth?: number,
): AppLibraryFolder[] => {
    const candidates = Array.isArray(folders) && folders.length > 0
        ? folders
        : (legacyPath || '').trim() !== ''
            ? [{ path: legacyPath || '', label: '', releaseDepth: asReleaseDepth(legacyReleaseDepth) }]
            : [];

    const normalized: AppLibraryFolder[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const path = String(candidate?.path || '').trim();
        if (!path) {
            continue;
        }

        const key = libraryFolderPathKey(path);
        if (!key || seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push({
            path,
            label: normalizeLibraryFolderLabel(candidate?.label),
            releaseDepth: asReleaseDepth(candidate?.releaseDepth),
        });
    }

    return normalized;
};

export const buildLibraryRootNameByPath = (folders: AppLibraryFolder[]): Map<string, string> => {
    const totals = new Map<string, number>();
    const seen = new Map<string, number>();

    folders.forEach((folder) => {
        const baseKey = libraryFolderDisplayBase(folder).toLowerCase();
        totals.set(baseKey, (totals.get(baseKey) || 0) + 1);
    });

    const names = new Map<string, string>();
    folders.forEach((folder) => {
        const baseName = libraryFolderDisplayBase(folder);
        const baseKey = baseName.toLowerCase();
        const nextIndex = (seen.get(baseKey) || 0) + 1;
        seen.set(baseKey, nextIndex);
        names.set(
            libraryFolderPathKey(folder.path),
            (totals.get(baseKey) || 0) > 1 ? `${baseName} (${nextIndex})` : baseName,
        );
    });

    return names;
};

export const findLibraryFolderForFilePath = (filePath: string, folders: AppLibraryFolder[]): AppLibraryFolder | null => {
    const normalizedFilePath = libraryFolderPathKey(filePath);
    if (!normalizedFilePath) {
        return null;
    }

    let bestMatch: AppLibraryFolder | null = null;
    let bestMatchLength = -1;
    for (const folder of folders) {
        const folderKey = libraryFolderPathKey(folder.path);
        if (!folderKey) {
            continue;
        }

        if (normalizedFilePath !== folderKey && !normalizedFilePath.startsWith(`${folderKey}/`)) {
            continue;
        }

        if (folderKey.length <= bestMatchLength) {
            continue;
        }

        bestMatch = folder;
        bestMatchLength = folderKey.length;
    }

    return bestMatch;
};

export const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0:00';
    }

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

export const base64ToObjectUrl = (base64: string, mimeType: string): string => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
};

export const base64ToDataUrl = (base64: string, mimeType: string): string => {
    return `data:${mimeType};base64,${base64}`;
};

export const mimeTypeForFileName = (name: string): string => {
    if (/\.png$/i.test(name)) {
        return 'image/png';
    }

    if (/\.gif$/i.test(name)) {
        return 'image/gif';
    }

    if (/\.webp$/i.test(name)) {
        return 'image/webp';
    }

    if (/\.bmp$/i.test(name)) {
        return 'image/bmp';
    }

    if (/\.jpe?g$/i.test(name)) {
        return 'image/jpeg';
    }

    return 'application/octet-stream';
};

export const folderKeyForPath = (folderPath: string): string => folderPath.toLowerCase();

export const trackVersionFromTags = (tags?: TrackTags): string => {
    const directVersion = tags?.version?.trim() || '';
    if (directVersion) {
        return directVersion;
    }

    const allTags = tags?.allTags;
    if (!allTags) {
        return '';
    }

    for (const [key, values] of Object.entries(allTags)) {
        if (key.trim().toLowerCase() !== 'version') {
            continue;
        }

        for (const value of values) {
            const cleaned = value.trim();
            if (cleaned) {
                return cleaned;
            }
        }
    }

    return '';
};

export const formatAlbumWithVersion = (album: string, version: string): string => {
    const cleanVersion = version.trim();
    if (!cleanVersion) {
        return album;
    }

    const bracketedVersion = `(${cleanVersion})`;
    if (album.toLowerCase().endsWith(bracketedVersion.toLowerCase())) {
        return album;
    }

    return `${album} ${bracketedVersion}`;
};

export const buildDisplayMetadata = (track: Track, tags?: TrackTags): { title: string; album: string; artist: string } => {
    const title = tags?.title?.trim() ? tags.title.trim() : track.title;
    const baseAlbum = tags?.album?.trim() ? tags.album.trim() : 'Unknown Album';
    const album = formatAlbumWithVersion(baseAlbum, trackVersionFromTags(tags));
    const artist = tags?.artist?.trim() ? tags.artist.trim() : 'Unknown Artist';

    return { title, album, artist };
};

export const taggedTrackPosition = (track: Track): string => {
    const number = track.displayTrackNumber.trim();
    const total = track.displayTrackTotal.trim();

    if (!number) {
        return '';
    }

    if (!total) {
        return `(#${number})`;
    }

    return `(${number}/${total})`;
};

export const formatTechnicalMetadata = (bitDepth?: number, sampleRate?: number, codec?: string, bitRate?: number): string => {
    const isKnownLossyCodec = (codecLabel: string): boolean => {
        return codecLabel === 'MP3'
            || codecLabel === 'AAC'
            || codecLabel === 'HE-AAC'
            || codecLabel === 'OPUS'
            || codecLabel === 'VORBIS'
            || codecLabel === 'OGG'
            || codecLabel === 'WMA';
    };

    const hasBitDepth = Number.isFinite(bitDepth) && (bitDepth as number) > 0;
    const hasSampleRate = Number.isFinite(sampleRate) && (sampleRate as number) > 0;
    const hasBitRate = Number.isFinite(bitRate) && (bitRate as number) > 0;
    const codecLabel = (codec || '').trim().toUpperCase();
    const isLossyCodec = isKnownLossyCodec(codecLabel);
    const shouldShowBitDepth = hasBitDepth && !isLossyCodec;

    let bitRateLabel = '';
    if (hasBitRate) {
        const kbps = (bitRate as number) / 1000;
        const kbpsLabel = Number.isInteger(kbps) ? String(kbps) : kbps.toFixed(1).replace(/\.0$/, '');
        bitRateLabel = `${kbpsLabel}k`;
    }

    let rateLabel = '';
    if (hasSampleRate) {
        const rateKhz = (sampleRate as number) / 1000;
        rateLabel = Number.isInteger(rateKhz) ? String(rateKhz) : rateKhz.toFixed(1).replace(/\.0$/, '');
    }

    const technicalParts: string[] = [];
    if (shouldShowBitDepth || hasSampleRate) {
        const depthLabel = shouldShowBitDepth
            ? String(bitDepth)
            : (isLossyCodec && bitRateLabel ? bitRateLabel : '?');
        const ratePart = hasSampleRate ? rateLabel : '?';
        technicalParts.push(`${depthLabel}/${ratePart}`);
    }

    if (codecLabel) {
        technicalParts.push(codecLabel);
    }

    if (technicalParts.length === 0) {
        return '';
    }

    if (technicalParts.length === 1) {
        return technicalParts[0];
    }

    return `${technicalParts[0]} • ${technicalParts[1]}`;
};

export const technicalDetailsFromTags = (tags?: TrackTags): TrackTechnicalDetails => ({
    bitDepth: Number.isFinite(tags?.bitDepth) && (tags?.bitDepth as number) > 0 ? (tags?.bitDepth as number) : undefined,
    sampleRate: Number.isFinite(tags?.sampleRate) && (tags?.sampleRate as number) > 0 ? (tags?.sampleRate as number) : undefined,
    codec: tags?.codec?.trim() || undefined,
    codecLong: tags?.codecLong?.trim() || undefined,
    codecProfile: tags?.codecProfile?.trim() || undefined,
    sampleFormat: tags?.sampleFormat?.trim() || undefined,
    channels: Number.isFinite(tags?.channels) && (tags?.channels as number) > 0 ? (tags?.channels as number) : undefined,
    channelLayout: tags?.channelLayout?.trim() || undefined,
    bitRate: Number.isFinite(tags?.bitRate) && (tags?.bitRate as number) > 0 ? (tags?.bitRate as number) : undefined,
    overallBitRate: Number.isFinite(tags?.overallBitRate) && (tags?.overallBitRate as number) > 0 ? (tags?.overallBitRate as number) : undefined,
    durationSeconds: Number.isFinite(tags?.durationSeconds) && (tags?.durationSeconds as number) > 0 ? (tags?.durationSeconds as number) : undefined,
    container: tags?.container?.trim() || undefined,
    fileSizeBytes: Number.isFinite(tags?.fileSizeBytes) && (tags?.fileSizeBytes as number) > 0 ? (tags?.fileSizeBytes as number) : undefined,
});

export const allFileTagsFromTags = (tags?: TrackTags): Record<string, string[]> => {
    const source = tags?.allTags;
    if (!source) {
        return {};
    }

    const normalizedEntries = Object.entries(source)
        .map(([key, values]) => {
            const normalizedKey = key.trim();
            const normalizedValues = values
                .map((value) => value.trim())
                .filter((value) => value !== '');
            return [normalizedKey, normalizedValues] as const;
        })
        .filter(([key, values]) => key !== '' && values.length > 0);

    if (normalizedEntries.length === 0) {
        return {};
    }

    return Object.fromEntries(normalizedEntries);
};

export const stripSyncedLyricTiming = (lyrics: string): string => {
    return lyrics
        .split(/\r?\n/)
        .map((line) => line.replace(/\[[0-9]{1,2}:[0-9]{2}(?:[.:][0-9]{1,3})?\]/g, '').replace(/<[0-9]{1,2}:[0-9]{2}(?:[.:][0-9]{1,3})?>/g, '').trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

export const normalizeTrackLyrics = (tags?: TrackTags): string => {
    const unsynced = tags?.unsyncedLyrics?.trim() || '';
    if (unsynced) {
        return unsynced;
    }

    const synced = tags?.lyrics?.trim() || '';
    if (!synced) {
        return '';
    }

    return stripSyncedLyricTiming(synced);
};

const formatDurationWithSeconds = (durationSeconds: number): string => {
    const durationLabel = formatTime(durationSeconds);
    const secondsLabel = durationSeconds.toFixed(3).replace(/\.000$/, '');
    return `${durationLabel} (${secondsLabel} s)`;
};

const formatBitRateValue = (bitRate: number): string => {
    if (bitRate >= 1_000_000) {
        return `${(bitRate / 1_000_000).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')} Mbps`;
    }

    return `${Math.round(bitRate / 1_000)} kbps`;
};

const formatFileSizeValue = (fileSizeBytes: number): string => {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = fileSizeBytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    const decimals = unitIndex === 0 ? 0 : 2;
    return `${size.toFixed(decimals).replace(/\.00$/, '')} ${units[unitIndex]} (${fileSizeBytes.toLocaleString()} bytes)`;
};

const buildTechnicalInfoRows = (track: Track): Array<{ label: string; value: string }> => {
    const details = track.technicalDetails;
    const rows: Array<{ label: string; value: string }> = [
        { label: 'File name', value: track.name },
        { label: 'Full path', value: track.path },
    ];

    if (details.container) {
        rows.push({ label: 'Container', value: details.container });
    }

    if (details.codec) {
        rows.push({ label: 'Codec', value: details.codec });
    }

    if (details.codecLong) {
        rows.push({ label: 'Codec description', value: details.codecLong });
    }

    if (details.codecProfile) {
        rows.push({ label: 'Codec profile', value: details.codecProfile });
    }

    if (details.sampleFormat) {
        rows.push({ label: 'Sample format', value: details.sampleFormat });
    }

    if (details.bitDepth) {
        rows.push({ label: 'Bit depth', value: `${details.bitDepth}-bit` });
    }

    if (details.sampleRate) {
        rows.push({ label: 'Sample rate', value: `${details.sampleRate.toLocaleString()} Hz` });
    }

    if (details.channels) {
        rows.push({ label: 'Channels', value: String(details.channels) });
    }

    if (details.channelLayout) {
        rows.push({ label: 'Channel layout', value: details.channelLayout });
    }

    if (details.bitRate) {
        rows.push({ label: 'Audio bitrate', value: formatBitRateValue(details.bitRate) });
    }

    if (details.overallBitRate) {
        rows.push({ label: 'Overall bitrate', value: formatBitRateValue(details.overallBitRate) });
    }

    if (details.durationSeconds) {
        rows.push({ label: 'Duration', value: formatDurationWithSeconds(details.durationSeconds) });
    }

    if (details.fileSizeBytes) {
        rows.push({ label: 'File size', value: formatFileSizeValue(details.fileSizeBytes) });
    }

    return rows;
};

export const renderTechnicalInfoContent = (container: HTMLElement, track: Track): void => {
    container.innerHTML = '';
    container.style.removeProperty('--technical-info-first-column-width');

    const rows = buildTechnicalInfoRows(track);
    if (rows.length === 0) {
        container.innerHTML = '<p class="technical-info-empty">No technical information available for this track.</p>';
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'technical-info-grid';

    for (const row of rows) {
        const label = document.createElement('p');
        label.className = 'technical-info-label';
        label.textContent = row.label;

        const value = document.createElement('p');
        value.className = 'technical-info-value';
        value.textContent = row.value;

        grid.append(label, value);
    }

    container.append(grid);

    const tagSection = document.createElement('section');
    tagSection.className = 'technical-info-tag-section';

    const tagTitle = document.createElement('p');
    tagTitle.className = 'technical-info-tag-title';
    tagTitle.textContent = 'All file tags';
    tagSection.append(tagTitle);

    const sortedTagEntries = Object.entries(track.allFileTags)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { sensitivity: 'base' }));

    if (sortedTagEntries.length === 0) {
        const emptyTags = document.createElement('p');
        emptyTags.className = 'technical-info-empty';
        emptyTags.textContent = 'No tag values found in this file.';
        tagSection.append(emptyTags);
        container.append(tagSection);
        return;
    }

    const tagList = document.createElement('div');
    tagList.className = 'technical-info-tag-list';

    for (const [tagKey, values] of sortedTagEntries) {
        const keyElement = document.createElement('p');
        keyElement.className = 'technical-info-tag-key';
        keyElement.textContent = tagKey;

        const valueElement = document.createElement('p');
        valueElement.className = 'technical-info-tag-value';
        valueElement.textContent = values.join('\n');

        tagList.append(keyElement, valueElement);
    }

    tagSection.append(tagList);
    container.append(tagSection);

    const firstColumnCells = container.querySelectorAll<HTMLElement>('.technical-info-label, .technical-info-tag-key');
    let firstColumnWidth = 0;
    for (let index = 0; index < firstColumnCells.length; index += 1) {
        const cell = firstColumnCells[index];
        firstColumnWidth = Math.max(firstColumnWidth, cell.scrollWidth);
    }
    if (firstColumnWidth > 0) {
        container.style.setProperty('--technical-info-first-column-width', `${firstColumnWidth}px`);
    }
};
