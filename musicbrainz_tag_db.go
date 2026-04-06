package main

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const musicBrainzTagDatabaseFileName = "silphium.musicbrainz.tags.sqlite3"
const legacyMusicBrainzTagDatabaseFileName = "silphium.musicbrainz.tags.json"
const musicBrainzTagDatabaseVersion = 1
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
	generation             uint64
	indexedByPath          map[string]LibraryIndexedFile
	pendingTrackPaths      []string
	totalTrackPaths        int
	completedTrackPaths    int
	referencedEntityKeys   map[string]struct{}
	pendingEntityKeys      map[string]struct{}
	pendingEntityOrder     []string
	totalEntityLookups     int
	completedEntityLookups int
}

type musicBrainzTagTrackScanResult struct {
	completedEntityKeys []string
	pendingEntityKeys   []string
}

type musicBrainzTagTrackScanCandidate struct {
	path              string
	releaseFolderPath string
	artistFolderPaths []string
}

type musicBrainzTagTrackRepresentative struct {
	path              string
	signature         trackTagsFileSignature
	releaseFolderPath string
	artistFolderPaths []string
}

type musicBrainzTagStoredTrackRecord struct {
	path   string
	record musicBrainzTagTrackRecord
}

type musicBrainzTagEntityRefreshCandidate struct {
	entityKey     string
	lastFetchedAt time.Time
}

// MusicBrainzTagWorkerProgress reports background MusicBrainz tag worker status.
type MusicBrainzTagWorkerProgress struct {
	Enabled                bool    `json:"enabled"`
	Active                 bool    `json:"active"`
	Progress               float64 `json:"progress"`
	PendingTrackScans      int     `json:"pendingTrackScans"`
	TotalTrackScans        int     `json:"totalTrackScans"`
	CompletedTrackScans    int     `json:"completedTrackScans"`
	PendingEntityLookups   int     `json:"pendingEntityLookups"`
	TotalEntityLookups     int     `json:"totalEntityLookups"`
	CompletedEntityLookups int     `json:"completedEntityLookups"`
}

func clampMusicBrainzTagWorkerProgress(value float64) float64 {
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}

	return value
}

func (state musicBrainzTagWorkerState) progressSnapshot(enabled bool) MusicBrainzTagWorkerProgress {
	pendingTrackScans := len(state.pendingTrackPaths)
	completedTrackScans := state.completedTrackPaths
	if completedTrackScans < 0 {
		completedTrackScans = 0
	}
	if completedTrackScans > state.totalTrackPaths {
		completedTrackScans = state.totalTrackPaths
	}

	pendingEntityLookups := len(state.pendingEntityKeys)
	completedEntityLookups := state.completedEntityLookups
	if completedEntityLookups < 0 {
		completedEntityLookups = 0
	}
	if completedEntityLookups > state.totalEntityLookups {
		completedEntityLookups = state.totalEntityLookups
	}

	totalWorkUnits := state.totalTrackPaths + state.totalEntityLookups
	completedWorkUnits := completedTrackScans + completedEntityLookups
	progress := 0.0
	if enabled {
		if totalWorkUnits == 0 {
			progress = 1
		} else {
			progress = float64(completedWorkUnits) / float64(totalWorkUnits)
		}
	}

	return MusicBrainzTagWorkerProgress{
		Enabled:                enabled,
		Active:                 enabled && (pendingTrackScans > 0 || pendingEntityLookups > 0),
		Progress:               clampMusicBrainzTagWorkerProgress(progress),
		PendingTrackScans:      pendingTrackScans,
		TotalTrackScans:        state.totalTrackPaths,
		CompletedTrackScans:    completedTrackScans,
		PendingEntityLookups:   pendingEntityLookups,
		TotalEntityLookups:     state.totalEntityLookups,
		CompletedEntityLookups: completedEntityLookups,
	}
}

func (state *musicBrainzTagWorkerState) noteCompletedEntityKey(entityKey string) {
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanEntityKey == "" {
		return
	}

	if state.referencedEntityKeys == nil {
		state.referencedEntityKeys = make(map[string]struct{})
	}

	if _, exists := state.referencedEntityKeys[cleanEntityKey]; exists {
		return
	}

	state.referencedEntityKeys[cleanEntityKey] = struct{}{}
	state.totalEntityLookups++
	state.completedEntityLookups++
}

func (state *musicBrainzTagWorkerState) notePendingEntityKey(entityKey string) {
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanEntityKey == "" {
		return
	}

	if state.referencedEntityKeys == nil {
		state.referencedEntityKeys = make(map[string]struct{})
	}

	if _, exists := state.referencedEntityKeys[cleanEntityKey]; !exists {
		state.referencedEntityKeys[cleanEntityKey] = struct{}{}
		state.totalEntityLookups++
	}

	state.queueEntityKey(cleanEntityKey)
}

func musicBrainzTagPathLessCaseInsensitive(left string, right string) bool {
	leftLower := strings.ToLower(strings.TrimSpace(left))
	rightLower := strings.ToLower(strings.TrimSpace(right))
	if leftLower == rightLower {
		return left < right
	}

	return leftLower < rightLower
}

func selectMusicBrainzTagRepresentativeTrack(candidates []musicBrainzTagTrackScanCandidate) (musicBrainzTagTrackRepresentative, bool) {
	for _, candidate := range candidates {
		signature, ok := trackTagsFileSignatureForPath(candidate.path)
		if !ok {
			continue
		}

		return musicBrainzTagTrackRepresentative{
			path:              candidate.path,
			signature:         signature,
			releaseFolderPath: candidate.releaseFolderPath,
			artistFolderPaths: candidate.artistFolderPaths,
		}, true
	}

	return musicBrainzTagTrackRepresentative{}, false
}

func (a *App) storedMusicBrainzTagTrackRecordsByReleaseFolderLocked() map[string]musicBrainzTagStoredTrackRecord {
	recordsByReleaseFolder := make(map[string]musicBrainzTagStoredTrackRecord, len(a.musicBrainzTagStore.Tracks))
	for path, record := range a.musicBrainzTagStore.Tracks {
		releaseFolderPath := normalizeMusicBrainzTagFolderPath(record.ReleaseFolderPath)
		if releaseFolderPath == "" {
			continue
		}

		existing, exists := recordsByReleaseFolder[releaseFolderPath]
		if exists && !musicBrainzTagPathLessCaseInsensitive(path, existing.path) {
			continue
		}

		recordsByReleaseFolder[releaseFolderPath] = musicBrainzTagStoredTrackRecord{
			path:   path,
			record: record,
		}
	}

	return recordsByReleaseFolder
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

func (state *musicBrainzTagWorkerState) queueEntityKey(entityKey string) bool {
	cleanEntityKey := strings.TrimSpace(entityKey)
	if cleanEntityKey == "" {
		return false
	}

	if state.pendingEntityKeys == nil {
		state.pendingEntityKeys = make(map[string]struct{})
	}

	if _, exists := state.pendingEntityKeys[cleanEntityKey]; exists {
		return false
	}

	state.pendingEntityKeys[cleanEntityKey] = struct{}{}
	state.pendingEntityOrder = append(state.pendingEntityOrder, cleanEntityKey)
	return true
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

func musicBrainzTagEntityRefreshInterval(staleDays int) time.Duration {
	if staleDays <= 0 {
		return 0
	}

	return time.Duration(staleDays) * 24 * time.Hour
}

func musicBrainzTagStaggeredRefreshCount(totalEntityCount int, staleDays int) int {
	if totalEntityCount <= 0 || staleDays <= 0 {
		return 0
	}

	refreshCount := totalEntityCount / staleDays
	if totalEntityCount%staleDays != 0 {
		refreshCount++
	}
	if refreshCount < 1 {
		return 1
	}

	return refreshCount
}

func musicBrainzTagSameDay(left time.Time, right time.Time) bool {
	if left.IsZero() || right.IsZero() {
		return false
	}

	leftLocal := left.In(time.Local)
	rightLocal := right.In(time.Local)
	leftYear, leftMonth, leftDay := leftLocal.Date()
	rightYear, rightMonth, rightDay := rightLocal.Date()

	return leftYear == rightYear && leftMonth == rightMonth && leftDay == rightDay
}

func (a *App) musicBrainzTagDatabaseEnabled() bool {
	a.ensureSettingsLoaded()
	return a.settings.MusicBrainzTagDatabaseEnabled
}

func (a *App) musicBrainzTagStaleDays() int {
	a.ensureSettingsLoaded()
	return normalizeMusicBrainzTagStaleDays(a.settings.MusicBrainzTagStaleDays)
}

func (a *App) musicBrainzTagRequestStaggeringEnabled() bool {
	a.ensureSettingsLoaded()
	return a.settings.MusicBrainzTagRequestStaggeringEnabled && a.musicBrainzTagStaleDays() > 0
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
		generation:           generation,
		indexedByPath:        snapshot,
		referencedEntityKeys: make(map[string]struct{}),
		pendingEntityKeys:    make(map[string]struct{}),
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
	releaseFolderOrder := make([]string, 0, len(paths))
	candidatesByReleaseFolder := make(map[string][]musicBrainzTagTrackScanCandidate, len(paths))
	for _, path := range paths {
		indexed := snapshot[path]
		releaseDepth := releaseDepthByRootPath[strings.ToLower(normalizePath(indexed.RootPath))]
		releaseFolderPath := releaseFolderPathForIndexedTrack(indexed, releaseDepth)
		if _, exists := candidatesByReleaseFolder[releaseFolderPath]; !exists {
			releaseFolderOrder = append(releaseFolderOrder, releaseFolderPath)
		}

		candidatesByReleaseFolder[releaseFolderPath] = append(candidatesByReleaseFolder[releaseFolderPath], musicBrainzTagTrackScanCandidate{
			path:              path,
			releaseFolderPath: releaseFolderPath,
			artistFolderPaths: artistFolderPathsForIndexedTrack(indexed, releaseDepth),
		})
	}

	representatives := make([]musicBrainzTagTrackRepresentative, 0, len(releaseFolderOrder))
	releaseFoldersWithoutRepresentative := make(map[string]struct{})
	for _, releaseFolderPath := range releaseFolderOrder {
		representative, ok := selectMusicBrainzTagRepresentativeTrack(candidatesByReleaseFolder[releaseFolderPath])
		if !ok {
			releaseFoldersWithoutRepresentative[releaseFolderPath] = struct{}{}
			continue
		}

		representatives = append(representatives, representative)
	}

	now := time.Now()

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()
	existingRecordsByReleaseFolder := a.storedMusicBrainzTagTrackRecordsByReleaseFolderLocked()
	representativePaths := make(map[string]struct{}, len(representatives))
	tracksChanged := false

	for releaseFolderPath := range releaseFoldersWithoutRepresentative {
		existingRecord, exists := existingRecordsByReleaseFolder[releaseFolderPath]
		if !exists {
			continue
		}

		a.removeMusicBrainzTagTrackRecordLocked(existingRecord.path)
		tracksChanged = true
	}

	for _, representative := range representatives {
		representativePaths[representative.path] = struct{}{}

		existingAtPath, existsAtPath := a.musicBrainzTagStore.Tracks[representative.path]
		if existsAtPath && existingAtPath.Signature == representative.signature {
			if existingAtPath.ReleaseFolderPath != representative.releaseFolderPath || !stringSlicesEqual(existingAtPath.ArtistFolderPaths, representative.artistFolderPaths) {
				existingAtPath.ReleaseFolderPath = representative.releaseFolderPath
				existingAtPath.ArtistFolderPaths = representative.artistFolderPaths
				a.upsertMusicBrainzTagTrackRecordLocked(representative.path, existingAtPath)
				tracksChanged = true
			}
			state.completedTrackPaths++
			continue
		}

		existingReleaseRecord, hasExistingReleaseRecord := existingRecordsByReleaseFolder[representative.releaseFolderPath]
		if hasExistingReleaseRecord && existingReleaseRecord.path != representative.path {
			migratedRecord := existingReleaseRecord.record
			migratedRecord.Signature = representative.signature
			migratedRecord.ReleaseFolderPath = representative.releaseFolderPath
			migratedRecord.ArtistFolderPaths = representative.artistFolderPaths
			a.upsertMusicBrainzTagTrackRecordLocked(representative.path, migratedRecord)
			tracksChanged = true
			state.completedTrackPaths++
			continue
		}

		state.pendingTrackPaths = append(state.pendingTrackPaths, representative.path)
	}

	for path := range a.musicBrainzTagStore.Tracks {
		if _, exists := representativePaths[path]; exists {
			continue
		}

		a.removeMusicBrainzTagTrackRecordLocked(path)
		tracksChanged = true
	}

	if tracksChanged {
		a.rebuildMusicBrainzTagIndexesLocked()
	}
	state.totalTrackPaths = len(representatives)

	staggeringEnabled := a.musicBrainzTagRequestStaggeringEnabled()
	staleDays := a.musicBrainzTagStaleDays()
	referencedEntityKeys := make(map[string]struct{})
	pendingEntityKeys := make(map[string]struct{})
	pendingEntityOrder := make([]string, 0)
	refreshCandidates := make([]musicBrainzTagEntityRefreshCandidate, 0)
	usedStaggeredRefreshCount := 0
	queuePendingEntityKey := func(entityKey string) {
		cleanEntityKey := strings.TrimSpace(entityKey)
		if cleanEntityKey == "" {
			return
		}

		if _, exists := pendingEntityKeys[cleanEntityKey]; exists {
			return
		}

		pendingEntityKeys[cleanEntityKey] = struct{}{}
		pendingEntityOrder = append(pendingEntityOrder, cleanEntityKey)
	}

	for _, path := range sortedMusicBrainzTagTrackPaths(a.musicBrainzTagStore) {
		record := a.musicBrainzTagStore.Tracks[path]
		for _, entityKey := range musicBrainzTagEntityKeysForTrackRecord(record) {
			cleanEntityKey := strings.TrimSpace(entityKey)
			if cleanEntityKey == "" {
				continue
			}

			if _, exists := referencedEntityKeys[cleanEntityKey]; exists {
				continue
			}

			referencedEntityKeys[cleanEntityKey] = struct{}{}
			storedRecord, exists := a.musicBrainzTagStore.Entities[cleanEntityKey]
			if !exists {
				queuePendingEntityKey(cleanEntityKey)
				continue
			}

			if storedRecord.LastFetchedAt.IsZero() {
				if storedRecord.LastAttemptAt.IsZero() || now.Sub(storedRecord.LastAttemptAt) >= musicBrainzTagEntityRetryInterval {
					queuePendingEntityKey(cleanEntityKey)
				}
				continue
			}

			if staggeringEnabled && musicBrainzTagSameDay(storedRecord.LastFetchedAt, now) {
				usedStaggeredRefreshCount++
				continue
			}

			if storedRecord.LastError != "" && now.Sub(storedRecord.LastAttemptAt) >= musicBrainzTagEntityRetryInterval {
				queuePendingEntityKey(cleanEntityKey)
				continue
			}

			if staggeringEnabled {
				refreshCandidates = append(refreshCandidates, musicBrainzTagEntityRefreshCandidate{
					entityKey:     cleanEntityKey,
					lastFetchedAt: storedRecord.LastFetchedAt,
				})
				continue
			}

			refreshInterval := musicBrainzTagEntityRefreshInterval(staleDays)
			if refreshInterval > 0 && now.Sub(storedRecord.LastFetchedAt) >= refreshInterval {
				queuePendingEntityKey(cleanEntityKey)
			}
		}
	}

	if staggeringEnabled && len(refreshCandidates) > 0 {
		sort.Slice(refreshCandidates, func(leftIndex int, rightIndex int) bool {
			leftCandidate := refreshCandidates[leftIndex]
			rightCandidate := refreshCandidates[rightIndex]
			if leftCandidate.lastFetchedAt.Equal(rightCandidate.lastFetchedAt) {
				return leftCandidate.entityKey < rightCandidate.entityKey
			}

			return leftCandidate.lastFetchedAt.Before(rightCandidate.lastFetchedAt)
		})

		refreshCount := musicBrainzTagStaggeredRefreshCount(len(referencedEntityKeys), staleDays) - usedStaggeredRefreshCount
		if refreshCount < 0 {
			refreshCount = 0
		}
		if refreshCount > len(refreshCandidates) {
			refreshCount = len(refreshCandidates)
		}

		for _, candidate := range refreshCandidates[:refreshCount] {
			queuePendingEntityKey(candidate.entityKey)
		}
	}

	state.referencedEntityKeys = referencedEntityKeys
	state.pendingEntityKeys = pendingEntityKeys
	state.pendingEntityOrder = pendingEntityOrder
	state.totalEntityLookups = len(referencedEntityKeys)
	state.completedEntityLookups = state.totalEntityLookups - len(pendingEntityKeys)

	for entityKey := range a.musicBrainzTagStore.Entities {
		if _, exists := state.referencedEntityKeys[entityKey]; exists {
			continue
		}

		a.removeMusicBrainzTagEntityRecordLocked(entityKey)
	}

	return state
}

func (a *App) setMusicBrainzTagWorkerProgress(progress MusicBrainzTagWorkerProgress) {
	progress.Progress = clampMusicBrainzTagWorkerProgress(progress.Progress)

	a.musicBrainzTagProgressMu.Lock()
	changed := a.musicBrainzTagProgress != progress
	a.musicBrainzTagProgress = progress
	a.musicBrainzTagProgressMu.Unlock()

	if changed && a.ctx != nil {
		runtime.EventsEmit(a.ctx, musicBrainzTagWorkerProgressEvent, progress)
	}
}

// GetMusicBrainzTagWorkerProgress returns the current MusicBrainz tag worker snapshot.
func (a *App) GetMusicBrainzTagWorkerProgress() MusicBrainzTagWorkerProgress {
	a.musicBrainzTagProgressMu.Lock()
	progress := a.musicBrainzTagProgress
	a.musicBrainzTagProgressMu.Unlock()

	enabled := a.musicBrainzTagDatabaseEnabled()
	if progress != (MusicBrainzTagWorkerProgress{}) || !enabled {
		if progress == (MusicBrainzTagWorkerProgress{}) {
			progress.Enabled = enabled
		}
		return progress
	}

	state := a.buildMusicBrainzTagWorkerState(a.musicBrainzTagWorkGeneration.Load())
	progress = state.progressSnapshot(true)
	a.setMusicBrainzTagWorkerProgress(progress)
	return progress
}

func (a *App) musicBrainzTagEntityNeedsFetchLocked(entityKey string, now time.Time) bool {
	record, exists := a.musicBrainzTagStore.Entities[strings.TrimSpace(entityKey)]
	if !exists {
		return true
	}

	if record.LastFetchedAt.IsZero() {
		return record.LastAttemptAt.IsZero() || now.Sub(record.LastAttemptAt) >= musicBrainzTagEntityRetryInterval
	}

	if record.LastError != "" && now.Sub(record.LastAttemptAt) >= musicBrainzTagEntityRetryInterval {
		return true
	}

	if a.musicBrainzTagRequestStaggeringEnabled() {
		return false
	}

	refreshInterval := musicBrainzTagEntityRefreshInterval(a.musicBrainzTagStaleDays())
	if refreshInterval <= 0 {
		return false
	}

	return now.Sub(record.LastFetchedAt) >= refreshInterval
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

func (a *App) scanMusicBrainzTagTrack(indexed LibraryIndexedFile, releaseDepth int, ffprobePath string) musicBrainzTagTrackScanResult {
	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		a.musicBrainzTagMu.Lock()
		a.ensureMusicBrainzTagDatabaseLoadedLocked()
		a.removeMusicBrainzTagTrackRecordLocked(indexed.Path)
		a.musicBrainzTagMu.Unlock()
		return musicBrainzTagTrackScanResult{}
	}

	var trackTags TrackTags
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
	result := musicBrainzTagTrackScanResult{
		completedEntityKeys: make([]string, 0, len(record.ArtistIDs)+1),
		pendingEntityKeys:   make([]string, 0, len(record.ArtistIDs)+1),
	}
	for _, entityKey := range musicBrainzTagEntityKeysForTrackRecord(record) {
		if a.musicBrainzTagEntityNeedsFetchLocked(entityKey, time.Now()) {
			result.pendingEntityKeys = append(result.pendingEntityKeys, entityKey)
			continue
		}

		result.completedEntityKeys = append(result.completedEntityKeys, entityKey)
	}
	a.musicBrainzTagMu.Unlock()

	return result
}

func (a *App) processMusicBrainzTagTrackBatch(indexedByPath map[string]LibraryIndexedFile, paths []string) musicBrainzTagTrackScanResult {
	if len(paths) == 0 {
		return musicBrainzTagTrackScanResult{}
	}

	a.ensureSettingsLoaded()
	ffprobePath := resolveFFProbePath(a.settings.FFmpegPath)
	releaseDepthByRootPath := a.musicBrainzTagReleaseDepthByRootPath()
	workerCount := a.musicBrainzTagWorkerCount(len(paths))
	if workerCount <= 0 {
		workerCount = 1
	}

	jobs := make(chan string, len(paths))
	results := make(chan musicBrainzTagTrackScanResult, len(paths))
	var waitGroup sync.WaitGroup

	for workerIndex := 0; workerIndex < workerCount; workerIndex++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for path := range jobs {
				indexed, exists := indexedByPath[path]
				if !exists {
					results <- musicBrainzTagTrackScanResult{}
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

	batchResult := musicBrainzTagTrackScanResult{}
	seenCompleted := make(map[string]struct{})
	seenPending := make(map[string]struct{})
	for result := range results {
		for _, entityKey := range result.completedEntityKeys {
			if entityKey == "" {
				continue
			}

			if _, exists := seenCompleted[entityKey]; exists {
				continue
			}

			seenCompleted[entityKey] = struct{}{}
			batchResult.completedEntityKeys = append(batchResult.completedEntityKeys, entityKey)
		}

		for _, entityKey := range result.pendingEntityKeys {
			if entityKey == "" {
				continue
			}

			if _, exists := seenPending[entityKey]; exists {
				continue
			}

			seenPending[entityKey] = struct{}{}
			batchResult.pendingEntityKeys = append(batchResult.pendingEntityKeys, entityKey)
		}
	}

	sort.Strings(batchResult.completedEntityKeys)
	sort.Strings(batchResult.pendingEntityKeys)
	return batchResult
}

func fetchMusicBrainzTagEntityRecord(entityType string, mbid string, apiBaseURL string, rateLimitMs int) (musicBrainzTagEntityRecord, bool) {
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

	payload, ok := fetchMusicBrainzPayloadWithPriority(requestURL, musicBrainzRequestPriorityBackground, rateLimitMs)
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
	a.musicBrainzTagMu.Unlock()

	record, fetched := fetchMusicBrainzTagEntityRecord(cleanEntityType, cleanMBID, a.musicBrainzAPIBaseURL(), a.musicBrainzRequestRateMs())
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
			a.setMusicBrainzTagWorkerProgress(MusicBrainzTagWorkerProgress{Enabled: false})
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
			a.setMusicBrainzTagWorkerProgress(state.progressSnapshot(true))
		}

		didWork := false
		if len(state.pendingTrackPaths) > 0 {
			batchSize := a.musicBrainzTagTrackBatchSize()
			if batchSize > len(state.pendingTrackPaths) {
				batchSize = len(state.pendingTrackPaths)
			}

			batch := append([]string(nil), state.pendingTrackPaths[:batchSize]...)
			state.pendingTrackPaths = state.pendingTrackPaths[batchSize:]
			batchResult := a.processMusicBrainzTagTrackBatch(state.indexedByPath, batch)
			for _, entityKey := range batchResult.completedEntityKeys {
				state.noteCompletedEntityKey(entityKey)
			}
			for _, entityKey := range batchResult.pendingEntityKeys {
				state.notePendingEntityKey(entityKey)
			}
			state.completedTrackPaths += len(batch)
			didWork = true
		}

		if len(state.pendingEntityKeys) > 0 {
			workerCount := a.musicBrainzTagWorkerCount(len(state.pendingEntityKeys))
			if workerCount > 0 {
				completedEntityFetches := 0
				activeWorkers := 0
				completionCh := make(chan struct{}, workerCount)

				launchFetch := func(entityKey string) {
					activeWorkers++
					go func(activeEntityKey string) {
						a.processMusicBrainzTagEntityFetch(activeEntityKey)
						completionCh <- struct{}{}
					}(entityKey)
				}

				for activeWorkers < workerCount {
					entityKey, ok := state.popNextEntityKey()
					if !ok {
						break
					}

					launchFetch(entityKey)
				}

				for activeWorkers > 0 {
					<-completionCh
					activeWorkers--
					completedEntityFetches++
					state.completedEntityLookups++

					if completedEntityFetches%workerCount == 0 {
						a.setMusicBrainzTagWorkerProgress(state.progressSnapshot(true))
					}

					nextEntityKey, ok := state.popNextEntityKey()
					if ok {
						launchFetch(nextEntityKey)
					}
				}
				didWork = completedEntityFetches > 0
			}
		}

		a.persistMusicBrainzTagDatabase(false)
		a.setMusicBrainzTagWorkerProgress(state.progressSnapshot(true))
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
