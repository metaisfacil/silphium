import type {
    AppSettings,
    AppLibraryFolder,
    PlaybackOrderMode,
    ScrobbleFilterMode,
    ScrobbleRule,
    ScrobbleRuleField,
    ScrobbleRuleOperator,
    Track,
    TrackTags,
    TrackTechnicalDetails,
} from '../types/app-types';

export const defaultLibrarySharingPort = 41637;

export const asPlaybackOrderMode = (value: string): PlaybackOrderMode => {
    if (value === 'ordered-album' || value === 'ordered-library' || value === 'shuffle-album' || value === 'shuffle-library') {
        return value;
    }

    return 'ordered-library';
};

export const asScrobbleFilterMode = (value: string): ScrobbleFilterMode => {
    return value === 'whitelist' ? 'whitelist' : 'blacklist';
};

const asScrobbleRuleField = (value: string): ScrobbleRuleField | null => {
    if (value === 'path' || value === 'albumArtist' || value === 'trackArtist' || value === 'albumTitle' || value === 'trackTitle'
        || value === 'genre' || value === 'anyTag' || value === 'artistMbid' || value === 'albumMbid' || value === 'trackLength') {
        return value;
    }

    return null;
};

const defaultScrobbleRuleOperator = (field: ScrobbleRuleField): ScrobbleRuleOperator => {
    if (field === 'trackLength') {
        return 'greater_than';
    }

    if (field === 'path') {
        return 'starts_with';
    }

    return 'contains';
};

const asScrobbleRuleOperator = (value: string, field: ScrobbleRuleField): ScrobbleRuleOperator => {
    if (field === 'trackLength') {
        return value === 'less_than' || value === 'greater_than'
            ? value
            : defaultScrobbleRuleOperator(field);
    }

    return value === 'contains' || value === 'equals' || value === 'starts_with' || value === 'regex'
        ? value
        : defaultScrobbleRuleOperator(field);
};

const normalizeLegacyScrobbleFolders = (folders: string[] | undefined): string[] => {
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

const normalizeScrobbleRuleValue = (field: ScrobbleRuleField, value: string): string => {
    const trimmed = value.trim();
    if (trimmed === '') {
        return '';
    }

    if (field === 'trackLength') {
        const parsed = Number.parseInt(trimmed, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            return '';
        }

        return String(Math.floor(parsed));
    }

    return trimmed;
};

export const normalizeScrobbleRules = (
    rules: ScrobbleRule[] | undefined,
    legacyFolders?: string[],
): ScrobbleRule[] => {
    const candidates = Array.isArray(rules) && rules.length > 0
        ? rules
        : normalizeLegacyScrobbleFolders(legacyFolders).map((folder) => ({
            field: 'path' as const,
            operator: 'starts_with' as const,
            value: folder,
        }));

    const normalized: ScrobbleRule[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const field = asScrobbleRuleField(String(candidate?.field || ''));
        if (!field) {
            continue;
        }

        const operator = asScrobbleRuleOperator(String(candidate?.operator || ''), field);
        const value = normalizeScrobbleRuleValue(field, String(candidate?.value || ''));
        if (value === '') {
            continue;
        }

        const dedupeValue = field === 'path' && operator !== 'regex'
            ? libraryFolderPathKey(value)
            : value.toLowerCase();
        const key = `${field}|${operator}|${dedupeValue}`;
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push({ field, operator, value });
    }

    return normalized;
};

const scrobbleRuleFieldLabel = (field: ScrobbleRuleField): string => {
    switch (field) {
    case 'path':
        return 'Path';
    case 'albumArtist':
        return 'Album artist';
    case 'trackArtist':
        return 'Track artist';
    case 'albumTitle':
        return 'Album title';
    case 'trackTitle':
        return 'Track title';
    case 'genre':
        return 'Genre';
    case 'anyTag':
        return 'Any tag';
    case 'artistMbid':
        return 'Artist MBID';
    case 'albumMbid':
        return 'Album MBID';
    case 'trackLength':
        return 'Track length';
    }
};

const scrobbleRuleOperatorLabel = (operator: ScrobbleRuleOperator): string => {
    switch (operator) {
    case 'contains':
        return 'contains';
    case 'equals':
        return 'equals';
    case 'starts_with':
        return 'starts with';
    case 'regex':
        return 'matches RegEx';
    case 'less_than':
        return 'is shorter than';
    case 'greater_than':
        return 'is longer than';
    }
};

export const describeScrobbleRule = (rule: ScrobbleRule): string => {
    if (rule.field === 'trackLength') {
        return `${scrobbleRuleFieldLabel(rule.field)} ${scrobbleRuleOperatorLabel(rule.operator)} ${rule.value}s`;
    }

    return `${scrobbleRuleFieldLabel(rule.field)} ${scrobbleRuleOperatorLabel(rule.operator)} ${rule.value}`;
};

const parseScrobbleRegex = (pattern: string): RegExp | null => {
    const trimmed = pattern.trim();
    if (trimmed === '') {
        return null;
    }

    if (trimmed.startsWith('/')) {
        const lastSlashIndex = trimmed.lastIndexOf('/');
        if (lastSlashIndex > 0) {
            const body = trimmed.slice(1, lastSlashIndex);
            const flags = trimmed.slice(lastSlashIndex + 1);
            try {
                return new RegExp(body, flags);
            } catch {
                return null;
            }
        }
    }

    try {
        return new RegExp(trimmed, 'i');
    } catch {
        return null;
    }
};

export const validateScrobbleRules = (rules: ScrobbleRule[]): string | null => {
    for (const rule of rules) {
        if (rule.field === 'trackLength') {
            const numeric = Number.parseInt(rule.value, 10);
            if (!Number.isFinite(numeric) || numeric < 0) {
                return `Invalid track length in rule: ${describeScrobbleRule(rule)}`;
            }

            continue;
        }

        if (rule.operator !== 'regex') {
            continue;
        }

        if (!parseScrobbleRegex(rule.value)) {
            return `Invalid RegEx in rule: ${describeScrobbleRule(rule)}`;
        }
    }

    return null;
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

export const normalizeLibrarySharingPort = (value: unknown): number => {
    const numeric = typeof value === 'number'
        ? value
        : Number.parseInt(String(value ?? ''), 10);

    if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 65535) {
        return defaultLibrarySharingPort;
    }

    return Math.floor(numeric);
};

export const normalizeLibraryFolderKind = (value: unknown): 'local' | 'remote' => {
    return String(value || '').trim().toLowerCase() === 'remote' ? 'remote' : 'local';
};

export const parseRemoteLibraryConnectionInput = (value: unknown): { host: string; port: number | null } => {
    const trimmed = String(value || '').trim();
    if (trimmed === '') {
        return { host: '', port: null };
    }

    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `silphium-remote://${trimmed}`;

    try {
        const parsed = new URL(withScheme);
        const host = (parsed.hostname || '').trim().replace(/^\[(.*)\]$/, '$1').toLowerCase();
        const port = parsed.port ? Number.parseInt(parsed.port, 10) : null;
        return {
            host,
            port: Number.isFinite(port) ? port : null,
        };
    } catch {
        return { host: '', port: null };
    }
};

export const normalizeRemoteLibraryHost = (value: unknown): string => parseRemoteLibraryConnectionInput(value).host;

const remoteLibraryBasePathForFolder = (folder: Pick<AppLibraryFolder, 'path' | 'host' | 'port'>): string => {
    const parsedPath = String(folder.path || '').trim();
    if (/^silphium-remote:\/\//i.test(parsedPath)) {
        try {
            const parsed = new URL(parsedPath);
            const host = normalizeRemoteLibraryHost(parsed.hostname);
            if (host === '') {
                return '';
            }

            const port = normalizeLibrarySharingPort(parsed.port ? Number.parseInt(parsed.port, 10) : folder.port);
            const formattedHost = host.includes(':') ? `[${host}]` : host;
            return `silphium-remote://${formattedHost}:${port}`;
        } catch {
            return '';
        }
    }

    const parsedConnection = parseRemoteLibraryConnectionInput(folder.host);
    const host = parsedConnection.host;
    if (host === '') {
        return '';
    }

    const port = normalizeLibrarySharingPort(
        typeof folder.port === 'number' && folder.port > 0
            ? folder.port
            : parsedConnection.port,
    );
    const formattedHost = host.includes(':') ? `[${host}]` : host;
    return `silphium-remote://${formattedHost}:${port}`;
};

export const describeLibraryFolderConnection = (folder: AppLibraryFolder): string => {
    if (normalizeLibraryFolderKind(folder.kind) !== 'remote') {
        return folder.path.trim();
    }

    const basePath = remoteLibraryBasePathForFolder(folder);
    if (basePath === '') {
        return folder.path.trim();
    }

    try {
        const parsed = new URL(basePath);
        const host = normalizeRemoteLibraryHost(parsed.hostname);
        const port = normalizeLibrarySharingPort(parsed.port ? Number.parseInt(parsed.port, 10) : folder.port);
        return host === '' ? folder.path.trim() : `${host}:${port}`;
    } catch {
        return folder.path.trim();
    }
};

export const hasExternalFileDragPayload = (dataTransfer: { types?: ArrayLike<string> | readonly string[] } | null | undefined): boolean => {
    if (!dataTransfer?.types) {
        return false;
    }

    return Array.from(dataTransfer.types).some((type) => String(type).toLowerCase() === 'files');
};

const supportedAudioFileExtensions = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus']);

export const isSupportedAudioFilePath = (path: string): boolean => {
    const trimmed = path.trim();
    if (trimmed === '') {
        return false;
    }

    const extensionMatch = /\.[^./\\]+$/.exec(trimmed.toLowerCase());
    if (!extensionMatch) {
        return false;
    }

    return supportedAudioFileExtensions.has(extensionMatch[0]);
};

export const libraryFolderPathKey = (path: string): string => path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

const getTagValuesIgnoreCase = (tags: Record<string, string[]>, ...keys: string[]): string[] => {
    const normalizedKeys = keys.map((key) => key.toLowerCase());
    const values: string[] = [];
    for (const [key, rawValues] of Object.entries(tags)) {
        if (!normalizedKeys.includes(key.toLowerCase())) {
            continue;
        }

        for (const rawValue of rawValues) {
            const value = rawValue.trim();
            if (value !== '') {
                values.push(value);
            }
        }
    }

    return values;
};

const getFirstTagValueIgnoreCase = (tags: Record<string, string[]>, ...keys: string[]): string => {
    return getTagValuesIgnoreCase(tags, ...keys)[0] || '';
};

const getScrobbleTextCandidates = (track: Track, field: ScrobbleRuleField): string[] => {
    if (field === 'path') {
        return track.path.trim() ? [track.path.trim()] : [];
    }

    if (field === 'albumArtist') {
        const tagged = getFirstTagValueIgnoreCase(track.allFileTags, 'albumartist', 'album artist', 'album_artist');
        const fallback = track.displayArtist.trim();
        return tagged ? [tagged] : (fallback ? [fallback] : []);
    }

    if (field === 'trackArtist') {
        const tagged = getFirstTagValueIgnoreCase(track.allFileTags, 'artist', 'trackartist', 'track artist');
        const fallback = track.displayArtist.trim();
        return tagged ? [tagged] : (fallback ? [fallback] : []);
    }

    if (field === 'albumTitle') {
        const albumTitle = track.displayAlbum.trim();
        return albumTitle ? [albumTitle] : [];
    }

    if (field === 'trackTitle') {
        const trackTitle = (track.displayTitle || track.title).trim();
        return trackTitle ? [trackTitle] : [];
    }

    if (field === 'genre') {
        return getTagValuesIgnoreCase(track.allFileTags, 'genre');
    }

    if (field === 'anyTag') {
        const values: string[] = [];
        for (const rawValues of Object.values(track.allFileTags)) {
            for (const rawValue of rawValues) {
                const value = rawValue.trim();
                if (value !== '') {
                    values.push(value);
                }
            }
        }

        return values;
    }

    if (field === 'artistMbid') {
        const candidates = [track.mbIds.artistId || '', ...track.artistMbids]
            .map((value) => value.trim())
            .filter((value) => value !== '');
        return Array.from(new Set(candidates));
    }

    if (field === 'albumMbid') {
        const albumMbid = (track.mbIds.releaseId || '').trim();
        return albumMbid ? [albumMbid] : [];
    }

    return [];
};

const normalizeRuleComparisonText = (field: ScrobbleRuleField, value: string): string => {
    if (field === 'path') {
        return libraryFolderPathKey(value);
    }

    return value.trim().toLowerCase();
};

const matchesScrobbleTextRule = (candidate: string, rule: ScrobbleRule): boolean => {
    if (rule.field === 'trackLength') {
        return false;
    }

    if (rule.operator === 'regex') {
        const regex = parseScrobbleRegex(rule.value);
        return regex ? regex.test(candidate) : false;
    }

    const normalizedCandidate = normalizeRuleComparisonText(rule.field, candidate);
    const normalizedRuleValue = normalizeRuleComparisonText(rule.field, rule.value);
    if (normalizedRuleValue === '') {
        return false;
    }

    if (rule.operator === 'equals') {
        return normalizedCandidate === normalizedRuleValue;
    }

    if (rule.operator === 'starts_with') {
        if (rule.field === 'path') {
            return normalizedCandidate === normalizedRuleValue || normalizedCandidate.startsWith(`${normalizedRuleValue}/`);
        }

        return normalizedCandidate.startsWith(normalizedRuleValue);
    }

    return normalizedCandidate.includes(normalizedRuleValue);
};

const trackDurationSecondsForRule = (track: Track, playbackDurationSeconds: number): number | null => {
    if (Number.isFinite(playbackDurationSeconds) && playbackDurationSeconds > 0) {
        return playbackDurationSeconds;
    }

    if (Number.isFinite(track.technicalDetails.durationSeconds) && (track.technicalDetails.durationSeconds || 0) > 0) {
        return track.technicalDetails.durationSeconds || null;
    }

    return null;
};

const matchesScrobbleRule = (track: Track, playbackDurationSeconds: number, rule: ScrobbleRule): boolean => {
    if (rule.field === 'trackLength') {
        const durationSeconds = trackDurationSecondsForRule(track, playbackDurationSeconds);
        if (durationSeconds === null) {
            return false;
        }

        const thresholdSeconds = Number.parseInt(rule.value, 10);
        if (!Number.isFinite(thresholdSeconds)) {
            return false;
        }

        return rule.operator === 'less_than'
            ? durationSeconds < thresholdSeconds
            : durationSeconds > thresholdSeconds;
    }

    return getScrobbleTextCandidates(track, rule.field).some((candidate) => matchesScrobbleTextRule(candidate, rule));
};

export const isTrackScrobbleAllowed = (
    track: Track,
    playbackDurationSeconds: number,
    mode: ScrobbleFilterMode,
    scrobbleRules: ScrobbleRule[],
): boolean => {
    if (scrobbleRules.length === 0) {
        return mode === 'blacklist';
    }

    const hasMatch = scrobbleRules.some((rule) => matchesScrobbleRule(track, playbackDurationSeconds, rule));
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

const libraryFolderDisplayBase = (folder: AppLibraryFolder): string => normalizeLibraryFolderLabel(folder.label)
    || (normalizeLibraryFolderKind(folder.kind) === 'remote' ? describeLibraryFolderConnection(folder) : libraryFolderBaseName(folder.path));

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
        const kind = normalizeLibraryFolderKind(candidate?.kind);
        if (kind === 'remote' || String(candidate?.host || '').trim() !== '' || /^silphium-remote:\/\//i.test(String(candidate?.path || '').trim())) {
            const path = remoteLibraryBasePathForFolder({
                path: String(candidate?.path || '').trim(),
                host: candidate?.host,
                port: candidate?.port,
            });
            if (!path) {
                continue;
            }

            const key = libraryFolderPathKey(path);
            if (!key || seen.has(key)) {
                continue;
            }

            seen.add(key);
            const password = String(candidate?.password || '').trim();
            const passwordHash = String(candidate?.passwordHash || '').trim();
            normalized.push({
                path,
                kind: 'remote',
                host: normalizeRemoteLibraryHost(candidate?.host) || (() => {
                    try {
                        return normalizeRemoteLibraryHost(new URL(path).hostname);
                    } catch {
                        return '';
                    }
                })(),
                port: (() => {
                    try {
                        const parsed = new URL(path);
                        return normalizeLibrarySharingPort(parsed.port ? Number.parseInt(parsed.port, 10) : candidate?.port);
                    } catch {
                        return normalizeLibrarySharingPort(candidate?.port);
                    }
                })(),
                label: normalizeLibraryFolderLabel(candidate?.label),
                ...(password !== '' ? { password } : {}),
                ...(passwordHash !== '' ? { passwordHash } : {}),
                releaseDepth: asReleaseDepth(candidate?.releaseDepth),
            });
            continue;
        }

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

export const findLibraryFolderForTrack = (
    track: Pick<Track, 'rootPath' | 'path'>,
    folders: AppLibraryFolder[],
): AppLibraryFolder | null => {
    let bestMatch: AppLibraryFolder | null = null;
    let bestMatchLength = -1;

    for (const candidatePath of [track.rootPath || '', track.path || '']) {
        const match = findLibraryFolderForFilePath(candidatePath, folders);
        if (!match) {
            continue;
        }

        const matchLength = libraryFolderPathKey(match.path).length;
        if (matchLength <= bestMatchLength) {
            continue;
        }

        bestMatch = match;
        bestMatchLength = matchLength;
    }

    return bestMatch;
};

export const relativeFolderSegmentsForTrack = (
    folderPath: string,
    rootName: string,
): string[] => {
    const segments = folderPath.split('/').filter((segment) => segment !== '');
    if (segments.length === 0) {
        return [];
    }

    const normalizedRootName = rootName.trim().toLowerCase();
    if (!normalizedRootName) {
        return segments;
    }

    return segments[0]?.trim().toLowerCase() === normalizedRootName
        ? segments.slice(1)
        : segments;
};

export const releaseFolderPathForTrackAtDepth = (
    track: Pick<Track, 'folderPath' | 'rootName'>,
    releaseDepth: number,
): string => {
    const normalizedFolderPath = track.folderPath || '';
    const segments = normalizedFolderPath.split('/').filter((segment) => segment !== '');
    if (segments.length === 0) {
        return normalizedFolderPath;
    }

    const relativeSegments = relativeFolderSegmentsForTrack(normalizedFolderPath, track.rootName || '');
    if (releaseDepth <= 0 || relativeSegments.length === 0 || releaseDepth >= relativeSegments.length) {
        return normalizedFolderPath;
    }

    const normalizedRootName = (track.rootName || '').trim().toLowerCase();
    const hasRootSegment = normalizedRootName !== '' && segments[0]?.trim().toLowerCase() === normalizedRootName;
    const scopedSegments = hasRootSegment
        ? [segments[0], ...relativeSegments.slice(0, releaseDepth)]
        : relativeSegments.slice(0, releaseDepth);

    return scopedSegments.join('/');
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

const isRemoteTrackPath = (path: string): boolean => /^silphium-remote:\/\//i.test(path.trim());

const normalizeRemoteTranscodingBitrateKbps = (bitrateKbps?: number): number => {
    if (!Number.isFinite(bitrateKbps)) {
        return 192;
    }

    return Math.max(64, Math.min(320, Math.round(bitrateKbps || 192)));
};

export const effectivePlaybackTechnicalMetadata = (
    track: Pick<Track, 'path' | 'displayTechnical'>,
    settings: Pick<AppSettings, 'remoteLibraryTranscodingEnabled' | 'remoteLibraryTranscodingBitrateKbps'>,
): string => {
    if (!isRemoteTrackPath(track.path) || !settings.remoteLibraryTranscodingEnabled) {
        return track.displayTechnical;
    }

    const bitrateKbps = normalizeRemoteTranscodingBitrateKbps(settings.remoteLibraryTranscodingBitrateKbps);
    return `${bitrateKbps}k • OPUS`;
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
