package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

func (a *App) removePathAndDescendants(path string) {
	delete(a.trackByPath, path)
	delete(a.textByPath, path)
	delete(a.imageByPath, path)

	prefix := path + string(filepath.Separator)
	for candidatePath := range a.trackByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(a.trackByPath, candidatePath)
		}
	}
	for candidatePath := range a.textByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(a.textByPath, candidatePath)
		}
	}
	for candidatePath := range a.imageByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(a.imageByPath, candidatePath)
		}
	}
}

func indexFileForRoot(root libraryRootConfig, fullPath string, fileName string) (LibraryIndexedFile, bool) {
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
	}, true
}

func (a *App) addOrUpdateIndexedFile(root libraryRootConfig, fullPath string, fileName string) {
	a.removePathAndDescendants(fullPath)

	indexed, ok := indexFileForRoot(root, fullPath, fileName)
	if !ok {
		return
	}

	switch {
	case isAudioPath(fullPath):
		a.trackByPath[fullPath] = indexed
	case isTextPath(fullPath):
		a.textByPath[fullPath] = indexed
	case isImagePath(fullPath):
		a.imageByPath[fullPath] = indexed
	}
}

func (a *App) addOrUpdatePathRecursive(root libraryRootConfig, targetPath string) {
	startTime := time.Now()
	info, err := os.Stat(targetPath)
	if err != nil {
		a.removePathAndDescendants(targetPath)
		return
	}

	if !info.IsDir() {
		a.addOrUpdateIndexedFile(root, targetPath, info.Name())
		a.logRescanEvent("  - processed single file: %s", targetPath)
		return
	}

	a.removePathAndDescendants(targetPath)
	fileCount := 0
	_ = filepath.WalkDir(targetPath, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}

		a.addOrUpdateIndexedFile(root, currentPath, entry.Name())
		fileCount++
		return nil
	})
	a.logRescanEvent("  - processed directory: %s (%d files in %.2fms)", targetPath, fileCount, time.Since(startTime).Seconds()*1000)
}

// applyIncrementalLibraryChanges resolves the owning root for each changed path
// so one debounced watcher batch can update multiple configured library folders.
func (a *App) applyIncrementalLibraryChanges(changedPaths []string) (LibraryScanResult, bool) {
	startTime := time.Now()
	a.logRescanEvent("applyIncrementalLibraryChanges START with %d paths", len(changedPaths))

	lockWaitStart := time.Now()
	a.logRescanEvent("  - waiting for indexMu lock...")
	a.indexMu.Lock()
	a.logRescanEvent("  - acquired indexMu lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer a.indexMu.Unlock()

	if len(changedPaths) == 0 {
		return LibraryScanResult{}, false
	}
	if a.libraryFileHydrationPending {
		a.logRescanEvent("applyIncrementalLibraryChanges skipped: deferred hydration still pending")
		return LibraryScanResult{}, false
	}

	hasChanges := false
	processStartTime := time.Now()
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
		root, ok := a.activeLibraryRootForPath(normalizedChangedPath)
		if !ok {
			continue
		}

		a.addOrUpdatePathRecursive(root, normalizedChangedPath)
		hasChanges = true
	}
	a.logRescanEvent("applyIncrementalLibraryChanges path processing took %.2fms for %d paths",
		time.Since(processStartTime).Seconds()*1000, len(changedPaths))

	if !hasChanges {
		return LibraryScanResult{}, false
	}

	// Avoid expensive full snapshot rebuild for incremental changes.
	// Just update the counts in the cached snapshot without re-sorting all files.
	// The file arrays are still valid (items may have been added/removed from the maps,
	// but the snapshot lists are consistent for the event emission).
	updateStartTime := time.Now()
	a.libraryScan.TrackCount = len(a.trackByPath)
	a.libraryScan.TextFileCount = len(a.textByPath)
	a.libraryScan.ImageFileCount = len(a.imageByPath)
	a.libraryScan.TotalEntries = a.libraryScan.TrackCount + a.libraryScan.TextFileCount + a.libraryScan.ImageFileCount
	a.markLibraryDerivedIndexDirtyLocked()
	a.maybeStartLibraryDerivedIndexRebuildLocked()
	a.notifyMusicBrainzTagWorker()

	// Emit only the lightweight metadata — the frontend no longer uses the file arrays
	// for incremental updates, and serializing 150K+ entries over IPC takes several seconds.
	notification := LibraryScanResult{
		RootPath:       a.libraryScan.RootPath,
		RootName:       a.libraryScan.RootName,
		TotalEntries:   a.libraryScan.TotalEntries,
		TrackCount:     a.libraryScan.TrackCount,
		TextFileCount:  a.libraryScan.TextFileCount,
		ImageFileCount: a.libraryScan.ImageFileCount,
		Truncated:      a.libraryScan.Truncated,
		EntryLimit:     a.libraryScan.EntryLimit,
	}
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

func addLibraryWatchesFromDiscoveredDirectories(watcher *fsnotify.Watcher, directoryPaths []string, onProgress func()) {
	for _, directoryPath := range directoryPaths {
		if strings.TrimSpace(directoryPath) == "" {
			continue
		}

		_ = watcher.Add(directoryPath)
		if onProgress != nil {
			onProgress()
		}
	}
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
	if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
		return
	}

	a.watchMu.Lock()
	if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
		a.watchMu.Unlock()
		return
	}

	watcher := a.libraryWatcher
	stopCh := a.watchStop
	a.libraryWatcher = nil
	a.watchStop = nil
	a.watchMu.Unlock()

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

	if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
		return false
	}

	a.logRescanEvent("Starting library watcher for %d directories", len(watchablePaths))

	watcher, watcherErr := fsnotify.NewWatcher()
	if watcherErr != nil {
		a.logRescanEvent("Failed to create filesystem watcher: %v", watcherErr)
		return false
	}

	if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
		_ = watcher.Close()
		return false
	}

	a.logRescanEvent("Watcher created, registering all directories")
	if len(directoryPaths) > 0 {
		addLibraryWatchesFromDiscoveredDirectories(watcher, watchablePaths, onProgress)
	} else {
		for _, rootPath := range watchablePaths {
			if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
				_ = watcher.Close()
				return false
			}

			addLibraryWatchesRecursive(watcher, rootPath, onProgress)
		}
	}

	if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
		_ = watcher.Close()
		return false
	}

	a.logRescanEvent("Watcher ready, listening for changes")
	stopCh := make(chan struct{})

	a.watchMu.Lock()
	if generation > 0 && a.libraryWatcherGeneration.Load() != generation {
		a.watchMu.Unlock()
		_ = watcher.Close()
		return false
	}

	previousWatcher := a.libraryWatcher
	previousStopCh := a.watchStop
	a.libraryWatcher = watcher
	a.watchStop = stopCh
	a.watchMu.Unlock()

	if previousStopCh != nil {
		close(previousStopCh)
	}
	if previousWatcher != nil {
		_ = previousWatcher.Close()
	}

	go func(activeWatcher *fsnotify.Watcher, activeStopCh chan struct{}) {
		defer func() {
			_ = activeWatcher.Close()
		}()

		const debounceDuration = 500 * time.Millisecond
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

			case event, ok := <-activeWatcher.Events:
				if !ok {
					if timer != nil {
						timer.Stop()
					}
					return
				}

				if event.Op&fsnotify.Create != 0 {
					if info, statErr := os.Stat(event.Name); statErr == nil && info.IsDir() {
						addLibraryWatchesRecursive(activeWatcher, event.Name, nil)
					}
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
				if changed && a.ctx != nil {
					emitStartTime := time.Now()
					a.logRescanEvent("EventsEmit START: sending scan update event")
					runtimeEventsEmit(a.ctx, libraryScanUpdatedEvent, scan)
					a.logRescanEvent("EventsEmit END: took %.2fms", time.Since(emitStartTime).Seconds()*1000)
				}

			case _, ok := <-activeWatcher.Errors:
				if !ok {
					if timer != nil {
						timer.Stop()
					}
					return
				}
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

	generation := a.libraryWatcherGeneration.Add(1)
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
	generation := a.libraryWatcherGeneration.Add(1)
	a.logRescanEvent("Scheduling asynchronous library watcher startup for %d roots", len(rootsCopy))

	go func(activeRoots []libraryRootConfig, activeDirectoryPaths []string, activeGeneration uint64) {
		startedAt := time.Now()
		started := a.startLibraryWatcherReserved(activeRoots, activeDirectoryPaths, nil, activeGeneration)
		if !started {
			if a.libraryWatcherGeneration.Load() != activeGeneration {
				a.logRescanEvent("Asynchronous library watcher startup canceled as stale")
				return
			}

			a.logRescanEvent("Asynchronous library watcher startup skipped: %s", fmt.Sprintf("validRoots=%d", len(collectWatchableLibraryRootPaths(activeRoots))))
			return
		}

		watcherMs := float64(time.Since(startedAt).Milliseconds())
		if watcherMs > 0 {
			a.indexMu.Lock()
			if a.scanWatcherMs <= 0 {
				a.scanWatcherMs = watcherMs
			} else {
				a.scanWatcherMs = (a.scanWatcherMs * 0.72) + (watcherMs * 0.28)
			}
			a.indexMu.Unlock()
		}

		a.logRescanEvent("Asynchronous library watcher startup END: took %.2fms", watcherMs)
	}(rootsCopy, directoryPathsCopy, generation)
}

func (a *App) stopLibraryWatcher() {
	generation := a.libraryWatcherGeneration.Add(1)
	a.stopLibraryWatcherReserved(generation)
}
