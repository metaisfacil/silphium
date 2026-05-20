package main

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var errLibraryScanCanceled = errors.New("library scan canceled")

type libraryQuickScanBuildResult struct {
	ScanResult                     LibraryScanResult
	DirectoryPaths                 []string
	DiscoveredChildFoldersByParent map[string]map[string]struct{}
}

type libraryFullScanBuildHints struct {
	TotalEntries   int
	TrackCount     int
	TextFileCount  int
	ImageFileCount int
}

const deferredHydrationFallbackQuickScanMultiplier = 4.0

func libraryDeferredHydrationEnabled() bool {
	return !libraryScanRunningUnderGoTest()
}

func libraryScanRunningUnderGoTest() bool {
	programName := strings.ToLower(filepath.Base(os.Args[0]))
	return strings.Contains(programName, ".test")
}

func newDeferredScanResult(rootPath string, rootName string) LibraryScanResult {
	return LibraryScanResult{
		RootPath:          rootPath,
		RootName:          rootName,
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		ImageFiles:        []LibraryIndexedFile{},
		DeferredFiles:     true,
		CoverPathByFolder: map[string]string{},
	}
}

func buildFolderChildPathsFromDiscovered(discoveredByParent map[string]map[string]struct{}) map[string][]string {
	folderChildPathsByFolder := make(map[string][]string, len(discoveredByParent)+1)
	for parentPath, childSet := range discoveredByParent {
		childPaths := make([]string, 0, len(childSet))
		for childPath := range childSet {
			if strings.TrimSpace(childPath) == "" {
				continue
			}

			childPaths = append(childPaths, childPath)
		}
		sortPathsCaseInsensitive(childPaths)
		folderChildPathsByFolder[parentPath] = childPaths
	}

	if _, exists := folderChildPathsByFolder[""]; !exists {
		folderChildPathsByFolder[""] = []string{}
	}

	return folderChildPathsByFolder
}

func buildFolderSearchEntriesFromChildPaths(folderChildPathsByFolder map[string][]string) []LibraryBrowserEntry {
	folderPaths := make([]string, 0)
	seen := map[string]struct{}{}
	for parentPath, childPaths := range folderChildPathsByFolder {
		if parentPath != "" {
			if _, exists := seen[parentPath]; !exists {
				seen[parentPath] = struct{}{}
				folderPaths = append(folderPaths, parentPath)
			}
		}

		for _, childPath := range childPaths {
			if childPath == "" {
				continue
			}

			if _, exists := seen[childPath]; exists {
				continue
			}

			seen[childPath] = struct{}{}
			folderPaths = append(folderPaths, childPath)
		}
	}

	entries := make([]LibraryBrowserEntry, 0, len(folderPaths))
	for _, folderPath := range folderPaths {
		entries = append(entries, folderBrowserEntry(folderPath, 0))
	}
	sortBrowserEntriesByPath(entries)
	return entries
}

func resolveLibraryFolderAbsolutePath(roots []libraryRootConfig, virtualFolderPath string) (libraryRootConfig, string, bool) {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(virtualFolderPath)
	if !ok {
		return libraryRootConfig{}, "", false
	}

	if normalizedFolderPath == "" {
		return libraryRootConfig{}, "", true
	}

	for _, root := range roots {
		if normalizedFolderPath == root.Name {
			return root, root.Path, true
		}

		prefix := root.Name + "/"
		if !strings.HasPrefix(normalizedFolderPath, prefix) {
			continue
		}

		relativeFolderPath := strings.TrimPrefix(normalizedFolderPath, prefix)
		if strings.TrimSpace(relativeFolderPath) == "" {
			return root, root.Path, true
		}

		return root, filepath.Join(root.Path, filepath.FromSlash(relativeFolderPath)), true
	}

	return libraryRootConfig{}, "", false
}

func listLibraryFolderEntriesFromFilesystem(roots []libraryRootConfig, folderPath string) ([]LibraryBrowserEntry, error) {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []LibraryBrowserEntry{}, nil
	}

	if normalizedFolderPath == "" {
		entries := make([]LibraryBrowserEntry, 0, len(roots))
		for _, root := range roots {
			rootModifiedAtMs := int64(0)
			if info, err := os.Stat(root.Path); err == nil {
				rootModifiedAtMs = modifiedAtMsFromFileInfo(info)
			}
			entries = append(entries, folderBrowserEntry(root.Name, rootModifiedAtMs))
		}
		sortBrowserEntriesByPath(entries)
		return entries, nil
	}

	root, absoluteFolderPath, ok := resolveLibraryFolderAbsolutePath(roots, normalizedFolderPath)
	if !ok {
		return []LibraryBrowserEntry{}, nil
	}

	entries, err := os.ReadDir(absoluteFolderPath)
	if err != nil {
		return []LibraryBrowserEntry{}, err
	}

	folderEntries := make([]LibraryBrowserEntry, 0)
	trackEntries := make([]LibraryBrowserEntry, 0)
	textEntries := make([]LibraryBrowserEntry, 0)
	imageEntries := make([]LibraryBrowserEntry, 0)

	for _, entry := range entries {
		if entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		currentPath := filepath.Join(absoluteFolderPath, entry.Name())
		currentFolderPath, relativePath, relativeOK := folderAndRelativeForLibraryRoot(root, currentPath)
		if !relativeOK {
			continue
		}

		entryInfo, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}

		if entry.IsDir() {
			folderEntries = append(folderEntries, folderBrowserEntry(relativePath, modifiedAtMsFromFileInfo(entryInfo)))
			continue
		}

		indexed := LibraryIndexedFile{
			Name:         entry.Name(),
			Path:         currentPath,
			RelativePath: relativePath,
			FolderPath:   currentFolderPath,
			RootPath:     root.Path,
			RootName:     root.Name,
			ReleaseDepth: root.ReleaseDepth,
			ModifiedAtMs: modifiedAtMsFromFileInfo(entryInfo),
		}

		switch {
		case isAudioPath(currentPath):
			trackEntries = append(trackEntries, browserEntryFromIndexedFile("track", indexed))
		case isTextPath(currentPath):
			textEntries = append(textEntries, browserEntryFromIndexedFile("text-file", indexed))
		case isImagePath(currentPath):
			imageEntries = append(imageEntries, browserEntryFromIndexedFile("image-file", indexed))
		}
	}

	sortBrowserEntriesByPath(folderEntries)
	sortBrowserEntriesByName(trackEntries)
	sortBrowserEntriesByName(textEntries)
	sortBrowserEntriesByName(imageEntries)

	combined := make([]LibraryBrowserEntry, 0, len(folderEntries)+len(trackEntries)+len(textEntries)+len(imageEntries))
	combined = append(combined, folderEntries...)
	combined = append(combined, trackEntries...)
	combined = append(combined, textEntries...)
	combined = append(combined, imageEntries...)
	return combined, nil
}

func collectLibraryFolderTrackPathsFromFilesystem(roots []libraryRootConfig, folderPath string) ([]string, error) {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []string{}, nil
	}

	indexedTracks := make([]LibraryIndexedFile, 0)
	appendTracksUnderRoot := func(root libraryRootConfig, absoluteStartPath string) error {
		return filepath.WalkDir(absoluteStartPath, func(currentPath string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			if entry.IsDir() || !isAudioPath(currentPath) {
				return nil
			}

			entryInfo, infoErr := entry.Info()
			if infoErr != nil {
				return nil
			}

			indexed, indexedOK := indexFileForRootWithModifiedAt(root, currentPath, entry.Name(), modifiedAtMsFromFileInfo(entryInfo))
			if !indexedOK {
				return nil
			}

			indexedTracks = append(indexedTracks, indexed)
			return nil
		})
	}

	if normalizedFolderPath == "" {
		for _, root := range roots {
			if err := appendTracksUnderRoot(root, root.Path); err != nil {
				return []string{}, err
			}
		}
	} else {
		root, absoluteFolderPath, resolved := resolveLibraryFolderAbsolutePath(roots, normalizedFolderPath)
		if !resolved {
			return []string{}, nil
		}

		if err := appendTracksUnderRoot(root, absoluteFolderPath); err != nil {
			return []string{}, err
		}
	}

	sort.SliceStable(indexedTracks, func(i int, j int) bool {
		left := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, indexedTracks[i].RelativePath))
		right := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, indexedTracks[j].RelativePath))
		return left < right
	})

	paths := make([]string, 0, len(indexedTracks))
	for _, indexed := range indexedTracks {
		paths = append(paths, indexed.Path)
	}

	return paths, nil
}

func collectLibraryFolderImageFilesFromFilesystem(roots []libraryRootConfig, folderPath string) ([]LibraryIndexedFile, error) {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []LibraryIndexedFile{}, nil
	}

	indexedImages := make([]LibraryIndexedFile, 0)
	appendImagesUnderRoot := func(root libraryRootConfig, absoluteStartPath string) error {
		return filepath.WalkDir(absoluteStartPath, func(currentPath string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil
			}
			if entry.IsDir() || !isImagePath(currentPath) {
				return nil
			}

			entryInfo, infoErr := entry.Info()
			if infoErr != nil {
				return nil
			}

			indexed, indexedOK := indexFileForRootWithModifiedAt(root, currentPath, entry.Name(), modifiedAtMsFromFileInfo(entryInfo))
			if !indexedOK {
				return nil
			}

			indexedImages = append(indexedImages, indexed)
			return nil
		})
	}

	if normalizedFolderPath == "" {
		for _, root := range roots {
			if err := appendImagesUnderRoot(root, root.Path); err != nil {
				return []LibraryIndexedFile{}, err
			}
		}
	} else {
		root, absoluteFolderPath, resolved := resolveLibraryFolderAbsolutePath(roots, normalizedFolderPath)
		if !resolved {
			return []LibraryIndexedFile{}, nil
		}

		if err := appendImagesUnderRoot(root, absoluteFolderPath); err != nil {
			return []LibraryIndexedFile{}, err
		}
	}

	return sortedIndexedFilesWithinFolder(normalizedFolderPath, indexedImages), nil
}

func countLibraryFolderTracksFromFilesystem(roots []libraryRootConfig, folderPath string) (int, error) {
	paths, err := collectLibraryFolderTrackPathsFromFilesystem(roots, folderPath)
	if err != nil {
		return 0, err
	}

	return len(paths), nil
}

func buildFilesystemQuickScan(roots []libraryRootConfig, isScanCanceled func() bool) (libraryQuickScanBuildResult, error) {
	rootPath, rootName := aggregateLibraryScanRootInfo(roots)
	build := libraryQuickScanBuildResult{
		ScanResult:                     newDeferredScanResult(rootPath, rootName),
		DiscoveredChildFoldersByParent: make(map[string]map[string]struct{}, len(roots)+1),
		DirectoryPaths:                 make([]string, 0, len(roots)),
	}

	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)
	seenDirectories := make(map[string]struct{}, len(roots))

	for _, root := range roots {
		addDiscoveredChildFolder(build.DiscoveredChildFoldersByParent, "", root.Name)
		normalizedRootPath := filepath.Clean(root.Path)
		if _, exists := seenDirectories[normalizedRootPath]; !exists {
			seenDirectories[normalizedRootPath] = struct{}{}
			build.DirectoryPaths = append(build.DirectoryPaths, normalizedRootPath)
		}
	}

	var walk func(absolutePath string, folderPath string) error
	walk = func(absolutePath string, folderPath string) error {
		if isScanCanceled() {
			return errLibraryScanCanceled
		}

		entries, err := os.ReadDir(absolutePath)
		if err != nil {
			return nil
		}

		for _, entry := range entries {
			if isScanCanceled() {
				return errLibraryScanCanceled
			}
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}

			currentPath := filepath.Join(absolutePath, entry.Name())
			build.ScanResult.TotalEntries++
			relativePath := buildVirtualLibraryPath(folderPath, entry.Name())

			if entry.IsDir() {
				addDiscoveredChildFolder(build.DiscoveredChildFoldersByParent, folderPath, relativePath)
				normalizedDirectoryPath := filepath.Clean(currentPath)
				if _, exists := seenDirectories[normalizedDirectoryPath]; !exists {
					seenDirectories[normalizedDirectoryPath] = struct{}{}
					build.DirectoryPaths = append(build.DirectoryPaths, normalizedDirectoryPath)
				}
				if err := walk(currentPath, relativePath); err != nil {
					return err
				}
				continue
			}

			switch {
			case isAudioPath(currentPath):
				build.ScanResult.TrackCount++
			case isTextPath(currentPath):
				build.ScanResult.TextFileCount++
			case isImagePath(currentPath):
				build.ScanResult.ImageFileCount++

				if !isPreferredCoverImagePath(currentPath) {
					continue
				}

				folderKey := strings.ToLower(folderPath)
				name := strings.ToLower(entry.Name())
				priority := coverPriority(name)
				currentPriority, hasCurrent := selectedCoverPriority[folderKey]
				currentName := selectedCoverName[folderKey]
				if !hasCurrent || priority < currentPriority || (priority == currentPriority && name < currentName) {
					selectedCoverPriority[folderKey] = priority
					selectedCoverName[folderKey] = name
					build.ScanResult.CoverPathByFolder[folderKey] = currentPath
				}
			}
		}

		return nil
	}

	for _, root := range roots {
		if err := walk(root.Path, root.Name); err != nil {
			return libraryQuickScanBuildResult{}, err
		}
	}

	return build, nil
}

func buildFilesystemFullScan(roots []libraryRootConfig, hints libraryFullScanBuildHints, isScanCanceled func() bool) (LibraryScanResult, error) {
	rootPath, rootName := aggregateLibraryScanRootInfo(roots)
	result := LibraryScanResult{
		RootPath:          rootPath,
		RootName:          rootName,
		TrackFiles:        make([]LibraryIndexedFile, 0, max(0, hints.TrackCount)),
		TextFiles:         make([]LibraryIndexedFile, 0, max(0, hints.TextFileCount)),
		ImageFiles:        make([]LibraryIndexedFile, 0, max(0, hints.ImageFileCount)),
		CoverPathByFolder: make(map[string]string, max(0, hints.ImageFileCount/8)),
	}

	selectedCoverPriority := make(map[string]int, max(0, hints.ImageFileCount/8))
	selectedCoverName := make(map[string]string, max(0, hints.ImageFileCount/8))

	var walk func(root libraryRootConfig, absolutePath string, folderPath string) error
	walk = func(root libraryRootConfig, absolutePath string, folderPath string) error {
		if isScanCanceled() {
			return errLibraryScanCanceled
		}

		entries, err := os.ReadDir(absolutePath)
		if err != nil {
			return nil
		}

		for _, entry := range entries {
			if isScanCanceled() {
				return errLibraryScanCanceled
			}
			if entry.Type()&os.ModeSymlink != 0 {
				continue
			}

			currentPath := filepath.Join(absolutePath, entry.Name())
			result.TotalEntries++

			entryInfo, infoErr := entry.Info()
			if infoErr != nil {
				continue
			}

			relativePath := buildVirtualLibraryPath(folderPath, entry.Name())

			if entry.IsDir() {
				if err := walk(root, currentPath, relativePath); err != nil {
					return err
				}
				continue
			}

			indexed := LibraryIndexedFile{
				Name:         entry.Name(),
				Path:         currentPath,
				RelativePath: relativePath,
				FolderPath:   folderPath,
				RootPath:     root.Path,
				RootName:     root.Name,
				ReleaseDepth: root.ReleaseDepth,
				ModifiedAtMs: modifiedAtMsFromFileInfo(entryInfo),
			}

			switch {
			case isAudioPath(currentPath):
				result.TrackFiles = append(result.TrackFiles, indexed)
			case isTextPath(currentPath):
				result.TextFiles = append(result.TextFiles, indexed)
			case isImagePath(currentPath):
				result.ImageFiles = append(result.ImageFiles, indexed)
				if !isPreferredCoverImagePath(currentPath) {
					continue
				}

				folderKey := strings.ToLower(folderPath)
				name := strings.ToLower(entry.Name())
				priority := coverPriority(name)
				currentPriority, hasCurrent := selectedCoverPriority[folderKey]
				currentName := selectedCoverName[folderKey]
				if !hasCurrent || priority < currentPriority || (priority == currentPriority && name < currentName) {
					selectedCoverPriority[folderKey] = priority
					selectedCoverName[folderKey] = name
					result.CoverPathByFolder[folderKey] = currentPath
				}
			}
		}

		return nil
	}

	for _, root := range roots {
		if err := walk(root, root.Path, root.Name); err != nil {
			return LibraryScanResult{}, err
		}
	}

	sort.SliceStable(result.TrackFiles, func(i int, j int) bool {
		return strings.ToLower(result.TrackFiles[i].RelativePath) < strings.ToLower(result.TrackFiles[j].RelativePath)
	})
	sort.SliceStable(result.TextFiles, func(i int, j int) bool {
		return strings.ToLower(result.TextFiles[i].RelativePath) < strings.ToLower(result.TextFiles[j].RelativePath)
	})
	sort.SliceStable(result.ImageFiles, func(i int, j int) bool {
		return strings.ToLower(result.ImageFiles[i].RelativePath) < strings.ToLower(result.ImageFiles[j].RelativePath)
	})

	result.TrackCount = len(result.TrackFiles)
	result.TextFileCount = len(result.TextFiles)
	result.ImageFileCount = len(result.ImageFiles)
	return result, nil
}

func compactLibraryScanResult(scan LibraryScanResult) LibraryScanResult {
	return LibraryScanResult{
		RootPath:       scan.RootPath,
		RootName:       scan.RootName,
		DeferredFiles:  scan.DeferredFiles,
		TotalEntries:   scan.TotalEntries,
		TrackCount:     scan.TrackCount,
		TextFileCount:  scan.TextFileCount,
		ImageFileCount: scan.ImageFileCount,
		Truncated:      scan.Truncated,
		EntryLimit:     scan.EntryLimit,
	}
}

func (a *App) estimateDeferredHydrationMs(totalEntries int, quickScanElapsed time.Duration) float64 {
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	quickElapsedMs := float64(quickScanElapsed.Milliseconds())
	if quickElapsedMs <= 0 {
		quickElapsedMs = 1000
	}

	contentState.indexMu.Lock()
	learnedScanEntryMs := scanState.scanEntryMs
	learnedFinalizeMs := scanState.scanFinalizeMs
	learnedWatcherMs := scanState.scanWatcherMs
	contentState.indexMu.Unlock()

	if learnedFinalizeMs > learnedWatcherMs && learnedWatcherMs > 0 {
		learnedFinalizeMs -= learnedWatcherMs
	}

	estimatedMs := 0.0
	if learnedScanEntryMs > 0 && totalEntries > 0 {
		estimatedMs += learnedScanEntryMs * float64(totalEntries)
	}
	if learnedFinalizeMs > 0 {
		estimatedMs += learnedFinalizeMs
	}
	if estimatedMs <= 0 {
		estimatedMs = quickElapsedMs * deferredHydrationFallbackQuickScanMultiplier
	}
	if estimatedMs < 1000 {
		estimatedMs = 1000
	}

	return estimatedMs
}

func (a *App) emitDeferredHydrationProgress(rootPath string, totalEntries int, startedAt time.Time, estimatedMs float64) {
	runtimeState := a.runtimeState()
	if runtimeState.ctx == nil {
		return
	}

	elapsedMs := time.Since(startedAt).Milliseconds()
	if elapsedMs < 0 {
		elapsedMs = 0
	}

	remainingMs := estimatedMs - float64(elapsedMs)
	if remainingMs < 0 {
		remainingMs = 0
	}

	entriesScanned := 0
	if totalEntries > 0 && estimatedMs > 0 {
		progress := float64(elapsedMs) / estimatedMs
		if progress < 0 {
			progress = 0
		}
		if progress > 1 {
			progress = 1
		}
		entriesScanned = int(math.Round(progress * float64(totalEntries)))
	}

	runtimeEventsEmit(runtimeState.ctx, libraryScanProgressEvent, LibraryScanProgress{
		RootPath:       rootPath,
		EntriesScanned: entriesScanned,
		TotalEntries:   totalEntries,
		ElapsedMs:      elapsedMs,
		EtaSeconds:     int(math.Ceil(remainingMs / 1000)),
		Phase:          "finalizing",
	})
}

func (a *App) emitDeferredScanInitialProgress(rootPath string) {
	runtimeState := a.runtimeState()
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	if runtimeState.ctx == nil {
		return
	}

	contentState.indexMu.Lock()
	learnedTotalEntries := scanState.scanLastTotalEntries
	learnedScanEntryMs := scanState.scanEntryMs
	learnedFinalizeMs := scanState.scanFinalizeMs
	learnedWatcherMs := scanState.scanWatcherMs
	contentState.indexMu.Unlock()

	if learnedFinalizeMs > learnedWatcherMs && learnedWatcherMs > 0 {
		learnedFinalizeMs -= learnedWatcherMs
	}

	estimatedMs := 0.0
	if learnedScanEntryMs > 0 && learnedTotalEntries > 0 {
		estimatedMs += learnedScanEntryMs * float64(learnedTotalEntries)
	}
	if learnedFinalizeMs > 0 {
		estimatedMs += learnedFinalizeMs
	}
	if estimatedMs <= 0 {
		return
	}

	runtimeEventsEmit(runtimeState.ctx, libraryScanProgressEvent, LibraryScanProgress{
		RootPath:       rootPath,
		EntriesScanned: 0,
		TotalEntries:   learnedTotalEntries,
		ElapsedMs:      0,
		EtaSeconds:     int(math.Ceil(estimatedMs / 1000)),
		Phase:          "scanning",
	})
}

func (a *App) buildDeferredHydrationScan(roots []libraryRootConfig, hints libraryFullScanBuildHints, expectedScanGeneration uint64) (LibraryScanResult, error) {
	generationState := a.libraryGenerationState()
	isScanCanceled := func() bool {
		return generationState.libraryScanGeneration.Load() != expectedScanGeneration
	}

	result, err := buildFilesystemFullScan(roots, hints, isScanCanceled)
	if err != nil {
		return LibraryScanResult{}, err
	}
	result.DeferredFiles = false
	return result, nil
}

func (a *App) startLibraryFileHydrationAsync(roots []libraryRootConfig, expectedScanGeneration uint64, hints libraryFullScanBuildHints, estimatedMs float64) {
	if len(roots) == 0 {
		return
	}
	contentState := a.libraryContentState()
	generationState := a.libraryGenerationState()
	indexState := a.libraryIndexState()
	runtimeState := a.runtimeState()

	rootsCopy := append([]libraryRootConfig(nil), roots...)
	a.logRescanEvent("Deferred library hydration START: roots=%d", len(rootsCopy))
	releaseAsyncTask := a.beginLibraryScanAsyncTask()

	go func(activeRoots []libraryRootConfig) {
		defer releaseAsyncTask()
		startedAt := time.Now()
		stopProgress := make(chan struct{})
		rootPath, _ := aggregateLibraryScanRootInfo(activeRoots)
		if estimatedMs > 0 {
			a.emitDeferredHydrationProgress(rootPath, hints.TotalEntries, startedAt, estimatedMs)
		}

		if estimatedMs > 0 {
			go func(rootPath string, entries int, started time.Time, activeStop <-chan struct{}) {
				ticker := time.NewTicker(500 * time.Millisecond)
				defer ticker.Stop()

				for {
					select {
					case <-activeStop:
						return
					case <-ticker.C:
						a.emitDeferredHydrationProgress(rootPath, entries, started, estimatedMs)
					}
				}
			}(rootPath, hints.TotalEntries, startedAt, stopProgress)
		}
		defer close(stopProgress)

		result, err := a.buildDeferredHydrationScan(activeRoots, hints, expectedScanGeneration)
		if err != nil {
			contentState.indexMu.Lock()
			if generationState.libraryScanGeneration.Load() == expectedScanGeneration {
				indexState.libraryFileHydrationPending = false
			}
			contentState.indexMu.Unlock()

			if errors.Is(err, errLibraryScanCanceled) {
				a.logRescanEvent("Deferred library hydration CANCELED")
				return
			}

			a.logRescanEvent("Deferred library hydration failed: %v", err)
			return
		}

		if !a.setLibraryIndexFromScan(result, expectedScanGeneration) {
			a.logRescanEvent("Deferred library hydration canceled during index commit")
			return
		}

		shouldEmitUpdate := false
		payload := LibraryScanResult{}
		contentState.indexMu.Lock()
		if generationState.libraryScanGeneration.Load() == expectedScanGeneration {
			indexState.libraryFileHydrationPending = false
			indexState.libraryFolderEntriesCache = nil
			shouldEmitUpdate = true
			payload = compactLibraryScanResult(contentState.libraryScan)
		}
		contentState.indexMu.Unlock()
		if shouldEmitUpdate && runtimeState.ctx != nil {
			runtimeEventsEmit(runtimeState.ctx, libraryScanUpdatedEvent, payload)
		}
		a.notifyMusicBrainzTagWorker()
		a.notifyLibraryFilesDatabaseWorker()
		a.emitDeferredHydrationProgress(result.RootPath, hints.TotalEntries, startedAt, 0)

		a.logRescanEvent(
			"Deferred library hydration END: tracks=%d text=%d images=%d took %.2fms",
			result.TrackCount,
			result.TextFileCount,
			result.ImageFileCount,
			time.Since(startedAt).Seconds()*1000,
		)
	}(rootsCopy)
}

func (a *App) scanLibraryFoldersDeferred(folders []AppLibraryFolder, restartWatcher bool) LibraryScanResult {
	scanStartedAt := time.Now()
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	generationState := a.libraryGenerationState()
	indexState := a.libraryIndexState()
	scanGeneration := generationState.libraryScanGeneration.Add(1)
	isScanCanceled := func() bool {
		return generationState.libraryScanGeneration.Load() != scanGeneration
	}
	scanCanceledResponse := func() LibraryScanResult {
		contentState.indexMu.Lock()
		defer contentState.indexMu.Unlock()

		return LibraryScanResult{
			RootPath:       contentState.libraryScan.RootPath,
			RootName:       contentState.libraryScan.RootName,
			DeferredFiles:  contentState.libraryScan.DeferredFiles,
			TotalEntries:   contentState.libraryScan.TotalEntries,
			TrackCount:     contentState.libraryScan.TrackCount,
			TextFileCount:  contentState.libraryScan.TextFileCount,
			ImageFileCount: contentState.libraryScan.ImageFileCount,
			Truncated:      contentState.libraryScan.Truncated,
			EntryLimit:     contentState.libraryScan.EntryLimit,
		}
	}

	roots := resolveLibraryRootConfigs(normalizeLibraryFolders(folders, "", 0))
	rootPath, rootName := aggregateLibraryScanRootInfo(roots)
	result := newDeferredScanResult(rootPath, rootName)

	if len(roots) == 0 {
		if restartWatcher {
			a.stopLibraryWatcher()
		}
		contentState.indexMu.Lock()
		contentState.activeLibraryRoots = nil
		indexState.libraryWatchDirectoryPaths = nil
		indexState.libraryFolderEntriesCache = nil
		indexState.libraryFileHydrationPending = false
		contentState.indexMu.Unlock()
		a.setLibraryIndexFromScan(result, scanGeneration)
		a.notifyMusicBrainzTagWorker()
		a.notifyLibraryFilesDatabaseWorker()
		return result
	}

	a.logRescanEvent("scanLibraryFolders deferred START: roots=%d restartWatcher=%t", len(roots), restartWatcher)
	a.emitDeferredScanInitialProgress(result.RootPath)
	if restartWatcher {
		a.stopLibraryWatcher()
	}

	contentState.indexMu.Lock()
	contentState.activeLibraryRoots = append([]libraryRootConfig(nil), roots...)
	contentState.trackByPath = make(map[string]LibraryIndexedFile)
	contentState.textByPath = make(map[string]LibraryIndexedFile)
	contentState.imageByPath = make(map[string]LibraryIndexedFile)
	a.markLibraryDerivedIndexDirtyLocked()
	indexState.searchFolderEntries = nil
	indexState.libraryFolderEntriesCache = make(map[string][]LibraryBrowserEntry)
	indexState.libraryWatchDirectoryPaths = nil
	indexState.libraryFileHydrationPending = false
	scanState.scanInProgress = true
	scanState.scanRemainingImmediateChildrenByFolder = make(map[string]int, len(roots))
	scanState.scanDiscoveredChildFoldersByParent = make(map[string]map[string]struct{}, len(roots)+1)
	for _, root := range roots {
		addDiscoveredChildFolder(scanState.scanDiscoveredChildFoldersByParent, "", root.Name)
		scanState.scanRemainingImmediateChildrenByFolder[root.Name] = 1
	}
	contentState.libraryScan = result
	contentState.indexMu.Unlock()

	defer func() {
		contentState.indexMu.Lock()
		scanState.scanInProgress = false
		scanState.scanRemainingImmediateChildrenByFolder = nil
		scanState.scanDiscoveredChildFoldersByParent = nil
		contentState.indexMu.Unlock()
	}()

	if a.localLibraryFilesDatabaseLoadOnStartupEnabled() {
		if snapshot, ok := loadLibraryFilesDatabaseSnapshot(a.libraryFilesDatabasePath(), roots); ok {
			persistedResult := snapshot.scanResult()
			if !a.setLibraryIndexFromScan(persistedResult, scanGeneration) {
				return scanCanceledResponse()
			}

			contentState.indexMu.Lock()
			if generationState.libraryScanGeneration.Load() != scanGeneration {
				contentState.indexMu.Unlock()
				return scanCanceledResponse()
			}
			indexState.libraryFolderEntriesCache = nil
			indexState.libraryWatchDirectoryPaths = nil
			contentState.indexMu.Unlock()

			a.notifyMusicBrainzTagWorker()
			if restartWatcher {
				a.startLibraryWatcherAsync(roots)
			}
			a.startLibraryFilesRefreshAsync(roots, scanGeneration)

			response := compactLibraryScanResult(persistedResult)
			a.logRescanEvent(
				"scanLibraryFolders deferred END (database): totalEntries=%d tracks=%d text=%d images=%d took %.2fms",
				response.TotalEntries,
				response.TrackCount,
				response.TextFileCount,
				response.ImageFileCount,
				time.Since(scanStartedAt).Seconds()*1000,
			)
			return response
		}
	}

	quickBuild, quickErr := buildFilesystemQuickScan(roots, isScanCanceled)
	if quickErr != nil {
		if errors.Is(quickErr, errLibraryScanCanceled) {
			return scanCanceledResponse()
		}

		a.logRescanEvent("scanLibraryFolders deferred walk failed: %v", quickErr)
		return scanCanceledResponse()
	}

	quickBuild.ScanResult.DeferredFiles = true
	folderChildPathsByFolder := buildFolderChildPathsFromDiscovered(quickBuild.DiscoveredChildFoldersByParent)
	searchFolderEntries := buildFolderSearchEntriesFromChildPaths(folderChildPathsByFolder)

	contentState.indexMu.Lock()
	if generationState.libraryScanGeneration.Load() != scanGeneration {
		contentState.indexMu.Unlock()
		return scanCanceledResponse()
	}

	indexState.folderChildPathsByFolder = folderChildPathsByFolder
	indexState.searchFolderEntries = searchFolderEntries
	indexState.libraryFolderEntriesCache = make(map[string][]LibraryBrowserEntry)
	indexState.libraryWatchDirectoryPaths = append([]string(nil), quickBuild.DirectoryPaths...)
	indexState.libraryFileHydrationPending = quickBuild.ScanResult.TrackCount > 0 || quickBuild.ScanResult.TextFileCount > 0 || quickBuild.ScanResult.ImageFileCount > 0
	scanState.scanLastTotalEntries = quickBuild.ScanResult.TotalEntries
	contentState.libraryScan = quickBuild.ScanResult
	contentState.libraryScan.CoverPathByFolder = cloneCoverPathByFolder(quickBuild.ScanResult.CoverPathByFolder)
	contentState.indexMu.Unlock()

	if restartWatcher {
		a.startLibraryWatcherAsyncWithDirectories(roots, quickBuild.DirectoryPaths)
	}
	if indexState.libraryFileHydrationPending {
		a.startLibraryFileHydrationAsync(
			roots,
			scanGeneration,
			libraryFullScanBuildHints{
				TotalEntries:   quickBuild.ScanResult.TotalEntries,
				TrackCount:     quickBuild.ScanResult.TrackCount,
				TextFileCount:  quickBuild.ScanResult.TextFileCount,
				ImageFileCount: quickBuild.ScanResult.ImageFileCount,
			},
			a.estimateDeferredHydrationMs(quickBuild.ScanResult.TotalEntries, time.Since(scanStartedAt)),
		)
	}

	response := quickBuild.ScanResult
	response.TrackFiles = []LibraryIndexedFile{}
	response.TextFiles = []LibraryIndexedFile{}
	response.ImageFiles = []LibraryIndexedFile{}
	a.logRescanEvent(
		"scanLibraryFolders deferred END: totalEntries=%d tracks=%d text=%d images=%d directories=%d took %.2fms",
		response.TotalEntries,
		response.TrackCount,
		response.TextFileCount,
		response.ImageFileCount,
		len(quickBuild.DirectoryPaths),
		time.Since(scanStartedAt).Seconds()*1000,
	)
	return response
}
