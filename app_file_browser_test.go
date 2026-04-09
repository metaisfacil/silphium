package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestOpenFolderInFileBrowser(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	helperDir := t.TempDir()
	helperPath := copyCurrentTestBinary(t, helperDir, "sendto-helper.exe")
	originalOpenFolderInBrowserCommand := openFolderInBrowserCommand
	defaultCommand := originalOpenFolderInBrowserCommand(`C:\temp`)
	switch got := strings.ToLower(filepath.Base(defaultCommand.Path)); runtime.GOOS {
	case "windows":
		if got != "explorer" && got != "explorer.exe" {
			t.Fatalf("openFolderInBrowserCommand(default) path = %q, want explorer on Windows", defaultCommand.Path)
		}
	case "darwin":
		if got != "open" {
			t.Fatalf("openFolderInBrowserCommand(default) path = %q, want open on macOS", defaultCommand.Path)
		}
	default:
		if got != "xdg-open" {
			t.Fatalf("openFolderInBrowserCommand(default) path = %q, want xdg-open on non-Windows platforms", defaultCommand.Path)
		}
	}
	openFolderInBrowserCommand = func(path string) *exec.Cmd {
		return exec.Command(helperPath, path)
	}
	t.Cleanup(func() {
		openFolderInBrowserCommand = originalOpenFolderInBrowserCommand
	})

	markerPath := filepath.Join(helperDir, "explorer-marker.txt")
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	t.Setenv("SILPHIUM_TEST_SENDTO_EXIT", "0")
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}

	if app.OpenFolderInFileBrowser("") {
		t.Fatal("OpenFolderInFileBrowser(empty) = true, want false")
	}
	if app.OpenFolderInFileBrowser(fixture.outsideTrack) {
		t.Fatal("OpenFolderInFileBrowser(outside) = true, want false")
	}
	if app.OpenFolderInFileBrowser(filepath.Join(fixture.rootOne, "missing-folder")) {
		t.Fatal("OpenFolderInFileBrowser(missing) = true, want false")
	}
	fileRootApp := &App{}
	fileRootApp.activeLibraryRoots = []libraryRootConfig{{Path: fixture.trackOne, Name: filepath.Base(fixture.trackOne)}}
	if fileRootApp.OpenFolderInFileBrowser(fixture.trackOne) {
		t.Fatal("OpenFolderInFileBrowser(file root) = true, want false after directory fallback leaves allowed scope")
	}

	if !app.OpenFolderInFileBrowser(filepath.Join("Artist One", "Album One", filepath.Base(fixture.trackOne))) {
		t.Fatal("OpenFolderInFileBrowser(relative file) = false, want true")
	}
	markerContents := waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, fixture.albumOneFolder) {
		t.Fatalf("OpenFolderInFileBrowser(file) marker = %q, want album folder %q", markerContents, fixture.albumOneFolder)
	}

	markerPath = filepath.Join(helperDir, "explorer-dir-marker.txt")
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	if !app.OpenFolderInFileBrowser(fixture.albumOneFolder) {
		t.Fatal("OpenFolderInFileBrowser(dir) = false, want true")
	}
	markerContents = waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, fixture.albumOneFolder) {
		t.Fatalf("OpenFolderInFileBrowser(dir) marker = %q, want album folder %q", markerContents, fixture.albumOneFolder)
	}

	openFolderInBrowserCommand = func(path string) *exec.Cmd {
		return exec.Command(filepath.Join(t.TempDir(), "missing-helper.exe"), path)
	}
	if app.OpenFolderInFileBrowser(fixture.albumOneFolder) {
		t.Fatal("OpenFolderInFileBrowser(no explorer) = true, want false")
	}
}
