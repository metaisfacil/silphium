import { setupExplorationButton, updateExplorationButton } from './components/media-controls-exploration';
import './style.css';
import './app.css';
import './components/overlays/overlays.css';
import './components/overlays/exploration-modal.css';
import { createArtistInfoController, type ArtistInfoController } from './controllers/artist-info-controller';
import { createImageModalController, type ImageModalController } from './controllers/image-modal-controller';
import { createLibraryController } from './controllers/library-controller';
import type { LibraryController } from './controllers/library-controller';
import { createListenBrainzController, type ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import { createListenBrainzSocialController } from './controllers/listenbrainz-social-controller';
import { createLissajousVisualizerController } from './controllers/lissajous-visualizer-controller';
import { createMediaSessionController, type ExternalPlaybackAction } from './controllers/media-session-controller';
import { createPlaylistController, type LoadedPlaylistData, type PlaylistController } from './controllers/playlist-controller';
import { createPlaylistTargetModalController, type PlaylistTargetModalController } from './controllers/playlist-target-modal-controller';
import { createSettingsController, type SettingsController } from './controllers/settings-controller';
import {
    appendIndexedFilesToScanCollections,
    clearLibraryRuntimeData,
    createScanCollections,
    mapLibraryScanResult,
    mergePlaylistFilesIntoTracks,
} from './services/library-data-service';
import { createPlaybackSequencingService } from './services/playback-sequencing-service';
import { createScrobbleService } from './services/scrobble-service';
import { canvasToPngBlob, loadShareCanvasImage, renderShareImagePreview } from './services/share-image-service';
import { createPlaybackStateService } from './services/playback-state-service';
import { createCoverArtService } from './services/cover-art-service';
import { createTrackMetadataService } from './services/track-metadata-service';
import { getMediaControlsElements, renderMediaControls, renderPlayPauseIcon } from './components/media-controls';
import {
    getAboutModalElements,
    getErrorModalElements,
    getImageFileModalElements,
    getMusicBrainzEntityModalElements,
    getPlayOrderMenuElements,
    getPlaylistMenuElements,
    getPlaylistModalElements,
    getPlaylistTargetModalElements,
    getQueueConfirmModalElements,
    getShareModalElements,
    getSidebarQueueMenuElements,
    getSettingsModalElements,
    getTechnicalInfoModalElements,
    getTextFileModalElements,
    getTrackMetaMenuElements,
    renderImageFileModal,
    renderAboutModal,
    renderErrorModal,
    renderMusicBrainzEntityModal,
    renderPlayOrderMenu,
    renderPlaylistMenu,
    renderPlaylistModal,
    renderPlaylistTargetModal,
    renderQueueConfirmModal,
    renderShareModal,
    renderSidebarQueueMenu,
    renderSettingsModal,
    renderTechnicalInfoModal,
    renderTextFileModal,
    renderTrackMetaMenu,
} from './components/overlays';
import { UI_TIMINGS_MS } from './constants/ui-timings';
import { getSidebarElements, renderSidebar } from './components/sidebar';
import {
    ScanConfiguredLibraryFolders,
    AudioListOutputDevices,
    AudioReinitializeBackend,
    AudioGetVisualizationFrame,
    AudioGetState,
    AudioGetReplayGainReleaseDynamicRange,
    AppendTracksToPlaylistFile,
    GetMusicBrainzTagWorkerProgress,
    AudioLoadTrack,
    AudioLoadTrackWithReplayGainContext,
    AudioPause,
    AudioPlay,
    AudioQueueNextTrack,
    AudioQueueNextTrackWithReplayGainContext,
    AudioSeek,
    AudioSetVolume,
    AudioStop,
    GetAppVersion,
    GetLibraryFolderCoverPath,
    GetLibraryFolderPage,
    GetLibraryFolderTrackCount,
    GetLibraryFolderTrackPaths,
    GetLastFmFollowing,
    GetLastFmFollowingFeed,
    GetLastFmRequestToken,
    GetLastFmSessionKey,
    GetLibraryIndexedFilePage,
    GetListenBrainzFollowing,
    GetListenBrainzFollowingFeed,
    ResolveLibraryFolderForPath,
    GetListenBrainzRecordingFeedback,
    IsLibraryFolderImmediateDescendantsEnumerated,
    GetSettings,
    InitializeAudioBackend,
    LoadPlaylistFile,
    LogFrontendMessage,
    LookupArtistByMBID,
    OpenFolderInFileBrowser,
    ReadTrackEmbeddedCover,
    ReadFileBase64,
    ReadImageThumbnail,
    ReadTextFile,
    ReadTrackTags,
    SavePlaylistFile,
    SaveShareImageFile,
    SaveSettings,
    SearchLibrary,
    SelectLibraryFolder,
    SelectPlaylistFile,
    SelectPlaylistSaveFile,
    SelectShareImageSaveFile,
    SubmitLastFm,
    SubmitLastFmLove,
    SubmitLastFmUnlove,
    SubmitListenBrainz,
    SubmitListenBrainzRecordingFeedback,
    ValidateFFmpegPath,
} from '../wailsjs/go/main/App';
import { main as WailsModels } from '../wailsjs/go/models';
import { BrowserOpenURL, ClipboardSetText, EventsOn, OnFileDrop, WindowHide, WindowIsMinimised } from '../wailsjs/runtime/runtime';
import { applyMbLinks, openMbLink } from './musicbrainz';
import type {
    AppLibraryFolder,
    AppSettings,
    AudioOutputDevice,
    AudioPlaybackState,
    AudioVisualizationFrame,
    CoverArtPrioritySource,
    FFmpegPathStatus,
    ImageLibraryFile,
    LibraryFolderPage,
    LibraryIndexedFilePage,
    LibraryScanProgress,
    LibraryScanResult,
    LibrarySearchPage,
    MusicBrainzTagWorkerProgress,
    MusicBrainzEntityType,
    ListenBrainzSocialEvent,
    PlayerCardLayout,
    PlaybackOrderMode,
    PlaylistLoadResult,
    TextLibraryFile,
    Track,
} from './types/app-types';
import {
    asPlaybackOrderMode,
    asScrobbleFilterMode,
    asReleaseDepth,
    buildLibraryRootNameByPath,
    findLibraryFolderForFilePath,
    formatTime,
    hasExternalFileDragPayload,
    isSupportedAudioFilePath,
    isTrackScrobbleAllowed,
    libraryFolderPathKey,
    normalizeLibraryFolders,
    normalizeScrobbleRules,
    renderTechnicalInfoContent,
    taggedTrackPosition,
} from './utils/main-helpers';
import {
    lookupMusicBrainzTrackMetadata,
    lookupMusicBrainzEntity,
    mbidForTrackEntity,
    renderMusicBrainzEntityContent,
    setMusicBrainzRequestLogServerResolver,
} from './utils/musicbrainz-entity-helpers';
import { scheduleListenBrainzRequest, scheduleMusicBrainzRequest } from './utils/musicbrainz-request-scheduler';
import { scheduleLastFmRequest } from './utils/lastfm-request-scheduler';
import {
    defaultFocusedKeyboardShortcuts,
    formatShortcutBindingFromKeyboardEvent,
    normalizeFocusedKeyboardShortcuts,
    shortcutBindingUsesCode,
} from './utils/shortcut-bindings';

const app = document.querySelector('#app') as HTMLElement | null;
const isWindowsRuntime = /windows/i.test(navigator.userAgent);

if (!app) {
    throw new Error('App container not found');
}

app.innerHTML = `
        <div class="bg-stage" aria-hidden="true">
            <div id="bg-layer-a" class="bg-layer"></div>
            <div id="bg-layer-b" class="bg-layer"></div>
        </div>
        ${renderSidebar()}
        ${renderMediaControls()}
        ${renderAboutModal()}
        ${renderErrorModal()}
        ${renderQueueConfirmModal()}
        ${renderTextFileModal()}
        ${renderImageFileModal()}
        ${renderMusicBrainzEntityModal()}
        ${renderTechnicalInfoModal()}
        ${renderSettingsModal()}
        ${renderShareModal()}
        ${renderPlayOrderMenu()}
        ${renderTrackMetaMenu()}
        ${renderSidebarQueueMenu()}
        ${renderPlaylistMenu()}
        ${renderPlaylistTargetModal()}
        ${renderPlaylistModal()}
`;


setupExplorationButton(document, {
    getActiveTrack: () => (currentTrackIndex >= 0 && currentTrackIndex < tracks.length ? tracks[currentTrackIndex] : undefined),
});

let tracks: Track[] = [];
let textFiles: TextLibraryFile[] = [];
let imageFiles: ImageLibraryFile[] = [];
const trackIndexByPath = new Map<string, number>();
const textFileIndexByPath = new Map<string, number>();
const imageFileIndexByPath = new Map<string, number>();
let currentTrackIndex = -1;
let objectUrls: string[] = [];
let tagRequestVersion = 0;
let artistInfoRequestVersion = 0;
let activeBackgroundLayer = 0;
let coverFlipped = false;
let playbackPollHandle: number | undefined;
let musicBrainzEntityModalHideTimer: number | undefined;
let technicalInfoModalHideTimer: number | undefined;
let aboutModalHideTimer: number | undefined;
let errorModalHideTimer: number | undefined;
let shareModalHideTimer: number | undefined;
let isSeeking = false;
let playbackMutationVersion = 0;
let playPauseToggleInFlight = false;
let trackNavigationChain: Promise<void> = Promise.resolve();
let gaplessQueueRequestVersion = 0;
let queuedGaplessTrackPath = '';
let activeReplayGainReleaseTrackPaths: string[] = [];
const replayGainReleaseDynamicRangeLabelByKey = new Map<string, string>();
const replayGainReleaseDynamicRangePendingByKey = new Map<string, Promise<string>>();
let replayGainReleaseDynamicRangeRequestVersion = 0;
let availableAudioOutputDevices: AudioOutputDevice[] = [];
const defaultMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress = {
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
const defaultMusicBrainzTagStaleDays = 30;
const maxMusicBrainzTagStaleDays = 36500;
let currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress = { ...defaultMusicBrainzTagWorkerProgress };
let currentSettings: AppSettings = {
    libraryFolders: [],
    libraryPath: '',
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
    musicBrainzTagStaleDays: defaultMusicBrainzTagStaleDays,
    musicBrainzTagRequestStaggeringEnabled: false,
    musicBrainzTagWorkerCores: 1,
    lissajousEnabled: true,
    minimizeToTrayOnClose: false,
    keyboardShortcuts: { ...defaultFocusedKeyboardShortcuts },
};

const normalizeMusicBrainzTagWorkerProgress = (value?: Partial<MusicBrainzTagWorkerProgress> | null): MusicBrainzTagWorkerProgress => {
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
let startupInitializationComplete = false;
let ffmpegConfigurationRequired = false;
let trackMetaMenuTarget: HTMLElement | null = null;
let sidebarQueueTrackIndexes: number[] = [];
let sidebarQueueFeedbackTrackIndex: number | null = null;
let sidebarQueueFolderPath = '';
let sidebarQueueFolderLabel = '';
let sidebarQueueFolderTarget = false;
let sidebarQueueTrackIndexesScopedToSelection = false;
let queueConfirmResolver: ((confirmed: boolean) => void) | null = null;
let sharePreviewRequestVersion = 0;
let sharePreviewSnapshot: {
    title: string;
    album: string;
    artist: string;
    trackPath: string;
    coverImage?: ImageBitmap;
} | null = null;
const musicBrainzEntityModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const technicalInfoModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const aboutModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const errorModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const shareModalTransitionMs = UI_TIMINGS_MS.modalTransition;
const sidebarQueueDescendantPromptThreshold = 200;
const selectedLibraryRootLabel = 'Selected folders';
const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];
const normalizeCoverArtPriority = (sources: CoverArtPrioritySource[] | string[] | undefined): CoverArtPrioritySource[] => {
    if (sources === undefined) {
        return [...defaultCoverArtPriority];
    }

    const ordered: CoverArtPrioritySource[] = [];
    const seen = new Set<CoverArtPrioritySource>();

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
const normalizeAppSettings = (settings: Partial<AppSettings>): AppSettings => {
    const libraryFolders = normalizeLibraryFolders(settings.libraryFolders, settings.libraryPath, settings.releaseDepth);
    const legacyScrobbleFolders = Array.isArray((settings as { scrobbleFolders?: string[] }).scrobbleFolders)
        ? (settings as { scrobbleFolders?: string[] }).scrobbleFolders
        : undefined;
    const rawAudio = settings.audio || { outputDevice: 'default', outputBufferMs: 0, gaplessPlayback: false, replayGainEnabled: false };
    const normalizedAudioBufferMs = Number.isFinite(rawAudio.outputBufferMs)
        ? Math.max(0, Math.min(1000, Math.round(rawAudio.outputBufferMs)))
        : 0;
    return {
        libraryFolders,
        libraryPath: libraryFolders[0]?.path || '',
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
        musicBrainzTagStaleDays: Number.isFinite(settings.musicBrainzTagStaleDays) && (settings.musicBrainzTagStaleDays ?? 0) >= 0
            ? Math.min(maxMusicBrainzTagStaleDays, Math.floor(settings.musicBrainzTagStaleDays ?? defaultMusicBrainzTagStaleDays))
            : defaultMusicBrainzTagStaleDays,
        musicBrainzTagRequestStaggeringEnabled: !!settings.musicBrainzTagRequestStaggeringEnabled,
        musicBrainzTagWorkerCores: Number.isFinite(settings.musicBrainzTagWorkerCores)
            ? Math.max(1, Math.min(128, Math.floor(settings.musicBrainzTagWorkerCores || 1)))
            : 1,
        lissajousEnabled: settings.lissajousEnabled !== false,
        minimizeToTrayOnClose: !!settings.minimizeToTrayOnClose,
        keyboardShortcuts: normalizeFocusedKeyboardShortcuts(settings.keyboardShortcuts),
    };
};

const validateConfiguredFFmpegPath = async (ffmpegPath: string): Promise<FFmpegPathStatus> => await ValidateFFmpegPath(ffmpegPath) as FFmpegPathStatus;

const missingFFmpegMessage = (status: FFmpegPathStatus): string => {
    if (status.message && status.message.trim() !== '') {
        return `${status.message.trim()}. Open Settings and save a valid ffmpeg executable path before continuing.`;
    }

    return 'FFmpeg was not found. Open Settings and save a valid ffmpeg executable path before continuing.';
};

const promptForMissingFFmpeg = (status: FFmpegPathStatus): void => {
    ffmpegConfigurationRequired = true;
    playbackStateService.setBackendReady(false);
    libraryController.renderFolder('none');
    openErrorModal('FFmpeg Required', missingFFmpegMessage(status));
    settingsController.open('general');
};

const completeStartupIfReady = async (): Promise<void> => {
    if (startupInitializationComplete) {
        return;
    }

    const ffmpegStatus = await validateConfiguredFFmpegPath(currentSettings.ffmpegPath);
    if (!ffmpegStatus.available) {
        promptForMissingFFmpeg(ffmpegStatus);
        return;
    }

    ffmpegConfigurationRequired = false;
    await initializeBackendPlayback();

    if (currentSettings.libraryFolders.length > 0) {
        await scanConfiguredLibraryFolders();
    } else {
        libraryController.renderFolder('none');
    }

    startupInitializationComplete = true;
    void refreshListenBrainzFeedbackForCurrentTrack(true);
};

const defaultMusicBrainzServerUrl = 'https://musicbrainz.org';
const defaultListenBrainzServerUrl = 'https://api.listenbrainz.org';
const defaultLastFmServerUrl = 'https://ws.audioscrobbler.com/2.0';
const hasLastFmCredentialsConfigured = (): boolean => currentSettings.lastFmApiKey.trim() !== ''
    && currentSettings.lastFmApiSecret.trim() !== ''
    && currentSettings.lastFmSessionKey.trim() !== '';

const firstTagValue = (track: Track, ...keys: string[]): string => {
    for (const key of keys) {
        const normalizedKey = key.toLowerCase();
        for (const [tagName, values] of Object.entries(track.allFileTags || {})) {
            if (tagName.toLowerCase() !== normalizedKey) {
                continue;
            }

            const firstValue = values.find((value) => value.trim() !== '');
            if (firstValue) {
                return firstValue.trim();
            }
        }
    }

    return '';
};

const normalizedTrackNumber = (track: Track): string | undefined => {
    const candidate = (track.displayTrackNumber || firstTagValue(track, 'tracknumber', 'track number', 'track')).trim();
    if (candidate === '') {
        return undefined;
    }

    const normalized = candidate.split('/')[0]?.trim() || '';
    return /^\d+$/.test(normalized) ? normalized : undefined;
};

const submitLastFmFeedbackForTrack = async (track: Track, score: ListenBrainzFeedbackScore): Promise<void> => {
    if ((score !== 1 && score !== 0) || !hasLastFmCredentialsConfigured()) {
        return;
    }

    const payload = {
        artistName: track.displayArtist || firstTagValue(track, 'artist') || 'Unknown Artist',
        trackName: track.displayTitle || track.title || track.name,
        releaseName: track.displayAlbum || firstTagValue(track, 'album') || '',
        albumArtist: firstTagValue(track, 'albumartist', 'album artist', 'album_artist') || undefined,
        trackNumber: normalizedTrackNumber(track),
        recordingMbid: track.mbIds.recordingId || undefined,
    };

    await scheduleLastFmRequest(async () => (
        score === 1 ? await SubmitLastFmLove(payload) : await SubmitLastFmUnlove(payload)
    ), {
        server: defaultLastFmServerUrl,
        path: score === 1 ? 'track.love' : 'track.unlove',
    });
};

const playbackStateService = createPlaybackStateService();
setMusicBrainzRequestLogServerResolver(() => currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl);
const scrobbleService = createScrobbleService({
    submitListenBrainz: async (eventType, payload, listenedAt) => await scheduleListenBrainzRequest(async () => (
        await SubmitListenBrainz(eventType, payload, listenedAt)
    ), {
        server: currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
        path: '/1/submit-listens',
    }),
    submitLastFm: async (eventType, payload, listenedAt) => await scheduleLastFmRequest(async () => (
        await SubmitLastFm(eventType, payload, listenedAt)
    ), {
        server: defaultLastFmServerUrl,
        path: eventType === 'playing_now' ? 'track.updateNowPlaying' : 'track.scrobble',
    }),
});
const playbackSequencingService = createPlaybackSequencingService({
    getTracks: () => tracks,
    getCurrentTrackIndex: () => currentTrackIndex,
    getReleaseDepthForTrack: (track: Track) => releaseDepthForTrack(track),
    initialPlaybackOrderMode: currentSettings.playbackOrder,
});
const trackMetadataService = createTrackMetadataService({
    getTracks: () => tracks,
    setTrack: (index: number, track: Track) => {
        tracks[index] = track;
    },
    readTrackTags: ReadTrackTags,
    lookupMusicBrainzTrackMetadata: async (releaseId: string) => await lookupMusicBrainzTrackMetadata(releaseId),
    getPreferMusicBrainzMetadata: () => currentSettings.preferMusicBrainzMetadata,
    getCurrentTrackIndex: () => currentTrackIndex,
    getTagRequestVersion: () => tagRequestVersion,
});
const coverArtService = createCoverArtService({
    getCoverArtPriority: () => currentSettings.coverArtPriority,
    getLibraryFolderCoverPath: async (folderPath: string): Promise<string> => await GetLibraryFolderCoverPath(folderPath) as string,
    readFileBase64: async (filePath: string): Promise<string> => await ReadFileBase64(filePath) as string,
    readTrackEmbeddedCover: async (trackPath: string): Promise<{ base64?: string; mimeType?: string }> => await ReadTrackEmbeddedCover(trackPath) as { base64?: string; mimeType?: string },
    registerObjectUrl: (url: string): void => {
        objectUrls.push(url);
    },
});

const {
    sidebarToggle,
    librarySidebar,
    librarySettings,
    libraryAbout,
    sidebarSectionTrigger,
    sidebarSectionTriggerLabel,
    sidebarSectionMenu,
    sidebarSectionOptionLibrary,
    sidebarSectionOptionSocial,
    sidebarPaneLibrary,
    sidebarPaneSocial,
    libraryBack,
    libraryPath,
    librarySearch,
    libraryBrowser,
    libraryScanYieldIndicator,
    socialFeedStatus,
    socialFeedList,
} = getSidebarElements(document);
const {
    playerShell,
    playerLane,
    playerCard,
    playerLissajousCanvas,
    trackTitle,
    trackAlbum,
    trackPosition,
    trackArtist,
    trackTechnical,
    trackTechnicalAlt,
    trackArtistHeader,
    trackReleaseAlbum,
    trackReleaseLabel,
    trackReleaseYear,
    trackReleaseCat,
    trackTitleInline,
    trackPositionInline,
    trackGenreInline,
    lyricsPanel,
    lyricsContent,
    coverFrame,
    coverFlipper,
    artistInfoName,
    artistInfoType,
    artistInfoCountry,
    artistInfoLifeSpan,
    artistInfoGenres,
    artistInfoSummary,
    artistInfoLinks,
    coverArtBackground,
    coverArt,
    currentTimeLabel,
    trackDurationLabel,
    seek,
    listenBrainzLoveBtn,
    listenBrainzFeedbackMenu,
    listenBrainzFeedbackLoveBtn,
    listenBrainzFeedbackHateBtn,
    playlistBtn,
    back,
    playPause,
    forward,
    shareBtn,
    volume,
} = getMediaControlsElements(document);
const lissajousVisualizerController = createLissajousVisualizerController({
    canvas: playerLissajousCanvas,
    getPlaybackState: () => playbackStateService.getPlaybackState(),
    fetchVisualizationFrame: async (frameCount: number): Promise<AudioVisualizationFrame> => (
        await AudioGetVisualizationFrame(frameCount) as AudioVisualizationFrame
    ),
});
lissajousVisualizerController.setEnabled(currentSettings.lissajousEnabled);
const listenBrainzController = createListenBrainzController({
    elements: {
        playerCard,
        listenBrainzLoveBtn,
        listenBrainzFeedbackMenu,
        listenBrainzFeedbackLoveBtn,
        listenBrainzFeedbackHateBtn,
    },
    getToken: () => currentSettings.listenBrainzUserToken,
    getTracks: () => tracks,
    getCurrentTrackIndex: () => currentTrackIndex,
    ensureTrackTagsResolved: async (index: number): Promise<void> => {
        await trackMetadataService.ensureTrackTagsResolved(index);
    },
    fetchRecordingFeedback: async (recordingMbid: string): Promise<number> => await scheduleListenBrainzRequest(async () => (
        await GetListenBrainzRecordingFeedback(recordingMbid) as number
    ), {
        server: currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
        path: '/1/feedback/user/{user}/get-feedback-for-recordings',
    }),
    submitRecordingFeedback: async (recordingMbid: string, score: ListenBrainzFeedbackScore): Promise<unknown> => await scheduleListenBrainzRequest(async () => (
        await SubmitListenBrainzRecordingFeedback(recordingMbid, score)
    ), {
        server: currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
        path: '/1/feedback/recording-feedback',
    }),
    onFeedbackSubmitted: async (track: Track, score: ListenBrainzFeedbackScore): Promise<void> => {
        await submitLastFmFeedbackForTrack(track, score);
    },
    beforeOpenMenu: () => {
        closePlayOrderMenu();
        closeTrackMetaMenu();
        closeSidebarQueueMenu();
        playlistController.closeMenu();
    },
});
const hasListenBrainzScrobbling = (): boolean => listenBrainzController.canScrobble();
const hasLastFmScrobbling = (): boolean => hasLastFmCredentialsConfigured();
const closeListenBrainzFeedbackMenu = (): void => {
    listenBrainzController.closeMenu();
};
const resetListenBrainzFeedbackState = (): void => {
    listenBrainzController.resetFeedbackState();
};
const refreshListenBrainzFeedbackForCurrentTrack = async (force = false): Promise<void> => {
    await listenBrainzController.refreshFeedbackForCurrentTrack(force);
};
const submitListenBrainzFeedbackForTrack = async (trackIndex: number, score: ListenBrainzFeedbackScore): Promise<void> => {
    await listenBrainzController.submitFeedbackForTrack(trackIndex, score);
};
const listenBrainzSocialController = createListenBrainzSocialController({
    elements: {
        sidebarToggle,
        sidebarSectionTrigger,
        sidebarSectionTriggerLabel,
        sidebarSectionMenu,
        sidebarSectionOptionLibrary,
        sidebarSectionOptionSocial,
        sidebarPaneLibrary,
        sidebarPaneSocial,
        socialFeedStatus,
        socialFeedList,
    },
    hasAnyProviderConfigured: () => hasListenBrainzScrobbling() || hasLastFmScrobbling(),
    isSidebarVisible: () => app.classList.contains('sidebar-open'),
    fetchFollowingUsers: async (): Promise<string[]> => {
        const providers: Array<Promise<string[]>> = [];

        if (hasListenBrainzScrobbling()) {
            providers.push(scheduleListenBrainzRequest(async () => (
                await GetListenBrainzFollowing() as string[]
            ), {
                server: currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
                path: '/1/user/{user}/following',
            }));
        }

        if (hasLastFmScrobbling()) {
            providers.push(scheduleLastFmRequest(async () => (
                await GetLastFmFollowing() as string[]
            ), {
                server: defaultLastFmServerUrl,
                path: 'user.getFriends',
            }));
        }

        const merged = (await Promise.all(providers)).flat();
        return [...new Set(merged.map((name) => name.trim()).filter((name) => name !== ''))].sort((left, right) => left.localeCompare(right));
    },
    fetchFollowingFeed: async (count: number): Promise<ListenBrainzSocialEvent[]> => {
        const providers: Array<Promise<ListenBrainzSocialEvent[]>> = [];

        if (hasListenBrainzScrobbling()) {
            providers.push(scheduleListenBrainzRequest(async () => (
                await GetListenBrainzFollowingFeed(count) as ListenBrainzSocialEvent[]
            ), {
                server: currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
                path: '/1/user/{user}/feed/events/listens/following',
            }));
        }

        if (hasLastFmScrobbling()) {
            providers.push(scheduleLastFmRequest(async () => (
                await GetLastFmFollowingFeed(count) as ListenBrainzSocialEvent[]
            ), {
                server: defaultLastFmServerUrl,
                path: 'user.getRecentTracks',
            }));
        }

        return (await Promise.all(providers)).flat();
    },
    openUserProfile: (provider, userName): void => {
        const encodedUserName = encodeURIComponent(userName);
        const profileUrl = provider === 'lastfm'
            ? `https://www.last.fm/user/${encodedUserName}`
            : `${(currentSettings.listenBrainzServerUrl || 'https://listenbrainz.org').replace(/\/+$/, '')}/user/${encodedUserName}/`;

        void BrowserOpenURL(profileUrl);
    },
});
const openMbOnCtrlClick = (event: MouseEvent, target: HTMLElement): void => {
    if (!event.ctrlKey) {
        return;
    }

    const eventTarget = event.target;
    if (eventTarget instanceof HTMLElement) {
        const nestedLink = eventTarget.closest('[data-mb-url]');
        if (nestedLink instanceof HTMLElement && target.contains(nestedLink)) {
            openMbLink(nestedLink);
            return;
        }
    }

    if (target.dataset.mbUrl) {
        openMbLink(target);
    }
};

const setCtrlHeldState = (held: boolean): void => {
    app.classList.toggle('ctrl-held', held);
};

const PLAYER_CARD_LAYOUT_KEY = 'playerCardLayout';
const LIBRARY_CLIENT_FINALIZE_MS_KEY = 'libraryClientFinalizeEstimateMs';
const defaultShareImageComment = 'Listening right now.';

const getStoredLayout = (): PlayerCardLayout =>
    localStorage.getItem(PLAYER_CARD_LAYOUT_KEY) === 'release' ? 'release' : 'default';

localStorage.removeItem('shareImageComment');

const applyPlayerCardLayout = (layout: PlayerCardLayout): void => {
    playerCard.classList.toggle('layout-release', layout === 'release');
    localStorage.setItem(PLAYER_CARD_LAYOUT_KEY, layout);
};

const getFirstTag = (tags: Record<string, string[]>, ...keys: string[]): string => {
    for (const key of keys) {
        for (const [k, v] of Object.entries(tags)) {
            if (k.toLowerCase() === key && v.length > 0 && v[0]) {
                return v[0];
            }
        }
    }
    return '';
};

const getReleaseLabel = (tags: Record<string, string[]>): string =>
    getFirstTag(tags, 'organization', 'label', 'publisher');

const getReleaseCat = (tags: Record<string, string[]>): string =>
    getFirstTag(tags, 'catalognumber', 'catalogid', 'catalog');

const containsNonLatinChars = (text: string): boolean =>
    /[^\u0000-\u024F\u1E00-\u1EFF]/u.test(text);

const formatSortArtist = (artist: string, sortName: string): string => {
    if (!sortName || sortName === artist || !containsNonLatinChars(artist)) {
        return artist;
    }
    return `${sortName} (${artist})`;
};

const trackMetaClickSuppressDurationMs = 280;
let suppressTrackMetaClickUntil = 0;

const suppressTrackMetaClicks = (): void => {
    suppressTrackMetaClickUntil = Date.now() + trackMetaClickSuppressDurationMs;
};

const shouldSuppressTrackMetaClick = (): boolean => Date.now() < suppressTrackMetaClickUntil;
const shouldBlockTrackMetaModalOpen = (): boolean => shouldSuppressTrackMetaClick() || app.classList.contains('sidebar-open');
const hasActiveSelectionWithin = (target: HTMLElement): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    return target.contains(commonAncestor);
};

trackTitle.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackTitle)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackTitle);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('recording');
});
trackTitle.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    trackMetaMenuTarget = trackTitle;
    openTrackMetaMenu(event.clientX, event.clientY, true, 'file');
});
trackAlbum.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackAlbum)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackAlbum);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('release');
});
trackAlbum.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    trackMetaMenuTarget = trackAlbum;
    openTrackMetaMenu(event.clientX, event.clientY, false, 'folder');
});
trackArtist.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackArtist)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackArtist);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('artist');
});
trackArtist.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const eventTarget = event.target;
    const nestedLink = eventTarget instanceof HTMLElement
        ? eventTarget.closest('[data-mb-url]')
        : null;
    const firstArtistLink = trackArtist.querySelector('[data-mb-url]');
    trackMetaMenuTarget = nestedLink instanceof HTMLElement && trackArtist.contains(nestedLink)
        ? nestedLink
        : (firstArtistLink instanceof HTMLElement ? firstArtistLink : trackArtist);

    openTrackMetaMenu(event.clientX, event.clientY, false, 'none');
});
trackTitleInline.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackTitleInline)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackTitleInline);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('recording');
});
trackTitleInline.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    trackMetaMenuTarget = trackTitleInline;
    openTrackMetaMenu(event.clientX, event.clientY, true, 'file');
});
trackReleaseAlbum.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackReleaseAlbum)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackReleaseAlbum);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('release');
});
trackReleaseAlbum.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    trackMetaMenuTarget = trackReleaseAlbum;
    openTrackMetaMenu(event.clientX, event.clientY, false, 'folder');
});
trackReleaseLabel.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackReleaseLabel)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackReleaseLabel);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('label');
});
trackArtistHeader.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
        return;
    }

    if (hasActiveSelectionWithin(trackArtistHeader)) {
        return;
    }

    if (event.ctrlKey) {
        openMbOnCtrlClick(event, trackArtistHeader);
        return;
    }

    void openMusicBrainzEntityForCurrentTrack('artist');
});
trackArtistHeader.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();

    const eventTarget = event.target;
    const nestedLink = eventTarget instanceof HTMLElement
        ? eventTarget.closest('[data-mb-url]')
        : null;
    const firstArtistLink = trackArtistHeader.querySelector('[data-mb-url]');
    trackMetaMenuTarget = nestedLink instanceof HTMLElement && trackArtistHeader.contains(nestedLink)
        ? nestedLink
        : (firstArtistLink instanceof HTMLElement ? firstArtistLink : trackArtistHeader);

    openTrackMetaMenu(event.clientX, event.clientY, false, 'none');
});
const bgLayerA = document.getElementById('bg-layer-a') as HTMLDivElement;
const bgLayerB = document.getElementById('bg-layer-b') as HTMLDivElement;
const { aboutModal, aboutBackdrop, aboutClose, aboutVersion, aboutRepoLink } = getAboutModalElements(document);
const { errorModal, errorBackdrop, errorTitle, errorMessage: errorModalMessage, errorClose, errorOk } = getErrorModalElements(document);
const {
    queueConfirmModal,
    queueConfirmBackdrop,
    queueConfirmTitle,
    queueConfirmMessage,
    queueConfirmCancel,
    queueConfirmProceed,
} = getQueueConfirmModalElements(document);
const { textFileModal, textFileBackdrop, textFileTitle, textFileCode, textFileClose } = getTextFileModalElements(document);
const imageModalElements = getImageFileModalElements(document);
const {
    musicBrainzEntityModal,
    musicBrainzEntityBackdrop,
    musicBrainzEntityDialog,
    musicBrainzEntityTitle,
    musicBrainzEntityContent,
    musicBrainzEntityClose,
} = getMusicBrainzEntityModalElements(document);
const { technicalInfoModal, technicalInfoBackdrop, technicalInfoTitle, technicalInfoContent, technicalInfoClose } = getTechnicalInfoModalElements(document);
const settingsElements = getSettingsModalElements(document);
const { shareModal, shareBackdrop, shareDialog, shareClose, sharePreview, shareCommentInput, shareStatus, shareSave, shareCopy } = getShareModalElements(document);
const { playOrderMenu } = getPlayOrderMenuElements(document);
const {
    trackMetaMenu,
    trackMetaCopyFilePathBtn,
    trackMetaCopyFolderPathBtn,
    trackMetaCopyDivider,
    trackMetaOpenMbBtn,
    trackMetaParentFolderBtn,
    trackMetaBrowserFolderBtn,
} = getTrackMetaMenuElements(document);
const {
    sidebarQueueMenu,
    sidebarQueuePlay,
    sidebarQueueAddNext,
    sidebarQueueEnd,
    sidebarQueueAddToPlaylist,
    sidebarQueueFeedbackDivider,
    sidebarQueueLove,
    sidebarQueueHate,
} = getSidebarQueueMenuElements(document);
const playlistMenuElements = getPlaylistMenuElements(document);
const playlistTargetModalElements = getPlaylistTargetModalElements(document);
const playlistModalElements = getPlaylistModalElements(document);
let settingsController: SettingsController;
let playlistController: PlaylistController;
let playlistTargetModalController: PlaylistTargetModalController;
let artistInfoController: ArtistInfoController;
let imageModalController: ImageModalController;
let libraryController: LibraryController;
let libraryClientFinalizeEstimateMs = parseFloat(localStorage.getItem(LIBRARY_CLIENT_FINALIZE_MS_KEY) ?? '') || 0;
let activeLibraryLoadScanResolvedAtMs: number | null = null;
let fullLibraryScanLoadActive = false;
let suppressAutoSelectAfterFullLibraryScan = false;
const libraryIndexedFilePageSize = 1000;
const libraryIncrementalRefreshDebounceMs = 180;
let pendingLibraryIncrementalRefreshHandle: number | null = null;
const nowPlayingCoverRefreshDebounceMs = 220;
let pendingNowPlayingCoverRefreshHandle: number | null = null;

const beginLibraryLoadTracking = (): void => {
    activeLibraryLoadScanResolvedAtMs = null;
};

const markLibraryScanResolved = (): void => {
    activeLibraryLoadScanResolvedAtMs = performance.now();
};

const finishLibraryLoadTracking = (): void => {
    if (activeLibraryLoadScanResolvedAtMs === null) {
        return;
    }

    const clientFinalizeMs = Math.max(0, performance.now() - activeLibraryLoadScanResolvedAtMs);
    activeLibraryLoadScanResolvedAtMs = null;
    if (!Number.isFinite(clientFinalizeMs) || clientFinalizeMs <= 0) {
        return;
    }

    if (libraryClientFinalizeEstimateMs <= 0) {
        libraryClientFinalizeEstimateMs = clientFinalizeMs;
    } else {
        libraryClientFinalizeEstimateMs = (libraryClientFinalizeEstimateMs * 0.7) + (clientFinalizeMs * 0.3);
    }

    localStorage.setItem(LIBRARY_CLIENT_FINALIZE_MS_KEY, String(libraryClientFinalizeEstimateMs));
};

const scheduleLibraryIncrementalFolderRefresh = (): void => {
    if (pendingLibraryIncrementalRefreshHandle !== null) {
        return;
    }

    pendingLibraryIncrementalRefreshHandle = window.setTimeout(() => {
        pendingLibraryIncrementalRefreshHandle = null;
        const currentFolderPath = libraryController.getCurrentFolderPath();
        logRescan('Refreshing current folder: %s', currentFolderPath || '(root)');
        libraryController.refreshCurrentFolder();
    }, libraryIncrementalRefreshDebounceMs);
};

const scheduleNowPlayingCoverRefresh = (): void => {
    if (pendingNowPlayingCoverRefreshHandle !== null) {
        window.clearTimeout(pendingNowPlayingCoverRefreshHandle);
    }

    pendingNowPlayingCoverRefreshHandle = window.setTimeout(() => {
        pendingNowPlayingCoverRefreshHandle = null;

        if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
            return;
        }

        const activeTrack = tracks[currentTrackIndex];
        if (!activeTrack) {
            return;
        }

        coverArtService.invalidateForTrack(activeTrack);
        void applyCoverArtForTrack(currentTrackIndex);
    }, nowPlayingCoverRefreshDebounceMs);
};

const rebuildTrackPathIndex = (): void => {
    trackIndexByPath.clear();
    tracks.forEach((track, index) => {
        trackIndexByPath.set(track.path.toLowerCase(), index);
    });
};

const rebuildTextFilePathIndex = (): void => {
    textFileIndexByPath.clear();
    textFiles.forEach((textFile, index) => {
        textFileIndexByPath.set(textFile.path.toLowerCase(), index);
    });
};

const rebuildImageFilePathIndex = (): void => {
    imageFileIndexByPath.clear();
    imageFiles.forEach((imageFile, index) => {
        imageFileIndexByPath.set(imageFile.path.toLowerCase(), index);
    });
};

const configuredLibraryFolderForPath = (path: string): AppLibraryFolder | null => {
    return findLibraryFolderForFilePath(path, currentSettings.libraryFolders);
};

const configuredLibraryRootNameByPath = (): Map<string, string> => {
    return buildLibraryRootNameByPath(currentSettings.libraryFolders);
};

const releaseDepthForTrack = (track: Pick<Track, 'rootPath'>): number => {
    const folder = configuredLibraryFolderForPath(track.rootPath || '');
    return folder ? asReleaseDepth(folder.releaseDepth) : 0;
};

const trackIndexForPath = (path: string): number => {
    const normalizedPath = path.trim().toLowerCase();
    if (!normalizedPath) {
        return -1;
    }

    const cached = trackIndexByPath.get(normalizedPath);
    if (cached !== undefined) {
        return cached;
    }

    const foundIndex = tracks.findIndex((track) => track.path.toLowerCase() === normalizedPath);
    if (foundIndex >= 0) {
        trackIndexByPath.set(normalizedPath, foundIndex);
    }

    return foundIndex;
};

const trackPathKey = (path: string): string => path.trim().toLowerCase();

const normalizeReplayGainReleaseTrackPathsForState = (paths: string[]): string[] => {
    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const path of paths) {
        const cleanPath = path.trim();
        const normalizedPathKey = trackPathKey(cleanPath);
        if (!normalizedPathKey || seen.has(normalizedPathKey)) {
            continue;
        }

        seen.add(normalizedPathKey);
        normalized.push(cleanPath);
    }

    return normalized;
};

const setActiveReplayGainReleaseTrackPaths = (releasePaths?: string[]): void => {
    activeReplayGainReleaseTrackPaths = Array.isArray(releasePaths)
        ? normalizeReplayGainReleaseTrackPathsForState(releasePaths)
        : [];
};

const createPlaceholderTrackForPath = (trackPath: string): Track => {
    const normalizedPath = trackPath.trim();
    const normalizedPathForSplit = normalizedPath.replace(/\\/g, '/');
    const segments = normalizedPathForSplit.split('/').filter((segment) => segment !== '');
    const fileName = segments[segments.length - 1] || normalizedPath;

    const matchingLibraryFolder = configuredLibraryFolderForPath(normalizedPath);
    const normalizedRootPath = (matchingLibraryFolder?.path || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const rootName = matchingLibraryFolder
        ? (configuredLibraryRootNameByPath().get(libraryFolderPathKey(matchingLibraryFolder.path)) || '')
        : '';
    const normalizedLowerPath = normalizedPathForSplit.toLowerCase();
    const normalizedLowerRootPath = normalizedRootPath.toLowerCase();

    let relativePath = fileName;
    let folderPath = '';
    if (normalizedRootPath && normalizedLowerPath.startsWith(`${normalizedLowerRootPath}/`)) {
        const libraryRelativePath = normalizedPathForSplit.slice(normalizedRootPath.length + 1);
        const libraryRelativeFolderPath = libraryRelativePath.includes('/')
            ? libraryRelativePath.slice(0, libraryRelativePath.lastIndexOf('/'))
            : '';

        relativePath = rootName ? `${rootName}/${libraryRelativePath}` : libraryRelativePath;
        folderPath = rootName
            ? (libraryRelativeFolderPath ? `${rootName}/${libraryRelativeFolderPath}` : rootName)
            : libraryRelativeFolderPath;
    }

    return {
        title: fileName,
        name: fileName,
        path: normalizedPath,
        relativePath,
        folderPath,
        rootPath: matchingLibraryFolder?.path || '',
        rootName,
        displayTitle: fileName,
        displayAlbum: 'Unknown Album',
        displayArtist: 'Unknown Artist',
        displayTrackNumber: '',
        displayTrackTotal: '',
        displayTechnical: '',
        displayLyrics: '',
        tagsResolved: false,
        mbMetadataResolved: false,
        technicalDetails: {},
        allFileTags: {},
        mbIds: {},
        artistMbids: [],
        mbArtistCredits: [],
    };
};

const ensureTrackIndexForPath = (path: string): number => {
    const existingIndex = trackIndexForPath(path);
    if (existingIndex >= 0) {
        return existingIndex;
    }

    const normalizedPath = path.trim();
    if (!normalizedPath) {
        return -1;
    }

    const placeholderTrack = createPlaceholderTrackForPath(normalizedPath);
    tracks.push(placeholderTrack);
    const createdIndex = tracks.length - 1;
    trackIndexByPath.set(normalizedPath.toLowerCase(), createdIndex);
    return createdIndex;
};

const textFileIndexForPath = (path: string): number => {
    const normalizedPath = path.trim().toLowerCase();
    if (!normalizedPath) {
        return -1;
    }

    const cached = textFileIndexByPath.get(normalizedPath);
    if (cached !== undefined) {
        return cached;
    }

    const foundIndex = textFiles.findIndex((textFile) => textFile.path.toLowerCase() === normalizedPath);
    if (foundIndex >= 0) {
        textFileIndexByPath.set(normalizedPath, foundIndex);
    }

    return foundIndex;
};

const imageFileIndexForPath = (path: string): number => {
    const normalizedPath = path.trim().toLowerCase();
    if (!normalizedPath) {
        return -1;
    }

    const cached = imageFileIndexByPath.get(normalizedPath);
    if (cached !== undefined) {
        return cached;
    }

    const foundIndex = imageFiles.findIndex((imageFile) => imageFile.path.toLowerCase() === normalizedPath);
    if (foundIndex >= 0) {
        imageFileIndexByPath.set(normalizedPath, foundIndex);
    }

    return foundIndex;
};

const currentTrackForPlaybackState = (state: AudioPlaybackState): Track | undefined => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return undefined;
    }

    const track = tracks[currentTrackIndex];
    if (!track || state.sourcePath !== track.path) {
        return undefined;
    }

    return track;
};

const applyCoverArtForTrack = async (index: number): Promise<void> => {
    const track = tracks[index];
    if (!track) {
        return;
    }

    const coverSrc = await resolveCoverForTrack(track);
    if (index !== currentTrackIndex) {
        return;
    }

    if (coverSrc) {
        coverArtBackground.src = coverSrc;
        coverArtBackground.classList.add('is-visible');
        coverArt.src = coverSrc;
        coverArt.classList.add('is-visible');
        setBackgroundCover(coverSrc);
        return;
    }

    coverArtBackground.removeAttribute('src');
    coverArtBackground.classList.remove('is-visible');
    coverArt.removeAttribute('src');
    coverArt.classList.remove('is-visible');
    setBackgroundCover();
};

const syncCurrentTrackFromPlaybackState = (state: AudioPlaybackState): void => {
    const normalizedSourcePath = state.sourcePath.trim();
    if (!state.loaded || normalizedSourcePath === '') {
        return;
    }

    const resolvedIndex = ensureTrackIndexForPath(normalizedSourcePath);
    if (resolvedIndex < 0 || resolvedIndex >= tracks.length) {
        return;
    }

    const activeTrack = tracks[currentTrackIndex];
    if (activeTrack && trackPathKey(activeTrack.path) === trackPathKey(normalizedSourcePath)) {
        return;
    }

    if (resolvedIndex === currentTrackIndex) {
        return;
    }

    currentTrackIndex = resolvedIndex;
    gaplessQueueRequestVersion += 1;
    queuedGaplessTrackPath = '';
    playlistController.scheduleRender();
    setCoverFlipped(false);
    scrobbleService.startTrackSession(normalizedSourcePath);

    const track = tracks[resolvedIndex];
    if (currentSettings.preferMusicBrainzMetadata) {
        track.mbMetadataResolved = false;
    }

    if (!libraryController.isSidebarOpen()) {
        libraryController.setSidebarAutoFolderPath(track.folderPath);
    }

    refreshNowPlayingLabel();
    void applyCoverArtForTrack(resolvedIndex);
    libraryController.renderFolder('none');

    tagRequestVersion += 1;
    void hydrateCurrentTrackTag(resolvedIndex, tagRequestVersion);

    artistInfoRequestVersion += 1;
    void hydrateCurrentArtistInfo(resolvedIndex);

    void refreshListenBrainzFeedbackForCurrentTrack(true);
};

const queueGaplessNextTrack = async (stateOverride?: AudioPlaybackState, sequenceOverrideIndexes?: number[]): Promise<void> => {
    if (!currentSettings.audio.gaplessPlayback || !playbackStateService.isBackendReady()) {
        return;
    }

    const playbackState = stateOverride || playbackStateService.getPlaybackState();
    const activeTrack = currentTrackForPlaybackState(playbackState);
    if (!playbackState.loaded || !activeTrack) {
        return;
    }

    const nextIndex = peekNextTrackIndexForDirection(1);
    const nextPath = nextIndex !== undefined ? tracks[nextIndex]?.path || '' : '';
    const requestVersion = ++gaplessQueueRequestVersion;

    if (nextPath === '') {
        if (queuedGaplessTrackPath === '') {
            return;
        }

        queuedGaplessTrackPath = '';
        logPlaybackDebug(`GaplessQueue clear after="${activeTrack.path}"`);
        try {
            await AudioQueueNextTrack(activeTrack.path, '');
            if (requestVersion !== gaplessQueueRequestVersion) {
                return;
            }
        } catch (error) {
            console.debug(error);
            logPlaybackDebug(`GaplessQueue clear failed after="${activeTrack.path}" error=${describeErrorForLog(error)}`);
        }
        return;
    }

    if (nextPath === queuedGaplessTrackPath) {
        return;
    }

    queuedGaplessTrackPath = nextPath;
    logPlaybackDebug(`GaplessQueue next="${nextPath}" after="${activeTrack.path}"`);
    try {
        const currentReleaseTrackPaths = currentReplayGainReleaseTrackPaths(sequenceOverrideIndexes);
        const replayGainReleaseTrackPaths = currentReleaseTrackPaths.length > 1
            && currentReleaseTrackPaths.some((path) => trackPathKey(path) === trackPathKey(nextPath))
            ? currentReleaseTrackPaths
            : collectReplayGainReleaseTrackPathsForIndex(nextIndex as number, sequenceOverrideIndexes);
        if (replayGainReleaseTrackPaths.length > 1) {
            await AudioQueueNextTrackWithReplayGainContext(activeTrack.path, nextPath, replayGainReleaseTrackPaths);
        } else {
            await AudioQueueNextTrack(activeTrack.path, nextPath);
        }
        if (requestVersion !== gaplessQueueRequestVersion) {
            return;
        }
    } catch (error) {
        console.debug(error);
        logPlaybackDebug(`GaplessQueue failed next="${nextPath}" after="${activeTrack.path}" error=${describeErrorForLog(error)}`);
        if (requestVersion === gaplessQueueRequestVersion) {
            queuedGaplessTrackPath = '';
        }
    }
};

const maybeSubmitListenBrainz = (state: AudioPlaybackState): void => {
    const track = currentTrackForPlaybackState(state);
    const allowTrack = !!track && isTrackScrobbleAllowed(track, state.duration, currentSettings.scrobbleFilterMode, currentSettings.scrobbleRules);
    const deferLastFmNowPlaying = !!track
        && currentSettings.preferMusicBrainzMetadata
        && !track.mbMetadataResolved
        && (track.mbIds.releaseId || '').trim() !== '';

    scrobbleService.maybeSubmit(state, track, {
        listenBrainz: hasListenBrainzScrobbling() && allowTrack,
        lastFm: hasLastFmScrobbling() && allowTrack,
    }, {
        deferLastFmNowPlaying,
    });
};

const updatePlayButton = (): void => {
    const playbackState = playbackStateService.getPlaybackState();
    const nextState = playbackState.playing ? 'pause' : 'play';
    const nextLabel = playbackState.playing ? 'Pause' : 'Play';
    if (playPause.dataset.state !== nextState) {
        playPause.innerHTML = renderPlayPauseIcon(nextState);
        playPause.dataset.state = nextState;
    }

    if (playPause.getAttribute('aria-label') !== nextLabel) {
        playPause.setAttribute('aria-label', nextLabel);
    }
};

const updateTrackLabels = (): void => {
    const playbackState = playbackStateService.getPlaybackState();
    currentTimeLabel.textContent = formatTime(playbackState.currentTime);
    trackDurationLabel.textContent = formatTime(playbackState.duration);
    seek.max = Number.isFinite(playbackState.duration) ? String(playbackState.duration) : '0';
    if (!isSeeking) {
        seek.value = String(playbackState.currentTime);
    }
};

const formatPlaybackStateForLog = (state: AudioPlaybackState): string => {
    const currentTime = Number.isFinite(state.currentTime) ? state.currentTime.toFixed(2) : '0.00';
    const duration = Number.isFinite(state.duration) ? state.duration.toFixed(2) : '0.00';
    const volume = Number.isFinite(state.volume) ? state.volume.toFixed(2) : '0.00';
    return `loaded=${state.loaded} playing=${state.playing} source="${state.sourcePath || ''}" time=${currentTime}/${duration} volume=${volume} endEventId=${state.endEventId}`;
};

const describeErrorForLog = (error: unknown): string => {
    if (error instanceof Error) {
        return error.stack || error.message || 'Error';
    }

    if (typeof error === 'string') {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

const logPlaybackDebug = (message: string): void => {
    const formatted = `[PLAYBACK] ${message}`;
    console.debug(formatted);
    void LogFrontendMessage(formatted).catch(() => undefined);
};

const handleAudioError = (error: unknown): void => {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Audio backend error';
    logPlaybackDebug(`AudioError ${describeErrorForLog(error)}`);
    if (!libraryController.getLibraryRootName()) {
        libraryController.setLibraryPathMessage(message);
    }
};

const errorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message || '';
    }

    if (typeof error === 'string') {
        return error;
    }

    return '';
};

const isMissingTrackLoadError = (error: unknown): boolean => {
    const message = errorMessage(error).toLowerCase();
    if (!message) {
        return false;
    }

    return message.includes('no such file')
        || message.includes('not found')
        || message.includes('cannot find the file')
        || message.includes('does not exist')
        || message.includes('path not found');
};

const applyPlaybackState = (nextState: AudioPlaybackState): void => {
    if (!nextState.loaded) {
        gaplessQueueRequestVersion += 1;
        queuedGaplessTrackPath = '';
        setActiveReplayGainReleaseTrackPaths();
    }

    syncCurrentTrackFromPlaybackState(nextState);
    const transition = playbackStateService.applyPlaybackState(nextState, tracks.length > 0);
    updateTrackLabels();
    updatePlayButton();
    maybeSubmitListenBrainz(nextState);
    updateMediaSessionMetadata();
    updateMediaSessionPlaybackState();
    updateMediaSessionPositionState();
    lissajousVisualizerController.setPlaybackState(nextState);
    void queueGaplessNextTrack(nextState);
    void refreshReplayGainReleaseDynamicRangeIndicator();

    if (transition.trackEnded) {
        goToTrack(1);
    }
};

const syncPlaybackState = async (): Promise<void> => {
    if (!playbackStateService.isBackendReady()) {
        return;
    }

    const requestVersion = playbackMutationVersion;
    try {
        const nextState = await AudioGetState() as AudioPlaybackState;
        if (requestVersion !== playbackMutationVersion) {
            return;
        }

        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }
};

const startPlaybackPolling = (): void => {
    if (playbackPollHandle !== undefined) {
        window.clearInterval(playbackPollHandle);
    }

    playbackPollHandle = window.setInterval(() => {
        void syncPlaybackState();
    }, 250);
};

const initializeBackendPlayback = async (): Promise<void> => {
    try {
        const initialState = await InitializeAudioBackend() as AudioPlaybackState;
        playbackStateService.setBackendReady(true);
        applyPlaybackState(initialState);
        volume.value = String(initialState.volume);
        startPlaybackPolling();
        lissajousVisualizerController.start();
    } catch (error) {
        playbackStateService.setBackendReady(false);
        handleAudioError(error);
    }
};

const silentTrackDurationThresholdSeconds = 30;

const hasActiveTrackLyrics = (): boolean => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return false;
    }

    return tracks[currentTrackIndex].displayLyrics.trim() !== '';
};

const updateLyricsPanelVisibility = (): void => {
    const lyricsPanelWidth = 400;
    const visibilityBuffer = 120;
    const shellStyles = getComputedStyle(playerShell);
    const horizontalPadding = (parseFloat(shellStyles.paddingLeft) || 0) + (parseFloat(shellStyles.paddingRight) || 0);
    const verticalPadding = (parseFloat(shellStyles.paddingTop) || 0) + (parseFloat(shellStyles.paddingBottom) || 0);
    const wasLyricsVisible = playerLane.classList.contains('lyrics-visible');
    if (!wasLyricsVisible) {
        playerLane.classList.add('lyrics-visible');
    }
    const laneStyles = getComputedStyle(playerLane);
    const laneGap = parseFloat(laneStyles.gap || laneStyles.columnGap || '0') || 0;
    if (!wasLyricsVisible) {
        playerLane.classList.remove('lyrics-visible');
    }

    const availableWidth = Math.max(0, window.innerWidth - horizontalPadding);
    const targetCardWidth = Math.max(0, (window.innerHeight - verticalPadding) * 0.75);
    const singleCardWidth = Math.min(availableWidth, targetCardWidth);
    const measuredCardHeight = playerCard.getBoundingClientRect().height;
    const requiredWidth = singleCardWidth + lyricsPanelWidth + laneGap + visibilityBuffer;
    const canShow = hasActiveTrackLyrics() && singleCardWidth > 0 && availableWidth >= requiredWidth;

    playerLane.style.setProperty('--lyrics-panel-width', `${lyricsPanelWidth}px`);
    if (measuredCardHeight > 0) {
        playerLane.style.setProperty('--player-card-height', `${Math.round(measuredCardHeight)}px`);
    }
    playerLane.classList.toggle('lyrics-visible', canShow);
    lyricsPanel.setAttribute('aria-hidden', canShow ? 'false' : 'true');
};

const refreshLyricsPanel = (): void => {
    const nextLyrics = hasActiveTrackLyrics() ? tracks[currentTrackIndex].displayLyrics : '';
    lyricsContent.textContent = nextLyrics;
    updateLyricsPanelVisibility();
};

const technicalLabelSeparator = ' • ';

const splitTechnicalLabel = (label: string): string[] => label
    .split(technicalLabelSeparator)
    .map((part) => part.trim())
    .filter((part) => part !== '');

const composeTechnicalLabel = (baseLabel: string, suffixLabel = ''): string => {
    const parts = splitTechnicalLabel(baseLabel);
    const cleanedSuffix = suffixLabel.trim();
    if (cleanedSuffix) {
        parts.push(cleanedSuffix);
    }

    return parts.join(technicalLabelSeparator);
};

const setTechnicalLabel = (button: HTMLButtonElement, label: string): void => {
    button.textContent = '';
    button.classList.remove('has-technical-separator');

    const cleaned = label.trim();
    if (!cleaned) {
        return;
    }

    const parts = splitTechnicalLabel(cleaned);
    if (parts.length <= 1) {
        button.textContent = cleaned;
        return;
    }

    parts.forEach((part, index) => {
        if (index > 0) {
            const separatorSpan = document.createElement('span');
            separatorSpan.className = 'track-technical-separator';
            separatorSpan.setAttribute('aria-hidden', 'true');
            separatorSpan.textContent = '•';
            button.append(separatorSpan);
        }

        const valueSpan = document.createElement('span');
        valueSpan.className = 'track-technical-value';
        valueSpan.textContent = part;
        button.append(valueSpan);
    });

    button.classList.add('has-technical-separator');
};

const clearReplayGainReleaseDynamicRangeCache = (): void => {
    replayGainReleaseDynamicRangeLabelByKey.clear();
    replayGainReleaseDynamicRangePendingByKey.clear();
    replayGainReleaseDynamicRangeRequestVersion += 1;
};

const cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack = (): string => {
    if (!currentSettings.audio.replayGainEnabled || currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return '';
    }

    const releasePaths = currentReplayGainReleaseTrackPaths();
    if (releasePaths.length <= 1) {
        return '';
    }

    return replayGainReleaseDynamicRangeLabelByKey.get(replayGainReleaseDynamicRangeCacheKey(releasePaths)) || '';
};

const updateNowPlayingTechnicalLabels = (): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const activeTrack = tracks[currentTrackIndex];
    const label = composeTechnicalLabel(activeTrack.displayTechnical, cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack()) || 'Details';
    setTechnicalLabel(trackTechnical, label);
    trackTechnical.disabled = false;
    setTechnicalLabel(trackTechnicalAlt, label);
    trackTechnicalAlt.disabled = false;
};

const refreshNowPlayingLabel = (): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const activeTrack = tracks[currentTrackIndex];
    trackTitle.textContent = activeTrack.displayTitle;
    trackAlbum.textContent = activeTrack.displayAlbum;
    trackPosition.textContent = taggedTrackPosition(activeTrack);
    trackArtist.textContent = activeTrack.displayArtist;
    updateNowPlayingTechnicalLabels();
    trackReleaseAlbum.textContent = activeTrack.displayAlbum;
    trackTitleInline.textContent = activeTrack.displayTitle;
    const num = activeTrack.displayTrackNumber.trim();
    const total = activeTrack.displayTrackTotal.trim();
    trackPositionInline.textContent = num && total ? `${num}/${total}` : num || '';
    const fileTags = activeTrack.allFileTags;
    trackReleaseLabel.textContent = getReleaseLabel(fileTags);
    trackReleaseCat.textContent = getReleaseCat(fileTags);
    trackReleaseYear.textContent = getFirstTag(fileTags, 'date', 'year', 'originaldate', 'releasedate');
    trackGenreInline.textContent = getFirstTag(fileTags, 'genre');
    const artistSortName = getFirstTag(fileTags, 'artistsort', 'sortartist', 'artist_sort');
    const headerArtistText = formatSortArtist(activeTrack.displayArtist, artistSortName);
    refreshLyricsPanel();
    const mbLinkOptions = {
        artistText: activeTrack.displayArtist,
        artistMbids: activeTrack.artistMbids,
        artistCredits: activeTrack.mbArtistCredits,
    };
    applyMbLinks(trackTitle, trackAlbum, trackArtist, activeTrack.mbIds, mbLinkOptions);
    applyMbLinks(trackTitleInline, trackReleaseAlbum, trackArtistHeader, activeTrack.mbIds, {
        ...mbLinkOptions,
        artistText: headerArtistText,
    });

    if (activeTrack.mbIds.labelId) {
        trackReleaseLabel.dataset.mbUrl = `https://musicbrainz.org/label/${activeTrack.mbIds.labelId}`;
    } else {
        delete trackReleaseLabel.dataset.mbUrl;
    }

    updateExplorationButton(document, activeTrack);
    updateMediaSessionMetadata();
    void refreshListenBrainzFeedbackForCurrentTrack();

    playlistController.scheduleRender();
    void refreshReplayGainReleaseDynamicRangeIndicator();
};

const ensureTrackTagsResolved = async (index: number): Promise<void> => {
    await trackMetadataService.ensureTrackTagsResolved(index);
    if (index === currentTrackIndex) {
        refreshNowPlayingLabel();
    }
};

const ensureTrackTagsResolvedBatch = async (indexes: number[]): Promise<void> => {
    await trackMetadataService.ensureTrackTagsResolvedBatch(indexes);
    if (indexes.includes(currentTrackIndex)) {
        refreshNowPlayingLabel();
    }
};

const matchesSilenceTitleHeuristic = (track: Track): boolean => {
    const titles = [
        track.displayTitle,
        track.title,
        track.name,
        track.name.replace(/\.[^/.]+$/, ''),
    ];

    return titles.some((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized === '[silence]' || normalized === '(silence)';
    });
};

const shouldSkipLoadedTrack = async (): Promise<boolean> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return false;
    }

    await ensureTrackTagsResolved(currentTrackIndex);

    const playbackState = playbackStateService.getPlaybackState();
    const track = tracks[currentTrackIndex];
    if (!playbackState.loaded || playbackState.sourcePath !== track.path) {
        return false;
    }

    if (!Number.isFinite(playbackState.duration) || playbackState.duration <= 0 || playbackState.duration >= silentTrackDurationThresholdSeconds) {
        return false;
    }

    return matchesSilenceTitleHeuristic(track);
};

const setCoverFlipped = (flipped: boolean): void => {
    coverFlipped = flipped;
    coverFlipper.classList.toggle('is-flipped', flipped);
};
const resetShuffleHistory = (): void => {
    playbackSequencingService.resetShuffleHistory();
};

const baseSequenceIndexes = (): { indexes: number[]; currentPosition: number } => {
    return playbackSequencingService.baseSequenceIndexes();
};

const nextTrackIndexForDirection = (direction: -1 | 1): number | undefined => {
    const nextPlaylistIndex = playlistController.getNextTrackIndex(direction);
    if (nextPlaylistIndex !== undefined) {
        return nextPlaylistIndex;
    }

    return playbackSequencingService.nextTrackIndexForDirection(direction);
};

const peekNextTrackIndexForDirection = (direction: -1 | 1): number | undefined => {
    const nextPlaylistIndex = playlistController.peekNextTrackIndex(direction);
    if (nextPlaylistIndex !== undefined) {
        return nextPlaylistIndex;
    }

    return playbackSequencingService.peekNextTrackIndexForDirection(direction);
};

const closePlayOrderMenu = (): void => {
    playOrderMenu.hidden = true;
};

const closeTrackMetaMenu = (): void => {
    trackMetaMenu.hidden = true;
    trackMetaMenuTarget = null;
};

type SidebarQueueSelectionContext = {
    trackIndexes: number[];
    folderPath: string;
    folderLabel: string;
    folderTarget: boolean;
    trackIndexesScopedToSelection: boolean;
};

const captureSidebarQueueSelectionContext = (): SidebarQueueSelectionContext | null => {
    const trackIndexes = sidebarQueueTrackIndexes.filter((trackIndex) => (
        Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < tracks.length
    ));

    if (trackIndexes.length === 0 && !sidebarQueueFolderTarget) {
        return null;
    }

    return {
        trackIndexes,
        folderPath: sidebarQueueFolderPath,
        folderLabel: sidebarQueueFolderLabel,
        folderTarget: sidebarQueueFolderTarget,
        trackIndexesScopedToSelection: sidebarQueueTrackIndexesScopedToSelection,
    };
};

const closeSidebarQueueMenu = (): void => {
    sidebarQueueMenu.hidden = true;
    sidebarQueueTrackIndexes = [];
    sidebarQueueFeedbackTrackIndex = null;
    sidebarQueueFolderPath = '';
    sidebarQueueFolderLabel = '';
    sidebarQueueFolderTarget = false;
    sidebarQueueTrackIndexesScopedToSelection = false;
};

const openSidebarQueueMenu = (
    clientX: number,
    clientY: number,
    trackIndexes: number[],
    feedbackTrackIndex?: number,
    folderPath?: string,
    folderLabel?: string,
    folderTarget = false,
    trackIndexesScopedToSelection = false,
): void => {
    const normalizedFolderPath = (folderPath || '').trim();
    if (trackIndexes.length === 0 && normalizedFolderPath === '' && !folderTarget) {
        return;
    }

    closePlayOrderMenu();
    closeTrackMetaMenu();
    closeListenBrainzFeedbackMenu();
    playlistController.closeMenu();

    sidebarQueueTrackIndexes = trackIndexes;
    sidebarQueueFolderPath = normalizedFolderPath;
    sidebarQueueFolderLabel = (folderLabel || '').trim() || normalizedFolderPath;
    const isFolderTarget = folderTarget || normalizedFolderPath !== '';
    sidebarQueueFolderTarget = isFolderTarget;
    sidebarQueueTrackIndexesScopedToSelection = trackIndexesScopedToSelection;
    const canShowFeedbackActions = !isFolderTarget
        && Number.isInteger(feedbackTrackIndex)
        && (feedbackTrackIndex as number) >= 0
        && (feedbackTrackIndex as number) < tracks.length;
    const hasListenBrainzToken = hasListenBrainzScrobbling();
    sidebarQueueFeedbackTrackIndex = canShowFeedbackActions ? (feedbackTrackIndex as number) : null;
    sidebarQueueFeedbackDivider.hidden = !canShowFeedbackActions;
    sidebarQueueLove.hidden = !canShowFeedbackActions;
    sidebarQueueHate.hidden = !canShowFeedbackActions;
    sidebarQueueLove.disabled = canShowFeedbackActions ? !hasListenBrainzToken : false;
    sidebarQueueHate.disabled = canShowFeedbackActions ? !hasListenBrainzToken : false;
    sidebarQueueLove.setAttribute('aria-disabled', sidebarQueueLove.disabled ? 'true' : 'false');
    sidebarQueueHate.setAttribute('aria-disabled', sidebarQueueHate.disabled ? 'true' : 'false');
    const feedbackDisabledTitle = 'Set a ListenBrainz token in Settings to enable Love/Hate.';
    const feedbackEnabledTitle = 'Submit ListenBrainz feedback for this track.';
    sidebarQueueLove.title = canShowFeedbackActions
        ? (hasListenBrainzToken ? feedbackEnabledTitle : feedbackDisabledTitle)
        : '';
    sidebarQueueHate.title = canShowFeedbackActions
        ? (hasListenBrainzToken ? feedbackEnabledTitle : feedbackDisabledTitle)
        : '';
    sidebarQueueMenu.hidden = false;

    const margin = 10;
    const rect = sidebarQueueMenu.getBoundingClientRect();
    const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
    const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

    sidebarQueueMenu.style.left = `${Math.max(margin, clampedX)}px`;
    sidebarQueueMenu.style.top = `${Math.max(margin, clampedY)}px`;
};

const closeQueueConfirmModal = (confirmed: boolean): void => {
    queueConfirmModal.classList.remove('is-visible');
    queueConfirmModal.hidden = true;

    if (queueConfirmResolver) {
        const resolver = queueConfirmResolver;
        queueConfirmResolver = null;
        resolver(confirmed);
    }
};

const openQueueConfirmModal = (title: string, message: string): Promise<boolean> => {
    if (queueConfirmResolver) {
        queueConfirmResolver(false);
        queueConfirmResolver = null;
    }

    queueConfirmTitle.textContent = title;
    queueConfirmMessage.textContent = message;
    queueConfirmModal.hidden = false;
    window.requestAnimationFrame(() => {
        queueConfirmModal.classList.add('is-visible');
    });

    return new Promise<boolean>((resolve) => {
        queueConfirmResolver = resolve;
    });
};

const resolveSidebarQueueTrackIndexesForAction = async (
    actionLabel: string,
    selection: SidebarQueueSelectionContext,
): Promise<number[]> => {
    if (selection.trackIndexesScopedToSelection) {
        return selection.trackIndexes;
    }

    if (!selection.folderTarget) {
        return selection.trackIndexes;
    }

    const descendantCount = await GetLibraryFolderTrackCount(selection.folderPath) as number;
    if (!Number.isFinite(descendantCount) || descendantCount <= 0) {
        return [];
    }

    if (descendantCount > sidebarQueueDescendantPromptThreshold) {
        const formattedDescendantCount = descendantCount.toLocaleString('en-US');
        const folderLabel = selection.folderLabel || selection.folderPath;
        const shouldProceed = await openQueueConfirmModal(
            `${actionLabel} ${formattedDescendantCount} tracks?`,
            `${actionLabel} for "${folderLabel}" requires scanning ${formattedDescendantCount} descendant files and may significantly reduce performance. Continue?`,
        );
        if (!shouldProceed) {
            return [];
        }
    }

    const trackPaths = await GetLibraryFolderTrackPaths(selection.folderPath) as string[];
    return trackPaths
        .map((trackPath) => ensureTrackIndexForPath(trackPath))
        .filter((trackIndex) => trackIndex >= 0);
};

const cleanSidebarQueueSelectionLabel = (label: string): string => {
    return label.replace(/^[▸▾•]\s*/u, '').trim();
};

const playlistTargetMessageForSelection = (
    selection: SidebarQueueSelectionContext,
    trackIndexes: number[],
): string => {
    const formattedCount = trackIndexes.length.toLocaleString('en-US');
    if (selection.folderTarget) {
        const folderLabel = cleanSidebarQueueSelectionLabel(selection.folderLabel) || selection.folderPath || 'this folder';
        const trackLabel = trackIndexes.length === 1 ? '1 track' : `${formattedCount} tracks`;
        return `Add ${trackLabel} from "${folderLabel}" to:`;
    }

    if (trackIndexes.length === 1) {
        const track = tracks[trackIndexes[0]];
        const trackLabel = track?.displayTitle || track?.name || 'this track';
        return `Add "${trackLabel}" to:`;
    }

    return `Add ${formattedCount} tracks to:`;
};

const addSidebarSelectionToPlaylist = async (selection: SidebarQueueSelectionContext): Promise<void> => {
    const actionLabel = 'Add to playlist';
    const trackIndexes = await resolveSidebarQueueTrackIndexesForAction(actionLabel, selection);
    if (trackIndexes.length === 0) {
        return;
    }

    const playlistPath = await playlistTargetModalController.prompt({
        title: actionLabel,
        message: playlistTargetMessageForSelection(selection, trackIndexes),
        confirmLabel: actionLabel,
        getPlaylists: () => playlistController.getAvailablePlaylistTargets(),
        onOpenPlaylist: () => playlistController.openPlaylistTarget(),
        onCreatePlaylist: () => playlistController.createPlaylistTarget(),
        emptyStateMessage: 'No playlists are available yet. Open one or create one below.',
    });
    if (!playlistPath) {
        return;
    }

    const appended = await playlistController.appendTracksToPlaylist(playlistPath, trackIndexes);
    if (!appended) {
        openErrorModal('Add to playlist failed', 'Silphium could not append the selected items to that playlist.');
    }
};

const playSidebarQueueSelection = async (trackIndexes: number[]): Promise<void> => {
    const [firstTrackIndex, ...remainingTrackIndexes] = trackIndexes.filter((trackIndex) => (
        Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < tracks.length
    ));

    if (!Number.isInteger(firstTrackIndex)) {
        return;
    }

    if (fullLibraryScanLoadActive) {
        suppressAutoSelectAfterFullLibraryScan = true;
    }

    playlistController.activatePlaybackQueueSource();

    if (remainingTrackIndexes.length > 0) {
        playlistController.addToQueueNext(remainingTrackIndexes);
    }

    await loadTrack(firstTrackIndex, true, trackIndexes, true);
    if (remainingTrackIndexes.length > 0) {
        await queueGaplessNextTrack(undefined, trackIndexes);
    }
    await playCurrentTrack();
};

const isDropWithinSidebarBrowser = (clientX: number, clientY: number): boolean => {
    const dropTarget = document.elementFromPoint(clientX, clientY);
    return dropTarget !== null && libraryBrowser.contains(dropTarget);
};

const resolveDroppedLibraryFolderPath = async (path: string): Promise<string> => {
    const normalizedPath = path.trim();
    if (normalizedPath === '') {
        return '';
    }

    return (await ResolveLibraryFolderForPath(normalizedPath) as string).trim();
};

const playDroppedLibraryFolder = async (folderPath: string): Promise<boolean> => {
    const normalizedFolderPath = folderPath.trim();
    if (normalizedFolderPath === '') {
        return false;
    }

    const trackPaths = await GetLibraryFolderTrackPaths(normalizedFolderPath) as string[];
    const trackIndexes = trackPaths
        .map((trackPath) => ensureTrackIndexForPath(trackPath))
        .filter((trackIndex) => trackIndex >= 0);

    if (trackIndexes.length === 0) {
        return false;
    }

    libraryController.setSidebarAutoFolderPath(normalizedFolderPath);
    await playSidebarQueueSelection(trackIndexes);
    return true;
};

const playDroppedTrackPath = async (path: string): Promise<boolean> => {
    const normalizedPath = path.trim();
    if (normalizedPath === '') {
        return false;
    }

    const resolvedFolderPath = await resolveDroppedLibraryFolderPath(normalizedPath);
    if (resolvedFolderPath === '') {
        return false;
    }

    const trackIndex = ensureTrackIndexForPath(normalizedPath);
    if (trackIndex < 0) {
        return false;
    }

    await playSidebarQueueSelection([trackIndex]);
    return true;
};

const handleDroppedFolderPath = async (clientX: number, clientY: number, droppedPath: string): Promise<boolean> => {
    const resolvedFolderPath = await resolveDroppedLibraryFolderPath(droppedPath);
    if (resolvedFolderPath === '') {
        return false;
    }

    if (isDropWithinSidebarBrowser(clientX, clientY)) {
        libraryController.setSidebarAutoFolderPath(resolvedFolderPath);
        navigateSidebarToFolder(resolvedFolderPath);
        return true;
    }

    return await playDroppedLibraryFolder(resolvedFolderPath);
};

const submitSidebarQueueFeedback = async (trackIndex: number | null, score: ListenBrainzFeedbackScore): Promise<void> => {
    if (trackIndex === null) {
        return;
    }

    const track = tracks[trackIndex];
    if (!track) {
        return;
    }

    await trackMetadataService.ensureTrackTagsResolved(trackIndex);
    const latestTrack = tracks[trackIndex];
    const recordingMbid = latestTrack ? (latestTrack.mbIds.recordingId || '').trim() : '';
    if (recordingMbid === '') {
        openErrorModal('Missing MusicBrainz Recording ID', 'This track does not have a recording MBID, so Love/Hate cannot be submitted. Tag the file using MusicBrainz Picard first.');
        return;
    }

    await submitListenBrainzFeedbackForTrack(trackIndex, score);
};

type TrackMetaCopyAction = 'none' | 'file' | 'folder';

const openTrackMetaMenu = (
    clientX: number,
    clientY: number,
    includeFolderAction: boolean,
    copyAction: TrackMetaCopyAction,
): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    closePlayOrderMenu();
    closeListenBrainzFeedbackMenu();
    trackMetaCopyFilePathBtn.hidden = copyAction !== 'file';
    trackMetaCopyFolderPathBtn.hidden = copyAction !== 'folder';
    trackMetaCopyDivider.hidden = copyAction === 'none';
    trackMetaParentFolderBtn.hidden = !includeFolderAction;
    trackMetaBrowserFolderBtn.hidden = !includeFolderAction;
    trackMetaMenu.hidden = false;

    const margin = 10;
    const rect = trackMetaMenu.getBoundingClientRect();
    const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
    const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

    trackMetaMenu.style.left = `${Math.max(margin, clampedX)}px`;
    trackMetaMenu.style.top = `${Math.max(margin, clampedY)}px`;
};

const navigateSidebarToFolder = (nextFolderPath: string): void => {
    libraryController.navigateToFolder(nextFolderPath);
};

const openCurrentTrackFolderInSidebar = (): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const targetFolderPath = tracks[currentTrackIndex].folderPath || '';
    libraryController.setSidebarAutoFolderPath(targetFolderPath);

    if (!libraryController.isSidebarOpen()) {
        libraryController.setSidebarOpen(true);
        return;
    }

    navigateSidebarToFolder(targetFolderPath);
};

const openCurrentTrackFolderInFileBrowser = async (): Promise<void> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const trackPath = tracks[currentTrackIndex].path || '';
    if (trackPath === '') {
        return;
    }

    try {
        await OpenFolderInFileBrowser(trackPath);
    } catch (error) {
        console.error(error);
    }
};

const copyCurrentTrackFilePath = async (): Promise<void> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const trackPath = (tracks[currentTrackIndex].path || '').trim();
    if (trackPath === '') {
        return;
    }

    try {
        await ClipboardSetText(trackPath);
    } catch (error) {
        console.error(error);
    }
};

const copyCurrentTrackFolderPath = async (): Promise<void> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const folderPath = (tracks[currentTrackIndex].folderPath || '').trim();
    if (folderPath === '') {
        return;
    }

    try {
        await ClipboardSetText(folderPath);
    } catch (error) {
        console.error(error);
    }
};

const clearSharePreviewSnapshot = (): void => {
    if (sharePreviewSnapshot?.coverImage) {
        sharePreviewSnapshot.coverImage.close();
    }

    sharePreviewSnapshot = null;
};

const clearSharePreviewCanvas = (message = 'Generating preview...'): void => {
    const context = sharePreview.getContext('2d');
    if (!context) {
        return;
    }

    context.clearRect(0, 0, sharePreview.width, sharePreview.height);
    context.fillStyle = '#12151d';
    context.fillRect(0, 0, sharePreview.width, sharePreview.height);
    context.fillStyle = 'rgba(255, 255, 255, 0.72)';
    context.font = '600 20px "Nunito", "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, sharePreview.width / 2, sharePreview.height / 2);
};

const setShareActionsDisabled = (disabled: boolean): void => {
    shareSave.disabled = disabled;
    shareCopy.disabled = disabled;
};

const setShareStatus = (message: string, tone: '' | 'success' | 'error' = ''): void => {
    shareStatus.textContent = message;
    if (tone) {
        shareStatus.dataset.tone = tone;
        return;
    }

    delete shareStatus.dataset.tone;
};

const buildShareImageDefaultFilename = (artist: string, album: string, title: string): string => {
    const sanitizeSegment = (value: string): string => value
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const parts = [sanitizeSegment(artist), sanitizeSegment(album), sanitizeSegment(title)].filter((part) => part !== '');
    const joined = parts.join(' - ');
    const fallback = joined || 'silphium-share';
    return `${fallback.slice(0, 120)}.png`;
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Unable to read share image data'));
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                reject(new Error('Unexpected share image encoding result'));
                return;
            }

            const commaIndex = reader.result.indexOf(',');
            resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
        };
        reader.readAsDataURL(blob);
    });
};

const renderSharePreviewSnapshot = (): void => {
    if (!sharePreviewSnapshot) {
        return;
    }

    renderShareImagePreview(sharePreview, {
        title: sharePreviewSnapshot.title,
        album: sharePreviewSnapshot.album,
        artist: sharePreviewSnapshot.artist,
        comment: shareCommentInput.value,
        coverImage: sharePreviewSnapshot.coverImage,
    });
};

const resolveShareCoverSource = async (track: Track): Promise<string | undefined> => {
    const currentTrack = currentTrackIndex >= 0 && currentTrackIndex < tracks.length ? tracks[currentTrackIndex] : undefined;
    if (currentTrack && currentTrack.path === track.path && coverArt.classList.contains('is-visible') && coverArt.src) {
        return coverArt.src;
    }

    const resolved = await resolveCoverForTrack(track);
    return coverArtService.getCachedMediaArtwork(track)?.src || resolved;
};

const closeShareModal = (): void => {
    sharePreviewRequestVersion += 1;
    shareModal.classList.remove('is-visible');

    if (shareModalHideTimer !== undefined) {
        window.clearTimeout(shareModalHideTimer);
    }

    shareModalHideTimer = window.setTimeout(() => {
        clearSharePreviewSnapshot();
        clearSharePreviewCanvas('Share current track');
        shareModal.hidden = true;
        shareModalHideTimer = undefined;
    }, shareModalTransitionMs);
};

const openShareModal = async (): Promise<void> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    closePlayOrderMenu();
    closeTrackMetaMenu();
    closeListenBrainzFeedbackMenu();
    closeSidebarQueueMenu();
    playlistController.closeMenu();

    if (shareModalHideTimer !== undefined) {
        window.clearTimeout(shareModalHideTimer);
        shareModalHideTimer = undefined;
    }

    const selectedTrack = tracks[currentTrackIndex];
    const requestVersion = ++sharePreviewRequestVersion;
    clearSharePreviewSnapshot();
    shareCommentInput.value = defaultShareImageComment;
    clearSharePreviewCanvas();
    setShareStatus('Generating preview...');
    setShareActionsDisabled(true);
    shareDialog.scrollTop = 0;
    shareModal.hidden = false;
    window.requestAnimationFrame(() => {
        shareModal.classList.add('is-visible');
        shareCommentInput.focus({ preventScroll: true });
        shareCommentInput.setSelectionRange(shareCommentInput.value.length, shareCommentInput.value.length);
    });

    try {
        const selectedTrackPath = selectedTrack.path;
        try {
            await ensureTrackTagsResolved(currentTrackIndex);
        } catch (error) {
            console.error(error);
        }

        const resolvedIndex = trackIndexForPath(selectedTrackPath);
        const track = resolvedIndex >= 0 && resolvedIndex < tracks.length ? tracks[resolvedIndex] : selectedTrack;
        const coverSource = await resolveShareCoverSource(track);
        const coverImage = await loadShareCanvasImage(coverSource);
        if (requestVersion !== sharePreviewRequestVersion) {
            coverImage?.close();
            return;
        }

        sharePreviewSnapshot = {
            title: track.displayTitle || track.title || track.name || 'Unknown Title',
            album: track.displayAlbum || 'Unknown Album',
            artist: track.displayArtist || 'Unknown Artist',
            trackPath: track.path,
            coverImage,
        };
        renderSharePreviewSnapshot();
        setShareStatus('');
    } catch (error) {
        console.error(error);
        clearSharePreviewSnapshot();
        clearSharePreviewCanvas('Unable to render preview');
        setShareStatus('Unable to generate share preview.', 'error');
    } finally {
        if (requestVersion === sharePreviewRequestVersion) {
            setShareActionsDisabled(false);
        }
    }
};

const saveSharePreview = async (): Promise<void> => {
    if (!sharePreviewSnapshot) {
        return;
    }

    setShareActionsDisabled(true);
    setShareStatus('Saving image...');

    try {
        const blob = await canvasToPngBlob(sharePreview);
        const targetPath = await SelectShareImageSaveFile(buildShareImageDefaultFilename(
            sharePreviewSnapshot.artist,
            sharePreviewSnapshot.album,
            sharePreviewSnapshot.title,
        ));
        if (targetPath === '') {
            setShareStatus('');
            return;
        }

        const saved = await SaveShareImageFile(targetPath, await blobToBase64(blob));
        if (!saved) {
            setShareStatus('Unable to save the share image.', 'error');
            return;
        }

        setShareStatus('Saved image.', 'success');
    } catch (error) {
        console.error(error);
        setShareStatus('Unable to save the share image.', 'error');
    } finally {
        setShareActionsDisabled(false);
    }
};

const copySharePreview = async (): Promise<void> => {
    if (!sharePreviewSnapshot) {
        return;
    }

    setShareActionsDisabled(true);
    setShareStatus('Copying image...');

    try {
        const blob = await canvasToPngBlob(sharePreview);
        const clipboard = navigator.clipboard as Clipboard & { write?: (items: unknown[]) => Promise<void> };
        const clipboardItemCtor = (window as Window & {
            ClipboardItem?: new (items: Record<string, Blob>) => unknown;
        }).ClipboardItem;

        if (!clipboard.write || !clipboardItemCtor) {
            throw new Error('Clipboard image copy is not available in this environment');
        }

        await clipboard.write([new clipboardItemCtor({ 'image/png': blob })]);
        setShareStatus('Copied image to clipboard.', 'success');
    } catch (error) {
        console.error(error);
        setShareStatus('Unable to copy the share image.', 'error');
    } finally {
        setShareActionsDisabled(false);
    }
};

const updatePlayOrderMenuState = (): void => {
    const playbackOrderMode = playbackSequencingService.getPlaybackOrderMode();
    const items = playOrderMenu.querySelectorAll('.play-order-item');
    items.forEach((item) => {
        if (!(item instanceof HTMLButtonElement)) {
            return;
        }

        const mode = item.dataset.playOrder as PlaybackOrderMode | undefined;
        const selected = mode === playbackOrderMode;
        item.setAttribute('aria-checked', selected ? 'true' : 'false');
        item.dataset.selected = selected ? 'true' : 'false';
    });

    playPause.title = `Playback order: ${playbackSequencingService.getPlaybackOrderLabel()} (right-click to change)`;
};

const openPlayOrderMenu = (clientX: number, clientY: number): void => {
    closeTrackMetaMenu();
    closeListenBrainzFeedbackMenu();
    updatePlayOrderMenuState();
    playOrderMenu.hidden = false;

    const margin = 10;
    const rect = playOrderMenu.getBoundingClientRect();
    const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
    const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

    playOrderMenu.style.left = `${Math.max(margin, clampedX)}px`;
    playOrderMenu.style.top = `${Math.max(margin, clampedY)}px`;
};

const resetArtistInfoPanel = (): void => {
    artistInfoController.reset();
};

const hydrateCurrentArtistInfo = async (index: number): Promise<void> => {
    await artistInfoController.hydrate(index);
};

const setBackgroundCover = (coverSrc?: string): void => {
    const incomingLayer = activeBackgroundLayer === 0 ? bgLayerB : bgLayerA;
    const outgoingLayer = activeBackgroundLayer === 0 ? bgLayerA : bgLayerB;

    if (!coverSrc) {
        bgLayerA.classList.remove('is-visible');
        bgLayerB.classList.remove('is-visible');
        bgLayerA.style.backgroundImage = '';
        bgLayerB.style.backgroundImage = '';
        return;
    }

    incomingLayer.style.backgroundImage = `url("${coverSrc}")`;
    incomingLayer.classList.add('is-visible');
    outgoingLayer.classList.remove('is-visible');
    activeBackgroundLayer = activeBackgroundLayer === 0 ? 1 : 0;
};

const hydrateCurrentTrackTag = async (index: number, version: number): Promise<void> => {
    const result = await trackMetadataService.hydrateTrack(index, version);
    if (index !== currentTrackIndex) {
        return;
    }

    if (result.updatedTags || result.updatedMusicBrainz) {
        refreshNowPlayingLabel();
        libraryController.renderFolder('none');
        await applyCoverArtForTrack(index);
    }

    if (result.updatedTags) {
        artistInfoRequestVersion += 1;
        void hydrateCurrentArtistInfo(index);
    }
};

const closeTextFileModal = (): void => {
    textFileModal.hidden = true;
    textFileCode.textContent = '';
};

const releaseRootPathForTrack = (track: Track): string => {
    const normalizedFolderPath = track.folderPath || '';
    const segments = normalizedFolderPath
        .split('/')
        .filter((segment) => segment !== '');

    if (segments.length === 0) {
        return '';
    }

    const releaseDepth = releaseDepthForTrack(track);
    const relativeSegments = track.rootName ? segments.slice(1) : segments;
    if (releaseDepth <= 0 || relativeSegments.length === 0 || releaseDepth >= relativeSegments.length) {
        return normalizedFolderPath;
    }

    const scopedSegments = track.rootName
        ? [segments[0], ...relativeSegments.slice(0, releaseDepth)]
        : relativeSegments.slice(0, releaseDepth);

    return scopedSegments.join('/');
};

const replayGainReleaseKeyForTrack = (track: Track): string => {
    const releaseRootPath = releaseRootPathForTrack(track).trim().toLowerCase();
    if (!releaseRootPath) {
        return '';
    }

    return `${libraryFolderPathKey(track.rootPath || '')}::${releaseRootPath}`;
};

const replayGainReleaseTrackPaths = (releaseKey: string): string[] => tracks
    .filter((candidate) => replayGainReleaseKeyForTrack(candidate) === releaseKey)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, {
        sensitivity: 'base',
        numeric: true,
    }))
    .map((candidate) => candidate.path);

const normalizeReplayGainSequenceIndexes = (indexes: number[]): number[] => {
    const normalized: number[] = [];
    const seen = new Set<number>();
    for (const index of indexes) {
        if (!Number.isInteger(index) || index < 0 || index >= tracks.length || seen.has(index)) {
            continue;
        }

        seen.add(index);
        normalized.push(index);
    }

    return normalized;
};

const playbackSequenceIndexesForReplayGain = (sequenceOverrideIndexes?: number[]): number[] => {
    if (Array.isArray(sequenceOverrideIndexes) && sequenceOverrideIndexes.length > 0) {
        return normalizeReplayGainSequenceIndexes(sequenceOverrideIndexes);
    }

    const sequenceOverride = playlistController?.getSequenceOverride();
    if (sequenceOverride && sequenceOverride.indexes.length > 0) {
        return normalizeReplayGainSequenceIndexes(sequenceOverride.indexes);
    }

    return normalizeReplayGainSequenceIndexes(baseSequenceIndexes().indexes);
};

const collectReplayGainReleaseTrackPathsForIndex = (trackIndex: number, sequenceOverrideIndexes?: number[]): string[] => {
    const track = tracks[trackIndex];
    if (!track) {
        return [];
    }

    const releaseKey = replayGainReleaseKeyForTrack(track);
    if (!releaseKey) {
        return [];
    }

    const sequenceIndexes = playbackSequenceIndexesForReplayGain(sequenceOverrideIndexes);
    const sequencePosition = sequenceIndexes.indexOf(trackIndex);
    if (sequencePosition < 0) {
        return [];
    }

    let rangeStart = sequencePosition;
    while (rangeStart > 0) {
        const previousTrack = tracks[sequenceIndexes[rangeStart - 1]];
        if (!previousTrack || replayGainReleaseKeyForTrack(previousTrack) !== releaseKey) {
            break;
        }

        rangeStart -= 1;
    }

    let rangeEnd = sequencePosition;
    while (rangeEnd < sequenceIndexes.length - 1) {
        const nextTrack = tracks[sequenceIndexes[rangeEnd + 1]];
        if (!nextTrack || replayGainReleaseKeyForTrack(nextTrack) !== releaseKey) {
            break;
        }

        rangeEnd += 1;
    }

    if (rangeStart === rangeEnd) {
        return [];
    }

    const releasePaths = replayGainReleaseTrackPaths(releaseKey);
    if (releasePaths.length <= 1) {
        return [];
    }

    const queuedReleaseTrackCount = rangeEnd - rangeStart + 1;
    if (queuedReleaseTrackCount !== releasePaths.length) {
        return [];
    }

    return releasePaths;
};

const currentReplayGainReleaseTrackPaths = (sequenceOverrideIndexes?: number[]): string[] => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return [];
    }

    const activeTrackPath = trackPathKey(tracks[currentTrackIndex]?.path || '');
    if (
        activeReplayGainReleaseTrackPaths.length > 1
        && activeTrackPath !== ''
        && activeReplayGainReleaseTrackPaths.some((path) => trackPathKey(path) === activeTrackPath)
    ) {
        return activeReplayGainReleaseTrackPaths;
    }

    return collectReplayGainReleaseTrackPathsForIndex(currentTrackIndex, sequenceOverrideIndexes);
};

const replayGainReleaseDynamicRangeCacheKey = (releasePaths: string[]): string => releasePaths
    .map((path) => path.trim().toLowerCase())
    .filter((path) => path !== '')
    .join('\n');

const refreshReplayGainReleaseDynamicRangeIndicator = async (): Promise<void> => {
    const requestVersion = ++replayGainReleaseDynamicRangeRequestVersion;
    if (!currentSettings.audio.replayGainEnabled || currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        updateNowPlayingTechnicalLabels();
        return;
    }

    const releasePaths = currentReplayGainReleaseTrackPaths();
    if (releasePaths.length <= 1) {
        updateNowPlayingTechnicalLabels();
        return;
    }

    const cacheKey = replayGainReleaseDynamicRangeCacheKey(releasePaths);
    if (replayGainReleaseDynamicRangeLabelByKey.has(cacheKey)) {
        updateNowPlayingTechnicalLabels();
        return;
    }

    let pendingLookup = replayGainReleaseDynamicRangePendingByKey.get(cacheKey);
    if (!pendingLookup) {
        pendingLookup = AudioGetReplayGainReleaseDynamicRange(releasePaths)
            .then((dynamicRange) => {
                const label = Number.isInteger(dynamicRange) && dynamicRange > 0 ? `DR${dynamicRange}` : '';
                replayGainReleaseDynamicRangeLabelByKey.set(cacheKey, label);
                replayGainReleaseDynamicRangePendingByKey.delete(cacheKey);
                return label;
            })
            .catch((error: unknown) => {
                console.debug(error);
                replayGainReleaseDynamicRangeLabelByKey.set(cacheKey, '');
                replayGainReleaseDynamicRangePendingByKey.delete(cacheKey);
                return '';
            });
        replayGainReleaseDynamicRangePendingByKey.set(cacheKey, pendingLookup);
    }

    await pendingLookup;
    if (requestVersion !== replayGainReleaseDynamicRangeRequestVersion) {
        return;
    }

    const latestReleasePaths = currentSettings.audio.replayGainEnabled && currentTrackIndex >= 0 && currentTrackIndex < tracks.length
        ? currentReplayGainReleaseTrackPaths()
        : [];
    if (replayGainReleaseDynamicRangeCacheKey(latestReleasePaths) !== cacheKey) {
        return;
    }

    updateNowPlayingTechnicalLabels();
};

const collectReleaseImageFiles = (track: Track): ImageLibraryFile[] => {
    const releaseRootPath = releaseRootPathForTrack(track);
    const releaseRootPathLower = releaseRootPath.toLowerCase();
    const prefix = releaseRootPathLower ? `${releaseRootPathLower}/` : '';
    const trackRootPathKey = libraryFolderPathKey(track.rootPath || '');

    return imageFiles
        .filter((candidate) => {
            if (libraryFolderPathKey(candidate.rootPath || '') !== trackRootPathKey) {
                return false;
            }

            const candidateFolderPath = (candidate.folderPath || '').toLowerCase();
            if (!releaseRootPathLower) {
                return candidateFolderPath === '';
            }

            return candidateFolderPath === releaseRootPathLower || candidateFolderPath.startsWith(prefix);
        })
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, {
            sensitivity: 'base',
            numeric: true,
        }));
};

const indexOfImageByPath = (gallery: ImageLibraryFile[], candidatePath?: string): number => {
    if (!candidatePath) {
        return -1;
    }

    const normalizedPath = candidatePath.toLowerCase();
    return gallery.findIndex((candidate) => candidate.path.toLowerCase() === normalizedPath);
};

const openTextFileModal = async (textFile: TextLibraryFile): Promise<void> => {
    textFileTitle.textContent = textFile.relativePath || textFile.name;
    textFileCode.textContent = 'Loading…';
    textFileModal.hidden = false;

    try {
        const content = await ReadTextFile(textFile.path);
        textFileCode.textContent = content || 'File is empty.';
    } catch (error) {
        console.error(error);
        textFileCode.textContent = 'Unable to read this file.';
    }
};

const openCoverImageModal = (): void => {
    if (!coverArt.classList.contains('is-visible') || !coverArt.src) {
        return;
    }

    const activeTrack = tracks[currentTrackIndex];
    if (!activeTrack) {
        imageModalController.openPreview(coverArt.src, coverArt.src);
        return;
    }

    const source = coverArtService.getResolvedSourceForTrack(activeTrack.path);
    if (source === 'musicbrainz') {
        imageModalController.openPreview(
            coverArt.src,
            coverArtService.getMusicBrainzCoverUrlForTrack(activeTrack) || coverArt.src,
        );
        return;
    }

    if (source === 'embedded') {
        imageModalController.openPreview(coverArt.src, activeTrack.path || coverArt.src);
        return;
    }

    const gallery = collectReleaseImageFiles(activeTrack);
    if (gallery.length === 0) {
        imageModalController.openPreview(coverArt.src, coverArt.src);
        return;
    }

    const coverPath = coverArtService.getFolderCoverPath(activeTrack.folderPath || '');
    const selectedIndex = indexOfImageByPath(gallery, coverPath);
    void imageModalController.openGallery(gallery, selectedIndex >= 0 ? selectedIndex : 0);
};

const closeAboutModal = (): void => {
    aboutModal.classList.remove('is-visible');

    if (aboutModalHideTimer !== undefined) {
        window.clearTimeout(aboutModalHideTimer);
    }

    aboutModalHideTimer = window.setTimeout(() => {
        aboutModal.hidden = true;
        aboutModalHideTimer = undefined;
    }, aboutModalTransitionMs);
};

const openAboutModal = (): void => {
    if (aboutModalHideTimer !== undefined) {
        window.clearTimeout(aboutModalHideTimer);
        aboutModalHideTimer = undefined;
    }

    aboutModal.hidden = false;
    window.requestAnimationFrame(() => {
        aboutModal.classList.add('is-visible');
    });
};

const closeErrorModal = (): void => {
    errorModal.classList.remove('is-visible');

    if (errorModalHideTimer !== undefined) {
        window.clearTimeout(errorModalHideTimer);
    }

    errorModalHideTimer = window.setTimeout(() => {
        errorModal.hidden = true;
        errorModalHideTimer = undefined;
    }, errorModalTransitionMs);
};

const openErrorModal = (title: string, message: string): void => {
    if (errorModalHideTimer !== undefined) {
        window.clearTimeout(errorModalHideTimer);
        errorModalHideTimer = undefined;
    }

    errorTitle.textContent = title.trim() || 'Error';
    errorModalMessage.textContent = message.trim() || 'An unexpected error occurred.';
    errorModal.hidden = false;
    window.requestAnimationFrame(() => {
        errorModal.classList.add('is-visible');
    });
};


const closeMusicBrainzEntityModal = (): void => {
    musicBrainzEntityModal.classList.remove('is-visible');

    if (musicBrainzEntityModalHideTimer !== undefined) {
        window.clearTimeout(musicBrainzEntityModalHideTimer);
    }

    musicBrainzEntityModalHideTimer = window.setTimeout(() => {
        musicBrainzEntityModal.hidden = true;
        musicBrainzEntityModalHideTimer = undefined;
    }, musicBrainzEntityModalTransitionMs);
};

const animateMusicBrainzDialogResize = (updateContent: () => void): void => {
    const modalVisible = !musicBrainzEntityModal.hidden && musicBrainzEntityModal.classList.contains('is-visible');
    if (!modalVisible) {
        updateContent();
        return;
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startRect = musicBrainzEntityDialog.getBoundingClientRect();
    const startWidth = Math.ceil(startRect.width);
    const startHeight = Math.ceil(startRect.height);

    updateContent();

    musicBrainzEntityDialog.style.width = '';
    musicBrainzEntityDialog.style.height = '';

    const targetRect = musicBrainzEntityDialog.getBoundingClientRect();
    const targetWidth = Math.ceil(targetRect.width);
    const targetHeight = Math.ceil(targetRect.height);
    if (
        prefersReducedMotion
        || startWidth <= 0
        || startHeight <= 0
        || targetWidth <= 0
        || targetHeight <= 0
        || (Math.abs(targetWidth - startWidth) < 2 && Math.abs(targetHeight - startHeight) < 2)
    ) {
        return;
    }

    const targetContentWidth = Math.ceil(musicBrainzEntityContent.getBoundingClientRect().width);
    musicBrainzEntityDialog.classList.add('is-resizing');
    musicBrainzEntityContent.style.width = `${targetContentWidth}px`;
    musicBrainzEntityDialog.style.width = `${startWidth}px`;
    musicBrainzEntityDialog.style.height = `${startHeight}px`;
    void musicBrainzEntityDialog.offsetWidth;
    musicBrainzEntityDialog.style.width = `${targetWidth}px`;
    musicBrainzEntityDialog.style.height = `${targetHeight}px`;

    let cleanupTimer: number | undefined;
    const cleanup = (): void => {
        if (cleanupTimer !== undefined) {
            window.clearTimeout(cleanupTimer);
            cleanupTimer = undefined;
        }

        musicBrainzEntityDialog.removeEventListener('transitionend', handleTransitionEnd);
        musicBrainzEntityDialog.classList.remove('is-resizing');
        musicBrainzEntityDialog.style.width = '';
        musicBrainzEntityDialog.style.height = '';
        musicBrainzEntityContent.style.width = '';
    };

    const handleTransitionEnd = (event: TransitionEvent): void => {
        if (event.target !== musicBrainzEntityDialog) {
            return;
        }

        if (event.propertyName !== 'width' && event.propertyName !== 'height') {
            return;
        }

        cleanup();
    };

    musicBrainzEntityDialog.addEventListener('transitionend', handleTransitionEnd);
    cleanupTimer = window.setTimeout(cleanup, musicBrainzEntityModalTransitionMs + 120);
};

const openMusicBrainzEntityForCurrentTrack = async (entityType: MusicBrainzEntityType): Promise<void> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const selectedTrackIndex = currentTrackIndex;
    await ensureTrackTagsResolved(selectedTrackIndex);

    if (selectedTrackIndex < 0 || selectedTrackIndex >= tracks.length) {
        return;
    }

    const mbid = mbidForTrackEntity(tracks[selectedTrackIndex], entityType).trim();
    if (!mbid) {
        return;
    }

    if (musicBrainzEntityModalHideTimer !== undefined) {
        window.clearTimeout(musicBrainzEntityModalHideTimer);
        musicBrainzEntityModalHideTimer = undefined;
    }

    musicBrainzEntityDialog.style.width = '';
    musicBrainzEntityDialog.style.height = '';
    musicBrainzEntityTitle.textContent = `MusicBrainz ${entityType} info`;
    musicBrainzEntityContent.innerHTML = '<p class="mb-entity-empty">Loading from MusicBrainz...</p>';
    musicBrainzEntityModal.hidden = false;
    window.requestAnimationFrame(() => {
        musicBrainzEntityModal.classList.add('is-visible');
    });

    const entityInfo = await lookupMusicBrainzEntity(entityType, mbid);
    if (!entityInfo.found) {
        animateMusicBrainzDialogResize(() => {
            musicBrainzEntityContent.innerHTML = '<p class="mb-entity-empty">No details found for this MusicBrainz ID.</p>';
        });
        return;
    }

    animateMusicBrainzDialogResize(() => {
        renderMusicBrainzEntityContent(entityInfo, musicBrainzEntityTitle, musicBrainzEntityContent);
    });
};

const closeTechnicalInfoModal = (): void => {
    technicalInfoModal.classList.remove('is-visible');

    if (technicalInfoModalHideTimer !== undefined) {
        window.clearTimeout(technicalInfoModalHideTimer);
    }

    technicalInfoModalHideTimer = window.setTimeout(() => {
        technicalInfoModal.hidden = true;
        technicalInfoModalHideTimer = undefined;
    }, technicalInfoModalTransitionMs);
};

const openTechnicalInfoModal = async (): Promise<void> => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    if (technicalInfoModalHideTimer !== undefined) {
        window.clearTimeout(technicalInfoModalHideTimer);
        technicalInfoModalHideTimer = undefined;
    }

    const selectedTrackIndex = currentTrackIndex;
    technicalInfoTitle.textContent = 'Technical info';
    technicalInfoContent.innerHTML = '<p class="technical-info-empty">Loading technical information...</p>';
    technicalInfoModal.hidden = false;
    window.requestAnimationFrame(() => {
        technicalInfoModal.classList.add('is-visible');
    });

    await ensureTrackTagsResolved(selectedTrackIndex);

    if (selectedTrackIndex >= tracks.length) {
        return;
    }

    renderTechnicalInfoContent(technicalInfoContent, tracks[selectedTrackIndex]);
};

const clearLibrarySelection = async (): Promise<void> => {
    closeSidebarQueueMenu();
    closeListenBrainzFeedbackMenu();
    closeMusicBrainzEntityModal();
    closeTechnicalInfoModal();
    clearReplayGainReleaseDynamicRangeCache();

    try {
        const nextState = await AudioStop() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }

    objectUrls = clearLibraryRuntimeData({
        objectUrls,
        clearCoverArtCache: () => {
            coverArtService.clearCache();
        },
        clearArtistInfoCache: () => {
            artistInfoController.clearCache();
        },
        clearImageModalCache: () => {
            imageModalController.clearCachedDataUrls();
        },
        resetLibraryState: () => {
            libraryController.resetLibraryState();
        },
        resetPlaylistState: () => {
            playlistController.resetState();
        },
    });

    tracks = [];
    textFiles = [];
    imageFiles = [];
    trackIndexByPath.clear();
    textFileIndexByPath.clear();
    imageFileIndexByPath.clear();

    currentTrackIndex = -1;
    scrobbleService.reset();
    resetShuffleHistory();

    trackTitle.textContent = 'Unknown Title';
    trackAlbum.textContent = 'Unknown Album';
    trackPosition.textContent = '';
    trackArtist.textContent = 'Unknown Artist';
    setTechnicalLabel(trackTechnical, '');
    trackTechnical.disabled = true;
    setTechnicalLabel(trackTechnicalAlt, '');
    trackTechnicalAlt.disabled = true;
    trackArtistHeader.textContent = '';
    trackReleaseAlbum.textContent = '';
    trackReleaseLabel.textContent = '';
    trackReleaseCat.textContent = '';
    trackReleaseYear.textContent = '';
    trackTitleInline.textContent = '';
    trackPositionInline.textContent = '';
    trackGenreInline.textContent = '';
    lyricsContent.textContent = '';
    playerLane.classList.remove('lyrics-visible');
    lyricsPanel.setAttribute('aria-hidden', 'true');
    applyMbLinks(trackTitle, trackAlbum, trackArtist, {});
    applyMbLinks(trackTitleInline, trackReleaseAlbum, trackArtistHeader, {});
    updateExplorationButton(document, undefined);
    resetListenBrainzFeedbackState();

    coverArt.removeAttribute('src');
    coverArtBackground.removeAttribute('src');
    coverArtBackground.classList.remove('is-visible');
    coverArt.classList.remove('is-visible');
    setBackgroundCover();
    setCoverFlipped(false);
    resetArtistInfoPanel();
    libraryController.renderFolder('none');
    updateMediaSessionMetadata();
};

const updateLibraryLoadingEtaFromProgress = (progress: LibraryScanProgress): void => {
    libraryController.setLibraryLoadingStatusLabel('');
    const clientTailSeconds = libraryClientFinalizeEstimateMs > 0
        ? Math.max(1, Math.ceil(libraryClientFinalizeEstimateMs / 1000))
        : 0;

    if (!progress || !Number.isFinite(progress.etaSeconds)) {
        const fallbackEtaSeconds = clientTailSeconds > 0 ? clientTailSeconds : null;
        libraryController.setLibraryLoadingEtaSeconds(fallbackEtaSeconds);
        settingsController.setForceReloadEtaSeconds(fallbackEtaSeconds);
        return;
    }

    const backendSeconds = Math.max(0, Math.ceil(progress.etaSeconds));
    const blendedEtaSeconds = backendSeconds + clientTailSeconds;
    const nextEtaSeconds = blendedEtaSeconds > 0 ? blendedEtaSeconds : null;
    libraryController.setLibraryLoadingEtaSeconds(nextEtaSeconds);
    settingsController.setForceReloadEtaSeconds(nextEtaSeconds);
};

const hasConfiguredLibraryFolders = (): boolean => currentSettings.libraryFolders.length > 0;

const scanConfiguredLibraryFolders = async (): Promise<void> => {
    if (!hasConfiguredLibraryFolders()) {
        await clearLibrarySelection();
        return;
    }

    fullLibraryScanLoadActive = true;
    suppressAutoSelectAfterFullLibraryScan = false;
    beginLibraryLoadTracking();
    libraryController.setLibraryLoading(true);
    libraryController.setLibraryLoadingEtaSeconds(null);
    libraryController.setLibraryLoadingStatusLabel('');
    try {
        libraryController.setLibraryPathMessage(currentSettings.libraryFolders.length > 1 ? 'Scanning library folders…' : 'Scanning folder…');
        const scanResult = await ScanConfiguredLibraryFolders() as LibraryScanResult;
        markLibraryScanResolved();
        if (libraryClientFinalizeEstimateMs > 0) {
            const finalizeEtaSeconds = Math.max(1, Math.ceil(libraryClientFinalizeEstimateMs / 1000));
            libraryController.setLibraryLoadingEtaSeconds(finalizeEtaSeconds);
            settingsController.setForceReloadEtaSeconds(finalizeEtaSeconds);
        }
        await loadLibraryScan(scanResult);
    } finally {
        finishLibraryLoadTracking();
        libraryController.setLibraryLoading(false);
        fullLibraryScanLoadActive = false;
        suppressAutoSelectAfterFullLibraryScan = false;
    }
};

const handleLibraryScanUpdatedEvent = (scanResult: LibraryScanResult): void => {
    const startTime = performance.now();
    logRescan('handleLibraryScanUpdatedEvent START: %d tracks, %d text, %d images',
        scanResult.trackCount, scanResult.textFileCount, scanResult.imageFileCount);

    if (!hasConfiguredLibraryFolders()) {
        return;
    }

    if (!scanResult) {
        return;
    }

    const previousRootName = libraryController.getLibraryRootName().trim();
    const nextRootName = selectedLibraryRootLabel;
    if (!previousRootName || previousRootName !== nextRootName) {
        libraryController.setCurrentFolderPath('');
    }

    libraryController.setLibraryRootName(nextRootName);
    libraryController.setLibraryIndexTruncated(!!scanResult.truncated);

    // For incremental updates, refresh the visible folder with a short debounce to
    // avoid rapid re-renders that interfere with pointer interactions.
    scheduleLibraryIncrementalFolderRefresh();
    scheduleNowPlayingCoverRefresh();
    logRescan('handleLibraryScanUpdatedEvent END: took %.2fms', performance.now() - startTime);
};

const initializeSettings = async (): Promise<void> => {
    applyPlayerCardLayout(getStoredLayout());
    resetListenBrainzFeedbackState();

    try {
        await refreshAvailableAudioOutputDevices();

        const settings = await GetSettings() as AppSettings;
        currentSettings = normalizeAppSettings(settings);
        lissajousVisualizerController.setEnabled(currentSettings.lissajousEnabled);
        listenBrainzSocialController.handleSettingsChanged();
        currentMusicBrainzTagWorkerProgress = normalizeMusicBrainzTagWorkerProgress(
            await GetMusicBrainzTagWorkerProgress() as MusicBrainzTagWorkerProgress,
        );
        settingsController.setMusicBrainzTagWorkerProgress(currentMusicBrainzTagWorkerProgress);
        setPlaybackOrderMode(currentSettings.playbackOrder);
        await completeStartupIfReady();
        return;
    } catch (error) {
        console.error(error);
    }

    libraryController.renderFolder('none');
    void refreshListenBrainzFeedbackForCurrentTrack(true);
};

const refreshAvailableAudioOutputDevices = async (): Promise<AudioOutputDevice[]> => {
    const outputDevices = await AudioListOutputDevices() as AudioOutputDevice[];
    availableAudioOutputDevices = Array.isArray(outputDevices) ? outputDevices : [];
    return availableAudioOutputDevices;
};

const initializeAppVersion = async (): Promise<void> => {
    try {
        const version = (await GetAppVersion()).trim();
        aboutVersion.textContent = `${version || 'dev'}`;
    } catch (error) {
        console.error(error);
        aboutVersion.textContent = 'dev';
    }
};

const resolveCoverForTrack = async (track: Track): Promise<string | undefined> => await coverArtService.resolveForTrack(track);

const loadTrack = async (
    index: number,
    allowMissingTrackRecovery = true,
    replayGainSequenceOverrideIndexes?: number[],
    manualTrackSelection = false,
): Promise<void> => {
    if (index < 0 || index >= tracks.length) {
        return;
    }

    gaplessQueueRequestVersion += 1;
    queuedGaplessTrackPath = '';
    if (manualTrackSelection && playbackSequencingService.getPlaybackOrderMode() === 'shuffle-library') {
        // Manual jumps in Shuffle: Library should restart from a freshly randomized queue.
        playlistController.activatePlaybackQueueSource();
        resetShuffleHistory();
    }

    currentTrackIndex = index;
    playlistController.scheduleRender();
    setCoverFlipped(false);
    const track = tracks[currentTrackIndex];
    scrobbleService.startTrackSession(track.path);

    if (currentSettings.preferMusicBrainzMetadata) {
        track.mbMetadataResolved = false;
    }

    if (!libraryController.isSidebarOpen()) {
        libraryController.setSidebarAutoFolderPath(track.folderPath);
    }

    logPlaybackDebug(`LoadTrack request index=${index} path="${track.path}" recovery=${allowMissingTrackRecovery}`);

    try {
        const replayGainReleaseTrackPaths = collectReplayGainReleaseTrackPathsForIndex(index, replayGainSequenceOverrideIndexes);
        const nextState = replayGainReleaseTrackPaths.length > 1
            ? await AudioLoadTrackWithReplayGainContext(track.path, replayGainReleaseTrackPaths) as AudioPlaybackState
            : await AudioLoadTrack(track.path) as AudioPlaybackState;
        setActiveReplayGainReleaseTrackPaths(replayGainReleaseTrackPaths);
        logPlaybackDebug(`LoadTrack success ${formatPlaybackStateForLog(nextState)}`);
        applyPlaybackState(nextState);
    } catch (error) {
        logPlaybackDebug(`LoadTrack failed path="${track.path}" error=${describeErrorForLog(error)}`);
        if (allowMissingTrackRecovery && isMissingTrackLoadError(error) && hasConfiguredLibraryFolders()) {
            const failedTrackPath = track.path.toLowerCase();
            const failedRelativePath = track.relativePath.toLowerCase();
            const failedName = track.name.toLowerCase();

            beginLibraryLoadTracking();
            libraryController.setLibraryLoading(true);
            libraryController.setLibraryLoadingEtaSeconds(null);
            libraryController.setLibraryLoadingStatusLabel('');
            try {
                libraryController.setLibraryPathMessage('Track missing. Rescanning library…');
                const scanResult = await ScanConfiguredLibraryFolders() as LibraryScanResult;
                markLibraryScanResolved();
                if (libraryClientFinalizeEstimateMs > 0) {
                    libraryController.setLibraryLoadingEtaSeconds(Math.max(1, Math.ceil(libraryClientFinalizeEstimateMs / 1000)));
                }
                await loadLibraryScan(scanResult, { autoSelectStartingTrack: false });

                let recoveredIndex = tracks.findIndex((candidate) => candidate.path.toLowerCase() === failedTrackPath);
                if (recoveredIndex < 0) {
                    recoveredIndex = tracks.findIndex((candidate) => candidate.relativePath.toLowerCase() === failedRelativePath);
                }
                if (recoveredIndex < 0) {
                    recoveredIndex = tracks.findIndex((candidate) => candidate.name.toLowerCase() === failedName);
                }

                if (recoveredIndex >= 0) {
                    await loadTrack(recoveredIndex, false, replayGainSequenceOverrideIndexes, manualTrackSelection);
                    return;
                }
            } catch (rescanError) {
                console.error(rescanError);
            } finally {
                finishLibraryLoadTracking();
                libraryController.setLibraryLoading(false);
            }
        }

        handleAudioError(error);
        return;
    }

    refreshNowPlayingLabel();
    await applyCoverArtForTrack(index);

    updateMediaSessionMetadata();

    libraryController.renderFolder('none');

    tagRequestVersion += 1;
    void hydrateCurrentTrackTag(index, tagRequestVersion);

    artistInfoRequestVersion += 1;
    void hydrateCurrentArtistInfo(index);
};

const playCurrentTrack = async (): Promise<void> => {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        await loadTrack(0);
    }

    if (currentTrackIndex === -1 || !playbackStateService.isBackendReady()) {
        logPlaybackDebug(`Play skipped currentTrackIndex=${currentTrackIndex} backendReady=${playbackStateService.isBackendReady()}`);
        return;
    }

    if (await shouldSkipLoadedTrack()) {
        logPlaybackDebug(`Play redirected due to silent-track heuristic currentIndex=${currentTrackIndex}`);
        goToTrack(1);
        return;
    }

    playbackMutationVersion += 1;
    logPlaybackDebug(`Play request index=${currentTrackIndex} path="${tracks[currentTrackIndex]?.path || ''}"`);
    try {
        const nextState = await AudioPlay() as AudioPlaybackState;
        logPlaybackDebug(`Play success ${formatPlaybackStateForLog(nextState)}`);
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }
};

const pauseCurrentTrack = async (): Promise<void> => {
    if (!playbackStateService.isBackendReady()) {
        logPlaybackDebug('Pause skipped because backend is not ready');
        return;
    }

    playbackMutationVersion += 1;
    logPlaybackDebug(`Pause request index=${currentTrackIndex} path="${tracks[currentTrackIndex]?.path || ''}"`);
    try {
        const nextState = await AudioPause() as AudioPlaybackState;
        logPlaybackDebug(`Pause success ${formatPlaybackStateForLog(nextState)}`);
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }
};

const toggleCurrentTrack = async (): Promise<void> => {
    if (!playbackStateService.isBackendReady() || playPauseToggleInFlight) {
        logPlaybackDebug(`Toggle skipped backendReady=${playbackStateService.isBackendReady()} inFlight=${playPauseToggleInFlight}`);
        return;
    }

    playPauseToggleInFlight = true;
    try {
        const playbackState = playbackStateService.getPlaybackState();
        logPlaybackDebug(`Toggle request ${formatPlaybackStateForLog(playbackState)}`);
        if (playbackState.playing) {
            await pauseCurrentTrack();
            return;
        }

        await playCurrentTrack();
    } finally {
        playPauseToggleInFlight = false;
    }
};

const goToTrackInternal = async (direction: -1 | 1): Promise<void> => {
    if (tracks.length === 0) {
        logPlaybackDebug(`GoToTrack skipped direction=${direction} because there are no tracks`);
        return;
    }

    logPlaybackDebug(`GoToTrack start direction=${direction} currentIndex=${currentTrackIndex}`);
    const playbackState = playbackStateService.getPlaybackState();
    if (playbackState.loaded && playbackState.playing) {
        await pauseCurrentTrack();
    }

    for (let attempt = 0; attempt < tracks.length; attempt += 1) {
        const nextIndex = nextTrackIndexForDirection(direction);
        if (nextIndex === undefined) {
            logPlaybackDebug(`GoToTrack direction=${direction} found no next index on attempt=${attempt}`);
            return;
        }

        logPlaybackDebug(`GoToTrack candidate direction=${direction} nextIndex=${nextIndex} path="${tracks[nextIndex]?.path || ''}" attempt=${attempt}`);

        await loadTrack(nextIndex);
        if (!(await shouldSkipLoadedTrack())) {
            await playCurrentTrack();
            return;
        }
    }

    await playCurrentTrack();
};

const goToTrack = (direction: -1 | 1): void => {
    trackNavigationChain = trackNavigationChain
        .then(() => goToTrackInternal(direction))
        .catch((error) => {
            console.error(error);
        });
};

const stopCurrentTrack = async (): Promise<void> => {
    if (!playbackStateService.isBackendReady()) {
        return;
    }

    gaplessQueueRequestVersion += 1;
    queuedGaplessTrackPath = '';
    try {
        const nextState = await AudioStop() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }
};

const mediaSessionController = createMediaSessionController({
    getPlaybackState: () => playbackStateService.getPlaybackState(),
    getCurrentTrack: () => (currentTrackIndex >= 0 && currentTrackIndex < tracks.length ? tracks[currentTrackIndex] : undefined),
    getCachedArtwork: (track: Track) => coverArtService.getCachedMediaArtwork(track),
    getCoverArtPreview: () => ({
        visible: coverArt.classList.contains('is-visible'),
        src: coverArt.src,
    }),
    playCurrentTrack,
    pauseCurrentTrack,
    toggleCurrentTrack,
    goToTrack,
    stopCurrentTrack,
    seekToTime: async (targetSeconds: number): Promise<void> => {
        if (!playbackStateService.isBackendReady()) {
            return;
        }

        try {
            const nextState = await AudioSeek(targetSeconds) as AudioPlaybackState;
            applyPlaybackState(nextState);
        } catch (error) {
            handleAudioError(error);
        }
    },
});
const updateMediaSessionMetadata = (): void => {
    mediaSessionController.updateMetadata();
};
const updateMediaSessionPlaybackState = (): void => {
    mediaSessionController.updatePlaybackState();
};
const updateMediaSessionPositionState = (): void => {
    mediaSessionController.updatePositionState();
};
const dispatchExternalPlaybackAction = (action: ExternalPlaybackAction): void => {
    mediaSessionController.dispatchExternalPlaybackAction(action);
};
const initializeMediaSessionIntegration = (): void => {
    mediaSessionController.initialize();
};
const unlockMediaSessionAnchorFromUserGesture = (): void => {
    mediaSessionController.unlockFromUserGesture();
};
const handleFocusedHardwareMediaKey = (event: KeyboardEvent): boolean => mediaSessionController.handleHardwareMediaKey(event);

let hideToTrayOnMinimizeInFlight = false;
let hideToTrayRetryTimer: number | undefined;
const hideToTrayRetryDelayMs = 60;
const hideToTrayMaxRetries = 5;

const clearHideToTrayRetryTimer = (): void => {
    if (hideToTrayRetryTimer === undefined) {
        return;
    }

    window.clearTimeout(hideToTrayRetryTimer);
    hideToTrayRetryTimer = undefined;
};

const hideToTrayWhenMinimized = async (remainingRetries = hideToTrayMaxRetries): Promise<void> => {
    if (!currentSettings.minimizeToTrayOnClose || hideToTrayOnMinimizeInFlight) {
        clearHideToTrayRetryTimer();
        return;
    }

    hideToTrayOnMinimizeInFlight = true;
    try {
        const isMinimized = await WindowIsMinimised();
        if (!isMinimized) {
            if (remainingRetries > 0) {
                clearHideToTrayRetryTimer();
                hideToTrayRetryTimer = window.setTimeout(() => {
                    hideToTrayRetryTimer = undefined;
                    void hideToTrayWhenMinimized(remainingRetries - 1);
                }, hideToTrayRetryDelayMs);
            }
            return;
        }

        clearHideToTrayRetryTimer();
        WindowHide();
    } catch (error) {
        console.debug(error);
    } finally {
        hideToTrayOnMinimizeInFlight = false;
    }
};

const nonTypingInputTypes = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
]);

const isTypingFieldElement = (element: Element | null): boolean => {
    if (!element) {
        return false;
    }

    if (element instanceof HTMLTextAreaElement) {
        return true;
    }

    if (element instanceof HTMLInputElement) {
        const inputType = (element.type || 'text').toLowerCase();
        return !nonTypingInputTypes.has(inputType);
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
        return true;
    }

    const role = element.getAttribute('role');
    return role === 'textbox' || role === 'searchbox';
};

const shouldSuppressFocusedShortcut = (event: KeyboardEvent): boolean => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (isTypingFieldElement(eventTarget)) {
        return true;
    }

    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
    return activeElement !== eventTarget && isTypingFieldElement(activeElement);
};

const handleFocusedKeyboardShortcut = (event: KeyboardEvent): boolean => {
    if (event.repeat || shouldSuppressFocusedShortcut(event)) {
        return false;
    }

    const eventBinding = formatShortcutBindingFromKeyboardEvent(event);
    if (!eventBinding) {
        return false;
    }

    const shortcuts = currentSettings.keyboardShortcuts;
    if (eventBinding === shortcuts.focusLibraryFilter) {
        if (!libraryController.isSidebarOpen()) {
            libraryController.setSidebarOpen(true);
        }

        listenBrainzSocialController.showLibrary();

        window.requestAnimationFrame(() => {
            librarySearch.focus();
        });
        return true;
    }

    if (eventBinding === shortcuts.openSettings) {
        settingsController.open();
        return true;
    }

    if (eventBinding === shortcuts.playPauseToggle) {
        dispatchExternalPlaybackAction('playpause');
        return true;
    }

    if (eventBinding === shortcuts.nextTrack) {
        dispatchExternalPlaybackAction('next');
        return true;
    }

    if (eventBinding === shortcuts.previousTrack) {
        dispatchExternalPlaybackAction('previous');
        return true;
    }

    if (eventBinding === shortcuts.stopPlayback) {
        dispatchExternalPlaybackAction('stop');
        return true;
    }

    return false;
};

const focusedShortcutBindingsUseCode = (code: string): boolean => {
    const shortcuts = currentSettings.keyboardShortcuts;
    return shortcutBindingUsesCode(shortcuts.playPauseToggle, code)
        || shortcutBindingUsesCode(shortcuts.nextTrack, code)
        || shortcutBindingUsesCode(shortcuts.previousTrack, code)
        || shortcutBindingUsesCode(shortcuts.stopPlayback, code)
        || shortcutBindingUsesCode(shortcuts.focusLibraryFilter, code)
        || shortcutBindingUsesCode(shortcuts.openSettings, code);
};

const setPlaybackOrderMode = (nextMode: PlaybackOrderMode): void => {
    const changed = playbackSequencingService.setPlaybackOrderMode(nextMode);
    if (!changed) {
        return;
    }

    currentSettings.playbackOrder = nextMode;
    playlistController.clearEditableQueue();
    updatePlayOrderMenuState();
};

const savePlaybackOrderSetting = async (): Promise<void> => {
    try {
        const primaryLibraryFolder = currentSettings.libraryFolders[0];
        const savedSettings = await SaveSettings(WailsModels.AppSettings.createFrom({
            libraryFolders: currentSettings.libraryFolders,
            libraryPath: currentSettings.libraryPath,
            ffmpegPath: currentSettings.ffmpegPath,
            listenBrainzUserToken: currentSettings.listenBrainzUserToken,
            lastFmApiKey: currentSettings.lastFmApiKey,
            lastFmApiSecret: currentSettings.lastFmApiSecret,
            lastFmSessionKey: currentSettings.lastFmSessionKey,
            musicBrainzServerUrl: currentSettings.musicBrainzServerUrl,
            musicBrainzRequestRateMs: currentSettings.musicBrainzRequestRateMs,
            listenBrainzServerUrl: currentSettings.listenBrainzServerUrl,
            listenBrainzRequestRateMs: currentSettings.listenBrainzRequestRateMs,
            playbackOrder: playbackSequencingService.getPlaybackOrderMode(),
            releaseDepth: primaryLibraryFolder?.releaseDepth || 0,
            favoritePlaylists: currentSettings.favoritePlaylists,
            coverArtPriority: currentSettings.coverArtPriority,
            audio: currentSettings.audio,
            preferMusicBrainzMetadata: currentSettings.preferMusicBrainzMetadata,
            musicBrainzTagDatabaseEnabled: currentSettings.musicBrainzTagDatabaseEnabled,
            musicBrainzTagStaleDays: currentSettings.musicBrainzTagStaleDays,
            musicBrainzTagRequestStaggeringEnabled: currentSettings.musicBrainzTagRequestStaggeringEnabled,
            musicBrainzTagWorkerCores: currentSettings.musicBrainzTagWorkerCores,
            lissajousEnabled: currentSettings.lissajousEnabled,
            minimizeToTrayOnClose: currentSettings.minimizeToTrayOnClose,
            keyboardShortcuts: currentSettings.keyboardShortcuts,
        })) as AppSettings;

        currentSettings = normalizeAppSettings(savedSettings);
        lissajousVisualizerController.setEnabled(currentSettings.lissajousEnabled);
        setPlaybackOrderMode(currentSettings.playbackOrder);
    } catch (error) {
        console.error(error);
    }
};

const loadPlaylistData = async (playlistPath: string): Promise<LoadedPlaylistData | null> => {
    const loaded = await LoadPlaylistFile(playlistPath) as PlaylistLoadResult;
    const mergeResult = await mergePlaylistFilesIntoTracks(tracks, loaded.trackFiles || []);
    tracks = mergeResult.tracks;
    rebuildTrackPathIndex();

    return {
        name: loaded.name || '',
        trackIndexes: mergeResult.trackIndexes,
    };
};

const hasCompleteLibraryPayload = (scanResult: LibraryScanResult): boolean => {
    const trackCount = Math.max(scanResult.trackCount || 0, (scanResult.trackFiles || []).length);
    const textFileCount = Math.max(scanResult.textFileCount || 0, (scanResult.textFiles || []).length);
    const imageFileCount = Math.max(scanResult.imageFileCount || 0, (scanResult.imageFiles || []).length);

    return (scanResult.trackFiles || []).length >= trackCount
        && (scanResult.textFiles || []).length >= textFileCount
        && (scanResult.imageFiles || []).length >= imageFileCount;
};

const loadPagedScanCollections = async (scanResult: LibraryScanResult) => {
    if (hasCompleteLibraryPayload(scanResult)) {
        return await mapLibraryScanResult(scanResult);
    }

    const scanCollections = createScanCollections(scanResult);
    const totalTrackCount = Math.max(scanResult.trackCount || 0, (scanResult.trackFiles || []).length);
    const totalTextFileCount = Math.max(scanResult.textFileCount || 0, (scanResult.textFiles || []).length);
    const totalImageFileCount = Math.max(scanResult.imageFileCount || 0, (scanResult.imageFiles || []).length);
    const totalFileCount = totalTrackCount + totalTextFileCount + totalImageFileCount;
    let loadedFileCount = 0;
    const transferStartedAtMs = performance.now();

    const updateTransferEta = (): void => {
        if (totalFileCount <= 0 || loadedFileCount <= 0) {
            return;
        }

        const elapsedTransferMs = Math.max(1, performance.now() - transferStartedAtMs);
        const measuredRemainingMs = loadedFileCount < totalFileCount
            ? Math.max(0, (elapsedTransferMs / loadedFileCount) * (totalFileCount - loadedFileCount))
            : 0;

        let historicalRemainingMs = 0;
        if (activeLibraryLoadScanResolvedAtMs !== null && libraryClientFinalizeEstimateMs > 0) {
            historicalRemainingMs = Math.max(0, libraryClientFinalizeEstimateMs - (performance.now() - activeLibraryLoadScanResolvedAtMs));
        }

        const remainingMs = Math.max(measuredRemainingMs, historicalRemainingMs);
        if (remainingMs <= 0) {
            return;
        }

        libraryController.setLibraryLoadingEtaSeconds(Math.max(1, Math.ceil(remainingMs / 1000)));
    };

    const pageKinds = [
        { kind: 'track' as const, totalEntries: totalTrackCount },
        { kind: 'text-file' as const, totalEntries: totalTextFileCount },
        { kind: 'image-file' as const, totalEntries: totalImageFileCount },
    ];

    for (const pageKind of pageKinds) {
        for (let offset = 0; offset < pageKind.totalEntries; offset += libraryIndexedFilePageSize) {
            const page = await GetLibraryIndexedFilePage(pageKind.kind, offset, libraryIndexedFilePageSize) as LibraryIndexedFilePage;
            const entries = page.entries || [];
            await appendIndexedFilesToScanCollections(scanCollections, pageKind.kind, entries);
            loadedFileCount += entries.length;
            updateTransferEta();
        }
    }

    libraryController.setLibraryLoadingStatusLabel('');
    return scanCollections;
};

const loadLibraryScan = async (scanResult: LibraryScanResult, options?: { autoSelectStartingTrack?: boolean; preserveFolderView?: boolean; currentFolderPath?: string }): Promise<void> => {
    const startTime = performance.now();
    logRescan('loadLibraryScan START: preserveFolderView=%s, %d tracks, %d text, %d images',
        options?.preserveFolderView || false, scanResult.trackCount, scanResult.textFileCount, scanResult.imageFileCount);

    if (!scanResult) {
        return;
    }

    let stepTime = performance.now();
    closeSidebarQueueMenu();
    closeMusicBrainzEntityModal();
    closeTechnicalInfoModal();
    clearReplayGainReleaseDynamicRangeCache();
    logRescan('  - closed modals: %.2fms', performance.now() - stepTime);

    const playbackStateBeforeScanSwap = playbackStateService.getPlaybackState();
    const preserveManualTrackPlayback = suppressAutoSelectAfterFullLibraryScan
        && playbackStateBeforeScanSwap.loaded
        && playbackStateBeforeScanSwap.sourcePath.trim() !== '';
    const previouslyPlayingTrack = preserveManualTrackPlayback && currentTrackIndex >= 0 && currentTrackIndex < tracks.length
        ? tracks[currentTrackIndex]
        : null;

    if (!preserveManualTrackPlayback) {
        try {
            stepTime = performance.now();
            const nextState = await AudioStop() as AudioPlaybackState;
            applyPlaybackState(nextState);
            logRescan('  - audio stop: %.2fms', performance.now() - stepTime);
        } catch (error) {
            handleAudioError(error);
        }
    } else {
        logRescan('  - preserving manual playback during scan swap');
    }

    stepTime = performance.now();
    const scanCollections = await loadPagedScanCollections(scanResult);
    logRescan('  - loaded paged collections: %.2fms', performance.now() - stepTime);

    const previousRootName = libraryController.getLibraryRootName().trim();
    const nextRootName = selectedLibraryRootLabel;
    const canPreserveExistingFolderView = previousRootName !== '' && previousRootName === nextRootName;
    const folderPathBeforeSwap = canPreserveExistingFolderView
        ? libraryController.getCurrentFolderPath()
        : '';
    const searchStateBeforeSwap = canPreserveExistingFolderView
        ? libraryController.getLibrarySearchStateSnapshot()
        : null;
    const shouldRestoreSearchState = (searchStateBeforeSwap?.query || '').trim() !== '';

    // Keep previous library UI usable while pages are being loaded, then swap in one step.
    stepTime = performance.now();
    objectUrls = clearLibraryRuntimeData({
        objectUrls,
        clearCoverArtCache: () => {
            coverArtService.clearCache();
        },
        clearArtistInfoCache: () => {
            artistInfoController.clearCache();
        },
        resetLibraryState: () => {
            libraryController.resetLibraryState();
        },
        resetPlaylistState: () => {
            playlistController.resetState();
        },
    });
    logRescan('  - cleared runtime data: %.2fms', performance.now() - stepTime);

    stepTime = performance.now();
    tracks = scanCollections.tracks;
    textFiles = scanCollections.textFiles;
    imageFiles = scanCollections.imageFiles;
    rebuildTrackPathIndex();
    rebuildTextFilePathIndex();
    rebuildImageFilePathIndex();

    if (preserveManualTrackPlayback) {
        const normalizedSourcePath = playbackStateBeforeScanSwap.sourcePath.trim().toLowerCase();
        currentTrackIndex = normalizedSourcePath
            ? tracks.findIndex((candidate) => candidate.path.toLowerCase() === normalizedSourcePath)
            : -1;

        if (currentTrackIndex >= 0) {
            if (previouslyPlayingTrack && previouslyPlayingTrack.path.toLowerCase() === tracks[currentTrackIndex].path.toLowerCase()) {
                tracks[currentTrackIndex] = {
                    ...tracks[currentTrackIndex],
                    title: previouslyPlayingTrack.title,
                    displayTitle: previouslyPlayingTrack.displayTitle,
                    displayAlbum: previouslyPlayingTrack.displayAlbum,
                    displayArtist: previouslyPlayingTrack.displayArtist,
                    displayTrackNumber: previouslyPlayingTrack.displayTrackNumber,
                    displayTrackTotal: previouslyPlayingTrack.displayTrackTotal,
                    displayTechnical: previouslyPlayingTrack.displayTechnical,
                    displayLyrics: previouslyPlayingTrack.displayLyrics,
                    tagsResolved: previouslyPlayingTrack.tagsResolved,
                    mbMetadataResolved: previouslyPlayingTrack.mbMetadataResolved,
                    technicalDetails: { ...previouslyPlayingTrack.technicalDetails },
                    allFileTags: { ...previouslyPlayingTrack.allFileTags },
                    mbIds: { ...previouslyPlayingTrack.mbIds },
                    artistMbids: [...previouslyPlayingTrack.artistMbids],
                    mbArtistCredits: [...previouslyPlayingTrack.mbArtistCredits],
                };
            }

            refreshNowPlayingLabel();
        }
    }

    logRescan('  - updated indices: %.2fms', performance.now() - stepTime);

    stepTime = performance.now();
    for (const [folder, coverPath] of scanCollections.coverPathEntries) {
        coverArtService.setFolderCoverPath(folder, coverPath);
    }
    logRescan('  - set cover paths: %.2fms', performance.now() - stepTime);

    stepTime = performance.now();
    await libraryController.rebuildLibraryTree(
        selectedLibraryRootLabel,
        scanResult.truncated,
        tracks,
        textFiles,
        imageFiles,
    );
    logRescan('  - rebuilt library tree: %.2fms', performance.now() - stepTime);

    if (tracks.length === 0) {
        logRescan('loadLibraryScan: no tracks found');
        closeListenBrainzFeedbackMenu();
        currentTrackIndex = -1;
        libraryController.setCurrentFolderPath('');
        trackTitle.textContent = 'No audio tracks found';
        trackAlbum.textContent = 'Unknown Album';
        trackPosition.textContent = '';
        trackArtist.textContent = 'Unknown Artist';
        setTechnicalLabel(trackTechnical, '');
        trackTechnical.disabled = true;
        setTechnicalLabel(trackTechnicalAlt, '');
        trackTechnicalAlt.disabled = true;
        trackArtistHeader.textContent = '';
        trackReleaseAlbum.textContent = '';
        trackReleaseLabel.textContent = '';
    trackReleaseCat.textContent = '';
        trackReleaseYear.textContent = '';
        trackTitleInline.textContent = '';
        trackGenreInline.textContent = '';
        lyricsContent.textContent = '';
        playerLane.classList.remove('lyrics-visible');
        lyricsPanel.setAttribute('aria-hidden', 'true');
        coverArt.removeAttribute('src');
        coverArtBackground.removeAttribute('src');
        coverArtBackground.classList.remove('is-visible');
        coverArt.classList.remove('is-visible');
        setBackgroundCover();
        setCoverFlipped(false);
        resetArtistInfoPanel();
        updateExplorationButton(document, undefined);
        resetListenBrainzFeedbackState();
        if (shouldRestoreSearchState && searchStateBeforeSwap) {
            libraryController.restoreLibrarySearchState(searchStateBeforeSwap);
        } else {
            libraryController.renderFolder('none');
        }
        playlistController.refreshOpenModal();
        logRescan('loadLibraryScan END: total time %.2fms (no tracks)', performance.now() - startTime);
        return;
    }

    if (shouldRestoreSearchState && searchStateBeforeSwap) {
        libraryController.restoreLibrarySearchState(searchStateBeforeSwap);
    } else {
        const preferredFolderPath = options?.currentFolderPath ?? folderPathBeforeSwap;
        if (preferredFolderPath) {
            libraryController.navigateToFolder(preferredFolderPath);
        } else {
            libraryController.setCurrentFolderPath('');
            libraryController.renderFolder('none');
        }
    }

    if (!options?.preserveFolderView) {
        resetShuffleHistory();

        const playbackStateAfterScanSwap = playbackStateService.getPlaybackState();
        const hasActivePlaybackAfterScanSwap = playbackStateAfterScanSwap.loaded
            && playbackStateAfterScanSwap.playing
            && playbackStateAfterScanSwap.sourcePath.trim() !== '';

        if (options?.autoSelectStartingTrack !== false && !suppressAutoSelectAfterFullLibraryScan && !hasActivePlaybackAfterScanSwap) {
            const startingTrackIndex = libraryController.firstTrackIndexFromRandomAlbumFolder();
            void loadTrack(startingTrackIndex);
        }
    }

    updatePlayButton();
    playlistController.refreshOpenModal();
    logRescan('loadLibraryScan END: total time %.2fms', performance.now() - startTime);
};

settingsController = createSettingsController({
    trigger: librarySettings,
    elements: settingsElements,
    isWindows: isWindowsRuntime,
    getValues: () => ({
        libraryFolders: currentSettings.libraryFolders,
        ffmpegPath: currentSettings.ffmpegPath,
        listenBrainzUserToken: currentSettings.listenBrainzUserToken,
        lastFmApiKey: currentSettings.lastFmApiKey,
        lastFmApiSecret: currentSettings.lastFmApiSecret,
        lastFmSessionKey: currentSettings.lastFmSessionKey,
        scrobbleFilterMode: currentSettings.scrobbleFilterMode,
        scrobbleRules: currentSettings.scrobbleRules,
        musicBrainzServerUrl: currentSettings.musicBrainzServerUrl,
        musicBrainzRequestRateMs: currentSettings.musicBrainzRequestRateMs,
        listenBrainzServerUrl: currentSettings.listenBrainzServerUrl,
        listenBrainzRequestRateMs: currentSettings.listenBrainzRequestRateMs,
        favoritePlaylists: currentSettings.favoritePlaylists,
        coverArtPriority: currentSettings.coverArtPriority,
        audioOutputDevice: currentSettings.audio.outputDevice,
        audioOutputBufferMs: currentSettings.audio.outputBufferMs,
        gaplessPlayback: currentSettings.audio.gaplessPlayback,
        replayGainEnabled: currentSettings.audio.replayGainEnabled,
        audioOutputDevices: availableAudioOutputDevices,
        preferMusicBrainzMetadata: currentSettings.preferMusicBrainzMetadata,
        musicBrainzTagDatabaseEnabled: currentSettings.musicBrainzTagDatabaseEnabled,
        musicBrainzTagStaleDays: currentSettings.musicBrainzTagStaleDays,
        musicBrainzTagRequestStaggeringEnabled: currentSettings.musicBrainzTagRequestStaggeringEnabled,
        musicBrainzTagWorkerCores: currentSettings.musicBrainzTagWorkerCores,
        lissajousEnabled: currentSettings.lissajousEnabled,
        minimizeToTrayOnClose: currentSettings.minimizeToTrayOnClose,
        musicBrainzTagWorkerProgress: currentMusicBrainzTagWorkerProgress,
        keyboardShortcuts: currentSettings.keyboardShortcuts,
    }),
    selectLibraryFolder: SelectLibraryFolder,
    selectPlaylistFile: SelectPlaylistFile,
    save: async ({
        libraryFolders: requestedLibraryFolders,
        ffmpegPath,
        listenBrainzUserToken,
        lastFmApiKey,
        lastFmApiSecret,
        lastFmSessionKey,
        scrobbleFilterMode,
        scrobbleRules,
        musicBrainzServerUrl,
        musicBrainzRequestRateMs,
        listenBrainzServerUrl,
        listenBrainzRequestRateMs,
        favoritePlaylists,
        coverArtPriority,
        audioOutputDevice,
        audioOutputBufferMs,
        gaplessPlayback,
        replayGainEnabled,
        preferMusicBrainzMetadata,
        musicBrainzTagDatabaseEnabled,
        musicBrainzTagStaleDays,
        musicBrainzTagRequestStaggeringEnabled,
        musicBrainzTagWorkerCores,
        lissajousEnabled,
        minimizeToTrayOnClose,
        keyboardShortcuts,
    }): Promise<void> => {
        const ffmpegStatus = await validateConfiguredFFmpegPath(ffmpegPath);
        if (!ffmpegStatus.available) {
            throw new Error(missingFFmpegMessage(ffmpegStatus));
        }

        const normalizedLibraryFolders = normalizeLibraryFolders(requestedLibraryFolders);
        const primaryLibraryFolder = normalizedLibraryFolders[0];
        const savedSettings = await SaveSettings(WailsModels.AppSettings.createFrom({
            libraryFolders: normalizedLibraryFolders,
            libraryPath: primaryLibraryFolder?.path || '',
            ffmpegPath,
            listenBrainzUserToken,
            lastFmApiKey,
            lastFmApiSecret,
            lastFmSessionKey,
            scrobbleFilterMode,
            scrobbleRules,
            musicBrainzServerUrl,
            musicBrainzRequestRateMs,
            listenBrainzServerUrl,
            listenBrainzRequestRateMs,
            playbackOrder: playbackSequencingService.getPlaybackOrderMode(),
            releaseDepth: primaryLibraryFolder?.releaseDepth || 0,
            favoritePlaylists,
            coverArtPriority,
            audio: {
                outputDevice: audioOutputDevice,
                outputBufferMs: audioOutputBufferMs,
                gaplessPlayback,
                replayGainEnabled,
            },
            preferMusicBrainzMetadata,
            musicBrainzTagDatabaseEnabled,
            musicBrainzTagStaleDays,
            musicBrainzTagRequestStaggeringEnabled,
            musicBrainzTagWorkerCores,
            lissajousEnabled,
            minimizeToTrayOnClose,
            keyboardShortcuts,
        })) as AppSettings;

        currentSettings = normalizeAppSettings(savedSettings);
        lissajousVisualizerController.setEnabled(currentSettings.lissajousEnabled);
        listenBrainzSocialController.handleSettingsChanged();
        setPlaybackOrderMode(currentSettings.playbackOrder);
        if (currentTrackIndex >= 0 && currentTrackIndex < tracks.length) {
            void applyCoverArtForTrack(currentTrackIndex);
        }

        playlistController.refreshFavorites();

        resetShuffleHistory();

        if (!hasListenBrainzScrobbling()) {
            closeListenBrainzFeedbackMenu();
        }

        gaplessQueueRequestVersion += 1;
        queuedGaplessTrackPath = '';
        refreshNowPlayingLabel();
        if (!currentSettings.audio.gaplessPlayback) {
            if (playbackStateService.isBackendReady()) {
                void AudioQueueNextTrack('', '').catch((error: unknown) => {
                    console.debug(error);
                });
            }
        } else {
            void queueGaplessNextTrack();
        }

        await completeStartupIfReady();
        void refreshListenBrainzFeedbackForCurrentTrack(true);
    },
    fetchLastFmSessionKey: async (apiKey: string, apiSecret: string): Promise<string> => {
        const normalizedApiKey = apiKey.trim();
        const normalizedApiSecret = apiSecret.trim();
        if (normalizedApiKey === '' || normalizedApiSecret === '') {
            throw new Error('Last.fm API key and shared secret are required.');
        }

        const requestToken = await GetLastFmRequestToken(normalizedApiKey, normalizedApiSecret) as string;
        const authorizeUrl = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(normalizedApiKey)}&token=${encodeURIComponent(requestToken)}`;
        await BrowserOpenURL(authorizeUrl);

        const confirmed = await openQueueConfirmModal(
            'Authorize Last.fm',
            'Allow access in your browser, then click Proceed to finish fetching the session key.',
        );
        if (!confirmed) {
            throw new Error('Last.fm authorization was cancelled.');
        }

        return await GetLastFmSessionKey(normalizedApiKey, normalizedApiSecret, requestToken) as string;
    },
    applyAudioNow: async ({
        libraryFolders: requestedLibraryFolders,
        ffmpegPath,
        listenBrainzUserToken,
        lastFmApiKey,
        lastFmApiSecret,
        lastFmSessionKey,
        scrobbleFilterMode,
        scrobbleRules,
        musicBrainzServerUrl,
        musicBrainzRequestRateMs,
        listenBrainzServerUrl,
        listenBrainzRequestRateMs,
        favoritePlaylists,
        coverArtPriority,
        audioOutputDevice,
        audioOutputBufferMs,
        gaplessPlayback,
        replayGainEnabled,
        preferMusicBrainzMetadata,
        musicBrainzTagDatabaseEnabled,
        musicBrainzTagStaleDays,
        musicBrainzTagRequestStaggeringEnabled,
        musicBrainzTagWorkerCores,
        lissajousEnabled,
        minimizeToTrayOnClose,
        keyboardShortcuts,
    }): Promise<AudioOutputDevice[]> => {
        const ffmpegStatus = await validateConfiguredFFmpegPath(ffmpegPath);
        if (!ffmpegStatus.available) {
            throw new Error(missingFFmpegMessage(ffmpegStatus));
        }

        const normalizedLibraryFolders = normalizeLibraryFolders(requestedLibraryFolders);
        const primaryLibraryFolder = normalizedLibraryFolders[0];
        const savedSettings = await SaveSettings(WailsModels.AppSettings.createFrom({
            libraryFolders: normalizedLibraryFolders,
            libraryPath: primaryLibraryFolder?.path || '',
            ffmpegPath,
            listenBrainzUserToken,
            lastFmApiKey,
            lastFmApiSecret,
            lastFmSessionKey,
            scrobbleFilterMode,
            scrobbleRules,
            musicBrainzServerUrl,
            musicBrainzRequestRateMs,
            listenBrainzServerUrl,
            listenBrainzRequestRateMs,
            playbackOrder: playbackSequencingService.getPlaybackOrderMode(),
            releaseDepth: primaryLibraryFolder?.releaseDepth || 0,
            favoritePlaylists,
            coverArtPriority,
            audio: {
                outputDevice: audioOutputDevice,
                outputBufferMs: audioOutputBufferMs,
                gaplessPlayback,
                replayGainEnabled,
            },
            preferMusicBrainzMetadata,
            musicBrainzTagDatabaseEnabled,
            musicBrainzTagStaleDays,
            musicBrainzTagRequestStaggeringEnabled,
            musicBrainzTagWorkerCores,
            lissajousEnabled,
            minimizeToTrayOnClose,
            keyboardShortcuts,
        })) as AppSettings;

        currentSettings = normalizeAppSettings(savedSettings);
        lissajousVisualizerController.setEnabled(currentSettings.lissajousEnabled);
        listenBrainzSocialController.handleSettingsChanged();
        setPlaybackOrderMode(currentSettings.playbackOrder);
        const outputDevices = await refreshAvailableAudioOutputDevices();

        const nextState = await AudioReinitializeBackend() as AudioPlaybackState;
        playbackStateService.setBackendReady(true);
        applyPlaybackState(nextState);
        updatePlayButton();

        gaplessQueueRequestVersion += 1;
        queuedGaplessTrackPath = '';
        refreshNowPlayingLabel();
        if (!currentSettings.audio.gaplessPlayback) {
            if (playbackStateService.isBackendReady()) {
                void AudioQueueNextTrack('', '').catch((error: unknown) => {
                    console.debug(error);
                });
            }
        }

        void refreshListenBrainzFeedbackForCurrentTrack(true);
        return outputDevices;
    },
    forceReload: async (): Promise<void> => {
        await scanConfiguredLibraryFolders();
    },
    beforeClose: async (): Promise<string | null> => {
        if (!ffmpegConfigurationRequired) {
            return null;
        }

        const ffmpegStatus = await validateConfiguredFFmpegPath(currentSettings.ffmpegPath);
        if (ffmpegStatus.available) {
            ffmpegConfigurationRequired = false;
            return null;
        }

        return missingFFmpegMessage(ffmpegStatus);
    },
    onCloseBlocked: (message: string): void => {
        openErrorModal('FFmpeg Required', message);
    },
    getPlayerCardLayout: getStoredLayout,
    setPlayerCardLayout: applyPlayerCardLayout,
});

playlistController = createPlaylistController({
    trigger: playlistBtn,
    menu: playlistMenuElements,
    modal: playlistModalElements,
    getTrack: (index: number) => tracks[index],
    getTrackPath: (index: number) => tracks[index]?.path || '',
    getTrackCount: () => tracks.length,
    getCurrentTrackIndex: () => currentTrackIndex,
    getPlaybackOrderLabel: () => playbackSequencingService.getPlaybackOrderLabel(),
    getBaseSequence: () => baseSequenceIndexes(),
    ensureTrackTagsResolvedBatch,
    selectPlaylistFile: SelectPlaylistFile,
    selectPlaylistSaveFile: SelectPlaylistSaveFile,
    loadPlaylistData,
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => SavePlaylistFile(playlistPath, trackPaths),
    appendTracksToPlaylistData: (playlistPath: string, trackPaths: string[]) => AppendTracksToPlaylistFile(playlistPath, trackPaths),
    getFavoritePlaylists: () => currentSettings.favoritePlaylists,
    onTrackChosen: async (index: number, context): Promise<void> => {
        const manualTrackSelection = context.userInitiated && context.source !== 'queue';
        await loadTrack(index, true, undefined, manualTrackSelection);
        await playCurrentTrack();
    },
    onExternalPlaylistLoaded: () => {
        resetShuffleHistory();
    },
});

playlistTargetModalController = createPlaylistTargetModalController(playlistTargetModalElements);

const preventBrowserFileDropDefault = (event: DragEvent): void => {
    if (!hasExternalFileDragPayload(event.dataTransfer)) {
        return;
    }

    event.preventDefault();
    if (event.dataTransfer && event.type !== 'drop') {
        event.dataTransfer.dropEffect = 'copy';
    }
};

window.addEventListener('dragenter', preventBrowserFileDropDefault, { capture: true, passive: false });
window.addEventListener('dragover', preventBrowserFileDropDefault, { capture: true, passive: false });
window.addEventListener('drop', preventBrowserFileDropDefault, { capture: true, passive: false });
document.addEventListener('dragenter', preventBrowserFileDropDefault, { capture: true, passive: false });
document.addEventListener('dragover', preventBrowserFileDropDefault, { capture: true, passive: false });
document.addEventListener('drop', preventBrowserFileDropDefault, { capture: true, passive: false });

OnFileDrop((x: number, y: number, paths: string[]) => {
    const droppedPaths = (paths || []).map((path) => path.trim()).filter((path) => path !== '');
    if (droppedPaths.length === 0) {
        return;
    }

    const droppedPlaylistPath = droppedPaths.find((path) => /\.(m3u8?|M3U8?)$/.test(path));
    if (droppedPlaylistPath) {
        void playlistController.loadPlaylistByPath(droppedPlaylistPath).catch((error: unknown) => {
            console.error(error);
        });
        return;
    }

    const droppedAudioPath = droppedPaths.find((path) => isSupportedAudioFilePath(path));
    if (droppedAudioPath) {
        void playDroppedTrackPath(droppedAudioPath).catch((error: unknown) => {
            console.error(error);
        });
        return;
    }

    const droppedFolderPath = droppedPaths.find((path) => !/\.(m3u8?|M3U8?)$/.test(path) && !isSupportedAudioFilePath(path));
    if (!droppedFolderPath) {
        return;
    }

    void handleDroppedFolderPath(x, y, droppedFolderPath).catch((error: unknown) => {
        console.error(error);
    });
}, false);

imageModalController = createImageModalController({
    elements: imageModalElements,
    readFileBase64: ReadFileBase64,
    readImageThumbnail: ReadImageThumbnail,
});

artistInfoController = createArtistInfoController({
    elements: {
        artistInfoName,
        artistInfoType,
        artistInfoCountry,
        artistInfoLifeSpan,
        artistInfoGenres,
        artistInfoSummary,
        artistInfoLinks,
    },
    getTracks: () => tracks,
    getCurrentTrackIndex: () => currentTrackIndex,
    getRequestVersion: () => artistInfoRequestVersion,
    lookupArtistByMBID: (mbid: string) => scheduleMusicBrainzRequest(async () => (
        await LookupArtistByMBID(mbid)
    ), {
        server: currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl,
        path: `/ws/2/artist/${mbid}?fmt=json&inc=genres+tags+url-rels`,
    }),
    openUrl: BrowserOpenURL,
});

libraryController = createLibraryController({
    app,
    sidebarToggle,
    librarySidebar,
    libraryBack,
    libraryPath,
    librarySearch,
    libraryBrowser,
    libraryScanYieldIndicator,
    getTracks: () => tracks,
    getTextFiles: () => textFiles,
    getImageFiles: () => imageFiles,
    getCurrentTrackIndex: () => currentTrackIndex,
    loadFolderPage: async (folderPath: string, offset: number, limit: number): Promise<LibraryFolderPage> => {
        return await GetLibraryFolderPage(folderPath, offset, limit) as LibraryFolderPage;
    },
    resolveLibraryFolderForAbsolutePath: async (path: string): Promise<string> => {
        return await ResolveLibraryFolderForPath(path);
    },
    isFolderImmediateDescendantsEnumerated: async (folderPath: string): Promise<boolean> => {
        return await IsLibraryFolderImmediateDescendantsEnumerated(folderPath);
    },
    searchLibrary: async (query: string, offset: number, limit: number): Promise<LibrarySearchPage> => {
        return await SearchLibrary(query, offset, limit) as LibrarySearchPage;
    },
    resolveTrackIndex: ensureTrackIndexForPath,
    resolveTextFileIndex: textFileIndexForPath,
    resolveImageFileIndex: imageFileIndexForPath,
    onTrackChosen: (index: number) => {
        if (fullLibraryScanLoadActive) {
            suppressAutoSelectAfterFullLibraryScan = true;
        }

        playlistController.activatePlaybackQueueSource();

        void loadTrack(index, true, undefined, true).then(() => {
            void playCurrentTrack();
        });
    },
    onTrackPathChosen: (trackPath: string) => {
        if (fullLibraryScanLoadActive) {
            suppressAutoSelectAfterFullLibraryScan = true;
        }

        const resolvedIndex = ensureTrackIndexForPath(trackPath);
        if (resolvedIndex < 0) {
            return;
        }

        playlistController.activatePlaybackQueueSource();

        void loadTrack(resolvedIndex, true, undefined, true).then(() => {
            void playCurrentTrack();
        });
    },
    onTextFileChosen: (textFileIndex: number) => {
        const textFile = textFiles[textFileIndex];
        if (textFile) {
            void openTextFileModal(textFile);
        }
    },
    onImageFileChosen: (imageFileIndex: number) => {
        const imageFile = imageFiles[imageFileIndex];
        if (imageFile) {
            void imageModalController.openImageFile(imageFile);
        }
    },
    onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[], feedbackTrackIndex?: number) => {
        openSidebarQueueMenu(clientX, clientY, trackIndexes, feedbackTrackIndex);
    },
    onFolderQueueRequested: (clientX: number, clientY: number, folderPath: string, folderLabel: string, trackIndexes?: number[]) => {
        const normalizedTrackIndexes = (trackIndexes || []).filter((trackIndex) => (
            Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < tracks.length
        ));
        const trackIndexesScopedToSelection = trackIndexes !== undefined;
        openSidebarQueueMenu(
            clientX,
            clientY,
            normalizedTrackIndexes,
            undefined,
            folderPath,
            folderLabel,
            true,
            trackIndexesScopedToSelection,
        );
    },
    onSidebarClosed: () => {
        closeSidebarQueueMenu();
    },
});

const coverFront = coverFrame.querySelector('.cover-front') as HTMLElement;
const coverFlipSuppressWindowMs = 320;
let suppressCoverContextMenuUntil = 0;
let suppressCoverFrontClickUntil = 0;

const markCoverFlipHandled = (): void => {
    const suppressUntil = performance.now() + coverFlipSuppressWindowMs;
    suppressCoverContextMenuUntil = suppressUntil;
    suppressCoverFrontClickUntil = suppressUntil;
};

const toggleCoverFlipFromSecondaryInput = (event: MouseEvent): void => {
    if (performance.now() < suppressCoverContextMenuUntil) {
        return;
    }

    const isSecondaryButton = event.button === 2;
    const isCtrlPrimaryClick = event.button === 0 && event.ctrlKey;
    if (!isSecondaryButton && !isCtrlPrimaryClick) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    markCoverFlipHandled();
    setCoverFlipped(!coverFlipped);
};

const toggleCoverFlipFromContextMenu = (event: MouseEvent): boolean => {
    const target = event.target;
    if (!(target instanceof Node) || !coverFrame.contains(target)) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();

    if (performance.now() < suppressCoverContextMenuUntil) {
        return true;
    }

    markCoverFlipHandled();
    setCoverFlipped(!coverFlipped);
    return true;
};

coverFront.addEventListener('click', (event) => {
    if (coverFlipped || event.ctrlKey || performance.now() < suppressCoverFrontClickUntil) {
        return;
    }

    openCoverImageModal();
});

coverFrame.addEventListener('mousedown', (event) => {
    toggleCoverFlipFromSecondaryInput(event);
});

coverFrame.addEventListener('pointerdown', (event) => {
    toggleCoverFlipFromSecondaryInput(event);
});

coverFrame.addEventListener('contextmenu', (event) => {
    toggleCoverFlipFromContextMenu(event);
});

coverFrame.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    event.preventDefault();

    if (!coverArt.classList.contains('is-visible') || !coverArt.src) {
        return;
    }

    openCoverImageModal();
});

trackTechnical.addEventListener('click', () => {
    void openTechnicalInfoModal();
});

trackTechnicalAlt.addEventListener('click', (event) => {
    event.stopPropagation();
    void openTechnicalInfoModal();
});

libraryAbout.addEventListener('click', () => {
    openAboutModal();
});

sidebarQueueAddNext.addEventListener('click', () => {
    const selection = captureSidebarQueueSelectionContext();
    if (selection === null) {
        return;
    }

    const actionLabel = 'Add next';
    closeSidebarQueueMenu();
    void (async () => {
        const trackIndexes = await resolveSidebarQueueTrackIndexesForAction(actionLabel, selection);
        if (trackIndexes.length === 0) {
            return;
        }

        playlistController.addToQueueNext(trackIndexes);
    })();
});

sidebarQueueAddToPlaylist.addEventListener('click', () => {
    const selection = captureSidebarQueueSelectionContext();
    if (selection === null) {
        return;
    }

    closeSidebarQueueMenu();
    void addSidebarSelectionToPlaylist(selection).catch((error: unknown) => {
        console.error(error);
    });
});

sidebarQueuePlay.addEventListener('click', () => {
    const selection = captureSidebarQueueSelectionContext();
    if (selection === null) {
        return;
    }

    closeSidebarQueueMenu();
    void (async () => {
        const trackIndexes = await resolveSidebarQueueTrackIndexesForAction('Play', selection);
        if (trackIndexes.length === 0) {
            return;
        }

        await playSidebarQueueSelection(trackIndexes);
    })();
});

sidebarQueueLove.addEventListener('click', () => {
    const feedbackTrackIndex = sidebarQueueFeedbackTrackIndex;
    closeSidebarQueueMenu();
    void submitSidebarQueueFeedback(feedbackTrackIndex, 1);
});

sidebarQueueHate.addEventListener('click', () => {
    const feedbackTrackIndex = sidebarQueueFeedbackTrackIndex;
    closeSidebarQueueMenu();
    void submitSidebarQueueFeedback(feedbackTrackIndex, -1);
});

sidebarQueueEnd.addEventListener('click', () => {
    const selection = captureSidebarQueueSelectionContext();
    if (selection === null) {
        return;
    }

    const actionLabel = 'Queue';
    closeSidebarQueueMenu();
    void (async () => {
        const trackIndexes = await resolveSidebarQueueTrackIndexesForAction(actionLabel, selection);
        if (trackIndexes.length === 0) {
            return;
        }

        playlistController.addToQueueEnd(trackIndexes);
    })();
});

errorBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeErrorModal();
});

errorClose.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeErrorModal();
});

errorOk.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeErrorModal();
});

queueConfirmBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeQueueConfirmModal(false);
});

queueConfirmCancel.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeQueueConfirmModal(false);
});

queueConfirmProceed.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeQueueConfirmModal(true);
});

textFileBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeTextFileModal();
});

textFileClose.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeTextFileModal();
});

musicBrainzEntityBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeMusicBrainzEntityModal();
});

musicBrainzEntityClose.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeMusicBrainzEntityModal();
});

shareBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeShareModal();
});

shareClose.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeShareModal();
});

shareCommentInput.addEventListener('input', () => {
    renderSharePreviewSnapshot();
    setShareStatus('');
});

shareSave.addEventListener('click', () => {
    void saveSharePreview();
});

shareCopy.addEventListener('click', () => {
    void copySharePreview();
});

technicalInfoBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeTechnicalInfoModal();
});

technicalInfoClose.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeTechnicalInfoModal();
});

aboutBackdrop.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeAboutModal();
});

aboutClose.addEventListener('click', () => {
    suppressTrackMetaClicks();
    closeAboutModal();
});

aboutRepoLink.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void BrowserOpenURL('https://github.com/metaisfacil/silphium');
});

settingsElements.settingsBackdrop.addEventListener('click', suppressTrackMetaClicks);
settingsElements.settingsClose.addEventListener('click', suppressTrackMetaClicks);
playlistModalElements.playlistBackdrop.addEventListener('click', suppressTrackMetaClicks);
playlistModalElements.playlistClose.addEventListener('click', suppressTrackMetaClicks);
playlistTargetModalElements.playlistTargetBackdrop.addEventListener('click', suppressTrackMetaClicks);
playlistTargetModalElements.playlistTargetClose.addEventListener('click', suppressTrackMetaClicks);
playlistTargetModalElements.playlistTargetCancel.addEventListener('click', suppressTrackMetaClicks);
playlistTargetModalElements.playlistTargetConfirm.addEventListener('click', suppressTrackMetaClicks);
imageModalElements.imageFileBackdrop.addEventListener('click', suppressTrackMetaClicks);

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }

    if (playlistTargetModalController.handleEscape()) {
        return;
    }

    if (playlistController.handleEscape()) {
        return;
    }

    if (settingsController.handleEscape()) {
        return;
    }

    if (!listenBrainzFeedbackMenu.hidden) {
        closeListenBrainzFeedbackMenu();
        return;
    }

    if (!sidebarQueueMenu.hidden) {
        closeSidebarQueueMenu();
        return;
    }

    if (!queueConfirmModal.hidden) {
        closeQueueConfirmModal(false);
        return;
    }

    if (!errorModal.hidden) {
        closeErrorModal();
        return;
    }

    if (!musicBrainzEntityModal.hidden) {
        closeMusicBrainzEntityModal();
        return;
    }

    if (!shareModal.hidden) {
        closeShareModal();
        return;
    }

    if (!technicalInfoModal.hidden) {
        closeTechnicalInfoModal();
        return;
    }

    if (!aboutModal.hidden) {
        closeAboutModal();
        return;
    }

    if (!textFileModal.hidden) {
        closeTextFileModal();
        return;
    }

    if (imageModalController.handleEscape()) {
        return;
    }

    if (libraryController.isSidebarOpen()) {
        libraryController.setSidebarOpen(false);
        return;
    }
});

playPause.addEventListener('click', () => {
    void toggleCurrentTrack();
});

playPause.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPlayOrderMenu(event.clientX, event.clientY);
});

playOrderMenu.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
        return;
    }

    const nextMode = target.dataset.playOrder as PlaybackOrderMode | undefined;
    if (!nextMode) {
        return;
    }

    setPlaybackOrderMode(nextMode);
    void savePlaybackOrderSetting();
    closePlayOrderMenu();
});

trackMetaParentFolderBtn.addEventListener('click', () => {
    closeTrackMetaMenu();
    openCurrentTrackFolderInSidebar();
});

trackMetaBrowserFolderBtn.addEventListener('click', () => {
    closeTrackMetaMenu();
    void openCurrentTrackFolderInFileBrowser();
});

trackMetaCopyFilePathBtn.addEventListener('click', () => {
    closeTrackMetaMenu();
    void copyCurrentTrackFilePath();
});

trackMetaCopyFolderPathBtn.addEventListener('click', () => {
    closeTrackMetaMenu();
    void copyCurrentTrackFolderPath();
});

trackMetaOpenMbBtn.addEventListener('click', () => {
    const target = trackMetaMenuTarget;
    closeTrackMetaMenu();
    if (!target) {
        return;
    }

    openMbLink(target);
});

back.addEventListener('click', () => {
    goToTrack(-1);
});

forward.addEventListener('click', () => {
    goToTrack(1);
});

shareBtn.addEventListener('click', () => {
    void openShareModal();
});

seek.addEventListener('input', () => {
    isSeeking = true;
    currentTimeLabel.textContent = formatTime(Number(seek.value));
});

seek.addEventListener('change', () => {
    isSeeking = false;
    void (async () => {
        try {
            const nextState = await AudioSeek(Number(seek.value)) as AudioPlaybackState;
            applyPlaybackState(nextState);
        } catch (error) {
            handleAudioError(error);
        }
    })();
});

seek.addEventListener('blur', () => {
    isSeeking = false;
});

volume.addEventListener('input', () => {
    void (async () => {
        try {
            const nextState = await AudioSetVolume(Number(volume.value)) as AudioPlaybackState;
            applyPlaybackState(nextState);
        } catch (error) {
            handleAudioError(error);
        }
    })();
});

const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
const volumeRow = volumeBtn.closest('.volume-wrap') as HTMLElement;

volumeBtn.addEventListener('click', () => {
    volumeRow.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    const target = e.target as Node;
    const clickPath = e.composedPath();

    if (!playOrderMenu.hidden && !playOrderMenu.contains(target)) {
        closePlayOrderMenu();
    }

    if (!trackMetaMenu.hidden && !trackMetaMenu.contains(target)) {
        closeTrackMetaMenu();
    }

    if (!sidebarQueueMenu.hidden && !sidebarQueueMenu.contains(target)) {
        closeSidebarQueueMenu();
    }

    if (!queueConfirmModal.hidden && !queueConfirmModal.contains(target)) {
        closeQueueConfirmModal(false);
    }

    if (!listenBrainzFeedbackMenu.hidden && !listenBrainzFeedbackMenu.contains(target) && !listenBrainzLoveBtn.contains(target)) {
        closeListenBrainzFeedbackMenu();
    }

    if (!volumeRow.contains(target)) {
        volumeRow.classList.remove('open');
    }

    if (playlistTargetModalController.handleDocumentClick(target)) {
        return;
    }

    if (playlistController.handleDocumentClick(target)) {
        return;
    }

    if (clickPath.includes(settingsElements.settingsModal)) {
        return;
    }

    if (settingsController.handleDocumentClick(target)) {
        return;
    }

    if (musicBrainzEntityModal.contains(target)) {
        return;
    }

    if (sidebarQueueMenu.contains(target)) {
        return;
    }

    if (queueConfirmModal.contains(target)) {
        return;
    }

    if (errorModal.contains(target)) {
        return;
    }

    if (technicalInfoModal.contains(target)) {
        return;
    }

    if (aboutModal.contains(target)) {
        return;
    }

    if (textFileModal.contains(target)) {
        return;
    }

    if (imageModalController.contains(target)) {
        return;
    }

    if (clickPath.includes(trackMetaMenu)) {
        return;
    }

    if (clickPath.includes(listenBrainzFeedbackMenu)) {
        return;
    }

    if (!libraryController.isSidebarOpen()) {
        return;
    }

    if (clickPath.includes(librarySidebar) || clickPath.includes(sidebarToggle) || clickPath.includes(libraryAbout)) {
        return;
    }

    libraryController.setSidebarOpen(false);
});

document.addEventListener('contextmenu', (event) => {
    if (toggleCoverFlipFromContextMenu(event)) {
        return;
    }

    const target = event.target as Node;
    if (!sidebarQueueMenu.hidden && !sidebarQueueMenu.contains(target)) {
        closeSidebarQueueMenu();
    }

    if (!listenBrainzFeedbackMenu.hidden && !listenBrainzFeedbackMenu.contains(target) && !listenBrainzLoveBtn.contains(target)) {
        closeListenBrainzFeedbackMenu();
    }

    if (listenBrainzLoveBtn.contains(target) || listenBrainzFeedbackMenu.contains(target)) {
        return;
    }

    if (trackTitle.contains(target) || trackAlbum.contains(target) || trackArtist.contains(target) || trackTitleInline.contains(target) || trackReleaseAlbum.contains(target) || trackArtistHeader.contains(target) || trackMetaMenu.contains(target)) {
        return;
    }

    if (!trackMetaMenu.hidden) {
        closeTrackMetaMenu();
    }
});

document.addEventListener('scroll', () => {
    if (!playOrderMenu.hidden) {
        closePlayOrderMenu();
    }

    if (!sidebarQueueMenu.hidden) {
        closeSidebarQueueMenu();
    }

    if (!trackMetaMenu.hidden) {
        closeTrackMetaMenu();
    }

    if (!listenBrainzFeedbackMenu.hidden) {
        closeListenBrainzFeedbackMenu();
    }

    playlistController.closeMenu();
}, { capture: true });

document.addEventListener('pointerdown', () => {
    unlockMediaSessionAnchorFromUserGesture();
}, { capture: true, passive: true });

document.addEventListener('keydown', () => {
    unlockMediaSessionAnchorFromUserGesture();
}, { capture: true });

document.addEventListener('keydown', (event) => {
    const suppressCapsLockToggle = event.code === 'CapsLock' && focusedShortcutBindingsUseCode('CapsLock');
    if (handleFocusedHardwareMediaKey(event) || handleFocusedKeyboardShortcut(event) || suppressCapsLockToggle) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    if (event.key === 'Escape' && !playOrderMenu.hidden) {
        closePlayOrderMenu();
    }

    if (event.key === 'Escape' && !trackMetaMenu.hidden) {
        closeTrackMetaMenu();
    }

    if (event.key === 'Escape' && !listenBrainzFeedbackMenu.hidden) {
        closeListenBrainzFeedbackMenu();
    }

    if (event.key === 'Escape') {
        playlistController.closeMenu();
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Control') {
        setCtrlHeldState(true);
    }
});

document.addEventListener('keyup', (event) => {
    if (event.code === 'CapsLock' && focusedShortcutBindingsUseCode('CapsLock')) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    if (event.key === 'Control') {
        setCtrlHeldState(false);
    }
});

window.addEventListener('blur', () => {
    setCtrlHeldState(false);
    void hideToTrayWhenMinimized();
});

window.addEventListener('beforeunload', () => {
    mediaSessionController.dispose();
});

window.addEventListener('resize', () => {
    updateLyricsPanelVisibility();
    void hideToTrayWhenMinimized();
});

const cardResizeObserver = new ResizeObserver(() => {
    updateLyricsPanelVisibility();
});
cardResizeObserver.observe(playerCard);

// Logging utilities with precise timestamps
const logRescan = (message: string, ...args: unknown[]): void => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    console.log(`[${timestamp}] ${message}`, ...args);
};

// Listen for backend rescan logs
EventsOn('silphium:library:rescan-log', (logLine: string) => {
    console.log(logLine);
});

EventsOn('silphium:library:scan-updated', (scanResult: LibraryScanResult) => {
    handleLibraryScanUpdatedEvent(scanResult);
});

EventsOn('silphium:library:scan-progress', (scanProgress: LibraryScanProgress) => {
    updateLibraryLoadingEtaFromProgress(scanProgress);
});

EventsOn('silphium:musicbrainz:tag-worker-progress', (progress: MusicBrainzTagWorkerProgress) => {
    currentMusicBrainzTagWorkerProgress = normalizeMusicBrainzTagWorkerProgress(progress);
    settingsController.setMusicBrainzTagWorkerProgress(currentMusicBrainzTagWorkerProgress);
});

EventsOn('silphium:media:key', (action: string) => {
    if (action === 'playpause') {
        dispatchExternalPlaybackAction('playpause');
        return;
    }

    if (action === 'next') {
        dispatchExternalPlaybackAction('next');
        return;
    }

    if (action === 'previous') {
        dispatchExternalPlaybackAction('previous');
        return;
    }

    if (action === 'stop') {
        dispatchExternalPlaybackAction('stop');
    }
});

updatePlayButton();
updateTrackLabels();
updatePlayOrderMenuState();
libraryController.refreshSidebarToggleState();
refreshLyricsPanel();
resetListenBrainzFeedbackState();
initializeMediaSessionIntegration();
void initializeSettings();
void initializeAppVersion();
