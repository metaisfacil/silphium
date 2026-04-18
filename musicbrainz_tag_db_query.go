package main

import (
	"strings"
)

type musicBrainzEntityIDSearchQuery struct {
	entityType string
	mbid       string
}

func trimMusicBrainzSearchQueryValue(value string) string {
	trimmedValue := strings.TrimSpace(value)
	if len(trimmedValue) >= 2 {
		if (trimmedValue[0] == '"' && trimmedValue[len(trimmedValue)-1] == '"') || (trimmedValue[0] == '\'' && trimmedValue[len(trimmedValue)-1] == '\'') {
			trimmedValue = trimmedValue[1 : len(trimmedValue)-1]
		}
	}

	return strings.TrimSpace(trimmedValue)
}

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

func parseMusicBrainzEntityIDSearchQuery(query string) (musicBrainzEntityIDSearchQuery, bool) {
	trimmedQuery := strings.TrimSpace(query)
	lowerQuery := strings.ToLower(trimmedQuery)

	for _, candidate := range []struct {
		prefix     string
		entityType string
	}{
		{prefix: "mbid-artist:", entityType: "artist"},
		{prefix: "mbid-release:", entityType: "release"},
		{prefix: "mbid-recording:", entityType: "recording"},
	} {
		if !strings.HasPrefix(lowerQuery, candidate.prefix) {
			continue
		}

		remainder := strings.TrimSpace(trimmedQuery[len(candidate.prefix):])
		return musicBrainzEntityIDSearchQuery{
			entityType: candidate.entityType,
			mbid:       sanitizeMusicBrainzID(trimMusicBrainzSearchQueryValue(remainder)),
		}, true
	}

	return musicBrainzEntityIDSearchQuery{}, false
}

func musicBrainzTagTrackRecordMatchesEntityMBID(record musicBrainzTagTrackRecord, query musicBrainzEntityIDSearchQuery) bool {
	switch query.entityType {
	case "artist":
		for _, artistID := range record.ArtistIDs {
			if artistID == query.mbid {
				return true
			}
		}
		return false
	case "release":
		return record.ReleaseID == query.mbid
	case "recording":
		return record.RecordingID == query.mbid
	default:
		return false
	}
}

func (a *App) musicBrainzEntityIDMatchingPaths(query musicBrainzEntityIDSearchQuery) ([]string, []string, []string) {
	if query.mbid == "" || !a.musicBrainzTagDatabaseEnabled() {
		return nil, nil, nil
	}

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	folderPaths := make([]string, 0)
	releaseFolderPaths := make([]string, 0)
	trackPaths := make([]string, 0)
	seenFolderPaths := make(map[string]struct{})
	seenReleaseFolderPaths := make(map[string]struct{})
	seenTrackPaths := make(map[string]struct{})
	addFolderPath := func(folderPath string) {
		cleanFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
		if cleanFolderPath == "" {
			return
		}

		folderKey := strings.ToLower(cleanFolderPath)
		if _, exists := seenFolderPaths[folderKey]; exists {
			return
		}

		seenFolderPaths[folderKey] = struct{}{}
		folderPaths = append(folderPaths, cleanFolderPath)
	}
	addReleaseFolderPath := func(folderPath string) {
		cleanFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
		if cleanFolderPath == "" {
			return
		}

		folderKey := strings.ToLower(cleanFolderPath)
		if _, exists := seenReleaseFolderPaths[folderKey]; exists {
			return
		}

		seenReleaseFolderPaths[folderKey] = struct{}{}
		releaseFolderPaths = append(releaseFolderPaths, cleanFolderPath)
	}
	addTrackPath := func(trackPath string) {
		cleanTrackPath := strings.TrimSpace(trackPath)
		if cleanTrackPath == "" {
			return
		}

		trackKey := strings.ToLower(cleanTrackPath)
		if _, exists := seenTrackPaths[trackKey]; exists {
			return
		}

		seenTrackPaths[trackKey] = struct{}{}
		trackPaths = append(trackPaths, cleanTrackPath)
	}

	switch query.entityType {
	case "release":
		for folderPath := range a.musicBrainzTagReleaseFoldersByID[query.mbid] {
			addReleaseFolderPath(folderPath)
			addFolderPath(folderPath)
		}
	}

	for path, record := range a.musicBrainzTagStore.Tracks {
		if !musicBrainzTagTrackRecordMatchesEntityMBID(record, query) {
			continue
		}

		addTrackPath(path)
		switch query.entityType {
		case "artist":
			for _, folderPath := range record.ArtistFolderPaths {
				addFolderPath(folderPath)
			}
			addReleaseFolderPath(record.ReleaseFolderPath)
			addFolderPath(record.ReleaseFolderPath)
		case "recording":
			addReleaseFolderPath(record.ReleaseFolderPath)
			addFolderPath(record.ReleaseFolderPath)
		}
	}

	sortPathsCaseInsensitive(folderPaths)
	sortPathsCaseInsensitive(releaseFolderPaths)
	sortPathsCaseInsensitive(trackPaths)
	return folderPaths, releaseFolderPaths, trackPaths
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

func (a *App) buildMusicBrainzEntityIDSearchResultsLocked(query musicBrainzEntityIDSearchQuery) []LibraryBrowserEntry {
	folderPaths, releaseFolderPaths, trackPaths := a.musicBrainzEntityIDMatchingPaths(query)
	if len(folderPaths) == 0 && len(trackPaths) == 0 {
		return []LibraryBrowserEntry{}
	}

	entries := make([]LibraryBrowserEntry, 0, len(folderPaths)+len(trackPaths))
	seen := make(map[string]struct{}, len(folderPaths)+len(trackPaths))
	appendEntry := func(entry LibraryBrowserEntry) {
		entryKey := strings.ToLower(entry.Kind + ":" + entry.Path)
		if _, exists := seen[entryKey]; exists {
			return
		}

		seen[entryKey] = struct{}{}
		entries = append(entries, entry)
	}
	releaseFolderPathSet := make(map[string]struct{}, len(releaseFolderPaths))
	for _, folderPath := range releaseFolderPaths {
		releaseFolderPathSet[strings.ToLower(folderPath)] = struct{}{}
	}
	appendFolderEntries := func(folderPath string, allowedChildFolderPaths map[string]struct{}) {
		var folderEntries []LibraryBrowserEntry
		indexState := a.libraryIndexState()
		if a.isLibraryFolderIndexReadyLocked() {
			folderEntries = indexState.folderEntriesByFolder[folderPath]
		} else {
			folderEntries = a.buildFolderEntriesFromMapsLocked(folderPath)
		}

		for _, entry := range folderEntries {
			if entry.Kind == "folder" && allowedChildFolderPaths != nil {
				if _, allowed := allowedChildFolderPaths[strings.ToLower(entry.Path)]; !allowed {
					continue
				}
			}

			appendEntry(entry)
		}
	}
	appendTrackEntry := func(trackPath string) {
		indexed, exists := a.libraryContentState().trackByPath[strings.TrimSpace(trackPath)]
		if !exists {
			return
		}

		appendEntry(browserEntryFromIndexedFile("track", indexed))
	}

	for _, folderPath := range folderPaths {
		cleanFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
		if cleanFolderPath == "" || !a.isMusicBrainzTagSearchFolderAvailableLocked(cleanFolderPath) {
			continue
		}

		appendEntry(folderBrowserEntry(cleanFolderPath, 0))
		switch query.entityType {
		case "artist":
			if _, isReleaseFolder := releaseFolderPathSet[strings.ToLower(cleanFolderPath)]; isReleaseFolder {
				appendFolderEntries(cleanFolderPath, nil)
			} else {
				appendFolderEntries(cleanFolderPath, releaseFolderPathSet)
			}
		case "release":
			appendFolderEntries(cleanFolderPath, nil)
		}
	}

	for _, trackPath := range trackPaths {
		appendTrackEntry(trackPath)
	}

	sortBrowserEntriesByPath(entries)
	return entries
}
