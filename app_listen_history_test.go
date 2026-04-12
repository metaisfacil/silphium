package main

import (
	"path/filepath"
	"testing"
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

	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100); !ok {
		t.Fatal("AddListenHistoryEntry(trackOne) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.outsideTrack, "Outside", "Outside Artist", "Outside Album", 200); !ok {
		t.Fatal("AddListenHistoryEntry(outsideTrack) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.trackTwo, "Outro", "Artist Two", "Album Two", 300); !ok {
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

	if ok := app.AddListenHistoryEntry(fixture.trackOne, "Intro", "Artist One", "Album One", 100); !ok {
		t.Fatal("AddListenHistoryEntry(trackOne) = false, want true")
	}
	if ok := app.AddListenHistoryEntry(fixture.trackTwo, "Outro", "Artist Two", "Album Two", 200); !ok {
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
}
