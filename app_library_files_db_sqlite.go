package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "modernc.org/sqlite"
)

const libraryFilesSQLiteDriverName = "sqlite"
const libraryFilesDatabaseVersion = 1

type libraryFilesDatabaseRecord struct {
	Path         string
	RootPath     string
	RelativePath string
	Kind         string
	Size         int64
	ModUnixNs    int64
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
		mod_unix_ns INTEGER NOT NULL DEFAULT 0
	)`,
	`CREATE INDEX IF NOT EXISTS idx_library_files_root_relative ON files (root_path, relative_path)`,
	`CREATE INDEX IF NOT EXISTS idx_library_files_root_kind ON files (root_path, kind)`,
}

func libraryFilesDatabaseFileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}

	return !info.IsDir()
}

func openLibraryFilesSQLite(path string) (*sql.DB, error) {
	directory := filepath.Dir(path)
	if directory != "" && directory != "." {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			return nil, err
		}
	}

	database, err := sql.Open(libraryFilesSQLiteDriverName, path)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)
	if err := configureLibraryFilesSQLite(database); err != nil {
		database.Close()
		return nil, err
	}
	return database, nil
}

func configureLibraryFilesSQLite(database *sql.DB) error {
	var journalMode string
	if err := database.QueryRow(`PRAGMA journal_mode=WAL`).Scan(&journalMode); err != nil {
		return err
	}

	if _, err := database.Exec(`PRAGMA synchronous=NORMAL`); err != nil {
		return err
	}

	return nil
}

func initializeLibraryFilesSQLite(database *sql.DB) error {
	for _, statement := range libraryFilesSQLiteSchemaStatements {
		if _, err := database.Exec(statement); err != nil {
			return err
		}
	}

	return nil
}

func loadLibraryFilesDatabaseRecordsFromSQLite(databasePath string, roots []libraryRootConfig) ([]libraryFilesDatabaseRecord, int, bool) {
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
	if err := database.QueryRow(`SELECT value FROM meta WHERE key = 'total_entries'`).Scan(&totalEntriesRaw); err == nil {
		parsed, parseErr := strconv.Atoi(strings.TrimSpace(totalEntriesRaw))
		if parseErr == nil && parsed > 0 {
			totalEntries = parsed
		}
	}

	rows, err := database.Query(`SELECT path, root_path, relative_path, kind, size, mod_unix_ns FROM files ORDER BY kind, relative_path, path`)
	if err != nil {
		return nil, 0, false
	}

	records := make([]libraryFilesDatabaseRecord, 0)
	for rows.Next() {
		var record libraryFilesDatabaseRecord
		if err := rows.Scan(&record.Path, &record.RootPath, &record.RelativePath, &record.Kind, &record.Size, &record.ModUnixNs); err != nil {
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
	defer transaction.Rollback()

	if _, err := transaction.Exec(`DELETE FROM meta`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM roots`); err != nil {
		return err
	}
	if _, err := transaction.Exec(`DELETE FROM files`); err != nil {
		return err
	}

	if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES ('version', ?)`, strconv.Itoa(libraryFilesDatabaseVersion)); err != nil {
		return err
	}
	if _, err := transaction.Exec(`INSERT INTO meta (key, value) VALUES ('total_entries', ?)`, strconv.Itoa(snapshot.TotalEntries)); err != nil {
		return err
	}

	for _, root := range snapshot.Roots {
		if _, err := transaction.Exec(`INSERT INTO roots (path, release_depth) VALUES (?, ?)`, root.Path, root.ReleaseDepth); err != nil {
			return err
		}
	}

	writeEntries := func(kind string, entries []LibraryIndexedFile) error {
		for _, entry := range entries {
			relativePath := strings.TrimSpace(entry.RelativePath)
			if entry.RootName != "" {
				prefix := entry.RootName + "/"
				if relativePath == entry.RootName {
					relativePath = ""
				} else if strings.HasPrefix(relativePath, prefix) {
					relativePath = strings.TrimPrefix(relativePath, prefix)
				}
			}
			if strings.TrimSpace(relativePath) == "" {
				continue
			}

			var size int64
			var modUnixNs int64
			if info, statErr := os.Stat(entry.Path); statErr == nil {
				size = info.Size()
				modUnixNs = info.ModTime().UnixNano()
			}

			if _, err := transaction.Exec(
				`INSERT INTO files (path, root_path, relative_path, kind, size, mod_unix_ns) VALUES (?, ?, ?, ?, ?, ?)`,
				entry.Path,
				entry.RootPath,
				relativePath,
				kind,
				size,
				modUnixNs,
			); err != nil {
				return err
			}
		}

		return nil
	}

	if err := writeEntries("track", snapshot.TrackFiles); err != nil {
		return err
	}
	if err := writeEntries("text-file", snapshot.TextFiles); err != nil {
		return err
	}
	if err := writeEntries("image-file", snapshot.ImageFiles); err != nil {
		return err
	}

	return transaction.Commit()
}
