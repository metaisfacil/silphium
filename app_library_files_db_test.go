package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadLibraryFilesDatabaseSnapshotUsesStoredTrackMetadata(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newTestAppWithLoadedSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled: boolPointer(true),
	})
	app.settingsPath = filepath.Join(t.TempDir(), appSettingsFileName)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library", ReleaseDepth: 0}}
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 1,
		TrackFiles: []LibraryIndexedFile{{
			Name:              filepath.Base(fixture.trackOne),
			Path:              fixture.trackOne,
			RelativePath:      "Library/Artist One/Album One/01 Intro.flac",
			FolderPath:        "Library/Artist One/Album One",
			RootPath:          fixture.rootOne,
			RootName:          "Library",
			CachedTrackTitle:  "Stored Title",
			CachedAlbumTitle:  "Stored Album",
			CachedAlbumArtist: "Stored Album Artist",
			CachedArtistName:  "Stored Artist",
			CachedTrackNumber: "2",
			CachedTrackTotal:  "9",
		}},
	}
	if err := writeLibraryFilesDatabaseSnapshotToSQLite(app.libraryFilesDatabasePath(), snapshot); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite() error = %v", err)
	}

	loaded, ok := loadLibraryFilesDatabaseSnapshot(app.libraryFilesDatabasePath(), roots)
	if !ok {
		t.Fatal("loadLibraryFilesDatabaseSnapshot() = false, want true")
	}
	if len(loaded.TrackFiles) != 1 {
		t.Fatalf("loaded track count = %d, want 1", len(loaded.TrackFiles))
	}
	loadedTrack := loaded.TrackFiles[0]
	if loadedTrack.CachedTrackTitle != "Stored Title" || loadedTrack.CachedAlbumTitle != "Stored Album" || loadedTrack.CachedAlbumArtist != "Stored Album Artist" || loadedTrack.CachedArtistName != "Stored Artist" {
		t.Fatalf("loaded cached metadata = %#v, want stored title/album/album-artist/artist", loadedTrack)
	}
	if loadedTrack.CachedTrackNumber != "2" || loadedTrack.CachedTrackTotal != "9" {
		t.Fatalf("loaded cached numbering = %#v, want stored track numbering", loadedTrack)
	}
}

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

func TestLibraryFilesDatabaseIncrementalChangesUpdateSubtree(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library One", ReleaseDepth: 0}, {Path: fixture.rootTwo, Name: "Library Two", ReleaseDepth: 0}}
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 6,
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

	bonusTrack := filepath.Join(fixture.albumOneFolder, "03 Bonus.flac")
	writeTestFile(t, bonusTrack, "bonus track")
	change := preparedIncrementalLibraryChange{
		root:       roots[0],
		targetPath: fixture.albumOneFolder,
		trackFiles: []LibraryIndexedFile{
			{Name: "01 Intro.flac", Path: fixture.trackOne, RelativePath: "Library One/Artist One/Album One/01 Intro.flac", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"},
			{Name: "03 Bonus.flac", Path: bonusTrack, RelativePath: "Library One/Artist One/Album One/03 Bonus.flac", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"},
		},
		imageFiles: []LibraryIndexedFile{{Name: "folder.jpg", Path: fixture.folderCoverOne, RelativePath: "Library One/Artist One/Album One/folder.jpg", FolderPath: "Library One/Artist One/Album One", RootPath: fixture.rootOne, RootName: "Library One"}},
	}

	if err := writeLibraryFilesDatabaseIncrementalChangesToSQLite(databasePath, []preparedIncrementalLibraryChange{change}, 5); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseIncrementalChangesToSQLite() error = %v", err)
	}

	loaded, ok := loadLibraryFilesDatabaseSnapshot(databasePath, roots)
	if !ok {
		t.Fatal("loadLibraryFilesDatabaseSnapshot() = false, want true")
	}

	result := loaded.scanResult()
	if result.TotalEntries != 5 || result.TrackCount != 3 || result.TextFileCount != 0 || result.ImageFileCount != 2 {
		t.Fatalf("incremental database scan result = %#v, want counts 5/3/0/2", result)
	}
	if got := result.CoverPathByFolder["library one/artist one/album one"]; got != fixture.folderCoverOne {
		t.Fatalf("loaded cover path after incremental update = %q, want %q", got, fixture.folderCoverOne)
	}

	trackPaths := make(map[string]struct{}, len(result.TrackFiles))
	for _, entry := range result.TrackFiles {
		trackPaths[entry.Path] = struct{}{}
	}
	if _, ok := trackPaths[fixture.trackOne]; !ok {
		t.Fatalf("track %q missing after incremental update", fixture.trackOne)
	}
	if _, ok := trackPaths[bonusTrack]; !ok {
		t.Fatalf("track %q missing after incremental update", bonusTrack)
	}
	if _, ok := trackPaths[fixture.trackTwo]; !ok {
		t.Fatalf("unrelated track %q missing after incremental update", fixture.trackTwo)
	}

	for _, entry := range result.TextFiles {
		if entry.Path == fixture.noteOne {
			t.Fatalf("removed text file %q still present after incremental update", fixture.noteOne)
		}
	}
	for _, entry := range result.ImageFiles {
		if entry.Path == fixture.coverOne {
			t.Fatalf("removed image file %q still present after incremental update", fixture.coverOne)
		}
	}
}

func TestWriteLibraryFilesDatabaseSnapshotToSQLiteWaitsForMetadataDatabasePathLock(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library One", ReleaseDepth: 0}}
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 1,
		TrackFiles: []LibraryIndexedFile{{
			Name:         "01 Intro.flac",
			Path:         fixture.trackOne,
			RelativePath: "Library One/Artist One/Album One/01 Intro.flac",
			FolderPath:   "Library One/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library One",
		}},
	}

	databasePath := filepath.Join(t.TempDir(), metadataDatabaseFileName)
	unlock := lockMetadataDatabasePath(databasePath)
	released := false
	defer func() {
		if !released {
			unlock()
		}
	}()

	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		done <- writeLibraryFilesDatabaseSnapshotToSQLite(databasePath, snapshot)
	}()
	<-started

	select {
	case err := <-done:
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite() completed before metadata lock release: %v", err)
	case <-time.After(100 * time.Millisecond):
	}

	released = true
	unlock()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("writeLibraryFilesDatabaseSnapshotToSQLite() did not complete after metadata lock release")
	}

	loaded, ok := loadLibraryFilesDatabaseSnapshot(databasePath, roots)
	if !ok {
		t.Fatal("loadLibraryFilesDatabaseSnapshot() = false, want true")
	}
	if len(loaded.TrackFiles) != 1 || loaded.TrackFiles[0].Path != fixture.trackOne {
		t.Fatalf("loaded snapshot after serialization = %#v, want stored track %q", loaded.TrackFiles, fixture.trackOne)
	}
}

func TestLoadLibraryFilesDatabaseSnapshotReturnsFalseQuicklyWhenMetadataPathLockBusy(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library One", ReleaseDepth: 0}}
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 1,
		TrackFiles: []LibraryIndexedFile{{
			Name:         "01 Intro.flac",
			Path:         fixture.trackOne,
			RelativePath: "Library One/Artist One/Album One/01 Intro.flac",
			FolderPath:   "Library One/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library One",
		}},
	}

	databasePath := filepath.Join(t.TempDir(), metadataDatabaseFileName)
	if err := writeLibraryFilesDatabaseSnapshotToSQLite(databasePath, snapshot); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite() error = %v", err)
	}

	unlock := lockMetadataDatabasePath(databasePath)
	defer unlock()

	startedAt := time.Now()
	loaded, ok := loadLibraryFilesDatabaseSnapshot(databasePath, roots)
	if ok {
		t.Fatalf("loadLibraryFilesDatabaseSnapshot() = (%#v, true), want false while metadata path lock is busy", loaded)
	}
	if elapsed := time.Since(startedAt); elapsed > 500*time.Millisecond {
		t.Fatalf("loadLibraryFilesDatabaseSnapshot() took %v with a busy metadata path lock, want fast fallback", elapsed)
	}
}

func TestScanLibraryFoldersDeferredFallsBackToFilesystemQuickScanWhenMetadataPathLockBusy(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{})
	t.Cleanup(func() {
		cleanupDeferredLibraryScanTestApp(t, app)
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

	unlock := lockMetadataDatabasePath(app.libraryFilesDatabasePath())
	defer unlock()

	result := app.scanLibraryFoldersDeferred([]AppLibraryFolder{{Path: fixture.rootOne, Label: "Library", ReleaseDepth: 0}}, false)
	if !result.DeferredFiles {
		t.Fatal("scanLibraryFoldersDeferred(lock busy) deferredFiles = false, want true from filesystem quick scan fallback")
	}
	if result.TotalEntries != 6 {
		t.Fatalf("scanLibraryFoldersDeferred(lock busy) totalEntries = %d, want 6", result.TotalEntries)
	}
	if result.TrackCount != 1 || result.TextFileCount != 1 || result.ImageFileCount != 2 {
		t.Fatalf(
			"scanLibraryFoldersDeferred(lock busy) counts = tracks:%d text:%d images:%d, want 1/1/2",
			result.TrackCount,
			result.TextFileCount,
			result.ImageFileCount,
		)
	}
}

func TestScanLibraryFoldersDeferredLoadsFromDatabaseBeforeFilesystemRefresh(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{})
	t.Cleanup(func() {
		cleanupDeferredLibraryScanTestApp(t, app)
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

}

func TestScanLibraryFoldersDeferredSkipsDatabaseWhenStartupLoadDisabled(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	disabled := false
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:       boolPointer(true),
		LocalLibraryFilesDatabaseLoadOnStartup: &disabled,
	})
	t.Cleanup(func() {
		cleanupDeferredLibraryScanTestApp(t, app)
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
	if result.TrackCount != 0 || result.TextFileCount != 1 || result.ImageFileCount != 2 {
		t.Fatalf("scanLibraryFoldersDeferred(filesystem) = %#v, want refreshed filesystem counts", result)
	}
	if got := app.GetLibraryFolderTrackCount("Library/Artist One/Album One"); got != 0 {
		t.Fatalf("GetLibraryFolderTrackCount(filesystem) = %d, want 0", got)
	}

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

func TestMetadataDatabaseMigratesLegacyMusicBrainzAndLibraryFilesData(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	settingsDir := t.TempDir()
	app := NewApp()
	app.settingsPath = filepath.Join(settingsDir, "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   10,
	})

	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library", ReleaseDepth: 0}}
	app.activeLibraryRoots = roots

	legacyLibraryPath := filepath.Join(settingsDir, legacyLibraryFilesDatabaseFileName)
	legacyMusicBrainzPath := filepath.Join(settingsDir, legacyMusicBrainzTagDatabaseFileName)
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 4,
		TrackFiles: []LibraryIndexedFile{{
			Name:         "01 Intro.flac",
			Path:         fixture.trackOne,
			RelativePath: "Library/Artist One/Album One/01 Intro.flac",
			FolderPath:   "Library/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library",
		}},
		TextFiles: []LibraryIndexedFile{{
			Name:         "notes.txt",
			Path:         fixture.noteOne,
			RelativePath: "Library/Artist One/Album One/notes.txt",
			FolderPath:   "Library/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library",
		}},
		ImageFiles: []LibraryIndexedFile{{
			Name:         "cover.jpg",
			Path:         fixture.coverOne,
			RelativePath: "Library/Artist One/Album One/cover.jpg",
			FolderPath:   "Library/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library",
		}},
	}

	if err := writeLibraryFilesDatabaseSnapshotToSQLite(legacyLibraryPath, snapshot); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite(legacy) error = %v", err)
	}
	if err := appendLibraryListenHistoryRecordToSQLite(legacyLibraryPath, libraryListenHistoryRecord{
		TrackPath:     fixture.trackOne,
		TrackName:     "Intro",
		ArtistName:    "Artist One",
		ReleaseName:   "Album One",
		ListenedAt:    123,
		PlayedPercent: 84,
	}, 10); err != nil {
		t.Fatalf("appendLibraryListenHistoryRecordToSQLite(legacy) error = %v", err)
	}
	if err := savePlaylistTrackCacheRecordsToSQLite(legacyLibraryPath, []playlistTrackCacheRecord{{
		TrackPath:  fixture.trackOne,
		TrackName:  "Intro",
		ArtistName: "Artist One",
	}}); err != nil {
		t.Fatalf("savePlaylistTrackCacheRecordsToSQLite(legacy) error = %v", err)
	}

	releaseID := "22222222-2222-4222-8222-222222222222"
	store := newMusicBrainzTagDatabaseStore()
	store.Tracks[fixture.trackOne] = musicBrainzTagTrackRecord{
		Signature: trackTagsFileSignature{Size: 1, ModUnixNs: 2},
		Title:     "Intro",
		ReleaseID: releaseID,
	}
	store.Entities[musicBrainzTagEntityKey("release", releaseID)] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseID,
		Title:      "Album One",
	}
	if err := writeMusicBrainzTagDatabaseStoreToSQLite(legacyMusicBrainzPath, store); err != nil {
		t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(legacy) error = %v", err)
	}

	if got, want := app.libraryFilesDatabasePath(), app.musicBrainzTagDatabasePath(); got == want {
		t.Fatalf("libraryFilesDatabasePath() = %q, want a dedicated snapshot database path", got)
	}
	if got := filepath.Base(app.libraryFilesDatabasePath()); got != libraryFilesDatabaseFileName {
		t.Fatalf("library snapshot database file name = %q, want %q", got, libraryFilesDatabaseFileName)
	}
	if got := filepath.Base(app.musicBrainzTagDatabasePath()); got != metadataDatabaseFileName {
		t.Fatalf("metadata database file name = %q, want %q", got, metadataDatabaseFileName)
	}

	loadedSnapshot, ok := loadLibraryFilesDatabaseSnapshot(app.libraryFilesDatabasePath(), roots)
	if !ok {
		t.Fatal("loadLibraryFilesDatabaseSnapshot(snapshot) = false, want true")
	}
	if loadedSnapshot.TotalEntries != snapshot.TotalEntries || len(loadedSnapshot.TrackFiles) != 1 || len(loadedSnapshot.TextFiles) != 1 || len(loadedSnapshot.ImageFiles) != 1 {
		t.Fatalf("loaded migrated snapshot = %#v, want legacy counts preserved", loadedSnapshot)
	}
	if !libraryFilesDatabaseFileExists(app.libraryFilesDatabasePath()) {
		t.Fatalf("expected migrated snapshot database at %q", app.libraryFilesDatabasePath())
	}

	history := app.LoadListenHistoryPlaylist()
	if len(history.TrackFiles) != 1 || history.TrackFiles[0].Path != fixture.trackOne || history.TrackFiles[0].CachedTrackTitle != "Intro" {
		t.Fatalf("LoadListenHistoryPlaylist() after migration = %#v, want migrated history entry", history)
	}
	if got := history.TrackFiles[0].PlayedPercent; got != 84 {
		t.Fatalf("migrated history played percent = %d, want 84", got)
	}

	cacheByPath := loadPlaylistTrackCacheRecordsFromSQLite(app.metadataDatabasePath(), []string{fixture.trackOne})
	cacheRecord, ok := cacheByPath[fixture.trackOne]
	if !ok || cacheRecord.TrackName != "Intro" || cacheRecord.ArtistName != "Artist One" {
		t.Fatalf("playlist track cache after migration = %#v, want migrated cache for %q", cacheByPath, fixture.trackOne)
	}

	loadedStore := loadMusicBrainzTagDatabaseStore(app.musicBrainzTagDatabasePath())
	if !musicBrainzTagDatabaseFileExists(app.metadataDatabasePath()) {
		t.Fatalf("expected migrated metadata database at %q", app.metadataDatabasePath())
	}
	loadedTrack, ok := loadedStore.Tracks[fixture.trackOne]
	if !ok || loadedTrack.ReleaseID != releaseID || loadedTrack.Title != "Intro" {
		t.Fatalf("loaded migrated MusicBrainz track = %#v, want release %q title Intro", loadedTrack, releaseID)
	}
	if loadedRelease, ok := loadedStore.Entities[musicBrainzTagEntityKey("release", releaseID)]; !ok || loadedRelease.Title != "Album One" {
		t.Fatalf("loaded migrated MusicBrainz release = %#v, want Album One", loadedRelease)
	}
}

func TestLibraryFilesDatabaseMigratesFromSharedMetadataDatabase(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newTestAppWithLoadedSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled: boolPointer(true),
	})
	app.settingsPath = filepath.Join(t.TempDir(), appSettingsFileName)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library", ReleaseDepth: 0}}
	sharedMetadataPath := app.metadataDatabasePath()
	snapshotPath := app.libraryFilesDatabasePath()
	snapshot := libraryFilesDatabaseSnapshot{
		Roots:        roots,
		TotalEntries: 3,
		TrackFiles: []LibraryIndexedFile{{
			Name:         filepath.Base(fixture.trackOne),
			Path:         fixture.trackOne,
			RelativePath: "Library/Artist One/Album One/01 Intro.flac",
			FolderPath:   "Library/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library",
		}},
	}

	if err := writeLibraryFilesDatabaseSnapshotToSQLite(sharedMetadataPath, snapshot); err != nil {
		t.Fatalf("writeLibraryFilesDatabaseSnapshotToSQLite(shared metadata) error = %v", err)
	}

	store := newMusicBrainzTagDatabaseStore()
	store.Tracks[fixture.trackOne] = musicBrainzTagTrackRecord{
		Signature:   trackTagsFileSignature{Size: 1, ModUnixNs: 2},
		Title:       "Intro",
		AlbumTitle:  "Album One",
		AlbumArtist: "Artist One",
		TrackArtist: "Artist One",
		TrackNumber: 1,
		TrackTotal:  8,
	}
	if err := writeMusicBrainzTagDatabaseStoreToSQLite(sharedMetadataPath, store); err != nil {
		t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(shared metadata) error = %v", err)
	}

	if libraryFilesDatabaseFileExists(snapshotPath) {
		t.Fatalf("snapshot database already exists at %q before migration", snapshotPath)
	}

	loadedSnapshot, ok := loadLibraryFilesDatabaseSnapshot(snapshotPath, roots)
	if !ok {
		t.Fatal("loadLibraryFilesDatabaseSnapshot(migrated shared metadata) = false, want true")
	}
	if loadedSnapshot.TotalEntries != snapshot.TotalEntries || len(loadedSnapshot.TrackFiles) != 1 {
		t.Fatalf("loaded snapshot from shared metadata = %#v, want migrated snapshot counts", loadedSnapshot)
	}
	if loadedTrack := loadedSnapshot.TrackFiles[0]; loadedTrack.CachedTrackTitle != "Intro" || loadedTrack.CachedAlbumTitle != "Album One" || loadedTrack.CachedAlbumArtist != "Artist One" || loadedTrack.CachedArtistName != "Artist One" || loadedTrack.CachedTrackNumber != "1" || loadedTrack.CachedTrackTotal != "8" {
		t.Fatalf("loaded snapshot metadata from shared metadata = %#v, want migrated cached track metadata", loadedTrack)
	}
	if !libraryFilesDatabaseFileExists(snapshotPath) {
		t.Fatalf("expected migrated snapshot database at %q", snapshotPath)
	}
	if !musicBrainzTagDatabaseFileExists(sharedMetadataPath) {
		t.Fatalf("expected shared metadata database to remain at %q", sharedMetadataPath)
	}

	loadedStore := loadMusicBrainzTagDatabaseStore(app.musicBrainzTagDatabasePath())
	if loadedTrack, exists := loadedStore.Tracks[fixture.trackOne]; !exists || loadedTrack.Title != "Intro" {
		t.Fatalf("shared metadata MusicBrainz track after snapshot migration = %#v, want Intro", loadedTrack)
	}
}

func TestSetLibraryIndexFromScanUsesStoredMetadataForIndexedTracks(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{})

	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library", ReleaseDepth: 0}}
	scan := LibraryScanResult{
		RootPath: fixture.rootOne,
		RootName: "Library",
		TrackFiles: []LibraryIndexedFile{{
			Name:         "01 Intro.flac",
			Path:         fixture.trackOne,
			RelativePath: "Library/Artist One/Album One/01 Intro.flac",
			FolderPath:   "Library/Artist One/Album One",
			RootPath:     fixture.rootOne,
			RootName:     "Library",
		}},
	}

	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Title:       "Database Title",
		AlbumTitle:  "Database Album",
		AlbumArtist: "Database Album Artist",
		TrackArtist: "Database Artist",
		TrackNumber: 3,
		TrackTotal:  11,
	})
	app.musicBrainzTagMu.Unlock()

	if !app.setLibraryIndexFromScan(scan, 0) {
		t.Fatal("setLibraryIndexFromScan() = false, want true")
	}

	indexed := app.trackByPath[fixture.trackOne]
	if indexed.CachedTrackTitle != "Database Title" || indexed.CachedAlbumTitle != "Database Album" || indexed.CachedAlbumArtist != "Database Album Artist" || indexed.CachedArtistName != "Database Artist" {
		t.Fatalf("cached indexed metadata = %#v, want stored title/album/album-artist/artist", indexed)
	}
	if indexed.CachedTrackNumber != "3" || indexed.CachedTrackTotal != "11" {
		t.Fatalf("cached indexed positions = %#v, want stored track numbering", indexed)
	}
	if got := app.libraryScan.TrackFiles[0]; got.CachedTrackTitle != "Database Title" || got.CachedAlbumTitle != "Database Album" || got.CachedAlbumArtist != "Database Album Artist" || got.CachedArtistName != "Database Artist" {
		t.Fatalf("libraryScan track cache = %#v, want stored metadata copied to scan", got)
	}
}
