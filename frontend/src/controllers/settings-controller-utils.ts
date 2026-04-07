import type { CoverArtPrioritySource, CustomSendToAction, CustomSendToActionScope, MusicBrainzTagWorkerProgress, ScrobbleRuleField, ScrobbleRuleOperator } from '../types/app-types';
import { allCoverArtPrioritySources, defaultCoverArtPriority, DEFAULT_MUSIC_BRAINZ_TAG_STALE_DAYS, MAX_MUSIC_BRAINZ_TAG_STALE_DAYS } from './settings-controller-types';

export const normalizeCoverArtPriority = (items: string[] | undefined): CoverArtPrioritySource[] => {
    if (items === undefined) {
        return [...defaultCoverArtPriority];
    }

    const ordered: CoverArtPrioritySource[] = [];
    const seen = new Set<CoverArtPrioritySource>();
    for (const item of items) {
        const normalized = item.trim().toLowerCase();
        if (normalized !== 'file' && normalized !== 'embedded' && normalized !== 'musicbrainz') {
            continue;
        }

        const source = normalized as CoverArtPrioritySource;
        if (seen.has(source)) {
            continue;
        }

        seen.add(source);
        ordered.push(source);
    }

    if (ordered.length === 0 && items.length > 0) {
        return [...defaultCoverArtPriority];
    }

    return ordered;
};

export const normalizeCoverArtPriorityOrder = (items: string[] | undefined): CoverArtPrioritySource[] => {
    const ordered = normalizeCoverArtPriority(items);
    const seen = new Set<CoverArtPrioritySource>(ordered);
    for (const fallback of allCoverArtPrioritySources) {
        if (!seen.has(fallback)) {
            ordered.push(fallback);
        }
    }

    return ordered;
};

export const scrobbleTextOperatorOptions: Array<{ value: ScrobbleRuleOperator; label: string }> = [
    { value: 'contains', label: 'Contains text' },
    { value: 'equals', label: 'Equals text' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'regex', label: 'Matches RegEx' },
];

export const scrobbleDurationOperatorOptions: Array<{ value: ScrobbleRuleOperator; label: string }> = [
    { value: 'less_than', label: 'Is shorter than' },
    { value: 'greater_than', label: 'Is longer than' },
];

export const normalizeFavoritePlaylists = (items: string[]): string[] => {
    const deduped = new Set<string>();
    const lines = items
        .map((line) => line.trim())
        .filter((line) => line !== '');

    lines.forEach((line) => {
        deduped.add(line);
    });

    return Array.from(deduped);
};

export const asCustomSendToActionScope = (value: string): CustomSendToActionScope | null => {
    if (value === 'track' || value === 'album' || value === 'file' || value === 'folder') {
        return value;
    }

    return null;
};

export const normalizeCustomSendToActions = (items: CustomSendToAction[]): CustomSendToAction[] => {
    const deduped = new Set<string>();
    const normalized: CustomSendToAction[] = [];
    for (const item of items) {
        const title = item.title.trim();
        const commandTemplate = item.commandTemplate.trim();
        const scope = asCustomSendToActionScope(item.scope);
        if (title === '' || commandTemplate === '' || scope === null) {
            continue;
        }

        const dedupeKey = `${scope}\n${title.toLowerCase()}\n${commandTemplate.toLowerCase()}`;
        if (deduped.has(dedupeKey)) {
            continue;
        }

        deduped.add(dedupeKey);
        normalized.push({
            title,
            scope,
            commandTemplate,
        });
    }

    return normalized;
};

export const asScrobbleRuleField = (value: string): ScrobbleRuleField => {
    switch (value) {
    case 'albumArtist':
    case 'trackArtist':
    case 'albumTitle':
    case 'trackTitle':
    case 'genre':
    case 'anyTag':
    case 'artistMbid':
    case 'albumMbid':
    case 'trackLength':
        return value;
    default:
        return 'path';
    }
};

export const defaultScrobbleRuleOperator = (field: ScrobbleRuleField): ScrobbleRuleOperator => {
    if (field === 'trackLength') {
        return 'greater_than';
    }

    if (field === 'path') {
        return 'starts_with';
    }

    return 'contains';
};

export const operatorOptionsForScrobbleRuleField = (field: ScrobbleRuleField): Array<{ value: ScrobbleRuleOperator; label: string }> => {
    return field === 'trackLength' ? scrobbleDurationOperatorOptions : scrobbleTextOperatorOptions;
};

export const normalizeMusicBrainzTagWorkerCores = (value: string): number => {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }

    return Math.min(Math.floor(parsed), 128);
};

export const normalizeMusicBrainzTagStaleDays = (value: string): number => {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_MUSIC_BRAINZ_TAG_STALE_DAYS;
    }

    return Math.min(Math.floor(parsed), MAX_MUSIC_BRAINZ_TAG_STALE_DAYS);
};

export const normalizeMusicBrainzTagWorkerProgress = (value?: Partial<MusicBrainzTagWorkerProgress> | null): MusicBrainzTagWorkerProgress => {
    const source = value || {};
    const progress = Number.isFinite(source.progress) ? Number(source.progress) : 0;
    const clampCount = (count: unknown): number => {
        const numeric = Number(count);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return 0;
        }

        return Math.floor(numeric);
    };

    return {
        enabled: !!source.enabled,
        active: !!source.active,
        progress: Math.max(0, Math.min(1, progress)),
        pendingTrackScans: clampCount(source.pendingTrackScans),
        totalTrackScans: clampCount(source.totalTrackScans),
        completedTrackScans: clampCount(source.completedTrackScans),
        pendingEntityLookups: clampCount(source.pendingEntityLookups),
        totalEntityLookups: clampCount(source.totalEntityLookups),
        completedEntityLookups: clampCount(source.completedEntityLookups),
    };
};

export const normalizeRequestRateMs = (value: string): number => {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }

    return Math.floor(parsed);
};

export const PUBLIC_MIN_RATE_LIMIT_MS = 1000;

export const parseServerHostname = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed === '') {
        return '';
    }

    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        return new URL(withScheme).hostname.toLowerCase();
    } catch {
        return '';
    }
};

export const isLocalDevelopmentServer = (url: string): boolean => {
    const host = parseServerHostname(url);
    return host === 'localhost'
        || host === '::1'
        || host === '127.0.0.1'
        || /^127\./.test(host)
        || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
        || /^10\.0\.\d{1,3}\.\d{1,3}$/.test(host);
};

export const normalizeServerRequestRateMs = (value: string, serverUrl: string): number => {
    const parsed = normalizeRequestRateMs(value);
    if (isLocalDevelopmentServer(serverUrl)) {
        return parsed;
    }

    return Math.max(PUBLIC_MIN_RATE_LIMIT_MS, parsed);
};

export const normalizeAudioOutputBufferMs = (rawValue: string): number => {
    const trimmed = rawValue.trim();
    if (trimmed === '') {
        return 0;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 0;
    }

    return Math.min(1000, parsed);
};

export const formatEtaLabel = (secondsRemaining: number | null): string => {
    if (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining <= 0) {
        return '';
    }

    const wholeSeconds = Math.max(1, Math.ceil(secondsRemaining));
    if (wholeSeconds < 60) {
        return `~${wholeSeconds}s`;
    }

    const minutes = Math.floor(wholeSeconds / 60);
    const seconds = wholeSeconds % 60;
    if (seconds === 0) {
        return `~${minutes}m`;
    }

    return `~${minutes}m ${seconds}s`;
};

export const formatCustomActionScopeLabel = (scope: CustomSendToActionScope): string => {
    if (scope === 'track') {
        return 'Track';
    }

    if (scope === 'album') {
        return 'Album';
    }

    if (scope === 'folder') {
        return 'Folder';
    }

    return 'File';
};

export const labelForCoverArtPriority = (source: CoverArtPrioritySource): string => {
    if (source === 'musicbrainz') {
        return 'Load cover from MusicBrainz';
    }

    if (source === 'embedded') {
        return 'Embedded track artwork';
    }

    return 'Separate image file in release folder';
};

export const resolvePrimaryTab = (tab: 'general' | 'network' | 'database' | 'playlists' | 'scrobbling' | 'audio' | 'ui' | 'actions' | 'shortcuts'): 'general' | 'network' | 'database' | 'playlists' | 'scrobbling' | 'audio' | 'ui' | 'actions' => (tab === 'shortcuts' ? 'ui' : tab);
