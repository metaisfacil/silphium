package main

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const musicBrainzTagDatabaseFileName = "silphium.musicbrainz.tags.sqlite3"
const legacyMusicBrainzTagDatabaseFileName = "silphium.musicbrainz.tags.json"
const musicBrainzTagDatabaseVersion = 1
const musicBrainzTagEntityRescanInterval = 30 * 24 * time.Hour
const musicBrainzTagEmptyEntityRescanInterval = 7 * 24 * time.Hour
const musicBrainzTagEntityRetryInterval = 6 * time.Hour
const musicBrainzTagDatabaseFlushInterval = 5 * time.Second

type musicBrainzTagTrackRecord struct {
	Signature         trackTagsFileSignature `json:"signature"`
	ReleaseID         string                 `json:"releaseId,omitempty"`
	ArtistIDs         []string               `json:"artistIds,omitempty"`
	ReleaseFolderPath string                 `json:"releaseFolderPath,omitempty"`
	ArtistFolderPaths []string               `json:"artistFolderPaths,omitempty"`
	LastScannedAt     time.Time              `json:"lastScannedAt,omitempty"`
}

type musicBrainzTagEntityRecord struct {
	EntityType    string    `json:"entityType"`
	MBID          string    `json:"mbid"`
	Title         string    `json:"title,omitempty"`
	Tags          []string  `json:"tags,omitempty"`
	LastFetchedAt time.Time `json:"lastFetchedAt,omitempty"`
	LastAttemptAt time.Time `json:"lastAttemptAt,omitempty"`
	LastError     string    `json:"lastError,omitempty"`
}

type musicBrainzTagDatabaseStore struct {
	Version  int                                   `json:"version"`
	Tracks   map[string]musicBrainzTagTrackRecord  `json:"tracks"`
	Entities map[string]musicBrainzTagEntityRecord `json:"entities"`
}

type musicBrainzTagWorkerState struct {
	generation         uint64
	indexedByPath      map[string]LibraryIndexedFile
	pendingTrackPaths  []string
	pendingEntityKeys  map[string]struct{}
	pendingEntityOrder []string
}

func newMusicBrainzTagDatabaseStore() musicBrainzTagDatabaseStore {
	return musicBrainzTagDatabaseStore{
		Version:  musicBrainzTagDatabaseVersion,
		Tracks:   make(map[string]musicBrainzTagTrackRecord),
		Entities: make(map[string]musicBrainzTagEntityRecord),
	}
}

func normalizeMusicBrainzTagName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	return strings.ToLower(strings.Join(strings.Fields(trimmed), " "))
}

func normalizeMusicBrainzTagNames(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		tagName := normalizeMusicBrainzTagName(value)
		if tagName == "" {
			continue
		}

		if _, exists := seen[tagName]; exists {
			continue
		}

		seen[tagName] = struct{}{}
		normalized = append(normalized, tagName)
	}

	if len(normalized) == 0 {
		return nil
	}

	sort.Strings(normalized)
	return normalized
}

func normalizeMusicBrainzTagFolderPath(value string) string {
	normalized, ok := normalizeLibraryRelativePath(value)
	if !ok {
		return ""
	}

	return normalized
}

func normalizeMusicBrainzTagFolderPaths(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		path := normalizeMusicBrainzTagFolderPath(value)
		if path == "" {
			continue
		}

		key := strings.ToLower(path)
		if _, exists := seen[key]; exists {
			continue
		}

		seen[key] = struct{}{}
		normalized = append(normalized, path)
	}

	if len(normalized) == 0 {
		return nil
	}

	sortPathsCaseInsensitive(normalized)
	return normalized
}

func normalizeMusicBrainzArtistIDsForTags(artistID string, artistIDs []string) []string {
	combined := make([]string, 0, len(artistIDs)+1)
	if strings.TrimSpace(artistID) != "" {
		combined = append(combined, artistID)
	}
	combined = append(combined, artistIDs...)
	cleanIDs := sanitizeMusicBrainzIDs(combined)
	if len(cleanIDs) == 0 {
		return nil
	}

	return cleanIDs
}

func musicBrainzTagEntityKey(entityType string, mbid string) string {
	cleanEntityType := strings.ToLower(strings.TrimSpace(entityType))
	cleanMBID := sanitizeMusicBrainzID(mbid)
	if cleanEntityType == "" || cleanMBID == "" {
		return ""
	}

	return cleanEntityType + ":" + cleanMBID
}

func parseMusicBrainzTagEntityKey(entityKey string) (string, string, bool) {
	entityType, mbid, found := strings.Cut(strings.TrimSpace(entityKey), ":")
	if !found {
		return "", "", false
	}

	cleanEntityType := strings.ToLower(strings.TrimSpace(entityType))
	cleanMBID := sanitizeMusicBrainzID(mbid)
	if cleanEntityType == "" || cleanMBID == "" {
		return "", "", false
	}

	return cleanEntityType, cleanMBID, true
}

func musicBrainzTagEntityKeysForTrackRecord(record musicBrainzTagTrackRecord) []string {
	keys := make([]string, 0, len(record.ArtistIDs)+1)
	seen := make(map[string]struct{}, len(record.ArtistIDs)+1)

	if entityKey := musicBrainzTagEntityKey("release", record.ReleaseID); entityKey != "" && record.ReleaseFolderPath != "" {
		seen[entityKey] = struct{}{}
		keys = append(keys, entityKey)
	}

	if len(record.ArtistFolderPaths) > 0 {
		for _, artistID := range record.ArtistIDs {
			entityKey := musicBrainzTagEntityKey("artist", artistID)
			if entityKey == "" {
				continue
			}

			if _, exists := seen[entityKey]; exists {
				continue
			}

			seen[entityKey] = struct{}{}
			keys = append(keys, entityKey)
		}
	}

	return keys
}

func stringSlicesEqual(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}

	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}

	return true
}

func releaseFolderPathForIndexedTrack(indexed LibraryIndexedFile, releaseDepth int) string {
	normalizedFolderPath := strings.TrimSpace(indexed.FolderPath)
	segments := strings.Split(normalizedFolderPath, "/")
	relativeSegments := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			continue
		}
		relativeSegments = append(relativeSegments, segment)
	}

	if len(relativeSegments) == 0 {
		return ""
	}

	trimmedRelativeSegments := relativeSegments
	if strings.TrimSpace(indexed.RootName) != "" && len(relativeSegments) > 1 {
		trimmedRelativeSegments = relativeSegments[1:]
	}

	if releaseDepth <= 0 || len(trimmedRelativeSegments) == 0 || releaseDepth >= len(trimmedRelativeSegments) {
		return normalizedFolderPath
	}

	if strings.TrimSpace(indexed.RootName) != "" {
		return strings.Join(append([]string{relativeSegments[0]}, trimmedRelativeSegments[:releaseDepth]...), "/")
	}

	return strings.Join(trimmedRelativeSegments[:releaseDepth], "/")
}

func artistFolderPathsForIndexedTrack(indexed LibraryIndexedFile, releaseDepth int) []string {
	normalizedFolderPath := strings.TrimSpace(indexed.FolderPath)
	segments := strings.Split(normalizedFolderPath, "/")
	relativeSegments := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			continue
		}
		relativeSegments = append(relativeSegments, segment)
	}

	if len(relativeSegments) == 0 {
		return nil
	}

	trimmedRelativeSegments := relativeSegments
	if strings.TrimSpace(indexed.RootName) != "" && len(relativeSegments) > 1 {
		trimmedRelativeSegments = relativeSegments[1:]
	}

	artistDepth := releaseDepth - 1
	if artistDepth <= 0 || len(trimmedRelativeSegments) == 0 || artistDepth >= len(trimmedRelativeSegments) {
		return normalizeMusicBrainzTagFolderPaths([]string{normalizedFolderPath})
	}

	if strings.TrimSpace(indexed.RootName) != "" {
		return normalizeMusicBrainzTagFolderPaths([]string{strings.Join(append([]string{relativeSegments[0]}, trimmedRelativeSegments[:artistDepth]...), "/")})
	}

	return normalizeMusicBrainzTagFolderPaths([]string{strings.Join(trimmedRelativeSegments[:artistDepth], "/")})
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

func (state *musicBrainzTagWorkerState) queueEntityKey(entityKey string) {
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanEntityKey == "" {
		return
	}

	if state.pendingEntityKeys == nil {
		state.pendingEntityKeys = make(map[string]struct{})
	}

	if _, exists := state.pendingEntityKeys[cleanEntityKey]; exists {
		return
	}

	state.pendingEntityKeys[cleanEntityKey] = struct{}{}
	state.pendingEntityOrder = append(state.pendingEntityOrder, cleanEntityKey)
}

func (state *musicBrainzTagWorkerState) popNextEntityKey() (string, bool) {
	for len(state.pendingEntityOrder) > 0 {
		entityKey := state.pendingEntityOrder[0]
		state.pendingEntityOrder = state.pendingEntityOrder[1:]
		if _, exists := state.pendingEntityKeys[entityKey]; !exists {
			continue
		}

		delete(state.pendingEntityKeys, entityKey)
		return entityKey, true
	}

	return "", false
}

func (a *App) musicBrainzTagDatabasePath() string {
	settingsPath := a.ensureSettingsPath()
	return filepath.Join(filepath.Dir(settingsPath), musicBrainzTagDatabaseFileName)
}

func (a *App) legacyMusicBrainzTagDatabasePath() string {
	settingsPath := a.ensureSettingsPath()
	return filepath.Join(filepath.Dir(settingsPath), legacyMusicBrainzTagDatabaseFileName)
}

func normalizeMusicBrainzTagDatabaseStore(store musicBrainzTagDatabaseStore) musicBrainzTagDatabaseStore {
	normalized := newMusicBrainzTagDatabaseStore()

	for path, record := range store.Tracks {
		cleanPath := strings.TrimSpace(path)
		if cleanPath == "" {
			continue
		}

		normalized.Tracks[cleanPath] = musicBrainzTagTrackRecord{
			Signature:         record.Signature,
			ReleaseID:         sanitizeMusicBrainzID(record.ReleaseID),
			ArtistIDs:         sanitizeMusicBrainzIDs(record.ArtistIDs),
			ReleaseFolderPath: normalizeMusicBrainzTagFolderPath(record.ReleaseFolderPath),
			ArtistFolderPaths: normalizeMusicBrainzTagFolderPaths(record.ArtistFolderPaths),
			LastScannedAt:     record.LastScannedAt,
		}
	}

	for _, record := range store.Entities {
		cleanEntityType, cleanMBID, ok := parseMusicBrainzTagEntityKey(musicBrainzTagEntityKey(record.EntityType, record.MBID))
		if !ok || (cleanEntityType != "artist" && cleanEntityType != "release") {
			continue
		}

		normalized.Entities[musicBrainzTagEntityKey(cleanEntityType, cleanMBID)] = musicBrainzTagEntityRecord{
			EntityType:    cleanEntityType,
			MBID:          cleanMBID,
			Title:         strings.TrimSpace(record.Title),
			Tags:          normalizeMusicBrainzTagNames(record.Tags),
			LastFetchedAt: record.LastFetchedAt,
			LastAttemptAt: record.LastAttemptAt,
			LastError:     strings.TrimSpace(record.LastError),
		}
	}

	return normalized
}

func (a *App) ensureMusicBrainzTagDatabaseLoadedLocked() {
	if a.musicBrainzTagStoreLoaded {
		return
	}

	store, migratedFromLegacy := loadMusicBrainzTagDatabaseStore(a.musicBrainzTagDatabasePath(), a.legacyMusicBrainzTagDatabasePath())

	a.musicBrainzTagStore = store
	a.musicBrainzTagStoreLoaded = true
	a.musicBrainzTagStoreDirty = migratedFromLegacy
	a.rebuildMusicBrainzTagIndexesLocked()
}

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
	if record.ReleaseID != "" && record.ReleaseFolderPath != "" {
		addMusicBrainzTagPathIndexEntry(a.musicBrainzTagReleaseFoldersByID, record.ReleaseID, record.ReleaseFolderPath)
	}

	for _, artistID := range record.ArtistIDs {
		for _, folderPath := range record.ArtistFolderPaths {
			addMusicBrainzTagPathIndexEntry(a.musicBrainzTagArtistFoldersByID, artistID, folderPath)
		}
	}
}

func (a *App) removeMusicBrainzTagTrackIndexesLocked(record musicBrainzTagTrackRecord) {
	if record.ReleaseID != "" && record.ReleaseFolderPath != "" {
		removeMusicBrainzTagPathIndexEntry(a.musicBrainzTagReleaseFoldersByID, record.ReleaseID, record.ReleaseFolderPath)
	}

	for _, artistID := range record.ArtistIDs {
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
}

func (a *App) upsertMusicBrainzTagTrackRecordLocked(path string, record musicBrainzTagTrackRecord) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return
	}

	record.ReleaseID = sanitizeMusicBrainzID(record.ReleaseID)
	record.ArtistIDs = sanitizeMusicBrainzIDs(record.ArtistIDs)
	record.ReleaseFolderPath = normalizeMusicBrainzTagFolderPath(record.ReleaseFolderPath)
	record.ArtistFolderPaths = normalizeMusicBrainzTagFolderPaths(record.ArtistFolderPaths)

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

func musicBrainzTagEntityRefreshInterval(record musicBrainzTagEntityRecord) time.Duration {
	if len(record.Tags) == 0 {
		return musicBrainzTagEmptyEntityRescanInterval
	}

	return musicBrainzTagEntityRescanInterval
}

func (a *App) musicBrainzTagDatabaseEnabled() bool {
	a.ensureSettingsLoaded()
	return a.settings.MusicBrainzTagDatabaseEnabled
}

func (a *App) musicBrainzTagReleaseDepthByRootPath() map[string]int {
	a.ensureSettingsLoaded()
	releaseDepthByRootPath := make(map[string]int, len(a.settings.LibraryFolders))
	for _, folder := range a.settings.LibraryFolders {
		normalizedPath, ok := absoluteNormalizedPath(folder.Path)
		if !ok {
			continue
		}

		releaseDepthByRootPath[strings.ToLower(normalizedPath)] = normalizeReleaseDepth(folder.ReleaseDepth)
	}

	return releaseDepthByRootPath
}

func (a *App) musicBrainzTagLibraryTrackSnapshot() map[string]LibraryIndexedFile {
	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	if len(a.trackByPath) == 0 {
		return nil
	}

	snapshot := make(map[string]LibraryIndexedFile, len(a.trackByPath))
	for path, indexed := range a.trackByPath {
		snapshot[path] = indexed
	}

	return snapshot
}

func (a *App) buildMusicBrainzTagWorkerState(generation uint64) musicBrainzTagWorkerState {
	snapshot := a.musicBrainzTagLibraryTrackSnapshot()
	state := musicBrainzTagWorkerState{
		generation:        generation,
		indexedByPath:     snapshot,
		pendingEntityKeys: make(map[string]struct{}),
	}

	if len(snapshot) == 0 {
		return state
	}

	paths := make([]string, 0, len(snapshot))
	for path := range snapshot {
		paths = append(paths, path)
	}
	sortPathsCaseInsensitive(paths)

	releaseDepthByRootPath := a.musicBrainzTagReleaseDepthByRootPath()
	now := time.Now()

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	currentPaths := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		currentPaths[path] = struct{}{}
	}

	for path := range a.musicBrainzTagStore.Tracks {
		if _, exists := currentPaths[path]; exists {
			continue
		}

		a.removeMusicBrainzTagTrackRecordLocked(path)
	}

	for _, path := range paths {
		indexed := snapshot[path]
		signature, ok := trackTagsFileSignatureForPath(path)
		if !ok {
			a.removeMusicBrainzTagTrackRecordLocked(path)
			continue
		}

		releaseDepth := releaseDepthByRootPath[strings.ToLower(normalizePath(indexed.RootPath))]
		releaseFolderPath := releaseFolderPathForIndexedTrack(indexed, releaseDepth)
		artistFolderPaths := artistFolderPathsForIndexedTrack(indexed, releaseDepth)

		existing, exists := a.musicBrainzTagStore.Tracks[path]
		if exists && existing.Signature == signature {
			if existing.ReleaseFolderPath != releaseFolderPath || !stringSlicesEqual(existing.ArtistFolderPaths, artistFolderPaths) {
				existing.ReleaseFolderPath = releaseFolderPath
				existing.ArtistFolderPaths = artistFolderPaths
				a.upsertMusicBrainzTagTrackRecordLocked(path, existing)
			}
			continue
		}

		state.pendingTrackPaths = append(state.pendingTrackPaths, path)
	}

	referencedEntityKeys := make(map[string]struct{})
	for _, record := range a.musicBrainzTagStore.Tracks {
		for _, entityKey := range musicBrainzTagEntityKeysForTrackRecord(record) {
			referencedEntityKeys[entityKey] = struct{}{}
			if a.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
				state.queueEntityKey(entityKey)
			}
		}
	}

	for entityKey := range a.musicBrainzTagStore.Entities {
		if _, exists := referencedEntityKeys[entityKey]; exists {
			continue
		}

		a.removeMusicBrainzTagEntityRecordLocked(entityKey)
	}

	return state
}

func (a *App) musicBrainzTagEntityNeedsFetchLocked(entityKey string, now time.Time) bool {
	record, exists := a.musicBrainzTagStore.Entities[strings.TrimSpace(entityKey)]
	if !exists {
		return true
	}

	if !record.LastFetchedAt.IsZero() && now.Sub(record.LastFetchedAt) >= musicBrainzTagEntityRefreshInterval(record) {
		return true
	}

	if record.LastFetchedAt.IsZero() {
		return record.LastAttemptAt.IsZero() || now.Sub(record.LastAttemptAt) >= musicBrainzTagEntityRetryInterval
	}

	if record.LastError != "" && now.Sub(record.LastAttemptAt) >= musicBrainzTagEntityRetryInterval {
		return true
	}

	return false
}

func (a *App) musicBrainzTagWorkerCount(jobCount int) int {
	if jobCount <= 0 {
		return 0
	}

	a.ensureSettingsLoaded()
	workerCount := normalizeMusicBrainzTagWorkerCores(a.settings.MusicBrainzTagWorkerCores)
	if workerCount > jobCount {
		workerCount = jobCount
	}
	if workerCount < 1 {
		workerCount = 1
	}

	return workerCount
}

func (a *App) musicBrainzTagTrackBatchSize() int {
	workerCount := a.musicBrainzTagWorkerCount(256)
	if workerCount <= 0 {
		return 32
	}

	batchSize := workerCount * 4
	if batchSize < 32 {
		batchSize = 32
	}
	if batchSize > 256 {
		batchSize = 256
	}

	return batchSize
}

func (a *App) scanMusicBrainzTagTrack(indexed LibraryIndexedFile, releaseDepth int, ffprobePath string) []string {
	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		a.musicBrainzTagMu.Lock()
		a.ensureMusicBrainzTagDatabaseLoadedLocked()
		a.removeMusicBrainzTagTrackRecordLocked(indexed.Path)
		a.musicBrainzTagMu.Unlock()
		return nil
	}

	trackTags := TrackTags{}
	hasMetadata := false
	if cachedTags, cachedHasMetadata, cacheHit := a.getTrackTagsCache(indexed.Path, signature); cacheHit {
		trackTags = cachedTags
		hasMetadata = cachedHasMetadata
	} else {
		trackTags, hasMetadata = readTrackTagsForPath(indexed.Path, ffprobePath)
		a.putTrackTagsCache(indexed.Path, signature, trackTags, hasMetadata)
	}

	if !hasMetadata {
		trackTags = TrackTags{}
	}

	record := musicBrainzTagTrackRecord{
		Signature:         signature,
		ReleaseID:         sanitizeMusicBrainzID(trackTags.ReleaseID),
		ArtistIDs:         normalizeMusicBrainzArtistIDsForTags(trackTags.ArtistID, trackTags.ArtistIDs),
		ReleaseFolderPath: releaseFolderPathForIndexedTrack(indexed, releaseDepth),
		ArtistFolderPaths: artistFolderPathsForIndexedTrack(indexed, releaseDepth),
		LastScannedAt:     time.Now(),
	}

	a.musicBrainzTagMu.Lock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()
	a.upsertMusicBrainzTagTrackRecordLocked(indexed.Path, record)
	entityKeys := make([]string, 0, len(record.ArtistIDs)+1)
	for _, entityKey := range musicBrainzTagEntityKeysForTrackRecord(record) {
		if a.musicBrainzTagEntityNeedsFetchLocked(entityKey, time.Now()) {
			entityKeys = append(entityKeys, entityKey)
		}
	}
	a.musicBrainzTagMu.Unlock()

	return entityKeys
}

func (a *App) processMusicBrainzTagTrackBatch(indexedByPath map[string]LibraryIndexedFile, paths []string) []string {
	if len(paths) == 0 {
		return nil
	}

	a.ensureSettingsLoaded()
	ffprobePath := resolveFFProbePath(a.settings.FFmpegPath)
	releaseDepthByRootPath := a.musicBrainzTagReleaseDepthByRootPath()
	workerCount := a.musicBrainzTagWorkerCount(len(paths))
	if workerCount <= 0 {
		workerCount = 1
	}

	jobs := make(chan string, len(paths))
	results := make(chan []string, len(paths))
	var waitGroup sync.WaitGroup

	for workerIndex := 0; workerIndex < workerCount; workerIndex++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for path := range jobs {
				indexed, exists := indexedByPath[path]
				if !exists {
					results <- nil
					continue
				}

				releaseDepth := releaseDepthByRootPath[strings.ToLower(normalizePath(indexed.RootPath))]
				results <- a.scanMusicBrainzTagTrack(indexed, releaseDepth, ffprobePath)
			}
		}()
	}

	for _, path := range paths {
		jobs <- path
	}
	close(jobs)

	waitGroup.Wait()
	close(results)

	entityKeys := make([]string, 0)
	seen := make(map[string]struct{})
	for batchKeys := range results {
		for _, entityKey := range batchKeys {
			if entityKey == "" {
				continue
			}

			if _, exists := seen[entityKey]; exists {
				continue
			}

			seen[entityKey] = struct{}{}
			entityKeys = append(entityKeys, entityKey)
		}
	}

	sort.Strings(entityKeys)
	return entityKeys
}

func fetchMusicBrainzTagEntityRecord(entityType string, mbid string, apiBaseURL string, rateLimit bool) (musicBrainzTagEntityRecord, bool) {
	cleanEntityType, cleanMBID, ok := parseMusicBrainzTagEntityKey(musicBrainzTagEntityKey(entityType, mbid))
	if !ok {
		return musicBrainzTagEntityRecord{}, false
	}

	incClause := "genres+tags"
	requestURL := ""
	titleField := "title"
	if cleanEntityType == "artist" {
		requestURL = apiBaseURL + "/artist/" + cleanMBID + "?fmt=json&inc=" + incClause
		titleField = "name"
	} else if cleanEntityType == "release" {
		requestURL = apiBaseURL + "/release/" + cleanMBID + "?fmt=json&inc=" + incClause
	} else {
		return musicBrainzTagEntityRecord{}, false
	}

	payload, ok := fetchMusicBrainzPayloadWithPriority(requestURL, musicBrainzRequestPriorityBackground, rateLimit)
	if !ok {
		return musicBrainzTagEntityRecord{}, false
	}

	now := time.Now()
	return musicBrainzTagEntityRecord{
		EntityType:    cleanEntityType,
		MBID:          cleanMBID,
		Title:         objectString(payload, titleField),
		Tags:          normalizeMusicBrainzTagNames(collectMusicBrainzTagNames(payload)),
		LastFetchedAt: now,
		LastAttemptAt: now,
	}, true
}

func (a *App) processMusicBrainzTagEntityFetch(entityKey string) bool {
	cleanEntityType, cleanMBID, ok := parseMusicBrainzTagEntityKey(entityKey)
	if !ok {
		return false
	}

	a.musicBrainzTagMu.Lock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()
	if !a.musicBrainzTagEntityNeedsFetchLocked(entityKey, time.Now()) {
		a.musicBrainzTagMu.Unlock()
		return false
	}
	a.musicBrainzTagMu.Unlock()

	record, fetched := fetchMusicBrainzTagEntityRecord(cleanEntityType, cleanMBID, a.musicBrainzAPIBaseURL(), a.musicBrainzRateLimit())
	now := time.Now()

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	if fetched {
		a.upsertMusicBrainzTagEntityRecordLocked(record)
		return true
	}

	existing := a.musicBrainzTagStore.Entities[entityKey]
	existing.EntityType = cleanEntityType
	existing.MBID = cleanMBID
	existing.LastAttemptAt = now
	existing.LastError = "MusicBrainz lookup failed"
	a.upsertMusicBrainzTagEntityRecordLocked(existing)
	return true
}

func (a *App) startMusicBrainzTagWorker() {
	if a.musicBrainzTagWorkerWake != nil {
		return
	}

	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	wakeCh := make(chan struct{}, 1)
	a.musicBrainzTagWorkerStop = stopCh
	a.musicBrainzTagWorkerDone = doneCh
	a.musicBrainzTagWorkerWake = wakeCh

	go a.musicBrainzTagWorkerLoop(stopCh, wakeCh, doneCh)
}

func (a *App) stopMusicBrainzTagWorker() {
	stopCh := a.musicBrainzTagWorkerStop
	doneCh := a.musicBrainzTagWorkerDone
	if stopCh == nil || doneCh == nil {
		return
	}

	a.musicBrainzTagWorkerStop = nil
	a.musicBrainzTagWorkerDone = nil
	a.musicBrainzTagWorkerWake = nil
	close(stopCh)
	<-doneCh
	a.persistMusicBrainzTagDatabase(true)
}

func (a *App) notifyMusicBrainzTagWorker() {
	a.musicBrainzTagWorkGeneration.Add(1)
	if a.musicBrainzTagWorkerWake == nil {
		return
	}

	select {
	case a.musicBrainzTagWorkerWake <- struct{}{}:
	default:
	}
}

func (a *App) musicBrainzTagWorkerLoop(stopCh <-chan struct{}, wakeCh <-chan struct{}, doneCh chan<- struct{}) {
	defer close(doneCh)
	flushTicker := time.NewTicker(musicBrainzTagDatabaseFlushInterval)
	defer flushTicker.Stop()

	state := musicBrainzTagWorkerState{}
	for {
		if !a.musicBrainzTagDatabaseEnabled() {
			a.persistMusicBrainzTagDatabase(false)
			select {
			case <-stopCh:
				a.persistMusicBrainzTagDatabase(true)
				return
			case <-wakeCh:
				state = musicBrainzTagWorkerState{}
				continue
			case <-flushTicker.C:
				continue
			}
		}

		currentGeneration := a.musicBrainzTagWorkGeneration.Load()
		if state.generation != currentGeneration {
			state = a.buildMusicBrainzTagWorkerState(currentGeneration)
		}

		didWork := false
		if len(state.pendingTrackPaths) > 0 {
			batchSize := a.musicBrainzTagTrackBatchSize()
			if batchSize > len(state.pendingTrackPaths) {
				batchSize = len(state.pendingTrackPaths)
			}

			batch := append([]string(nil), state.pendingTrackPaths[:batchSize]...)
			state.pendingTrackPaths = state.pendingTrackPaths[batchSize:]
			for _, entityKey := range a.processMusicBrainzTagTrackBatch(state.indexedByPath, batch) {
				state.queueEntityKey(entityKey)
			}
			didWork = true
		}

		if entityKey, ok := state.popNextEntityKey(); ok {
			if a.processMusicBrainzTagEntityFetch(entityKey) {
				didWork = true
			}
		}

		a.persistMusicBrainzTagDatabase(false)
		if didWork {
			continue
		}

		select {
		case <-stopCh:
			a.persistMusicBrainzTagDatabase(true)
			return
		case <-wakeCh:
			state = musicBrainzTagWorkerState{}
		case <-flushTicker.C:
		}
	}
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
				for folderPath := range a.musicBrainzTagReleaseFoldersByID[record.MBID] {
					key := strings.ToLower(folderPath)
					if _, exists := seen[key]; exists {
						continue
					}

					seen[key] = struct{}{}
					folderPaths = append(folderPaths, folderPath)
				}
			case "artist":
				for folderPath := range a.musicBrainzTagArtistFoldersByID[record.MBID] {
					key := strings.ToLower(folderPath)
					if _, exists := seen[key]; exists {
						continue
					}

					seen[key] = struct{}{}
					folderPaths = append(folderPaths, folderPath)
				}
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

	if !a.scanInProgress {
		a.maybeStartLibraryDerivedIndexRebuildLocked()
	}

	if a.isLibraryDerivedIndexReadyLocked() {
		_, exists := a.folderEntriesByFolder[cleanFolderPath]
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
	for _, folderPath := range folderPaths {
		cleanFolderPath := normalizeMusicBrainzTagFolderPath(folderPath)
		if cleanFolderPath == "" {
			continue
		}

		key := strings.ToLower(cleanFolderPath)
		if _, exists := seen[key]; exists || !a.isMusicBrainzTagSearchFolderAvailableLocked(cleanFolderPath) {
			continue
		}

		seen[key] = struct{}{}
		entries = append(entries, folderBrowserEntry(cleanFolderPath))
	}

	sortBrowserEntriesByPath(entries)
	return entries
}
