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

type AppLibraryFolder struct {
	Path         string `json:"path"`
	Label        string `json:"label,omitempty"`
	ReleaseDepth int    `json:"releaseDepth,omitempty"`
}

// AppSettings stores persisted user configuration shared between frontend and backend.
type AppSettings struct {
	LibraryFolders            []AppLibraryFolder       `json:"libraryFolders,omitempty"`
	LibraryPath               string                   `json:"libraryPath,omitempty"`
	ListenBrainzUserToken     string                   `json:"listenBrainzUserToken"`
	PlaybackOrder             string                   `json:"playbackOrder"`
	ReleaseDepth              int                      `json:"releaseDepth,omitempty"`
	FavoritePlaylists         []string                 `json:"favoritePlaylists,omitempty"`
	CoverArtPriority          []string                 `json:"coverArtPriority,omitempty"`
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
const coverArtPriorityFile = "file"
const coverArtPriorityEmbedded = "embedded"

var defaultCoverArtPriority = []string{coverArtPriorityFile, coverArtPriorityEmbedded}

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

func normalizeCoverArtPriority(priority []string) []string {
	if len(priority) == 0 {
		return append([]string{}, defaultCoverArtPriority...)
	}

	ordered := make([]string, 0, len(defaultCoverArtPriority))
	seen := make(map[string]struct{}, len(defaultCoverArtPriority))
	for _, item := range priority {
		normalized := strings.ToLower(strings.TrimSpace(item))
		switch normalized {
		case coverArtPriorityFile, coverArtPriorityEmbedded:
			if _, exists := seen[normalized]; exists {
				continue
			}

			seen[normalized] = struct{}{}
			ordered = append(ordered, normalized)
		}
	}

	for _, fallback := range defaultCoverArtPriority {
		if _, exists := seen[fallback]; exists {
			continue
		}

		ordered = append(ordered, fallback)
	}

	if len(ordered) == 0 {
		return append([]string{}, defaultCoverArtPriority...)
	}

	return ordered
}

func normalizeReleaseDepth(value int) int {
	if value < 0 {
		return 0
	}

	if value > maxReleaseDepth {
		return maxReleaseDepth
	}

	return value
}

func normalizeLibraryFolderLabel(value string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\\", " "), "/", " "))
	if normalized == "" {
		return ""
	}

	return strings.Join(strings.Fields(normalized), " ")
}

func normalizeLibraryFolders(folders []AppLibraryFolder, legacyPath string, legacyReleaseDepth int) []AppLibraryFolder {
	candidates := make([]AppLibraryFolder, 0, len(folders)+1)
	if len(folders) > 0 {
		candidates = append(candidates, folders...)
	} else if strings.TrimSpace(legacyPath) != "" {
		candidates = append(candidates, AppLibraryFolder{
			Path:         legacyPath,
			ReleaseDepth: legacyReleaseDepth,
		})
	}

	normalizedFolders := make([]AppLibraryFolder, 0, len(candidates))
	seenPaths := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		normalizedPath := normalizePath(candidate.Path)
		if normalizedPath == "" {
			continue
		}

		if absolutePath, err := filepath.Abs(normalizedPath); err == nil {
			normalizedPath = filepath.Clean(absolutePath)
		}

		if _, exists := seenPaths[normalizedPath]; exists {
			continue
		}

		seenPaths[normalizedPath] = struct{}{}
		normalizedFolders = append(normalizedFolders, AppLibraryFolder{
			Path:         normalizedPath,
			Label:        normalizeLibraryFolderLabel(candidate.Label),
			ReleaseDepth: normalizeReleaseDepth(candidate.ReleaseDepth),
		})
	}

	return normalizedFolders
}

func normalizeAppSettings(settings AppSettings) AppSettings {
	token := strings.TrimSpace(settings.ListenBrainzUserToken)
	playbackOrder := normalizePlaybackOrder(settings.PlaybackOrder)
	libraryFolders := normalizeLibraryFolders(settings.LibraryFolders, settings.LibraryPath, settings.ReleaseDepth)
	coverArtPriority := normalizeCoverArtPriority(settings.CoverArtPriority)
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
	legacyLibraryPath := ""
	legacyReleaseDepth := 0
	if len(libraryFolders) > 0 {
		legacyLibraryPath = libraryFolders[0].Path
		legacyReleaseDepth = libraryFolders[0].ReleaseDepth
	}

	return AppSettings{
		LibraryFolders:            libraryFolders,
		LibraryPath:               legacyLibraryPath,
		ListenBrainzUserToken:     token,
		PlaybackOrder:             playbackOrder,
		ReleaseDepth:              legacyReleaseDepth,
		FavoritePlaylists:         favoritePlaylists,
		CoverArtPriority:          coverArtPriority,
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
	return normalized, nil
}
