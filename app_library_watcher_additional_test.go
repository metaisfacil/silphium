package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func waitForLibraryWatcherToStart(t *testing.T, app *App) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		app.watchMu.Lock()
		watcher := app.libraryWatcher
		stopCh := app.watchStop
		app.watchMu.Unlock()

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
		app.watchMu.Lock()
		watcher := app.libraryWatcher
		stopCh := app.watchStop
		app.watchMu.Unlock()

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

	watchDeadline := time.Now().Add(2 * time.Second)
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
	if app.libraryWatcher != nil || app.watchStop != nil {
		t.Fatal("stopLibraryWatcher() should clear watcher state")
	}

	app.startLibraryWatcher(nil, nil)
	if app.libraryWatcher != nil {
		t.Fatal("startLibraryWatcher(nil) should leave watcher nil")
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
	firstWatcher := app.libraryWatcher
	if firstWatcher == nil {
		t.Fatal("startLibraryWatcher() did not create the initial watcher")
	}

	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	if app.libraryWatcher == nil {
		t.Fatal("startLibraryWatcher(restart) did not keep a live watcher")
	}
	if app.libraryWatcher == firstWatcher {
		t.Fatal("startLibraryWatcher(restart) should replace the previous watcher instance")
	}
	if err := firstWatcher.Add(fixture.rootOne); err == nil {
		t.Fatal("expected the replaced watcher to be closed")
	}

	invalidRootPath := filepath.Join(t.TempDir(), "not-a-directory")
	writeTestFile(t, invalidRootPath, "file")
	app.startLibraryWatcher([]libraryRootConfig{{Path: "   ", Name: "Blank"}, {Path: invalidRootPath, Name: "File"}}, nil)
	if app.libraryWatcher != nil || app.watchStop != nil {
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

	deadline := time.Now().Add(2 * time.Second)
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
		app.watchMu.Lock()
		watcher := app.libraryWatcher
		stopCh := app.watchStop
		app.watchMu.Unlock()

		if watcher != nil || stopCh != nil {
			t.Fatal("stale asynchronous watcher startup restored watcher state after stop")
		}

		time.Sleep(20 * time.Millisecond)
	}
}
