package main

import (
	"crypto/md5"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSignLastFmParams(t *testing.T) {
	t.Parallel()

	params := map[string]string{
		"api_key": "api-key",
		"artist":  "Test Artist",
		"method":  "track.updateNowPlaying",
		"sk":      "session-key",
		"track":   "Test Track",
	}

	got := signLastFmParams(params, "shared-secret")
	wantBytes := md5.Sum([]byte("api_keyapi-keyartistTest Artistmethodtrack.updateNowPlayingsksession-keytrackTest Trackshared-secret"))
	want := hex.EncodeToString(wantBytes[:])
	if got != want {
		t.Fatalf("signLastFmParams() = %q, want %q", got, want)
	}
}

func TestSubmitLastFm(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	t.Run("submits now playing and scrobble payloads", func(t *testing.T) {
		requestBodies := make([]url.Values, 0, 2)
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodPost {
				t.Fatalf("request method = %s, want %s", request.Method, http.MethodPost)
			}

			rawBody, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("ReadAll(request.Body) error = %v", err)
			}

			values, err := url.ParseQuery(string(rawBody))
			if err != nil {
				t.Fatalf("ParseQuery(request.Body) error = %v", err)
			}

			requestBodies = append(requestBodies, values)
			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"ok\"></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{
			settingsLoaded: true,
			settings: AppSettings{
				LastFmAPIKey:     " api-key ",
				LastFmAPISecret:  " shared-secret ",
				LastFmSessionKey: " session-key ",
			},
		}

		nowPlayingMetadata := LastFmTrackMetadata{
			ArtistName:      "Test Artist",
			TrackName:       "Test Track",
			ReleaseName:     "Test Album",
			AlbumArtist:     "Album Artist",
			TrackNumber:     "03/10",
			RecordingMBID:   "recording-mbid",
			DurationSeconds: 321,
		}
		if err := app.SubmitLastFm("playing_now", nowPlayingMetadata, 0); err != nil {
			t.Fatalf("SubmitLastFm(playing_now) error = %v", err)
		}

		scrobbleMetadata := LastFmTrackMetadata{
			ArtistName:    "Second Artist",
			TrackName:     "Second Track",
			ReleaseName:   "Second Album",
			TrackNumber:   "7",
			RecordingMBID: "second-recording-mbid",
		}
		if err := app.SubmitLastFm("single", scrobbleMetadata, 1710000000); err != nil {
			t.Fatalf("SubmitLastFm(single) error = %v", err)
		}

		if len(requestBodies) != 2 {
			t.Fatalf("request count = %d, want 2", len(requestBodies))
		}

		nowPlayingBody := requestBodies[0]
		if got := nowPlayingBody.Get("method"); got != "track.updateNowPlaying" {
			t.Fatalf("now-playing method = %q, want %q", got, "track.updateNowPlaying")
		}
		if got := nowPlayingBody.Get("artist"); got != "Test Artist" {
			t.Fatalf("now-playing artist = %q, want %q", got, "Test Artist")
		}
		if got := nowPlayingBody.Get("track"); got != "Test Track" {
			t.Fatalf("now-playing track = %q, want %q", got, "Test Track")
		}
		if got := nowPlayingBody.Get("album"); got != "Test Album" {
			t.Fatalf("now-playing album = %q, want %q", got, "Test Album")
		}
		if got := nowPlayingBody.Get("albumArtist"); got != "Album Artist" {
			t.Fatalf("now-playing albumArtist = %q, want %q", got, "Album Artist")
		}
		if got := nowPlayingBody.Get("trackNumber"); got != "3" {
			t.Fatalf("now-playing trackNumber = %q, want %q", got, "3")
		}
		if got := nowPlayingBody.Get("mbid"); got != "recording-mbid" {
			t.Fatalf("now-playing mbid = %q, want %q", got, "recording-mbid")
		}
		if got := nowPlayingBody.Get("duration"); got != "321" {
			t.Fatalf("now-playing duration = %q, want %q", got, "321")
		}
		if got := nowPlayingBody.Get("timestamp"); got != "" {
			t.Fatalf("now-playing timestamp = %q, want empty", got)
		}
		if got := nowPlayingBody.Get("api_sig"); got == "" {
			t.Fatal("now-playing api_sig should not be empty")
		}

		scrobbleBody := requestBodies[1]
		if got := scrobbleBody.Get("method"); got != "track.scrobble" {
			t.Fatalf("scrobble method = %q, want %q", got, "track.scrobble")
		}
		if got := scrobbleBody.Get("timestamp"); got != "1710000000" {
			t.Fatalf("scrobble timestamp = %q, want %q", got, "1710000000")
		}
		if got := scrobbleBody.Get("trackNumber"); got != "7" {
			t.Fatalf("scrobble trackNumber = %q, want %q", got, "7")
		}
	})

	t.Run("returns parsed api errors", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"failed\"><error code=\"9\">Invalid session key - Please re-authenticate</error></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{
			settingsLoaded: true,
			settings: AppSettings{
				LastFmAPIKey:     "api-key",
				LastFmAPISecret:  "shared-secret",
				LastFmSessionKey: "session-key",
			},
		}

		err := app.SubmitLastFm("single", LastFmTrackMetadata{
			ArtistName: "Test Artist",
			TrackName:  "Test Track",
		}, 1710000000)
		if err == nil {
			t.Fatal("SubmitLastFm() error = nil, want error")
		}
		if !strings.Contains(err.Error(), "Invalid session key") {
			t.Fatalf("SubmitLastFm() error = %q, want Last.fm API error", err.Error())
		}
	})

	t.Run("requires complete credentials", func(t *testing.T) {
		app := &App{
			settingsLoaded: true,
			settings: AppSettings{
				LastFmAPIKey:     "api-key",
				LastFmAPISecret:  "",
				LastFmSessionKey: "session-key",
			},
		}

		err := app.SubmitLastFm("playing_now", LastFmTrackMetadata{
			ArtistName: "Test Artist",
			TrackName:  "Test Track",
		}, 0)
		if err == nil {
			t.Fatal("SubmitLastFm() error = nil, want error")
		}
		if got, want := err.Error(), "last.fm scrobbling requires an API key, shared secret, and session key"; got != want {
			t.Fatalf("SubmitLastFm() error = %q, want %q", got, want)
		}
	})

	t.Run("suppresses duplicate single scrobbles", func(t *testing.T) {
		requestCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			requestCount++
			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"ok\"></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{
			settingsLoaded: true,
			settings: AppSettings{
				LastFmAPIKey:     "api-key",
				LastFmAPISecret:  "shared-secret",
				LastFmSessionKey: "session-key",
			},
		}

		metadata := LastFmTrackMetadata{
			ArtistName:    "Duplicate Artist",
			TrackName:     "Duplicate Track",
			ReleaseName:   "Duplicate Album",
			RecordingMBID: "duplicate-recording-mbid",
		}

		if err := app.SubmitLastFm("single", metadata, 1710000000); err != nil {
			t.Fatalf("first SubmitLastFm(single) error = %v", err)
		}
		if err := app.SubmitLastFm("single", metadata, 1710000000); err != nil {
			t.Fatalf("second SubmitLastFm(single) error = %v", err)
		}

		if requestCount != 1 {
			t.Fatalf("request count = %d, want 1", requestCount)
		}
	})

	t.Run("suppresses near-duplicate single scrobbles with drifted timestamps", func(t *testing.T) {
		requestCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			requestCount++
			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"ok\"></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{
			settingsLoaded: true,
			settings: AppSettings{
				LastFmAPIKey:     "api-key",
				LastFmAPISecret:  "shared-secret",
				LastFmSessionKey: "session-key",
			},
		}

		metadata := LastFmTrackMetadata{
			ArtistName:    "Duplicate Artist",
			TrackName:     "Duplicate Track",
			ReleaseName:   "Duplicate Album",
			RecordingMBID: "duplicate-recording-mbid",
		}

		if err := app.SubmitLastFm("single", metadata, 1710000000); err != nil {
			t.Fatalf("first SubmitLastFm(single) error = %v", err)
		}
		if err := app.SubmitLastFm("single", metadata, 1710000008); err != nil {
			t.Fatalf("second SubmitLastFm(single) error = %v", err)
		}

		if requestCount != 1 {
			t.Fatalf("request count = %d, want 1", requestCount)
		}
	})

	t.Run("suppresses duplicate single scrobbles when artist label changes", func(t *testing.T) {
		requestCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			requestCount++
			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"ok\"></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{
			settingsLoaded: true,
			settings: AppSettings{
				LastFmAPIKey:     "api-key",
				LastFmAPISecret:  "shared-secret",
				LastFmSessionKey: "session-key",
			},
		}

		if err := app.SubmitLastFm("single", LastFmTrackMetadata{
			ArtistName:    "Masato Kouda",
			TrackName:     "コメディックスタイル",
			ReleaseName:   "「魔法戦争」オリジナルサウンドトラック",
			RecordingMBID: "",
		}, 1710000100); err != nil {
			t.Fatalf("first SubmitLastFm(single) error = %v", err)
		}

		if err := app.SubmitLastFm("single", LastFmTrackMetadata{
			ArtistName:    "甲田雅人",
			TrackName:     "コメディックスタイル",
			ReleaseName:   "「魔法戦争」オリジナルサウンドトラック",
			RecordingMBID: "",
		}, 1710000106); err != nil {
			t.Fatalf("second SubmitLastFm(single) error = %v", err)
		}

		if requestCount != 1 {
			t.Fatalf("request count = %d, want 1", requestCount)
		}
	})
}

func TestGetLastFmRequestToken(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	t.Run("returns token from successful response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			rawBody, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("ReadAll(request.Body) error = %v", err)
			}

			values, err := url.ParseQuery(string(rawBody))
			if err != nil {
				t.Fatalf("ParseQuery(request.Body) error = %v", err)
			}

			if got := values.Get("method"); got != "auth.getToken" {
				t.Fatalf("method = %q, want %q", got, "auth.getToken")
			}
			if got := values.Get("api_key"); got != "api-key" {
				t.Fatalf("api_key = %q, want %q", got, "api-key")
			}
			if values.Get("api_sig") == "" {
				t.Fatal("api_sig should not be empty")
			}

			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"ok\"><token>request-token</token></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{}

		token, err := app.GetLastFmRequestToken("api-key", "shared-secret")
		if err != nil {
			t.Fatalf("GetLastFmRequestToken() error = %v", err)
		}
		if token != "request-token" {
			t.Fatalf("GetLastFmRequestToken() = %q, want %q", token, "request-token")
		}
	})

	t.Run("returns explicit api error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"failed\"><error code=\"10\">Invalid API key</error></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{}

		_, err := app.GetLastFmRequestToken("api-key", "shared-secret")
		if err == nil {
			t.Fatal("GetLastFmRequestToken() error = nil, want error")
		}
		if !strings.Contains(err.Error(), "Invalid API key") {
			t.Fatalf("GetLastFmRequestToken() error = %q, want API error message", err.Error())
		}
	})
}

func TestGetLastFmSessionKey(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	t.Run("returns session key from successful response", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			rawBody, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("ReadAll(request.Body) error = %v", err)
			}

			values, err := url.ParseQuery(string(rawBody))
			if err != nil {
				t.Fatalf("ParseQuery(request.Body) error = %v", err)
			}

			if got := values.Get("method"); got != "auth.getSession" {
				t.Fatalf("method = %q, want %q", got, "auth.getSession")
			}
			if got := values.Get("token"); got != "request-token" {
				t.Fatalf("token = %q, want %q", got, "request-token")
			}

			writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
			_, _ = writer.Write([]byte("<lfm status=\"ok\"><session><name>user</name><key>session-key</key></session></lfm>"))
		}))
		defer server.Close()

		lastFmAPIBaseURL = server.URL
		app := &App{}

		sessionKey, err := app.GetLastFmSessionKey("api-key", "shared-secret", "request-token")
		if err != nil {
			t.Fatalf("GetLastFmSessionKey() error = %v", err)
		}
		if sessionKey != "session-key" {
			t.Fatalf("GetLastFmSessionKey() = %q, want %q", sessionKey, "session-key")
		}
	})

	t.Run("validates required request token", func(t *testing.T) {
		app := &App{}
		_, err := app.GetLastFmSessionKey("api-key", "shared-secret", "")
		if err == nil {
			t.Fatal("GetLastFmSessionKey() error = nil, want error")
		}
		if got, want := err.Error(), "last.fm session exchange requires a request token"; got != want {
			t.Fatalf("GetLastFmSessionKey() error = %q, want %q", got, want)
		}
	})
}
