package main

import (
	"path/filepath"
	"strings"
)

type shareableLocalSelection struct {
	tracks          map[string]LibraryIndexedFile
	textFiles       map[string]LibraryIndexedFile
	imageFiles      map[string]LibraryIndexedFile
	affectedFolders map[string]struct{}
}

func newShareableLocalSelection() shareableLocalSelection {
	return shareableLocalSelection{
		tracks:          make(map[string]LibraryIndexedFile),
		textFiles:       make(map[string]LibraryIndexedFile),
		imageFiles:      make(map[string]LibraryIndexedFile),
		affectedFolders: make(map[string]struct{}),
	}
}

func localPathMatchesChangedPath(changedPath string, candidatePath string) bool {
	if candidatePath == changedPath {
		return true
	}

	prefix := changedPath + string(filepath.Separator)
	return strings.HasPrefix(candidatePath, prefix)
}

func (selection shareableLocalSelection) add(kind string, indexed LibraryIndexedFile) {
	if isRemoteLibraryPath(indexed.Path) {
		return
	}

	selection.affectedFolders[indexed.FolderPath] = struct{}{}
	switch kind {
	case "track":
		selection.tracks[indexed.Path] = indexed
	case "text-file":
		selection.textFiles[indexed.Path] = indexed
	case "image-file":
		selection.imageFiles[indexed.Path] = indexed
	}
}

func (a *App) collectShareableLocalSelectionLocked(changedPaths []string) shareableLocalSelection {
	selection := newShareableLocalSelection()
	normalizedChangedPaths := make([]string, 0, len(changedPaths))
	for _, changedPath := range changedPaths {
		normalizedChangedPath, ok := absoluteNormalizedPath(changedPath)
		if !ok || isRemoteLibraryPath(normalizedChangedPath) {
			continue
		}

		normalizedChangedPaths = append(normalizedChangedPaths, normalizedChangedPath)
	}

	if len(normalizedChangedPaths) == 0 {
		return selection
	}

	matchPath := func(candidatePath string) bool {
		for _, changedPath := range normalizedChangedPaths {
			if localPathMatchesChangedPath(changedPath, candidatePath) {
				return true
			}
		}

		return false
	}

	for _, indexed := range a.trackByPath {
		if matchPath(indexed.Path) {
			selection.add("track", indexed)
		}
	}
	for _, indexed := range a.textByPath {
		if matchPath(indexed.Path) {
			selection.add("text-file", indexed)
		}
	}
	for _, indexed := range a.imageByPath {
		if matchPath(indexed.Path) {
			selection.add("image-file", indexed)
		}
	}

	return selection
}

func (a *App) bestLocalCoverVirtualPathForFolderLocked(folderPath string) string {
	bestPriority := 1000
	bestName := ""
	bestVirtualPath := ""
	for _, indexed := range a.imageByPath {
		if isRemoteLibraryPath(indexed.Path) || !strings.EqualFold(indexed.FolderPath, folderPath) || !isPreferredCoverImagePath(indexed.Path) {
			continue
		}

		priority := coverPriority(strings.ToLower(indexed.Name))
		candidateName := strings.ToLower(indexed.Name)
		if bestVirtualPath == "" || priority < bestPriority || (priority == bestPriority && candidateName < bestName) {
			bestPriority = priority
			bestName = candidateName
			bestVirtualPath = indexed.RelativePath
		}
	}

	return bestVirtualPath
}

func (a *App) localCoverPathsForFoldersLocked(folders map[string]struct{}) map[string]string {
	coverPathByFolder := make(map[string]string, len(folders))
	for folderPath := range folders {
		if strings.TrimSpace(folderPath) == "" {
			continue
		}

		virtualPath := a.bestLocalCoverVirtualPathForFolderLocked(folderPath)
		if strings.TrimSpace(virtualPath) == "" {
			continue
		}

		coverPathByFolder[folderPath] = virtualPath
	}

	return coverPathByFolder
}
