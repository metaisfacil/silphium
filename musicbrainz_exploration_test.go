package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLookupMusicBrainzExploration(t *testing.T) {
	app := &App{}
	if graph := app.LookupMusicBrainzExploration("", "", nil, "", "req"); graph.Found || len(graph.Nodes) != 0 {
		t.Fatalf("LookupMusicBrainzExploration(empty) = %#v, want empty graph", graph)
	}

	const recordingID = "11111111-1111-4111-8111-111111111111"
	const releaseID = "22222222-2222-4222-8222-222222222222"
	const altReleaseID = "33333333-3333-4333-8333-333333333333"
	const labelID = "44444444-4444-4444-8444-444444444444"
	const seedArtistID = "55555555-5555-4555-8555-555555555555"
	const relatedBandID = "66666666-6666-4666-8666-666666666666"
	const guestArtistID = "77777777-7777-4777-8777-777777777777"
	const labelArtistID = "88888888-8888-4888-8888-888888888888"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/recording/"+recordingID):
			_, _ = writer.Write([]byte(`{
				"id":"` + recordingID + `",
				"title":"Song Title",
				"artist-credit":[{"name":"Seed Artist","artist":{"id":"` + seedArtistID + `","name":"Seed Artist","type":"Person"}}],
				"releases":[
					{"id":"` + releaseID + `"},
					{"id":"` + altReleaseID + `","artist-credit":[{"name":"Various Artists","artist":{"id":"` + musicBrainzVariousArtistsID + `","name":"Various Artists","type":"Group"}}],"release-group":{"primary-type":"Compilation"},"media":[{"tracks":[{"artist-credit":[{"name":"Guest Artist","artist":{"id":"` + guestArtistID + `","name":"Guest Artist","type":"Person"}}]}]}]}
				]
			}`))
		case strings.Contains(request.URL.Path, "/release/"+releaseID):
			_, _ = writer.Write([]byte(`{
				"id":"` + releaseID + `",
				"title":"Current Release",
				"date":"2024-01-01",
				"artist-credit":[{"name":"Seed Artist","artist":{"id":"` + seedArtistID + `","name":"Seed Artist","type":"Person"}}],
				"label-info":[{"label":{"id":"` + labelID + `","name":"Test Label"}}],
				"release-group":{"primary-type":"Album"},
				"media":[{"tracks":[{"artist-credit":[{"name":"Seed Artist","artist":{"id":"` + seedArtistID + `","name":"Seed Artist","type":"Person"}}]}]}]
			}`))
		case strings.Contains(request.URL.Path, "/release/"+altReleaseID):
			_, _ = writer.Write([]byte(`{
				"id":"` + altReleaseID + `",
				"title":"Compilation Release",
				"artist-credit":[{"name":"Various Artists","artist":{"id":"` + musicBrainzVariousArtistsID + `","name":"Various Artists","type":"Group"}}],
				"release-group":{"primary-type":"Compilation"},
				"media":[{"tracks":[{"artist-credit":[{"name":"Guest Artist","artist":{"id":"` + guestArtistID + `","name":"Guest Artist","type":"Person"}}]}]}]
			}`))
		case request.URL.Path == "/ws/2/release" && request.URL.Query().Get("label") == labelID:
			_, _ = writer.Write([]byte(`{
				"releases":[
					{"id":"99999999-9999-4999-8999-999999999999","title":"Label Artist Release","artist-credit":[{"name":"Label Artist","artist":{"id":"` + labelArtistID + `","name":"Label Artist","type":"Person"}}],"release-group":{"primary-type":"Album"}},
					{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","title":"Label Compilation","artist-credit":[{"name":"Various Artists","artist":{"id":"` + musicBrainzVariousArtistsID + `","name":"Various Artists","type":"Group"}}],"release-group":{"primary-type":"Compilation"},"media":[{"tracks":[{"artist-credit":[{"name":"Label Artist","artist":{"id":"` + labelArtistID + `","name":"Label Artist","type":"Person"}}]}]}]}
				]
			}`))
		case strings.Contains(request.URL.Path, "/artist/"+seedArtistID):
			_, _ = writer.Write([]byte(`{
				"relations":[
					{"target-type":"artist","type":"member of band","artist":{"id":"` + relatedBandID + `","name":"Related Band","type":"Group"}}
				]
			}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	emitted := make([]MusicBrainzExplorationProgress, 0, 8)
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != musicBrainzExplorationProgressEvent || len(optionalData) == 0 {
			return
		}
		if progress, ok := optionalData[0].(MusicBrainzExplorationProgress); ok {
			emitted = append(emitted, progress)
		}
	}

	app = &App{
		ctx:            context.Background(),
		settingsLoaded: true,
		settings: AppSettings{
			MusicBrainzServerURL:          server.URL,
			MusicBrainzRequestRateMs:      0,
			MusicBrainzTagDatabaseEnabled: true,
		},
	}
	graph := app.LookupMusicBrainzExploration(recordingID, releaseID, nil, "", "request-1")
	if !graph.Found || graph.Title != "Song Title" {
		t.Fatalf("LookupMusicBrainzExploration() = %#v, want populated graph titled Song Title", graph)
	}
	if len(graph.Nodes) < 6 || len(graph.Edges) < 5 {
		t.Fatalf("LookupMusicBrainzExploration() nodes/edges = %d/%d, want a populated graph", len(graph.Nodes), len(graph.Edges))
	}
	if !strings.Contains(graph.Summary, "compilations") || !strings.Contains(graph.Summary, "artist membership relationships") {
		t.Fatalf("LookupMusicBrainzExploration() summary = %q, want compilation and artist relationship context", graph.Summary)
	}
	if len(emitted) == 0 || emitted[len(emitted)-1].Message != "MusicBrainz exploration ready." {
		t.Fatalf("LookupMusicBrainzExploration() progress events = %#v, want final ready message", emitted)
	}
}

func TestLookupMusicBrainzExplorationWarningsAndFallbackNodes(t *testing.T) {
	const recordingID = "11111111-1111-4111-8111-111111111111"
	const releaseID = "22222222-2222-4222-8222-222222222222"
	const labelID = "33333333-3333-4333-8333-333333333333"
	artistIDs := []string{
		"44444444-4444-4444-8444-444444444444",
		"55555555-5555-4555-8555-555555555555",
		"66666666-6666-4666-8666-666666666666",
		"77777777-7777-4777-8777-777777777777",
		"88888888-8888-4888-8888-888888888888",
	}

	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()

	app := &App{
		settingsLoaded: true,
		settings: AppSettings{
			MusicBrainzServerURL:          server.URL,
			MusicBrainzRequestRateMs:      0,
			MusicBrainzTagDatabaseEnabled: true,
		},
	}

	graph := app.LookupMusicBrainzExploration(recordingID, releaseID, artistIDs, labelID, "request-2")
	if !graph.Found {
		t.Fatalf("LookupMusicBrainzExploration(fallback nodes) = %#v, want fallback graph", graph)
	}
	if len(graph.Nodes) < 7 {
		t.Fatalf("LookupMusicBrainzExploration(fallback nodes) len = %d, want at least 7 nodes", len(graph.Nodes))
	}
	if !strings.Contains(graph.Summary, "compilations") {
		t.Fatalf("LookupMusicBrainzExploration(fallback summary) = %q, want label-driven summary", graph.Summary)
	}

	warnings := strings.Join(graph.Warnings, " | ")
	for _, fragment := range []string{
		"Recording details could not be loaded from MusicBrainz.",
		"Release details could not be loaded from MusicBrainz.",
		"Limited primary artist relationships to 4 tagged artists.",
		"Label roster details could not be loaded from MusicBrainz.",
	} {
		if !strings.Contains(warnings, fragment) {
			t.Fatalf("LookupMusicBrainzExploration(warnings) = %q, want fragment %q", warnings, fragment)
		}
	}
}

func TestLookupMusicBrainzExplorationDefaultSummaryAndExcludedLabel(t *testing.T) {
	const releaseID = "99999999-9999-4999-8999-999999999999"
	const seedArtistID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const excludedLabelID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/release/"+releaseID):
			_, _ = writer.Write([]byte(`{
				"id":"` + releaseID + `",
				"artist-credit":[{"name":"Release Seed","artist":{"id":"` + seedArtistID + `","name":"Release Seed","type":"Person"}}],
				"label-info":[{"label":{"id":"` + excludedLabelID + `","name":"No Label"}}]
			}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := &App{settingsLoaded: true, settings: AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0}}
	graph := app.LookupMusicBrainzExploration("", releaseID, nil, "", "request-3")
	if !graph.Found {
		t.Fatalf("LookupMusicBrainzExploration(default summary) = %#v, want non-empty graph", graph)
	}
	if graph.Title != "Release Seed" {
		t.Fatalf("LookupMusicBrainzExploration(default summary) title = %q, want release-seeded fallback title", graph.Title)
	}
	if graph.Summary != "Connections shown through tagged MusicBrainz entities around this track." {
		t.Fatalf("LookupMusicBrainzExploration(default summary) = %q, want default summary", graph.Summary)
	}
	if strings.Contains(strings.Join(graph.Warnings, " | "), "Label") {
		t.Fatalf("LookupMusicBrainzExploration(default summary) warnings = %#v, want excluded label without label warnings", graph.Warnings)
	}
	for _, node := range graph.Nodes {
		if node.EntityType == "label" {
			t.Fatalf("LookupMusicBrainzExploration(default summary) nodes = %#v, want excluded label omitted", graph.Nodes)
		}
	}
}

func TestLookupMusicBrainzExplorationLimitAndSkipBranches(t *testing.T) {
	makeID := func(index int) string {
		return fmt.Sprintf("%08d-0000-4000-8000-%012d", index, index)
	}
	artistCredit := func(id string, name string, artistType string) map[string]any {
		artist := map[string]any{"id": id, "name": name}
		if artistType != "" {
			artist["type"] = artistType
		}
		return map[string]any{"name": name, "artist": artist}
	}
	mediaWithArtists := func(artistIDs []string, prefix string) []any {
		tracks := make([]any, 0, len(artistIDs))
		for index, artistID := range artistIDs {
			tracks = append(tracks, map[string]any{
				"artist-credit": []any{artistCredit(artistID, fmt.Sprintf("%s Artist %d", prefix, index+1), "Person")},
			})
		}
		return []any{map[string]any{"tracks": tracks}}
	}
	writeJSON := func(writer http.ResponseWriter, payload any) {
		writer.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(writer).Encode(payload); err != nil {
			t.Fatalf("Encode() error = %v", err)
		}
	}

	recordingID := makeID(1)
	releaseID := makeID(2)
	labelID := makeID(3)
	seedArtistID := makeID(4)
	duplicateSeedID := makeID(5)
	failingArtistID := makeID(6)
	releaseOnlyArtistID := makeID(7)
	nonCompilationReleaseID := makeID(100)
	altReleaseIDs := []string{makeID(101), makeID(102), makeID(103), makeID(104), makeID(105)}
	duplicateLabelArtistID := makeID(200)
	labelArtistIDs := make([]string, 0, 11)
	for index := 0; index < 11; index++ {
		labelArtistIDs = append(labelArtistIDs, makeID(201+index))
	}
	labelCompilationIDs := []string{altReleaseIDs[0], makeID(300), makeID(301), makeID(302), makeID(303), makeID(304), makeID(305)}
	relationGroupIDs := make([]string, 0, 6)
	for index := 0; index < 6; index++ {
		relationGroupIDs = append(relationGroupIDs, makeID(400+index))
	}
	relationOverflowID := makeID(406)
	compilationArtistIDs := make([]string, 0, 13)
	for index := 0; index < 13; index++ {
		compilationArtistIDs = append(compilationArtistIDs, makeID(500+index))
	}

	releasePayloads := map[string]map[string]any{
		releaseID: {
			"id":            releaseID,
			"title":         "Current Release",
			"artist-credit": []any{artistCredit(releaseOnlyArtistID, "Release Only Artist", "Person")},
			"label-info":    []any{map[string]any{"label": map[string]any{"id": labelID, "name": "Limit Label"}}},
			"release-group": map[string]any{"primary-type": "Album"},
			"media":         mediaWithArtists([]string{seedArtistID}, "Current"),
		},
		nonCompilationReleaseID: {
			"id":            nonCompilationReleaseID,
			"title":         "Not a Compilation",
			"artist-credit": []any{artistCredit(seedArtistID, "Seed Artist", "Person")},
			"release-group": map[string]any{"primary-type": "Album"},
		},
		altReleaseIDs[0]: {
			"id":            altReleaseIDs[0],
			"title":         "Compilation One",
			"artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")},
			"release-group": map[string]any{"primary-type": "Compilation"},
			"media":         mediaWithArtists(compilationArtistIDs, "Guest"),
		},
		altReleaseIDs[1]: {
			"id":            altReleaseIDs[1],
			"title":         "Compilation Two",
			"artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")},
			"release-group": map[string]any{"primary-type": "Compilation"},
			"media":         mediaWithArtists([]string{makeID(700)}, "Second"),
		},
		altReleaseIDs[3]: {
			"id":            altReleaseIDs[3],
			"title":         "Compilation Four",
			"artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")},
			"release-group": map[string]any{"primary-type": "Compilation"},
			"media":         mediaWithArtists([]string{makeID(701)}, "Fourth"),
		},
		altReleaseIDs[4]: {
			"id":            altReleaseIDs[4],
			"title":         "Compilation Five",
			"artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")},
			"release-group": map[string]any{"primary-type": "Compilation"},
			"media":         mediaWithArtists([]string{makeID(702)}, "Fifth"),
		},
	}

	browseReleases := []any{
		map[string]any{"id": releaseID, "title": "Current Release", "artist-credit": []any{artistCredit(seedArtistID, "Seed Artist", "Person")}},
		map[string]any{"id": makeID(800), "title": "Invalid Artist Release", "artist-credit": []any{artistCredit("bad", "Invalid Artist", "Person")}},
		map[string]any{"id": makeID(801), "title": "Seed Artist Release", "artist-credit": []any{artistCredit(seedArtistID, "Seed Artist", "Person")}},
		map[string]any{"id": makeID(802), "title": "Duplicate Artist Release A", "artist-credit": []any{artistCredit(duplicateLabelArtistID, "Duplicate Label Artist", "Person")}},
		map[string]any{"id": makeID(803), "title": "Duplicate Artist Release B", "artist-credit": []any{artistCredit(duplicateLabelArtistID, "Duplicate Label Artist", "Person")}},
	}
	for index, artistID := range labelArtistIDs {
		browseReleases = append(browseReleases, map[string]any{
			"id":            makeID(820 + index),
			"title":         fmt.Sprintf("Label Artist Release %d", index+1),
			"artist-credit": []any{artistCredit(artistID, fmt.Sprintf("Label Artist %d", index+1), "Person")},
		})
	}
	for index, compilationID := range labelCompilationIDs {
		browseReleases = append(browseReleases, map[string]any{
			"id":            compilationID,
			"title":         fmt.Sprintf("Label Compilation %d", index+1),
			"artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")},
			"release-group": map[string]any{"primary-type": "Compilation"},
			"media":         mediaWithArtists([]string{makeID(900 + index)}, "Label Compilation"),
		})
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case strings.Contains(request.URL.Path, "/recording/"+recordingID):
			writeJSON(writer, map[string]any{
				"id":    recordingID,
				"title": "Limit Song",
				"artist-credit": []any{
					artistCredit(seedArtistID, "Seed Artist", "Person"),
					artistCredit("bad", "Ignored Artist", "Person"),
				},
				"releases": []any{
					map[string]any{"id": "bad"},
					map[string]any{"id": releaseID},
					map[string]any{"id": nonCompilationReleaseID},
					map[string]any{"id": altReleaseIDs[0], "artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")}, "release-group": map[string]any{"primary-type": "Compilation"}},
					map[string]any{"id": altReleaseIDs[1], "artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")}, "release-group": map[string]any{"primary-type": "Compilation"}, "media": mediaWithArtists([]string{makeID(710)}, "Embedded")},
					map[string]any{"id": altReleaseIDs[2], "artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")}, "release-group": map[string]any{"primary-type": "Compilation"}},
					map[string]any{"id": altReleaseIDs[3], "artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")}, "release-group": map[string]any{"primary-type": "Compilation"}, "media": mediaWithArtists([]string{makeID(711)}, "Embedded")},
					map[string]any{"id": altReleaseIDs[4], "artist-credit": []any{artistCredit(musicBrainzVariousArtistsID, "Various Artists", "Group")}, "release-group": map[string]any{"primary-type": "Compilation"}, "media": mediaWithArtists([]string{makeID(712)}, "Embedded")},
				},
			})
		case strings.Contains(request.URL.Path, "/release/"):
			releaseID := strings.TrimPrefix(request.URL.Path, "/ws/2/release/")
			payload, ok := releasePayloads[releaseID]
			if !ok {
				writer.WriteHeader(http.StatusNotFound)
				return
			}
			writeJSON(writer, payload)
		case request.URL.Path == "/ws/2/release" && request.URL.Query().Get("label") == labelID:
			writeJSON(writer, map[string]any{"releases": browseReleases})
		case strings.Contains(request.URL.Path, "/artist/"+failingArtistID):
			writer.WriteHeader(http.StatusBadGateway)
		case strings.Contains(request.URL.Path, "/artist/"+seedArtistID):
			relations := []any{
				map[string]any{"target-type": "url", "type": "official homepage", "artist": map[string]any{"id": makeID(950), "name": "Ignored URL Artist"}},
				map[string]any{"target-type": "artist", "type": "producer", "artist": map[string]any{"id": makeID(951), "name": "Ignored Producer"}},
				map[string]any{"target-type": "artist", "type": "member of band", "artist": map[string]any{"name": "Missing ID"}},
				map[string]any{"target-type": "artist", "type": "member of band", "artist": map[string]any{"id": duplicateSeedID, "name": "Duplicate Seed", "type": "Person"}},
			}
			for index, relationID := range relationGroupIDs {
				relations = append(relations, map[string]any{"target-type": "artist", "type": "member of band", "artist": map[string]any{"id": relationID, "name": fmt.Sprintf("Related Group %d", index+1), "type": "Group"}})
			}
			relations = append(relations, map[string]any{"target-type": "artist", "type": "member of band", "artist": map[string]any{"id": relationOverflowID, "name": "Overflow Group", "type": "Group"}})
			writeJSON(writer, map[string]any{"relations": relations})
		case strings.Contains(request.URL.Path, "/artist/"):
			writeJSON(writer, map[string]any{"relations": []any{}})
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := &App{settingsLoaded: true, settings: AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0}}
	graph := app.LookupMusicBrainzExploration(recordingID, releaseID, []string{seedArtistID, duplicateSeedID, failingArtistID}, labelID, "request-4")
	if !graph.Found {
		t.Fatalf("LookupMusicBrainzExploration(limits) = %#v, want populated graph", graph)
	}
	if !strings.Contains(graph.Summary, "compilations") || !strings.Contains(graph.Summary, "other artists with releases on the same label") || !strings.Contains(graph.Summary, "artist membership relationships") {
		t.Fatalf("LookupMusicBrainzExploration(limits) summary = %q, want summary fragments for label, compilation, and relations", graph.Summary)
	}

	warnings := strings.Join(graph.Warnings, " | ")
	for _, fragment := range []string{
		"Limited alternate release appearances to 4 releases.",
		"Limited compilation artist links to 12 artists.",
		"Limited same-label artist links to 10 artists.",
		"Limited label connections to 6 Various Artists compilations.",
		"Limited artist membership relationships to 6 connections.",
	} {
		if !strings.Contains(warnings, fragment) {
			t.Fatalf("LookupMusicBrainzExploration(limits) warnings = %q, want fragment %q", warnings, fragment)
		}
	}
}

func TestLookupMusicBrainzExplorationReleaseTitleAndFetchedLabel(t *testing.T) {
	const releaseID = "11111111-1111-4111-8111-111111111111"
	const labelID = "22222222-2222-4222-8222-222222222222"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/release/"+releaseID):
			_, _ = writer.Write([]byte(`{
				"id":"` + releaseID + `",
				"title":"Release Title",
				"label-info":[{"label":{"id":"` + labelID + `"}}]
			}`))
		case strings.Contains(request.URL.Path, "/label/"+labelID):
			_, _ = writer.Write([]byte(`{"id":"` + labelID + `","name":"Fetched Label"}`))
		case request.URL.Path == "/ws/2/release" && request.URL.Query().Get("label") == labelID:
			_, _ = writer.Write([]byte(`{"releases":[]}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := &App{settingsLoaded: true, settings: AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0}}
	graph := app.LookupMusicBrainzExploration("", releaseID, nil, "", "request-release-title")
	if !graph.Found {
		t.Fatalf("LookupMusicBrainzExploration(release title) = %#v, want populated graph", graph)
	}
	if graph.Title != "Release Title" {
		t.Fatalf("LookupMusicBrainzExploration(release title) title = %q, want release title fallback", graph.Title)
	}

	labelFound := false
	for _, node := range graph.Nodes {
		if node.EntityType == "label" && node.Label == "Fetched Label" {
			labelFound = true
			break
		}
	}
	if !labelFound {
		t.Fatalf("LookupMusicBrainzExploration(release title) nodes = %#v, want fetched label node", graph.Nodes)
	}
	if len(graph.Warnings) != 0 {
		t.Fatalf("LookupMusicBrainzExploration(release title) warnings = %#v, want none", graph.Warnings)
	}
}

func TestLookupMusicBrainzExplorationExcludedFetchedLabelNoNodes(t *testing.T) {
	const labelID = "33333333-3333-4333-8333-333333333333"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/label/"+labelID):
			_, _ = writer.Write([]byte(`{"id":"` + labelID + `","name":"No Label"}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := &App{settingsLoaded: true, settings: AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0}}
	graph := app.LookupMusicBrainzExploration("", "", nil, labelID, "request-excluded-label")
	if graph.Found {
		t.Fatalf("LookupMusicBrainzExploration(excluded label) = %#v, want no graph", graph)
	}
	if graph.Summary != "No connected MusicBrainz entities were available for this track." {
		t.Fatalf("LookupMusicBrainzExploration(excluded label) summary = %q, want no-connections summary", graph.Summary)
	}
	if len(graph.Nodes) != 0 || len(graph.Edges) != 0 {
		t.Fatalf("LookupMusicBrainzExploration(excluded label) nodes/edges = %#v/%#v, want none", graph.Nodes, graph.Edges)
	}
	if len(graph.Warnings) != 0 {
		t.Fatalf("LookupMusicBrainzExploration(excluded label) warnings = %#v, want none", graph.Warnings)
	}
}

func TestLookupMusicBrainzExplorationAlternateReleaseCheckLimit(t *testing.T) {
	const recordingID = "44444444-4444-4444-8444-444444444444"
	const seedArtistID = "55555555-5555-4555-8555-555555555555"

	altReleaseIDs := make([]string, 0, musicBrainzExplorationAlternateReleaseCheckLimit+1)
	for index := 0; index < musicBrainzExplorationAlternateReleaseCheckLimit+1; index++ {
		altReleaseIDs = append(altReleaseIDs, fmt.Sprintf("%08d-0000-4000-8000-%012d", 900+index, 900+index))
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/recording/"+recordingID):
			releases := make([]string, 0, len(altReleaseIDs))
			for _, releaseID := range altReleaseIDs {
				releases = append(releases, `{"id":"`+releaseID+`"}`)
			}
			_, _ = writer.Write([]byte(`{
				"id":"` + recordingID + `",
				"title":"Check Limit Song",
				"artist-credit":[{"name":"Seed Artist","artist":{"id":"` + seedArtistID + `","name":"Seed Artist","type":"Person"}}],
				"releases":[` + strings.Join(releases, ",") + `]
			}`))
		case strings.Contains(request.URL.Path, "/release/"):
			writer.WriteHeader(http.StatusBadGateway)
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := &App{settingsLoaded: true, settings: AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0}}
	graph := app.LookupMusicBrainzExploration(recordingID, "", nil, "", "request-alt-check-limit")
	if !graph.Found {
		t.Fatalf("LookupMusicBrainzExploration(alternate check limit) = %#v, want populated graph", graph)
	}
	if graph.Title != "Check Limit Song" {
		t.Fatalf("LookupMusicBrainzExploration(alternate check limit) title = %q, want recording title", graph.Title)
	}
	if len(graph.Nodes) < 2 {
		t.Fatalf("LookupMusicBrainzExploration(alternate check limit) nodes = %#v, want recording and artist nodes", graph.Nodes)
	}

	warnings := strings.Join(graph.Warnings, " | ")
	if !strings.Contains(warnings, "Limited alternate release checks to 12 candidate releases.") {
		t.Fatalf("LookupMusicBrainzExploration(alternate check limit) warnings = %q, want alternate release check warning", warnings)
	}
	if strings.Contains(warnings, "Limited alternate release appearances to 4 releases.") {
		t.Fatalf("LookupMusicBrainzExploration(alternate check limit) warnings = %q, want check-limit warning without appearance-limit warning", warnings)
	}
	if strings.Contains(graph.Summary, "Various Artists appearances of the current recording") {
		t.Fatalf("LookupMusicBrainzExploration(alternate check limit) summary = %q, want no successful compilation appearances", graph.Summary)
	}
}
