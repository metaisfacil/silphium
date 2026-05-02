package main

import (
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	taglib "go.senan.xyz/taglib"
)

func newOpenSubsonicTestApp(t *testing.T) (*App, libraryTestFixture, string) {
	t.Helper()
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		OpenSubsonicEnabled: true,
		OpenSubsonicAPIKey:  "api-key-12345",
	})
	app.scanLibraryFolders([]AppLibraryFolder{{Path: fixture.rootOne}}, false)
	return app, fixture, "api-key-12345"
}

func newOpenSubsonicMultiRootTestApp(t *testing.T) (*App, libraryTestFixture, string) {
	t.Helper()
	fixture := createLibraryTestFixture(t)
	app := NewApp()
	app.settingsLoaded = true
	app.settings = normalizeAppSettings(AppSettings{
		OpenSubsonicEnabled: true,
		OpenSubsonicAPIKey:  "api-key-12345",
	})
	app.scanLibraryFolders([]AppLibraryFolder{{Path: fixture.rootOne}, {Path: fixture.rootTwo}}, false)
	return app, fixture, "api-key-12345"
}

func decodeOpenSubsonicResponse(t *testing.T, response *http.Response) openSubsonicEnvelope {
	t.Helper()
	defer response.Body.Close()
	var payload openSubsonicEnvelope
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("Decode(response) error = %v", err)
	}
	return payload
}

func newOpenSubsonicRequest(t *testing.T, serverURL string, path string, apiKey string) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, serverURL+path, nil)
	if err != nil {
		t.Fatalf("NewRequest(%q) error = %v", path, err)
	}
	if strings.TrimSpace(apiKey) != "" {
		query := request.URL.Query()
		query.Set("apiKey", apiKey)
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()
	}
	return request
}

func newOpenSubsonicPostRequest(t *testing.T, serverURL string, path string, values url.Values) *http.Request {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, serverURL+path, strings.NewReader(values.Encode()))
	if err != nil {
		t.Fatalf("NewRequest(%q POST) error = %v", path, err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return request
}

func TestNormalizeAppSettingsOpenSubsonic(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{
		OpenSubsonicEnabled: true,
		OpenSubsonicPort:    70000,
		OpenSubsonicAPIKey:  "api-key-12345",
	})

	if !settings.OpenSubsonicEnabled {
		t.Fatal("OpenSubsonicEnabled = false, want true")
	}
	if settings.OpenSubsonicPort != defaultOpenSubsonicPort {
		t.Fatalf("OpenSubsonicPort = %d, want %d", settings.OpenSubsonicPort, defaultOpenSubsonicPort)
	}
	if settings.OpenSubsonicAPIKeyHash != hashNetworkPassword("api-key-12345") {
		t.Fatalf("OpenSubsonicAPIKeyHash = %q, want hashed api key", settings.OpenSubsonicAPIKeyHash)
	}
}

func TestOpenSubsonicSanitizedQueryPreservesValues(t *testing.T) {
	values := url.Values{}
	values.Set("apiKey", "secret-key")
	values.Set("p", "enc:password")
	values.Set("t", "token-value")
	values.Set("s", "salt-value")
	values.Set("v", openSubsonicAPIVersion)
	values.Set("c", "SilphiumTests")

	encoded := openSubsonicSanitizedQuery(values)
	if !strings.Contains(encoded, "apiKey=secret-key") {
		t.Fatalf("encoded query missing apiKey: %q", encoded)
	}
	if !strings.Contains(encoded, "p=enc%3Apassword") {
		t.Fatalf("encoded query missing password payload: %q", encoded)
	}
	if !strings.Contains(encoded, "t=token-value") {
		t.Fatalf("encoded query missing token: %q", encoded)
	}
	if !strings.Contains(encoded, "s=salt-value") {
		t.Fatalf("encoded query missing salt: %q", encoded)
	}
	if !strings.Contains(encoded, "v=1.16.1") {
		t.Fatalf("encoded query missing expected non-sensitive fields: %q", encoded)
	}
}

func TestOpenSubsonicExtensionsIsPublic(t *testing.T) {
	app, _, _ := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	response, err := http.Get(server.URL + "/rest/getOpenSubsonicExtensions.view?f=json")
	if err != nil {
		t.Fatalf("GET(getOpenSubsonicExtensions) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("status = %q, want ok", payload.Response.Status)
	}
	if len(payload.Response.OpenSubsonicExtensions) != 2 {
		t.Fatalf("len(OpenSubsonicExtensions) = %d, want 2", len(payload.Response.OpenSubsonicExtensions))
	}
}

func TestOpenSubsonicDefaultFormatIsXML(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	request, err := http.NewRequest(http.MethodGet, server.URL+"/rest/ping.view", nil)
	if err != nil {
		t.Fatalf("NewRequest(ping xml) error = %v", err)
	}
	query := request.URL.Query()
	query.Set("u", "demo")
	query.Set("p", apiKey)
	query.Set("v", openSubsonicAPIVersion)
	query.Set("c", "SilphiumTests")
	request.URL.RawQuery = query.Encode()

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(ping xml) error = %v", err)
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); !strings.Contains(contentType, "application/xml") {
		t.Fatalf("Content-Type = %q, want XML", contentType)
	}
	bodyBytes := make([]byte, 512)
	readCount, _ := response.Body.Read(bodyBytes)
	body := string(bodyBytes[:readCount])
	if !strings.Contains(body, "subsonic-response") {
		t.Fatalf("body = %q, want subsonic-response XML", body)
	}
}

func TestOpenSubsonicFormPostBodyParametersAreAccepted(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	t.Run("api key in form body", func(t *testing.T) {
		values := url.Values{}
		values.Set("apiKey", apiKey)
		values.Set("v", openSubsonicAPIVersion)
		values.Set("c", "SilphiumTests")
		values.Set("f", "json")

		response, err := http.DefaultClient.Do(newOpenSubsonicPostRequest(t, server.URL, "/rest/ping.view", values))
		if err != nil {
			t.Fatalf("POST(ping api key body) error = %v", err)
		}
		defer response.Body.Close()
		if contentType := response.Header.Get("Content-Type"); !strings.Contains(contentType, "application/json") {
			t.Fatalf("Content-Type = %q, want JSON", contentType)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("username password in form body", func(t *testing.T) {
		values := url.Values{}
		values.Set("u", "demo")
		values.Set("p", apiKey)
		values.Set("v", openSubsonicAPIVersion)
		values.Set("c", "SilphiumTests")
		values.Set("f", "json")

		response, err := http.DefaultClient.Do(newOpenSubsonicPostRequest(t, server.URL, "/rest/ping.view", values))
		if err != nil {
			t.Fatalf("POST(ping username password body) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("default xml when format omitted", func(t *testing.T) {
		values := url.Values{}
		values.Set("apiKey", apiKey)
		values.Set("v", openSubsonicAPIVersion)
		values.Set("c", "SilphiumTests")

		response, err := http.DefaultClient.Do(newOpenSubsonicPostRequest(t, server.URL, "/rest/ping.view", values))
		if err != nil {
			t.Fatalf("POST(ping xml body) error = %v", err)
		}
		defer response.Body.Close()
		if contentType := response.Header.Get("Content-Type"); !strings.Contains(contentType, "application/xml") {
			t.Fatalf("Content-Type = %q, want XML", contentType)
		}
		bodyBytes, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("ReadAll(response.Body) error = %v", err)
		}
		if !strings.Contains(string(bodyBytes), "subsonic-response") {
			t.Fatalf("body = %q, want subsonic-response XML", string(bodyBytes))
		}
	})
}

func TestOpenSubsonicAuthErrors(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	t.Run("token auth rejected", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "demo")
		query.Set("t", openSubsonicExpectedToken(apiKey, "salt"))
		query.Set("s", "salt")
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping token auth) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("token auth rejected when token invalid", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "demo")
		query.Set("t", "invalid-token")
		query.Set("s", "salt")
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping token auth invalid token) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Error == nil || payload.Response.Error.Code != openSubsonicErrorWrongUsernamePassword {
			t.Fatalf("error = %#v, want code %d", payload.Response.Error, openSubsonicErrorWrongUsernamePassword)
		}
	})

	t.Run("conflicting auth rejected", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", apiKey)
		query := request.URL.Query()
		query.Set("p", apiKey)
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping conflicting auth) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Error == nil || payload.Response.Error.Code != openSubsonicErrorConflictingAuth {
			t.Fatalf("error = %#v, want code %d", payload.Response.Error, openSubsonicErrorConflictingAuth)
		}
	})

	t.Run("invalid api key rejected", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "wrong-api-key")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping invalid api key) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Error == nil || payload.Response.Error.Code != openSubsonicErrorInvalidAPIKey {
			t.Fatalf("error = %#v, want code %d", payload.Response.Error, openSubsonicErrorInvalidAPIKey)
		}
	})

	t.Run("username password auth accepted", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "demo")
		query.Set("p", apiKey)
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping username password) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("username enc password auth accepted", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "demo")
		query.Set("p", "enc:"+hex.EncodeToString([]byte(apiKey)))
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping username enc password) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("username password auth falls back to stored hash when plaintext drifts", func(t *testing.T) {
		originalPlaintext := app.settings.OpenSubsonicAPIKey
		originalHash := app.settings.OpenSubsonicAPIKeyHash
		app.settings.OpenSubsonicAPIKey = "stale-api-key"
		app.settings.OpenSubsonicAPIKeyHash = hashNetworkPassword(apiKey)
		defer func() {
			app.settings.OpenSubsonicAPIKey = originalPlaintext
			app.settings.OpenSubsonicAPIKeyHash = originalHash
		}()

		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "admin")
		query.Set("p", apiKey)
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping username password stale plaintext) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("username enc password auth falls back to stored hash when plaintext drifts", func(t *testing.T) {
		originalPlaintext := app.settings.OpenSubsonicAPIKey
		originalHash := app.settings.OpenSubsonicAPIKeyHash
		app.settings.OpenSubsonicAPIKey = "stale-api-key"
		app.settings.OpenSubsonicAPIKeyHash = hashNetworkPassword(apiKey)
		defer func() {
			app.settings.OpenSubsonicAPIKey = originalPlaintext
			app.settings.OpenSubsonicAPIKeyHash = originalHash
		}()

		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "admin")
		query.Set("p", "enc:"+hex.EncodeToString([]byte(apiKey)))
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping username enc password stale plaintext) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("username password auth rejected when password invalid", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", "")
		query := request.URL.Query()
		query.Set("u", "demo")
		query.Set("p", "wrong-password")
		query.Set("v", openSubsonicAPIVersion)
		query.Set("c", "SilphiumTests")
		query.Set("f", "json")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping username wrong password) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Error == nil || payload.Response.Error.Code != openSubsonicErrorWrongUsernamePassword {
			t.Fatalf("error = %#v, want code %d", payload.Response.Error, openSubsonicErrorWrongUsernamePassword)
		}
	})
}

func TestOpenSubsonicDefaultsMissingCommonParams(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	t.Run("ping accepts missing version and client", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/ping.view", apiKey)
		query := request.URL.Query()
		query.Del("v")
		query.Del("c")
		request.URL.RawQuery = query.Encode()
		request.Header.Set("User-Agent", "Submariner/3.4 CFNetwork/3860.500.112 Darwin/25.4.0")

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(ping missing common params) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Status != "ok" {
			t.Fatalf("status = %q, want ok", payload.Response.Status)
		}
	})

	t.Run("getArtist accepts missing version and client", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/getMusicFolders.view", apiKey)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getMusicFolders) error = %v", err)
		}
		folders := decodeOpenSubsonicResponse(t, response)

		request = newOpenSubsonicRequest(t, server.URL, "/rest/getIndexes.view", apiKey)
		query := request.URL.Query()
		query.Set("musicFolderId", folders.Response.MusicFolders.MusicFolder[0].ID)
		request.URL.RawQuery = query.Encode()
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getIndexes) error = %v", err)
		}
		indexes := decodeOpenSubsonicResponse(t, response)
		artistID := indexes.Response.Indexes.Index[0].Artist[0].ID

		request = newOpenSubsonicRequest(t, server.URL, "/rest/getArtist.view", apiKey)
		query = request.URL.Query()
		query.Del("v")
		query.Del("c")
		query.Set("id", artistID)
		request.URL.RawQuery = query.Encode()
		request.Header.Set("User-Agent", "Submariner/3.4 CFNetwork/3860.500.112 Darwin/25.4.0")

		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getArtist missing common params) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Artist == nil {
			t.Fatal("artist = nil, want populated artist")
		}
		if payload.Response.Artist.ID != artistID {
			t.Fatalf("artist id = %q, want %q", payload.Response.Artist.ID, artistID)
		}
	})
}

func TestOpenSubsonicBrowseAndMediaEndpoints(t *testing.T) {
	app, fixture, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getMusicFolders.view", apiKey))
	if err != nil {
		t.Fatalf("GET(getMusicFolders) error = %v", err)
	}
	musicFolders := decodeOpenSubsonicResponse(t, response)
	if len(musicFolders.Response.MusicFolders.MusicFolder) != 1 {
		t.Fatalf("len(musicFolders) = %d, want 1", len(musicFolders.Response.MusicFolders.MusicFolder))
	}
	musicFolderID := musicFolders.Response.MusicFolders.MusicFolder[0].ID

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getIndexes.view", apiKey)
	query := request.URL.Query()
	query.Set("musicFolderId", musicFolderID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getIndexes) error = %v", err)
	}
	indexes := decodeOpenSubsonicResponse(t, response)
	if len(indexes.Response.Indexes.Index) == 0 || len(indexes.Response.Indexes.Index[0].Artist) == 0 {
		t.Fatalf("indexes = %#v, want at least one artist", indexes.Response.Indexes)
	}
	if len(indexes.Response.Indexes.Child) == 0 {
		t.Fatalf("indexes children = %#v, want track children", indexes.Response.Indexes.Child)
	}
	if indexes.Response.Indexes.IgnoredArticles != "The El La Los Las Le Les" {
		t.Fatalf("indexes ignoredArticles = %q, want %q", indexes.Response.Indexes.IgnoredArticles, "The El La Los Las Le Les")
	}
	if got := indexes.Response.Indexes.Child[0].Path; got == "" {
		t.Fatal("indexes child path = empty, want populated track path")
	}
	artistDirectoryID := indexes.Response.Indexes.Index[0].Artist[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", artistDirectoryID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory artist) error = %v", err)
	}
	artistDirectory := decodeOpenSubsonicResponse(t, response)
	if len(artistDirectory.Response.Directory.Child) != 1 || !artistDirectory.Response.Directory.Child[0].IsDir {
		t.Fatalf("artist directory child = %#v, want one album folder", artistDirectory.Response.Directory.Child)
	}
	albumDirectoryID := artistDirectory.Response.Directory.Child[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", albumDirectoryID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory album) error = %v", err)
	}
	albumDirectory := decodeOpenSubsonicResponse(t, response)
	if len(albumDirectory.Response.Directory.Child) == 0 || albumDirectory.Response.Directory.Child[0].IsDir {
		t.Fatalf("album directory child = %#v, want track entries", albumDirectory.Response.Directory.Child)
	}
	track := albumDirectory.Response.Directory.Child[0]

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getSong.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getSong) error = %v", err)
	}
	song := decodeOpenSubsonicResponse(t, response)
	if song.Response.Song == nil || song.Response.Song.Title == "" {
		t.Fatalf("song = %#v, want populated song", song.Response.Song)
	}
	if track.ContentType != "audio/flac" {
		t.Fatalf("track content type = %q, want %q", track.ContentType, "audio/flac")
	}
	if song.Response.Song.ContentType != "audio/flac" {
		t.Fatalf("song content type = %q, want %q", song.Response.Song.ContentType, "audio/flac")
	}

	if track.CoverArt != "" {
		request = newOpenSubsonicRequest(t, server.URL, "/rest/getCoverArt.view", apiKey)
		query = request.URL.Query()
		query.Set("id", track.CoverArt)
		request.URL.RawQuery = query.Encode()
		response, err = http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getCoverArt) error = %v", err)
		}
		defer response.Body.Close()
		bodyBytes := make([]byte, 32)
		readCount, _ := response.Body.Read(bodyBytes)
		if readCount <= 0 {
			t.Fatal("getCoverArt returned empty body")
		}
	}

	request = newOpenSubsonicRequest(t, server.URL, "/rest/stream.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(stream) error = %v", err)
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "audio/flac" {
		t.Fatalf("stream Content-Type = %q, want %q", contentType, "audio/flac")
	}
	if nosniff := response.Header.Get("X-Content-Type-Options"); nosniff != "nosniff" {
		t.Fatalf("stream X-Content-Type-Options = %q, want %q", nosniff, "nosniff")
	}
	if acceptRanges := response.Header.Get("Accept-Ranges"); acceptRanges != "bytes" {
		t.Fatalf("stream Accept-Ranges = %q, want %q", acceptRanges, "bytes")
	}
	if disposition := response.Header.Get("Content-Disposition"); disposition != "" {
		t.Fatalf("stream Content-Disposition = %q, want empty", disposition)
	}
	streamBody := make([]byte, 64)
	readCount, _ := response.Body.Read(streamBody)
	if string(streamBody[:readCount]) != "track one" {
		t.Fatalf("stream body = %q, want %q", string(streamBody[:readCount]), "track one")
	}

	request = newOpenSubsonicRequest(t, server.URL, "/rest/stream.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	request.Header.Set("Range", "bytes=0-4")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(stream range) error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusPartialContent {
		t.Fatalf("stream range status = %d, want %d", response.StatusCode, http.StatusPartialContent)
	}
	if contentRange := response.Header.Get("Content-Range"); !strings.HasPrefix(contentRange, "bytes 0-4/") {
		t.Fatalf("stream range Content-Range = %q, want bytes 0-4/*", contentRange)
	}
	rangedBody := make([]byte, 16)
	readCount, _ = response.Body.Read(rangedBody)
	if string(rangedBody[:readCount]) != "track" {
		t.Fatalf("stream ranged body = %q, want %q", string(rangedBody[:readCount]), "track")
	}

	if got := song.Response.Song.Path; got != filepath.ToSlash(filepath.Join("Artist One", "Album One", "01 Intro.flac")) {
		t.Fatalf("song path = %q, want %q", got, filepath.ToSlash(filepath.Join("Artist One", "Album One", "01 Intro.flac")))
	}
	if track.Title != "01 Intro" {
		t.Fatalf("track title = %q, want %q", track.Title, "01 Intro")
	}
	if track.Album != "Album One" {
		t.Fatalf("track album = %q, want %q", track.Album, "Album One")
	}
	if track.Artist != "Artist One" {
		t.Fatalf("track artist = %q, want %q", track.Artist, "Artist One")
	}
	_ = fixture
}

func TestOpenSubsonicPlaybackAuxiliaryEndpoints(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getMusicFolders.view", apiKey))
	if err != nil {
		t.Fatalf("GET(getMusicFolders) error = %v", err)
	}
	musicFolders := decodeOpenSubsonicResponse(t, response)
	if len(musicFolders.Response.MusicFolders.MusicFolder) != 1 {
		t.Fatalf("len(musicFolders) = %d, want 1", len(musicFolders.Response.MusicFolders.MusicFolder))
	}

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getIndexes.view", apiKey)
	query := request.URL.Query()
	query.Set("musicFolderId", musicFolders.Response.MusicFolders.MusicFolder[0].ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getIndexes) error = %v", err)
	}
	indexes := decodeOpenSubsonicResponse(t, response)
	artistID := indexes.Response.Indexes.Index[0].Artist[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", artistID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory artist) error = %v", err)
	}
	artistDirectory := decodeOpenSubsonicResponse(t, response)

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", artistDirectory.Response.Directory.Child[0].ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory album) error = %v", err)
	}
	albumDirectory := decodeOpenSubsonicResponse(t, response)
	track := albumDirectory.Response.Directory.Child[0]

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getLyrics.view", apiKey)
	query = request.URL.Query()
	query.Set("artist", track.Artist)
	query.Set("title", track.Title)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getLyrics) error = %v", err)
	}
	lyrics := decodeOpenSubsonicResponse(t, response)
	if lyrics.Response.Status != "ok" {
		t.Fatalf("getLyrics status = %q, want ok", lyrics.Response.Status)
	}
	if lyrics.Response.Lyrics == nil {
		t.Fatal("getLyrics response missing lyrics payload")
	}
	if lyrics.Response.Lyrics.Artist != track.Artist {
		t.Fatalf("getLyrics artist = %q, want %q", lyrics.Response.Lyrics.Artist, track.Artist)
	}
	if lyrics.Response.Lyrics.Title != track.Title {
		t.Fatalf("getLyrics title = %q, want %q", lyrics.Response.Lyrics.Title, track.Title)
	}
	if lyrics.Response.Lyrics.Value != "" {
		t.Fatalf("getLyrics value = %q, want empty string", lyrics.Response.Lyrics.Value)
	}

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getSimilarSongs.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getSimilarSongs) error = %v", err)
	}
	similarSongs := decodeOpenSubsonicResponse(t, response)
	if similarSongs.Response.Status != "ok" {
		t.Fatalf("getSimilarSongs status = %q, want ok", similarSongs.Response.Status)
	}
	if similarSongs.Response.SimilarSongs == nil {
		t.Fatal("getSimilarSongs response missing similarSongs payload")
	}
	if len(similarSongs.Response.SimilarSongs.Song) != 0 {
		t.Fatalf("len(getSimilarSongs songs) = %d, want 0", len(similarSongs.Response.SimilarSongs.Song))
	}

	request = newOpenSubsonicRequest(t, server.URL, "/rest/scrobble.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(scrobble) error = %v", err)
	}
	scrobble := decodeOpenSubsonicResponse(t, response)
	if scrobble.Response.Status != "ok" {
		t.Fatalf("scrobble status = %q, want ok", scrobble.Response.Status)
	}
	if scrobble.Response.Error != nil {
		t.Fatalf("scrobble error = %#v, want nil", scrobble.Response.Error)
	}
}

func TestOpenSubsonicSearchEndpoints(t *testing.T) {
	app, _, apiKey := newOpenSubsonicMultiRootTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getMusicFolders.view", apiKey))
	if err != nil {
		t.Fatalf("GET(getMusicFolders) error = %v", err)
	}
	folders := decodeOpenSubsonicResponse(t, response)
	if folders.Response.MusicFolders == nil || len(folders.Response.MusicFolders.MusicFolder) != 2 {
		t.Fatalf("musicFolders = %#v, want 2 folders", folders.Response.MusicFolders)
	}
	rootOneID := folders.Response.MusicFolders.MusicFolder[0].ID

	t.Run("legacy search returns total hits for full library", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/search.view", apiKey)
		query := request.URL.Query()
		query.Set("count", "0")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(search legacy count) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.SearchResult == nil {
			t.Fatal("searchResult = nil, want payload")
		}
		if payload.Response.SearchResult.TotalHits != 2 {
			t.Fatalf("search totalHits = %d, want %d", payload.Response.SearchResult.TotalHits, 2)
		}
		if len(payload.Response.SearchResult.Match) != 0 {
			t.Fatalf("len(search matches) = %d, want 0 when count=0", len(payload.Response.SearchResult.Match))
		}
	})

	t.Run("legacy search matches fielded artist query", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/search.view", apiKey)
		query := request.URL.Query()
		query.Set("artist", "Artist Two")
		query.Set("count", "10")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(search legacy artist) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.SearchResult == nil {
			t.Fatal("searchResult = nil, want payload")
		}
		if payload.Response.SearchResult.TotalHits != 1 {
			t.Fatalf("search totalHits = %d, want %d", payload.Response.SearchResult.TotalHits, 1)
		}
		if len(payload.Response.SearchResult.Match) != 1 {
			t.Fatalf("len(search matches) = %d, want 1", len(payload.Response.SearchResult.Match))
		}
		if got := payload.Response.SearchResult.Match[0].Artist; got != "Artist Two" {
			t.Fatalf("search match artist = %q, want %q", got, "Artist Two")
		}
	})

	t.Run("search2 returns artist album and song matches", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/search2.view", apiKey)
		query := request.URL.Query()
		query.Set("query", "Artist Two")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(search2) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.SearchResult2 == nil {
			t.Fatal("searchResult2 = nil, want payload")
		}
		if len(payload.Response.SearchResult2.Artist) != 1 {
			t.Fatalf("len(search2 artists) = %d, want 1", len(payload.Response.SearchResult2.Artist))
		}
		if len(payload.Response.SearchResult2.Album) != 1 {
			t.Fatalf("len(search2 albums) = %d, want 1", len(payload.Response.SearchResult2.Album))
		}
		if len(payload.Response.SearchResult2.Song) != 1 {
			t.Fatalf("len(search2 songs) = %d, want 1", len(payload.Response.SearchResult2.Song))
		}
		if got := payload.Response.SearchResult2.Song[0].AlbumID; got == "" {
			t.Fatal("search2 song albumId = empty, want populated ID")
		}
		if got := payload.Response.SearchResult2.Song[0].ArtistID; got == "" {
			t.Fatal("search2 song artistId = empty, want populated ID")
		}
	})

	t.Run("search3 supports empty query and music folder filtering", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/search3.view", apiKey)
		query := request.URL.Query()
		query.Set("query", "")
		query.Set("musicFolderId", rootOneID)
		query.Set("artistCount", "10")
		query.Set("albumCount", "10")
		query.Set("songCount", "10")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(search3 empty query) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.SearchResult3 == nil {
			t.Fatal("searchResult3 = nil, want payload")
		}
		if len(payload.Response.SearchResult3.Artist) != 1 {
			t.Fatalf("len(search3 artists) = %d, want 1", len(payload.Response.SearchResult3.Artist))
		}
		if len(payload.Response.SearchResult3.Album) != 1 {
			t.Fatalf("len(search3 albums) = %d, want 1", len(payload.Response.SearchResult3.Album))
		}
		if len(payload.Response.SearchResult3.Song) != 1 {
			t.Fatalf("len(search3 songs) = %d, want 1", len(payload.Response.SearchResult3.Song))
		}
		if got := payload.Response.SearchResult3.Song[0].Artist; got != "Artist One" {
			t.Fatalf("search3 song artist = %q, want %q", got, "Artist One")
		}
	})
}

func TestOpenSubsonicGetGenresUsesBrowseSnapshotAggregation(t *testing.T) {
	app, fixture, apiKey := newOpenSubsonicMultiRootTestApp(t)
	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Title:             "Intro",
		AlbumTitle:        "Album One",
		AlbumArtist:       "Artist One",
		Genres:            []string{"Rock", "Jazz"},
		ReleaseFolderPath: filepath.ToSlash(filepath.Join(filepath.Base(fixture.rootOne), "Artist One", "Album One")),
	})
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackTwo, musicBrainzTagTrackRecord{
		Title:             "Outro",
		AlbumTitle:        "Album Two",
		AlbumArtist:       "Artist Two",
		Genres:            []string{"Rock"},
		ReleaseFolderPath: filepath.ToSlash(filepath.Join(filepath.Base(fixture.rootTwo), "Artist Two", "Album Two")),
	})
	app.musicBrainzTagMu.Unlock()

	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getGenres.view", apiKey))
	if err != nil {
		t.Fatalf("GET(getGenres) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.Genres == nil {
		t.Fatal("genres = nil, want populated container")
	}
	if len(payload.Response.Genres.Genre) != 2 {
		t.Fatalf("len(genres) = %d, want 2", len(payload.Response.Genres.Genre))
	}
	if got := payload.Response.Genres.Genre[0]; got.Name != "Jazz" || got.SongCount != 1 || got.AlbumCount != 1 {
		t.Fatalf("first genre = %#v, want Jazz with songCount=1 albumCount=1", got)
	}
	if got := payload.Response.Genres.Genre[1]; got.Name != "Rock" || got.SongCount != 2 || got.AlbumCount != 2 {
		t.Fatalf("second genre = %#v, want Rock with songCount=2 albumCount=2", got)
	}
}

func TestOpenSubsonicFavoritePlaylistsCanBeListedAndUpdated(t *testing.T) {
	app, fixture, apiKey := newOpenSubsonicMultiRootTestApp(t)
	playlistPath := filepath.Join(fixture.tempDir, "playlists", "favorites.m3u8")
	if !app.SavePlaylistFile(playlistPath, []string{fixture.trackOne}) {
		t.Fatal("SavePlaylistFile(favorites) = false, want true")
	}
	app.settings = normalizeAppSettings(AppSettings{
		OpenSubsonicEnabled: true,
		OpenSubsonicAPIKey:  apiKey,
		FavoritePlaylists:   []string{playlistPath},
	})

	browse := app.openSubsonicBrowseIndex()
	trackTwoID := ""
	for _, trackSnapshot := range browse.Tracks {
		if normalizePath(trackSnapshot.Track.Path) == normalizePath(fixture.trackTwo) {
			trackTwoID = openSubsonicSongID(trackSnapshot.Track.RelativePath)
			break
		}
	}
	if trackTwoID == "" {
		t.Fatal("trackTwoID = empty, want populated song ID")
	}

	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getPlaylists.view", apiKey))
	if err != nil {
		t.Fatalf("GET(getPlaylists) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.Playlists == nil {
		t.Fatal("playlists = nil, want payload")
	}
	if len(payload.Response.Playlists.Playlist) != 1 {
		t.Fatalf("len(playlists) = %d, want 1", len(payload.Response.Playlists.Playlist))
	}
	playlist := payload.Response.Playlists.Playlist[0]
	if playlist.Name != "favorites" {
		t.Fatalf("playlist name = %q, want %q", playlist.Name, "favorites")
	}
	if playlist.SongCount != 1 {
		t.Fatalf("playlist songCount = %d, want %d", playlist.SongCount, 1)
	}
	if playlist.ID == "" {
		t.Fatal("playlist id = empty, want encoded ID")
	}

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getPlaylist.view", apiKey)
	query := request.URL.Query()
	query.Set("id", playlist.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getPlaylist) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if payload.Response.Playlist == nil {
		t.Fatal("playlist detail = nil, want payload")
	}
	if got := payload.Response.Playlist.Name; got != "favorites" {
		t.Fatalf("getPlaylist name = %q, want %q", got, "favorites")
	}
	if got := len(payload.Response.Playlist.Entry); got != 1 {
		t.Fatalf("len(getPlaylist entries) = %d, want 1", got)
	}
	if got := payload.Response.Playlist.Entry[0].Path; got == "" {
		t.Fatal("getPlaylist entry path = empty, want populated relative path")
	}

	values := url.Values{}
	values.Set("apiKey", apiKey)
	values.Set("v", openSubsonicAPIVersion)
	values.Set("c", "SilphiumTests")
	values.Set("f", "json")
	values.Set("playlistId", playlist.ID)
	values.Add("songIdToAdd", trackTwoID)

	response, err = http.DefaultClient.Do(newOpenSubsonicPostRequest(t, server.URL, "/rest/updatePlaylist.view", values))
	if err != nil {
		t.Fatalf("POST(updatePlaylist) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("updatePlaylist status = %q, want ok", payload.Response.Status)
	}

	loadedPlaylist := app.LoadPlaylistFile(playlistPath)
	if got, want := len(loadedPlaylist.TrackFiles), 2; got != want {
		t.Fatalf("LoadPlaylistFile(updated favorites) len = %d, want %d", got, want)
	}
	if got := loadedPlaylist.TrackFiles[1].Path; got != fixture.trackTwo {
		t.Fatalf("LoadPlaylistFile(updated favorites) second path = %q, want %q", got, fixture.trackTwo)
	}

	response, err = http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getPlaylists.view", apiKey))
	if err != nil {
		t.Fatalf("GET(getPlaylists updated) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if got := payload.Response.Playlists.Playlist[0].SongCount; got != 2 {
		t.Fatalf("updated playlist songCount = %d, want %d", got, 2)
	}

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getPlaylist.view", apiKey)
	query = request.URL.Query()
	query.Set("id", playlist.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getPlaylist updated) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if got := len(payload.Response.Playlist.Entry); got != 2 {
		t.Fatalf("len(updated getPlaylist entries) = %d, want 2", got)
	}
}

func TestOpenSubsonicScrobbleUsesProvidersAndRules(t *testing.T) {
	app, fixture, apiKey := newOpenSubsonicMultiRootTestApp(t)
	app.settingsPath = filepath.Join(fixture.tempDir, "settings.json")

	type listenSubmitPayload struct {
		ListenType string `json:"listen_type"`
		Payload    []struct {
			ListenedAt int64 `json:"listened_at,omitempty"`
		} `json:"payload"`
	}

	var mu sync.Mutex
	lastFmRequests := make([]url.Values, 0)
	listenBrainzSubmissions := make([]listenSubmitPayload, 0)
	var handlerErr error
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/":
			body, err := io.ReadAll(request.Body)
			if err != nil {
				mu.Lock()
				if handlerErr == nil {
					handlerErr = err
				}
				mu.Unlock()
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			values, err := url.ParseQuery(string(body))
			if err != nil {
				mu.Lock()
				if handlerErr == nil {
					handlerErr = err
				}
				mu.Unlock()
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			mu.Lock()
			lastFmRequests = append(lastFmRequests, values)
			mu.Unlock()
			writer.Header().Set("Content-Type", "application/xml")
			_, _ = writer.Write([]byte(`<lfm status="ok"></lfm>`))
		case listenBrainzSubmitPath:
			var payload listenSubmitPayload
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				mu.Lock()
				if handlerErr == nil {
					handlerErr = err
				}
				mu.Unlock()
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			mu.Lock()
			listenBrainzSubmissions = append(listenBrainzSubmissions, payload)
			mu.Unlock()
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"status":"ok"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	originalLastFmAPIBaseURL := lastFmAPIBaseURL
	lastFmAPIBaseURL = server.URL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalLastFmAPIBaseURL
	})

	app.settings = normalizeAppSettings(AppSettings{
		OpenSubsonicEnabled:   true,
		OpenSubsonicAPIKey:    apiKey,
		LastFmAPIKey:          "lastfm-key",
		LastFmAPISecret:       "lastfm-secret",
		LastFmSessionKey:      "lastfm-session",
		ListenBrainzUserToken: "listenbrainz-token",
		ListenBrainzServerURL: server.URL,
		ScrobbleFilterMode:    "whitelist",
		ScrobbleRules: []ScrobbleRule{{
			Field:    scrobbleRuleFieldPath,
			Operator: scrobbleRuleOperatorStartsWith,
			Value:    fixture.rootOne,
		}},
	})
	app.settingsLoaded = true

	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Title:           "Intro",
		TrackArtist:     "Artist One",
		AlbumTitle:      "Album One",
		AlbumArtist:     "Artist One",
		RecordingID:     "11111111-1111-4111-8111-111111111111",
		ReleaseID:       "22222222-2222-4222-8222-222222222222",
		ArtistIDs:       []string{"33333333-3333-4333-8333-333333333333"},
		DurationSeconds: 301,
	})
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackTwo, musicBrainzTagTrackRecord{
		Title:           "Outro",
		TrackArtist:     "Artist Two",
		AlbumTitle:      "Album Two",
		AlbumArtist:     "Artist Two",
		RecordingID:     "44444444-4444-4444-8444-444444444444",
		ReleaseID:       "55555555-5555-4555-8555-555555555555",
		ArtistIDs:       []string{"66666666-6666-4666-8666-666666666666"},
		DurationSeconds: 215,
	})
	app.musicBrainzTagMu.Unlock()

	browse := app.openSubsonicBrowseIndex()
	trackOneID := ""
	trackTwoID := ""
	for _, trackSnapshot := range browse.Tracks {
		switch normalizePath(trackSnapshot.Track.Path) {
		case normalizePath(fixture.trackOne):
			trackOneID = openSubsonicSongID(trackSnapshot.Track.RelativePath)
		case normalizePath(fixture.trackTwo):
			trackTwoID = openSubsonicSongID(trackSnapshot.Track.RelativePath)
		}
	}
	if trackOneID == "" || trackTwoID == "" {
		t.Fatalf("track IDs = (%q, %q), want both populated", trackOneID, trackTwoID)
	}

	serverMux := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer serverMux.Close()

	request := newOpenSubsonicRequest(t, serverMux.URL, "/rest/scrobble.view", apiKey)
	query := request.URL.Query()
	query.Add("id", trackOneID)
	query.Add("id", trackTwoID)
	request.URL.RawQuery = query.Encode()

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(scrobble default now playing) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("scrobble default now playing status = %q, want ok", payload.Response.Status)
	}
	mu.Lock()
	if handlerErr != nil {
		err = handlerErr
		mu.Unlock()
		t.Fatalf("provider handler error after default now playing = %v", err)
	}
	mu.Unlock()

	mu.Lock()
	if len(lastFmRequests) != 1 {
		mu.Unlock()
		t.Fatalf("len(lastFm requests after default now playing) = %d, want 1", len(lastFmRequests))
	}
	if got := lastFmRequests[0].Get("method"); got != "track.updateNowPlaying" {
		mu.Unlock()
		t.Fatalf("lastFm default now playing method = %q, want %q", got, "track.updateNowPlaying")
	}
	if got := lastFmRequests[0].Get("timestamp"); got != "" {
		mu.Unlock()
		t.Fatalf("lastFm default now playing timestamp = %q, want empty", got)
	}
	if len(listenBrainzSubmissions) != 1 {
		mu.Unlock()
		t.Fatalf("len(listenbrainz submissions after default now playing) = %d, want 1", len(listenBrainzSubmissions))
	}
	if got := listenBrainzSubmissions[0].ListenType; got != "playing_now" {
		mu.Unlock()
		t.Fatalf("listenbrainz default now playing type = %q, want %q", got, "playing_now")
	}
	if got := listenBrainzSubmissions[0].Payload[0].ListenedAt; got != 0 {
		mu.Unlock()
		t.Fatalf("listenbrainz default now playing listened_at = %d, want 0", got)
	}
	lastFmRequests = nil
	listenBrainzSubmissions = nil
	mu.Unlock()

	request = newOpenSubsonicRequest(t, serverMux.URL, "/rest/scrobble.view", apiKey)
	query = request.URL.Query()
	query.Add("id", trackOneID)
	query.Add("id", trackTwoID)
	query.Add("time", "1710000000000")
	query.Add("time", "1710000005000")
	query.Set("submission", "true")
	request.URL.RawQuery = query.Encode()

	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(scrobble explicit submission) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("scrobble explicit submission status = %q, want ok", payload.Response.Status)
	}
	mu.Lock()
	if handlerErr != nil {
		err = handlerErr
		mu.Unlock()
		t.Fatalf("provider handler error after explicit submission = %v", err)
	}
	mu.Unlock()

	mu.Lock()
	if len(lastFmRequests) != 1 {
		mu.Unlock()
		t.Fatalf("len(lastFm requests after explicit submission) = %d, want 1", len(lastFmRequests))
	}
	if got := lastFmRequests[0].Get("method"); got != "track.scrobble" {
		mu.Unlock()
		t.Fatalf("lastFm explicit submission method = %q, want %q", got, "track.scrobble")
	}
	if got := lastFmRequests[0].Get("timestamp"); got != "1710000000" {
		mu.Unlock()
		t.Fatalf("lastFm explicit submission timestamp = %q, want %q", got, "1710000000")
	}
	if len(listenBrainzSubmissions) != 1 {
		mu.Unlock()
		t.Fatalf("len(listenbrainz submissions after explicit submission) = %d, want 1", len(listenBrainzSubmissions))
	}
	if got := listenBrainzSubmissions[0].ListenType; got != "single" {
		mu.Unlock()
		t.Fatalf("listenbrainz explicit submission type = %q, want %q", got, "single")
	}
	if got := listenBrainzSubmissions[0].Payload[0].ListenedAt; got != 1710000000 {
		mu.Unlock()
		t.Fatalf("listenbrainz explicit submission listened_at = %d, want %d", got, 1710000000)
	}
	lastFmRequests = nil
	listenBrainzSubmissions = nil
	mu.Unlock()

	request = newOpenSubsonicRequest(t, serverMux.URL, "/rest/scrobble.view", apiKey)
	query = request.URL.Query()
	query.Add("id", trackOneID)
	query.Set("submission", "false")
	request.URL.RawQuery = query.Encode()

	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(scrobble now playing) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("scrobble now playing status = %q, want ok", payload.Response.Status)
	}
	mu.Lock()
	if handlerErr != nil {
		err = handlerErr
		mu.Unlock()
		t.Fatalf("provider handler error after now playing = %v", err)
	}
	mu.Unlock()

	mu.Lock()
	if len(lastFmRequests) != 1 {
		mu.Unlock()
		t.Fatalf("len(lastFm requests after now playing) = %d, want 1", len(lastFmRequests))
	}
	if got := lastFmRequests[0].Get("method"); got != "track.updateNowPlaying" {
		mu.Unlock()
		t.Fatalf("lastFm now playing method = %q, want %q", got, "track.updateNowPlaying")
	}
	if len(listenBrainzSubmissions) != 1 {
		mu.Unlock()
		t.Fatalf("len(listenbrainz submissions after now playing) = %d, want 1", len(listenBrainzSubmissions))
	}
	if got := listenBrainzSubmissions[0].ListenType; got != "playing_now" {
		mu.Unlock()
		t.Fatalf("listenbrainz now playing type = %q, want %q", got, "playing_now")
	}
	mu.Unlock()

}

func TestOpenSubsonicStarAndUnstarMirrorLoveFeedback(t *testing.T) {
	app, fixture, apiKey := newOpenSubsonicTestApp(t)
	app.settings = normalizeAppSettings(AppSettings{
		OpenSubsonicEnabled:   true,
		OpenSubsonicAPIKey:    apiKey,
		LastFmAPIKey:          "lastfm-key",
		LastFmAPISecret:       "lastfm-secret",
		LastFmSessionKey:      "lastfm-session",
		ListenBrainzUserToken: "listenbrainz-token",
	})
	app.settingsLoaded = true

	var mu sync.Mutex
	lastFmMethods := make([]string, 0)
	feedbackScores := make([]int, 0)
	var handlerErr error
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/":
			body, err := io.ReadAll(request.Body)
			if err != nil {
				mu.Lock()
				if handlerErr == nil {
					handlerErr = err
				}
				mu.Unlock()
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			values, err := url.ParseQuery(string(body))
			if err != nil {
				mu.Lock()
				if handlerErr == nil {
					handlerErr = err
				}
				mu.Unlock()
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			mu.Lock()
			lastFmMethods = append(lastFmMethods, values.Get("method"))
			mu.Unlock()
			writer.Header().Set("Content-Type", "application/xml")
			_, _ = writer.Write([]byte(`<lfm status="ok"></lfm>`))
		case listenBrainzRecordingFeedbackPath:
			var payload struct {
				Score int `json:"score"`
			}
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				mu.Lock()
				if handlerErr == nil {
					handlerErr = err
				}
				mu.Unlock()
				http.Error(writer, err.Error(), http.StatusInternalServerError)
				return
			}
			mu.Lock()
			feedbackScores = append(feedbackScores, payload.Score)
			mu.Unlock()
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"status":"ok"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	originalLastFmAPIBaseURL := lastFmAPIBaseURL
	lastFmAPIBaseURL = server.URL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalLastFmAPIBaseURL
	})
	app.settings.ListenBrainzServerURL = server.URL

	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Title:       "Intro",
		TrackArtist: "Artist One",
		AlbumTitle:  "Album One",
		AlbumArtist: "Artist One",
		RecordingID: "11111111-1111-4111-8111-111111111111",
	})
	app.musicBrainzTagMu.Unlock()

	browse := app.openSubsonicBrowseIndex()
	trackID := ""
	for _, trackSnapshot := range browse.Tracks {
		if normalizePath(trackSnapshot.Track.Path) == normalizePath(fixture.trackOne) {
			trackID = openSubsonicSongID(trackSnapshot.Track.RelativePath)
			break
		}
	}
	if trackID == "" {
		t.Fatal("trackID = empty, want populated song ID")
	}

	serverMux := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer serverMux.Close()

	response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, serverMux.URL, "/rest/star.view?id="+url.QueryEscape(trackID), apiKey))
	if err != nil {
		t.Fatalf("GET(star) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("star status = %q, want ok", payload.Response.Status)
	}
	mu.Lock()
	if handlerErr != nil {
		err = handlerErr
		mu.Unlock()
		t.Fatalf("provider handler error after star = %v", err)
	}
	mu.Unlock()

	response, err = http.DefaultClient.Do(newOpenSubsonicRequest(t, serverMux.URL, "/rest/unstar.view?id="+url.QueryEscape(trackID), apiKey))
	if err != nil {
		t.Fatalf("GET(unstar) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if payload.Response.Status != "ok" {
		t.Fatalf("unstar status = %q, want ok", payload.Response.Status)
	}
	mu.Lock()
	if handlerErr != nil {
		err = handlerErr
		mu.Unlock()
		t.Fatalf("provider handler error after unstar = %v", err)
	}
	mu.Unlock()

	mu.Lock()
	defer mu.Unlock()
	if got, want := lastFmMethods, []string{"track.love", "track.unlove"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("lastFm methods = %#v, want %#v", got, want)
	}
	if got, want := feedbackScores, []int{1, 0}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("listenbrainz feedback scores = %#v, want %#v", got, want)
	}
}

func TestOpenSubsonicBrowseCacheReusesSnapshotWhileMusicBrainzWorkerActive(t *testing.T) {
	app, _, _ := newOpenSubsonicTestApp(t)

	browse := app.openSubsonicBrowseIndex()
	if browse == nil {
		t.Fatal("openSubsonicBrowseIndex() = nil, want cached snapshot")
	}

	app.setMusicBrainzTagWorkerProgress(MusicBrainzTagWorkerProgress{Enabled: true, Active: true})
	app.musicBrainzTagVersion.Add(1)
	if cached := app.openSubsonicBrowseIndex(); cached != browse {
		t.Fatal("openSubsonicBrowseIndex() rebuilt cache while the MusicBrainz worker was active")
	}

	app.setMusicBrainzTagWorkerProgress(MusicBrainzTagWorkerProgress{Enabled: true, Active: false})
	app.musicBrainzTagVersion.Add(1)
	rebuilt := app.openSubsonicBrowseIndex()
	if rebuilt == browse {
		t.Fatal("openSubsonicBrowseIndex() reused a stale cache after the MusicBrainz worker became idle")
	}
	if rebuilt.MusicBrainzVersion != app.musicBrainzTagVersion.Load() {
		t.Fatalf("rebuilt cache MusicBrainzVersion = %d, want %d", rebuilt.MusicBrainzVersion, app.musicBrainzTagVersion.Load())
	}
}

func TestOpenSubsonicGetSongHydratesTechnicalMetadataFromTrackTags(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	originalReadTaglibProperties := readTaglibProperties
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
		readTaglibProperties = originalReadTaglibProperties
	})

	app, fixture, apiKey := newOpenSubsonicTestApp(t)
	readTaglibTags = func(path string) (map[string][]string, error) {
		if normalizePath(path) != normalizePath(fixture.trackOne) {
			return nil, nil
		}
		return map[string][]string{
			"TITLE":  {"Hydrated Intro"},
			"ARTIST": {"Hydrated Artist"},
			"ALBUM":  {"Hydrated Album"},
		}, nil
	}
	readTaglibProperties = func(path string) (taglib.Properties, error) {
		if normalizePath(path) != normalizePath(fixture.trackOne) {
			return taglib.Properties{}, nil
		}
		return taglib.Properties{Length: 5 * time.Second, Channels: 2, SampleRate: 48000, Bitrate: 320}, nil
	}

	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getMusicFolders.view", apiKey)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicFolders) error = %v", err)
	}
	folders := decodeOpenSubsonicResponse(t, response)
	musicFolderID := folders.Response.MusicFolders.MusicFolder[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getIndexes.view", apiKey)
	query := request.URL.Query()
	query.Set("musicFolderId", musicFolderID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getIndexes) error = %v", err)
	}
	indexes := decodeOpenSubsonicResponse(t, response)
	artistDirectoryID := indexes.Response.Indexes.Index[0].Artist[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", artistDirectoryID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory artist) error = %v", err)
	}
	artistDirectory := decodeOpenSubsonicResponse(t, response)
	albumDirectoryID := artistDirectory.Response.Directory.Child[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", albumDirectoryID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory album) error = %v", err)
	}
	albumDirectory := decodeOpenSubsonicResponse(t, response)
	track := albumDirectory.Response.Directory.Child[0]

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getSong.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getSong hydrated) error = %v", err)
	}
	song := decodeOpenSubsonicResponse(t, response)
	if song.Response.Song == nil {
		t.Fatal("song = nil, want hydrated song")
	}
	if song.Response.Song.Duration != 5 {
		t.Fatalf("song duration = %d, want %d", song.Response.Song.Duration, 5)
	}
	if song.Response.Song.BitRate != 320 {
		t.Fatalf("song bitRate = %d, want %d", song.Response.Song.BitRate, 320)
	}
	if song.Response.Song.SamplingRate != 48000 || song.Response.Song.ChannelCount != 2 {
		t.Fatalf("song technical metadata = %#v, want samplingRate 48000 and channelCount 2", song.Response.Song)
	}
	if song.Response.Song.Title != "Hydrated Intro" {
		t.Fatalf("song title = %q, want %q", song.Response.Song.Title, "Hydrated Intro")
	}

	request = newOpenSubsonicRequest(t, server.URL, "/rest/stream.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(stream hydrated) error = %v", err)
	}
	defer response.Body.Close()
	if durationHeader := response.Header.Get("X-Content-Duration"); durationHeader != "5" {
		t.Fatalf("stream X-Content-Duration = %q, want %q", durationHeader, "5")
	}
	if nosniff := response.Header.Get("X-Content-Type-Options"); nosniff != "nosniff" {
		t.Fatalf("stream X-Content-Type-Options = %q, want %q", nosniff, "nosniff")
	}
}

func TestOpenSubsonicStreamFallsBackToStaticTrackWhenTranscodeProducesNoBytes(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	helperDir := t.TempDir()
	helperPath := copyCurrentTestBinary(t, helperDir, toolExecutableName("ffmpeg"))
	app.settings.FFmpegPath = helperPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "1")

	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getMusicFolders.view", apiKey)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicFolders) error = %v", err)
	}
	folders := decodeOpenSubsonicResponse(t, response)
	musicFolderID := folders.Response.MusicFolders.MusicFolder[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getIndexes.view", apiKey)
	query := request.URL.Query()
	query.Set("musicFolderId", musicFolderID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getIndexes) error = %v", err)
	}
	indexes := decodeOpenSubsonicResponse(t, response)
	artistDirectoryID := indexes.Response.Indexes.Index[0].Artist[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", artistDirectoryID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory artist) error = %v", err)
	}
	artistDirectory := decodeOpenSubsonicResponse(t, response)
	albumDirectoryID := artistDirectory.Response.Directory.Child[0].ID

	request = newOpenSubsonicRequest(t, server.URL, "/rest/getMusicDirectory.view", apiKey)
	query = request.URL.Query()
	query.Set("id", albumDirectoryID)
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getMusicDirectory album) error = %v", err)
	}
	albumDirectory := decodeOpenSubsonicResponse(t, response)
	track := albumDirectory.Response.Directory.Child[0]

	request = newOpenSubsonicRequest(t, server.URL, "/rest/stream.view", apiKey)
	query = request.URL.Query()
	query.Set("id", track.ID)
	query.Set("maxBitRate", "128")
	request.URL.RawQuery = query.Encode()
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(stream fallback) error = %v", err)
	}
	defer response.Body.Close()
	body := make([]byte, 64)
	readCount, _ := response.Body.Read(body)
	if got := string(body[:readCount]); got != "track one" {
		t.Fatalf("stream fallback body = %q, want %q", got, "track one")
	}
	if contentType := response.Header.Get("Content-Type"); contentType != "audio/flac" {
		t.Fatalf("stream fallback Content-Type = %q, want %q", contentType, "audio/flac")
	}
	if nosniff := response.Header.Get("X-Content-Type-Options"); nosniff != "nosniff" {
		t.Fatalf("stream fallback X-Content-Type-Options = %q, want %q", nosniff, "nosniff")
	}
	if disposition := response.Header.Get("Content-Disposition"); disposition != "" {
		t.Fatalf("stream fallback Content-Disposition = %q, want empty", disposition)
	}
}

func TestOpenSubsonicHomeEndpoints(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	t.Run("user", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/getUser.view", apiKey)
		query := request.URL.Query()
		query.Set("username", "demo")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getUser) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.User == nil {
			t.Fatal("user = nil, want populated user")
		}
		if payload.Response.User.Username != "demo" {
			t.Fatalf("username = %q, want demo", payload.Response.User.Username)
		}
		if !payload.Response.User.StreamRole {
			t.Fatal("streamRole = false, want true")
		}
	})

	t.Run("album list", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/getAlbumList2.view", apiKey)
		query := request.URL.Query()
		query.Set("type", "newest")
		query.Set("size", "20")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getAlbumList2) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.AlbumList2 == nil || len(payload.Response.AlbumList2.Album) == 0 {
			t.Fatalf("albumList2 = %#v, want albums", payload.Response.AlbumList2)
		}
		if app.openSubsonicBrowse != nil {
			t.Fatal("getAlbumList2 built the full browse cache, want dedicated album-list cache only")
		}
		if app.openSubsonicAlbumList == nil {
			t.Fatal("getAlbumList2 did not populate the album-list cache")
		}
	})

	t.Run("playlists", func(t *testing.T) {
		response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getPlaylists.view", apiKey))
		if err != nil {
			t.Fatalf("GET(getPlaylists) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.Playlists == nil {
			t.Fatal("playlists = nil, want empty container")
		}
	})

	t.Run("scan status", func(t *testing.T) {
		response, err := http.DefaultClient.Do(newOpenSubsonicRequest(t, server.URL, "/rest/getScanStatus.view", apiKey))
		if err != nil {
			t.Fatalf("GET(getScanStatus) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.ScanStatus == nil {
			t.Fatal("scanStatus = nil, want populated container")
		}
	})

	t.Run("random songs", func(t *testing.T) {
		request := newOpenSubsonicRequest(t, server.URL, "/rest/getRandomSongs.view", apiKey)
		query := request.URL.Query()
		query.Set("size", "10")
		request.URL.RawQuery = query.Encode()

		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatalf("GET(getRandomSongs) error = %v", err)
		}
		payload := decodeOpenSubsonicResponse(t, response)
		if payload.Response.RandomSongs == nil || len(payload.Response.RandomSongs.Song) == 0 {
			t.Fatalf("randomSongs = %#v, want songs", payload.Response.RandomSongs)
		}
	})
}

func TestOpenSubsonicAlbumCoverArtAliasesResolve(t *testing.T) {
	app, _, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getAlbumList2.view", apiKey)
	query := request.URL.Query()
	query.Set("type", "newest")
	request.URL.RawQuery = query.Encode()

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getAlbumList2) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.AlbumList2 == nil || len(payload.Response.AlbumList2.Album) == 0 {
		t.Fatalf("albumList2 = %#v, want albums", payload.Response.AlbumList2)
	}

	albumID := payload.Response.AlbumList2.Album[0].ID
	aliasID := strings.Replace(albumID, "album:", "al-album:", 1)
	request = newOpenSubsonicRequest(t, server.URL, "/rest/getCoverArt.view", apiKey)
	query = request.URL.Query()
	query.Set("id", aliasID)
	request.URL.RawQuery = query.Encode()

	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(getCoverArt alias) error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	body := make([]byte, 32)
	readCount, _ := response.Body.Read(body)
	if got := string(body[:readCount]); got != "cover image" {
		t.Fatalf("cover art body = %q, want %q", got, "cover image")
	}
}

func TestOpenSubsonicBrowseCacheInvalidatesOnMusicBrainzUpdates(t *testing.T) {
	app, fixture, apiKey := newOpenSubsonicTestApp(t)
	server := httptest.NewServer(app.newOpenSubsonicServeMux())
	defer server.Close()

	request := newOpenSubsonicRequest(t, server.URL, "/rest/getAlbumList2.view", apiKey)
	query := request.URL.Query()
	query.Set("type", "newest")
	request.URL.RawQuery = query.Encode()

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(initial getAlbumList2) error = %v", err)
	}
	payload := decodeOpenSubsonicResponse(t, response)
	if payload.Response.AlbumList2 == nil || len(payload.Response.AlbumList2.Album) == 0 {
		t.Fatalf("initial albumList2 = %#v, want albums", payload.Response.AlbumList2)
	}
	if got := payload.Response.AlbumList2.Album[0].Name; got != "Album One" {
		t.Fatalf("initial album name = %q, want %q", got, "Album One")
	}

	app.musicBrainzTagMu.Lock()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		AlbumTitle:        "MusicBrainz Album",
		AlbumArtist:       "MusicBrainz Artist",
		Title:             "MusicBrainz Intro",
		ReleaseFolderPath: filepath.ToSlash(filepath.Join(filepath.Base(fixture.rootOne), "Artist One", "Album One")),
	})
	app.musicBrainzTagMu.Unlock()

	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET(updated getAlbumList2) error = %v", err)
	}
	payload = decodeOpenSubsonicResponse(t, response)
	if payload.Response.AlbumList2 == nil || len(payload.Response.AlbumList2.Album) == 0 {
		t.Fatalf("updated albumList2 = %#v, want albums", payload.Response.AlbumList2)
	}
	album := payload.Response.AlbumList2.Album[0]
	if album.Name != "MusicBrainz Album" {
		t.Fatalf("updated album name = %q, want %q", album.Name, "MusicBrainz Album")
	}
	if album.Artist != "MusicBrainz Artist" {
		t.Fatalf("updated album artist = %q, want %q", album.Artist, "MusicBrainz Artist")
	}
}
