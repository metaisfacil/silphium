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
	if libraryDeferredHydrationEnabled() {
		return a.scanLibraryFoldersDeferred(folders, restartWatcher)
	}
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	generationState := a.libraryGenerationState()
	runtimeState := a.runtimeState()

	scanOverallStartedAt := time.Now()
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
		contentState.indexMu.Lock()
		contentState.activeLibraryRoots = nil
		contentState.indexMu.Unlock()
		a.setLibraryIndexFromScan(result, scanGeneration)
		a.notifyMusicBrainzTagWorker()
		return result
	}

	a.logRescanEvent("scanLibraryFolders START: roots=%d restartWatcher=%t", len(roots), restartWatcher)

	if restartWatcher {
		a.stopLibraryWatcher()
	}

	contentState.indexMu.Lock()
	learnedScanEntryMs := scanState.scanEntryMs
	learnedFinalizeMs := scanState.scanFinalizeMs
	learnedWatcherMs := scanState.scanWatcherMs
	learnedTotalEntries := scanState.scanLastTotalEntries
	contentState.indexMu.Unlock()
	if learnedFinalizeMs > learnedWatcherMs && learnedWatcherMs > 0 {
		learnedFinalizeMs -= learnedWatcherMs
	}

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

	contentState.indexMu.Lock()
	contentState.activeLibraryRoots = append([]libraryRootConfig(nil), roots...)
	contentState.trackByPath = make(map[string]LibraryIndexedFile)
	contentState.textByPath = make(map[string]LibraryIndexedFile)
	contentState.imageByPath = make(map[string]LibraryIndexedFile)
	a.markLibraryDerivedIndexDirtyLocked()
	scanState.scanInProgress = true
	scanState.scanRemainingImmediateChildrenByFolder = make(map[string]int, len(roots))
	scanState.scanDiscoveredChildFoldersByParent = make(map[string]map[string]struct{}, len(roots)+1)
	for _, root := range roots {
		addDiscoveredChildFolder(scanState.scanDiscoveredChildFoldersByParent, "", root.Name)
		scanState.scanRemainingImmediateChildrenByFolder[root.Name] = 1
	}
	contentState.libraryScan = LibraryScanResult{
		RootPath:          result.RootPath,
		RootName:          result.RootName,
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		ImageFiles:        []LibraryIndexedFile{},
		CoverPathByFolder: map[string]string{},
		EntryLimit:        0,
	}
	contentState.indexMu.Unlock()
	defer func() {
		contentState.indexMu.Lock()
		scanState.scanInProgress = false
		scanState.scanRemainingImmediateChildrenByFolder = nil
		scanState.scanDiscoveredChildFoldersByParent = nil
		a.maybeStartLibraryDerivedIndexRebuildLocked()
		contentState.indexMu.Unlock()
	}()

	setupElapsedMs := float64(time.Since(setupStartedAt).Milliseconds())
	if setupElapsedMs <= 0 {
		setupElapsedMs = 1
	}
	contentState.indexMu.Lock()
	if scanState.scanPreCountMs <= 0 {
		scanState.scanPreCountMs = setupElapsedMs
	} else {
		scanState.scanPreCountMs = (scanState.scanPreCountMs * 0.72) + (setupElapsedMs * 0.28)
	}
	contentState.indexMu.Unlock()
	a.logRescanEvent(
		"scanLibraryFolders setup END: roots=%d took %.2fms",
		len(roots),
		setupElapsedMs,
	)
	scanStartedAt = time.Now()

	estimateFinalizationBudgetMs := func(elapsed time.Duration, entriesDone int) float64 {
		if learnedFinalizeMs > 0 {
			return learnedFinalizeMs
		}

		if totalEntries <= 0 {
			return 4000
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

		return fallback
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
		if isScanCanceled() {
			return
		}

		if runtimeState.ctx == nil {
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

		runtimeEventsEmit(runtimeState.ctx, libraryScanProgressEvent, LibraryScanProgress{
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
		if isScanCanceled() {
			return
		}

		if runtimeState.ctx == nil {
			return
		}

		now := time.Now()
		if !force && !lastScanUpdatedEmit.IsZero() && now.Sub(lastScanUpdatedEmit) < 180*time.Millisecond {
			return
		}

		contentState.indexMu.Lock()
		payload := LibraryScanResult{
			RootPath:       contentState.libraryScan.RootPath,
			RootName:       contentState.libraryScan.RootName,
			TotalEntries:   contentState.libraryScan.TotalEntries,
			TrackCount:     contentState.libraryScan.TrackCount,
			TextFileCount:  contentState.libraryScan.TextFileCount,
			ImageFileCount: contentState.libraryScan.ImageFileCount,
			Truncated:      contentState.libraryScan.Truncated,
			EntryLimit:     contentState.libraryScan.EntryLimit,
		}
		contentState.indexMu.Unlock()

		runtimeEventsEmit(runtimeState.ctx, libraryScanUpdatedEvent, payload)
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
		if isScanCanceled() {
			return
		}

		pendingDirectories--

		entries, err := os.ReadDir(absolutePath)
		if err != nil {
			contentState.indexMu.Lock()
			delete(scanState.scanRemainingImmediateChildrenByFolder, folderPath)
			contentState.indexMu.Unlock()
			emitScanUpdated(false)
			if scanErr == nil {
				scanErr = err
			}
			return
		}
		if isScanCanceled() {
			return
		}

		listedDirectories++
		totalEntries += len(entries)

		discoveredFoldersChanged := false
		contentState.indexMu.Lock()
		if _, exists := scanState.scanRemainingImmediateChildrenByFolder[folderPath]; exists {
			delete(scanState.scanRemainingImmediateChildrenByFolder, folderPath)
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

			if addDiscoveredChildFolder(scanState.scanDiscoveredChildFoldersByParent, folderPath, relativePath) {
				discoveredFoldersChanged = true
			}
			if _, exists := scanState.scanRemainingImmediateChildrenByFolder[relativePath]; !exists {
				scanState.scanRemainingImmediateChildrenByFolder[relativePath] = 1
				discoveredFoldersChanged = true
			}
			pendingDirectories++
		}
		contentState.indexMu.Unlock()

		emitProgress(false, "scanning")
		if discoveredFoldersChanged {
			emitScanUpdated(false)
		}

		for _, entry := range entries {
			if isScanCanceled() {
				return
			}

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

			contentState.indexMu.Lock()
			if isScanCanceled() {
				contentState.indexMu.Unlock()
				return
			}
			switch kind {
			case "track":
				contentState.trackByPath[currentPath] = indexed
			case "text-file":
				contentState.textByPath[currentPath] = indexed
			case "image-file":
				contentState.imageByPath[currentPath] = indexed
			}
			if coverFolderKey != "" {
				contentState.libraryScan.CoverPathByFolder[coverFolderKey] = coverPath
			}
			contentState.libraryScan.TrackCount = len(contentState.trackByPath)
			contentState.libraryScan.TextFileCount = len(contentState.textByPath)
			contentState.libraryScan.ImageFileCount = len(contentState.imageByPath)
			contentState.libraryScan.TotalEntries = contentState.libraryScan.TrackCount + contentState.libraryScan.TextFileCount + contentState.libraryScan.ImageFileCount
			contentState.indexMu.Unlock()

			emitScanUpdated(false)
		}
	}
	for _, root := range roots {
		if isScanCanceled() {
			break
		}

		scanDirectory(root, root.Path, root.Name)
	}
	if isScanCanceled() {
		a.logRescanEvent("scanLibraryFolders CANCELED: roots=%d", len(roots))
		return scanCanceledResponse()
	}
	a.logRescanEvent(
		"scanLibraryFolders walk END: scannedEntries=%d discoveredEntries=%d directories=%d took %.2fms",
		scannedEntries,
		totalEntries,
		listedDirectories,
		time.Since(indexWalkStartedAt).Seconds()*1000,
	)

	contentState.indexMu.Lock()
	scanState.scanLastTotalEntries = result.TotalEntries
	contentState.indexMu.Unlock()

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
	if isScanCanceled() {
		a.logRescanEvent("scanLibraryFolders CANCELED before finalization")
		return scanCanceledResponse()
	}
	scanDurationMs := float64(finalizationStartedAt.Sub(scanStartedAt).Milliseconds())
	if scanDurationMs > 0 && result.TotalEntries > 0 {
		measuredScanEntryMs := scanDurationMs / float64(result.TotalEntries)
		contentState.indexMu.Lock()
		if scanState.scanEntryMs <= 0 {
			scanState.scanEntryMs = measuredScanEntryMs
		} else {
			scanState.scanEntryMs = (scanState.scanEntryMs * 0.72) + (measuredScanEntryMs * 0.28)
		}
		contentState.indexMu.Unlock()
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
	if isScanCanceled() {
		a.logRescanEvent("scanLibraryFolders CANCELED before index commit")
		return scanCanceledResponse()
	}

	if !a.setLibraryIndexFromScan(result, scanGeneration) {
		a.logRescanEvent("scanLibraryFolders CANCELED during index commit")
		return scanCanceledResponse()
	}
	a.notifyMusicBrainzTagWorker()
	emitScanUpdated(true)

	sortIndexMs := float64(time.Since(finalizationStartedAt).Milliseconds())

	if restartWatcher {
		if sortIndexMs > 0 {
			contentState.indexMu.Lock()
			if scanState.scanFinalizeMs <= 0 {
				scanState.scanFinalizeMs = sortIndexMs
			} else {
				scanState.scanFinalizeMs = (scanState.scanFinalizeMs * 0.72) + (sortIndexMs * 0.28)
			}
			contentState.indexMu.Unlock()
		}

		a.startLibraryWatcherAsync(roots)
	} else if sortIndexMs > 0 {
		contentState.indexMu.Lock()
		if scanState.scanFinalizeMs <= 0 {
			scanState.scanFinalizeMs = sortIndexMs
		} else {
			scanState.scanFinalizeMs = (scanState.scanFinalizeMs * 0.72) + (sortIndexMs * 0.28)
		}
		contentState.indexMu.Unlock()
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
	return a.scanLibraryFolders(a.settingsState().settings.LibraryFolders, true)
}

func cloneCoverPathByFolder(input map[string]string) map[string]string {
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}

	return cloned
}

func (a *App) setLibraryIndexFromScan(scan LibraryScanResult, expectedScanGeneration uint64) bool {
	setStartTime := time.Now()
	a.logRescanEvent("setLibraryIndexFromScan START: %d tracks, %d text, %d images",
		len(scan.TrackFiles), len(scan.TextFiles), len(scan.ImageFiles))
	contentState := a.libraryContentState()
	generationState := a.libraryGenerationState()

	lockWaitStart := time.Now()
	contentState.indexMu.Lock()
	a.logRescanEvent("  - setLibraryIndexFromScan acquired lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer contentState.indexMu.Unlock()
	if expectedScanGeneration > 0 && generationState.libraryScanGeneration.Load() != expectedScanGeneration {
		a.logRescanEvent(
			"  - setLibraryIndexFromScan canceled: stale generation expected=%d active=%d",
			expectedScanGeneration,
			generationState.libraryScanGeneration.Load(),
		)
		return false
	}

	mapStartTime := time.Now()
	contentState.trackByPath = make(map[string]LibraryIndexedFile, len(scan.TrackFiles))
	contentState.textByPath = make(map[string]LibraryIndexedFile, len(scan.TextFiles))
	contentState.imageByPath = make(map[string]LibraryIndexedFile, len(scan.ImageFiles))

	for _, entry := range scan.TrackFiles {
		contentState.trackByPath[entry.Path] = entry
	}
	for _, entry := range scan.TextFiles {
		contentState.textByPath[entry.Path] = entry
	}
	for _, entry := range scan.ImageFiles {
		contentState.imageByPath[entry.Path] = entry
	}
	a.logRescanEvent("  - indexed maps populated (%.2fms)", time.Since(mapStartTime).Seconds()*1000)

	copyCoverStartTime := time.Now()
	contentState.libraryScan = scan
	contentState.libraryScan.CoverPathByFolder = cloneCoverPathByFolder(scan.CoverPathByFolder)
	a.markLibraryDerivedIndexDirtyLocked()
	a.logRescanEvent("  - cover paths copied (%.2fms)", time.Since(copyCoverStartTime).Seconds()*1000)
	a.logRescanEvent("setLibraryIndexFromScan END: total time %.2fms", time.Since(setStartTime).Seconds()*1000)
	return true
}
