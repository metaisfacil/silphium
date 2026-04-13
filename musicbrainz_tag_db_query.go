package main

import (
	"strings"
)

func parseMusicBrainzTagSearchQuery(query string) ([]string, bool) {
	trimmedQuery := strings.TrimSpace(query)
	if !strings.HasPrefix(strings.ToLower(trimmedQuery), "mbtag:") {
		return nil, false
	}

	remainder := strings.TrimSpace(trimmedQuery[len("mbtag:"):])
	if remainder == "" {
		return []string{}, true
	}

	tags := make([]string, 0, 4)
	var builder strings.Builder
	inQuotes := false
	flush := func() {
		tagName := normalizeMusicBrainzTagName(builder.String())
		builder.Reset()
		if tagName == "" {
			return
		}

		tags = append(tags, tagName)
	}

	for index := 0; index < len(remainder); index++ {
		switch remainder[index] {
		case '"':
			if inQuotes && index+1 < len(remainder) && remainder[index+1] == '"' {
				builder.WriteByte('"')
				index++
				continue
			}

			inQuotes = !inQuotes
		case ',':
			if inQuotes {
				builder.WriteByte(remainder[index])
				continue
			}

			flush()
		default:
			builder.WriteByte(remainder[index])
		}
	}

	flush()
	return normalizeMusicBrainzTagNames(tags), true
}

func (a *App) musicBrainzTagMatchingFolderPaths(tagNames []string) []string {
	if len(tagNames) == 0 || !a.musicBrainzTagDatabaseEnabled() {
		return nil
	}

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	folderPaths := make([]string, 0)
	seen := make(map[string]struct{})
	addFolderPaths := func(index map[string]map[string]struct{}, key string) {
		for folderPath := range index[key] {
			folderKey := strings.ToLower(folderPath)
			if _, exists := seen[folderKey]; exists {
				continue
			}

			seen[folderKey] = struct{}{}
			folderPaths = append(folderPaths, folderPath)
		}
	}
	for _, rawTagName := range tagNames {
		tagName := normalizeMusicBrainzTagName(rawTagName)
		if tagName == "" {
			continue
		}

		entityKeys := a.musicBrainzTagEntityKeysByTag[tagName]
		for entityKey := range entityKeys {
			record, exists := a.musicBrainzTagStore.Entities[entityKey]
			if !exists {
				continue
			}

			switch record.EntityType {
			case "release":
				addFolderPaths(a.musicBrainzTagReleaseFoldersByID, record.MBID)
			case "artist":
				addFolderPaths(a.musicBrainzTagArtistFoldersByID, record.MBID)
				addFolderPaths(a.musicBrainzTagReleaseFoldersByArtistID, record.MBID)
			}
		}
	}

	sortPathsCaseInsensitive(folderPaths)
	return folderPaths
}

func (a *App) isMusicBrainzTagSearchFolderAvailableLocked(folderPath string) bool {
	cleanFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
	if cleanFolderPath == "" {
		return false
	}
	indexState := a.libraryIndexState()

	if a.isLibraryFolderIndexReadyLocked() {
		_, exists := indexState.folderEntriesByFolder[cleanFolderPath]
		return exists
	}

	return a.resolveAvailableLibraryFolderForVirtualPathLocked(cleanFolderPath) != ""
}

func (a *App) buildMusicBrainzTagSearchResultsLocked(tagNames []string) []LibraryBrowserEntry {
	folderPaths := a.musicBrainzTagMatchingFolderPaths(tagNames)
	if len(folderPaths) == 0 {
		return []LibraryBrowserEntry{}
	}

	entries := make([]LibraryBrowserEntry, 0, len(folderPaths))
	seen := make(map[string]struct{}, len(folderPaths))
	appendEntry := func(entry LibraryBrowserEntry) {
		entryKey := strings.ToLower(entry.Kind + ":" + entry.Path)
		if _, exists := seen[entryKey]; exists {
			return
		}

		seen[entryKey] = struct{}{}
		entries = append(entries, entry)
	}
	appendFolderEntries := func(folderPath string) {
		var folderEntries []LibraryBrowserEntry
		indexState := a.libraryIndexState()
		if a.isLibraryFolderIndexReadyLocked() {
			folderEntries = indexState.folderEntriesByFolder[folderPath]
		} else {
			folderEntries = a.buildFolderEntriesFromMapsLocked(folderPath)
		}

		for _, entry := range folderEntries {
			appendEntry(entry)
		}
	}
	for _, folderPath := range folderPaths {
		cleanFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
		if cleanFolderPath == "" {
			continue
		}

		if !a.isMusicBrainzTagSearchFolderAvailableLocked(cleanFolderPath) {
			continue
		}

		appendEntry(folderBrowserEntry(cleanFolderPath, 0))
		appendFolderEntries(cleanFolderPath)
	}

	sortBrowserEntriesByPath(entries)
	return entries
}
