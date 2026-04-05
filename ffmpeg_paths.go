package main

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// FFmpegPathStatus reports whether ffmpeg can be resolved from settings or PATH.
type FFmpegPathStatus struct {
	Available         bool   `json:"available"`
	ResolvedPath      string `json:"resolvedPath,omitempty"`
	Message           string `json:"message,omitempty"`
	UsingPathFallback bool   `json:"usingPathFallback"`
}

func normalizeToolExecutablePath(value string) string {
	trimmed := strings.Trim(strings.TrimSpace(value), "\"")
	if trimmed == "" {
		return ""
	}

	normalized := normalizePath(trimmed)
	if absolutePath, err := filepath.Abs(normalized); err == nil {
		normalized = filepath.Clean(absolutePath)
	}

	return normalized
}

func resolveConfiguredExecutablePath(configuredPath string, executableName string) (string, bool, error) {
	normalizedConfiguredPath := normalizeToolExecutablePath(configuredPath)
	if normalizedConfiguredPath != "" {
		resolvedPath, err := exec.LookPath(normalizedConfiguredPath)
		if err != nil {
			return "", false, fmt.Errorf("ffmpeg executable was not found at %q", normalizedConfiguredPath)
		}

		return resolvedPath, false, nil
	}

	resolvedPath, err := exec.LookPath(executableName)
	if err != nil {
		return "", true, fmt.Errorf("ffmpeg executable was not found in PATH")
	}

	return resolvedPath, true, nil
}

func resolveFFmpegPath(configuredPath string) (string, error) {
	resolvedPath, _, err := resolveConfiguredExecutablePath(configuredPath, "ffmpeg")
	if err != nil {
		return "", err
	}

	return resolvedPath, nil
}

func resolveFFProbePath(configuredFFmpegPath string) string {
	resolvedFFmpegPath, err := resolveFFmpegPath(configuredFFmpegPath)
	if err == nil {
		extension := filepath.Ext(resolvedFFmpegPath)
		candidate := filepath.Join(filepath.Dir(resolvedFFmpegPath), "ffprobe"+extension)
		if resolvedPath, lookupErr := exec.LookPath(candidate); lookupErr == nil {
			return resolvedPath
		}
	}

	resolvedPath, err := exec.LookPath("ffprobe")
	if err != nil {
		return ""
	}

	return resolvedPath
}

func validateFFmpegPath(configuredPath string) FFmpegPathStatus {
	resolvedPath, usingPathFallback, err := resolveConfiguredExecutablePath(configuredPath, "ffmpeg")
	if err != nil {
		return FFmpegPathStatus{
			Available:         false,
			Message:           err.Error(),
			UsingPathFallback: usingPathFallback,
		}
	}

	return FFmpegPathStatus{
		Available:         true,
		ResolvedPath:      resolvedPath,
		UsingPathFallback: usingPathFallback,
	}
}
