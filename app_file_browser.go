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

// OpenFolderInFileBrowser opens a folder in the operating system file browser.
func (a *App) OpenFolderInFileBrowser(path string) bool {
	return profiledValue(a, "OpenFolderInFileBrowser", func() bool {
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

		cmd := openFolderInBrowserCommand(cleanPath)

		if err := cmd.Start(); err != nil {
			return false
		}

		return true
	})
}
