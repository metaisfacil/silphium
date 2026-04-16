package main

import (
	"strings"
	"time"
)

func addMusicBrainzTagPathIndexEntry(index map[string]map[string]struct{}, key string, path string) {
	cleanKey := strings.TrimSpace(key)
	cleanPath := normalizeMusicBrainzTagFolderPath(path)
	if cleanKey == "" || cleanPath == "" {
		return
	}

	entry := index[cleanKey]
	if entry == nil {
		entry = make(map[string]struct{})
		index[cleanKey] = entry
	}

	entry[cleanPath] = struct{}{}
}

func removeMusicBrainzTagPathIndexEntry(index map[string]map[string]struct{}, key string, path string) {
	cleanKey := strings.TrimSpace(key)
	cleanPath := normalizeMusicBrainzTagFolderPath(path)
	if cleanKey == "" || cleanPath == "" {
		return
	}

	entry := index[cleanKey]
	if entry == nil {
		return
	}

	delete(entry, cleanPath)
	if len(entry) == 0 {
		delete(index, cleanKey)
	}
}

func addMusicBrainzTagEntityIndexEntry(index map[string]map[string]struct{}, tagName string, entityKey string) {
	cleanTagName := normalizeMusicBrainzTagName(tagName)
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanTagName == "" || cleanEntityKey == "" {
		return
	}

	entry := index[cleanTagName]
	if entry == nil {
		entry = make(map[string]struct{})
		index[cleanTagName] = entry
	}

	entry[cleanEntityKey] = struct{}{}
}

func removeMusicBrainzTagEntityIndexEntry(index map[string]map[string]struct{}, tagName string, entityKey string) {
	cleanTagName := normalizeMusicBrainzTagName(tagName)
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanTagName == "" || cleanEntityKey == "" {
		return
	}

	entry := index[cleanTagName]
	if entry == nil {
		return
	}

	delete(entry, cleanEntityKey)
	if len(entry) == 0 {
		delete(index, cleanTagName)
	}
}

func (a *App) addMusicBrainzTagTrackIndexesLocked(record musicBrainzTagTrackRecord) {
	artistIDs := musicBrainzTagBrowseArtistIDs(record)
	if record.ReleaseID != "" && record.ReleaseFolderPath != "" {
		addMusicBrainzTagPathIndexEntry(a.musicBrainzTagReleaseFoldersByID, record.ReleaseID, record.ReleaseFolderPath)
	}
	if record.ReleaseFolderPath != "" {
		for _, artistID := range artistIDs {
			addMusicBrainzTagPathIndexEntry(a.musicBrainzTagReleaseFoldersByArtistID, artistID, record.ReleaseFolderPath)
		}
	}

	for _, artistID := range artistIDs {
		for _, folderPath := range record.ArtistFolderPaths {
			addMusicBrainzTagPathIndexEntry(a.musicBrainzTagArtistFoldersByID, artistID, folderPath)
		}
	}
}

func (a *App) removeMusicBrainzTagTrackIndexesLocked(record musicBrainzTagTrackRecord) {
	artistIDs := musicBrainzTagBrowseArtistIDs(record)
	if record.ReleaseID != "" && record.ReleaseFolderPath != "" {
		removeMusicBrainzTagPathIndexEntry(a.musicBrainzTagReleaseFoldersByID, record.ReleaseID, record.ReleaseFolderPath)
	}
	if record.ReleaseFolderPath != "" {
		for _, artistID := range artistIDs {
			removeMusicBrainzTagPathIndexEntry(a.musicBrainzTagReleaseFoldersByArtistID, artistID, record.ReleaseFolderPath)
		}
	}

	for _, artistID := range artistIDs {
		for _, folderPath := range record.ArtistFolderPaths {
			removeMusicBrainzTagPathIndexEntry(a.musicBrainzTagArtistFoldersByID, artistID, folderPath)
		}
	}
}

func (a *App) addMusicBrainzTagEntityIndexesLocked(record musicBrainzTagEntityRecord) {
	entityKey := musicBrainzTagEntityKey(record.EntityType, record.MBID)
	if entityKey == "" {
		return
	}

	for _, tagName := range record.Tags {
		addMusicBrainzTagEntityIndexEntry(a.musicBrainzTagEntityKeysByTag, tagName, entityKey)
	}
}

func (a *App) removeMusicBrainzTagEntityIndexesLocked(record musicBrainzTagEntityRecord) {
	entityKey := musicBrainzTagEntityKey(record.EntityType, record.MBID)
	if entityKey == "" {
		return
	}

	for _, tagName := range record.Tags {
		removeMusicBrainzTagEntityIndexEntry(a.musicBrainzTagEntityKeysByTag, tagName, entityKey)
	}
}

func (a *App) rebuildMusicBrainzTagIndexesLocked() {
	a.musicBrainzTagEntityKeysByTag = make(map[string]map[string]struct{})
	a.musicBrainzTagReleaseFoldersByID = make(map[string]map[string]struct{})
	a.musicBrainzTagReleaseFoldersByArtistID = make(map[string]map[string]struct{})
	a.musicBrainzTagArtistFoldersByID = make(map[string]map[string]struct{})

	for _, record := range a.musicBrainzTagStore.Tracks {
		a.addMusicBrainzTagTrackIndexesLocked(record)
	}
	for _, record := range a.musicBrainzTagStore.Entities {
		a.addMusicBrainzTagEntityIndexesLocked(record)
	}
}

func (a *App) markMusicBrainzTagDatabaseDirtyLocked() {
	a.musicBrainzTagStoreDirty = true
	a.musicBrainzTagVersion.Add(1)
}

func (a *App) upsertMusicBrainzTagTrackRecordLocked(path string, record musicBrainzTagTrackRecord) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return
	}

	record = normalizeMusicBrainzTagTrackRecord(record)

	if existing, exists := a.musicBrainzTagStore.Tracks[cleanPath]; exists {
		a.removeMusicBrainzTagTrackIndexesLocked(existing)
	}

	a.musicBrainzTagStore.Tracks[cleanPath] = record
	a.addMusicBrainzTagTrackIndexesLocked(record)
	a.markMusicBrainzTagDatabaseDirtyLocked()
}

func (a *App) removeMusicBrainzTagTrackRecordLocked(path string) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return
	}

	record, exists := a.musicBrainzTagStore.Tracks[cleanPath]
	if !exists {
		return
	}

	a.removeMusicBrainzTagTrackIndexesLocked(record)
	delete(a.musicBrainzTagStore.Tracks, cleanPath)
	a.markMusicBrainzTagDatabaseDirtyLocked()
}

func (a *App) upsertMusicBrainzTagEntityRecordLocked(record musicBrainzTagEntityRecord) {
	entityKey := musicBrainzTagEntityKey(record.EntityType, record.MBID)
	if entityKey == "" {
		return
	}

	record.EntityType, record.MBID, _ = parseMusicBrainzTagEntityKey(entityKey)
	record.Title = strings.TrimSpace(record.Title)
	record.Tags = normalizeMusicBrainzTagNames(record.Tags)
	record.LastError = strings.TrimSpace(record.LastError)

	if existing, exists := a.musicBrainzTagStore.Entities[entityKey]; exists {
		a.removeMusicBrainzTagEntityIndexesLocked(existing)
	}

	a.musicBrainzTagStore.Entities[entityKey] = record
	a.addMusicBrainzTagEntityIndexesLocked(record)
	a.markMusicBrainzTagDatabaseDirtyLocked()
}

func (a *App) removeMusicBrainzTagEntityRecordLocked(entityKey string) {
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanEntityKey == "" {
		return
	}

	record, exists := a.musicBrainzTagStore.Entities[cleanEntityKey]
	if !exists {
		return
	}

	a.removeMusicBrainzTagEntityIndexesLocked(record)
	delete(a.musicBrainzTagStore.Entities, cleanEntityKey)
	a.markMusicBrainzTagDatabaseDirtyLocked()
}

func (a *App) persistMusicBrainzTagDatabase(force bool) {
	a.musicBrainzTagMu.Lock()
	if !a.musicBrainzTagStoreLoaded || !a.musicBrainzTagStoreDirty {
		a.musicBrainzTagMu.Unlock()
		return
	}

	if !force && !a.musicBrainzTagLastPersistAt.IsZero() && time.Since(a.musicBrainzTagLastPersistAt) < musicBrainzTagDatabaseFlushInterval {
		a.musicBrainzTagMu.Unlock()
		return
	}

	store := a.musicBrainzTagStore
	a.musicBrainzTagStoreDirty = false
	a.musicBrainzTagLastPersistAt = time.Now()
	a.musicBrainzTagMu.Unlock()

	err := writeMusicBrainzTagDatabaseStoreToSQLite(a.musicBrainzTagDatabasePath(), store)

	if err == nil {
		return
	}

	a.musicBrainzTagMu.Lock()
	a.musicBrainzTagStoreDirty = true
	a.musicBrainzTagMu.Unlock()
}

func (a *App) ensureMusicBrainzTagDatabaseLoadedLocked() {
	if a.musicBrainzTagStoreLoaded {
		return
	}

	store := loadMusicBrainzTagDatabaseStore(a.musicBrainzTagDatabasePath())

	a.musicBrainzTagStore = store
	a.musicBrainzTagStoreLoaded = true
	a.rebuildMusicBrainzTagIndexesLocked()
}
