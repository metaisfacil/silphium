package main

import (
	"log"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

var musicBrainzTagWorkerStopTimeout = 2 * time.Second

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

func musicBrainzTagTrackPathKey(path string) string {
	normalizedPath := normalizePath(path)
	if normalizedPath == "" {
		return ""
	}

	if runtime.GOOS == "windows" && !isRemoteLibraryPath(normalizedPath) {
		return strings.ToLower(normalizedPath)
	}

	return normalizedPath
}

func (a *App) musicBrainzTagDatabaseEnabled() bool {
	a.ensureSettingsLoaded()
	return a.settingsState().settings.MusicBrainzTagDatabaseEnabled
}

func (a *App) musicBrainzTagStaleDays() int {
	a.ensureSettingsLoaded()
	return normalizeMusicBrainzTagStaleDays(a.settingsState().settings.MusicBrainzTagStaleDays)
}

func (a *App) musicBrainzTagRequestStaggeringEnabled() bool {
	a.ensureSettingsLoaded()
	return a.settingsState().settings.MusicBrainzTagRequestStaggeringEnabled && a.musicBrainzTagStaleDays() > 0
}

func (a *App) musicBrainzTagReleaseDepthByRootPath() map[string]int {
	a.ensureSettingsLoaded()
	settings := a.settingsState().settings
	releaseDepthByRootPath := make(map[string]int, len(settings.LibraryFolders))
	for _, folder := range settings.LibraryFolders {
		normalizedPath, ok := absoluteNormalizedPath(folder.Path)
		if !ok {
			continue
		}

		releaseDepthByRootPath[strings.ToLower(normalizedPath)] = normalizeReleaseDepth(folder.ReleaseDepth)
	}

	return releaseDepthByRootPath
}

func (a *App) musicBrainzTagWorkerConfiguredRootPaths() map[string]struct{} {
	a.ensureSettingsLoaded()
	settings := a.settingsState().settings
	configuredRootPaths := make(map[string]struct{}, len(settings.LibraryFolders))
	for _, folder := range settings.LibraryFolders {
		normalizedPath, ok := absoluteNormalizedPath(folder.Path)
		if !ok {
			continue
		}

		configuredRootPaths[strings.ToLower(normalizedPath)] = struct{}{}
	}

	return configuredRootPaths
}

func (a *App) musicBrainzTagWorkerDisabledRootPaths() map[string]struct{} {
	a.ensureSettingsLoaded()
	settings := a.settingsState().settings
	disabledRootPaths := make(map[string]struct{})
	for _, folder := range settings.LibraryFolders {
		if libraryFolderMusicBrainzTagWorkerScansEnabled(folder) {
			continue
		}

		normalizedPath, ok := absoluteNormalizedPath(folder.Path)
		if !ok {
			continue
		}

		disabledRootPaths[strings.ToLower(normalizedPath)] = struct{}{}
	}

	if len(disabledRootPaths) == 0 {
		return nil
	}

	return disabledRootPaths
}

func (a *App) musicBrainzTagLibraryTrackSnapshot(configuredRootPaths map[string]struct{}, disabledRootPaths map[string]struct{}) map[string]LibraryIndexedFile {
	contentState := a.libraryContentState()
	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	if len(contentState.trackByPath) == 0 {
		return nil
	}

	snapshot := make(map[string]LibraryIndexedFile, len(contentState.trackByPath))
	for path, indexed := range contentState.trackByPath {
		rootKey := strings.ToLower(normalizePath(indexed.RootPath))
		if _, configured := configuredRootPaths[rootKey]; !configured {
			continue
		}

		if len(disabledRootPaths) > 0 {
			if _, disabled := disabledRootPaths[rootKey]; disabled {
				continue
			}
		}

		snapshot[path] = indexed
	}

	if len(snapshot) == 0 {
		return nil
	}

	return snapshot
}

func (a *App) buildMusicBrainzTagWorkerState(generation uint64) musicBrainzTagWorkerState {
	configuredRootPaths := a.musicBrainzTagWorkerConfiguredRootPaths()
	disabledRootPaths := a.musicBrainzTagWorkerDisabledRootPaths()
	snapshot := a.musicBrainzTagLibraryTrackSnapshot(configuredRootPaths, disabledRootPaths)
	state := musicBrainzTagWorkerState{
		generation:           generation,
		indexedByPath:        snapshot,
		referencedEntityKeys: make(map[string]struct{}),
		pendingEntityKeys:    make(map[string]struct{}),
	}

	paths := make([]string, 0, len(snapshot))
	for path := range snapshot {
		paths = append(paths, path)
	}
	sortPathsCaseInsensitive(paths)

	releaseDepthByRootPath := a.musicBrainzTagReleaseDepthByRootPath()
	now := time.Now()

	a.musicBrainzTagMu.Lock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()
	storedTracks := make(map[string]musicBrainzTagTrackRecord, len(a.musicBrainzTagStore.Tracks))
	for path, record := range a.musicBrainzTagStore.Tracks {
		storedTracks[path] = record
	}
	storedTrackRecordsByKey := make(map[string]musicBrainzTagStoredTrackRecord, len(storedTracks))
	for path, record := range storedTracks {
		pathKey := musicBrainzTagTrackPathKey(path)
		if pathKey == "" {
			continue
		}

		existing, exists := storedTrackRecordsByKey[pathKey]
		if exists && !musicBrainzTagPathLessCaseInsensitive(path, existing.path) {
			continue
		}

		storedTrackRecordsByKey[pathKey] = musicBrainzTagStoredTrackRecord{
			path:   path,
			record: record,
		}
	}
	storedEntities := make(map[string]musicBrainzTagEntityRecord, len(a.musicBrainzTagStore.Entities))
	for entityKey, record := range a.musicBrainzTagStore.Entities {
		storedEntities[entityKey] = record
	}
	a.musicBrainzTagMu.Unlock()

	activePathsByKey := make(map[string]string, len(paths))
	actualTrackPaths := 0
	trackUpdates := make(map[string]musicBrainzTagTrackRecord)
	trackRemovals := make([]string, 0)
	for _, path := range paths {
		pathKey := musicBrainzTagTrackPathKey(path)
		if pathKey == "" {
			continue
		}
		activePathsByKey[pathKey] = path
		indexed := snapshot[path]
		releaseDepth := releaseDepthByRootPath[strings.ToLower(normalizePath(indexed.RootPath))]
		releaseFolderPath := releaseFolderPathForIndexedTrack(indexed, releaseDepth)
		artistFolderPaths := artistFolderPathsForIndexedTrack(indexed, releaseDepth)
		matchingStoredTrack, matchExists := storedTrackRecordsByKey[pathKey]
		if exactRecord, exactExists := storedTracks[path]; exactExists {
			matchingStoredTrack = musicBrainzTagStoredTrackRecord{
				path:   path,
				record: exactRecord,
			}
			matchExists = true
		}
		signature, ok := trackTagsFileSignatureForPath(path)
		if !ok {
			if matchExists {
				delete(storedTracks, matchingStoredTrack.path)
				delete(storedTrackRecordsByKey, pathKey)
				trackRemovals = append(trackRemovals, matchingStoredTrack.path)
			}
			continue
		}
		actualTrackPaths++

		if matchExists && matchingStoredTrack.path != path {
			delete(storedTracks, matchingStoredTrack.path)
			trackRemovals = append(trackRemovals, matchingStoredTrack.path)
		}

		existingRecord := matchingStoredTrack.record
		if matchExists && existingRecord.Signature == signature {
			if matchingStoredTrack.path != path || existingRecord.ReleaseFolderPath != releaseFolderPath || !stringSlicesEqual(existingRecord.ArtistFolderPaths, artistFolderPaths) {
				existingRecord.ReleaseFolderPath = releaseFolderPath
				existingRecord.ArtistFolderPaths = artistFolderPaths
				trackUpdates[path] = existingRecord
			}
			storedTracks[path] = existingRecord
			storedTrackRecordsByKey[pathKey] = musicBrainzTagStoredTrackRecord{
				path:   path,
				record: existingRecord,
			}
			state.completedTrackPaths++
			continue
		}

		state.pendingTrackPaths = append(state.pendingTrackPaths, path)
	}

	for path := range storedTracks {
		pathKey := musicBrainzTagTrackPathKey(path)
		if activePath, exists := activePathsByKey[pathKey]; exists && activePath == path {
			continue
		}

		delete(storedTracks, path)
		trackRemovals = append(trackRemovals, path)
	}

	if len(trackRemovals) > 0 || len(trackUpdates) > 0 {
		a.musicBrainzTagMu.Lock()
		a.ensureMusicBrainzTagDatabaseLoadedLocked()
		for _, path := range trackRemovals {
			a.removeMusicBrainzTagTrackRecordLocked(path)
		}
		for path, record := range trackUpdates {
			a.upsertMusicBrainzTagTrackRecordLocked(path, record)
		}
		a.musicBrainzTagMu.Unlock()
	}
	state.totalTrackPaths = actualTrackPaths

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

	storedStore := musicBrainzTagDatabaseStore{Tracks: storedTracks, Entities: storedEntities}
	for _, path := range sortedMusicBrainzTagTrackPaths(storedStore) {
		record := storedTracks[path]
		for _, entityKey := range musicBrainzTagEntityKeysForTrackRecord(record) {
			cleanEntityKey := strings.TrimSpace(entityKey)
			if cleanEntityKey == "" {
				continue
			}

			if _, exists := referencedEntityKeys[cleanEntityKey]; exists {
				continue
			}

			referencedEntityKeys[cleanEntityKey] = struct{}{}
			storedRecord, exists := storedEntities[cleanEntityKey]
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

	if len(storedEntities) > 0 {
		a.musicBrainzTagMu.Lock()
		a.ensureMusicBrainzTagDatabaseLoadedLocked()
		for entityKey := range storedEntities {
			if _, exists := state.referencedEntityKeys[entityKey]; exists {
				continue
			}

			a.removeMusicBrainzTagEntityRecordLocked(entityKey)
		}
		a.musicBrainzTagMu.Unlock()
	}

	return state
}

func (a *App) setMusicBrainzTagWorkerProgress(progress MusicBrainzTagWorkerProgress) {
	progress.Progress = clampMusicBrainzTagWorkerProgress(progress.Progress)

	workerState := a.musicBrainzTagWorkerState()
	workerState.progressMu.Lock()
	changed := workerState.progress != progress
	workerState.progress = progress
	workerState.progressMu.Unlock()

	runtimeState := a.runtimeState()
	if changed && runtimeState.ctx != nil {
		runtimeEventsEmit(runtimeState.ctx, musicBrainzTagWorkerProgressEvent, progress)
	}
}

func (a *App) musicBrainzTagWorkerProgressSnapshot() MusicBrainzTagWorkerProgress {
	workerState := a.musicBrainzTagWorkerState()
	workerState.progressMu.Lock()
	progress := workerState.progress
	workerState.progressMu.Unlock()
	return progress
}

func (a *App) markMusicBrainzTagWorkerActive() {
	workerState := a.musicBrainzTagWorkerState()
	workerState.progressMu.Lock()
	progress := workerState.progress
	progress.Enabled = true
	progress.Active = true
	workerState.progress = progress
	workerState.progressMu.Unlock()
}

// GetMusicBrainzTagWorkerProgress returns the current MusicBrainz tag worker snapshot.
func (a *App) GetMusicBrainzTagWorkerProgress() MusicBrainzTagWorkerProgress {
	return profiledValue(a, "GetMusicBrainzTagWorkerProgress", func() MusicBrainzTagWorkerProgress {
		workerState := a.musicBrainzTagWorkerState()
		workerState.progressMu.Lock()
		progress := workerState.progress
		workerState.progressMu.Unlock()

		enabled := a.musicBrainzTagDatabaseEnabled()
		if progress != (MusicBrainzTagWorkerProgress{}) || !enabled {
			if progress == (MusicBrainzTagWorkerProgress{}) {
				progress.Enabled = enabled
			}
			return progress
		}

		state := a.buildMusicBrainzTagWorkerState(workerState.generation.Load())
		progress = state.progressSnapshot(true)
		a.setMusicBrainzTagWorkerProgress(progress)
		return progress
	})
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
	workerCount := normalizeMusicBrainzTagWorkerCores(a.settingsState().settings.MusicBrainzTagWorkerCores)
	if workerCount > jobCount {
		workerCount = jobCount
	}

	return workerCount
}

func (a *App) musicBrainzTagTrackBatchSize() int {
	workerCount := a.musicBrainzTagWorkerCount(256)

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

	record := musicBrainzTagTrackRecordFromIndexedTrack(indexed, releaseDepth, signature, trackTags)

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

func musicBrainzTagTrackRecordFromIndexedTrack(indexed LibraryIndexedFile, releaseDepth int, signature trackTagsFileSignature, trackTags TrackTags) musicBrainzTagTrackRecord {
	return musicBrainzTagTrackRecord{
		Signature:         signature,
		Title:             strings.TrimSpace(trackTags.Title),
		TrackArtist:       strings.TrimSpace(trackTags.Artist),
		AlbumTitle:        strings.TrimSpace(trackTags.Album),
		AlbumArtist:       strings.TrimSpace(trackTags.AlbumArtist),
		Date:              strings.TrimSpace(trackTags.Date),
		RecordLabel:       strings.TrimSpace(trackTags.RecordLabel),
		CatalogNumber:     strings.TrimSpace(trackTags.CatalogNumber),
		Genres:            append([]string(nil), trackTags.Genres...),
		TrackNumber:       parseIntValue(trackTags.TrackNumber),
		TrackTotal:        parseIntValue(trackTags.TrackTotal),
		DiscNumber:        parseIntValue(trackTags.DiscNumber),
		DiscTotal:         parseIntValue(trackTags.DiscTotal),
		DurationSeconds:   trackTags.DurationSecs,
		BitRate:           trackTags.BitRate,
		BitDepth:          trackTags.BitDepth,
		SampleRate:        trackTags.SampleRate,
		Channels:          trackTags.Channels,
		FileSizeBytes:     signature.Size,
		RecordingID:       sanitizeMusicBrainzID(trackTags.RecordingID),
		ReleaseID:         sanitizeMusicBrainzID(trackTags.ReleaseID),
		ArtistIDs:         normalizeMusicBrainzArtistIDsForTags(trackTags.ArtistID, trackTags.ArtistIDs),
		AlbumArtistIDs:    sanitizeMusicBrainzIDs(trackTags.AlbumArtistIDs),
		ReleaseFolderPath: releaseFolderPathForIndexedTrack(indexed, releaseDepth),
		ArtistFolderPaths: artistFolderPathsForIndexedTrack(indexed, releaseDepth),
		LastScannedAt:     time.Now(),
	}
}

func (a *App) processMusicBrainzTagTrackBatch(indexedByPath map[string]LibraryIndexedFile, paths []string, onProgress func(musicBrainzTagTrackScanResult)) musicBrainzTagTrackScanResult {
	if len(paths) == 0 {
		return musicBrainzTagTrackScanResult{}
	}

	a.ensureSettingsLoaded()
	ffprobePath := resolveFFProbePath(a.settingsState().settings.FFmpegPath)
	releaseDepthByRootPath := a.musicBrainzTagReleaseDepthByRootPath()
	workerCount := a.musicBrainzTagWorkerCount(len(paths))

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

	go func() {
		waitGroup.Wait()
		close(results)
	}()

	batchResult := musicBrainzTagTrackScanResult{}
	seenCompleted := make(map[string]struct{})
	seenPending := make(map[string]struct{})
	for result := range results {
		if onProgress != nil {
			onProgress(result)
		}

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
	workerState := a.musicBrainzTagWorkerState()
	if workerState.wakeCh != nil {
		return
	}

	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	wakeCh := make(chan struct{}, 1)
	workerState.stopCh = stopCh
	workerState.doneCh = doneCh
	workerState.wakeCh = wakeCh

	go a.musicBrainzTagWorkerLoop(stopCh, wakeCh, doneCh)
}

func (a *App) stopMusicBrainzTagWorker() {
	workerState := a.musicBrainzTagWorkerState()
	stopCh := workerState.stopCh
	doneCh := workerState.doneCh
	if stopCh == nil || doneCh == nil {
		return
	}

	workerState.stopCh = nil
	workerState.doneCh = nil
	workerState.wakeCh = nil
	close(stopCh)
	select {
	case <-doneCh:
	case <-time.After(musicBrainzTagWorkerStopTimeout):
		log.Printf("musicbrainz tag worker stop timed out after %s", musicBrainzTagWorkerStopTimeout)
	}
	a.persistMusicBrainzTagDatabase(true)
}

func (a *App) notifyMusicBrainzTagWorker() {
	workerState := a.musicBrainzTagWorkerState()
	workerState.generation.Add(1)
	if workerState.wakeCh == nil {
		return
	}

	select {
	case workerState.wakeCh <- struct{}{}:
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

		currentGeneration := a.musicBrainzTagWorkerState().generation.Load()
		if state.generation != currentGeneration {
			a.markMusicBrainzTagWorkerActive()
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
			state.inFlightTrackScans += len(batch)
			a.processMusicBrainzTagTrackBatch(state.indexedByPath, batch, func(result musicBrainzTagTrackScanResult) {
				if state.inFlightTrackScans > 0 {
					state.inFlightTrackScans--
				}
				for _, entityKey := range result.completedEntityKeys {
					state.noteCompletedEntityKey(entityKey)
				}
				for _, entityKey := range result.pendingEntityKeys {
					state.notePendingEntityKey(entityKey)
				}
				state.completedTrackPaths++
				a.setMusicBrainzTagWorkerProgress(state.progressSnapshot(true))
			})
			didWork = true
		}

		if len(state.pendingEntityKeys) > 0 {
			workerCount := a.musicBrainzTagWorkerCount(len(state.pendingEntityKeys))
			if workerCount > 0 {
				completedEntityFetches := 0
				activeWorkers := 0
				completionCh := make(chan struct{}, workerCount)

				launchFetch := func(entityKey string) {
					state.inFlightEntityLookups++
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
					if state.inFlightEntityLookups > 0 {
						state.inFlightEntityLookups--
					}
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
