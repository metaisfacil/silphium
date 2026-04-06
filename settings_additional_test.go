package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestIsLocalBrainzServerURL(t *testing.T) {
	testCases := []struct {
		name string
		url  string
		want bool
	}{
		{name: "empty URL", url: "", want: false},
		{name: "localhost", url: "http://localhost:5000", want: true},
		{name: "ipv4 loopback", url: "http://127.0.0.1:5000", want: true},
		{name: "ipv6 loopback", url: "http://[::1]:5000", want: true},
		{name: "192.168 private range", url: "http://192.168.1.20:5000", want: true},
		{name: "10.0 private range", url: "http://10.0.4.20:5000", want: true},
		{name: "other 10.x address", url: "http://10.1.4.20:5000", want: false},
		{name: "public host", url: "https://musicbrainz.org", want: false},
		{name: "invalid host", url: "://bad", want: false},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isLocalBrainzServerURL(testCase.url); got != testCase.want {
				t.Fatalf("isLocalBrainzServerURL(%q) = %t, want %t", testCase.url, got, testCase.want)
			}
		})
	}
}

func TestNormalizeAppSettingsLibraryFoldersAndFavorites(t *testing.T) {
	tempDir := t.TempDir()
	libraryPath := filepath.Join(tempDir, "Music")
	playlistPath := filepath.Join(tempDir, "Favorites.m3u")

	settings := normalizeAppSettings(AppSettings{
		LibraryFolders: []AppLibraryFolder{
			{Path: libraryPath + string(filepath.Separator), Label: " Main / Library ", ReleaseDepth: 99},
			{Path: libraryPath, Label: "Duplicate", ReleaseDepth: 1},
			{Path: "   ", Label: "Ignored", ReleaseDepth: 1},
		},
		FavoritePlaylists: []string{
			"  " + playlistPath + "  ",
			playlistPath,
			"   ",
		},
	})

	if len(settings.LibraryFolders) != 1 {
		t.Fatalf("expected 1 normalized library folder, got %d", len(settings.LibraryFolders))
	}

	expectedLibraryPath := filepath.Clean(libraryPath)
	if settings.LibraryFolders[0].Path != expectedLibraryPath {
		t.Fatalf("library folder path = %q, want %q", settings.LibraryFolders[0].Path, expectedLibraryPath)
	}
	if settings.LibraryFolders[0].Label != "Main Library" {
		t.Fatalf("library folder label = %q, want %q", settings.LibraryFolders[0].Label, "Main Library")
	}
	if settings.LibraryFolders[0].ReleaseDepth != maxReleaseDepth {
		t.Fatalf("library folder release depth = %d, want %d", settings.LibraryFolders[0].ReleaseDepth, maxReleaseDepth)
	}
	if settings.LibraryPath != expectedLibraryPath {
		t.Fatalf("legacy library path = %q, want %q", settings.LibraryPath, expectedLibraryPath)
	}
	if settings.ReleaseDepth != maxReleaseDepth {
		t.Fatalf("legacy release depth = %d, want %d", settings.ReleaseDepth, maxReleaseDepth)
	}

	if !reflect.DeepEqual(settings.FavoritePlaylists, []string{playlistPath}) {
		t.Fatalf("favorite playlists = %#v, want %#v", settings.FavoritePlaylists, []string{playlistPath})
	}
}

func TestNormalizeAppSettingsAudioCoverArtAndShortcuts(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{
		CoverArtPriority: []string{" embedded ", "MUSICBRAINZ", "file", "embedded", "invalid"},
		Audio: AudioSettings{
			OutputDevice:      "  USB DAC  ",
			OutputBufferMs:    5000,
			GaplessPlayback:   true,
			ReplayGainEnabled: true,
		},
		KeyboardShortcuts: FocusedKeyboardShortcuts{
			PlayPauseToggle:    " ",
			NextTrack:          "Ctrl+N",
			PreviousTrack:      "",
			StopPlayback:       "S",
			FocusLibraryFilter: " ",
			OpenSettings:       "Alt+P",
		},
	})

	if !reflect.DeepEqual(settings.CoverArtPriority, []string{"embedded", "musicbrainz", "file"}) {
		t.Fatalf("cover art priority = %#v, want %#v", settings.CoverArtPriority, []string{"embedded", "musicbrainz", "file"})
	}
	if settings.Audio.OutputDevice != "USB DAC" {
		t.Fatalf("audio output device = %q, want %q", settings.Audio.OutputDevice, "USB DAC")
	}
	if settings.Audio.OutputBufferMs != maxAudioOutputBufferMs {
		t.Fatalf("audio output buffer = %d, want %d", settings.Audio.OutputBufferMs, maxAudioOutputBufferMs)
	}
	if !settings.Audio.GaplessPlayback {
		t.Fatal("expected gapless playback to remain enabled")
	}
	if !settings.Audio.ReplayGainEnabled {
		t.Fatal("expected replaygain to remain enabled")
	}

	if settings.KeyboardShortcuts.PlayPauseToggle != defaultShortcutPlayPauseToggle {
		t.Fatalf("play/pause shortcut = %q, want %q", settings.KeyboardShortcuts.PlayPauseToggle, defaultShortcutPlayPauseToggle)
	}
	if settings.KeyboardShortcuts.NextTrack != "Ctrl+N" {
		t.Fatalf("next-track shortcut = %q, want %q", settings.KeyboardShortcuts.NextTrack, "Ctrl+N")
	}
	if settings.KeyboardShortcuts.PreviousTrack != defaultShortcutPreviousTrack {
		t.Fatalf("previous-track shortcut = %q, want %q", settings.KeyboardShortcuts.PreviousTrack, defaultShortcutPreviousTrack)
	}
	if settings.KeyboardShortcuts.StopPlayback != "S" {
		t.Fatalf("stop shortcut = %q, want %q", settings.KeyboardShortcuts.StopPlayback, "S")
	}
	if settings.KeyboardShortcuts.FocusLibraryFilter != defaultShortcutFocusLibraryFilter {
		t.Fatalf("focus shortcut = %q, want %q", settings.KeyboardShortcuts.FocusLibraryFilter, defaultShortcutFocusLibraryFilter)
	}
	if settings.KeyboardShortcuts.OpenSettings != "Alt+P" {
		t.Fatalf("open-settings shortcut = %q, want %q", settings.KeyboardShortcuts.OpenSettings, "Alt+P")
	}
}

func TestReadAndWriteAppSettingsRoundTrip(t *testing.T) {
	tempDir := t.TempDir()
	settingsPath := filepath.Join(tempDir, appSettingsFileName)
	configuredFFmpegPath := filepath.Join(tempDir, "bin", "ffmpeg.exe")
	rawSettings := AppSettings{
		LibraryPath:                   filepath.Join(tempDir, "Library"),
		ReleaseDepth:                  3,
		FFmpegPath:                    "\"" + configuredFFmpegPath + "\"",
		MusicBrainzServerURL:          " https://musicbrainz.org/ ",
		MusicBrainzRequestRateMs:      0,
		ListenBrainzServerURL:         " http://localhost:6000/ ",
		ListenBrainzRequestRateMs:     -1,
		CoverArtPriority:              []string{"musicbrainz", "file"},
		MusicBrainzTagWorkerCores:     0,
		KeyboardShortcuts:             FocusedKeyboardShortcuts{NextTrack: "J"},
		PreferMusicBrainzMetadata:     true,
		MusicBrainzTagDatabaseEnabled: true,
	}

	if err := writeAppSettings(settingsPath, rawSettings); err != nil {
		t.Fatalf("writeAppSettings() error = %v", err)
	}

	settings, err := readAppSettings(settingsPath)
	if err != nil {
		t.Fatalf("readAppSettings() error = %v", err)
	}

	if settings.FFmpegPath != configuredFFmpegPath {
		t.Fatalf("FFmpegPath = %q, want %q", settings.FFmpegPath, configuredFFmpegPath)
	}
	if settings.MusicBrainzServerURL != "https://musicbrainz.org" {
		t.Fatalf("MusicBrainzServerURL = %q, want %q", settings.MusicBrainzServerURL, "https://musicbrainz.org")
	}
	if settings.MusicBrainzRequestRateMs != publicBrainzMinRateLimitMs {
		t.Fatalf("MusicBrainzRequestRateMs = %d, want %d", settings.MusicBrainzRequestRateMs, publicBrainzMinRateLimitMs)
	}
	if settings.ListenBrainzServerURL != "http://localhost:6000" {
		t.Fatalf("ListenBrainzServerURL = %q, want %q", settings.ListenBrainzServerURL, "http://localhost:6000")
	}
	if settings.ListenBrainzRequestRateMs != 0 {
		t.Fatalf("ListenBrainzRequestRateMs = %d, want %d", settings.ListenBrainzRequestRateMs, 0)
	}
	if settings.LibraryPath != filepath.Join(tempDir, "Library") {
		t.Fatalf("LibraryPath = %q, want %q", settings.LibraryPath, filepath.Join(tempDir, "Library"))
	}
	if settings.ReleaseDepth != 3 {
		t.Fatalf("ReleaseDepth = %d, want %d", settings.ReleaseDepth, 3)
	}
	if !reflect.DeepEqual(settings.CoverArtPriority, []string{"musicbrainz", "file"}) {
		t.Fatalf("CoverArtPriority = %#v, want %#v", settings.CoverArtPriority, []string{"musicbrainz", "file"})
	}
	if settings.MusicBrainzTagWorkerCores < 1 || settings.MusicBrainzTagWorkerCores > maxMusicBrainzTagWorkerCores() {
		t.Fatalf("MusicBrainzTagWorkerCores = %d, want value in [1, %d]", settings.MusicBrainzTagWorkerCores, maxMusicBrainzTagWorkerCores())
	}
	if settings.KeyboardShortcuts.NextTrack != "J" {
		t.Fatalf("NextTrack shortcut = %q, want %q", settings.KeyboardShortcuts.NextTrack, "J")
	}
	if !settings.PreferMusicBrainzMetadata {
		t.Fatal("expected PreferMusicBrainzMetadata to remain enabled")
	}
	if !settings.MusicBrainzTagDatabaseEnabled {
		t.Fatal("expected MusicBrainzTagDatabaseEnabled to remain enabled")
	}
}
