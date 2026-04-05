package main

import (
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

// GetLibraryIndexedFilePage returns a paginated slice of indexed files for initial frontend hydration.
func (a *App) GetLibraryIndexedFilePage(kind string, offset int, limit int) LibraryIndexedFilePage {
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	switch normalizedKind {
	case "track":
		return pagedIndexedFiles("track", a.libraryScan.TrackFiles, offset, limit)
	case "text-file":
		return pagedIndexedFiles("text-file", a.libraryScan.TextFiles, offset, limit)
	case "image-file":
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
	defer a.indexMu.Unlock()

	entries := []LibraryBrowserEntry{}
	mode := "fallback-map"
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		entries = a.folderEntriesByFolder[normalizedFolderPath]
		mode = "derived-index"
	} else {
		entries = a.buildFolderEntriesFromMapsLocked(normalizedFolderPath)
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

	entries := []LibraryBrowserEntry{}
	mode := "fallback-map"
	canceled := false
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		var derivedMode string
		entries, derivedMode, canceled = a.buildSearchResultsLocked(normalizedQuery, searchCanceled)
		mode = "derived-" + derivedMode
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
	defer a.indexMu.Unlock()

	mode := "fallback-map"
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		mode = "derived-index"
		paths := a.getFolderTrackPathsFromDerivedIndexLocked(normalizedFolderPath)
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
	defer a.indexMu.Unlock()

	mode := "fallback-map"
	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		mode = "derived-index"
		count := a.getFolderTrackCountFromDerivedIndexLocked(normalizedFolderPath)
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
	a.logRescanEvent(
		"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
		folderPathForLog(normalizedFolderPath),
		mode,
		count,
		time.Since(queryStartTime).Seconds()*1000,
	)
	return count
}
