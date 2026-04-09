package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMusicBrainzLookupFunctions(t *testing.T) {
	artistID := "11111111-1111-4111-8111-111111111111"
	releaseID := "22222222-2222-4222-8222-222222222222"
	recordingID := "33333333-3333-4333-8333-333333333333"
	labelID := "44444444-4444-4444-8444-444444444444"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/artist/"):
			_, _ = writer.Write([]byte(`{"id":"` + artistID + `","name":"Artist","type":"Group","country":"BR","disambiguation":"Live","life-span":{"begin":"2001","end":"2005","ended":true},"genres":[{"name":"Rock","count":3},{"name":"rock","count":1}],"relations":[{"type":"official homepage","target-type":"url","url":{"resource":"https://artist.example"}}]}`))
		case strings.Contains(request.URL.Path, "/recording/"):
			_, _ = writer.Write([]byte(`{"id":"` + recordingID + `","title":"Track Title","first-release-date":"2002-03-04","artist-credit":[{"name":"Artist","artist":{"id":"` + artistID + `"}}],"releases":[{"title":"Release Title"}],"length":61000,"video":false,"genres":[{"name":"Rock","count":2}],"relations":[{"type":"streaming","target-type":"url","url":{"resource":"https://recording.example"}}]}`))
		case strings.Contains(request.URL.Path, "/release/"):
			_, _ = writer.Write([]byte(`{"id":"` + releaseID + `","title":"Release Title","date":"2002-03-04","release-group":{"primary-type":"Album","secondary-types":["Compilation"]},"artist-credit":[{"name":"Various Artists","artist":{"id":"` + musicBrainzVariousArtistsID + `"}}],"label-info":[{"label":{"id":"` + labelID + `","name":"Label Name"}}],"genres":[{"name":"Pop","count":5}],"relations":[{"type":"purchase for download","target-type":"url","url":{"resource":"https://release.example"}}]}`))
		case strings.Contains(request.URL.Path, "/label/"):
			_, _ = writer.Write([]byte(`{"id":"` + labelID + `","name":"Label Name","disambiguation":"Independent","type":"Original Production","life-span":{"begin":"1999"},"genres":[{"name":"Indie","count":2}],"relations":[{"type":"official homepage","target-type":"url","url":{"resource":"https://label.example"}}]}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0})

	artistInfo := app.LookupArtistByMBID(artistID)
	if !artistInfo.Found || artistInfo.Name != "Artist" || artistInfo.LifeSpan != "2001 – 2005" {
		t.Fatalf("LookupArtistByMBID() = %#v, want populated artist info", artistInfo)
	}
	if got, want := len(artistInfo.URLs), 1; got != want {
		t.Fatalf("LookupArtistByMBID() urls len = %d, want %d", got, want)
	}
	if result := app.LookupArtistByMBID("bad"); result.Found {
		t.Fatalf("LookupArtistByMBID(invalid) = %#v, want not found", result)
	}

	trackMetadata := app.LookupTrackMusicBrainzMetadata(recordingID, releaseID)
	if !trackMetadata.Found || trackMetadata.Title != "Track Title" || trackMetadata.Album != "Release Title" || trackMetadata.Artist != "Artist" || trackMetadata.LabelID != labelID {
		t.Fatalf("LookupTrackMusicBrainzMetadata() = %#v, want populated track metadata", trackMetadata)
	}
	if result := app.LookupTrackMusicBrainzMetadata("bad", "bad"); result.Found {
		t.Fatalf("LookupTrackMusicBrainzMetadata(invalid) = %#v, want not found", result)
	}

	if got := musicBrainzReleaseLabelID(map[string]any{"labels": []any{map[string]any{"id": labelID}}}); got != labelID {
		t.Fatalf("musicBrainzReleaseLabelID() = %q, want %q", got, labelID)
	}

	recordingEntity := app.LookupMusicBrainzEntity("recording", recordingID)
	if !recordingEntity.Found || recordingEntity.Title != "Track Title" || len(recordingEntity.Facts) == 0 || len(recordingEntity.Tags) == 0 || len(recordingEntity.URLs) == 0 {
		t.Fatalf("LookupMusicBrainzEntity(recording) = %#v, want populated entity info", recordingEntity)
	}
	releaseEntity := app.LookupMusicBrainzEntity("release", releaseID)
	if !releaseEntity.Found || releaseEntity.Title != "Release Title" {
		t.Fatalf("LookupMusicBrainzEntity(release) = %#v, want populated release info", releaseEntity)
	}
	artistEntity := app.LookupMusicBrainzEntity("artist", artistID)
	if !artistEntity.Found || artistEntity.Title != "Artist" {
		t.Fatalf("LookupMusicBrainzEntity(artist) = %#v, want populated artist info", artistEntity)
	}
	labelEntity := app.LookupMusicBrainzEntity("label", labelID)
	if !labelEntity.Found || labelEntity.Title != "Label Name" {
		t.Fatalf("LookupMusicBrainzEntity(label) = %#v, want populated label info", labelEntity)
	}
	if result := app.LookupMusicBrainzEntity("unknown", recordingID); result.Found {
		t.Fatalf("LookupMusicBrainzEntity(invalid type) = %#v, want not found", result)
	}
	if result := app.LookupMusicBrainzEntity("recording", "bad"); result.Found {
		t.Fatalf("LookupMusicBrainzEntity(invalid mbid) = %#v, want not found", result)
	}
}

func TestMusicBrainzLookupEdgeCases(t *testing.T) {
	artistID := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	releaseID := "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	recordingID := "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	labelID := "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/artist/"):
			_, _ = writer.Write([]byte(`{"id":"` + artistID + `","name":"Artist Two","type":"Person","gender":"Other","country":"JP","sort-name":"Two, Artist","disambiguation":"Solo project","life-span":{"begin":"1999","ended":true},"begin-area":{"name":"Tokyo"},"area":{"name":"Japan"},"tags":[{"name":"Electronic","count":5},{"name":"electronic","count":1}],"relations":[{"type":"official homepage","target-type":"url","url":{"resource":"https://artist.two"}},{"type":"official homepage","target-type":"url","url":{"resource":"https://artist.two"}}]}`))
		case strings.Contains(request.URL.Path, "/recording/"):
			_, _ = writer.Write([]byte(`{"id":"` + recordingID + `","title":"Edge Track","disambiguation":"Live take","artist-credit":[{"name":"Artist Two","artist":{"id":"` + artistID + `"}}],"releases":[{"title":"Fallback Release"},{"title":"Second Release"}],"length":123000,"video":true,"tags":[{"name":"Ambient","count":3}]}`))
		case strings.Contains(request.URL.Path, "/release/"):
			_, _ = writer.Write([]byte(`{"id":"` + releaseID + `","title":"Edge Release","disambiguation":"Deluxe","status":"Official","date":"2001-02-03","country":"JP","barcode":"1234567890","packaging":"Digipak","quality":"high","artist-credit":[{"name":"Artist Two","artist":{"id":"` + artistID + `"}}],"label-info":[{"catalog-number":"CAT-001","label":{"id":"` + labelID + `","name":"Label Two"}},{"catalog-number":"CAT-001","label":{"id":"` + labelID + `","name":"Label Two"}}],"text-representation":{"language":"eng","script":"Latn"},"release-group":{"title":"Release Group","primary-type":"Album"},"media":[{"format":"CD","title":"Disc 1","track-count":10},{"track-count":2}],"tags":[{"name":"Pop","count":2}]}`))
		case strings.Contains(request.URL.Path, "/label/"):
			_, _ = writer.Write([]byte(`{"id":"` + labelID + `","name":"Label Two","disambiguation":"Indie label","label-code":"LC-123","type":"Original Production","country":"JP","begin-date":"1990","end-date":"2000","artist-credit":[{"name":"Artist Two","artist":{"id":"` + artistID + `"}}],"tags":[{"name":"Indie","count":2}]}`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0})

	artistInfo := app.LookupArtistByMBID(artistID)
	if !artistInfo.Found || artistInfo.LifeSpan != "1999 –" || len(artistInfo.Genres) == 0 || artistInfo.Genres[0] != "Electronic" {
		t.Fatalf("LookupArtistByMBID(edge) = %#v, want tags fallback and ended lifespan", artistInfo)
	}

	trackMetadata := app.LookupTrackMusicBrainzMetadata(recordingID, releaseID)
	if !trackMetadata.Found || trackMetadata.Title != "Edge Track" || trackMetadata.Album != "Edge Release" || trackMetadata.LabelID != labelID {
		t.Fatalf("LookupTrackMusicBrainzMetadata(edge) = %#v, want populated metadata", trackMetadata)
	}

	releaseEntity := app.LookupMusicBrainzEntity("release", releaseID)
	if !releaseEntity.Found || releaseEntity.Title != "Edge Release" || len(releaseEntity.Facts) < 8 {
		t.Fatalf("LookupMusicBrainzEntity(release edge) = %#v, want rich release facts", releaseEntity)
	}
	artistEntity := app.LookupMusicBrainzEntity("artist", artistID)
	if !artistEntity.Found || artistEntity.Title != "Artist Two" || len(artistEntity.Facts) < 6 {
		t.Fatalf("LookupMusicBrainzEntity(artist edge) = %#v, want rich artist facts", artistEntity)
	}
	labelEntity := app.LookupMusicBrainzEntity("label", labelID)
	if !labelEntity.Found || labelEntity.Title != "Label Two" || len(labelEntity.Facts) < 5 {
		t.Fatalf("LookupMusicBrainzEntity(label edge) = %#v, want rich label facts", labelEntity)
	}
}

func TestMusicBrainzLookupInvalidJSONAndFallbacks(t *testing.T) {
	artistID := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
	releaseID := "ffffffff-ffff-4fff-8fff-ffffffffffff"
	recordingID := "99999999-9999-4999-8999-999999999999"
	labelID := "12121212-1212-4212-8212-121212121212"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/artist/"):
			_, _ = writer.Write([]byte(`not-json`))
		case strings.Contains(request.URL.Path, "/recording/"):
			_, _ = writer.Write([]byte(`not-json`))
		case strings.Contains(request.URL.Path, "/release/"):
			_, _ = writer.Write([]byte(`{"id":"` + releaseID + `","title":"Release Fallback","artist-credit":[{"name":"Fallback Artist","artist":{"id":"` + artistID + `"}}],"labels":[{"id":"` + labelID + `","name":"Fallback Label"}]}`))
		case strings.Contains(request.URL.Path, "/label/"):
			_, _ = writer.Write([]byte(`not-json`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0})

	if artistInfo := app.LookupArtistByMBID(artistID); artistInfo.Found {
		t.Fatalf("LookupArtistByMBID(invalid json) = %#v, want not found", artistInfo)
	}
	trackMetadata := app.LookupTrackMusicBrainzMetadata(recordingID, releaseID)
	if !trackMetadata.Found || trackMetadata.Album != "Release Fallback" || trackMetadata.Artist != "Fallback Artist" || trackMetadata.LabelID != labelID {
		t.Fatalf("LookupTrackMusicBrainzMetadata(fallback) = %#v, want release-derived fallback metadata", trackMetadata)
	}
	if labelEntity := app.LookupMusicBrainzEntity("label", labelID); labelEntity.Found {
		t.Fatalf("LookupMusicBrainzEntity(label invalid json) = %#v, want not found", labelEntity)
	}
}

func TestMusicBrainzLookupArtistAndMetadataEdgeBranches(t *testing.T) {
	endedArtistID := "abababab-abab-4bab-8bab-abababababab"
	endedOnlyArtistID := "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd"
	namelessArtistID := "efefefef-efef-4fef-8fef-efefefefefef"
	fetchFailArtistID := "10101010-1010-4010-8010-101010101010"
	recordingID := "12121212-1212-4212-8212-121212121212"
	releaseID := "13131313-1313-4313-8313-131313131313"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/artist/"+fetchFailArtistID):
			writer.WriteHeader(http.StatusBadGateway)
		case strings.Contains(request.URL.Path, "/artist/"+endedArtistID):
			_, _ = writer.Write([]byte(`{"id":"` + endedArtistID + `","name":"Ended Artist","life-span":{"end":"2005"},"tags":[{"name":"","count":9},{"name":"Tag Seven","count":7},{"name":"Tag Six","count":6},{"name":"Tag Five","count":5},{"name":"Tag Four","count":4},{"name":"Tag Three","count":3},{"name":"Tag Two","count":2},{"name":"Tag One","count":1}],"relations":[{"target-type":"artist","type":"member of band","url":{"resource":"https://ignored.example"}},{"target-type":"url","type":"discogs","url":{"resource":"https://discogs.example/b"}},{"target-type":"url","type":"discogs","url":{"resource":"https://discogs.example/a"}},{"target-type":"url","type":"discogs","url":{"resource":"https://discogs.example/a"}},{"target-type":"url","type":"streaming","url":{"resource":""}}]}`))
		case strings.Contains(request.URL.Path, "/artist/"+endedOnlyArtistID):
			_, _ = writer.Write([]byte(`{"id":"` + endedOnlyArtistID + `","name":"Ended Only","life-span":{"ended":true}}`))
		case strings.Contains(request.URL.Path, "/artist/"+namelessArtistID):
			_, _ = writer.Write([]byte(`{"id":"` + namelessArtistID + `","tags":[{"name":"Rock","count":1}]}`))
		case strings.Contains(request.URL.Path, "/recording/"+recordingID):
			_, _ = writer.Write([]byte(`{"id":"` + recordingID + `","title":"Recording Only","artist-credit":[{"name":"Fallback Artist","artist":{"id":"` + endedArtistID + `"}}],"releases":[{"title":"Recording Release"}]}`))
		case strings.Contains(request.URL.Path, "/release/"+releaseID):
			_, _ = writer.Write([]byte(`not-json`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0})

	if info := app.LookupArtistByMBID(fetchFailArtistID); info.Found {
		t.Fatalf("LookupArtistByMBID(fetch fail) = %#v, want not found", info)
	}
	endedInfo := app.LookupArtistByMBID(endedArtistID)
	if !endedInfo.Found || endedInfo.LifeSpan != "? – 2005" {
		t.Fatalf("LookupArtistByMBID(ended) = %#v, want missing-begin lifespan fallback", endedInfo)
	}
	if got, want := len(endedInfo.Genres), 6; got != want {
		t.Fatalf("LookupArtistByMBID(ended) genres len = %d, want %d", got, want)
	}
	if got, want := endedInfo.URLs[0].Resource, "https://discogs.example/a"; got != want {
		t.Fatalf("LookupArtistByMBID(ended) first url = %q, want %q", got, want)
	}
	if info := app.LookupArtistByMBID(endedOnlyArtistID); !info.Found || info.LifeSpan != "? –" {
		t.Fatalf("LookupArtistByMBID(ended only) = %#v, want open-ended lifespan fallback", info)
	}
	if info := app.LookupArtistByMBID(namelessArtistID); info.Found {
		t.Fatalf("LookupArtistByMBID(nameless) = %#v, want not found", info)
	}

	metadata := app.LookupTrackMusicBrainzMetadata(recordingID, releaseID)
	if !metadata.Found || metadata.Title != "Recording Only" || metadata.Album != "Recording Release" || metadata.Artist != "Fallback Artist" || metadata.LabelID != "" {
		t.Fatalf("LookupTrackMusicBrainzMetadata(release invalid json) = %#v, want recording-only fallback metadata", metadata)
	}
}

func TestMusicBrainzLookupEntityFallbackTitlesAndFacts(t *testing.T) {
	recordingID := "14141414-1414-4414-8414-141414141414"
	labelID := "15151515-1515-4515-8515-151515151515"
	entityFetchFailID := "16161616-1616-4616-8616-161616161616"
	entityInvalidJSONID := "17171717-1717-4717-8717-171717171717"

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.Contains(request.URL.Path, "/recording/"+recordingID):
			_, _ = writer.Write([]byte(`{
				"id":"` + recordingID + `",
				"disambiguation":"Instrumental",
				"first-release-date":"2001-02-03",
				"length":185000,
				"video":true,
				"releases":[
					{},
					{"title":"Release One"},
					{"title":"Release Two"},
					{"title":"Release Three"},
					{"title":"Release Four"},
					{"title":"Release Five"}
				]
			}`))
		case strings.Contains(request.URL.Path, "/label/"+labelID):
			_, _ = writer.Write([]byte(`{
				"id":"` + labelID + `",
				"disambiguation":"Archival imprint",
				"label-code":"LC-001",
				"type":"Distributor",
				"country":"DE",
				"begin-date":"1990",
				"end-date":"2005",
				"label-info":[
					{"catalog-number":"CAT-1","label":{"name":"Label Name"}},
					{"catalog-number":"cat-1","label":{"name":"label name"}},
					{"catalog-number":"CAT-2","label":{"name":"Label Two"}}
				],
				"text-representation":{"language":"eng","script":"Latn"},
				"release-group":{"title":"Archive Series","primary-type":"Series"},
				"media":[
					{"track-count":2},
					{"format":"LP","title":"Disc A","track-count":3}
				]
			}`))
		case strings.Contains(request.URL.Path, "/artist/"+entityFetchFailID):
			writer.WriteHeader(http.StatusNotFound)
		case strings.Contains(request.URL.Path, "/release/"+entityInvalidJSONID):
			_, _ = writer.Write([]byte(`not-json`))
		default:
			writer.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	app := newTestAppWithLoadedSettings(AppSettings{MusicBrainzServerURL: server.URL, MusicBrainzRequestRateMs: 0})

	recordingEntity := app.LookupMusicBrainzEntity("recording", recordingID)
	if !recordingEntity.Found || recordingEntity.Title != "Recording info" {
		t.Fatalf("LookupMusicBrainzEntity(recording fallback) = %#v, want fallback title", recordingEntity)
	}
	recordingFacts := fmt.Sprintf("%#v", recordingEntity.Facts)
	for _, fragment := range []string{"Video recording", "Yes", "Release count", "6", "Release One, Release Two, Release Three, Release Four"} {
		if !strings.Contains(recordingFacts, fragment) {
			t.Fatalf("LookupMusicBrainzEntity(recording fallback) facts = %s, want fragment %q", recordingFacts, fragment)
		}
	}

	labelEntity := app.LookupMusicBrainzEntity("label", labelID)
	if !labelEntity.Found || labelEntity.Title != labelEntity.Subtitle+" info" {
		t.Fatalf("LookupMusicBrainzEntity(label fallback) = %#v, want subtitle-based fallback title", labelEntity)
	}
	labelFacts := fmt.Sprintf("%#v", labelEntity.Facts)
	for _, fragment := range []string{"Label Name, Label Two", "CAT-1, CAT-2", "Language", "eng", "Script", "Latn", "Release group", "Archive Series", "Release group type", "Series", "Total tracks", "5", "Medium, LP (Disc A)"} {
		if !strings.Contains(labelFacts, fragment) {
			t.Fatalf("LookupMusicBrainzEntity(label fallback) facts = %s, want fragment %q", labelFacts, fragment)
		}
	}

	if result := app.LookupMusicBrainzEntity("artist", entityFetchFailID); result.Found {
		t.Fatalf("LookupMusicBrainzEntity(fetch fail) = %#v, want not found", result)
	}
	if result := app.LookupMusicBrainzEntity("release", entityInvalidJSONID); result.Found {
		t.Fatalf("LookupMusicBrainzEntity(invalid json) = %#v, want not found", result)
	}
}
