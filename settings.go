package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const appSettingsFileName = "silphium.settings.json"

type AppSettings struct {
	LibraryPath string `json:"libraryPath"`
}

func normalizeAppSettings(settings AppSettings) AppSettings {
	path := strings.TrimSpace(settings.LibraryPath)
	if path == "" {
		return AppSettings{}
	}

	path = normalizePath(path)
	if absolutePath, err := filepath.Abs(path); err == nil {
		path = filepath.Clean(absolutePath)
	}

	return AppSettings{LibraryPath: path}
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
	}
}

func (a *App) ensureSettingsLoaded() {
	if a.settingsLoaded {
		return
	}

	a.loadStoredSettings()
}

func (a *App) GetSettings() AppSettings {
	a.ensureSettingsLoaded()
	return a.settings
}

func (a *App) SaveSettings(settings AppSettings) (AppSettings, error) {
	a.ensureSettingsLoaded()

	normalized := normalizeAppSettings(settings)
	if err := writeAppSettings(a.ensureSettingsPath(), normalized); err != nil {
		return AppSettings{}, err
	}

	a.settings = normalized
	a.libraryRoot = normalized.LibraryPath
	return normalized, nil
}
