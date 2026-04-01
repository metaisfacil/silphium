import './style.css';
import './app.css';
import { getMediaControlsElements, renderMediaControls } from './components/media-controls';
import { getSidebarElements, renderSidebar } from './components/sidebar';
import { LookupArtistByMBID, ReadTrackTagsFromBlobs } from '../wailsjs/go/main/App';
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
    src: string;
    relativePath: string;
    folderPath: string;
    displayTitle: string;
    displayAlbum: string;
    displayArtist: string;
    sourceFile: File;
    tagsResolved: boolean;
    mbIds: MusicBrainzIds;
    artistMbids: string[];
};

type TrackTags = {
    artist: string;
    album: string;
    title: string;
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

type TrackBlobPayload = {
    key: string;
    name: string;
    data: string;
};

type TextLibraryFile = {
    name: string;
    relativePath: string;
    folderPath: string;
    sourceFile: File;
};

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
`;

const audio = new Audio();
audio.preload = 'metadata';
audio.volume = 0.8;

let tracks: Track[] = [];
let textFiles: TextLibraryFile[] = [];
let currentTrackIndex = -1;
let objectUrls: string[] = [];
let libraryFiles: File[] = [];
let sidebarOpen = false;
let libraryRootName = '';
let currentFolderPath = '';
let tagRequestVersion = 0;
let artistInfoRequestVersion = 0;
let activeBackgroundLayer = 0;
let coverFlipped = false;
const libraryNodeByPath = new Map<string, LibraryNode>();
const coverUrlByFolder = new Map<string, string>();
const artistInfoByMBID = new Map<string, ArtistDetails>();

const { sidebarToggle, librarySidebar, libraryUpload, libraryBack, libraryPath, libraryBrowser } = getSidebarElements(document);
const {
    trackTitle,
    trackAlbum,
    trackArtist,
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

const setLibraryPathLabel = (): void => {
    if (!libraryRootName) {
        libraryPath.textContent = 'No folder selected';
        libraryBack.disabled = true;
        return;
    }

    if (!currentFolderPath) {
        libraryPath.textContent = libraryRootName;
        libraryBack.disabled = true;
        return;
    }

    libraryPath.textContent = `${libraryRootName} / ${currentFolderPath}`;
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

const updatePlayButton = (): void => {
    playPause.textContent = audio.paused ? '▶' : '⏸';
    playPause.dataset.state = audio.paused ? 'play' : 'pause';
    playPause.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
};

const updateTrackLabels = (): void => {
    currentTimeLabel.textContent = formatTime(audio.currentTime);
    trackDurationLabel.textContent = formatTime(audio.duration);
    seek.max = Number.isFinite(audio.duration) ? String(audio.duration) : '0';
    seek.value = String(audio.currentTime);
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
};

const buildDisplayMetadata = (track: Track, tags?: TrackTags): { title: string; album: string; artist: string } => {
    const title = tags?.title?.trim() ? tags.title.trim() : track.title;
    const album = tags?.album?.trim() ? tags.album.trim() : 'Unknown Album';
    const artist = tags?.artist?.trim() ? tags.artist.trim() : 'Unknown Artist';

    return { title, album, artist };
};

const refreshNowPlayingLabel = (): void => {
    if (currentTrackIndex < 0 || currentTrackIndex >= tracks.length) {
        return;
    }

    const activeTrack = tracks[currentTrackIndex];
    trackTitle.textContent = activeTrack.displayTitle;
    trackAlbum.textContent = activeTrack.displayAlbum;
    trackArtist.textContent = activeTrack.displayArtist;
    applyMbLinks(trackTitle, trackAlbum, trackArtist, activeTrack.mbIds);
};

const setCoverFlipped = (flipped: boolean): void => {
    coverFlipped = flipped;
    coverFlipper.classList.toggle('is-flipped', flipped);
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
        const rawBuffer = await track.sourceFile.arrayBuffer();
        const payload: TrackBlobPayload[] = [{
            key: String(index),
            name: track.sourceFile.name,
            data: arrayBufferToBase64(rawBuffer),
        }];

        const tagByKey = await ReadTrackTagsFromBlobs(payload);
        if (version !== tagRequestVersion) {
            return;
        }

        const tags = tagByKey[String(index)] as TrackTags | undefined;
        const metadata = buildDisplayMetadata(tracks[index], tags);
        tracks[index] = {
            ...tracks[index],
            displayTitle: metadata.title,
            displayAlbum: metadata.album,
            displayArtist: metadata.artist,
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

const getFolderKey = (file: File): string => {
    if ('webkitRelativePath' in file && file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        parts.pop();
        return parts.join('/').toLowerCase();
    }

    return '';
};

const getRelativePath = (file: File): string => {
    if ('webkitRelativePath' in file && file.webkitRelativePath) {
        const segments = file.webkitRelativePath.split('/');
        segments.shift();
        return segments.join('/');
    }

    return file.name;
};

const getLibraryRootName = (files: File[]): string => {
    const firstWithPath = files.find((file) => file.webkitRelativePath && file.webkitRelativePath.includes('/'));
    if (!firstWithPath || !firstWithPath.webkitRelativePath) {
        return 'Selected folder';
    }

    return firstWithPath.webkitRelativePath.split('/')[0] || 'Selected folder';
};

const isAudioFile = (file: File): boolean => {
    if (/\.m3u8$/i.test(file.name)) {
        return false;
    }

    if (file.type.startsWith('audio/')) {
        return true;
    }

    return /\.(mp3|m4a|aac|wav|flac|ogg|opus)$/i.test(file.name);
};

const isTextLibraryFile = (file: File): boolean => /\.(txt|log)$/i.test(file.name);

const closeTextFileModal = (): void => {
    textFileModal.hidden = true;
    textFileCode.textContent = '';
};

const openTextFileModal = async (textFile: TextLibraryFile): Promise<void> => {
    textFileTitle.textContent = textFile.relativePath || textFile.name;
    textFileCode.textContent = 'Loading…';
    textFileModal.hidden = false;

    try {
        const content = await textFile.sourceFile.text();
        textFileCode.textContent = content;
    } catch (error) {
        console.error(error);
        textFileCode.textContent = 'Unable to read this file.';
    }
};

const isJpgFile = (file: File): boolean => {
    if (file.type === 'image/jpeg') {
        return true;
    }

    return /\.jpe?g$/i.test(file.name);
};

const resolveCoverForTrack = (track: Track): string | undefined => {
    const folderKey = getFolderKey(track.sourceFile);
    const cached = coverUrlByFolder.get(folderKey);
    if (cached) {
        return cached;
    }

    const imageFiles = libraryFiles
        .filter((file) => isJpgFile(file) && getFolderKey(file) === folderKey)
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

    const selectedCover = imageFiles.find((image) => image.name.toLowerCase() === 'cover.jpg')
        ?? imageFiles.find((image) => image.name.toLowerCase() === 'folder.jpg')
        ?? imageFiles.find((image) => /^albumart.*\.jpg$/i.test(image.name));

    if (!selectedCover) {
        return undefined;
    }

    const coverUrl = URL.createObjectURL(selectedCover);
    coverUrlByFolder.set(folderKey, coverUrl);
    objectUrls.push(coverUrl);
    return coverUrl;
};

const loadTrack = (index: number): void => {
    if (index < 0 || index >= tracks.length) {
        return;
    }

    currentTrackIndex = index;
    setCoverFlipped(false);
    const track = tracks[currentTrackIndex];
    audio.src = track.src;
    refreshNowPlayingLabel();
    const coverSrc = resolveCoverForTrack(track);
    if (coverSrc) {
        coverArt.src = coverSrc;
        coverArt.classList.add('is-visible');
        setBackgroundCover(coverSrc);
    } else {
        coverArt.removeAttribute('src');
        coverArt.classList.remove('is-visible');
        setBackgroundCover();
    }
    currentTimeLabel.textContent = '0:00';
    trackDurationLabel.textContent = '0:00';
    seek.value = '0';
    renderFolder('none');

    tagRequestVersion += 1;
    void hydrateCurrentTrackTag(index, tagRequestVersion);

    artistInfoRequestVersion += 1;
    void hydrateCurrentArtistInfo(index, artistInfoRequestVersion);
};

const playCurrentTrack = async (): Promise<void> => {
    if (currentTrackIndex === -1 && tracks.length > 0) {
        loadTrack(0);
    }

    if (currentTrackIndex === -1) {
        return;
    }

    try {
        await audio.play();
    } catch (error) {
        console.error(error);
    }
};

const goToTrack = (direction: -1 | 1): void => {
    if (tracks.length === 0) {
        return;
    }

    const nextIndex = (currentTrackIndex + direction + tracks.length) % tracks.length;
    loadTrack(nextIndex);
    void playCurrentTrack();
};

const loadLibraryFiles = (fileList: FileList): void => {
    if (fileList.length === 0) {
        return;
    }

    for (const url of objectUrls) {
        URL.revokeObjectURL(url);
    }
    objectUrls = [];
    coverUrlByFolder.clear();

    const allFiles = Array.from(fileList);
    libraryFiles = allFiles;
    libraryRootName = getLibraryRootName(allFiles);

    tracks = allFiles
        .filter((file) => isAudioFile(file))
        .sort((left, right) => getRelativePath(left).localeCompare(getRelativePath(right), undefined, { sensitivity: 'base' }))
        .map((file) => {
            const relativePath = getRelativePath(file);
            const parts = relativePath.split('/');
            parts.pop();
            const folderPath = parts.join('/');
            const src = URL.createObjectURL(file);
            objectUrls.push(src);

            return {
                title: file.name,
                src,
                relativePath,
                folderPath,
                displayTitle: file.name,
                displayAlbum: 'Unknown Album',
                displayArtist: 'Unknown Artist',
                sourceFile: file,
                tagsResolved: false,
                mbIds: {},
                artistMbids: [],
            };
        });

    textFiles = allFiles
        .filter((file) => isTextLibraryFile(file))
        .sort((left, right) => getRelativePath(left).localeCompare(getRelativePath(right), undefined, { sensitivity: 'base' }))
        .map((file) => {
            const relativePath = getRelativePath(file);
            const parts = relativePath.split('/');
            parts.pop();

            return {
                name: file.name,
                relativePath,
                folderPath: parts.join('/'),
                sourceFile: file,
            };
        });

    libraryNodeByPath.clear();
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
        trackArtist.textContent = 'Unknown Artist';
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
    loadTrack(0);
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

libraryUpload.addEventListener('change', () => {
    if (!libraryUpload.files) {
        return;
    }

    loadLibraryFiles(libraryUpload.files);
});

sidebarToggle.addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    app.classList.toggle('sidebar-open', sidebarOpen);
    sidebarToggle.textContent = sidebarOpen ? '←' : '→';
    sidebarToggle.setAttribute('aria-label', sidebarOpen ? 'Close library' : 'Open library');
    librarySidebar.setAttribute('aria-hidden', sidebarOpen ? 'false' : 'true');
});

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

        loadTrack(index);
        void playCurrentTrack();
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
    if (event.key === 'Escape' && !textFileModal.hidden) {
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
    if (audio.paused) {
        void playCurrentTrack();
        return;
    }

    audio.pause();
});

back.addEventListener('click', () => {
    goToTrack(-1);
});

forward.addEventListener('click', () => {
    goToTrack(1);
});

seek.addEventListener('input', () => {
    audio.currentTime = Number(seek.value);
    currentTimeLabel.textContent = formatTime(audio.currentTime);
});

volume.addEventListener('input', () => {
    audio.volume = Number(volume.value);
});

const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
const volumeRow = volumeBtn.closest('.volume-wrap') as HTMLElement;

volumeBtn.addEventListener('click', () => {
    volumeRow.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!volumeRow.contains(e.target as Node)) {
        volumeRow.classList.remove('open');
    }
});

audio.addEventListener('loadedmetadata', () => {
    updateTrackLabels();
});

audio.addEventListener('timeupdate', () => {
    updateTrackLabels();
});

audio.addEventListener('play', () => {
    updatePlayButton();
});

audio.addEventListener('pause', () => {
    updatePlayButton();
});

audio.addEventListener('ended', () => {
    goToTrack(1);
});
