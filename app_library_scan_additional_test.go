package main

import (
	"path/filepath"
	"reflect"
	"testing"
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
