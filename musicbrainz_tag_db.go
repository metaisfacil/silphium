package main

import (
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const musicBrainzTagDatabaseFileName = "silphium.musicbrainz.tags.sqlite3"
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
	for _, path := range sortedMusicBrainzTagTrackPaths(a.musicBrainzTagStore) {
		record := a.musicBrainzTagStore.Tracks[path]
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

func (a *App) musicBrainzTagDatabasePath() string {
	settingsPath := a.ensureSettingsPath()
	return filepath.Join(filepath.Dir(settingsPath), musicBrainzTagDatabaseFileName)
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
