package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPlaylistHelpersAndLoading(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}
	playlistPath := filepath.Join(fixture.tempDir, "playlists", "queue.m3u8")

	if _, ok := playlistFilePathForWrite(""); ok {
		t.Fatal("playlistFilePathForWrite(empty) = true, want false")
	}
	blockedParentPath := filepath.Join(fixture.tempDir, "blocked-parent")
	writeTestFile(t, blockedParentPath, "blocked")
	if _, ok := playlistFilePathForWrite(filepath.Join(blockedParentPath, "queue.m3u8")); ok {
		t.Fatal("playlistFilePathForWrite(blocked parent) = true, want false")
	}
	if _, ok := playlistFilePathForWrite(string([]byte{'b', 'a', 'd', 0})); ok {
		t.Fatal("playlistFilePathForWrite(invalid path) = true, want false")
	}
	cleanPlaylistPath, ok := playlistFilePathForWrite(playlistPath)
	if !ok || cleanPlaylistPath != filepath.Clean(playlistPath) {
		t.Fatalf("playlistFilePathForWrite() = (%q, %t), want cleaned path and true", cleanPlaylistPath, ok)
	}

	contents := writePlaylistContents([]string{"", "  ", fixture.trackOne, fixture.outsideTrack})
	if want := "#EXTM3U\n" + fixture.trackOne + "\n" + fixture.outsideTrack + "\n"; contents != want {
		t.Fatalf("writePlaylistContents() = %q, want %q", contents, want)
	}

	playlistDir := filepath.Join(fixture.tempDir, "playlist-dir")
	if err := os.MkdirAll(playlistDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", playlistDir, err)
	}
	if app.SavePlaylistFile("   ", []string{fixture.trackOne}) {
		t.Fatal("SavePlaylistFile(empty path) = true, want false")
	}
	if app.SavePlaylistFile(playlistDir, []string{fixture.trackOne}) {
		t.Fatal("SavePlaylistFile(directory target) = true, want false")
	}
	if !app.SavePlaylistFile(playlistPath, []string{fixture.trackOne}) {
		t.Fatal("SavePlaylistFile(valid) = false, want true")
	}

	if app.AppendTracksToPlaylistFile("   ", []string{fixture.trackOne}) {
		t.Fatal("AppendTracksToPlaylistFile(empty path) = true, want false")
	}
	if app.AppendTracksToPlaylistFile(playlistPath, []string{"", "   "}) {
		t.Fatal("AppendTracksToPlaylistFile(empty entries) = true, want false")
	}
	if app.AppendTracksToPlaylistFile(playlistDir, []string{fixture.trackOne}) {
		t.Fatal("AppendTracksToPlaylistFile(directory target) = true, want false")
	}
	newPlaylistPath := filepath.Join(fixture.tempDir, "playlists", "new-append.m3u8")
	if !app.AppendTracksToPlaylistFile(newPlaylistPath, []string{fixture.trackOne}) {
		t.Fatal("AppendTracksToPlaylistFile(new playlist) = false, want true")
	}
	newPlaylistContents, err := os.ReadFile(newPlaylistPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", newPlaylistPath, err)
	}
	if string(newPlaylistContents) != "#EXTM3U\n"+fixture.trackOne+"\n" {
		t.Fatalf("AppendTracksToPlaylistFile(new playlist) contents = %q, want header plus track", string(newPlaylistContents))
	}
	if err := os.WriteFile(playlistPath, []byte("#EXTM3U\n"+fixture.trackOne), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", playlistPath, err)
	}
	if !app.AppendTracksToPlaylistFile(playlistPath, []string{fixture.trackOne}) {
		t.Fatal("AppendTracksToPlaylistFile(valid) = false, want true")
	}
	readOnlyPlaylistPath := filepath.Join(fixture.tempDir, "playlists", "readonly.m3u8")
	if err := os.WriteFile(readOnlyPlaylistPath, []byte("#EXTM3U\n"+fixture.trackOne+"\n"), 0o444); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", readOnlyPlaylistPath, err)
	}
	if err := os.Chmod(readOnlyPlaylistPath, 0o444); err != nil {
		t.Fatalf("Chmod(%q) error = %v", readOnlyPlaylistPath, err)
	}
	if app.AppendTracksToPlaylistFile(readOnlyPlaylistPath, []string{fixture.trackOne}) {
		t.Fatal("AppendTracksToPlaylistFile(read-only target) = true, want false")
	}
	if err := os.Chmod(readOnlyPlaylistPath, 0o644); err != nil {
		t.Fatalf("Chmod(%q restore) error = %v", readOnlyPlaylistPath, err)
	}

	absPath, ok := resolvePlaylistEntryPath(playlistPath, fixture.trackOne)
	if !ok || absPath != fixture.trackOne {
		t.Fatalf("resolvePlaylistEntryPath(abs) = (%q, %t), want (%q, true)", absPath, ok, fixture.trackOne)
	}
	relativePath, ok := resolvePlaylistEntryPath(playlistPath, filepath.Base(fixture.trackOne))
	if !ok || relativePath != filepath.Join(filepath.Dir(playlistPath), filepath.Base(fixture.trackOne)) {
		t.Fatalf("resolvePlaylistEntryPath(relative) = (%q, %t), want joined path", relativePath, ok)
	}
	if _, ok := resolvePlaylistEntryPath(playlistPath, "   "); ok {
		t.Fatal("resolvePlaylistEntryPath(blank) = true, want false")
	}
	if _, ok := resolvePlaylistEntryPath(playlistPath, "#EXTINF:123"); ok {
		t.Fatal("resolvePlaylistEntryPath(comment) = true, want false")
	}
	if _, ok := resolvePlaylistEntryPath(playlistPath, "https://example.com"); ok {
		t.Fatal("resolvePlaylistEntryPath(url) = true, want false")
	}
	remoteBasePath := buildRemoteLibraryBasePath("example.com", 5005)
	remoteTrackPath := buildRemoteLibraryPath(remoteBasePath, "Shared Root/Album/01 Remote.flac")
	if _, ok := resolvePlaylistEntryPath(playlistPath, remoteTrackPath); ok {
		t.Fatal("resolvePlaylistEntryPath(remote) = true, want false")
	}

	outsidePlaylist := filepath.Join(fixture.tempDir, "outside.m3u8")
	if err := os.WriteFile(outsidePlaylist, []byte("#EXTM3U\n"+fixture.outsideTrack+"\n"+fixture.albumOneFolder+"\n"+filepath.Base(fixture.trackOne)+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", outsidePlaylist, err)
	}
	if loaded := app.LoadPlaylistFile("   "); loaded.Name != "." || len(loaded.TrackFiles) != 0 {
		t.Fatalf("LoadPlaylistFile(empty) = %#v, want empty result", loaded)
	}
	loadedPlaylist := app.LoadPlaylistFile(outsidePlaylist)
	if got, want := len(loadedPlaylist.TrackFiles), 0; got != want {
		t.Fatalf("LoadPlaylistFile(disallowed/relative missing) len = %d, want %d", got, want)
	}
	missingAudioPath := filepath.Join(fixture.albumOneFolder, "02 Missing.flac")
	directoryAudioPath := filepath.Join(fixture.albumOneFolder, "03 Folder.flac")
	if err := os.MkdirAll(directoryAudioPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", directoryAudioPath, err)
	}
	statSkipPlaylist := filepath.Join(fixture.albumOneFolder, "stat-skip.m3u8")
	if err := os.WriteFile(statSkipPlaylist, []byte("#EXTM3U\n"+missingAudioPath+"\n"+directoryAudioPath+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", statSkipPlaylist, err)
	}
	loadedPlaylist = app.LoadPlaylistFile(statSkipPlaylist)
	if got := len(loadedPlaylist.TrackFiles); got != 0 {
		t.Fatalf("LoadPlaylistFile(stat skip entries) len = %d, want 0", got)
	}

	allowedPlaylist := filepath.Join(fixture.albumOneFolder, "allowed.m3u8")
	if err := os.WriteFile(allowedPlaylist, []byte("#EXTM3U\n"+fixture.trackOne+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", allowedPlaylist, err)
	}
	loadedPlaylist = app.LoadPlaylistFile(allowedPlaylist)
	if got, want := len(loadedPlaylist.TrackFiles), 1; got != want {
		t.Fatalf("LoadPlaylistFile(allowed) len = %d, want %d", got, want)
	}
	if loadedPlaylist.TrackFiles[0].RootName != "Library" {
		t.Fatalf("LoadPlaylistFile(allowed) rootName = %q, want %q", loadedPlaylist.TrackFiles[0].RootName, "Library")
	}
	appWithCache := NewApp()
	appWithCache.settingsPath = filepath.Join(fixture.tempDir, "settings.json")
	appWithCache.settingsLoaded = true
	appWithCache.settings = normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled: boolPointer(true),
	})
	appWithCache.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}
	if ok := appWithCache.SavePlaylistTrackMetadataCache([]PlaylistTrackMetadataCacheEntry{{
		TrackPath:  fixture.trackOne,
		TrackName:  "Cached Intro",
		ArtistName: "Cached Artist",
	}}); !ok {
		t.Fatal("SavePlaylistTrackMetadataCache(valid) = false, want true")
	}
	loadedPlaylist = appWithCache.LoadPlaylistFile(allowedPlaylist)
	if got := loadedPlaylist.TrackFiles[0].CachedTrackTitle; got != "Cached Intro" {
		t.Fatalf("LoadPlaylistFile(allowed cached) title = %q, want %q", got, "Cached Intro")
	}
	if got := loadedPlaylist.TrackFiles[0].CachedArtistName; got != "Cached Artist" {
		t.Fatalf("LoadPlaylistFile(allowed cached) artist = %q, want %q", got, "Cached Artist")
	}

	relativeAllowedPlaylist := filepath.Join(fixture.albumOneFolder, "relative-allowed.m3u8")
	if err := os.WriteFile(relativeAllowedPlaylist, []byte("#EXTM3U\n01 Intro.flac\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", relativeAllowedPlaylist, err)
	}
	loadedPlaylist = app.LoadPlaylistFile(relativeAllowedPlaylist)
	if got, want := len(loadedPlaylist.TrackFiles), 1; got != want {
		t.Fatalf("LoadPlaylistFile(relative allowed) len = %d, want %d", got, want)
	}
	if loadedPlaylist.TrackFiles[0].Path != fixture.trackOne || loadedPlaylist.TrackFiles[0].RootName != "Library" {
		t.Fatalf("LoadPlaylistFile(relative allowed) = %#v, want indexed library track", loadedPlaylist.TrackFiles[0])
	}

	missingPlaylist := app.LoadPlaylistFile(filepath.Join(fixture.tempDir, "missing.m3u8"))
	if got := len(missingPlaylist.TrackFiles); got != 0 {
		t.Fatalf("LoadPlaylistFile(missing) len = %d, want 0", got)
	}

	fallbackApp := &App{}
	loadedPlaylist = fallbackApp.LoadPlaylistFile(allowedPlaylist)
	if got, want := len(loadedPlaylist.TrackFiles), 1; got != want {
		t.Fatalf("LoadPlaylistFile(no roots) len = %d, want %d", got, want)
	}
	if loadedPlaylist.TrackFiles[0].RootName != "" {
		t.Fatalf("LoadPlaylistFile(no roots) rootName = %q, want empty", loadedPlaylist.TrackFiles[0].RootName)
	}

	remotePlaylistPath := filepath.Join(fixture.tempDir, "remote.m3u8")
	if err := os.WriteFile(remotePlaylistPath, []byte("#EXTM3U\n"+remoteTrackPath+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", remotePlaylistPath, err)
	}
	loadedPlaylist = app.LoadPlaylistFile(remotePlaylistPath)
	if got := len(loadedPlaylist.TrackFiles); got != 0 {
		t.Fatalf("LoadPlaylistFile(remote) len = %d, want 0", got)
	}
}
