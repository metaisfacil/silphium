package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetListenBrainzFollowingAndFeed(t *testing.T) {
	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache = map[string]string{}
	listenBrainzUserNameCacheMu.Unlock()

	const token = "secret-token"
	const userName = "tester"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Token "+token {
			t.Fatalf("Authorization header = %q, want %q", request.Header.Get("Authorization"), "Token "+token)
		}

		switch request.URL.Path {
		case "/1/validate-token":
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"valid":     true,
				"user_name": userName,
			})
		case "/1/user/tester/following":
			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"following": []string{"alice", " bob ", ""},
				"user":      userName,
			})
		case "/1/user/tester/feed/events/listens/following":
			if request.URL.Query().Get("count") != "25" {
				t.Fatalf("count query = %q, want %q", request.URL.Query().Get("count"), "25")
			}

			writer.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"payload": map[string]any{
					"count":   2,
					"user_id": "test-user-id",
					"events": []map[string]any{
						{
							"created":    1710000100,
							"event_type": "listen",
							"hidden":     false,
							"id":         7,
							"message":    "",
							"user_name":  "alice",
							"metadata": map[string]any{
								"listened_at":     1710000000,
								"listened_at_iso": "2024-03-09T16:00:00Z",
								"playing_now":     true,
								"track_metadata": map[string]any{
									"artist_name":  "Artist One",
									"track_name":   "Track One",
									"release_name": "Album One",
									"additional_info": map[string]any{
										"recording_mbid":     "11111111-1111-1111-1111-111111111111",
										"recording_msid":     "22222222-2222-2222-2222-222222222222",
										"release_mbid":       "33333333-3333-3333-3333-333333333333",
										"release_group_mbid": "44444444-4444-4444-4444-444444444444",
										"artist_mbids":       []string{"55555555-5555-5555-5555-555555555555"},
										"origin_url":         "https://example.com/track-one",
										"music_service":      "spotify.com",
										"music_service_name": "Spotify",
										"duration_ms":        245000,
									},
								},
							},
						},
						{
							"created":    0,
							"event_type": "listen",
							"hidden":     false,
							"id":         8,
							"message":    "",
							"user_name":  "",
							"metadata": map[string]any{
								"created":        0,
								"inserted_at":    1710000200,
								"listened_at":    1710000150,
								"user_name":      "bob",
								"track_metadata": map[string]any{"artist_name": "Artist Two", "track_name": "Track Two"},
							},
						},
					},
				},
			})
		default:
			t.Fatalf("unexpected request path %q", request.URL.Path)
		}
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{
		ListenBrainzUserToken:     token,
		ListenBrainzServerURL:     server.URL,
		ListenBrainzRequestRateMs: 0,
	})

	following, err := app.GetListenBrainzFollowing()
	if err != nil {
		t.Fatalf("GetListenBrainzFollowing() error = %v", err)
	}

	if len(following) != 2 {
		t.Fatalf("len(GetListenBrainzFollowing()) = %d, want %d", len(following), 2)
	}
	if following[0] != "alice" || following[1] != "bob" {
		t.Fatalf("GetListenBrainzFollowing() = %#v, want %#v", following, []string{"alice", "bob"})
	}

	events, err := app.GetListenBrainzFollowingFeed(0)
	if err != nil {
		t.Fatalf("GetListenBrainzFollowingFeed() error = %v", err)
	}

	if len(events) != 2 {
		t.Fatalf("len(GetListenBrainzFollowingFeed()) = %d, want %d", len(events), 2)
	}

	event := events[0]
	if event.ID != 7 {
		t.Fatalf("event.ID = %d, want %d", event.ID, 7)
	}
	if event.UserName != "alice" {
		t.Fatalf("event.UserName = %q, want %q", event.UserName, "alice")
	}
	if event.ListenedAt != 1710000000 {
		t.Fatalf("event.ListenedAt = %d, want %d", event.ListenedAt, 1710000000)
	}
	if !event.PlayingNow {
		t.Fatalf("event.PlayingNow = %t, want %t", event.PlayingNow, true)
	}
	if event.TrackMetadata.TrackName != "Track One" {
		t.Fatalf("event.TrackMetadata.TrackName = %q, want %q", event.TrackMetadata.TrackName, "Track One")
	}
	if event.TrackMetadata.ArtistName != "Artist One" {
		t.Fatalf("event.TrackMetadata.ArtistName = %q, want %q", event.TrackMetadata.ArtistName, "Artist One")
	}
	if event.TrackMetadata.ReleaseName != "Album One" {
		t.Fatalf("event.TrackMetadata.ReleaseName = %q, want %q", event.TrackMetadata.ReleaseName, "Album One")
	}
	if event.TrackMetadata.AdditionalInfo.MusicServiceName != "Spotify" {
		t.Fatalf("event.TrackMetadata.AdditionalInfo.MusicServiceName = %q, want %q", event.TrackMetadata.AdditionalInfo.MusicServiceName, "Spotify")
	}
	if event.TrackMetadata.AdditionalInfo.OriginURL != "https://example.com/track-one" {
		t.Fatalf("event.TrackMetadata.AdditionalInfo.OriginURL = %q, want %q", event.TrackMetadata.AdditionalInfo.OriginURL, "https://example.com/track-one")
	}

	fallbackEvent := events[1]
	if fallbackEvent.UserName != "bob" {
		t.Fatalf("fallbackEvent.UserName = %q, want %q", fallbackEvent.UserName, "bob")
	}
	if fallbackEvent.Created != 1710000200 {
		t.Fatalf("fallbackEvent.Created = %d, want %d", fallbackEvent.Created, 1710000200)
	}
}
