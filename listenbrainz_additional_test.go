package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestListenBrainzHelpersAndFeedback(t *testing.T) {
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache = map[string]string{}
	listenBrainzUserNameCacheMu.Unlock()

	if got := normalizedListenBrainzFeedbackScore(7); got != 0 {
		t.Fatalf("normalizedListenBrainzFeedbackScore(7) = %d, want 0", got)
	}
	if got := normalizedListenBrainzFeedbackScore(-1); got != -1 {
		t.Fatalf("normalizedListenBrainzFeedbackScore(-1) = %d, want -1", got)
	}
	if err := parseListenBrainzError(http.StatusBadRequest, []byte(`{"error":"bad token"}`), "fallback"); err == nil || err.Error() != "bad token" {
		t.Fatalf("parseListenBrainzError(error field) = %v, want %q", err, "bad token")
	}
	if err := parseListenBrainzError(http.StatusBadRequest, []byte(`{"message":"bad request"}`), "fallback"); err == nil || err.Error() != "bad request" {
		t.Fatalf("parseListenBrainzError(message field) = %v, want %q", err, "bad request")
	}
	if err := parseListenBrainzError(http.StatusBadRequest, []byte(`{}`), "fallback"); err == nil || err.Error() != "fallback with status 400" {
		t.Fatalf("parseListenBrainzError(fallback) = %v, want fallback status error", err)
	}

	if got := normalizeListenBrainzSocialCount(0); got != 25 {
		t.Fatalf("normalizeListenBrainzSocialCount(0) = %d, want 25", got)
	}
	if got := normalizeListenBrainzSocialCount(1500); got != 1000 {
		t.Fatalf("normalizeListenBrainzSocialCount(high) = %d, want 1000", got)
	}

	app := newTestAppWithLoadedSettings(AppSettings{ListenBrainzServerURL: "https://listenbrainz.example/", ListenBrainzRequestRateMs: 0, ListenBrainzUserToken: "token"})
	if got := app.listenBrainzServerURL(); got != "https://listenbrainz.example" {
		t.Fatalf("listenBrainzServerURL() = %q, want %q", got, "https://listenbrainz.example")
	}
	if got := newTestAppWithSettingsLoaded().listenBrainzServerURL(); got != listenBrainzPublicServerURL {
		t.Fatalf("listenBrainzServerURL(default) = %q, want %q", got, listenBrainzPublicServerURL)
	}
	if got := app.listenBrainzRequestRateMs(); got != 0 {
		t.Fatalf("listenBrainzRequestRateMs() = %d, want 0", got)
	}
	if token, err := app.listenBrainzToken(); err != nil || token != "token" {
		t.Fatalf("listenBrainzToken() = (%q, %v), want token and nil", token, err)
	}
	if _, err := newTestAppWithSettingsLoaded().listenBrainzToken(); err == nil {
		t.Fatal("listenBrainzToken(missing) error = nil, want error")
	}

	const token = "secret-token"
	const userName = "tester"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Token "+token {
			t.Fatalf("Authorization header = %q, want %q", request.Header.Get("Authorization"), "Token "+token)
		}

		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": userName})
		case listenBrainzRecordingFeedbackPath:
			writer.WriteHeader(http.StatusOK)
		case "/1/feedback/user/tester/get-feedback-for-recordings":
			_ = json.NewEncoder(writer).Encode(map[string]any{"feedback": []map[string]any{{"recording_mbid": "recording-id", "score": 1}}})
		default:
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"message":"bad request"}`))
		}
	}))
	defer server.Close()

	feedbackApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: token, ListenBrainzServerURL: server.URL, ListenBrainzRequestRateMs: 0})
	user, err := feedbackApp.listenBrainzUserName(token)
	if err != nil || user != userName {
		t.Fatalf("listenBrainzUserName() = (%q, %v), want (%q, nil)", user, err, userName)
	}
	if cachedUser, err := feedbackApp.listenBrainzUserName(token); err != nil || cachedUser != userName {
		t.Fatalf("listenBrainzUserName(cache) = (%q, %v), want cached user", cachedUser, err)
	}

	if err := feedbackApp.SubmitListenBrainzRecordingFeedback("recording-id", 1); err != nil {
		t.Fatalf("SubmitListenBrainzRecordingFeedback() error = %v", err)
	}
	if err := feedbackApp.SubmitListenBrainzRecordingFeedback("", 1); err == nil {
		t.Fatal("SubmitListenBrainzRecordingFeedback(empty mbid) error = nil, want error")
	}
	if err := feedbackApp.SubmitListenBrainzRecordingFeedback("recording-id", 7); err == nil {
		t.Fatal("SubmitListenBrainzRecordingFeedback(invalid score) error = nil, want error")
	}

	score, err := feedbackApp.GetListenBrainzRecordingFeedback("recording-id")
	if err != nil || score != 1 {
		t.Fatalf("GetListenBrainzRecordingFeedback() = (%d, %v), want (1, nil)", score, err)
	}
	if score, err := feedbackApp.GetListenBrainzRecordingFeedback("missing-id"); err != nil || score != 0 {
		t.Fatalf("GetListenBrainzRecordingFeedback(missing) = (%d, %v), want (0, nil)", score, err)
	}

	errorServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"message":"bad request"}`))
	}))
	defer errorServer.Close()
	errorToken := "different-token"
	errorApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: errorToken, ListenBrainzServerURL: errorServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := errorApp.listenBrainzUserName(errorToken); err == nil || !strings.Contains(err.Error(), "bad request") {
		t.Fatalf("listenBrainzUserName(error) = %v, want parsed error", err)
	}
}

func TestWaitForListenBrainzRequestSlot(t *testing.T) {
	listenBrainzFetchMu.Lock()
	originalNextFetchAt := nextListenBrainzFetchAt
	nextListenBrainzFetchAt = time.Time{}
	listenBrainzFetchMu.Unlock()
	t.Cleanup(func() {
		listenBrainzFetchMu.Lock()
		nextListenBrainzFetchAt = originalNextFetchAt
		listenBrainzFetchMu.Unlock()
	})

	waitForListenBrainzRequestSlot(0)
	listenBrainzFetchMu.Lock()
	if !nextListenBrainzFetchAt.IsZero() {
		listenBrainzFetchMu.Unlock()
		t.Fatal("waitForListenBrainzRequestSlot(0) changed next fetch time, want zero value")
	}
	listenBrainzFetchMu.Unlock()

	listenBrainzFetchMu.Lock()
	nextListenBrainzFetchAt = time.Now().Add(5 * time.Millisecond)
	listenBrainzFetchMu.Unlock()

	start := time.Now()
	waitForListenBrainzRequestSlot(1)
	if elapsed := time.Since(start); elapsed < 4*time.Millisecond {
		t.Fatalf("waitForListenBrainzRequestSlot() elapsed = %v, want >= 4ms", elapsed)
	}

	listenBrainzFetchMu.Lock()
	updatedNextFetchAt := nextListenBrainzFetchAt
	listenBrainzFetchMu.Unlock()
	if updatedNextFetchAt.Before(start.Add(time.Millisecond)) {
		t.Fatalf("nextListenBrainzFetchAt = %v, want at or after %v", updatedNextFetchAt, start.Add(time.Millisecond))
	}
}

func TestSubmitListenBrainzValidationAndErrors(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != listenBrainzSubmitPath {
			t.Fatalf("request path = %q, want %q", request.URL.Path, listenBrainzSubmitPath)
		}

		requestCount++
		parsedRequest := listenBrainzSubmitRequest{}
		if err := json.NewDecoder(request.Body).Decode(&parsedRequest); err != nil {
			t.Fatalf("Decode(request.Body) error = %v", err)
		}
		if len(parsedRequest.Payload) != 1 {
			t.Fatalf("SubmitListenBrainz request payload = %#v, want one payload item", parsedRequest)
		}
		if parsedRequest.ListenType == "single" && parsedRequest.Payload[0].ListenedAt <= 0 {
			t.Fatalf("SubmitListenBrainz request payload = %#v, want populated listened_at for single listens", parsedRequest)
		}

		if requestCount == 1 {
			writer.WriteHeader(http.StatusOK)
			return
		}

		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"message":"submit failed"}`))
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "token", ListenBrainzServerURL: server.URL, ListenBrainzRequestRateMs: 0})
	metadata := ListenBrainzTrackMetadata{ArtistName: "Artist", TrackName: "Track", ReleaseName: "Album"}

	if err := app.SubmitListenBrainz("single", metadata, 0); err != nil {
		t.Fatalf("SubmitListenBrainz(single auto timestamp) error = %v", err)
	}
	if err := app.SubmitListenBrainz("playing_now", metadata, 0); err == nil || err.Error() != "submit failed" {
		t.Fatalf("SubmitListenBrainz(server error) = %v, want %q", err, "submit failed")
	}
	if err := app.SubmitListenBrainz("bad", metadata, 0); err == nil {
		t.Fatal("SubmitListenBrainz(invalid type) error = nil, want error")
	}
	if err := app.SubmitListenBrainz("single", ListenBrainzTrackMetadata{}, 0); err == nil {
		t.Fatal("SubmitListenBrainz(missing metadata) error = nil, want error")
	}
}

func TestSubmitListenBrainzRecordingFeedbackServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = writer.Write([]byte(`{"message":"feedback failed"}`))
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "token", ListenBrainzServerURL: server.URL, ListenBrainzRequestRateMs: 0})
	if err := app.SubmitListenBrainzRecordingFeedback("recording-id", 1); err == nil || err.Error() != "feedback failed" {
		t.Fatalf("SubmitListenBrainzRecordingFeedback(server error) = %v, want %q", err, "feedback failed")
	}
}

func TestListenBrainzUserAndFeedbackErrorCases(t *testing.T) {
	invalidJSONServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`not-json`))
	}))
	defer invalidJSONServer.Close()

	app := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "token", ListenBrainzServerURL: invalidJSONServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := app.listenBrainzUserName("token"); err == nil || err.Error() != "invalid listenbrainz validate-token response" {
		t.Fatalf("listenBrainzUserName(invalid json) = %v, want invalid-validate-token error", err)
	}

	invalidTokenServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]any{"valid": false})
	}))
	defer invalidTokenServer.Close()
	app.settings.ListenBrainzServerURL = invalidTokenServer.URL
	if _, err := app.listenBrainzUserName("token"); err == nil || err.Error() != "listenbrainz token is invalid" {
		t.Fatalf("listenBrainzUserName(invalid token) = %v, want invalid-token error", err)
	}

	missingUserServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true})
	}))
	defer missingUserServer.Close()
	app.settings.ListenBrainzServerURL = missingUserServer.URL
	if _, err := app.listenBrainzUserName("token"); err == nil || err.Error() != "listenbrainz validate-token response did not include user name" {
		t.Fatalf("listenBrainzUserName(missing user) = %v, want missing-user-name error", err)
	}

	feedbackServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			_, _ = writer.Write([]byte(`{"feedback":"bad"}`))
		}
	}))
	defer feedbackServer.Close()
	app.settings.ListenBrainzServerURL = feedbackServer.URL
	if _, err := app.GetListenBrainzRecordingFeedback("recording-id"); err == nil || err.Error() != "invalid listenbrainz feedback response" {
		t.Fatalf("GetListenBrainzRecordingFeedback(invalid json shape) = %v, want invalid-feedback-response error", err)
	}
	if _, err := app.GetListenBrainzRecordingFeedback(""); err == nil || err.Error() != "recording mbid is required" {
		t.Fatalf("GetListenBrainzRecordingFeedback(empty) = %v, want recording-required error", err)
	}
}

func TestListenBrainzFollowingAndDedupErrorCases(t *testing.T) {
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache = map[string]string{}
	listenBrainzUserNameCacheMu.Unlock()

	dedupApp := &App{}
	metadata := ListenBrainzTrackMetadata{ArtistName: "Artist", TrackName: "Track", ReleaseName: "Album"}
	if dedupApp.shouldSkipListenBrainzDuplicateScrobble(metadata, 0) {
		t.Fatal("shouldSkipListenBrainzDuplicateScrobble(zero timestamp) = true, want false")
	}
	if dedupApp.shouldSkipListenBrainzDuplicateScrobble(ListenBrainzTrackMetadata{}, 1710000000) {
		t.Fatal("shouldSkipListenBrainzDuplicateScrobble(missing names) = true, want false")
	}
	if dedupApp.shouldSkipListenBrainzDuplicateScrobble(metadata, 1710000000) {
		t.Fatal("first shouldSkipListenBrainzDuplicateScrobble() = true, want false")
	}
	if !dedupApp.shouldSkipListenBrainzDuplicateScrobble(metadata, 1710000000) {
		t.Fatal("second shouldSkipListenBrainzDuplicateScrobble() = false, want true")
	}
	dedupApp.scrobble.listenBrainzScrobbleMu.Lock()
	for key, entry := range dedupApp.scrobble.listenBrainzRecentScrobbles {
		entry.seenAt = time.Now().Add(-listenBrainzDuplicateScrobbleWindow - time.Second)
		dedupApp.scrobble.listenBrainzRecentScrobbles[key] = entry
	}
	dedupApp.scrobble.listenBrainzScrobbleMu.Unlock()
	if dedupApp.shouldSkipListenBrainzDuplicateScrobble(metadata, 1710000100) {
		t.Fatal("expired listenbrainz duplicate should not be skipped")
	}

	invalidFollowingServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			_, _ = writer.Write([]byte(`not-json`))
		}
	}))
	defer invalidFollowingServer.Close()
	invalidFollowingApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "follow-invalid", ListenBrainzServerURL: invalidFollowingServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := invalidFollowingApp.GetListenBrainzFollowing(); err == nil || err.Error() != "invalid listenbrainz following response" {
		t.Fatalf("GetListenBrainzFollowing(invalid json) = %v, want invalid-following-response error", err)
	}

	statusFollowingServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"message":"following failed"}`))
		}
	}))
	defer statusFollowingServer.Close()
	statusFollowingApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "follow-status", ListenBrainzServerURL: statusFollowingServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := statusFollowingApp.GetListenBrainzFollowing(); err == nil || err.Error() != "following failed" {
		t.Fatalf("GetListenBrainzFollowing(status error) = %v, want parsed error", err)
	}

	invalidFeedServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			_, _ = writer.Write([]byte(`not-json`))
		}
	}))
	defer invalidFeedServer.Close()
	invalidFeedApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "feed-invalid", ListenBrainzServerURL: invalidFeedServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := invalidFeedApp.GetListenBrainzFollowingFeed(5); err == nil || err.Error() != "invalid listenbrainz following feed response" {
		t.Fatalf("GetListenBrainzFollowingFeed(invalid json) = %v, want invalid-feed-response error", err)
	}

	statusFeedServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"message":"feed failed"}`))
		}
	}))
	defer statusFeedServer.Close()
	statusFeedApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "feed-status", ListenBrainzServerURL: statusFeedServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := statusFeedApp.GetListenBrainzFollowingFeed(5); err == nil || err.Error() != "feed failed" {
		t.Fatalf("GetListenBrainzFollowingFeed(status error) = %v, want parsed error", err)
	}
}

func TestListenBrainzTokenTransportAndRequestBranches(t *testing.T) {
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache = map[string]string{}
	listenBrainzUserNameCacheMu.Unlock()

	metadata := ListenBrainzTrackMetadata{ArtistName: "Artist", TrackName: "Track", ReleaseName: "Album"}

	missingTokenApp := newTestAppWithSettingsLoaded()
	if err := missingTokenApp.SubmitListenBrainz("single", metadata, 1710000000); err == nil || err.Error() != "listenbrainz token is not configured" {
		t.Fatalf("SubmitListenBrainz(missing token) = %v, want token-required error", err)
	}
	if err := missingTokenApp.SubmitListenBrainzRecordingFeedback("recording-id", 1); err == nil || err.Error() != "listenbrainz token is not configured" {
		t.Fatalf("SubmitListenBrainzRecordingFeedback(missing token) = %v, want token-required error", err)
	}
	if _, err := missingTokenApp.GetListenBrainzRecordingFeedback("recording-id"); err == nil || err.Error() != "listenbrainz token is not configured" {
		t.Fatalf("GetListenBrainzRecordingFeedback(missing token) = %v, want token-required error", err)
	}
	if _, err := missingTokenApp.GetListenBrainzFollowing(); err == nil || err.Error() != "listenbrainz token is not configured" {
		t.Fatalf("GetListenBrainzFollowing(missing token) = %v, want token-required error", err)
	}
	if _, err := missingTokenApp.GetListenBrainzFollowingFeed(5); err == nil || err.Error() != "listenbrainz token is not configured" {
		t.Fatalf("GetListenBrainzFollowingFeed(missing token) = %v, want token-required error", err)
	}

	invalidURLToken := "listenbrainz-invalid-url"
	invalidURLApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: invalidURLToken, ListenBrainzServerURL: "://bad", ListenBrainzRequestRateMs: 0})
	if _, err := invalidURLApp.listenBrainzUserName(invalidURLToken); err == nil {
		t.Fatal("listenBrainzUserName(invalid url) error = nil, want error")
	}
	if err := invalidURLApp.SubmitListenBrainz("single", metadata, 1710000000); err == nil {
		t.Fatal("SubmitListenBrainz(invalid url) error = nil, want error")
	}
	if err := invalidURLApp.SubmitListenBrainzRecordingFeedback("recording-id", 1); err == nil {
		t.Fatal("SubmitListenBrainzRecordingFeedback(invalid url) error = nil, want error")
	}
	if _, err := invalidURLApp.GetListenBrainzRecordingFeedback("recording-id"); err == nil {
		t.Fatal("GetListenBrainzRecordingFeedback(invalid url) error = nil, want error")
	}
	if _, err := invalidURLApp.GetListenBrainzFollowing(); err == nil {
		t.Fatal("GetListenBrainzFollowing(invalid url) error = nil, want error")
	}
	if _, err := invalidURLApp.GetListenBrainzFollowingFeed(5); err == nil {
		t.Fatal("GetListenBrainzFollowingFeed(invalid url) error = nil, want error")
	}
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache[invalidURLToken] = "tester"
	listenBrainzUserNameCacheMu.Unlock()
	if _, err := invalidURLApp.GetListenBrainzRecordingFeedback("recording-id"); err == nil {
		t.Fatal("GetListenBrainzRecordingFeedback(cached user invalid url) error = nil, want error")
	}
	if _, err := invalidURLApp.GetListenBrainzFollowing(); err == nil {
		t.Fatal("GetListenBrainzFollowing(cached user invalid url) error = nil, want error")
	}
	if _, err := invalidURLApp.GetListenBrainzFollowingFeed(5); err == nil {
		t.Fatal("GetListenBrainzFollowingFeed(cached user invalid url) error = nil, want error")
	}

	doErrorToken := "listenbrainz-do-error"
	doErrorApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: doErrorToken, ListenBrainzServerURL: "http://127.0.0.1:1", ListenBrainzRequestRateMs: 0})
	if _, err := doErrorApp.listenBrainzUserName(doErrorToken); err == nil {
		t.Fatal("listenBrainzUserName(do error) error = nil, want error")
	}
	if err := doErrorApp.SubmitListenBrainz("single", metadata, 1710000000); err == nil {
		t.Fatal("SubmitListenBrainz(do error) error = nil, want error")
	}
	if err := doErrorApp.SubmitListenBrainzRecordingFeedback("recording-id", 1); err == nil {
		t.Fatal("SubmitListenBrainzRecordingFeedback(do error) error = nil, want error")
	}
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache[doErrorToken] = "tester"
	listenBrainzUserNameCacheMu.Unlock()
	if _, err := doErrorApp.GetListenBrainzRecordingFeedback("recording-id"); err == nil {
		t.Fatal("GetListenBrainzRecordingFeedback(do error) error = nil, want error")
	}
	if _, err := doErrorApp.GetListenBrainzFollowing(); err == nil {
		t.Fatal("GetListenBrainzFollowing(do error) error = nil, want error")
	}
	if _, err := doErrorApp.GetListenBrainzFollowingFeed(5); err == nil {
		t.Fatal("GetListenBrainzFollowingFeed(do error) error = nil, want error")
	}
}

func TestListenBrainzValidateTokenFeedbackAndFeedFallbackBranches(t *testing.T) {
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache = map[string]string{}
	listenBrainzUserNameCacheMu.Unlock()

	invalidTokenMessageServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]any{"valid": false, "message": "token invalid with message"})
	}))
	defer invalidTokenMessageServer.Close()
	invalidTokenApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "token-message", ListenBrainzServerURL: invalidTokenMessageServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := invalidTokenApp.listenBrainzUserName("token-message"); err == nil || err.Error() != "token invalid with message" {
		t.Fatalf("listenBrainzUserName(invalid token message) = %v, want parsed message", err)
	}

	feedbackStatusServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			writer.WriteHeader(http.StatusBadRequest)
			_, _ = writer.Write([]byte(`{"message":"feedback lookup failed"}`))
		}
	}))
	defer feedbackStatusServer.Close()
	feedbackStatusApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "feedback-status", ListenBrainzServerURL: feedbackStatusServer.URL, ListenBrainzRequestRateMs: 0})
	if _, err := feedbackStatusApp.GetListenBrainzRecordingFeedback("recording-id"); err == nil || err.Error() != "feedback lookup failed" {
		t.Fatalf("GetListenBrainzRecordingFeedback(status error) = %v, want parsed error", err)
	}

	feedFallbackServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case listenBrainzValidateTokenPath:
			_ = json.NewEncoder(writer).Encode(map[string]any{"valid": true, "user_name": "tester"})
		default:
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"payload": map[string]any{
					"events": []map[string]any{{
						"id":         7,
						"event_type": "listen",
						"user_name":  "",
						"metadata": map[string]any{
							"user_name":   "metadata-user",
							"listened_at": 1710000000,
							"track_metadata": map[string]any{
								"artist_name": "Artist",
								"track_name":  "Track",
							},
						},
					}},
				},
			})
		}
	}))
	defer feedFallbackServer.Close()
	feedFallbackApp := newTestAppWithLoadedSettings(AppSettings{ListenBrainzUserToken: "feed-fallback", ListenBrainzServerURL: feedFallbackServer.URL, ListenBrainzRequestRateMs: 0})
	events, err := feedFallbackApp.GetListenBrainzFollowingFeed(5)
	if err != nil {
		t.Fatalf("GetListenBrainzFollowingFeed(created fallback) error = %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("GetListenBrainzFollowingFeed(created fallback) len = %d, want 1", len(events))
	}
	if events[0].Created != 1710000000 || events[0].UserName != "metadata-user" {
		t.Fatalf("GetListenBrainzFollowingFeed(created fallback) = %#v, want Created/UserName metadata fallbacks", events[0])
	}
}
