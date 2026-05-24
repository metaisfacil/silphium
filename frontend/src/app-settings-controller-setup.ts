import { createSettingsController, type SettingsController } from './controllers/settings-controller';
import type { SettingsModalElements } from './components/overlays';
import type {
    AppLibraryFolder,
    AppSettings,
    AudioOutputDevice,
    AudioPlaybackState,
    FFmpegPathStatus,
    MusicBrainzTagWorkerProgress,
    Track,
} from './types/app-types';
import type { SettingsControllerState } from './controllers/settings-controller-types';
import type { RoonAccentSettings } from './utils/roon-accent-theme';
import { libraryFolderMusicBrainzTagWorkerScansEnabled, normalizeLibraryFolderKind, normalizeLibraryFolders } from './utils/main-helpers';
import { normalizeAppSettings } from './utils/settings-normalization';

const defaultOpenSubsonicPort = 4040;

const sameLibraryFolder = (left: AppLibraryFolder, right: AppLibraryFolder): boolean => (
    (left.path || '') === (right.path || '')
    && (left.label || '') === (right.label || '')
    && (left.releaseDepth || 0) === (right.releaseDepth || 0)
    && libraryFolderMusicBrainzTagWorkerScansEnabled(left) === libraryFolderMusicBrainzTagWorkerScansEnabled(right)
    && (left.kind || 'local') === (right.kind || 'local')
    && (left.host || '') === (right.host || '')
    && (left.port || 0) === (right.port || 0)
    && (left.password || '') === (right.password || '')
    && (left.passwordHash || '') === (right.passwordHash || '')
);

const filterLocalLibraryFolders = (folders: AppLibraryFolder[]): AppLibraryFolder[] => (
    folders.filter((folder) => normalizeLibraryFolderKind(folder.kind) !== 'remote')
);

const libraryFoldersChanged = (left: AppLibraryFolder[], right: AppLibraryFolder[]): boolean => {
    const normalizedLeft = normalizeLibraryFolders(filterLocalLibraryFolders(left));
    const normalizedRight = normalizeLibraryFolders(filterLocalLibraryFolders(right));
    if (normalizedLeft.length !== normalizedRight.length) {
        return true;
    }

    return normalizedLeft.some((folder, index) => !sameLibraryFolder(folder, normalizedRight[index]));
};

const defaultAudioOutputDeviceId = 'default';

const resolveAvailableAudioOutputDevice = (
    requestedDevice: string,
    outputDevices: AudioOutputDevice[],
): { selectedDevice: string; fellBackToDefault: boolean } => {
    const normalizedRequestedDevice = requestedDevice.trim() || defaultAudioOutputDeviceId;
    if (normalizedRequestedDevice === defaultAudioOutputDeviceId) {
        return { selectedDevice: defaultAudioOutputDeviceId, fellBackToDefault: false };
    }

    const deviceExists = outputDevices.some((device) => {
        const normalizedDeviceID = (device.id || defaultAudioOutputDeviceId).trim() || defaultAudioOutputDeviceId;
        return normalizedDeviceID === normalizedRequestedDevice;
    });
    if (deviceExists) {
        return { selectedDevice: normalizedRequestedDevice, fellBackToDefault: false };
    }

    return { selectedDevice: defaultAudioOutputDeviceId, fellBackToDefault: true };
};

export interface AppSettingsControllerSetupContext {
    trigger: HTMLButtonElement;
    elements: SettingsModalElements;
    settingsControllerState: SettingsControllerState;
    isWindowsRuntime: boolean;
    isMacRuntime: boolean;
    isLinuxRuntime: boolean;
    currentSettings: AppSettings;
    currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
    availableAudioOutputDevices: AudioOutputDevice[];
    getMusicBrainzTagWorkerProgress: () => Promise<MusicBrainzTagWorkerProgress>;
    currentTrackIndex: number;
    tracks: Track[];
    ffmpegConfigurationRequired: boolean;
    validateConfiguredFFmpegPath: (ffmpegPath: string) => Promise<FFmpegPathStatus>;
    missingFFmpegMessage: (status: FFmpegPathStatus) => string;
    saveSettings: (settings: AppSettings) => Promise<AppSettings>;
    selectLibraryFolder: () => Promise<string>;
    selectPlaylistFile: () => Promise<string>;
    getPlaybackOrderMode: () => AppSettings['playbackOrder'];
    setLissajousEnabled: (enabled: boolean) => void;
    setLissajousScale: (scale: AppSettings['lissajousScale']) => void;
    setVisualizerMode: (mode: AppSettings['visualizerMode']) => void;
    setEqualizerPosition: (position: AppSettings['equalizerPosition']) => void;
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
    getRoonAccentTheme: () => RoonAccentSettings;
    setRoonAccentTheme: (theme: RoonAccentSettings) => void;
}

export const setupSettingsController = (context: AppSettingsControllerSetupContext): SettingsController => {
    const applyLiveVisualizerSettings = (settings: AppSettings): void => {
        context.setVisualizerMode(settings.visualizerMode);
        context.setEqualizerPosition(settings.equalizerPosition);
        context.setLissajousScale(settings.lissajousScale);
        context.setLissajousEnabled(settings.lissajousEnabled);
        context.applyUiDitheringSetting();
    };

    const saveNormalizedSettings = async (values: {
        libraryFolders: AppLibraryFolder[];
        localLibraryFilesDatabaseEnabled: boolean;
        localLibraryFilesDatabaseLoadOnStartup: boolean;
        localLibraryFilesDatabaseListenHistoryEnabled: boolean;
        localLibraryFilesDatabaseListenHistoryLimit: number;
        localLibraryFilesDatabaseListenHistoryThresholdSeconds: number;
        ffmpegPath: string;
        remoteLibraryTranscodingEnabled: boolean;
        remoteLibraryTranscodingBitrateKbps: number;
        librarySharingEnabled: boolean;
        librarySharingPort: number;
        librarySharingPassword?: string;
        librarySharingPasswordHash?: string;
        listenBrainzUserToken: string;
        lastFmApiKey: string;
        lastFmApiSecret: string;
        lastFmSessionKey: string;
        scrobblingEnabled: boolean;
        scrobbleFilterMode: AppSettings['scrobbleFilterMode'];
        scrobbleRules: AppSettings['scrobbleRules'];
        musicBrainzServerUrl: string;
        musicBrainzRequestRateMs: number;
        listenBrainzServerUrl: string;
        listenBrainzRequestRateMs: number;
        favoritePlaylists: string[];
        savePlaylistsOnAddRemove: boolean;
        coverArtPriority: AppSettings['coverArtPriority'];
        audioOutputDevice: string;
        audioOutputBufferMs: number;
        gaplessPlayback: boolean;
        replayGainEnabled: boolean;
        preferMusicBrainzMetadata: boolean;
        musicBrainzTagDatabaseEnabled: boolean;
        highlightMusicBrainzTaggedAlbumFolders: boolean;
        musicBrainzTagStaleDays: number;
        musicBrainzTagRequestStaggeringEnabled: boolean;
        musicBrainzTagWorkerCores: number;
        lissajousEnabled: boolean;
        lissajousScale: AppSettings['lissajousScale'];
        visualizerMode: AppSettings['visualizerMode'];
        equalizerPosition: AppSettings['equalizerPosition'];
        uiDitheringEnabled: boolean;
        minimizeToTrayOnClose: boolean;
        customSendToActions: AppSettings['customSendToActions'];
        keyboardShortcuts: AppSettings['keyboardShortcuts'];
    }): Promise<void> => {
        const previousSettings = context.currentSettings;
        const normalizedLibraryFolders = normalizeLibraryFolders(values.libraryFolders);
        const primaryLibraryFolder = normalizedLibraryFolders[0];
        const pendingSettings = normalizeAppSettings({
            libraryFolders: normalizedLibraryFolders,
            libraryPath: primaryLibraryFolder?.path || '',
            localLibraryFilesDatabaseEnabled: values.localLibraryFilesDatabaseEnabled,
            localLibraryFilesDatabaseLoadOnStartup: values.localLibraryFilesDatabaseLoadOnStartup,
            localLibraryFilesDatabaseListenHistoryEnabled: values.localLibraryFilesDatabaseListenHistoryEnabled,
            localLibraryFilesDatabaseListenHistoryLimit: values.localLibraryFilesDatabaseListenHistoryLimit,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: values.localLibraryFilesDatabaseListenHistoryThresholdSeconds,
            ffmpegPath: values.ffmpegPath,
            openSubsonicEnabled: values.librarySharingEnabled,
            openSubsonicPort: values.librarySharingPort,
            openSubsonicApiKey: values.librarySharingPassword || '',
            openSubsonicApiKeyHash: values.librarySharingPasswordHash || '',
            remoteLibraryTranscodingEnabled: false,
            remoteLibraryTranscodingBitrateKbps: 192,
            librarySharingEnabled: values.librarySharingEnabled,
            librarySharingPort: values.librarySharingPort,
            librarySharingPassword: values.librarySharingPassword || '',
            librarySharingPasswordHash: values.librarySharingPasswordHash || '',
            listenBrainzUserToken: values.listenBrainzUserToken,
            lastFmApiKey: values.lastFmApiKey,
            lastFmApiSecret: values.lastFmApiSecret,
            lastFmSessionKey: values.lastFmSessionKey,
            scrobblingEnabled: values.scrobblingEnabled,
            scrobbleFilterMode: values.scrobbleFilterMode,
            scrobbleRules: values.scrobbleRules,
            musicBrainzServerUrl: values.musicBrainzServerUrl,
            musicBrainzRequestRateMs: values.musicBrainzRequestRateMs,
            listenBrainzServerUrl: values.listenBrainzServerUrl,
            listenBrainzRequestRateMs: values.listenBrainzRequestRateMs,
            playbackOrder: context.getPlaybackOrderMode(),
            releaseDepth: primaryLibraryFolder?.releaseDepth || 0,
            favoritePlaylists: values.favoritePlaylists,
            savePlaylistsOnAddRemove: values.savePlaylistsOnAddRemove,
            coverArtPriority: values.coverArtPriority,
            audio: {
                outputDevice: values.audioOutputDevice,
                outputBufferMs: values.audioOutputBufferMs,
                gaplessPlayback: values.gaplessPlayback,
                replayGainEnabled: values.replayGainEnabled,
            },
            preferMusicBrainzMetadata: values.preferMusicBrainzMetadata,
            musicBrainzTagDatabaseEnabled: values.musicBrainzTagDatabaseEnabled,
            highlightMusicBrainzTaggedAlbumFolders: values.highlightMusicBrainzTaggedAlbumFolders,
            musicBrainzTagStaleDays: values.musicBrainzTagStaleDays,
            musicBrainzTagRequestStaggeringEnabled: values.musicBrainzTagRequestStaggeringEnabled,
            musicBrainzTagWorkerCores: values.musicBrainzTagWorkerCores,
            lissajousEnabled: values.lissajousEnabled,
            lissajousScale: values.lissajousScale,
            visualizerMode: values.visualizerMode,
            equalizerPosition: values.equalizerPosition,
            uiDitheringEnabled: values.uiDitheringEnabled,
            minimizeToTrayOnClose: values.minimizeToTrayOnClose,
            customSendToActions: values.customSendToActions,
            keyboardShortcuts: values.keyboardShortcuts,
        });

        applyLiveVisualizerSettings(pendingSettings);

        const ffmpegStatus = await context.validateConfiguredFFmpegPath(values.ffmpegPath);
        if (!ffmpegStatus.available) {
            applyLiveVisualizerSettings(previousSettings);
            throw new Error(context.missingFFmpegMessage(ffmpegStatus));
        }

        const shouldRescanLibrary = libraryFoldersChanged(previousSettings.libraryFolders, values.libraryFolders);
        let savedSettings: AppSettings;
        try {
            savedSettings = await context.saveSettings(pendingSettings);
        } catch (error) {
            applyLiveVisualizerSettings(previousSettings);
            throw error;
        }

        context.currentSettings = normalizeAppSettings(savedSettings);
        applyLiveVisualizerSettings(context.currentSettings);
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
        if (shouldRescanLibrary) {
            void context.scanConfiguredLibraryFolders().catch((error: unknown) => {
                console.error(error);
            });
        }
    };

    return createSettingsController({
        trigger: context.trigger,
        elements: context.elements,
        state: context.settingsControllerState,
        isWindows: context.isWindowsRuntime,
        isMac: context.isMacRuntime,
        isLinux: context.isLinuxRuntime,
        getValues: () => ({
            libraryFolders: filterLocalLibraryFolders(context.currentSettings.libraryFolders),
            localLibraryFilesDatabaseEnabled: context.currentSettings.localLibraryFilesDatabaseEnabled,
            localLibraryFilesDatabaseLoadOnStartup: context.currentSettings.localLibraryFilesDatabaseLoadOnStartup,
            localLibraryFilesDatabaseListenHistoryEnabled: context.currentSettings.localLibraryFilesDatabaseListenHistoryEnabled,
            localLibraryFilesDatabaseListenHistoryLimit: context.currentSettings.localLibraryFilesDatabaseListenHistoryLimit,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: context.currentSettings.localLibraryFilesDatabaseListenHistoryThresholdSeconds,
            ffmpegPath: context.currentSettings.ffmpegPath,
            remoteLibraryTranscodingEnabled: false,
            remoteLibraryTranscodingBitrateKbps: 192,
            librarySharingEnabled: !!context.currentSettings.openSubsonicEnabled,
            librarySharingPort: context.currentSettings.openSubsonicPort || defaultOpenSubsonicPort,
            librarySharingPassword: context.currentSettings.openSubsonicApiKey || '',
            librarySharingPasswordHash: context.currentSettings.openSubsonicApiKeyHash || '',
            listenBrainzUserToken: context.currentSettings.listenBrainzUserToken,
            lastFmApiKey: context.currentSettings.lastFmApiKey,
            lastFmApiSecret: context.currentSettings.lastFmApiSecret,
            lastFmSessionKey: context.currentSettings.lastFmSessionKey,
            scrobblingEnabled: context.currentSettings.scrobblingEnabled,
            scrobbleFilterMode: context.currentSettings.scrobbleFilterMode,
            scrobbleRules: context.currentSettings.scrobbleRules,
            musicBrainzServerUrl: context.currentSettings.musicBrainzServerUrl,
            musicBrainzRequestRateMs: context.currentSettings.musicBrainzRequestRateMs,
            listenBrainzServerUrl: context.currentSettings.listenBrainzServerUrl,
            listenBrainzRequestRateMs: context.currentSettings.listenBrainzRequestRateMs,
            favoritePlaylists: context.currentSettings.favoritePlaylists,
            savePlaylistsOnAddRemove: context.currentSettings.savePlaylistsOnAddRemove,
            coverArtPriority: context.currentSettings.coverArtPriority,
            audioOutputDevice: context.currentSettings.audio.outputDevice,
            audioOutputBufferMs: context.currentSettings.audio.outputBufferMs,
            gaplessPlayback: context.currentSettings.audio.gaplessPlayback,
            replayGainEnabled: context.currentSettings.audio.replayGainEnabled,
            audioOutputDevices: context.availableAudioOutputDevices,
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
            musicBrainzTagWorkerProgress: context.currentMusicBrainzTagWorkerProgress,
            keyboardShortcuts: context.currentSettings.keyboardShortcuts,
        }),
        getMusicBrainzTagWorkerProgress: async () => await context.getMusicBrainzTagWorkerProgress(),
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
        applyAudioNow: async (values) => {
            const outputDevices = await context.refreshAvailableAudioOutputDevices();
            const resolvedOutputDevice = resolveAvailableAudioOutputDevice(values.audioOutputDevice, outputDevices);
            const nextValues = resolvedOutputDevice.fellBackToDefault
                ? { ...values, audioOutputDevice: resolvedOutputDevice.selectedDevice }
                : values;

            await saveNormalizedSettings(nextValues);

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
            return {
                devices: outputDevices,
                selectedDevice: resolvedOutputDevice.selectedDevice,
                message: resolvedOutputDevice.fellBackToDefault
                    ? 'Audio settings refreshed. Switched to Primary Sound Driver because the selected audio device is unavailable.'
                    : 'Audio settings refreshed.',
            };
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
        getRoonAccentTheme: context.getRoonAccentTheme,
        setRoonAccentTheme: context.setRoonAccentTheme,
    });
};