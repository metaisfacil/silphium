import type {
    AppSettings,
    CoverArtPrioritySource,
    CustomSendToAction,
    CustomSendToActionScope,
    MusicBrainzTagWorkerProgress,
    PlayerEqualizerPosition,
    PlayerVisualizerMode,
} from '../types/app-types';
import {
    asPlaybackOrderMode,
    asScrobbleFilterMode,
    normalizeLibraryFolders,
    normalizeScrobbleRules,
} from './main-helpers';
import { defaultFocusedKeyboardShortcuts, normalizeFocusedKeyboardShortcuts } from './shortcut-bindings';

export const defaultMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress = {
    enabled: false,
    active: false,
    progress: 0,
    pendingTrackScans: 0,
    totalTrackScans: 0,
    completedTrackScans: 0,
    pendingEntityLookups: 0,
    totalEntityLookups: 0,
    completedEntityLookups: 0,
};

export const defaultMusicBrainzTagStaleDays = 30;
export const maxMusicBrainzTagStaleDays = 36500;
export const defaultLissajousScale = 0.25;
export const minLissajousScale = 0.05;
export const maxLissajousScale = 1;

export const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];
export const defaultCustomSendToActions: CustomSendToAction[] = [];

export const defaultAppSettings: AppSettings = {
    libraryFolders: [],
    libraryPath: '',
    localLibraryFilesDatabaseEnabled: true,
    localLibraryFilesDatabaseLoadOnStartup: true,
    localLibraryFilesDatabaseListenHistoryEnabled: false,
    localLibraryFilesDatabaseListenHistoryLimit: 0,
    ffmpegPath: '',
    listenBrainzUserToken: '',
    lastFmApiKey: '',
    lastFmApiSecret: '',
    lastFmSessionKey: '',
    scrobbleFilterMode: 'blacklist',
    scrobbleRules: [],
    musicBrainzServerUrl: '',
    musicBrainzRequestRateMs: 1000,
    listenBrainzServerUrl: '',
    listenBrainzRequestRateMs: 1000,
    playbackOrder: 'ordered-library',
    releaseDepth: 0,
    favoritePlaylists: [],
    coverArtPriority: ['file', 'embedded'],
    audio: {
        outputDevice: 'default',
        outputBufferMs: 0,
        gaplessPlayback: false,
        replayGainEnabled: false,
    },
    preferMusicBrainzMetadata: false,
    musicBrainzTagDatabaseEnabled: false,
    highlightMusicBrainzTaggedAlbumFolders: false,
    musicBrainzTagStaleDays: defaultMusicBrainzTagStaleDays,
    musicBrainzTagRequestStaggeringEnabled: false,
    musicBrainzTagWorkerCores: 1,
    lissajousEnabled: true,
    lissajousScale: defaultLissajousScale,
    visualizerMode: 'lissajous',
    equalizerPosition: 'bottom',
    uiDitheringEnabled: true,
    minimizeToTrayOnClose: false,
    customSendToActions: [],
    keyboardShortcuts: { ...defaultFocusedKeyboardShortcuts },
};

export const asPlayerVisualizerMode = (value: string): PlayerVisualizerMode => (
    value === 'equalizer' ? 'equalizer' : 'lissajous'
);

export const asPlayerEqualizerPosition = (value: string): PlayerEqualizerPosition => (
    value === 'top' ? 'top' : 'bottom'
);

export const normalizeLissajousScale = (value: unknown): number => {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseFloat(value)
            : Number.NaN;
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return defaultLissajousScale;
    }

    return Math.max(minLissajousScale, Math.min(maxLissajousScale, numeric));
};

export const normalizeMusicBrainzTagWorkerProgress = (value?: Partial<MusicBrainzTagWorkerProgress> | null): MusicBrainzTagWorkerProgress => {
    const source = value || {};
    const progress = Number.isFinite(source.progress) ? Number(source.progress) : 0;
    const normalizeCount = (count: unknown): number => {
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
        pendingTrackScans: normalizeCount(source.pendingTrackScans),
        totalTrackScans: normalizeCount(source.totalTrackScans),
        completedTrackScans: normalizeCount(source.completedTrackScans),
        pendingEntityLookups: normalizeCount(source.pendingEntityLookups),
        totalEntityLookups: normalizeCount(source.totalEntityLookups),
        completedEntityLookups: normalizeCount(source.completedEntityLookups),
    };
};

export const normalizeCoverArtPriority = (sources: CoverArtPrioritySource[] | string[] | undefined): CoverArtPrioritySource[] => {
    if (sources === undefined) {
        return [...defaultCoverArtPriority];
    }

    const ordered: CoverArtPrioritySource[] = [];
    const seen = new Set<CoverArtPrioritySource>();

    /* v8 ignore next -- valid callers provide an array when sources is defined */
    for (const rawSource of sources || []) {
        const source = rawSource === 'embedded'
            ? 'embedded'
            : rawSource === 'file'
                ? 'file'
                : rawSource === 'musicbrainz'
                    ? 'musicbrainz'
                    : undefined;
        if (!source || seen.has(source)) {
            continue;
        }

        seen.add(source);
        ordered.push(source);
    }

    if (ordered.length === 0 && sources.length > 0) {
        return [...defaultCoverArtPriority];
    }

    return ordered;
};

export const asCustomSendToActionScope = (value: string): CustomSendToActionScope | null => {
    if (value === 'track' || value === 'album' || value === 'file' || value === 'folder') {
        return value;
    }

    return null;
};

export const normalizeCustomSendToActions = (actions: CustomSendToAction[] | Array<{
    title?: string;
    scope?: string;
    commandTemplate?: string;
}> | undefined): CustomSendToAction[] => {
    if (!Array.isArray(actions)) {
        return [...defaultCustomSendToActions];
    }

    const deduped = new Set<string>();
    const normalized: CustomSendToAction[] = [];
    for (const candidate of actions) {
        const title = (candidate.title || '').trim();
        const scope = asCustomSendToActionScope(candidate.scope || '');
        const commandTemplate = (candidate.commandTemplate || '').trim();
        if (title === '' || scope === null || commandTemplate === '') {
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

export const normalizeAppSettings = (settings: Partial<AppSettings>): AppSettings => {
    const libraryFolders = normalizeLibraryFolders(settings.libraryFolders, settings.libraryPath, settings.releaseDepth);
    const legacyScrobbleFolders = Array.isArray((settings as { scrobbleFolders?: string[] }).scrobbleFolders)
        ? (settings as { scrobbleFolders?: string[] }).scrobbleFolders
        : undefined;
    const rawAudio = settings.audio || { outputDevice: 'default', outputBufferMs: 0, gaplessPlayback: false, replayGainEnabled: false };
    const normalizedAudioBufferMs = Number.isFinite(rawAudio.outputBufferMs)
        ? Math.max(0, Math.min(1000, Math.round(rawAudio.outputBufferMs)))
        : 0;
    const normalizedMusicBrainzTagStaleDays = typeof settings.musicBrainzTagStaleDays === 'number' && Number.isFinite(settings.musicBrainzTagStaleDays) && settings.musicBrainzTagStaleDays >= 0
        ? Math.min(maxMusicBrainzTagStaleDays, Math.floor(settings.musicBrainzTagStaleDays as number))
        : defaultMusicBrainzTagStaleDays;
    return {
        libraryFolders,
        libraryPath: libraryFolders[0]?.path || '',
        localLibraryFilesDatabaseEnabled: settings.localLibraryFilesDatabaseEnabled !== false,
        localLibraryFilesDatabaseLoadOnStartup: settings.localLibraryFilesDatabaseLoadOnStartup !== false,
        localLibraryFilesDatabaseListenHistoryEnabled: settings.localLibraryFilesDatabaseListenHistoryEnabled === true,
        localLibraryFilesDatabaseListenHistoryLimit: typeof settings.localLibraryFilesDatabaseListenHistoryLimit === 'number'
            && Number.isFinite(settings.localLibraryFilesDatabaseListenHistoryLimit)
            && settings.localLibraryFilesDatabaseListenHistoryLimit > 0
            ? Math.floor(settings.localLibraryFilesDatabaseListenHistoryLimit)
            : 0,
        ffmpegPath: (settings.ffmpegPath || '').trim(),
        listenBrainzUserToken: settings.listenBrainzUserToken || '',
        lastFmApiKey: (settings.lastFmApiKey || '').trim(),
        lastFmApiSecret: (settings.lastFmApiSecret || '').trim(),
        lastFmSessionKey: (settings.lastFmSessionKey || '').trim(),
        scrobbleFilterMode: asScrobbleFilterMode(settings.scrobbleFilterMode || ''),
        scrobbleRules: normalizeScrobbleRules(settings.scrobbleRules, legacyScrobbleFolders),
        musicBrainzServerUrl: (settings.musicBrainzServerUrl || '').trim(),
        musicBrainzRequestRateMs: Number.isFinite(settings.musicBrainzRequestRateMs) && (settings.musicBrainzRequestRateMs || 0) >= 0
            ? Math.floor(settings.musicBrainzRequestRateMs || 0)
            : 0,
        listenBrainzServerUrl: (settings.listenBrainzServerUrl || '').trim(),
        listenBrainzRequestRateMs: Number.isFinite(settings.listenBrainzRequestRateMs) && (settings.listenBrainzRequestRateMs || 0) >= 0
            ? Math.floor(settings.listenBrainzRequestRateMs || 0)
            : 0,
        playbackOrder: asPlaybackOrderMode(settings.playbackOrder || ''),
        releaseDepth: libraryFolders[0]?.releaseDepth || 0,
        favoritePlaylists: Array.isArray(settings.favoritePlaylists) ? settings.favoritePlaylists : [],
        coverArtPriority: normalizeCoverArtPriority(settings.coverArtPriority),
        audio: {
            outputDevice: (rawAudio.outputDevice || 'default').trim() || 'default',
            outputBufferMs: normalizedAudioBufferMs,
            gaplessPlayback: !!rawAudio.gaplessPlayback,
            replayGainEnabled: !!rawAudio.replayGainEnabled,
        },
        preferMusicBrainzMetadata: !!settings.preferMusicBrainzMetadata,
        musicBrainzTagDatabaseEnabled: !!settings.musicBrainzTagDatabaseEnabled,
        highlightMusicBrainzTaggedAlbumFolders: !!settings.highlightMusicBrainzTaggedAlbumFolders,
        musicBrainzTagStaleDays: normalizedMusicBrainzTagStaleDays,
        musicBrainzTagRequestStaggeringEnabled: !!settings.musicBrainzTagRequestStaggeringEnabled,
        musicBrainzTagWorkerCores: Number.isFinite(settings.musicBrainzTagWorkerCores)
            ? Math.max(1, Math.min(128, Math.floor(settings.musicBrainzTagWorkerCores || 1)))
            : 1,
        lissajousEnabled: settings.lissajousEnabled !== false,
        lissajousScale: normalizeLissajousScale(settings.lissajousScale),
        visualizerMode: asPlayerVisualizerMode(settings.visualizerMode || ''),
        equalizerPosition: asPlayerEqualizerPosition(settings.equalizerPosition || ''),
        uiDitheringEnabled: settings.uiDitheringEnabled !== false,
        minimizeToTrayOnClose: !!settings.minimizeToTrayOnClose,
        customSendToActions: normalizeCustomSendToActions(settings.customSendToActions),
        keyboardShortcuts: normalizeFocusedKeyboardShortcuts(settings.keyboardShortcuts),
    };
};
