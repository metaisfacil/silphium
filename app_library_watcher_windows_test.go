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

	deadline := time.Now().Add(3 * time.Second)
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
