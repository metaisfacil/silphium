package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"
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

func (a *App) resolveAvailableLibraryFolderForVirtualPathLocked(virtualFolderPath string) string {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(virtualFolderPath)
	if !ok {
		return ""
	}

	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		if _, exists := a.folderEntriesByFolder[normalizedFolderPath]; exists {
			return normalizedFolderPath
		}
		return ""
	}

	if a.libraryScan.DeferredFiles {
		if normalizedFolderPath == "" {
			return ""
		}

		for _, entry := range a.searchFolderEntries {
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

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	if indexed, exists := a.trackByPath[absolutePath]; exists {
		return indexed.FolderPath
	}
	if indexed, exists := a.textByPath[absolutePath]; exists {
		return indexed.FolderPath
	}
	if indexed, exists := a.imageByPath[absolutePath]; exists {
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

// GetLibraryIndexedFilePage returns a paginated slice of indexed files for initial frontend hydration.
func (a *App) GetLibraryIndexedFilePage(kind string, offset int, limit int) LibraryIndexedFilePage {
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

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
		if a.libraryScan.DeferredFiles && len(a.libraryScan.TrackFiles) == 0 {
			return emptyDeferredPage("track", a.libraryScan.TrackCount)
		}
		return pagedIndexedFiles("track", a.libraryScan.TrackFiles, offset, limit)
	case "text-file":
		if a.libraryScan.DeferredFiles && len(a.libraryScan.TextFiles) == 0 {
			return emptyDeferredPage("text-file", a.libraryScan.TextFileCount)
		}
		return pagedIndexedFiles("text-file", a.libraryScan.TextFiles, offset, limit)
	case "image-file":
		if a.libraryScan.DeferredFiles && len(a.libraryScan.ImageFiles) == 0 {
			return emptyDeferredPage("image-file", a.libraryScan.ImageFileCount)
		}
		return pagedIndexedFiles("image-file", a.libraryScan.ImageFiles, offset, limit)
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

// GetLibraryFolderPage returns a paginated folder listing from the current backend index.
func (a *App) GetLibraryFolderPage(folderPath string, offset int, limit int) LibraryFolderPage {
	queryStartTime := time.Now()
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
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

	lockWaitStart := time.Now()
	a.logRescanEvent("GetLibraryFolderPage waiting for indexMu lock: folder=%s", folderPathForLog(normalizedFolderPath))
	a.indexMu.Lock()
	a.logRescanEvent(
		"GetLibraryFolderPage acquired lock (waited %.2fms): folder=%s",
		time.Since(lockWaitStart).Seconds()*1000,
		folderPathForLog(normalizedFolderPath),
	)

	var entries []LibraryBrowserEntry
	mode := "fallback-map"
	useFilesystemFallback := false
	var rootsSnapshot []libraryRootConfig
	activeGeneration := a.libraryScanGeneration.Load()
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		entries = a.folderEntriesByFolder[normalizedFolderPath]
		mode = "derived-index"
	} else if a.scanInProgress {
		entries = a.buildFolderEntriesFromMapsLocked(normalizedFolderPath)
	} else if a.libraryScan.DeferredFiles {
		if cachedEntries, exists := a.libraryFolderEntriesCache[normalizedFolderPath]; exists {
			entries = append([]LibraryBrowserEntry(nil), cachedEntries...)
			mode = "lazy-cache"
		} else {
			rootsSnapshot = append([]libraryRootConfig(nil), a.activeLibraryRoots...)
			useFilesystemFallback = true
			mode = "lazy-filesystem"
		}
	} else {
		entries = a.buildFolderEntriesFromMapsLocked(normalizedFolderPath)
	}
	a.indexMu.Unlock()

	if useFilesystemFallback {
		filesystemEntries, err := listLibraryFolderEntriesFromFilesystem(rootsSnapshot, normalizedFolderPath)
		if err != nil {
			filesystemEntries = []LibraryBrowserEntry{}
		}

		a.indexMu.Lock()
		if a.libraryScanGeneration.Load() == activeGeneration && a.libraryScan.DeferredFiles {
			if a.libraryFolderEntriesCache == nil {
				a.libraryFolderEntriesCache = make(map[string][]LibraryBrowserEntry)
			}
			a.libraryFolderEntriesCache[normalizedFolderPath] = append([]LibraryBrowserEntry(nil), filesystemEntries...)
		}
		entries = filesystemEntries
		a.indexMu.Unlock()
	}

	pagedEntries := copyPagedLibraryEntries(entries, offset, limit)
	result := LibraryFolderPage{
		FolderPath:   normalizedFolderPath,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedEntries,
	}
	a.logRescanEvent(
		"GetLibraryFolderPage END: folder=%s mode=%s total=%d page=%d offset=%d limit=%d took %.2fms",
		folderPathForLog(normalizedFolderPath),
		mode,
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
	searchGeneration := a.searchGeneration.Load()
	if offset <= 0 {
		searchGeneration = a.searchGeneration.Add(1)
	}
	searchCanceled := func() bool {
		return a.searchGeneration.Load() != searchGeneration
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
	a.indexMu.Lock()
	a.logRescanEvent("SearchLibrary acquired lock (waited %.2fms): query=%q", time.Since(lockWaitStart).Seconds()*1000, logQuery)
	defer a.indexMu.Unlock()

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
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if hasMusicBrainzTagQuery {
		entries = a.buildMusicBrainzTagSearchResultsLocked(musicBrainzTagQuery)
		mode = "musicbrainz-tags"
	} else if a.isLibraryDerivedIndexReadyLocked() {
		var derivedMode string
		entries, derivedMode, canceled = a.buildSearchResultsLocked(normalizedQuery, searchCanceled)
		mode = "derived-" + derivedMode
	} else if a.libraryScan.DeferredFiles && len(a.trackByPath) == 0 && len(a.textByPath) == 0 && len(a.imageByPath) == 0 {
		entries, canceled = filterSearchEntries(a.searchFolderEntries, normalizedQuery, searchCanceled)
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

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	if !a.scanInProgress {
		return true
	}

	remainingChildren, exists := a.scanRemainingImmediateChildrenByFolder[normalizedFolderPath]
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

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	if a.libraryScan.CoverPathByFolder == nil {
		return ""
	}

	folderKey := strings.ToLower(normalizedFolderPath)
	coverPath, exists := a.libraryScan.CoverPathByFolder[folderKey]
	if !exists {
		return ""
	}

	return coverPath
}

// GetLibraryFolderTrackPaths resolves all audio tracks under a folder subtree for queue actions.
func (a *App) GetLibraryFolderTrackPaths(folderPath string) []string {
	queryStartTime := time.Now()
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []string{}
	}

	a.indexMu.Lock()

	mode := "fallback-map"
	useFilesystemFallback := false
	var rootsSnapshot []libraryRootConfig
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		mode = "derived-index"
		paths := a.getFolderTrackPathsFromDerivedIndexLocked(normalizedFolderPath)
		a.indexMu.Unlock()
		a.logRescanEvent(
			"GetLibraryFolderTrackPaths END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			len(paths),
			time.Since(queryStartTime).Seconds()*1000,
		)
		return paths
	} else if a.libraryScan.DeferredFiles && len(a.trackByPath) == 0 {
		rootsSnapshot = append([]libraryRootConfig(nil), a.activeLibraryRoots...)
		useFilesystemFallback = true
		mode = "lazy-filesystem"
	}

	if useFilesystemFallback {
		a.indexMu.Unlock()
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
	a.indexMu.Unlock()
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

	a.indexMu.Lock()

	mode := "fallback-map"
	useFilesystemFallback := false
	var rootsSnapshot []libraryRootConfig
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		mode = "derived-index"
		count := a.getFolderTrackCountFromDerivedIndexLocked(normalizedFolderPath)
		a.indexMu.Unlock()
		a.logRescanEvent(
			"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			count,
			time.Since(queryStartTime).Seconds()*1000,
		)
		return count
	} else if a.libraryScan.DeferredFiles && len(a.trackByPath) == 0 {
		rootsSnapshot = append([]libraryRootConfig(nil), a.activeLibraryRoots...)
		useFilesystemFallback = true
		mode = "lazy-filesystem"
	}

	if useFilesystemFallback {
		a.indexMu.Unlock()
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
	a.indexMu.Unlock()
	a.logRescanEvent(
		"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
		folderPathForLog(normalizedFolderPath),
		mode,
		count,
		time.Since(queryStartTime).Seconds()*1000,
	)
	return count
}
