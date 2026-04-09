package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func waitForMarkerFile(t *testing.T, path string) string {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		contents, err := os.ReadFile(path)
		if err == nil && len(contents) > 0 {
			return string(contents)
		}
		time.Sleep(20 * time.Millisecond)
	}

	t.Fatalf("timed out waiting for marker file %q", path)
	return ""
}

func TestCustomActionHelpers(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: " "}, {Path: fixture.rootOne, Name: "Library"}}

	originalShellQuoteGOOS := shellQuoteGOOS
	t.Cleanup(func() {
		shellQuoteGOOS = originalShellQuoteGOOS
	})
	shellQuoteGOOS = "windows"
	if got := shellQuotePath(`C:\Music\Track "One".flac`); got != `"C:\Music\Track \"One\".flac"` {
		t.Fatalf("shellQuotePath() = %q, want %q", got, `"C:\Music\Track \"One\".flac"`)
	}
	shellQuoteGOOS = "linux"
	if got := shellQuotePath(`/music/O'Brien.flac`); got != `'`+`/music/O'"'"'Brien.flac`+`'` {
		t.Fatalf("shellQuotePath(posix) = %q, want escaped single-quoted path", got)
	}

	resolvedPath, ok := app.resolveAbsoluteLibraryPathFromVirtualPath("Library/Artist One/Album One/01 Intro.flac")
	if !ok || resolvedPath != fixture.trackOne {
		t.Fatalf("resolveAbsoluteLibraryPathFromVirtualPath() = (%q, %t), want (%q, true)", resolvedPath, ok, fixture.trackOne)
	}
	resolvedPath, ok = app.resolveAbsoluteLibraryPathFromVirtualPath("Library")
	if !ok || resolvedPath != fixture.rootOne {
		t.Fatalf("resolveAbsoluteLibraryPathFromVirtualPath(root) = (%q, %t), want (%q, true)", resolvedPath, ok, fixture.rootOne)
	}
	blankRootPathApp := &App{}
	blankRootPathApp.activeLibraryRoots = []libraryRootConfig{{Path: " ", Name: "Library"}}
	if _, ok := blankRootPathApp.resolveAbsoluteLibraryPathFromVirtualPath("Library/Artist One"); ok {
		t.Fatal("resolveAbsoluteLibraryPathFromVirtualPath(blank root path) = true, want false")
	}
	if _, ok := app.resolveAbsoluteLibraryPathFromVirtualPath("../escape"); ok {
		t.Fatal("resolveAbsoluteLibraryPathFromVirtualPath(escape) = true, want false")
	}

	if got := targetDirectoryForPath(fixture.trackOne); got != fixture.albumOneFolder {
		t.Fatalf("targetDirectoryForPath(file) = %q, want %q", got, fixture.albumOneFolder)
	}
	if got := targetDirectoryForPath(fixture.albumOneFolder); got != fixture.albumOneFolder {
		t.Fatalf("targetDirectoryForPath(dir) = %q, want %q", got, fixture.albumOneFolder)
	}

	if got := trimForLog(" 1234567890 ", 4); got != "1234..." {
		t.Fatalf("trimForLog() = %q, want %q", got, "1234...")
	}
	t.Setenv("SILPHIUM_EXPAND_ME", "expanded")
	if got := expandWindowsPercentEnvVariables("%SILPHIUM_EXPAND_ME%/path/%MISSING%"); got != "expanded/path/%MISSING%" {
		t.Fatalf("expandWindowsPercentEnvVariables() = %q, want %q", got, "expanded/path/%MISSING%")
	}

	argv, ok := splitCommandLineWindows(`cmd /C "C:\Path With Spaces\app.exe" "two words"`)
	if !ok || len(argv) != 4 {
		t.Fatalf("splitCommandLineWindows(valid) = (%#v, %t), want four args and true", argv, ok)
	}
	argv, ok = splitCommandLineWindows(`helper.exe "say \"hello\""`)
	if !ok || len(argv) != 2 || argv[1] != `say "hello"` {
		t.Fatalf("splitCommandLineWindows(escaped quotes) = (%#v, %t), want literal inner quotes", argv, ok)
	}
	if _, ok := splitCommandLineWindows("   "); ok {
		t.Fatal("splitCommandLineWindows(empty) = true, want false")
	}
	if _, ok := splitCommandLineWindows(`""`); ok {
		t.Fatal("splitCommandLineWindows(empty quoted) = true, want false")
	}
	if _, ok := splitCommandLineWindows(`cmd /C "unterminated`); ok {
		t.Fatal("splitCommandLineWindows(invalid) = true, want false")
	}

	argv, ok = splitCommandLinePOSIX(`"/tmp/helper tool" "two words"`)
	if !ok || len(argv) != 2 || argv[0] != "/tmp/helper tool" || argv[1] != "two words" {
		t.Fatalf("splitCommandLinePOSIX(valid) = (%#v, %t), want two parsed args", argv, ok)
	}
	argv, ok = splitCommandLinePOSIX(`helper 'say "hello"'`)
	if !ok || len(argv) != 2 || argv[1] != `say "hello"` {
		t.Fatalf("splitCommandLinePOSIX(single quotes) = (%#v, %t), want literal quoted content", argv, ok)
	}
	if _, ok := splitCommandLinePOSIX("   "); ok {
		t.Fatal("splitCommandLinePOSIX(empty) = true, want false")
	}
	if _, ok := splitCommandLinePOSIX(`""`); ok {
		t.Fatal("splitCommandLinePOSIX(empty quoted command) = true, want false")
	}
	if _, ok := splitCommandLinePOSIX(`helper "unterminated`); ok {
		t.Fatal("splitCommandLinePOSIX(invalid) = true, want false")
	}
	if !requiresPOSIXShell(`echo "$HOME"`) {
		t.Fatal("requiresPOSIXShell(env expansion) = false, want true")
	}
	if requiresPOSIXShell(`"/tmp/helper tool" "two words"`) {
		t.Fatal("requiresPOSIXShell(simple direct command) = true, want false")
	}
}

func TestRunCustomSendToAction(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	helperDir := t.TempDir()
	helperPath := copyCurrentTestBinary(t, helperDir, "sendto-helper.exe")
	markerPath := filepath.Join(helperDir, "sendto-marker.txt")
	template := `"` + helperPath + `" "{path_unquoted}" "{directory_unquoted}"`

	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	t.Setenv("SILPHIUM_TEST_SENDTO_EXIT", "0")
	t.Setenv("SILPHIUM_TEST_SENDTO_STDOUT", "")
	t.Setenv("SILPHIUM_TEST_SENDTO_STDERR", "")

	if app.RunCustomSendToAction("", fixture.trackOne) {
		t.Fatal("RunCustomSendToAction(empty template) = true, want false")
	}
	if app.RunCustomSendToAction(helperPath, "") {
		t.Fatal("RunCustomSendToAction(empty path) = true, want false")
	}
	if app.RunCustomSendToAction(helperPath, fixture.outsideTrack) {
		t.Fatal("RunCustomSendToAction(outside path) = true, want false")
	}
	if !app.RunCustomSendToAction(template, filepath.Join("Missing", "Track.flac")) {
		t.Fatal("RunCustomSendToAction(relative fallback path) = false, want true")
	}

	markerContents := waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, filepath.Join(fixture.rootOne, "Missing", "Track.flac")) {
		t.Fatalf("RunCustomSendToAction(relative path fallback) marker = %q, want joined fallback path", markerContents)
	}

	markerPath = filepath.Join(helperDir, "sendto-virtual-marker.txt")
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	if !app.RunCustomSendToAction(template, "Library/Artist One/Album One/01 Intro.flac") {
		t.Fatal("RunCustomSendToAction(virtual path) = false, want true")
	}
	markerContents = waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, fixture.trackOne) || !strings.Contains(markerContents, fixture.albumOneFolder) {
		t.Fatalf("RunCustomSendToAction(marker) = %q, want target file and directory", markerContents)
	}

	markerPath = filepath.Join(helperDir, "sendto-relative-marker.txt")
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	if !app.RunCustomSendToAction(template, filepath.Base(fixture.trackOne)) {
		t.Fatal("RunCustomSendToAction(relative fallback) = false, want true")
	}
	markerContents = waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, filepath.Join(fixture.rootOne, filepath.Base(fixture.trackOne))) {
		t.Fatalf("RunCustomSendToAction(relative fallback) marker = %q, want fallback path rooted at %q", markerContents, fixture.rootOne)
	}

	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", filepath.Join(helperDir, "unused.txt"))
	if app.RunCustomSendToAction(`missing-command.exe "{path_unquoted}"`, fixture.trackOne) {
		t.Fatal("RunCustomSendToAction(start error) = true, want false")
	}
	t.Setenv("SILPHIUM_EMPTY_COMMAND", "")
	if app.RunCustomSendToAction(`%SILPHIUM_EMPTY_COMMAND%`, fixture.trackOne) {
		t.Fatal("RunCustomSendToAction(empty after env expansion) = true, want false")
	}
	if !app.RunCustomSendToAction(`"`+helperPath+`" "{path_unquoted}`, fixture.trackOne) {
		t.Fatal("RunCustomSendToAction(shell fallback) = false, want true because cmd.exe should still start")
	}

	markerPath = filepath.Join(helperDir, "sendto-exit-error-marker.txt")
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	t.Setenv("SILPHIUM_TEST_SENDTO_EXIT", "3")
	t.Setenv("SILPHIUM_TEST_SENDTO_STDOUT", "stdout text")
	t.Setenv("SILPHIUM_TEST_SENDTO_STDERR", "stderr text")
	if !app.RunCustomSendToAction(template, fixture.trackOne) {
		t.Fatal("RunCustomSendToAction(non-zero exit) = false, want true because the process started")
	}
	markerContents = waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, fixture.trackOne) {
		t.Fatalf("RunCustomSendToAction(non-zero exit) marker = %q, want track path", markerContents)
	}

	markerPath = filepath.Join(helperDir, "sendto-success-output-marker.txt")
	t.Setenv("SILPHIUM_TEST_SENDTO_MARKER", markerPath)
	t.Setenv("SILPHIUM_TEST_SENDTO_EXIT", "0")
	t.Setenv("SILPHIUM_TEST_SENDTO_STDOUT", "stdout ok")
	t.Setenv("SILPHIUM_TEST_SENDTO_STDERR", "stderr ok")
	if !app.RunCustomSendToAction(template, fixture.trackOne) {
		t.Fatal("RunCustomSendToAction(success output) = false, want true")
	}
	markerContents = waitForMarkerFile(t, markerPath)
	if !strings.Contains(markerContents, fixture.trackOne) {
		t.Fatalf("RunCustomSendToAction(success output) marker = %q, want track path", markerContents)
	}
	time.Sleep(50 * time.Millisecond)
}
