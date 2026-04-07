package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	if runSilphiumHelperProcess() {
		return
	}

	os.Exit(m.Run())
}

func runSilphiumHelperProcess() bool {
	switch strings.ToLower(filepath.Base(os.Args[0])) {
	case "ffmpeg", "ffmpeg.exe":
		if encoded := os.Getenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64"); encoded != "" {
			decoded, err := base64.StdEncoding.DecodeString(encoded)
			if err == nil {
				_, _ = os.Stdout.Write(decoded)
			}
		} else if stdout := os.Getenv("SILPHIUM_TEST_FFMPEG_STDOUT"); stdout != "" {
			_, _ = io.WriteString(os.Stdout, stdout)
		}
		if stderr := os.Getenv("SILPHIUM_TEST_FFMPEG_STDERR"); stderr != "" {
			_, _ = io.WriteString(os.Stderr, stderr)
		}
		os.Exit(helperProcessExitCode("SILPHIUM_TEST_FFMPEG_EXIT"))
	case "ffprobe", "ffprobe.exe":
		if stdout := os.Getenv("SILPHIUM_TEST_FFPROBE_JSON"); stdout != "" {
			_, _ = io.WriteString(os.Stdout, stdout)
		}
		if stderr := os.Getenv("SILPHIUM_TEST_FFPROBE_STDERR"); stderr != "" {
			_, _ = io.WriteString(os.Stderr, stderr)
		}
		os.Exit(helperProcessExitCode("SILPHIUM_TEST_FFPROBE_EXIT"))
	case "explorer", "explorer.exe":
		writeHelperMarkerFile(os.Getenv("SILPHIUM_TEST_EXPLORER_MARKER"), strings.Join(os.Args[1:], "\n"))
		os.Exit(0)
	case "sendto-helper", "sendto-helper.exe":
		writeHelperMarkerFile(os.Getenv("SILPHIUM_TEST_SENDTO_MARKER"), strings.Join(os.Args[1:], "\n"))
		if stdout := os.Getenv("SILPHIUM_TEST_SENDTO_STDOUT"); stdout != "" {
			_, _ = io.WriteString(os.Stdout, stdout)
		}
		if stderr := os.Getenv("SILPHIUM_TEST_SENDTO_STDERR"); stderr != "" {
			_, _ = io.WriteString(os.Stderr, stderr)
		}
		os.Exit(helperProcessExitCode("SILPHIUM_TEST_SENDTO_EXIT"))
	}

	return false
}

func helperProcessExitCode(envName string) int {
	rawValue := strings.TrimSpace(os.Getenv(envName))
	if rawValue == "" {
		return 0
	}

	value, err := strconv.Atoi(rawValue)
	if err != nil {
		return 0
	}

	return value
}

func writeHelperMarkerFile(path string, contents string) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return
	}

	if err := os.MkdirAll(filepath.Dir(cleanPath), 0o755); err != nil {
		return
	}

	_ = os.WriteFile(cleanPath, []byte(contents), 0o644)
}

func copyCurrentTestBinary(t *testing.T, dir string, name string) string {
	t.Helper()

	currentBinary, err := os.Executable()
	if err != nil {
		t.Fatalf("Executable() error = %v", err)
	}

	source, err := os.Open(currentBinary)
	if err != nil {
		t.Fatalf("Open(%q) error = %v", currentBinary, err)
	}
	defer source.Close()

	targetPath := filepath.Join(dir, name)
	target, err := os.Create(targetPath)
	if err != nil {
		t.Fatalf("Create(%q) error = %v", targetPath, err)
	}

	if _, err := io.Copy(target, source); err != nil {
		_ = target.Close()
		t.Fatalf("Copy(%q) error = %v", targetPath, err)
	}

	if err := target.Close(); err != nil {
		t.Fatalf("Close(%q) error = %v", targetPath, err)
	}

	if err := os.Chmod(targetPath, 0o755); err != nil {
		t.Fatalf("Chmod(%q) error = %v", targetPath, err)
	}

	return targetPath
}

func prependToPath(t *testing.T, dir string) {
	t.Helper()

	separator := string(os.PathListSeparator)
	currentPath := os.Getenv("PATH")
	if currentPath == "" {
		t.Setenv("PATH", dir)
		return
	}

	t.Setenv("PATH", fmt.Sprintf("%s%s%s", dir, separator, currentPath))
}
