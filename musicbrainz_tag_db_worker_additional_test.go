package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMusicBrainzTagWorkerStateHelpersAndIndexes(t *testing.T) {
	state := musicBrainzTagWorkerState{}
	state.noteCompletedEntityKey("")
	state.noteCompletedEntityKey(" artist:11111111-1111-4111-8111-111111111111 ")
	state.noteCompletedEntityKey("artist:11111111-1111-4111-8111-111111111111")
	if state.totalEntityLookups != 1 || state.completedEntityLookups != 1 {
		t.Fatalf("noteCompletedEntityKey() = total:%d completed:%d, want 1/1", state.totalEntityLookups, state.completedEntityLookups)
	}

	state.notePendingEntityKey("release:22222222-2222-4222-8222-222222222222")
	state.notePendingEntityKey("release:22222222-2222-4222-8222-222222222222")
	if len(state.pendingEntityKeys) != 1 || state.totalEntityLookups != 2 {
		t.Fatalf("notePendingEntityKey() = pending:%#v total:%d, want one pending key and total 2", state.pendingEntityKeys, state.totalEntityLookups)
	}
	if !state.queueEntityKey("artist:33333333-3333-4333-8333-333333333333") {
		t.Fatal("queueEntityKey(new key) = false, want true")
	}
	if state.queueEntityKey("artist:33333333-3333-4333-8333-333333333333") {
		t.Fatal("queueEntityKey(duplicate key) = true, want false")
	}
	if entityKey, ok := state.popNextEntityKey(); !ok || entityKey != "release:22222222-2222-4222-8222-222222222222" {
		t.Fatalf("popNextEntityKey() = (%q, %t), want first queued release key", entityKey, ok)
	}
	if entityKey, ok := state.popNextEntityKey(); !ok || entityKey != "artist:33333333-3333-4333-8333-333333333333" {
		t.Fatalf("popNextEntityKey() = (%q, %t), want second queued artist key", entityKey, ok)
	}
	if _, ok := state.popNextEntityKey(); ok {
		t.Fatal("popNextEntityKey(empty) = true, want false")
	}

	if !musicBrainzTagPathLessCaseInsensitive("Alpha", "beta") {
		t.Fatal("musicBrainzTagPathLessCaseInsensitive(Alpha, beta) = false, want true")
	}

	fixture := createLibraryTestFixture(t)
	missingTrack := filepath.Join(fixture.albumOneFolder, "missing.flac")
	representative, ok := selectMusicBrainzTagRepresentativeTrack([]musicBrainzTagTrackScanCandidate{{path: missingTrack}, {path: fixture.trackOne, releaseFolderPath: "Library/Artist/Album", artistFolderPaths: []string{"Library/Artist"}}})
	if !ok || representative.path != normalizePath(fixture.trackOne) && representative.path != fixture.trackOne {
		t.Fatalf("selectMusicBrainzTagRepresentativeTrack() = (%#v, %t), want existing track", representative, ok)
	}

	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne)
	trackRecord := musicBrainzTagTrackRecord{
		ReleaseID:         "22222222-2222-4222-8222-222222222222",
		ArtistIDs:         []string{"11111111-1111-4111-8111-111111111111"},
		ReleaseFolderPath: "Library/Artist/Album",
		ArtistFolderPaths: []string{"Library/Artist"},
	}
	entityRecord := musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       "22222222-2222-4222-8222-222222222222",
		Tags:       []string{"Rock"},
	}
	app.upsertMusicBrainzTagTrackRecordLocked(" track.flac ", trackRecord)
	app.upsertMusicBrainzTagEntityRecordLocked(entityRecord)
	if len(app.musicBrainzTagReleaseFoldersByID) == 0 || len(app.musicBrainzTagEntityKeysByTag) == 0 {
		t.Fatalf("upsertMusicBrainzTag*RecordLocked() did not build indexes: %#v %#v", app.musicBrainzTagReleaseFoldersByID, app.musicBrainzTagEntityKeysByTag)
	}
	app.removeMusicBrainzTagEntityRecordLocked(musicBrainzTagEntityKey("release", entityRecord.MBID))
	app.removeMusicBrainzTagTrackRecordLocked("track.flac")
	if len(app.musicBrainzTagStore.Entities) != 0 || len(app.musicBrainzTagStore.Tracks) != 0 {
		t.Fatalf("removeMusicBrainzTag*RecordLocked() left store populated: %#v %#v", app.musicBrainzTagStore.Tracks, app.musicBrainzTagStore.Entities)
	}

	app.settingsPath = filepath.Join(t.TempDir(), "silphium.settings.json")
	if got := app.musicBrainzTagDatabasePath(); filepath.Base(got) != musicBrainzTagDatabaseFileName {
		t.Fatalf("musicBrainzTagDatabasePath() = %q, want %q suffix", got, musicBrainzTagDatabaseFileName)
	}

	if got := newMusicBrainzTagDatabaseStore(); got.Version != musicBrainzTagDatabaseVersion || got.Tracks == nil || got.Entities == nil {
		t.Fatalf("newMusicBrainzTagDatabaseStore() = %#v, want initialized store", got)
	}
}

func TestMusicBrainzTagWorkerTrackBatchAndProgress(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	fixture := createLibraryTestFixture(t)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexedTrackForTest(fixture.rootOne, fixture.trackOne))
	app.settings.MusicBrainzTagWorkerCores = 1
	if got := app.musicBrainzTagWorkerCount(0); got != 0 {
		t.Fatalf("musicBrainzTagWorkerCount(0) = %d, want 0", got)
	}
	if got := app.musicBrainzTagWorkerCount(3); got != 1 {
		t.Fatalf("musicBrainzTagWorkerCount(3) = %d, want 1", got)
	}
	if got := app.musicBrainzTagTrackBatchSize(); got != 32 {
		t.Fatalf("musicBrainzTagTrackBatchSize() = %d, want 32", got)
	}

	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
	}
	app.putTrackTagsCache(indexed.Path, signature, TrackTags{ReleaseID: "22222222-2222-4222-8222-222222222222", ArtistIDs: []string{"11111111-1111-4111-8111-111111111111"}, RecordLabel: "Label Name", CatalogNumber: "CAT-001"}, true)

	scanResult := app.scanMusicBrainzTagTrack(indexed, 2, "")
	if len(scanResult.pendingEntityKeys) != 2 {
		t.Fatalf("scanMusicBrainzTagTrack() = %#v, want pending release and artist entities", scanResult)
	}
	app.musicBrainzTagMu.Lock()
	storedRecord := app.musicBrainzTagStore.Tracks[indexed.Path]
	app.musicBrainzTagMu.Unlock()
	if storedRecord.RecordLabel != "Label Name" || storedRecord.CatalogNumber != "CAT-001" {
		t.Fatalf("scanMusicBrainzTagTrack() stored record = %#v, want persisted label and catalog number", storedRecord)
	}
	app.musicBrainzTagMu.Lock()
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", "22222222-2222-4222-8222-222222222222")] = musicBrainzTagEntityRecord{EntityType: "release", MBID: "22222222-2222-4222-8222-222222222222", LastFetchedAt: time.Now()}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", "11111111-1111-4111-8111-111111111111")] = musicBrainzTagEntityRecord{EntityType: "artist", MBID: "11111111-1111-4111-8111-111111111111", LastFetchedAt: time.Now()}
	app.musicBrainzTagMu.Unlock()
	scanResult = app.scanMusicBrainzTagTrack(indexed, 2, "")
	if len(scanResult.completedEntityKeys) != 2 {
		t.Fatalf("scanMusicBrainzTagTrack(existing entities) = %#v, want completed release and artist entities", scanResult)
	}

	progressCalls := 0
	batchResult := app.processMusicBrainzTagTrackBatch(map[string]LibraryIndexedFile{indexed.Path: indexed}, []string{indexed.Path, filepath.Join(fixture.albumOneFolder, "missing.flac")}, func(result musicBrainzTagTrackScanResult) {
		progressCalls++
	})
	if len(batchResult.completedEntityKeys) != 2 {
		t.Fatalf("processMusicBrainzTagTrackBatch() = %#v, want deduplicated completed entities", batchResult)
	}
	if progressCalls != 2 {
		t.Fatalf("processMusicBrainzTagTrackBatch() progress calls = %d, want 2", progressCalls)
	}

	app.trackByPath = map[string]LibraryIndexedFile{indexed.Path: indexed}
	progress := app.GetMusicBrainzTagWorkerProgress()
	if !progress.Enabled || progress.TotalTrackScans != 1 {
		t.Fatalf("GetMusicBrainzTagWorkerProgress() = %#v, want enabled progress snapshot", progress)
	}

	app.ctx = context.Background()
	emitCalls := 0
	runtimeEventsEmit = func(ctx context.Context, eventName string, optionalData ...interface{}) {
		emitCalls++
		if ctx != app.ctx {
			t.Fatalf("runtimeEventsEmit ctx = %#v, want app context", ctx)
		}
		if eventName != musicBrainzTagWorkerProgressEvent {
			t.Fatalf("runtimeEventsEmit event = %q, want %q", eventName, musicBrainzTagWorkerProgressEvent)
		}
		if len(optionalData) != 1 {
			t.Fatalf("runtimeEventsEmit args len = %d, want 1", len(optionalData))
		}
		payload, ok := optionalData[0].(MusicBrainzTagWorkerProgress)
		if !ok {
			t.Fatalf("runtimeEventsEmit payload type = %T, want MusicBrainzTagWorkerProgress", optionalData[0])
		}
		if payload.Progress != 1 {
			t.Fatalf("runtimeEventsEmit payload = %#v, want clamped progress 1", payload)
		}
	}
	app.setMusicBrainzTagWorkerProgress(MusicBrainzTagWorkerProgress{Enabled: true, Progress: 2})
	app.setMusicBrainzTagWorkerProgress(MusicBrainzTagWorkerProgress{Enabled: true, Progress: 2})
	if emitCalls != 1 {
		t.Fatalf("setMusicBrainzTagWorkerProgress() emitted %d events, want 1", emitCalls)
	}

	disabledApp := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	disabledApp.settings.MusicBrainzTagDatabaseEnabled = false
	progress = disabledApp.GetMusicBrainzTagWorkerProgress()
	if progress.Enabled {
		t.Fatalf("GetMusicBrainzTagWorkerProgress(disabled) = %#v, want disabled progress", progress)
	}

	app.settings.MusicBrainzTagDatabaseEnabled = true
	app.startMusicBrainzTagWorker()
	if app.musicBrainzTagWorkerState().wakeCh == nil {
		t.Fatal("startMusicBrainzTagWorker() did not initialize worker channels")
	}
	app.notifyMusicBrainzTagWorker()
	app.stopMusicBrainzTagWorker()
	workerState := app.musicBrainzTagWorkerState()
	if workerState.wakeCh != nil || workerState.doneCh != nil || workerState.stopCh != nil {
		t.Fatal("stopMusicBrainzTagWorker() should clear worker channels")
	}
}

func TestMusicBrainzTagTrackBatchStreamsProgressBeforeBatchFinishes(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondTrack := filepath.Join(fixture.albumOneFolder, "02 Second.flac")
	writeTestFile(t, secondTrack, "second")

	indexedOne := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	indexedTwo := indexedTrackForTest(fixture.rootOne, secondTrack)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexedOne, indexedTwo)
	app.settings.MusicBrainzTagWorkerCores = 1

	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	allowSecondTrack := make(chan struct{})
	firstProgress := make(chan struct{})
	readTaglibTags = func(path string) (map[string][]string, error) {
		switch normalizePath(path) {
		case normalizePath(indexedOne.Path):
			return map[string][]string{
				"TITLE":  {"Track One"},
				"ARTIST": {"Artist One"},
				"ALBUM":  {"Album One"},
			}, nil
		case normalizePath(indexedTwo.Path):
			<-allowSecondTrack
			return map[string][]string{
				"TITLE":  {"Track Two"},
				"ARTIST": {"Artist One"},
				"ALBUM":  {"Album One"},
			}, nil
		default:
			return nil, fmt.Errorf("unexpected path %q", path)
		}
	}

	doneCh := make(chan musicBrainzTagTrackScanResult, 1)
	go func() {
		doneCh <- app.processMusicBrainzTagTrackBatch(
			map[string]LibraryIndexedFile{
				indexedOne.Path: indexedOne,
				indexedTwo.Path: indexedTwo,
			},
			[]string{indexedOne.Path, indexedTwo.Path},
			func(result musicBrainzTagTrackScanResult) {
				select {
				case <-firstProgress:
				default:
					close(firstProgress)
				}
			},
		)
	}()

	select {
	case <-firstProgress:
	case <-time.After(2 * time.Second):
		t.Fatal("processMusicBrainzTagTrackBatch() did not stream first progress result before the blocked track finished")
	}

	select {
	case <-doneCh:
		t.Fatal("processMusicBrainzTagTrackBatch() returned before the blocked track finished")
	default:
	}

	close(allowSecondTrack)

	select {
	case batchResult := <-doneCh:
		if len(batchResult.completedEntityKeys) != 0 || len(batchResult.pendingEntityKeys) != 0 {
			t.Fatalf("processMusicBrainzTagTrackBatch() = %#v, want empty entity results for plain tag-only tracks", batchResult)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("processMusicBrainzTagTrackBatch() did not finish after releasing the blocked track")
	}
}

func TestMusicBrainzTagWorkerProgressCountsInFlightEntitiesAsPending(t *testing.T) {
	state := musicBrainzTagWorkerState{
		totalEntityLookups:     2,
		completedEntityLookups: 0,
		inFlightEntityLookups:  2,
	}

	progress := state.progressSnapshot(true)
	if !progress.Active {
		t.Fatal("progressSnapshot(in-flight entities) active = false, want true")
	}
	if progress.PendingEntityLookups != 2 {
		t.Fatalf("progressSnapshot(in-flight entities) pendingEntityLookups = %d, want 2", progress.PendingEntityLookups)
	}
	if progress.CompletedEntityLookups != 0 {
		t.Fatalf("progressSnapshot(in-flight entities) completedEntityLookups = %d, want 0", progress.CompletedEntityLookups)
	}
}

func TestMusicBrainzTagWorkerTrackScanEdgeCases(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)

	missingIndexed := indexed
	missingIndexed.Path = filepath.Join(fixture.albumOneFolder, "missing.flac")
	app.musicBrainzTagMu.Lock()
	app.musicBrainzTagStore.Tracks[missingIndexed.Path] = musicBrainzTagTrackRecord{ReleaseID: "22222222-2222-4222-8222-222222222222"}
	app.musicBrainzTagMu.Unlock()
	if result := app.scanMusicBrainzTagTrack(missingIndexed, 2, ""); len(result.pendingEntityKeys) != 0 || len(result.completedEntityKeys) != 0 {
		t.Fatalf("scanMusicBrainzTagTrack(missing file) = %#v, want empty result", result)
	}
	app.musicBrainzTagMu.Lock()
	if _, exists := app.musicBrainzTagStore.Tracks[missingIndexed.Path]; exists {
		app.musicBrainzTagMu.Unlock()
		t.Fatal("scanMusicBrainzTagTrack(missing file) should remove the stale track record")
	}
	app.musicBrainzTagMu.Unlock()

	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", indexed.Path)
	}
	app.putTrackTagsCache(indexed.Path, signature, TrackTags{ReleaseID: "22222222-2222-4222-8222-222222222222"}, false)
	result := app.scanMusicBrainzTagTrack(indexed, 2, "")
	if len(result.pendingEntityKeys) != 0 || len(result.completedEntityKeys) != 0 {
		t.Fatalf("scanMusicBrainzTagTrack(no metadata) = %#v, want no entity work", result)
	}
}

func TestMusicBrainzTagWorkerRetryAndClampBranches(t *testing.T) {
	originalRuntimeNumCPU := runtimeNumCPU
	t.Cleanup(func() {
		runtimeNumCPU = originalRuntimeNumCPU
	})

	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	now := time.Date(2026, time.April, 7, 12, 0, 0, 0, time.UTC)
	const artistID = "11111111-1111-4111-8111-111111111111"
	entityKey := musicBrainzTagEntityKey("artist", artistID)

	app.settings.MusicBrainzTagDatabaseEnabled = true
	app.settings.MusicBrainzTagStaleDays = intPointer(10)
	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistID,
		LastAttemptAt: now,
	}
	if app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("musicBrainzTagEntityNeedsFetchLocked(recent first attempt) = true, want false")
	}

	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistID,
		LastFetchedAt: now.Add(-24 * time.Hour),
		LastAttemptAt: now.Add(-2 * musicBrainzTagEntityRetryInterval),
		LastError:     "lookup failed",
	}
	if !app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("musicBrainzTagEntityNeedsFetchLocked(retryable error) = false, want true")
	}

	app.settings.MusicBrainzTagRequestStaggeringEnabled = true
	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistID,
		LastFetchedAt: now,
	}
	if app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("musicBrainzTagEntityNeedsFetchLocked(staggered) = true, want false")
	}

	runtimeNumCPU = func() int { return 128 }
	app.settings.MusicBrainzTagRequestStaggeringEnabled = false
	app.settings.MusicBrainzTagWorkerCores = 200
	if got := app.musicBrainzTagWorkerCount(3); got != 3 {
		t.Fatalf("musicBrainzTagWorkerCount(clamped to jobs) = %d, want 3", got)
	}
	if got := app.musicBrainzTagTrackBatchSize(); got != 256 {
		t.Fatalf("musicBrainzTagTrackBatchSize(clamped max) = %d, want 256", got)
	}

	if batchResult := app.processMusicBrainzTagTrackBatch(map[string]LibraryIndexedFile{}, nil, nil); len(batchResult.completedEntityKeys) != 0 || len(batchResult.pendingEntityKeys) != 0 {
		t.Fatalf("processMusicBrainzTagTrackBatch(empty) = %#v, want empty result", batchResult)
	}
}

func TestMusicBrainzTagEntityFetchHelpers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/artist/11111111-1111-4111-8111-111111111111"):
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"name":"Artist Name","tags":[{"name":"Rock"}]}`))
		case strings.Contains(request.URL.Path, "/release/22222222-2222-4222-8222-222222222222"):
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"title":"Album Name","genres":[{"name":"Art Pop"}]}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	artistRecord, ok := fetchMusicBrainzTagEntityRecord("artist", "11111111-1111-4111-8111-111111111111", server.URL, 0)
	if !ok || artistRecord.Title != "Artist Name" || len(artistRecord.Tags) != 1 || artistRecord.Tags[0] != "rock" {
		t.Fatalf("fetchMusicBrainzTagEntityRecord(artist) = (%#v, %t), want normalized artist record", artistRecord, ok)
	}
	releaseRecord, ok := fetchMusicBrainzTagEntityRecord("release", "22222222-2222-4222-8222-222222222222", server.URL, 0)
	if !ok || releaseRecord.Title != "Album Name" || len(releaseRecord.Tags) != 1 || releaseRecord.Tags[0] != "art pop" {
		t.Fatalf("fetchMusicBrainzTagEntityRecord(release) = (%#v, %t), want normalized release record", releaseRecord, ok)
	}
	if _, ok := fetchMusicBrainzTagEntityRecord("label", "33333333-3333-4333-8333-333333333333", server.URL, 0); ok {
		t.Fatal("fetchMusicBrainzTagEntityRecord(label) = true, want false")
	}

	app := newMusicBrainzTagDatabaseTestApp()
	app.settingsLoaded = true
	app.settings = AppSettings{
		MusicBrainzServerURL:          server.URL,
		MusicBrainzRequestRateMs:      0,
		MusicBrainzTagDatabaseEnabled: true,
	}
	app.rebuildMusicBrainzTagIndexesLocked()
	if !app.processMusicBrainzTagEntityFetch("artist:11111111-1111-4111-8111-111111111111") {
		t.Fatal("processMusicBrainzTagEntityFetch(success) = false, want true")
	}
	if record, exists := app.musicBrainzTagStore.Entities["artist:11111111-1111-4111-8111-111111111111"]; !exists || record.Title != "Artist Name" {
		t.Fatalf("processMusicBrainzTagEntityFetch(success) stored %#v, want fetched artist record", record)
	}
	if !app.processMusicBrainzTagEntityFetch("release:99999999-9999-4999-8999-999999999999") {
		t.Fatal("processMusicBrainzTagEntityFetch(failure) = false, want true")
	}
	if record, exists := app.musicBrainzTagStore.Entities["release:99999999-9999-4999-8999-999999999999"]; !exists || record.LastError == "" {
		t.Fatalf("processMusicBrainzTagEntityFetch(failure) stored %#v, want error marker", record)
	}
	if app.processMusicBrainzTagEntityFetch("invalid") {
		t.Fatal("processMusicBrainzTagEntityFetch(invalid key) = true, want false")
	}
}

func TestMusicBrainzTagWorkerLoopProcessesTrackAndEntities(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	app.settings.MusicBrainzServerURL = ""
	app.settings.MusicBrainzRequestRateMs = 0
	app.settings.MusicBrainzTagWorkerCores = 1
	app.settingsPath = filepath.Join(t.TempDir(), "silphium.settings.json")

	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
	}
	const artistID = "11111111-1111-4111-8111-111111111111"
	const releaseID = "22222222-2222-4222-8222-222222222222"
	app.putTrackTagsCache(indexed.Path, signature, TrackTags{ReleaseID: releaseID, ArtistIDs: []string{artistID}}, true)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/artist/"+artistID):
			_, _ = writer.Write([]byte(`{"name":"Worker Artist","tags":[{"name":"rock"}]}`))
		case strings.Contains(request.URL.Path, "/release/"+releaseID):
			_, _ = writer.Write([]byte(`{"title":"Worker Release","genres":[{"name":"shoegaze"}]}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	app.settings.MusicBrainzServerURL = server.URL

	app.startMusicBrainzTagWorker()
	t.Cleanup(func() {
		app.stopMusicBrainzTagWorker()
	})
	app.notifyMusicBrainzTagWorker()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		progress := app.GetMusicBrainzTagWorkerProgress()
		if progress.CompletedTrackScans >= 1 && progress.CompletedEntityLookups >= 2 && !progress.Active {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	progress := app.GetMusicBrainzTagWorkerProgress()
	if progress.CompletedTrackScans < 1 || progress.CompletedEntityLookups < 2 || progress.Active {
		t.Fatalf("GetMusicBrainzTagWorkerProgress() = %#v, want completed worker state", progress)
	}
	if record, exists := app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", artistID)]; !exists || record.Title != "Worker Artist" {
		t.Fatalf("artist entity = %#v, want fetched worker artist record", record)
	}
	if record, exists := app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseID)]; !exists || record.Title != "Worker Release" {
		t.Fatalf("release entity = %#v, want fetched worker release record", record)
	}
}

func TestMusicBrainzTagWorkerStateCleanupSnapshotAndRetryBranches(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne)
	app.settings.LibraryFolders = append(app.settings.LibraryFolders, AppLibraryFolder{
		Path:         "   ",
		ReleaseDepth: 5,
	})

	depthByRoot := app.musicBrainzTagReleaseDepthByRootPath()
	rootKey := strings.ToLower(normalizePath(fixture.rootOne))
	if len(depthByRoot) != 1 || depthByRoot[rootKey] != 2 {
		t.Fatalf("musicBrainzTagReleaseDepthByRootPath() = %#v, want one normalized root entry", depthByRoot)
	}

	if snapshot := app.musicBrainzTagLibraryTrackSnapshot(); snapshot != nil {
		t.Fatalf("musicBrainzTagLibraryTrackSnapshot() = %#v, want nil for an empty index", snapshot)
	}

	emptyState := app.buildMusicBrainzTagWorkerState(9)
	if emptyState.generation != 9 || emptyState.indexedByPath != nil || emptyState.totalTrackPaths != 0 || emptyState.completedTrackPaths != 0 {
		t.Fatalf("buildMusicBrainzTagWorkerState(empty) = %#v, want an empty generation 9 snapshot", emptyState)
	}

	missingIndexed := indexedTrackForTest(fixture.rootOne, filepath.Join(fixture.albumOneFolder, "missing.flac"))
	app.trackByPath = map[string]LibraryIndexedFile{missingIndexed.Path: missingIndexed}
	app.musicBrainzTagStore.Tracks[missingIndexed.Path] = musicBrainzTagTrackRecord{
		ReleaseID:         "22222222-2222-4222-8222-222222222222",
		ReleaseFolderPath: releaseFolderPathForIndexedTrack(missingIndexed, 2),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", "22222222-2222-4222-8222-222222222222")] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       "22222222-2222-4222-8222-222222222222",
	}

	state := app.buildMusicBrainzTagWorkerState(10)
	if state.totalTrackPaths != 0 || len(state.pendingTrackPaths) != 0 {
		t.Fatalf("buildMusicBrainzTagWorkerState(missing representative) = %#v, want no track work", state)
	}
	if len(app.musicBrainzTagStore.Tracks) != 0 {
		t.Fatalf("expected missing representative cleanup to remove stored tracks, got %#v", app.musicBrainzTagStore.Tracks)
	}
	if len(app.musicBrainzTagStore.Entities) != 0 {
		t.Fatalf("expected unreferenced entity cleanup to remove stored entities, got %#v", app.musicBrainzTagStore.Entities)
	}
}

func TestMusicBrainzTagWorkerStateUpdatesStoredPathsAndStaggerTieBreak(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
	}

	const releaseID = "22222222-2222-4222-8222-222222222222"
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	app.musicBrainzTagStore.Tracks[indexed.Path] = musicBrainzTagTrackRecord{
		Signature:         signature,
		ReleaseID:         releaseID,
		ReleaseFolderPath: "Wrong/Folder",
		ArtistFolderPaths: []string{"Wrong/Artist"},
		LastScannedAt:     time.Now().Add(-time.Hour),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseID)] = musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseID,
		LastAttemptAt: time.Now(),
	}

	state := app.buildMusicBrainzTagWorkerState(3)
	if state.completedTrackPaths != 1 || state.totalTrackPaths != 1 || len(state.pendingTrackPaths) != 0 {
		t.Fatalf("buildMusicBrainzTagWorkerState(updated stored path) = %#v, want one completed representative with no pending track scans", state)
	}
	releaseKey := musicBrainzTagEntityKey("release", releaseID)
	if _, exists := state.pendingEntityKeys[releaseKey]; exists {
		t.Fatalf("pendingEntityKeys = %#v, did not expect a recent retry record to be requeued", state.pendingEntityKeys)
	}
	if state.totalEntityLookups != 1 || state.completedEntityLookups != 1 {
		t.Fatalf("entity progress = %d/%d, want 1/1", state.completedEntityLookups, state.totalEntityLookups)
	}

	record := app.musicBrainzTagStore.Tracks[indexed.Path]
	if record.ReleaseFolderPath != releaseFolderPathForIndexedTrack(indexed, 2) {
		t.Fatalf("updated ReleaseFolderPath = %q, want %q", record.ReleaseFolderPath, releaseFolderPathForIndexedTrack(indexed, 2))
	}
	wantArtistFolders := artistFolderPathsForIndexedTrack(indexed, 2)
	if !stringSlicesEqual(record.ArtistFolderPaths, wantArtistFolders) {
		t.Fatalf("updated ArtistFolderPaths = %#v, want %#v", record.ArtistFolderPaths, wantArtistFolders)
	}

	secondAlbumFolder := filepath.Join(fixture.rootOne, "Artist Two", "Album Two")
	if err := os.MkdirAll(secondAlbumFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", secondAlbumFolder, err)
	}
	secondTrack := filepath.Join(secondAlbumFolder, "01 Second.flac")
	writeTestFile(t, secondTrack, "second")

	firstIndexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	secondIndexed := indexedTrackForTest(fixture.rootOne, secondTrack)
	tieApp := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, firstIndexed, secondIndexed)
	tieApp.settings.MusicBrainzTagStaleDays = intPointer(2)
	tieApp.settings.MusicBrainzTagRequestStaggeringEnabled = true

	releaseIDs := []string{
		"22222222-2222-4222-8222-222222222222",
		"11111111-1111-4111-8111-111111111111",
	}
	indexedTracks := []LibraryIndexedFile{firstIndexed, secondIndexed}
	tiedFetchTime := time.Date(2026, time.April, 5, 8, 0, 0, 0, time.UTC)
	for index, track := range indexedTracks {
		trackSignature, ok := trackTagsFileSignatureForPath(track.Path)
		if !ok {
			t.Fatalf("trackTagsFileSignatureForPath(%q) failed", track.Path)
		}

		tieApp.musicBrainzTagStore.Tracks[track.Path] = musicBrainzTagTrackRecord{
			Signature:         trackSignature,
			ReleaseID:         releaseIDs[index],
			ReleaseFolderPath: releaseFolderPathForIndexedTrack(track, 2),
			LastScannedAt:     time.Now().Add(-time.Hour),
		}
		tieApp.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseIDs[index])] = musicBrainzTagEntityRecord{
			EntityType:    "release",
			MBID:          releaseIDs[index],
			LastFetchedAt: tiedFetchTime,
			LastAttemptAt: tiedFetchTime,
		}
	}

	tieState := tieApp.buildMusicBrainzTagWorkerState(4)
	wantPendingKey := musicBrainzTagEntityKey("release", "11111111-1111-4111-8111-111111111111")
	if len(tieState.pendingEntityOrder) != 1 || tieState.pendingEntityOrder[0] != wantPendingKey {
		t.Fatalf("pendingEntityOrder = %#v, want [%q] for equal timestamp tie-breaking", tieState.pendingEntityOrder, wantPendingKey)
	}
}

func TestMusicBrainzTagWorkerLifecycleAndCompletedTrackEntityBranches(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	app.settingsPath = filepath.Join(t.TempDir(), "silphium.settings.json")

	workerState := app.musicBrainzTagWorkerState()
	initialGeneration := workerState.generation.Load()
	app.notifyMusicBrainzTagWorker()
	if workerState.generation.Load() != initialGeneration+1 {
		t.Fatalf("notifyMusicBrainzTagWorker() without a worker = generation %d, want %d", workerState.generation.Load(), initialGeneration+1)
	}

	app.stopMusicBrainzTagWorker()

	manualWake := make(chan struct{}, 1)
	manualWake <- struct{}{}
	workerState.wakeCh = manualWake
	app.notifyMusicBrainzTagWorker()
	if len(manualWake) != 1 {
		t.Fatalf("notifyMusicBrainzTagWorker(full wake channel) left %d queued signals, want 1", len(manualWake))
	}
	workerState.wakeCh = nil

	app.settings.MusicBrainzTagDatabaseEnabled = false
	app.startMusicBrainzTagWorker()
	firstWake := workerState.wakeCh
	firstStop := workerState.stopCh
	firstDone := workerState.doneCh
	if firstWake == nil || firstStop == nil || firstDone == nil {
		t.Fatal("startMusicBrainzTagWorker() did not initialize worker channels")
	}
	app.startMusicBrainzTagWorker()
	if workerState.wakeCh != firstWake || workerState.stopCh != firstStop || workerState.doneCh != firstDone {
		t.Fatal("startMusicBrainzTagWorker() should be a no-op while the worker is already running")
	}
	app.notifyMusicBrainzTagWorker()
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if progress := app.GetMusicBrainzTagWorkerProgress(); !progress.Enabled {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if progress := app.GetMusicBrainzTagWorkerProgress(); progress.Enabled {
		t.Fatalf("GetMusicBrainzTagWorkerProgress(disabled worker) = %#v, want disabled progress", progress)
	}
	app.stopMusicBrainzTagWorker()

	completedApp := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	completedApp.settingsPath = filepath.Join(t.TempDir(), "silphium.settings.json")
	completedApp.settings.MusicBrainzTagWorkerCores = 1
	completedApp.settings.MusicBrainzRequestRateMs = 0

	signature, ok := trackTagsFileSignatureForPath(indexed.Path)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
	}
	const artistID = "11111111-1111-4111-8111-111111111111"
	const releaseID = "22222222-2222-4222-8222-222222222222"
	completedApp.putTrackTagsCache(indexed.Path, signature, TrackTags{ReleaseID: releaseID, ArtistIDs: []string{artistID}}, true)
	completedApp.musicBrainzTagStore.Tracks[indexed.Path] = musicBrainzTagTrackRecord{
		Signature:         signature,
		ReleaseID:         releaseID,
		ArtistIDs:         []string{artistID},
		ReleaseFolderPath: releaseFolderPathForIndexedTrack(indexed, 2),
		ArtistFolderPaths: artistFolderPathsForIndexedTrack(indexed, 2),
		LastScannedAt:     time.Now(),
	}
	completedApp.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", artistID)] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistID,
		LastFetchedAt: time.Now(),
		LastAttemptAt: time.Now(),
	}
	completedApp.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseID)] = musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseID,
		LastFetchedAt: time.Now(),
		LastAttemptAt: time.Now(),
	}
	completedApp.rebuildMusicBrainzTagIndexesLocked()

	completedApp.startMusicBrainzTagWorker()
	t.Cleanup(func() {
		completedApp.stopMusicBrainzTagWorker()
	})
	completedApp.notifyMusicBrainzTagWorker()

	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		progress := completedApp.GetMusicBrainzTagWorkerProgress()
		if progress.CompletedTrackScans >= 1 && progress.CompletedEntityLookups >= 2 && !progress.Active {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	progress := completedApp.GetMusicBrainzTagWorkerProgress()
	if progress.CompletedTrackScans < 1 || progress.CompletedEntityLookups < 2 || progress.PendingEntityLookups != 0 || progress.Active {
		t.Fatalf("GetMusicBrainzTagWorkerProgress(completed entities) = %#v, want one completed scan and no pending entity work", progress)
	}
}
