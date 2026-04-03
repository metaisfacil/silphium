package main

import (
	"sort"
	"strings"
	"time"
)

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
	a.logRescanEvent("GetLibraryFolderPage waiting for indexMu lock: %s", normalizedFolderPath)
	a.indexMu.Lock()
	a.logRescanEvent("GetLibraryFolderPage acquired lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer a.indexMu.Unlock()

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

	sort.SliceStable(folderEntries, func(i int, j int) bool {
		return strings.ToLower(folderEntries[i].Path) < strings.ToLower(folderEntries[j].Path)
	})
	sort.SliceStable(trackEntries, func(i int, j int) bool {
		return strings.ToLower(trackEntries[i].Name) < strings.ToLower(trackEntries[j].Name)
	})
	sort.SliceStable(textEntries, func(i int, j int) bool {
		return strings.ToLower(textEntries[i].Name) < strings.ToLower(textEntries[j].Name)
	})
	sort.SliceStable(imageEntries, func(i int, j int) bool {
		return strings.ToLower(imageEntries[i].Name) < strings.ToLower(imageEntries[j].Name)
	})

	entries := make([]LibraryBrowserEntry, 0, len(folderEntries)+len(trackEntries)+len(textEntries)+len(imageEntries))
	entries = append(entries, folderEntries...)
	entries = append(entries, trackEntries...)
	entries = append(entries, textEntries...)
	entries = append(entries, imageEntries...)

	result := LibraryFolderPage{
		FolderPath:   normalizedFolderPath,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedLibraryEntries(entries, offset, limit),
	}
	a.logRescanEvent("GetLibraryFolderPage END: %d total entries, took %.2fms", len(entries), time.Since(queryStartTime).Seconds()*1000)
	return result
}

// SearchLibrary returns paginated server-side search results across folders and indexed files.
func (a *App) SearchLibrary(query string, offset int, limit int) LibrarySearchPage {
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
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

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

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

	sort.SliceStable(folderMatches, func(i int, j int) bool {
		return strings.ToLower(folderMatches[i].Path) < strings.ToLower(folderMatches[j].Path)
	})
	sort.SliceStable(trackMatches, func(i int, j int) bool {
		return strings.ToLower(trackMatches[i].RelativePath) < strings.ToLower(trackMatches[j].RelativePath)
	})
	sort.SliceStable(textMatches, func(i int, j int) bool {
		return strings.ToLower(textMatches[i].RelativePath) < strings.ToLower(textMatches[j].RelativePath)
	})
	sort.SliceStable(imageMatches, func(i int, j int) bool {
		return strings.ToLower(imageMatches[i].RelativePath) < strings.ToLower(imageMatches[j].RelativePath)
	})

	entries := make([]LibraryBrowserEntry, 0, len(folderMatches)+len(trackMatches)+len(textMatches)+len(imageMatches))
	entries = append(entries, folderMatches...)
	entries = append(entries, trackMatches...)
	entries = append(entries, textMatches...)
	entries = append(entries, imageMatches...)

	return LibrarySearchPage{
		Query:        query,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedLibraryEntries(entries, offset, limit),
	}
}

// GetLibraryFolderTrackPaths resolves all audio tracks under a folder subtree for queue actions.
func (a *App) GetLibraryFolderTrackPaths(folderPath string) []string {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []string{}
	}

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

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
