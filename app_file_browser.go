package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

var openFolderInBrowserCommand = func(path string) *exec.Cmd {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", path)
	case "darwin":
		return exec.Command("open", path)
	default:
		return exec.Command("xdg-open", path)
	}
}

var openFileInBrowserCommand = func(path string) *exec.Cmd {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", "/select,", path)
	case "darwin":
		return exec.Command("open", "-R", path)
	default:
		return exec.Command("xdg-open", filepath.Dir(path))
	}
}

func (a *App) resolveOpenInBrowserPath(path string) string {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return ""
	}

	if filepath.IsAbs(cleanPath) {
		return cleanPath
	}

	if a.looksLikeVirtualLibraryPath(cleanPath) {
		if resolvedPath, ok := a.resolveAbsoluteLibraryPathFromVirtualPath(cleanPath); ok {
			return resolvedPath
		}
		return ""
	}

	if root, ok := a.primaryActiveLibraryRoot(); ok {
		return filepath.Join(root.Path, cleanPath)
	}

	return cleanPath
}

// OpenFolderInFileBrowser opens a folder in the operating system file browser.
func (a *App) OpenFolderInFileBrowser(path string) bool {
	return profiledValue(a, "OpenFolderInFileBrowser", func() bool {
		cleanPath := a.resolveOpenInBrowserPath(path)
		if cleanPath == "" {
			return false
		}

		if !a.isAllowedLibraryPath(cleanPath) {
			return false
		}

		info, err := os.Stat(cleanPath)
		if err != nil {
			return false
		}

		if !info.IsDir() {
			cleanPath = filepath.Dir(cleanPath)
			if !a.isAllowedLibraryPath(cleanPath) {
				return false
			}
		}

		if cleanPath == "" {
			return false
		}

		cmd := openFolderInBrowserCommand(cleanPath)

		if err := cmd.Start(); err != nil {
			return false
		}

		return true
	})
}

// OpenFileInFileBrowser reveals a file in the operating system file browser.
func (a *App) OpenFileInFileBrowser(path string) bool {
	return profiledValue(a, "OpenFileInFileBrowser", func() bool {
		cleanPath := a.resolveOpenInBrowserPath(path)
		if cleanPath == "" {
			return false
		}

		if !a.isAllowedLibraryPath(cleanPath) {
			return false
		}

		info, err := os.Stat(cleanPath)
		if err != nil || info.IsDir() {
			return false
		}

		cmd := openFileInBrowserCommand(cleanPath)
		if err := cmd.Start(); err != nil {
			return false
		}

		return true
	})
}
