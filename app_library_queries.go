package main

import (
	"fmt"
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

	if !a.musicBrainzTagMu.TryLock() {
		return
	}
	defer a.musicBrainzTagMu.Unlock()
	if !a.musicBrainzTagStoreLoaded {
		return
	}

	if len(a.musicBrainzTagReleaseFoldersByID) == 0 {
		return
	}

	for index := range entries {
		entry := &entries[index]
		if entry.Kind != "folder" {
			continue
		}
		entry.MusicBrainzTaggedAlbumDir = a.isMusicBrainzTaggedAlbumFolderLocked(entry.Path)
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
	return profiledValue(a, "ResolveLibraryFolderForPath", func() string {
		trace := a.beginBridgeTrace("library", "ResolveLibraryFolderForPath", "path="+bridgeTraceLogString(path))
		absolutePath, ok := absoluteNormalizedPath(path)
		if !ok {
			trace.finish("folderPath=\"\"", nil)
			return ""
		}
		contentState := a.libraryContentState()

		contentState.indexMu.RLock()
		defer contentState.indexMu.RUnlock()

		if indexed, exists := contentState.trackByPath[absolutePath]; exists {
			trace.finish("folderPath="+bridgeTraceLogString(indexed.FolderPath), nil)
			return indexed.FolderPath
		}
		if indexed, exists := contentState.textByPath[absolutePath]; exists {
			trace.finish("folderPath="+bridgeTraceLogString(indexed.FolderPath), nil)
			return indexed.FolderPath
		}
		if indexed, exists := contentState.imageByPath[absolutePath]; exists {
			trace.finish("folderPath="+bridgeTraceLogString(indexed.FolderPath), nil)
			return indexed.FolderPath
		}

		root, ok := a.activeLibraryRootForPath(absolutePath)
		if !ok {
			trace.finish("folderPath=\"\"", nil)
			return ""
		}

		relativePath, err := filepath.Rel(root.Path, absolutePath)
		if err != nil {
			trace.finish("folderPath=\"\"", nil)
			return ""
		}

		virtualFolderPath := buildVirtualLibraryPath(root.Name, filepath.ToSlash(relativePath))
		if info, statErr := os.Stat(absolutePath); statErr == nil && !info.IsDir() {
			virtualFolderPath = buildVirtualLibraryPath(root.Name, filepath.ToSlash(filepath.Dir(relativePath)))
		}
		resolved := a.resolveAvailableLibraryFolderForVirtualPathLocked(virtualFolderPath)
		trace.finish("folderPath="+bridgeTraceLogString(resolved), nil)
		return resolved
	})
}

// ResolveLibraryFolderForReleaseMBID resolves a MusicBrainz release MBID to one available virtual library folder path.
func (a *App) ResolveLibraryFolderForReleaseMBID(releaseMBID string) string {
	return profiledValue(a, "ResolveLibraryFolderForReleaseMBID", func() string {
		trace := a.beginBridgeTrace("library", "ResolveLibraryFolderForReleaseMBID", "releaseMBID="+bridgeTraceLogString(releaseMBID))
		cleanReleaseMBID := sanitizeMusicBrainzID(releaseMBID)
		if cleanReleaseMBID == "" || !a.musicBrainzTagDatabaseEnabled() {
			trace.finish("folderPath=\"\"", nil)
			return ""
		}

		a.musicBrainzTagMu.Lock()
		defer a.musicBrainzTagMu.Unlock()
		a.ensureMusicBrainzTagDatabaseLoadedLocked()

		folderPathsByID := a.musicBrainzTagReleaseFoldersByID[cleanReleaseMBID]
		if len(folderPathsByID) == 0 {
			trace.finish("folderPath=\"\"", nil)
			return ""
		}

		folderPaths := make([]string, 0, len(folderPathsByID))
		for folderPath := range folderPathsByID {
			folderPaths = append(folderPaths, folderPath)
		}
		sortPathsCaseInsensitive(folderPaths)

		for _, folderPath := range folderPaths {
			if resolved := a.resolveAvailableLibraryFolderForVirtualPathLocked(folderPath); resolved != "" {
				trace.finish("folderPath="+bridgeTraceLogString(resolved), nil)
				return resolved
			}
		}

		trace.finish("folderPath=\"\"", nil)
		return ""
	})
}

// GetLibraryIndexedFilePage returns a paginated slice of indexed files for initial frontend hydration.
func (a *App) GetLibraryIndexedFilePage(kind string, offset int, limit int) LibraryIndexedFilePage {
	return profiledValue(a, "GetLibraryIndexedFilePage", func() LibraryIndexedFilePage {
		trace := a.beginBridgeTrace(
			"library",
			"GetLibraryIndexedFilePage",
			"kind="+bridgeTraceLogString(kind)+fmt.Sprintf(" offset=%d limit=%d", offset, limit),
		)
		normalizedKind := strings.ToLower(strings.TrimSpace(kind))
		contentState := a.libraryContentState()

		contentState.indexMu.RLock()
		defer contentState.indexMu.RUnlock()

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
				page := emptyDeferredPage("track", contentState.libraryScan.TrackCount)
				trace.finish(libraryIndexedFilePageForLog(page), nil)
				return page
			}
			page := pagedIndexedFiles("track", contentState.libraryScan.TrackFiles, offset, limit)
			trace.finish(libraryIndexedFilePageForLog(page), nil)
			return page
		case "text-file":
			if contentState.libraryScan.DeferredFiles && len(contentState.libraryScan.TextFiles) == 0 {
				page := emptyDeferredPage("text-file", contentState.libraryScan.TextFileCount)
				trace.finish(libraryIndexedFilePageForLog(page), nil)
				return page
			}
			page := pagedIndexedFiles("text-file", contentState.libraryScan.TextFiles, offset, limit)
			trace.finish(libraryIndexedFilePageForLog(page), nil)
			return page
		case "image-file":
			if contentState.libraryScan.DeferredFiles && len(contentState.libraryScan.ImageFiles) == 0 {
				page := emptyDeferredPage("image-file", contentState.libraryScan.ImageFileCount)
				trace.finish(libraryIndexedFilePageForLog(page), nil)
				return page
			}
			page := pagedIndexedFiles("image-file", contentState.libraryScan.ImageFiles, offset, limit)
			trace.finish(libraryIndexedFilePageForLog(page), nil)
			return page
		default:
			page := LibraryIndexedFilePage{
				Kind:         normalizedKind,
				Offset:       offset,
				Limit:        limit,
				TotalEntries: 0,
				Entries:      []LibraryIndexedFile{},
			}
			trace.finish(libraryIndexedFilePageForLog(page), nil)
			return page
		}
	})
}

// GetLibraryFolderPage returns a paginated folder listing from the current backend index using the default name sort.
func (a *App) GetLibraryFolderPage(folderPath string, offset int, limit int) LibraryFolderPage {
	return profiledValue(a, "GetLibraryFolderPage", func() LibraryFolderPage {
		return a.GetLibraryFolderPageSorted(folderPath, libraryBrowserSortName, offset, limit)
	})
}

// GetLibraryFolderPageSorted returns a paginated folder listing from the current backend index.
func (a *App) GetLibraryFolderPageSorted(folderPath string, sortMode string, offset int, limit int) LibraryFolderPage {
	return profiledValue(a, "GetLibraryFolderPageSorted", func() LibraryFolderPage {
		trace := a.beginBridgeTrace(
			"library",
			"GetLibraryFolderPageSorted",
			"folderPath="+bridgeTraceLogString(folderPath)+" sortMode="+bridgeTraceLogString(sortMode)+fmt.Sprintf(" offset=%d limit=%d", offset, limit),
		)
		queryStartTime := time.Now()
		normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
		normalizedSortMode := normalizeLibraryBrowserSortMode(sortMode)
		if !ok {
			page := LibraryFolderPage{
				FolderPath: normalizedFolderPath,
				Offset:     offset,
				Limit:      limit,
				Entries:    []LibraryBrowserEntry{},
			}
			trace.finish(libraryFolderPageForLog(page), nil)
			return page
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
		contentState.indexMu.RLock()
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
		contentState.indexMu.RUnlock()

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
		trace.finish(libraryFolderPageForLog(result), nil)
		return result
	})
}

// SearchLibrary returns paginated server-side search results across folders and indexed files.
func (a *App) SearchLibrary(query string, offset int, limit int) LibrarySearchPage {
	return profiledValue(a, "SearchLibrary", func() LibrarySearchPage {
		trace := a.beginBridgeTrace(
			"library",
			"SearchLibrary",
			"query="+bridgeTraceLogString(query)+fmt.Sprintf(" offset=%d limit=%d", offset, limit),
		)
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
			page := LibrarySearchPage{
				Query:   query,
				Offset:  offset,
				Limit:   limit,
				Entries: []LibraryBrowserEntry{},
			}
			trace.finish(librarySearchPageForLog(page), nil)
			return page
		}

		musicBrainzTagQuery, hasMusicBrainzTagQuery := parseMusicBrainzTagSearchQuery(query)
		musicBrainzEntityIDQuery, hasMusicBrainzEntityIDQuery := parseMusicBrainzEntityIDSearchQuery(query)

		if searchCanceled() {
			a.logRescanEvent("SearchLibrary CANCELED before lock: query=%q offset=%d", logQuery, offset)
			page := LibrarySearchPage{
				Query:   query,
				Offset:  offset,
				Limit:   limit,
				Entries: []LibraryBrowserEntry{},
			}
			trace.finish(librarySearchPageForLog(page), nil)
			return page
		}

		lockWaitStart := time.Now()
		a.logRescanEvent("SearchLibrary waiting for indexMu lock: query=%q", logQuery)
		contentState.indexMu.Lock()
		a.logRescanEvent("SearchLibrary acquired lock (waited %.2fms): query=%q", time.Since(lockWaitStart).Seconds()*1000, logQuery)
		defer contentState.indexMu.Unlock()

		if searchCanceled() {
			a.logRescanEvent("SearchLibrary CANCELED after lock: query=%q offset=%d", logQuery, offset)
			page := LibrarySearchPage{
				Query:   query,
				Offset:  offset,
				Limit:   limit,
				Entries: []LibraryBrowserEntry{},
			}
			trace.finish(librarySearchPageForLog(page), nil)
			return page
		}

		var entries []LibraryBrowserEntry
		mode := "fallback-map"
		canceled := false

		if hasMusicBrainzTagQuery {
			entries = a.buildMusicBrainzTagSearchResultsLocked(musicBrainzTagQuery)
			mode = "musicbrainz-tags"
		} else if hasMusicBrainzEntityIDQuery {
			entries = a.buildMusicBrainzEntityIDSearchResultsLocked(musicBrainzEntityIDQuery)
			mode = "musicbrainz-mbid"
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
			page := LibrarySearchPage{
				Query:   query,
				Offset:  offset,
				Limit:   limit,
				Entries: []LibraryBrowserEntry{},
			}
			trace.finish(librarySearchPageForLog(page), nil)
			return page
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
		trace.finish(librarySearchPageForLog(result), nil)

		return result
	})
}

// IsLibraryFolderImmediateDescendantsEnumerated reports whether a folder's
// direct children are fully enumerated during the active scan.
func (a *App) IsLibraryFolderImmediateDescendantsEnumerated(folderPath string) bool {
	return profiledValue(a, "IsLibraryFolderImmediateDescendantsEnumerated", func() bool {
		trace := a.beginBridgeTrace("library", "IsLibraryFolderImmediateDescendantsEnumerated", "folderPath="+bridgeTraceLogString(folderPath))
		normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
		if !ok {
			trace.finish("enumerated=false", nil)
			return false
		}
		contentState := a.libraryContentState()
		scanState := a.libraryScanState()

		contentState.indexMu.RLock()
		defer contentState.indexMu.RUnlock()

		if !scanState.scanInProgress {
			trace.finish("enumerated=true", nil)
			return true
		}

		remainingChildren, exists := scanState.scanRemainingImmediateChildrenByFolder[normalizedFolderPath]
		if !exists {
			trace.finish("enumerated=true", nil)
			return true
		}

		enumerated := remainingChildren <= 0
		trace.finish(fmt.Sprintf("enumerated=%t", enumerated), nil)
		return enumerated
	})
}

// GetLibraryFolderCoverPath returns the current best cover image path for a folder.
func (a *App) GetLibraryFolderCoverPath(folderPath string) string {
	return profiledValue(a, "GetLibraryFolderCoverPath", func() string {
		trace := a.beginBridgeTrace("library", "GetLibraryFolderCoverPath", "folderPath="+bridgeTraceLogString(folderPath))
		normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
		if !ok {
			trace.finish("coverPath=\"\"", nil)
			return ""
		}
		contentState := a.libraryContentState()

		contentState.indexMu.RLock()
		folderKey := strings.ToLower(normalizedFolderPath)
		if contentState.libraryScan.CoverPathByFolder != nil {
			if coverPath, exists := contentState.libraryScan.CoverPathByFolder[folderKey]; exists {
				contentState.indexMu.RUnlock()
				trace.finish("coverPath="+bridgeTraceLogString(coverPath), nil)
				return coverPath
			}
		}
		contentState.indexMu.RUnlock()
		trace.finish("coverPath=\"\"", nil)
		return ""
	})
}

func sortedIndexedFilesWithinFolder(normalizedFolderPath string, files []LibraryIndexedFile) []LibraryIndexedFile {
	if len(files) == 0 {
		return []LibraryIndexedFile{}
	}

	prefix := ""
	if normalizedFolderPath != "" {
		prefix = normalizedFolderPath + "/"
	}

	filteredFiles := make([]LibraryIndexedFile, 0)
	for _, indexed := range files {
		if normalizedFolderPath == "" || indexed.FolderPath == normalizedFolderPath || strings.HasPrefix(indexed.FolderPath, prefix) {
			filteredFiles = append(filteredFiles, indexed)
		}
	}

	sort.SliceStable(filteredFiles, func(i int, j int) bool {
		left := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, filteredFiles[i].RelativePath))
		right := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, filteredFiles[j].RelativePath))
		return left < right
	})

	return filteredFiles
}

func (a *App) getFolderImageFilesFromMapsLocked(normalizedFolderPath string) []LibraryIndexedFile {
	contentState := a.libraryContentState()
	imageFiles := make([]LibraryIndexedFile, 0, len(contentState.imageByPath))
	for _, indexed := range contentState.imageByPath {
		imageFiles = append(imageFiles, indexed)
	}

	return sortedIndexedFilesWithinFolder(normalizedFolderPath, imageFiles)
}

// GetLibraryFolderTrackPaths resolves all audio tracks under a folder subtree for queue actions.
func (a *App) GetLibraryFolderTrackPaths(folderPath string) []string {
	return profiledValue(a, "GetLibraryFolderTrackPaths", func() []string {
		trace := a.beginBridgeTrace("library", "GetLibraryFolderTrackPaths", "folderPath="+bridgeTraceLogString(folderPath))
		queryStartTime := time.Now()
		normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
		if !ok {
			trace.finish("tracks=0", nil)
			return []string{}
		}
		contentState := a.libraryContentState()

		contentState.indexMu.RLock()

		mode := "fallback-map"
		useFilesystemFallback := false
		var rootsSnapshot []libraryRootConfig
		if a.isLibraryFolderIndexReadyLocked() {
			mode = "derived-index"
			paths := a.getFolderTrackPathsFromDerivedIndexLocked(normalizedFolderPath)
			contentState.indexMu.RUnlock()
			a.logRescanEvent(
				"GetLibraryFolderTrackPaths END: folder=%s mode=%s tracks=%d took %.2fms",
				folderPathForLog(normalizedFolderPath),
				mode,
				len(paths),
				time.Since(queryStartTime).Seconds()*1000,
			)
			trace.finish(fmt.Sprintf("tracks=%d mode=%s", len(paths), mode), nil)
			return paths
		} else if contentState.libraryScan.DeferredFiles && len(contentState.trackByPath) == 0 {
			rootsSnapshot = append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
			useFilesystemFallback = true
			mode = "lazy-filesystem"
		}

		if useFilesystemFallback {
			contentState.indexMu.RUnlock()
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
			trace.finish(fmt.Sprintf("tracks=%d mode=%s", len(paths), mode), nil)
			return paths
		}

		paths := a.getFolderTrackPathsFromMapsLocked(normalizedFolderPath)
		contentState.indexMu.RUnlock()
		a.logRescanEvent(
			"GetLibraryFolderTrackPaths END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			len(paths),
			time.Since(queryStartTime).Seconds()*1000,
		)
		trace.finish(fmt.Sprintf("tracks=%d mode=%s", len(paths), mode), nil)
		return paths
	})
}

// GetLibraryFolderImageFiles resolves image files under a folder subtree for on-demand gallery hydration.
func (a *App) GetLibraryFolderImageFiles(folderPath string) []LibraryIndexedFile {
	return profiledValue(a, "GetLibraryFolderImageFiles", func() []LibraryIndexedFile {
		trace := a.beginBridgeTrace("library", "GetLibraryFolderImageFiles", "folderPath="+bridgeTraceLogString(folderPath))
		queryStartTime := time.Now()
		normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
		if !ok {
			trace.finish("images=0", nil)
			return []LibraryIndexedFile{}
		}

		contentState := a.libraryContentState()
		contentState.indexMu.RLock()

		mode := "fallback-map"
		useFilesystemFallback := false
		var rootsSnapshot []libraryRootConfig
		if len(contentState.libraryScan.ImageFiles) > 0 {
			mode = "scan-slice"
			imageFiles := sortedIndexedFilesWithinFolder(normalizedFolderPath, contentState.libraryScan.ImageFiles)
			contentState.indexMu.RUnlock()
			a.logRescanEvent(
				"GetLibraryFolderImageFiles END: folder=%s mode=%s images=%d took %.2fms",
				folderPathForLog(normalizedFolderPath),
				mode,
				len(imageFiles),
				time.Since(queryStartTime).Seconds()*1000,
			)
			trace.finish(fmt.Sprintf("images=%d mode=%s", len(imageFiles), mode), nil)
			return imageFiles
		} else if contentState.libraryScan.DeferredFiles && len(contentState.imageByPath) == 0 {
			rootsSnapshot = append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
			useFilesystemFallback = true
			mode = "lazy-filesystem"
		}

		if useFilesystemFallback {
			contentState.indexMu.RUnlock()
			imageFiles, err := collectLibraryFolderImageFilesFromFilesystem(rootsSnapshot, normalizedFolderPath)
			if err != nil {
				imageFiles = []LibraryIndexedFile{}
			}
			a.logRescanEvent(
				"GetLibraryFolderImageFiles END: folder=%s mode=%s images=%d took %.2fms",
				folderPathForLog(normalizedFolderPath),
				mode,
				len(imageFiles),
				time.Since(queryStartTime).Seconds()*1000,
			)
			trace.finish(fmt.Sprintf("images=%d mode=%s", len(imageFiles), mode), nil)
			return imageFiles
		}

		imageFiles := a.getFolderImageFilesFromMapsLocked(normalizedFolderPath)
		contentState.indexMu.RUnlock()
		a.logRescanEvent(
			"GetLibraryFolderImageFiles END: folder=%s mode=%s images=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			len(imageFiles),
			time.Since(queryStartTime).Seconds()*1000,
		)
		trace.finish(fmt.Sprintf("images=%d mode=%s", len(imageFiles), mode), nil)
		return imageFiles
	})
}

// GetLibraryFolderTrackCount returns the number of audio tracks under a folder subtree.
func (a *App) GetLibraryFolderTrackCount(folderPath string) int {
	return profiledValue(a, "GetLibraryFolderTrackCount", func() int {
		trace := a.beginBridgeTrace("library", "GetLibraryFolderTrackCount", "folderPath="+bridgeTraceLogString(folderPath))
		queryStartTime := time.Now()
		normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
		if !ok {
			trace.finish("tracks=0", nil)
			return 0
		}
		contentState := a.libraryContentState()

		contentState.indexMu.RLock()

		mode := "fallback-map"
		useFilesystemFallback := false
		var rootsSnapshot []libraryRootConfig
		if a.isLibraryFolderIndexReadyLocked() {
			mode = "derived-index"
			count := a.getFolderTrackCountFromDerivedIndexLocked(normalizedFolderPath)
			contentState.indexMu.RUnlock()
			a.logRescanEvent(
				"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
				folderPathForLog(normalizedFolderPath),
				mode,
				count,
				time.Since(queryStartTime).Seconds()*1000,
			)
			trace.finish(fmt.Sprintf("tracks=%d mode=%s", count, mode), nil)
			return count
		} else if contentState.libraryScan.DeferredFiles && len(contentState.trackByPath) == 0 {
			rootsSnapshot = append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
			useFilesystemFallback = true
			mode = "lazy-filesystem"
		}

		if useFilesystemFallback {
			contentState.indexMu.RUnlock()
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
			trace.finish(fmt.Sprintf("tracks=%d mode=%s", count, mode), nil)
			return count
		}

		count := a.getFolderTrackCountFromMapsLocked(normalizedFolderPath)
		contentState.indexMu.RUnlock()
		a.logRescanEvent(
			"GetLibraryFolderTrackCount END: folder=%s mode=%s tracks=%d took %.2fms",
			folderPathForLog(normalizedFolderPath),
			mode,
			count,
			time.Since(queryStartTime).Seconds()*1000,
		)
		trace.finish(fmt.Sprintf("tracks=%d mode=%s", count, mode), nil)
		return count
	})
}
