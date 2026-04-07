package main

import (
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func addDiscoveredChildFolder(discoveredByParent map[string]map[string]struct{}, parentPath string, childPath string) bool {
	if strings.TrimSpace(childPath) == "" {
		return false
	}

	childSet := discoveredByParent[parentPath]
	if childSet == nil {
		childSet = make(map[string]struct{})
		discoveredByParent[parentPath] = childSet
	}

	if _, exists := childSet[childPath]; exists {
		return false
	}

	childSet[childPath] = struct{}{}
	return true
}

func aggregateLibraryScanRootInfo(roots []libraryRootConfig) (string, string) {
	if len(roots) == 0 {
		return "", ""
	}

	if len(roots) == 1 {
		return roots[0].Path, roots[0].Name
	}

	return "", "Selected folders"
}

func (a *App) scanLibraryFolder(path string, restartWatcher bool) LibraryScanResult {
	return a.scanLibraryFolders(normalizeLibraryFolders([]AppLibraryFolder{{Path: path}}, "", 0), restartWatcher)
}

func (a *App) scanLibraryFolders(folders []AppLibraryFolder, restartWatcher bool) LibraryScanResult {
	scanOverallStartedAt := time.Now()
	roots := resolveLibraryRootConfigs(normalizeLibraryFolders(folders, "", 0))
	rootPath, rootName := aggregateLibraryScanRootInfo(roots)
	result := LibraryScanResult{
		RootPath:          rootPath,
		RootName:          rootName,
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		ImageFiles:        []LibraryIndexedFile{},
		CoverPathByFolder: map[string]string{},
		EntryLimit:        0,
	}

	if len(roots) == 0 {
		if restartWatcher {
			a.stopLibraryWatcher()
		}
		a.indexMu.Lock()
		a.activeLibraryRoots = nil
		a.indexMu.Unlock()
		a.setLibraryIndexFromScan(result)
		a.notifyMusicBrainzTagWorker()
		return result
	}

	a.logRescanEvent("scanLibraryFolders START: roots=%d restartWatcher=%t", len(roots), restartWatcher)

	if restartWatcher {
		a.stopLibraryWatcher()
	}

	a.indexMu.Lock()
	learnedScanEntryMs := a.scanEntryMs
	learnedFinalizeMs := a.scanFinalizeMs
	learnedWatcherMs := a.scanWatcherMs
	learnedTotalEntries := a.scanLastTotalEntries
	a.indexMu.Unlock()

	totalEntries := 0
	listedDirectories := 0
	pendingDirectories := len(roots)

	setupStartedAt := time.Now()

	scanStartedAt := time.Time{}
	lastProgressEmit := time.Time{}
	lastScanUpdatedEmit := time.Time{}
	scannedEntries := 0
	finalizationStartedAt := time.Time{}
	finalizationBudgetMs := 0.0

	a.indexMu.Lock()
	a.activeLibraryRoots = append([]libraryRootConfig(nil), roots...)
	a.trackByPath = make(map[string]LibraryIndexedFile)
	a.textByPath = make(map[string]LibraryIndexedFile)
	a.imageByPath = make(map[string]LibraryIndexedFile)
	a.markLibraryDerivedIndexDirtyLocked()
	a.scanInProgress = true
	a.scanRemainingImmediateChildrenByFolder = make(map[string]int, len(roots))
	a.scanDiscoveredChildFoldersByParent = make(map[string]map[string]struct{}, len(roots)+1)
	for _, root := range roots {
		addDiscoveredChildFolder(a.scanDiscoveredChildFoldersByParent, "", root.Name)
		a.scanRemainingImmediateChildrenByFolder[root.Name] = 1
	}
	a.libraryScan = LibraryScanResult{
		RootPath:          result.RootPath,
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
		a.scanDiscoveredChildFoldersByParent = nil
		a.maybeStartLibraryDerivedIndexRebuildLocked()
		a.indexMu.Unlock()
	}()

	setupElapsedMs := float64(time.Since(setupStartedAt).Milliseconds())
	if setupElapsedMs <= 0 {
		setupElapsedMs = 1
	}
	a.indexMu.Lock()
	if a.scanPreCountMs <= 0 {
		a.scanPreCountMs = setupElapsedMs
	} else {
		a.scanPreCountMs = (a.scanPreCountMs * 0.72) + (setupElapsedMs * 0.28)
	}
	a.indexMu.Unlock()
	a.logRescanEvent(
		"scanLibraryFolders setup END: roots=%d took %.2fms",
		len(roots),
		setupElapsedMs,
	)
	scanStartedAt = time.Now()

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

	estimateTotalEntriesForProgress := func() int {
		estimatedTotalEntries := totalEntries
		if listedDirectories > 0 && pendingDirectories > 0 {
			averageEntriesPerDirectory := float64(totalEntries) / float64(listedDirectories)
			estimatedTotalEntries += int(math.Ceil(averageEntriesPerDirectory * float64(pendingDirectories)))
		}

		if learnedTotalEntries > estimatedTotalEntries && scannedEntries < learnedTotalEntries {
			estimatedTotalEntries = learnedTotalEntries
		}

		if estimatedTotalEntries < scannedEntries {
			estimatedTotalEntries = scannedEntries
		}

		return estimatedTotalEntries
	}

	estimateRemainingScanSeconds := func(elapsed time.Duration) float64 {
		if scannedEntries <= 0 {
			if learnedScanEntryMs > 0 && learnedTotalEntries > 0 {
				return (learnedScanEntryMs * float64(learnedTotalEntries)) / 1000
			}

			return 0
		}

		estimatedTotalEntries := estimateTotalEntriesForProgress()
		if scannedEntries >= estimatedTotalEntries && pendingDirectories <= 0 {
			return 0
		}

		elapsedSeconds := elapsed.Seconds()
		if elapsedSeconds <= 0 {
			return 0
		}

		globalRate := float64(scannedEntries) / elapsedSeconds
		historicalRate := 0.0
		if learnedScanEntryMs > 0 {
			historicalRate = 1000 / learnedScanEntryMs
		}

		rate := globalRate
		if historicalRate > 0 && rate > 0 {
			rate = (rate * 0.7) + (historicalRate * 0.3)
		} else if rate <= 0 {
			rate = historicalRate
		}
		if rate <= 0 {
			return 0
		}

		remainingEntries := estimatedTotalEntries - scannedEntries
		if remainingEntries <= 0 && pendingDirectories > 0 {
			remainingEntries = 1
		}

		return float64(remainingEntries) / rate
	}

	emitProgress := func(force bool, phase string) {
		if a.ctx == nil {
			return
		}

		now := time.Now()
		if !force && !lastProgressEmit.IsZero() && now.Sub(lastProgressEmit) < 120*time.Millisecond {
			return
		}

		elapsed := now.Sub(scanStartedAt)
		etaSeconds := 0
		progressTotalEntries := totalEntries
		if phase == "scanning" {
			remainingScanSeconds := estimateRemainingScanSeconds(elapsed)
			remainingFinalizeSeconds := estimateFinalizationBudgetMs(elapsed, scannedEntries) / 1000
			etaSeconds = int(math.Ceil(remainingScanSeconds + remainingFinalizeSeconds))
			progressTotalEntries = estimateTotalEntriesForProgress()
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

		runtimeEventsEmit(a.ctx, libraryScanProgressEvent, LibraryScanProgress{
			RootPath:       result.RootPath,
			EntriesScanned: scannedEntries,
			TotalEntries:   progressTotalEntries,
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
		if !force && !lastScanUpdatedEmit.IsZero() && now.Sub(lastScanUpdatedEmit) < 180*time.Millisecond {
			return
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

		runtimeEventsEmit(a.ctx, libraryScanUpdatedEvent, payload)
		lastScanUpdatedEmit = now
	}

	emitProgress(true, "scanning")
	emitScanUpdated(true)

	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)

	indexWalkStartedAt := time.Now()
	var scanErr error
	var scanDirectory func(root libraryRootConfig, absolutePath string, folderPath string)
	scanDirectory = func(root libraryRootConfig, absolutePath string, folderPath string) {
		pendingDirectories--

		entries, err := os.ReadDir(absolutePath)
		if err != nil {
			a.indexMu.Lock()
			delete(a.scanRemainingImmediateChildrenByFolder, folderPath)
			a.indexMu.Unlock()
			emitScanUpdated(false)
			if scanErr == nil {
				scanErr = err
			}
			return
		}

		listedDirectories++
		totalEntries += len(entries)

		discoveredFoldersChanged := false
		a.indexMu.Lock()
		if _, exists := a.scanRemainingImmediateChildrenByFolder[folderPath]; exists {
			delete(a.scanRemainingImmediateChildrenByFolder, folderPath)
			discoveredFoldersChanged = true
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}

			childPath := filepath.Join(absolutePath, entry.Name())
			_, relativePath, ok := folderAndRelativeForLibraryRoot(root, childPath)
			if !ok {
				continue
			}

			if addDiscoveredChildFolder(a.scanDiscoveredChildFoldersByParent, folderPath, relativePath) {
				discoveredFoldersChanged = true
			}
			if _, exists := a.scanRemainingImmediateChildrenByFolder[relativePath]; !exists {
				a.scanRemainingImmediateChildrenByFolder[relativePath] = 1
				discoveredFoldersChanged = true
			}
			pendingDirectories++
		}
		a.indexMu.Unlock()

		emitProgress(false, "scanning")
		if discoveredFoldersChanged {
			emitScanUpdated(false)
		}

		for _, entry := range entries {
			currentPath := filepath.Join(absolutePath, entry.Name())
			result.TotalEntries++
			scannedEntries++
			emitProgress(false, "scanning")

			folderPathForEntry, relativePath, ok := folderAndRelativeForLibraryRoot(root, currentPath)
			if !ok {
				continue
			}

			if entry.IsDir() {
				scanDirectory(root, currentPath, relativePath)
				continue
			}

			indexed := LibraryIndexedFile{
				Name:         entry.Name(),
				Path:         currentPath,
				RelativePath: relativePath,
				FolderPath:   folderPathForEntry,
				RootPath:     root.Path,
				RootName:     root.Name,
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

				if !isPreferredCoverImagePath(currentPath) {
					break
				}

				folderKey := strings.ToLower(folderPathForEntry)
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
				continue
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
		}
	}
	for _, root := range roots {
		scanDirectory(root, root.Path, root.Name)
	}
	a.logRescanEvent(
		"scanLibraryFolders walk END: scannedEntries=%d discoveredEntries=%d directories=%d took %.2fms",
		scannedEntries,
		totalEntries,
		listedDirectories,
		time.Since(indexWalkStartedAt).Seconds()*1000,
	)

	a.indexMu.Lock()
	a.scanLastTotalEntries = result.TotalEntries
	a.indexMu.Unlock()

	if scanErr != nil {
		result.TrackCount = len(result.TrackFiles)
		result.TextFileCount = len(result.TextFiles)
		result.ImageFileCount = len(result.ImageFiles)
		a.logRescanEvent(
			"scanLibraryFolders END (walk error): tracks=%d text=%d images=%d took %.2fms",
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

	scannedEntries = result.TotalEntries
	finalizationStartedAt = time.Now()
	scanDurationMs := float64(finalizationStartedAt.Sub(scanStartedAt).Milliseconds())
	if scanDurationMs > 0 && result.TotalEntries > 0 {
		measuredScanEntryMs := scanDurationMs / float64(result.TotalEntries)
		a.indexMu.Lock()
		if a.scanEntryMs <= 0 {
			a.scanEntryMs = measuredScanEntryMs
		} else {
			a.scanEntryMs = (a.scanEntryMs * 0.72) + (measuredScanEntryMs * 0.28)
		}
		a.indexMu.Unlock()
	}
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
		"scanLibraryFolders sort END: tracks=%.2fms text=%.2fms images=%.2fms",
		trackSortMs,
		textSortMs,
		imageSortMs,
	)

	result.TrackCount = len(result.TrackFiles)
	result.TextFileCount = len(result.TextFiles)
	result.ImageFileCount = len(result.ImageFiles)

	a.setLibraryIndexFromScan(result)
	a.notifyMusicBrainzTagWorker()
	emitScanUpdated(true)

	sortIndexMs := float64(time.Since(finalizationStartedAt).Milliseconds())

	if restartWatcher {
		a.indexMu.Lock()
		firstWatcherLearning := a.scanWatcherMs <= 0
		a.indexMu.Unlock()

		if sortIndexMs > 0 {
			a.indexMu.Lock()
			if a.scanFinalizeMs <= 0 || firstWatcherLearning {
				a.scanFinalizeMs = sortIndexMs
			} else {
				a.scanFinalizeMs = (a.scanFinalizeMs * 0.72) + (sortIndexMs * 0.28)
			}
			a.indexMu.Unlock()
		}

		watcherStartedAt := time.Now()
		a.startLibraryWatcher(roots, func() { emitProgress(false, "finalizing") })
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
		"scanLibraryFolders END: totalEntries=%d tracks=%d text=%d images=%d took %.2fms",
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

// ScanConfiguredLibraryFolders indexes all configured library folders from settings as one aggregated library.
func (a *App) ScanConfiguredLibraryFolders() LibraryScanResult {
	a.ensureSettingsLoaded()
	return a.scanLibraryFolders(a.settings.LibraryFolders, true)
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
