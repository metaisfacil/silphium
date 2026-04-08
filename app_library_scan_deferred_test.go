package main

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func TestScanLibraryFoldersDeferredEmitsHydrationEvents(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	fixture := createLibraryTestFixture(t)
	progressEvents := make(chan LibraryScanProgress, 8)
	updatedEvents := make(chan LibraryScanResult, 8)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if len(optionalData) == 0 {
			return
		}

		switch eventName {
		case libraryScanProgressEvent:
			payload, ok := optionalData[0].(LibraryScanProgress)
			if ok {
				progressEvents <- payload
			}
		case libraryScanUpdatedEvent:
			payload, ok := optionalData[0].(LibraryScanResult)
			if ok {
				updatedEvents <- payload
			}
		}
	}

	app := NewApp()
	app.ctx = context.Background()
	app.scanEntryMs = 1
	app.scanFinalizeMs = 20

	result := app.scanLibraryFoldersDeferred([]AppLibraryFolder{{
		Path:         fixture.rootOne,
		Label:        "Library",
		ReleaseDepth: 0,
	}}, false)
	if !result.DeferredFiles {
		t.Fatal("scanLibraryFoldersDeferred() deferredFiles = false, want true")
	}

	seenPositiveETA := false
	seenCompletionUpdate := false
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case payload := <-progressEvents:
			if payload.Phase == "finalizing" && payload.EtaSeconds > 0 {
				seenPositiveETA = true
			}
		case payload := <-updatedEvents:
			if !payload.DeferredFiles && payload.TrackCount == 1 && payload.TextFileCount == 1 && payload.ImageFileCount == 2 {
				seenCompletionUpdate = true
			}
		default:
			if seenPositiveETA && seenCompletionUpdate {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
	}

	if !seenPositiveETA || !seenCompletionUpdate {
		t.Fatalf(
			"deferred hydration events = eta:%t completion:%t, want both true",
			seenPositiveETA,
			seenCompletionUpdate,
		)
	}
	app.libraryScanGeneration.Add(1)
}

func TestScanLibraryFoldersDeferredUsesFilesystemQuickScan(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := NewApp()

	result := app.scanLibraryFoldersDeferred([]AppLibraryFolder{{
		Path:         fixture.rootOne,
		Label:        "Main Library",
		ReleaseDepth: 0,
	}}, false)

	if !result.DeferredFiles {
		t.Fatal("scanLibraryFoldersDeferred() deferredFiles = false, want true")
	}
	if result.TotalEntries != 6 {
		t.Fatalf("scanLibraryFoldersDeferred() totalEntries = %d, want 6", result.TotalEntries)
	}
	if result.TrackCount != 1 || result.TextFileCount != 1 || result.ImageFileCount != 2 {
		t.Fatalf(
			"scanLibraryFoldersDeferred() counts = tracks:%d text:%d images:%d, want 1/1/2",
			result.TrackCount,
			result.TextFileCount,
			result.ImageFileCount,
		)
	}
	if got := app.GetLibraryFolderCoverPath("Main Library/Artist One/Album One"); got != fixture.coverOne {
		t.Fatalf("GetLibraryFolderCoverPath() = %q, want %q", got, fixture.coverOne)
	}
	if got := app.ResolveLibraryFolderForPath(fixture.trackOne); got != "Main Library/Artist One/Album One" {
		t.Fatalf("ResolveLibraryFolderForPath(trackOne) = %q, want %q", got, "Main Library/Artist One/Album One")
	}
	if got := app.GetLibraryFolderTrackCount("Main Library"); got != 1 {
		t.Fatalf("GetLibraryFolderTrackCount() = %d, want 1", got)
	}

	app.libraryScanGeneration.Add(1)
}

func TestBuildFilesystemQuickScanAndLazyFilesystemHelpers(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	roots := []libraryRootConfig{{Path: fixture.rootOne, Name: "Library One"}, {Path: fixture.rootTwo, Name: "Library Two"}}

	quickScan, err := buildFilesystemQuickScan(roots, func() bool { return false })
	if err != nil {
		t.Fatalf("buildFilesystemQuickScan() error = %v", err)
	}
	if quickScan.ScanResult.DeferredFiles != true {
		t.Fatal("buildFilesystemQuickScan() deferredFiles = false, want true")
	}
	if quickScan.ScanResult.TrackCount != 2 || quickScan.ScanResult.TextFileCount != 1 || quickScan.ScanResult.ImageFileCount != 3 {
		t.Fatalf("buildFilesystemQuickScan() counts = tracks:%d text:%d images:%d", quickScan.ScanResult.TrackCount, quickScan.ScanResult.TextFileCount, quickScan.ScanResult.ImageFileCount)
	}
	if quickScan.ScanResult.TotalEntries != 10 {
		t.Fatalf("buildFilesystemQuickScan() totalEntries = %d, want 10", quickScan.ScanResult.TotalEntries)
	}
	if got := quickScan.ScanResult.CoverPathByFolder["library one/artist one/album one"]; got != fixture.coverOne {
		t.Fatalf("buildFilesystemQuickScan() cover = %q, want %q", got, fixture.coverOne)
	}

	folderPageEntries, err := listLibraryFolderEntriesFromFilesystem(roots, "Library One/Artist One/Album One")
	if err != nil {
		t.Fatalf("listLibraryFolderEntriesFromFilesystem() error = %v", err)
	}
	if got, want := browserEntryNames(folderPageEntries), []string{"01 Intro.flac", "notes.txt", "cover.jpg", "folder.jpg"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("listLibraryFolderEntriesFromFilesystem() names = %#v, want %#v", got, want)
	}

	trackPaths, err := collectLibraryFolderTrackPathsFromFilesystem(roots, "")
	if err != nil {
		t.Fatalf("collectLibraryFolderTrackPathsFromFilesystem(root) error = %v", err)
	}
	if got, want := trackPaths, []string{fixture.trackOne, fixture.trackTwo}; !reflect.DeepEqual(got, want) {
		t.Fatalf("collectLibraryFolderTrackPathsFromFilesystem(root) = %#v, want %#v", got, want)
	}

	if count, err := countLibraryFolderTracksFromFilesystem(roots, "Library One/Artist One"); err != nil || count != 1 {
		t.Fatalf("countLibraryFolderTracksFromFilesystem() = (%d, %v), want (1, nil)", count, err)
	}
}
