package main

import (
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var runtimeOpenDirectoryDialog = runtime.OpenDirectoryDialog
var runtimeOpenFileDialog = runtime.OpenFileDialog
var runtimeSaveFileDialog = runtime.SaveFileDialog
var runtimeMessageDialog = runtime.MessageDialog

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
	return profiledValue(a, "SelectLibraryFolder", func() string {
		runtimeState := a.runtimeState()
		selectedPath, err := runtimeOpenDirectoryDialog(runtimeState.ctx, runtime.OpenDialogOptions{
			Title: "Select Music Library Folder",
		})
		if err != nil {
			return ""
		}

		return selectedPath
	})
}

// SelectPlaylistFile opens a file picker and returns a selected M3U/M3U8 playlist path.
func (a *App) SelectPlaylistFile() string {
	return profiledValue(a, "SelectPlaylistFile", func() string {
		runtimeState := a.runtimeState()
		selectedPath, err := runtimeOpenFileDialog(runtimeState.ctx, runtime.OpenDialogOptions{
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
	})
}

// SelectPlaylistSaveFile opens a save dialog and returns a target M3U/M3U8 path.
func (a *App) SelectPlaylistSaveFile() string {
	return profiledValue(a, "SelectPlaylistSaveFile", func() string {
		runtimeState := a.runtimeState()
		selectedPath, err := runtimeSaveFileDialog(runtimeState.ctx, runtime.SaveDialogOptions{
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
	})
}

// SelectShareImageSaveFile opens a save dialog and returns a target PNG path for the current share image.
func (a *App) SelectShareImageSaveFile(defaultFilename string) string {
	return profiledValue(a, "SelectShareImageSaveFile", func() string {
		runtimeState := a.runtimeState()
		selectedPath, err := runtimeSaveFileDialog(runtimeState.ctx, runtime.SaveDialogOptions{
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
	})
}

// ShowErrorDialog displays an application error dialog with the provided title and message.
func (a *App) ShowErrorDialog(title string, message string) {
	profiledVoid(a, "ShowErrorDialog", func() {
		runtimeState := a.runtimeState()
		cleanTitle := strings.TrimSpace(title)
		if cleanTitle == "" {
			cleanTitle = "Error"
		}

		cleanMessage := strings.TrimSpace(message)
		if cleanMessage == "" {
			cleanMessage = "An unexpected error occurred."
		}

		_, _ = runtimeMessageDialog(runtimeState.ctx, runtime.MessageDialogOptions{
			Type:    runtime.ErrorDialog,
			Title:   cleanTitle,
			Message: cleanMessage,
			Buttons: []string{"OK"},
		})
	})
}
