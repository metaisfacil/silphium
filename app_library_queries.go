package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	libraryBrowserSortName     = "name"
	libraryBrowserSortDateAsc  = "date-asc"
	libraryBrowserSortDateDesc = "date-desc"
)

func searchQueryForLog(query string) string {
	trimmed := strings.TrimSpace(query)
	if len(trimmed) <= 80 {
		return trimmed
	}

	return trimmed[:77] + "..."
}

func folderPathForLog(folderPath string) string {
	if strings.TrimSpace(folderPath) == "" {
		return "/"
	}

	return folderPath
}

func normalizeLibraryBrowserSortMode(sortMode string) string {
	switch strings.ToLower(strings.TrimSpace(sortMode)) {
	case "", libraryBrowserSortName:
		return libraryBrowserSortName
	case libraryBrowserSortDateAsc:
		return libraryBrowserSortDateAsc
	case libraryBrowserSortDateDesc:
		return libraryBrowserSortDateDesc
	default:
		return libraryBrowserSortName
	}
}

func sortLibraryBrowserEntries(entries []LibraryBrowserEntry, sortMode string) []LibraryBrowserEntry {
	normalizedSortMode := normalizeLibraryBrowserSortMode(sortMode)
	if normalizedSortMode == libraryBrowserSortName || len(entries) <= 1 {
		return entries
	}

	sortedEntries := append([]LibraryBrowserEntry(nil), entries...)
	sort.SliceStable(sortedEntries, func(i int, j int) bool {
		leftModifiedAt := sortedEntries[i].ModifiedAtMs
		rightModifiedAt := sortedEntries[j].ModifiedAtMs
		if leftModifiedAt == rightModifiedAt {
			return false
		}

		if normalizedSortMode == libraryBrowserSortDateAsc {
			return leftModifiedAt < rightModifiedAt
		}

		return leftModifiedAt > rightModifiedAt
	})
	return sortedEntries
}

func (a *App) annotateMusicBrainzTaggedAlbumFolders(entries []LibraryBrowserEntry) {
	if len(entries) == 0 || !a.musicBrainzTagDatabaseEnabled() {
		return
	}

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	if len(a.musicBrainzTagReleaseFoldersByID) == 0 {
		return
	}

	taggedAlbumFolders := make(map[string]struct{})
	for _, folderPathsByID := range a.musicBrainzTagReleaseFoldersByID {
		for folderPath := range folderPathsByID {
			normalizedFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
			if normalizedFolderPath == "" {
				continue
			}

			taggedAlbumFolders[strings.ToLower(normalizedFolderPath)] = struct{}{}
		}
	}

	for index := range entries {
		entry := &entries[index]
		if entry.Kind != "folder" {
			continue
		}

		normalizedEntryPath := normalizeMusicBrainzTagFolderPath(entry.Path)
		if normalizedEntryPath == "" {
			continue
		}

		_, tagged := taggedAlbumFolders[strings.ToLower(normalizedEntryPath)]
		entry.MusicBrainzTaggedAlbumDir = tagged
	}
}

func (a *App) resolveAvailableLibraryFolderForVirtualPathLocked(virtualFolderPath string) string {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(virtualFolderPath)
	if !ok {
		return ""
	}
	contentState := a.libraryContentState()
	indexState := a.libraryIndexState()

	if a.isLibraryFolderIndexReadyLocked() {
		if _, exists := indexState.folderEntriesByFolder[normalizedFolderPath]; exists {
			return normalizedFolderPath
		}
		return ""
	}

	if contentState.libraryScan.DeferredFiles {
		if normalizedFolderPath == "" {
			return ""
		}

		for _, entry := range indexState.searchFolderEntries {
			if entry.Path == normalizedFolderPath {
				return normalizedFolderPath
			}
		}

		return ""
	}

	if len(a.buildFolderEntriesFromMapsLocked(normalizedFolderPath)) > 0 {
		return normalizedFolderPath
	}

	return ""
}

// ResolveLibraryFolderForPath resolves an absolute filesystem path to the currently available virtual library folder path.
func (a *App) ResolveLibraryFolderForPath(path string) string {
	absolutePath, ok := absoluteNormalizedPath(path)
	if !ok {
		return ""
	}
	contentState := a.libraryContentState()

	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	if indexed, exists := contentState.trackByPath[absolutePath]; exists {
		return indexed.FolderPath
	}
	if indexed, exists := contentState.textByPath[absolutePath]; exists {
		return indexed.FolderPath
	}
	if indexed, exists := contentState.imageByPath[absolutePath]; exists {
		return indexed.FolderPath
	}

	root, ok := a.activeLibraryRootForPath(absolutePath)
	if !ok {
		return ""
	}

	relativePath, err := filepath.Rel(root.Path, absolutePath)
	if err != nil {
		return ""
	}

	virtualFolderPath := buildVirtualLibraryPath(root.Name, filepath.ToSlash(relativePath))
	if info, statErr := os.Stat(absolutePath); statErr == nil && !info.IsDir() {
		virtualFolderPath = buildVirtualLibraryPath(root.Name, filepath.ToSlash(filepath.Dir(relativePath)))
	}
	return a.resolveAvailableLibraryFolderForVirtualPathLocked(virtualFolderPath)
}

// ResolveLibraryFolderForReleaseMBID resolves a MusicBrainz release MBID to one available virtual library folder path.
func (a *App) ResolveLibraryFolderForReleaseMBID(releaseMBID string) string {
	cleanReleaseMBID := sanitizeMusicBrainzID(releaseMBID)
	if cleanReleaseMBID == "" || !a.musicBrainzTagDatabaseEnabled() {
		return ""
	}

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	folderPathsByID := a.musicBrainzTagReleaseFoldersByID[cleanReleaseMBID]
	if len(folderPathsByID) == 0 {
		return ""
	}

	folderPaths := make([]string, 0, len(folderPathsByID))
	for folderPath := range folderPathsByID {
		folderPaths = append(folderPaths, folderPath)
	}
	sortPathsCaseInsensitive(folderPaths)

	for _, folderPath := range folderPaths {
		if resolved := a.resolveAvailableLibraryFolderForVirtualPathLocked(folderPath); resolved != "" {
			return resolved
		}
	}

	return ""
}

// GetLibraryIndexedFilePage returns a paginated slice of indexed files for initial frontend hydration.
func (a *App) GetLibraryIndexedFilePage(kind string, offset int, limit int) LibraryIndexedFilePage {
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))
	contentState := a.libraryContentState()

	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	emptyDeferredPage := func(kind string, totalEntries int) LibraryIndexedFilePage {
		return LibraryIndexedFilePage{
			Kind:         kind,
			Offset:       offset,
			Limit:        limit,
			TotalEntries: totalEntries,
			Entries:      []LibraryIndexedFile{},
		}
	}

	switch normalizedKind {
	case "track":
		if contentState.libraryScan.DeferredFiles && len(contentState.libraryScan.TrackFiles) == 0 {
			return emptyDeferredPage("track", contentState.libraryScan.TrackCount)
		}
		return pagedIndexedFiles("track", contentState.libraryScan.TrackFiles, offset, limit)
	case "text-file":
		if contentState.libraryScan.DeferredFiles && len(contentState.libraryScan.TextFiles) == 0 {
			return emptyDeferredPage("text-file", contentState.libraryScan.TextFileCount)
		}
		return pagedIndexedFiles("text-file", contentState.libraryScan.TextFiles, offset, limit)
	case "image-file":
		if contentState.libraryScan.DeferredFiles && len(contentState.libraryScan.ImageFiles) == 0 {
			return emptyDeferredPage("image-file", contentState.libraryScan.ImageFileCount)
		}
		return pagedIndexedFiles("image-file", contentState.libraryScan.ImageFiles, offset, limit)
	default:
		return LibraryIndexedFilePage{
			Kind:         normalizedKind,
			Offset:       offset,
			Limit:        limit,
			TotalEntries: 0,
			Entries:      []LibraryIndexedFile{},
		}
	}
}

// GetLibraryFolderPage returns a paginated folder listing from the current backend index using the default name sort.
func (a *App) GetLibraryFolderPage(folderPath string, offset int, limit int) LibraryFolderPage {
	return a.GetLibraryFolderPageSorted(folderPath, libraryBrowserSortName, offset, limit)
}

// GetLibraryFolderPageSorted returns a paginated folder listing from the current backend index.
func (a *App) GetLibraryFolderPageSorted(folderPath string, sortMode string, offset int, limit int) LibraryFolderPage {
	queryStartTime := time.Now()
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	normalizedSortMode := normalizeLibraryBrowserSortMode(sortMode)
	if !ok {
		return LibraryFolderPage{
			FolderPath: normalizedFolderPath,
			Offset:     offset,
			Limit:      limit,
			Entries:    []LibraryBrowserEntry{},
		}
	}

	if limit <= 0 {
		limit = 100
	}
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	generationState := a.libraryGenerationState()
	indexState := a.libraryIndexState()

	lockWaitStart := time.Now()
	a.logRescanEvent("GetLibraryFolderPage waiting for indexMu lock: folder=%s", folderPathForLog(normalizedFolderPath))
	contentState.indexMu.Lock()
	a.logRescanEvent(
		"GetLibraryFolderPage acquired lock (waited %.2fms): folder=%s",
		time.Since(lockWaitStart).Seconds()*1000,
		folderPathForLog(normalizedFolderPath),
	)

	var entries []LibraryBrowserEntry
	mode := "fallback-map"
	useFilesystemFallback := false
	var rootsSnapshot []libraryRootConfig
	activeGeneration := generationState.libraryScanGeneration.Load()
	if a.isLibraryFolderIndexReadyLocked() {
		entries = indexState.folderEntriesByFolder[normalizedFolderPath]
		mode = "derived-index"
	} else if scanState.scanInProgress {
		entries = a.buildFolderEntriesFromMapsLocked(normalizedFolderPath)
	} else if contentState.libraryScan.DeferredFiles {
		if cachedEntries, exists := indexState.libraryFolderEntriesCache[normalizedFolderPath]; exists {
			entries = append([]LibraryBrowserEntry(nil), cachedEntries...)
			mode = "lazy-cache"
		} else {
			rootsSnapshot = append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
			useFilesystemFallback = true
			mode = "lazy-filesystem"
		}
	} else {
		entries = a.buildFolderEntriesFromMapsLocked(normalizedFolderPath)
	}
	contentState.indexMu.Unlock()

	if useFilesystemFallback {
		filesystemEntries, err := listLibraryFolderEntriesFromFilesystem(rootsSnapshot, normalizedFolderPath)
		if err != nil {
			filesystemEntries = []LibraryBrowserEntry{}
		}

		contentState.indexMu.Lock()
		if generationState.libraryScanGeneration.Load() == activeGeneration && contentState.libraryScan.DeferredFiles {
			if indexState.libraryFolderEntriesCache == nil {
				indexState.libraryFolderEntriesCache = make(map[string][]LibraryBrowserEntry)
			}
			indexState.libraryFolderEntriesCache[normalizedFolderPath] = append([]LibraryBrowserEntry(nil), filesystemEntries...)
		}
		entries = filesystemEntries
		contentState.indexMu.Unlock()
	}

	entries = sortLibraryBrowserEntries(entries, normalizedSortMode)

	pagedEntries := copyPagedLibraryEntries(entries, offset, limit)
	a.annotateMusicBrainzTaggedAlbumFolders(pagedEntries)
	result := LibraryFolderPage{
		FolderPath:   normalizedFolderPath,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedEntries,
	}
	a.logRescanEvent(
		"GetLibraryFolderPageSorted END: folder=%s mode=%s sort=%s total=%d page=%d offset=%d limit=%d took %.2fms",
		folderPathForLog(normalizedFolderPath),
		mode,
		normalizedSortMode,
		len(entries),
		len(pagedEntries),
		offset,
		limit,
		time.Since(queryStartTime).Seconds()*1000,
	)
	return result
}

// SearchLibrary returns paginated server-side search results across folders and indexed files.
func (a *App) SearchLibrary(query string, offset int, limit int) LibrarySearchPage {
	queryStartTime := time.Now()
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	logQuery := searchQueryForLog(query)
	generationState := a.libraryGenerationState()
	contentState := a.libraryContentState()
	indexState := a.libraryIndexState()
	searchGeneration := generationState.searchGeneration.Load()
	if offset <= 0 {
		searchGeneration = generationState.searchGeneration.Add(1)
	}
	searchCanceled := func() bool {
		return generationState.searchGeneration.Load() != searchGeneration
	}
	if limit <= 0 {
		limit = 100
	}

	if normalizedQuery == "" {
		return LibrarySearchPage{
			Query:   query,
			Offset:  offset,
			Limit:   limit,
			Entries: []LibraryBrowserEntry{},
		}
	}

	musicBrainzTagQuery, hasMusicBrainzTagQuery := parseMusicBrainzTagSearchQuery(query)

	if searchCanceled() {
		a.logRescanEvent("SearchLibrary CANCELED before lock: query=%q offset=%d", logQuery, offset)
		return LibrarySearchPage{
			Query:   query,
			Offset:  offset,
			Limit:   limit,
			Entries: []LibraryBrowserEntry{},
		}
	}

	lockWaitStart := time.Now()
	a.logRescanEvent("SearchLibrary waiting for indexMu lock: query=%q", logQuery)
	contentState.indexMu.Lock()
	a.logRescanEvent("SearchLibrary acquired lock (waited %.2fms): query=%q", time.Since(lockWaitStart).Seconds()*1000, logQuery)
	defer contentState.indexMu.Unlock()

	if searchCanceled() {
		a.logRescanEvent("SearchLibrary CANCELED after lock: query=%q offset=%d", logQuery, offset)
		return LibrarySearchPage{
			Query:   query,
			Offset:  offset,
			Limit:   limit,
			Entries: []LibraryBrowserEntry{},
		}
	}

	var entries []LibraryBrowserEntry
	mode := "fallback-map"
	canceled := false

	if hasMusicBrainzTagQuery {
		entries = a.buildMusicBrainzTagSearchResultsLocked(musicBrainzTagQuery)
		mode = "musicbrainz-tags"
	} else if a.isLibrarySearchIndexReadyLocked() {
		var derivedMode string
		entries, derivedMode, canceled = a.buildSearchResultsLocked(normalizedQuery, searchCanceled)
		mode = "derived-" + derivedMode
	} else if contentState.libraryScan.DeferredFiles && len(contentState.trackByPath) == 0 && len(contentState.textByPath) == 0 && len(contentState.imageByPath) == 0 {
		entries, canceled = filterSearchEntries(indexState.searchFolderEntries, normalizedQuery, searchCanceled)
		mode = "folder-tree"
	} else {
		entries, canceled = a.buildSearchEntriesFromMapsLocked(normalizedQuery, searchCanceled)
	}

	if canceled || searchCanceled() {
		a.logRescanEvent(
			"SearchLibrary CANCELED: query=%q mode=%s offset=%d limit=%d took %.2fms",
			logQuery,
			mode,
			offset,
			limit,
			time.Since(queryStartTime).Seconds()*1000,
		)
		return LibrarySearchPage{
			Query:   query,
			Offset:  offset,
			Limit:   limit,
			Entries: []LibraryBrowserEntry{},
		}
	}

	pagedEntries := copyPagedLibraryEntries(entries, offset, limit)
	a.annotateMusicBrainzTaggedAlbumFolders(pagedEntries)

	result := LibrarySearchPage{
		Query:        query,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedEntries,
	}

	a.logRescanEvent(
		"SearchLibrary END: query=%q mode=%s total=%d page=%d offset=%d limit=%d took %.2fms",
		logQuery,
		mode,
		len(entries),
		len(pagedEntries),
		offset,
		limit,
		time.Since(queryStartTime).Seconds()*1000,
	)

	return result
}

// IsLibraryFolderImmediateDescendantsEnumerated reports whether a folder's
// direct children are fully enumerated during the active scan.
func (a *App) IsLibraryFolderImmediateDescendantsEnumerated(folderPath string) bool {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return false
	}
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()

	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	if !scanState.scanInProgress {
		return true
	}

	remainingChildren, exists := scanState.scanRemainingImmediateChildrenByFolder[normalizedFolderPath]
	if !exists {
		return true
	}

	return remainingChildren <= 0
}

// GetLibraryFolderCoverPath returns the current best cover image path for a folder.
func (a *App) GetLibraryFolderCoverPath(folderPath string) string {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return ""
	}
	contentState := a.libraryContentState()

	contentState.indexMu.Lock()
	folderKey := strings.ToLower(normalizedFolderPath)
	if contentState.libraryScan.CoverPathByFolder != nil {
		if coverPath, exists := contentState.libraryScan.CoverPathByFolder[folderKey]; exists {
			contentState.indexMu.Unlock()
			return coverPath
		}
	}
	contentState.indexMu.Unlock()
	return ""
}

// GetLibraryFolderTrackPaths resolves all audio tracks under a folder subtree for queue actions.
func (a *App) GetLibraryFolderTrackPaths(folderPath string) []string {
	queryStartTime := time.Now()
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []string{}
	}
	contentState := a.libraryContentState()

	contentState.indexMu.Lock()

	mode := "fallback-map"
	useFilesystemFallback := false
	var rootsSnapshot []libraryRootConfig
	if a.isLibraryFolderIndexReadyLocked() {
		mode = "derived-index"
		paths := a.getFolderTrackPathsFromDerivedIndexLocked(normalizedFolderPath)
		contentState.indexMu.Unlock()
		a.logRescanEvent(
			"GetLibraryFolderTrackPaths END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			len(paths),
			time.Since(queryStartTime).Seconds()*1000,
		)
		return paths
	} else if contentState.libraryScan.DeferredFiles && len(contentState.trackByPath) == 0 {
		rootsSnapshot = append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
		useFilesystemFallback = true
		mode = "lazy-filesystem"
	}

	if useFilesystemFallback {
		contentState.indexMu.Unlock()
		paths, err := collectLibraryFolderTrackPathsFromFilesystem(rootsSnapshot, normalizedFolderPath)
		if err != nil {
			paths = []string{}
		}
		a.logRescanEvent(
			"GetLibraryFolderTrackPaths END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			len(paths),
			time.Since(queryStartTime).Seconds()*1000,
		)
		return paths
	}

	paths := a.getFolderTrackPathsFromMapsLocked(normalizedFolderPath)
	contentState.indexMu.Unlock()
	a.logRescanEvent(
		"GetLibraryFolderTrackPaths END: folder=%s mode=%s tracks=%d took %.2fms",
		folderPathForLog(normalizedFolderPath),
		mode,
		len(paths),
		time.Since(queryStartTime).Seconds()*1000,
	)
	return paths
}

// GetLibraryFolderTrackCount returns the number of audio tracks under a folder subtree.
func (a *App) GetLibraryFolderTrackCount(folderPath string) int {
	queryStartTime := time.Now()
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return 0
	}
	contentState := a.libraryContentState()

	contentState.indexMu.Lock()

	mode := "fallback-map"
	useFilesystemFallback := false
	var rootsSnapshot []libraryRootConfig
	if a.isLibraryFolderIndexReadyLocked() {
		mode = "derived-index"
		count := a.getFolderTrackCountFromDerivedIndexLocked(normalizedFolderPath)
		contentState.indexMu.Unlock()
		a.logRescanEvent(
			"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			count,
			time.Since(queryStartTime).Seconds()*1000,
		)
		return count
	} else if contentState.libraryScan.DeferredFiles && len(contentState.trackByPath) == 0 {
		rootsSnapshot = append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
		useFilesystemFallback = true
		mode = "lazy-filesystem"
	}

	if useFilesystemFallback {
		contentState.indexMu.Unlock()
		count, err := countLibraryFolderTracksFromFilesystem(rootsSnapshot, normalizedFolderPath)
		if err != nil {
			count = 0
		}
		a.logRescanEvent(
			"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			count,
			time.Since(queryStartTime).Seconds()*1000,
		)
		return count
	}

	count := a.getFolderTrackCountFromMapsLocked(normalizedFolderPath)
	contentState.indexMu.Unlock()
	a.logRescanEvent(
		"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
		folderPathForLog(normalizedFolderPath),
		mode,
		count,
		time.Since(queryStartTime).Seconds()*1000,
	)
	return count
}
