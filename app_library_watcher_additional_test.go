package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

const libraryWatcherUpdateTimeout = 6 * time.Second

func waitForLibraryWatcherToStart(t *testing.T, app *App) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		watcherState := app.libraryWatcherState()
		watcherState.mu.Lock()
		watcher := watcherState.watcher
		stopCh := watcherState.stopCh
		watcherState.mu.Unlock()

		if watcher != nil && stopCh != nil {
			return
		}

		time.Sleep(20 * time.Millisecond)
	}

	t.Fatal("library watcher did not start before timeout")
}

func waitForLibraryWatcherToStop(t *testing.T, app *App) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		watcherState := app.libraryWatcherState()
		watcherState.mu.Lock()
		watcher := watcherState.watcher
		stopCh := watcherState.stopCh
		watcherState.mu.Unlock()

		if watcher == nil && stopCh == nil {
			return
		}

		time.Sleep(20 * time.Millisecond)
	}

	t.Fatal("library watcher did not stop before timeout")
}

func TestLibraryScanWrappersAndIncrementalUpdates(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	initialScan := app.scanLibraryFolder(fixture.rootOne, false)
	if initialScan.TrackCount != 1 || initialScan.TextFileCount != 1 || initialScan.ImageFileCount != 2 {
		t.Fatalf("scanLibraryFolder() = %#v, want indexed library-one counts", initialScan)
	}

	wrappedScan := app.ScanLibraryFolder(fixture.rootOne)
	if wrappedScan.TrackCount != 1 || wrappedScan.RootPath != normalizePath(fixture.rootOne) {
		t.Fatalf("ScanLibraryFolder() = %#v, want wrapped root-one scan", wrappedScan)
	}

	app.settingsLoaded = true
	app.settings.LibraryFolders = []AppLibraryFolder{{Path: fixture.rootOne, Label: "Configured Library", ReleaseDepth: 0}}
	configuredScan := app.ScanConfiguredLibraryFolders()
	if configuredScan.RootName != "Configured Library" || configuredScan.TrackCount != 1 {
		t.Fatalf("ScanConfiguredLibraryFolders() = %#v, want configured root scan", configuredScan)
	}

	root := app.activeLibraryRoots[0]
	newFolder := filepath.Join(fixture.rootOne, "Artist One", "Singles")
	if err := os.MkdirAll(newFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", newFolder, err)
	}
	newTrack := filepath.Join(newFolder, "03 Bonus.flac")
	newText := filepath.Join(newFolder, "notes.txt")
	newImage := filepath.Join(newFolder, "cover.png")
	writeTestFile(t, newTrack, "bonus")
	writeTestFile(t, newText, "notes")
	writeTestFile(t, newImage, "png")

	app.indexMu.Lock()
	app.addOrUpdatePathRecursive(root, newFolder)
	app.indexMu.Unlock()
	if _, exists := app.trackByPath[normalizePath(newTrack)]; !exists {
		t.Fatalf("addOrUpdatePathRecursive() did not index new track %q", newTrack)
	}
	if _, exists := app.textByPath[normalizePath(newText)]; !exists {
		t.Fatalf("addOrUpdatePathRecursive() did not index new text file %q", newText)
	}
	if _, exists := app.imageByPath[normalizePath(newImage)]; !exists {
		t.Fatalf("addOrUpdatePathRecursive() did not index new image %q", newImage)
	}

	if err := os.Remove(newTrack); err != nil {
		t.Fatalf("Remove(%q) error = %v", newTrack, err)
	}
	app.indexMu.Lock()
	app.addOrUpdatePathRecursive(root, newTrack)
	app.indexMu.Unlock()
	if _, exists := app.trackByPath[normalizePath(newTrack)]; exists {
		t.Fatalf("addOrUpdatePathRecursive(removed file) should remove %q from the index", newTrack)
	}

	if notification, changed := app.applyIncrementalLibraryChanges(nil); changed || notification.TotalEntries != 0 {
		t.Fatalf("applyIncrementalLibraryChanges(nil) = (%#v, %t), want no changes", notification, changed)
	}
	if notification, changed := app.applyIncrementalLibraryChanges([]string{"", filepath.Join(t.TempDir(), "outside.txt")}); changed || notification.TotalEntries != 0 {
		t.Fatalf("applyIncrementalLibraryChanges(outside paths) = (%#v, %t), want no changes", notification, changed)
	}

	writeTestFile(t, newTrack, "bonus-restored")
	notification, changed := app.applyIncrementalLibraryChanges([]string{newFolder})
	if !changed {
		t.Fatal("applyIncrementalLibraryChanges(root folder) = false, want true")
	}
	if notification.TrackCount != len(app.trackByPath) || notification.TextFileCount != len(app.textByPath) || notification.ImageFileCount != len(app.imageByPath) {
		t.Fatalf("applyIncrementalLibraryChanges() = %#v, want current indexed counts", notification)
	}
	if _, exists := app.trackByPath[normalizePath(newTrack)]; !exists {
		t.Fatalf("applyIncrementalLibraryChanges() did not reindex restored track %q", newTrack)
	}

	app.indexMu.Lock()
	app.removePathAndDescendants(newFolder)
	app.indexMu.Unlock()
	if _, exists := app.textByPath[normalizePath(newText)]; exists {
		t.Fatalf("removePathAndDescendants() should remove %q from the text index", newText)
	}
	if _, exists := app.imageByPath[normalizePath(newImage)]; exists {
		t.Fatalf("removePathAndDescendants() should remove %q from the image index", newImage)
	}
	if _, exists := app.trackByPath[normalizePath(newTrack)]; exists {
		t.Fatalf("removePathAndDescendants() should remove %q from the track index", newTrack)
	}
}

func TestLibraryWatcherHelpersAndRuntimeEvents(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	if !isRelevantWatchEvent(fsnotify.Event{Op: fsnotify.Create}) {
		t.Fatal("isRelevantWatchEvent(create) = false, want true")
	}
	if isRelevantWatchEvent(fsnotify.Event{Op: fsnotify.Chmod}) {
		t.Fatal("isRelevantWatchEvent(chmod) = true, want false")
	}

	indexRoot := libraryRootConfig{Path: filepath.Join(t.TempDir(), "library"), Name: "Library"}
	if _, ok := indexFileForRoot(indexRoot, filepath.Join(t.TempDir(), "outside.flac"), "outside.flac"); ok {
		t.Fatal("indexFileForRoot(outside root) = true, want false")
	}

	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	progressEvents := make(chan LibraryScanProgress, 16)
	updatedEvents := make(chan LibraryScanResult, 16)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if len(optionalData) == 0 {
			return
		}
		switch eventName {
		case libraryScanProgressEvent:
			if payload, ok := optionalData[0].(LibraryScanProgress); ok {
				progressEvents <- payload
			}
		case libraryScanUpdatedEvent:
			if payload, ok := optionalData[0].(LibraryScanResult); ok {
				updatedEvents <- payload
			}
		}
	}
	app.ctx = context.Background()
	app.scanLibraryFolder(fixture.rootOne, false)

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatalf("NewWatcher() error = %v", err)
	}
	progressCalls := 0
	addLibraryWatchesRecursive(watcher, fixture.rootOne, func() { progressCalls++ })
	if progressCalls == 0 {
		t.Fatal("addLibraryWatchesRecursive() should invoke the progress callback for watched directories")
	}
	_ = watcher.Close()

	scanResult := app.scanLibraryFolder(fixture.rootOne, false)
	if scanResult.TotalEntries == 0 {
		t.Fatalf("scanLibraryFolder() = %#v, want indexed entries", scanResult)
	}
	seenScanning := false
	seenFinalizing := false
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		select {
		case payload := <-progressEvents:
			switch payload.Phase {
			case "scanning":
				seenScanning = true
			case "finalizing":
				seenFinalizing = true
			}
		default:
			time.Sleep(10 * time.Millisecond)
		}
	}
	if !seenScanning || !seenFinalizing {
		t.Fatalf("scan progress phases = scanning:%t finalizing:%t, want both phases", seenScanning, seenFinalizing)
	}
	seenNonEmptyUpdate := false
	updateDeadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(updateDeadline) {
		select {
		case payload := <-updatedEvents:
			if payload.TotalEntries > 0 {
				seenNonEmptyUpdate = true
			}
		default:
			time.Sleep(10 * time.Millisecond)
		}
		if seenNonEmptyUpdate {
			break
		}
	}
	if !seenNonEmptyUpdate {
		t.Fatal("scanLibraryFolder() should emit at least one non-empty scan update event")
	}

	root := app.activeLibraryRoots[0]
	app.startLibraryWatcher([]libraryRootConfig{root}, nil)
	newTrack := filepath.Join(fixture.albumOneFolder, "99 Watched.flac")
	writeTestFile(t, newTrack, "watched")

	watchDeadline := time.Now().Add(libraryWatcherUpdateTimeout)
	for time.Now().Before(watchDeadline) {
		app.indexMu.Lock()
		_, exists := app.trackByPath[normalizePath(newTrack)]
		app.indexMu.Unlock()
		if exists {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	app.indexMu.Lock()
	_, exists := app.trackByPath[normalizePath(newTrack)]
	app.indexMu.Unlock()
	if !exists {
		t.Fatalf("startLibraryWatcher() did not apply incremental update for %q", newTrack)
	}

	app.stopLibraryWatcher()
	watcherState := app.libraryWatcherState()
	if watcherState.watcher != nil || watcherState.stopCh != nil {
		t.Fatal("stopLibraryWatcher() should clear watcher state")
	}

	app.startLibraryWatcher(nil, nil)
	if watcherState.watcher != nil {
		t.Fatal("startLibraryWatcher(nil) should leave watcher nil")
	}
}

func TestIncrementalLibraryChangesAmendDerivedFolderIndexInPlace(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	var logMu sync.Mutex
	logLines := make([]string, 0, 32)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != libraryRescanLogEvent || len(optionalData) == 0 {
			return
		}
		line, ok := optionalData[0].(string)
		if !ok {
			return
		}
		logMu.Lock()
		logLines = append(logLines, line)
		logMu.Unlock()
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.ctx = context.Background()

	scanResult := app.scanLibraryFolder(fixture.rootOne, false)
	if scanResult.ImageFileCount != 2 {
		t.Fatalf("scanLibraryFolder() = %#v, want both fixture images indexed", scanResult)
	}

	albumFolderPath := ""
	app.indexMu.Lock()
	indexedCover, exists := app.imageByPath[normalizePath(fixture.coverOne)]
	if exists {
		albumFolderPath = indexedCover.FolderPath
	}
	app.indexMu.Unlock()
	if !exists {
		t.Fatalf("initial image index is missing %q", fixture.coverOne)
	}
	if got := app.GetLibraryFolderCoverPath(albumFolderPath); got != fixture.coverOne {
		t.Fatalf("GetLibraryFolderCoverPath(before incremental update) = %q, want %q", got, fixture.coverOne)
	}

	logMu.Lock()
	logLines = nil
	logMu.Unlock()

	if err := os.Remove(fixture.coverOne); err != nil {
		t.Fatalf("Remove(%q) error = %v", fixture.coverOne, err)
	}

	notification, changed := app.applyIncrementalLibraryChanges([]string{fixture.coverOne})
	if !changed {
		t.Fatal("applyIncrementalLibraryChanges(removed cover) = false, want true")
	}
	if notification.ImageFileCount != 1 {
		t.Fatalf("applyIncrementalLibraryChanges(removed cover) = %#v, want one indexed image remaining", notification)
	}

	app.indexMu.Lock()
	folderIndexReady := app.isLibraryFolderIndexReadyLocked()
	derivedDirty := app.libraryDerivedIndexDirty
	derivedBuilding := app.libraryDerivedIndexBuilding
	searchTrackEntriesReady := app.searchTrackEntries != nil
	app.indexMu.Unlock()
	if !folderIndexReady {
		t.Fatal("incremental cover-art update should keep the folder-derived index ready")
	}
	if !derivedDirty || derivedBuilding {
		t.Fatalf("incremental cover-art update should leave only the search corpus dirty/building = %t/%t, want true/false", derivedDirty, derivedBuilding)
	}
	if searchTrackEntriesReady {
		t.Fatal("incremental cover-art update should invalidate the global search corpus instead of rebuilding it eagerly")
	}

	if got := app.GetLibraryFolderCoverPath(albumFolderPath); got != fixture.folderCoverOne {
		t.Fatalf("GetLibraryFolderCoverPath(after incremental update) = %q, want %q", got, fixture.folderCoverOne)
	}

	page := app.GetLibraryFolderPage(albumFolderPath, 0, 10)
	if page.TotalEntries != 3 {
		t.Fatalf("GetLibraryFolderPage(after incremental update) = %#v, want 3 remaining entries", page)
	}
	for _, entry := range page.Entries {
		if entry.Path == normalizePath(fixture.coverOne) {
			t.Fatalf("GetLibraryFolderPage(after incremental update) still contains removed cover entry %#v", entry)
		}
	}

	searchPage := app.SearchLibrary("folder.jpg", 0, 10)
	if searchPage.TotalEntries != 1 || len(searchPage.Entries) != 1 || searchPage.Entries[0].Path != normalizePath(fixture.folderCoverOne) {
		t.Fatalf("SearchLibrary(folder.jpg) = %#v, want fallback-map results for the remaining cover art", searchPage)
	}

	logMu.Lock()
	deferredLogs := append([]string(nil), logLines...)
	logMu.Unlock()
	for _, line := range deferredLogs {
		if strings.Contains(line, "rebuildLibraryDerivedIndex START") {
			t.Fatalf("incremental cover-art update should not trigger a full derived-index rebuild, but log contained %q", line)
		}
	}
}

func TestLibraryWatcherAdditionalEdgeBranches(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	root := libraryRootConfig{Path: fixture.rootOne, Name: "Library One"}
	outsideTrack := filepath.Join(t.TempDir(), "outside.flac")
	writeTestFile(t, outsideTrack, "outside")
	app.indexMu.Lock()
	app.addOrUpdateIndexedFile(root, outsideTrack, filepath.Base(outsideTrack))
	app.indexMu.Unlock()
	if _, exists := app.trackByPath[normalizePath(outsideTrack)]; exists {
		t.Fatalf("addOrUpdateIndexedFile(outside root) should not index %q", outsideTrack)
	}

	ignoredFile := filepath.Join(fixture.albumOneFolder, "ignore.bin")
	writeTestFile(t, ignoredFile, "ignored")
	app.indexMu.Lock()
	app.addOrUpdateIndexedFile(root, normalizePath(ignoredFile), filepath.Base(ignoredFile))
	app.indexMu.Unlock()
	if _, exists := app.trackByPath[normalizePath(ignoredFile)]; exists {
		t.Fatalf("addOrUpdateIndexedFile(unsupported file) should not add %q to trackByPath", ignoredFile)
	}
	if _, exists := app.textByPath[normalizePath(ignoredFile)]; exists {
		t.Fatalf("addOrUpdateIndexedFile(unsupported file) should not add %q to textByPath", ignoredFile)
	}
	if _, exists := app.imageByPath[normalizePath(ignoredFile)]; exists {
		t.Fatalf("addOrUpdateIndexedFile(unsupported file) should not add %q to imageByPath", ignoredFile)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatalf("NewWatcher() error = %v", err)
	}
	addLibraryWatchesRecursive(watcher, filepath.Join(t.TempDir(), "missing-root"), nil)
	_ = watcher.Close()

	app.scanLibraryFolder(fixture.rootOne, false)
	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	watcherState := app.libraryWatcherState()
	firstWatcher := watcherState.watcher
	if firstWatcher == nil {
		t.Fatal("startLibraryWatcher() did not create the initial watcher")
	}

	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	if watcherState.watcher == nil {
		t.Fatal("startLibraryWatcher(restart) did not keep a live watcher")
	}
	if watcherState.watcher == firstWatcher {
		t.Fatal("startLibraryWatcher(restart) should replace the previous watcher instance")
	}
	if !firstWatcher.IsClosed() {
		t.Fatal("expected the replaced watcher to be closed")
	}

	invalidRootPath := filepath.Join(t.TempDir(), "not-a-directory")
	writeTestFile(t, invalidRootPath, "file")
	app.startLibraryWatcher([]libraryRootConfig{{Path: "   ", Name: "Blank"}, {Path: invalidRootPath, Name: "File"}}, nil)
	if watcherState.watcher != nil || watcherState.stopCh != nil {
		t.Fatal("startLibraryWatcher(invalid roots) should stop and clear watcher state")
	}

	app.scanLibraryFolder(fixture.rootOne, false)
	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	watchRoot := filepath.Join(fixture.rootOne, "Artist One", "Watched Folder")
	if err := os.MkdirAll(watchRoot, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", watchRoot, err)
	}
	time.Sleep(100 * time.Millisecond)
	watchTrack := filepath.Join(watchRoot, "01 Watched.flac")
	writeTestFile(t, watchTrack, "watched")

	deadline := time.Now().Add(libraryWatcherUpdateTimeout)
	for time.Now().Before(deadline) {
		app.indexMu.Lock()
		_, exists := app.trackByPath[normalizePath(watchTrack)]
		app.indexMu.Unlock()
		if exists {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	app.indexMu.Lock()
	_, exists := app.trackByPath[normalizePath(watchTrack)]
	app.indexMu.Unlock()
	if !exists {
		t.Fatalf("startLibraryWatcher(directory create) did not index %q", watchTrack)
	}
}

func TestAsyncLibraryWatcherStartupDoesNotRestoreStoppedWatcher(t *testing.T) {
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	asyncRoot := filepath.Join(t.TempDir(), "async-root")
	for index := 0; index < 400; index++ {
		if err := os.MkdirAll(filepath.Join(asyncRoot, fmt.Sprintf("dir-%03d", index), "nested"), 0o755); err != nil {
			t.Fatalf("MkdirAll(async watcher tree) error = %v", err)
		}
	}

	app.startLibraryWatcherAsync([]libraryRootConfig{{Path: asyncRoot, Name: "Async"}})
	app.stopLibraryWatcher()
	waitForLibraryWatcherToStop(t, app)

	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		watcherState := app.libraryWatcherState()
		watcherState.mu.Lock()
		watcher := watcherState.watcher
		stopCh := watcherState.stopCh
		watcherState.mu.Unlock()

		if watcher != nil || stopCh != nil {
			t.Fatal("stale asynchronous watcher startup restored watcher state after stop")
		}

		time.Sleep(20 * time.Millisecond)
	}
}

func TestIncrementalLibraryChangesDoNotBlockFolderQueries(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	app.scanLibraryFolder(fixture.rootOne, false)
	app.indexMu.Lock()
	existingTrack, ok := app.trackByPath[normalizePath(fixture.trackOne)]
	app.indexMu.Unlock()
	if !ok {
		t.Fatalf("scanLibraryFolder() did not index %q", fixture.trackOne)
	}
	existingAlbumFolder := existingTrack.FolderPath
	blockedPath := filepath.Join(fixture.rootOne, "Artist One", "Singles")
	newTrack := filepath.Join(blockedPath, "03 Bonus.flac")
	writeTestFile(t, newTrack, "bonus")

	hookEntered := make(chan string, 1)
	releaseHook := make(chan struct{})
	beforeIncrementalLibraryPathScanHook = func(path string) {
		select {
		case hookEntered <- path:
		default:
		}
		<-releaseHook
	}
	t.Cleanup(func() {
		beforeIncrementalLibraryPathScanHook = nil
		select {
		case <-releaseHook:
		default:
			close(releaseHook)
		}
	})

	applyResultCh := make(chan struct {
		notification LibraryScanResult
		changed      bool
	}, 1)
	go func() {
		notification, changed := app.applyIncrementalLibraryChanges([]string{blockedPath})
		applyResultCh <- struct {
			notification LibraryScanResult
			changed      bool
		}{notification: notification, changed: changed}
	}()

	select {
	case path := <-hookEntered:
		if normalizePath(path) != normalizePath(blockedPath) {
			close(releaseHook)
			t.Fatalf("incremental scan hook path = %q, want %q", path, blockedPath)
		}
	case <-time.After(time.Second):
		close(releaseHook)
		t.Fatal("incremental scan hook was not reached before timeout")
	}

	pageCh := make(chan LibraryFolderPage, 1)
	go func() {
		pageCh <- app.GetLibraryFolderPage(existingAlbumFolder, 0, 10)
	}()

	select {
	case page := <-pageCh:
		if page.TotalEntries != 4 {
			close(releaseHook)
			t.Fatalf("GetLibraryFolderPage() during incremental update = %#v, want existing album entries", page)
		}
	case <-time.After(time.Second):
		close(releaseHook)
		t.Fatal("GetLibraryFolderPage() blocked while incremental watcher work was in progress")
	}

	close(releaseHook)
	result := <-applyResultCh
	if !result.changed {
		t.Fatal("applyIncrementalLibraryChanges() = false, want true")
	}
	if result.notification.TrackCount != len(app.trackByPath) {
		t.Fatalf("applyIncrementalLibraryChanges() notification = %#v, want updated track count", result.notification)
	}

	app.indexMu.Lock()
	_, exists := app.trackByPath[normalizePath(newTrack)]
	app.indexMu.Unlock()
	if !exists {
		t.Fatalf("applyIncrementalLibraryChanges() did not index %q", newTrack)
	}
}

func TestCoalesceIncrementalLibraryChangePaths(t *testing.T) {
	root := filepath.Join(t.TempDir(), "library")
	child := filepath.Join(root, "Artist", "Album")
	grandchild := filepath.Join(child, "01 Track.flac")
	other := filepath.Join(root, "Other", "Album")

	coalesced := coalesceIncrementalLibraryChangePaths([]string{grandchild, root, child, other, grandchild, "   "})
	if len(coalesced) != 1 || normalizePath(coalesced[0]) != normalizePath(root) {
		t.Fatalf("coalesceIncrementalLibraryChangePaths() = %#v, want only root %q", coalesced, root)
	}

	independent := coalesceIncrementalLibraryChangePaths([]string{child, other})
	if len(independent) != 2 {
		t.Fatalf("coalesceIncrementalLibraryChangePaths(independent) = %#v, want two paths", independent)
	}
}
