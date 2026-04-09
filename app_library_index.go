package main

import (
	"sort"
	"strings"
	"time"
)

const librarySearchCacheLimit = 24

type libraryDerivedIndexData struct {
	folderEntriesByFolder    map[string][]LibraryBrowserEntry
	folderChildPathsByFolder map[string][]string
	trackFilesByFolder       map[string][]LibraryIndexedFile
	searchFolderEntries      []LibraryBrowserEntry
	searchTrackEntries       []LibraryBrowserEntry
	searchTextEntries        []LibraryBrowserEntry
	searchImageEntries       []LibraryBrowserEntry
}

func (a *App) markLibraryDerivedIndexDirtyLocked() {
	indexState := a.libraryIndexState()
	indexState.libraryDerivedIndexGeneration++
	indexState.libraryDerivedIndexDirty = true
	indexState.folderEntriesByFolder = nil
	indexState.folderChildPathsByFolder = nil
	indexState.trackFilesByFolder = nil
	indexState.searchFolderEntries = nil
	indexState.searchTrackEntries = nil
	indexState.searchTextEntries = nil
	indexState.searchImageEntries = nil
	indexState.searchResultsByQuery = nil
	indexState.searchCacheOrder = nil
	indexState.searchLastQuery = ""
	indexState.searchLastResults = nil
}

func (a *App) isLibraryDerivedIndexReadyLocked() bool {
	indexState := a.libraryIndexState()
	return !indexState.libraryDerivedIndexDirty &&
		!indexState.libraryDerivedIndexBuilding &&
		indexState.folderEntriesByFolder != nil &&
		indexState.folderChildPathsByFolder != nil &&
		indexState.trackFilesByFolder != nil &&
		indexState.searchFolderEntries != nil &&
		indexState.searchTrackEntries != nil &&
		indexState.searchTextEntries != nil &&
		indexState.searchImageEntries != nil &&
		indexState.searchResultsByQuery != nil
}

func (a *App) maybeStartLibraryDerivedIndexRebuildLocked() {
	scanState := a.libraryScanState()
	contentState := a.libraryContentState()
	indexState := a.libraryIndexState()
	if scanState.scanInProgress || indexState.libraryFileHydrationPending || !indexState.libraryDerivedIndexDirty || indexState.libraryDerivedIndexBuilding {
		return
	}

	generation := indexState.libraryDerivedIndexGeneration
	trackFiles := make([]LibraryIndexedFile, 0, len(contentState.trackByPath))
	for _, indexed := range contentState.trackByPath {
		trackFiles = append(trackFiles, indexed)
	}

	textFiles := make([]LibraryIndexedFile, 0, len(contentState.textByPath))
	for _, indexed := range contentState.textByPath {
		textFiles = append(textFiles, indexed)
	}

	imageFiles := make([]LibraryIndexedFile, 0, len(contentState.imageByPath))
	for _, indexed := range contentState.imageByPath {
		imageFiles = append(imageFiles, indexed)
	}

	indexState.libraryDerivedIndexBuilding = true
	a.logRescanEvent(
		"rebuildLibraryDerivedIndex START (async): %d tracks, %d text, %d images",
		len(trackFiles),
		len(textFiles),
		len(imageFiles),
	)

	go a.rebuildLibraryDerivedIndexAsync(generation, trackFiles, textFiles, imageFiles)
}

func (a *App) rebuildLibraryDerivedIndexAsync(generation uint64, trackFiles []LibraryIndexedFile, textFiles []LibraryIndexedFile, imageFiles []LibraryIndexedFile) {
	rebuildStartedAt := time.Now()
	indexData := buildLibraryDerivedIndexData(trackFiles, textFiles, imageFiles)
	rebuildDurationMs := time.Since(rebuildStartedAt).Seconds() * 1000
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	indexState := a.libraryIndexState()

	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	if scanState.scanInProgress || generation != indexState.libraryDerivedIndexGeneration {
		indexState.libraryDerivedIndexBuilding = false
		a.maybeStartLibraryDerivedIndexRebuildLocked()
		return
	}

	indexState.folderEntriesByFolder = indexData.folderEntriesByFolder
	indexState.folderChildPathsByFolder = indexData.folderChildPathsByFolder
	indexState.trackFilesByFolder = indexData.trackFilesByFolder
	indexState.searchFolderEntries = indexData.searchFolderEntries
	indexState.searchTrackEntries = indexData.searchTrackEntries
	indexState.searchTextEntries = indexData.searchTextEntries
	indexState.searchImageEntries = indexData.searchImageEntries
	indexState.searchResultsByQuery = make(map[string][]LibraryBrowserEntry)
	indexState.searchCacheOrder = make([]string, 0, librarySearchCacheLimit)
	indexState.searchLastQuery = ""
	indexState.searchLastResults = nil
	indexState.libraryDerivedIndexDirty = false
	indexState.libraryDerivedIndexBuilding = false

	a.logRescanEvent(
		"rebuildLibraryDerivedIndex END: %d folders, %d track files, %d text files, %d images in %.2fms",
		len(indexData.searchFolderEntries),
		len(indexData.searchTrackEntries),
		len(indexData.searchTextEntries),
		len(indexData.searchImageEntries),
		rebuildDurationMs,
	)
}

func addFolderAncestorsToIndex(folderPath string, folderChildSetByParent map[string]map[string]struct{}, folderPaths map[string]struct{}) {
	cleanFolderPath := strings.TrimSpace(folderPath)
	if cleanFolderPath == "" {
		return
	}

	segments := strings.Split(cleanFolderPath, "/")
	parentPath := ""
	for _, segment := range segments {
		if segment == "" {
			continue
		}

		childPath := segment
		if parentPath != "" {
			childPath = parentPath + "/" + segment
		}

		childSet := folderChildSetByParent[parentPath]
		if childSet == nil {
			childSet = make(map[string]struct{})
			folderChildSetByParent[parentPath] = childSet
		}
		childSet[childPath] = struct{}{}
		folderPaths[childPath] = struct{}{}

		parentPath = childPath
	}
}

func sortBrowserEntriesByPath(entries []LibraryBrowserEntry) {
	sort.SliceStable(entries, func(i int, j int) bool {
		return strings.ToLower(entries[i].Path) < strings.ToLower(entries[j].Path)
	})
}

func sortBrowserEntriesByName(entries []LibraryBrowserEntry) {
	sort.SliceStable(entries, func(i int, j int) bool {
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
}

func sortBrowserEntriesByRelativePath(entries []LibraryBrowserEntry) {
	sort.SliceStable(entries, func(i int, j int) bool {
		return strings.ToLower(entries[i].RelativePath) < strings.ToLower(entries[j].RelativePath)
	})
}

func sortPathsCaseInsensitive(paths []string) {
	sort.SliceStable(paths, func(i int, j int) bool {
		return strings.ToLower(paths[i]) < strings.ToLower(paths[j])
	})
}

func collectDiscoveredScanFolders(folderPaths map[string]struct{}, discoveredByParent map[string]map[string]struct{}) {
	for _, childSet := range discoveredByParent {
		for childPath := range childSet {
			if strings.TrimSpace(childPath) == "" {
				continue
			}

			folderPaths[childPath] = struct{}{}
		}
	}
}

func buildLibraryDerivedIndexData(trackFiles []LibraryIndexedFile, textFiles []LibraryIndexedFile, imageFiles []LibraryIndexedFile) libraryDerivedIndexData {
	folderChildSetByParent := make(map[string]map[string]struct{})
	folderPaths := map[string]struct{}{}

	trackEntriesByFolder := make(map[string][]LibraryBrowserEntry)
	textEntriesByFolder := make(map[string][]LibraryBrowserEntry)
	imageEntriesByFolder := make(map[string][]LibraryBrowserEntry)
	trackFilesByFolder := make(map[string][]LibraryIndexedFile)

	searchTrackEntries := make([]LibraryBrowserEntry, 0, len(trackFiles))
	searchTextEntries := make([]LibraryBrowserEntry, 0, len(textFiles))
	searchImageEntries := make([]LibraryBrowserEntry, 0, len(imageFiles))

	for _, indexed := range trackFiles {
		addFolderAncestorsToIndex(indexed.FolderPath, folderChildSetByParent, folderPaths)
		entry := browserEntryFromIndexedFile("track", indexed)
		trackEntriesByFolder[indexed.FolderPath] = append(trackEntriesByFolder[indexed.FolderPath], entry)
		trackFilesByFolder[indexed.FolderPath] = append(trackFilesByFolder[indexed.FolderPath], indexed)
		searchTrackEntries = append(searchTrackEntries, entry)
	}

	for _, indexed := range textFiles {
		addFolderAncestorsToIndex(indexed.FolderPath, folderChildSetByParent, folderPaths)
		entry := browserEntryFromIndexedFile("text-file", indexed)
		textEntriesByFolder[indexed.FolderPath] = append(textEntriesByFolder[indexed.FolderPath], entry)
		searchTextEntries = append(searchTextEntries, entry)
	}

	for _, indexed := range imageFiles {
		addFolderAncestorsToIndex(indexed.FolderPath, folderChildSetByParent, folderPaths)
		entry := browserEntryFromIndexedFile("image-file", indexed)
		imageEntriesByFolder[indexed.FolderPath] = append(imageEntriesByFolder[indexed.FolderPath], entry)
		searchImageEntries = append(searchImageEntries, entry)
	}

	folderKeys := map[string]struct{}{"": {}}
	for folderPath := range folderPaths {
		folderKeys[folderPath] = struct{}{}
	}
	for folderPath := range folderChildSetByParent {
		folderKeys[folderPath] = struct{}{}
	}
	for folderPath := range trackEntriesByFolder {
		folderKeys[folderPath] = struct{}{}
	}
	for folderPath := range textEntriesByFolder {
		folderKeys[folderPath] = struct{}{}
	}
	for folderPath := range imageEntriesByFolder {
		folderKeys[folderPath] = struct{}{}
	}

	folderEntriesByFolder := make(map[string][]LibraryBrowserEntry, len(folderKeys))
	folderChildPathsByFolder := make(map[string][]string, len(folderKeys))
	sortedTrackFilesByFolder := make(map[string][]LibraryIndexedFile, len(folderKeys))

	for folderPath := range folderKeys {
		childPaths := make([]string, 0)
		childEntries := make([]LibraryBrowserEntry, 0)

		if childSet := folderChildSetByParent[folderPath]; len(childSet) > 0 {
			childPaths = make([]string, 0, len(childSet))
			childEntries = make([]LibraryBrowserEntry, 0, len(childSet))
			for childPath := range childSet {
				childPaths = append(childPaths, childPath)
				childEntries = append(childEntries, folderBrowserEntry(childPath))
			}
			sortPathsCaseInsensitive(childPaths)
			sortBrowserEntriesByPath(childEntries)
		}

		directTrackEntries := append([]LibraryBrowserEntry(nil), trackEntriesByFolder[folderPath]...)
		directTextEntries := append([]LibraryBrowserEntry(nil), textEntriesByFolder[folderPath]...)
		directImageEntries := append([]LibraryBrowserEntry(nil), imageEntriesByFolder[folderPath]...)

		sortBrowserEntriesByName(directTrackEntries)
		sortBrowserEntriesByName(directTextEntries)
		sortBrowserEntriesByName(directImageEntries)

		entries := make([]LibraryBrowserEntry, 0, len(childEntries)+len(directTrackEntries)+len(directTextEntries)+len(directImageEntries))
		entries = append(entries, childEntries...)
		entries = append(entries, directTrackEntries...)
		entries = append(entries, directTextEntries...)
		entries = append(entries, directImageEntries...)

		folderEntriesByFolder[folderPath] = entries
		folderChildPathsByFolder[folderPath] = childPaths

		directTrackFiles := append([]LibraryIndexedFile(nil), trackFilesByFolder[folderPath]...)
		sort.SliceStable(directTrackFiles, func(i int, j int) bool {
			left := strings.ToLower(relativePathWithinFolder(folderPath, directTrackFiles[i].RelativePath))
			right := strings.ToLower(relativePathWithinFolder(folderPath, directTrackFiles[j].RelativePath))
			return left < right
		})
		sortedTrackFilesByFolder[folderPath] = directTrackFiles
	}

	searchFolderEntries := make([]LibraryBrowserEntry, 0, len(folderPaths))
	for folderPath := range folderPaths {
		searchFolderEntries = append(searchFolderEntries, folderBrowserEntry(folderPath))
	}

	sortBrowserEntriesByPath(searchFolderEntries)
	sortBrowserEntriesByRelativePath(searchTrackEntries)
	sortBrowserEntriesByRelativePath(searchTextEntries)
	sortBrowserEntriesByRelativePath(searchImageEntries)

	return libraryDerivedIndexData{
		folderEntriesByFolder:    folderEntriesByFolder,
		folderChildPathsByFolder: folderChildPathsByFolder,
		trackFilesByFolder:       sortedTrackFilesByFolder,
		searchFolderEntries:      searchFolderEntries,
		searchTrackEntries:       searchTrackEntries,
		searchTextEntries:        searchTextEntries,
		searchImageEntries:       searchImageEntries,
	}
}

func libraryEntryMatchesSearchQuery(entry LibraryBrowserEntry, normalizedQuery string) bool {
	switch entry.Kind {
	case "folder":
		return strings.Contains(strings.ToLower(entry.Path), normalizedQuery) ||
			strings.Contains(strings.ToLower(entry.Name), normalizedQuery)
	default:
		return strings.Contains(strings.ToLower(entry.Name), normalizedQuery) ||
			strings.Contains(strings.ToLower(entry.RelativePath), normalizedQuery)
	}
}

func filterSearchEntries(entries []LibraryBrowserEntry, normalizedQuery string, shouldCancel func() bool) ([]LibraryBrowserEntry, bool) {
	if len(entries) == 0 {
		return []LibraryBrowserEntry{}, false
	}

	filtered := make([]LibraryBrowserEntry, 0, len(entries))
	for index, entry := range entries {
		if shouldCancel != nil && index%256 == 0 && shouldCancel() {
			return []LibraryBrowserEntry{}, true
		}

		if libraryEntryMatchesSearchQuery(entry, normalizedQuery) {
			filtered = append(filtered, entry)
		}
	}

	return filtered, false
}

func (a *App) rememberSearchResultLocked(normalizedQuery string, entries []LibraryBrowserEntry) {
	indexState := a.libraryIndexState()
	if indexState.searchResultsByQuery == nil {
		indexState.searchResultsByQuery = make(map[string][]LibraryBrowserEntry)
	}

	if _, exists := indexState.searchResultsByQuery[normalizedQuery]; !exists {
		indexState.searchCacheOrder = append(indexState.searchCacheOrder, normalizedQuery)
	}

	indexState.searchResultsByQuery[normalizedQuery] = entries

	for len(indexState.searchCacheOrder) > librarySearchCacheLimit {
		evictedQuery := indexState.searchCacheOrder[0]
		indexState.searchCacheOrder = indexState.searchCacheOrder[1:]
		delete(indexState.searchResultsByQuery, evictedQuery)
	}
}

func (a *App) buildSearchResultsLocked(normalizedQuery string, shouldCancel func() bool) ([]LibraryBrowserEntry, string, bool) {
	indexState := a.libraryIndexState()
	if cachedEntries, exists := indexState.searchResultsByQuery[normalizedQuery]; exists {
		return cachedEntries, "cache-hit", false
	}

	var entries []LibraryBrowserEntry
	mode := "full-filter"
	if indexState.searchLastQuery != "" && strings.HasPrefix(normalizedQuery, indexState.searchLastQuery) && len(indexState.searchLastResults) > 0 {
		var canceled bool
		entries, canceled = filterSearchEntries(indexState.searchLastResults, normalizedQuery, shouldCancel)
		if canceled {
			return []LibraryBrowserEntry{}, mode, true
		}
		mode = "prefix-filter"
	} else {
		folderMatches, canceled := filterSearchEntries(indexState.searchFolderEntries, normalizedQuery, shouldCancel)
		if canceled {
			return []LibraryBrowserEntry{}, mode, true
		}

		trackMatches, canceled := filterSearchEntries(indexState.searchTrackEntries, normalizedQuery, shouldCancel)
		if canceled {
			return []LibraryBrowserEntry{}, mode, true
		}

		textMatches, canceled := filterSearchEntries(indexState.searchTextEntries, normalizedQuery, shouldCancel)
		if canceled {
			return []LibraryBrowserEntry{}, mode, true
		}

		imageMatches, canceled := filterSearchEntries(indexState.searchImageEntries, normalizedQuery, shouldCancel)
		if canceled {
			return []LibraryBrowserEntry{}, mode, true
		}

		entries = make([]LibraryBrowserEntry, 0, len(folderMatches)+len(trackMatches)+len(textMatches)+len(imageMatches))
		entries = append(entries, folderMatches...)
		entries = append(entries, trackMatches...)
		entries = append(entries, textMatches...)
		entries = append(entries, imageMatches...)
	}

	if shouldCancel != nil && shouldCancel() {
		return []LibraryBrowserEntry{}, mode, true
	}

	a.rememberSearchResultLocked(normalizedQuery, entries)
	indexState.searchLastQuery = normalizedQuery
	indexState.searchLastResults = entries
	return entries, mode, false
}

func copyPagedLibraryEntries(entries []LibraryBrowserEntry, offset int, limit int) []LibraryBrowserEntry {
	pagedEntries := pagedLibraryEntries(entries, offset, limit)
	return append([]LibraryBrowserEntry(nil), pagedEntries...)
}

func (a *App) buildFolderEntriesFromMapsLocked(normalizedFolderPath string) []LibraryBrowserEntry {
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	folderEntriesByPath := make(map[string]LibraryBrowserEntry)
	trackEntries := make([]LibraryBrowserEntry, 0)
	textEntries := make([]LibraryBrowserEntry, 0)
	imageEntries := make([]LibraryBrowserEntry, 0)

	if scanState.scanInProgress && scanState.scanDiscoveredChildFoldersByParent != nil {
		for childPath := range scanState.scanDiscoveredChildFoldersByParent[normalizedFolderPath] {
			folderEntriesByPath[childPath] = folderBrowserEntry(childPath)
		}
	}

	appendEntry := func(indexed LibraryIndexedFile, kind string, destination *[]LibraryBrowserEntry) {
		if indexed.FolderPath == normalizedFolderPath {
			*destination = append(*destination, browserEntryFromIndexedFile(kind, indexed))
			return
		}

		childFolderPath, childOk := directChildFolderPath(normalizedFolderPath, indexed.FolderPath)
		if !childOk {
			return
		}

		if _, exists := folderEntriesByPath[childFolderPath]; !exists {
			folderEntriesByPath[childFolderPath] = folderBrowserEntry(childFolderPath)
		}
	}

	for _, indexed := range contentState.trackByPath {
		appendEntry(indexed, "track", &trackEntries)
	}
	for _, indexed := range contentState.textByPath {
		appendEntry(indexed, "text-file", &textEntries)
	}
	for _, indexed := range contentState.imageByPath {
		appendEntry(indexed, "image-file", &imageEntries)
	}

	folderEntries := make([]LibraryBrowserEntry, 0, len(folderEntriesByPath))
	for _, entry := range folderEntriesByPath {
		folderEntries = append(folderEntries, entry)
	}

	sortBrowserEntriesByPath(folderEntries)
	sortBrowserEntriesByName(trackEntries)
	sortBrowserEntriesByName(textEntries)
	sortBrowserEntriesByName(imageEntries)

	entries := make([]LibraryBrowserEntry, 0, len(folderEntries)+len(trackEntries)+len(textEntries)+len(imageEntries))
	entries = append(entries, folderEntries...)
	entries = append(entries, trackEntries...)
	entries = append(entries, textEntries...)
	entries = append(entries, imageEntries...)
	return entries
}

func (a *App) buildSearchEntriesFromMapsLocked(normalizedQuery string, shouldCancel func() bool) ([]LibraryBrowserEntry, bool) {
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	folderPaths := make(map[string]struct{})
	folderMatchesByPath := make(map[string]LibraryBrowserEntry)
	trackMatches := make([]LibraryBrowserEntry, 0)
	textMatches := make([]LibraryBrowserEntry, 0)
	imageMatches := make([]LibraryBrowserEntry, 0)

	collectFolderAncestors := func(folderPath string) {
		if folderPath == "" {
			return
		}

		segments := strings.Split(folderPath, "/")
		cumulative := ""
		for _, segment := range segments {
			if segment == "" {
				continue
			}

			if cumulative == "" {
				cumulative = segment
			} else {
				cumulative += "/" + segment
			}

			folderPaths[cumulative] = struct{}{}
		}
	}

	matchIndexedFile := func(indexed LibraryIndexedFile, kind string, destination *[]LibraryBrowserEntry) {
		collectFolderAncestors(indexed.FolderPath)
		candidateName := strings.ToLower(indexed.Name)
		candidateRelativePath := strings.ToLower(indexed.RelativePath)
		if strings.Contains(candidateName, normalizedQuery) || strings.Contains(candidateRelativePath, normalizedQuery) {
			*destination = append(*destination, browserEntryFromIndexedFile(kind, indexed))
		}
	}

	if scanState.scanInProgress && scanState.scanDiscoveredChildFoldersByParent != nil {
		collectDiscoveredScanFolders(folderPaths, scanState.scanDiscoveredChildFoldersByParent)
	}

	trackIndex := 0
	for _, indexed := range contentState.trackByPath {
		if shouldCancel != nil && trackIndex%256 == 0 && shouldCancel() {
			return []LibraryBrowserEntry{}, true
		}
		trackIndex++
		matchIndexedFile(indexed, "track", &trackMatches)
	}
	textIndex := 0
	for _, indexed := range contentState.textByPath {
		if shouldCancel != nil && textIndex%256 == 0 && shouldCancel() {
			return []LibraryBrowserEntry{}, true
		}
		textIndex++
		matchIndexedFile(indexed, "text-file", &textMatches)
	}
	imageIndex := 0
	for _, indexed := range contentState.imageByPath {
		if shouldCancel != nil && imageIndex%256 == 0 && shouldCancel() {
			return []LibraryBrowserEntry{}, true
		}
		imageIndex++
		matchIndexedFile(indexed, "image-file", &imageMatches)
	}

	folderIndex := 0
	for folderPath := range folderPaths {
		if shouldCancel != nil && folderIndex%256 == 0 && shouldCancel() {
			return []LibraryBrowserEntry{}, true
		}
		folderIndex++

		folderName := folderPath
		if lastSlash := strings.LastIndex(folderPath, "/"); lastSlash >= 0 {
			folderName = folderPath[lastSlash+1:]
		}

		if strings.Contains(strings.ToLower(folderPath), normalizedQuery) || strings.Contains(strings.ToLower(folderName), normalizedQuery) {
			folderMatchesByPath[folderPath] = folderBrowserEntry(folderPath)
		}
	}

	folderMatches := make([]LibraryBrowserEntry, 0, len(folderMatchesByPath))
	for _, entry := range folderMatchesByPath {
		folderMatches = append(folderMatches, entry)
	}

	sortBrowserEntriesByPath(folderMatches)
	sortBrowserEntriesByRelativePath(trackMatches)
	sortBrowserEntriesByRelativePath(textMatches)
	sortBrowserEntriesByRelativePath(imageMatches)

	entries := make([]LibraryBrowserEntry, 0, len(folderMatches)+len(trackMatches)+len(textMatches)+len(imageMatches))
	entries = append(entries, folderMatches...)
	entries = append(entries, trackMatches...)
	entries = append(entries, textMatches...)
	entries = append(entries, imageMatches...)
	return entries, false
}

func (a *App) getFolderTrackPathsFromMapsLocked(normalizedFolderPath string) []string {
	contentState := a.libraryContentState()
	prefix := ""
	if normalizedFolderPath != "" {
		prefix = normalizedFolderPath + "/"
	}

	trackFiles := make([]LibraryIndexedFile, 0)
	for _, indexed := range contentState.trackByPath {
		if normalizedFolderPath == "" || indexed.FolderPath == normalizedFolderPath || strings.HasPrefix(indexed.FolderPath, prefix) {
			trackFiles = append(trackFiles, indexed)
		}
	}

	sort.SliceStable(trackFiles, func(i int, j int) bool {
		left := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, trackFiles[i].RelativePath))
		right := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, trackFiles[j].RelativePath))
		return left < right
	})

	paths := make([]string, 0, len(trackFiles))
	for _, indexed := range trackFiles {
		paths = append(paths, indexed.Path)
	}

	return paths
}

func (a *App) getFolderTrackCountFromMapsLocked(normalizedFolderPath string) int {
	contentState := a.libraryContentState()
	prefix := ""
	if normalizedFolderPath != "" {
		prefix = normalizedFolderPath + "/"
	}

	count := 0
	for _, indexed := range contentState.trackByPath {
		if normalizedFolderPath == "" || indexed.FolderPath == normalizedFolderPath || strings.HasPrefix(indexed.FolderPath, prefix) {
			count++
		}
	}

	return count
}

func (a *App) getFolderTrackPathsFromDerivedIndexLocked(normalizedFolderPath string) []string {
	indexState := a.libraryIndexState()
	if indexState.trackFilesByFolder == nil || indexState.folderChildPathsByFolder == nil {
		return []string{}
	}

	if normalizedFolderPath != "" {
		_, hasFolderEntries := indexState.folderEntriesByFolder[normalizedFolderPath]
		_, hasDirectTracks := indexState.trackFilesByFolder[normalizedFolderPath]
		_, hasChildFolders := indexState.folderChildPathsByFolder[normalizedFolderPath]
		if !hasFolderEntries && !hasDirectTracks && !hasChildFolders {
			return []string{}
		}
	}

	pendingFolders := []string{normalizedFolderPath}
	trackFiles := make([]LibraryIndexedFile, 0)
	for len(pendingFolders) > 0 {
		currentFolder := pendingFolders[len(pendingFolders)-1]
		pendingFolders = pendingFolders[:len(pendingFolders)-1]

		if directTrackFiles := indexState.trackFilesByFolder[currentFolder]; len(directTrackFiles) > 0 {
			trackFiles = append(trackFiles, directTrackFiles...)
		}

		childFolders := indexState.folderChildPathsByFolder[currentFolder]
		for index := len(childFolders) - 1; index >= 0; index-- {
			pendingFolders = append(pendingFolders, childFolders[index])
		}
	}

	sort.SliceStable(trackFiles, func(i int, j int) bool {
		left := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, trackFiles[i].RelativePath))
		right := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, trackFiles[j].RelativePath))
		return left < right
	})

	paths := make([]string, 0, len(trackFiles))
	for _, indexed := range trackFiles {
		paths = append(paths, indexed.Path)
	}

	return paths
}

func (a *App) getFolderTrackCountFromDerivedIndexLocked(normalizedFolderPath string) int {
	indexState := a.libraryIndexState()
	if indexState.trackFilesByFolder == nil || indexState.folderChildPathsByFolder == nil {
		return 0
	}

	if normalizedFolderPath != "" {
		_, hasFolderEntries := indexState.folderEntriesByFolder[normalizedFolderPath]
		_, hasDirectTracks := indexState.trackFilesByFolder[normalizedFolderPath]
		_, hasChildFolders := indexState.folderChildPathsByFolder[normalizedFolderPath]
		if !hasFolderEntries && !hasDirectTracks && !hasChildFolders {
			return 0
		}
	}

	pendingFolders := []string{normalizedFolderPath}
	count := 0
	for len(pendingFolders) > 0 {
		currentFolder := pendingFolders[len(pendingFolders)-1]
		pendingFolders = pendingFolders[:len(pendingFolders)-1]

		if directTrackFiles := indexState.trackFilesByFolder[currentFolder]; len(directTrackFiles) > 0 {
			count += len(directTrackFiles)
		}

		childFolders := indexState.folderChildPathsByFolder[currentFolder]
		for index := len(childFolders) - 1; index >= 0; index-- {
			pendingFolders = append(pendingFolders, childFolders[index])
		}
	}

	return count
}
