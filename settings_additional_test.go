package main

import (
	"errors"
	"os"
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
		{name: "localhost without scheme", url: "localhost:5000", want: true},
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

func TestNormalizeAppSettingsMusicBrainzRefreshDefaults(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{})
	if settings.MusicBrainzTagStaleDays == nil || *settings.MusicBrainzTagStaleDays != defaultMusicBrainzTagStaleDays {
		t.Fatalf("MusicBrainzTagStaleDays = %#v, want %d", settings.MusicBrainzTagStaleDays, defaultMusicBrainzTagStaleDays)
	}

	settings = normalizeAppSettings(AppSettings{MusicBrainzTagStaleDays: intPointer(-10)})
	if settings.MusicBrainzTagStaleDays == nil || *settings.MusicBrainzTagStaleDays != defaultMusicBrainzTagStaleDays {
		t.Fatalf("negative MusicBrainzTagStaleDays = %#v, want %d", settings.MusicBrainzTagStaleDays, defaultMusicBrainzTagStaleDays)
	}

	settings = normalizeAppSettings(AppSettings{MusicBrainzTagStaleDays: intPointer(0)})
	if settings.MusicBrainzTagStaleDays == nil || *settings.MusicBrainzTagStaleDays != 0 {
		t.Fatalf("zero MusicBrainzTagStaleDays = %#v, want 0", settings.MusicBrainzTagStaleDays)
	}

	settings = normalizeAppSettings(AppSettings{MusicBrainzTagStaleDays: intPointer(maxMusicBrainzTagStaleDays + 5)})
	if settings.MusicBrainzTagStaleDays == nil || *settings.MusicBrainzTagStaleDays != maxMusicBrainzTagStaleDays {
		t.Fatalf("clamped MusicBrainzTagStaleDays = %#v, want %d", settings.MusicBrainzTagStaleDays, maxMusicBrainzTagStaleDays)
	}
}

func TestReadAndWriteAppSettingsRoundTrip(t *testing.T) {
	tempDir := t.TempDir()
	settingsPath := filepath.Join(tempDir, appSettingsFileName)
	configuredFFmpegPath := filepath.Join(tempDir, "bin", "ffmpeg.exe")
	rawSettings := AppSettings{
		LibraryPath:                            filepath.Join(tempDir, "Library"),
		ReleaseDepth:                           3,
		FFmpegPath:                             "\"" + configuredFFmpegPath + "\"",
		MusicBrainzServerURL:                   " https://musicbrainz.org/ ",
		MusicBrainzRequestRateMs:               0,
		ListenBrainzServerURL:                  " http://localhost:6000/ ",
		ListenBrainzRequestRateMs:              -1,
		CoverArtPriority:                       []string{"musicbrainz", "file"},
		MusicBrainzTagStaleDays:                intPointer(0),
		MusicBrainzTagRequestStaggeringEnabled: true,
		MusicBrainzTagWorkerCores:              0,
		KeyboardShortcuts:                      FocusedKeyboardShortcuts{NextTrack: "J"},
		PreferMusicBrainzMetadata:              true,
		MusicBrainzTagDatabaseEnabled:          true,
		HighlightMusicBrainzTaggedAlbumFolders: true,
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
	if settings.MusicBrainzTagStaleDays == nil || *settings.MusicBrainzTagStaleDays != 0 {
		t.Fatalf("MusicBrainzTagStaleDays = %#v, want 0", settings.MusicBrainzTagStaleDays)
	}
	if !settings.MusicBrainzTagRequestStaggeringEnabled {
		t.Fatal("expected MusicBrainzTagRequestStaggeringEnabled to remain enabled")
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
	if !settings.HighlightMusicBrainzTaggedAlbumFolders {
		t.Fatal("expected HighlightMusicBrainzTaggedAlbumFolders to remain enabled")
	}
}

func TestSettingsPathAndLoadHelpers(t *testing.T) {
	originalOSExecutable := osExecutable
	t.Cleanup(func() {
		osExecutable = originalOSExecutable
	})

	tempDir := t.TempDir()
	defaultExecutablePath := filepath.Join(tempDir, "bin", "silphium.exe")
	osExecutable = func() (string, error) {
		return defaultExecutablePath, nil
	}
	if got := defaultSettingsPath(); got != filepath.Join(filepath.Dir(defaultExecutablePath), appSettingsFileName) {
		t.Fatalf("defaultSettingsPath() = %q, want %q", got, filepath.Join(filepath.Dir(defaultExecutablePath), appSettingsFileName))
	}

	osExecutable = func() (string, error) {
		return "", errors.New("boom")
	}
	if got := defaultSettingsPath(); got != appSettingsFileName {
		t.Fatalf("defaultSettingsPath(error) = %q, want %q", got, appSettingsFileName)
	}

	missingPath := filepath.Join(tempDir, "missing.json")
	settings, err := readAppSettings(missingPath)
	if err != nil || !reflect.DeepEqual(settings, AppSettings{}) {
		t.Fatalf("readAppSettings(missing) = (%#v, %v), want empty settings and nil error", settings, err)
	}

	invalidJSONPath := filepath.Join(tempDir, "invalid.json")
	writeTestFile(t, invalidJSONPath, "{")
	if _, err := readAppSettings(invalidJSONPath); err == nil {
		t.Fatal("readAppSettings(invalid json) error = nil, want error")
	}

	blockedPath := filepath.Join(tempDir, "blocked")
	if err := os.MkdirAll(blockedPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", blockedPath, err)
	}
	if err := writeAppSettings(blockedPath, AppSettings{}); err == nil {
		t.Fatal("writeAppSettings(directory path) error = nil, want error")
	}

	storedSettingsPath := filepath.Join(tempDir, appSettingsFileName)
	if err := writeAppSettings(storedSettingsPath, AppSettings{LibraryPath: tempDir, ReleaseDepth: 2}); err != nil {
		t.Fatalf("writeAppSettings(stored) error = %v", err)
	}

	app := &App{}
	app.settingsPath = storedSettingsPath
	if got := app.ensureSettingsPath(); got != storedSettingsPath {
		t.Fatalf("ensureSettingsPath(existing) = %q, want %q", got, storedSettingsPath)
	}
	app.ensureSettingsLoaded()
	if !app.settingsLoaded || app.settings.LibraryPath != tempDir || app.settings.ReleaseDepth != 2 {
		t.Fatalf("ensureSettingsLoaded() = loaded:%t settings:%#v, want stored settings", app.settingsLoaded, app.settings)
	}

	writeTestFile(t, storedSettingsPath, "{\n  \"libraryPath\": \"ignored\"\n}\n")
	app.ensureSettingsLoaded()
	if app.settings.LibraryPath != tempDir {
		t.Fatalf("ensureSettingsLoaded(second call) library path = %q, want original loaded value", app.settings.LibraryPath)
	}

	failingApp := &App{}
	failingApp.settingsPath = invalidJSONPath
	failingApp.loadStoredSettings()
	if !failingApp.settingsLoaded {
		t.Fatal("loadStoredSettings(error) should still mark settings as loaded")
	}
	if !reflect.DeepEqual(failingApp.settings, AppSettings{}) {
		t.Fatalf("loadStoredSettings(error) settings = %#v, want zero value", failingApp.settings)
	}

	osExecutable = func() (string, error) {
		return filepath.Join(tempDir, "resolved", "silphium.exe"), nil
	}
	defaultPathApp := &App{}
	if got := defaultPathApp.ensureSettingsPath(); got != filepath.Join(tempDir, "resolved", appSettingsFileName) {
		t.Fatalf("ensureSettingsPath(default) = %q, want %q", got, filepath.Join(tempDir, "resolved", appSettingsFileName))
	}

	failingSaveApp := newTestAppWithSettingsLoaded()
	failingSaveApp.settingsPath = blockedPath
	if _, err := failingSaveApp.SaveSettings(AppSettings{}); err == nil {
		t.Fatal("SaveSettings(write error) error = nil, want error")
	}
}

func TestSettingsAdditionalNormalizationBranches(t *testing.T) {
	if got := normalizeScrobbleRuleOperator("bogus", scrobbleRuleFieldTrackArtist); got != defaultScrobbleRuleOperator(scrobbleRuleFieldTrackArtist) {
		t.Fatalf("normalizeScrobbleRuleOperator(invalid non-track) = %q, want %q", got, defaultScrobbleRuleOperator(scrobbleRuleFieldTrackArtist))
	}
	if got := normalizeScrobbleRuleValue(scrobbleRuleFieldGenre, scrobbleRuleOperatorContains, "   "); got != "" {
		t.Fatalf("normalizeScrobbleRuleValue(empty) = %q, want empty", got)
	}

	rules := normalizeScrobbleRules([]ScrobbleRule{
		{Field: "bogus", Operator: scrobbleRuleOperatorContains, Value: "ignored"},
		{Field: scrobbleRuleFieldGenre, Operator: "bogus", Value: " rock "},
	}, nil)
	if !reflect.DeepEqual(rules, []ScrobbleRule{{
		Field:    scrobbleRuleFieldGenre,
		Operator: defaultScrobbleRuleOperator(scrobbleRuleFieldGenre),
		Value:    "rock",
	}}) {
		t.Fatalf("normalizeScrobbleRules(additional branches) = %#v, want one normalized genre rule", rules)
	}

	if got := normalizeCoverArtPriority([]string{}); !reflect.DeepEqual(got, []string{}) {
		t.Fatalf("normalizeCoverArtPriority(empty slice) = %#v, want empty slice", got)
	}
	if isLocalBrainzServerURL("http://:5000") {
		t.Fatal("isLocalBrainzServerURL(hostless) = true, want false")
	}
	if isLocalBrainzServerURL("http://[2001:db8::1]:5000") {
		t.Fatal("isLocalBrainzServerURL(non-loopback ipv6) = true, want false")
	}

	tempDir := t.TempDir()
	blockedPath := filepath.Join(tempDir, "blocked-dir")
	if err := os.MkdirAll(blockedPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", blockedPath, err)
	}
	if _, err := readAppSettings(blockedPath); err == nil {
		t.Fatal("readAppSettings(directory path) error = nil, want error")
	}
}

func TestSettingsAdditionalWriteAndPathBranches(t *testing.T) {
	originalJSONMarshalIndent := jsonMarshalIndent
	t.Cleanup(func() {
		jsonMarshalIndent = originalJSONMarshalIndent
	})

	jsonMarshalIndent = func(_ interface{}, _ string, _ string) ([]byte, error) {
		return nil, errors.New("marshal failed")
	}
	if err := writeAppSettings(filepath.Join(t.TempDir(), appSettingsFileName), AppSettings{}); err == nil || err.Error() != "marshal failed" {
		t.Fatalf("writeAppSettings(marshal error) = %v, want marshal failure", err)
	}

	invalidPath := string([]byte{'M', 'u', 's', 'i', 'c', 0, 'X'})
	if got, want := normalizeScrobbleRuleValue(scrobbleRuleFieldPath, scrobbleRuleOperatorStartsWith, invalidPath), normalizePath(invalidPath); got != want {
		t.Fatalf("normalizeScrobbleRuleValue(path abs error) = %q, want %q", got, want)
	}
}
