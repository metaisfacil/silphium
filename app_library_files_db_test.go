package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLibraryFilesDatabaseSnapshotRoundTrip(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library One", ReleaseDepth: 0}, {Path: fixture.rootTwo, Name: "Library Two", ReleaseDepth: 0}}
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 10,
		TrackFiles: []LibraryIndexedFile{
			{Name: "01 Intro.flac", Path: fixture.trackOne, RelativePath: "Library One/Artist One/Album One/01 Intro.flac", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"},
			{Name: "02 Outro.flac", Path: fixture.trackTwo, RelativePath: "Library Two/Artist Two/Album Two/02 Outro.flac", FolderPath: "Library Two/Artist Two/Album Two", RootPath: fixture.rootTwo, RootName: "Library Two"},
		},
		TextFiles: []LibraryIndexedFile{{Name: "notes.txt", Path: fixture.noteOne, RelativePath: "Library One/Artist One/Album One/notes.txt", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"}},
		ImageFiles: []LibraryIndexedFile{
			{Name: "cover.jpg", Path: fixture.coverOne, RelativePath: "Library One/Artist One/Album One/cover.jpg", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"},
			{Name: "folder.jpg", Path: fixture.folderCoverOne, RelativePath: "Library One/Artist One/Album One/folder.jpg", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"},
			{Name: "booklet.png", Path: fixture.imageTwo, RelativePath: "Library Two/Artist Two/Album Two/booklet.png", FolderPath: "Library Two/Artist Two/Album Two", RootPath: fixture.rootTwo, RootName: "Library Two"},
		},
	}

	databasePath := filepath.Join(t.TempDir(), libraryFilesDatabaseFileName)
	if err := writeLibraryFilesDatabaseSnapshotToSQLite(databasePath, snapshot); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite() error = %v", err)
	}

	loaded, ok := loadLibraryFilesDatabaseSnapshot(databasePath, roots)
	if !ok {
		t.Fatal("loadLibraryFilesDatabaseSnapshot() = false, want true")
	}

	result := loaded.scanResult()
	if result.TotalEntries != 10 || result.TrackCount != 2 || result.TextFileCount != 1 || result.ImageFileCount != 3 {
		t.Fatalf("loaded database scan result = %#v, want counts 10/2/1/3", result)
	}
	if got := result.CoverPathByFolder["library one/artist one/album one"]; got != fixture.coverOne {
		t.Fatalf("loaded cover path = %q, want %q", got, fixture.coverOne)
	}
	if got := result.TrackFiles[0].RelativePath; got != "Library One/Artist One/Album One/01 Intro.flac" {
		t.Fatalf("loaded track relative path = %q, want %q", got, "Library One/Artist One/Album One/01 Intro.flac")
	}
}

func TestScanLibraryFoldersDeferredLoadsFromDatabaseBeforeFilesystemRefresh(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	t.Cleanup(func() {
		app.stopLibraryFilesDatabaseWorker()
	})

	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library", ReleaseDepth: 0}}
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 6,
		TrackFiles:   []LibraryIndexedFile{{Name: "01 Intro.flac", Path: fixture.trackOne, RelativePath: "Library/Artist One/Album One/01 Intro.flac", FolderPath: "Library/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library"}},
		TextFiles:    []LibraryIndexedFile{{Name: "notes.txt", Path: fixture.noteOne, RelativePath: "Library/Artist One/Album One/notes.txt", FolderPath: "Library/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library"}},
		ImageFiles: []LibraryIndexedFile{
			{Name: "cover.jpg", Path: fixture.coverOne, RelativePath: "Library/Artist One/Album One/cover.jpg", FolderPath: "Library/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library"},
			{Name: "folder.jpg", Path: fixture.folderCoverOne, RelativePath: "Library/Artist One/Album One/folder.jpg", FolderPath: "Library/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library"},
		},
	}

	if err := writeLibraryFilesDatabaseSnapshotToSQLite(app.libraryFilesDatabasePath(), snapshot); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite() error = %v", err)
	}
	if err := os.Remove(fixture.trackOne); err != nil {
		t.Fatalf("Remove(%q) error = %v", fixture.trackOne, err)
	}

	result := app.scanLibraryFoldersDeferred([]AppLibraryFolder{{Path: fixture.rootOne, Label: "Library", ReleaseDepth: 0}}, false)
	if result.DeferredFiles {
		t.Fatal("scanLibraryFoldersDeferred(database) deferredFiles = true, want false")
	}
	if result.TrackCount != 1 || result.TextFileCount != 1 || result.ImageFileCount != 2 {
		t.Fatalf("scanLibraryFoldersDeferred(database) = %#v, want database counts", result)
	}
	if got := app.GetLibraryFolderTrackCount("Library/Artist One/Album One"); got != 1 {
		t.Fatalf("GetLibraryFolderTrackCount(database) = %d, want 1", got)
	}
	if got := app.GetLibraryFolderCoverPath("Library/Artist One/Album One"); got != fixture.coverOne {
		t.Fatalf("GetLibraryFolderCoverPath(database) = %q, want %q", got, fixture.coverOne)
	}
	if got := app.ResolveLibraryFolderForPath(fixture.noteOne); got != "Library/Artist One/Album One" {
		t.Fatalf("ResolveLibraryFolderForPath(database) = %q, want %q", got, "Library/Artist One/Album One")
	}

	app.libraryScanGeneration.Add(1)
}

func TestScanLibraryFolderPersistsLibraryFilesDatabase(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	t.Cleanup(func() {
		app.stopLibraryFilesDatabaseWorker()
	})

	result := app.scanLibraryFolder(fixture.rootOne, false)
	if result.TrackCount != 1 || result.TextFileCount != 1 || result.ImageFileCount != 2 {
		t.Fatalf("scanLibraryFolder() = %#v, want indexed counts", result)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		loaded, ok := loadLibraryFilesDatabaseSnapshot(app.libraryFilesDatabasePath(), app.activeLibraryRoots)
		if ok {
			persisted := loaded.scanResult()
			if persisted.TrackCount == 1 && persisted.TextFileCount == 1 && persisted.ImageFileCount == 2 {
				return
			}
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatal("timed out waiting for persisted library files database snapshot")
}
