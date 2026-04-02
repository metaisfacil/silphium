export namespace main {
	
	export class AppSettings {
	    libraryPath: string;
	    listenBrainzUserToken: string;
	    playbackOrder: string;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.libraryPath = source["libraryPath"];
	        this.listenBrainzUserToken = source["listenBrainzUserToken"];
	        this.playbackOrder = source["playbackOrder"];
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
	export class LibraryScanResult {
	    rootPath: string;
	    rootName: string;
	    trackFiles: LibraryIndexedFile[];
	    textFiles: LibraryIndexedFile[];
	    imageFiles: LibraryIndexedFile[];
	    coverPathByFolder: Record<string, string>;
	    totalEntries: number;
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

