package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const appSettingsFileName = "silphium.settings.json"

type FocusedKeyboardShortcuts struct {
	PlayPauseToggle    string `json:"playPauseToggle"`
	NextTrack          string `json:"nextTrack"`
	PreviousTrack      string `json:"previousTrack"`
	StopPlayback       string `json:"stopPlayback"`
	FocusLibraryFilter string `json:"focusLibraryFilter"`
	OpenSettings       string `json:"openSettings"`
}

// AppSettings stores persisted user configuration shared between frontend and backend.
type AppSettings struct {
	LibraryPath               string                   `json:"libraryPath"`
	ListenBrainzUserToken     string                   `json:"listenBrainzUserToken"`
	PlaybackOrder             string                   `json:"playbackOrder"`
	ReleaseDepth              int                      `json:"releaseDepth,omitempty"`
	FavoritePlaylists         []string                 `json:"favoritePlaylists,omitempty"`
	PreferMusicBrainzMetadata bool                     `json:"preferMusicBrainzMetadata"`
	KeyboardShortcuts         FocusedKeyboardShortcuts `json:"keyboardShortcuts"`
}

const defaultPlaybackOrder = "ordered-library"
const maxReleaseDepth = 64
const defaultShortcutPlayPauseToggle = "Space"
const defaultShortcutNextTrack = "N"
const defaultShortcutPreviousTrack = "P"
const defaultShortcutStopPlayback = "Z"
const defaultShortcutFocusLibraryFilter = "Ctrl+F"
const defaultShortcutOpenSettings = "Ctrl+P"

func normalizePlaybackOrder(value string) string {
	switch strings.TrimSpace(value) {
	case "ordered-album", "ordered-library", "shuffle-album", "shuffle-library":
		return strings.TrimSpace(value)
	default:
		return defaultPlaybackOrder
	}
}

func normalizeKeyboardShortcutBinding(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}

	return trimmed
}

func normalizeFocusedKeyboardShortcuts(shortcuts FocusedKeyboardShortcuts) FocusedKeyboardShortcuts {
	return FocusedKeyboardShortcuts{
		PlayPauseToggle:    normalizeKeyboardShortcutBinding(shortcuts.PlayPauseToggle, defaultShortcutPlayPauseToggle),
		NextTrack:          normalizeKeyboardShortcutBinding(shortcuts.NextTrack, defaultShortcutNextTrack),
		PreviousTrack:      normalizeKeyboardShortcutBinding(shortcuts.PreviousTrack, defaultShortcutPreviousTrack),
		StopPlayback:       normalizeKeyboardShortcutBinding(shortcuts.StopPlayback, defaultShortcutStopPlayback),
		FocusLibraryFilter: normalizeKeyboardShortcutBinding(shortcuts.FocusLibraryFilter, defaultShortcutFocusLibraryFilter),
		OpenSettings:       normalizeKeyboardShortcutBinding(shortcuts.OpenSettings, defaultShortcutOpenSettings),
	}
}

func normalizeAppSettings(settings AppSettings) AppSettings {
	token := strings.TrimSpace(settings.ListenBrainzUserToken)
	path := strings.TrimSpace(settings.LibraryPath)
	playbackOrder := normalizePlaybackOrder(settings.PlaybackOrder)
	releaseDepth := settings.ReleaseDepth
	preferMusicBrainzMetadata := settings.PreferMusicBrainzMetadata
	keyboardShortcuts := normalizeFocusedKeyboardShortcuts(settings.KeyboardShortcuts)
	favoritePlaylists := make([]string, 0, len(settings.FavoritePlaylists))
	seenFavoritePlaylists := make(map[string]struct{})
	for _, candidate := range settings.FavoritePlaylists {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}

		normalized := normalizePath(trimmed)
		if absolutePath, err := filepath.Abs(normalized); err == nil {
			normalized = filepath.Clean(absolutePath)
		}

		if _, exists := seenFavoritePlaylists[normalized]; exists {
			continue
		}

		seenFavoritePlaylists[normalized] = struct{}{}
		favoritePlaylists = append(favoritePlaylists, normalized)
	}
	if releaseDepth < 0 {
		releaseDepth = 0
	}
	if releaseDepth > maxReleaseDepth {
		releaseDepth = maxReleaseDepth
	}
	if path == "" {
		return AppSettings{ListenBrainzUserToken: token, PlaybackOrder: playbackOrder, ReleaseDepth: releaseDepth, FavoritePlaylists: favoritePlaylists, PreferMusicBrainzMetadata: preferMusicBrainzMetadata, KeyboardShortcuts: keyboardShortcuts}
	}

	path = normalizePath(path)
	if absolutePath, err := filepath.Abs(path); err == nil {
		path = filepath.Clean(absolutePath)
	}

	return AppSettings{
		LibraryPath:               path,
		ListenBrainzUserToken:     token,
		PlaybackOrder:             playbackOrder,
		ReleaseDepth:              releaseDepth,
		FavoritePlaylists:         favoritePlaylists,
		PreferMusicBrainzMetadata: preferMusicBrainzMetadata,
		KeyboardShortcuts:         keyboardShortcuts,
	}
}

func defaultSettingsPath() string {
	executablePath, err := os.Executable()
	if err != nil {
		return appSettingsFileName
	}

	return filepath.Join(filepath.Dir(executablePath), appSettingsFileName)
}

func readAppSettings(path string) (AppSettings, error) {
	rawBytes, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return AppSettings{}, nil
		}
		return AppSettings{}, err
	}

	var settings AppSettings
	if err := json.Unmarshal(rawBytes, &settings); err != nil {
		return AppSettings{}, err
	}

	return normalizeAppSettings(settings), nil
}

func writeAppSettings(path string, settings AppSettings) error {
	rawBytes, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	rawBytes = append(rawBytes, '\n')
	return os.WriteFile(path, rawBytes, 0o644)
}

func (a *App) ensureSettingsPath() string {
	if strings.TrimSpace(a.settingsPath) == "" {
		a.settingsPath = defaultSettingsPath()
	}

	return a.settingsPath
}

func (a *App) loadStoredSettings() {
	a.settingsLoaded = true
	settingsPath := a.ensureSettingsPath()
	settings, err := readAppSettings(settingsPath)
	if err != nil {
		return
	}

	a.settings = settings
	a.libraryRoot = settings.LibraryPath
	if settings.LibraryPath == "" {
		a.stopLibraryWatcher()
	}
}

func (a *App) ensureSettingsLoaded() {
	if a.settingsLoaded {
		return
	}

	a.loadStoredSettings()
}

// GetSettings returns the currently persisted application settings.
func (a *App) GetSettings() AppSettings {
	a.ensureSettingsLoaded()
	return a.settings
}

// SaveSettings validates, persists, and returns normalized application settings.
func (a *App) SaveSettings(settings AppSettings) (AppSettings, error) {
	a.ensureSettingsLoaded()

	normalized := normalizeAppSettings(settings)
	if err := writeAppSettings(a.ensureSettingsPath(), normalized); err != nil {
		return AppSettings{}, err
	}

	a.settings = normalized
	a.libraryRoot = normalized.LibraryPath
	if normalized.LibraryPath == "" {
		a.stopLibraryWatcher()
	}
	return normalized, nil
}
