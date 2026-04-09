package main

import (
	"log"
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

	workerState := a.musicBrainzTagWorkerState()
	workerState.progressMu.Lock()
	changed := workerState.progress != progress
	workerState.progress = progress
	workerState.progressMu.Unlock()

	if changed && a.ctx != nil {
		runtimeEventsEmit(a.ctx, musicBrainzTagWorkerProgressEvent, progress)
	}
}

// GetMusicBrainzTagWorkerProgress returns the current MusicBrainz tag worker snapshot.
func (a *App) GetMusicBrainzTagWorkerProgress() MusicBrainzTagWorkerProgress {
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
