package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSubmitListenBrainz(t *testing.T) {
	t.Run("suppresses duplicate single scrobbles", func(t *testing.T) {
		requestCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			requestCount++
			if got := request.Method; got != http.MethodPost {
				t.Fatalf("request method = %q, want %q", got, http.MethodPost)
			}
			if got := request.URL.Path; got != listenBrainzSubmitPath {
				t.Fatalf("request path = %q, want %q", got, listenBrainzSubmitPath)
			}
			if got := request.Header.Get("Authorization"); got != "Token token" {
				t.Fatalf("authorization header = %q, want %q", got, "Token token")
			}

			_, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("ReadAll(request.Body) error = %v", err)
			}

			writer.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		app := newTestAppWithLoadedSettings(AppSettings{
			ListenBrainzUserToken: "token",
			ListenBrainzServerURL: server.URL,
		})

		metadata := ListenBrainzTrackMetadata{
			ArtistName:    "Duplicate Artist",
			TrackName:     "Duplicate Track",
			ReleaseName:   "Duplicate Album",
			RecordingMBID: "duplicate-recording-mbid",
		}

		if err := app.SubmitListenBrainz("single", metadata, 1710000000); err != nil {
			t.Fatalf("first SubmitListenBrainz(single) error = %v", err)
		}
		if err := app.SubmitListenBrainz("single", metadata, 1710000000); err != nil {
			t.Fatalf("second SubmitListenBrainz(single) error = %v", err)
		}

		if requestCount != 1 {
			t.Fatalf("request count = %d, want 1", requestCount)
		}
	})

	t.Run("suppresses duplicate single scrobbles when artist label changes", func(t *testing.T) {
		requestCount := 0
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
			requestCount++
			writer.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		app := newTestAppWithLoadedSettings(AppSettings{
			ListenBrainzUserToken: "token",
			ListenBrainzServerURL: server.URL,
		})

		if err := app.SubmitListenBrainz("single", ListenBrainzTrackMetadata{
			ArtistName:  "Masato Kouda",
			TrackName:   "コメディックスタイル",
			ReleaseName: "「魔法戦争」オリジナルサウンドトラック",
		}, 1710000100); err != nil {
			t.Fatalf("first SubmitListenBrainz(single) error = %v", err)
		}

		if err := app.SubmitListenBrainz("single", ListenBrainzTrackMetadata{
			ArtistName:  "甲田雅人",
			TrackName:   "コメディックスタイル",
			ReleaseName: "「魔法戦争」オリジナルサウンドトラック",
		}, 1710000106); err != nil {
			t.Fatalf("second SubmitListenBrainz(single) error = %v", err)
		}

		if requestCount != 1 {
			t.Fatalf("request count = %d, want 1", requestCount)
		}
	})
}
