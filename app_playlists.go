package main

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

// PlaylistLoadResult contains parsed playlist metadata and indexed tracks.
type PlaylistLoadResult struct {
	Name       string               `json:"name"`
	TrackFiles []LibraryIndexedFile `json:"trackFiles"`
}

// SavePlaylistFile writes the provided track paths to an M3U/M3U8 playlist file.
func (a *App) SavePlaylistFile(path string, trackPaths []string) bool {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return false
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return false
	}
	cleanPath = filepath.Clean(absolutePath)

	if mkdirErr := os.MkdirAll(filepath.Dir(cleanPath), 0o755); mkdirErr != nil {
		return false
	}

	var builder strings.Builder
	builder.WriteString("#EXTM3U\n")
	for _, trackPath := range trackPaths {
		trimmed := strings.TrimSpace(trackPath)
		if trimmed == "" {
			continue
		}

		builder.WriteString(trimmed)
		builder.WriteByte('\n')
	}

	if writeErr := os.WriteFile(cleanPath, []byte(builder.String()), 0o644); writeErr != nil {
		return false
	}

	return true
}

func resolvePlaylistEntryPath(playlistPath string, entry string) (string, bool) {
	clean := strings.TrimSpace(entry)
	if clean == "" || strings.HasPrefix(clean, "#") {
		return "", false
	}

	if strings.Contains(clean, "://") {
		return "", false
	}

	trimmed := strings.TrimLeftFunc(clean, unicode.IsSpace)
	if trimmed == "" {
		return "", false
	}

	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed), true
	}

	baseDir := filepath.Dir(playlistPath)
	return filepath.Clean(filepath.Join(baseDir, trimmed)), true
}

// LoadPlaylistFile parses a playlist and returns valid audio entries within the allowed library scope.
func (a *App) LoadPlaylistFile(path string) PlaylistLoadResult {
	cleanPath := normalizePath(path)
	result := PlaylistLoadResult{
		Name:       filepath.Base(cleanPath),
		TrackFiles: []LibraryIndexedFile{},
	}

	if cleanPath == "" {
		return result
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return result
	}
	cleanPath = filepath.Clean(absolutePath)
	result.Name = filepath.Base(cleanPath)

	fileHandle, err := os.Open(cleanPath)
	if err != nil {
		return result
	}
	defer fileHandle.Close()

	scanner := bufio.NewScanner(fileHandle)
	for scanner.Scan() {
		resolved, ok := resolvePlaylistEntryPath(cleanPath, scanner.Text())
		if !ok || !isAudioPath(resolved) {
			continue
		}

		if !a.isAllowedLibraryPath(resolved) {
			continue
		}

		fileInfo, statErr := os.Stat(resolved)
		if statErr != nil || fileInfo.IsDir() {
			continue
		}

		result.TrackFiles = append(result.TrackFiles, LibraryIndexedFile{
			Name:         filepath.Base(resolved),
			Path:         resolved,
			RelativePath: filepath.Base(resolved),
			FolderPath:   filepath.ToSlash(filepath.Dir(resolved)),
		})
	}

	return result
}
