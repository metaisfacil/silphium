package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestTrackTagParsingHelpers(t *testing.T) {
	tags := map[string][]string{
		"ARTIST":                {" Artist Name "},
		"TITLE":                 {" Track Title "},
		"TRACKNUMBER":           {" 03/12 "},
		"TRACKTOTAL":            {" 12/12 "},
		"MUSICBRAINZ_ARTISTID":  {"11111111-1111-4111-8111-111111111111; 11111111-1111-4111-8111-111111111111"},
		"MusicBrainz Artist Id": {"22222222-2222-4222-8222-222222222222"},
		"CODEC":                 {" flac "},
		"BITS":                  {"24 bit"},
	}

	if got := firstTagValue(tags, "artist", "albumartist"); got != "Artist Name" {
		t.Fatalf("firstTagValue() = %q, want %q", got, "Artist Name")
	}
	if got := firstTagValue(tags, "missing"); got != "" {
		t.Fatalf("firstTagValue(missing) = %q, want empty", got)
	}

	allTags := collectAllTags(map[string][]string{" ARTIST ": {"  Artist Name  ", ""}, "EMPTY": {"   "}})
	if got, want := len(allTags), 1; got != want {
		t.Fatalf("collectAllTags() len = %d, want %d", got, want)
	}
	if got := collectAllTags(nil); got != nil {
		t.Fatalf("collectAllTags(nil) = %#v, want nil", got)
	}

	left, right := splitSlashPair(" 03 / 12 ")
	if left != "03" || right != "12" {
		t.Fatalf("splitSlashPair() = (%q, %q), want (%q, %q)", left, right, "03", "12")
	}
	left, right = splitSlashPair("single")
	if left != "single" || right != "" {
		t.Fatalf("splitSlashPair(single) = (%q, %q), want (%q, empty)", left, right, "single")
	}

	trackNumber, trackTotal := extractTrackNumbers(tags)
	if trackNumber != "03" || trackTotal != "12" {
		t.Fatalf("extractTrackNumbers() = (%q, %q), want (%q, %q)", trackNumber, trackTotal, "03", "12")
	}

	if got := parseIntValue(" 320 kbps "); got != 320 {
		t.Fatalf("parseIntValue() = %d, want %d", got, 320)
	}
	if got := parseIntValue("0"); got != 0 {
		t.Fatalf("parseIntValue(zero) = %d, want 0", got)
	}
	if got := parseIntValue(strings.Repeat("9", 400)); got != 0 {
		t.Fatalf("parseIntValue(overflow) = %d, want 0", got)
	}
	if got := parseFloatValue("44.1"); got != 44.1 {
		t.Fatalf("parseFloatValue() = %.1f, want 44.1", got)
	}
	if got := parseFloatValue("0"); got != 0 {
		t.Fatalf("parseFloatValue(zero) = %.1f, want 0", got)
	}

	if got := bitDepthFromSampleFmt("flt"); got != 32 {
		t.Fatalf("bitDepthFromSampleFmt() = %d, want %d", got, 32)
	}
	if got := inferContainerFromPath("track.FLAC"); got != "flac" {
		t.Fatalf("inferContainerFromPath() = %q, want %q", got, "flac")
	}
	if got := inferChannelLayout(6); got != "5.1" {
		t.Fatalf("inferChannelLayout() = %q, want %q", got, "5.1")
	}
	if got := parseBitDepthFromTags(tags); got != 24 {
		t.Fatalf("parseBitDepthFromTags() = %d, want %d", got, 24)
	}
	if got := inferCodecFromContainerAndTags("flac", tags); got != "FLAC" {
		t.Fatalf("inferCodecFromContainerAndTags() = %q, want %q", got, "FLAC")
	}

	artistIDs := extractArtistMBIDs(tags)
	if got, want := len(artistIDs), 2; got != want {
		t.Fatalf("extractArtistMBIDs() len = %d, want %d", got, want)
	}

	builtTags := buildTrackTags(tags, TrackTechnicalMetadata{
		BitDepth:        24,
		SampleRate:      44100,
		Codec:           "FLAC",
		CodecLong:       "Free Lossless Audio Codec",
		CodecProfile:    "Lossless",
		SampleFormat:    "s16",
		Channels:        2,
		ChannelLayout:   "stereo",
		BitRate:         900000,
		OverallBitRate:  910000,
		DurationSeconds: 123.4,
		Container:       "flac",
		FileSizeBytes:   2048,
	})
	if !hasAnyTrackMetadata(builtTags) {
		t.Fatal("hasAnyTrackMetadata() = false, want true")
	}
	if hasAnyTrackMetadata(TrackTags{}) {
		t.Fatal("hasAnyTrackMetadata(empty) = true, want false")
	}
	if builtTags.TrackNumber != "03" || builtTags.TrackTotal != "12" || builtTags.Codec != "FLAC" {
		t.Fatalf("buildTrackTags() = %#v, want normalized metadata", builtTags)
	}
}

func TestTrackTechnicalMetadataWithFFProbeAndFallbacks(t *testing.T) {
	helperDir := t.TempDir()
	ffprobePath := copyCurrentTestBinary(t, helperDir, "ffprobe.exe")
	trackPath := filepath.Join(helperDir, "track.flac")
	if err := os.WriteFile(trackPath, []byte("not real audio"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", trackPath, err)
	}

	t.Setenv("SILPHIUM_TEST_FFPROBE_JSON", `{"streams":[{"codec_name":"flac","codec_long_name":"Free Lossless Audio Codec","profile":"Lossless","sample_rate":"96000","bits_per_sample":24,"sample_fmt":"s32","channels":2,"channel_layout":"stereo","bit_rate":"123456","duration":"12.5"}],"format":{"format_name":"flac","bit_rate":"654321","duration":"12.5"}}`)
	metadata, ok := readTrackTechnicalMetadataFromFFProbe(trackPath, ffprobePath)
	if !ok {
		t.Fatal("readTrackTechnicalMetadataFromFFProbe(valid) = false, want true")
	}
	if metadata.SampleRate != 96000 || metadata.BitDepth != 24 || metadata.Container != "flac" {
		t.Fatalf("readTrackTechnicalMetadataFromFFProbe(valid) = %#v, want parsed metadata", metadata)
	}

	t.Setenv("SILPHIUM_TEST_FFPROBE_JSON", `{"streams":[],"format":{"format_name":"wav","bit_rate":"320000","duration":"1.5"}}`)
	metadata, ok = readTrackTechnicalMetadataFromFFProbe(trackPath, ffprobePath)
	if !ok || metadata.Container != "wav" || metadata.OverallBitRate != 320000 {
		t.Fatalf("readTrackTechnicalMetadataFromFFProbe(no streams) = (%#v, %t), want format metadata", metadata, ok)
	}

	t.Setenv("SILPHIUM_TEST_FFPROBE_JSON", `{broken`)
	if _, ok := readTrackTechnicalMetadataFromFFProbe(trackPath, ffprobePath); ok {
		t.Fatal("readTrackTechnicalMetadataFromFFProbe(invalid json) = true, want false")
	}
	if _, ok := readTrackTechnicalMetadataFromFFProbe(trackPath, ""); ok {
		t.Fatal("readTrackTechnicalMetadataFromFFProbe(empty path) = true, want false")
	}

	fallback := readTrackTechnicalMetadata(trackPath, map[string][]string{
		"FORMAT":              {"flac"},
		"CODEC":               {"FLAC"},
		"PROFILE":             {"Lossless"},
		"SAMPLE_FMT":          {"s16"},
		"CHANNELS":            {"2"},
		"BITRATE":             {"128"},
		"DURATION":            {"45.5"},
		"BITS":                {"24"},
		"SAMPLERATE":          {"44100"},
		"LYRICS":              {"hello"},
		"MUSICBRAINZ_TRACKID": {"33333333-3333-4333-8333-333333333333"},
	}, "")
	if fallback.Container != "flac" || fallback.Codec != "FLAC" || fallback.BitRate != 128000 || fallback.SampleRate != 44100 || fallback.BitDepth != 24 {
		t.Fatalf("readTrackTechnicalMetadata(fallback) = %#v, want tag-derived metadata", fallback)
	}
	if fallback.FileSizeBytes == 0 {
		t.Fatal("readTrackTechnicalMetadata(fallback) should preserve file size")
	}
}

func TestTrackTagCachingAndBatchReads(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	secondTrack := filepath.Join(fixture.albumOneFolder, "02 Second.flac")
	writeTestFile(t, secondTrack, "fake track")

	app := &App{
		settingsLoaded: true,
		activeLibraryRoots: []libraryRootConfig{{
			Path: fixture.rootOne,
			Name: "Library",
		}},
	}

	signature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", fixture.trackOne)
	}
	if _, ok := trackTagsFileSignatureForPath(fixture.albumOneFolder); ok {
		t.Fatal("trackTagsFileSignatureForPath(directory) = true, want false")
	}

	normalizedPaths := app.normalizeTrackTagPaths([]string{"", fixture.trackOne, fixture.trackOne, fixture.outsideTrack, secondTrack})
	if got, want := len(normalizedPaths), 2; got != want {
		t.Fatalf("normalizeTrackTagPaths() len = %d, want %d", got, want)
	}

	app.putTrackTagsCache(fixture.trackOne, signature, TrackTags{Artist: "Artist"}, true)
	if cachedTags, hasMetadata, cacheHit := app.getTrackTagsCache(fixture.trackOne, signature); !cacheHit || !hasMetadata || cachedTags.Artist != "Artist" {
		t.Fatalf("getTrackTagsCache(hit) = (%#v, %t, %t), want cached metadata", cachedTags, hasMetadata, cacheHit)
	}
	results := app.ReadTrackTags([]string{fixture.trackOne})
	if tags, exists := results[fixture.trackOne]; !exists || tags.Artist != "Artist" {
		t.Fatalf("ReadTrackTags(cached metadata) = %#v, want cached artist metadata for %q", results, fixture.trackOne)
	}
	app.touchTrackTagsCacheOrderLocked(fixture.trackOne)
	app.removeTrackTagsCacheOrderEntryLocked(fixture.trackOne)
	if _, _, cacheHit := app.getTrackTagsCache(fixture.trackOne, trackTagsFileSignature{Size: signature.Size + 1}); cacheHit {
		t.Fatal("getTrackTagsCache(signature mismatch) = true, want false")
	}

	if got := resolveTrackTagsWorkerCount(0); got != 0 {
		t.Fatalf("resolveTrackTagsWorkerCount(0) = %d, want 0", got)
	}
	wantWorkers := trackTagsWorkerLimit
	if runtime.NumCPU() < wantWorkers {
		wantWorkers = runtime.NumCPU()
		if wantWorkers < 2 {
			wantWorkers = 2
		}
	}
	if got := resolveTrackTagsWorkerCount(trackTagsWorkerLimit + 10); got != wantWorkers {
		t.Fatalf("resolveTrackTagsWorkerCount(max) = %d, want %d", got, wantWorkers)
	}

	if _, ok := readTrackTagsForPath(fixture.trackOne, ""); ok {
		t.Fatal("readTrackTagsForPath(fake flac) = true, want false")
	}

	results = app.ReadTrackTags([]string{fixture.trackOne, secondTrack, fixture.outsideTrack, ""})
	if len(results) != 0 {
		t.Fatalf("ReadTrackTags(fake tracks) len = %d, want 0", len(results))
	}
	if got, want := len(app.trackTagsCacheByPath), 2; got != want {
		t.Fatalf("ReadTrackTags() cache size = %d, want %d", got, want)
	}

	results = app.ReadTrackTags([]string{fixture.trackOne, secondTrack})
	if len(results) != 0 {
		t.Fatalf("ReadTrackTags(cache hit replay) len = %d, want 0", len(results))
	}

	blobResults := app.ReadTrackTagsFromBlobs([]TrackBlob{
		{Key: "", Name: "track.flac", Data: "AA=="},
		{Key: "bad", Name: "track.flac", Data: "%%%"},
		{Key: "plain", Name: "track.flac", Data: "dGV4dA=="},
	})
	if len(blobResults) != 0 {
		t.Fatalf("ReadTrackTagsFromBlobs(invalid blobs) len = %d, want 0", len(blobResults))
	}

	evictionApp := &App{}
	for index := 0; index <= trackTagsCacheLimit; index++ {
		path := fmt.Sprintf("track-%d.flac", index)
		evictionApp.putTrackTagsCache(path, trackTagsFileSignature{Size: int64(index), ModUnixNs: int64(index)}, TrackTags{Title: path}, true)
	}
	if got, want := len(evictionApp.trackTagsCacheByPath), trackTagsCacheLimit; got != want {
		t.Fatalf("trackTags cache len = %d, want %d", got, want)
	}
	if _, exists := evictionApp.trackTagsCacheByPath["track-0.flac"]; exists {
		t.Fatal("expected oldest track tags cache entry to be evicted")
	}
	if _, exists := evictionApp.trackTagsCacheByPath[fmt.Sprintf("track-%d.flac", trackTagsCacheLimit)]; !exists {
		t.Fatal("expected newest track tags cache entry to remain present")
	}
}

func TestTrackTagWorkerAndBlobNoMetadataBranches(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	fixture := createLibraryTestFixture(t)
	app := &App{
		settingsLoaded: true,
		activeLibraryRoots: []libraryRootConfig{{
			Path: fixture.rootOne,
			Name: "Library",
		}},
	}

	if got := resolveTrackTagsWorkerCount(1); got != 1 {
		t.Fatalf("resolveTrackTagsWorkerCount(1) = %d, want 1", got)
	}

	results := app.ReadTrackTags([]string{"", fixture.outsideTrack})
	if len(results) != 0 {
		t.Fatalf("ReadTrackTags(empty normalized paths) = %#v, want empty result", results)
	}

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{"TITLE": {"Worker Title"}}, nil
	}
	results = app.ReadTrackTags([]string{fixture.trackOne})
	tags, exists := results[fixture.trackOne]
	if !exists || tags.Title != "Worker Title" {
		t.Fatalf("ReadTrackTags(worker result) = %#v, want populated worker result for %q", results, fixture.trackOne)
	}

	results = app.ReadTrackTags([]string{fixture.albumOneFolder})
	if len(results) != 0 {
		t.Fatalf("ReadTrackTags(directory only) = %#v, want empty result", results)
	}

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{}, nil
	}
	blobResults := app.ReadTrackTagsFromBlobs([]TrackBlob{{
		Key:  "blob-no-metadata",
		Name: "",
		Data: base64.StdEncoding.EncodeToString([]byte{0}),
	}})
	tags, exists = blobResults["blob-no-metadata"]
	if !exists || tags.FileSizeBytes == 0 {
		t.Fatalf("ReadTrackTagsFromBlobs(technical-only blob) = %#v, want technical fallback result", blobResults)
	}
}

func TestReadTrackTagsFromBlobsAdditionalTempAndDiscardBranches(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	app := &App{settingsLoaded: true}

	blockedTemp := filepath.Join(t.TempDir(), "blocked-temp")
	writeTestFile(t, blockedTemp, "blocked")
	t.Setenv("TMP", blockedTemp)
	t.Setenv("TEMP", blockedTemp)
	if got := app.ReadTrackTagsFromBlobs([]TrackBlob{{
		Key:  "temp-fail",
		Name: "track.flac",
		Data: base64.StdEncoding.EncodeToString([]byte("blob")),
	}}); len(got) != 0 {
		t.Fatalf("ReadTrackTagsFromBlobs(create temp error) = %#v, want empty result", got)
	}
}

func TestReadTrackTagsFromBlobsDiscardNoMetadataBranch(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	readTaglibTags = func(path string) (map[string][]string, error) {
		return map[string][]string{}, nil
	}

	app := &App{settingsLoaded: true}
	if got := app.ReadTrackTagsFromBlobs([]TrackBlob{{
		Key:  "empty-blob",
		Name: "track.flac",
		Data: base64.StdEncoding.EncodeToString([]byte{}),
	}}); len(got) != 0 {
		t.Fatalf("ReadTrackTagsFromBlobs(no metadata discard) = %#v, want empty result", got)
	}
}
