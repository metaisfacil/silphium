package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestParseMusicBrainzTagSearchQuery(t *testing.T) {
	testCases := []struct {
		name      string
		query     string
		wantTags  []string
		wantMatch bool
	}{
		{
			name:      "single tag",
			query:     "mbtag:rock",
			wantTags:  []string{"rock"},
			wantMatch: true,
		},
		{
			name:      "quoted tag",
			query:     "mbtag:\"rock\"",
			wantTags:  []string{"rock"},
			wantMatch: true,
		},
		{
			name:      "multiple tags",
			query:     "mbtag:rock,\"visual kei\"",
			wantTags:  []string{"rock", "visual kei"},
			wantMatch: true,
		},
		{
			name:      "not a tag query",
			query:     "rock",
			wantTags:  nil,
			wantMatch: false,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			gotTags, gotMatch := parseMusicBrainzTagSearchQuery(testCase.query)
			if gotMatch != testCase.wantMatch {
				t.Fatalf("parseMusicBrainzTagSearchQuery(%q) match = %t, want %t", testCase.query, gotMatch, testCase.wantMatch)
			}

			if !stringSlicesEqual(gotTags, testCase.wantTags) {
				t.Fatalf("parseMusicBrainzTagSearchQuery(%q) tags = %#v, want %#v", testCase.query, gotTags, testCase.wantTags)
			}
		})
	}
}

func TestReleaseFolderPathForIndexedTrack(t *testing.T) {
	indexed := LibraryIndexedFile{
		FolderPath: "Library/Artist/Album/Disc 1",
		RootName:   "Library",
	}

	if got := releaseFolderPathForIndexedTrack(indexed, 2); got != "Library/Artist/Album" {
		t.Fatalf("releaseFolderPathForIndexedTrack depth 2 = %q, want %q", got, "Library/Artist/Album")
	}

	if got := releaseFolderPathForIndexedTrack(indexed, 0); got != "Library/Artist/Album/Disc 1" {
		t.Fatalf("releaseFolderPathForIndexedTrack depth 0 = %q, want %q", got, "Library/Artist/Album/Disc 1")
	}
}

func TestArtistFolderPathsForIndexedTrack(t *testing.T) {
	indexed := LibraryIndexedFile{
		FolderPath: "Library/Label/Artist/Album/Disc 1",
		RootName:   "Library",
	}

	got := artistFolderPathsForIndexedTrack(indexed, 3)
	want := []string{"Library/Label/Artist"}
	if !stringSlicesEqual(got, want) {
		t.Fatalf("artistFolderPathsForIndexedTrack depth 3 = %#v, want %#v", got, want)
	}
}

func TestUpsertMusicBrainzTagEntityRecordLockedSkipsMissingMBID(t *testing.T) {
	app := &App{
		musicBrainzTagStore:       newMusicBrainzTagDatabaseStore(),
		musicBrainzTagStoreLoaded: true,
	}

	app.upsertMusicBrainzTagEntityRecordLocked(musicBrainzTagEntityRecord{
		EntityType: "artist",
		Title:      "Missing ID",
	})

	if len(app.musicBrainzTagStore.Entities) != 0 {
		t.Fatalf("expected no entities to be stored without an MBID, got %#v", app.musicBrainzTagStore.Entities)
	}
}

func TestMusicBrainzTagEntityNeedsFetchLockedUsesConfiguredStaleDays(t *testing.T) {
	now := time.Date(2026, time.April, 5, 12, 0, 0, 0, time.UTC)
	artistMBID := "11111111-1111-4111-8111-111111111111"
	entityKey := musicBrainzTagEntityKey("artist", artistMBID)
	app := &App{
		settings: AppSettings{
			MusicBrainzTagStaleDays: intPointer(10),
		},
		settingsLoaded:            true,
		musicBrainzTagStore:       newMusicBrainzTagDatabaseStore(),
		musicBrainzTagStoreLoaded: true,
	}

	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		LastFetchedAt: now.Add(-10 * 24 * time.Hour),
	}
	if !app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("expected entity to refresh after 10 days when stale window is configured")
	}

	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: now.Add(-9 * 24 * time.Hour),
	}
	if app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("did not expect entity to refresh before the configured stale window")
	}

	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: now.Add(-10 * 24 * time.Hour),
	}
	if !app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("expected entity to refresh once the configured stale window elapses")
	}

	app.settings.MusicBrainzTagStaleDays = intPointer(0)
	app.musicBrainzTagStore.Entities[entityKey] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: now.Add(-365 * 24 * time.Hour),
	}
	if app.musicBrainzTagEntityNeedsFetchLocked(entityKey, now) {
		t.Fatal("did not expect entity to refresh when stale days is set to never")
	}
}

func TestMusicBrainzTagWorkerStateProgressSnapshot(t *testing.T) {
	state := musicBrainzTagWorkerState{
		pendingTrackPaths:      []string{"track-2.flac", "track-3.flac"},
		totalTrackPaths:        5,
		completedTrackPaths:    3,
		pendingEntityKeys:      map[string]struct{}{"artist:1": {}, "release:2": {}},
		totalEntityLookups:     4,
		completedEntityLookups: 2,
	}

	progress := state.progressSnapshot(true)
	if !progress.Enabled {
		t.Fatal("expected worker progress to be enabled")
	}
	if !progress.Active {
		t.Fatal("expected worker progress to be active")
	}
	if progress.PendingEntityLookups != 2 {
		t.Fatalf("pendingEntityLookups = %d, want %d", progress.PendingEntityLookups, 2)
	}
	if progress.PendingTrackScans != 2 {
		t.Fatalf("pendingTrackScans = %d, want %d", progress.PendingTrackScans, 2)
	}
	if progress.Progress != (5.0 / 9.0) {
		t.Fatalf("progress = %.6f, want %.6f", progress.Progress, 5.0/9.0)
	}
}

func TestMusicBrainzTagWorkerStateProgressSnapshotDisabled(t *testing.T) {
	progress := (musicBrainzTagWorkerState{}).progressSnapshot(false)
	if progress.Enabled {
		t.Fatal("did not expect disabled worker progress to be enabled")
	}
	if progress.Active {
		t.Fatal("did not expect disabled worker progress to be active")
	}
	if progress.Progress != 0 {
		t.Fatalf("progress = %.2f, want 0", progress.Progress)
	}
}

func indexedTrackForTest(rootPath string, path string) LibraryIndexedFile {
	relativePath, err := filepath.Rel(rootPath, path)
	if err != nil {
		panic(err)
	}

	folderPath := filepath.Dir(relativePath)
	rootName := filepath.Base(rootPath)
	normalizedFolderPath := rootName
	if folderPath != "." {
		normalizedFolderPath = filepath.ToSlash(filepath.Join(rootName, folderPath))
	}

	return LibraryIndexedFile{
		Name:         filepath.Base(path),
		Path:         normalizePath(path),
		RelativePath: filepath.ToSlash(relativePath),
		FolderPath:   normalizedFolderPath,
		RootPath:     normalizePath(rootPath),
		RootName:     rootName,
	}
}

func newMusicBrainzTagWorkerStateTestApp(rootPath string, indexedTracks ...LibraryIndexedFile) *App {
	trackByPath := make(map[string]LibraryIndexedFile, len(indexedTracks))
	for _, indexed := range indexedTracks {
		trackByPath[indexed.Path] = indexed
	}

	app := &App{
		settings: AppSettings{
			LibraryFolders: []AppLibraryFolder{{
				Path:         rootPath,
				ReleaseDepth: 2,
			}},
			MusicBrainzTagDatabaseEnabled: true,
		},
		settingsLoaded:            true,
		trackByPath:               trackByPath,
		musicBrainzTagStore:       newMusicBrainzTagDatabaseStore(),
		musicBrainzTagStoreLoaded: true,
	}
	app.rebuildMusicBrainzTagIndexesLocked()
	return app
}

func TestBuildMusicBrainzTagWorkerStateScansOneRepresentativeTrackPerRelease(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondTrack := filepath.Join(fixture.albumOneFolder, "02 Song.flac")
	writeTestFile(t, secondTrack, "track two")

	firstIndexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	secondIndexed := indexedTrackForTest(fixture.rootOne, secondTrack)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, firstIndexed, secondIndexed)

	state := app.buildMusicBrainzTagWorkerState(1)
	if len(state.pendingTrackPaths) != 1 {
		t.Fatalf("pendingTrackPaths = %#v, want one representative path", state.pendingTrackPaths)
	}
	if state.pendingTrackPaths[0] != firstIndexed.Path {
		t.Fatalf("representative path = %q, want %q", state.pendingTrackPaths[0], firstIndexed.Path)
	}
	if state.totalTrackPaths != 1 {
		t.Fatalf("totalTrackPaths = %d, want 1", state.totalTrackPaths)
	}
	if state.completedTrackPaths != 0 {
		t.Fatalf("completedTrackPaths = %d, want 0", state.completedTrackPaths)
	}
}

func TestBuildMusicBrainzTagWorkerStateReusesReleaseRecordWhenRepresentativePathChanges(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	replacementTrack := filepath.Join(fixture.albumOneFolder, "02 Song.flac")
	writeTestFile(t, replacementTrack, "replacement track")

	replacementIndexed := indexedTrackForTest(fixture.rootOne, replacementTrack)
	releaseFolderPath := releaseFolderPathForIndexedTrack(replacementIndexed, 2)
	artistFolderPaths := artistFolderPathsForIndexedTrack(replacementIndexed, 2)
	replacementSignature, ok := trackTagsFileSignatureForPath(replacementTrack)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) failed", replacementTrack)
	}

	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, replacementIndexed)
	app.musicBrainzTagStore.Tracks[normalizePath(fixture.trackOne)] = musicBrainzTagTrackRecord{
		Signature: trackTagsFileSignature{
			Size:      1,
			ModUnixNs: 2,
		},
		ReleaseID:         releaseMBID,
		ArtistIDs:         []string{artistMBID},
		ReleaseFolderPath: releaseFolderPath,
		ArtistFolderPaths: artistFolderPaths,
		LastScannedAt:     time.Now().Add(-time.Hour),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", artistMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		LastFetchedAt: time.Now().Add(-time.Hour),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseMBID,
		LastFetchedAt: time.Now().Add(-time.Hour),
	}
	app.rebuildMusicBrainzTagIndexesLocked()

	state := app.buildMusicBrainzTagWorkerState(1)
	if len(state.pendingTrackPaths) != 0 {
		t.Fatalf("pendingTrackPaths = %#v, want no rescan", state.pendingTrackPaths)
	}
	if state.totalTrackPaths != 1 {
		t.Fatalf("totalTrackPaths = %d, want 1", state.totalTrackPaths)
	}
	if state.completedTrackPaths != 1 {
		t.Fatalf("completedTrackPaths = %d, want 1", state.completedTrackPaths)
	}
	if len(state.pendingEntityKeys) != 0 {
		t.Fatalf("pendingEntityKeys = %#v, want none", state.pendingEntityKeys)
	}
	if state.totalEntityLookups != 2 {
		t.Fatalf("totalEntityLookups = %d, want 2", state.totalEntityLookups)
	}
	if state.completedEntityLookups != 2 {
		t.Fatalf("completedEntityLookups = %d, want 2", state.completedEntityLookups)
	}

	if _, exists := app.musicBrainzTagStore.Tracks[normalizePath(fixture.trackOne)]; exists {
		t.Fatal("did not expect stale representative path to remain in the store")
	}

	record, exists := app.musicBrainzTagStore.Tracks[replacementIndexed.Path]
	if !exists {
		t.Fatalf("expected representative record at %q", replacementIndexed.Path)
	}
	if record.Signature != replacementSignature {
		t.Fatalf("representative signature = %#v, want %#v", record.Signature, replacementSignature)
	}
	if record.ReleaseID != releaseMBID {
		t.Fatalf("representative release ID = %q, want %q", record.ReleaseID, releaseMBID)
	}
	if !stringSlicesEqual(record.ArtistIDs, []string{artistMBID}) {
		t.Fatalf("representative artist IDs = %#v, want %#v", record.ArtistIDs, []string{artistMBID})
	}
}

func TestBuildMusicBrainzTagWorkerStateCountsAlreadySatisfiedWork(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	releaseFolderPath := releaseFolderPathForIndexedTrack(indexed, 2)
	artistFolderPaths := artistFolderPathsForIndexedTrack(indexed, 2)
	signature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) failed", fixture.trackOne)
	}

	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"
	staleFetchedAt := time.Now().Add(-31 * 24 * time.Hour)
	freshFetchedAt := time.Now().Add(-time.Hour)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	app.musicBrainzTagStore.Tracks[indexed.Path] = musicBrainzTagTrackRecord{
		Signature:         signature,
		ReleaseID:         releaseMBID,
		ArtistIDs:         []string{artistMBID},
		ReleaseFolderPath: releaseFolderPath,
		ArtistFolderPaths: artistFolderPaths,
		LastScannedAt:     time.Now().Add(-time.Hour),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", artistMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: freshFetchedAt,
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: staleFetchedAt,
	}
	app.rebuildMusicBrainzTagIndexesLocked()

	state := app.buildMusicBrainzTagWorkerState(1)
	if state.totalTrackPaths != 1 {
		t.Fatalf("totalTrackPaths = %d, want 1", state.totalTrackPaths)
	}
	if state.completedTrackPaths != 1 {
		t.Fatalf("completedTrackPaths = %d, want 1", state.completedTrackPaths)
	}
	if state.totalEntityLookups != 2 {
		t.Fatalf("totalEntityLookups = %d, want 2", state.totalEntityLookups)
	}
	if state.completedEntityLookups != 1 {
		t.Fatalf("completedEntityLookups = %d, want 1", state.completedEntityLookups)
	}
	if len(state.pendingEntityKeys) != 1 {
		t.Fatalf("pendingEntityKeys = %#v, want one pending entity", state.pendingEntityKeys)
	}
	progress := state.progressSnapshot(true)
	if progress.Progress != (2.0 / 3.0) {
		t.Fatalf("progress = %.6f, want %.6f", progress.Progress, 2.0/3.0)
	}
}

func TestBuildMusicBrainzTagWorkerStateStaggersSuccessfulRefetches(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondAlbumFolder := filepath.Join(fixture.rootOne, "Artist Two", "Album Two")
	thirdAlbumFolder := filepath.Join(fixture.rootOne, "Artist Three", "Album Three")
	if err := os.MkdirAll(secondAlbumFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", secondAlbumFolder, err)
	}
	if err := os.MkdirAll(thirdAlbumFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", thirdAlbumFolder, err)
	}

	secondTrack := filepath.Join(secondAlbumFolder, "01 Second.flac")
	thirdTrack := filepath.Join(thirdAlbumFolder, "01 Third.flac")
	writeTestFile(t, secondTrack, "second")
	writeTestFile(t, thirdTrack, "third")

	indexedTracks := []LibraryIndexedFile{
		indexedTrackForTest(fixture.rootOne, fixture.trackOne),
		indexedTrackForTest(fixture.rootOne, secondTrack),
		indexedTrackForTest(fixture.rootOne, thirdTrack),
	}
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexedTracks...)
	app.settings.MusicBrainzTagStaleDays = intPointer(30)
	app.settings.MusicBrainzTagRequestStaggeringEnabled = true

	releaseIDs := []string{
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
	}
	lastFetchedAt := []time.Time{
		time.Date(2026, time.April, 1, 8, 0, 0, 0, time.UTC),
		time.Date(2026, time.April, 2, 8, 0, 0, 0, time.UTC),
		time.Date(2026, time.April, 3, 8, 0, 0, 0, time.UTC),
	}

	for index, indexed := range indexedTracks {
		signature, ok := trackTagsFileSignatureForPath(indexed.Path)
		if !ok {
			t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
		}

		app.musicBrainzTagStore.Tracks[indexed.Path] = musicBrainzTagTrackRecord{
			Signature:         signature,
			ReleaseID:         releaseIDs[index],
			ReleaseFolderPath: releaseFolderPathForIndexedTrack(indexed, 2),
			LastScannedAt:     time.Now().Add(-time.Hour),
		}
		app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseIDs[index])] = musicBrainzTagEntityRecord{
			EntityType:    "release",
			MBID:          releaseIDs[index],
			Tags:          []string{"rock"},
			LastFetchedAt: lastFetchedAt[index],
			LastAttemptAt: lastFetchedAt[index],
		}
	}
	app.rebuildMusicBrainzTagIndexesLocked()

	state := app.buildMusicBrainzTagWorkerState(1)
	if len(state.pendingTrackPaths) != 0 {
		t.Fatalf("pendingTrackPaths = %#v, want none", state.pendingTrackPaths)
	}
	if state.totalEntityLookups != 3 {
		t.Fatalf("totalEntityLookups = %d, want 3", state.totalEntityLookups)
	}
	if len(state.pendingEntityKeys) != 1 {
		t.Fatalf("pendingEntityKeys = %#v, want one staggered refresh", state.pendingEntityKeys)
	}

	oldestEntityKey := musicBrainzTagEntityKey("release", releaseIDs[0])
	if _, exists := state.pendingEntityKeys[oldestEntityKey]; !exists {
		t.Fatalf("pendingEntityKeys = %#v, want %q", state.pendingEntityKeys, oldestEntityKey)
	}
	if len(state.pendingEntityOrder) != 1 || state.pendingEntityOrder[0] != oldestEntityKey {
		t.Fatalf("pendingEntityOrder = %#v, want [%q]", state.pendingEntityOrder, oldestEntityKey)
	}
	if state.completedEntityLookups != 2 {
		t.Fatalf("completedEntityLookups = %d, want 2", state.completedEntityLookups)
	}
}

func TestBuildMusicBrainzTagWorkerStateDoesNotQueueAnotherStaggeredBatchSameDay(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondAlbumFolder := filepath.Join(fixture.rootOne, "Artist Two", "Album Two")
	thirdAlbumFolder := filepath.Join(fixture.rootOne, "Artist Three", "Album Three")
	if err := os.MkdirAll(secondAlbumFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", secondAlbumFolder, err)
	}
	if err := os.MkdirAll(thirdAlbumFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", thirdAlbumFolder, err)
	}

	secondTrack := filepath.Join(secondAlbumFolder, "01 Second.flac")
	thirdTrack := filepath.Join(thirdAlbumFolder, "01 Third.flac")
	writeTestFile(t, secondTrack, "second")
	writeTestFile(t, thirdTrack, "third")

	indexedTracks := []LibraryIndexedFile{
		indexedTrackForTest(fixture.rootOne, fixture.trackOne),
		indexedTrackForTest(fixture.rootOne, secondTrack),
		indexedTrackForTest(fixture.rootOne, thirdTrack),
	}
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexedTracks...)
	app.settings.MusicBrainzTagStaleDays = intPointer(30)
	app.settings.MusicBrainzTagRequestStaggeringEnabled = true

	releaseIDs := []string{
		"11111111-1111-4111-8111-111111111111",
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
	}
	currentTime := time.Now()
	lastFetchedAt := []time.Time{
		currentTime,
		time.Date(2026, time.April, 2, 8, 0, 0, 0, time.UTC),
		time.Date(2026, time.April, 3, 8, 0, 0, 0, time.UTC),
	}

	for index, indexed := range indexedTracks {
		signature, ok := trackTagsFileSignatureForPath(indexed.Path)
		if !ok {
			t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
		}

		app.musicBrainzTagStore.Tracks[indexed.Path] = musicBrainzTagTrackRecord{
			Signature:         signature,
			ReleaseID:         releaseIDs[index],
			ReleaseFolderPath: releaseFolderPathForIndexedTrack(indexed, 2),
			LastScannedAt:     currentTime.Add(-time.Hour),
		}
		app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseIDs[index])] = musicBrainzTagEntityRecord{
			EntityType:    "release",
			MBID:          releaseIDs[index],
			Tags:          []string{"rock"},
			LastFetchedAt: lastFetchedAt[index],
			LastAttemptAt: lastFetchedAt[index],
		}
	}
	app.rebuildMusicBrainzTagIndexesLocked()

	state := app.buildMusicBrainzTagWorkerState(1)
	if len(state.pendingEntityKeys) != 0 {
		t.Fatalf("pendingEntityKeys = %#v, want none because today's staggered budget is already used", state.pendingEntityKeys)
	}
	if state.completedEntityLookups != 3 {
		t.Fatalf("completedEntityLookups = %d, want 3", state.completedEntityLookups)
	}
}

func TestMusicBrainzTagDatabaseSQLiteRoundTrip(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "silphium.musicbrainz.tags.sqlite3")
	trackPath := filepath.Join("C:\\Music", "Artist", "Album", "track.flac")
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"
	labelMBID := "33333333-3333-4333-8333-333333333333"
	store := newMusicBrainzTagDatabaseStore()
	store.Tracks[trackPath] = musicBrainzTagTrackRecord{
		Signature: trackTagsFileSignature{
			Size:      1234,
			ModUnixNs: 5678,
		},
		ReleaseID:         releaseMBID,
		ArtistIDs:         []string{artistMBID},
		ReleaseFolderPath: "Library/Artist/Album",
		ArtistFolderPaths: []string{"Library/Artist"},
		LastScannedAt:     time.Unix(0, 9012),
	}
	store.Entities[musicBrainzTagEntityKey("artist", artistMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Title:         "Artist",
		LastFetchedAt: time.Unix(0, 1111),
		LastAttemptAt: time.Unix(0, 2222),
	}
	store.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseMBID,
		Title:         "Album",
		Tags:          []string{"rock", "visual kei"},
		LastFetchedAt: time.Unix(0, 3333),
		LastAttemptAt: time.Unix(0, 4444),
	}
	store.Entities[musicBrainzTagEntityKey("label", labelMBID)] = musicBrainzTagEntityRecord{
		EntityType: "label",
		MBID:       labelMBID,
		Title:      "Should not round-trip",
	}

	if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err != nil {
		t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite() error = %v", err)
	}

	loadedStore := loadMusicBrainzTagDatabaseStore(databasePath)

	loadedTrack, exists := loadedStore.Tracks[trackPath]
	if !exists {
		t.Fatalf("expected track %q to round-trip", trackPath)
	}
	if loadedTrack.Signature != store.Tracks[trackPath].Signature {
		t.Fatalf("track signature = %#v, want %#v", loadedTrack.Signature, store.Tracks[trackPath].Signature)
	}
	if loadedTrack.ReleaseID != releaseMBID {
		t.Fatalf("track release ID = %q, want %q", loadedTrack.ReleaseID, releaseMBID)
	}
	if !stringSlicesEqual(loadedTrack.ArtistIDs, []string{artistMBID}) {
		t.Fatalf("track artist IDs = %#v, want %#v", loadedTrack.ArtistIDs, []string{artistMBID})
	}
	if !stringSlicesEqual(loadedTrack.ArtistFolderPaths, []string{"Library/Artist"}) {
		t.Fatalf("track artist folder paths = %#v, want %#v", loadedTrack.ArtistFolderPaths, []string{"Library/Artist"})
	}

	loadedArtist, exists := loadedStore.Entities[musicBrainzTagEntityKey("artist", artistMBID)]
	if !exists {
		t.Fatal("expected artist entity to round-trip")
	}
	if len(loadedArtist.Tags) != 0 {
		t.Fatalf("expected empty-tag artist to remain stored without tags, got %#v", loadedArtist.Tags)
	}

	loadedRelease, exists := loadedStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)]
	if !exists {
		t.Fatal("expected release entity to round-trip")
	}
	if !stringSlicesEqual(loadedRelease.Tags, []string{"rock", "visual kei"}) {
		t.Fatalf("release tags = %#v, want %#v", loadedRelease.Tags, []string{"rock", "visual kei"})
	}

	if _, exists := loadedStore.Entities[musicBrainzTagEntityKey("label", labelMBID)]; exists {
		t.Fatal("did not expect unsupported label entity to round-trip into the tag database")
	}
}

func TestMusicBrainzTagDatabaseSQLiteUsesWALJournalMode(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "silphium.musicbrainz.tags.sqlite3")
	database, err := openMusicBrainzTagSQLite(databasePath)
	if err != nil {
		t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		t.Fatalf("initializeMusicBrainzTagSQLite() error = %v", err)
	}

	var journalMode string
	if err := database.QueryRow(`PRAGMA journal_mode`).Scan(&journalMode); err != nil {
		t.Fatalf("PRAGMA journal_mode query error = %v", err)
	}
	if journalMode != "wal" {
		t.Fatalf("journal mode = %q, want %q", journalMode, "wal")
	}

	var synchronousMode int
	if err := database.QueryRow(`PRAGMA synchronous`).Scan(&synchronousMode); err != nil {
		t.Fatalf("PRAGMA synchronous query error = %v", err)
	}
	if synchronousMode != 1 {
		t.Fatalf("synchronous mode = %d, want %d (NORMAL)", synchronousMode, 1)
	}
}

func TestMusicBrainzTagDatabaseSQLiteDeltaWrite(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "silphium.musicbrainz.tags.sqlite3")
	trackOnePath := filepath.Join("C:\\Music", "Artist A", "Album A", "track1.flac")
	trackTwoPath := filepath.Join("C:\\Music", "Artist B", "Album B", "track2.flac")
	trackThreePath := filepath.Join("C:\\Music", "Artist C", "Album C", "track3.flac")
	artistAMBID := "11111111-1111-4111-8111-111111111111"
	releaseAMBID := "22222222-2222-4222-8222-222222222222"
	artistBMBID := "33333333-3333-4333-8333-333333333333"
	releaseBMBID := "44444444-4444-4444-8444-444444444444"
	artistCMBID := "55555555-5555-4555-8555-555555555555"
	releaseCMBID := "66666666-6666-4666-8666-666666666666"

	initialStore := newMusicBrainzTagDatabaseStore()
	initialStore.Tracks[trackOnePath] = musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 100, ModUnixNs: 1000},
		ReleaseID:         releaseAMBID,
		ArtistIDs:         []string{artistAMBID},
		ReleaseFolderPath: "Library/Artist A/Album A",
		ArtistFolderPaths: []string{"Library/Artist A"},
		LastScannedAt:     time.Unix(0, 10000),
	}
	initialStore.Tracks[trackTwoPath] = musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 200, ModUnixNs: 2000},
		ReleaseID:         releaseBMBID,
		ArtistIDs:         []string{artistBMBID},
		ReleaseFolderPath: "Library/Artist B/Album B",
		ArtistFolderPaths: []string{"Library/Artist B"},
		LastScannedAt:     time.Unix(0, 20000),
	}
	initialStore.Entities[musicBrainzTagEntityKey("artist", artistAMBID)] = musicBrainzTagEntityRecord{
		EntityType: "artist",
		MBID:       artistAMBID,
		Title:      "Artist A",
	}
	initialStore.Entities[musicBrainzTagEntityKey("release", releaseAMBID)] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseAMBID,
		Title:      "Album A",
		Tags:       []string{"rock"},
	}
	initialStore.Entities[musicBrainzTagEntityKey("artist", artistBMBID)] = musicBrainzTagEntityRecord{
		EntityType: "artist",
		MBID:       artistBMBID,
		Title:      "Artist B",
	}
	initialStore.Entities[musicBrainzTagEntityKey("release", releaseBMBID)] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseBMBID,
		Title:      "Album B",
		Tags:       []string{"jazz"},
	}

	if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, initialStore); err != nil {
		t.Fatalf("initial writeMusicBrainzTagDatabaseStoreToSQLite() error = %v", err)
	}

	updatedStore := newMusicBrainzTagDatabaseStore()
	updatedStore.Tracks[trackOnePath] = musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 101, ModUnixNs: 3000},
		ReleaseID:         releaseAMBID,
		ArtistIDs:         []string{artistAMBID},
		ReleaseFolderPath: "Library/Artist A/Album A (Deluxe)",
		ArtistFolderPaths: []string{"Library/Artist A"},
		LastScannedAt:     time.Unix(0, 30000),
	}
	updatedStore.Tracks[trackThreePath] = musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 300, ModUnixNs: 4000},
		ReleaseID:         releaseCMBID,
		ArtistIDs:         []string{artistCMBID},
		ReleaseFolderPath: "Library/Artist C/Album C",
		ArtistFolderPaths: []string{"Library/Artist C"},
		LastScannedAt:     time.Unix(0, 40000),
	}
	updatedStore.Entities[musicBrainzTagEntityKey("artist", artistAMBID)] = musicBrainzTagEntityRecord{
		EntityType: "artist",
		MBID:       artistAMBID,
		Title:      "Artist A",
	}
	updatedStore.Entities[musicBrainzTagEntityKey("release", releaseAMBID)] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseAMBID,
		Title:      "Album A Deluxe",
		Tags:       []string{"rock", "shoegaze"},
	}
	updatedStore.Entities[musicBrainzTagEntityKey("artist", artistCMBID)] = musicBrainzTagEntityRecord{
		EntityType: "artist",
		MBID:       artistCMBID,
		Title:      "Artist C",
	}
	updatedStore.Entities[musicBrainzTagEntityKey("release", releaseCMBID)] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseCMBID,
		Title:      "Album C",
	}

	if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, updatedStore); err != nil {
		t.Fatalf("updated writeMusicBrainzTagDatabaseStoreToSQLite() error = %v", err)
	}

	loadedStore := loadMusicBrainzTagDatabaseStore(databasePath)

	if len(loadedStore.Tracks) != 2 {
		t.Fatalf("track count after delta write = %d, want %d", len(loadedStore.Tracks), 2)
	}
	if _, exists := loadedStore.Tracks[trackTwoPath]; exists {
		t.Fatal("expected removed track to be deleted by delta write")
	}
	loadedTrackOne, exists := loadedStore.Tracks[trackOnePath]
	if !exists {
		t.Fatal("expected updated track one to exist")
	}
	if loadedTrackOne.ReleaseFolderPath != "Library/Artist A/Album A (Deluxe)" {
		t.Fatalf("updated track release folder path = %q, want %q", loadedTrackOne.ReleaseFolderPath, "Library/Artist A/Album A (Deluxe)")
	}
	if _, exists := loadedStore.Tracks[trackThreePath]; !exists {
		t.Fatal("expected inserted track three to exist")
	}

	if len(loadedStore.Entities) != 4 {
		t.Fatalf("entity count after delta write = %d, want %d", len(loadedStore.Entities), 4)
	}
	if _, exists := loadedStore.Entities[musicBrainzTagEntityKey("artist", artistBMBID)]; exists {
		t.Fatal("expected removed artist entity to be deleted by delta write")
	}
	if _, exists := loadedStore.Entities[musicBrainzTagEntityKey("release", releaseBMBID)]; exists {
		t.Fatal("expected removed release entity to be deleted by delta write")
	}
	loadedReleaseA, exists := loadedStore.Entities[musicBrainzTagEntityKey("release", releaseAMBID)]
	if !exists {
		t.Fatal("expected updated release A entity to exist")
	}
	if loadedReleaseA.Title != "Album A Deluxe" {
		t.Fatalf("updated release title = %q, want %q", loadedReleaseA.Title, "Album A Deluxe")
	}
	if !stringSlicesEqual(loadedReleaseA.Tags, []string{"rock", "shoegaze"}) {
		t.Fatalf("updated release tags = %#v, want %#v", loadedReleaseA.Tags, []string{"rock", "shoegaze"})
	}
	if _, exists := loadedStore.Entities[musicBrainzTagEntityKey("release", releaseCMBID)]; !exists {
		t.Fatal("expected inserted release C entity to exist")
	}
}
