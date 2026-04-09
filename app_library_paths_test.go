package main

import (
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestLibraryPathKinds(t *testing.T) {
	testCases := []struct {
		path        string
		wantAudio   bool
		wantText    bool
		wantImage   bool
		wantCoverOK bool
	}{
		{path: "song.FLAC", wantAudio: true},
		{path: "playlist.m3u8"},
		{path: "notes.txt", wantText: true},
		{path: "art.PNG", wantImage: true, wantCoverOK: true},
		{path: "cover.gif", wantImage: true},
	}

	for _, testCase := range testCases {
		if got := isAudioPath(testCase.path); got != testCase.wantAudio {
			t.Fatalf("isAudioPath(%q) = %t, want %t", testCase.path, got, testCase.wantAudio)
		}
		if got := isTextPath(testCase.path); got != testCase.wantText {
			t.Fatalf("isTextPath(%q) = %t, want %t", testCase.path, got, testCase.wantText)
		}
		if got := isImagePath(testCase.path); got != testCase.wantImage {
			t.Fatalf("isImagePath(%q) = %t, want %t", testCase.path, got, testCase.wantImage)
		}
		if got := isPreferredCoverImagePath(testCase.path); got != testCase.wantCoverOK {
			t.Fatalf("isPreferredCoverImagePath(%q) = %t, want %t", testCase.path, got, testCase.wantCoverOK)
		}
	}
}

func TestLibraryRootDisplayHelpers(t *testing.T) {
	if got := libraryRootDisplayBaseForPath("   "); got != "Library" {
		t.Fatalf("libraryRootDisplayBaseForPath(empty) = %q, want %q", got, "Library")
	}

	if got := libraryRootDisplayBaseForPath(filepath.Join(" ", "Artist", " Album ")); got != "Album" {
		t.Fatalf("libraryRootDisplayBaseForPath() = %q, want %q", got, "Album")
	}

	if got := libraryRootDisplayBase(AppLibraryFolder{Path: filepath.Join("C:", "Music"), Label: "  Main Shelf  "}); got != "Main Shelf" {
		t.Fatalf("libraryRootDisplayBase(label) = %q, want %q", got, "Main Shelf")
	}

	folder := AppLibraryFolder{Path: filepath.Join("C:", "Libraries", "Jazz")}
	if got := libraryRootDisplayBase(folder); !strings.EqualFold(got, "Jazz") {
		t.Fatalf("libraryRootDisplayBase(path) = %q, want %q", got, "Jazz")
	}

	resolved := resolveLibraryRootConfigs([]AppLibraryFolder{
		{Path: filepath.Join("C:", "one"), Label: "Shelf"},
		{Path: filepath.Join("C:", "two"), Label: " shelf "},
		{Path: filepath.Join("C:", "three")},
	})
	if got, want := len(resolved), 3; got != want {
		t.Fatalf("resolveLibraryRootConfigs() len = %d, want %d", got, want)
	}
	if resolved[0].Name != "Shelf (1)" || resolved[1].Name != "shelf (2)" {
		t.Fatalf("resolveLibraryRootConfigs() duplicate names = %#v", resolved)
	}
	if resolved[2].Name == "" {
		t.Fatal("resolveLibraryRootConfigs() should derive a name from the path")
	}
	if got := resolveLibraryRootConfigs(nil); len(got) != 0 {
		t.Fatalf("resolveLibraryRootConfigs(nil) len = %d, want 0", len(got))
	}
}

func TestFolderAndVirtualPathHelpers(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	root := libraryRootConfig{Path: fixture.rootOne, Name: "Library One"}

	folderPath, relativePath, ok := folderAndRelative(root.Path, fixture.trackOne)
	if !ok {
		t.Fatal("folderAndRelative() = not ok, want ok")
	}
	if got, want := folderPath, "Artist One/Album One"; got != want {
		t.Fatalf("folderAndRelative() folder = %q, want %q", got, want)
	}
	if got, want := relativePath, "Artist One/Album One/01 Intro.flac"; got != want {
		t.Fatalf("folderAndRelative() relative = %q, want %q", got, want)
	}

	virtualFolder, virtualRelative, ok := folderAndRelativeForLibraryRoot(root, fixture.trackOne)
	if !ok {
		t.Fatal("folderAndRelativeForLibraryRoot() = not ok, want ok")
	}
	if got, want := virtualFolder, "Library One/Artist One/Album One"; got != want {
		t.Fatalf("folderAndRelativeForLibraryRoot() folder = %q, want %q", got, want)
	}
	if got, want := virtualRelative, "Library One/Artist One/Album One/01 Intro.flac"; got != want {
		t.Fatalf("folderAndRelativeForLibraryRoot() relative = %q, want %q", got, want)
	}

	if got := buildVirtualLibraryPath("", "Artist/Album"); got != "Artist/Album" {
		t.Fatalf("buildVirtualLibraryPath(empty root) = %q, want %q", got, "Artist/Album")
	}
	if got := buildVirtualLibraryPath("Root", ""); got != "Root" {
		t.Fatalf("buildVirtualLibraryPath(empty relative) = %q, want %q", got, "Root")
	}

	outsideSiblingPath := filepath.Join(filepath.Dir(fixture.rootOne), filepath.Base(fixture.rootOne)+"-outside", "track.flac")
	if _, _, ok := folderAndRelative(root.Path, outsideSiblingPath); ok {
		t.Fatal("folderAndRelative(outside sibling) = ok, want false")
	}
	if _, _, ok := folderAndRelativeForLibraryRoot(root, outsideSiblingPath); ok {
		t.Fatal("folderAndRelativeForLibraryRoot(outside sibling) = ok, want false")
	}

	if runtime.GOOS == "windows" {
		if _, _, ok := folderAndRelative(`C:\library`, `D:\track.flac`); ok {
			t.Fatal("folderAndRelative(cross-volume) = ok, want false")
		}
		if _, _, ok := folderAndRelativeForLibraryRoot(libraryRootConfig{Path: `C:\library`, Name: "Library"}, `D:\track.flac`); ok {
			t.Fatal("folderAndRelativeForLibraryRoot(cross-volume) = ok, want false")
		}
	}
}

func TestNormalizedPathHelpers(t *testing.T) {
	fixture := createLibraryTestFixture(t)

	if got := normalizePath("  " + filepath.Join(fixture.rootOne, ".", "Artist One", "..", "Artist One") + "  "); got != filepath.Join(fixture.rootOne, "Artist One") {
		t.Fatalf("normalizePath() = %q, want %q", got, filepath.Join(fixture.rootOne, "Artist One"))
	}
	if got := normalizePath("   "); got != "" {
		t.Fatalf("normalizePath(empty) = %q, want empty", got)
	}

	absolutePath, ok := absoluteNormalizedPath(filepath.Join(fixture.rootOne, "Artist One", "Album One", "..", "Album One"))
	if !ok {
		t.Fatal("absoluteNormalizedPath() = not ok, want ok")
	}
	if absolutePath != filepath.Clean(fixture.albumOneFolder) {
		t.Fatalf("absoluteNormalizedPath() = %q, want %q", absolutePath, filepath.Clean(fixture.albumOneFolder))
	}
	if _, ok := absoluteNormalizedPath("   "); ok {
		t.Fatal("absoluteNormalizedPath(empty) = ok, want false")
	}
	if _, ok := absoluteNormalizedPath(string([]byte{'b', 'a', 'd', 0})); ok {
		t.Fatal("absoluteNormalizedPath(invalid path) = ok, want false")
	}

	testCases := []struct {
		value string
		want  string
		ok    bool
	}{
		{value: "", want: "", ok: true},
		{value: ".", want: "", ok: true},
		{value: " Artist\\Album ", want: "Artist/Album", ok: true},
		{value: " Artist/Album ", want: "Artist/Album", ok: true},
		{value: "Artist/../Album", want: "Album", ok: true},
		{value: "../escape", want: "", ok: false},
	}

	for _, testCase := range testCases {
		got, ok := normalizeLibraryRelativePath(testCase.value)
		if ok != testCase.ok || got != testCase.want {
			t.Fatalf("normalizeLibraryRelativePath(%q) = (%q, %t), want (%q, %t)", testCase.value, got, ok, testCase.want, testCase.ok)
		}
	}
	if got, ok := normalizeLibraryRelativePath("Artist/.."); !ok || got != "" {
		t.Fatalf("normalizeLibraryRelativePath(cleaned dot) = (%q, %t), want (\"\", true)", got, ok)
	}

	if !pathWithinRoot(fixture.rootOne, fixture.rootOne) {
		t.Fatal("pathWithinRoot(root, root) = false, want true")
	}
	if !pathWithinRoot(fixture.rootOne, fixture.trackOne) {
		t.Fatal("pathWithinRoot(root, child) = false, want true")
	}
	if runtime.GOOS == "windows" && pathWithinRoot(`C:\library`, `D:\track.flac`) {
		t.Fatal("pathWithinRoot(cross-volume) = true, want false")
	}
	if pathWithinRoot("", fixture.trackOne) {
		t.Fatal("pathWithinRoot(empty root) = true, want false")
	}
	if pathWithinRoot(fixture.rootOne, fixture.outsideTrack) {
		t.Fatal("pathWithinRoot(root, outside) = true, want false")
	}
	if pathWithinRoot(fixture.rootOne, filepath.Join(filepath.Dir(fixture.rootOne), filepath.Base(fixture.rootOne)+"-shadow", "track.flac")) {
		t.Fatal("pathWithinRoot(root, sibling prefix) = true, want false")
	}
}

func TestActiveLibraryRootSelectionAndPermissions(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	nestedRootPath := filepath.Join(fixture.rootOne, "Artist One")
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{
		{Path: fixture.rootOne, Name: "Library One"},
		{Path: nestedRootPath, Name: "Artist One"},
	}

	root, ok := app.activeLibraryRootForPath(fixture.trackOne)
	if !ok {
		t.Fatal("activeLibraryRootForPath() = not ok, want ok")
	}
	if root.Path != nestedRootPath {
		t.Fatalf("activeLibraryRootForPath() path = %q, want %q", root.Path, nestedRootPath)
	}

	primary, ok := app.primaryActiveLibraryRoot()
	if !ok || primary.Path != fixture.rootOne {
		t.Fatalf("primaryActiveLibraryRoot() = (%#v, %t), want first root and true", primary, ok)
	}

	if _, ok := (&App{}).primaryActiveLibraryRoot(); ok {
		t.Fatal("primaryActiveLibraryRoot(empty) = ok, want false")
	}
	if _, ok := app.activeLibraryRootForPath("   "); ok {
		t.Fatal("activeLibraryRootForPath(empty) = ok, want false")
	}
	if _, ok := (&App{}).activeLibraryRootForPath(fixture.trackOne); ok {
		t.Fatal("activeLibraryRootForPath(no roots) = ok, want false")
	}
	equalLengthApp := &App{}
	equalLengthApp.activeLibraryRoots = []libraryRootConfig{
		{Path: nestedRootPath, Name: "Artist One"},
		{Path: fixture.rootOne, Name: "Library One"},
	}
	root, ok = equalLengthApp.activeLibraryRootForPath(fixture.trackOne)
	if !ok || root.Path != nestedRootPath {
		t.Fatalf("activeLibraryRootForPath(prefer existing best match) = (%#v, %t), want nested root and true", root, ok)
	}

	if !app.isAllowedLibraryPath(fixture.trackOne) {
		t.Fatal("isAllowedLibraryPath(inside root) = false, want true")
	}
	if app.isAllowedLibraryPath(fixture.outsideTrack) {
		t.Fatal("isAllowedLibraryPath(outside root) = true, want false")
	}
	if !(&App{}).isAllowedLibraryPath(fixture.outsideTrack) {
		t.Fatal("isAllowedLibraryPath(no roots) = false, want true")
	}
	if app.isAllowedLibraryPath("   ") {
		t.Fatal("isAllowedLibraryPath(empty) = true, want false")
	}
}

func TestFolderAndPagingEntryHelpers(t *testing.T) {
	indexed := LibraryIndexedFile{
		Name:         "01 Intro.flac",
		Path:         `C:\music\Artist\Album\01 Intro.flac`,
		RelativePath: "Library/Artist/Album/01 Intro.flac",
		FolderPath:   "Library/Artist/Album",
	}

	testCases := []struct {
		parent    string
		candidate string
		want      string
		ok        bool
	}{
		{parent: "", candidate: "Library/Artist", want: "Library", ok: true},
		{parent: "Library", candidate: "Library/Artist/Album", want: "Library/Artist", ok: true},
		{parent: "Library", candidate: "Library", ok: false},
		{parent: "Library", candidate: "Library/", ok: false},
		{parent: "Library", candidate: "Other/Artist", ok: false},
		{parent: "Library", candidate: "", ok: false},
	}

	for _, testCase := range testCases {
		got, ok := directChildFolderPath(testCase.parent, testCase.candidate)
		if ok != testCase.ok || got != testCase.want {
			t.Fatalf("directChildFolderPath(%q, %q) = (%q, %t), want (%q, %t)", testCase.parent, testCase.candidate, got, ok, testCase.want, testCase.ok)
		}
	}
	if _, ok := directChildFolderPath("", "/"); ok {
		t.Fatal("directChildFolderPath(empty parent, slash) = ok, want false")
	}
	if _, ok := directChildFolderPath("Library", "Library//"); ok {
		t.Fatal("directChildFolderPath(double slash remainder) = ok, want false")
	}

	folderEntry := folderBrowserEntry("Library/Artist/Album")
	if folderEntry.Kind != "folder" || folderEntry.Name != "Album" || folderEntry.FolderPath != "Library/Artist" {
		t.Fatalf("folderBrowserEntry() = %#v, want folder metadata", folderEntry)
	}

	browserEntry := browserEntryFromIndexedFile("track", indexed)
	if browserEntry.Kind != "track" || browserEntry.Path != indexed.Path || browserEntry.RelativePath != indexed.RelativePath {
		t.Fatalf("browserEntryFromIndexedFile() = %#v, want indexed metadata", browserEntry)
	}

	if got := relativePathWithinFolder("Library/Artist", "Library/Artist/Album/01 Intro.flac"); got != "Album/01 Intro.flac" {
		t.Fatalf("relativePathWithinFolder(prefix) = %q, want %q", got, "Album/01 Intro.flac")
	}
	if got := relativePathWithinFolder("", "Library/Artist/Album/01 Intro.flac"); got != "Library/Artist/Album/01 Intro.flac" {
		t.Fatalf("relativePathWithinFolder(empty prefix) = %q, want unchanged", got)
	}
	if got := relativePathWithinFolder("Library/Artist", "Other/Album"); got != "Other/Album" {
		t.Fatalf("relativePathWithinFolder(non-prefix) = %q, want unchanged", got)
	}

	entries := []LibraryBrowserEntry{{Path: "a"}, {Path: "b"}, {Path: "c"}}
	paged := pagedLibraryEntries(entries, -5, 2)
	if got, want := len(paged), 2; got != want {
		t.Fatalf("pagedLibraryEntries() len = %d, want %d", got, want)
	}
	if got, want := len(pagedLibraryEntries(entries, 1, 0)), 2; got != want {
		t.Fatalf("pagedLibraryEntries(default limit) len = %d, want %d", got, want)
	}
	if got := pagedLibraryEntries(entries, 99, 2); len(got) != 0 {
		t.Fatalf("pagedLibraryEntries(out of range) len = %d, want 0", len(got))
	}

	filePage := pagedIndexedFiles("track", []LibraryIndexedFile{indexed, indexed}, 1, 0)
	if filePage.Limit != 1000 {
		t.Fatalf("pagedIndexedFiles() limit = %d, want %d", filePage.Limit, 1000)
	}
	if got, want := len(filePage.Entries), 1; got != want {
		t.Fatalf("pagedIndexedFiles() len = %d, want %d", got, want)
	}
	filePage.Entries[0].Name = "changed"
	if indexed.Name != "01 Intro.flac" {
		t.Fatal("pagedIndexedFiles() should return a copy of the slice entries")
	}
	outOfRangePage := pagedIndexedFiles("track", []LibraryIndexedFile{indexed}, 9, 2)
	if outOfRangePage.Kind != "track" || outOfRangePage.TotalEntries != 1 || len(outOfRangePage.Entries) != 0 {
		t.Fatalf("pagedIndexedFiles(out of range) = %#v, want empty page metadata", outOfRangePage)
	}
	negativeOffsetPage := pagedIndexedFiles("track", []LibraryIndexedFile{indexed}, -2, 1)
	if negativeOffsetPage.Offset != 0 || len(negativeOffsetPage.Entries) != 1 {
		t.Fatalf("pagedIndexedFiles(negative offset) = %#v, want offset clamped to 0 with one entry", negativeOffsetPage)
	}

	coverCases := map[string]int{
		"cover.jpg":     0,
		"folder.jpg":    1,
		"albumart.jpg":  2,
		"cover.png":     3,
		"folder.png":    4,
		"albumart.png":  5,
		"ALBUMART.JPEG": 2,
		"other.bmp":     6,
	}
	for name, want := range coverCases {
		if got := coverPriority(name); got != want {
			t.Fatalf("coverPriority(%q) = %d, want %d", name, got, want)
		}
	}
}
