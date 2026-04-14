package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const librarySearchCacheLimit = 24

type libraryFolderIndexData struct {
	folderEntriesByFolder      map[string][]LibraryBrowserEntry
	folderChildPathsByFolder   map[string][]string
	trackFilesByFolder         map[string][]LibraryIndexedFile
	directTextEntriesByFolder  map[string][]LibraryBrowserEntry
	directImageEntriesByFolder map[string][]LibraryBrowserEntry
	folderModifiedAtByPath     map[string]int64
	searchFolderEntries        []LibraryBrowserEntry
}

type librarySearchIndexData struct {
	searchTrackEntries []LibraryBrowserEntry
	searchTextEntries  []LibraryBrowserEntry
	searchImageEntries []LibraryBrowserEntry
}

type libraryDerivedIndexData struct {
	libraryFolderIndexData
	librarySearchIndexData
}

type incrementalDerivedIndexUpdate struct {
	targetFolderPath       string
	previousSubtreeFolders map[string]struct{}
	subtreeFolderIndex     libraryFolderIndexData
	affectedCoverFolders   map[string]struct{}
}

func (a *App) markLibraryDerivedIndexDirtyLocked() {
	indexState := a.libraryIndexState()
	indexState.libraryDerivedIndexGeneration++
	indexState.libraryDerivedIndexDirty = true
	indexState.folderEntriesByFolder = nil
	indexState.folderChildPathsByFolder = nil
	indexState.trackFilesByFolder = nil
	indexState.directTextEntriesByFolder = nil
	indexState.directImageEntriesByFolder = nil
	indexState.folderModifiedAtByPath = nil
	indexState.searchFolderEntries = nil
	a.invalidateLibrarySearchIndexLocked()
}

func (a *App) markLibrarySearchIndexDirtyLocked() {
	indexState := a.libraryIndexState()
	indexState.libraryDerivedIndexGeneration++
	indexState.libraryDerivedIndexDirty = true
	indexState.libraryDerivedIndexBuilding = false
	a.invalidateLibrarySearchIndexLocked()
}

func (a *App) invalidateLibrarySearchIndexLocked() {
	indexState := a.libraryIndexState()
	indexState.searchTrackEntries = nil
	indexState.searchTextEntries = nil
	indexState.searchImageEntries = nil
	indexState.searchResultsByQuery = nil
	indexState.searchCacheOrder = nil
	indexState.searchLastQuery = ""
	indexState.searchLastResults = nil
}

func (a *App) isLibraryFolderIndexReadyLocked() bool {
	indexState := a.libraryIndexState()
	return indexState.folderEntriesByFolder != nil &&
		indexState.folderChildPathsByFolder != nil &&
		indexState.trackFilesByFolder != nil &&
		indexState.directTextEntriesByFolder != nil &&
		indexState.directImageEntriesByFolder != nil &&
		indexState.folderModifiedAtByPath != nil
}

func (a *App) isLibrarySearchIndexReadyLocked() bool {
	indexState := a.libraryIndexState()
	return a.isLibraryFolderIndexReadyLocked() &&
		indexState.searchFolderEntries != nil &&
		indexState.searchTrackEntries != nil &&
		indexState.searchTextEntries != nil &&
		indexState.searchImageEntries != nil &&
		indexState.searchResultsByQuery != nil
}

func cloneIndexedFiles(entries []LibraryIndexedFile) []LibraryIndexedFile {
	if len(entries) == 0 {
		return []LibraryIndexedFile{}
	}

	return append([]LibraryIndexedFile(nil), entries...)
}

func cloneBrowserEntries(entries []LibraryBrowserEntry) []LibraryBrowserEntry {
	if len(entries) == 0 {
		return []LibraryBrowserEntry{}
	}

	return append([]LibraryBrowserEntry(nil), entries...)
}

func virtualPathWithinSubtree(rootPath string, candidatePath string) bool {
	if rootPath == "" {
		return true
	}

	return candidatePath == rootPath || strings.HasPrefix(candidatePath, rootPath+"/")
}

func (a *App) pathHasIndexedContentLocked(path string) bool {
	contentState := a.libraryContentState()
	prefix := path + string(filepath.Separator)

	hasIndexedContent := func(indexedByPath map[string]LibraryIndexedFile) bool {
		for indexedPath := range indexedByPath {
			if indexedPath == path || strings.HasPrefix(indexedPath, prefix) {
				return true
			}
		}
		return false
	}

	return hasIndexedContent(contentState.trackByPath) ||
		hasIndexedContent(contentState.textByPath) ||
		hasIndexedContent(contentState.imageByPath)
}

func (a *App) collectExistingDerivedFoldersInSubtreeLocked(targetFolderPath string) map[string]struct{} {
	indexState := a.libraryIndexState()
	folders := make(map[string]struct{})
	collect := func(values map[string][]LibraryBrowserEntry) {
		for folderPath := range values {
			if virtualPathWithinSubtree(targetFolderPath, folderPath) {
				folders[folderPath] = struct{}{}
			}
		}
	}
	collectTrackFiles := func(values map[string][]LibraryIndexedFile) {
		for folderPath := range values {
			if virtualPathWithinSubtree(targetFolderPath, folderPath) {
				folders[folderPath] = struct{}{}
			}
		}
	}
	collect(indexState.folderEntriesByFolder)
	collectTrackFiles(indexState.trackFilesByFolder)
	collect(indexState.directTextEntriesByFolder)
	collect(indexState.directImageEntriesByFolder)
	for folderPath := range indexState.folderChildPathsByFolder {
		if virtualPathWithinSubtree(targetFolderPath, folderPath) {
			folders[folderPath] = struct{}{}
		}
	}
	for folderPath := range indexState.folderModifiedAtByPath {
		if virtualPathWithinSubtree(targetFolderPath, folderPath) {
			folders[folderPath] = struct{}{}
		}
	}
	return folders
}

func libraryFolderPathForIncrementalTarget(root libraryRootConfig, targetPath string) string {
	absoluteTargetPath, ok := absoluteNormalizedPath(targetPath)
	if !ok || !pathWithinRoot(root.Path, absoluteTargetPath) {
		return ""
	}

	relativePath, err := filepath.Rel(root.Path, absoluteTargetPath)
	if err != nil {
		return ""
	}
	relativePath = filepath.ToSlash(filepath.Clean(relativePath))
	if relativePath == "." {
		relativePath = ""
	}

	if info, statErr := os.Stat(absoluteTargetPath); statErr == nil && info.IsDir() {
		return buildVirtualLibraryPath(root.Name, relativePath)
	}

	parentPath := filepath.ToSlash(filepath.Dir(relativePath))
	if parentPath == "." {
		parentPath = ""
	}
	return buildVirtualLibraryPath(root.Name, parentPath)
}

func (a *App) collectIncrementalDerivedIndexUpdateLocked(prepared preparedIncrementalLibraryChange) incrementalDerivedIndexUpdate {
	update := incrementalDerivedIndexUpdate{
		previousSubtreeFolders: make(map[string]struct{}),
		affectedCoverFolders:   make(map[string]struct{}),
	}

	update.targetFolderPath = libraryFolderPathForIncrementalTarget(prepared.root, prepared.targetPath)
	update.previousSubtreeFolders = a.collectExistingDerivedFoldersInSubtreeLocked(update.targetFolderPath)
	update.subtreeFolderIndex = buildLibraryFolderIndexData(prepared.trackFiles, prepared.textFiles, prepared.imageFiles)

	for folderPath := range update.previousSubtreeFolders {
		update.affectedCoverFolders[folderPath] = struct{}{}
	}
	for folderPath := range update.subtreeFolderIndex.directImageEntriesByFolder {
		if virtualPathWithinSubtree(update.targetFolderPath, folderPath) {
			update.affectedCoverFolders[folderPath] = struct{}{}
		}
	}

	return update
}

func directTrackEntriesFromFiles(trackFiles []LibraryIndexedFile) []LibraryBrowserEntry {
	entries := make([]LibraryBrowserEntry, 0, len(trackFiles))
	for _, indexed := range trackFiles {
		entries = append(entries, browserEntryFromIndexedFile("track", indexed))
	}
	sortBrowserEntriesByName(entries)
	return entries
}

func (a *App) bestCoverPathForFolderFromContentLocked(folderPath string) string {
	contentState := a.libraryContentState()
	folderKey := strings.ToLower(strings.TrimSpace(folderPath))
	selectedPriority := 0
	selectedName := ""
	selectedPath := ""
	hasSelection := false

	for _, indexed := range contentState.imageByPath {
		if strings.ToLower(indexed.FolderPath) != folderKey || !isPreferredCoverImagePath(indexed.Path) {
			continue
		}

		name := strings.ToLower(indexed.Name)
		priority := coverPriority(name)
		if !hasSelection || priority < selectedPriority || (priority == selectedPriority && name < selectedName) {
			hasSelection = true
			selectedPriority = priority
			selectedName = name
			selectedPath = indexed.Path
		}
	}

	return selectedPath
}

func appendSortedUniqueChildPath(childPaths []string, childPath string) []string {
	for _, existing := range childPaths {
		if existing == childPath {
			return childPaths
		}
	}
	childPaths = append(childPaths, childPath)
	sortPathsCaseInsensitive(childPaths)
	return childPaths
}

func removeChildPath(childPaths []string, childPath string) []string {
	for index, existing := range childPaths {
		if existing != childPath {
			continue
		}
		updated := append([]string(nil), childPaths[:index]...)
		updated = append(updated, childPaths[index+1:]...)
		return updated
	}
	return childPaths
}

func parentFolderPath(folderPath string) string {
	if folderPath == "" {
		return ""
	}

	lastSlash := strings.LastIndex(folderPath, "/")
	if lastSlash < 0 {
		return ""
	}

	return folderPath[:lastSlash]
}

func ancestorFolderPathsBottomUp(folderPath string) []string {
	ancestors := make([]string, 0, 8)
	current := folderPath
	for {
		ancestors = append(ancestors, current)
		if current == "" {
			break
		}
		current = parentFolderPath(current)
	}
	return ancestors
}

func (a *App) folderExistsInDerivedIndexLocked(folderPath string) bool {
	if folderPath == "" {
		return true
	}

	indexState := a.libraryIndexState()
	return len(indexState.trackFilesByFolder[folderPath]) > 0 ||
		len(indexState.directTextEntriesByFolder[folderPath]) > 0 ||
		len(indexState.directImageEntriesByFolder[folderPath]) > 0 ||
		len(indexState.folderChildPathsByFolder[folderPath]) > 0
}

func (a *App) recomputeFolderModifiedAtFromDerivedIndexLocked(folderPath string) int64 {
	indexState := a.libraryIndexState()
	maxModifiedAtMs := int64(0)
	for _, indexed := range indexState.trackFilesByFolder[folderPath] {
		if indexed.ModifiedAtMs > maxModifiedAtMs {
			maxModifiedAtMs = indexed.ModifiedAtMs
		}
	}
	for _, entry := range indexState.directTextEntriesByFolder[folderPath] {
		if entry.ModifiedAtMs > maxModifiedAtMs {
			maxModifiedAtMs = entry.ModifiedAtMs
		}
	}
	for _, entry := range indexState.directImageEntriesByFolder[folderPath] {
		if entry.ModifiedAtMs > maxModifiedAtMs {
			maxModifiedAtMs = entry.ModifiedAtMs
		}
	}
	for _, childPath := range indexState.folderChildPathsByFolder[folderPath] {
		if indexState.folderModifiedAtByPath[childPath] > maxModifiedAtMs {
			maxModifiedAtMs = indexState.folderModifiedAtByPath[childPath]
		}
	}
	return maxModifiedAtMs
}

func (a *App) buildFolderEntriesFromDerivedCachesLocked(folderPath string) []LibraryBrowserEntry {
	indexState := a.libraryIndexState()
	childPaths := indexState.folderChildPathsByFolder[folderPath]
	entries := make([]LibraryBrowserEntry, 0, len(childPaths)+len(indexState.trackFilesByFolder[folderPath])+len(indexState.directTextEntriesByFolder[folderPath])+len(indexState.directImageEntriesByFolder[folderPath]))
	for _, childPath := range childPaths {
		entries = append(entries, folderBrowserEntry(childPath, indexState.folderModifiedAtByPath[childPath]))
	}
	entries = append(entries, directTrackEntriesFromFiles(indexState.trackFilesByFolder[folderPath])...)
	entries = append(entries, cloneBrowserEntries(indexState.directTextEntriesByFolder[folderPath])...)
	entries = append(entries, cloneBrowserEntries(indexState.directImageEntriesByFolder[folderPath])...)
	return entries
}

func folderSetFromFolderIndexData(indexData libraryFolderIndexData, targetFolderPath string) map[string]struct{} {
	folders := make(map[string]struct{})
	collectEntries := func(values map[string][]LibraryBrowserEntry) {
		for folderPath := range values {
			if virtualPathWithinSubtree(targetFolderPath, folderPath) {
				folders[folderPath] = struct{}{}
			}
		}
	}
	collectTracks := func(values map[string][]LibraryIndexedFile) {
		for folderPath := range values {
			if virtualPathWithinSubtree(targetFolderPath, folderPath) {
				folders[folderPath] = struct{}{}
			}
		}
	}
	collectEntries(indexData.folderEntriesByFolder)
	collectTracks(indexData.trackFilesByFolder)
	collectEntries(indexData.directTextEntriesByFolder)
	collectEntries(indexData.directImageEntriesByFolder)
	for folderPath := range indexData.folderChildPathsByFolder {
		if virtualPathWithinSubtree(targetFolderPath, folderPath) {
			folders[folderPath] = struct{}{}
		}
	}
	for folderPath := range indexData.folderModifiedAtByPath {
		if virtualPathWithinSubtree(targetFolderPath, folderPath) {
			folders[folderPath] = struct{}{}
		}
	}
	return folders
}

func (a *App) applyIncrementalDerivedIndexUpdatesLocked(updates []incrementalDerivedIndexUpdate) {
	indexState := a.libraryIndexState()
	contentState := a.libraryContentState()
	if !a.isLibraryFolderIndexReadyLocked() {
		a.markLibrarySearchIndexDirtyLocked()
		return
	}
	affectedCoverFolders := make(map[string]struct{})
	for _, update := range updates {
		for folderPath := range update.affectedCoverFolders {
			affectedCoverFolders[folderPath] = struct{}{}
		}

		newSubtreeFolders := folderSetFromFolderIndexData(update.subtreeFolderIndex, update.targetFolderPath)
		for folderPath := range update.previousSubtreeFolders {
			if _, exists := newSubtreeFolders[folderPath]; exists {
				continue
			}
			delete(indexState.folderEntriesByFolder, folderPath)
			delete(indexState.folderChildPathsByFolder, folderPath)
			delete(indexState.trackFilesByFolder, folderPath)
			delete(indexState.directTextEntriesByFolder, folderPath)
			delete(indexState.directImageEntriesByFolder, folderPath)
			delete(indexState.folderModifiedAtByPath, folderPath)
		}

		for folderPath := range newSubtreeFolders {
			indexState.folderChildPathsByFolder[folderPath] = append([]string(nil), update.subtreeFolderIndex.folderChildPathsByFolder[folderPath]...)
			indexState.trackFilesByFolder[folderPath] = cloneIndexedFiles(update.subtreeFolderIndex.trackFilesByFolder[folderPath])
			indexState.directTextEntriesByFolder[folderPath] = cloneBrowserEntries(update.subtreeFolderIndex.directTextEntriesByFolder[folderPath])
			indexState.directImageEntriesByFolder[folderPath] = cloneBrowserEntries(update.subtreeFolderIndex.directImageEntriesByFolder[folderPath])
			indexState.folderModifiedAtByPath[folderPath] = update.subtreeFolderIndex.folderModifiedAtByPath[folderPath]
			indexState.folderEntriesByFolder[folderPath] = cloneBrowserEntries(update.subtreeFolderIndex.folderEntriesByFolder[folderPath])
		}

		ancestors := ancestorFolderPathsBottomUp(update.targetFolderPath)
		for index, folderPath := range ancestors {
			if index > 0 {
				parentPath := ancestors[index]
				childPath := ancestors[index-1]
				childPaths := indexState.folderChildPathsByFolder[parentPath]
				if a.folderExistsInDerivedIndexLocked(childPath) {
					indexState.folderChildPathsByFolder[parentPath] = appendSortedUniqueChildPath(childPaths, childPath)
				} else {
					indexState.folderChildPathsByFolder[parentPath] = removeChildPath(childPaths, childPath)
				}
			}

			folderExists := a.folderExistsInDerivedIndexLocked(folderPath)
			if !folderExists && folderPath != "" {
				delete(indexState.folderEntriesByFolder, folderPath)
				delete(indexState.folderChildPathsByFolder, folderPath)
				delete(indexState.trackFilesByFolder, folderPath)
				delete(indexState.directTextEntriesByFolder, folderPath)
				delete(indexState.directImageEntriesByFolder, folderPath)
				delete(indexState.folderModifiedAtByPath, folderPath)
				continue
			}

			indexState.folderModifiedAtByPath[folderPath] = a.recomputeFolderModifiedAtFromDerivedIndexLocked(folderPath)
			indexState.folderEntriesByFolder[folderPath] = a.buildFolderEntriesFromDerivedCachesLocked(folderPath)
		}
	}

	if contentState.libraryScan.CoverPathByFolder == nil {
		contentState.libraryScan.CoverPathByFolder = make(map[string]string)
	}
	for folderPath := range affectedCoverFolders {
		folderKey := strings.ToLower(folderPath)
		coverPath := a.bestCoverPathForFolderFromContentLocked(folderPath)
		if coverPath == "" {
			delete(contentState.libraryScan.CoverPathByFolder, folderKey)
		} else {
			contentState.libraryScan.CoverPathByFolder[folderKey] = coverPath
		}
	}

	a.markLibrarySearchIndexDirtyLocked()
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

func noteFolderModifiedAt(folderModifiedAtByPath map[string]int64, folderPath string, modifiedAtMs int64) {
	cleanFolderPath := strings.TrimSpace(folderPath)
	if cleanFolderPath == "" || modifiedAtMs <= 0 {
		return
	}

	segments := strings.Split(cleanFolderPath, "/")
	currentPath := ""
	for _, segment := range segments {
		if segment == "" {
			continue
		}

		if currentPath == "" {
			currentPath = segment
		} else {
			currentPath += "/" + segment
		}

		if modifiedAtMs > folderModifiedAtByPath[currentPath] {
			folderModifiedAtByPath[currentPath] = modifiedAtMs
		}
	}
}

func buildLibraryFolderIndexData(trackFiles []LibraryIndexedFile, textFiles []LibraryIndexedFile, imageFiles []LibraryIndexedFile) libraryFolderIndexData {
	folderChildSetByParent := make(map[string]map[string]struct{})
	folderPaths := map[string]struct{}{}
	folderModifiedAtByPath := make(map[string]int64)

	trackEntriesByFolder := make(map[string][]LibraryBrowserEntry)
	textEntriesByFolder := make(map[string][]LibraryBrowserEntry)
	imageEntriesByFolder := make(map[string][]LibraryBrowserEntry)
	trackFilesByFolder := make(map[string][]LibraryIndexedFile)

	for _, indexed := range trackFiles {
		addFolderAncestorsToIndex(indexed.FolderPath, folderChildSetByParent, folderPaths)
		noteFolderModifiedAt(folderModifiedAtByPath, indexed.FolderPath, indexed.ModifiedAtMs)
		entry := browserEntryFromIndexedFile("track", indexed)
		trackEntriesByFolder[indexed.FolderPath] = append(trackEntriesByFolder[indexed.FolderPath], entry)
		trackFilesByFolder[indexed.FolderPath] = append(trackFilesByFolder[indexed.FolderPath], indexed)
	}

	for _, indexed := range textFiles {
		addFolderAncestorsToIndex(indexed.FolderPath, folderChildSetByParent, folderPaths)
		noteFolderModifiedAt(folderModifiedAtByPath, indexed.FolderPath, indexed.ModifiedAtMs)
		entry := browserEntryFromIndexedFile("text-file", indexed)
		textEntriesByFolder[indexed.FolderPath] = append(textEntriesByFolder[indexed.FolderPath], entry)
	}

	for _, indexed := range imageFiles {
		addFolderAncestorsToIndex(indexed.FolderPath, folderChildSetByParent, folderPaths)
		noteFolderModifiedAt(folderModifiedAtByPath, indexed.FolderPath, indexed.ModifiedAtMs)
		entry := browserEntryFromIndexedFile("image-file", indexed)
		imageEntriesByFolder[indexed.FolderPath] = append(imageEntriesByFolder[indexed.FolderPath], entry)
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
	sortedTextEntriesByFolder := make(map[string][]LibraryBrowserEntry, len(folderKeys))
	sortedImageEntriesByFolder := make(map[string][]LibraryBrowserEntry, len(folderKeys))

	for folderPath := range folderKeys {
		childPaths := make([]string, 0)
		childEntries := make([]LibraryBrowserEntry, 0)

		if childSet := folderChildSetByParent[folderPath]; len(childSet) > 0 {
			childPaths = make([]string, 0, len(childSet))
			childEntries = make([]LibraryBrowserEntry, 0, len(childSet))
			for childPath := range childSet {
				childPaths = append(childPaths, childPath)
				childEntries = append(childEntries, folderBrowserEntry(childPath, folderModifiedAtByPath[childPath]))
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
		sortedTextEntriesByFolder[folderPath] = directTextEntries
		sortedImageEntriesByFolder[folderPath] = directImageEntries

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
		searchFolderEntries = append(searchFolderEntries, folderBrowserEntry(folderPath, folderModifiedAtByPath[folderPath]))
	}

	sortBrowserEntriesByPath(searchFolderEntries)

	return libraryFolderIndexData{
		folderEntriesByFolder:      folderEntriesByFolder,
		folderChildPathsByFolder:   folderChildPathsByFolder,
		trackFilesByFolder:         sortedTrackFilesByFolder,
		directTextEntriesByFolder:  sortedTextEntriesByFolder,
		directImageEntriesByFolder: sortedImageEntriesByFolder,
		folderModifiedAtByPath:     folderModifiedAtByPath,
		searchFolderEntries:        searchFolderEntries,
	}
}

func buildLibrarySearchIndexData(trackFiles []LibraryIndexedFile, textFiles []LibraryIndexedFile, imageFiles []LibraryIndexedFile) librarySearchIndexData {
	searchTrackEntries := make([]LibraryBrowserEntry, 0, len(trackFiles))
	searchTextEntries := make([]LibraryBrowserEntry, 0, len(textFiles))
	searchImageEntries := make([]LibraryBrowserEntry, 0, len(imageFiles))

	for _, indexed := range trackFiles {
		searchTrackEntries = append(searchTrackEntries, browserEntryFromIndexedFile("track", indexed))
	}
	for _, indexed := range textFiles {
		searchTextEntries = append(searchTextEntries, browserEntryFromIndexedFile("text-file", indexed))
	}
	for _, indexed := range imageFiles {
		searchImageEntries = append(searchImageEntries, browserEntryFromIndexedFile("image-file", indexed))
	}

	sortBrowserEntriesByRelativePath(searchTrackEntries)
	sortBrowserEntriesByRelativePath(searchTextEntries)
	sortBrowserEntriesByRelativePath(searchImageEntries)

	return librarySearchIndexData{
		searchTrackEntries: searchTrackEntries,
		searchTextEntries:  searchTextEntries,
		searchImageEntries: searchImageEntries,
	}
}

func buildLibraryDerivedIndexData(trackFiles []LibraryIndexedFile, textFiles []LibraryIndexedFile, imageFiles []LibraryIndexedFile) libraryDerivedIndexData {
	return libraryDerivedIndexData{
		libraryFolderIndexData: buildLibraryFolderIndexData(trackFiles, textFiles, imageFiles),
		librarySearchIndexData: buildLibrarySearchIndexData(trackFiles, textFiles, imageFiles),
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
	folderModifiedAtByPath := make(map[string]int64)
	trackEntries := make([]LibraryBrowserEntry, 0)
	textEntries := make([]LibraryBrowserEntry, 0)
	imageEntries := make([]LibraryBrowserEntry, 0)

	if scanState.scanInProgress && scanState.scanDiscoveredChildFoldersByParent != nil {
		for childPath := range scanState.scanDiscoveredChildFoldersByParent[normalizedFolderPath] {
			folderEntriesByPath[childPath] = folderBrowserEntry(childPath, 0)
		}
	}

	appendEntry := func(indexed LibraryIndexedFile, kind string, destination *[]LibraryBrowserEntry) {
		noteFolderModifiedAt(folderModifiedAtByPath, indexed.FolderPath, indexed.ModifiedAtMs)
		if indexed.FolderPath == normalizedFolderPath {
			*destination = append(*destination, browserEntryFromIndexedFile(kind, indexed))
			return
		}

		childFolderPath, childOk := directChildFolderPath(normalizedFolderPath, indexed.FolderPath)
		if !childOk {
			return
		}

		if _, exists := folderEntriesByPath[childFolderPath]; !exists {
			folderEntriesByPath[childFolderPath] = folderBrowserEntry(childFolderPath, 0)
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
	for folderPath, entry := range folderEntriesByPath {
		entry.ModifiedAtMs = folderModifiedAtByPath[folderPath]
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
	folderModifiedAtByPath := make(map[string]int64)
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
		noteFolderModifiedAt(folderModifiedAtByPath, indexed.FolderPath, indexed.ModifiedAtMs)
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
			folderMatchesByPath[folderPath] = folderBrowserEntry(folderPath, folderModifiedAtByPath[folderPath])
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
