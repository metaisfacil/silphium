package main

import (
	"bytes"
	"image"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	taglib "go.senan.xyz/taglib"
)

func newInternalCoverArtRequest(t *testing.T, serverURL string, requestedID string, token string, size int) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, serverURL+internalCoverArtPath, nil)
	if err != nil {
		t.Fatalf("NewRequest(%q) error = %v", internalCoverArtPath, err)
	}

	query := request.URL.Query()
	query.Set("id", requestedID)
	if token != "" {
		query.Set("token", token)
	}
	if size > 0 {
		query.Set("size", strconv.Itoa(size))
	}
	request.URL.RawQuery = query.Encode()
	return request
}

func TestInternalCoverArtServeMuxRequiresToken(t *testing.T) {
	app, fixture, _ := newOpenSubsonicTestApp(t)
	writePNGFile(t, fixture.coverOne, 32, 32)
	app.internalCoverArtState().token = "secret-token"
	server := httptest.NewServer(app.newInternalCoverArtServeMux())
	defer server.Close()

	folderPath := app.ResolveLibraryFolderForPath(fixture.coverOne)
	response, err := http.DefaultClient.Do(newInternalCoverArtRequest(t, server.URL, openSubsonicFolderCoverID(folderPath), "", 16))
	if err != nil {
		t.Fatalf("GET(internal cover without token) error = %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET(internal cover without token) status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}
}

func TestInternalCoverArtServeMuxServesFolderCover(t *testing.T) {
	app, fixture, _ := newOpenSubsonicTestApp(t)
	writePNGFile(t, fixture.coverOne, 32, 32)
	app.internalCoverArtState().token = "secret-token"
	server := httptest.NewServer(app.newInternalCoverArtServeMux())
	defer server.Close()

	folderPath := app.ResolveLibraryFolderForPath(fixture.coverOne)
	response, err := http.DefaultClient.Do(newInternalCoverArtRequest(t, server.URL, openSubsonicFolderCoverID(folderPath), "secret-token", 16))
	if err != nil {
		t.Fatalf("GET(internal folder cover) error = %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET(internal folder cover) status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	if got := response.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("GET(internal folder cover) CORS origin = %q, want %q", got, "*")
	}
	if got := response.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("GET(internal folder cover) content type = %q, want %q", got, "image/png")
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("ReadAll(folder cover body) error = %v", err)
	}
	decodedImage, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("image.Decode(folder cover body) error = %v", err)
	}
	if decodedImage.Bounds().Dx() > 16 || decodedImage.Bounds().Dy() > 16 {
		t.Fatalf("folder cover bounds = %v, want max edge <= 16", decodedImage.Bounds())
	}
}

func TestInternalCoverArtServeMuxFolderCoverDoesNotRebuildBrowseAfterMetadataVersionChange(t *testing.T) {
	app, fixture, _ := newOpenSubsonicTestApp(t)
	writePNGFile(t, fixture.coverOne, 32, 32)
	app.internalCoverArtState().token = "secret-token"
	sentinelBrowse := &openSubsonicBrowseIndex{
		LibraryVersion:     app.openSubsonicLibraryVersion(),
		MusicBrainzVersion: app.musicBrainzTagVersion.Load(),
	}
	app.openSubsonicBrowse = sentinelBrowse
	app.musicBrainzTagVersion.Add(1)
	server := httptest.NewServer(app.newInternalCoverArtServeMux())
	defer server.Close()

	folderPath := app.ResolveLibraryFolderForPath(fixture.coverOne)
	response, err := http.DefaultClient.Do(newInternalCoverArtRequest(t, server.URL, openSubsonicFolderCoverID(folderPath), "secret-token", 16))
	if err != nil {
		t.Fatalf("GET(internal folder cover with stale browse) error = %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET(internal folder cover with stale browse) status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	if app.openSubsonicBrowse != sentinelBrowse {
		t.Fatal("folder cover request rebuilt openSubsonicBrowse after metadata version change")
	}
}

func TestInternalCoverArtServeMuxAllowsPreflight(t *testing.T) {
	app, _, _ := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newInternalCoverArtServeMux())
	defer server.Close()

	request, err := http.NewRequest(http.MethodOptions, server.URL+internalCoverArtPath, nil)
	if err != nil {
		t.Fatalf("NewRequest(%q OPTIONS) error = %v", internalCoverArtPath, err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("OPTIONS(internal cover) error = %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("OPTIONS(internal cover) status = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
	if got := response.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("OPTIONS(internal cover) CORS origin = %q, want %q", got, "*")
	}
}

func TestInternalCoverArtServeMuxServesEmbeddedCover(t *testing.T) {
	originalReadTaglibImage := readTaglibImage
	originalReadTaglibProperties := readTaglibProperties
	t.Cleanup(func() {
		readTaglibImage = originalReadTaglibImage
		readTaglibProperties = originalReadTaglibProperties
	})

	root := t.TempDir()
	trackPath := filepath.Join(root, "Artist", "Album", "01 Track.flac")
	writeTestFile(t, trackPath, "track")
	app := NewApp()
	app.settingsLoaded = true
	app.scanLibraryFolders([]AppLibraryFolder{{Path: root}}, false)
	app.internalCoverArtState().token = "secret-token"

	pngFixturePath := filepath.Join(t.TempDir(), "embedded.png")
	pngBytes := writePNGFile(t, pngFixturePath, 32, 32)
	readTaglibImage = func(_ string) ([]byte, error) {
		return pngBytes, nil
	}
	readTaglibProperties = func(_ string) (taglib.Properties, error) {
		return taglib.Properties{Images: []taglib.ImageDesc{{MIMEType: "image/png"}}}, nil
	}

	browse := app.openSubsonicBrowseIndex()
	virtualTrackPath := ""
	for _, snapshot := range browse.TracksBySongID {
		virtualTrackPath = snapshot.Track.RelativePath
		break
	}
	if virtualTrackPath == "" {
		t.Fatal("openSubsonicBrowseIndex() returned no tracks for embedded cover test")
	}

	server := httptest.NewServer(app.newInternalCoverArtServeMux())
	defer server.Close()

	request := newInternalCoverArtRequest(t, server.URL, openSubsonicTrackCoverID(virtualTrackPath), "secret-token", 16)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(internal embedded cover) error = %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET(internal embedded cover) status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	if got := response.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("GET(internal embedded cover) content type = %q, want %q", got, "image/png")
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("ReadAll(embedded cover body) error = %v", err)
	}
	decodedImage, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("image.Decode(embedded cover body) error = %v", err)
	}
	if decodedImage.Bounds().Dx() > 16 || decodedImage.Bounds().Dy() > 16 {
		t.Fatalf("embedded cover bounds = %v, want max edge <= 16", decodedImage.Bounds())
	}
}

func TestInternalCoverArtServeMuxTrackCoverDoesNotRebuildBrowseAfterMetadataVersionChange(t *testing.T) {
	app, fixture, _ := newOpenSubsonicTestApp(t)
	writePNGFile(t, fixture.coverOne, 32, 32)
	app.internalCoverArtState().token = "secret-token"
	if len(app.activeLibraryRoots) == 0 {
		t.Fatal("activeLibraryRoots = 0, want at least one root")
	}
	_, virtualTrackPath, ok := folderAndRelativeForLibraryRoot(app.activeLibraryRoots[0], fixture.trackOne)
	if !ok || virtualTrackPath == "" {
		t.Fatalf("folderAndRelativeForLibraryRoot(trackOne) = (%q, %t), want non-empty virtual path", virtualTrackPath, ok)
	}

	sentinelBrowse := &openSubsonicBrowseIndex{
		LibraryVersion:     app.openSubsonicLibraryVersion(),
		MusicBrainzVersion: app.musicBrainzTagVersion.Load(),
	}
	app.openSubsonicBrowse = sentinelBrowse
	app.musicBrainzTagVersion.Add(1)
	server := httptest.NewServer(app.newInternalCoverArtServeMux())
	defer server.Close()

	response, err := http.DefaultClient.Do(newInternalCoverArtRequest(t, server.URL, openSubsonicTrackCoverID(virtualTrackPath), "secret-token", 16))
	if err != nil {
		t.Fatalf("GET(internal track cover with stale browse) error = %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET(internal track cover with stale browse) status = %d, want %d", response.StatusCode, http.StatusOK)
	}
	if app.openSubsonicBrowse != sentinelBrowse {
		t.Fatal("track cover request rebuilt openSubsonicBrowse after metadata version change")
	}
}
