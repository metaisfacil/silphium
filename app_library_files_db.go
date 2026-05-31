package main

import (
	logpkg "log"
	pathpkg "path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const libraryFilesDatabaseFileName = legacyLibraryFilesDatabaseFileName
const libraryFilesDatabaseStartupSnapshotLockTimeout = 100 * time.Millisecond

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

func (a *App) localLibraryFilesDatabaseEnabled() bool {
	a.ensureSettingsLoaded()
	if a.settingsState().settings.LocalLibraryFilesDatabaseEnabled == nil {
		return true
	}

	return *a.settingsState().settings.LocalLibraryFilesDatabaseEnabled
}

func (a *App) localLibraryFilesDatabaseLoadOnStartupEnabled() bool {
	if !a.localLibraryFilesDatabaseEnabled() {
		return false
	}

	a.ensureSettingsLoaded()
	if a.settingsState().settings.LocalLibraryFilesDatabaseLoadOnStartup == nil {
		return true
	}

	return *a.settingsState().settings.LocalLibraryFilesDatabaseLoadOnStartup
}

func (a *App) localLibraryFilesDatabaseListenHistoryEnabled() bool {
	if !a.localLibraryFilesDatabaseEnabled() {
		return false
	}

	a.ensureSettingsLoaded()
	if a.settingsState().settings.LocalLibraryFilesDatabaseListenHistoryEnabled == nil {
		return false
	}

	return *a.settingsState().settings.LocalLibraryFilesDatabaseListenHistoryEnabled
}

func (a *App) localLibraryFilesDatabaseListenHistoryLimit() int {
	a.ensureSettingsLoaded()
	limit := a.settingsState().settings.LocalLibraryFilesDatabaseListenHistoryLimit
	if limit < 0 {
		return 0
	}

	return limit
}

func (a *App) libraryFilesDatabasePath() string {
	return a.metadataDatabasePath()
}

func (a *App) snapshotLibraryFilesDatabaseState() (libraryFilesDatabaseSnapshot, bool) {
	contentState := a.libraryContentState()
	scanState := a.libraryScanState()
	indexState := a.libraryIndexState()

	contentState.indexMu.RLock()
	defer contentState.indexMu.RUnlock()

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
	if !a.localLibraryFilesDatabaseEnabled() {
		return
	}

	databaseState := a.libraryDatabaseState()
	databaseState.mu.Lock()
	databaseState.pendingFullSnapshot = true
	databaseState.pendingIncrementalChanges = nil
	databaseState.pendingIncrementalTotalEntries = 0
	databaseState.mu.Unlock()

	wakeCh := a.ensureLibraryFilesDatabaseWorker()
	select {
	case wakeCh <- struct{}{}:
	default:
	}
}

func clonePreparedIncrementalLibraryChanges(changes []preparedIncrementalLibraryChange) []preparedIncrementalLibraryChange {
	if len(changes) == 0 {
		return nil
	}

	cloned := make([]preparedIncrementalLibraryChange, len(changes))
	for index, change := range changes {
		cloned[index] = preparedIncrementalLibraryChange{
			root:       change.root,
			targetPath: change.targetPath,
			trackFiles: append([]LibraryIndexedFile(nil), change.trackFiles...),
			textFiles:  append([]LibraryIndexedFile(nil), change.textFiles...),
			imageFiles: append([]LibraryIndexedFile(nil), change.imageFiles...),
		}
	}

	return cloned
}

func (a *App) notifyLibraryFilesDatabaseWorkerIncremental(changes []preparedIncrementalLibraryChange, totalEntries int) {
	if !a.localLibraryFilesDatabaseEnabled() || len(changes) == 0 {
		return
	}

	databaseState := a.libraryDatabaseState()
	databaseState.mu.Lock()
	if !databaseState.pendingFullSnapshot {
		databaseState.pendingIncrementalChanges = append(databaseState.pendingIncrementalChanges, clonePreparedIncrementalLibraryChanges(changes)...)
		databaseState.pendingIncrementalTotalEntries = totalEntries
	}
	databaseState.mu.Unlock()

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
	databaseState.pendingFullSnapshot = false
	databaseState.pendingIncrementalChanges = nil
	databaseState.pendingIncrementalTotalEntries = 0
	databaseState.mu.Unlock()

	if stopCh == nil || doneCh == nil {
		return
	}

	close(stopCh)
	<-doneCh
}

func (a *App) dequeueLibraryFilesDatabaseWork() (bool, []preparedIncrementalLibraryChange, int) {
	databaseState := a.libraryDatabaseState()
	databaseState.mu.Lock()
	defer databaseState.mu.Unlock()

	if databaseState.pendingFullSnapshot {
		databaseState.pendingFullSnapshot = false
		databaseState.pendingIncrementalChanges = nil
		databaseState.pendingIncrementalTotalEntries = 0
		return true, nil, 0
	}

	if len(databaseState.pendingIncrementalChanges) == 0 {
		return false, nil, 0
	}

	changes := databaseState.pendingIncrementalChanges
	totalEntries := databaseState.pendingIncrementalTotalEntries
	databaseState.pendingIncrementalChanges = nil
	databaseState.pendingIncrementalTotalEntries = 0
	return false, changes, totalEntries
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
			fullSnapshot, incrementalChanges, totalEntries := a.dequeueLibraryFilesDatabaseWork()
			if !fullSnapshot && len(incrementalChanges) == 0 {
				break
			}

			if fullSnapshot {
				snapshot, ok := a.snapshotLibraryFilesDatabaseState()
				if !ok {
					databaseState := a.libraryDatabaseState()
					databaseState.mu.Lock()
					databaseState.pendingFullSnapshot = true
					databaseState.mu.Unlock()
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
			} else if len(incrementalChanges) > 0 {
				if err := writeLibraryFilesDatabaseIncrementalChangesToSQLite(a.libraryFilesDatabasePath(), incrementalChanges, totalEntries); err != nil {
					logpkg.Printf("failed to persist incremental library files database changes: %v", err)
				}
			}
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

	storedTrackRecord := musicBrainzTagTrackRecord{
		Title:       record.TrackTitle,
		TrackArtist: record.TrackArtist,
		AlbumTitle:  record.AlbumTitle,
		AlbumArtist: record.AlbumArtist,
		TrackNumber: record.TrackNumber,
		TrackTotal:  record.TrackTotal,
	}
	title, album, albumArtist, artist, trackNumber, hasMetadata := cachedIndexedTrackMetadataFromStoredTrackRecord(storedTrackRecord)
	indexed := LibraryIndexedFile{
		Name:         name,
		Path:         absolutePath,
		RelativePath: buildVirtualLibraryPath(root.Name, relativePath),
		FolderPath:   buildVirtualLibraryPath(root.Name, folderPath),
		RootPath:     root.Path,
		RootName:     root.Name,
		ModifiedAtMs: timeFromUnixNanoValue(record.ModUnixNs).UnixMilli(),
	}
	if hasMetadata {
		indexed.CachedTrackTitle = title
		indexed.CachedAlbumTitle = album
		indexed.CachedAlbumArtist = albumArtist
		indexed.CachedArtistName = artist
		indexed.CachedTrackNumber = trackNumber
		if record.TrackTotal > 0 {
			indexed.CachedTrackTotal = strconv.Itoa(record.TrackTotal)
		}
	}

	return indexed, true
}

func loadLibraryFilesDatabaseSnapshot(databasePath string, roots []libraryRootConfig) (libraryFilesDatabaseSnapshot, bool) {
	records, totalEntries, ok := loadLibraryFilesDatabaseRecordsFromSQLiteWithLockTimeout(
		databasePath,
		roots,
		libraryFilesDatabaseStartupSnapshotLockTimeout,
	)
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
	hydrationHints := libraryFullScanBuildHints{
		TotalEntries:   contentState.libraryScan.TotalEntries,
		TrackCount:     contentState.libraryScan.TrackCount,
		TextFileCount:  contentState.libraryScan.TextFileCount,
		ImageFileCount: contentState.libraryScan.ImageFileCount,
	}
	indexState.libraryFileHydrationPending = true
	contentState.indexMu.Unlock()

	activeRoots := append([]libraryRootConfig(nil), roots...)
	a.logRescanEvent("Library files database refresh START: roots=%d", len(activeRoots))
	releaseAsyncTask := a.beginLibraryScanAsyncTask()

	go func(rootsCopy []libraryRootConfig) {
		defer releaseAsyncTask()
		startedAt := time.Now()
		result, err := a.buildDeferredHydrationScan(rootsCopy, hydrationHints, expectedScanGeneration)
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
