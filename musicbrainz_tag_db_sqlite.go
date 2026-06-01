package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const musicBrainzTagSQLiteDriverName = "sqlite"
const musicBrainzTagMetaVersionKey = "musicbrainz_version"
const libraryFilesMetaVersionKey = "library_version"
const libraryFilesMetaTotalEntriesKey = "library_total_entries"

var metadataDatabaseMigrationMu sync.Mutex
var metadataDatabasePathLocks sync.Map

func lockMetadataDatabasePath(path string) func() {
	normalizedPath := normalizePath(path)
	if normalizedPath == "" {
		return func() {}
	}

	value, _ := metadataDatabasePathLocks.LoadOrStore(normalizedPath, &sync.Mutex{})
	pathMu := value.(*sync.Mutex)
	pathMu.Lock()
	return func() {
		pathMu.Unlock()
	}
}

func tryLockMetadataDatabasePath(path string, timeout time.Duration) (func(), bool) {
	normalizedPath := normalizePath(path)
	if normalizedPath == "" {
		return func() {}, true
	}

	value, _ := metadataDatabasePathLocks.LoadOrStore(normalizedPath, &sync.Mutex{})
	pathMu := value.(*sync.Mutex)
	if timeout <= 0 {
		if !pathMu.TryLock() {
			return nil, false
		}

		return func() {
			pathMu.Unlock()
		}, true
	}

	deadline := time.Now().Add(timeout)
	for {
		if pathMu.TryLock() {
			return func() {
				pathMu.Unlock()
			}, true
		}
		if time.Now().After(deadline) {
			return nil, false
		}

		time.Sleep(10 * time.Millisecond)
	}
}

var musicBrainzTagSQLiteSchemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS track_scans (
		path TEXT PRIMARY KEY,
		size INTEGER NOT NULL,
		mod_unix_ns INTEGER NOT NULL,
		title TEXT NOT NULL DEFAULT '',
		track_artist TEXT NOT NULL DEFAULT '',
		album_title TEXT NOT NULL DEFAULT '',
		album_artist TEXT NOT NULL DEFAULT '',
		date_text TEXT NOT NULL DEFAULT '',
		record_label TEXT NOT NULL DEFAULT '',
		catalog_number TEXT NOT NULL DEFAULT '',
		track_number INTEGER NOT NULL DEFAULT 0,
		track_total INTEGER NOT NULL DEFAULT 0,
		disc_number INTEGER NOT NULL DEFAULT 0,
		disc_total INTEGER NOT NULL DEFAULT 0,
		duration_seconds REAL NOT NULL DEFAULT 0,
		bit_rate INTEGER NOT NULL DEFAULT 0,
		bit_depth INTEGER NOT NULL DEFAULT 0,
		sample_rate INTEGER NOT NULL DEFAULT 0,
		channels INTEGER NOT NULL DEFAULT 0,
		file_size_bytes INTEGER NOT NULL DEFAULT 0,
		recording_id TEXT NOT NULL DEFAULT '',
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
	`CREATE TABLE IF NOT EXISTS track_scan_album_artist_ids (
		path TEXT NOT NULL,
		artist_id TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (path, artist_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_track_scan_album_artist_ids_artist_id ON track_scan_album_artist_ids (artist_id)`,
	`CREATE TABLE IF NOT EXISTS track_scan_artist_folders (
		path TEXT NOT NULL,
		folder_path TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (path, folder_path)
	)`,
	`CREATE TABLE IF NOT EXISTS track_scan_genres (
		path TEXT NOT NULL,
		genre TEXT NOT NULL,
		position INTEGER NOT NULL,
		PRIMARY KEY (path, genre)
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

func openMetadataSQLiteNoMigration(path string) (*sql.DB, error) {
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

func ensureMetadataDatabaseMigratedLocked(path string) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" || musicBrainzTagDatabaseFileExists(cleanPath) {
		return nil
	}

	metadataDatabaseMigrationMu.Lock()
	defer metadataDatabaseMigrationMu.Unlock()

	if musicBrainzTagDatabaseFileExists(cleanPath) {
		return nil
	}

	directory := filepath.Dir(cleanPath)
	legacyMusicBrainzPath := filepath.Join(directory, legacyMusicBrainzTagDatabaseFileName)
	legacyLibraryPath := filepath.Join(directory, legacyLibraryFilesDatabaseFileName)
	legacyMusicBrainzExists := legacyMusicBrainzPath != cleanPath && musicBrainzTagDatabaseFileExists(legacyMusicBrainzPath)
	legacyLibraryExists := legacyLibraryPath != cleanPath && libraryFilesDatabaseFileExists(legacyLibraryPath)
	if !legacyMusicBrainzExists && !legacyLibraryExists {
		return nil
	}

	database, err := openMetadataSQLiteNoMigration(cleanPath)
	if err != nil {
		return err
	}
	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		database.Close()
		return err
	}
	if err := initializeLibraryFilesSQLite(database); err != nil {
		database.Close()
		return err
	}
	if err := database.Close(); err != nil {
		return err
	}

	if legacyMusicBrainzExists {
		store, err := loadMusicBrainzTagDatabaseStoreFromLegacySQLite(legacyMusicBrainzPath)
		if err != nil {
			return err
		}
		if err := writeMusicBrainzTagDatabaseStoreToSQLiteLocked(cleanPath, store); err != nil {
			return err
		}
	}

	if legacyLibraryExists {
		if err := migrateLegacyLibraryFilesDatabaseToMetadata(cleanPath, legacyLibraryPath); err != nil {
			return err
		}
	}

	return nil
}

func openMusicBrainzTagSQLite(path string) (*sql.DB, error) {
	return openMetadataSQLiteNoMigration(path)
}

func configureMusicBrainzTagSQLite(database *sql.DB) error {
	var journalMode string
	if err := database.QueryRow(`PRAGMA journal_mode=WAL`).Scan(&journalMode); err != nil {
		return err
	}

	if _, err := database.Exec(`PRAGMA busy_timeout=5000`); err != nil {
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

	for _, statement := range []string{
		`ALTER TABLE track_scans ADD COLUMN title TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN track_artist TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN album_title TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN album_artist TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN date_text TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN record_label TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN catalog_number TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE track_scans ADD COLUMN track_number INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN track_total INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN disc_number INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN disc_total INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN duration_seconds REAL NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN bit_rate INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN bit_depth INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN sample_rate INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN channels INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN file_size_bytes INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE track_scans ADD COLUMN recording_id TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := database.Exec(statement); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
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

func loadMusicBrainzTagDatabaseStore(databasePath string) musicBrainzTagDatabaseStore {
	unlock := lockMetadataDatabasePath(databasePath)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(databasePath); err != nil {
		return newMusicBrainzTagDatabaseStore()
	}

	if musicBrainzTagDatabaseFileExists(databasePath) {
		if store, err := loadMusicBrainzTagDatabaseStoreFromSQLiteLocked(databasePath); err == nil {
			return store
		}
	}

	return newMusicBrainzTagDatabaseStore()
}

func loadMusicBrainzTagDatabaseStoreFromSQLite(path string) (musicBrainzTagDatabaseStore, error) {
	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	return loadMusicBrainzTagDatabaseStoreFromSQLiteLocked(path)
}

func loadMusicBrainzTagDatabaseStoreFromSQLiteLocked(path string) (musicBrainzTagDatabaseStore, error) {
	store := newMusicBrainzTagDatabaseStore()
	database, err := openMetadataSQLiteNoMigration(path)
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

	trackRows, err := database.Query(`SELECT path, size, mod_unix_ns, title, track_artist, album_title, album_artist, date_text, record_label, catalog_number, track_number, track_total, disc_number, disc_total, duration_seconds, bit_rate, bit_depth, sample_rate, channels, file_size_bytes, recording_id, release_id, release_folder_path, last_scanned_unix_ns FROM track_scans ORDER BY path`)
	if err != nil {
		return store, err
	}
	for trackRows.Next() {
		var path string
		var size int64
		var modUnixNs int64
		var title string
		var trackArtist string
		var albumTitle string
		var albumArtist string
		var dateText string
		var recordLabel string
		var catalogNumber string
		var trackNumber int
		var trackTotal int
		var discNumber int
		var discTotal int
		var durationSeconds float64
		var bitRate int
		var bitDepth int
		var sampleRate int
		var channels int
		var fileSizeBytes int64
		var recordingID string
		var releaseID string
		var releaseFolderPath string
		var lastScannedUnixNs int64
		if err := trackRows.Scan(&path, &size, &modUnixNs, &title, &trackArtist, &albumTitle, &albumArtist, &dateText, &recordLabel, &catalogNumber, &trackNumber, &trackTotal, &discNumber, &discTotal, &durationSeconds, &bitRate, &bitDepth, &sampleRate, &channels, &fileSizeBytes, &recordingID, &releaseID, &releaseFolderPath, &lastScannedUnixNs); err != nil {
			trackRows.Close()
			return store, err
		}

		store.Tracks[path] = musicBrainzTagTrackRecord{
			Signature: trackTagsFileSignature{
				Size:      size,
				ModUnixNs: modUnixNs,
			},
			Title:             title,
			TrackArtist:       trackArtist,
			AlbumTitle:        albumTitle,
			AlbumArtist:       albumArtist,
			Date:              dateText,
			RecordLabel:       recordLabel,
			CatalogNumber:     catalogNumber,
			TrackNumber:       trackNumber,
			TrackTotal:        trackTotal,
			DiscNumber:        discNumber,
			DiscTotal:         discTotal,
			DurationSeconds:   durationSeconds,
			BitRate:           bitRate,
			BitDepth:          bitDepth,
			SampleRate:        sampleRate,
			Channels:          channels,
			FileSizeBytes:     fileSizeBytes,
			RecordingID:       recordingID,
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

	trackAlbumArtistRows, err := database.Query(`SELECT path, artist_id FROM track_scan_album_artist_ids ORDER BY path, position`)
	if err != nil {
		return store, err
	}
	for trackAlbumArtistRows.Next() {
		var path string
		var artistID string
		if err := trackAlbumArtistRows.Scan(&path, &artistID); err != nil {
			trackAlbumArtistRows.Close()
			return store, err
		}

		record, exists := store.Tracks[path]
		if !exists {
			continue
		}

		record.AlbumArtistIDs = append(record.AlbumArtistIDs, artistID)
		store.Tracks[path] = record
	}
	if err := trackAlbumArtistRows.Err(); err != nil {
		trackAlbumArtistRows.Close()
		return store, err
	}
	trackAlbumArtistRows.Close()

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

	trackGenreRows, err := database.Query(`SELECT path, genre FROM track_scan_genres ORDER BY path, position`)
	if err != nil {
		return store, err
	}
	for trackGenreRows.Next() {
		var path string
		var genre string
		if err := trackGenreRows.Scan(&path, &genre); err != nil {
			trackGenreRows.Close()
			return store, err
		}

		record, exists := store.Tracks[path]
		if !exists {
			continue
		}

		record.Genres = append(record.Genres, genre)
		store.Tracks[path] = record
	}
	if err := trackGenreRows.Err(); err != nil {
		trackGenreRows.Close()
		return store, err
	}
	trackGenreRows.Close()

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

func loadMusicBrainzTagDatabaseStoreFromLegacySQLite(path string) (musicBrainzTagDatabaseStore, error) {
	store := newMusicBrainzTagDatabaseStore()
	database, err := openMetadataSQLiteNoMigration(path)
	if err != nil {
		return store, err
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		return store, err
	}

	return loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database)
}

func loadMusicBrainzTagTrackRecordFromSQLite(databasePath string, trackPath string) (musicBrainzTagTrackRecord, bool) {
	unlock := lockMetadataDatabasePath(databasePath)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(databasePath); err != nil {
		return musicBrainzTagTrackRecord{}, false
	}
	if !musicBrainzTagDatabaseFileExists(databasePath) {
		return musicBrainzTagTrackRecord{}, false
	}

	database, err := openMetadataSQLiteNoMigration(databasePath)
	if err != nil {
		return musicBrainzTagTrackRecord{}, false
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		return musicBrainzTagTrackRecord{}, false
	}

	return loadMusicBrainzTagTrackRecordFromSQLiteConnection(database, trackPath)
}

func loadMusicBrainzTagTrackRecordsFromSQLite(databasePath string, trackPaths []string) map[string]musicBrainzTagTrackRecord {
	if len(trackPaths) == 0 {
		return nil
	}

	unlock := lockMetadataDatabasePath(databasePath)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(databasePath); err != nil {
		return nil
	}
	if !musicBrainzTagDatabaseFileExists(databasePath) {
		return nil
	}

	database, err := openMetadataSQLiteNoMigration(databasePath)
	if err != nil {
		return nil
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		return nil
	}

	recordByPath := make(map[string]musicBrainzTagTrackRecord, len(trackPaths))
	seenPaths := make(map[string]struct{}, len(trackPaths))
	for _, trackPath := range trackPaths {
		cleanPath := strings.TrimSpace(trackPath)
		if cleanPath == "" {
			continue
		}
		if _, exists := seenPaths[cleanPath]; exists {
			continue
		}
		seenPaths[cleanPath] = struct{}{}

		record, ok := loadDetailedMusicBrainzTagTrackRecordFromSQLiteConnection(database, cleanPath)
		if !ok {
			continue
		}
		recordByPath[cleanPath] = record
	}

	if len(recordByPath) == 0 {
		return nil
	}

	return recordByPath
}

func loadMusicBrainzTagTrackRecordFromSQLiteConnection(database *sql.DB, trackPath string) (musicBrainzTagTrackRecord, bool) {
	var size int64
	var modUnixNs int64
	var title string
	var trackArtist string
	var albumTitle string
	var albumArtist string
	var trackNumber int
	var trackTotal int
	var durationSeconds float64
	err := database.QueryRow(`SELECT size, mod_unix_ns, title, track_artist, album_title, album_artist, track_number, track_total, duration_seconds FROM track_scans WHERE path = ?`, trackPath).Scan(
		&size,
		&modUnixNs,
		&title,
		&trackArtist,
		&albumTitle,
		&albumArtist,
		&trackNumber,
		&trackTotal,
		&durationSeconds,
	)
	if err != nil {
		return musicBrainzTagTrackRecord{}, false
	}

	return musicBrainzTagTrackRecord{
		Signature: trackTagsFileSignature{
			Size:      size,
			ModUnixNs: modUnixNs,
		},
		Title:           title,
		TrackArtist:     trackArtist,
		AlbumTitle:      albumTitle,
		AlbumArtist:     albumArtist,
		TrackNumber:     trackNumber,
		TrackTotal:      trackTotal,
		DurationSeconds: durationSeconds,
	}, true
}

func loadDetailedMusicBrainzTagTrackRecordFromSQLiteConnection(database *sql.DB, trackPath string) (musicBrainzTagTrackRecord, bool) {
	var size int64
	var modUnixNs int64
	var title string
	var trackArtist string
	var albumTitle string
	var albumArtist string
	var dateText string
	var recordLabel string
	var catalogNumber string
	var trackNumber int
	var trackTotal int
	var discNumber int
	var discTotal int
	var durationSeconds float64
	var bitRate int
	var bitDepth int
	var sampleRate int
	var channels int
	var fileSizeBytes int64
	var recordingID string
	var releaseID string
	var releaseFolderPath string
	var lastScannedUnixNs int64
	err := database.QueryRow(`SELECT size, mod_unix_ns, title, track_artist, album_title, album_artist, date_text, record_label, catalog_number, track_number, track_total, disc_number, disc_total, duration_seconds, bit_rate, bit_depth, sample_rate, channels, file_size_bytes, recording_id, release_id, release_folder_path, last_scanned_unix_ns FROM track_scans WHERE path = ?`, trackPath).Scan(
		&size,
		&modUnixNs,
		&title,
		&trackArtist,
		&albumTitle,
		&albumArtist,
		&dateText,
		&recordLabel,
		&catalogNumber,
		&trackNumber,
		&trackTotal,
		&discNumber,
		&discTotal,
		&durationSeconds,
		&bitRate,
		&bitDepth,
		&sampleRate,
		&channels,
		&fileSizeBytes,
		&recordingID,
		&releaseID,
		&releaseFolderPath,
		&lastScannedUnixNs,
	)
	if err != nil {
		return musicBrainzTagTrackRecord{}, false
	}

	artistIDs, ok := loadMusicBrainzTagTrackRecordStringValues(database, `SELECT artist_id FROM track_scan_artist_ids WHERE path = ? ORDER BY position`, trackPath)
	if !ok {
		return musicBrainzTagTrackRecord{}, false
	}
	albumArtistIDs, ok := loadMusicBrainzTagTrackRecordStringValues(database, `SELECT artist_id FROM track_scan_album_artist_ids WHERE path = ? ORDER BY position`, trackPath)
	if !ok {
		return musicBrainzTagTrackRecord{}, false
	}
	artistFolderPaths, ok := loadMusicBrainzTagTrackRecordStringValues(database, `SELECT folder_path FROM track_scan_artist_folders WHERE path = ? ORDER BY position`, trackPath)
	if !ok {
		return musicBrainzTagTrackRecord{}, false
	}
	genres, ok := loadMusicBrainzTagTrackRecordStringValues(database, `SELECT genre FROM track_scan_genres WHERE path = ? ORDER BY position`, trackPath)
	if !ok {
		return musicBrainzTagTrackRecord{}, false
	}

	return musicBrainzTagTrackRecord{
		Signature: trackTagsFileSignature{
			Size:      size,
			ModUnixNs: modUnixNs,
		},
		Title:             title,
		TrackArtist:       trackArtist,
		AlbumTitle:        albumTitle,
		AlbumArtist:       albumArtist,
		Date:              dateText,
		RecordLabel:       recordLabel,
		CatalogNumber:     catalogNumber,
		Genres:            genres,
		TrackNumber:       trackNumber,
		TrackTotal:        trackTotal,
		DiscNumber:        discNumber,
		DiscTotal:         discTotal,
		DurationSeconds:   durationSeconds,
		BitRate:           bitRate,
		BitDepth:          bitDepth,
		SampleRate:        sampleRate,
		Channels:          channels,
		FileSizeBytes:     fileSizeBytes,
		RecordingID:       recordingID,
		ReleaseID:         releaseID,
		ArtistIDs:         artistIDs,
		AlbumArtistIDs:    albumArtistIDs,
		ReleaseFolderPath: releaseFolderPath,
		ArtistFolderPaths: artistFolderPaths,
		LastScannedAt:     timeFromUnixNanoValue(lastScannedUnixNs),
	}, true
}

func loadMusicBrainzTagTrackRecordStringValues(database *sql.DB, query string, trackPath string) ([]string, bool) {
	rows, err := database.Query(query, trackPath)
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	values := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, false
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, false
	}
	if len(values) == 0 {
		return nil, true
	}

	return values, true
}

func musicBrainzTagTrackRecordsEqual(left musicBrainzTagTrackRecord, right musicBrainzTagTrackRecord) bool {
	return left.Signature == right.Signature &&
		left.Title == right.Title &&
		left.TrackArtist == right.TrackArtist &&
		left.AlbumTitle == right.AlbumTitle &&
		left.AlbumArtist == right.AlbumArtist &&
		left.Date == right.Date &&
		left.RecordLabel == right.RecordLabel &&
		left.CatalogNumber == right.CatalogNumber &&
		stringSlicesEqual(left.Genres, right.Genres) &&
		left.TrackNumber == right.TrackNumber &&
		left.TrackTotal == right.TrackTotal &&
		left.DiscNumber == right.DiscNumber &&
		left.DiscTotal == right.DiscTotal &&
		left.DurationSeconds == right.DurationSeconds &&
		left.BitRate == right.BitRate &&
		left.BitDepth == right.BitDepth &&
		left.SampleRate == right.SampleRate &&
		left.Channels == right.Channels &&
		left.FileSizeBytes == right.FileSizeBytes &&
		left.RecordingID == right.RecordingID &&
		left.ReleaseID == right.ReleaseID &&
		stringSlicesEqual(left.ArtistIDs, right.ArtistIDs) &&
		stringSlicesEqual(left.AlbumArtistIDs, right.AlbumArtistIDs) &&
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
		`DELETE FROM track_scan_album_artist_ids WHERE path = ?`,
		`DELETE FROM track_scan_artist_folders WHERE path = ?`,
		`DELETE FROM track_scan_genres WHERE path = ?`,
		`DELETE FROM track_scans WHERE path = ?`,
	} {
		if _, err := transaction.Exec(statement, path); err != nil {
			return err
		}
	}

	return nil
}

func upsertMusicBrainzTagTrackRow(transaction *sql.Tx, path string, record musicBrainzTagTrackRecord) error {
	record = normalizeMusicBrainzTagTrackRecord(record)
	if _, err := transaction.Exec(
		`INSERT INTO track_scans(path, size, mod_unix_ns, title, track_artist, album_title, album_artist, date_text, record_label, catalog_number, track_number, track_total, disc_number, disc_total, duration_seconds, bit_rate, bit_depth, sample_rate, channels, file_size_bytes, recording_id, release_id, release_folder_path, last_scanned_unix_ns)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(path) DO UPDATE SET
		 	size = excluded.size,
		 	mod_unix_ns = excluded.mod_unix_ns,
		 	title = excluded.title,
		 	track_artist = excluded.track_artist,
		 	album_title = excluded.album_title,
		 	album_artist = excluded.album_artist,
		 	date_text = excluded.date_text,
		 	record_label = excluded.record_label,
		 	catalog_number = excluded.catalog_number,
		 	track_number = excluded.track_number,
		 	track_total = excluded.track_total,
		 	disc_number = excluded.disc_number,
		 	disc_total = excluded.disc_total,
		 	duration_seconds = excluded.duration_seconds,
		 	bit_rate = excluded.bit_rate,
		 	bit_depth = excluded.bit_depth,
		 	sample_rate = excluded.sample_rate,
		 	channels = excluded.channels,
		 	file_size_bytes = excluded.file_size_bytes,
		 	recording_id = excluded.recording_id,
		 	release_id = excluded.release_id,
		 	release_folder_path = excluded.release_folder_path,
		 	last_scanned_unix_ns = excluded.last_scanned_unix_ns`,
		path,
		record.Signature.Size,
		record.Signature.ModUnixNs,
		record.Title,
		record.TrackArtist,
		record.AlbumTitle,
		record.AlbumArtist,
		record.Date,
		record.RecordLabel,
		record.CatalogNumber,
		record.TrackNumber,
		record.TrackTotal,
		record.DiscNumber,
		record.DiscTotal,
		record.DurationSeconds,
		record.BitRate,
		record.BitDepth,
		record.SampleRate,
		record.Channels,
		record.FileSizeBytes,
		record.RecordingID,
		record.ReleaseID,
		record.ReleaseFolderPath,
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

	if _, err := transaction.Exec(`DELETE FROM track_scan_album_artist_ids WHERE path = ?`, path); err != nil {
		return err
	}
	for position, artistID := range sanitizeMusicBrainzIDs(record.AlbumArtistIDs) {
		if _, err := transaction.Exec(`INSERT INTO track_scan_album_artist_ids(path, artist_id, position) VALUES (?, ?, ?)`, path, artistID, position); err != nil {
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

	if _, err := transaction.Exec(`DELETE FROM track_scan_genres WHERE path = ?`, path); err != nil {
		return err
	}
	for position, genre := range normalizeMusicBrainzTrackGenres(record.Genres) {
		if _, err := transaction.Exec(`INSERT INTO track_scan_genres(path, genre, position) VALUES (?, ?, ?)`, path, genre, position); err != nil {
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
	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	return writeMusicBrainzTagDatabaseStoreToSQLiteLocked(path, store)
}

func writeMusicBrainzTagDatabaseStoreToSQLiteLocked(path string, store musicBrainzTagDatabaseStore) error {
	if err := ensureMetadataDatabaseMigratedLocked(path); err != nil {
		return err
	}

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
	defer func() {
		_ = transaction.Rollback()
	}()

	for _, statement := range []string{
		`DELETE FROM entities WHERE entity_type NOT IN ('artist', 'release')`,
		`DELETE FROM entity_tags WHERE NOT EXISTS (SELECT 1 FROM entities WHERE entities.entity_type = entity_tags.entity_type AND entities.mbid = entity_tags.mbid)`,
		`DELETE FROM track_scan_artist_ids WHERE NOT EXISTS (SELECT 1 FROM track_scans WHERE track_scans.path = track_scan_artist_ids.path)`,
		`DELETE FROM track_scan_album_artist_ids WHERE NOT EXISTS (SELECT 1 FROM track_scans WHERE track_scans.path = track_scan_album_artist_ids.path)`,
		`DELETE FROM track_scan_artist_folders WHERE NOT EXISTS (SELECT 1 FROM track_scans WHERE track_scans.path = track_scan_artist_folders.path)`,
		`DELETE FROM track_scan_genres WHERE NOT EXISTS (SELECT 1 FROM track_scans WHERE track_scans.path = track_scan_genres.path)`,
	} {
		if _, err := transaction.Exec(statement); err != nil {
			return err
		}
	}

	if _, err := transaction.Exec(
		`INSERT INTO meta(key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value
		 WHERE meta.value <> excluded.value`,
		musicBrainzTagMetaVersionKey,
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
