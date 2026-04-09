import { LoadPlaylistFile, SaveSettings } from '../wailsjs/go/main/App';
import type { LoadedPlaylistData } from './controllers/playlist-controller';
import { mergePlaylistFilesIntoTracks } from './services/library-data-service';
import { normalizeAppSettings } from './utils/settings-normalization';
import type { AppSettings, PlaybackOrderMode, PlaylistLoadResult, Track } from './types/app-types';

type PlaybackOrderPlaylistRuntimeContext = {
    currentSettings: AppSettings;
    tracks?: Track[];
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
                ffmpegPath: context.currentSettings.ffmpegPath,
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
        const loaded = await LoadPlaylistFile(playlistPath) as PlaylistLoadResult;
        const mergeResult = await mergePlaylistFilesIntoTracks(context.tracks || [], loaded.trackFiles || []);
        context.tracks = mergeResult.tracks;
        context.rebuildTrackPathIndex?.();

        return {
            name: loaded.name || '',
            trackIndexes: mergeResult.trackIndexes,
        };
    };

    return {
        loadPlaylistData,
        savePlaybackOrderSetting,
        setPlaybackOrderMode,
    };
};
