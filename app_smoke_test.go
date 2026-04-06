package main

import (
	"path/filepath"
	"testing"
)

func TestAppHighRiskMethodsSmoke(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsPath = filepath.Join(fixture.tempDir, appSettingsFileName)
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	playlistPath := filepath.Join(fixture.tempDir, "playlists", "queue.m3u8")
	savedSettings, err := app.SaveSettings(AppSettings{
		LibraryFolders: []AppLibraryFolder{{
			Path:         fixture.rootOne + string(filepath.Separator),
			Label:        " Main / Library ",
			ReleaseDepth: 2,
		}},
		FavoritePlaylists: []string{"  " + playlistPath + "  "},
		Audio: AudioSettings{
			OutputBufferMs: 256,
		},
	})
	if err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}

	if len(savedSettings.LibraryFolders) != 1 {
		t.Fatalf("SaveSettings() libraryFolders length = %d, want %d", len(savedSettings.LibraryFolders), 1)
	}
	if savedSettings.LibraryFolders[0].Path != fixture.rootOne {
		t.Fatalf("SaveSettings() library folder path = %q, want %q", savedSettings.LibraryFolders[0].Path, fixture.rootOne)
	}
	if savedSettings.LibraryFolders[0].Label != "Main Library" {
		t.Fatalf("SaveSettings() library folder label = %q, want %q", savedSettings.LibraryFolders[0].Label, "Main Library")
	}
	if savedSettings.LibraryPath != fixture.rootOne {
		t.Fatalf("SaveSettings() legacy library path = %q, want %q", savedSettings.LibraryPath, fixture.rootOne)
	}
	if len(savedSettings.FavoritePlaylists) != 1 || savedSettings.FavoritePlaylists[0] != playlistPath {
		t.Fatalf("SaveSettings() favorite playlists = %#v, want %#v", savedSettings.FavoritePlaylists, []string{playlistPath})
	}

	loadedSettings := app.GetSettings()
	if loadedSettings.LibraryFolders[0].Label != "Main Library" {
		t.Fatalf("GetSettings() library folder label = %q, want %q", loadedSettings.LibraryFolders[0].Label, "Main Library")
	}

	scan := app.ScanConfiguredLibraryFolders()
	if scan.RootPath != fixture.rootOne {
		t.Fatalf("ScanConfiguredLibraryFolders() rootPath = %q, want %q", scan.RootPath, fixture.rootOne)
	}
	if scan.RootName != "Main Library" {
		t.Fatalf("ScanConfiguredLibraryFolders() rootName = %q, want %q", scan.RootName, "Main Library")
	}
	if scan.TrackCount != 1 || scan.TextFileCount != 1 || scan.ImageFileCount != 2 {
		t.Fatalf(
			"ScanConfiguredLibraryFolders() counts = tracks:%d text:%d images:%d, want 1/1/2",
			scan.TrackCount,
			scan.TextFileCount,
			scan.ImageFileCount,
		)
	}

	albumFolder := "Main Library/Artist One/Album One"
	folderPage := app.GetLibraryFolderPage(albumFolder, 0, 10)
	if !hasBrowserEntry(folderPage.Entries, "track", fixture.trackOne) {
		t.Fatalf("GetLibraryFolderPage() missing track %q: %#v", fixture.trackOne, folderPage.Entries)
	}
	if !hasBrowserEntry(folderPage.Entries, "text-file", fixture.noteOne) {
		t.Fatalf("GetLibraryFolderPage() missing text file %q: %#v", fixture.noteOne, folderPage.Entries)
	}

	searchPage := app.SearchLibrary("intro", 0, 10)
	if !hasBrowserEntry(searchPage.Entries, "track", fixture.trackOne) {
		t.Fatalf("SearchLibrary() missing track %q: %#v", fixture.trackOne, searchPage.Entries)
	}

	if !app.SavePlaylistFile(playlistPath, []string{"", "   ", fixture.trackOne, fixture.outsideTrack}) {
		t.Fatal("SavePlaylistFile() = false, want true")
	}

	loadedPlaylist := app.LoadPlaylistFile(playlistPath)
	if loadedPlaylist.Name != "queue.m3u8" {
		t.Fatalf("LoadPlaylistFile() name = %q, want %q", loadedPlaylist.Name, "queue.m3u8")
	}
	if len(loadedPlaylist.TrackFiles) != 1 {
		t.Fatalf("LoadPlaylistFile() trackFiles length = %d, want %d", len(loadedPlaylist.TrackFiles), 1)
	}
	if loadedPlaylist.TrackFiles[0].Path != fixture.trackOne {
		t.Fatalf("LoadPlaylistFile() first track path = %q, want %q", loadedPlaylist.TrackFiles[0].Path, fixture.trackOne)
	}
	if loadedPlaylist.TrackFiles[0].RootName != "Main Library" {
		t.Fatalf("LoadPlaylistFile() first track rootName = %q, want %q", loadedPlaylist.TrackFiles[0].RootName, "Main Library")
	}
}
