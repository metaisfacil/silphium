package main

import (
	"path/filepath"
	"strings"
)

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

func isJpegPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".jpg" || ext == ".jpeg"
}

func folderAndRelative(rootPath string, fullPath string) (string, string, bool) {
	relativePath, err := filepath.Rel(rootPath, fullPath)
	if err != nil {
		return "", "", false
	}

	relativePath = filepath.ToSlash(relativePath)
	folderPath := filepath.ToSlash(filepath.Dir(relativePath))
	if folderPath == "." {
		folderPath = ""
	}

	return folderPath, relativePath, true
}

func coverPriority(name string) int {
	switch {
	case strings.EqualFold(name, "cover.jpg"):
		return 0
	case strings.EqualFold(name, "folder.jpg"):
		return 1
	case strings.HasPrefix(strings.ToLower(name), "albumart"):
		return 2
	default:
		return 3
	}
}

func normalizePath(path string) string {
	return filepath.Clean(strings.TrimSpace(path))
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
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return false
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return false
	}

	if strings.TrimSpace(a.libraryRoot) == "" {
		return true
	}

	relativeToRoot, err := filepath.Rel(a.libraryRoot, absolutePath)
	if err != nil {
		return false
	}

	if relativeToRoot == "." {
		return true
	}

	parentPrefix := ".." + string(filepath.Separator)
	return relativeToRoot != ".." && !strings.HasPrefix(relativeToRoot, parentPrefix)
}
