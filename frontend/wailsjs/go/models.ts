export namespace main {
	
	export class AppLibraryFolder {
	    path: string;
	    kind?: string;
	    host?: string;
	    port?: number;
	    label?: string;
	    password?: string;
	    passwordHash?: string;
	    releaseDepth?: number;
	
	    static createFrom(source: any = {}) {
	        return new AppLibraryFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.kind = source["kind"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.label = source["label"];
	        this.password = source["password"];
	        this.passwordHash = source["passwordHash"];
	        this.releaseDepth = source["releaseDepth"];
	    }
	}
	export class FocusedKeyboardShortcuts {
	    playPauseToggle: string;
	    nextTrack: string;
	    previousTrack: string;
	    stopPlayback: string;
	    focusLibraryFilter: string;
	    openSettings: string;
	
	    static createFrom(source: any = {}) {
	        return new FocusedKeyboardShortcuts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.playPauseToggle = source["playPauseToggle"];
	        this.nextTrack = source["nextTrack"];
	        this.previousTrack = source["previousTrack"];
	        this.stopPlayback = source["stopPlayback"];
	        this.focusLibraryFilter = source["focusLibraryFilter"];
	        this.openSettings = source["openSettings"];
	    }
	}
	export class CustomSendToAction {
	    title: string;
	    scope: string;
	    commandTemplate: string;
	
	    static createFrom(source: any = {}) {
	        return new CustomSendToAction(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.scope = source["scope"];
	        this.commandTemplate = source["commandTemplate"];
	    }
	}
	export class AudioSettings {
	    outputDevice?: string;
	    outputBufferMs?: number;
	    gaplessPlayback?: boolean;
	    replayGainEnabled?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AudioSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.outputDevice = source["outputDevice"];
	        this.outputBufferMs = source["outputBufferMs"];
	        this.gaplessPlayback = source["gaplessPlayback"];
	        this.replayGainEnabled = source["replayGainEnabled"];
	    }
	}
	export class ScrobbleRule {
	    field: string;
	    operator: string;
	    value?: string;
	
	    static createFrom(source: any = {}) {
	        return new ScrobbleRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.field = source["field"];
	        this.operator = source["operator"];
	        this.value = source["value"];
	    }
	}
	export class AppSettings {
	    libraryFolders?: AppLibraryFolder[];
	    libraryPath?: string;
	    localLibraryFilesDatabaseEnabled?: boolean;
	    localLibraryFilesDatabaseLoadOnStartup?: boolean;
	    localLibraryFilesDatabaseListenHistoryEnabled?: boolean;
	    localLibraryFilesDatabaseListenHistoryLimit?: number;
	    ffmpegPath?: string;
	    remoteLibraryTranscodingEnabled?: boolean;
	    remoteLibraryTranscodingBitrateKbps?: number;
	    openSubsonicEnabled?: boolean;
	    openSubsonicPort?: number;
	    openSubsonicApiKey?: string;
	    openSubsonicApiKeyHash?: string;
	    librarySharingEnabled?: boolean;
	    librarySharingPort?: number;
	    librarySharingPassword?: string;
	    librarySharingPasswordHash?: string;
	    remoteLibraryPassword?: string;
	    remoteLibraryPasswordHash?: string;
	    listenBrainzUserToken: string;
	    lastFmApiKey: string;
	    lastFmApiSecret: string;
	    lastFmSessionKey: string;
	    scrobbleFilterMode?: string;
	    scrobbleRules?: ScrobbleRule[];
	    scrobbleFolders?: string[];
	    musicBrainzServerUrl?: string;
	    musicBrainzRequestRateMs?: number;
	    listenBrainzServerUrl?: string;
	    listenBrainzRequestRateMs?: number;
	    playbackOrder: string;
	    releaseDepth?: number;
	    favoritePlaylists?: string[];
	    coverArtPriority?: string[];
	    audio?: AudioSettings;
	    preferMusicBrainzMetadata: boolean;
	    musicBrainzTagDatabaseEnabled?: boolean;
	    highlightMusicBrainzTaggedAlbumFolders?: boolean;
	    musicBrainzTagStaleDays?: number;
	    musicBrainzTagRequestStaggeringEnabled?: boolean;
	    musicBrainzTagWorkerCores?: number;
	    lissajousEnabled?: boolean;
	    lissajousScale?: number;
	    visualizerMode?: string;
	    equalizerPosition?: string;
	    uiDitheringEnabled?: boolean;
	    minimizeToTrayOnClose?: boolean;
	    customSendToActions?: CustomSendToAction[];
	    keyboardShortcuts: FocusedKeyboardShortcuts;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.libraryFolders = this.convertValues(source["libraryFolders"], AppLibraryFolder);
	        this.libraryPath = source["libraryPath"];
	        this.localLibraryFilesDatabaseEnabled = source["localLibraryFilesDatabaseEnabled"];
	        this.localLibraryFilesDatabaseLoadOnStartup = source["localLibraryFilesDatabaseLoadOnStartup"];
	        this.localLibraryFilesDatabaseListenHistoryEnabled = source["localLibraryFilesDatabaseListenHistoryEnabled"];
	        this.localLibraryFilesDatabaseListenHistoryLimit = source["localLibraryFilesDatabaseListenHistoryLimit"];
	        this.ffmpegPath = source["ffmpegPath"];
	        this.remoteLibraryTranscodingEnabled = source["remoteLibraryTranscodingEnabled"];
	        this.remoteLibraryTranscodingBitrateKbps = source["remoteLibraryTranscodingBitrateKbps"];
	        this.openSubsonicEnabled = source["openSubsonicEnabled"];
	        this.openSubsonicPort = source["openSubsonicPort"];
	        this.openSubsonicApiKey = source["openSubsonicApiKey"];
	        this.openSubsonicApiKeyHash = source["openSubsonicApiKeyHash"];
	        this.librarySharingEnabled = source["librarySharingEnabled"];
	        this.librarySharingPort = source["librarySharingPort"];
	        this.librarySharingPassword = source["librarySharingPassword"];
	        this.librarySharingPasswordHash = source["librarySharingPasswordHash"];
	        this.remoteLibraryPassword = source["remoteLibraryPassword"];
	        this.remoteLibraryPasswordHash = source["remoteLibraryPasswordHash"];
	        this.listenBrainzUserToken = source["listenBrainzUserToken"];
	        this.lastFmApiKey = source["lastFmApiKey"];
	        this.lastFmApiSecret = source["lastFmApiSecret"];
	        this.lastFmSessionKey = source["lastFmSessionKey"];
	        this.scrobbleFilterMode = source["scrobbleFilterMode"];
	        this.scrobbleRules = this.convertValues(source["scrobbleRules"], ScrobbleRule);
	        this.scrobbleFolders = source["scrobbleFolders"];
	        this.musicBrainzServerUrl = source["musicBrainzServerUrl"];
	        this.musicBrainzRequestRateMs = source["musicBrainzRequestRateMs"];
	        this.listenBrainzServerUrl = source["listenBrainzServerUrl"];
	        this.listenBrainzRequestRateMs = source["listenBrainzRequestRateMs"];
	        this.playbackOrder = source["playbackOrder"];
	        this.releaseDepth = source["releaseDepth"];
	        this.favoritePlaylists = source["favoritePlaylists"];
	        this.coverArtPriority = source["coverArtPriority"];
	        this.audio = this.convertValues(source["audio"], AudioSettings);
	        this.preferMusicBrainzMetadata = source["preferMusicBrainzMetadata"];
	        this.musicBrainzTagDatabaseEnabled = source["musicBrainzTagDatabaseEnabled"];
	        this.highlightMusicBrainzTaggedAlbumFolders = source["highlightMusicBrainzTaggedAlbumFolders"];
	        this.musicBrainzTagStaleDays = source["musicBrainzTagStaleDays"];
	        this.musicBrainzTagRequestStaggeringEnabled = source["musicBrainzTagRequestStaggeringEnabled"];
	        this.musicBrainzTagWorkerCores = source["musicBrainzTagWorkerCores"];
	        this.lissajousEnabled = source["lissajousEnabled"];
	        this.lissajousScale = source["lissajousScale"];
	        this.visualizerMode = source["visualizerMode"];
	        this.equalizerPosition = source["equalizerPosition"];
	        this.uiDitheringEnabled = source["uiDitheringEnabled"];
	        this.minimizeToTrayOnClose = source["minimizeToTrayOnClose"];
	        this.customSendToActions = this.convertValues(source["customSendToActions"], CustomSendToAction);
	        this.keyboardShortcuts = this.convertValues(source["keyboardShortcuts"], FocusedKeyboardShortcuts);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AudioOutputDevice {
	    id: string;
	    name: string;
	    backend: string;
	    isDefault: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AudioOutputDevice(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.backend = source["backend"];
	        this.isDefault = source["isDefault"];
	    }
	}
	export class AudioPlaybackState {
	    loaded: boolean;
	    playing: boolean;
	    currentTime: number;
	    duration: number;
	    volume: number;
	    sourcePath: string;
	    endEventId: number;
	
	    static createFrom(source: any = {}) {
	        return new AudioPlaybackState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loaded = source["loaded"];
	        this.playing = source["playing"];
	        this.currentTime = source["currentTime"];
	        this.duration = source["duration"];
	        this.volume = source["volume"];
	        this.sourcePath = source["sourcePath"];
	        this.endEventId = source["endEventId"];
	    }
	}
	
	export class AudioVisualizationFrame {
	    loaded: boolean;
	    playing: boolean;
	    sourcePath: string;
	    sampleRate: number;
	    channelCount: number;
	    frameCount: number;
	    sampleStride: number;
	    peak: number;
	    samples: number[];
	
	    static createFrom(source: any = {}) {
	        return new AudioVisualizationFrame(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loaded = source["loaded"];
	        this.playing = source["playing"];
	        this.sourcePath = source["sourcePath"];
	        this.sampleRate = source["sampleRate"];
	        this.channelCount = source["channelCount"];
	        this.frameCount = source["frameCount"];
	        this.sampleStride = source["sampleStride"];
	        this.peak = source["peak"];
	        this.samples = source["samples"];
	    }
	}
	
	export class EmbeddedCoverArt {
	    base64: string;
	    mimeType: string;
	
	    static createFrom(source: any = {}) {
	        return new EmbeddedCoverArt(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.base64 = source["base64"];
	        this.mimeType = source["mimeType"];
	    }
	}
	export class FFmpegPathStatus {
	    available: boolean;
	    resolvedPath?: string;
	    message?: string;
	    usingPathFallback: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FFmpegPathStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.resolvedPath = source["resolvedPath"];
	        this.message = source["message"];
	        this.usingPathFallback = source["usingPathFallback"];
	    }
	}
	
	export class LastFmTrackMetadata {
	    artistName: string;
	    trackName: string;
	    releaseName?: string;
	    albumArtist?: string;
	    trackNumber?: string;
	    recordingMbid?: string;
	    durationSeconds?: number;
	
	    static createFrom(source: any = {}) {
	        return new LastFmTrackMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.artistName = source["artistName"];
	        this.trackName = source["trackName"];
	        this.releaseName = source["releaseName"];
	        this.albumArtist = source["albumArtist"];
	        this.trackNumber = source["trackNumber"];
	        this.recordingMbid = source["recordingMbid"];
	        this.durationSeconds = source["durationSeconds"];
	    }
	}
	export class LibraryBrowserEntry {
	    kind: string;
	    name: string;
	    path: string;
	    folderPath: string;
	    relativePath: string;
	    modifiedAtMs?: number;
	    musicBrainzTaggedAlbumDir?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new LibraryBrowserEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.folderPath = source["folderPath"];
	        this.relativePath = source["relativePath"];
	        this.modifiedAtMs = source["modifiedAtMs"];
	        this.musicBrainzTaggedAlbumDir = source["musicBrainzTaggedAlbumDir"];
	    }
	}
	export class LibraryFolderPage {
	    folderPath: string;
	    offset: number;
	    limit: number;
	    totalEntries: number;
	    entries: LibraryBrowserEntry[];
	
	    static createFrom(source: any = {}) {
	        return new LibraryFolderPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folderPath = source["folderPath"];
	        this.offset = source["offset"];
	        this.limit = source["limit"];
	        this.totalEntries = source["totalEntries"];
	        this.entries = this.convertValues(source["entries"], LibraryBrowserEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LibraryIndexedFile {
	    name: string;
	    path: string;
	    relativePath: string;
	    folderPath: string;
	    rootPath: string;
	    rootName: string;
	    releaseDepth?: number;
	    cachedTrackTitle?: string;
	    cachedArtistName?: string;
	    listenedAt?: number;
	    modifiedAtMs?: number;
	
	    static createFrom(source: any = {}) {
	        return new LibraryIndexedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.relativePath = source["relativePath"];
	        this.folderPath = source["folderPath"];
	        this.rootPath = source["rootPath"];
	        this.rootName = source["rootName"];
	        this.releaseDepth = source["releaseDepth"];
	        this.cachedTrackTitle = source["cachedTrackTitle"];
	        this.cachedArtistName = source["cachedArtistName"];
	        this.listenedAt = source["listenedAt"];
	        this.modifiedAtMs = source["modifiedAtMs"];
	    }
	}
	export class LibraryIndexedFilePage {
	    kind: string;
	    offset: number;
	    limit: number;
	    totalEntries: number;
	    entries: LibraryIndexedFile[];
	
	    static createFrom(source: any = {}) {
	        return new LibraryIndexedFilePage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.offset = source["offset"];
	        this.limit = source["limit"];
	        this.totalEntries = source["totalEntries"];
	        this.entries = this.convertValues(source["entries"], LibraryIndexedFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LibraryScanResult {
	    rootPath: string;
	    rootName: string;
	    trackFiles: LibraryIndexedFile[];
	    textFiles: LibraryIndexedFile[];
	    imageFiles: LibraryIndexedFile[];
	    deferredFiles: boolean;
	    coverPathByFolder: Record<string, string>;
	    totalEntries: number;
	    trackCount: number;
	    textFileCount: number;
	    imageFileCount: number;
	    truncated: boolean;
	    entryLimit: number;
	
	    static createFrom(source: any = {}) {
	        return new LibraryScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rootPath = source["rootPath"];
	        this.rootName = source["rootName"];
	        this.trackFiles = this.convertValues(source["trackFiles"], LibraryIndexedFile);
	        this.textFiles = this.convertValues(source["textFiles"], LibraryIndexedFile);
	        this.imageFiles = this.convertValues(source["imageFiles"], LibraryIndexedFile);
	        this.deferredFiles = source["deferredFiles"];
	        this.coverPathByFolder = source["coverPathByFolder"];
	        this.totalEntries = source["totalEntries"];
	        this.trackCount = source["trackCount"];
	        this.textFileCount = source["textFileCount"];
	        this.imageFileCount = source["imageFileCount"];
	        this.truncated = source["truncated"];
	        this.entryLimit = source["entryLimit"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LibrarySearchPage {
	    query: string;
	    offset: number;
	    limit: number;
	    totalEntries: number;
	    entries: LibraryBrowserEntry[];
	
	    static createFrom(source: any = {}) {
	        return new LibrarySearchPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.offset = source["offset"];
	        this.limit = source["limit"];
	        this.totalEntries = source["totalEntries"];
	        this.entries = this.convertValues(source["entries"], LibraryBrowserEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ListenBrainzSocialAdditionalInfo {
	    recordingMbid?: string;
	    recordingMsid?: string;
	    releaseMbid?: string;
	    releaseGroupMbid?: string;
	    artistMbids?: string[];
	    originUrl?: string;
	    musicService?: string;
	    musicServiceName?: string;
	    durationMs?: number;
	
	    static createFrom(source: any = {}) {
	        return new ListenBrainzSocialAdditionalInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.recordingMbid = source["recordingMbid"];
	        this.recordingMsid = source["recordingMsid"];
	        this.releaseMbid = source["releaseMbid"];
	        this.releaseGroupMbid = source["releaseGroupMbid"];
	        this.artistMbids = source["artistMbids"];
	        this.originUrl = source["originUrl"];
	        this.musicService = source["musicService"];
	        this.musicServiceName = source["musicServiceName"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class ListenBrainzSocialTrackMetadata {
	    artistName: string;
	    trackName: string;
	    releaseName?: string;
	    additionalInfo: ListenBrainzSocialAdditionalInfo;
	
	    static createFrom(source: any = {}) {
	        return new ListenBrainzSocialTrackMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.artistName = source["artistName"];
	        this.trackName = source["trackName"];
	        this.releaseName = source["releaseName"];
	        this.additionalInfo = this.convertValues(source["additionalInfo"], ListenBrainzSocialAdditionalInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ListenBrainzSocialEvent {
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
	
	    static createFrom(source: any = {}) {
	        return new ListenBrainzSocialEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.created = source["created"];
	        this.eventType = source["eventType"];
	        this.hidden = source["hidden"];
	        this.message = source["message"];
	        this.userName = source["userName"];
	        this.listenedAt = source["listenedAt"];
	        this.listenedAtIso = source["listenedAtIso"];
	        this.playingNow = source["playingNow"];
	        this.trackMetadata = this.convertValues(source["trackMetadata"], ListenBrainzSocialTrackMetadata);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ListenBrainzTrackMetadata {
	    artistName: string;
	    trackName: string;
	    releaseName: string;
	    recordingMbid?: string;
	    releaseMbid?: string;
	    artistMbids?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ListenBrainzTrackMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.artistName = source["artistName"];
	        this.trackName = source["trackName"];
	        this.releaseName = source["releaseName"];
	        this.recordingMbid = source["recordingMbid"];
	        this.releaseMbid = source["releaseMbid"];
	        this.artistMbids = source["artistMbids"];
	    }
	}
	export class MusicBrainzArtistCreditPart {
	    name: string;
	    artistId: string;
	    joinPhrase: string;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzArtistCreditPart(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.artistId = source["artistId"];
	        this.joinPhrase = source["joinPhrase"];
	    }
	}
	export class MusicBrainzURL {
	    type: string;
	    resource: string;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzURL(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.resource = source["resource"];
	    }
	}
	export class MusicBrainzArtistInfo {
	    found: boolean;
	    mbid: string;
	    name: string;
	    type: string;
	    country: string;
	    disambiguation: string;
	    lifeSpan: string;
	    genres: string[];
	    urls: MusicBrainzURL[];
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzArtistInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.mbid = source["mbid"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.country = source["country"];
	        this.disambiguation = source["disambiguation"];
	        this.lifeSpan = source["lifeSpan"];
	        this.genres = source["genres"];
	        this.urls = this.convertValues(source["urls"], MusicBrainzURL);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MusicBrainzEntityFact {
	    label: string;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzEntityFact(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.value = source["value"];
	    }
	}
	export class MusicBrainzEntityInfo {
	    found: boolean;
	    entityType: string;
	    mbid: string;
	    title: string;
	    subtitle: string;
	    summary: string;
	    facts: MusicBrainzEntityFact[];
	    tags: string[];
	    urls: MusicBrainzURL[];
	    rawJson: string;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzEntityInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.entityType = source["entityType"];
	        this.mbid = source["mbid"];
	        this.title = source["title"];
	        this.subtitle = source["subtitle"];
	        this.summary = source["summary"];
	        this.facts = this.convertValues(source["facts"], MusicBrainzEntityFact);
	        this.tags = source["tags"];
	        this.urls = this.convertValues(source["urls"], MusicBrainzURL);
	        this.rawJson = source["rawJson"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MusicBrainzExplorationEdge {
	    id: string;
	    sourceId: string;
	    targetId: string;
	    label: string;
	    kind: string;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzExplorationEdge(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sourceId = source["sourceId"];
	        this.targetId = source["targetId"];
	        this.label = source["label"];
	        this.kind = source["kind"];
	    }
	}
	export class MusicBrainzExplorationNode {
	    id: string;
	    entityType: string;
	    kind: string;
	    mbid: string;
	    label: string;
	    subtitle: string;
	    accent: string;
	    emphasis: number;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzExplorationNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.entityType = source["entityType"];
	        this.kind = source["kind"];
	        this.mbid = source["mbid"];
	        this.label = source["label"];
	        this.subtitle = source["subtitle"];
	        this.accent = source["accent"];
	        this.emphasis = source["emphasis"];
	        this.url = source["url"];
	    }
	}
	export class MusicBrainzExplorationGraph {
	    found: boolean;
	    title: string;
	    summary: string;
	    nodes: MusicBrainzExplorationNode[];
	    edges: MusicBrainzExplorationEdge[];
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzExplorationGraph(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.title = source["title"];
	        this.summary = source["summary"];
	        this.nodes = this.convertValues(source["nodes"], MusicBrainzExplorationNode);
	        this.edges = this.convertValues(source["edges"], MusicBrainzExplorationEdge);
	        this.warnings = source["warnings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class MusicBrainzTagWorkerProgress {
	    enabled: boolean;
	    active: boolean;
	    progress: number;
	    pendingTrackScans: number;
	    totalTrackScans: number;
	    completedTrackScans: number;
	    pendingEntityLookups: number;
	    totalEntityLookups: number;
	    completedEntityLookups: number;
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzTagWorkerProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.active = source["active"];
	        this.progress = source["progress"];
	        this.pendingTrackScans = source["pendingTrackScans"];
	        this.totalTrackScans = source["totalTrackScans"];
	        this.completedTrackScans = source["completedTrackScans"];
	        this.pendingEntityLookups = source["pendingEntityLookups"];
	        this.totalEntityLookups = source["totalEntityLookups"];
	        this.completedEntityLookups = source["completedEntityLookups"];
	    }
	}
	export class MusicBrainzTrackMetadata {
	    found: boolean;
	    recordingId: string;
	    releaseId: string;
	    labelId: string;
	    title: string;
	    album: string;
	    artist: string;
	    artistCredits: MusicBrainzArtistCreditPart[];
	
	    static createFrom(source: any = {}) {
	        return new MusicBrainzTrackMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.found = source["found"];
	        this.recordingId = source["recordingId"];
	        this.releaseId = source["releaseId"];
	        this.labelId = source["labelId"];
	        this.title = source["title"];
	        this.album = source["album"];
	        this.artist = source["artist"];
	        this.artistCredits = this.convertValues(source["artistCredits"], MusicBrainzArtistCreditPart);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class PlaylistLoadResult {
	    name: string;
	    trackFiles: LibraryIndexedFile[];
	
	    static createFrom(source: any = {}) {
	        return new PlaylistLoadResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.trackFiles = this.convertValues(source["trackFiles"], LibraryIndexedFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PlaylistTrackMetadataCacheEntry {
	    trackPath: string;
	    trackName: string;
	    artistName: string;
	
	    static createFrom(source: any = {}) {
	        return new PlaylistTrackMetadataCacheEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.trackPath = source["trackPath"];
	        this.trackName = source["trackName"];
	        this.artistName = source["artistName"];
	    }
	}
	
	export class TrackBlob {
	    key: string;
	    name: string;
	    data: string;
	
	    static createFrom(source: any = {}) {
	        return new TrackBlob(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.name = source["name"];
	        this.data = source["data"];
	    }
	}
	export class TrackTags {
	    artist: string;
	    albumArtist?: string;
	    album: string;
	    title: string;
	    date?: string;
	    genre?: string;
	    recordLabel?: string;
	    catalogNumber?: string;
	    genres?: string[];
	    allTags?: Record<string, Array<string>>;
	    lyrics?: string;
	    unsyncedLyrics?: string;
	    trackNumber?: string;
	    trackTotal?: string;
	    discNumber?: string;
	    discTotal?: string;
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
	    albumArtistId?: string;
	    albumArtistIds?: string[];
	
	    static createFrom(source: any = {}) {
	        return new TrackTags(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.artist = source["artist"];
	        this.albumArtist = source["albumArtist"];
	        this.album = source["album"];
	        this.title = source["title"];
	        this.date = source["date"];
	        this.genre = source["genre"];
	        this.recordLabel = source["recordLabel"];
	        this.catalogNumber = source["catalogNumber"];
	        this.genres = source["genres"];
	        this.allTags = source["allTags"];
	        this.lyrics = source["lyrics"];
	        this.unsyncedLyrics = source["unsyncedLyrics"];
	        this.trackNumber = source["trackNumber"];
	        this.trackTotal = source["trackTotal"];
	        this.discNumber = source["discNumber"];
	        this.discTotal = source["discTotal"];
	        this.bitDepth = source["bitDepth"];
	        this.sampleRate = source["sampleRate"];
	        this.codec = source["codec"];
	        this.codecLong = source["codecLong"];
	        this.codecProfile = source["codecProfile"];
	        this.sampleFormat = source["sampleFormat"];
	        this.channels = source["channels"];
	        this.channelLayout = source["channelLayout"];
	        this.bitRate = source["bitRate"];
	        this.overallBitRate = source["overallBitRate"];
	        this.durationSeconds = source["durationSeconds"];
	        this.container = source["container"];
	        this.fileSizeBytes = source["fileSizeBytes"];
	        this.recordingId = source["recordingId"];
	        this.releaseId = source["releaseId"];
	        this.artistId = source["artistId"];
	        this.artistIds = source["artistIds"];
	        this.albumArtistId = source["albumArtistId"];
	        this.albumArtistIds = source["albumArtistIds"];
	    }
	}

}

