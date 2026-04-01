export namespace main {
	
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

