//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWindowsLibraryWatcherDoesNotLockWatchedSubfolders(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	app.scanLibraryFolder(fixture.rootOne, false)
	if len(app.activeLibraryRoots) != 1 {
		t.Fatalf("activeLibraryRoots len = %d, want 1", len(app.activeLibraryRoots))
	}

	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	waitForLibraryWatcherToStart(t, app)

	originalAlbum := fixture.albumOneFolder
	renamedAlbum := filepath.Join(filepath.Dir(originalAlbum), "Album One Renamed")
	if err := os.Rename(originalAlbum, renamedAlbum); err != nil {
		t.Fatalf("Rename(%q, %q) error = %v", originalAlbum, renamedAlbum, err)
	}

	originalTrackPath := normalizePath(fixture.trackOne)
	renamedTrackPath := normalizePath(filepath.Join(renamedAlbum, filepath.Base(fixture.trackOne)))

	deadline := time.Now().Add(libraryWatcherUpdateTimeout)
	for time.Now().Before(deadline) {
		app.indexMu.Lock()
		_, oldExists := app.trackByPath[originalTrackPath]
		_, newExists := app.trackByPath[renamedTrackPath]
		app.indexMu.Unlock()
		if !oldExists && newExists {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	app.indexMu.Lock()
	_, oldExists := app.trackByPath[originalTrackPath]
	_, newExists := app.trackByPath[renamedTrackPath]
	app.indexMu.Unlock()
	if oldExists || !newExists {
		t.Fatalf("watcher rename update = old:%t new:%t, want old:false new:true", oldExists, newExists)
	}
}

func TestWindowsLibraryWatcherCoalescesBurstChanges(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	app.scanLibraryFolder(fixture.rootOne, false)
	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	waitForLibraryWatcherToStart(t, app)

	hookPaths := make(chan string, 8)
	beforeIncrementalLibraryPathScanHook = func(path string) {
		hookPaths <- normalizePath(path)
	}
	t.Cleanup(func() {
		beforeIncrementalLibraryPathScanHook = nil
	})

	burstFolder := filepath.Join(fixture.albumOneFolder, "Burst")
	if err := os.MkdirAll(burstFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", burstFolder, err)
	}

	writeTestFile(t, filepath.Join(burstFolder, "01 One.flac"), "one")
	time.Sleep(250 * time.Millisecond)
	writeTestFile(t, filepath.Join(burstFolder, "02 Two.flac"), "two")
	time.Sleep(250 * time.Millisecond)
	writeTestFile(t, filepath.Join(burstFolder, "03 Three.flac"), "three")

	select {
	case path := <-hookPaths:
		if path != normalizePath(burstFolder) {
			t.Fatalf("incremental scan hook path = %q, want burst folder path %q", path, burstFolder)
		}
	case <-time.After(windowsLibraryWatcherDebounceDuration + 2*time.Second):
		t.Fatal("expected a debounced root rescan after burst changes")
	}

	select {
	case path := <-hookPaths:
		t.Fatalf("unexpected second rescan for burst changes: %q", path)
	case <-time.After(windowsLibraryWatcherDebounceDuration / 2):
	}

	deadline := time.Now().Add(libraryWatcherUpdateTimeout)
	for time.Now().Before(deadline) {
		app.indexMu.Lock()
		_, oneExists := app.trackByPath[normalizePath(filepath.Join(burstFolder, "01 One.flac"))]
		_, twoExists := app.trackByPath[normalizePath(filepath.Join(burstFolder, "02 Two.flac"))]
		_, threeExists := app.trackByPath[normalizePath(filepath.Join(burstFolder, "03 Three.flac"))]
		app.indexMu.Unlock()
		if oneExists && twoExists && threeExists {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatal("burst changes were not fully indexed after the debounced root rescan")
}

func TestWindowsLibraryWatcherTargetsCoverArtChanges(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	app.scanLibraryFolder(fixture.rootOne, false)
	app.startLibraryWatcher([]libraryRootConfig{app.activeLibraryRoots[0]}, nil)
	waitForLibraryWatcherToStart(t, app)

	hookPaths := make(chan string, 8)
	beforeIncrementalLibraryPathScanHook = func(path string) {
		hookPaths <- normalizePath(path)
	}
	t.Cleanup(func() {
		beforeIncrementalLibraryPathScanHook = nil
	})

	writeTestFile(t, fixture.coverOne, "updated-cover")

	select {
	case path := <-hookPaths:
		albumFolder := normalizePath(filepath.Dir(fixture.coverOne))
		coverPath := normalizePath(fixture.coverOne)
		rootPath := normalizePath(fixture.rootOne)
		if path == rootPath {
			t.Fatalf("incremental scan hook path = %q, want targeted cover update instead of root rescan", path)
		}
		if path != albumFolder && path != coverPath {
			t.Fatalf("incremental scan hook path = %q, want album folder %q or cover file %q", path, albumFolder, coverPath)
		}
	case <-time.After(windowsLibraryWatcherDebounceDuration + 2*time.Second):
		t.Fatal("expected a targeted incremental rescan after replacing cover art")
	}
}
