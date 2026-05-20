package main

import (
	"log"
	"net/url"
	"path/filepath"
	"strings"
)

type systemMediaTransportControlsManager interface {
	Start(app *App)
	Stop()
	Sync(snapshot systemMediaTransportControlsSnapshot)
}

type appSMTCState struct {
	manager systemMediaTransportControlsManager
}

type systemMediaTransportControlsSnapshot struct {
	Loaded      bool
	Playing     bool
	CurrentTime float64
	Duration    float64
	SourcePath  string
	Title       string
	Artist      string
	AlbumTitle  string
	AlbumArtist string
	CoverArtURL string
}

func (a *App) systemMediaTransportControlsState() *appSMTCState {
	return &a.smtc
}

func (a *App) systemMediaTransportControlsManager() systemMediaTransportControlsManager {
	state := a.systemMediaTransportControlsState()
	if state.manager == nil {
		state.manager = newSystemMediaTransportControlsManager()
	}

	return state.manager
}

func (a *App) startSystemMediaTransportControls() {
	a.systemMediaTransportControlsManager().Start(a)
	a.syncSystemMediaTransportControlsState(a.audioBackend().State())
}

func (a *App) stopSystemMediaTransportControls() {
	a.systemMediaTransportControlsManager().Stop()
}

func (a *App) syncSystemMediaTransportControlsState(state AudioPlaybackState) {
	manager := a.systemMediaTransportControlsState().manager
	if manager == nil {
		return
	}

	manager.Sync(a.systemMediaTransportControlsSnapshotForState(state))
}

func (a *App) syncSystemMediaTransportControlsCurrentState() {
	if a.systemMediaTransportControlsState().manager == nil {
		return
	}

	a.syncSystemMediaTransportControlsState(a.audioBackend().State())
}

func (a *App) syncSystemMediaTransportControlsForTrackPaths(paths []string) {
	if a.systemMediaTransportControlsState().manager == nil || len(paths) == 0 {
		return
	}

	state := a.audioBackend().State()
	if !state.Loaded {
		return
	}

	currentPath := normalizePath(state.SourcePath)
	if currentPath == "" {
		return
	}

	for _, path := range paths {
		if normalizePath(path) != currentPath {
			continue
		}

		a.syncSystemMediaTransportControlsState(state)
		return
	}
}

func (a *App) systemMediaTransportControlsSnapshotForState(state AudioPlaybackState) systemMediaTransportControlsSnapshot {
	snapshot := systemMediaTransportControlsSnapshot{
		Loaded:      state.Loaded,
		Playing:     state.Playing,
		CurrentTime: state.CurrentTime,
		Duration:    state.Duration,
		SourcePath:  normalizePath(state.SourcePath),
	}

	if !snapshot.Loaded || snapshot.SourcePath == "" {
		return snapshot
	}

	contentState := a.libraryContentState()
	contentState.indexMu.RLock()
	indexed, ok := contentState.trackByPath[snapshot.SourcePath]
	contentState.indexMu.RUnlock()
	snapshot.Title, snapshot.Artist, snapshot.AlbumTitle, snapshot.AlbumArtist = a.systemMediaTransportControlsTextMetadata(snapshot.SourcePath, indexed, ok)
	snapshot.CoverArtURL = a.systemMediaTransportControlsCoverArtURL(snapshot.SourcePath, indexed, ok)

	if snapshot.Title == "" {
		baseName := filepath.Base(snapshot.SourcePath)
		snapshot.Title = strings.TrimSuffix(baseName, filepath.Ext(baseName))
	}
	if snapshot.AlbumArtist == "" && snapshot.Artist != "" {
		snapshot.AlbumArtist = snapshot.Artist
	}

	return snapshot
}

func (a *App) systemMediaTransportControlsTextMetadata(sourcePath string, indexed LibraryIndexedFile, indexedAvailable bool) (string, string, string, string) {
	title := strings.TrimSpace(indexed.CachedTrackTitle)
	artist := strings.TrimSpace(indexed.CachedArtistName)
	albumTitle := strings.TrimSpace(indexed.CachedAlbumTitle)
	albumArtist := ""

	if title != "" && artist != "" && albumTitle != "" {
		return title, artist, albumTitle, artist
	}

	trackTags, ok := a.systemMediaTransportControlsTrackTags(sourcePath)
	if !ok {
		return title, artist, albumTitle, albumArtist
	}

	if title == "" {
		title = strings.TrimSpace(trackTags.Title)
	}
	if artist == "" {
		artist = strings.TrimSpace(trackTags.Artist)
	}
	if albumTitle == "" {
		albumTitle = strings.TrimSpace(trackTags.Album)
	}
	albumArtist = strings.TrimSpace(trackTags.AlbumArtist)
	if albumArtist == "" {
		albumArtist = artist
	}

	return title, artist, albumTitle, albumArtist
}

func (a *App) systemMediaTransportControlsTrackTags(path string) (TrackTags, bool) {
	if path == "" || isRemoteLibraryPath(path) {
		return TrackTags{}, false
	}

	signature, ok := trackTagsFileSignatureForPath(path)
	if !ok {
		return TrackTags{}, false
	}

	if cachedTags, cachedHasMetadata, cacheHit := a.getTrackTagsCache(path, signature); cacheHit && cachedHasMetadata {
		return cachedTags, true
	}

	if a.localLibraryFilesDatabaseEnabled() {
		a.musicBrainzTagMu.Lock()
		a.ensureMusicBrainzTagDatabaseLoadedLocked()
		record, exists := a.musicBrainzTagStore.Tracks[path]
		a.musicBrainzTagMu.Unlock()
		if exists {
			if databaseTags, ok := trackTagsFromStoredTrackRecord(path, signature, record); ok {
				a.putTrackTagsCache(path, signature, databaseTags, true)
				return databaseTags, true
			}
		}
	}

	return TrackTags{}, false
}

func (a *App) systemMediaTransportControlsCoverArtURL(sourcePath string, indexed LibraryIndexedFile, indexedAvailable bool) string {
	if sourcePath == "" || isRemoteLibraryPath(sourcePath) {
		return ""
	}

	folderPath := strings.TrimSpace(indexed.FolderPath)
	virtualTrackPath := strings.TrimSpace(indexed.RelativePath)
	if !indexedAvailable || virtualTrackPath == "" {
		root, ok := a.activeLibraryRootForPath(sourcePath)
		if !ok {
			return ""
		}

		resolvedFolderPath, resolvedTrackPath, ok := folderAndRelativeForLibraryRoot(root, sourcePath)
		if !ok {
			return ""
		}
		if folderPath == "" {
			folderPath = strings.TrimSpace(resolvedFolderPath)
		}
		virtualTrackPath = strings.TrimSpace(resolvedTrackPath)
	}

	coverID := a.openSubsonicTrackCoverIDForPath(folderPath, virtualTrackPath, sourcePath)
	if coverID == "" {
		return ""
	}

	config := a.internalCoverArtConfig()
	if strings.TrimSpace(config.BaseURL) == "" || strings.TrimSpace(config.Token) == "" {
		return ""
	}

	query := url.Values{}
	query.Set("id", coverID)
	query.Set("size", "256")
	query.Set("token", config.Token)
	return strings.TrimRight(config.BaseURL, "/") + internalCoverArtPath + "?" + query.Encode()
}

func (a *App) syncSystemMediaTransportControlsAfterAudioCall(state AudioPlaybackState, err error) {
	if err != nil {
		return
	}

	defer func() {
		if recovered := recover(); recovered != nil {
			log.Printf("failed to sync system media transport controls: %v", recovered)
		}
	}()
	a.syncSystemMediaTransportControlsState(state)
}
