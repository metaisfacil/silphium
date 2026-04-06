package main

import (
	"os"
	"path/filepath"
	"testing"
)

type libraryTestFixture struct {
	tempDir        string
	rootOne        string
	rootTwo        string
	albumOneFolder string
	albumTwoFolder string
	trackOne       string
	trackTwo       string
	noteOne        string
	coverOne       string
	folderCoverOne string
	imageTwo       string
	outsideTrack   string
}

func writeTestFile(t *testing.T, path string, contents string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll(%q) error = %v", filepath.Dir(path), err)
	}

	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}
}

func createLibraryTestFixture(t *testing.T) libraryTestFixture {
	t.Helper()

	tempDir := t.TempDir()
	fixture := libraryTestFixture{
		tempDir:        tempDir,
		rootOne:        filepath.Join(tempDir, "library-one"),
		rootTwo:        filepath.Join(tempDir, "library-two"),
		albumOneFolder: filepath.Join(tempDir, "library-one", "Artist One", "Album One"),
		albumTwoFolder: filepath.Join(tempDir, "library-two", "Artist Two", "Album Two"),
		outsideTrack:   filepath.Join(tempDir, "outside", "03 Outside.flac"),
	}

	fixture.trackOne = filepath.Join(fixture.albumOneFolder, "01 Intro.flac")
	fixture.noteOne = filepath.Join(fixture.albumOneFolder, "notes.txt")
	fixture.coverOne = filepath.Join(fixture.albumOneFolder, "cover.jpg")
	fixture.folderCoverOne = filepath.Join(fixture.albumOneFolder, "folder.jpg")
	fixture.trackTwo = filepath.Join(fixture.albumTwoFolder, "02 Outro.flac")
	fixture.imageTwo = filepath.Join(fixture.albumTwoFolder, "booklet.png")

	writeTestFile(t, fixture.trackOne, "track one")
	writeTestFile(t, fixture.noteOne, "album notes")
	writeTestFile(t, fixture.coverOne, "cover image")
	writeTestFile(t, fixture.folderCoverOne, "folder image")
	writeTestFile(t, fixture.trackTwo, "track two")
	writeTestFile(t, fixture.imageTwo, "booklet image")
	writeTestFile(t, fixture.outsideTrack, "outside track")

	return fixture
}
