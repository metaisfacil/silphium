package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestListenHistoryPlaylistLoadsNewestEntriesAndAppliesLimit(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   2,
	})
	app.activeLibraryRoots = []libraryRootConfig{
		{Path: fixture.rootOne, Name: "Library One", ReleaseDepth: 0},
		{Path: fixture.rootTwo, Name: "Library Two", ReleaseDepth: 0},
	}

	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100, 64); !ok {
		t.Fatal("AddListenHistoryEntry(trackOne) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.outsideTrack, "Outside", "Outside Artist", "Outside Album", 200, 88); !ok {
		t.Fatal("AddListenHistoryEntry(outsideTrack) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.trackTwo, "Outro", "Artist Two", "Album Two", 300, 100); !ok {
		t.Fatal("AddListenHistoryEntry(trackTwo) = false, want true")
	}

	loaded := app.LoadListenHistoryPlaylist()
	if loaded.Name != "Listen History" {
		t.Fatalf("LoadListenHistoryPlaylist().Name = %q, want %q", loaded.Name, "Listen History")
	}
	if len(loaded.TrackFiles) != 2 {
		t.Fatalf("len(LoadListenHistoryPlaylist().TrackFiles) = %d, want 2", len(loaded.TrackFiles))
	}
	if got := loaded.TrackFiles[0].Path; got != fixture.trackTwo {
		t.Fatalf("newest history path = %q, want %q", got, fixture.trackTwo)
	}
	if got := loaded.TrackFiles[0].CachedTrackTitle; got != "Outro" {
		t.Fatalf("newest history cached title = %q, want %q", got, "Outro")
	}
	if got := loaded.TrackFiles[0].CachedArtistName; got != "Artist Two" {
		t.Fatalf("newest history cached artist = %q, want %q", got, "Artist Two")
	}
	if got := loaded.TrackFiles[0].ListenedAt; got != 300 {
		t.Fatalf("newest history listened at = %d, want 300", got)
	}
	if got := loaded.TrackFiles[0].PlayedPercent; got != 100 {
		t.Fatalf("newest history played percent = %d, want 100", got)
	}
	if got := loaded.TrackFiles[0].RootName; got != "Library Two" {
		t.Fatalf("indexed history root name = %q, want %q", got, "Library Two")
	}
	if got := loaded.TrackFiles[1].Path; got != fixture.outsideTrack {
		t.Fatalf("second history path = %q, want %q", got, fixture.outsideTrack)
	}
	if got := loaded.TrackFiles[1].RootName; got != "" {
		t.Fatalf("outside history root name = %q, want empty", got)
	}
	if got := loaded.TrackFiles[1].RelativePath; got != filepath.Base(fixture.outsideTrack) {
		t.Fatalf("outside history relative path = %q, want %q", got, filepath.Base(fixture.outsideTrack))
	}
	if got := loaded.TrackFiles[1].PlayedPercent; got != 88 {
		t.Fatalf("outside history played percent = %d, want 88", got)
	}
}

func TestSaveSettingsTrimsStoredListenHistoryToNewLimit(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   0,
	})
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library", ReleaseDepth: 0}}

	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100, 55); !ok {
		t.Fatal("AddListenHistoryEntry(trackOne) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.trackTwo, "Outro", "Artist Two", "Album Two", 200, 100); !ok {
		t.Fatal("AddListenHistoryEntry(trackTwo) = false, want true")
	}

	saved, err := app.SaveSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   1,
	})
	if err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}
	if saved.LocalLibraryFilesDatabaseListenHistoryLimit != 1 {
		t.Fatalf("SaveSettings().LocalLibraryFilesDatabaseListenHistoryLimit = %d, want 1", saved.LocalLibraryFilesDatabaseListenHistoryLimit)
	}

	loaded := app.LoadListenHistoryPlaylist()
	if len(loaded.TrackFiles) != 1 {
		t.Fatalf("len(LoadListenHistoryPlaylist().TrackFiles) after trim = %d, want 1", len(loaded.TrackFiles))
	}
	if got := loaded.TrackFiles[0].Path; got != fixture.trackTwo {
		t.Fatalf("remaining history path after trim = %q, want %q", got, fixture.trackTwo)
	}
	if got := loaded.TrackFiles[0].PlayedPercent; got != 100 {
		t.Fatalf("remaining history played percent after trim = %d, want 100", got)
	}
}

func TestListenHistoryEntryUpdatesStoredPlayedPercentForSameSession(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   10,
	})

	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100, 52); !ok {
		t.Fatal("AddListenHistoryEntry(initial) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100, 97); !ok {
		t.Fatal("AddListenHistoryEntry(update) = false, want true")
	}

	loaded := app.LoadListenHistoryPlaylist()
	if len(loaded.TrackFiles) != 1 {
		t.Fatalf("len(LoadListenHistoryPlaylist().TrackFiles) = %d, want 1", len(loaded.TrackFiles))
	}
	if got := loaded.TrackFiles[0].PlayedPercent; got != 97 {
		t.Fatalf("updated history played percent = %d, want 97", got)
	}
}

func TestAddListenHistoryEntrySkipsSilenceTracks(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:                       boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled:          boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryThresholdSeconds: defaultListenHistoryThresholdSeconds,
	})

	if ok := app.AddListenHistoryEntry(filepath.Join(filepath.Dir(fixture.trackOne), "[silence].flac"), "[silence]", "", "", 100, 100); ok {
		t.Fatal("AddListenHistoryEntry([silence]) = true, want false")
	}
	if ok := app.AddListenHistoryEntry(filepath.Join(filepath.Dir(fixture.trackOne), "(silence).flac"), "", "", "", 100, 100); ok {
		t.Fatal("AddListenHistoryEntry((silence)) = true, want false")
	}

	loaded := app.LoadListenHistoryPlaylist()
	if len(loaded.TrackFiles) != 0 {
		t.Fatalf("len(LoadListenHistoryPlaylist().TrackFiles) = %d, want 0", len(loaded.TrackFiles))
	}
}

func TestAddListenHistoryEntryWaitsForMetadataDatabasePathLock(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   10,
	})

	unlock := lockMetadataDatabasePath(app.metadataDatabasePath())
	released := false
	defer func() {
		if !released {
			unlock()
		}
	}()

	started := make(chan struct{})
	done := make(chan bool, 1)
	go func() {
		close(started)
		done <- app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100, 100)
	}()
	<-started

	select {
	case ok := <-done:
		t.Fatalf("AddListenHistoryEntry() completed before metadata lock release with %t", ok)
	case <-time.After(100 * time.Millisecond):
	}

	released = true
	unlock()

	select {
	case ok := <-done:
		if !ok {
			t.Fatal("AddListenHistoryEntry() = false, want true")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("AddListenHistoryEntry() did not complete after metadata lock release")
	}

	loaded := app.LoadListenHistoryPlaylist()
	if len(loaded.TrackFiles) != 1 {
		t.Fatalf("len(LoadListenHistoryPlaylist().TrackFiles) = %d, want 1", len(loaded.TrackFiles))
	}
	if got := loaded.TrackFiles[0].Path; got != fixture.trackOne {
		t.Fatalf("stored history path = %q, want %q", got, fixture.trackOne)
	}
}

func TestLoadListenHistoryPlaylistReturnsQuicklyWhileMetadataPathLockBusy(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), "settings.json")
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:              boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryEnabled: boolPointer(true),
		LocalLibraryFilesDatabaseListenHistoryLimit:   10,
	})

	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100, 100); !ok {
		t.Fatal("AddListenHistoryEntry() = false, want true")
	}

	unlock := lockMetadataDatabasePath(app.metadataDatabasePath())
	defer unlock()

	start := time.Now()
	done := make(chan PlaylistLoadResult, 1)
	go func() {
		done <- app.LoadListenHistoryPlaylist()
	}()

	select {
	case loaded := <-done:
		if elapsed := time.Since(start); elapsed > 250*time.Millisecond {
			t.Fatalf("LoadListenHistoryPlaylist() took %v with a busy metadata path lock, want a quick snapshot read", elapsed)
		}
		if len(loaded.TrackFiles) != 1 {
			t.Fatalf("len(LoadListenHistoryPlaylist().TrackFiles) = %d, want 1", len(loaded.TrackFiles))
		}
		if got := loaded.TrackFiles[0].Path; got != fixture.trackOne {
			t.Fatalf("stored history path = %q, want %q", got, fixture.trackOne)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("LoadListenHistoryPlaylist() did not complete while the metadata path lock was busy")
	}
}
