import { createSettingsController, type SettingsController } from './controllers/settings-controller';
import type { SettingsModalElements } from './components/overlays';
import { main as WailsModels } from '../wailsjs/go/models';
import type {
    AppLibraryFolder,
    AppSettings,
    AudioOutputDevice,
    AudioPlaybackState,
    FFmpegPathStatus,
    MusicBrainzTagWorkerProgress,
    PlayerCardLayout,
    Track,
} from './types/app-types';
import { normalizeLibraryFolders } from './utils/main-helpers';
import { normalizeAppSettings } from './utils/settings-normalization';

export interface AppSettingsControllerSetupContext {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    isWindowsRuntime: boolean;
    isMacRuntime: boolean;
    isLinuxRuntime: boolean;
    currentSettings: AppSettings;
    currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
    availableAudioOutputDevices: AudioOutputDevice[];
    currentTrackIndex: number;
    tracks: Track[];
    ffmpegConfigurationRequired: boolean;
    validateConfiguredFFmpegPath: (ffmpegPath: string) => Promise<FFmpegPathStatus>;
    missingFFmpegMessage: (status: FFmpegPathStatus) => string;
    saveSettings: (settings: AppSettings) => Promise<AppSettings>;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    getPlaybackOrderMode: () => string;
    setLissajousEnabled: (enabled: boolean) => void;
    applyUiDitheringSetting: () => void;
    handleSocialSettingsChanged: () => void;
    setPlaybackOrderMode: (mode: AppSettings['playbackOrder']) => void;
    applyCoverArtForTrack: (index: number) => Promise<void>;
    refreshPlaylistFavorites: () => void;
    resetShuffleHistory: () => void;
    hasListenBrainzScrobbling: () => boolean;
    closeListenBrainzFeedbackMenu: () => void;
    isPlaybackBackendReady: () => boolean;
    audioQueueNextTrack: (currentPath: string, nextPath: string) => Promise<unknown>;
    queueGaplessNextTrack: () => Promise<void>;
    refreshNowPlayingLabel: () => void;
    completeStartupIfReady: () => Promise<void>;
    refreshListenBrainzFeedbackForCurrentTrack: (force?: boolean) => Promise<void>;
    getLastFmRequestToken: (apiKey: string, apiSecret: string) => Promise<string>;
    browserOpenUrl: (url: string) => Promise<void>;
    openQueueConfirmModal: (title: string, message: string) => Promise<boolean>;
    getLastFmSessionKey: (apiKey: string, apiSecret: string, requestToken: string) => Promise<string>;
    refreshAvailableAudioOutputDevices: () => Promise<AudioOutputDevice[]>;
    audioReinitializeBackend: () => Promise<AudioPlaybackState>;
    setPlaybackBackendReady: (ready: boolean) => void;
    applyPlaybackState: (state: AudioPlaybackState) => void;
    updatePlayButton: () => void;
    scanConfiguredLibraryFolders: () => Promise<void>;
    openErrorModal: (title: string, message: string) => void;
    getPlayerCardLayout: () => PlayerCardLayout;
    setPlayerCardLayout: (layout: PlayerCardLayout) => void;
}

export const setupSettingsController = (context: AppSettingsControllerSetupContext): SettingsController => {
    const saveNormalizedSettings = async (values: {
        libraryFolders: AppLibraryFolder[];
        ffmpegPath: string;
        listenBrainzUserToken: string;
        lastFmApiKey: string;
        lastFmApiSecret: string;
        lastFmSessionKey: string;
        scrobbleFilterMode: AppSettings['scrobbleFilterMode'];
        scrobbleRules: AppSettings['scrobbleRules'];
        musicBrainzServerUrl: string;
        musicBrainzRequestRateMs: number;
        listenBrainzServerUrl: string;
        listenBrainzRequestRateMs: number;
        favoritePlaylists: string[];
        coverArtPriority: AppSettings['coverArtPriority'];
        audioOutputDevice: string;
        audioOutputBufferMs: number;
        gaplessPlayback: boolean;
        replayGainEnabled: boolean;
        preferMusicBrainzMetadata: boolean;
        musicBrainzTagDatabaseEnabled: boolean;
        musicBrainzTagStaleDays: number;
        musicBrainzTagRequestStaggeringEnabled: boolean;
        musicBrainzTagWorkerCores: number;
        lissajousEnabled: boolean;
        uiDitheringEnabled: boolean;
        minimizeToTrayOnClose: boolean;
        customSendToActions: AppSettings['customSendToActions'];
        keyboardShortcuts: AppSettings['keyboardShortcuts'];
    }): Promise<void> => {
        const ffmpegStatus = await context.validateConfiguredFFmpegPath(values.ffmpegPath);
        if (!ffmpegStatus.available) {
            throw new Error(context.missingFFmpegMessage(ffmpegStatus));
        }

        const normalizedLibraryFolders = normalizeLibraryFolders(values.libraryFolders);
        const primaryLibraryFolder = normalizedLibraryFolders[0];
        const savedSettings = await context.saveSettings(WailsModels.AppSettings.createFrom({
            libraryFolders: normalizedLibraryFolders,
            libraryPath: primaryLibraryFolder?.path || '',
            ffmpegPath: values.ffmpegPath,
            listenBrainzUserToken: values.listenBrainzUserToken,
            lastFmApiKey: values.lastFmApiKey,
            lastFmApiSecret: values.lastFmApiSecret,
            lastFmSessionKey: values.lastFmSessionKey,
            scrobbleFilterMode: values.scrobbleFilterMode,
            scrobbleRules: values.scrobbleRules,
            musicBrainzServerUrl: values.musicBrainzServerUrl,
            musicBrainzRequestRateMs: values.musicBrainzRequestRateMs,
            listenBrainzServerUrl: values.listenBrainzServerUrl,
            listenBrainzRequestRateMs: values.listenBrainzRequestRateMs,
            playbackOrder: context.getPlaybackOrderMode(),
            releaseDepth: primaryLibraryFolder?.releaseDepth || 0,
            favoritePlaylists: values.favoritePlaylists,
            coverArtPriority: values.coverArtPriority,
            audio: {
                outputDevice: values.audioOutputDevice,
                outputBufferMs: values.audioOutputBufferMs,
                gaplessPlayback: values.gaplessPlayback,
                replayGainEnabled: values.replayGainEnabled,
            },
            preferMusicBrainzMetadata: values.preferMusicBrainzMetadata,
            musicBrainzTagDatabaseEnabled: values.musicBrainzTagDatabaseEnabled,
            musicBrainzTagStaleDays: values.musicBrainzTagStaleDays,
            musicBrainzTagRequestStaggeringEnabled: values.musicBrainzTagRequestStaggeringEnabled,
            musicBrainzTagWorkerCores: values.musicBrainzTagWorkerCores,
            lissajousEnabled: values.lissajousEnabled,
            uiDitheringEnabled: values.uiDitheringEnabled,
            minimizeToTrayOnClose: values.minimizeToTrayOnClose,
            customSendToActions: values.customSendToActions,
            keyboardShortcuts: values.keyboardShortcuts,
        }) as AppSettings);

        context.currentSettings = normalizeAppSettings(savedSettings);
        context.setLissajousEnabled(context.currentSettings.lissajousEnabled);
        context.applyUiDitheringSetting();
        context.handleSocialSettingsChanged();
        context.setPlaybackOrderMode(context.currentSettings.playbackOrder);
        if (context.currentTrackIndex >= 0 && context.currentTrackIndex < context.tracks.length) {
            void context.applyCoverArtForTrack(context.currentTrackIndex);
        }

        context.refreshPlaylistFavorites();
        context.resetShuffleHistory();

        if (!context.hasListenBrainzScrobbling()) {
            context.closeListenBrainzFeedbackMenu();
        }

        context.refreshNowPlayingLabel();
        if (!context.currentSettings.audio.gaplessPlayback) {
            if (context.isPlaybackBackendReady()) {
                void context.audioQueueNextTrack('', '').catch((error: unknown) => {
                    console.debug(error);
                });
            }
        } else {
            void context.queueGaplessNextTrack();
        }

        await context.completeStartupIfReady();
        void context.refreshListenBrainzFeedbackForCurrentTrack(true);
    };

    return createSettingsController({
        trigger: context.trigger,
        elements: context.elements,
        isWindows: context.isWindowsRuntime,
        isMac: context.isMacRuntime,
        isLinux: context.isLinuxRuntime,
        getValues: () => ({
            libraryFolders: context.currentSettings.libraryFolders,
            ffmpegPath: context.currentSettings.ffmpegPath,
            listenBrainzUserToken: context.currentSettings.listenBrainzUserToken,
            lastFmApiKey: context.currentSettings.lastFmApiKey,
            lastFmApiSecret: context.currentSettings.lastFmApiSecret,
            lastFmSessionKey: context.currentSettings.lastFmSessionKey,
            scrobbleFilterMode: context.currentSettings.scrobbleFilterMode,
            scrobbleRules: context.currentSettings.scrobbleRules,
            musicBrainzServerUrl: context.currentSettings.musicBrainzServerUrl,
            musicBrainzRequestRateMs: context.currentSettings.musicBrainzRequestRateMs,
            listenBrainzServerUrl: context.currentSettings.listenBrainzServerUrl,
            listenBrainzRequestRateMs: context.currentSettings.listenBrainzRequestRateMs,
            favoritePlaylists: context.currentSettings.favoritePlaylists,
            coverArtPriority: context.currentSettings.coverArtPriority,
            audioOutputDevice: context.currentSettings.audio.outputDevice,
            audioOutputBufferMs: context.currentSettings.audio.outputBufferMs,
            gaplessPlayback: context.currentSettings.audio.gaplessPlayback,
            replayGainEnabled: context.currentSettings.audio.replayGainEnabled,
            audioOutputDevices: context.availableAudioOutputDevices,
            preferMusicBrainzMetadata: context.currentSettings.preferMusicBrainzMetadata,
            musicBrainzTagDatabaseEnabled: context.currentSettings.musicBrainzTagDatabaseEnabled,
            musicBrainzTagStaleDays: context.currentSettings.musicBrainzTagStaleDays,
            musicBrainzTagRequestStaggeringEnabled: context.currentSettings.musicBrainzTagRequestStaggeringEnabled,
            musicBrainzTagWorkerCores: context.currentSettings.musicBrainzTagWorkerCores,
            lissajousEnabled: context.currentSettings.lissajousEnabled,
            uiDitheringEnabled: context.currentSettings.uiDitheringEnabled,
            minimizeToTrayOnClose: context.currentSettings.minimizeToTrayOnClose,
            customSendToActions: context.currentSettings.customSendToActions,
            musicBrainzTagWorkerProgress: context.currentMusicBrainzTagWorkerProgress,
            keyboardShortcuts: context.currentSettings.keyboardShortcuts,
        }),
        selectLibraryFolder: context.selectLibraryFolder,
        selectPlaylistFile: context.selectPlaylistFile,
        save: saveNormalizedSettings,
        fetchLastFmSessionKey: async (apiKey: string, apiSecret: string): Promise<string> => {
            const normalizedApiKey = apiKey.trim();
            const normalizedApiSecret = apiSecret.trim();
            if (normalizedApiKey === '' || normalizedApiSecret === '') {
                throw new Error('Last.fm API key and shared secret are required.');
            }

            const requestToken = await context.getLastFmRequestToken(normalizedApiKey, normalizedApiSecret);
            const authorizeUrl = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(normalizedApiKey)}&token=${encodeURIComponent(requestToken)}`;
            await context.browserOpenUrl(authorizeUrl);

            const confirmed = await context.openQueueConfirmModal(
                'Authorize Last.fm',
                'Allow access in your browser, then click Proceed to finish fetching the session key.',
            );
            if (!confirmed) {
                throw new Error('Last.fm authorization was cancelled.');
            }

            return await context.getLastFmSessionKey(normalizedApiKey, normalizedApiSecret, requestToken);
        },
        applyAudioNow: async (values): Promise<AudioOutputDevice[]> => {
            await saveNormalizedSettings(values);
            const outputDevices = await context.refreshAvailableAudioOutputDevices();

            const nextState = await context.audioReinitializeBackend();
            context.setPlaybackBackendReady(true);
            context.applyPlaybackState(nextState);
            context.updatePlayButton();
            context.refreshNowPlayingLabel();

            if (!context.currentSettings.audio.gaplessPlayback && context.isPlaybackBackendReady()) {
                void context.audioQueueNextTrack('', '').catch((error: unknown) => {
                    console.debug(error);
                });
            }

            void context.refreshListenBrainzFeedbackForCurrentTrack(true);
            return outputDevices;
        },
        forceReload: async (): Promise<void> => {
            await context.scanConfiguredLibraryFolders();
        },
        beforeClose: async (): Promise<string | null> => {
            if (!context.ffmpegConfigurationRequired) {
                return null;
            }

            const ffmpegStatus = await context.validateConfiguredFFmpegPath(context.currentSettings.ffmpegPath);
            if (ffmpegStatus.available) {
                context.ffmpegConfigurationRequired = false;
                return null;
            }

            return context.missingFFmpegMessage(ffmpegStatus);
        },
        onCloseBlocked: (message: string): void => {
            context.openErrorModal('FFmpeg Required', message);
        },
        getPlayerCardLayout: context.getPlayerCardLayout,
        setPlayerCardLayout: context.setPlayerCardLayout,
    });
};