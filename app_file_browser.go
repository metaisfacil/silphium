package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// OpenFolderInFileBrowser opens a folder in the operating system file browser.
func (a *App) OpenFolderInFileBrowser(path string) bool {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return false
	}

	if !filepath.IsAbs(cleanPath) {
		if root, ok := a.primaryActiveLibraryRoot(); ok {
			cleanPath = filepath.Join(root.Path, cleanPath)
		}
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

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", cleanPath)
	case "darwin":
		cmd = exec.Command("open", cleanPath)
	default:
		cmd = exec.Command("xdg-open", cleanPath)
	}

	if err := cmd.Start(); err != nil {
		return false
	}

	return true
}
