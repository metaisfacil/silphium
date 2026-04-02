import './style.css';
import './app.css';
import './components/overlays/overlays.css';
import { createArtistInfoController, type ArtistInfoController } from './controllers/artist-info-controller';
import { createImageModalController, type ImageModalController } from './controllers/image-modal-controller';
import { createLibraryController, type LibraryController } from './controllers/library-controller';
import { createPlaylistController, type LoadedPlaylistData, type PlaylistController } from './controllers/playlist-controller';
import { createSettingsController, type SettingsController } from './controllers/settings-controller';
import { clearLibraryRuntimeData, mapLibraryScanResult, mergePlaylistFilesIntoTracks } from './services/library-data-service';
import { createPlaybackSequencingService } from './services/playback-sequencing-service';
import { createScrobbleService } from './services/scrobble-service';
import { createPlaybackStateService } from './services/playback-state-service';
import { createTrackMetadataService } from './services/track-metadata-service';
import { getMediaControlsElements, renderMediaControls } from './components/media-controls';
import {
    getAboutModalElements,
    getImageFileModalElements,
    getMusicBrainzEntityModalElements,
    getPlayOrderMenuElements,
    getPlaylistMenuElements,
    getPlaylistModalElements,
    getSidebarQueueMenuElements,
    getSettingsModalElements,
    getTechnicalInfoModalElements,
    getTextFileModalElements,
    getTrackMetaMenuElements,
    renderImageFileModal,
    renderAboutModal,
    renderMusicBrainzEntityModal,
    renderPlayOrderMenu,
    renderPlaylistMenu,
    renderPlaylistModal,
    renderSidebarQueueMenu,
    renderSettingsModal,
    renderTechnicalInfoModal,
    renderTextFileModal,
    renderTrackMetaMenu,
} from './components/overlays';
import { getSidebarElements, renderSidebar } from './components/sidebar';
import {
    AudioGetState,
    AudioLoadTrack,
    AudioPause,
    AudioPlay,
    AudioSeek,
    AudioSetVolume,
    AudioStop,
    GetAppVersion,
    GetSettings,
    InitializeAudioBackend,
    LoadPlaylistFile,
    LookupArtistByMBID,
    ReadFileBase64,
    ReadTextFile,
    ReadTrackTags,
    SavePlaylistFile,
    SaveSettings,
    ScanLibraryFolder,
    SelectLibraryFolder,
    SelectPlaylistFile,
    SelectPlaylistSaveFile,
    SubmitListenBrainz,
} from '../wailsjs/go/main/App';
import { BrowserOpenURL, EventsOn } from '../wailsjs/runtime/runtime';
import { applyMbLinks, openMbLink } from './musicbrainz';
import type {
    AppSettings,
    AudioPlaybackState,
    ImageLibraryFile,
    LibraryScanResult,
    MusicBrainzEntityType,
    PlaybackOrderMode,
    PlaylistLoadResult,
    TextLibraryFile,
    Track,
} from './types/app-types';
import {
    asPlaybackOrderMode,
    asReleaseDepth,
    base64ToObjectUrl,
    folderKeyForPath,
    formatTime,
    mimeTypeForFileName,
    renderTechnicalInfoContent,
    taggedTrackPosition,
} from './utils/main-helpers';
import {
    lookupMusicBrainzTrackMetadata,
    lookupMusicBrainzEntity,
    mbidForTrackEntity,
    renderMusicBrainzEntityContent,
} from './utils/musicbrainz-entity-helpers';
import { scheduleMusicBrainzRequest } from './utils/musicbrainz-request-scheduler';

const app = document.querySelector('#app') as HTMLElement | null;

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
    ${renderTextFileModal()}
    ${renderImageFileModal()}
    ${renderMusicBrainzEntityModal()}
    ${renderTechnicalInfoModal()}
    ${renderSettingsModal()}
    ${renderPlayOrderMenu()}
    ${renderTrackMetaMenu()}
    ${renderSidebarQueueMenu()}
    ${renderPlaylistMenu()}
    ${renderPlaylistModal()}
`;

let tracks: Track[] = [];
let textFiles: TextLibraryFile[] = [];
let imageFiles: ImageLibraryFile[] = [];
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
let isSeeking = false;
let currentSettings: AppSettings = {
    libraryPath: '',
    listenBrainzUserToken: '',
    playbackOrder: 'ordered-library',
    releaseDepth: 0,
    favoritePlaylists: [],
    preferMusicBrainzMetadata: false,
};
let trackMetaMenuTarget: HTMLElement | null = null;
let sidebarQueueTrackIndexes: number[] = [];
const coverPathByFolder = new Map<string, string>();
const coverUrlByFolder = new Map<string, string>();
const musicBrainzEntityModalTransitionMs = 220;
const technicalInfoModalTransitionMs = 220;
const aboutModalTransitionMs = 220;
const playbackStateService = createPlaybackStateService();
const scrobbleService = createScrobbleService({
    submitListenBrainz: SubmitListenBrainz,
});
const playbackSequencingService = createPlaybackSequencingService({
    getTracks: () => tracks,
    getCurrentTrackIndex: () => currentTrackIndex,
    getReleaseDepth: () => asReleaseDepth(currentSettings.releaseDepth),
    initialPlaybackOrderMode: currentSettings.playbackOrder,
});
const trackMetadataService = createTrackMetadataService({
    getTracks: () => tracks,
    setTrack: (index: number, track: Track) => {
        tracks[index] = track;
    },
    readTrackTags: ReadTrackTags,
    lookupMusicBrainzTrackMetadata,
    getPreferMusicBrainzMetadata: () => currentSettings.preferMusicBrainzMetadata,
    getCurrentTrackIndex: () => currentTrackIndex,
    getTagRequestVersion: () => tagRequestVersion,
});

const { sidebarToggle, librarySidebar, librarySettings, libraryAbout, libraryBack, libraryPath, librarySearch, libraryBrowser } = getSidebarElements(document);
const {
    playerShell,
    playerLane,
    playerCard,
    trackTitle,
    trackAlbum,
    trackPosition,
    trackArtist,
    trackTechnical,
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
    coverArt,
    currentTimeLabel,
    trackDurationLabel,
    seek,
    playlistBtn,
    back,
    playPause,
    forward,
    volume,
} = getMediaControlsElements(document);
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

const trackMetaClickSuppressDurationMs = 280;
let suppressTrackMetaClickUntil = 0;

const suppressTrackMetaClicks = (): void => {
    suppressTrackMetaClickUntil = Date.now() + trackMetaClickSuppressDurationMs;
};

const shouldSuppressTrackMetaClick = (): boolean => Date.now() < suppressTrackMetaClickUntil;
const shouldBlockTrackMetaModalOpen = (): boolean => shouldSuppressTrackMetaClick() || app.classList.contains('sidebar-open');

trackTitle.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
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
    openTrackMetaMenu(event.clientX, event.clientY, true);
});
trackAlbum.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
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
    openTrackMetaMenu(event.clientX, event.clientY, false);
});
trackArtist.addEventListener('click', (event) => {
    if (shouldBlockTrackMetaModalOpen()) {
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

    openTrackMetaMenu(event.clientX, event.clientY, false);
});
const bgLayerA = document.getElementById('bg-layer-a') as HTMLDivElement;
const bgLayerB = document.getElementById('bg-layer-b') as HTMLDivElement;
const { aboutModal, aboutBackdrop, aboutClose, aboutVersion, aboutRepoLink } = getAboutModalElements(document);
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
const { playOrderMenu } = getPlayOrderMenuElements(document);
const { trackMetaMenu, trackMetaOpenMbBtn, trackMetaParentFolderBtn } = getTrackMetaMenuElements(document);
const { sidebarQueueMenu, sidebarQueueAddNext, sidebarQueueEnd } = getSidebarQueueMenuElements(document);
const playlistMenuElements = getPlaylistMenuElements(document);
const playlistModalElements = getPlaylistModalElements(document);
let settingsController: SettingsController;
let playlistController: PlaylistController;
let artistInfoController: ArtistInfoController;
let imageModalController: ImageModalController;
let libraryController: LibraryController;

const canScrobble = (): boolean => currentSettings.listenBrainzUserToken.trim() !== '';

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

const maybeSubmitListenBrainz = (state: AudioPlaybackState): void => {
    scrobbleService.maybeSubmit(state, currentTrackForPlaybackState(state), canScrobble());
};

const updatePlayButton = (): void => {
    const playbackState = playbackStateService.getPlaybackState();
    playPause.textContent = playbackState.playing ? '⏸' : '▶';
    playPause.dataset.state = playbackState.playing ? 'pause' : 'play';
    playPause.setAttribute('aria-label', playbackState.playing ? 'Pause' : 'Play');
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

const handleAudioError = (error: unknown): void => {
    console.error(error);
    const message = error instanceof Error ? error.message : 'Audio backend error';
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
    const transition = playbackStateService.applyPlaybackState(nextState, tracks.length > 0);
    updateTrackLabels();
    updatePlayButton();
    maybeSubmitListenBrainz(nextState);

    if (transition.trackEnded) {
        goToTrack(1);
    }
};

const syncPlaybackState = async (): Promise<void> => {
    if (!playbackStateService.isBackendReady()) {
        return;
    }

    try {
        const nextState = await AudioGetState() as AudioPlaybackState;
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

const refreshNowPlayingLabel = (): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const activeTrack = tracks[currentTrackIndex];
    trackTitle.textContent = activeTrack.displayTitle;
    trackAlbum.textContent = activeTrack.displayAlbum;
    trackPosition.textContent = taggedTrackPosition(activeTrack);
    trackArtist.textContent = activeTrack.displayArtist;
    trackTechnical.textContent = activeTrack.displayTechnical || 'Details';
    trackTechnical.disabled = false;
    refreshLyricsPanel();
    applyMbLinks(trackTitle, trackAlbum, trackArtist, activeTrack.mbIds, {
        artistText: activeTrack.displayArtist,
        artistMbids: activeTrack.artistMbids,
        artistCredits: activeTrack.mbArtistCredits,
    });

    playlistController.scheduleRender();
};

const ensureTrackTagsResolved = async (index: number): Promise<void> => {
    await trackMetadataService.ensureTrackTagsResolved(index);
    if (index === currentTrackIndex) {
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

const closePlayOrderMenu = (): void => {
    playOrderMenu.hidden = true;
};

const closeTrackMetaMenu = (): void => {
    trackMetaMenu.hidden = true;
    trackMetaMenuTarget = null;
};

const closeSidebarQueueMenu = (): void => {
    sidebarQueueMenu.hidden = true;
    sidebarQueueTrackIndexes = [];
};

const openSidebarQueueMenu = (clientX: number, clientY: number, trackIndexes: number[]): void => {
    if (trackIndexes.length === 0) {
        return;
    }

    closePlayOrderMenu();
    closeTrackMetaMenu();
    playlistController.closeMenu();

    sidebarQueueTrackIndexes = trackIndexes;
    sidebarQueueMenu.hidden = false;

    const margin = 10;
    const rect = sidebarQueueMenu.getBoundingClientRect();
    const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
    const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

    sidebarQueueMenu.style.left = `${Math.max(margin, clampedX)}px`;
    sidebarQueueMenu.style.top = `${Math.max(margin, clampedY)}px`;
};

const openTrackMetaMenu = (clientX: number, clientY: number, includeFolderAction: boolean): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    closePlayOrderMenu();
    trackMetaParentFolderBtn.hidden = !includeFolderAction;
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

const releaseRootPathForFolder = (folderPath: string): string => {
    const normalizedFolderPath = folderPath || '';
    const segments = normalizedFolderPath
        .split('/')
        .filter((segment) => segment !== '');

    if (segments.length === 0) {
        return '';
    }

    const releaseDepth = asReleaseDepth(currentSettings.releaseDepth);
    if (releaseDepth <= 0 || releaseDepth >= segments.length) {
        return normalizedFolderPath;
    }

    return segments.slice(0, releaseDepth).join('/');
};

const collectReleaseImageFiles = (folderPath: string): ImageLibraryFile[] => {
    const releaseRootPath = releaseRootPathForFolder(folderPath || '');
    const releaseRootPathLower = releaseRootPath.toLowerCase();
    const prefix = releaseRootPathLower ? `${releaseRootPathLower}/` : '';

    return imageFiles
        .filter((candidate) => {
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
        imageModalController.openPreview(coverArt.src);
        return;
    }

    const gallery = collectReleaseImageFiles(activeTrack.folderPath || '');
    if (gallery.length === 0) {
        imageModalController.openPreview(coverArt.src);
        return;
    }

    const coverPath = coverPathByFolder.get(folderKeyForPath(activeTrack.folderPath || ''));
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

const lockMusicBrainzDialogWidth = (): void => {
    const width = Math.ceil(musicBrainzEntityDialog.getBoundingClientRect().width);
    if (width > 0) {
        musicBrainzEntityDialog.style.width = `${width}px`;
    }
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
    musicBrainzEntityTitle.textContent = 'MusicBrainz info';
    musicBrainzEntityContent.innerHTML = '<p class="mb-entity-empty">Loading from MusicBrainz...</p>';
    musicBrainzEntityModal.hidden = false;
    window.requestAnimationFrame(() => {
        musicBrainzEntityModal.classList.add('is-visible');
    });

    const entityInfo = await lookupMusicBrainzEntity(entityType, mbid);
    if (!entityInfo.found) {
        musicBrainzEntityContent.innerHTML = '<p class="mb-entity-empty">No details found for this MusicBrainz ID.</p>';
        lockMusicBrainzDialogWidth();
        return;
    }

    renderMusicBrainzEntityContent(entityInfo, musicBrainzEntityTitle, musicBrainzEntityContent);
    lockMusicBrainzDialogWidth();
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
    closeMusicBrainzEntityModal();
    closeTechnicalInfoModal();

    try {
        const nextState = await AudioStop() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }

    objectUrls = clearLibraryRuntimeData({
        objectUrls,
        coverPathByFolder,
        coverUrlByFolder,
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

    currentTrackIndex = -1;
    scrobbleService.reset();
    resetShuffleHistory();

    trackTitle.textContent = 'Unknown Title';
    trackAlbum.textContent = 'Unknown Album';
    trackPosition.textContent = '';
    trackArtist.textContent = 'Unknown Artist';
    trackTechnical.textContent = '';
    trackTechnical.disabled = true;
    lyricsContent.textContent = '';
    playerLane.classList.remove('lyrics-visible');
    lyricsPanel.setAttribute('aria-hidden', 'true');
    applyMbLinks(trackTitle, trackAlbum, trackArtist, {});

    coverArt.removeAttribute('src');
    coverArt.classList.remove('is-visible');
    setBackgroundCover();
    setCoverFlipped(false);
    resetArtistInfoPanel();
    libraryController.renderFolder('none');
};

const applyLibraryPath = async (selectedPath: string): Promise<void> => {
    const cleanPath = selectedPath.trim();
    if (!cleanPath) {
        await clearLibrarySelection();
        return;
    }

    libraryController.setLibraryLoading(true);
    try {
        libraryController.setLibraryPathMessage('Scanning folder…');
        const scanResult = await ScanLibraryFolder(cleanPath) as LibraryScanResult;
        await loadLibraryScan(scanResult);
    } finally {
        libraryController.setLibraryLoading(false);
    }
};

const handleLibraryScanUpdatedEvent = async (scanResult: LibraryScanResult): Promise<void> => {
    const expectedRootPath = currentSettings.libraryPath.trim();
    if (!expectedRootPath) {
        return;
    }

    if (!scanResult || !scanResult.rootPath) {
        return;
    }

    if (scanResult.rootPath.trim().toLowerCase() !== expectedRootPath.toLowerCase()) {
        return;
    }

    await loadLibraryScan(scanResult, { autoSelectStartingTrack: false });
};

const initializeSettings = async (): Promise<void> => {
    try {
        const settings = await GetSettings() as AppSettings;
        currentSettings = {
            libraryPath: settings.libraryPath || '',
            listenBrainzUserToken: settings.listenBrainzUserToken || '',
            playbackOrder: asPlaybackOrderMode(settings.playbackOrder || ''),
            releaseDepth: asReleaseDepth(settings.releaseDepth),
            favoritePlaylists: Array.isArray(settings.favoritePlaylists) ? settings.favoritePlaylists : [],
            preferMusicBrainzMetadata: !!settings.preferMusicBrainzMetadata,
        };
        setPlaybackOrderMode(currentSettings.playbackOrder);

        if (settings.libraryPath) {
            await applyLibraryPath(settings.libraryPath);
            return;
        }
    } catch (error) {
        console.error(error);
    }

    libraryController.renderFolder('none');
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

const resolveCoverForTrack = async (track: Track): Promise<string | undefined> => {
    const folderKey = folderKeyForPath(track.folderPath);
    const cached = coverUrlByFolder.get(folderKey);
    if (cached) {
        return cached;
    }

    const coverPath = coverPathByFolder.get(folderKey);
    if (!coverPath) {
        return undefined;
    }

    const base64 = await ReadFileBase64(coverPath);
    if (!base64) {
        return undefined;
    }

    const coverUrl = base64ToObjectUrl(base64, mimeTypeForFileName(coverPath));
    coverUrlByFolder.set(folderKey, coverUrl);
    objectUrls.push(coverUrl);
    return coverUrl;
};

const loadTrack = async (index: number, allowMissingTrackRecovery = true): Promise<void> => {
    if (index < 0 || index >= tracks.length) {
        return;
    }

    currentTrackIndex = index;
    playlistController.scheduleRender();
    setCoverFlipped(false);
    scrobbleService.startTrackSession();
    const track = tracks[currentTrackIndex];

    if (currentSettings.preferMusicBrainzMetadata) {
        track.mbMetadataResolved = false;
    }

    if (!libraryController.isSidebarOpen()) {
        libraryController.setSidebarAutoFolderPath(track.folderPath);
    }

    try {
        const nextState = await AudioLoadTrack(track.path) as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        if (allowMissingTrackRecovery && isMissingTrackLoadError(error) && currentSettings.libraryPath.trim() !== '') {
            const failedTrackPath = track.path.toLowerCase();
            const failedRelativePath = track.relativePath.toLowerCase();
            const failedName = track.name.toLowerCase();

            libraryController.setLibraryLoading(true);
            try {
                libraryController.setLibraryPathMessage('Track missing. Rescanning folder…');
                const scanResult = await ScanLibraryFolder(currentSettings.libraryPath.trim()) as LibraryScanResult;
                await loadLibraryScan(scanResult, { autoSelectStartingTrack: false });

                let recoveredIndex = tracks.findIndex((candidate) => candidate.path.toLowerCase() === failedTrackPath);
                if (recoveredIndex < 0) {
                    recoveredIndex = tracks.findIndex((candidate) => candidate.relativePath.toLowerCase() === failedRelativePath);
                }
                if (recoveredIndex < 0) {
                    recoveredIndex = tracks.findIndex((candidate) => candidate.name.toLowerCase() === failedName);
                }

                if (recoveredIndex >= 0) {
                    await loadTrack(recoveredIndex, false);
                    return;
                }
            } catch (rescanError) {
                console.error(rescanError);
            } finally {
                libraryController.setLibraryLoading(false);
            }
        }

        handleAudioError(error);
        return;
    }

    refreshNowPlayingLabel();
    const coverSrc = await resolveCoverForTrack(track);
    if (index !== currentTrackIndex) {
        return;
    }

    if (coverSrc) {
        coverArt.src = coverSrc;
        coverArt.classList.add('is-visible');
        setBackgroundCover(coverSrc);
    } else {
        coverArt.removeAttribute('src');
        coverArt.classList.remove('is-visible');
        setBackgroundCover();
    }

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
        return;
    }

    if (await shouldSkipLoadedTrack()) {
        goToTrack(1);
        return;
    }

    try {
        const nextState = await AudioPlay() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }
};

const pauseCurrentTrack = async (): Promise<void> => {
    if (!playbackStateService.isBackendReady()) {
        return;
    }

    try {
        const nextState = await AudioPause() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }
};

const goToTrack = (direction: -1 | 1): void => {
    if (tracks.length === 0) {
        return;
    }

    void (async () => {
        for (let attempt = 0; attempt < tracks.length; attempt += 1) {
            const nextIndex = nextTrackIndexForDirection(direction);
            if (nextIndex === undefined) {
                return;
            }

            await loadTrack(nextIndex);
            if (!(await shouldSkipLoadedTrack())) {
                await playCurrentTrack();
                return;
            }
        }

        await playCurrentTrack();
    })();
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
        const savedSettings = await SaveSettings({
            libraryPath: currentSettings.libraryPath,
            listenBrainzUserToken: currentSettings.listenBrainzUserToken,
            playbackOrder: playbackSequencingService.getPlaybackOrderMode(),
            releaseDepth: asReleaseDepth(currentSettings.releaseDepth),
            favoritePlaylists: currentSettings.favoritePlaylists,
            preferMusicBrainzMetadata: currentSettings.preferMusicBrainzMetadata,
        }) as AppSettings;

        currentSettings = {
            libraryPath: savedSettings.libraryPath || '',
            listenBrainzUserToken: savedSettings.listenBrainzUserToken || '',
            playbackOrder: asPlaybackOrderMode(savedSettings.playbackOrder || ''),
            releaseDepth: asReleaseDepth(savedSettings.releaseDepth),
            favoritePlaylists: Array.isArray(savedSettings.favoritePlaylists) ? savedSettings.favoritePlaylists : [],
            preferMusicBrainzMetadata: !!savedSettings.preferMusicBrainzMetadata,
        };
        setPlaybackOrderMode(currentSettings.playbackOrder);
    } catch (error) {
        console.error(error);
    }
};

const loadPlaylistData = async (playlistPath: string): Promise<LoadedPlaylistData | null> => {
    const loaded = await LoadPlaylistFile(playlistPath) as PlaylistLoadResult;
    const mergeResult = await mergePlaylistFilesIntoTracks(tracks, loaded.trackFiles || []);
    tracks = mergeResult.tracks;

    if (mergeResult.trackIndexes.length === 0) {
        return null;
    }

    return {
        name: loaded.name || '',
        trackIndexes: mergeResult.trackIndexes,
    };
};

const loadLibraryScan = async (scanResult: LibraryScanResult, options?: { autoSelectStartingTrack?: boolean }): Promise<void> => {
    if (!scanResult.rootPath) {
        return;
    }

    closeSidebarQueueMenu();
    closeMusicBrainzEntityModal();
    closeTechnicalInfoModal();

    try {
        const nextState = await AudioStop() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }

    objectUrls = clearLibraryRuntimeData({
        objectUrls,
        coverPathByFolder,
        coverUrlByFolder,
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

    tracks = [];
    textFiles = [];
    imageFiles = [];

    const scanCollections = mapLibraryScanResult(scanResult);
    tracks = scanCollections.tracks;
    textFiles = scanCollections.textFiles;
    imageFiles = scanCollections.imageFiles;

    for (const [folder, coverPath] of scanCollections.coverPathEntries) {
        coverPathByFolder.set(folder, coverPath);
    }

    libraryController.rebuildLibraryTree(
        scanResult.rootName || 'Selected folder',
        scanResult.truncated,
        tracks,
        textFiles,
        imageFiles,
    );

    if (tracks.length === 0) {
        currentTrackIndex = -1;
        libraryController.setCurrentFolderPath('');
        trackTitle.textContent = 'No audio tracks found';
        trackAlbum.textContent = 'Unknown Album';
        trackPosition.textContent = '';
        trackArtist.textContent = 'Unknown Artist';
        trackTechnical.textContent = '';
        trackTechnical.disabled = true;
        lyricsContent.textContent = '';
        playerLane.classList.remove('lyrics-visible');
        lyricsPanel.setAttribute('aria-hidden', 'true');
        coverArt.removeAttribute('src');
        coverArt.classList.remove('is-visible');
        setBackgroundCover();
        setCoverFlipped(false);
        resetArtistInfoPanel();
        libraryController.renderFolder('none');
        playlistController.refreshOpenModal();
        return;
    }

    libraryController.setCurrentFolderPath('');
    libraryController.renderFolder('none');
    resetShuffleHistory();

    if (options?.autoSelectStartingTrack !== false) {
        const startingTrackIndex = libraryController.firstTrackIndexFromRandomAlbumFolder();
        void loadTrack(startingTrackIndex);
    }

    updatePlayButton();
    playlistController.refreshOpenModal();
};

settingsController = createSettingsController({
    trigger: librarySettings,
    elements: settingsElements,
    getValues: () => ({
        libraryPath: currentSettings.libraryPath,
        listenBrainzUserToken: currentSettings.listenBrainzUserToken,
        releaseDepth: asReleaseDepth(currentSettings.releaseDepth),
        favoritePlaylists: currentSettings.favoritePlaylists,
        preferMusicBrainzMetadata: currentSettings.preferMusicBrainzMetadata,
    }),
    selectLibraryFolder: SelectLibraryFolder,
    selectPlaylistFile: SelectPlaylistFile,
    save: async ({
        libraryPath: requestedLibraryPath,
        listenBrainzUserToken,
        releaseDepth,
        favoritePlaylists,
        preferMusicBrainzMetadata,
    }): Promise<void> => {
        try {
            const savedSettings = await SaveSettings({
                libraryPath: requestedLibraryPath,
                listenBrainzUserToken,
                playbackOrder: playbackSequencingService.getPlaybackOrderMode(),
                releaseDepth: asReleaseDepth(releaseDepth),
                favoritePlaylists,
                preferMusicBrainzMetadata,
            }) as AppSettings;

            currentSettings = {
                libraryPath: savedSettings.libraryPath || '',
                listenBrainzUserToken: savedSettings.listenBrainzUserToken || '',
                playbackOrder: asPlaybackOrderMode(savedSettings.playbackOrder || ''),
                releaseDepth: asReleaseDepth(savedSettings.releaseDepth),
                favoritePlaylists: Array.isArray(savedSettings.favoritePlaylists) ? savedSettings.favoritePlaylists : [],
                preferMusicBrainzMetadata: !!savedSettings.preferMusicBrainzMetadata,
            };
            setPlaybackOrderMode(currentSettings.playbackOrder);

            playlistController.refreshFavorites();

            resetShuffleHistory();

            await applyLibraryPath(savedSettings.libraryPath || '');
        } catch (error) {
            console.error(error);
            libraryController.setLibraryPathMessage('Unable to save settings.');
        }
    },
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
    ensureTrackTagsResolved,
    selectPlaylistFile: SelectPlaylistFile,
    selectPlaylistSaveFile: SelectPlaylistSaveFile,
    loadPlaylistData,
    savePlaylistData: (playlistPath: string, trackPaths: string[]) => SavePlaylistFile(playlistPath, trackPaths),
    getFavoritePlaylists: () => currentSettings.favoritePlaylists,
    onTrackChosen: async (index: number): Promise<void> => {
        await loadTrack(index);
        await playCurrentTrack();
    },
    onExternalPlaylistLoaded: () => {
        resetShuffleHistory();
    },
});

imageModalController = createImageModalController({
    elements: imageModalElements,
    readFileBase64: ReadFileBase64,
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
    )),
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
    getTracks: () => tracks,
    getTextFiles: () => textFiles,
    getImageFiles: () => imageFiles,
    getCurrentTrackIndex: () => currentTrackIndex,
    onTrackChosen: (index: number) => {
        void loadTrack(index).then(() => {
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
    onQueueRequested: (clientX: number, clientY: number, trackIndexes: number[]) => {
        openSidebarQueueMenu(clientX, clientY, trackIndexes);
    },
    onSidebarClosed: () => {
        closeSidebarQueueMenu();
    },
});

coverFrame.addEventListener('click', () => {
    openCoverImageModal();
});

coverFrame.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    setCoverFlipped(!coverFlipped);
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

libraryAbout.addEventListener('click', () => {
    openAboutModal();
});

sidebarQueueAddNext.addEventListener('click', () => {
    if (sidebarQueueTrackIndexes.length === 0) {
        return;
    }

    playlistController.addToQueueNext(sidebarQueueTrackIndexes);
    closeSidebarQueueMenu();
});

sidebarQueueEnd.addEventListener('click', () => {
    if (sidebarQueueTrackIndexes.length === 0) {
        return;
    }

    playlistController.addToQueueEnd(sidebarQueueTrackIndexes);
    closeSidebarQueueMenu();
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
imageModalElements.imageFileBackdrop.addEventListener('click', suppressTrackMetaClicks);

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }

    if (playlistController.handleEscape()) {
        return;
    }

    if (settingsController.handleEscape()) {
        return;
    }

    if (!sidebarQueueMenu.hidden) {
        closeSidebarQueueMenu();
        return;
    }

    if (!musicBrainzEntityModal.hidden) {
        closeMusicBrainzEntityModal();
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
});

playPause.addEventListener('click', () => {
    const playbackState = playbackStateService.getPlaybackState();
    if (!playbackState.playing) {
        void playCurrentTrack();
        return;
    }

    void pauseCurrentTrack();
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

    if (!volumeRow.contains(target)) {
        volumeRow.classList.remove('open');
    }

    if (playlistController.handleDocumentClick(target)) {
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

    if (!libraryController.isSidebarOpen()) {
        return;
    }

    if (clickPath.includes(librarySidebar) || clickPath.includes(sidebarToggle) || clickPath.includes(libraryAbout)) {
        return;
    }

    libraryController.setSidebarOpen(false);
});

document.addEventListener('contextmenu', (event) => {
    const target = event.target as Node;
    if (!sidebarQueueMenu.hidden && !sidebarQueueMenu.contains(target)) {
        closeSidebarQueueMenu();
    }

    if (trackTitle.contains(target) || trackAlbum.contains(target) || trackArtist.contains(target) || trackMetaMenu.contains(target)) {
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

    playlistController.closeMenu();
}, { capture: true });

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !playOrderMenu.hidden) {
        closePlayOrderMenu();
    }

    if (event.key === 'Escape' && !trackMetaMenu.hidden) {
        closeTrackMetaMenu();
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
    if (event.key === 'Control') {
        setCtrlHeldState(false);
    }
});

window.addEventListener('blur', () => {
    setCtrlHeldState(false);
});

window.addEventListener('resize', () => {
    updateLyricsPanelVisibility();
});

const cardResizeObserver = new ResizeObserver(() => {
    updateLyricsPanelVisibility();
});
cardResizeObserver.observe(playerCard);

EventsOn('silphium:library:scan-updated', (scanResult: LibraryScanResult) => {
    void handleLibraryScanUpdatedEvent(scanResult).catch((error) => {
        console.error(error);
    });
});

updatePlayButton();
updateTrackLabels();
updatePlayOrderMenuState();
libraryController.refreshSidebarToggleState();
refreshLyricsPanel();
void initializeBackendPlayback();
void initializeSettings();
void initializeAppVersion();
