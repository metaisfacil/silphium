import './style.css';
import './app.css';
import { getMediaControlsElements, renderMediaControls } from './components/media-controls';
import { getSidebarElements, renderSidebar } from './components/sidebar';
import {
    AudioGetState,
    AudioLoadTrack,
    AudioPause,
    AudioPlay,
    AudioSeek,
    AudioSetVolume,
    AudioStop,
    GetSettings,
    InitializeAudioBackend,
    LookupArtistByMBID,
    ReadFileBase64,
    ReadTextFile,
    ReadTrackTags,
    SaveSettings,
    ScanLibraryFolder,
    SelectLibraryFolder,
    SubmitListenBrainz,
} from '../wailsjs/go/main/App';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import { type MusicBrainzIds, applyMbLinks, openMbLink } from './musicbrainz';

type LibraryNode = {
    name: string;
    path: string;
    folders: LibraryNode[];
    trackIndexes: number[];
    textFileIndexes: number[];
};

type Track = {
    title: string;
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
    displayTitle: string;
    displayAlbum: string;
    displayArtist: string;
    displayTrackNumber: string;
    displayTrackTotal: string;
    displayTechnical: string;
    tagsResolved: boolean;
    mbIds: MusicBrainzIds;
    artistMbids: string[];
};

type TrackTags = {
    artist: string;
    album: string;
    title: string;
    trackNumber?: string;
    trackTotal?: string;
    bitDepth?: number;
    sampleRate?: number;
    codec?: string;
    recordingId?: string;
    releaseId?: string;
    artistId?: string;
    artistIds?: string[];
};

type ArtistDetails = {
    found: boolean;
    mbid: string;
    name: string;
    type: string;
    country: string;
    disambiguation: string;
    lifeSpan: string;
    genres: string[];
    urls?: ArtistExternalUrl[];
};

type ArtistExternalUrl = {
    type: string;
    resource: string;
};

type LibraryIndexedFile = {
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
};

type LibraryScanResult = {
    rootPath: string;
    rootName: string;
    trackFiles: LibraryIndexedFile[];
    textFiles: LibraryIndexedFile[];
    coverPathByFolder: Record<string, string>;
    totalEntries: number;
    truncated: boolean;
    entryLimit: number;
};

type TextLibraryFile = {
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
};

type AudioPlaybackState = {
    loaded: boolean;
    playing: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    sourcePath: string;
    endEventId: number;
};

type AppSettings = {
    libraryPath: string;
    listenBrainzUserToken: string;
    playbackOrder: PlaybackOrderMode;
};

type PlaybackOrderMode = 'ordered-album' | 'ordered-library' | 'shuffle-album' | 'shuffle-library';

const app = document.querySelector('#app');

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
                <div id="text-file-modal" class="text-file-modal" hidden>
                    <div id="text-file-backdrop" class="text-file-backdrop"></div>
                    <section class="text-file-dialog" role="dialog" aria-modal="true" aria-labelledby="text-file-title">
                        <header class="text-file-header">
                            <p id="text-file-title" class="text-file-title">Text file</p>
                            <button id="text-file-close" class="text-file-close" type="button" aria-label="Close text file">✕</button>
                        </header>
                        <pre class="text-file-content"><code id="text-file-code"></code></pre>
                    </section>
                </div>
                <div id="settings-modal" class="settings-modal" hidden>
                    <div id="settings-backdrop" class="settings-backdrop"></div>
                    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                        <header class="settings-header">
                            <p id="settings-title" class="settings-title">Settings</p>
                            <button id="settings-close" class="settings-close" type="button" aria-label="Close settings">✕</button>
                        </header>
                        <div class="settings-content">
                            <div class="settings-field">
                                <label class="settings-label" for="settings-library-path">Library Folder</label>
                                <p class="settings-hint">Choose the root library folder Silphium scans for files.</p>
                                <div class="settings-path-row">
                                    <input id="settings-library-path" class="settings-input" type="text" placeholder="No folder selected">
                                    <button id="settings-browse" class="settings-browse-btn" type="button" aria-label="Choose folder">...</button>
                                </div>
                            </div>
                            <div class="settings-field">
                                <label class="settings-label" for="settings-listenbrainz-token">ListenBrainz User Token</label>
                                <p class="settings-hint">Used to submit scrobbles to your ListenBrainz account.</p>
                                <input id="settings-listenbrainz-token" class="settings-input" type="password" placeholder="Optional">
                            </div>
                            <p id="settings-status" class="settings-status"></p>
                            <div class="settings-actions">
                                <button id="settings-save" class="upload-btn" type="button">Save</button>
                            </div>
                        </div>
                    </section>
                </div>
                <div id="play-order-menu" class="play-order-menu" role="menu" aria-label="Playback order" hidden>
                    <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-album">Ordered (album)</button>
                    <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-library">Ordered (library)</button>
                    <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-album">Shuffle (album)</button>
                    <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-library">Shuffle (library)</button>
                </div>
`;

let tracks: Track[] = [];
let textFiles: TextLibraryFile[] = [];
let currentTrackIndex = -1;
let objectUrls: string[] = [];
let sidebarOpen = false;
let libraryRootName = '';
let currentFolderPath = '';
let libraryIndexTruncated = false;
let tagRequestVersion = 0;
let artistInfoRequestVersion = 0;
let activeBackgroundLayer = 0;
let coverFlipped = false;
let playbackState: AudioPlaybackState = {
    loaded: false,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    sourcePath: '',
    endEventId: 0,
};
let playbackPollHandle: number | undefined;
let isSeeking = false;
let backendReady = false;
let lastHandledEndEventId = 0;
let currentSettings: AppSettings = { libraryPath: '', listenBrainzUserToken: '', playbackOrder: 'ordered-library' };
let scrobbleSessionId = 0;
let nowPlayingSubmittedSessionId = -1;
let scrobbleSubmittedSessionId = -1;
let nowPlayingInFlight = false;
let scrobbleInFlight = false;
let scrobbleSessionStartedAt = 0;
let playbackOrderMode: PlaybackOrderMode = 'ordered-library';
let shuffleHistory: number[] = [];
let shuffleCursor = -1;
let shuffleScopeKey = '';
const libraryNodeByPath = new Map<string, LibraryNode>();
const coverPathByFolder = new Map<string, string>();
const coverUrlByFolder = new Map<string, string>();
const artistInfoByMBID = new Map<string, ArtistDetails>();

const { sidebarToggle, librarySidebar, librarySettings, libraryBack, libraryPath, libraryBrowser } = getSidebarElements(document);
const {
    trackTitle,
    trackAlbum,
    trackPosition,
    trackArtist,
    trackTechnical,
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
    back,
    playPause,
    forward,
    volume,
} = getMediaControlsElements(document);
trackTitle.addEventListener('click', () => openMbLink(trackTitle));
trackAlbum.addEventListener('click', () => openMbLink(trackAlbum));
trackArtist.addEventListener('click', () => openMbLink(trackArtist));
const bgLayerA = document.getElementById('bg-layer-a') as HTMLDivElement;
const bgLayerB = document.getElementById('bg-layer-b') as HTMLDivElement;
const textFileModal = document.getElementById('text-file-modal') as HTMLDivElement;
const textFileBackdrop = document.getElementById('text-file-backdrop') as HTMLDivElement;
const textFileTitle = document.getElementById('text-file-title') as HTMLParagraphElement;
const textFileCode = document.getElementById('text-file-code') as HTMLElement;
const textFileClose = document.getElementById('text-file-close') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal') as HTMLDivElement;
const settingsBackdrop = document.getElementById('settings-backdrop') as HTMLDivElement;
const settingsClose = document.getElementById('settings-close') as HTMLButtonElement;
const settingsBrowse = document.getElementById('settings-browse') as HTMLButtonElement;
const settingsSave = document.getElementById('settings-save') as HTMLButtonElement;
const settingsLibraryPath = document.getElementById('settings-library-path') as HTMLInputElement;
const settingsListenBrainzToken = document.getElementById('settings-listenbrainz-token') as HTMLInputElement;
const settingsStatus = document.getElementById('settings-status') as HTMLParagraphElement;
const playOrderMenu = document.getElementById('play-order-menu') as HTMLDivElement;

const playbackOrderLabelByMode: Record<PlaybackOrderMode, string> = {
    'ordered-album': 'Ordered (album)',
    'ordered-library': 'Ordered (library)',
    'shuffle-album': 'Shuffle (album)',
    'shuffle-library': 'Shuffle (library)',
};

const asPlaybackOrderMode = (value: string): PlaybackOrderMode => {
    if (value === 'ordered-album' || value === 'ordered-library' || value === 'shuffle-album' || value === 'shuffle-library') {
        return value;
    }

    return 'ordered-library';
};

const setLibraryPathLabel = (): void => {
    const partialSuffix = libraryIndexTruncated ? ' (partial)' : '';
    const formattedFolderPath = currentFolderPath
        .split('/')
        .filter((segment) => segment !== '')
        .join(' / ');

    if (!libraryRootName) {
        libraryPath.textContent = 'No folder selected';
        libraryBack.disabled = true;
        return;
    }

    if (!currentFolderPath) {
        libraryPath.textContent = `${libraryRootName}${partialSuffix}`;
        libraryBack.disabled = true;
        return;
    }

    libraryPath.textContent = `${libraryRootName}${partialSuffix} / ${formattedFolderPath}`;
    libraryBack.disabled = false;
};

const createFolderPane = (node: LibraryNode): HTMLUListElement => {
    const pane = document.createElement('ul');
    pane.className = 'library-list-pane';

    const folderRows = node.folders
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
        .map((folder) => `<li><button class="library-entry folder" data-folder-path="${folder.path}">📁 ${folder.name}</button></li>`)
        .join('');

    const trackRows = node.trackIndexes
        .map((trackIndex) => ({ trackIndex, track: tracks[trackIndex] }))
        .sort((left, right) => left.track.title.localeCompare(right.track.title, undefined, { sensitivity: 'base' }))
        .map(({ trackIndex, track }) => `<li><button class="library-entry track${trackIndex === currentTrackIndex ? ' active' : ''}" data-track-index="${trackIndex}">🎵 ${track.title}</button></li>`)
        .join('');

    const textRows = node.textFileIndexes
        .map((textFileIndex) => ({ textFileIndex, file: textFiles[textFileIndex] }))
        .sort((left, right) => left.file.name.localeCompare(right.file.name, undefined, { sensitivity: 'base' }))
        .map(({ textFileIndex, file }) => `<li><button class="library-entry text-file" data-text-file-index="${textFileIndex}">📄 ${file.name}</button></li>`)
        .join('');

    const content = `${folderRows}${trackRows}${textRows}`;
    if (!content) {
        pane.innerHTML = '<li class="empty">Folder is empty</li>';
        return pane;
    }

    pane.innerHTML = content;
    return pane;
};

const renderFolder = (direction: 'none' | 'forward' | 'back'): void => {
    const node = libraryNodeByPath.get(currentFolderPath);
    if (!node) {
        setLibraryPathLabel();
        libraryBrowser.innerHTML = '';
        return;
    }

    const nextPane = createFolderPane(node);
    const currentPane = libraryBrowser.querySelector('.library-list-pane.current') as HTMLUListElement | null;
    setLibraryPathLabel();

    if (!currentPane || direction === 'none') {
        libraryBrowser.innerHTML = '';
        nextPane.classList.add('current');
        libraryBrowser.append(nextPane);
        return;
    }

    nextPane.classList.add('current');
    if (direction === 'forward') {
        nextPane.classList.add('from-right');
        currentPane.classList.add('to-left');
    } else {
        nextPane.classList.add('from-left');
        currentPane.classList.add('to-right');
    }

    libraryBrowser.append(nextPane);

    requestAnimationFrame(() => {
        nextPane.classList.remove('from-right', 'from-left');
    });

    const cleanup = (): void => {
        currentPane.remove();
    };

    nextPane.addEventListener('transitionend', cleanup, { once: true });
    window.setTimeout(cleanup, 260);
};

const formatTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }

    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

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

const buildListenBrainzMetadata = (track: Track): { artistName: string; trackName: string; releaseName: string; recordingMbid?: string; releaseMbid?: string; artistMbids?: string[] } => ({
    artistName: track.displayArtist || 'Unknown Artist',
    trackName: track.displayTitle || track.title,
    releaseName: track.displayAlbum || 'Unknown Album',
    recordingMbid: track.mbIds.recordingId || undefined,
    releaseMbid: track.mbIds.releaseId || undefined,
    artistMbids: track.artistMbids.length > 0 ? track.artistMbids : undefined,
});

const scrobbleThreshold = (duration: number): number => {
    if (!Number.isFinite(duration) || duration <= 0) {
        return Number.POSITIVE_INFINITY;
    }

    return Math.min(duration / 2, 240);
};

const maybeSubmitListenBrainz = (state: AudioPlaybackState): void => {
    if (!canScrobble()) {
        return;
    }

    const track = currentTrackForPlaybackState(state);
    if (!track) {
        return;
    }

    if (state.playing && scrobbleSessionStartedAt <= 0) {
        scrobbleSessionStartedAt = Math.floor(Date.now() / 1000);
    }

    if (state.playing && nowPlayingSubmittedSessionId !== scrobbleSessionId && !nowPlayingInFlight) {
        nowPlayingInFlight = true;
        void SubmitListenBrainz('playing_now', buildListenBrainzMetadata(track), 0)
            .then(() => {
                nowPlayingSubmittedSessionId = scrobbleSessionId;
            })
            .catch((error) => {
                console.error(error);
            })
            .finally(() => {
                nowPlayingInFlight = false;
            });
    }

    if (scrobbleSubmittedSessionId === scrobbleSessionId || scrobbleInFlight) {
        return;
    }

    const threshold = scrobbleThreshold(state.duration);
    if (state.currentTime < threshold) {
        return;
    }

    const listenedAt = scrobbleSessionStartedAt > 0 ? scrobbleSessionStartedAt : Math.floor(Date.now() / 1000);
    scrobbleInFlight = true;
    void SubmitListenBrainz('single', buildListenBrainzMetadata(track), listenedAt)
        .then(() => {
            scrobbleSubmittedSessionId = scrobbleSessionId;
        })
        .catch((error) => {
            console.error(error);
        })
        .finally(() => {
            scrobbleInFlight = false;
        });
};

const updatePlayButton = (): void => {
    playPause.textContent = playbackState.playing ? '⏸' : '▶';
    playPause.dataset.state = playbackState.playing ? 'pause' : 'play';
    playPause.setAttribute('aria-label', playbackState.playing ? 'Pause' : 'Play');
};

const updateTrackLabels = (): void => {
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
    if (!libraryRootName) {
        libraryPath.textContent = message;
    }
};

const maybeHandleTrackEnded = (state: AudioPlaybackState): void => {
    if (state.endEventId <= lastHandledEndEventId || tracks.length === 0) {
        return;
    }

    lastHandledEndEventId = state.endEventId;
    goToTrack(1);
};

const applyPlaybackState = (nextState: AudioPlaybackState): void => {
    playbackState = nextState;
    updateTrackLabels();
    updatePlayButton();
    maybeSubmitListenBrainz(nextState);
    maybeHandleTrackEnded(nextState);
};

const syncPlaybackState = async (): Promise<void> => {
    if (!backendReady) {
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
        backendReady = true;
        applyPlaybackState(initialState);
        volume.value = String(initialState.volume);
        startPlaybackPolling();
    } catch (error) {
        backendReady = false;
        handleAudioError(error);
    }
};

const base64ToObjectUrl = (base64: string, mimeType: string): string => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
};

const mimeTypeForFileName = (name: string): string => {
    if (/\.jpe?g$/i.test(name)) {
        return 'image/jpeg';
    }

    return 'application/octet-stream';
};

const folderKeyForPath = (folderPath: string): string => folderPath.toLowerCase();
const silentTrackDurationThresholdSeconds = 30;

const buildDisplayMetadata = (track: Track, tags?: TrackTags): { title: string; album: string; artist: string } => {
    const title = tags?.title?.trim() ? tags.title.trim() : track.title;
    const album = tags?.album?.trim() ? tags.album.trim() : 'Unknown Album';
    const artist = tags?.artist?.trim() ? tags.artist.trim() : 'Unknown Artist';

    return { title, album, artist };
};

const taggedTrackPosition = (track: Track): string => {
    const number = track.displayTrackNumber.trim();
    const total = track.displayTrackTotal.trim();

    if (!number) {
        return '';
    }

    if (!total) {
        return `(${number})`;
    }

    return `(${number}/${total})`;
};

const formatTechnicalMetadata = (bitDepth?: number, sampleRate?: number, codec?: string): string => {
    const hasBitDepth = Number.isFinite(bitDepth) && (bitDepth as number) > 0;
    const hasSampleRate = Number.isFinite(sampleRate) && (sampleRate as number) > 0;
    const codecLabel = (codec || '').trim().toUpperCase();

    let rateLabel = '';
    if (hasSampleRate) {
        const rateKhz = (sampleRate as number) / 1000;
        rateLabel = Number.isInteger(rateKhz) ? String(rateKhz) : rateKhz.toFixed(1).replace(/\.0$/, '');
    }

    const technicalParts: string[] = [];
    if (hasBitDepth || hasSampleRate) {
        const depthLabel = hasBitDepth ? String(bitDepth) : '?';
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

    return `${technicalParts[0]} ‣ ${technicalParts[1]}`;
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
    trackTechnical.textContent = activeTrack.displayTechnical;
    applyMbLinks(trackTitle, trackAlbum, trackArtist, activeTrack.mbIds);
};

const ensureTrackTagsResolved = async (index: number): Promise<void> => {
    if (index < 0 || index >= tracks.length) {
        return;
    }

    const track = tracks[index];
    if (track.tagsResolved) {
        return;
    }

    try {
        const tagByPath = await ReadTrackTags([track.path]);
        const tags = tagByPath[track.path] as TrackTags | undefined;
        const metadata = buildDisplayMetadata(tracks[index], tags);
        tracks[index] = {
            ...tracks[index],
            displayTitle: metadata.title,
            displayAlbum: metadata.album,
            displayArtist: metadata.artist,
            displayTrackNumber: tags?.trackNumber?.trim() || '',
            displayTrackTotal: tags?.trackTotal?.trim() || '',
            displayTechnical: formatTechnicalMetadata(tags?.bitDepth, tags?.sampleRate, tags?.codec),
            tagsResolved: true,
            mbIds: {
                recordingId: tags?.recordingId || undefined,
                releaseId: tags?.releaseId || undefined,
                artistId: tags?.artistIds?.[0] || tags?.artistId || undefined,
            },
            artistMbids: (tags?.artistIds && tags.artistIds.length > 0)
                ? tags.artistIds
                : (tags?.artistId ? [tags.artistId] : []),
        };

        if (index === currentTrackIndex) {
            refreshNowPlayingLabel();
        }
    } catch (error) {
        console.error(error);
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

const albumScopeKeyForTrack = (track: Track): string => `folder::${track.folderPath.toLowerCase()}`;

const orderedTrackIndexesForScope = (): number[] => {
    if (tracks.length === 0) {
        return [];
    }

    if (playbackOrderMode === 'ordered-library' || playbackOrderMode === 'shuffle-library') {
        return tracks.map((_, index) => index);
    }

    const current = tracks[currentTrackIndex];
    if (!current) {
        return [];
    }

    const albumScopeKey = albumScopeKeyForTrack(current);
    return tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => albumScopeKeyForTrack(track) === albumScopeKey)
        .sort((left, right) => {
            return left.track.name.localeCompare(right.track.name, undefined, {
                sensitivity: 'base',
                numeric: true,
            });
        })
        .map(({ index }) => index);
};

const isShuffleMode = (): boolean => playbackOrderMode === 'shuffle-album' || playbackOrderMode === 'shuffle-library';

const currentShuffleScopeKey = (): string => {
    if (playbackOrderMode === 'shuffle-library') {
        return 'library';
    }

    const current = tracks[currentTrackIndex];
    if (!current) {
        return 'album::none';
    }

    return `album::${albumScopeKeyForTrack(current)}`;
};

const resetShuffleHistory = (): void => {
    shuffleHistory = [];
    shuffleCursor = -1;
    shuffleScopeKey = '';
};

const pickRandomTrackIndex = (candidates: number[], currentIndex: number): number => {
    if (candidates.length === 0) {
        return currentIndex;
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    const withoutCurrent = candidates.filter((index) => index !== currentIndex);
    const pool = withoutCurrent.length > 0 ? withoutCurrent : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
};

const nextTrackIndexForDirection = (direction: -1 | 1): number | undefined => {
    const orderedIndexes = orderedTrackIndexesForScope();
    if (orderedIndexes.length === 0) {
        return undefined;
    }

    if (!isShuffleMode()) {
        const currentPosition = orderedIndexes.indexOf(currentTrackIndex);
        if (currentPosition < 0) {
            return orderedIndexes[0];
        }

        const nextPosition = (currentPosition + direction + orderedIndexes.length) % orderedIndexes.length;
        return orderedIndexes[nextPosition];
    }

    const scopeKey = currentShuffleScopeKey();
    if (shuffleScopeKey !== scopeKey) {
        shuffleScopeKey = scopeKey;
        shuffleHistory = [];
        shuffleCursor = -1;
    }

    if (shuffleCursor < 0) {
        shuffleHistory.push(currentTrackIndex >= 0 ? currentTrackIndex : orderedIndexes[0]);
        shuffleCursor = 0;
    }

    if (direction < 0) {
        if (shuffleCursor > 0) {
            shuffleCursor -= 1;
        }

        return shuffleHistory[shuffleCursor];
    }

    if (shuffleCursor < shuffleHistory.length - 1) {
        shuffleCursor += 1;
        return shuffleHistory[shuffleCursor];
    }

    const currentIndex = shuffleHistory[shuffleCursor];
    const nextIndex = pickRandomTrackIndex(orderedIndexes, currentIndex);
    shuffleHistory.push(nextIndex);
    shuffleCursor += 1;
    return nextIndex;
};

const closePlayOrderMenu = (): void => {
    playOrderMenu.hidden = true;
};

const updatePlayOrderMenuState = (): void => {
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

    playPause.title = `Playback order: ${playbackOrderLabelByMode[playbackOrderMode]} (right-click to change)`;
};

const openPlayOrderMenu = (clientX: number, clientY: number): void => {
    updatePlayOrderMenuState();
    playOrderMenu.hidden = false;

    const margin = 10;
    const rect = playOrderMenu.getBoundingClientRect();
    const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
    const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

    playOrderMenu.style.left = `${Math.max(margin, clampedX)}px`;
    playOrderMenu.style.top = `${Math.max(margin, clampedY)}px`;
};

const faviconUrlForResource = (resource: string): string | undefined => {
    try {
        const { hostname } = new URL(resource);
        if (!hostname) {
            return undefined;
        }

        return `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(`https://${hostname}`)}`;
    } catch {
        return undefined;
    }
};

const renderArtistUrlIcons = (urls?: ArtistExternalUrl[]): void => {
    artistInfoLinks.innerHTML = '';

    if (!urls || urls.length === 0) {
        artistInfoLinks.hidden = true;
        return;
    }

    artistInfoLinks.hidden = false;
    for (const url of urls) {
        const button = document.createElement('button');
        button.className = 'artist-link-btn';
        button.type = 'button';

        const fallback = document.createElement('span');
        fallback.className = 'artist-link-fallback';
        fallback.textContent = '🔗';

        const faviconUrl = faviconUrlForResource(url.resource);
        if (faviconUrl) {
            const icon = document.createElement('img');
            icon.className = 'artist-link-icon';
            icon.alt = '';
            icon.loading = 'lazy';
            icon.decoding = 'async';
            icon.referrerPolicy = 'no-referrer';
            icon.src = faviconUrl;
            icon.addEventListener('error', () => {
                icon.remove();
                fallback.hidden = false;
            });
            fallback.hidden = true;
            button.append(icon, fallback);
        } else {
            fallback.hidden = false;
            button.append(fallback);
        }

        button.title = `${url.type || 'Link'}: ${url.resource}`;
        button.setAttribute('aria-label', button.title);
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            void BrowserOpenURL(url.resource);
        });
        artistInfoLinks.append(button);
    }
};

const resetArtistInfoPanel = (): void => {
    artistInfoName.textContent = 'No artist info';
    artistInfoType.textContent = 'Type: —';
    artistInfoCountry.textContent = 'Country: —';
    artistInfoLifeSpan.textContent = 'Life span: —';
    artistInfoGenres.textContent = 'Genres: —';
    artistInfoSummary.textContent = 'Flip back after MBID lookup to see details.';
    renderArtistUrlIcons();
};

const renderArtistInfoPanel = (details: ArtistDetails): void => {
    artistInfoName.textContent = details.name || 'No artist info';
    artistInfoType.textContent = `Type: ${details.type || '—'}`;
    artistInfoCountry.textContent = `Country: ${details.country || '—'}`;
    artistInfoLifeSpan.textContent = `Life span: ${details.lifeSpan || '—'}`;
    artistInfoGenres.textContent = `Genres: ${details.genres?.length ? details.genres.join(', ') : '—'}`;
    artistInfoSummary.textContent = details.disambiguation || 'Artist information from MusicBrainz.';
    renderArtistUrlIcons(details.urls);
};

const hydrateCurrentArtistInfo = async (index: number, version: number): Promise<void> => {
    if (index < 0 || index >= tracks.length) {
        return;
    }

    const mbid = tracks[index].artistMbids[0];
    if (!mbid) {
        resetArtistInfoPanel();
        return;
    }

    const cached = artistInfoByMBID.get(mbid);
    if (cached) {
        renderArtistInfoPanel(cached);
        return;
    }

    artistInfoSummary.textContent = 'Loading artist details from MusicBrainz…';

    try {
        const details = await LookupArtistByMBID(mbid) as ArtistDetails;
        if (version !== artistInfoRequestVersion || index !== currentTrackIndex) {
            return;
        }

        if (!details.found) {
            artistInfoSummary.textContent = 'No artist details found for this MBID.';
            return;
        }

        artistInfoByMBID.set(mbid, details);
        renderArtistInfoPanel(details);
    } catch (error) {
        console.error(error);
        if (version === artistInfoRequestVersion && index === currentTrackIndex) {
            artistInfoSummary.textContent = 'Unable to load artist details right now.';
        }
    }
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
    if (index < 0 || index >= tracks.length) {
        return;
    }

    const track = tracks[index];
    if (track.tagsResolved) {
        return;
    }

    try {
        const tagByPath = await ReadTrackTags([track.path]);
        if (version !== tagRequestVersion) {
            return;
        }

        const tags = tagByPath[track.path] as TrackTags | undefined;
        const metadata = buildDisplayMetadata(tracks[index], tags);
        tracks[index] = {
            ...tracks[index],
            displayTitle: metadata.title,
            displayAlbum: metadata.album,
            displayArtist: metadata.artist,
            displayTrackNumber: tags?.trackNumber?.trim() || '',
            displayTrackTotal: tags?.trackTotal?.trim() || '',
            displayTechnical: formatTechnicalMetadata(tags?.bitDepth, tags?.sampleRate, tags?.codec),
            tagsResolved: true,
            mbIds: {
                recordingId: tags?.recordingId || undefined,
                releaseId: tags?.releaseId || undefined,
                artistId: tags?.artistIds?.[0] || tags?.artistId || undefined,
            },
            artistMbids: (tags?.artistIds && tags.artistIds.length > 0)
                ? tags.artistIds
                : (tags?.artistId ? [tags.artistId] : []),
        };

        if (index === currentTrackIndex) {
            refreshNowPlayingLabel();
            renderFolder('none');
            artistInfoRequestVersion += 1;
            void hydrateCurrentArtistInfo(index, artistInfoRequestVersion);
        }
    } catch (error) {
        console.error(error);
    }
};

const closeTextFileModal = (): void => {
    textFileModal.hidden = true;
    textFileCode.textContent = '';
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

const closeSettingsModal = (): void => {
    settingsModal.hidden = true;
    settingsStatus.textContent = '';
};

const openSettingsModal = (): void => {
    settingsLibraryPath.value = currentSettings.libraryPath || '';
    settingsListenBrainzToken.value = currentSettings.listenBrainzUserToken || '';
    settingsStatus.textContent = '';
    settingsModal.hidden = false;
    settingsLibraryPath.focus();
};

const clearLibrarySelection = async (): Promise<void> => {
    try {
        const nextState = await AudioStop() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }

    for (const url of objectUrls) {
        URL.revokeObjectURL(url);
    }

    objectUrls = [];
    coverPathByFolder.clear();
    coverUrlByFolder.clear();
    artistInfoByMBID.clear();
    libraryNodeByPath.clear();
    tracks = [];
    textFiles = [];

    currentTrackIndex = -1;
    libraryRootName = '';
    currentFolderPath = '';
    libraryIndexTruncated = false;
    scrobbleSessionId = 0;
    nowPlayingSubmittedSessionId = -1;
    scrobbleSubmittedSessionId = -1;
    scrobbleSessionStartedAt = 0;
    resetShuffleHistory();

    trackTitle.textContent = 'No track loaded';
    trackAlbum.textContent = 'Unknown Album';
    trackPosition.textContent = '';
    trackArtist.textContent = 'Unknown Artist';
    trackTechnical.textContent = '';
    applyMbLinks(trackTitle, trackAlbum, trackArtist, {});

    coverArt.removeAttribute('src');
    coverArt.classList.remove('is-visible');
    setBackgroundCover();
    setCoverFlipped(false);
    resetArtistInfoPanel();
    renderFolder('none');
};

const applyLibraryPath = async (selectedPath: string): Promise<void> => {
    const cleanPath = selectedPath.trim();
    if (!cleanPath) {
        await clearLibrarySelection();
        return;
    }

    libraryPath.textContent = 'Scanning folder…';
    const scanResult = await ScanLibraryFolder(cleanPath) as LibraryScanResult;
    await loadLibraryScan(scanResult);
};

const initializeSettings = async (): Promise<void> => {
    try {
        const settings = await GetSettings() as AppSettings;
        currentSettings = {
            libraryPath: settings.libraryPath || '',
            listenBrainzUserToken: settings.listenBrainzUserToken || '',
            playbackOrder: asPlaybackOrderMode(settings.playbackOrder || ''),
        };
        setPlaybackOrderMode(currentSettings.playbackOrder);
        settingsLibraryPath.value = settings.libraryPath || '';
        settingsListenBrainzToken.value = settings.listenBrainzUserToken || '';

        if (settings.libraryPath) {
            await applyLibraryPath(settings.libraryPath);
            return;
        }
    } catch (error) {
        console.error(error);
    }

    renderFolder('none');
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

const loadTrack = async (index: number): Promise<void> => {
    if (index < 0 || index >= tracks.length) {
        return;
    }

    currentTrackIndex = index;
    setCoverFlipped(false);
    scrobbleSessionId += 1;
    nowPlayingSubmittedSessionId = -1;
    scrobbleSubmittedSessionId = -1;
    scrobbleSessionStartedAt = 0;
    const track = tracks[currentTrackIndex];

    try {
        const nextState = await AudioLoadTrack(track.path) as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
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

    renderFolder('none');

    tagRequestVersion += 1;
    void hydrateCurrentTrackTag(index, tagRequestVersion);

    artistInfoRequestVersion += 1;
    void hydrateCurrentArtistInfo(index, artistInfoRequestVersion);
};

const playCurrentTrack = async (): Promise<void> => {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        await loadTrack(0);
    }

    if (currentTrackIndex === -1 || !backendReady) {
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
    if (!backendReady) {
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
    if (playbackOrderMode === nextMode) {
        return;
    }

    playbackOrderMode = nextMode;
    currentSettings.playbackOrder = nextMode;
    resetShuffleHistory();
    updatePlayOrderMenuState();
};

const savePlaybackOrderSetting = async (): Promise<void> => {
    try {
        const savedSettings = await SaveSettings({
            libraryPath: currentSettings.libraryPath,
            listenBrainzUserToken: currentSettings.listenBrainzUserToken,
            playbackOrder: playbackOrderMode,
        }) as AppSettings;

        currentSettings = {
            libraryPath: savedSettings.libraryPath || '',
            listenBrainzUserToken: savedSettings.listenBrainzUserToken || '',
            playbackOrder: asPlaybackOrderMode(savedSettings.playbackOrder || ''),
        };
    } catch (error) {
        console.error(error);
    }
};

const loadLibraryScan = async (scanResult: LibraryScanResult): Promise<void> => {
    if (!scanResult.rootPath) {
        return;
    }

    try {
        const nextState = await AudioStop() as AudioPlaybackState;
        applyPlaybackState(nextState);
    } catch (error) {
        handleAudioError(error);
    }

    for (const url of objectUrls) {
        URL.revokeObjectURL(url);
    }
    objectUrls = [];
    coverPathByFolder.clear();
    coverUrlByFolder.clear();
    artistInfoByMBID.clear();
    libraryNodeByPath.clear();
    tracks = [];
    textFiles = [];

    for (const [folder, coverPath] of Object.entries(scanResult.coverPathByFolder || {})) {
        coverPathByFolder.set(folder, coverPath);
    }

    libraryRootName = scanResult.rootName || 'Selected folder';
    libraryIndexTruncated = scanResult.truncated;

    tracks = (scanResult.trackFiles || [])
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }))
        .map((file) => ({
            title: file.name,
            name: file.name,
            path: file.path,
            relativePath: file.relativePath,
            folderPath: file.folderPath,
            displayTitle: file.name,
            displayAlbum: 'Unknown Album',
            displayArtist: 'Unknown Artist',
            displayTrackNumber: '',
            displayTrackTotal: '',
            displayTechnical: '',
            tagsResolved: false,
            mbIds: {},
            artistMbids: [],
        }));

    textFiles = (scanResult.textFiles || [])
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' }))
        .map((file) => ({
            name: file.name,
            path: file.path,
            relativePath: file.relativePath,
            folderPath: file.folderPath,
        }));

    const rootNode: LibraryNode = {
        name: libraryRootName,
        path: '',
        folders: [],
        trackIndexes: [],
        textFileIndexes: [],
    };
    libraryNodeByPath.set('', rootNode);

    const getOrCreateFolder = (path: string, name: string, parent: LibraryNode): LibraryNode => {
        const existing = libraryNodeByPath.get(path);
        if (existing) {
            return existing;
        }

        const created: LibraryNode = {
            name,
            path,
            folders: [],
            trackIndexes: [],
            textFileIndexes: [],
        };
        libraryNodeByPath.set(path, created);
        parent.folders.push(created);
        return created;
    };

    tracks.forEach((track, index) => {
        const segments = track.folderPath ? track.folderPath.split('/') : [];
        let parent = rootNode;
        let cumulativePath = '';

        for (const segment of segments) {
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            parent = getOrCreateFolder(cumulativePath, segment, parent);
        }

        parent.trackIndexes.push(index);
    });

    textFiles.forEach((textFile, index) => {
        const segments = textFile.folderPath ? textFile.folderPath.split('/') : [];
        let parent = rootNode;
        let cumulativePath = '';

        for (const segment of segments) {
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            parent = getOrCreateFolder(cumulativePath, segment, parent);
        }

        parent.textFileIndexes.push(index);
    });

    if (tracks.length === 0) {
        currentTrackIndex = -1;
        currentFolderPath = '';
        trackTitle.textContent = 'No audio tracks found';
        trackAlbum.textContent = 'Unknown Album';
        trackPosition.textContent = '';
        trackArtist.textContent = 'Unknown Artist';
        trackTechnical.textContent = '';
        coverArt.removeAttribute('src');
        coverArt.classList.remove('is-visible');
        setBackgroundCover();
        setCoverFlipped(false);
        resetArtistInfoPanel();
        renderFolder('none');
        return;
    }

    currentFolderPath = '';
    renderFolder('none');
    resetShuffleHistory();
    void loadTrack(0);

    updatePlayButton();
};

coverFrame.addEventListener('click', () => {
    setCoverFlipped(!coverFlipped);
});

coverFrame.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
        return;
    }

    event.preventDefault();
    setCoverFlipped(!coverFlipped);
});

librarySettings.addEventListener('click', () => {
    openSettingsModal();
});

settingsBackdrop.addEventListener('click', () => {
    closeSettingsModal();
});

settingsClose.addEventListener('click', () => {
    closeSettingsModal();
});

settingsBrowse.addEventListener('click', async () => {
    settingsStatus.textContent = '';

    try {
        const selectedFolder = await SelectLibraryFolder();
        if (!selectedFolder) {
            return;
        }

        settingsLibraryPath.value = selectedFolder;
    } catch (error) {
        console.error(error);
        settingsStatus.textContent = 'Unable to open folder picker.';
    }
});

settingsSave.addEventListener('click', async () => {
    if (settingsSave.disabled) {
        return;
    }

    settingsSave.disabled = true;
    const requestedLibraryPath = settingsLibraryPath.value;
    closeSettingsModal();

    try {
        const savedSettings = await SaveSettings({
            libraryPath: requestedLibraryPath,
            listenBrainzUserToken: settingsListenBrainzToken.value,
            playbackOrder: playbackOrderMode,
        }) as AppSettings;

        currentSettings = {
            libraryPath: savedSettings.libraryPath || '',
            listenBrainzUserToken: savedSettings.listenBrainzUserToken || '',
            playbackOrder: asPlaybackOrderMode(savedSettings.playbackOrder || ''),
        };
        settingsLibraryPath.value = savedSettings.libraryPath || '';

        await applyLibraryPath(savedSettings.libraryPath || '');
    } catch (error) {
        console.error(error);
        libraryPath.textContent = 'Unable to save settings.';
    } finally {
        settingsSave.disabled = false;
    }
});

sidebarToggle.addEventListener('click', () => {
    setSidebarOpen(!sidebarOpen);
});

const setSidebarOpen = (open: boolean): void => {
    sidebarOpen = open;
    app.classList.toggle('sidebar-open', sidebarOpen);
    sidebarToggle.textContent = '‣‣‣';
    sidebarToggle.setAttribute('aria-label', sidebarOpen ? 'Close library' : 'Open library');
    librarySidebar.setAttribute('aria-hidden', sidebarOpen ? 'false' : 'true');
};

libraryBrowser.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
        return;
    }

    const nextFolder = target.dataset.folderPath;
    if (nextFolder !== undefined) {
        currentFolderPath = nextFolder;
        renderFolder('forward');
        return;
    }

    const rawIndex = target.dataset.trackIndex;
    if (rawIndex !== undefined) {
        const index = Number(rawIndex);
        if (!Number.isInteger(index)) {
            return;
        }

        void loadTrack(index).then(() => {
            void playCurrentTrack();
        });
        return;
    }

    const rawTextFileIndex = target.dataset.textFileIndex;
    if (rawTextFileIndex === undefined) {
        return;
    }

    const textFileIndex = Number(rawTextFileIndex);
    if (!Number.isInteger(textFileIndex)) {
        return;
    }

    const textFile = textFiles[textFileIndex];
    if (!textFile) {
        return;
    }

    void openTextFileModal(textFile);
});

textFileBackdrop.addEventListener('click', () => {
    closeTextFileModal();
});

textFileClose.addEventListener('click', () => {
    closeTextFileModal();
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
        return;
    }

    if (!settingsModal.hidden) {
        closeSettingsModal();
        return;
    }

    if (!textFileModal.hidden) {
        closeTextFileModal();
    }
});

libraryBack.addEventListener('click', () => {
    if (!currentFolderPath) {
        return;
    }

    const segments = currentFolderPath.split('/');
    segments.pop();
    currentFolderPath = segments.join('/');
    renderFolder('back');
});

playPause.addEventListener('click', () => {
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

    if (!playOrderMenu.hidden && !playOrderMenu.contains(target)) {
        closePlayOrderMenu();
    }

    if (!volumeRow.contains(target)) {
        volumeRow.classList.remove('open');
    }

    if (settingsModal.contains(target)) {
        return;
    }

    if (!sidebarOpen) {
        return;
    }

    if (librarySidebar.contains(target) || sidebarToggle.contains(target)) {
        return;
    }

    setSidebarOpen(false);
});

document.addEventListener('scroll', () => {
    if (!playOrderMenu.hidden) {
        closePlayOrderMenu();
    }
}, { capture: true });

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !playOrderMenu.hidden) {
        closePlayOrderMenu();
    }
});

updatePlayButton();
updateTrackLabels();
updatePlayOrderMenuState();
void initializeBackendPlayback();
void initializeSettings();
