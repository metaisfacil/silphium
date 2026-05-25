package main

// LibraryIndexedFile represents a discovered file with normalized library-relative metadata.
type LibraryIndexedFile struct {
	Name              string `json:"name"`
	Path              string `json:"path"`
	RelativePath      string `json:"relativePath"`
	FolderPath        string `json:"folderPath"`
	RootPath          string `json:"rootPath"`
	RootName          string `json:"rootName"`
	ReleaseDepth      int    `json:"releaseDepth,omitempty"`
	CachedTrackTitle  string `json:"cachedTrackTitle,omitempty"`
	CachedAlbumTitle  string `json:"cachedAlbumTitle,omitempty"`
	CachedAlbumArtist string `json:"cachedAlbumArtist,omitempty"`
	CachedArtistName  string `json:"cachedArtistName,omitempty"`
	CachedTrackNumber string `json:"cachedTrackNumber,omitempty"`
	CachedTrackTotal  string `json:"cachedTrackTotal,omitempty"`
	ListenedAt        int64  `json:"listenedAt,omitempty"`
	PlayedPercent     int    `json:"playedPercent,omitempty"`
	ModifiedAtMs      int64  `json:"modifiedAtMs,omitempty"`
}

// LibraryScanResult contains indexed library content and scan metadata.
type LibraryScanResult struct {
	RootPath          string               `json:"rootPath"`
	RootName          string               `json:"rootName"`
	ScanGeneration    uint64               `json:"scanGeneration,omitempty"`
	TrackFiles        []LibraryIndexedFile `json:"trackFiles"`
	TextFiles         []LibraryIndexedFile `json:"textFiles"`
	ImageFiles        []LibraryIndexedFile `json:"imageFiles"`
	DeferredFiles     bool                 `json:"deferredFiles"`
	CoverPathByFolder map[string]string    `json:"coverPathByFolder"`
	TotalEntries      int                  `json:"totalEntries"`
	TrackCount        int                  `json:"trackCount"`
	TextFileCount     int                  `json:"textFileCount"`
	ImageFileCount    int                  `json:"imageFileCount"`
	Truncated         bool                 `json:"truncated"`
	EntryLimit        int                  `json:"entryLimit"`
}

// LibraryScanProgress reports scan progress and an ETA for long-running scans.
type LibraryScanProgress struct {
	RootPath       string `json:"rootPath"`
	EntriesScanned int    `json:"entriesScanned"`
	TotalEntries   int    `json:"totalEntries"`
	ElapsedMs      int64  `json:"elapsedMs"`
	EtaSeconds     int    `json:"etaSeconds"`
	Phase          string `json:"phase"`
}

// LibraryBrowserEntry is a single server-side sidebar/search result row.
type LibraryBrowserEntry struct {
	Kind                      string `json:"kind"`
	Name                      string `json:"name"`
	Path                      string `json:"path"`
	FolderPath                string `json:"folderPath"`
	RelativePath              string `json:"relativePath"`
	ModifiedAtMs              int64  `json:"modifiedAtMs,omitempty"`
	MusicBrainzTaggedAlbumDir bool   `json:"musicBrainzTaggedAlbumDir,omitempty"`
}

// LibraryFolderPage contains one paginated folder view from the backend.
type LibraryFolderPage struct {
	FolderPath   string                `json:"folderPath"`
	Offset       int                   `json:"offset"`
	Limit        int                   `json:"limit"`
	TotalEntries int                   `json:"totalEntries"`
	Entries      []LibraryBrowserEntry `json:"entries"`
}

// LibrarySearchPage contains one paginated search result page from the backend.
type LibrarySearchPage struct {
	Query        string                `json:"query"`
	Offset       int                   `json:"offset"`
	Limit        int                   `json:"limit"`
	TotalEntries int                   `json:"totalEntries"`
	Entries      []LibraryBrowserEntry `json:"entries"`
}

// LibraryIndexedFilePage contains a paginated slice of indexed library files.
type LibraryIndexedFilePage struct {
	Kind         string               `json:"kind"`
	Offset       int                  `json:"offset"`
	Limit        int                  `json:"limit"`
	TotalEntries int                  `json:"totalEntries"`
	Entries      []LibraryIndexedFile `json:"entries"`
}
