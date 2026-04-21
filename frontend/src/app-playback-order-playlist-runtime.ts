import {
    AppendTracksToPlaylistFile,
    LoadListenHistoryPlaylist,
    LoadPlaylistFile,
    SavePlaylistFile,
    SavePlaylistTrackMetadataCache,
    SaveSettings,
} from '../wailsjs/go/main/App';
import type { LoadedPlaylistData, PlaylistTrackMetadataCacheEntry } from './controllers/playlist-controller';
import { mergePlaylistFilesIntoTracks } from './services/library-data-service';
import { normalizeAppSettings } from './utils/settings-normalization';
import type { AppSettings, PlaybackOrderMode, PlaylistLoadResult, Track } from './types/app-types';

const mapLoadedPlaylistCachedItems = (loaded: PlaylistLoadResult): NonNullable<LoadedPlaylistData['cachedItems']> => (
    (loaded.trackFiles || []).map((file) => ({
        cachedTrackTitle: file.cachedTrackTitle,
        cachedArtistName: file.cachedArtistName,
    }))
);

const normalizePlaylistCacheKey = (playlistPath: string): string => playlistPath.trim().toLowerCase();

type PlaybackOrderPlaylistRuntimeContext = {
    currentSettings: AppSettings;
    tracks?: Track[];
    trackIndexByPath?: Map<string, number>;
    playlistController: {
        clearEditableQueue: () => void;
    };
    playbackSequencingService: {
        setPlaybackOrderMode: (mode: PlaybackOrderMode) => boolean;
        getPlaybackOrderMode: () => PlaybackOrderMode;
    };
    updatePlayOrderMenuState: () => void;
    visualizerController?: {
        setEnabled: (enabled: boolean) => void;
        setLissajousScale?: (scale: AppSettings['lissajousScale']) => void;
        setMode?: (mode: AppSettings['visualizerMode']) => void;
        setEqualizerPosition?: (position: AppSettings['equalizerPosition']) => void;
    };
    applyUiDitheringSetting?: () => void;
    rebuildTrackPathIndex?: () => void;
};

export const createPlaybackOrderPlaylistRuntime = (context: PlaybackOrderPlaylistRuntimeContext) => {
    const playlistLoadCache = new Map<string, PlaylistLoadResult>();

    const invalidatePlaylistLoadCache = (playlistPath: string): void => {
        const cacheKey = normalizePlaylistCacheKey(playlistPath);
        if (cacheKey === '') {
            return;
        }

        playlistLoadCache.delete(cacheKey);
    };

    const loadPlaylistResult = async (playlistPath: string): Promise<PlaylistLoadResult> => {
        const cacheKey = normalizePlaylistCacheKey(playlistPath);
        if (cacheKey !== '') {
            const cached = playlistLoadCache.get(cacheKey);
            if (cached) {
                return cached;
            }
        }

        const loaded = await LoadPlaylistFile(playlistPath) as PlaylistLoadResult;
        if (cacheKey !== '') {
            playlistLoadCache.set(cacheKey, loaded);
        }

        return loaded;
    };

    const setPlaybackOrderMode = (nextMode: PlaybackOrderMode): void => {
        const changed = context.playbackSequencingService.setPlaybackOrderMode(nextMode);
        if (!changed) {
            return;
        }

        context.currentSettings.playbackOrder = nextMode;
        context.playlistController.clearEditableQueue();
        context.updatePlayOrderMenuState();
    };

    const savePlaybackOrderSetting = async (): Promise<void> => {
        try {
            const primaryLibraryFolder = context.currentSettings.libraryFolders[0];
            const savedSettings = await SaveSettings({
                libraryFolders: context.currentSettings.libraryFolders,
                libraryPath: context.currentSettings.libraryPath,
                localLibraryFilesDatabaseEnabled: context.currentSettings.localLibraryFilesDatabaseEnabled,
                localLibraryFilesDatabaseLoadOnStartup: context.currentSettings.localLibraryFilesDatabaseLoadOnStartup,
                localLibraryFilesDatabaseListenHistoryEnabled: context.currentSettings.localLibraryFilesDatabaseListenHistoryEnabled,
                localLibraryFilesDatabaseListenHistoryLimit: context.currentSettings.localLibraryFilesDatabaseListenHistoryLimit,
                localLibraryFilesDatabaseListenHistoryThresholdSeconds: context.currentSettings.localLibraryFilesDatabaseListenHistoryThresholdSeconds,
                ffmpegPath: context.currentSettings.ffmpegPath,
                openSubsonicEnabled: !!context.currentSettings.openSubsonicEnabled,
                openSubsonicPort: context.currentSettings.openSubsonicPort,
                openSubsonicApiKey: context.currentSettings.openSubsonicApiKey,
                openSubsonicApiKeyHash: context.currentSettings.openSubsonicApiKeyHash,
                librarySharingEnabled: !!context.currentSettings.librarySharingEnabled,
                librarySharingPort: context.currentSettings.librarySharingPort,
                listenBrainzUserToken: context.currentSettings.listenBrainzUserToken,
                lastFmApiKey: context.currentSettings.lastFmApiKey,
                lastFmApiSecret: context.currentSettings.lastFmApiSecret,
                lastFmSessionKey: context.currentSettings.lastFmSessionKey,
                musicBrainzServerUrl: context.currentSettings.musicBrainzServerUrl,
                musicBrainzRequestRateMs: context.currentSettings.musicBrainzRequestRateMs,
                listenBrainzServerUrl: context.currentSettings.listenBrainzServerUrl,
                listenBrainzRequestRateMs: context.currentSettings.listenBrainzRequestRateMs,
                playbackOrder: context.playbackSequencingService.getPlaybackOrderMode(),
                releaseDepth: primaryLibraryFolder?.releaseDepth || 0,
                favoritePlaylists: context.currentSettings.favoritePlaylists,
                coverArtPriority: context.currentSettings.coverArtPriority,
                audio: context.currentSettings.audio,
                preferMusicBrainzMetadata: context.currentSettings.preferMusicBrainzMetadata,
                musicBrainzTagDatabaseEnabled: context.currentSettings.musicBrainzTagDatabaseEnabled,
                highlightMusicBrainzTaggedAlbumFolders: context.currentSettings.highlightMusicBrainzTaggedAlbumFolders,
                musicBrainzTagStaleDays: context.currentSettings.musicBrainzTagStaleDays,
                musicBrainzTagRequestStaggeringEnabled: context.currentSettings.musicBrainzTagRequestStaggeringEnabled,
                musicBrainzTagWorkerCores: context.currentSettings.musicBrainzTagWorkerCores,
                lissajousEnabled: context.currentSettings.lissajousEnabled,
                lissajousScale: context.currentSettings.lissajousScale,
                visualizerMode: context.currentSettings.visualizerMode,
                equalizerPosition: context.currentSettings.equalizerPosition,
                uiDitheringEnabled: context.currentSettings.uiDitheringEnabled,
                minimizeToTrayOnClose: context.currentSettings.minimizeToTrayOnClose,
                customSendToActions: context.currentSettings.customSendToActions,
                keyboardShortcuts: context.currentSettings.keyboardShortcuts,
            } as unknown as Parameters<typeof SaveSettings>[0]) as unknown as Partial<AppSettings>;

            context.currentSettings = normalizeAppSettings(savedSettings);
            context.visualizerController?.setMode?.(context.currentSettings.visualizerMode);
            context.visualizerController?.setEqualizerPosition?.(context.currentSettings.equalizerPosition);
            context.visualizerController?.setLissajousScale?.(context.currentSettings.lissajousScale);
            context.visualizerController?.setEnabled(context.currentSettings.lissajousEnabled);
            context.applyUiDitheringSetting?.();
            setPlaybackOrderMode(context.currentSettings.playbackOrder);
        } catch (error) {
            console.error(error);
        }
    };

    const loadPlaylistData = async (playlistPath: string): Promise<LoadedPlaylistData | null> => {
        const loaded = await loadPlaylistResult(playlistPath);
        const mergeResult = await mergePlaylistFilesIntoTracks(context.tracks || [], loaded.trackFiles || [], context.trackIndexByPath);
        context.tracks = mergeResult.tracks;
        if (!context.trackIndexByPath) {
            context.rebuildTrackPathIndex?.();
        }

        return {
            name: loaded.name || '',
            cachedItems: mapLoadedPlaylistCachedItems(loaded),
            trackIndexes: mergeResult.trackIndexes,
        };
    };

    const loadListenHistoryData = async (): Promise<LoadedPlaylistData | null> => {
        const loaded = await LoadListenHistoryPlaylist() as PlaylistLoadResult;
        const mergeResult = await mergePlaylistFilesIntoTracks(context.tracks || [], loaded.trackFiles || [], context.trackIndexByPath);
        context.tracks = mergeResult.tracks;
        if (!context.trackIndexByPath) {
            context.rebuildTrackPathIndex?.();
        }

        return {
            cachedItems: mapLoadedPlaylistCachedItems(loaded),
            name: loaded.name || 'Listen History',
            historyItems: (loaded.trackFiles || []).map((file) => ({
                listenedAt: Number.isFinite(file.listenedAt || 0) ? Math.floor(file.listenedAt || 0) : 0,
                playedPercent: Number.isFinite(file.playedPercent || 0)
                    ? Math.max(0, Math.min(100, Math.round(file.playedPercent || 0)))
                    : 0,
            })),
            trackIndexes: mergeResult.trackIndexes,
        };
    };

    const savePlaylistTrackMetadataCache = async (entries: PlaylistTrackMetadataCacheEntry[]): Promise<boolean> => {
        return await SavePlaylistTrackMetadataCache(entries);
    };

    const savePlaylistData = async (playlistPath: string, trackPaths: string[]): Promise<boolean> => {
        const saved = await SavePlaylistFile(playlistPath, trackPaths);
        if (saved) {
            invalidatePlaylistLoadCache(playlistPath);
        }

        return saved;
    };

    const appendTracksToPlaylistData = async (playlistPath: string, trackPaths: string[]): Promise<boolean> => {
        const appended = await AppendTracksToPlaylistFile(playlistPath, trackPaths);
        if (appended) {
            invalidatePlaylistLoadCache(playlistPath);
        }

        return appended;
    };

    return {
        appendTracksToPlaylistData,
        loadListenHistoryData,
        loadPlaylistData,
        savePlaylistData,
        savePlaylistTrackMetadataCache,
        savePlaybackOrderSetting,
        setPlaybackOrderMode,
    };
};
