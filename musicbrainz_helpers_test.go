package main

import (
	"strings"
	"testing"
)

func TestMusicBrainzHelperFunctions(t *testing.T) {
	artistID := "11111111-1111-4111-8111-111111111111"
	guestArtistID := "22222222-2222-4222-8222-222222222222"
	releaseID := "33333333-3333-4333-8333-333333333333"
	labelID := "44444444-4444-4444-8444-444444444444"
	recordingID := "55555555-5555-4555-8555-555555555555"

	app := newTestAppWithLoadedSettings(AppSettings{MusicBrainzServerURL: "https://musicbrainz.example/", MusicBrainzRequestRateMs: 250})
	if got := app.musicBrainzServerURL(); got != "https://musicbrainz.example" {
		t.Fatalf("musicBrainzServerURL() = %q, want %q", got, "https://musicbrainz.example")
	}
	if got := newTestAppWithSettingsLoaded().musicBrainzServerURL(); got != musicBrainzPublicServerURL {
		t.Fatalf("musicBrainzServerURL(default) = %q, want %q", got, musicBrainzPublicServerURL)
	}
	if got := app.musicBrainzAPIBaseURL(); got != "https://musicbrainz.example/ws/2" {
		t.Fatalf("musicBrainzAPIBaseURL() = %q, want %q", got, "https://musicbrainz.example/ws/2")
	}
	if got := app.musicBrainzRequestRateMs(); got != 250 {
		t.Fatalf("musicBrainzRequestRateMs() = %d, want %d", got, 250)
	}

	if got := musicBrainzEntitySubtitle("release"); got != "Release" {
		t.Fatalf("musicBrainzEntitySubtitle() = %q, want %q", got, "Release")
	}
	if got := asObject(map[string]any{"name": "value"})["name"]; got != "value" {
		t.Fatalf("asObject() = %#v, want parsed object", got)
	}
	if got := len(asArray([]any{"a"})); got != 1 {
		t.Fatalf("asArray() len = %d, want 1", got)
	}
	if got := asString("  value  "); got != "value" {
		t.Fatalf("asString() = %q, want %q", got, "value")
	}

	object := map[string]any{"name": " value ", "raw": " raw ", "number": float64(12), "enabled": true}
	if got := objectString(object, "name"); got != "value" {
		t.Fatalf("objectString() = %q, want %q", got, "value")
	}
	if got := objectRawString(object, "raw"); got != " raw " {
		t.Fatalf("objectRawString() = %q, want %q", got, " raw ")
	}
	if got, ok := objectNumber(object, "number"); !ok || got != 12 {
		t.Fatalf("objectNumber() = (%v, %t), want (12, true)", got, ok)
	}
	if _, ok := objectNumber(nil, "number"); ok {
		t.Fatal("objectNumber(nil) = ok, want false")
	}
	if _, ok := objectNumber(map[string]any{"number": "12"}, "number"); ok {
		t.Fatal("objectNumber(non-number) = ok, want false")
	}
	if got, ok := objectBool(object, "enabled"); !ok || !got {
		t.Fatalf("objectBool() = (%v, %t), want (true, true)", got, ok)
	}

	facts := appendFact(nil, " Label ", " Value ")
	facts = appendFact(facts, "", "ignored")
	if got, want := len(facts), 1; got != want {
		t.Fatalf("appendFact() len = %d, want %d", got, want)
	}
	if got := formatDurationMillis(61_000); got != "1:01" {
		t.Fatalf("formatDurationMillis(61000) = %q, want %q", got, "1:01")
	}
	if got := formatDurationMillis(3_661_000); got != "1:01:01" {
		t.Fatalf("formatDurationMillis(3661000) = %q, want %q", got, "1:01:01")
	}
	if got := formatDurationMillis(0); got != "" {
		t.Fatalf("formatDurationMillis(0) = %q, want empty", got)
	}

	payload := map[string]any{
		"life-span": map[string]any{"begin": "2001", "end": "2005", "ended": true},
		"artist-credit": []any{
			map[string]any{"name": "Artist", "joinphrase": " feat. ", "artist": map[string]any{"id": artistID}},
			map[string]any{"artist": map[string]any{"name": "Guest", "id": guestArtistID}},
		},
		"releases": []any{map[string]any{"title": "Release Title"}},
		"genres": []any{
			map[string]any{"name": "Rock", "count": float64(5)},
			map[string]any{"name": "rock", "count": float64(1)},
			map[string]any{"name": "Jazz", "count": float64(3)},
		},
		"tags": []any{map[string]any{"name": "Alt", "count": float64(4)}},
		"relations": []any{
			map[string]any{"target-type": "url", "type": "official homepage", "url": map[string]any{"resource": "https://example.com"}},
			map[string]any{"target-type": "url", "type": "discogs", "url": map[string]any{"resource": "https://discogs.com/item"}},
			map[string]any{"target-type": "url", "type": "discogs", "url": map[string]any{"resource": "https://discogs.com/item"}},
		},
		"label-info": []any{map[string]any{"label": map[string]any{"id": labelID, "name": "Label Name"}}},
		"labels":     []any{map[string]any{"id": releaseID, "name": musicBrainzNoLabelName}},
		"date":       "2004-01-02",
		"release-group": map[string]any{
			"primary-type":    "Album",
			"secondary-types": []any{"Compilation"},
		},
		"artist-credit-phrase": "Various Artists",
		"media": []any{
			map[string]any{"tracks": []any{
				map[string]any{"artist-credit": []any{map[string]any{"name": "Artist", "artist": map[string]any{"id": artistID}}}},
				map[string]any{"recording": map[string]any{"artist-credit": []any{map[string]any{"name": "Guest", "artist": map[string]any{"id": guestArtistID}}}}},
			}},
		},
		"title": "Release Title",
	}

	if got := musicBrainzLifeSpan(payload); got != "2001 – 2005" {
		t.Fatalf("musicBrainzLifeSpan() = %q, want %q", got, "2001 – 2005")
	}
	if got := musicBrainzArtistCredit(payload); got != "Artist feat. Guest" {
		t.Fatalf("musicBrainzArtistCredit() = %q, want %q", got, "Artist feat. Guest")
	}
	if got, want := len(musicBrainzArtistCredits(payload)), 2; got != want {
		t.Fatalf("musicBrainzArtistCredits() len = %d, want %d", got, want)
	}
	if got := firstMusicBrainzReleaseTitle(payload); got != "Release Title" {
		t.Fatalf("firstMusicBrainzReleaseTitle() = %q, want %q", got, "Release Title")
	}
	if got := collectMusicBrainzTagNames(payload); len(got) != 3 || got[0] != "Rock" || got[1] != "Alt" {
		t.Fatalf("collectMusicBrainzTagNames() = %#v, want weighted unique tag order", got)
	}
	if got := collectMusicBrainzURLRelations(payload); len(got) != 2 || got[0].Type != "discogs" {
		t.Fatalf("collectMusicBrainzURLRelations() = %#v, want sorted unique URLs", got)
	}
	if got := prettyJSON([]byte(`{"name":"value"}`)); got == `{"name":"value"}` {
		t.Fatal("prettyJSON(valid) should indent JSON")
	}
	if got := prettyJSON([]byte(`{broken`)); got != `{broken` {
		t.Fatalf("prettyJSON(invalid) = %q, want raw string", got)
	}

	if got := sanitizeMusicBrainzIDs([]string{" ", artistID, strings.ToUpper(artistID), guestArtistID}); len(got) != 2 {
		t.Fatalf("sanitizeMusicBrainzIDs() = %#v, want two unique MBIDs", got)
	}
	if got := musicBrainzExplorationNodeID("artist", artistID, "fallback"); got != "artist:"+artistID {
		t.Fatalf("musicBrainzExplorationNodeID() = %q, want artist node id", got)
	}
	if got := musicBrainzExplorationNodeID("", "bad", "fallback"); got != "fallback" {
		t.Fatalf("musicBrainzExplorationNodeID(fallback) = %q, want %q", got, "fallback")
	}
	if got := musicBrainzExplorationURL("release", releaseID); got != "https://musicbrainz.org/release/"+releaseID {
		t.Fatalf("musicBrainzExplorationURL() = %q, want MusicBrainz URL", got)
	}
	if got := musicBrainzExplorationAccent("compilation"); got != "#3b9c8f" {
		t.Fatalf("musicBrainzExplorationAccent() = %q, want %q", got, "#3b9c8f")
	}

	nameMap := musicBrainzArtistNameMap(payload)
	if got := nameMap[artistID]; got != "Artist" {
		t.Fatalf("musicBrainzArtistNameMap() = %#v, want artist name map", nameMap)
	}
	if !isExcludedMusicBrainzLabel(musicBrainzNoLabelName) {
		t.Fatal("isExcludedMusicBrainzLabel(no label) = false, want true")
	}
	if gotID, gotName := musicBrainzReleaseLabelInfo(payload); gotID != labelID || gotName != "Label Name" {
		t.Fatalf("musicBrainzReleaseLabelInfo() = (%q, %q), want (%q, %q)", gotID, gotName, labelID, "Label Name")
	}
	if got := musicBrainzReleaseDateLabel(payload); got != "2004-01-02" {
		t.Fatalf("musicBrainzReleaseDateLabel() = %q, want %q", got, "2004-01-02")
	}
	if got := musicBrainzReleaseGroupSummary(payload); got != "Album / Compilation" {
		t.Fatalf("musicBrainzReleaseGroupSummary() = %q, want %q", got, "Album / Compilation")
	}
	if !isMusicBrainzCompilationRelease(payload) {
		t.Fatal("isMusicBrainzCompilationRelease() = false, want true")
	}
	if !isVariousArtistsRelease(payload) {
		t.Fatal("isVariousArtistsRelease() = false, want true")
	}
	if !isVariousArtistsCompilationRelease(payload) {
		t.Fatal("isVariousArtistsCompilationRelease() = false, want true")
	}
	if got := musicBrainzCompilationArtistRefs(payload); len(got) != 2 {
		t.Fatalf("musicBrainzCompilationArtistRefs() = %#v, want two non-VA artists", got)
	}
	if !isMusicBrainzBandRelation("member of band") {
		t.Fatal("isMusicBrainzBandRelation() = false, want true")
	}
	if isMusicBrainzBandRelation("") {
		t.Fatal("isMusicBrainzBandRelation(empty) = true, want false")
	}

	builder := newMusicBrainzExplorationBuilder()
	artistNodeID := addMusicBrainzArtistNode(builder, artistID, "Artist", "", "artist", 2)
	releaseNodeID := addMusicBrainzReleaseNode(builder, payload, 1)
	recordingNodeID := addMusicBrainzRecordingNode(builder, recordingID, "Recording", 1)
	labelNodeID := addMusicBrainzLabelNode(builder, labelID, "Label", 1)
	if artistNodeID == "" || releaseNodeID == "" || recordingNodeID == "" || labelNodeID == "" {
		t.Fatalf("MusicBrainz node helpers returned empty ids: %q %q %q %q", artistNodeID, releaseNodeID, recordingNodeID, labelNodeID)
	}
	if got := musicBrainzBrowseURL(app.musicBrainzAPIBaseURL(), "artist", map[string][]string{"query": {"artist:demo"}}, "genres+tags"); got != "https://musicbrainz.example/ws/2/artist?fmt=json&query=artist%3Ademo&inc=genres%2Btags" {
		t.Fatalf("musicBrainzBrowseURL() = %q, want encoded browse URL", got)
	}
}

func TestMusicBrainzHelperEdgeCases(t *testing.T) {
	labelID := "44444444-4444-4444-8444-444444444444"

	if got := objectString(nil, "missing"); got != "" {
		t.Fatalf("objectString(nil) = %q, want empty", got)
	}
	if got := objectString(map[string]any{"name": true}, "name"); got != "" {
		t.Fatalf("objectString(non-string) = %q, want empty", got)
	}
	if _, ok := objectBool(nil, "enabled"); ok {
		t.Fatal("objectBool(nil) = ok, want false")
	}
	if got, ok := objectBool(map[string]any{"enabled": false}, "enabled"); !ok || got {
		t.Fatalf("objectBool(false) = (%t, %t), want (false, true)", got, ok)
	}
	if _, ok := objectBool(map[string]any{"enabled": "yes"}, "enabled"); ok {
		t.Fatal("objectBool(non-bool) = ok, want false")
	}

	if got := musicBrainzLifeSpan(map[string]any{"life-span": map[string]any{"ended": true}}); got != "? –" {
		t.Fatalf("musicBrainzLifeSpan(ended only) = %q, want %q", got, "? –")
	}
	if got := musicBrainzLifeSpan(map[string]any{"life-span": map[string]any{"begin": "1999"}}); got != "1999" {
		t.Fatalf("musicBrainzLifeSpan(begin only) = %q, want %q", got, "1999")
	}

	payload := map[string]any{
		"label-info": []any{map[string]any{"label": map[string]any{"name": musicBrainzNoLabelName}}},
		"labels": []any{
			map[string]any{"id": labelID, "name": "Fallback Label"},
			map[string]any{"id": "bad", "name": "No Label"},
		},
	}
	if gotID, gotName := musicBrainzReleaseLabelInfo(payload); gotID != labelID || gotName != "Fallback Label" {
		t.Fatalf("musicBrainzReleaseLabelInfo(fallback) = (%q, %q), want (%q, %q)", gotID, gotName, labelID, "Fallback Label")
	}
	if !isExcludedMusicBrainzLabel(" No Label ") {
		t.Fatal("isExcludedMusicBrainzLabel(no label) = false, want true")
	}
	if isExcludedMusicBrainzLabel("") {
		t.Fatal("isExcludedMusicBrainzLabel(empty) = true, want false")
	}
	if !isMusicBrainzBandRelation(" founder ") || !isMusicBrainzBandRelation("subgroup") {
		t.Fatal("isMusicBrainzBandRelation() did not recognize expected band relations")
	}
	if isMusicBrainzBandRelation("producer") {
		t.Fatal("isMusicBrainzBandRelation(producer) = true, want false")
	}
	if !isVariousArtistsRelease(map[string]any{"artist-credit-phrase": "Various Artists"}) {
		t.Fatal("isVariousArtistsRelease(artist-credit-phrase) = false, want true")
	}
}

func TestMusicBrainzHelperAdditionalEdgeBranches(t *testing.T) {
	artistID := "11111111-1111-4111-8111-111111111111"
	labelID := "44444444-4444-4444-8444-444444444444"
	releaseID := "33333333-3333-4333-8333-333333333333"

	if got := objectRawString(nil, "raw"); got != "" {
		t.Fatalf("objectRawString(nil) = %q, want empty", got)
	}
	if got := musicBrainzLifeSpan(map[string]any{"life-span": map[string]any{"end": "2005"}}); got != "? – 2005" {
		t.Fatalf("musicBrainzLifeSpan(end only) = %q, want %q", got, "? – 2005")
	}
	if got := musicBrainzArtistCredit(map[string]any{"artist-credit": []any{"literal"}}); got != "" {
		t.Fatalf("musicBrainzArtistCredit(string-only) = %q, want empty", got)
	}

	credits := musicBrainzArtistCredits(map[string]any{
		"artist-credit": []any{
			"literal",
			map[string]any{},
			map[string]any{"artist": map[string]any{"name": "Fallback Artist", "id": artistID}},
			map[string]any{"name": "  ", "artist": map[string]any{"id": artistID}},
		},
	})
	if len(credits) != 1 || credits[0].Name != "Fallback Artist" || credits[0].ArtistID != artistID {
		t.Fatalf("musicBrainzArtistCredits(fallback name) = %#v, want one fallback artist credit", credits)
	}

	if got := firstMusicBrainzReleaseTitle(map[string]any{"releases": []any{map[string]any{"title": "  "}, true}}); got != "" {
		t.Fatalf("firstMusicBrainzReleaseTitle(empty titles) = %q, want empty", got)
	}
	if got := collectMusicBrainzTagNames(map[string]any{"genres": []any{
		map[string]any{"name": " "},
		map[string]any{"name": "Beta", "count": float64(1)},
		map[string]any{"name": "Alpha", "count": float64(1)},
	}}); !stringSlicesEqual(got, []string{"Alpha", "Beta"}) {
		t.Fatalf("collectMusicBrainzTagNames(tied counts) = %#v, want alphabetical tie-breaks", got)
	}
	urlRelations := collectMusicBrainzURLRelations(map[string]any{"relations": []any{
		map[string]any{"target-type": "artist"},
		map[string]any{"target-type": "url", "type": "official", "url": map[string]any{}},
		map[string]any{"target-type": "url", "type": "official", "url": map[string]any{"resource": "https://b.example"}},
		map[string]any{"target-type": "url", "type": "official", "url": map[string]any{"resource": "https://a.example"}},
	}})
	if len(urlRelations) != 2 || urlRelations[0].Resource != "https://a.example" || urlRelations[1].Resource != "https://b.example" {
		t.Fatalf("collectMusicBrainzURLRelations(resource ordering) = %#v, want sorted official URLs", urlRelations)
	}

	nameMap := musicBrainzArtistNameMap(map[string]any{"artist-credit": []any{
		map[string]any{"name": "  ", "artist": map[string]any{"id": artistID}},
		map[string]any{"name": "Artist", "artist": map[string]any{"id": "bad"}},
		map[string]any{"name": "Artist", "artist": map[string]any{"id": artistID}},
	}})
	if len(nameMap) != 1 || nameMap[artistID] != "Artist" {
		t.Fatalf("musicBrainzArtistNameMap(skip invalid and empty) = %#v, want one valid artist entry", nameMap)
	}

	if gotID, gotName := musicBrainzReleaseLabelInfo(map[string]any{"labels": []any{
		map[string]any{"name": "No Label"},
		map[string]any{"id": labelID, "name": "Actual Label"},
	}}); gotID != labelID || gotName != "Actual Label" {
		t.Fatalf("musicBrainzReleaseLabelInfo(labels fallback) = (%q, %q), want (%q, %q)", gotID, gotName, labelID, "Actual Label")
	}
	if got := musicBrainzReleaseDateLabel(map[string]any{"first-release-date": "1999"}); got != "1999" {
		t.Fatalf("musicBrainzReleaseDateLabel(fallback) = %q, want %q", got, "1999")
	}
	if got := musicBrainzReleaseGroupSummary(map[string]any{"release-group": map[string]any{"secondary-types": []any{"", "Live"}}}); got != "Live" {
		t.Fatalf("musicBrainzReleaseGroupSummary(secondary only) = %q, want %q", got, "Live")
	}
	if got := musicBrainzReleaseGroupSummary(map[string]any{}); got != "" {
		t.Fatalf("musicBrainzReleaseGroupSummary(empty) = %q, want empty", got)
	}

	if !isVariousArtistsRelease(map[string]any{"artist-credit": []any{map[string]any{"name": "Various Artists"}}}) {
		t.Fatal("isVariousArtistsRelease(credit name) = false, want true")
	}
	if !isVariousArtistsRelease(map[string]any{"artist-credit": []any{map[string]any{"name": "Various", "joinphrase": " Artists"}}}) {
		t.Fatal("isVariousArtistsRelease(credit phrase) = false, want true")
	}
	if !isVariousArtistsRelease(map[string]any{"release-group": map[string]any{"artist-credit": []any{map[string]any{"artist": map[string]any{"id": musicBrainzVariousArtistsID, "name": "Various Artists"}}}}}) {
		t.Fatal("isVariousArtistsRelease(various artists id) = false, want true")
	}

	refs := musicBrainzCompilationArtistRefs(map[string]any{"media": []any{map[string]any{"tracks": []any{
		map[string]any{"artist-credit": []any{map[string]any{"name": "Various Artists"}}},
		map[string]any{"artist-credit": []any{map[string]any{"name": " Guest "}}},
		map[string]any{"recording": map[string]any{"artist-credit": []any{map[string]any{"name": "guest"}}}},
		map[string]any{"recording": map[string]any{"artist-credit": []any{map[string]any{"name": "  "}}}},
	}}}})
	if len(refs) != 1 || refs[0].Name != "Guest" || refs[0].ArtistID != "" {
		t.Fatalf("musicBrainzCompilationArtistRefs(name fallback dedupe) = %#v, want one guest ref without an id", refs)
	}

	builder := newMusicBrainzExplorationBuilder()
	artistNodeID := addMusicBrainzArtistNode(builder, artistID, "Artist", "", "", 1)
	artistNode := builder.nodes[artistNodeID]
	if artistNode.Kind != "artist" || artistNode.Subtitle != "Artist" {
		t.Fatalf("addMusicBrainzArtistNode(defaults) = %#v, want default artist kind and subtitle", artistNode)
	}
	releaseNodeID := addMusicBrainzReleaseNode(builder, map[string]any{
		"id":    releaseID,
		"title": "Release",
		"release-group": map[string]any{
			"secondary-types": []any{"Live"},
		},
	}, 1)
	releaseNode := builder.nodes[releaseNodeID]
	if releaseNode.Subtitle != "Release • Live" {
		t.Fatalf("addMusicBrainzReleaseNode(group summary only) = %#v, want release subtitle with group summary", releaseNode)
	}
	dateOnlyBuilder := newMusicBrainzExplorationBuilder()
	releaseNodeID = addMusicBrainzReleaseNode(dateOnlyBuilder, map[string]any{
		"id":    releaseID,
		"title": "Release With Date",
		"date":  "2001-02-03",
	}, 1)
	releaseNode = dateOnlyBuilder.nodes[releaseNodeID]
	if releaseNode.Subtitle != "Release • 2001-02-03" {
		t.Fatalf("addMusicBrainzReleaseNode(date only) = %#v, want release subtitle with date", releaseNode)
	}

	if got := musicBrainzBrowseURL("https://musicbrainz.example/ws/2", "release", nil, ""); got != "https://musicbrainz.example/ws/2/release?fmt=json" {
		t.Fatalf("musicBrainzBrowseURL(empty query) = %q, want bare fmt=json URL", got)
	}
}
