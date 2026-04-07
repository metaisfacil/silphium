package main

import (
	"context"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func browserEntryNames(entries []LibraryBrowserEntry) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name)
	}

	return names
}

func indexedFileRelativePaths(entries []LibraryIndexedFile) []string {
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		paths = append(paths, entry.RelativePath)
	}

	return paths
}

func hasBrowserEntry(entries []LibraryBrowserEntry, kind string, path string) bool {
	for _, entry := range entries {
		if entry.Kind == kind && entry.Path == path {
			return true
		}
	}

	return false
}

func TestScanLibraryFoldersBuildsQueryableIndexAcrossDuplicateLabels(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()

	result := app.scanLibraryFolders([]AppLibraryFolder{
		{Path: fixture.rootOne, Label: "Road Trip", ReleaseDepth: 0},
		{Path: fixture.rootTwo, Label: "Road Trip", ReleaseDepth: 0},
	}, false)

	if result.RootPath != "" {
		t.Fatalf("scanLibraryFolders() rootPath = %q, want empty", result.RootPath)
	}
	if result.RootName != "Selected folders" {
		t.Fatalf("scanLibraryFolders() rootName = %q, want %q", result.RootName, "Selected folders")
	}
	if result.TotalEntries != 10 {
		t.Fatalf("scanLibraryFolders() totalEntries = %d, want %d", result.TotalEntries, 10)
	}
	if result.TrackCount != 2 {
		t.Fatalf("scanLibraryFolders() trackCount = %d, want %d", result.TrackCount, 2)
	}
	if result.TextFileCount != 1 {
		t.Fatalf("scanLibraryFolders() textFileCount = %d, want %d", result.TextFileCount, 1)
	}
	if result.ImageFileCount != 3 {
		t.Fatalf("scanLibraryFolders() imageFileCount = %d, want %d", result.ImageFileCount, 3)
	}

	expectedAlbumFolder := "Road Trip (1)/Artist One/Album One"
	if got := app.ResolveLibraryFolderForPath(fixture.trackOne); got != expectedAlbumFolder {
		t.Fatalf("ResolveLibraryFolderForPath(track) = %q, want %q", got, expectedAlbumFolder)
	}
	if got := app.ResolveLibraryFolderForPath(filepath.Dir(fixture.trackOne)); got != expectedAlbumFolder {
		t.Fatalf("ResolveLibraryFolderForPath(folder) = %q, want %q", got, expectedAlbumFolder)
	}
	if got := app.ResolveLibraryFolderForPath(fixture.outsideTrack); got != "" {
		t.Fatalf("ResolveLibraryFolderForPath(outside) = %q, want empty", got)
	}

	rootPage := app.GetLibraryFolderPage("", 0, 10)
	if rootPage.TotalEntries != 2 {
		t.Fatalf("GetLibraryFolderPage(root) totalEntries = %d, want %d", rootPage.TotalEntries, 2)
	}
	if got := browserEntryNames(rootPage.Entries); !reflect.DeepEqual(got, []string{"Road Trip (1)", "Road Trip (2)"}) {
		t.Fatalf("GetLibraryFolderPage(root) names = %#v, want %#v", got, []string{"Road Trip (1)", "Road Trip (2)"})
	}

	albumPage := app.GetLibraryFolderPage(expectedAlbumFolder, 0, 10)
	if albumPage.TotalEntries != 4 {
		t.Fatalf("GetLibraryFolderPage(album) totalEntries = %d, want %d", albumPage.TotalEntries, 4)
	}
	if got := browserEntryNames(albumPage.Entries); !reflect.DeepEqual(got, []string{"01 Intro.flac", "notes.txt", "cover.jpg", "folder.jpg"}) {
		t.Fatalf("GetLibraryFolderPage(album) names = %#v, want %#v", got, []string{"01 Intro.flac", "notes.txt", "cover.jpg", "folder.jpg"})
	}

	if got := app.GetLibraryFolderCoverPath(expectedAlbumFolder); got != fixture.coverOne {
		t.Fatalf("GetLibraryFolderCoverPath() = %q, want %q", got, fixture.coverOne)
	}

	artistTrackPaths := app.GetLibraryFolderTrackPaths("Road Trip (1)/Artist One")
	if !reflect.DeepEqual(artistTrackPaths, []string{fixture.trackOne}) {
		t.Fatalf("GetLibraryFolderTrackPaths() = %#v, want %#v", artistTrackPaths, []string{fixture.trackOne})
	}
	if got := app.GetLibraryFolderTrackCount("Road Trip (1)/Artist One"); got != 1 {
		t.Fatalf("GetLibraryFolderTrackCount() = %d, want %d", got, 1)
	}

	searchPage := app.SearchLibrary("artist one", 0, 20)
	if !hasBrowserEntry(searchPage.Entries, "folder", expectedAlbumFolder) {
		t.Fatalf("SearchLibrary() entries missing folder %q: %#v", expectedAlbumFolder, searchPage.Entries)
	}
	if !hasBrowserEntry(searchPage.Entries, "track", fixture.trackOne) {
		t.Fatalf("SearchLibrary() entries missing track %q: %#v", fixture.trackOne, searchPage.Entries)
	}

	trackPage := app.GetLibraryIndexedFilePage("track", 0, 10)
	if trackPage.TotalEntries != 2 {
		t.Fatalf("GetLibraryIndexedFilePage(track) totalEntries = %d, want %d", trackPage.TotalEntries, 2)
	}
	if got := indexedFileRelativePaths(trackPage.Entries); !reflect.DeepEqual(got, []string{
		"Road Trip (1)/Artist One/Album One/01 Intro.flac",
		"Road Trip (2)/Artist Two/Album Two/02 Outro.flac",
	}) {
		t.Fatalf("GetLibraryIndexedFilePage(track) relativePaths = %#v", got)
	}
}

func TestScanLibraryFoldersClearsIndexWhenNoRootsRemain(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()

	initial := app.scanLibraryFolders([]AppLibraryFolder{{Path: fixture.rootOne, Label: "Main Library", ReleaseDepth: 0}}, false)
	if initial.TrackCount != 1 {
		t.Fatalf("initial scan trackCount = %d, want %d", initial.TrackCount, 1)
	}

	cleared := app.scanLibraryFolders(nil, false)
	if cleared.RootPath != "" {
		t.Fatalf("cleared scan rootPath = %q, want empty", cleared.RootPath)
	}
	if cleared.RootName != "" {
		t.Fatalf("cleared scan rootName = %q, want empty", cleared.RootName)
	}
	if cleared.TotalEntries != 0 {
		t.Fatalf("cleared scan totalEntries = %d, want %d", cleared.TotalEntries, 0)
	}
	if cleared.TrackCount != 0 || cleared.TextFileCount != 0 || cleared.ImageFileCount != 0 {
		t.Fatalf(
			"cleared scan counts = tracks:%d text:%d images:%d, want all zero",
			cleared.TrackCount,
			cleared.TextFileCount,
			cleared.ImageFileCount,
		)
	}

	trackPage := app.GetLibraryIndexedFilePage("track", 0, 10)
	if trackPage.TotalEntries != 0 || len(trackPage.Entries) != 0 {
		t.Fatalf("GetLibraryIndexedFilePage(track) after clear = %#v, want empty", trackPage)
	}

	rootPage := app.GetLibraryFolderPage("", 0, 10)
	if rootPage.TotalEntries != 0 || len(rootPage.Entries) != 0 {
		t.Fatalf("GetLibraryFolderPage(root) after clear = %#v, want empty", rootPage)
	}

	if got := app.ResolveLibraryFolderForPath(fixture.trackOne); got != "" {
		t.Fatalf("ResolveLibraryFolderForPath() after clear = %q, want empty", got)
	}
	if got := app.GetLibraryFolderCoverPath("Main Library/Artist One/Album One"); got != "" {
		t.Fatalf("GetLibraryFolderCoverPath() after clear = %q, want empty", got)
	}
}

func TestScanLibraryFoldersRestartWatcherAndWalkErrorBranches(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	app.scanLibraryFolder(fixture.rootOne, true)
	waitForLibraryWatcherToStart(t, app)

	cleared := app.scanLibraryFolders(nil, true)
	if cleared.TotalEntries != 0 || cleared.TrackCount != 0 || cleared.TextFileCount != 0 || cleared.ImageFileCount != 0 {
		t.Fatalf("scanLibraryFolders(nil, true) = %#v, want cleared index", cleared)
	}
	if app.libraryWatcher != nil || app.watchStop != nil {
		t.Fatal("scanLibraryFolders(nil, true) should stop and clear watcher state")
	}

	app.indexMu.Lock()
	activeRootsLen := len(app.activeLibraryRoots)
	scanInProgress := app.scanInProgress
	remainingChildren := app.scanRemainingImmediateChildrenByFolder
	app.indexMu.Unlock()
	if activeRootsLen != 0 {
		t.Fatalf("activeLibraryRoots len = %d, want 0 after clearing roots", activeRootsLen)
	}
	if scanInProgress || remainingChildren != nil {
		t.Fatalf("scan state after clear = inProgress:%t remaining:%#v, want false/nil", scanInProgress, remainingChildren)
	}

	missingRoot := filepath.Join(t.TempDir(), "missing-root")
	missingScan := app.scanLibraryFolders([]AppLibraryFolder{{Path: missingRoot, Label: "Missing Root", ReleaseDepth: 0}}, false)
	if missingScan.RootName != "Missing Root" {
		t.Fatalf("scanLibraryFolders(missing) rootName = %q, want %q", missingScan.RootName, "Missing Root")
	}
	if missingScan.RootPath == "" {
		t.Fatal("scanLibraryFolders(missing) rootPath = empty, want normalized root path")
	}
	if missingScan.TotalEntries != 0 || missingScan.TrackCount != 0 || missingScan.TextFileCount != 0 || missingScan.ImageFileCount != 0 {
		t.Fatalf("scanLibraryFolders(missing) = %#v, want empty counts", missingScan)
	}

	app.indexMu.Lock()
	scanInProgress = app.scanInProgress
	remainingChildren = app.scanRemainingImmediateChildrenByFolder
	app.indexMu.Unlock()
	if scanInProgress || remainingChildren != nil {
		t.Fatalf("scan state after missing root scan = inProgress:%t remaining:%#v, want false/nil", scanInProgress, remainingChildren)
	}
}

func TestScanLibraryFoldersProgressLearningAndCoverTieBreak(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	fixture := createLibraryTestFixture(t)
	coverAlpha := filepath.Join(fixture.albumTwoFolder, "albumart-a.jpg")
	coverZulu := filepath.Join(fixture.albumTwoFolder, "albumart-z.jpg")
	writeTestFile(t, coverZulu, "albumart z")
	writeTestFile(t, coverAlpha, "albumart a")

	progressEvents := make(chan LibraryScanProgress, 32)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != libraryScanProgressEvent || len(optionalData) == 0 {
			return
		}

		payload, ok := optionalData[0].(LibraryScanProgress)
		if !ok {
			return
		}

		progressEvents <- payload
	}

	app := NewApp()
	app.ctx = context.Background()
	app.scanEntryMs = 5
	app.scanFinalizeMs = 25
	app.scanWatcherMs = 30
	app.scanLastTotalEntries = 2
	app.scanPreCountMs = 10
	t.Cleanup(func() {
		app.stopLibraryWatcher()
	})

	result := app.scanLibraryFolders([]AppLibraryFolder{
		{Path: fixture.rootOne, Label: "One", ReleaseDepth: 0},
		{Path: fixture.rootTwo, Label: "Two", ReleaseDepth: 0},
	}, true)
	if result.RootName != "Selected folders" {
		t.Fatalf("scanLibraryFolders(progress) rootName = %q, want %q", result.RootName, "Selected folders")
	}
	if result.TotalEntries != 12 || result.TrackCount != 2 || result.TextFileCount != 1 || result.ImageFileCount != 5 {
		t.Fatalf("scanLibraryFolders(progress) = %#v, want multi-root counts with added covers", result)
	}
	waitForLibraryWatcherToStart(t, app)
	if got := app.GetLibraryFolderCoverPath("Two/Artist Two/Album Two"); got != coverAlpha {
		t.Fatalf("GetLibraryFolderCoverPath(tie break) = %q, want %q", got, coverAlpha)
	}
	if app.scanEntryMs <= 0 || app.scanPreCountMs <= 0 || app.scanFinalizeMs <= 0 || app.scanWatcherMs <= 0 {
		t.Fatalf(
			"scan timing state = entry:%f precount:%f finalize:%f watcher:%f, want positive learned values",
			app.scanEntryMs,
			app.scanPreCountMs,
			app.scanFinalizeMs,
			app.scanWatcherMs,
		)
	}

	seenScanning := false
	seenFinalizing := false
	seenPositiveETA := false
	drainDeadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(drainDeadline) {
		select {
		case payload := <-progressEvents:
			if payload.EtaSeconds > 0 {
				seenPositiveETA = true
			}
			switch payload.Phase {
			case "scanning":
				seenScanning = true
			case "finalizing":
				seenFinalizing = true
			}
		default:
			if seenScanning && seenFinalizing && seenPositiveETA {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	if !seenScanning || !seenFinalizing || !seenPositiveETA {
		t.Fatalf(
			"progress phases = scanning:%t finalizing:%t eta:%t, want all true",
			seenScanning,
			seenFinalizing,
			seenPositiveETA,
		)
	}
}

func TestScanLibraryFoldersLargeScanUpdatesLearningMetrics(t *testing.T) {
	largeRoot := filepath.Join(t.TempDir(), "large-root")
	albumFolder := filepath.Join(largeRoot, "Artist", "Album")
	for index := 0; index < 600; index++ {
		writeTestFile(t, filepath.Join(albumFolder, fmt.Sprintf("%03d Track.flac", index)), "track")
	}
	for index := 0; index < 300; index++ {
		writeTestFile(t, filepath.Join(albumFolder, fmt.Sprintf("%03d Notes.txt", index)), "notes")
	}
	for index := 0; index < 300; index++ {
		writeTestFile(t, filepath.Join(albumFolder, fmt.Sprintf("%03d Image.png", index)), "image")
	}
	nonPreferredCover := filepath.Join(albumFolder, "cover.gif")
	unsupportedFile := filepath.Join(albumFolder, "ignored.bin")
	writeTestFile(t, nonPreferredCover, "gif")
	writeTestFile(t, unsupportedFile, "bin")

	app := NewApp()
	app.scanPreCountMs = 100
	app.scanEntryMs = 2
	app.scanFinalizeMs = 20

	result := app.scanLibraryFolders([]AppLibraryFolder{{Path: largeRoot, Label: "Large", ReleaseDepth: 0}}, false)
	if result.RootName != "Large" {
		t.Fatalf("scanLibraryFolders(large) rootName = %q, want %q", result.RootName, "Large")
	}
	if result.TrackCount != 600 || result.TextFileCount != 300 || result.ImageFileCount != 301 {
		t.Fatalf("scanLibraryFolders(large) = %#v, want counted audio/text/image files", result)
	}
	if result.TotalEntries != 1204 {
		t.Fatalf("scanLibraryFolders(large) totalEntries = %d, want %d", result.TotalEntries, 1204)
	}
	if _, exists := app.trackByPath[normalizePath(unsupportedFile)]; exists {
		t.Fatalf("scanLibraryFolders(large) should not index unsupported file %q", unsupportedFile)
	}
	if _, exists := app.imageByPath[normalizePath(nonPreferredCover)]; !exists {
		t.Fatalf("scanLibraryFolders(large) should index gif image %q", nonPreferredCover)
	}
	if got := app.GetLibraryFolderCoverPath("Large/Artist/Album"); got == nonPreferredCover {
		t.Fatalf("GetLibraryFolderCoverPath(large) = %q, want a preferred image instead of gif", got)
	}
	if app.scanPreCountMs <= 0 || app.scanEntryMs <= 0 || app.scanFinalizeMs <= 0 {
		t.Fatalf(
			"large scan learning state = precount:%f entry:%f finalize:%f, want positive metrics",
			app.scanPreCountMs,
			app.scanEntryMs,
			app.scanFinalizeMs,
		)
	}
}
