package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeExecutableStub(t *testing.T, path string) string {
	t.Helper()

	if err := os.WriteFile(path, []byte("stub"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}

	return path
}

func TestFFmpegPathHelpers(t *testing.T) {
	tempDir := t.TempDir()
	configuredFFmpeg := writeExecutableStub(t, filepath.Join(tempDir, "ffmpeg.exe"))
	configuredFFProbe := writeExecutableStub(t, filepath.Join(tempDir, "ffprobe.exe"))

	normalized := normalizeToolExecutablePath("  \"" + configuredFFmpeg + "\"  ")
	if normalized != filepath.Clean(configuredFFmpeg) {
		t.Fatalf("normalizeToolExecutablePath() = %q, want %q", normalized, filepath.Clean(configuredFFmpeg))
	}
	if got := normalizeToolExecutablePath("   "); got != "" {
		t.Fatalf("normalizeToolExecutablePath(empty) = %q, want empty", got)
	}

	resolvedPath, usingPathFallback, err := resolveConfiguredExecutablePath(configuredFFmpeg, "ffmpeg")
	if err != nil {
		t.Fatalf("resolveConfiguredExecutablePath(configured) error = %v", err)
	}
	if resolvedPath != configuredFFmpeg || usingPathFallback {
		t.Fatalf("resolveConfiguredExecutablePath(configured) = (%q, %t), want (%q, false)", resolvedPath, usingPathFallback, configuredFFmpeg)
	}

	if _, usingPathFallback, err := resolveConfiguredExecutablePath(filepath.Join(tempDir, "missing.exe"), "ffmpeg"); err == nil || usingPathFallback {
		t.Fatalf("resolveConfiguredExecutablePath(missing configured) = (_, %t, %v), want error with usingPathFallback=false", usingPathFallback, err)
	}

	prependToPath(t, tempDir)
	resolvedPath, usingPathFallback, err = resolveConfiguredExecutablePath("", "ffmpeg")
	if err != nil {
		t.Fatalf("resolveConfiguredExecutablePath(PATH fallback) error = %v", err)
	}
	if resolvedPath != configuredFFmpeg || !usingPathFallback {
		t.Fatalf("resolveConfiguredExecutablePath(PATH fallback) = (%q, %t), want (%q, true)", resolvedPath, usingPathFallback, configuredFFmpeg)
	}

	if got, err := resolveFFmpegPath(configuredFFmpeg); err != nil || got != configuredFFmpeg {
		t.Fatalf("resolveFFmpegPath() = (%q, %v), want (%q, nil)", got, err, configuredFFmpeg)
	}
	if _, err := resolveFFmpegPath(filepath.Join(tempDir, "missing.exe")); err == nil {
		t.Fatal("resolveFFmpegPath(missing) error = nil, want error")
	}

	if got := resolveFFProbePath(configuredFFmpeg); got != configuredFFProbe {
		t.Fatalf("resolveFFProbePath(sibling) = %q, want %q", got, configuredFFProbe)
	}

	pathOnlyDir := t.TempDir()
	pathOnlyFFProbe := writeExecutableStub(t, filepath.Join(pathOnlyDir, "ffprobe.exe"))
	t.Setenv("PATH", pathOnlyDir)
	if got := resolveFFProbePath(filepath.Join(pathOnlyDir, "missing-ffmpeg.exe")); got != pathOnlyFFProbe {
		t.Fatalf("resolveFFProbePath(PATH fallback) = %q, want %q", got, pathOnlyFFProbe)
	}
	t.Setenv("PATH", t.TempDir())
	if got := resolveFFProbePath(filepath.Join(pathOnlyDir, "missing-ffmpeg.exe")); got != "" {
		t.Fatalf("resolveFFProbePath(missing) = %q, want empty", got)
	}

	prependToPath(t, tempDir)
	status := validateFFmpegPath("")
	if !status.Available || !status.UsingPathFallback || status.ResolvedPath != configuredFFmpeg {
		t.Fatalf("validateFFmpegPath(PATH fallback) = %#v, want available fallback result", status)
	}

	t.Setenv("PATH", t.TempDir())
	status = validateFFmpegPath(filepath.Join(tempDir, "missing.exe"))
	if status.Available {
		t.Fatalf("validateFFmpegPath(missing) = %#v, want unavailable", status)
	}
	if status.Message == "" {
		t.Fatal("validateFFmpegPath(missing) should include an error message")
	}
}
