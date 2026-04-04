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
	a.libraryDerivedIndexGeneration++
	a.libraryDerivedIndexDirty = true
	a.folderEntriesByFolder = nil
	a.folderChildPathsByFolder = nil
	a.trackFilesByFolder = nil
	a.searchFolderEntries = nil
	a.searchTrackEntries = nil
	a.searchTextEntries = nil
	a.searchImageEntries = nil
	a.searchResultsByQuery = nil
	a.searchCacheOrder = nil
	a.searchLastQuery = ""
	a.searchLastResults = nil
}

func (a *App) isLibraryDerivedIndexReadyLocked() bool {
	return !a.libraryDerivedIndexDirty &&
		!a.libraryDerivedIndexBuilding &&
		a.folderEntriesByFolder != nil &&
		a.folderChildPathsByFolder != nil &&
		a.trackFilesByFolder != nil &&
		a.searchFolderEntries != nil &&
		a.searchTrackEntries != nil &&
		a.searchTextEntries != nil &&
		a.searchImageEntries != nil &&
		a.searchResultsByQuery != nil
}

func (a *App) maybeStartLibraryDerivedIndexRebuildLocked() {
	if a.scanInProgress || !a.libraryDerivedIndexDirty || a.libraryDerivedIndexBuilding {
		return
	}

	generation := a.libraryDerivedIndexGeneration
	trackFiles := make([]LibraryIndexedFile, 0, len(a.trackByPath))
	for _, indexed := range a.trackByPath {
		trackFiles = append(trackFiles, indexed)
	}

	textFiles := make([]LibraryIndexedFile, 0, len(a.textByPath))
	for _, indexed := range a.textByPath {
		textFiles = append(textFiles, indexed)
	}

	imageFiles := make([]LibraryIndexedFile, 0, len(a.imageByPath))
	for _, indexed := range a.imageByPath {
		imageFiles = append(imageFiles, indexed)
	}

	a.libraryDerivedIndexBuilding = true
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

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	if a.scanInProgress || generation != a.libraryDerivedIndexGeneration {
		a.libraryDerivedIndexBuilding = false
		a.maybeStartLibraryDerivedIndexRebuildLocked()
		return
	}

	a.folderEntriesByFolder = indexData.folderEntriesByFolder
	a.folderChildPathsByFolder = indexData.folderChildPathsByFolder
	a.trackFilesByFolder = indexData.trackFilesByFolder
	a.searchFolderEntries = indexData.searchFolderEntries
	a.searchTrackEntries = indexData.searchTrackEntries
	a.searchTextEntries = indexData.searchTextEntries
	a.searchImageEntries = indexData.searchImageEntries
	a.searchResultsByQuery = make(map[string][]LibraryBrowserEntry)
	a.searchCacheOrder = make([]string, 0, librarySearchCacheLimit)
	a.searchLastQuery = ""
	a.searchLastResults = nil
	a.libraryDerivedIndexDirty = false
	a.libraryDerivedIndexBuilding = false

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

func filterSearchEntries(entries []LibraryBrowserEntry, normalizedQuery string) []LibraryBrowserEntry {
	if len(entries) == 0 {
		return []LibraryBrowserEntry{}
	}

	filtered := make([]LibraryBrowserEntry, 0, len(entries))
	for _, entry := range entries {
		if libraryEntryMatchesSearchQuery(entry, normalizedQuery) {
			filtered = append(filtered, entry)
		}
	}

	return filtered
}

func (a *App) rememberSearchResultLocked(normalizedQuery string, entries []LibraryBrowserEntry) {
	if a.searchResultsByQuery == nil {
		a.searchResultsByQuery = make(map[string][]LibraryBrowserEntry)
	}

	if _, exists := a.searchResultsByQuery[normalizedQuery]; !exists {
		a.searchCacheOrder = append(a.searchCacheOrder, normalizedQuery)
	}

	a.searchResultsByQuery[normalizedQuery] = entries

	for len(a.searchCacheOrder) > librarySearchCacheLimit {
		evictedQuery := a.searchCacheOrder[0]
		a.searchCacheOrder = a.searchCacheOrder[1:]
		delete(a.searchResultsByQuery, evictedQuery)
	}
}

func (a *App) buildSearchResultsLocked(normalizedQuery string) ([]LibraryBrowserEntry, string) {
	if cachedEntries, exists := a.searchResultsByQuery[normalizedQuery]; exists {
		return cachedEntries, "cache-hit"
	}

	var entries []LibraryBrowserEntry
	mode := "full-filter"
	if a.searchLastQuery != "" && strings.HasPrefix(normalizedQuery, a.searchLastQuery) && len(a.searchLastResults) > 0 {
		entries = filterSearchEntries(a.searchLastResults, normalizedQuery)
		mode = "prefix-filter"
	} else {
		folderMatches := filterSearchEntries(a.searchFolderEntries, normalizedQuery)
		trackMatches := filterSearchEntries(a.searchTrackEntries, normalizedQuery)
		textMatches := filterSearchEntries(a.searchTextEntries, normalizedQuery)
		imageMatches := filterSearchEntries(a.searchImageEntries, normalizedQuery)

		entries = make([]LibraryBrowserEntry, 0, len(folderMatches)+len(trackMatches)+len(textMatches)+len(imageMatches))
		entries = append(entries, folderMatches...)
		entries = append(entries, trackMatches...)
		entries = append(entries, textMatches...)
		entries = append(entries, imageMatches...)
	}

	a.rememberSearchResultLocked(normalizedQuery, entries)
	a.searchLastQuery = normalizedQuery
	a.searchLastResults = entries
	return entries, mode
}

func copyPagedLibraryEntries(entries []LibraryBrowserEntry, offset int, limit int) []LibraryBrowserEntry {
	pagedEntries := pagedLibraryEntries(entries, offset, limit)
	return append([]LibraryBrowserEntry(nil), pagedEntries...)
}

func (a *App) buildFolderEntriesFromMapsLocked(normalizedFolderPath string) []LibraryBrowserEntry {
	folderEntriesByPath := make(map[string]LibraryBrowserEntry)
	trackEntries := make([]LibraryBrowserEntry, 0)
	textEntries := make([]LibraryBrowserEntry, 0)
	imageEntries := make([]LibraryBrowserEntry, 0)

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

	for _, indexed := range a.trackByPath {
		appendEntry(indexed, "track", &trackEntries)
	}
	for _, indexed := range a.textByPath {
		appendEntry(indexed, "text-file", &textEntries)
	}
	for _, indexed := range a.imageByPath {
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

func (a *App) buildSearchEntriesFromMapsLocked(normalizedQuery string) []LibraryBrowserEntry {
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

	for _, indexed := range a.trackByPath {
		matchIndexedFile(indexed, "track", &trackMatches)
	}
	for _, indexed := range a.textByPath {
		matchIndexedFile(indexed, "text-file", &textMatches)
	}
	for _, indexed := range a.imageByPath {
		matchIndexedFile(indexed, "image-file", &imageMatches)
	}

	for folderPath := range folderPaths {
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
	return entries
}

func (a *App) getFolderTrackPathsFromMapsLocked(normalizedFolderPath string) []string {
	prefix := ""
	if normalizedFolderPath != "" {
		prefix = normalizedFolderPath + "/"
	}

	trackFiles := make([]LibraryIndexedFile, 0)
	for _, indexed := range a.trackByPath {
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

func (a *App) getFolderTrackPathsFromDerivedIndexLocked(normalizedFolderPath string) []string {
	if a.trackFilesByFolder == nil || a.folderChildPathsByFolder == nil {
		return []string{}
	}

	if normalizedFolderPath != "" {
		_, hasFolderEntries := a.folderEntriesByFolder[normalizedFolderPath]
		_, hasDirectTracks := a.trackFilesByFolder[normalizedFolderPath]
		_, hasChildFolders := a.folderChildPathsByFolder[normalizedFolderPath]
		if !hasFolderEntries && !hasDirectTracks && !hasChildFolders {
			return []string{}
		}
	}

	pendingFolders := []string{normalizedFolderPath}
	trackFiles := make([]LibraryIndexedFile, 0)
	for len(pendingFolders) > 0 {
		currentFolder := pendingFolders[len(pendingFolders)-1]
		pendingFolders = pendingFolders[:len(pendingFolders)-1]

		if directTrackFiles := a.trackFilesByFolder[currentFolder]; len(directTrackFiles) > 0 {
			trackFiles = append(trackFiles, directTrackFiles...)
		}

		childFolders := a.folderChildPathsByFolder[currentFolder]
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
