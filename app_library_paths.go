package main

import (
	"fmt"
	"path/filepath"
	"strings"
)

type libraryRootConfig struct {
	Path         string
	Name         string
	ReleaseDepth int
}

var audioExtensions = map[string]struct{}{
	".mp3":  {},
	".m4a":  {},
	".aac":  {},
	".wav":  {},
	".flac": {},
	".ogg":  {},
	".opus": {},
}

var textExtensions = map[string]struct{}{
	".txt": {},
	".log": {},
}

var imageExtensions = map[string]struct{}{
	".jpg":  {},
	".jpeg": {},
	".png":  {},
	".gif":  {},
	".webp": {},
	".bmp":  {},
}

func isAudioPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".m3u8" {
		return false
	}
	_, ok := audioExtensions[ext]
	return ok
}

func isTextPath(path string) bool {
	_, ok := textExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func isImagePath(path string) bool {
	_, ok := imageExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func isPreferredCoverImagePath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".jpg" || ext == ".jpeg" || ext == ".png"
}

func libraryRootDisplayBaseForPath(path string) string {
	base := filepath.Base(filepath.Clean(strings.TrimSpace(path)))
	base = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(base, "\\", " "), "/", " "))
	if base == "" || base == "." {
		return "Library"
	}

	return base
}

func libraryRootDisplayBase(folder AppLibraryFolder) string {
	if label := normalizeLibraryFolderLabel(folder.Label); label != "" {
		return label
	}

	return libraryRootDisplayBaseForPath(folder.Path)
}

func resolveLibraryRootConfigs(folders []AppLibraryFolder) []libraryRootConfig {
	if len(folders) == 0 {
		return []libraryRootConfig{}
	}

	totalsByBase := make(map[string]int, len(folders))
	for _, folder := range folders {
		baseKey := strings.ToLower(libraryRootDisplayBase(folder))
		totalsByBase[baseKey] = totalsByBase[baseKey] + 1
	}

	seenByBase := make(map[string]int, len(folders))
	resolved := make([]libraryRootConfig, 0, len(folders))
	for _, folder := range folders {
		baseName := libraryRootDisplayBase(folder)
		baseKey := strings.ToLower(baseName)
		seenByBase[baseKey] = seenByBase[baseKey] + 1

		rootName := baseName
		if totalsByBase[baseKey] > 1 {
			rootName = fmt.Sprintf("%s (%d)", baseName, seenByBase[baseKey])
		}

		resolved = append(resolved, libraryRootConfig{
			Path:         folder.Path,
			Name:         rootName,
			ReleaseDepth: folder.ReleaseDepth,
		})
	}

	return resolved
}

func folderAndRelative(rootPath string, fullPath string) (string, string, bool) {
	relativePath, err := filepath.Rel(rootPath, fullPath)
	if err != nil {
		return "", "", false
	}

	relativePath = filepath.Clean(relativePath)
	parentPrefix := ".." + string(filepath.Separator)
	if relativePath == ".." || strings.HasPrefix(relativePath, parentPrefix) {
		return "", "", false
	}

	relativePath = filepath.ToSlash(relativePath)
	folderPath := filepath.ToSlash(filepath.Dir(relativePath))
	if folderPath == "." {
		folderPath = ""
	}

	return folderPath, relativePath, true
}

func buildVirtualLibraryPath(rootName string, relativePath string) string {
	trimmedRootName := strings.TrimSpace(rootName)
	trimmedRelativePath := strings.TrimSpace(relativePath)
	if trimmedRootName == "" {
		return trimmedRelativePath
	}

	if trimmedRelativePath == "" {
		return trimmedRootName
	}

	return trimmedRootName + "/" + trimmedRelativePath
}

func folderAndRelativeForLibraryRoot(root libraryRootConfig, fullPath string) (string, string, bool) {
	folderPath, relativePath, ok := folderAndRelative(root.Path, fullPath)
	if !ok {
		return "", "", false
	}

	return buildVirtualLibraryPath(root.Name, folderPath), buildVirtualLibraryPath(root.Name, relativePath), true
}

func absoluteNormalizedPath(path string) (string, bool) {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return "", false
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return "", false
	}

	return filepath.Clean(absolutePath), true
}

func pathWithinRoot(rootPath string, absolutePath string) bool {
	if strings.TrimSpace(rootPath) == "" {
		return false
	}

	relativeToRoot, err := filepath.Rel(rootPath, absolutePath)
	if err != nil {
		return false
	}

	if relativeToRoot == "." {
		return true
	}

	parentPrefix := ".." + string(filepath.Separator)
	return relativeToRoot != ".." && !strings.HasPrefix(relativeToRoot, parentPrefix)
}

func (a *App) activeLibraryRootForPath(path string) (libraryRootConfig, bool) {
	absolutePath, ok := absoluteNormalizedPath(path)
	if !ok {
		return libraryRootConfig{}, false
	}

	bestMatch := libraryRootConfig{}
	bestMatchLength := -1
	for _, root := range a.activeLibraryRoots {
		if !pathWithinRoot(root.Path, absolutePath) {
			continue
		}

		if len(root.Path) <= bestMatchLength {
			continue
		}

		bestMatch = root
		bestMatchLength = len(root.Path)
	}

	if bestMatchLength < 0 {
		return libraryRootConfig{}, false
	}

	return bestMatch, true
}

func (a *App) primaryActiveLibraryRoot() (libraryRootConfig, bool) {
	if len(a.activeLibraryRoots) == 0 {
		return libraryRootConfig{}, false
	}

	return a.activeLibraryRoots[0], true
}

func coverPriority(name string) int {
	lowerName := strings.ToLower(name)

	switch {
	case lowerName == "cover.jpg":
		return 0
	case lowerName == "folder.jpg":
		return 1
	case strings.HasPrefix(lowerName, "albumart") && !strings.HasSuffix(lowerName, ".png"):
		return 2
	case lowerName == "cover.png":
		return 3
	case lowerName == "folder.png":
		return 4
	case strings.HasPrefix(lowerName, "albumart") && strings.HasSuffix(lowerName, ".png"):
		return 5
	default:
		return 6
	}
}

func normalizePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}

	return filepath.Clean(trimmed)
}

func normalizeLibraryRelativePath(path string) (string, bool) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" || trimmed == "." {
		return "", true
	}

	cleaned := filepath.ToSlash(filepath.Clean(strings.ReplaceAll(trimmed, "/", string(filepath.Separator))))
	if cleaned == "." {
		return "", true
	}

	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false
	}

	return cleaned, true
}

func directChildFolderPath(parentPath string, candidateFolderPath string) (string, bool) {
	normalizedParent := strings.TrimSpace(parentPath)
	normalizedCandidate := strings.TrimSpace(candidateFolderPath)
	if normalizedCandidate == "" {
		return "", false
	}

	if normalizedParent == "" {
		segments := strings.Split(normalizedCandidate, "/")
		if len(segments) == 0 || segments[0] == "" {
			return "", false
		}

		return segments[0], true
	}

	if normalizedCandidate == normalizedParent {
		return "", false
	}

	prefix := normalizedParent + "/"
	if !strings.HasPrefix(normalizedCandidate, prefix) {
		return "", false
	}

	remainder := strings.TrimPrefix(normalizedCandidate, prefix)
	if remainder == "" {
		return "", false
	}

	segments := strings.Split(remainder, "/")
	if len(segments) == 0 || segments[0] == "" {
		return "", false
	}

	return normalizedParent + "/" + segments[0], true
}

func folderBrowserEntry(path string) LibraryBrowserEntry {
	segments := strings.Split(path, "/")
	name := path
	parentPath := ""
	if len(segments) > 0 {
		name = segments[len(segments)-1]
		if len(segments) > 1 {
			parentPath = strings.Join(segments[:len(segments)-1], "/")
		}
	}

	return LibraryBrowserEntry{
		Kind:         "folder",
		Name:         name,
		Path:         path,
		FolderPath:   parentPath,
		RelativePath: path,
	}
}

func browserEntryFromIndexedFile(kind string, indexed LibraryIndexedFile) LibraryBrowserEntry {
	return LibraryBrowserEntry{
		Kind:         kind,
		Name:         indexed.Name,
		Path:         indexed.Path,
		FolderPath:   indexed.FolderPath,
		RelativePath: indexed.RelativePath,
	}
}

func relativePathWithinFolder(folderPath string, relativePath string) string {
	normalizedFolder := strings.TrimSpace(folderPath)
	if normalizedFolder == "" {
		return relativePath
	}

	prefix := normalizedFolder + "/"
	if !strings.HasPrefix(relativePath, prefix) {
		return relativePath
	}

	return strings.TrimPrefix(relativePath, prefix)
}

func pagedLibraryEntries(entries []LibraryBrowserEntry, offset int, limit int) []LibraryBrowserEntry {
	if offset < 0 {
		offset = 0
	}

	if limit <= 0 {
		limit = 100
	}

	if offset >= len(entries) {
		return []LibraryBrowserEntry{}
	}

	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}

	return entries[offset:end]
}

func pagedIndexedFiles(kind string, entries []LibraryIndexedFile, offset int, limit int) LibraryIndexedFilePage {
	if offset < 0 {
		offset = 0
	}

	if limit <= 0 {
		limit = 1000
	}

	if offset >= len(entries) {
		return LibraryIndexedFilePage{
			Kind:         kind,
			Offset:       offset,
			Limit:        limit,
			TotalEntries: len(entries),
			Entries:      []LibraryIndexedFile{},
		}
	}

	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}

	pageEntries := append([]LibraryIndexedFile(nil), entries[offset:end]...)
	return LibraryIndexedFilePage{
		Kind:         kind,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pageEntries,
	}
}

func (a *App) isAllowedLibraryPath(path string) bool {
	absolutePath, ok := absoluteNormalizedPath(path)
	if !ok {
		return false
	}

	if len(a.activeLibraryRoots) == 0 {
		return true
	}

	_, exists := a.activeLibraryRootForPath(absolutePath)
	return exists
}
