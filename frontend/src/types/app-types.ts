import type { MusicBrainzArtistCredit, MusicBrainzIds } from '../musicbrainz';

export type LibraryNode = {
    name: string;
    path: string;
    folders: LibraryNode[];
    trackIndexes: number[];
    textFileIndexes: number[];
    imageFileIndexes: number[];
};

export type LibrarySearchTreeNode = {
    name: string;
    path: string;
    folders: LibrarySearchTreeNode[];
    trackIndexes: number[];
    textFileIndexes: number[];
    imageFileIndexes: number[];
};

export type TrackTechnicalDetails = {
    bitDepth?: number;
    sampleRate?: number;
    codec?: string;
    codecLong?: string;
    codecProfile?: string;
    sampleFormat?: string;
    channels?: number;
    channelLayout?: string;
    bitRate?: number;
    overallBitRate?: number;
    durationSeconds?: number;
    container?: string;
    fileSizeBytes?: number;
};

export type Track = {
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
    displayLyrics: string;
    tagsResolved: boolean;
    mbMetadataResolved: boolean;
    technicalDetails: TrackTechnicalDetails;
    allFileTags: Record<string, string[]>;
    mbIds: MusicBrainzIds;
    artistMbids: string[];
    mbArtistCredits: MusicBrainzArtistCredit[];
};

export type TrackTags = {
    artist: string;
    album: string;
    title: string;
    version?: string;
    allTags?: Record<string, string[]>;
    lyrics?: string;
    unsyncedLyrics?: string;
    trackNumber?: string;
    trackTotal?: string;
    bitDepth?: number;
    sampleRate?: number;
    codec?: string;
    codecLong?: string;
    codecProfile?: string;
    sampleFormat?: string;
    channels?: number;
    channelLayout?: string;
    bitRate?: number;
    overallBitRate?: number;
    durationSeconds?: number;
    container?: string;
    fileSizeBytes?: number;
    recordingId?: string;
    releaseId?: string;
    artistId?: string;
    artistIds?: string[];
};

export type ArtistExternalUrl = {
    type: string;
    resource: string;
};

export type ArtistDetails = {
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

export type LibraryIndexedFile = {
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
};

export type LibraryScanResult = {
    rootPath: string;
    rootName: string;
    trackFiles: LibraryIndexedFile[];
    textFiles: LibraryIndexedFile[];
    imageFiles: LibraryIndexedFile[];
    coverPathByFolder: Record<string, string>;
    totalEntries: number;
    trackCount: number;
    textFileCount: number;
    imageFileCount: number;
    truncated: boolean;
    entryLimit: number;
};

export type LibraryScanProgress = {
    rootPath: string;
    entriesScanned: number;
    totalEntries: number;
    elapsedMs: number;
    etaSeconds: number;
    phase: 'scanning' | 'finalizing';
};

export type LibraryBrowserEntry = {
    kind: 'folder' | 'track' | 'text-file' | 'image-file';
    name: string;
    path: string;
    folderPath: string;
    relativePath: string;
};

export type LibraryFolderPage = {
    folderPath: string;
    offset: number;
    limit: number;
    totalEntries: number;
    entries: LibraryBrowserEntry[];
};

export type LibrarySearchPage = {
    query: string;
    offset: number;
    limit: number;
    totalEntries: number;
    entries: LibraryBrowserEntry[];
};

export type LibraryIndexedFilePage = {
    kind: 'track' | 'text-file' | 'image-file';
    offset: number;
    limit: number;
    totalEntries: number;
    entries: LibraryIndexedFile[];
};

export type PlaylistLoadResult = {
    name: string;
    trackFiles: LibraryIndexedFile[];
};

export type TextLibraryFile = {
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
};

export type ImageLibraryFile = {
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
};

export type AudioPlaybackState = {
    loaded: boolean;
    playing: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    sourcePath: string;
    endEventId: number;
};

export type PlaybackOrderMode = 'ordered-album' | 'ordered-library' | 'shuffle-album' | 'shuffle-library';

export type PlayerCardLayout = 'default' | 'release';

export type AppSettings = {
    libraryPath: string;
    listenBrainzUserToken: string;
    playbackOrder: PlaybackOrderMode;
    releaseDepth: number;
    favoritePlaylists: string[];
    preferMusicBrainzMetadata: boolean;
};

export type MusicBrainzEntityType = 'recording' | 'release' | 'artist' | 'label';

export type MusicBrainzEntityFact = {
    label: string;
    value: string;
};

export type MusicBrainzEntityInfo = {
    found: boolean;
    entityType: string;
    mbid: string;
    title: string;
    subtitle: string;
    summary: string;
    facts: MusicBrainzEntityFact[];
    tags: string[];
    urls: ArtistExternalUrl[];
    rawJson: string;
};

export type MusicBrainzTrackMetadata = {
    found: boolean;
    recordingId: string;
    releaseId: string;
    labelId?: string;
    title: string;
    album: string;
    artist: string;
    artistCredits: MusicBrainzArtistCredit[];
};
