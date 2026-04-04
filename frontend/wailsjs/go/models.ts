export namespace main {
	
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
	export class AppSettings {
	    libraryPath: string;
	    listenBrainzUserToken: string;
	    playbackOrder: string;
	    releaseDepth?: number;
	    favoritePlaylists?: string[];
	    coverArtPriority?: string[];
	    preferMusicBrainzMetadata: boolean;
	    keyboardShortcuts: FocusedKeyboardShortcuts;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.libraryPath = source["libraryPath"];
	        this.listenBrainzUserToken = source["listenBrainzUserToken"];
	        this.playbackOrder = source["playbackOrder"];
	        this.releaseDepth = source["releaseDepth"];
	        this.favoritePlaylists = source["favoritePlaylists"];
	        this.coverArtPriority = source["coverArtPriority"];
	        this.preferMusicBrainzMetadata = source["preferMusicBrainzMetadata"];
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
	
	export class LibraryBrowserEntry {
	    kind: string;
	    name: string;
	    path: string;
	    folderPath: string;
	    relativePath: string;
	
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
	
	    static createFrom(source: any = {}) {
	        return new LibraryIndexedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.relativePath = source["relativePath"];
	        this.folderPath = source["folderPath"];
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

}

