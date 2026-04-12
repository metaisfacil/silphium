package main

import (
	logpkg "log"
	pathpkg "path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const libraryFilesDatabaseFileName = "silphium.library.files.sqlite3"

type libraryFilesDatabaseSnapshot struct {
	Roots        []libraryRootConfig
	TotalEntries int
	TrackFiles   []LibraryIndexedFile
	TextFiles    []LibraryIndexedFile
	ImageFiles   []LibraryIndexedFile
}

func sortIndexedFilesByRelativePath(entries []LibraryIndexedFile) {
	sort.SliceStable(entries, func(i int, j int) bool {
		return strings.ToLower(entries[i].RelativePath) < strings.ToLower(entries[j].RelativePath)
	})
}

func buildCoverPathByFolderFromImages(imageFiles []LibraryIndexedFile) map[string]string {
	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)
	coverPathByFolder := make(map[string]string)

	for _, indexed := range imageFiles {
		if !isPreferredCoverImagePath(indexed.Path) {
			continue
		}

		folderKey := strings.ToLower(indexed.FolderPath)
		name := strings.ToLower(indexed.Name)
		priority := coverPriority(name)
		currentPriority, hasCurrent := selectedCoverPriority[folderKey]
		currentName := selectedCoverName[folderKey]
		if !hasCurrent || priority < currentPriority || (priority == currentPriority && name < currentName) {
			selectedCoverPriority[folderKey] = priority
			selectedCoverName[folderKey] = name
			coverPathByFolder[folderKey] = indexed.Path
		}
	}

	return coverPathByFolder
}

func (snapshot libraryFilesDatabaseSnapshot) scanResult() LibraryScanResult {
	rootPath, rootName := aggregateLibraryScanRootInfo(snapshot.Roots)
	totalEntries := snapshot.TotalEntries
	indexedEntries := len(snapshot.TrackFiles) + len(snapshot.TextFiles) + len(snapshot.ImageFiles)
	if totalEntries < indexedEntries {
		totalEntries = indexedEntries
	}

	return LibraryScanResult{
		RootPath:          rootPath,
		RootName:          rootName,
		TrackFiles:        append([]LibraryIndexedFile(nil), snapshot.TrackFiles...),
		TextFiles:         append([]LibraryIndexedFile(nil), snapshot.TextFiles...),
		ImageFiles:        append([]LibraryIndexedFile(nil), snapshot.ImageFiles...),
		DeferredFiles:     false,
		CoverPathByFolder: buildCoverPathByFolderFromImages(snapshot.ImageFiles),
		TotalEntries:      totalEntries,
		TrackCount:        len(snapshot.TrackFiles),
		TextFileCount:     len(snapshot.TextFiles),
		ImageFileCount:    len(snapshot.ImageFiles),
	}
}

func (a *App) libraryFilesDatabasePath() string {
	settingsPath := a.ensureSettingsPath()
	return filepath.Join(filepath.Dir(settingsPath), libraryFilesDatabaseFileName)
}

func (a *App) snapshotLibraryFilesDatabaseState() (libraryFilesDatabaseSnapshot, bool) {
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	indexState := a.libraryIndexState()

	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	if scanState.scanInProgress || indexState.libraryFileHydrationPending {
		return libraryFilesDatabaseSnapshot{}, false
	}

	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        append([]libraryRootConfig(nil), contentState.activeLibraryRoots...),
		TotalEntries: contentState.libraryScan.TotalEntries,
		TrackFiles:   make([]LibraryIndexedFile, 0, len(contentState.trackByPath)),
		TextFiles:    make([]LibraryIndexedFile, 0, len(contentState.textByPath)),
		ImageFiles:   make([]LibraryIndexedFile, 0, len(contentState.imageByPath)),
	}

	for _, entry := range contentState.trackByPath {
		snapshot.TrackFiles = append(snapshot.TrackFiles, entry)
	}
	for _, entry := range contentState.textByPath {
		snapshot.TextFiles = append(snapshot.TextFiles, entry)
	}
	for _, entry := range contentState.imageByPath {
		snapshot.ImageFiles = append(snapshot.ImageFiles, entry)
	}

	sortIndexedFilesByRelativePath(snapshot.TrackFiles)
	sortIndexedFilesByRelativePath(snapshot.TextFiles)
	sortIndexedFilesByRelativePath(snapshot.ImageFiles)

	return snapshot, true
}

func (a *App) ensureLibraryFilesDatabaseWorker() chan struct{} {
	databaseState := a.libraryDatabaseState()
	databaseState.mu.Lock()
	defer databaseState.mu.Unlock()

	if databaseState.wakeCh != nil {
		return databaseState.wakeCh
	}

	databaseState.wakeCh = make(chan struct{}, 1)
	databaseState.stopCh = make(chan struct{})
	databaseState.doneCh = make(chan struct{})
	go a.runLibraryFilesDatabaseWorker(databaseState.wakeCh, databaseState.stopCh, databaseState.doneCh)
	return databaseState.wakeCh
}

func (a *App) notifyLibraryFilesDatabaseWorker() {
	wakeCh := a.ensureLibraryFilesDatabaseWorker()
	select {
	case wakeCh <- struct{}{}:
	default:
	}
}

func (a *App) stopLibraryFilesDatabaseWorker() {
	databaseState := a.libraryDatabaseState()
	databaseState.mu.Lock()
	stopCh := databaseState.stopCh
	doneCh := databaseState.doneCh
	databaseState.wakeCh = nil
	databaseState.stopCh = nil
	databaseState.doneCh = nil
	databaseState.mu.Unlock()

	if stopCh == nil || doneCh == nil {
		return
	}

	close(stopCh)
	<-doneCh
}

func (a *App) runLibraryFilesDatabaseWorker(wakeCh <-chan struct{}, stopCh <-chan struct{}, doneCh chan<- struct{}) {
	defer close(doneCh)

	for {
		select {
		case <-stopCh:
			return
		case <-wakeCh:
		}

		for {
			snapshot, ok := a.snapshotLibraryFilesDatabaseState()
			if !ok {
				select {
				case <-stopCh:
					return
				case <-time.After(250 * time.Millisecond):
					continue
				}
			}

			if err := writeLibraryFilesDatabaseSnapshotToSQLite(a.libraryFilesDatabasePath(), snapshot); err != nil {
				logpkg.Printf("failed to persist library files database: %v", err)
			}
			break
		}

		for {
			select {
			case <-stopCh:
				return
			case <-wakeCh:
			default:
				goto nextWake
			}
		}
	nextWake:
	}
}

func indexedFileFromDatabaseRecord(root libraryRootConfig, record libraryFilesDatabaseRecord) (LibraryIndexedFile, bool) {
	relativePath, ok := normalizeLibraryRelativePath(record.RelativePath)
	if !ok || strings.TrimSpace(relativePath) == "" {
		return LibraryIndexedFile{}, false
	}

	name := pathpkg.Base(relativePath)
	folderPath := pathpkg.Dir(relativePath)
	if folderPath == "." {
		folderPath = ""
	}

	absolutePath := strings.TrimSpace(record.Path)
	if absolutePath == "" {
		absolutePath = filepath.Join(root.Path, filepath.FromSlash(relativePath))
	}

	return LibraryIndexedFile{
		Name:         name,
		Path:         absolutePath,
		RelativePath: buildVirtualLibraryPath(root.Name, relativePath),
		FolderPath:   buildVirtualLibraryPath(root.Name, folderPath),
		RootPath:     root.Path,
		RootName:     root.Name,
		ModifiedAtMs: timeFromUnixNanoValue(record.ModUnixNs).UnixMilli(),
	}, true
}

func loadLibraryFilesDatabaseSnapshot(databasePath string, roots []libraryRootConfig) (libraryFilesDatabaseSnapshot, bool) {
	records, totalEntries, ok := loadLibraryFilesDatabaseRecordsFromSQLite(databasePath, roots)
	if !ok {
		return libraryFilesDatabaseSnapshot{}, false
	}

	rootByPath := make(map[string]libraryRootConfig, len(roots))
	for _, root := range roots {
		rootByPath[root.Path] = root
	}

	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        append([]libraryRootConfig(nil), roots...),
		TotalEntries: totalEntries,
		TrackFiles:   make([]LibraryIndexedFile, 0),
		TextFiles:    make([]LibraryIndexedFile, 0),
		ImageFiles:   make([]LibraryIndexedFile, 0),
	}

	for _, record := range records {
		root, exists := rootByPath[record.RootPath]
		if !exists {
			return libraryFilesDatabaseSnapshot{}, false
		}

		indexed, indexedOK := indexedFileFromDatabaseRecord(root, record)
		if !indexedOK {
			continue
		}

		switch record.Kind {
		case "track":
			snapshot.TrackFiles = append(snapshot.TrackFiles, indexed)
		case "text-file":
			snapshot.TextFiles = append(snapshot.TextFiles, indexed)
		case "image-file":
			snapshot.ImageFiles = append(snapshot.ImageFiles, indexed)
		}
	}

	sortIndexedFilesByRelativePath(snapshot.TrackFiles)
	sortIndexedFilesByRelativePath(snapshot.TextFiles)
	sortIndexedFilesByRelativePath(snapshot.ImageFiles)
	return snapshot, true
}

func (a *App) startLibraryFilesRefreshAsync(roots []libraryRootConfig, expectedScanGeneration uint64) {
	if len(roots) == 0 {
		return
	}

	contentState := a.libraryContentState()
	generationState := a.libraryGenerationState()
	indexState := a.libraryIndexState()
	runtimeState := a.runtimeState()

	contentState.indexMu.Lock()
	if generationState.libraryScanGeneration.Load() != expectedScanGeneration {
		contentState.indexMu.Unlock()
		return
	}
	indexState.libraryFileHydrationPending = true
	contentState.indexMu.Unlock()

	activeRoots := append([]libraryRootConfig(nil), roots...)
	a.logRescanEvent("Library files database refresh START: roots=%d", len(activeRoots))

	go func(rootsCopy []libraryRootConfig) {
		startedAt := time.Now()
		result, err := a.buildDeferredHydrationScan(rootsCopy, expectedScanGeneration)
		if err != nil {
			contentState.indexMu.Lock()
			if generationState.libraryScanGeneration.Load() == expectedScanGeneration {
				indexState.libraryFileHydrationPending = false
			}
			contentState.indexMu.Unlock()

			if err == errLibraryScanCanceled {
				a.logRescanEvent("Library files database refresh CANCELED")
				return
			}

			a.logRescanEvent("Library files database refresh failed: %v", err)
			return
		}

		if !a.setLibraryIndexFromScan(result, expectedScanGeneration) {
			a.logRescanEvent("Library files database refresh canceled during index commit")
			return
		}

		shouldEmitUpdate := false
		payload := LibraryScanResult{}
		contentState.indexMu.Lock()
		if generationState.libraryScanGeneration.Load() == expectedScanGeneration {
			indexState.libraryFileHydrationPending = false
			indexState.libraryFolderEntriesCache = nil
			a.maybeStartLibraryDerivedIndexRebuildLocked()
			shouldEmitUpdate = true
			payload = compactLibraryScanResult(contentState.libraryScan)
		}
		contentState.indexMu.Unlock()

		if shouldEmitUpdate && runtimeState.ctx != nil {
			runtimeEventsEmit(runtimeState.ctx, libraryScanUpdatedEvent, payload)
		}

		a.notifyMusicBrainzTagWorker()
		a.notifyLibraryFilesDatabaseWorker()
		a.logRescanEvent(
			"Library files database refresh END: tracks=%d text=%d images=%d took %.2fms",
			result.TrackCount,
			result.TextFileCount,
			result.ImageFileCount,
			time.Since(startedAt).Seconds()*1000,
		)
	}(activeRoots)
}
