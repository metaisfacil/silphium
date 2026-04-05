package main

import (
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var shareImageFilenameSanitizer = strings.NewReplacer(
	"<", "_",
	">", "_",
	":", "_",
	"\"", "_",
	"/", "_",
	"\\", "_",
	"|", "_",
	"?", "_",
	"*", "_",
)

func sanitizeShareImageFilename(defaultFilename string) string {
	cleanName := strings.TrimSpace(defaultFilename)
	if cleanName == "" {
		return "silphium-share.png"
	}

	cleanName = shareImageFilenameSanitizer.Replace(cleanName)
	cleanName = strings.Join(strings.Fields(cleanName), " ")
	cleanName = strings.TrimRight(cleanName, ". ")
	if cleanName == "" {
		return "silphium-share.png"
	}

	return cleanName
}

// SelectLibraryFolder opens a directory picker and returns the selected library path.
func (a *App) SelectLibraryFolder() string {
	selectedPath, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Music Library Folder",
	})
	if err != nil {
		return ""
	}

	return selectedPath
}

// SelectPlaylistFile opens a file picker and returns a selected M3U/M3U8 playlist path.
func (a *App) SelectPlaylistFile() string {
	selectedPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Playlist File",
		Filters: []runtime.FileFilter{{
			DisplayName: "Playlists",
			Pattern:     "*.m3u;*.m3u8",
		}},
	})
	if err != nil {
		return ""
	}

	return selectedPath
}

// SelectPlaylistSaveFile opens a save dialog and returns a target M3U/M3U8 path.
func (a *App) SelectPlaylistSaveFile() string {
	selectedPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Playlist As",
		DefaultFilename: "playlist.m3u8",
		Filters: []runtime.FileFilter{{
			DisplayName: "Playlists",
			Pattern:     "*.m3u;*.m3u8",
		}},
	})
	if err != nil {
		return ""
	}

	cleanPath := strings.TrimSpace(selectedPath)
	if cleanPath == "" {
		return ""
	}

	ext := strings.ToLower(filepath.Ext(cleanPath))
	if ext != ".m3u" && ext != ".m3u8" {
		cleanPath += ".m3u8"
	}

	return cleanPath
}

// SelectShareImageSaveFile opens a save dialog and returns a target PNG path for the current share image.
func (a *App) SelectShareImageSaveFile(defaultFilename string) string {
	selectedPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Share Image As",
		DefaultFilename: sanitizeShareImageFilename(defaultFilename),
		Filters: []runtime.FileFilter{{
			DisplayName: "PNG Images",
			Pattern:     "*.png",
		}},
	})
	if err != nil {
		return ""
	}

	cleanPath := strings.TrimSpace(selectedPath)
	if cleanPath == "" {
		return ""
	}

	if strings.ToLower(filepath.Ext(cleanPath)) != ".png" {
		cleanPath += ".png"
	}

	return cleanPath
}

// ShowErrorDialog displays an application error dialog with the provided title and message.
func (a *App) ShowErrorDialog(title string, message string) {
	cleanTitle := strings.TrimSpace(title)
	if cleanTitle == "" {
		cleanTitle = "Error"
	}

	cleanMessage := strings.TrimSpace(message)
	if cleanMessage == "" {
		cleanMessage = "An unexpected error occurred."
	}

	_, _ = runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type:    runtime.ErrorDialog,
		Title:   cleanTitle,
		Message: cleanMessage,
		Buttons: []string{"OK"},
	})
}
