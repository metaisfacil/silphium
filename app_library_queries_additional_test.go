package main

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func newIndexedLibraryAppForTests(t *testing.T) (*App, libraryTestFixture) {
	t.Helper()

	fixture := createLibraryTestFixture(t)
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library One"}, {Path: fixture.rootTwo, Name: "Library Two"}}
	app.trackByPath = map[string]LibraryIndexedFile{}
	app.textByPath = map[string]LibraryIndexedFile{}
	app.imageByPath = map[string]LibraryIndexedFile{}
	app.libraryScan = LibraryScanResult{
		CoverPathByFolder: map[string]string{},
	}
	app.libraryDerivedIndexDirty = true
	app.searchResultsByQuery = make(map[string][]LibraryBrowserEntry)
	app.scanRemainingImmediateChildrenByFolder = map[string]int{}

	for _, root := range app.activeLibraryRoots {
		for _, candidate := range []string{fixture.trackOne, fixture.noteOne, fixture.coverOne, fixture.folderCoverOne, fixture.trackTwo, fixture.imageTwo} {
			if pathWithinRoot(root.Path, candidate) {
				app.addOrUpdateIndexedFile(root, candidate, filepath.Base(candidate))
			}
		}
	}

	app.libraryScan.TrackFiles = []LibraryIndexedFile{app.trackByPath[fixture.trackOne], app.trackByPath[fixture.trackTwo]}
	app.libraryScan.TextFiles = []LibraryIndexedFile{app.textByPath[fixture.noteOne]}
	app.libraryScan.ImageFiles = []LibraryIndexedFile{app.imageByPath[fixture.coverOne], app.imageByPath[fixture.folderCoverOne], app.imageByPath[fixture.imageTwo]}
	app.libraryScan.CoverPathByFolder[strings.ToLower(app.imageByPath[fixture.coverOne].FolderPath)] = fixture.coverOne

	indexData := buildLibraryDerivedIndexData(app.libraryScan.TrackFiles, app.libraryScan.TextFiles, app.libraryScan.ImageFiles)
	app.folderEntriesByFolder = indexData.folderEntriesByFolder
	app.folderChildPathsByFolder = indexData.folderChildPathsByFolder
	app.trackFilesByFolder = indexData.trackFilesByFolder
	app.searchFolderEntries = indexData.searchFolderEntries
	app.searchTrackEntries = indexData.searchTrackEntries
	app.searchTextEntries = indexData.searchTextEntries
	app.searchImageEntries = indexData.searchImageEntries
	app.libraryDerivedIndexDirty = false
	app.libraryDerivedIndexBuilding = false

	return app, fixture
}

func TestLibraryIndexAndQueryHelpers(t *testing.T) {
	app, fixture := newIndexedLibraryAppForTests(t)

	longQuery := strings.Repeat("a", 90)
	if got := searchQueryForLog(longQuery); len(got) != 80 || !strings.HasSuffix(got, "...") {
		t.Fatalf("searchQueryForLog(long) = %q, want 80-char truncated log query", got)
	}

	folderChildren := map[string]map[string]struct{}{}
	folderPaths := map[string]struct{}{}
	addFolderAncestorsToIndex("  Library One/Artist One/Album One  ", folderChildren, folderPaths)
	addFolderAncestorsToIndex("", folderChildren, folderPaths)
	if _, exists := folderPaths["Library One/Artist One/Album One"]; !exists {
		t.Fatalf("addFolderAncestorsToIndex() folderPaths = %#v, want album path", folderPaths)
	}

	entries, canceled := filterSearchEntries(nil, "intro", nil)
	if canceled || len(entries) != 0 {
		t.Fatalf("filterSearchEntries(nil) = (%#v, %t), want empty and false", entries, canceled)
	}
	entries, canceled = filterSearchEntries(app.searchTrackEntries, "intro", func() bool { return true })
	if !canceled || len(entries) != 0 {
		t.Fatalf("filterSearchEntries(canceled) = (%#v, %t), want empty and true", entries, canceled)
	}

	app.searchResultsByQuery = nil
	for index := 0; index < librarySearchCacheLimit+1; index++ {
		query := filepath.Base(filepath.Join("query", string(rune('a'+(index%26))))) + string(rune('0'+(index%10)))
		app.rememberSearchResultLocked(query, []LibraryBrowserEntry{{Path: query}})
	}
	if got, want := len(app.searchCacheOrder), librarySearchCacheLimit; got != want {
		t.Fatalf("rememberSearchResultLocked() cache size = %d, want %d", got, want)
	}

	app.searchResultsByQuery = map[string][]LibraryBrowserEntry{"intro": app.searchTrackEntries}
	if entries, mode, canceled := app.buildSearchResultsLocked("intro", nil); canceled || mode != "cache-hit" || len(entries) == 0 {
		t.Fatalf("buildSearchResultsLocked(cache-hit) = (%#v, %q, %t), want cached entries", entries, mode, canceled)
	}

	app.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	app.searchLastQuery = "int"
	app.searchLastResults = app.searchTrackEntries
	if entries, mode, canceled := app.buildSearchResultsLocked("intro", nil); canceled || mode != "prefix-filter" || len(entries) == 0 {
		t.Fatalf("buildSearchResultsLocked(prefix) = (%#v, %q, %t), want prefix-filter results", entries, mode, canceled)
	}

	app.searchLastQuery = ""
	app.searchLastResults = nil
	if entries, mode, canceled := app.buildSearchResultsLocked("album", nil); canceled || mode != "full-filter" || len(entries) == 0 {
		t.Fatalf("buildSearchResultsLocked(full) = (%#v, %q, %t), want full-filter results", entries, mode, canceled)
	}
	app.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	app.searchLastQuery = ""
	app.searchLastResults = nil
	if _, _, canceled := app.buildSearchResultsLocked("album", func() bool { return true }); !canceled {
		t.Fatal("buildSearchResultsLocked(canceled) = false, want true")
	}

	if got, want := app.getFolderTrackPathsFromMapsLocked("Library One/Artist One"), []string{fixture.trackOne}; len(got) != len(want) || got[0] != want[0] {
		t.Fatalf("getFolderTrackPathsFromMapsLocked() = %#v, want %#v", got, want)
	}
	if got, want := app.getFolderTrackPathsFromMapsLocked(""), []string{fixture.trackOne, fixture.trackTwo}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("getFolderTrackPathsFromMapsLocked(root) = %#v, want %#v", got, want)
	}
	if got := app.getFolderTrackCountFromMapsLocked("Library One/Artist One"); got != 1 {
		t.Fatalf("getFolderTrackCountFromMapsLocked() = %d, want 1", got)
	}
	if got := app.getFolderTrackCountFromMapsLocked(""); got != 2 {
		t.Fatalf("getFolderTrackCountFromMapsLocked(root) = %d, want 2", got)
	}
	if got := app.getFolderTrackPathsFromDerivedIndexLocked("missing"); len(got) != 0 {
		t.Fatalf("getFolderTrackPathsFromDerivedIndexLocked(missing) = %#v, want empty", got)
	}
	if got, want := app.getFolderTrackPathsFromDerivedIndexLocked(""), []string{fixture.trackOne, fixture.trackTwo}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("getFolderTrackPathsFromDerivedIndexLocked(root) = %#v, want %#v", got, want)
	}
	if got := app.getFolderTrackCountFromDerivedIndexLocked("missing"); got != 0 {
		t.Fatalf("getFolderTrackCountFromDerivedIndexLocked(missing) = %d, want 0", got)
	}
	if got := app.getFolderTrackCountFromDerivedIndexLocked(""); got != 2 {
		t.Fatalf("getFolderTrackCountFromDerivedIndexLocked(root) = %d, want 2", got)
	}
	savedTrackFilesByFolder := app.trackFilesByFolder
	savedFolderChildPathsByFolder := app.folderChildPathsByFolder
	app.trackFilesByFolder = nil
	app.folderChildPathsByFolder = nil
	if got := app.getFolderTrackPathsFromDerivedIndexLocked(""); len(got) != 0 {
		t.Fatalf("getFolderTrackPathsFromDerivedIndexLocked(nil maps) = %#v, want empty", got)
	}
	if got := app.getFolderTrackCountFromDerivedIndexLocked(""); got != 0 {
		t.Fatalf("getFolderTrackCountFromDerivedIndexLocked(nil maps) = %d, want 0", got)
	}
	app.trackFilesByFolder = savedTrackFilesByFolder
	app.folderChildPathsByFolder = savedFolderChildPathsByFolder

	app.libraryDerivedIndexDirty = true
	app.libraryDerivedIndexBuilding = true
	if got := app.resolveAvailableLibraryFolderForVirtualPathLocked("../escape"); got != "" {
		t.Fatalf("resolveAvailableLibraryFolderForVirtualPathLocked(invalid) = %q, want empty", got)
	}
	app.libraryDerivedIndexDirty = false
	app.libraryDerivedIndexBuilding = false
	if got := app.resolveAvailableLibraryFolderForVirtualPathLocked("Library One/Artist One/Album One"); got != "Library One/Artist One/Album One" {
		t.Fatalf("resolveAvailableLibraryFolderForVirtualPathLocked(valid) = %q, want same path", got)
	}

	if got := app.ResolveLibraryFolderForPath(fixture.trackOne); got != "Library One/Artist One/Album One" {
		t.Fatalf("ResolveLibraryFolderForPath(track) = %q, want album folder", got)
	}
	if got := app.ResolveLibraryFolderForPath(fixture.noteOne); got != "Library One/Artist One/Album One" {
		t.Fatalf("ResolveLibraryFolderForPath(text) = %q, want album folder", got)
	}
	if got := app.ResolveLibraryFolderForPath(fixture.outsideTrack); got != "" {
		t.Fatalf("ResolveLibraryFolderForPath(outside) = %q, want empty", got)
	}

	if page := app.GetLibraryIndexedFilePage("track", 0, 1); page.Kind != "track" || len(page.Entries) != 1 {
		t.Fatalf("GetLibraryIndexedFilePage(track) = %#v, want one track", page)
	}
	if page := app.GetLibraryIndexedFilePage("text-file", 0, 10); page.Kind != "text-file" || len(page.Entries) != 1 {
		t.Fatalf("GetLibraryIndexedFilePage(text-file) = %#v, want one text file", page)
	}
	if page := app.GetLibraryIndexedFilePage("image-file", 0, 10); page.Kind != "image-file" || len(page.Entries) != 3 {
		t.Fatalf("GetLibraryIndexedFilePage(image-file) = %#v, want three image files", page)
	}
	if page := app.GetLibraryIndexedFilePage("unknown", 0, 1); page.Kind != "unknown" || len(page.Entries) != 0 {
		t.Fatalf("GetLibraryIndexedFilePage(unknown) = %#v, want empty page", page)
	}

	app.scanInProgress = true
	app.scanRemainingImmediateChildrenByFolder["Library One/Artist One"] = 1
	if app.IsLibraryFolderImmediateDescendantsEnumerated("Library One/Artist One") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(pending) = true, want false")
	}
	app.scanRemainingImmediateChildrenByFolder["Library One/Artist One"] = 0
	if !app.IsLibraryFolderImmediateDescendantsEnumerated("Library One/Artist One") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(done) = false, want true")
	}
	if app.IsLibraryFolderImmediateDescendantsEnumerated("../escape") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(invalid) = true, want false")
	}

	if got := app.GetLibraryFolderCoverPath("Library One/Artist One/Album One"); got != fixture.coverOne {
		t.Fatalf("GetLibraryFolderCoverPath() = %q, want %q", got, fixture.coverOne)
	}
	app.libraryScan.CoverPathByFolder = nil
	if got := app.GetLibraryFolderCoverPath("Library One/Artist One/Album One"); got != "" {
		t.Fatalf("GetLibraryFolderCoverPath(nil map) = %q, want empty", got)
	}

	app.libraryScan.CoverPathByFolder = map[string]string{strings.ToLower("Library One/Artist One/Album One"): fixture.coverOne}
	if got := app.GetLibraryFolderTrackPaths(""); len(got) != 2 || got[0] != fixture.trackOne || got[1] != fixture.trackTwo {
		t.Fatalf("GetLibraryFolderTrackPaths(root) = %#v, want both indexed tracks", got)
	}
	if got := app.GetLibraryFolderTrackPaths("Library One/Artist One"); len(got) != 1 || got[0] != fixture.trackOne {
		t.Fatalf("GetLibraryFolderTrackPaths() = %#v, want track one", got)
	}
	if got := app.GetLibraryFolderTrackPaths("../escape"); len(got) != 0 {
		t.Fatalf("GetLibraryFolderTrackPaths(invalid) = %#v, want empty", got)
	}
	if got := app.GetLibraryFolderTrackCount(""); got != 2 {
		t.Fatalf("GetLibraryFolderTrackCount(root) = %d, want 2", got)
	}
	if got := app.GetLibraryFolderTrackCount("Library One/Artist One"); got != 1 {
		t.Fatalf("GetLibraryFolderTrackCount() = %d, want 1", got)
	}
	if got := app.GetLibraryFolderTrackCount("../escape"); got != 0 {
		t.Fatalf("GetLibraryFolderTrackCount(invalid) = %d, want 0", got)
	}
}

func TestLibraryQueryFallbackPagingAndMusicBrainzTagSearch(t *testing.T) {
	app, fixture := newIndexedLibraryAppForTests(t)

	derivedPage := app.GetLibraryFolderPage("Library One/Artist One", 0, 10)
	if derivedPage.TotalEntries != 1 || len(derivedPage.Entries) != 1 || derivedPage.Entries[0].Path != "Library One/Artist One/Album One" {
		t.Fatalf("GetLibraryFolderPage(derived index) = %#v, want the album child entry", derivedPage)
	}

	app.scanInProgress = true
	app.libraryDerivedIndexDirty = true
	app.libraryDerivedIndexBuilding = false

	invalidPage := app.GetLibraryFolderPage("../escape", 0, 0)
	if invalidPage.TotalEntries != 0 || len(invalidPage.Entries) != 0 {
		t.Fatalf("GetLibraryFolderPage(invalid) = %#v, want empty page", invalidPage)
	}

	artistPage := app.GetLibraryFolderPage("Library One/Artist One", 0, 0)
	if artistPage.Limit != 100 {
		t.Fatalf("GetLibraryFolderPage(default limit) = %d, want 100", artistPage.Limit)
	}
	if artistPage.TotalEntries != 1 || len(artistPage.Entries) != 1 || artistPage.Entries[0].Path != "Library One/Artist One/Album One" {
		t.Fatalf("GetLibraryFolderPage(fallback map) = %#v, want the album child entry", artistPage)
	}

	newerAlbumFolder := filepath.Join(fixture.rootOne, "Artist One", "Album Two")
	newerTrackPath := filepath.Join(newerAlbumFolder, "02 Newer.flac")
	writeTestFile(t, newerTrackPath, "newer")
	olderTimestamp := time.Unix(1_700_000_000, 0)
	newerTimestamp := olderTimestamp.Add(2 * time.Hour)
	if err := os.Chtimes(fixture.trackOne, olderTimestamp, olderTimestamp); err != nil {
		t.Fatalf("Chtimes(%q) error = %v", fixture.trackOne, err)
	}
	if err := os.Chtimes(fixture.noteOne, olderTimestamp, olderTimestamp); err != nil {
		t.Fatalf("Chtimes(%q) error = %v", fixture.noteOne, err)
	}
	if err := os.Chtimes(fixture.coverOne, olderTimestamp, olderTimestamp); err != nil {
		t.Fatalf("Chtimes(%q) error = %v", fixture.coverOne, err)
	}
	if err := os.Chtimes(fixture.folderCoverOne, olderTimestamp, olderTimestamp); err != nil {
		t.Fatalf("Chtimes(%q) error = %v", fixture.folderCoverOne, err)
	}
	if err := os.Chtimes(newerTrackPath, newerTimestamp, newerTimestamp); err != nil {
		t.Fatalf("Chtimes(%q) error = %v", newerTrackPath, err)
	}

	root := app.activeLibraryRoots[0]
	app.addOrUpdateIndexedFile(root, fixture.trackOne, filepath.Base(fixture.trackOne))
	app.addOrUpdateIndexedFile(root, fixture.noteOne, filepath.Base(fixture.noteOne))
	app.addOrUpdateIndexedFile(root, fixture.coverOne, filepath.Base(fixture.coverOne))
	app.addOrUpdateIndexedFile(root, fixture.folderCoverOne, filepath.Base(fixture.folderCoverOne))
	app.addOrUpdateIndexedFile(root, newerTrackPath, filepath.Base(newerTrackPath))
	app.libraryScan.TrackFiles = []LibraryIndexedFile{app.trackByPath[fixture.trackOne], app.trackByPath[fixture.trackTwo], app.trackByPath[newerTrackPath]}
	app.libraryScan.TextFiles = []LibraryIndexedFile{app.textByPath[fixture.noteOne]}
	app.libraryScan.ImageFiles = []LibraryIndexedFile{app.imageByPath[fixture.coverOne], app.imageByPath[fixture.folderCoverOne], app.imageByPath[fixture.imageTwo]}
	indexData := buildLibraryDerivedIndexData(app.libraryScan.TrackFiles, app.libraryScan.TextFiles, app.libraryScan.ImageFiles)
	app.folderEntriesByFolder = indexData.folderEntriesByFolder
	app.folderChildPathsByFolder = indexData.folderChildPathsByFolder
	app.trackFilesByFolder = indexData.trackFilesByFolder
	app.searchFolderEntries = indexData.searchFolderEntries
	app.searchTrackEntries = indexData.searchTrackEntries
	app.searchTextEntries = indexData.searchTextEntries
	app.searchImageEntries = indexData.searchImageEntries
	app.libraryDerivedIndexDirty = false
	app.libraryDerivedIndexBuilding = false

	dateDescPage := app.GetLibraryFolderPageSorted("Library One/Artist One", "date-desc", 0, 10)
	if dateDescPage.TotalEntries != 2 || len(dateDescPage.Entries) != 2 || dateDescPage.Entries[0].Path != "Library One/Artist One/Album Two" {
		t.Fatalf("GetLibraryFolderPageSorted(date-desc) = %#v, want newer album first", dateDescPage)
	}

	dateAscPage := app.GetLibraryFolderPageSorted("Library One/Artist One", "date-asc", 0, 10)
	if dateAscPage.TotalEntries != 2 || len(dateAscPage.Entries) != 2 || dateAscPage.Entries[0].Path != "Library One/Artist One/Album One" {
		t.Fatalf("GetLibraryFolderPageSorted(date-asc) = %#v, want older album first", dateAscPage)
	}

	if got := app.ResolveLibraryFolderForPath(filepath.Join(fixture.rootOne, "Artist One", "Missing Album", "01 Missing.flac")); got != "" {
		t.Fatalf("ResolveLibraryFolderForPath(unavailable folder) = %q, want empty", got)
	}

	emptySearch := app.SearchLibrary("   ", 0, 0)
	if emptySearch.Limit != 100 || emptySearch.TotalEntries != 0 || len(emptySearch.Entries) != 0 {
		t.Fatalf("SearchLibrary(empty) = %#v, want empty search page with default limit", emptySearch)
	}

	fallbackSearch := app.SearchLibrary("intro", 0, 0)
	if fallbackSearch.Limit != 100 {
		t.Fatalf("SearchLibrary(default limit) = %d, want 100", fallbackSearch.Limit)
	}
	if !hasBrowserEntry(fallbackSearch.Entries, "track", fixture.trackOne) {
		t.Fatalf("SearchLibrary(fallback map) missing track %q: %#v", fixture.trackOne, fallbackSearch.Entries)
	}

	app.settingsLoaded = true
	app.settings.MusicBrainzTagDatabaseEnabled = true
	app.musicBrainzTagStoreLoaded = true
	app.musicBrainzTagStore = newMusicBrainzTagDatabaseStore()

	const releaseID = "11111111-1111-4111-8111-111111111111"
	const artistID = "22222222-2222-4222-8222-222222222222"
	releaseKey := musicBrainzTagEntityKey("release", releaseID)
	artistKey := musicBrainzTagEntityKey("artist", artistID)
	app.musicBrainzTagStore.Entities[releaseKey] = musicBrainzTagEntityRecord{EntityType: "release", MBID: releaseID}
	app.musicBrainzTagStore.Entities[artistKey] = musicBrainzTagEntityRecord{EntityType: "artist", MBID: artistID}
	app.musicBrainzTagEntityKeysByTag = map[string]map[string]struct{}{
		"rock": {
			releaseKey: {},
			artistKey:  {},
		},
	}
	app.musicBrainzTagReleaseFoldersByID = map[string]map[string]struct{}{
		releaseID: {
			"Library One/Artist One/Album One": {},
		},
	}
	app.musicBrainzTagArtistFoldersByID = map[string]map[string]struct{}{
		artistID: {
			"Library One/Artist One": {},
		},
	}
	app.musicBrainzTagReleaseFoldersByArtistID = map[string]map[string]struct{}{
		artistID: {
			"Library One/Artist One/Album One": {},
		},
	}

	tagSearch := app.SearchLibrary(`mbtag: "rock"`, 0, 20)
	if !hasBrowserEntry(tagSearch.Entries, "folder", "Library One/Artist One") {
		t.Fatalf("SearchLibrary(mbtag) missing artist folder: %#v", tagSearch.Entries)
	}
	if !hasBrowserEntry(tagSearch.Entries, "folder", "Library One/Artist One/Album One") {
		t.Fatalf("SearchLibrary(mbtag) missing album folder: %#v", tagSearch.Entries)
	}
	if !hasBrowserEntry(tagSearch.Entries, "track", fixture.trackOne) {
		t.Fatalf("SearchLibrary(mbtag) missing track %q: %#v", fixture.trackOne, tagSearch.Entries)
	}

	albumFolderTagged := false
	artistFolderTagged := false
	for _, entry := range tagSearch.Entries {
		if entry.Kind != "folder" {
			continue
		}

		if entry.Path == "Library One/Artist One/Album One" {
			albumFolderTagged = entry.MusicBrainzTaggedAlbumDir
		}
		if entry.Path == "Library One/Artist One" {
			artistFolderTagged = entry.MusicBrainzTaggedAlbumDir
		}
	}
	if !albumFolderTagged {
		t.Fatalf("SearchLibrary(mbtag) album folder tag highlight = false, want true: %#v", tagSearch.Entries)
	}
	if artistFolderTagged {
		t.Fatalf("SearchLibrary(mbtag) artist folder tag highlight = true, want false: %#v", tagSearch.Entries)
	}

	app.musicBrainzTagReleaseFoldersByID[releaseID] = map[string]struct{}{
		"Library One/Artist One/01 Missing Album": {},
		"Library One/Artist One/Album One":        {},
	}
	if got := app.ResolveLibraryFolderForReleaseMBID(releaseID); got != "Library One/Artist One/Album One" {
		t.Fatalf("ResolveLibraryFolderForReleaseMBID() = %q, want %q", got, "Library One/Artist One/Album One")
	}
	if got := app.ResolveLibraryFolderForReleaseMBID("not-an-mbid"); got != "" {
		t.Fatalf("ResolveLibraryFolderForReleaseMBID(invalid) = %q, want empty", got)
	}

	app.settings.MusicBrainzTagDatabaseEnabled = false
	if got := app.ResolveLibraryFolderForReleaseMBID(releaseID); got != "" {
		t.Fatalf("ResolveLibraryFolderForReleaseMBID(disabled) = %q, want empty", got)
	}

	emptyTagSearch := app.SearchLibrary("mbtag:", 0, 20)
	if emptyTagSearch.TotalEntries != 0 || len(emptyTagSearch.Entries) != 0 {
		t.Fatalf("SearchLibrary(empty mbtag) = %#v, want empty search results", emptyTagSearch)
	}
}

func TestLibraryQueryAdditionalFallbackAndPathBranches(t *testing.T) {
	app, fixture := newIndexedLibraryAppForTests(t)

	if got := app.resolveAvailableLibraryFolderForVirtualPathLocked("Library One/Missing Album"); got != "" {
		t.Fatalf("resolveAvailableLibraryFolderForVirtualPathLocked(derived missing) = %q, want empty", got)
	}

	app.scanInProgress = true
	app.libraryDerivedIndexDirty = true
	app.libraryDerivedIndexBuilding = false
	if got := app.resolveAvailableLibraryFolderForVirtualPathLocked("Library One/Missing Album"); got != "" {
		t.Fatalf("resolveAvailableLibraryFolderForVirtualPathLocked(fallback missing) = %q, want empty", got)
	}

	if got := app.ResolveLibraryFolderForPath("   "); got != "" {
		t.Fatalf("ResolveLibraryFolderForPath(invalid) = %q, want empty", got)
	}
	if got := app.ResolveLibraryFolderForPath(fixture.coverOne); got != "Library One/Artist One/Album One" {
		t.Fatalf("ResolveLibraryFolderForPath(image) = %q, want album folder", got)
	}

	app.scanInProgress = false
	if !app.IsLibraryFolderImmediateDescendantsEnumerated("Library One/Missing Album") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(idle) = false, want true")
	}
	app.scanInProgress = true
	delete(app.scanRemainingImmediateChildrenByFolder, "Library One/Missing Album")
	if !app.IsLibraryFolderImmediateDescendantsEnumerated("Library One/Missing Album") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(missing key) = false, want true")
	}

	if got := app.GetLibraryFolderCoverPath("   "); got != "" {
		t.Fatalf("GetLibraryFolderCoverPath(invalid) = %q, want empty", got)
	}
	if got := app.GetLibraryFolderCoverPath("../escape"); got != "" {
		t.Fatalf("GetLibraryFolderCoverPath(parent escape) = %q, want empty", got)
	}

	if got := app.GetLibraryFolderTrackPaths("Library One/Artist One"); len(got) != 1 || got[0] != fixture.trackOne {
		t.Fatalf("GetLibraryFolderTrackPaths(fallback map) = %#v, want track one", got)
	}
	if got := app.GetLibraryFolderTrackCount("Library One/Artist One"); got != 1 {
		t.Fatalf("GetLibraryFolderTrackCount(fallback map) = %d, want 1", got)
	}
}

func TestLibraryQueryFallbackIncludesDiscoveredFoldersDuringScan(t *testing.T) {
	app, _ := newIndexedLibraryAppForTests(t)

	app.scanInProgress = true
	app.libraryDerivedIndexDirty = true
	app.libraryDerivedIndexBuilding = false
	app.scanDiscoveredChildFoldersByParent = map[string]map[string]struct{}{
		"": {
			"Library One": {},
		},
		"Library One": {
			"Library One/Artist Pending": {},
		},
		"Library One/Artist Pending": {
			"Library One/Artist Pending/Album Pending": {},
		},
	}
	app.scanRemainingImmediateChildrenByFolder["Library One/Artist Pending"] = 1

	page := app.GetLibraryFolderPage("Library One", 0, 10)
	if !hasBrowserEntry(page.Entries, "folder", "Library One/Artist Pending") {
		t.Fatalf("GetLibraryFolderPage(scan discovered folders) missing pending folder: %#v", page.Entries)
	}

	search := app.SearchLibrary("pending", 0, 20)
	if !hasBrowserEntry(search.Entries, "folder", "Library One/Artist Pending") {
		t.Fatalf("SearchLibrary(scan discovered folders) missing pending artist folder: %#v", search.Entries)
	}
	if !hasBrowserEntry(search.Entries, "folder", "Library One/Artist Pending/Album Pending") {
		t.Fatalf("SearchLibrary(scan discovered folders) missing pending album folder: %#v", search.Entries)
	}

	if app.IsLibraryFolderImmediateDescendantsEnumerated("Library One/Artist Pending") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(discovered pending) = true, want false")
	}
	delete(app.scanRemainingImmediateChildrenByFolder, "Library One/Artist Pending")
	if !app.IsLibraryFolderImmediateDescendantsEnumerated("Library One/Artist Pending") {
		t.Fatal("IsLibraryFolderImmediateDescendantsEnumerated(discovered ready) = false, want true")
	}
}

func TestLibraryFolderPageReadLockDoesNotBlockConcurrentReads(t *testing.T) {
	app, _ := newIndexedLibraryAppForTests(t)

	app.indexMu.RLock()
	defer app.indexMu.RUnlock()

	resultCh := make(chan LibraryFolderPage, 1)
	go func() {
		resultCh <- app.GetLibraryFolderPageSorted("Library One/Artist One", "name", 0, 10)
	}()

	select {
	case result := <-resultCh:
		if result.TotalEntries != 1 || len(result.Entries) != 1 || result.Entries[0].Path != "Library One/Artist One/Album One" {
			t.Fatalf("GetLibraryFolderPageSorted(concurrent read) = %#v, want album child entry", result)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("GetLibraryFolderPageSorted() blocked behind a concurrent read lock")
	}
}

func TestGetLibraryFolderPageSortedUsesMusicBrainzTaggedAlbumLookupCache(t *testing.T) {
	app, _ := newIndexedLibraryAppForTests(t)
	app.settingsLoaded = true
	app.settings.MusicBrainzTagDatabaseEnabled = true
	app.musicBrainzTagStoreLoaded = true
	app.musicBrainzTagReleaseFoldersByID = map[string]map[string]struct{}{
		"11111111-1111-4111-8111-111111111111": {
			"Library One/Artist One/Album One": {},
		},
	}
	app.musicBrainzTagReleaseFolderRefCounts = nil

	page := app.GetLibraryFolderPageSorted("Library One/Artist One", "name", 0, 10)
	if len(app.musicBrainzTagReleaseFolderRefCounts) != 1 {
		t.Fatalf("musicBrainzTagReleaseFolderRefCounts = %#v, want one cached album folder", app.musicBrainzTagReleaseFolderRefCounts)
	}

	albumOneTagged := false
	albumTwoTagged := false
	for _, entry := range page.Entries {
		if entry.Kind != "folder" {
			continue
		}
		if entry.Path == "Library One/Artist One/Album One" {
			albumOneTagged = entry.MusicBrainzTaggedAlbumDir
		}
		if entry.Path == "Library One/Artist One/Album Two" {
			albumTwoTagged = entry.MusicBrainzTaggedAlbumDir
		}
	}
	if !albumOneTagged {
		t.Fatalf("GetLibraryFolderPageSorted() = %#v, want Album One tagged", page)
	}
	if albumTwoTagged {
		t.Fatalf("GetLibraryFolderPageSorted() = %#v, want Album Two untagged", page)
	}
}

func TestSearchLibraryCancellationAfterLock(t *testing.T) {
	app, _ := newIndexedLibraryAppForTests(t)

	app.indexMu.Lock()
	resultCh := make(chan LibrarySearchPage, 1)
	go func() {
		resultCh <- app.SearchLibrary("intro", 0, 10)
	}()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if app.searchGeneration.Load() == 1 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if app.searchGeneration.Load() != 1 {
		app.indexMu.Unlock()
		t.Fatalf("SearchLibrary() did not update the search generation while waiting for the lock: got %d", app.searchGeneration.Load())
	}

	app.searchGeneration.Add(1)
	app.indexMu.Unlock()

	result := <-resultCh
	if result.Query != "intro" || result.Offset != 0 || result.Limit != 10 || result.TotalEntries != 0 || len(result.Entries) != 0 {
		t.Fatalf("SearchLibrary(canceled after lock) = %#v, want an empty canceled result page", result)
	}
}

func TestSearchLibraryCancellationBeforeLock(t *testing.T) {
	app, _ := newIndexedLibraryAppForTests(t)
	query := "mbtag:" + strings.Repeat("tag,", 3000000)
	stopUpdates := make(chan struct{})
	defer close(stopUpdates)

	go func() {
		for app.searchGeneration.Load() == 0 {
			select {
			case <-stopUpdates:
				return
			default:
				runtime.Gosched()
			}
		}

		for {
			select {
			case <-stopUpdates:
				return
			default:
				app.searchGeneration.Add(1)
			}
		}
	}()

	result := app.SearchLibrary(query, 0, 10)

	if app.searchGeneration.Load() <= 1 {
		t.Fatalf("SearchLibrary(canceled before lock) searchGeneration = %d, want concurrent update", app.searchGeneration.Load())
	}
	if result.Query != query || result.Offset != 0 || result.Limit != 10 || result.TotalEntries != 0 || len(result.Entries) != 0 {
		t.Fatalf("SearchLibrary(canceled before lock) = %#v, want an empty canceled result page", result)
	}
	if len(app.searchResultsByQuery) != 0 {
		t.Fatalf("SearchLibrary(canceled before lock) populated search cache = %#v, want empty cache", app.searchResultsByQuery)
	}
}

func TestSearchLibraryCancellationAfterBuild(t *testing.T) {
	app, _ := newIndexedLibraryAppForTests(t)
	app.ctx = context.Background()

	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	scheduledCancellation := make(chan struct{}, 1)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != libraryRescanLogEvent || len(optionalData) == 0 {
			return
		}

		logLine, _ := optionalData[0].(string)
		if !strings.Contains(logLine, "SearchLibrary acquired lock") {
			return
		}

		select {
		case scheduledCancellation <- struct{}{}:
			app.searchGeneration.Add(1)
		default:
		}
	}

	largeResults := make([]LibraryBrowserEntry, 300000)
	repeatedEntry := LibraryBrowserEntry{
		Kind:         "track",
		Name:         "Intro",
		Path:         "Library One/Artist One/Album One/01 Intro.flac",
		FolderPath:   "Library One/Artist One/Album One",
		RelativePath: "Artist One/Album One/01 Intro.flac",
	}
	for index := range largeResults {
		largeResults[index] = repeatedEntry
	}
	app.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	app.searchLastQuery = "in"
	app.searchLastResults = largeResults

	result := app.SearchLibrary("intro", 0, 10)

	select {
	case <-scheduledCancellation:
	default:
		t.Fatal("SearchLibrary() did not emit the acquired-lock rescan event")
	}

	if result.Query != "intro" || result.Offset != 0 || result.Limit != 10 || result.TotalEntries != 0 || len(result.Entries) != 0 {
		t.Fatalf("SearchLibrary(canceled after build) = %#v, want an empty canceled result page", result)
	}
	if app.searchLastQuery != "in" {
		t.Fatalf("SearchLibrary(canceled after build) updated searchLastQuery = %q, want prefix cache to remain unchanged", app.searchLastQuery)
	}
	if len(app.searchLastResults) != len(largeResults) {
		t.Fatalf("SearchLibrary(canceled after build) changed searchLastResults length = %d, want %d", len(app.searchLastResults), len(largeResults))
	}
}

func TestLibraryIndexCancellationAndFolderBranches(t *testing.T) {
	makeEntries := func(kind string, count int) []LibraryBrowserEntry {
		entries := make([]LibraryBrowserEntry, count)
		for index := range entries {
			entries[index] = LibraryBrowserEntry{
				Kind:         kind,
				Name:         "Intro",
				Path:         "Library One/Artist One/Album One/01 Intro.flac",
				RelativePath: "Artist One/Album One/01 Intro.flac",
			}
		}
		return entries
	}

	folderChildren := map[string]map[string]struct{}{}
	folderPaths := map[string]struct{}{}
	addFolderAncestorsToIndex("Library One//Artist One///Album One", folderChildren, folderPaths)
	if _, exists := folderPaths["Library One/Artist One/Album One"]; !exists {
		t.Fatalf("addFolderAncestorsToIndex(double slashes) = %#v, want normalized ancestor path", folderPaths)
	}

	searchResultsApp := &App{}
	searchResultsApp.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	searchResultsApp.searchTrackEntries = makeEntries("track", 257)
	if _, _, canceled := searchResultsApp.buildSearchResultsLocked("intro", func() bool { return true }); !canceled {
		t.Fatal("buildSearchResultsLocked(track canceled) = false, want true")
	}

	searchResultsApp = &App{}
	searchResultsApp.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	searchResultsApp.searchTextEntries = makeEntries("text-file", 257)
	if _, _, canceled := searchResultsApp.buildSearchResultsLocked("intro", func() bool { return true }); !canceled {
		t.Fatal("buildSearchResultsLocked(text canceled) = false, want true")
	}

	searchResultsApp = &App{}
	searchResultsApp.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	searchResultsApp.searchImageEntries = makeEntries("image-file", 257)
	if _, _, canceled := searchResultsApp.buildSearchResultsLocked("intro", func() bool { return true }); !canceled {
		t.Fatal("buildSearchResultsLocked(image canceled) = false, want true")
	}

	searchResultsApp = &App{}
	searchResultsApp.searchResultsByQuery = map[string][]LibraryBrowserEntry{}
	if _, _, canceled := searchResultsApp.buildSearchResultsLocked("intro", func() bool { return true }); !canceled {
		t.Fatal("buildSearchResultsLocked(post-filter cancel) = false, want true")
	}

	mapsApp := &App{}
	mapsApp.trackByPath = map[string]LibraryIndexedFile{
		"loose.flac": {
			Name:         "Loose",
			Path:         "loose.flac",
			RelativePath: "Loose.flac",
			FolderPath:   "",
		},
	}
	mapsApp.textByPath = map[string]LibraryIndexedFile{}
	mapsApp.imageByPath = map[string]LibraryIndexedFile{}
	entries, canceled := mapsApp.buildSearchEntriesFromMapsLocked("loose", nil)
	if canceled || !hasBrowserEntry(entries, "track", "loose.flac") {
		t.Fatalf("buildSearchEntriesFromMapsLocked(root track) = (%#v, %t), want loose track result", entries, canceled)
	}

	mapsApp = &App{}
	mapsApp.trackByPath = map[string]LibraryIndexedFile{
		"nested.flac": {
			Name:         "Nested",
			Path:         "nested.flac",
			RelativePath: "Artist One/Nested.flac",
			FolderPath:   "Library One//Artist One",
		},
	}
	mapsApp.textByPath = map[string]LibraryIndexedFile{}
	mapsApp.imageByPath = map[string]LibraryIndexedFile{}
	entries, canceled = mapsApp.buildSearchEntriesFromMapsLocked("artist one", nil)
	if canceled || !hasBrowserEntry(entries, "folder", "Library One/Artist One") {
		t.Fatalf("buildSearchEntriesFromMapsLocked(double slash folder) = (%#v, %t), want normalized folder match", entries, canceled)
	}

	trackCancelApp := &App{}
	trackCancelApp.trackByPath = map[string]LibraryIndexedFile{
		"track.flac": {Name: "Track", Path: "track.flac", RelativePath: "Artist/Track.flac", FolderPath: "Library/Artist"},
	}
	trackCancelApp.textByPath = map[string]LibraryIndexedFile{}
	trackCancelApp.imageByPath = map[string]LibraryIndexedFile{}
	if _, canceled := trackCancelApp.buildSearchEntriesFromMapsLocked("track", func() bool { return true }); !canceled {
		t.Fatal("buildSearchEntriesFromMapsLocked(track canceled) = false, want true")
	}

	textCancelApp := &App{}
	textCancelApp.trackByPath = map[string]LibraryIndexedFile{}
	textCancelApp.textByPath = map[string]LibraryIndexedFile{
		"note.txt": {Name: "Note", Path: "note.txt", RelativePath: "Artist/Note.txt", FolderPath: "Library/Artist"},
	}
	textCancelApp.imageByPath = map[string]LibraryIndexedFile{}
	if _, canceled := textCancelApp.buildSearchEntriesFromMapsLocked("note", func() bool { return true }); !canceled {
		t.Fatal("buildSearchEntriesFromMapsLocked(text canceled) = false, want true")
	}

	imageCancelApp := &App{}
	imageCancelApp.trackByPath = map[string]LibraryIndexedFile{}
	imageCancelApp.textByPath = map[string]LibraryIndexedFile{}
	imageCancelApp.imageByPath = map[string]LibraryIndexedFile{
		"cover.jpg": {Name: "Cover", Path: "cover.jpg", RelativePath: "Artist/Cover.jpg", FolderPath: "Library/Artist"},
	}
	if _, canceled := imageCancelApp.buildSearchEntriesFromMapsLocked("cover", func() bool { return true }); !canceled {
		t.Fatal("buildSearchEntriesFromMapsLocked(image canceled) = false, want true")
	}

	folderCancelCalls := 0
	folderCancelApp := &App{}
	folderCancelApp.trackByPath = map[string]LibraryIndexedFile{
		"track.flac": {Name: "Track", Path: "track.flac", RelativePath: "Artist/Track.flac", FolderPath: "Library/Artist"},
	}
	folderCancelApp.textByPath = map[string]LibraryIndexedFile{}
	folderCancelApp.imageByPath = map[string]LibraryIndexedFile{}
	if _, canceled := folderCancelApp.buildSearchEntriesFromMapsLocked("artist", func() bool {
		folderCancelCalls++
		return folderCancelCalls > 1
	}); !canceled {
		t.Fatal("buildSearchEntriesFromMapsLocked(folder canceled) = false, want true")
	}

	folderMatchApp := &App{}
	folderMatchApp.trackByPath = map[string]LibraryIndexedFile{
		"song.flac": {Name: "Song", Path: "song.flac", RelativePath: "Artist One/Song.flac", FolderPath: "Library One/Artist One"},
	}
	folderMatchApp.textByPath = map[string]LibraryIndexedFile{}
	folderMatchApp.imageByPath = map[string]LibraryIndexedFile{}
	entries, canceled = folderMatchApp.buildSearchEntriesFromMapsLocked("artist one", nil)
	if canceled || !hasBrowserEntry(entries, "folder", "Library One/Artist One") {
		t.Fatalf("buildSearchEntriesFromMapsLocked(folder match) = (%#v, %t), want folder result", entries, canceled)
	}
}
