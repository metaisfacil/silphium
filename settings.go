package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const appSettingsFileName = "silphium.settings.json"

// AppSettings stores persisted user configuration shared between frontend and backend.
type AppSettings struct {
	LibraryPath               string   `json:"libraryPath"`
	ListenBrainzUserToken     string   `json:"listenBrainzUserToken"`
	PlaybackOrder             string   `json:"playbackOrder"`
	ReleaseDepth              int      `json:"releaseDepth,omitempty"`
	FavoritePlaylists         []string `json:"favoritePlaylists,omitempty"`
	PreferMusicBrainzMetadata bool     `json:"preferMusicBrainzMetadata"`
}

const defaultPlaybackOrder = "ordered-library"
const maxReleaseDepth = 64

func normalizePlaybackOrder(value string) string {
	switch strings.TrimSpace(value) {
	case "ordered-album", "ordered-library", "shuffle-album", "shuffle-library":
		return strings.TrimSpace(value)
	default:
		return defaultPlaybackOrder
	}
}

func normalizeAppSettings(settings AppSettings) AppSettings {
	token := strings.TrimSpace(settings.ListenBrainzUserToken)
	path := strings.TrimSpace(settings.LibraryPath)
	playbackOrder := normalizePlaybackOrder(settings.PlaybackOrder)
	releaseDepth := settings.ReleaseDepth
	preferMusicBrainzMetadata := settings.PreferMusicBrainzMetadata
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
		return AppSettings{ListenBrainzUserToken: token, PlaybackOrder: playbackOrder, ReleaseDepth: releaseDepth, FavoritePlaylists: favoritePlaylists, PreferMusicBrainzMetadata: preferMusicBrainzMetadata}
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
	if settings.LibraryPath != "" {
		a.libraryRoot = settings.LibraryPath
		a.startLibraryWatcher(settings.LibraryPath)
		return
	}

	a.stopLibraryWatcher()
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
	} else {
		a.startLibraryWatcher(normalized.LibraryPath)
	}
	return normalized, nil
}
