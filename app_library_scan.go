package main

import (
	"io/fs"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func cloneImmediateChildCountByFolder(input map[string]int) map[string]int {
	cloned := make(map[string]int, len(input))
	for key, value := range input {
		cloned[key] = value
	}

	return cloned
}

func (a *App) scanLibraryFolder(path string, restartWatcher bool) LibraryScanResult {
	scanOverallStartedAt := time.Now()
	cleanRoot := normalizePath(path)
	result := LibraryScanResult{
		RootPath:          cleanRoot,
		RootName:          filepath.Base(cleanRoot),
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		ImageFiles:        []LibraryIndexedFile{},
		CoverPathByFolder: map[string]string{},
		EntryLimit:        0,
	}

	if cleanRoot == "" {
		return result
	}

	absoluteRoot, err := filepath.Abs(cleanRoot)
	if err != nil {
		return result
	}

	cleanRoot = filepath.Clean(absoluteRoot)
	result.RootPath = cleanRoot
	result.RootName = filepath.Base(cleanRoot)
	a.logRescanEvent("scanLibraryFolder START: root=%s restartWatcher=%t", cleanRoot, restartWatcher)

	if restartWatcher {
		a.stopLibraryWatcher()
	}

	totalEntries := 0
	remainingImmediateChildrenByFolder := make(map[string]int)
	preCountStartedAt := time.Now()
	_ = filepath.WalkDir(cleanRoot, func(currentPath string, _ fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if currentPath == cleanRoot {
			return nil
		}

		totalEntries++
		folderPath, _, ok := folderAndRelative(cleanRoot, currentPath)
		if ok {
			remainingImmediateChildrenByFolder[folderPath] = remainingImmediateChildrenByFolder[folderPath] + 1
		}
		return nil
	})
	a.logRescanEvent(
		"scanLibraryFolder pre-count END: totalEntries=%d folders=%d took %.2fms",
		totalEntries,
		len(remainingImmediateChildrenByFolder),
		time.Since(preCountStartedAt).Seconds()*1000,
	)

	scanStartedAt := time.Now()
	lastProgressEmit := time.Time{}
	lastScanUpdatedEmit := time.Time{}
	scannedEntries := 0
	finalizationStartedAt := time.Time{}
	finalizationBudgetMs := 0.0

	a.indexMu.Lock()
	learnedFinalizeMs := a.scanFinalizeMs
	learnedWatcherMs := a.scanWatcherMs
	a.libraryRoot = cleanRoot
	a.trackByPath = make(map[string]LibraryIndexedFile)
	a.textByPath = make(map[string]LibraryIndexedFile)
	a.imageByPath = make(map[string]LibraryIndexedFile)
	a.markLibraryDerivedIndexDirtyLocked()
	a.scanInProgress = true
	a.scanRemainingImmediateChildrenByFolder = cloneImmediateChildCountByFolder(remainingImmediateChildrenByFolder)
	a.libraryScan = LibraryScanResult{
		RootPath:          cleanRoot,
		RootName:          result.RootName,
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		ImageFiles:        []LibraryIndexedFile{},
		CoverPathByFolder: map[string]string{},
		EntryLimit:        0,
	}
	a.indexMu.Unlock()
	defer func() {
		a.indexMu.Lock()
		a.scanInProgress = false
		a.scanRemainingImmediateChildrenByFolder = nil
		a.maybeStartLibraryDerivedIndexRebuildLocked()
		a.indexMu.Unlock()
	}()

	estimateFinalizationBudgetMs := func(elapsed time.Duration, entriesDone int) float64 {
		watcherBudget := learnedWatcherMs
		if restartWatcher && watcherBudget <= 0 {
			watcherBudget = 8000
		} else if !restartWatcher {
			watcherBudget = 0
		}

		if learnedFinalizeMs > 0 {
			return learnedFinalizeMs + watcherBudget
		}

		if totalEntries <= 0 {
			return 4000 + watcherBudget
		}

		if entriesDone <= 0 {
			entriesDone = 1
		}

		progress := float64(entriesDone) / float64(totalEntries)
		if progress < 0.02 {
			progress = 0.02
		}

		estimatedScanTotalMs := float64(elapsed.Milliseconds()) / progress
		fallback := estimatedScanTotalMs * 0.22
		if fallback < 4000 {
			fallback = 4000
		}
		if fallback > 180000 {
			fallback = 180000
		}

		return fallback + watcherBudget
	}

	emitProgress := func(force bool, phase string) {
		if a.ctx == nil || totalEntries <= 0 {
			return
		}

		now := time.Now()
		if !force {
			if !lastProgressEmit.IsZero() && now.Sub(lastProgressEmit) < 120*time.Millisecond {
				return
			}
		}

		elapsed := now.Sub(scanStartedAt)
		etaSeconds := 0
		if phase == "scanning" {
			remainingScanSeconds := 0.0
			if scannedEntries < totalEntries {
				elapsedSeconds := elapsed.Seconds()
				if elapsedSeconds > 0 && scannedEntries > 0 {
					rate := float64(scannedEntries) / elapsedSeconds
					if rate > 0 {
						remainingEntries := totalEntries - scannedEntries
						remainingScanSeconds = float64(remainingEntries) / rate
					}
				}
			}

			remainingFinalizeSeconds := estimateFinalizationBudgetMs(elapsed, scannedEntries) / 1000
			etaSeconds = int(math.Ceil(remainingScanSeconds + remainingFinalizeSeconds))
		} else if phase == "finalizing" {
			if finalizationBudgetMs <= 0 {
				finalizationBudgetMs = estimateFinalizationBudgetMs(elapsed, scannedEntries)
			}

			elapsedFinalizationMs := 0.0
			if !finalizationStartedAt.IsZero() {
				elapsedFinalizationMs = float64(now.Sub(finalizationStartedAt).Milliseconds())
			}

			remainingMs := finalizationBudgetMs - elapsedFinalizationMs
			if remainingMs < 0 {
				remainingMs = 0
			}

			etaSeconds = int(math.Ceil(remainingMs / 1000))
		}

		runtime.EventsEmit(a.ctx, libraryScanProgressEvent, LibraryScanProgress{
			RootPath:       cleanRoot,
			EntriesScanned: scannedEntries,
			TotalEntries:   totalEntries,
			ElapsedMs:      elapsed.Milliseconds(),
			EtaSeconds:     etaSeconds,
			Phase:          phase,
		})
		lastProgressEmit = now
	}

	emitScanUpdated := func(force bool) {
		if a.ctx == nil {
			return
		}

		now := time.Now()
		if !force {
			if !lastScanUpdatedEmit.IsZero() && now.Sub(lastScanUpdatedEmit) < 180*time.Millisecond {
				return
			}
		}

		a.indexMu.Lock()
		payload := LibraryScanResult{
			RootPath:       a.libraryScan.RootPath,
			RootName:       a.libraryScan.RootName,
			TotalEntries:   a.libraryScan.TotalEntries,
			TrackCount:     a.libraryScan.TrackCount,
			TextFileCount:  a.libraryScan.TextFileCount,
			ImageFileCount: a.libraryScan.ImageFileCount,
			Truncated:      a.libraryScan.Truncated,
			EntryLimit:     a.libraryScan.EntryLimit,
		}
		a.indexMu.Unlock()

		runtime.EventsEmit(a.ctx, libraryScanUpdatedEvent, payload)
		lastScanUpdatedEmit = now
	}

	emitProgress(true, "scanning")
	emitScanUpdated(true)

	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)

	indexWalkStartedAt := time.Now()
	scanErr := filepath.WalkDir(cleanRoot, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if currentPath == cleanRoot {
			return nil
		}

		result.TotalEntries++
		scannedEntries++
		emitProgress(false, "scanning")

		folderPath, relativePath, ok := folderAndRelative(cleanRoot, currentPath)
		if ok {
			a.indexMu.Lock()
			if remainingChildren, exists := a.scanRemainingImmediateChildrenByFolder[folderPath]; exists {
				remainingChildren--
				if remainingChildren <= 0 {
					delete(a.scanRemainingImmediateChildrenByFolder, folderPath)
				} else {
					a.scanRemainingImmediateChildrenByFolder[folderPath] = remainingChildren
				}
			}
			a.indexMu.Unlock()
		}

		if entry.IsDir() {
			return nil
		}

		if !ok {
			return nil
		}

		indexed := LibraryIndexedFile{
			Name:         entry.Name(),
			Path:         currentPath,
			RelativePath: relativePath,
			FolderPath:   folderPath,
		}

		kind := ""
		coverFolderKey := ""
		coverPath := ""

		switch {
		case isAudioPath(currentPath):
			result.TrackFiles = append(result.TrackFiles, indexed)
			kind = "track"
		case isTextPath(currentPath):
			result.TextFiles = append(result.TextFiles, indexed)
			kind = "text-file"
		case isImagePath(currentPath):
			result.ImageFiles = append(result.ImageFiles, indexed)
			kind = "image-file"

			if !isJpegPath(currentPath) {
				break
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
				coverFolderKey = folderKey
				coverPath = currentPath
			}
		}

		if kind == "" {
			return nil
		}

		a.indexMu.Lock()
		switch kind {
		case "track":
			a.trackByPath[currentPath] = indexed
		case "text-file":
			a.textByPath[currentPath] = indexed
		case "image-file":
			a.imageByPath[currentPath] = indexed
		}
		if coverFolderKey != "" {
			a.libraryScan.CoverPathByFolder[coverFolderKey] = coverPath
		}
		a.libraryScan.TrackCount = len(a.trackByPath)
		a.libraryScan.TextFileCount = len(a.textByPath)
		a.libraryScan.ImageFileCount = len(a.imageByPath)
		a.libraryScan.TotalEntries = a.libraryScan.TrackCount + a.libraryScan.TextFileCount + a.libraryScan.ImageFileCount
		a.indexMu.Unlock()

		emitScanUpdated(false)

		return nil
	})
	a.logRescanEvent(
		"scanLibraryFolder index walk END: scannedEntries=%d took %.2fms",
		scannedEntries,
		time.Since(indexWalkStartedAt).Seconds()*1000,
	)

	if scanErr != nil {
		result.TrackCount = len(result.TrackFiles)
		result.TextFileCount = len(result.TextFiles)
		result.ImageFileCount = len(result.ImageFiles)
		a.logRescanEvent(
			"scanLibraryFolder END (walk error): tracks=%d text=%d images=%d took %.2fms",
			result.TrackCount,
			result.TextFileCount,
			result.ImageFileCount,
			time.Since(scanOverallStartedAt).Seconds()*1000,
		)
		finalizationStartedAt = time.Now()
		finalizationBudgetMs = estimateFinalizationBudgetMs(finalizationStartedAt.Sub(scanStartedAt), scannedEntries)
		emitProgress(true, "finalizing")
		emitScanUpdated(true)
		return result
	}

	scannedEntries = totalEntries
	finalizationStartedAt = time.Now()
	finalizationBudgetMs = estimateFinalizationBudgetMs(finalizationStartedAt.Sub(scanStartedAt), scannedEntries)
	emitProgress(true, "finalizing")

	trackSortStartedAt := time.Now()
	sort.SliceStable(result.TrackFiles, func(i int, j int) bool {
		left := strings.ToLower(result.TrackFiles[i].RelativePath)
		right := strings.ToLower(result.TrackFiles[j].RelativePath)
		return left < right
	})
	trackSortMs := time.Since(trackSortStartedAt).Seconds() * 1000

	textSortStartedAt := time.Now()
	sort.SliceStable(result.TextFiles, func(i int, j int) bool {
		left := strings.ToLower(result.TextFiles[i].RelativePath)
		right := strings.ToLower(result.TextFiles[j].RelativePath)
		return left < right
	})
	textSortMs := time.Since(textSortStartedAt).Seconds() * 1000

	imageSortStartedAt := time.Now()
	sort.SliceStable(result.ImageFiles, func(i int, j int) bool {
		left := strings.ToLower(result.ImageFiles[i].RelativePath)
		right := strings.ToLower(result.ImageFiles[j].RelativePath)
		return left < right
	})
	imageSortMs := time.Since(imageSortStartedAt).Seconds() * 1000
	a.logRescanEvent(
		"scanLibraryFolder sort END: tracks=%.2fms text=%.2fms images=%.2fms",
		trackSortMs,
		textSortMs,
		imageSortMs,
	)

	result.TrackCount = len(result.TrackFiles)
	result.TextFileCount = len(result.TextFiles)
	result.ImageFileCount = len(result.ImageFiles)

	a.libraryRoot = cleanRoot
	a.setLibraryIndexFromScan(result)
	emitScanUpdated(true)

	sortIndexMs := float64(time.Since(finalizationStartedAt).Milliseconds())

	if restartWatcher {
		a.indexMu.Lock()
		firstWatcherLearning := a.scanWatcherMs <= 0
		a.indexMu.Unlock()

		if sortIndexMs > 0 {
			a.indexMu.Lock()
			// If scanWatcherMs has never been learned, scanFinalizeMs was measured under old
			// code which included watcher registration time. Reset it to avoid double-counting.
			if a.scanFinalizeMs <= 0 || firstWatcherLearning {
				a.scanFinalizeMs = sortIndexMs
			} else {
				a.scanFinalizeMs = (a.scanFinalizeMs * 0.72) + (sortIndexMs * 0.28)
			}
			a.indexMu.Unlock()
		}

		watcherStartedAt := time.Now()
		a.startLibraryWatcher(cleanRoot, func() { emitProgress(false, "finalizing") })
		watcherMs := float64(time.Since(watcherStartedAt).Milliseconds())
		if watcherMs > 0 {
			a.indexMu.Lock()
			if a.scanWatcherMs <= 0 {
				a.scanWatcherMs = watcherMs
			} else {
				a.scanWatcherMs = (a.scanWatcherMs * 0.72) + (watcherMs * 0.28)
			}
			a.indexMu.Unlock()
		}
	} else if sortIndexMs > 0 {
		a.indexMu.Lock()
		if a.scanFinalizeMs <= 0 {
			a.scanFinalizeMs = sortIndexMs
		} else {
			a.scanFinalizeMs = (a.scanFinalizeMs * 0.72) + (sortIndexMs * 0.28)
		}
		a.indexMu.Unlock()
	}

	response := result
	response.TrackFiles = []LibraryIndexedFile{}
	response.TextFiles = []LibraryIndexedFile{}
	response.ImageFiles = []LibraryIndexedFile{}
	a.logRescanEvent(
		"scanLibraryFolder END: totalEntries=%d tracks=%d text=%d images=%d took %.2fms",
		result.TotalEntries,
		result.TrackCount,
		result.TextFileCount,
		result.ImageFileCount,
		time.Since(scanOverallStartedAt).Seconds()*1000,
	)
	return response
}

// ScanLibraryFolder indexes audio, text, and image files under the selected root folder.
func (a *App) ScanLibraryFolder(path string) LibraryScanResult {
	return a.scanLibraryFolder(path, true)
}

func cloneCoverPathByFolder(input map[string]string) map[string]string {
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}

	return cloned
}

func (a *App) setLibraryIndexFromScan(scan LibraryScanResult) {
	setStartTime := time.Now()
	a.logRescanEvent("setLibraryIndexFromScan START: %d tracks, %d text, %d images",
		len(scan.TrackFiles), len(scan.TextFiles), len(scan.ImageFiles))

	lockWaitStart := time.Now()
	a.indexMu.Lock()
	a.logRescanEvent("  - setLibraryIndexFromScan acquired lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer a.indexMu.Unlock()

	mapStartTime := time.Now()
	a.trackByPath = make(map[string]LibraryIndexedFile, len(scan.TrackFiles))
	a.textByPath = make(map[string]LibraryIndexedFile, len(scan.TextFiles))
	a.imageByPath = make(map[string]LibraryIndexedFile, len(scan.ImageFiles))

	for _, entry := range scan.TrackFiles {
		a.trackByPath[entry.Path] = entry
	}
	for _, entry := range scan.TextFiles {
		a.textByPath[entry.Path] = entry
	}
	for _, entry := range scan.ImageFiles {
		a.imageByPath[entry.Path] = entry
	}
	a.logRescanEvent("  - indexed maps populated (%.2fms)", time.Since(mapStartTime).Seconds()*1000)

	copyCoverStartTime := time.Now()
	a.libraryScan = scan
	a.libraryScan.CoverPathByFolder = cloneCoverPathByFolder(scan.CoverPathByFolder)
	a.markLibraryDerivedIndexDirtyLocked()
	a.logRescanEvent("  - cover paths copied (%.2fms)", time.Since(copyCoverStartTime).Seconds()*1000)
	a.logRescanEvent("setLibraryIndexFromScan END: total time %.2fms", time.Since(setStartTime).Seconds()*1000)
}
