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
    rootPath: string;
    rootName: string;
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

export type ListenBrainzSocialAdditionalInfo = {
    recordingMbid?: string;
    recordingMsid?: string;
    releaseMbid?: string;
    releaseGroupMbid?: string;
    artistMbids?: string[];
    originUrl?: string;
    musicService?: string;
    musicServiceName?: string;
    durationMs?: number;
};

export type ListenBrainzSocialTrackMetadata = {
    artistName: string;
    trackName: string;
    releaseName?: string;
    additionalInfo: ListenBrainzSocialAdditionalInfo;
};

export type ListenBrainzSocialEvent = {
    id: number;
    created: number;
    eventType: string;
    hidden: boolean;
    message?: string;
    userName: string;
    listenedAt?: number;
    listenedAtIso?: string;
    playingNow?: boolean;
    trackMetadata: ListenBrainzSocialTrackMetadata;
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
    rootPath: string;
    rootName: string;
};

export type LibraryScanResult = {
    rootPath: string;
    rootName: string;
    trackFiles: LibraryIndexedFile[];
    textFiles: LibraryIndexedFile[];
    imageFiles: LibraryIndexedFile[];
    deferredFiles?: boolean;
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
    phase: 'counting' | 'scanning' | 'finalizing';
};

export type MusicBrainzTagWorkerProgress = {
    enabled: boolean;
    active: boolean;
    progress: number;
    pendingTrackScans: number;
    totalTrackScans: number;
    completedTrackScans: number;
    pendingEntityLookups: number;
    totalEntityLookups: number;
    completedEntityLookups: number;
};

export type LibraryBrowserEntry = {
    kind: 'folder' | 'track' | 'text-file' | 'image-file';
    name: string;
    path: string;
    folderPath: string;
    relativePath: string;
    musicBrainzTaggedAlbumDir?: boolean;
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
    rootPath: string;
    rootName: string;
};

export type ImageLibraryFile = {
    name: string;
    path: string;
    relativePath: string;
    folderPath: string;
    rootPath: string;
    rootName: string;
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
export type ScrobbleFilterMode = 'blacklist' | 'whitelist';
export type ScrobbleRuleField = 'path' | 'albumArtist' | 'trackArtist' | 'albumTitle' | 'trackTitle' | 'genre' | 'anyTag' | 'artistMbid' | 'albumMbid' | 'trackLength';
export type ScrobbleTextRuleOperator = 'contains' | 'equals' | 'starts_with' | 'regex';
export type ScrobbleDurationRuleOperator = 'less_than' | 'greater_than';
export type ScrobbleRuleOperator = ScrobbleTextRuleOperator | ScrobbleDurationRuleOperator;

export type ScrobbleRule = {
    field: ScrobbleRuleField;
    operator: ScrobbleRuleOperator;
    value: string;
};

export type CoverArtPrioritySource = 'file' | 'embedded' | 'musicbrainz';

export type PlayerCardLayout = 'default' | 'release';
export type PlayerVisualizerMode = 'lissajous' | 'equalizer';
export type PlayerEqualizerPosition = 'bottom' | 'top';

export type FocusedKeyboardShortcuts = {
    playPauseToggle: string;
    nextTrack: string;
    previousTrack: string;
    stopPlayback: string;
    focusLibraryFilter: string;
    openSettings: string;
};

export type CustomSendToActionScope = 'track' | 'album' | 'file' | 'folder';

export type CustomSendToAction = {
    title: string;
    scope: CustomSendToActionScope;
    commandTemplate: string;
};

export type AudioSettings = {
    outputDevice: string;
    outputBufferMs: number;
    gaplessPlayback: boolean;
    replayGainEnabled: boolean;
};

export type AudioOutputDevice = {
    id: string;
    name: string;
    backend: string;
    isDefault: boolean;
};

export type AudioVisualizationFrame = {
    loaded: boolean;
    playing: boolean;
    sourcePath: string;
    sampleRate: number;
    channelCount: number;
    frameCount: number;
    sampleStride: number;
    peak: number;
    samples: number[];
};

export type FFmpegPathStatus = {
    available: boolean;
    resolvedPath?: string;
    message?: string;
    usingPathFallback: boolean;
};

export type AppLibraryFolder = {
    path: string;
    label: string;
    releaseDepth: number;
};

export type AppSettings = {
    libraryFolders: AppLibraryFolder[];
    libraryPath: string;
    ffmpegPath: string;
    listenBrainzUserToken: string;
    lastFmApiKey: string;
    lastFmApiSecret: string;
    lastFmSessionKey: string;
    scrobbleFilterMode: ScrobbleFilterMode;
    scrobbleRules: ScrobbleRule[];
    musicBrainzServerUrl: string;
    musicBrainzRequestRateMs: number;
    listenBrainzServerUrl: string;
    listenBrainzRequestRateMs: number;
    playbackOrder: PlaybackOrderMode;
    releaseDepth: number;
    favoritePlaylists: string[];
    coverArtPriority: CoverArtPrioritySource[];
    audio: AudioSettings;
    preferMusicBrainzMetadata: boolean;
    musicBrainzTagDatabaseEnabled: boolean;
    highlightMusicBrainzTaggedAlbumFolders: boolean;
    musicBrainzTagStaleDays: number;
    musicBrainzTagRequestStaggeringEnabled: boolean;
    musicBrainzTagWorkerCores: number;
    lissajousEnabled: boolean;
    lissajousScale: number;
    visualizerMode: PlayerVisualizerMode;
    equalizerPosition: PlayerEqualizerPosition;
    uiDitheringEnabled: boolean;
    minimizeToTrayOnClose: boolean;
    customSendToActions: CustomSendToAction[];
    keyboardShortcuts: FocusedKeyboardShortcuts;
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

export type MusicBrainzExplorationNode = {
    id: string;
    entityType: string;
    kind: string;
    mbid: string;
    label: string;
    subtitle: string;
    accent: string;
    emphasis: number;
    url: string;
};

export type MusicBrainzExplorationEdge = {
    id: string;
    sourceId: string;
    targetId: string;
    label: string;
    kind: string;
};

export type MusicBrainzExplorationGraph = {
    found: boolean;
    title: string;
    summary: string;
    nodes: MusicBrainzExplorationNode[];
    edges: MusicBrainzExplorationEdge[];
    warnings: string[];
};
