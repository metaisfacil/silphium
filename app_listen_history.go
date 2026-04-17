package main

import (
	logpkg "log"
	"path/filepath"
	"strings"
	"time"
)

func (a *App) indexedFileForHistoryRecord(record libraryListenHistoryRecord) LibraryIndexedFile {
	cleanPath := normalizePath(record.TrackPath)
	name := filepath.Base(cleanPath)
	cachedTrackTitle := strings.TrimSpace(record.TrackName)
	cachedArtistName := strings.TrimSpace(record.ArtistName)
	if root, ok := a.activeLibraryRootForPath(cleanPath); ok {
		if indexed, indexedOK := indexFileForRoot(root, cleanPath, name); indexedOK {
			indexed.CachedTrackTitle = cachedTrackTitle
			indexed.CachedArtistName = cachedArtistName
			indexed.ListenedAt = record.ListenedAt
			return indexed
		}
	}

	return LibraryIndexedFile{
		Name:             name,
		Path:             cleanPath,
		RelativePath:     name,
		FolderPath:       filepath.ToSlash(filepath.Dir(cleanPath)),
		RootPath:         "",
		RootName:         "",
		CachedTrackTitle: cachedTrackTitle,
		CachedArtistName: cachedArtistName,
		ListenedAt:       record.ListenedAt,
		ModifiedAtMs:     0,
	}
}

func (a *App) trimLocalLibraryListenHistory() {
	if !a.localLibraryFilesDatabaseListenHistoryEnabled() {
		return
	}

	if err := trimLibraryListenHistoryToLimitInSQLite(a.libraryFilesDatabasePath(), a.localLibraryFilesDatabaseListenHistoryLimit()); err != nil {
		logpkg.Printf("failed to trim local library listen history: %v", err)
	}
}

// AddListenHistoryEntry stores one completed listen in the local library database.
func (a *App) AddListenHistoryEntry(trackPath string, trackName string, artistName string, releaseName string, listenedAt int64) bool {
	return profiledValue(a, "AddListenHistoryEntry", func() bool {
		cleanPath := normalizePath(trackPath)
		if cleanPath == "" || !a.localLibraryFilesDatabaseListenHistoryEnabled() {
			return false
		}

		if listenedAt <= 0 {
			listenedAt = time.Now().Unix()
		}

		name := strings.TrimSpace(trackName)
		if name == "" {
			name = filepath.Base(cleanPath)
		}

		record := libraryListenHistoryRecord{
			TrackPath:   cleanPath,
			TrackName:   name,
			ArtistName:  strings.TrimSpace(artistName),
			ReleaseName: strings.TrimSpace(releaseName),
			ListenedAt:  listenedAt,
		}
		if err := appendLibraryListenHistoryRecordToSQLite(a.libraryFilesDatabasePath(), record, a.localLibraryFilesDatabaseListenHistoryLimit()); err != nil {
			logpkg.Printf("failed to append local library listen history: %v", err)
			return false
		}

		return true
	})
}

// LoadListenHistoryPlaylist returns the stored listen history as a read-only playlist view.
func (a *App) LoadListenHistoryPlaylist() PlaylistLoadResult {
	return profiledValue(a, "LoadListenHistoryPlaylist", func() PlaylistLoadResult {
		result := PlaylistLoadResult{
			Name:       "Listen History",
			TrackFiles: []LibraryIndexedFile{},
		}
		if !a.localLibraryFilesDatabaseListenHistoryEnabled() {
			return result
		}

		records, ok := loadLibraryListenHistoryRecordsFromSQLite(a.libraryFilesDatabasePath())
		if !ok {
			return result
		}

		result.TrackFiles = make([]LibraryIndexedFile, 0, len(records))
		for _, record := range records {
			if strings.TrimSpace(record.TrackPath) == "" {
				continue
			}

			result.TrackFiles = append(result.TrackFiles, a.indexedFileForHistoryRecord(record))
		}

		return result
	})
}
