package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

var beforeIncrementalLibraryPathScanHook func(string)

type preparedIncrementalLibraryChange struct {
	root       libraryRootConfig
	targetPath string
	trackFiles []LibraryIndexedFile
	textFiles  []LibraryIndexedFile
	imageFiles []LibraryIndexedFile
}

func modifiedAtMsFromFileInfo(info os.FileInfo) int64 {
	if info == nil {
		return 0
	}

	return info.ModTime().UnixMilli()
}

func activeLibraryRootForPathInRoots(roots []libraryRootConfig, path string) (libraryRootConfig, bool) {
	absolutePath, ok := absoluteNormalizedPath(path)
	if !ok {
		return libraryRootConfig{}, false
	}

	bestMatch := libraryRootConfig{}
	bestMatchLength := -1
	for _, root := range roots {
		if !pathWithinRoot(root.Path, absolutePath) {
			continue
		}

		if len(root.Path) <= bestMatchLength {
			continue
		}

		bestMatch = root
		bestMatchLength = len(root.Path)
	}

	if bestMatchLength < 0 {
		return libraryRootConfig{}, false
	}

	return bestMatch, true
}

func appendPreparedIncrementalLibraryFile(prepared *preparedIncrementalLibraryChange, indexed LibraryIndexedFile) {
	switch {
	case isAudioPath(indexed.Path):
		prepared.trackFiles = append(prepared.trackFiles, indexed)
	case isTextPath(indexed.Path):
		prepared.textFiles = append(prepared.textFiles, indexed)
	case isImagePath(indexed.Path):
		prepared.imageFiles = append(prepared.imageFiles, indexed)
	}
}

func (a *App) prepareIncrementalLibraryChange(root libraryRootConfig, targetPath string) preparedIncrementalLibraryChange {
	if beforeIncrementalLibraryPathScanHook != nil {
		beforeIncrementalLibraryPathScanHook(targetPath)
	}

	startTime := time.Now()
	prepared := preparedIncrementalLibraryChange{root: root, targetPath: targetPath}
	info, err := os.Stat(targetPath)
	if err != nil {
		return prepared
	}

	if !info.IsDir() {
		if indexed, ok := indexFileForRootWithModifiedAt(root, targetPath, info.Name(), modifiedAtMsFromFileInfo(info)); ok {
			appendPreparedIncrementalLibraryFile(&prepared, indexed)
		}
		a.logRescanEvent("  - processed single file: %s", targetPath)
		return prepared
	}

	fileCount := 0
	_ = filepath.WalkDir(targetPath, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}

		entryInfo, infoErr := entry.Info()
		if infoErr != nil {
			return nil
		}

		if indexed, ok := indexFileForRootWithModifiedAt(root, currentPath, entry.Name(), modifiedAtMsFromFileInfo(entryInfo)); ok {
			appendPreparedIncrementalLibraryFile(&prepared, indexed)
		}
		fileCount++
		return nil
	})
	a.logRescanEvent("  - processed directory: %s (%d files in %.2fms)", targetPath, fileCount, time.Since(startTime).Seconds()*1000)
	return prepared
}

func (a *App) applyPreparedIncrementalLibraryChange(prepared preparedIncrementalLibraryChange) {
	contentState := a.libraryContentState()
	a.removePathAndDescendants(prepared.targetPath)
	for _, indexed := range prepared.trackFiles {
		contentState.trackByPath[indexed.Path] = indexed
	}
	for _, indexed := range prepared.textFiles {
		contentState.textByPath[indexed.Path] = indexed
	}
	for _, indexed := range prepared.imageFiles {
		contentState.imageByPath[indexed.Path] = indexed
	}
}

func (a *App) removePathAndDescendants(path string) {
	contentState := a.libraryContentState()
	delete(contentState.trackByPath, path)
	delete(contentState.textByPath, path)
	delete(contentState.imageByPath, path)

	prefix := path + string(filepath.Separator)
	for candidatePath := range contentState.trackByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(contentState.trackByPath, candidatePath)
		}
	}
	for candidatePath := range contentState.textByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(contentState.textByPath, candidatePath)
		}
	}
	for candidatePath := range contentState.imageByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(contentState.imageByPath, candidatePath)
		}
	}
}

func indexFileForRootWithModifiedAt(root libraryRootConfig, fullPath string, fileName string, modifiedAtMs int64) (LibraryIndexedFile, bool) {
	if !pathResolvesWithinRoot(root.Path, fullPath) {
		return LibraryIndexedFile{}, false
	}

	folderPath, relativePath, ok := folderAndRelativeForLibraryRoot(root, fullPath)
	if !ok {
		return LibraryIndexedFile{}, false
	}

	return LibraryIndexedFile{
		Name:         fileName,
		Path:         fullPath,
		RelativePath: relativePath,
		FolderPath:   folderPath,
		RootPath:     root.Path,
		RootName:     root.Name,
		ReleaseDepth: root.ReleaseDepth,
		ModifiedAtMs: modifiedAtMs,
	}, true
}

func indexFileForRoot(root libraryRootConfig, fullPath string, fileName string) (LibraryIndexedFile, bool) {
	info, err := os.Stat(fullPath)
	if err != nil {
		return indexFileForRootWithModifiedAt(root, fullPath, fileName, 0)
	}

	return indexFileForRootWithModifiedAt(root, fullPath, fileName, modifiedAtMsFromFileInfo(info))
}

func (a *App) addOrUpdateIndexedFile(root libraryRootConfig, fullPath string, fileName string) {
	contentState := a.libraryContentState()
	a.removePathAndDescendants(fullPath)

	indexed, ok := indexFileForRoot(root, fullPath, fileName)
	if !ok {
		return
	}

	switch {
	case isAudioPath(fullPath):
		contentState.trackByPath[fullPath] = indexed
	case isTextPath(fullPath):
		contentState.textByPath[fullPath] = indexed
	case isImagePath(fullPath):
		contentState.imageByPath[fullPath] = indexed
	}
}

func (a *App) addOrUpdatePathRecursive(root libraryRootConfig, targetPath string) {
	prepared := a.prepareIncrementalLibraryChange(root, targetPath)
	a.applyPreparedIncrementalLibraryChange(prepared)
}

func incrementalLibraryChangeTargetPath(changedPath string) string {
	absolutePath, ok := absoluteNormalizedPath(changedPath)
	if !ok {
		return ""
	}

	info, err := os.Stat(absolutePath)
	if err == nil && info.IsDir() {
		return absolutePath
	}

	if isImagePath(absolutePath) {
		return filepath.Dir(absolutePath)
	}

	return absolutePath
}

func coalesceIncrementalLibraryChangePaths(changedPaths []string) []string {
	normalizedPaths := make([]string, 0, len(changedPaths))
	seen := make(map[string]struct{}, len(changedPaths))
	for _, changedPath := range changedPaths {
		targetPath := incrementalLibraryChangeTargetPath(changedPath)
		if targetPath == "" {
			continue
		}

		if _, exists := seen[targetPath]; exists {
			continue
		}

		seen[targetPath] = struct{}{}
		normalizedPaths = append(normalizedPaths, targetPath)
	}

	if len(normalizedPaths) <= 1 {
		return normalizedPaths
	}

	sort.Slice(normalizedPaths, func(i int, j int) bool {
		left := normalizedPaths[i]
		right := normalizedPaths[j]
		if len(left) == len(right) {
			return left < right
		}
		return len(left) < len(right)
	})

	coalesced := make([]string, 0, len(normalizedPaths))
	for _, candidate := range normalizedPaths {
		covered := false
		for _, existing := range coalesced {
			if pathWithinRoot(existing, candidate) {
				covered = true
				break
			}
		}
		if covered {
			continue
		}

		coalesced = append(coalesced, candidate)
	}

	return coalesced
}

// applyIncrementalLibraryChanges resolves the owning root for each changed path
// so one debounced watcher batch can update multiple configured library folders.
func (a *App) applyIncrementalLibraryChanges(changedPaths []string) (LibraryScanResult, bool) {
	startTime := time.Now()
	changedPaths = coalesceIncrementalLibraryChangePaths(changedPaths)
	a.logRescanEvent("applyIncrementalLibraryChanges START with %d paths", len(changedPaths))
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	generationState := a.libraryGenerationState()
	indexState := a.libraryIndexState()

	lockWaitStart := time.Now()
	a.logRescanEvent("  - waiting for indexMu lock...")
	contentState.indexMu.Lock()
	a.logRescanEvent("  - acquired indexMu lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)

	if len(changedPaths) == 0 {
		contentState.indexMu.Unlock()
		return LibraryScanResult{}, false
	}
	if indexState.libraryFileHydrationPending || scanState.scanInProgress {
		a.logRescanEvent("applyIncrementalLibraryChanges skipped: deferred hydration still pending")
		contentState.indexMu.Unlock()
		return LibraryScanResult{}, false
	}
	expectedGeneration := generationState.libraryScanGeneration.Load()
	rootsSnapshot := append([]libraryRootConfig(nil), contentState.activeLibraryRoots...)
	beforeSelection := a.collectShareableLocalSelectionLocked(changedPaths)
	contentState.indexMu.Unlock()

	hasChanges := false
	processStartTime := time.Now()
	preparedChanges := make([]preparedIncrementalLibraryChange, 0, len(changedPaths))
	for _, changedPath := range changedPaths {
		cleanChangedPath := normalizePath(changedPath)
		if cleanChangedPath == "" {
			continue
		}

		absoluteChangedPath, err := filepath.Abs(cleanChangedPath)
		if err != nil {
			continue
		}

		normalizedChangedPath := filepath.Clean(absoluteChangedPath)
		root, ok := activeLibraryRootForPathInRoots(rootsSnapshot, normalizedChangedPath)
		if !ok {
			continue
		}

		preparedChanges = append(preparedChanges, a.prepareIncrementalLibraryChange(root, normalizedChangedPath))
		hasChanges = true
	}
	a.logRescanEvent("applyIncrementalLibraryChanges path processing took %.2fms for %d paths",
		time.Since(processStartTime).Seconds()*1000, len(changedPaths))

	if !hasChanges {
		return LibraryScanResult{}, false
	}

	contentState.indexMu.Lock()
	if generationState.libraryScanGeneration.Load() != expectedGeneration || indexState.libraryFileHydrationPending || scanState.scanInProgress {
		a.logRescanEvent(
			"applyIncrementalLibraryChanges skipped before commit: generation=%d active=%d hydrationPending=%t scanInProgress=%t",
			expectedGeneration,
			generationState.libraryScanGeneration.Load(),
			indexState.libraryFileHydrationPending,
			scanState.scanInProgress,
		)
		contentState.indexMu.Unlock()
		return LibraryScanResult{}, false
	}

	indexUpdates := make([]incrementalDerivedIndexUpdate, 0, len(preparedChanges))
	hasIndexedChanges := false
	for _, prepared := range preparedChanges {
		if len(prepared.trackFiles) == 0 && len(prepared.textFiles) == 0 && len(prepared.imageFiles) == 0 && !a.pathHasIndexedContentLocked(prepared.targetPath) {
			continue
		}

		indexUpdates = append(indexUpdates, a.collectIncrementalDerivedIndexUpdateLocked(prepared))
		a.applyPreparedIncrementalLibraryChange(prepared)
		hasIndexedChanges = true
	}

	if !hasIndexedChanges {
		contentState.indexMu.Unlock()
		return LibraryScanResult{}, false
	}

	affectedFolders := make(map[string]struct{}, len(beforeSelection.affectedFolders))
	for folderPath := range beforeSelection.affectedFolders {
		affectedFolders[folderPath] = struct{}{}
	}
	afterSelection := a.collectShareableLocalSelectionLocked(changedPaths)
	for folderPath := range afterSelection.affectedFolders {
		affectedFolders[folderPath] = struct{}{}
	}
	afterCoverPathByFolder := a.localCoverPathsForFoldersLocked(affectedFolders)
	if contentState.libraryScan.CoverPathByFolder == nil {
		contentState.libraryScan.CoverPathByFolder = map[string]string{}
	}
	for folderPath := range affectedFolders {
		delete(contentState.libraryScan.CoverPathByFolder, strings.ToLower(folderPath))
	}
	for folderPath, virtualPath := range afterCoverPathByFolder {
		absolutePath, ok := a.resolveAbsoluteLibraryPathFromVirtualPath(virtualPath)
		if !ok || isRemoteLibraryPath(absolutePath) {
			continue
		}
		contentState.libraryScan.CoverPathByFolder[strings.ToLower(folderPath)] = absolutePath
	}

	// Avoid expensive full snapshot rebuild for incremental changes.
	// Just update the counts in the cached snapshot without re-sorting all files.
	// The file arrays are still valid (items may have been added/removed from the maps,
	// but the snapshot lists are consistent for the event emission).
	updateStartTime := time.Now()
	a.applyIncrementalDerivedIndexUpdatesLocked(indexUpdates)
	contentState.libraryScan.TrackCount = len(contentState.trackByPath)
	contentState.libraryScan.TextFileCount = len(contentState.textByPath)
	contentState.libraryScan.ImageFileCount = len(contentState.imageByPath)
	contentState.libraryScan.TotalEntries = contentState.libraryScan.TrackCount + contentState.libraryScan.TextFileCount + contentState.libraryScan.ImageFileCount

	// Emit only the lightweight metadata — the frontend no longer uses the file arrays
	// for incremental updates, and serializing 150K+ entries over IPC takes several seconds.
	notification := LibraryScanResult{
		RootPath:       contentState.libraryScan.RootPath,
		RootName:       contentState.libraryScan.RootName,
		ScanGeneration: contentState.libraryScan.ScanGeneration,
		TotalEntries:   contentState.libraryScan.TotalEntries,
		TrackCount:     contentState.libraryScan.TrackCount,
		TextFileCount:  contentState.libraryScan.TextFileCount,
		ImageFileCount: contentState.libraryScan.ImageFileCount,
		Truncated:      contentState.libraryScan.Truncated,
		EntryLimit:     contentState.libraryScan.EntryLimit,
	}
	contentState.indexMu.Unlock()
	a.syncSystemMediaTransportControlsCurrentState()
	a.notifyMusicBrainzTagWorker()
	a.notifyLibraryFilesDatabaseWorkerIncremental(preparedChanges, notification.TotalEntries)
	a.logRescanEvent("applyIncrementalLibraryChanges update took %.2fms, total time %.2fms",
		time.Since(updateStartTime).Seconds()*1000, time.Since(startTime).Seconds()*1000)

	return notification, true
}

func isRelevantWatchEvent(event fsnotify.Event) bool {
	interestingOps := fsnotify.Create | fsnotify.Write | fsnotify.Remove | fsnotify.Rename
	return event.Op&interestingOps != 0
}

func addLibraryWatchesRecursive(watcher *fsnotify.Watcher, rootPath string, onProgress func()) {
	_ = filepath.WalkDir(rootPath, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}

		if !entry.IsDir() {
			return nil
		}

		_ = watcher.Add(currentPath)
		if onProgress != nil {
			onProgress()
		}
		return nil
	})
}

func collectWatchableLibraryRootPaths(roots []libraryRootConfig) []string {
	rootPaths := make([]string, 0, len(roots))
	for _, root := range roots {
		if strings.TrimSpace(root.Path) == "" {
			continue
		}

		if info, statErr := os.Stat(root.Path); statErr != nil || !info.IsDir() {
			continue
		}

		rootPaths = append(rootPaths, root.Path)
	}

	return rootPaths
}

func collectWatchableLibraryDirectoryPaths(roots []libraryRootConfig, directoryPaths []string) []string {
	rootPaths := collectWatchableLibraryRootPaths(roots)
	if libraryWatcherUsesRecursiveRootHandles() {
		return rootPaths
	}

	if len(directoryPaths) == 0 {
		return rootPaths
	}

	seen := make(map[string]struct{}, len(directoryPaths))
	watchable := make([]string, 0, len(directoryPaths))
	for _, candidate := range directoryPaths {
		absoluteCandidate, ok := absoluteNormalizedPath(candidate)
		if !ok {
			continue
		}

		if _, exists := seen[absoluteCandidate]; exists {
			continue
		}

		withinRoot := false
		for _, rootPath := range rootPaths {
			if pathWithinRoot(rootPath, absoluteCandidate) {
				withinRoot = true
				break
			}
		}
		if !withinRoot {
			continue
		}

		info, statErr := os.Stat(absoluteCandidate)
		if statErr != nil || !info.IsDir() {
			continue
		}

		seen[absoluteCandidate] = struct{}{}
		watchable = append(watchable, absoluteCandidate)
	}

	if len(watchable) == 0 {
		return rootPaths
	}

	return watchable
}

func (a *App) stopLibraryWatcherReserved(generation uint64) {
	watcherState := a.libraryWatcherState()
	if generation > 0 && watcherState.generation.Load() != generation {
		return
	}

	watcherState.mu.Lock()
	if generation > 0 && watcherState.generation.Load() != generation {
		watcherState.mu.Unlock()
		return
	}

	watcher := watcherState.watcher
	stopCh := watcherState.stopCh
	watcherState.watcher = nil
	watcherState.stopCh = nil
	watcherState.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}

	if watcher != nil {
		_ = watcher.Close()
	}
}

func (a *App) startLibraryWatcherReserved(roots []libraryRootConfig, directoryPaths []string, onProgress func(), generation uint64) bool {
	watchablePaths := collectWatchableLibraryDirectoryPaths(roots, directoryPaths)
	if len(watchablePaths) == 0 {
		a.stopLibraryWatcherReserved(generation)
		return false
	}

	watcherState := a.libraryWatcherState()
	if generation > 0 && watcherState.generation.Load() != generation {
		return false
	}

	a.logRescanEvent("Starting library watcher for %d directories", len(watchablePaths))

	watcher, watcherErr := newLibraryEventWatcher(roots, watchablePaths, directoryPaths, onProgress)
	if watcherErr != nil {
		a.logRescanEvent("Failed to create filesystem watcher: %v", watcherErr)
		return false
	}

	if generation > 0 && watcherState.generation.Load() != generation {
		_ = watcher.Close()
		return false
	}

	if generation > 0 && watcherState.generation.Load() != generation {
		_ = watcher.Close()
		return false
	}

	a.logRescanEvent("Watcher ready, listening for changes")
	stopCh := make(chan struct{})

	watcherState.mu.Lock()
	if generation > 0 && watcherState.generation.Load() != generation {
		watcherState.mu.Unlock()
		_ = watcher.Close()
		return false
	}

	previousWatcher := watcherState.watcher
	previousStopCh := watcherState.stopCh
	watcherState.watcher = watcher
	watcherState.stopCh = stopCh
	watcherState.mu.Unlock()

	if previousStopCh != nil {
		close(previousStopCh)
	}
	if previousWatcher != nil {
		_ = previousWatcher.Close()
	}

	go func(activeWatcher libraryEventWatcher, activeStopCh chan struct{}) {
		runtimeState := a.runtimeState()
		defer func() {
			_ = activeWatcher.Close()
		}()

		debounceDuration := activeWatcher.DebounceDuration()
		if debounceDuration <= 0 {
			debounceDuration = 500 * time.Millisecond
		}
		var timer *time.Timer
		var timerC <-chan time.Time
		pendingPaths := make(map[string]struct{})

		resetDebounce := func() {
			if timer == nil {
				timer = time.NewTimer(debounceDuration)
				timerC = timer.C
				return
			}

			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}

			timer.Reset(debounceDuration)
			timerC = timer.C
		}

		for {
			select {
			case <-activeStopCh:
				if timer != nil {
					timer.Stop()
				}
				return

			case event, ok := <-activeWatcher.Events():
				if !ok {
					if timer != nil {
						timer.Stop()
					}
					return
				}

				if event.Op&fsnotify.Create != 0 {
					activeWatcher.HandleCreatePath(event.Name)
				}

				if isRelevantWatchEvent(event) {
					pendingPaths[event.Name] = struct{}{}
					resetDebounce()
				}

			case <-timerC:
				timerC = nil
				changedPaths := make([]string, 0, len(pendingPaths))
				for changedPath := range pendingPaths {
					changedPaths = append(changedPaths, changedPath)
				}
				pendingPaths = make(map[string]struct{})
				a.logRescanEvent("Debounce timer fired, applying incremental changes to %d paths", len(changedPaths))

				scan, changed := a.applyIncrementalLibraryChanges(changedPaths)
				if changed && runtimeState.ctx != nil {
					emitStartTime := time.Now()
					a.logRescanEvent("EventsEmit START: sending scan update event")
					runtimeEventsEmit(runtimeState.ctx, libraryScanUpdatedEvent, scan)
					a.logRescanEvent("EventsEmit END: took %.2fms", time.Since(emitStartTime).Seconds()*1000)
				}

			case watcherErr, ok := <-activeWatcher.Errors():
				if !ok {
					if timer != nil {
						timer.Stop()
					}
					return
				}
				a.logRescanEvent("Library watcher error: %v", watcherErr)
			}
		}
	}(watcher, stopCh)

	return true
}

func (a *App) startLibraryWatcher(roots []libraryRootConfig, onProgress func()) {
	if len(roots) == 0 {
		a.stopLibraryWatcher()
		return
	}

	generation := a.libraryWatcherState().generation.Add(1)
	if !a.startLibraryWatcherReserved(roots, nil, onProgress, generation) {
		rootCount := len(collectWatchableLibraryRootPaths(roots))
		if rootCount == 0 {
			a.logRescanEvent("Library watcher not started: no valid roots")
		} else {
			a.logRescanEvent("Library watcher start canceled before activation")
		}
	}
}

func (a *App) startLibraryWatcherAsync(roots []libraryRootConfig) {
	a.startLibraryWatcherAsyncWithDirectories(roots, nil)
}

func (a *App) startLibraryWatcherAsyncWithDirectories(roots []libraryRootConfig, directoryPaths []string) {
	if len(roots) == 0 {
		a.stopLibraryWatcher()
		return
	}

	rootsCopy := append([]libraryRootConfig(nil), roots...)
	directoryPathsCopy := append([]string(nil), directoryPaths...)
	watcherState := a.libraryWatcherState()
	generation := watcherState.generation.Add(1)
	a.logRescanEvent("Scheduling asynchronous library watcher startup for %d roots", len(rootsCopy))

	go func(activeRoots []libraryRootConfig, activeDirectoryPaths []string, activeGeneration uint64) {
		startedAt := time.Now()
		started := a.startLibraryWatcherReserved(activeRoots, activeDirectoryPaths, nil, activeGeneration)
		if !started {
			if watcherState.generation.Load() != activeGeneration {
				a.logRescanEvent("Asynchronous library watcher startup canceled as stale")
				return
			}

			a.logRescanEvent("Asynchronous library watcher startup skipped: %s", fmt.Sprintf("validRoots=%d", len(collectWatchableLibraryRootPaths(activeRoots))))
			return
		}

		watcherMs := float64(time.Since(startedAt).Milliseconds())
		if watcherMs > 0 {
			contentState := a.libraryContentState()
			scanState := a.libraryScanState()
			contentState.indexMu.Lock()
			if scanState.scanWatcherMs <= 0 {
				scanState.scanWatcherMs = watcherMs
			} else {
				scanState.scanWatcherMs = (scanState.scanWatcherMs * 0.72) + (watcherMs * 0.28)
			}
			contentState.indexMu.Unlock()
		}

		a.logRescanEvent("Asynchronous library watcher startup END: took %.2fms", watcherMs)
	}(rootsCopy, directoryPathsCopy, generation)
}

func (a *App) stopLibraryWatcher() {
	generation := a.libraryWatcherState().generation.Add(1)
	a.stopLibraryWatcherReserved(generation)
}
