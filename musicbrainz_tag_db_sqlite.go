package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const musicBrainzTagSQLiteDriverName = "sqlite"

var musicBrainzTagSQLiteSchemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS track_scans (
		path TEXT PRIMARY KEY,
		size INTEGER NOT NULL,
		mod_unix_ns INTEGER NOT NULL,
		release_id TEXT NOT NULL DEFAULT '',
		release_folder_path TEXT NOT NULL DEFAULT '',
		last_scanned_unix_ns INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS track_scan_artist_ids (
		path TEXT NOT NULL,
		artist_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (path, artist_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_track_scan_artist_ids_artist_id ON track_scan_artist_ids (artist_id)`,
	`CREATE TABLE IF NOT EXISTS track_scan_artist_folders (
		path TEXT NOT NULL,
		folder_path TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (path, folder_path)
	)`,
	`CREATE TABLE IF NOT EXISTS entities (
		entity_type TEXT NOT NULL,
		mbid TEXT NOT NULL,
		title TEXT NOT NULL DEFAULT '',
		last_fetched_unix_ns INTEGER NOT NULL DEFAULT 0,
		last_attempt_unix_ns INTEGER NOT NULL DEFAULT 0,
		last_error TEXT NOT NULL DEFAULT '',
		PRIMARY KEY (entity_type, mbid)
	)`,
	`CREATE TABLE IF NOT EXISTS entity_tags (
		entity_type TEXT NOT NULL,
		mbid TEXT NOT NULL,
		tag_name TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (entity_type, mbid, tag_name)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_entity_tags_tag_name ON entity_tags (tag_name)`,
}

func musicBrainzTagDatabaseFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}

	return !info.IsDir()
}

func openMusicBrainzTagSQLite(path string) (*sql.DB, error) {
	directory := filepath.Dir(path)
	if directory != "" && directory != "." {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return nil, err
		}
	}

	database, err := sql.Open(musicBrainzTagSQLiteDriverName, path)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)
	if err := configureMusicBrainzTagSQLite(database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func configureMusicBrainzTagSQLite(database *sql.DB) error {
	var journalMode string
	if err := database.QueryRow(`PRAGMA journal_mode=WAL`).Scan(&journalMode); err != nil {
		return err
	}

	if _, err := database.Exec(`PRAGMA synchronous=NORMAL`); err != nil {
		return err
	}

	return nil
}

func initializeMusicBrainzTagSQLite(database *sql.DB) error {
	for _, statement := range musicBrainzTagSQLiteSchemaStatements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}

	return nil
}

func timeFromUnixNanoValue(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}

	return time.Unix(0, value)
}

func timeToUnixNanoValue(value time.Time) int64 {
	if value.IsZero() {
		return 0
	}

	return value.UnixNano()
}

func sortedMusicBrainzTagTrackPaths(store musicBrainzTagDatabaseStore) []string {
	paths := make([]string, 0, len(store.Tracks))
	for path := range store.Tracks {
		paths = append(paths, path)
	}

	sortPathsCaseInsensitive(paths)
	return paths
}

func sortedMusicBrainzTagEntityKeys(store musicBrainzTagDatabaseStore) []string {
	entityKeys := make([]string, 0, len(store.Entities))
	for entityKey := range store.Entities {
		entityKeys = append(entityKeys, entityKey)
	}

	sort.Strings(entityKeys)
	return entityKeys
}

func loadMusicBrainzTagDatabaseStore(databasePath string, legacyPath string) (musicBrainzTagDatabaseStore, bool) {
	if musicBrainzTagDatabaseFileExists(databasePath) {
		if store, err := loadMusicBrainzTagDatabaseStoreFromSQLite(databasePath); err == nil {
			return store, false
		}
	}

	if musicBrainzTagDatabaseFileExists(legacyPath) {
		rawBytes, err := os.ReadFile(legacyPath)
		if err == nil {
			var decoded musicBrainzTagDatabaseStore
			if json.Unmarshal(rawBytes, &decoded) == nil {
				return normalizeMusicBrainzTagDatabaseStore(decoded), true
			}
		}
	}

	return newMusicBrainzTagDatabaseStore(), false
}

func loadMusicBrainzTagDatabaseStoreFromSQLite(path string) (musicBrainzTagDatabaseStore, error) {
	store := newMusicBrainzTagDatabaseStore()
	database, err := openMusicBrainzTagSQLite(path)
	if err != nil {
		return store, err
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		return store, err
	}

	return loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database)
}

func loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database *sql.DB) (musicBrainzTagDatabaseStore, error) {
	store := newMusicBrainzTagDatabaseStore()

	trackRows, err := database.Query(`SELECT path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns FROM track_scans ORDER BY path`)
	if err != nil {
		return store, err
	}
	for trackRows.Next() {
		var path string
		var size int64
		var modUnixNs int64
		var releaseID string
		var releaseFolderPath string
		var lastScannedUnixNs int64
		if err := trackRows.Scan(&path, &size, &modUnixNs, &releaseID, &releaseFolderPath, &lastScannedUnixNs); err != nil {
			trackRows.Close()
			return store, err
		}

		store.Tracks[path] = musicBrainzTagTrackRecord{
			Signature: trackTagsFileSignature{
				Size:      size,
				ModUnixNs: modUnixNs,
			},
			ReleaseID:         releaseID,
			ReleaseFolderPath: releaseFolderPath,
			LastScannedAt:     timeFromUnixNanoValue(lastScannedUnixNs),
		}
	}
	if err := trackRows.Err(); err != nil {
		trackRows.Close()
		return store, err
	}
	trackRows.Close()

	trackArtistRows, err := database.Query(`SELECT path, artist_id FROM track_scan_artist_ids ORDER BY path, position`)
	if err != nil {
		return store, err
	}
	for trackArtistRows.Next() {
		var path string
		var artistID string
		if err := trackArtistRows.Scan(&path, &artistID); err != nil {
			trackArtistRows.Close()
			return store, err
		}

		record, exists := store.Tracks[path]
		if !exists {
			continue
		}

		record.ArtistIDs = append(record.ArtistIDs, artistID)
		store.Tracks[path] = record
	}
	if err := trackArtistRows.Err(); err != nil {
		trackArtistRows.Close()
		return store, err
	}
	trackArtistRows.Close()

	trackFolderRows, err := database.Query(`SELECT path, folder_path FROM track_scan_artist_folders ORDER BY path, position`)
	if err != nil {
		return store, err
	}
	for trackFolderRows.Next() {
		var path string
		var folderPath string
		if err := trackFolderRows.Scan(&path, &folderPath); err != nil {
			trackFolderRows.Close()
			return store, err
		}

		record, exists := store.Tracks[path]
		if !exists {
			continue
		}

		record.ArtistFolderPaths = append(record.ArtistFolderPaths, folderPath)
		store.Tracks[path] = record
	}
	if err := trackFolderRows.Err(); err != nil {
		trackFolderRows.Close()
		return store, err
	}
	trackFolderRows.Close()

	entityRows, err := database.Query(`SELECT entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error FROM entities ORDER BY entity_type, mbid`)
	if err != nil {
		return store, err
	}
	for entityRows.Next() {
		var entityType string
		var mbid string
		var title string
		var lastFetchedUnixNs int64
		var lastAttemptUnixNs int64
		var lastError string
		if err := entityRows.Scan(&entityType, &mbid, &title, &lastFetchedUnixNs, &lastAttemptUnixNs, &lastError); err != nil {
			entityRows.Close()
			return store, err
		}

		entityKey := musicBrainzTagEntityKey(entityType, mbid)
		if entityKey == "" {
			continue
		}

		store.Entities[entityKey] = musicBrainzTagEntityRecord{
			EntityType:    entityType,
			MBID:          mbid,
			Title:         title,
			LastFetchedAt: timeFromUnixNanoValue(lastFetchedUnixNs),
			LastAttemptAt: timeFromUnixNanoValue(lastAttemptUnixNs),
			LastError:     lastError,
		}
	}
	if err := entityRows.Err(); err != nil {
		entityRows.Close()
		return store, err
	}
	entityRows.Close()

	entityTagRows, err := database.Query(`SELECT entity_type, mbid, tag_name FROM entity_tags ORDER BY entity_type, mbid, position`)
	if err != nil {
		return store, err
	}
	for entityTagRows.Next() {
		var entityType string
		var mbid string
		var tagName string
		if err := entityTagRows.Scan(&entityType, &mbid, &tagName); err != nil {
			entityTagRows.Close()
			return store, err
		}

		entityKey := musicBrainzTagEntityKey(entityType, mbid)
		record, exists := store.Entities[entityKey]
		if !exists {
			continue
		}

		record.Tags = append(record.Tags, tagName)
		store.Entities[entityKey] = record
	}
	if err := entityTagRows.Err(); err != nil {
		entityTagRows.Close()
		return store, err
	}
	entityTagRows.Close()

	return normalizeMusicBrainzTagDatabaseStore(store), nil
}

func musicBrainzTagTrackRecordsEqual(left musicBrainzTagTrackRecord, right musicBrainzTagTrackRecord) bool {
	return left.Signature == right.Signature &&
		left.ReleaseID == right.ReleaseID &&
		stringSlicesEqual(left.ArtistIDs, right.ArtistIDs) &&
		left.ReleaseFolderPath == right.ReleaseFolderPath &&
		stringSlicesEqual(left.ArtistFolderPaths, right.ArtistFolderPaths) &&
		timeToUnixNanoValue(left.LastScannedAt) == timeToUnixNanoValue(right.LastScannedAt)
}

func musicBrainzTagEntityRecordsEqual(left musicBrainzTagEntityRecord, right musicBrainzTagEntityRecord) bool {
	return left.EntityType == right.EntityType &&
		left.MBID == right.MBID &&
		left.Title == right.Title &&
		stringSlicesEqual(left.Tags, right.Tags) &&
		timeToUnixNanoValue(left.LastFetchedAt) == timeToUnixNanoValue(right.LastFetchedAt) &&
		timeToUnixNanoValue(left.LastAttemptAt) == timeToUnixNanoValue(right.LastAttemptAt) &&
		left.LastError == right.LastError
}

func deleteMusicBrainzTagTrackRow(transaction *sql.Tx, path string) error {
	for _, statement := range []string{
		`DELETE FROM track_scan_artist_ids WHERE path = ?`,
		`DELETE FROM track_scan_artist_folders WHERE path = ?`,
		`DELETE FROM track_scans WHERE path = ?`,
	} {
		if _, err := transaction.Exec(statement, path); err != nil {
			return err
		}
	}

	return nil
}

func upsertMusicBrainzTagTrackRow(transaction *sql.Tx, path string, record musicBrainzTagTrackRecord) error {
	if _, err := transaction.Exec(
		`INSERT INTO track_scans(path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		 	size = excluded.size,
		 	mod_unix_ns = excluded.mod_unix_ns,
		 	release_id = excluded.release_id,
		 	release_folder_path = excluded.release_folder_path,
		 	last_scanned_unix_ns = excluded.last_scanned_unix_ns`,
		path,
		record.Signature.Size,
		record.Signature.ModUnixNs,
		sanitizeMusicBrainzID(record.ReleaseID),
		normalizeMusicBrainzTagFolderPath(record.ReleaseFolderPath),
		timeToUnixNanoValue(record.LastScannedAt),
	); err != nil {
		return err
	}

	if _, err := transaction.Exec(`DELETE FROM track_scan_artist_ids WHERE path = ?`, path); err != nil {
		return err
	}
	for position, artistID := range sanitizeMusicBrainzIDs(record.ArtistIDs) {
		if _, err := transaction.Exec(`INSERT INTO track_scan_artist_ids(path, artist_id, position) VALUES (?, ?, ?)`, path, artistID, position); err != nil {
			return err
		}
	}

	if _, err := transaction.Exec(`DELETE FROM track_scan_artist_folders WHERE path = ?`, path); err != nil {
		return err
	}
	for position, folderPath := range normalizeMusicBrainzTagFolderPaths(record.ArtistFolderPaths) {
		if _, err := transaction.Exec(`INSERT INTO track_scan_artist_folders(path, folder_path, position) VALUES (?, ?, ?)`, path, folderPath, position); err != nil {
			return err
		}
	}

	return nil
}

func deleteMusicBrainzTagEntityRow(transaction *sql.Tx, entityKey string) error {
	entityType, mbid, ok := parseMusicBrainzTagEntityKey(entityKey)
	if !ok {
		return nil
	}

	if _, err := transaction.Exec(`DELETE FROM entity_tags WHERE entity_type = ? AND mbid = ?`, entityType, mbid); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM entities WHERE entity_type = ? AND mbid = ?`, entityType, mbid); err != nil {
		return err
	}

	return nil
}

func upsertMusicBrainzTagEntityRow(transaction *sql.Tx, entityKey string, record musicBrainzTagEntityRecord) error {
	entityType, mbid, ok := parseMusicBrainzTagEntityKey(entityKey)
	if !ok {
		return nil
	}

	if _, err := transaction.Exec(
		`INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(entity_type, mbid) DO UPDATE SET
		 	title = excluded.title,
		 	last_fetched_unix_ns = excluded.last_fetched_unix_ns,
		 	last_attempt_unix_ns = excluded.last_attempt_unix_ns,
		 	last_error = excluded.last_error`,
		entityType,
		mbid,
		strings.TrimSpace(record.Title),
		timeToUnixNanoValue(record.LastFetchedAt),
		timeToUnixNanoValue(record.LastAttemptAt),
		strings.TrimSpace(record.LastError),
	); err != nil {
		return err
	}

	if _, err := transaction.Exec(`DELETE FROM entity_tags WHERE entity_type = ? AND mbid = ?`, entityType, mbid); err != nil {
		return err
	}
	for position, tagName := range normalizeMusicBrainzTagNames(record.Tags) {
		if _, err := transaction.Exec(`INSERT INTO entity_tags(entity_type, mbid, tag_name, position) VALUES (?, ?, ?, ?)`, entityType, mbid, tagName, position); err != nil {
			return err
		}
	}

	return nil
}

func writeMusicBrainzTagDatabaseStoreToSQLite(path string, store musicBrainzTagDatabaseStore) error {
	normalizedStore := normalizeMusicBrainzTagDatabaseStore(store)
	database, err := openMusicBrainzTagSQLite(path)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		return err
	}

	existingStore, err := loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database)
	if err != nil {
		return err
	}

	transaction, err := database.Begin()
	if err != nil {
		return err
	}
	defer transaction.Rollback()

	for _, statement := range []string{
		`DELETE FROM entities WHERE entity_type NOT IN ('artist', 'release')`,
		`DELETE FROM entity_tags WHERE NOT EXISTS (SELECT 1 FROM entities WHERE entities.entity_type = entity_tags.entity_type AND entities.mbid = entity_tags.mbid)`,
		`DELETE FROM track_scan_artist_ids WHERE NOT EXISTS (SELECT 1 FROM track_scans WHERE track_scans.path = track_scan_artist_ids.path)`,
		`DELETE FROM track_scan_artist_folders WHERE NOT EXISTS (SELECT 1 FROM track_scans WHERE track_scans.path = track_scan_artist_folders.path)`,
	} {
		if _, err := transaction.Exec(statement); err != nil {
			return err
		}
	}

	if _, err := transaction.Exec(
		`INSERT INTO meta(key, value) VALUES ('version', ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value
		 WHERE meta.value <> excluded.value`,
		strconv.Itoa(musicBrainzTagDatabaseVersion),
	); err != nil {
		return err
	}

	for path := range existingStore.Tracks {
		if _, exists := normalizedStore.Tracks[path]; exists {
			continue
		}

		if err := deleteMusicBrainzTagTrackRow(transaction, path); err != nil {
			return err
		}
	}

	for _, path := range sortedMusicBrainzTagTrackPaths(normalizedStore) {
		record := normalizedStore.Tracks[path]
		existingRecord, exists := existingStore.Tracks[path]
		if exists && musicBrainzTagTrackRecordsEqual(existingRecord, record) {
			continue
		}

		if err := upsertMusicBrainzTagTrackRow(transaction, path, record); err != nil {
			return err
		}
	}

	for entityKey := range existingStore.Entities {
		if _, exists := normalizedStore.Entities[entityKey]; exists {
			continue
		}

		if err := deleteMusicBrainzTagEntityRow(transaction, entityKey); err != nil {
			return err
		}
	}

	for _, entityKey := range sortedMusicBrainzTagEntityKeys(normalizedStore) {
		record := normalizedStore.Entities[entityKey]
		existingRecord, exists := existingStore.Entities[entityKey]
		if exists && musicBrainzTagEntityRecordsEqual(existingRecord, record) {
			continue
		}

		if err := upsertMusicBrainzTagEntityRow(transaction, entityKey, record); err != nil {
			return err
		}
	}

	return transaction.Commit()
}
