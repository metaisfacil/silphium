package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLastFmHelpersAndSocialFeeds(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	if err := parseLastFmResponse([]byte(""), "fallback"); err != nil {
		t.Fatalf("parseLastFmResponse(empty) error = %v, want nil", err)
	}
	if err := parseLastFmResponse([]byte(`<lfm status="failed"><error code="9">Bad session</error></lfm>`), "fallback"); err == nil || err.Error() != "Bad session" {
		t.Fatalf("parseLastFmResponse(failed) = %v, want %q", err, "Bad session")
	}
	if err := parseLastFmResponse([]byte(`not xml`), "fallback"); err == nil || err.Error() != "fallback" {
		t.Fatalf("parseLastFmResponse(invalid xml) = %v, want %q", err, "fallback")
	}

	if _, _, err := lastFmAuthCredentials(" ", "secret"); err == nil {
		t.Fatal("lastFmAuthCredentials(missing key) error = nil, want error")
	}
	if key, secret, err := lastFmAuthCredentials(" key ", " secret "); err != nil || key != "key" || secret != "secret" {
		t.Fatalf("lastFmAuthCredentials() = (%q, %q, %v), want trimmed credentials", key, secret, err)
	}

	app := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "key", LastFmSessionKey: "session"}}
	if key, session, err := app.lastFmSessionCredentials(); err != nil || key != "key" || session != "session" {
		t.Fatalf("lastFmSessionCredentials() = (%q, %q, %v), want stored credentials", key, session, err)
	}
	if _, _, err := (&App{settingsLoaded: true}).lastFmSessionCredentials(); err == nil {
		t.Fatal("lastFmSessionCredentials(missing) error = nil, want error")
	}

	if got := normalizeLastFmSocialCount(0); got != 25 {
		t.Fatalf("normalizeLastFmSocialCount(0) = %d, want 25", got)
	}
	if got := normalizeLastFmSocialCount(999); got != 200 {
		t.Fatalf("normalizeLastFmSocialCount(high) = %d, want 200", got)
	}
	if first, second := stableLastFmSocialID("alice", "Track", 123), stableLastFmSocialID("alice", "Track", 123); first != second {
		t.Fatalf("stableLastFmSocialID() = %d and %d, want deterministic ids", first, second)
	}
	if got := parseLastFmUnixTimestamp("1710000000"); got != 1710000000 {
		t.Fatalf("parseLastFmUnixTimestamp() = %d, want %d", got, 1710000000)
	}
	if got := parseLastFmUnixTimestamp("bad"); got != 0 {
		t.Fatalf("parseLastFmUnixTimestamp(invalid) = %d, want 0", got)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		method := request.URL.Query().Get("method")
		switch method {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`{"friends":{"user":[{"name":"bob"},{"name":"Alice"},{"name":"bob"}]}}`))
		case "user.getrecenttracks":
			user := request.URL.Query().Get("user")
			_, _ = writer.Write([]byte(fmt.Sprintf(`{"recenttracks":{"track":[{"name":"%s Track","artist":{"#text":"%s Artist"},"album":{"#text":"%s Album"},"mbid":"%s","date":{"uts":"171000000%d"},"@attr":{"nowplaying":"%s"}}]}}`, user, user, user, user, len(user), "false")))
		default:
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"error":6,"message":"Bad method"}`))
		}
	}))
	defer server.Close()
	lastFmAPIBaseURL = server.URL

	if body, err := callLastFmReadAPI(map[string]string{"method": "user.getinfo"}); err != nil || string(body) == "" {
		t.Fatalf("callLastFmReadAPI(success) = (%q, %v), want body and nil", string(body), err)
	}
	if _, err := callLastFmReadAPI(map[string]string{"method": "bad.method"}); err == nil || err.Error() != "Bad method" {
		t.Fatalf("callLastFmReadAPI(error) = %v, want parsed message", err)
	}

	feedApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "key", LastFmSessionKey: "session"}}
	following, err := feedApp.GetLastFmFollowing()
	if err != nil {
		t.Fatalf("GetLastFmFollowing() error = %v", err)
	}
	if got, want := len(following), 2; got != want {
		t.Fatalf("GetLastFmFollowing() len = %d, want %d", got, want)
	}
	if following[0] != "Alice" || following[1] != "bob" {
		t.Fatalf("GetLastFmFollowing() = %#v, want sorted unique names", following)
	}

	events, err := feedApp.GetLastFmFollowingFeed(0)
	if err != nil {
		t.Fatalf("GetLastFmFollowingFeed() error = %v", err)
	}
	if got, want := len(events), 2; got != want {
		t.Fatalf("GetLastFmFollowingFeed() len = %d, want %d", got, want)
	}
	if events[0].ListenedAt < events[1].ListenedAt {
		t.Fatalf("GetLastFmFollowingFeed() = %#v, want newest events first", events)
	}
}

func TestLastFmAPIAndSocialEdgeCases(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	fallbackServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = writer.Write([]byte("server error"))
	}))
	defer fallbackServer.Close()
	lastFmAPIBaseURL = fallbackServer.URL
	if _, err := callLastFmAPI(map[string]string{"method": "auth.getToken"}); err == nil || err.Error() != "last.fm request failed with status 500" {
		t.Fatalf("callLastFmAPI(fallback error) = %v, want %q", err, "last.fm request failed with status 500")
	}

	missingTokenServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="ok"></lfm>`))
	}))
	defer missingTokenServer.Close()
	lastFmAPIBaseURL = missingTokenServer.URL
	if _, err := (&App{}).GetLastFmRequestToken("api-key", "shared-secret"); err == nil || err.Error() != "last.fm auth token response did not include a token" {
		t.Fatalf("GetLastFmRequestToken(missing token) = %v, want missing-token error", err)
	}

	missingSessionServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="ok"><session><name>user</name></session></lfm>`))
	}))
	defer missingSessionServer.Close()
	lastFmAPIBaseURL = missingSessionServer.URL
	if _, err := (&App{}).GetLastFmSessionKey("api-key", "shared-secret", "request-token"); err == nil || err.Error() != "last.fm session response did not include a session key" {
		t.Fatalf("GetLastFmSessionKey(missing key) = %v, want missing-session-key error", err)
	}

	feedServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		method := request.URL.Query().Get("method")
		switch method {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`{"friends":{"user":[{"name":"alice"},{"name":"bob"},{"name":"charlie"}]}}`))
		case "user.getrecenttracks":
			switch request.URL.Query().Get("user") {
			case "alice":
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"Track One","artist":{"#text":"Artist One"},"album":{"#text":"Album One"},"mbid":"recording-one","@attr":{"nowplaying":"true"}}]}}`))
			case "bob":
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"","artist":{"#text":"Artist Two"}}]}}`))
			default:
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[]}}`))
			}
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer feedServer.Close()
	lastFmAPIBaseURL = feedServer.URL

	app := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "key", LastFmSessionKey: "session"}}
	events, err := app.GetLastFmFollowingFeed(1)
	if err != nil {
		t.Fatalf("GetLastFmFollowingFeed(edge cases) error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("GetLastFmFollowingFeed(edge cases) len = %d, want 1", len(events))
	}
	if !events[0].PlayingNow || events[0].ListenedAt <= 0 {
		t.Fatalf("GetLastFmFollowingFeed(edge cases) = %#v, want now-playing event with synthesized timestamp", events[0])
	}
}

func TestLastFmSessionAndFollowingErrorCases(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	invalidXMLServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="ok">`))
	}))
	defer invalidXMLServer.Close()
	lastFmAPIBaseURL = invalidXMLServer.URL
	if _, err := (&App{}).GetLastFmSessionKey("api-key", "shared-secret", "request-token"); err == nil || err.Error() != "invalid last.fm session response" {
		t.Fatalf("GetLastFmSessionKey(invalid xml) = %v, want invalid-session-response error", err)
	}

	failedSessionServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="failed"></lfm>`))
	}))
	defer failedSessionServer.Close()
	lastFmAPIBaseURL = failedSessionServer.URL
	if _, err := (&App{}).GetLastFmSessionKey("api-key", "shared-secret", "request-token"); err == nil || err.Error() != "last.fm session request failed" {
		t.Fatalf("GetLastFmSessionKey(failed without message) = %v, want generic failure", err)
	}

	infoErrorServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"user":{}}`))
	}))
	defer infoErrorServer.Close()
	lastFmAPIBaseURL = infoErrorServer.URL
	app := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "key", LastFmSessionKey: "session"}}
	if _, err := app.GetLastFmFollowing(); err == nil || err.Error() != "last.fm user info response did not include a username" {
		t.Fatalf("GetLastFmFollowing(missing username) = %v, want missing-username error", err)
	}

	friendsErrorServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`not-json`))
		}
	}))
	defer friendsErrorServer.Close()
	lastFmAPIBaseURL = friendsErrorServer.URL
	if _, err := app.GetLastFmFollowing(); err == nil || err.Error() != "invalid last.fm friends response" {
		t.Fatalf("GetLastFmFollowing(invalid friends json) = %v, want invalid-friends-response error", err)
	}
}

func TestLastFmHelperAndSubmissionEdgeCases(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	if got := lastFmDurationSeconds(0); got != "" {
		t.Fatalf("lastFmDurationSeconds(0) = %q, want empty", got)
	}
	if got := lastFmTrackNumber("0"); got != "" {
		t.Fatalf("lastFmTrackNumber(zero) = %q, want empty", got)
	}
	if got := lastFmTrackNumber("bad"); got != "" {
		t.Fatalf("lastFmTrackNumber(invalid) = %q, want empty", got)
	}

	dedupApp := &App{}
	metadata := LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track", ReleaseName: "Album"}
	if dedupApp.shouldSkipLastFmDuplicateScrobble(metadata, 0) {
		t.Fatal("shouldSkipLastFmDuplicateScrobble(zero timestamp) = true, want false")
	}
	if dedupApp.shouldSkipLastFmDuplicateScrobble(LastFmTrackMetadata{}, 1710000000) {
		t.Fatal("shouldSkipLastFmDuplicateScrobble(missing names) = true, want false")
	}
	if dedupApp.shouldSkipLastFmDuplicateScrobble(metadata, 1710000000) {
		t.Fatal("first shouldSkipLastFmDuplicateScrobble() = true, want false")
	}
	if !dedupApp.shouldSkipLastFmDuplicateScrobble(metadata, 1710000000) {
		t.Fatal("second shouldSkipLastFmDuplicateScrobble() = false, want true")
	}
	dedupApp.lastFmScrobbleMu.Lock()
	for key, entry := range dedupApp.lastFmRecentScrobbles {
		entry.seenAt = time.Now().Add(-lastFmDuplicateScrobbleWindow - time.Second)
		dedupApp.lastFmRecentScrobbles[key] = entry
	}
	dedupApp.lastFmScrobbleMu.Unlock()
	if dedupApp.shouldSkipLastFmDuplicateScrobble(metadata, 1710000100) {
		t.Fatal("expired last.fm duplicate should not be skipped")
	}

	invalidTokenServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="ok">`))
	}))
	defer invalidTokenServer.Close()
	lastFmAPIBaseURL = invalidTokenServer.URL
	if _, err := (&App{}).GetLastFmRequestToken("api-key", "shared-secret"); err == nil || err.Error() != "invalid last.fm auth token response" {
		t.Fatalf("GetLastFmRequestToken(invalid xml) = %v, want invalid-token-response error", err)
	}

	failedTokenServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="failed"></lfm>`))
	}))
	defer failedTokenServer.Close()
	lastFmAPIBaseURL = failedTokenServer.URL
	if _, err := (&App{}).GetLastFmRequestToken("api-key", "shared-secret"); err == nil || err.Error() != "last.fm auth token request failed" {
		t.Fatalf("GetLastFmRequestToken(failed without message) = %v, want generic failure", err)
	}

	loveApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "api-key", LastFmAPISecret: "shared-secret", LastFmSessionKey: "session-key"}}
	invalidLoveServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`not xml`))
	}))
	defer invalidLoveServer.Close()
	lastFmAPIBaseURL = invalidLoveServer.URL
	if err := loveApp.SubmitLastFmLove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil || err.Error() != "invalid last.fm love response" {
		t.Fatalf("SubmitLastFmLove(invalid response) = %v, want invalid-love-response error", err)
	}
	if err := loveApp.SubmitLastFmUnlove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil || err.Error() != "invalid last.fm unlove response" {
		t.Fatalf("SubmitLastFmUnlove(invalid response) = %v, want invalid-unlove-response error", err)
	}

	feedSkipServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`{"friends":{"user":[{"name":"alice"},{"name":"bob"}]}}`))
		case "user.getrecenttracks":
			if request.URL.Query().Get("user") == "alice" {
				writer.WriteHeader(http.StatusBadRequest)
				_, _ = writer.Write([]byte(`{"error":6,"message":"bad recent tracks"}`))
				return
			}
			_, _ = writer.Write([]byte(`not-json`))
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer feedSkipServer.Close()
	lastFmAPIBaseURL = feedSkipServer.URL
	feedApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "api-key", LastFmSessionKey: "session"}}
	events, err := feedApp.GetLastFmFollowingFeed(10)
	if err != nil {
		t.Fatalf("GetLastFmFollowingFeed(skip errors) error = %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("GetLastFmFollowingFeed(skip errors) = %#v, want no events", events)
	}
}

func TestLastFmRequestValidationAndTransportBranches(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	lastFmAPIBaseURL = "://bad"
	if _, err := callLastFmAPI(map[string]string{"method": "auth.getToken"}); err == nil {
		t.Fatal("callLastFmAPI(invalid url) error = nil, want error")
	}
	if _, err := callLastFmReadAPI(map[string]string{"method": "user.getinfo"}); err == nil {
		t.Fatal("callLastFmReadAPI(invalid url) error = nil, want error")
	}
	if _, err := (&App{}).GetLastFmRequestToken("api-key", "shared-secret"); err == nil {
		t.Fatal("GetLastFmRequestToken(invalid url) error = nil, want error")
	}
	if _, err := (&App{}).GetLastFmSessionKey("api-key", "shared-secret", "request-token"); err == nil {
		t.Fatal("GetLastFmSessionKey(invalid url) error = nil, want error")
	}
	invalidSubmitApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "api-key", LastFmAPISecret: "shared-secret", LastFmSessionKey: "session-key"}}
	if err := invalidSubmitApp.SubmitLastFmLove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil {
		t.Fatal("SubmitLastFmLove(invalid url) error = nil, want error")
	}
	if err := invalidSubmitApp.SubmitLastFmUnlove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil {
		t.Fatal("SubmitLastFmUnlove(invalid url) error = nil, want error")
	}

	if _, err := (&App{}).GetLastFmRequestToken("api-key", " "); err == nil || err.Error() != "last.fm auth requires both API key and shared secret" {
		t.Fatalf("GetLastFmRequestToken(missing secret) = %v, want auth-required error", err)
	}
	if _, err := (&App{}).GetLastFmSessionKey("api-key", "shared-secret", " "); err == nil || err.Error() != "last.fm session exchange requires a request token" {
		t.Fatalf("GetLastFmSessionKey(missing request token) = %v, want request-token-required error", err)
	}

	fallbackServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	defer fallbackServer.Close()
	lastFmAPIBaseURL = fallbackServer.URL
	if _, err := callLastFmAPI(map[string]string{"method": "auth.getToken"}); err == nil || err.Error() != "last.fm request failed with status 500" {
		t.Fatalf("callLastFmAPI(empty 500) = %v, want fallback status error", err)
	}

	readFallbackServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = writer.Write([]byte(`{}`))
	}))
	defer readFallbackServer.Close()
	lastFmAPIBaseURL = readFallbackServer.URL
	if _, err := callLastFmReadAPI(map[string]string{"method": "user.getinfo"}); err == nil || err.Error() != "last.fm request failed with status 500" {
		t.Fatalf("callLastFmReadAPI(no message) = %v, want fallback status error", err)
	}

	parsedReadErrorServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"error":6,"message":"read exploded"}`))
	}))
	defer parsedReadErrorServer.Close()
	lastFmAPIBaseURL = parsedReadErrorServer.URL
	if _, err := callLastFmReadAPI(map[string]string{"method": "user.getinfo"}); err == nil || err.Error() != "read exploded" {
		t.Fatalf("callLastFmReadAPI(parsed 200 error) = %v, want parsed message", err)
	}
}

func TestLastFmSubmitAndSocialValidationBranches(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	missingCredentialApp := &App{settingsLoaded: true}
	if err := missingCredentialApp.SubmitLastFmLove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil || err.Error() != "last.fm scrobbling requires an API key, shared secret, and session key" {
		t.Fatalf("SubmitLastFmLove(missing credentials) = %v, want credentials-required error", err)
	}
	if err := missingCredentialApp.SubmitLastFmUnlove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil || err.Error() != "last.fm scrobbling requires an API key, shared secret, and session key" {
		t.Fatalf("SubmitLastFmUnlove(missing credentials) = %v, want credentials-required error", err)
	}

	app := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "api-key", LastFmAPISecret: "shared-secret", LastFmSessionKey: "session-key"}}
	if err := app.SubmitLastFm("single", LastFmTrackMetadata{}, 1710000000); err == nil || err.Error() != "artist name and track name are required for Last.fm submissions" {
		t.Fatalf("SubmitLastFm(missing metadata) = %v, want metadata-required error", err)
	}
	if err := app.SubmitLastFm("invalid", LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}, 1710000000); err == nil || err.Error() != "listen type must be either playing_now or single" {
		t.Fatalf("SubmitLastFm(invalid type) = %v, want listen-type error", err)
	}

	duplicateMetadata := LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track", ReleaseName: "Album"}
	app.lastFmRecentScrobbles = map[string]lastFmScrobbleDedupEntry{
		lastFmScrobbleFingerprint(duplicateMetadata): {
			seenAt:     time.Now(),
			listenedAt: time.Now().Unix(),
		},
	}
	requestCount := 0
	duplicateServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		_, _ = writer.Write([]byte(`<lfm status="ok"></lfm>`))
	}))
	defer duplicateServer.Close()
	lastFmAPIBaseURL = duplicateServer.URL
	if err := app.SubmitLastFm("single", duplicateMetadata, 0); err != nil {
		t.Fatalf("SubmitLastFm(single duplicate with zero timestamp) error = %v", err)
	}
	if requestCount != 0 {
		t.Fatalf("SubmitLastFm(single duplicate with zero timestamp) requestCount = %d, want 0", requestCount)
	}

	missingTrackApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "api-key", LastFmAPISecret: "shared-secret", LastFmSessionKey: "session-key"}}
	if err := missingTrackApp.SubmitLastFmLove(LastFmTrackMetadata{ArtistName: "Artist"}); err == nil || err.Error() != "artist name and track name are required for Last.fm love submissions" {
		t.Fatalf("SubmitLastFmLove(missing track) = %v, want metadata-required error", err)
	}
	if err := missingTrackApp.SubmitLastFmUnlove(LastFmTrackMetadata{ArtistName: "Artist"}); err == nil || err.Error() != "artist name and track name are required for Last.fm unlove submissions" {
		t.Fatalf("SubmitLastFmUnlove(missing track) = %v, want metadata-required error", err)
	}

	if _, err := (&App{settingsLoaded: true}).GetLastFmFollowing(); err == nil || err.Error() != "last.fm social feed requires an API key and session key" {
		t.Fatalf("GetLastFmFollowing(missing credentials) = %v, want credentials-required error", err)
	}
	if _, err := (&App{settingsLoaded: true}).GetLastFmFollowingFeed(5); err == nil || err.Error() != "last.fm social feed requires an API key and session key" {
		t.Fatalf("GetLastFmFollowingFeed(missing credentials) = %v, want credentials-required error", err)
	}

	infoErrorServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"error":6,"message":"info failed"}`))
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer infoErrorServer.Close()
	lastFmAPIBaseURL = infoErrorServer.URL
	socialApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "key", LastFmSessionKey: "session"}}
	if _, err := socialApp.GetLastFmFollowing(); err == nil || err.Error() != "info failed" {
		t.Fatalf("GetLastFmFollowing(info error) = %v, want parsed error", err)
	}

	friendsErrorServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`{"error":6,"message":"friends failed"}`))
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer friendsErrorServer.Close()
	lastFmAPIBaseURL = friendsErrorServer.URL
	if _, err := socialApp.GetLastFmFollowing(); err == nil || err.Error() != "friends failed" {
		t.Fatalf("GetLastFmFollowing(friends error) = %v, want parsed error", err)
	}

	feedBranchServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`{"friends":{"user":[{"name":"   "},{"name":"alice"},{"name":"bob"},{"name":"charlie"},{"name":"dan"}]}}`))
		case "user.getrecenttracks":
			switch request.URL.Query().Get("user") {
			case "alice":
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[]}}`))
			case "bob":
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"","artist":{"#text":"Bob Artist"},"date":{"uts":"1710000001"}}]}}`))
			case "charlie":
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"Charlie Track","artist":{"#text":""},"album":{"#text":"Charlie Album"},"mbid":"charlie-mbid","date":{"uts":"1710000001"}}]}}`))
			case "dan":
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"Dan Track","artist":{"#text":"Dan Artist"},"album":{"#text":"Dan Album"},"mbid":"dan-mbid","date":{"uts":"1710000001"}}]}}`))
			default:
				writer.WriteHeader(http.StatusBadRequest)
			}
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer feedBranchServer.Close()
	lastFmAPIBaseURL = feedBranchServer.URL
	events, err := socialApp.GetLastFmFollowingFeed(10)
	if err != nil {
		t.Fatalf("GetLastFmFollowingFeed(branches) error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("GetLastFmFollowingFeed(branches) len = %d, want 2", len(events))
	}
	if events[0].ListenedAt != events[1].ListenedAt || events[0].ID <= events[1].ID {
		t.Fatalf("GetLastFmFollowingFeed(branches) = %#v, want stable id tie-break for equal timestamps", events)
	}
	unknownArtistFound := false
	for _, event := range events {
		if event.TrackMetadata.ArtistName == "Unknown artist" {
			unknownArtistFound = true
		}
	}
	if !unknownArtistFound {
		t.Fatalf("GetLastFmFollowingFeed(branches) = %#v, want unknown-artist fallback event", events)
	}
}

func TestLastFmAdditionalFallbackTransportAndFeedBranches(t *testing.T) {
	originalBaseURL := lastFmAPIBaseURL
	t.Cleanup(func() {
		lastFmAPIBaseURL = originalBaseURL
	})

	if err := parseLastFmResponse([]byte(`<lfm status="failed"></lfm>`), "fallback"); err == nil || err.Error() != "fallback" {
		t.Fatalf("parseLastFmResponse(failed without message) = %v, want %q", err, "fallback")
	}
	if got := lastFmTrackNumber(" / 12 "); got != "" {
		t.Fatalf("lastFmTrackNumber(empty after slash) = %q, want empty", got)
	}

	lastFmAPIBaseURL = "http://127.0.0.1:1"
	if _, err := callLastFmAPI(map[string]string{"method": "auth.getToken"}); err == nil {
		t.Fatal("callLastFmAPI(do error) error = nil, want error")
	}
	if _, err := callLastFmReadAPI(map[string]string{"method": "user.getinfo"}); err == nil {
		t.Fatal("callLastFmReadAPI(do error) error = nil, want error")
	}
	if _, err := (&App{}).GetLastFmSessionKey("api-key", " ", "request-token"); err == nil || err.Error() != "last.fm auth requires both API key and shared secret" {
		t.Fatalf("GetLastFmSessionKey(missing secret) = %v, want auth-required error", err)
	}

	failedSessionMessageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`<lfm status="failed"><error code="9">bad session</error></lfm>`))
	}))
	defer failedSessionMessageServer.Close()
	lastFmAPIBaseURL = failedSessionMessageServer.URL
	if _, err := (&App{}).GetLastFmSessionKey("api-key", "shared-secret", "request-token"); err == nil || err.Error() != "bad session" {
		t.Fatalf("GetLastFmSessionKey(failed with message) = %v, want parsed error message", err)
	}

	preferenceApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "api-key", LastFmAPISecret: "shared-secret", LastFmSessionKey: "session-key"}}
	lastFmAPIBaseURL = "http://127.0.0.1:1"
	if err := preferenceApp.SubmitLastFmLove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil {
		t.Fatal("SubmitLastFmLove(do error) error = nil, want error")
	}

	preferenceFallbackServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusInternalServerError)
	}))
	defer preferenceFallbackServer.Close()
	lastFmAPIBaseURL = preferenceFallbackServer.URL
	if err := preferenceApp.SubmitLastFmLove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil || err.Error() != "last.fm request failed with status 500" {
		t.Fatalf("SubmitLastFmLove(fallback status error) = %v, want fallback status error", err)
	}

	preferenceMessageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusInternalServerError)
		_, _ = writer.Write([]byte(`<lfm status="failed"><error code="9">preference failed</error></lfm>`))
	}))
	defer preferenceMessageServer.Close()
	lastFmAPIBaseURL = preferenceMessageServer.URL
	if err := preferenceApp.SubmitLastFmUnlove(LastFmTrackMetadata{ArtistName: "Artist", TrackName: "Track"}); err == nil || err.Error() != "preference failed" {
		t.Fatalf("SubmitLastFmUnlove(parsed status error) = %v, want parsed error message", err)
	}

	invalidInfoServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`not-json`))
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer invalidInfoServer.Close()
	lastFmAPIBaseURL = invalidInfoServer.URL
	socialApp := &App{settingsLoaded: true, settings: AppSettings{LastFmAPIKey: "key", LastFmSessionKey: "session"}}
	if _, err := socialApp.GetLastFmFollowing(); err == nil || err.Error() != "invalid last.fm user info response" {
		t.Fatalf("GetLastFmFollowing(invalid user info json) = %v, want invalid-user-info error", err)
	}
	if _, err := socialApp.GetLastFmFollowingFeed(5); err == nil || err.Error() != "invalid last.fm user info response" {
		t.Fatalf("GetLastFmFollowingFeed(following error propagation) = %v, want invalid-user-info error", err)
	}

	feedLimitServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Query().Get("method") {
		case "user.getinfo":
			_, _ = writer.Write([]byte(`{"user":{"name":"tester"}}`))
		case "user.getfriends":
			_, _ = writer.Write([]byte(`{"friends":{"user":[{"name":"alice"},{"name":"bob"}]}}`))
		case "user.getrecenttracks":
			user := request.URL.Query().Get("user")
			if user == "alice" {
				_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"Alice Track","artist":{"#text":"Alice Artist"},"album":{"#text":"Alice Album"},"date":{"uts":"1710000002"}}]}}`))
				return
			}
			_, _ = writer.Write([]byte(`{"recenttracks":{"track":[{"name":"Bob Track","artist":{"#text":"Bob Artist"},"album":{"#text":"Bob Album"},"date":{"uts":"1710000001"}}]}}`))
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer feedLimitServer.Close()
	lastFmAPIBaseURL = feedLimitServer.URL
	events, err := socialApp.GetLastFmFollowingFeed(1)
	if err != nil {
		t.Fatalf("GetLastFmFollowingFeed(limit) error = %v", err)
	}
	if len(events) != 1 || events[0].UserName != "alice" {
		t.Fatalf("GetLastFmFollowingFeed(limit) = %#v, want only the newest alice event", events)
	}
}
