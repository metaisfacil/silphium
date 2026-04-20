package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
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
			name:      "quoted comma stays inside tag",
			query:     `mbtag:"rock, pop",metal`,
			wantTags:  []string{"metal", "rock, pop"},
			wantMatch: true,
		},
		{
			name:      "empty segments are skipped",
			query:     "mbtag:rock, , ,shoegaze,,",
			wantTags:  []string{"rock", "shoegaze"},
			wantMatch: true,
		},
		{
			name:      "empty tag expression",
			query:     "mbtag:   ",
			wantTags:  []string{},
			wantMatch: true,
		},
		{
			name:      "deduplicated quoted tags",
			query:     `MBTAG: rock, "Visual   Kei", "quote ""test""", rock`,
			wantTags:  []string{`quote "test"`, "rock", "visual kei"},
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

func TestMusicBrainzTagSQLiteOpenConfigureAndInitializeErrors(t *testing.T) {
	blockedPath := filepath.Join(t.TempDir(), "blocked")
	writeTestFile(t, blockedPath, "blocker")
	if _, err := openMusicBrainzTagSQLite(filepath.Join(blockedPath, musicBrainzTagDatabaseFileName)); err == nil {
		t.Fatal("openMusicBrainzTagSQLite(blocked parent) error = nil, want error")
	}

	database, err := sql.Open(musicBrainzTagSQLiteDriverName, ":memory:")
	if err != nil {
		t.Fatalf("sql.Open(:memory:) error = %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("Close(:memory:) error = %v", err)
	}
	if err := configureMusicBrainzTagSQLite(database); err == nil {
		t.Fatal("configureMusicBrainzTagSQLite(closed db) error = nil, want error")
	}
	if err := initializeMusicBrainzTagSQLite(database); err == nil {
		t.Fatal("initializeMusicBrainzTagSQLite(closed db) error = nil, want error")
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
	app := newMusicBrainzTagDatabaseTestApp()

	app.upsertMusicBrainzTagEntityRecordLocked(musicBrainzTagEntityRecord{
		EntityType: "artist",
		Title:      "Missing ID",
	})

	if len(app.musicBrainzTagStore.Entities) != 0 {
		t.Fatalf("expected no entities to be stored without an MBID, got %#v", app.musicBrainzTagStore.Entities)
	}
}

func TestMusicBrainzTagIndexGuardBranches(t *testing.T) {
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"

	pathIndex := map[string]map[string]struct{}{}
	addMusicBrainzTagPathIndexEntry(pathIndex, " ", "Library/Artist")
	removeMusicBrainzTagPathIndexEntry(pathIndex, " ", "Library/Artist")
	removeMusicBrainzTagPathIndexEntry(pathIndex, "artist", "Library/Artist")
	if len(pathIndex) != 0 {
		t.Fatalf("path index guards left entries behind: %#v", pathIndex)
	}

	entityIndex := map[string]map[string]struct{}{}
	addMusicBrainzTagEntityIndexEntry(entityIndex, " ", "artist:"+artistMBID)
	removeMusicBrainzTagEntityIndexEntry(entityIndex, " ", "artist:"+artistMBID)
	removeMusicBrainzTagEntityIndexEntry(entityIndex, "rock", "artist:"+artistMBID)
	if len(entityIndex) != 0 {
		t.Fatalf("entity index guards left entries behind: %#v", entityIndex)
	}

	app := newMusicBrainzTagDatabaseTestApp()
	app.musicBrainzTagEntityKeysByTag = map[string]map[string]struct{}{}
	app.musicBrainzTagReleaseFoldersByID = map[string]map[string]struct{}{}
	app.musicBrainzTagReleaseFoldersByArtistID = map[string]map[string]struct{}{}
	app.musicBrainzTagArtistFoldersByID = map[string]map[string]struct{}{}

	app.addMusicBrainzTagEntityIndexesLocked(musicBrainzTagEntityRecord{EntityType: "artist"})
	app.removeMusicBrainzTagEntityIndexesLocked(musicBrainzTagEntityRecord{EntityType: "artist"})
	if len(app.musicBrainzTagEntityKeysByTag) != 0 {
		t.Fatalf("entity index guard helpers should keep indexes empty, got %#v", app.musicBrainzTagEntityKeysByTag)
	}

	app.musicBrainzTagStoreDirty = false
	app.upsertMusicBrainzTagTrackRecordLocked(" ", musicBrainzTagTrackRecord{ReleaseID: releaseMBID})
	if len(app.musicBrainzTagStore.Tracks) != 0 || app.musicBrainzTagStoreDirty {
		t.Fatalf("upsertMusicBrainzTagTrackRecordLocked(blank path) mutated state: %#v dirty=%t", app.musicBrainzTagStore.Tracks, app.musicBrainzTagStoreDirty)
	}
	app.removeMusicBrainzTagTrackRecordLocked(" ")
	app.removeMusicBrainzTagTrackRecordLocked("missing.flac")
	if app.musicBrainzTagStoreDirty {
		t.Fatal("removeMusicBrainzTagTrackRecordLocked(guard paths) should not dirty the store")
	}

	app.musicBrainzTagStoreDirty = false
	app.removeMusicBrainzTagEntityRecordLocked(" ")
	app.removeMusicBrainzTagEntityRecordLocked("artist:" + artistMBID)
	if app.musicBrainzTagStoreDirty {
		t.Fatal("removeMusicBrainzTagEntityRecordLocked(guard keys) should not dirty the store")
	}

	entityKey := musicBrainzTagEntityKey("artist", artistMBID)
	app.upsertMusicBrainzTagEntityRecordLocked(musicBrainzTagEntityRecord{
		EntityType: "artist",
		MBID:       artistMBID,
		Title:      "Artist",
		Tags:       []string{"rock"},
	})
	app.musicBrainzTagStoreDirty = false
	app.upsertMusicBrainzTagEntityRecordLocked(musicBrainzTagEntityRecord{
		EntityType: "artist",
		MBID:       artistMBID,
		Title:      "Artist",
		Tags:       []string{"jazz"},
	})
	if _, exists := app.musicBrainzTagEntityKeysByTag["rock"]; exists {
		t.Fatalf("upsertMusicBrainzTagEntityRecordLocked(replace) left stale rock index: %#v", app.musicBrainzTagEntityKeysByTag)
	}
	if _, exists := app.musicBrainzTagEntityKeysByTag["jazz"][entityKey]; !exists {
		t.Fatalf("upsertMusicBrainzTagEntityRecordLocked(replace) missing jazz index: %#v", app.musicBrainzTagEntityKeysByTag)
	}
	if !app.musicBrainzTagStoreDirty {
		t.Fatal("upsertMusicBrainzTagEntityRecordLocked(replace) should dirty the store")
	}

	app.musicBrainzTagStoreLoaded = true
	app.musicBrainzTagStore.Tracks["sentinel.flac"] = musicBrainzTagTrackRecord{}
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	if _, exists := app.musicBrainzTagStore.Tracks["sentinel.flac"]; !exists {
		t.Fatal("ensureMusicBrainzTagDatabaseLoadedLocked(already loaded) should leave the in-memory store untouched")
	}
}

func TestMusicBrainzTagEntityNeedsFetchLockedUsesConfiguredStaleDays(t *testing.T) {
	now := time.Date(2026, time.April, 5, 12, 0, 0, 0, time.UTC)
	artistMBID := "11111111-1111-4111-8111-111111111111"
	entityKey := musicBrainzTagEntityKey("artist", artistMBID)
	app := newMusicBrainzTagDatabaseTestApp()
	app.settings = AppSettings{
		MusicBrainzTagStaleDays: intPointer(10),
	}
	app.settingsLoaded = true

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
		inFlightTrackScans:     1,
		totalTrackPaths:        5,
		completedTrackPaths:    3,
		pendingEntityKeys:      map[string]struct{}{"artist:1": {}, "release:2": {}},
		inFlightEntityLookups:  1,
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
	if progress.PendingEntityLookups != 3 {
		t.Fatalf("pendingEntityLookups = %d, want %d", progress.PendingEntityLookups, 3)
	}
	if progress.PendingTrackScans != 3 {
		t.Fatalf("pendingTrackScans = %d, want %d", progress.PendingTrackScans, 3)
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

func TestMusicBrainzTagDatabaseHelperFunctions(t *testing.T) {
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"

	if got := clampMusicBrainzTagWorkerProgress(-0.25); got != 0 {
		t.Fatalf("clampMusicBrainzTagWorkerProgress(-0.25) = %f, want 0", got)
	}
	if got := clampMusicBrainzTagWorkerProgress(1.25); got != 1 {
		t.Fatalf("clampMusicBrainzTagWorkerProgress(1.25) = %f, want 1", got)
	}
	if got := musicBrainzTagEntityRefreshInterval(0); got != 0 {
		t.Fatalf("musicBrainzTagEntityRefreshInterval(0) = %v, want 0", got)
	}
	if got := musicBrainzTagEntityRefreshInterval(3); got != 72*time.Hour {
		t.Fatalf("musicBrainzTagEntityRefreshInterval(3) = %v, want 72h", got)
	}
	if got := musicBrainzTagStaggeredRefreshCount(0, 7); got != 0 {
		t.Fatalf("musicBrainzTagStaggeredRefreshCount(0, 7) = %d, want 0", got)
	}
	if got := musicBrainzTagStaggeredRefreshCount(10, 3); got != 4 {
		t.Fatalf("musicBrainzTagStaggeredRefreshCount(10, 3) = %d, want 4", got)
	}

	if !musicBrainzTagSameDay(
		time.Date(2024, time.January, 5, 9, 0, 0, 0, time.Local),
		time.Date(2024, time.January, 5, 23, 0, 0, 0, time.Local),
	) {
		t.Fatal("musicBrainzTagSameDay() = false, want true for same local day")
	}
	if musicBrainzTagSameDay(time.Time{}, time.Now()) {
		t.Fatal("musicBrainzTagSameDay(zero) = true, want false")
	}
	if musicBrainzTagSameDay(
		time.Date(2024, time.January, 5, 23, 0, 0, 0, time.Local),
		time.Date(2024, time.January, 6, 0, 1, 0, 0, time.Local),
	) {
		t.Fatal("musicBrainzTagSameDay(next day) = true, want false")
	}

	if got := normalizeMusicBrainzTagName("  Alt   Rock  "); got != "alt rock" {
		t.Fatalf("normalizeMusicBrainzTagName() = %q, want %q", got, "alt rock")
	}
	if got := normalizeMusicBrainzTagNames([]string{" Alt Rock ", "alt rock", "", "Shoegaze"}); !stringSlicesEqual(got, []string{"alt rock", "shoegaze"}) {
		t.Fatalf("normalizeMusicBrainzTagNames() = %#v, want normalized unique tags", got)
	}
	if got := normalizeMusicBrainzTagFolderPath(" Library/Artist/Album "); got != "Library/Artist/Album" {
		t.Fatalf("normalizeMusicBrainzTagFolderPath() = %q, want %q", got, "Library/Artist/Album")
	}
	if got := normalizeMusicBrainzTagFolderPath("../bad"); got != "" {
		t.Fatalf("normalizeMusicBrainzTagFolderPath(invalid) = %q, want empty", got)
	}
	if got := normalizeMusicBrainzTagFolderPaths([]string{"Library/Artist", "library/artist", "  ", "Library/Artist/Album/.."}); !stringSlicesEqual(got, []string{"Library/Artist"}) {
		t.Fatalf("normalizeMusicBrainzTagFolderPaths() = %#v, want one normalized folder", got)
	}
	if got := normalizeMusicBrainzArtistIDsForTags(strings.ToUpper(artistMBID), []string{" ", artistMBID, releaseMBID}); !stringSlicesEqual(got, []string{artistMBID, releaseMBID}) {
		t.Fatalf("normalizeMusicBrainzArtistIDsForTags() = %#v, want deduplicated MBIDs", got)
	}

	if !musicBrainzTagPathLessCaseInsensitive("Alpha", "beta") {
		t.Fatal("musicBrainzTagPathLessCaseInsensitive(Alpha, beta) = false, want true")
	}
	if musicBrainzTagPathLessCaseInsensitive("beta", "Alpha") {
		t.Fatal("musicBrainzTagPathLessCaseInsensitive(beta, Alpha) = true, want false")
	}
	if !musicBrainzTagPathLessCaseInsensitive("Alpha.flac", "alpha.flac") {
		t.Fatal("musicBrainzTagPathLessCaseInsensitive(Alpha.flac, alpha.flac) = false, want true")
	}
	if musicBrainzTagPathLessCaseInsensitive("alpha.flac", "Alpha.flac") {
		t.Fatal("musicBrainzTagPathLessCaseInsensitive(alpha.flac, Alpha.flac) = true, want false")
	}

	progress := (musicBrainzTagWorkerState{completedTrackPaths: -1, completedEntityLookups: -1}).progressSnapshot(true)
	if !progress.Enabled || progress.Progress != 1 {
		t.Fatalf("progressSnapshot(no work) = %#v, want enabled progress of 1", progress)
	}
}

func TestMusicBrainzTagDatabaseAdditionalEdgeCases(t *testing.T) {
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"

	progress := (musicBrainzTagWorkerState{
		pendingTrackPaths:      []string{"pending.flac"},
		totalTrackPaths:        1,
		completedTrackPaths:    5,
		totalEntityLookups:     1,
		completedEntityLookups: 5,
	}).progressSnapshot(true)
	if progress.CompletedTrackScans != 1 || progress.CompletedEntityLookups != 1 || progress.Progress != 1 {
		t.Fatalf("progressSnapshot(clamped) = %#v, want fully clamped progress", progress)
	}

	state := musicBrainzTagWorkerState{}
	state.notePendingEntityKey("")
	state.notePendingEntityKey(" artist:" + artistMBID + " ")
	state.notePendingEntityKey("artist:" + artistMBID)
	if state.totalEntityLookups != 1 || len(state.pendingEntityKeys) != 1 || len(state.pendingEntityOrder) != 1 {
		t.Fatalf("notePendingEntityKey() = %#v, want one queued entity", state)
	}
	if state.queueEntityKey("") {
		t.Fatal("queueEntityKey(empty) = true, want false")
	}
	staleState := musicBrainzTagWorkerState{
		pendingEntityKeys:  map[string]struct{}{"artist:" + artistMBID: {}},
		pendingEntityOrder: []string{"missing", "artist:" + artistMBID},
	}
	if entityKey, ok := staleState.popNextEntityKey(); !ok || entityKey != "artist:"+artistMBID {
		t.Fatalf("popNextEntityKey(stale prefix) = (%q, %t), want the first live entity key", entityKey, ok)
	}

	app := newMusicBrainzTagDatabaseTestApp()
	app.musicBrainzTagStore.Tracks["z.flac"] = musicBrainzTagTrackRecord{ReleaseFolderPath: "../bad"}
	app.musicBrainzTagStore.Tracks["b.flac"] = musicBrainzTagTrackRecord{ReleaseFolderPath: "Library/Artist/Album"}
	app.musicBrainzTagStore.Tracks["A.flac"] = musicBrainzTagTrackRecord{ReleaseFolderPath: "Library/Artist/Album"}
	recordsByReleaseFolder := app.storedMusicBrainzTagTrackRecordsByReleaseFolderLocked()
	if len(recordsByReleaseFolder) != 1 || recordsByReleaseFolder["Library/Artist/Album"].path != "A.flac" {
		t.Fatalf("storedMusicBrainzTagTrackRecordsByReleaseFolderLocked() = %#v, want the case-insensitive earliest path", recordsByReleaseFolder)
	}

	caseTieApp := newMusicBrainzTagDatabaseTestApp()
	caseTieApp.musicBrainzTagStore.Tracks["alpha.flac"] = musicBrainzTagTrackRecord{ReleaseFolderPath: "Library/Artist/Album"}
	caseTieApp.musicBrainzTagStore.Tracks["Alpha.flac"] = musicBrainzTagTrackRecord{ReleaseFolderPath: "Library/Artist/Album"}
	caseTieRecords := caseTieApp.storedMusicBrainzTagTrackRecordsByReleaseFolderLocked()
	if got := caseTieRecords["Library/Artist/Album"].path; got != "Alpha.flac" {
		t.Fatalf("storedMusicBrainzTagTrackRecordsByReleaseFolderLocked(case tie) = %q, want %q", got, "Alpha.flac")
	}

	if got := normalizeMusicBrainzTagNames([]string{" ", ""}); got != nil {
		t.Fatalf("normalizeMusicBrainzTagNames(all invalid) = %#v, want nil", got)
	}
	if got := normalizeMusicBrainzTagFolderPaths([]string{" ", "../bad"}); got != nil {
		t.Fatalf("normalizeMusicBrainzTagFolderPaths(all invalid) = %#v, want nil", got)
	}
	if got := normalizeMusicBrainzArtistIDsForTags(" ", []string{"bad"}); got != nil {
		t.Fatalf("normalizeMusicBrainzArtistIDsForTags(all invalid) = %#v, want nil", got)
	}
	if _, _, ok := parseMusicBrainzTagEntityKey("artist:bad"); ok {
		t.Fatal("parseMusicBrainzTagEntityKey(invalid mbid) = true, want false")
	}

	entityKeys := musicBrainzTagEntityKeysForTrackRecord(musicBrainzTagTrackRecord{
		ReleaseID:         releaseMBID,
		ArtistIDs:         []string{"bad", artistMBID, artistMBID},
		ReleaseFolderPath: "Library/Artist/Album",
		ArtistFolderPaths: []string{"Library/Artist"},
	})
	wantEntityKeys := []string{musicBrainzTagEntityKey("release", releaseMBID), musicBrainzTagEntityKey("artist", artistMBID)}
	if !stringSlicesEqual(entityKeys, wantEntityKeys) {
		t.Fatalf("musicBrainzTagEntityKeysForTrackRecord() = %#v, want %#v", entityKeys, wantEntityKeys)
	}
	if stringSlicesEqual([]string{"a"}, []string{"b"}) {
		t.Fatal("stringSlicesEqual(mismatched contents) = true, want false")
	}

	if got := releaseFolderPathForIndexedTrack(LibraryIndexedFile{FolderPath: "  ", RootName: ""}, 2); got != "" {
		t.Fatalf("releaseFolderPathForIndexedTrack(empty) = %q, want empty", got)
	}
	if got := releaseFolderPathForIndexedTrack(LibraryIndexedFile{FolderPath: "Artist/Album/Disc 1", RootName: ""}, 2); got != "Artist/Album" {
		t.Fatalf("releaseFolderPathForIndexedTrack(rootless) = %q, want %q", got, "Artist/Album")
	}
	if got := artistFolderPathsForIndexedTrack(LibraryIndexedFile{FolderPath: "  ", RootName: ""}, 2); got != nil {
		t.Fatalf("artistFolderPathsForIndexedTrack(empty) = %#v, want nil", got)
	}
	if got := artistFolderPathsForIndexedTrack(LibraryIndexedFile{FolderPath: "Artist/Album/Disc 1", RootName: ""}, 2); !stringSlicesEqual(got, []string{"Artist"}) {
		t.Fatalf("artistFolderPathsForIndexedTrack(rootless) = %#v, want %#v", got, []string{"Artist"})
	}
	if got := artistFolderPathsForIndexedTrack(LibraryIndexedFile{FolderPath: "Artist", RootName: ""}, 1); !stringSlicesEqual(got, []string{"Artist"}) {
		t.Fatalf("artistFolderPathsForIndexedTrack(shallow rootless) = %#v, want %#v", got, []string{"Artist"})
	}

	normalizedStore := normalizeMusicBrainzTagDatabaseStore(musicBrainzTagDatabaseStore{
		Tracks: map[string]musicBrainzTagTrackRecord{
			" ": {},
			"track.flac": {
				ReleaseID:         strings.ToUpper(releaseMBID),
				ArtistIDs:         []string{"bad", artistMBID},
				ReleaseFolderPath: " Library/Artist/Album ",
				ArtistFolderPaths: []string{"Library/Artist", "../bad"},
			},
		},
		Entities: map[string]musicBrainzTagEntityRecord{
			"release": {
				EntityType: "release",
				MBID:       strings.ToUpper(releaseMBID),
				Title:      " Album ",
				Tags:       []string{" Rock "},
			},
			"label": {
				EntityType: "label",
				MBID:       "33333333-3333-4333-8333-333333333333",
				Title:      "Ignored",
			},
		},
	})
	if len(normalizedStore.Tracks) != 1 {
		t.Fatalf("normalizeMusicBrainzTagDatabaseStore().Tracks = %#v, want one normalized track", normalizedStore.Tracks)
	}
	normalizedTrack := normalizedStore.Tracks["track.flac"]
	if normalizedTrack.ReleaseID != releaseMBID || !stringSlicesEqual(normalizedTrack.ArtistIDs, []string{artistMBID}) || !stringSlicesEqual(normalizedTrack.ArtistFolderPaths, []string{"Library/Artist"}) {
		t.Fatalf("normalized track = %#v, want sanitized ids and folders", normalizedTrack)
	}
	if len(normalizedStore.Entities) != 1 {
		t.Fatalf("normalizeMusicBrainzTagDatabaseStore().Entities = %#v, want one normalized release entity", normalizedStore.Entities)
	}
	normalizedEntity := normalizedStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)]
	if normalizedEntity.Title != "Album" || !stringSlicesEqual(normalizedEntity.Tags, []string{"rock"}) {
		t.Fatalf("normalized entity = %#v, want trimmed title and normalized tags", normalizedEntity)
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

	app := newTestAppWithLoadedSettings(AppSettings{
		LibraryFolders: []AppLibraryFolder{{
			Path:         rootPath,
			ReleaseDepth: 2,
		}},
		MusicBrainzTagDatabaseEnabled: true,
	})
	app.trackByPath = trackByPath
	app.musicBrainzTagStore = newMusicBrainzTagDatabaseStore()
	app.musicBrainzTagStoreLoaded = true
	app.rebuildMusicBrainzTagIndexesLocked()
	return app
}

func newMusicBrainzTagDatabaseTestApp() *App {
	app := &App{}
	app.musicBrainzTagStore = newMusicBrainzTagDatabaseStore()
	app.musicBrainzTagStoreLoaded = true
	return app
}

func primeMusicBrainzTagSearchAvailability(app *App, folderPaths ...string) {
	app.libraryDerivedIndexDirty = false
	app.libraryDerivedIndexBuilding = false
	app.folderEntriesByFolder = make(map[string][]LibraryBrowserEntry, len(folderPaths))
	for _, folderPath := range folderPaths {
		app.folderEntriesByFolder[folderPath] = app.buildFolderEntriesFromMapsLocked(folderPath)
	}
	app.folderChildPathsByFolder = map[string][]string{}
	app.trackFilesByFolder = map[string][]LibraryIndexedFile{}
	app.searchFolderEntries = []LibraryBrowserEntry{}
	app.searchTrackEntries = []LibraryBrowserEntry{}
	app.searchTextEntries = []LibraryBrowserEntry{}
	app.searchImageEntries = []LibraryBrowserEntry{}
	app.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
}

func TestSearchLibraryMusicBrainzArtistTagIncludesReleaseFolders(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondAlbumFolder := filepath.Join(fixture.rootOne, "Artist One", "Album Two")
	if err := os.MkdirAll(secondAlbumFolder, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", secondAlbumFolder, err)
	}

	secondTrack := filepath.Join(secondAlbumFolder, "01 Second.flac")
	writeTestFile(t, secondTrack, "second")

	indexedTracks := []LibraryIndexedFile{
		indexedTrackForTest(fixture.rootOne, fixture.trackOne),
		indexedTrackForTest(fixture.rootOne, secondTrack),
	}
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseIDs := []string{
		"22222222-2222-4222-8222-222222222222",
		"33333333-3333-4333-8333-333333333333",
	}
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexedTracks...)

	albumFolderPaths := make([]string, 0, len(indexedTracks))
	artistFolderPath := ""
	for index, indexed := range indexedTracks {
		signature, ok := trackTagsFileSignatureForPath(indexed.Path)
		if !ok {
			t.Fatalf("trackTagsFileSignatureForPath(%q) failed", indexed.Path)
		}

		releaseFolderPath := releaseFolderPathForIndexedTrack(indexed, 2)
		artistFolderPaths := artistFolderPathsForIndexedTrack(indexed, 2)
		if artistFolderPath == "" && len(artistFolderPaths) > 0 {
			artistFolderPath = artistFolderPaths[0]
		}
		albumFolderPaths = append(albumFolderPaths, releaseFolderPath)

		app.musicBrainzTagStore.Tracks[indexed.Path] = musicBrainzTagTrackRecord{
			Signature:         signature,
			ReleaseID:         releaseIDs[index],
			ArtistIDs:         []string{artistMBID},
			ReleaseFolderPath: releaseFolderPath,
			ArtistFolderPaths: artistFolderPaths,
			LastScannedAt:     time.Now().Add(-time.Hour),
		}
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", artistMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Tags:          []string{"pikopiko kei"},
		LastFetchedAt: time.Now().Add(-time.Hour),
	}
	app.rebuildMusicBrainzTagIndexesLocked()
	primeMusicBrainzTagSearchAvailability(app, artistFolderPath, albumFolderPaths[0], albumFolderPaths[1])

	page := app.SearchLibrary(`mbtag:"pikopiko kei"`, 0, 20)
	if page.TotalEntries != 5 {
		t.Fatalf("SearchLibrary() totalEntries = %d, want %d", page.TotalEntries, 5)
	}
	if !hasBrowserEntry(page.Entries, "folder", artistFolderPath) {
		t.Fatalf("SearchLibrary() entries missing artist folder %q: %#v", artistFolderPath, page.Entries)
	}
	if !hasBrowserEntry(page.Entries, "folder", albumFolderPaths[0]) {
		t.Fatalf("SearchLibrary() entries missing album folder %q: %#v", albumFolderPaths[0], page.Entries)
	}
	if !hasBrowserEntry(page.Entries, "folder", albumFolderPaths[1]) {
		t.Fatalf("SearchLibrary() entries missing album folder %q: %#v", albumFolderPaths[1], page.Entries)
	}
	if !hasBrowserEntry(page.Entries, "track", indexedTracks[0].Path) {
		t.Fatalf("SearchLibrary() entries missing album track %q: %#v", indexedTracks[0].Path, page.Entries)
	}
	if !hasBrowserEntry(page.Entries, "track", indexedTracks[1].Path) {
		t.Fatalf("SearchLibrary() entries missing album track %q: %#v", indexedTracks[1].Path, page.Entries)
	}
}

func TestMusicBrainzTagSearchAdditionalBranches(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	indexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	releaseFolderPath := releaseFolderPathForIndexedTrack(indexed, 2)
	releaseMBID := "11111111-1111-4111-8111-111111111111"
	artistMBID := "22222222-2222-4222-8222-222222222222"

	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, indexed)
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: time.Now().Add(-time.Hour),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("artist", artistMBID)] = musicBrainzTagEntityRecord{
		EntityType:    "artist",
		MBID:          artistMBID,
		Tags:          []string{"rock"},
		LastFetchedAt: time.Now().Add(-time.Hour),
	}
	app.rebuildMusicBrainzTagIndexesLocked()

	app.musicBrainzTagEntityKeysByTag["rock"][musicBrainzTagEntityKey("artist", "33333333-3333-4333-8333-333333333333")] = struct{}{}
	app.musicBrainzTagReleaseFoldersByID[releaseMBID] = map[string]struct{}{
		strings.ToUpper(releaseFolderPath): {},
		" ":                                {},
	}
	app.musicBrainzTagReleaseFoldersByArtistID[artistMBID] = map[string]struct{}{
		releaseFolderPath: {},
		filepath.Base(fixture.rootOne) + "/Missing Album": {},
	}
	primeMusicBrainzTagSearchAvailability(app, releaseFolderPath)

	folderPaths := app.musicBrainzTagMatchingFolderPaths([]string{" ", "rock"})
	if len(folderPaths) != 3 {
		t.Fatalf("musicBrainzTagMatchingFolderPaths() = %#v, want deduped actual, blank, and unavailable folders", folderPaths)
	}

	if app.isMusicBrainzTagSearchFolderAvailableLocked(" ") {
		t.Fatal("isMusicBrainzTagSearchFolderAvailableLocked(blank) = true, want false")
	}

	app.musicBrainzTagReleaseFoldersByID[releaseMBID] = map[string]struct{}{
		releaseFolderPath: {},
		" ":               {},
	}

	entries := app.buildMusicBrainzTagSearchResultsLocked([]string{"rock"})
	if len(entries) != 2 {
		t.Fatalf("buildMusicBrainzTagSearchResultsLocked() = %#v, want folder and track entries for the available release only", entries)
	}
	if !hasBrowserEntry(entries, "folder", releaseFolderPath) {
		t.Fatalf("buildMusicBrainzTagSearchResultsLocked() missing folder %q: %#v", releaseFolderPath, entries)
	}
	if !hasBrowserEntry(entries, "track", indexed.Path) {
		t.Fatalf("buildMusicBrainzTagSearchResultsLocked() missing track %q: %#v", indexed.Path, entries)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Path, "Missing Album") {
			t.Fatalf("buildMusicBrainzTagSearchResultsLocked() = %#v, want unavailable folder skipped", entries)
		}
	}
}

func TestBuildMusicBrainzTagWorkerStateScansEveryTrackPerRelease(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondTrack := filepath.Join(fixture.albumOneFolder, "02 Song.flac")
	writeTestFile(t, secondTrack, "track two")

	firstIndexed := indexedTrackForTest(fixture.rootOne, fixture.trackOne)
	secondIndexed := indexedTrackForTest(fixture.rootOne, secondTrack)
	app := newMusicBrainzTagWorkerStateTestApp(fixture.rootOne, firstIndexed, secondIndexed)

	state := app.buildMusicBrainzTagWorkerState(1)
	if len(state.pendingTrackPaths) != 2 {
		t.Fatalf("pendingTrackPaths = %#v, want both album tracks queued", state.pendingTrackPaths)
	}
	if !stringSlicesEqual(state.pendingTrackPaths, []string{firstIndexed.Path, secondIndexed.Path}) {
		t.Fatalf("pendingTrackPaths = %#v, want %#v", state.pendingTrackPaths, []string{firstIndexed.Path, secondIndexed.Path})
	}
	if state.totalTrackPaths != 2 {
		t.Fatalf("totalTrackPaths = %d, want 2", state.totalTrackPaths)
	}
	if state.completedTrackPaths != 0 {
		t.Fatalf("completedTrackPaths = %d, want 0", state.completedTrackPaths)
	}
}

func TestBuildMusicBrainzTagWorkerStateDropsStaleTrackRecordWhenPathChanges(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	replacementTrack := filepath.Join(fixture.albumOneFolder, "02 Song.flac")
	writeTestFile(t, replacementTrack, "replacement track")

	replacementIndexed := indexedTrackForTest(fixture.rootOne, replacementTrack)
	releaseFolderPath := releaseFolderPathForIndexedTrack(replacementIndexed, 2)
	artistFolderPaths := artistFolderPathsForIndexedTrack(replacementIndexed, 2)

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
	if len(state.pendingTrackPaths) != 1 || state.pendingTrackPaths[0] != replacementIndexed.Path {
		t.Fatalf("pendingTrackPaths = %#v, want only the new track path queued", state.pendingTrackPaths)
	}
	if state.totalTrackPaths != 1 {
		t.Fatalf("totalTrackPaths = %d, want 1", state.totalTrackPaths)
	}
	if state.completedTrackPaths != 0 {
		t.Fatalf("completedTrackPaths = %d, want 0", state.completedTrackPaths)
	}
	if len(state.pendingEntityKeys) != 0 {
		t.Fatalf("pendingEntityKeys = %#v, want none", state.pendingEntityKeys)
	}
	if state.totalEntityLookups != 0 {
		t.Fatalf("totalEntityLookups = %d, want 0", state.totalEntityLookups)
	}
	if state.completedEntityLookups != 0 {
		t.Fatalf("completedEntityLookups = %d, want 0", state.completedEntityLookups)
	}

	if _, exists := app.musicBrainzTagStore.Tracks[normalizePath(fixture.trackOne)]; exists {
		t.Fatal("did not expect stale track path to remain in the store")
	}

	if _, exists := app.musicBrainzTagStore.Tracks[replacementIndexed.Path]; exists {
		t.Fatalf("did not expect a new track record at %q before the rescan runs", replacementIndexed.Path)
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

func TestMusicBrainzTagSQLiteRowHelpers(t *testing.T) {
	databaseDir := filepath.Join(t.TempDir(), "nested", "musicbrainz")
	databasePath := filepath.Join(databaseDir, musicBrainzTagDatabaseFileName)
	trackPath := filepath.Join("C:\\Music", "Artist", "Album", "track.flac")
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"
	orphanMBID := "33333333-3333-4333-8333-333333333333"

	if musicBrainzTagDatabaseFileExists(databasePath) {
		t.Fatalf("musicBrainzTagDatabaseFileExists(%q) = true, want false", databasePath)
	}
	if err := os.MkdirAll(databaseDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", databaseDir, err)
	}
	if musicBrainzTagDatabaseFileExists(databaseDir) {
		t.Fatalf("musicBrainzTagDatabaseFileExists(%q) = true, want false for directory", databaseDir)
	}

	database, err := openMusicBrainzTagSQLite(databasePath)
	if err != nil {
		t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		t.Fatalf("initializeMusicBrainzTagSQLite() error = %v", err)
	}
	if !musicBrainzTagDatabaseFileExists(databasePath) {
		t.Fatalf("musicBrainzTagDatabaseFileExists(%q) = false, want true", databasePath)
	}

	transaction, err := database.Begin()
	if err != nil {
		t.Fatalf("Begin() error = %v", err)
	}
	if err := deleteMusicBrainzTagTrackRow(transaction, "missing.flac"); err != nil {
		t.Fatalf("deleteMusicBrainzTagTrackRow() error = %v", err)
	}
	if err := deleteMusicBrainzTagEntityRow(transaction, "broken"); err != nil {
		t.Fatalf("deleteMusicBrainzTagEntityRow(invalid) error = %v", err)
	}
	if err := upsertMusicBrainzTagTrackRow(transaction, trackPath, musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 123, ModUnixNs: 456},
		RecordLabel:       "  Example Label  ",
		CatalogNumber:     "  CAT-001  ",
		ReleaseID:         strings.ToUpper(releaseMBID),
		ArtistIDs:         []string{" ", artistMBID, strings.ToUpper(artistMBID)},
		ReleaseFolderPath: " Library/Artist/Album ",
		ArtistFolderPaths: []string{"Library/Artist", "library/artist", ""},
		LastScannedAt:     time.Unix(0, 789),
	}); err != nil {
		t.Fatalf("upsertMusicBrainzTagTrackRow() error = %v", err)
	}
	if err := upsertMusicBrainzTagEntityRow(transaction, musicBrainzTagEntityKey("release", releaseMBID), musicBrainzTagEntityRecord{
		EntityType:    "release",
		MBID:          releaseMBID,
		Title:         " Album ",
		Tags:          []string{" Rock ", "rock", "Shoegaze"},
		LastFetchedAt: time.Unix(0, 111),
		LastAttemptAt: time.Unix(0, 222),
		LastError:     " transient ",
	}); err != nil {
		t.Fatalf("upsertMusicBrainzTagEntityRow() error = %v", err)
	}
	if err := upsertMusicBrainzTagEntityRow(transaction, "broken", musicBrainzTagEntityRecord{Title: "ignored"}); err != nil {
		t.Fatalf("upsertMusicBrainzTagEntityRow(invalid) error = %v", err)
	}
	if err := transaction.Commit(); err != nil {
		t.Fatalf("Commit() error = %v", err)
	}

	if _, err := database.Exec(`INSERT INTO track_scan_artist_ids(path, artist_id, position) VALUES (?, ?, ?)`, "missing.flac", artistMBID, 0); err != nil {
		t.Fatalf("INSERT orphan track_scan_artist_ids error = %v", err)
	}
	if _, err := database.Exec(`INSERT INTO track_scan_artist_folders(path, folder_path, position) VALUES (?, ?, ?)`, "missing.flac", "Library/Missing", 0); err != nil {
		t.Fatalf("INSERT orphan track_scan_artist_folders error = %v", err)
	}
	if _, err := database.Exec(`INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error) VALUES (?, ?, ?, 0, 0, '')`, "release", "bad", "Broken release"); err != nil {
		t.Fatalf("INSERT invalid entity row error = %v", err)
	}
	if _, err := database.Exec(`INSERT INTO entity_tags(entity_type, mbid, tag_name, position) VALUES (?, ?, ?, ?)`, "release", orphanMBID, "ignored", 0); err != nil {
		t.Fatalf("INSERT orphan entity tag error = %v", err)
	}

	loadedStore, err := loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database)
	if err != nil {
		t.Fatalf("loadMusicBrainzTagDatabaseStoreFromSQLiteConnection() error = %v", err)
	}
	loadedTrack, exists := loadedStore.Tracks[trackPath]
	if !exists {
		t.Fatalf("expected loaded store to include %q", trackPath)
	}
	if loadedTrack.ReleaseID != releaseMBID {
		t.Fatalf("loaded track release ID = %q, want %q", loadedTrack.ReleaseID, releaseMBID)
	}
	if loadedTrack.RecordLabel != "Example Label" || loadedTrack.CatalogNumber != "CAT-001" {
		t.Fatalf("loaded track label metadata = %#v, want trimmed label and catalog number", loadedTrack)
	}
	if !stringSlicesEqual(loadedTrack.ArtistIDs, []string{artistMBID}) {
		t.Fatalf("loaded track artist IDs = %#v, want %#v", loadedTrack.ArtistIDs, []string{artistMBID})
	}
	if !stringSlicesEqual(loadedTrack.ArtistFolderPaths, []string{"Library/Artist"}) {
		t.Fatalf("loaded track artist folder paths = %#v, want %#v", loadedTrack.ArtistFolderPaths, []string{"Library/Artist"})
	}
	loadedEntity, exists := loadedStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)]
	if !exists {
		t.Fatal("expected loaded store to include release entity")
	}
	if loadedEntity.Title != "Album" || loadedEntity.LastError != "transient" {
		t.Fatalf("loaded entity = %#v, want trimmed title and last error", loadedEntity)
	}
	if !stringSlicesEqual(loadedEntity.Tags, []string{"rock", "shoegaze"}) {
		t.Fatalf("loaded entity tags = %#v, want normalized tags", loadedEntity.Tags)
	}
	if len(loadedStore.Entities) != 1 {
		t.Fatalf("loaded entity count = %d, want 1", len(loadedStore.Entities))
	}

	loadedViaPath, err := loadMusicBrainzTagDatabaseStoreFromSQLite(databasePath)
	if err != nil {
		t.Fatalf("loadMusicBrainzTagDatabaseStoreFromSQLite() error = %v", err)
	}
	if len(loadedViaPath.Tracks) != 1 || len(loadedViaPath.Entities) != 1 {
		t.Fatalf("loadMusicBrainzTagDatabaseStoreFromSQLite() = %#v, want one track and one entity", loadedViaPath)
	}

	transaction, err = database.Begin()
	if err != nil {
		t.Fatalf("Begin(update) error = %v", err)
	}
	if err := upsertMusicBrainzTagTrackRow(transaction, trackPath, musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 124, ModUnixNs: 457},
		ReleaseID:         releaseMBID,
		ReleaseFolderPath: "Library/Artist/Album",
		LastScannedAt:     time.Unix(0, 790),
	}); err != nil {
		t.Fatalf("upsertMusicBrainzTagTrackRow(update) error = %v", err)
	}
	if err := upsertMusicBrainzTagEntityRow(transaction, musicBrainzTagEntityKey("release", releaseMBID), musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseMBID,
		Title:      "Album",
	}); err != nil {
		t.Fatalf("upsertMusicBrainzTagEntityRow(update) error = %v", err)
	}
	if err := transaction.Commit(); err != nil {
		t.Fatalf("Commit(update) error = %v", err)
	}

	transaction, err = database.Begin()
	if err != nil {
		t.Fatalf("Begin(delete) error = %v", err)
	}
	if err := deleteMusicBrainzTagTrackRow(transaction, trackPath); err != nil {
		t.Fatalf("deleteMusicBrainzTagTrackRow(valid) error = %v", err)
	}
	if err := deleteMusicBrainzTagEntityRow(transaction, musicBrainzTagEntityKey("release", releaseMBID)); err != nil {
		t.Fatalf("deleteMusicBrainzTagEntityRow(valid) error = %v", err)
	}
	if err := transaction.Commit(); err != nil {
		t.Fatalf("Commit(delete) error = %v", err)
	}

	emptyStore, err := loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database)
	if err != nil {
		t.Fatalf("loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(after delete) error = %v", err)
	}
	if len(emptyStore.Tracks) != 0 || len(emptyStore.Entities) != 0 {
		t.Fatalf("store after delete = %#v, want empty store", emptyStore)
	}
}

func TestLoadMusicBrainzTagDatabaseStoreFallsBackToEmptyOnInvalidSQLite(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
	writeTestFile(t, databasePath, "not-a-sqlite-database")

	loadedStore := loadMusicBrainzTagDatabaseStore(databasePath)
	if len(loadedStore.Tracks) != 0 || len(loadedStore.Entities) != 0 {
		t.Fatalf("loadMusicBrainzTagDatabaseStore(invalid sqlite) = %#v, want empty store", loadedStore)
	}
}

func TestPersistAndEnsureMusicBrainzTagDatabase(t *testing.T) {
	tempDir := t.TempDir()
	settingsPath := filepath.Join(tempDir, "silphium.settings.json")
	trackPath := filepath.Join(tempDir, "track.flac")
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"
	writeTestFile(t, trackPath, "track")

	app := newMusicBrainzTagDatabaseTestApp()
	app.settingsPath = settingsPath
	app.musicBrainzTagStoreDirty = true
	app.musicBrainzTagStore.Tracks[trackPath] = musicBrainzTagTrackRecord{
		Signature:         trackTagsFileSignature{Size: 12, ModUnixNs: 34},
		ReleaseID:         releaseMBID,
		ArtistIDs:         []string{artistMBID},
		ReleaseFolderPath: "Library/Artist/Album",
		ArtistFolderPaths: []string{"Library/Artist"},
		LastScannedAt:     time.Unix(0, 56),
	}
	app.musicBrainzTagStore.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
		EntityType: "release",
		MBID:       releaseMBID,
		Title:      "Album",
		Tags:       []string{"rock"},
	}

	app.persistMusicBrainzTagDatabase(true)
	if !musicBrainzTagDatabaseFileExists(app.musicBrainzTagDatabasePath()) {
		t.Fatalf("expected persisted database at %q", app.musicBrainzTagDatabasePath())
	}
	if app.musicBrainzTagStoreDirty {
		t.Fatal("expected persistMusicBrainzTagDatabase() to clear dirty flag on success")
	}

	app.musicBrainzTagStore = musicBrainzTagDatabaseStore{}
	app.musicBrainzTagStoreLoaded = false
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	if !app.musicBrainzTagStoreLoaded {
		t.Fatal("expected ensureMusicBrainzTagDatabaseLoadedLocked() to load the store")
	}
	if _, exists := app.musicBrainzTagStore.Tracks[trackPath]; !exists {
		t.Fatalf("expected loaded store to contain %q", trackPath)
	}
	if _, exists := app.musicBrainzTagReleaseFoldersByID[releaseMBID]; !exists {
		t.Fatalf("expected release folder index for %q", releaseMBID)
	}

	app.musicBrainzTagStore.Tracks["sentinel"] = musicBrainzTagTrackRecord{}
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	if _, exists := app.musicBrainzTagStore.Tracks["sentinel"]; !exists {
		t.Fatal("expected already-loaded store to remain unchanged on second ensure")
	}
}

func TestPersistMusicBrainzTagDatabaseGuardsAndFailure(t *testing.T) {
	tempDir := t.TempDir()
	app := &App{}
	app.settingsPath = filepath.Join(tempDir, "silphium.settings.json")
	app.musicBrainzTagStore = newMusicBrainzTagDatabaseStore()

	app.persistMusicBrainzTagDatabase(true)
	if app.musicBrainzTagStoreDirty {
		t.Fatal("persistMusicBrainzTagDatabase(no-op) should leave dirty=false when nothing was pending")
	}

	app.musicBrainzTagStoreLoaded = true
	app.musicBrainzTagStoreDirty = true
	app.musicBrainzTagLastPersistAt = time.Now()
	app.persistMusicBrainzTagDatabase(false)
	if !app.musicBrainzTagStoreDirty {
		t.Fatal("persistMusicBrainzTagDatabase(throttled) should keep the dirty flag set")
	}

	blockingPath := filepath.Join(tempDir, "blocking-parent")
	writeTestFile(t, blockingPath, "not-a-directory")
	app.settingsPath = filepath.Join(blockingPath, "silphium.settings.json")
	app.musicBrainzTagStoreDirty = true
	app.musicBrainzTagLastPersistAt = time.Time{}
	app.persistMusicBrainzTagDatabase(true)
	if !app.musicBrainzTagStoreDirty {
		t.Fatal("persistMusicBrainzTagDatabase(error) should restore the dirty flag")
	}
}

func TestMusicBrainzTagSQLiteErrorBranches(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
	database, err := openMusicBrainzTagSQLite(databasePath)
	if err != nil {
		t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
	}
	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		t.Fatalf("initializeMusicBrainzTagSQLite() error = %v", err)
	}
	if err := database.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if _, err := loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database); err == nil {
		t.Fatal("loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(closed db) error = nil, want error")
	}

	database, err = openMusicBrainzTagSQLite(databasePath)
	if err != nil {
		t.Fatalf("openMusicBrainzTagSQLite(reopen) error = %v", err)
	}
	defer database.Close()
	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		t.Fatalf("initializeMusicBrainzTagSQLite(reopen) error = %v", err)
	}
	transaction, err := database.Begin()
	if err != nil {
		t.Fatalf("Begin() error = %v", err)
	}
	if err := transaction.Rollback(); err != nil {
		t.Fatalf("Rollback() error = %v", err)
	}
	if err := deleteMusicBrainzTagTrackRow(transaction, "track.flac"); err == nil {
		t.Fatal("deleteMusicBrainzTagTrackRow(rolled back tx) error = nil, want error")
	}
	if err := upsertMusicBrainzTagTrackRow(transaction, "track.flac", musicBrainzTagTrackRecord{}); err == nil {
		t.Fatal("upsertMusicBrainzTagTrackRow(rolled back tx) error = nil, want error")
	}
	if err := deleteMusicBrainzTagEntityRow(transaction, musicBrainzTagEntityKey("release", "22222222-2222-4222-8222-222222222222")); err == nil {
		t.Fatal("deleteMusicBrainzTagEntityRow(rolled back tx) error = nil, want error")
	}
	if err := upsertMusicBrainzTagEntityRow(transaction, musicBrainzTagEntityKey("release", "22222222-2222-4222-8222-222222222222"), musicBrainzTagEntityRecord{Title: "Album"}); err == nil {
		t.Fatal("upsertMusicBrainzTagEntityRow(rolled back tx) error = nil, want error")
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

	var busyTimeout int
	if err := database.QueryRow(`PRAGMA busy_timeout`).Scan(&busyTimeout); err != nil {
		t.Fatalf("PRAGMA busy_timeout query error = %v", err)
	}
	if busyTimeout != 5000 {
		t.Fatalf("busy timeout = %d, want %d", busyTimeout, 5000)
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
		RecordLabel:       "Label A",
		CatalogNumber:     "CAT-A",
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
		RecordLabel:       "Label A Deluxe",
		CatalogNumber:     "CAT-A2",
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
	if loadedTrackOne.RecordLabel != "Label A Deluxe" || loadedTrackOne.CatalogNumber != "CAT-A2" {
		t.Fatalf("updated track label metadata = %#v, want updated label and catalog number", loadedTrackOne)
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

func prepareMusicBrainzTagSQLitePath(t *testing.T, customize func(*sql.DB)) string {
	t.Helper()

	databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
	database, err := openMusicBrainzTagSQLite(databasePath)
	if err != nil {
		t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
	}
	defer database.Close()

	if err := initializeMusicBrainzTagSQLite(database); err != nil {
		t.Fatalf("initializeMusicBrainzTagSQLite() error = %v", err)
	}
	if customize != nil {
		customize(database)
	}

	return databasePath
}

func TestMusicBrainzTagSQLiteAdditionalLoadBranches(t *testing.T) {
	t.Run("initialize fails when schema is incompatible", func(t *testing.T) {
		databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
		database, err := openMusicBrainzTagSQLite(databasePath)
		if err != nil {
			t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
		}
		if _, err := database.Exec(`CREATE TABLE track_scan_artist_ids (path TEXT PRIMARY KEY)`); err != nil {
			database.Close()
			t.Fatalf("CREATE malformed track_scan_artist_ids table error = %v", err)
		}
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		if _, err := loadMusicBrainzTagDatabaseStoreFromSQLite(databasePath); err == nil {
			t.Fatal("loadMusicBrainzTagDatabaseStoreFromSQLite(incompatible schema) error = nil, want error")
		}
	})

	t.Run("later query errors bubble up", func(t *testing.T) {
		for _, testCase := range []struct {
			name      string
			dropTable string
		}{
			{name: "track artist ids", dropTable: "track_scan_artist_ids"},
			{name: "track artist folders", dropTable: "track_scan_artist_folders"},
			{name: "entities", dropTable: "entities"},
			{name: "entity tags", dropTable: "entity_tags"},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				databasePath := prepareMusicBrainzTagSQLitePath(t, nil)
				database, err := openMusicBrainzTagSQLite(databasePath)
				if err != nil {
					t.Fatalf("openMusicBrainzTagSQLite(reopen) error = %v", err)
				}
				defer database.Close()

				if _, err := database.Exec("DROP TABLE " + testCase.dropTable); err != nil {
					t.Fatalf("DROP TABLE %s error = %v", testCase.dropTable, err)
				}

				if _, err := loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database); err == nil {
					t.Fatalf("loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(%s missing) error = nil, want error", testCase.dropTable)
				}
			})
		}
	})

	t.Run("track row scan errors bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO track_scans(path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns) VALUES (?, ?, ?, '', '', 0)`, "track.flac", "bad-size", 0); err != nil {
				t.Fatalf("INSERT malformed track row error = %v", err)
			}
		})
		database, err := openMusicBrainzTagSQLite(databasePath)
		if err != nil {
			t.Fatalf("openMusicBrainzTagSQLite(reopen) error = %v", err)
		}
		defer database.Close()

		if _, err := loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(database); err == nil {
			t.Fatal("loadMusicBrainzTagDatabaseStoreFromSQLiteConnection(malformed track row) error = nil, want error")
		}
	})

	t.Run("secondary row scan errors bubble up", func(t *testing.T) {
		for _, testCase := range []struct {
			name      string
			createSQL string
			insertSQL string
			args      []interface{}
		}{
			{
				name:      "track artist row",
				createSQL: `CREATE TABLE track_scan_artist_ids (path TEXT, artist_id TEXT, position INTEGER)`,
				insertSQL: `INSERT INTO track_scan_artist_ids(path, artist_id, position) VALUES (?, NULL, 0)`,
				args:      []interface{}{"track.flac"},
			},
			{
				name:      "track folder row",
				createSQL: `CREATE TABLE track_scan_artist_folders (path TEXT, folder_path TEXT, position INTEGER)`,
				insertSQL: `INSERT INTO track_scan_artist_folders(path, folder_path, position) VALUES (?, NULL, 0)`,
				args:      []interface{}{"track.flac"},
			},
			{
				name:      "entity row",
				createSQL: `CREATE TABLE entities (entity_type TEXT, mbid TEXT, title TEXT, last_fetched_unix_ns INTEGER, last_attempt_unix_ns INTEGER, last_error TEXT)`,
				insertSQL: `INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error) VALUES (?, ?, NULL, 0, 0, '')`,
				args:      []interface{}{"release", "22222222-2222-4222-8222-222222222222"},
			},
			{
				name:      "entity tag row",
				createSQL: `CREATE TABLE entity_tags (entity_type TEXT, mbid TEXT, tag_name TEXT, position INTEGER)`,
				insertSQL: `INSERT INTO entity_tags(entity_type, mbid, tag_name, position) VALUES (?, ?, NULL, 0)`,
				args:      []interface{}{"release", "22222222-2222-4222-8222-222222222222"},
			},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
				database, err := openMusicBrainzTagSQLite(databasePath)
				if err != nil {
					t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
				}
				if _, err := database.Exec(testCase.createSQL); err != nil {
					_ = database.Close()
					t.Fatalf("CREATE malformed table error = %v", err)
				}
				if _, err := database.Exec(testCase.insertSQL, testCase.args...); err != nil {
					_ = database.Close()
					t.Fatalf("INSERT malformed row error = %v", err)
				}
				if err := database.Close(); err != nil {
					t.Fatalf("Close() error = %v", err)
				}

				if _, err := loadMusicBrainzTagDatabaseStoreFromSQLite(databasePath); err == nil {
					t.Fatalf("loadMusicBrainzTagDatabaseStoreFromSQLite(%s malformed row) error = nil, want error", testCase.name)
				}
			})
		}
	})
}

func TestMusicBrainzTagSQLiteAdditionalWriteErrorBranches(t *testing.T) {
	trackPath := filepath.Join("C:\\Music", "Artist", "Album", "track.flac")
	artistMBID := "11111111-1111-4111-8111-111111111111"
	releaseMBID := "22222222-2222-4222-8222-222222222222"

	t.Run("initialize failure bubbles up", func(t *testing.T) {
		databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
		database, err := openMusicBrainzTagSQLite(databasePath)
		if err != nil {
			t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
		}
		if _, err := database.Exec(`CREATE VIEW meta AS SELECT 'version' AS key, '1' AS value`); err != nil {
			database.Close()
			t.Fatalf("CREATE VIEW meta error = %v", err)
		}
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil {
			t.Fatal("writeMusicBrainzTagDatabaseStoreToSQLite(meta view) error = nil, want error")
		}
	})

	t.Run("existing store load failures bubble up", func(t *testing.T) {
		databasePath := filepath.Join(t.TempDir(), musicBrainzTagDatabaseFileName)
		database, err := openMusicBrainzTagSQLite(databasePath)
		if err != nil {
			t.Fatalf("openMusicBrainzTagSQLite() error = %v", err)
		}
		if _, err := database.Exec(`CREATE TABLE track_scans (path TEXT PRIMARY KEY, size TEXT NOT NULL, mod_unix_ns INTEGER NOT NULL, release_id TEXT NOT NULL DEFAULT '', release_folder_path TEXT NOT NULL DEFAULT '', last_scanned_unix_ns INTEGER NOT NULL DEFAULT 0)`); err != nil {
			database.Close()
			t.Fatalf("CREATE malformed track_scans error = %v", err)
		}
		if _, err := database.Exec(`INSERT INTO track_scans(path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns) VALUES (?, ?, ?, '', '', 0)`, trackPath, "bad-size", 0); err != nil {
			database.Close()
			t.Fatalf("INSERT malformed track_scans row error = %v", err)
		}
		if err := database.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil {
			t.Fatal("writeMusicBrainzTagDatabaseStoreToSQLite(malformed existing store) error = nil, want error")
		}
	})

	t.Run("cleanup delete failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error) VALUES ('label', ?, 'Ignored', 0, 0, '')`, "33333333-3333-4333-8333-333333333333"); err != nil {
				t.Fatalf("INSERT unsupported entity error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_cleanup_delete BEFORE DELETE ON entities WHEN old.entity_type NOT IN ('artist', 'release') BEGIN SELECT RAISE(FAIL, 'cleanup delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_cleanup_delete error = %v", err)
			}
		})

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil || !strings.Contains(err.Error(), "cleanup delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(cleanup delete) = %v, want cleanup delete error", err)
		}
	})

	t.Run("meta insert failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`CREATE TRIGGER fail_meta_insert BEFORE INSERT ON meta BEGIN SELECT RAISE(FAIL, 'meta insert fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_meta_insert error = %v", err)
			}
		})

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil || !strings.Contains(err.Error(), "meta insert fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(meta insert) = %v, want meta insert error", err)
		}
	})

	t.Run("track delete failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO track_scans(path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns) VALUES (?, ?, ?, ?, ?, 0)`, trackPath, 1, 2, releaseMBID, "Library/Artist/Album"); err != nil {
				t.Fatalf("INSERT track_scans row error = %v", err)
			}
			if _, err := database.Exec(`INSERT INTO track_scan_artist_ids(path, artist_id, position) VALUES (?, ?, 0)`, trackPath, artistMBID); err != nil {
				t.Fatalf("INSERT track_scan_artist_ids row error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_track_delete BEFORE DELETE ON track_scan_artist_ids BEGIN SELECT RAISE(FAIL, 'track delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_track_delete error = %v", err)
			}
		})

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil || !strings.Contains(err.Error(), "track delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(track delete) = %v, want track delete error", err)
		}
	})

	t.Run("track upsert failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`CREATE TRIGGER fail_track_artist_insert BEFORE INSERT ON track_scan_artist_ids BEGIN SELECT RAISE(FAIL, 'track upsert fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_track_artist_insert error = %v", err)
			}
		})
		store := newMusicBrainzTagDatabaseStore()
		store.Tracks[trackPath] = musicBrainzTagTrackRecord{
			Signature:         trackTagsFileSignature{Size: 1, ModUnixNs: 2},
			ReleaseID:         releaseMBID,
			ArtistIDs:         []string{artistMBID},
			ReleaseFolderPath: "Library/Artist/Album",
			ArtistFolderPaths: []string{"Library/Artist"},
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err == nil || !strings.Contains(err.Error(), "track upsert fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(track upsert) = %v, want track upsert error", err)
		}
	})

	t.Run("track artist delete failures during upsert bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO track_scans(path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns) VALUES (?, ?, ?, ?, ?, 0)`, trackPath, 1, 2, releaseMBID, "Library/Artist/Album"); err != nil {
				t.Fatalf("INSERT track_scans row error = %v", err)
			}
			if _, err := database.Exec(`INSERT INTO track_scan_artist_ids(path, artist_id, position) VALUES (?, ?, 0)`, trackPath, artistMBID); err != nil {
				t.Fatalf("INSERT track_scan_artist_ids row error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_track_artist_delete BEFORE DELETE ON track_scan_artist_ids BEGIN SELECT RAISE(FAIL, 'track artist delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_track_artist_delete error = %v", err)
			}
		})
		store := newMusicBrainzTagDatabaseStore()
		store.Tracks[trackPath] = musicBrainzTagTrackRecord{
			Signature:         trackTagsFileSignature{Size: 2, ModUnixNs: 3},
			ReleaseID:         releaseMBID,
			ArtistIDs:         []string{artistMBID},
			ReleaseFolderPath: "Library/Artist/Album",
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err == nil || !strings.Contains(err.Error(), "track artist delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(track artist delete) = %v, want track artist delete error", err)
		}
	})

	t.Run("track folder upsert failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`CREATE TRIGGER fail_track_folder_insert BEFORE INSERT ON track_scan_artist_folders BEGIN SELECT RAISE(FAIL, 'track folder upsert fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_track_folder_insert error = %v", err)
			}
		})
		store := newMusicBrainzTagDatabaseStore()
		store.Tracks[trackPath] = musicBrainzTagTrackRecord{
			Signature:         trackTagsFileSignature{Size: 1, ModUnixNs: 2},
			ReleaseID:         releaseMBID,
			ReleaseFolderPath: "Library/Artist/Album",
			ArtistFolderPaths: []string{"Library/Artist"},
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err == nil || !strings.Contains(err.Error(), "track folder upsert fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(track folder upsert) = %v, want track folder upsert error", err)
		}
	})

	t.Run("track folder delete failures during upsert bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO track_scans(path, size, mod_unix_ns, release_id, release_folder_path, last_scanned_unix_ns) VALUES (?, ?, ?, ?, ?, 0)`, trackPath, 1, 2, releaseMBID, "Library/Artist/Album"); err != nil {
				t.Fatalf("INSERT track_scans row error = %v", err)
			}
			if _, err := database.Exec(`INSERT INTO track_scan_artist_folders(path, folder_path, position) VALUES (?, ?, 0)`, trackPath, "Library/Artist"); err != nil {
				t.Fatalf("INSERT track_scan_artist_folders row error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_track_folder_delete BEFORE DELETE ON track_scan_artist_folders BEGIN SELECT RAISE(FAIL, 'track folder delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_track_folder_delete error = %v", err)
			}
		})
		store := newMusicBrainzTagDatabaseStore()
		store.Tracks[trackPath] = musicBrainzTagTrackRecord{
			Signature:         trackTagsFileSignature{Size: 2, ModUnixNs: 3},
			ReleaseID:         releaseMBID,
			ReleaseFolderPath: "Library/Artist/Album",
			ArtistFolderPaths: []string{"Library/Artist"},
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err == nil || !strings.Contains(err.Error(), "track folder delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(track folder delete) = %v, want track folder delete error", err)
		}
	})

	t.Run("entity delete failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error) VALUES ('release', ?, 'Album', 0, 0, '')`, releaseMBID); err != nil {
				t.Fatalf("INSERT entity row error = %v", err)
			}
			if _, err := database.Exec(`INSERT INTO entity_tags(entity_type, mbid, tag_name, position) VALUES ('release', ?, 'rock', 0)`, releaseMBID); err != nil {
				t.Fatalf("INSERT entity_tags row error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_entity_delete BEFORE DELETE ON entity_tags BEGIN SELECT RAISE(FAIL, 'entity delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_entity_delete error = %v", err)
			}
		})

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil || !strings.Contains(err.Error(), "entity delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(entity delete) = %v, want entity delete error", err)
		}
	})

	t.Run("entity row delete failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error) VALUES ('release', ?, 'Album', 0, 0, '')`, releaseMBID); err != nil {
				t.Fatalf("INSERT entity row error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_entity_row_delete BEFORE DELETE ON entities BEGIN SELECT RAISE(FAIL, 'entity row delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_entity_row_delete error = %v", err)
			}
		})

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, newMusicBrainzTagDatabaseStore()); err == nil || !strings.Contains(err.Error(), "entity row delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(entity row delete) = %v, want entity row delete error", err)
		}
	})

	t.Run("entity upsert failures bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`CREATE TRIGGER fail_entity_tag_insert BEFORE INSERT ON entity_tags BEGIN SELECT RAISE(FAIL, 'entity upsert fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_entity_tag_insert error = %v", err)
			}
		})
		store := newMusicBrainzTagDatabaseStore()
		store.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
			EntityType: "release",
			MBID:       releaseMBID,
			Title:      "Album",
			Tags:       []string{"rock"},
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err == nil || !strings.Contains(err.Error(), "entity upsert fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(entity upsert) = %v, want entity upsert error", err)
		}
	})

	t.Run("entity tag delete failures during upsert bubble up", func(t *testing.T) {
		databasePath := prepareMusicBrainzTagSQLitePath(t, func(database *sql.DB) {
			if _, err := database.Exec(`INSERT INTO entities(entity_type, mbid, title, last_fetched_unix_ns, last_attempt_unix_ns, last_error) VALUES ('release', ?, 'Album', 0, 0, '')`, releaseMBID); err != nil {
				t.Fatalf("INSERT entity row error = %v", err)
			}
			if _, err := database.Exec(`INSERT INTO entity_tags(entity_type, mbid, tag_name, position) VALUES ('release', ?, 'rock', 0)`, releaseMBID); err != nil {
				t.Fatalf("INSERT entity_tags row error = %v", err)
			}
			if _, err := database.Exec(`CREATE TRIGGER fail_entity_tag_delete BEFORE DELETE ON entity_tags BEGIN SELECT RAISE(FAIL, 'entity tag delete fail'); END`); err != nil {
				t.Fatalf("CREATE TRIGGER fail_entity_tag_delete error = %v", err)
			}
		})
		store := newMusicBrainzTagDatabaseStore()
		store.Entities[musicBrainzTagEntityKey("release", releaseMBID)] = musicBrainzTagEntityRecord{
			EntityType: "release",
			MBID:       releaseMBID,
			Title:      "Album Deluxe",
			Tags:       []string{"rock", "shoegaze"},
		}

		if err := writeMusicBrainzTagDatabaseStoreToSQLite(databasePath, store); err == nil || !strings.Contains(err.Error(), "entity tag delete fail") {
			t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite(entity tag delete) = %v, want entity tag delete error", err)
		}
	})
}
