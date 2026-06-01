package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

const libraryFilesDatabaseVersion = 5

type libraryFilesDatabaseRecord struct {
	Path         string
	RootPath     string
	RelativePath string
	Kind         string
	Size         int64
	ModUnixNs    int64
	TrackTitle   string
	TrackArtist  string
	AlbumTitle   string
	AlbumArtist  string
	TrackNumber  int
	TrackTotal   int
}

type libraryListenHistoryRecord struct {
	TrackPath     string
	TrackName     string
	ArtistName    string
	ReleaseName   string
	ListenedAt    int64
	PlayedPercent int
}

type playlistTrackCacheRecord struct {
	TrackPath  string
	TrackName  string
	ArtistName string
}

type sqliteExecRunner interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func libraryFilesDatabaseRelativePath(entry LibraryIndexedFile) string {
	relativePath := strings.TrimSpace(entry.RelativePath)
	if entry.RootName != "" {
		prefix := entry.RootName + "/"
		if relativePath == entry.RootName {
			relativePath = ""
		} else if strings.HasPrefix(relativePath, prefix) {
			relativePath = strings.TrimPrefix(relativePath, prefix)
		}
	}

	return relativePath
}

func writeLibraryFilesDatabaseEntries(runner sqliteExecRunner, kind string, entries []LibraryIndexedFile) error {
	for _, entry := range entries {
		relativePath := libraryFilesDatabaseRelativePath(entry)
		if strings.TrimSpace(relativePath) == "" {
			continue
		}

		modUnixNs := entry.ModifiedAtMs * int64(time.Millisecond)
		trackNumber := 0
		if parsed, err := strconv.Atoi(strings.TrimSpace(entry.CachedTrackNumber)); err == nil && parsed > 0 {
			trackNumber = parsed
		}
		trackTotal := 0
		if parsed, err := strconv.Atoi(strings.TrimSpace(entry.CachedTrackTotal)); err == nil && parsed > 0 {
			trackTotal = parsed
		}
		if _, err := runner.Exec(
			`INSERT INTO files (path, root_path, relative_path, kind, size, mod_unix_ns, track_title, track_artist, album_title, album_artist, track_number, track_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			entry.Path,
			entry.RootPath,
			relativePath,
			kind,
			int64(0),
			modUnixNs,
			strings.TrimSpace(entry.CachedTrackTitle),
			strings.TrimSpace(entry.CachedArtistName),
			strings.TrimSpace(entry.CachedAlbumTitle),
			strings.TrimSpace(entry.CachedAlbumArtist),
			trackNumber,
			trackTotal,
		); err != nil {
			return err
		}
	}

	return nil
}

var libraryFilesSQLiteSchemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS roots (
		path TEXT PRIMARY KEY,
		release_depth INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS files (
		path TEXT PRIMARY KEY,
		root_path TEXT NOT NULL,
		relative_path TEXT NOT NULL,
		kind TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT 0,
		mod_unix_ns INTEGER NOT NULL DEFAULT 0,
		track_title TEXT NOT NULL DEFAULT '',
		track_artist TEXT NOT NULL DEFAULT '',
		album_title TEXT NOT NULL DEFAULT '',
		album_artist TEXT NOT NULL DEFAULT '',
		track_number INTEGER NOT NULL DEFAULT 0,
		track_total INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS listen_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		track_path TEXT NOT NULL,
		track_name TEXT NOT NULL DEFAULT '',
		artist_name TEXT NOT NULL DEFAULT '',
		release_name TEXT NOT NULL DEFAULT '',
		listened_at INTEGER NOT NULL DEFAULT 0,
		played_percent INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS playlist_track_cache (
		track_path TEXT PRIMARY KEY,
		track_name TEXT NOT NULL DEFAULT '',
		artist_name TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE INDEX IF NOT EXISTS idx_library_files_root_relative ON files (root_path, relative_path)`,
	`CREATE INDEX IF NOT EXISTS idx_library_files_root_kind ON files (root_path, kind)`,
	`CREATE INDEX IF NOT EXISTS idx_listen_history_listened_at ON listen_history (listened_at DESC, id DESC)`,
}

func libraryFilesDatabaseFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}

	return !info.IsDir()
}

func openLibraryFilesSQLite(path string) (*sql.DB, error) {
	return openMetadataSQLiteNoMigration(path)
}

// ensureLibraryFilesDatabaseMigratedLocked is the temporary upgrade bridge from the
// former shared metadata DB layout to the dedicated library snapshot DB.
func ensureLibraryFilesDatabaseMigratedLocked(path string) error {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" || libraryFilesDatabaseFileExists(cleanPath) {
		return nil
	}

	metadataDatabaseMigrationMu.Lock()
	defer metadataDatabaseMigrationMu.Unlock()

	if libraryFilesDatabaseFileExists(cleanPath) {
		return nil
	}

	directory := filepath.Dir(cleanPath)
	legacyLibraryPath := filepath.Join(directory, legacyLibraryFilesDatabaseFileName)
	if legacyLibraryPath != cleanPath && libraryFilesDatabaseFileExists(legacyLibraryPath) {
		return migrateLibraryFilesSnapshotToSeparateDatabase(cleanPath, legacyLibraryPath)
	}

	sharedMetadataPath := filepath.Join(directory, metadataDatabaseFileName)
	if sharedMetadataPath != cleanPath && libraryFilesDatabaseFileExists(sharedMetadataPath) {
		return migrateLibraryFilesSnapshotToSeparateDatabase(cleanPath, sharedMetadataPath)
	}

	return nil
}

func migrateLibraryFilesSnapshotToSeparateDatabase(targetPath string, sourcePath string) error {
	sourceUnlock := lockMetadataDatabasePath(sourcePath)
	defer sourceUnlock()

	sourceDatabase, err := openMetadataSQLiteNoMigration(sourcePath)
	if err != nil {
		return err
	}
	defer sourceDatabase.Close()

	totalEntriesRaw := ""
	hasTotalEntries := false
	err = sourceDatabase.QueryRow(`SELECT value FROM meta WHERE key = ?`, libraryFilesMetaTotalEntriesKey).Scan(&totalEntriesRaw)
	if err == sql.ErrNoRows {
		err = sourceDatabase.QueryRow(`SELECT value FROM meta WHERE key = 'total_entries'`).Scan(&totalEntriesRaw)
	}
	if err == nil {
		hasTotalEntries = true
	} else if err != sql.ErrNoRows {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") {
			return nil
		}
		return err
	}

	roots := make([]libraryRootConfig, 0)
	rootRows, err := sourceDatabase.Query(`SELECT path, release_depth FROM roots ORDER BY path`)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") {
			return nil
		}
		return err
	}
	for rootRows.Next() {
		var root libraryRootConfig
		if err := rootRows.Scan(&root.Path, &root.ReleaseDepth); err != nil {
			rootRows.Close()
			return err
		}
		roots = append(roots, root)
	}
	if err := rootRows.Err(); err != nil {
		rootRows.Close()
		return err
	}
	rootRows.Close()

	if err := initializeMusicBrainzTagSQLite(sourceDatabase); err != nil {
		return err
	}

	records := make([]libraryFilesDatabaseRecord, 0)
	fileRows, err := sourceDatabase.Query(`SELECT files.path, files.root_path, files.relative_path, files.kind, files.size, files.mod_unix_ns,
		COALESCE(NULLIF(files.track_title, ''), track_scans.title, ''),
		COALESCE(NULLIF(files.track_artist, ''), track_scans.track_artist, ''),
		COALESCE(NULLIF(files.album_title, ''), track_scans.album_title, ''),
		COALESCE(NULLIF(files.album_artist, ''), track_scans.album_artist, ''),
		CASE WHEN files.track_number > 0 THEN files.track_number ELSE COALESCE(track_scans.track_number, 0) END,
		CASE WHEN files.track_total > 0 THEN files.track_total ELSE COALESCE(track_scans.track_total, 0) END
		FROM files
		LEFT JOIN track_scans ON track_scans.path = files.path
		ORDER BY files.path`)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such column") {
			fileRows, err = sourceDatabase.Query(`SELECT files.path, files.root_path, files.relative_path, files.kind, files.size, files.mod_unix_ns,
				COALESCE(track_scans.title, ''), COALESCE(track_scans.track_artist, ''), COALESCE(track_scans.album_title, ''), COALESCE(track_scans.album_artist, ''),
				COALESCE(track_scans.track_number, 0), COALESCE(track_scans.track_total, 0)
				FROM files
				LEFT JOIN track_scans ON track_scans.path = files.path
				ORDER BY files.path`)
		}
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "no such table") {
				return nil
			}
			return err
		}
	}
	for fileRows.Next() {
		var record libraryFilesDatabaseRecord
		if err := fileRows.Scan(&record.Path, &record.RootPath, &record.RelativePath, &record.Kind, &record.Size, &record.ModUnixNs, &record.TrackTitle, &record.TrackArtist, &record.AlbumTitle, &record.AlbumArtist, &record.TrackNumber, &record.TrackTotal); err != nil {
			fileRows.Close()
			return err
		}
		records = append(records, record)
	}
	if err := fileRows.Err(); err != nil {
		fileRows.Close()
		return err
	}
	fileRows.Close()

	if !hasTotalEntries && len(roots) == 0 && len(records) == 0 {
		return nil
	}

	targetDatabase, err := openMetadataSQLiteNoMigration(targetPath)
	if err != nil {
		return err
	}
	defer targetDatabase.Close()

	if err := initializeLibraryFilesSQLite(targetDatabase); err != nil {
		return err
	}

	transaction, err := targetDatabase.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = transaction.Rollback()
	}()

	if _, err := transaction.Exec(`DELETE FROM meta WHERE key IN (?, ?)`, libraryFilesMetaVersionKey, libraryFilesMetaTotalEntriesKey); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM roots`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM files`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaVersionKey, strconv.Itoa(libraryFilesDatabaseVersion)); err != nil {
		return err
	}
	if hasTotalEntries {
		if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaTotalEntriesKey, totalEntriesRaw); err != nil {
			return err
		}
	}

	for _, root := range roots {
		if _, err := transaction.Exec(`INSERT INTO roots (path, release_depth) VALUES (?, ?)`, root.Path, root.ReleaseDepth); err != nil {
			return err
		}
	}

	for _, record := range records {
		if _, err := transaction.Exec(
			`INSERT INTO files (path, root_path, relative_path, kind, size, mod_unix_ns, track_title, track_artist, album_title, album_artist, track_number, track_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			record.Path,
			record.RootPath,
			record.RelativePath,
			record.Kind,
			record.Size,
			record.ModUnixNs,
			record.TrackTitle,
			record.TrackArtist,
			record.AlbumTitle,
			record.AlbumArtist,
			record.TrackNumber,
			record.TrackTotal,
		); err != nil {
			return err
		}
	}

	if err := transaction.Commit(); err != nil {
		return err
	}
	committed = true

	return nil
}

func initializeLibraryFilesSQLite(database *sql.DB) error {
	for _, statement := range libraryFilesSQLiteSchemaStatements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}

	for _, statement := range []string{
		`ALTER TABLE listen_history ADD COLUMN played_percent INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE files ADD COLUMN track_title TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE files ADD COLUMN track_artist TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE files ADD COLUMN album_title TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE files ADD COLUMN album_artist TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE files ADD COLUMN track_number INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE files ADD COLUMN track_total INTEGER NOT NULL DEFAULT 0`,
	} {
		if _, err := database.Exec(statement); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column name") {
			return err
		}
	}

	return nil
}

func loadLibraryFilesDatabaseRecordsFromSQLiteWithLockTimeout(databasePath string, roots []libraryRootConfig, lockTimeout time.Duration) ([]libraryFilesDatabaseRecord, int, bool) {
	unlock, locked := tryLockMetadataDatabasePath(databasePath, lockTimeout)
	if !locked {
		return nil, 0, false
	}
	defer unlock()

	if err := ensureLibraryFilesDatabaseMigratedLocked(databasePath); err != nil {
		return nil, 0, false
	}

	if !libraryFilesDatabaseFileExists(databasePath) {
		return nil, 0, false
	}

	database, err := openLibraryFilesSQLite(databasePath)
	if err != nil {
		return nil, 0, false
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return nil, 0, false
	}
	storedRoots := make(map[string]int, len(roots))
	rootRows, err := database.Query(`SELECT path, release_depth FROM roots ORDER BY path`)
	if err != nil {
		return nil, 0, false
	}
	for rootRows.Next() {
		var path string
		var releaseDepth int
		if err := rootRows.Scan(&path, &releaseDepth); err != nil {
			rootRows.Close()
			return nil, 0, false
		}
		storedRoots[path] = releaseDepth
	}
	if err := rootRows.Err(); err != nil {
		rootRows.Close()
		return nil, 0, false
	}
	rootRows.Close()

	if len(storedRoots) != len(roots) {
		return nil, 0, false
	}
	for _, root := range roots {
		storedReleaseDepth, exists := storedRoots[root.Path]
		if !exists || storedReleaseDepth != root.ReleaseDepth {
			return nil, 0, false
		}
	}

	totalEntries := 0
	var totalEntriesRaw string
	metaErr := database.QueryRow(`SELECT value FROM meta WHERE key = ?`, libraryFilesMetaTotalEntriesKey).Scan(&totalEntriesRaw)
	if metaErr == sql.ErrNoRows {
		metaErr = database.QueryRow(`SELECT value FROM meta WHERE key = 'total_entries'`).Scan(&totalEntriesRaw)
	}
	if metaErr == nil {
		parsed, parseErr := strconv.Atoi(strings.TrimSpace(totalEntriesRaw))
		if parseErr == nil && parsed > 0 {
			totalEntries = parsed
		}
	}

	rows, err := database.Query(`SELECT files.path, files.root_path, files.relative_path, files.kind, files.size, files.mod_unix_ns,
		files.track_title, files.track_artist, files.album_title, files.album_artist, files.track_number, files.track_total
		FROM files
		ORDER BY files.kind, files.relative_path, files.path`)
	if err != nil {
		return nil, 0, false
	}

	records := make([]libraryFilesDatabaseRecord, 0)
	for rows.Next() {
		var record libraryFilesDatabaseRecord
		if err := rows.Scan(
			&record.Path,
			&record.RootPath,
			&record.RelativePath,
			&record.Kind,
			&record.Size,
			&record.ModUnixNs,
			&record.TrackTitle,
			&record.TrackArtist,
			&record.AlbumTitle,
			&record.AlbumArtist,
			&record.TrackNumber,
			&record.TrackTotal,
		); err != nil {
			rows.Close()
			return nil, 0, false
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, 0, false
	}
	rows.Close()

	return records, totalEntries, true
}

func writeLibraryFilesDatabaseSnapshotToSQLite(path string, snapshot libraryFilesDatabaseSnapshot) error {
	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	if err := ensureLibraryFilesDatabaseMigratedLocked(path); err != nil {
		return err
	}

	database, err := openLibraryFilesSQLite(path)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return err
	}

	transaction, err := database.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = transaction.Rollback()
	}()

	if _, err := transaction.Exec(`DELETE FROM meta WHERE key IN (?, ?)`, libraryFilesMetaVersionKey, libraryFilesMetaTotalEntriesKey); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM roots`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM files`); err != nil {
		return err
	}

	if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaVersionKey, strconv.Itoa(libraryFilesDatabaseVersion)); err != nil {
		return err
	}
	if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaTotalEntriesKey, strconv.Itoa(snapshot.TotalEntries)); err != nil {
		return err
	}

	for _, root := range snapshot.Roots {
		if _, err := transaction.Exec(`INSERT INTO roots (path, release_depth) VALUES (?, ?)`, root.Path, root.ReleaseDepth); err != nil {
			return err
		}
	}

	if err := writeLibraryFilesDatabaseEntries(transaction, "track", snapshot.TrackFiles); err != nil {
		return err
	}
	if err := writeLibraryFilesDatabaseEntries(transaction, "text-file", snapshot.TextFiles); err != nil {
		return err
	}
	if err := writeLibraryFilesDatabaseEntries(transaction, "image-file", snapshot.ImageFiles); err != nil {
		return err
	}

	if err := transaction.Commit(); err != nil {
		return err
	}
	committed = true

	return nil
}

func writeLibraryFilesDatabaseIncrementalChangesToSQLite(path string, changes []preparedIncrementalLibraryChange, totalEntries int) error {
	if len(changes) == 0 {
		return nil
	}

	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	if err := ensureLibraryFilesDatabaseMigratedLocked(path); err != nil {
		return err
	}

	database, err := openLibraryFilesSQLite(path)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return err
	}

	transaction, err := database.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = transaction.Rollback()
	}()

	if _, err := transaction.Exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaVersionKey, strconv.Itoa(libraryFilesDatabaseVersion)); err != nil {
		return err
	}
	if totalEntries >= 0 {
		if _, err := transaction.Exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaTotalEntriesKey, strconv.Itoa(totalEntries)); err != nil {
			return err
		}
	}

	for _, change := range changes {
		_, relativeTargetPath, ok := folderAndRelative(change.root.Path, change.targetPath)
		if !ok {
			continue
		}
		relativeTargetPath, ok = normalizeLibraryRelativePath(relativeTargetPath)
		if !ok {
			continue
		}

		if _, err := transaction.Exec(
			`INSERT OR REPLACE INTO roots (path, release_depth) VALUES (?, ?)`,
			change.root.Path,
			change.root.ReleaseDepth,
		); err != nil {
			return err
		}

		deleteArgs := []any{change.root.Path}
		deleteQuery := `DELETE FROM files WHERE root_path = ?`
		if relativeTargetPath != "" {
			deleteQuery += ` AND (relative_path = ? OR relative_path LIKE ?)`
			deleteArgs = append(deleteArgs, relativeTargetPath, relativeTargetPath+`/%`)
		}
		if _, err := transaction.Exec(deleteQuery, deleteArgs...); err != nil {
			return err
		}

		if err := writeLibraryFilesDatabaseEntries(transaction, "track", change.trackFiles); err != nil {
			return err
		}
		if err := writeLibraryFilesDatabaseEntries(transaction, "text-file", change.textFiles); err != nil {
			return err
		}
		if err := writeLibraryFilesDatabaseEntries(transaction, "image-file", change.imageFiles); err != nil {
			return err
		}
	}

	if err := transaction.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func trimLibraryListenHistoryInSQLite(runner sqliteExecRunner, limit int) error {
	if limit <= 0 {
		return nil
	}

	_, err := runner.Exec(
		`DELETE FROM listen_history WHERE id IN (
			SELECT id FROM (
				SELECT id FROM listen_history ORDER BY listened_at DESC, id DESC LIMIT -1 OFFSET ?
			)
		)`,
		limit,
	)
	return err
}

func appendLibraryListenHistoryRecordToSQLite(path string, record libraryListenHistoryRecord, limit int) error {
	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(path); err != nil {
		return err
	}

	database, err := openLibraryFilesSQLite(path)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return err
	}

	transaction, err := database.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = transaction.Rollback()
	}()

	var existingID int64
	storedPlayedPercent := 0
	lookupErr := transaction.QueryRow(
		`SELECT id, played_percent FROM listen_history WHERE track_path = ? AND listened_at = ? ORDER BY id DESC LIMIT 1`,
		record.TrackPath,
		record.ListenedAt,
	).Scan(&existingID, &storedPlayedPercent)
	if lookupErr != nil && lookupErr != sql.ErrNoRows {
		return lookupErr
	}

	playedPercent := record.PlayedPercent
	if playedPercent < storedPlayedPercent {
		playedPercent = storedPlayedPercent
	}

	if lookupErr == sql.ErrNoRows {
		if _, err := transaction.Exec(
			`INSERT INTO listen_history (track_path, track_name, artist_name, release_name, listened_at, played_percent) VALUES (?, ?, ?, ?, ?, ?)`,
			record.TrackPath,
			record.TrackName,
			record.ArtistName,
			record.ReleaseName,
			record.ListenedAt,
			playedPercent,
		); err != nil {
			return err
		}
	} else {
		if _, err := transaction.Exec(
			`UPDATE listen_history SET track_name = ?, artist_name = ?, release_name = ?, played_percent = ? WHERE id = ?`,
			record.TrackName,
			record.ArtistName,
			record.ReleaseName,
			playedPercent,
			existingID,
		); err != nil {
			return err
		}
	}

	if err := trimLibraryListenHistoryInSQLite(transaction, limit); err != nil {
		return err
	}

	if err := transaction.Commit(); err != nil {
		return err
	}
	committed = true

	return nil
}

func queryLibraryListenHistoryRecords(database *sql.DB) ([]libraryListenHistoryRecord, bool) {
	rows, err := database.Query(`SELECT track_path, track_name, artist_name, release_name, listened_at, played_percent FROM listen_history ORDER BY listened_at DESC, id DESC`)
	if err != nil {
		return nil, false
	}
	defer rows.Close()

	records := make([]libraryListenHistoryRecord, 0)
	for rows.Next() {
		var record libraryListenHistoryRecord
		if err := rows.Scan(&record.TrackPath, &record.TrackName, &record.ArtistName, &record.ReleaseName, &record.ListenedAt, &record.PlayedPercent); err != nil {
			return nil, false
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, false
	}

	return records, true
}

func loadLibraryListenHistoryRecordsFromSQLiteSnapshot(databasePath string) ([]libraryListenHistoryRecord, bool) {
	if !libraryFilesDatabaseFileExists(databasePath) {
		return nil, false
	}

	database, err := openLibraryFilesSQLite(databasePath)
	if err != nil {
		return nil, false
	}
	defer database.Close()

	return queryLibraryListenHistoryRecords(database)
}

func loadLibraryListenHistoryRecordsFromSQLite(databasePath string) ([]libraryListenHistoryRecord, bool) {
	if records, ok := loadLibraryListenHistoryRecordsFromSQLiteSnapshot(databasePath); ok {
		return records, true
	}

	unlock := lockMetadataDatabasePath(databasePath)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(databasePath); err != nil {
		return nil, false
	}

	if !libraryFilesDatabaseFileExists(databasePath) {
		return nil, false
	}

	database, err := openLibraryFilesSQLite(databasePath)
	if err != nil {
		return nil, false
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return nil, false
	}

	return queryLibraryListenHistoryRecords(database)
}

func trimLibraryListenHistoryToLimitInSQLite(path string, limit int) error {
	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(path); err != nil {
		return err
	}

	database, err := openLibraryFilesSQLite(path)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return err
	}

	return trimLibraryListenHistoryInSQLite(database, limit)
}

func loadPlaylistTrackCacheRecordsFromSQLite(databasePath string, trackPaths []string) map[string]playlistTrackCacheRecord {
	unlock := lockMetadataDatabasePath(databasePath)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(databasePath); err != nil {
		return nil
	}

	if !libraryFilesDatabaseFileExists(databasePath) {
		return nil
	}

	cleanPaths := make([]string, 0, len(trackPaths))
	seenPaths := make(map[string]struct{}, len(trackPaths))
	for _, trackPath := range trackPaths {
		cleanPath := normalizePath(trackPath)
		if cleanPath == "" {
			continue
		}
		if _, exists := seenPaths[cleanPath]; exists {
			continue
		}
		seenPaths[cleanPath] = struct{}{}
		cleanPaths = append(cleanPaths, cleanPath)
	}
	if len(cleanPaths) == 0 {
		return nil
	}

	database, err := openLibraryFilesSQLite(databasePath)
	if err != nil {
		return nil
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return nil
	}

	const batchSize = 250
	results := make(map[string]playlistTrackCacheRecord, len(cleanPaths))
	for start := 0; start < len(cleanPaths); start += batchSize {
		end := start + batchSize
		if end > len(cleanPaths) {
			end = len(cleanPaths)
		}

		batch := cleanPaths[start:end]
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(batch)), ",")
		args := make([]any, len(batch))
		for index, trackPath := range batch {
			args[index] = trackPath
		}

		rows, queryErr := database.Query(
			`SELECT track_path, track_name, artist_name FROM playlist_track_cache WHERE track_path IN (`+placeholders+`)`,
			args...,
		)
		if queryErr != nil {
			return nil
		}

		for rows.Next() {
			var record playlistTrackCacheRecord
			if err := rows.Scan(&record.TrackPath, &record.TrackName, &record.ArtistName); err != nil {
				rows.Close()
				return nil
			}
			results[record.TrackPath] = record
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil
		}
		rows.Close()
	}

	return results
}

func savePlaylistTrackCacheRecordsToSQLite(path string, records []playlistTrackCacheRecord) error {
	cleanRecords := make([]playlistTrackCacheRecord, 0, len(records))
	seenPaths := make(map[string]struct{}, len(records))
	for _, record := range records {
		cleanPath := normalizePath(record.TrackPath)
		if cleanPath == "" {
			continue
		}
		if _, exists := seenPaths[cleanPath]; exists {
			continue
		}
		seenPaths[cleanPath] = struct{}{}
		cleanRecords = append(cleanRecords, playlistTrackCacheRecord{
			TrackPath:  cleanPath,
			TrackName:  strings.TrimSpace(record.TrackName),
			ArtistName: strings.TrimSpace(record.ArtistName),
		})
	}
	if len(cleanRecords) == 0 {
		return nil
	}

	unlock := lockMetadataDatabasePath(path)
	defer unlock()

	if err := ensureMetadataDatabaseMigratedLocked(path); err != nil {
		return err
	}

	database, err := openLibraryFilesSQLite(path)
	if err != nil {
		return err
	}
	defer database.Close()

	if err := initializeLibraryFilesSQLite(database); err != nil {
		return err
	}

	transaction, err := database.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = transaction.Rollback()
	}()

	for _, record := range cleanRecords {
		if _, err := transaction.Exec(
			`INSERT INTO playlist_track_cache (track_path, track_name, artist_name) VALUES (?, ?, ?)
			ON CONFLICT(track_path) DO UPDATE SET
				track_name = excluded.track_name,
				artist_name = excluded.artist_name`,
			record.TrackPath,
			record.TrackName,
			record.ArtistName,
		); err != nil {
			return err
		}
	}

	if err := transaction.Commit(); err != nil {
		return err
	}
	committed = true

	return nil
}

func migrateLegacyLibraryFilesDatabaseToMetadata(metadataPath string, legacyPath string) error {
	legacyDatabase, err := openMetadataSQLiteNoMigration(legacyPath)
	if err != nil {
		return err
	}
	defer legacyDatabase.Close()

	if err := initializeLibraryFilesSQLite(legacyDatabase); err != nil {
		return err
	}

	metadataDatabase, err := openMetadataSQLiteNoMigration(metadataPath)
	if err != nil {
		return err
	}
	defer metadataDatabase.Close()

	if err := initializeLibraryFilesSQLite(metadataDatabase); err != nil {
		return err
	}

	transaction, err := metadataDatabase.Begin()
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		_ = transaction.Rollback()
	}()

	if _, err := transaction.Exec(`DELETE FROM meta WHERE key IN (?, ?)`, libraryFilesMetaVersionKey, libraryFilesMetaTotalEntriesKey); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM roots`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM files`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM listen_history`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM playlist_track_cache`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaVersionKey, strconv.Itoa(libraryFilesDatabaseVersion)); err != nil {
		return err
	}

	var totalEntriesRaw string
	err = legacyDatabase.QueryRow(`SELECT value FROM meta WHERE key = ?`, libraryFilesMetaTotalEntriesKey).Scan(&totalEntriesRaw)
	if err == sql.ErrNoRows {
		err = legacyDatabase.QueryRow(`SELECT value FROM meta WHERE key = 'total_entries'`).Scan(&totalEntriesRaw)
	}
	if err == nil {
		if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES (?, ?)`, libraryFilesMetaTotalEntriesKey, totalEntriesRaw); err != nil {
			return err
		}
	} else if err != sql.ErrNoRows {
		return err
	}

	rootRows, err := legacyDatabase.Query(`SELECT path, release_depth FROM roots ORDER BY path`)
	if err != nil {
		return err
	}
	for rootRows.Next() {
		var path string
		var releaseDepth int
		if err := rootRows.Scan(&path, &releaseDepth); err != nil {
			rootRows.Close()
			return err
		}
		if _, err := transaction.Exec(`INSERT INTO roots (path, release_depth) VALUES (?, ?)`, path, releaseDepth); err != nil {
			rootRows.Close()
			return err
		}
	}
	if err := rootRows.Err(); err != nil {
		rootRows.Close()
		return err
	}
	rootRows.Close()

	fileRows, err := legacyDatabase.Query(`SELECT path, root_path, relative_path, kind, size, mod_unix_ns FROM files ORDER BY path`)
	if err != nil {
		return err
	}
	for fileRows.Next() {
		var record libraryFilesDatabaseRecord
		if err := fileRows.Scan(&record.Path, &record.RootPath, &record.RelativePath, &record.Kind, &record.Size, &record.ModUnixNs); err != nil {
			fileRows.Close()
			return err
		}
		if _, err := transaction.Exec(
			`INSERT INTO files (path, root_path, relative_path, kind, size, mod_unix_ns) VALUES (?, ?, ?, ?, ?, ?)`,
			record.Path,
			record.RootPath,
			record.RelativePath,
			record.Kind,
			record.Size,
			record.ModUnixNs,
		); err != nil {
			fileRows.Close()
			return err
		}
	}
	if err := fileRows.Err(); err != nil {
		fileRows.Close()
		return err
	}
	fileRows.Close()

	historyRows, err := legacyDatabase.Query(`SELECT track_path, track_name, artist_name, release_name, listened_at, played_percent FROM listen_history ORDER BY id`)
	if err != nil {
		return err
	}
	for historyRows.Next() {
		var record libraryListenHistoryRecord
		if err := historyRows.Scan(&record.TrackPath, &record.TrackName, &record.ArtistName, &record.ReleaseName, &record.ListenedAt, &record.PlayedPercent); err != nil {
			historyRows.Close()
			return err
		}
		if _, err := transaction.Exec(
			`INSERT INTO listen_history (track_path, track_name, artist_name, release_name, listened_at, played_percent) VALUES (?, ?, ?, ?, ?, ?)`,
			record.TrackPath,
			record.TrackName,
			record.ArtistName,
			record.ReleaseName,
			record.ListenedAt,
			record.PlayedPercent,
		); err != nil {
			historyRows.Close()
			return err
		}
	}
	if err := historyRows.Err(); err != nil {
		historyRows.Close()
		return err
	}
	historyRows.Close()

	cacheRows, err := legacyDatabase.Query(`SELECT track_path, track_name, artist_name FROM playlist_track_cache ORDER BY track_path`)
	if err != nil {
		return err
	}
	for cacheRows.Next() {
		var record playlistTrackCacheRecord
		if err := cacheRows.Scan(&record.TrackPath, &record.TrackName, &record.ArtistName); err != nil {
			cacheRows.Close()
			return err
		}
		if _, err := transaction.Exec(
			`INSERT INTO playlist_track_cache (track_path, track_name, artist_name) VALUES (?, ?, ?)`,
			record.TrackPath,
			record.TrackName,
			record.ArtistName,
		); err != nil {
			cacheRows.Close()
			return err
		}
	}
	if err := cacheRows.Err(); err != nil {
		cacheRows.Close()
		return err
	}
	cacheRows.Close()

	if err := transaction.Commit(); err != nil {
		return err
	}
	committed = true

	return nil
}
