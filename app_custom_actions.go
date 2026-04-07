package main

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unicode"
)

var shellQuoteGOOS = runtime.GOOS

func shellQuotePath(path string) string {
	if shellQuoteGOOS == "windows" {
		return "\"" + strings.ReplaceAll(path, "\"", "\\\"") + "\""
	}

	return "'" + strings.ReplaceAll(path, "'", "'\"'\"'") + "'"
}

func (a *App) resolveAbsoluteLibraryPathFromVirtualPath(path string) (string, bool) {
	normalizedPath, ok := normalizeLibraryRelativePath(path)
	if !ok || normalizedPath == "" {
		return "", false
	}

	for _, root := range a.activeLibraryRoots {
		rootName := strings.TrimSpace(root.Name)
		if rootName == "" {
			continue
		}

		relativePath := ""
		switch {
		case normalizedPath == rootName:
			relativePath = ""
		case strings.HasPrefix(normalizedPath, rootName+"/"):
			relativePath = strings.TrimPrefix(normalizedPath, rootName+"/")
		default:
			continue
		}

		candidate := root.Path
		if relativePath != "" {
			candidate = filepath.Join(root.Path, filepath.FromSlash(relativePath))
		}

		candidate = filepath.Clean(candidate)
		if !pathWithinRoot(root.Path, candidate) {
			return "", false
		}

		return candidate, true
	}

	return "", false
}

func (a *App) looksLikeVirtualLibraryPath(path string) bool {
	normalizedPath, ok := normalizeLibraryRelativePath(path)
	if !ok || normalizedPath == "" {
		return false
	}

	firstSegment := normalizedPath
	if separator := strings.Index(firstSegment, "/"); separator >= 0 {
		firstSegment = firstSegment[:separator]
	}

	for _, root := range a.activeLibraryRoots {
		if strings.TrimSpace(root.Name) == firstSegment {
			return true
		}
	}

	return false
}

func targetDirectoryForPath(path string) string {
	fileInfo, err := os.Stat(path)
	if err == nil && fileInfo.IsDir() {
		return path
	}

	return filepath.Dir(path)
}

func trimForLog(output string, maxLength int) string {
	trimmed := strings.TrimSpace(output)
	if len(trimmed) <= maxLength {
		return trimmed
	}

	return trimmed[:maxLength] + "..."
}

var windowsEnvVarPattern = regexp.MustCompile(`%([^%]+)%`)

func expandWindowsPercentEnvVariables(value string) string {
	return windowsEnvVarPattern.ReplaceAllStringFunc(value, func(match string) string {
		variableName := match[1 : len(match)-1]
		expandedValue, exists := os.LookupEnv(variableName)
		if !exists {
			return match
		}

		return expandedValue
	})
}

func splitCommandLineWindows(commandLine string) ([]string, bool) {
	trimmed := strings.TrimSpace(commandLine)
	if trimmed == "" {
		return nil, false
	}

	parts := make([]string, 0, 8)
	current := strings.Builder{}
	inQuotes := false

	runes := []rune(trimmed)
	for i := 0; i < len(runes); i++ {
		character := runes[i]

		if character == '\\' && i+1 < len(runes) && runes[i+1] == '"' {
			current.WriteRune('"')
			i++
			continue
		}

		if character == '"' {
			inQuotes = !inQuotes
			continue
		}

		if !inQuotes && unicode.IsSpace(character) {
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
			continue
		}

		current.WriteRune(character)
	}

	if inQuotes {
		return nil, false
	}

	if current.Len() > 0 {
		parts = append(parts, current.String())
	}

	if len(parts) == 0 {
		return nil, false
	}

	return parts, true
}

// RunCustomSendToAction launches a user-defined command template with {path} replaced by the selected path.
func (a *App) RunCustomSendToAction(commandTemplate string, targetPath string) bool {
	trimmedTemplate := strings.TrimSpace(commandTemplate)
	a.logRescanEvent("send-to START: template=%q target=%q", trimmedTemplate, strings.TrimSpace(targetPath))
	if trimmedTemplate == "" {
		a.logRescanEvent("send-to ABORT: empty command template")
		return false
	}

	cleanTargetPath := normalizePath(targetPath)
	if cleanTargetPath == "" {
		a.logRescanEvent("send-to ABORT: empty normalized target path")
		return false
	}

	if !filepath.IsAbs(cleanTargetPath) {
		if resolvedPath, ok := a.resolveAbsoluteLibraryPathFromVirtualPath(cleanTargetPath); ok {
			a.logRescanEvent("send-to RESOLVED: virtual path %q -> %q", cleanTargetPath, resolvedPath)
			cleanTargetPath = resolvedPath
		} else if a.looksLikeVirtualLibraryPath(cleanTargetPath) {
			a.logRescanEvent("send-to ABORT: unresolved virtual path %q", cleanTargetPath)
			return false
		} else if root, ok := a.primaryActiveLibraryRoot(); ok {
			a.logRescanEvent("send-to FALLBACK: joining relative path %q with root %q", cleanTargetPath, root.Path)
			cleanTargetPath = filepath.Join(root.Path, cleanTargetPath)
		}
	}

	if !a.isAllowedLibraryPath(cleanTargetPath) {
		a.logRescanEvent("send-to ABORT: disallowed path %q", cleanTargetPath)
		return false
	}

	targetDirectoryPath := targetDirectoryForPath(cleanTargetPath)

	renderedCommand := trimmedTemplate
	renderedCommand = strings.ReplaceAll(renderedCommand, "{path}", shellQuotePath(cleanTargetPath))
	renderedCommand = strings.ReplaceAll(renderedCommand, "{path_unquoted}", cleanTargetPath)
	renderedCommand = strings.ReplaceAll(renderedCommand, "{directory}", shellQuotePath(targetDirectoryPath))
	renderedCommand = strings.ReplaceAll(renderedCommand, "{directory_unquoted}", targetDirectoryPath)
	if runtime.GOOS == "windows" {
		renderedCommand = expandWindowsPercentEnvVariables(renderedCommand)
	}
	if renderedCommand == "" {
		a.logRescanEvent("send-to ABORT: rendered command empty")
		return false
	}
	a.logRescanEvent("send-to EXEC: %s", renderedCommand)

	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		if argv, ok := splitCommandLineWindows(renderedCommand); ok {
			command = exec.Command(argv[0], argv[1:]...)
			a.logRescanEvent("send-to MODE: direct")
		} else {
			command = exec.Command("cmd", "/S", "/C", renderedCommand)
			a.logRescanEvent("send-to MODE: shell fallback")
		}
	} else {
		command = exec.Command("sh", "-c", renderedCommand)
	}

	var stdoutBuffer bytes.Buffer
	var stderrBuffer bytes.Buffer
	command.Stdout = &stdoutBuffer
	command.Stderr = &stderrBuffer

	if err := command.Start(); err != nil {
		a.logRescanEvent("send-to ERROR: %v", err)
		return false
	}
	a.logRescanEvent("send-to OK: pid=%d", command.Process.Pid)

	go func(startedCommand *exec.Cmd, rendered string) {
		if waitErr := startedCommand.Wait(); waitErr != nil {
			stdoutText := trimForLog(stdoutBuffer.String(), 8000)
			stderrText := trimForLog(stderrBuffer.String(), 8000)
			if stdoutText != "" {
				a.logRescanEvent("send-to STDOUT: %s", stdoutText)
			}
			if stderrText != "" {
				a.logRescanEvent("send-to STDERR: %s", stderrText)
			}
			a.logRescanEvent("send-to EXIT ERROR: cmd=%q err=%v", rendered, waitErr)
			return
		}

		stdoutText := trimForLog(stdoutBuffer.String(), 8000)
		stderrText := trimForLog(stderrBuffer.String(), 8000)
		if stdoutText != "" {
			a.logRescanEvent("send-to STDOUT: %s", stdoutText)
		}
		if stderrText != "" {
			a.logRescanEvent("send-to STDERR: %s", stderrText)
		}

		a.logRescanEvent("send-to EXIT OK: cmd=%q", rendered)
	}(command, renderedCommand)

	return true
}
