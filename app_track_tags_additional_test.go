package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	taglib "go.senan.xyz/taglib"
)

func TestTrackTagParsingHelpers(t *testing.T) {
	tags := map[string][]string{
		"ARTIST":                {" Artist Name "},
		"TITLE":                 {" Track Title "},
		"TRACKNUMBER":           {" 03/12 "},
		"TRACKTOTAL":            {" 12/12 "},
		"ORGANIZATION":          {" Label Name "},
		"CATALOG":               {" CAT-001 "},
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
	if builtTags.TrackNumber != "03" || builtTags.TrackTotal != "12" || builtTags.Codec != "FLAC" || builtTags.RecordLabel != "Label Name" || builtTags.CatalogNumber != "CAT-001" {
		t.Fatalf("buildTrackTags() = %#v, want normalized metadata", builtTags)
	}
}

func TestBuildTrackTagsPrefersTrackArtistOverAlbumArtistFallback(t *testing.T) {
	tags := map[string][]string{
		"TRACKARTIST": {" Guest Performer "},
		"ARTIST":      {" Release Artist "},
		"ALBUMARTIST": {" Compilation Artist "},
		"TITLE":       {" Track Title "},
	}

	builtTags := buildTrackTags(tags, TrackTechnicalMetadata{})

	if builtTags.Artist != "Guest Performer" {
		t.Fatalf("buildTrackTags() artist = %q, want %q", builtTags.Artist, "Guest Performer")
	}
	if builtTags.AlbumArtist != "Compilation Artist" {
		t.Fatalf("buildTrackTags() album artist = %q, want %q", builtTags.AlbumArtist, "Compilation Artist")
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

	app := newTestAppWithSettingsLoaded()
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}

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
	if got := resolveTrackTagsWorkerCountWithMax(trackTagsWorkerLimit+10, remoteTrackTagsWorkerLimit); got > remoteTrackTagsWorkerLimit {
		t.Fatalf("resolveTrackTagsWorkerCountWithMax(remote cap) = %d, want <= %d", got, remoteTrackTagsWorkerLimit)
	}
	if got := resolveTrackTagsWorkerCountWithMax(5, 0); got != 0 {
		t.Fatalf("resolveTrackTagsWorkerCountWithMax(zero max) = %d, want 0", got)
	}

	if _, ok := readTrackTagsForPath(fixture.trackOne, ""); ok {
		t.Fatal("readTrackTagsForPath(fake flac) = true, want false")
	}

	results = app.ReadTrackTags([]string{fixture.trackOne, secondTrack, fixture.outsideTrack, ""})
	if len(results) != 0 {
		t.Fatalf("ReadTrackTags(fake tracks) len = %d, want 0", len(results))
	}
	remoteTrack := buildRemoteLibraryPath(buildRemoteLibraryBasePath("example.com", 5005), "Library/Artist/Album/01 Track.flac")
	results = app.ReadTrackTags([]string{remoteTrack})
	if len(results) != 0 {
		t.Fatalf("ReadTrackTags(remote track) = %#v, want empty result", results)
	}
	if got, want := len(app.trackTagsCacheState().byPath), 2; got != want {
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
	if got, want := len(evictionApp.trackTagsCacheState().byPath), trackTagsCacheLimit; got != want {
		t.Fatalf("trackTags cache len = %d, want %d", got, want)
	}
	if _, exists := evictionApp.trackTagsCacheState().byPath["track-0.flac"]; exists {
		t.Fatal("expected oldest track tags cache entry to be evicted")
	}
	if _, exists := evictionApp.trackTagsCacheState().byPath[fmt.Sprintf("track-%d.flac", trackTagsCacheLimit)]; !exists {
		t.Fatal("expected newest track tags cache entry to remain present")
	}
}

func TestReadTrackTagsDeduplicatesConcurrentInflightReads(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newTestAppWithSettingsLoaded()
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}

	originalReadTaglibTags := readTaglibTags
	originalReadTaglibProperties := readTaglibProperties
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
		readTaglibProperties = originalReadTaglibProperties
	})

	var readCount atomic.Int32
	startCh := make(chan struct{})
	readTaglibTags = func(path string) (map[string][]string, error) {
		readCount.Add(1)
		<-startCh
		return map[string][]string{
			"TITLE":  {filepath.Base(path)},
			"ARTIST": {"Artist"},
		}, nil
	}
	readTaglibProperties = func(string) (taglib.Properties, error) {
		return taglib.Properties{}, nil
	}

	results := make([]map[string]TrackTags, 2)
	var waitGroup sync.WaitGroup
	for index := range results {
		waitGroup.Add(1)
		go func(resultIndex int) {
			defer waitGroup.Done()
			results[resultIndex] = app.ReadTrackTags([]string{fixture.trackOne})
		}(index)
	}

	for readCount.Load() == 0 {
		runtime.Gosched()
	}
	close(startCh)
	waitGroup.Wait()

	if got := readCount.Load(); got != 1 {
		t.Fatalf("readTaglibTags concurrent call count = %d, want 1", got)
	}
	for index, result := range results {
		tags, exists := result[fixture.trackOne]
		if !exists || tags.Title == "" || tags.Artist == "" {
			t.Fatalf("ReadTrackTags concurrent result[%d] = %#v, want resolved tags for %q", index, result, fixture.trackOne)
		}
	}
	if got := len(app.trackTagsCacheState().inflightBy); got != 0 {
		t.Fatalf("len(trackTags inflight map) = %d, want 0", got)
	}
}

func TestReadTrackTagsUsesMetadataDatabaseBeforeReadingFiles(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	fixture := createLibraryTestFixture(t)
	app := newTestAppWithSettingsLoaded()
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}

	signature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", fixture.trackOne)
	}

	readCalls := 0
	readTaglibTags = func(_ string) (map[string][]string, error) {
		readCalls++
		return map[string][]string{"TITLE": {"File Title"}}, nil
	}

	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Signature:       signature,
		Title:           "Database Title",
		TrackArtist:     "Database Artist",
		AlbumTitle:      "Database Album",
		AlbumArtist:     "Database Album Artist",
		Genres:          []string{"Electronic", "Ambient"},
		TrackNumber:     2,
		TrackTotal:      10,
		DiscNumber:      1,
		DiscTotal:       1,
		DurationSeconds: 123.5,
		BitRate:         900000,
		BitDepth:        24,
		SampleRate:      96000,
		Channels:        2,
		FileSizeBytes:   signature.Size,
		RecordingID:     "11111111-1111-4111-8111-111111111111",
		ReleaseID:       "22222222-2222-4222-8222-222222222222",
		ArtistIDs:       []string{"33333333-3333-4333-8333-333333333333"},
		AlbumArtistIDs:  []string{"44444444-4444-4444-8444-444444444444"},
	})
	app.musicBrainzTagMu.Unlock()

	results := app.ReadTrackTags([]string{fixture.trackOne})
	tags, exists := results[fixture.trackOne]
	if !exists {
		t.Fatalf("ReadTrackTags(database hit) = %#v, want result for %q", results, fixture.trackOne)
	}
	if readCalls != 0 {
		t.Fatalf("readTaglibTags() calls = %d, want 0 when metadata database has the tags", readCalls)
	}
	if tags.Title != "Database Title" || tags.Artist != "Database Artist" || tags.Album != "Database Album" {
		t.Fatalf("ReadTrackTags(database title/artist/album) = %#v, want stored metadata", tags)
	}
	if tags.TrackNumber != "2" || tags.TrackTotal != "10" || tags.DiscNumber != "1" || tags.DiscTotal != "1" {
		t.Fatalf("ReadTrackTags(database positions) = %#v, want numeric fields converted to strings", tags)
	}
	if tags.Genre != "Electronic" || len(tags.Genres) != 2 {
		t.Fatalf("ReadTrackTags(database genres) = %#v, want stored genres", tags)
	}
	if tags.Codec != "FLAC" || tags.Container != "flac" || tags.ChannelLayout != "stereo" {
		t.Fatalf("ReadTrackTags(database technical metadata) = %#v, want derived codec/container/layout", tags)
	}
	if tags.FileSizeBytes != signature.Size || tags.ArtistID != "33333333-3333-4333-8333-333333333333" || tags.AlbumArtistID != "44444444-4444-4444-8444-444444444444" {
		t.Fatalf("ReadTrackTags(database IDs/file size) = %#v, want stored IDs and signature size", tags)
	}
}

func TestReadTrackTagsFallsBackToFileReadWhenDatabaseMetadataIsEmpty(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	fixture := createLibraryTestFixture(t)
	app := newTestAppWithSettingsLoaded()
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}

	signature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", fixture.trackOne)
	}

	readCalls := 0
	readTaglibTags = func(_ string) (map[string][]string, error) {
		readCalls++
		return map[string][]string{
			"TITLE":  {"File Title"},
			"ARTIST": {"File Artist"},
		}, nil
	}

	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Signature: signature,
	})
	app.musicBrainzTagMu.Unlock()

	results := app.ReadTrackTags([]string{fixture.trackOne})
	tags, exists := results[fixture.trackOne]
	if !exists {
		t.Fatalf("ReadTrackTags(file fallback) = %#v, want result for %q", results, fixture.trackOne)
	}
	if readCalls != 1 {
		t.Fatalf("readTaglibTags() calls = %d, want 1 when database metadata is empty", readCalls)
	}
	if tags.Title != "File Title" || tags.Artist != "File Artist" {
		t.Fatalf("ReadTrackTags(file fallback) = %#v, want file metadata", tags)
	}
}

func TestApplyStoredMetadataToIndexedTracksDoesNotLazyLoadMetadataStore(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newTestAppWithLoadedSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled: boolPointer(true),
	})
	app.settingsPath = filepath.Join(t.TempDir(), appSettingsFileName)

	entries := []LibraryIndexedFile{{
		Name:         filepath.Base(fixture.trackOne),
		Path:         fixture.trackOne,
		RelativePath: filepath.ToSlash(filepath.Base(filepath.Dir(fixture.trackOne)) + "/" + filepath.Base(fixture.trackOne)),
		FolderPath:   "Library/Artist One/Album One",
		RootPath:     fixture.rootOne,
		RootName:     "Library",
	}}

	enriched := app.applyStoredMetadataToIndexedTracks(entries)

	if app.musicBrainzTagStoreLoaded {
		t.Fatal("applyStoredMetadataToIndexedTracks() loaded the metadata store, want startup path to skip lazy loading")
	}
	if len(enriched) != 1 || enriched[0].CachedTrackTitle != "" || enriched[0].CachedAlbumTitle != "" || enriched[0].CachedAlbumArtist != "" || enriched[0].CachedArtistName != "" {
		t.Fatalf("applyStoredMetadataToIndexedTracks() = %#v, want unchanged entry without lazy metadata load", enriched)
	}
}

func TestTrackTagWorkerAndBlobNoMetadataBranches(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	fixture := createLibraryTestFixture(t)
	app := newTestAppWithSettingsLoaded()
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}

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

func TestRefreshTrackMetadataForcesFreshReadAndIncrementalRescan(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	originalIncrementalHook := beforeIncrementalLibraryPathScanHook
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
		beforeIncrementalLibraryPathScanHook = originalIncrementalHook
	})

	fixture := createLibraryTestFixture(t)
	app := newTestAppWithLoadedSettings(AppSettings{LibraryPath: fixture.rootOne})
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}
	app.scanLibraryFolder(fixture.rootOne, false)

	readTitle := "Cached Title"
	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{"TITLE": {readTitle}}, nil
	}

	if tags := app.ReadTrackTags([]string{fixture.trackOne}); tags[fixture.trackOne].Title != "Cached Title" {
		t.Fatalf("ReadTrackTags() title = %q, want cached title", tags[fixture.trackOne].Title)
	}

	signature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", fixture.trackOne)
	}
	app.musicBrainzTagMu.Lock()
	app.ensureMusicBrainzTagDatabaseLoadedLocked()
	app.upsertMusicBrainzTagTrackRecordLocked(fixture.trackOne, musicBrainzTagTrackRecord{
		Signature:   signature,
		Title:       "Database Title",
		TrackArtist: "Database Artist",
	})
	app.musicBrainzTagMu.Unlock()

	readTitle = "Fresh Title"
	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{
			"TITLE":  {readTitle},
			"ARTIST": {"Fresh Artist"},
			"CUSTOM": {"Fresh Value"},
		}, nil
	}
	rescannedPath := ""
	beforeIncrementalLibraryPathScanHook = func(path string) {
		rescannedPath = path
	}

	tags, err := app.RefreshTrackMetadata(fixture.trackOne)
	if err != nil {
		t.Fatalf("RefreshTrackMetadata() error = %v", err)
	}
	if tags.Title != "Fresh Title" {
		t.Fatalf("RefreshTrackMetadata() title = %q, want %q", tags.Title, "Fresh Title")
	}
	if tags.Artist != "Fresh Artist" {
		t.Fatalf("RefreshTrackMetadata() artist = %q, want %q", tags.Artist, "Fresh Artist")
	}
	if got := tags.AllTags["CUSTOM"]; len(got) != 1 || got[0] != "Fresh Value" {
		t.Fatalf("RefreshTrackMetadata() allTags = %#v, want file-backed custom tag", tags.AllTags)
	}
	if rescannedPath != "" {
		t.Fatalf("incremental refresh path = %q, want empty", rescannedPath)
	}

	app.musicBrainzTagMu.Lock()
	refreshedRecord := app.musicBrainzTagStore.Tracks[fixture.trackOne]
	app.musicBrainzTagMu.Unlock()
	if refreshedRecord.Title != "Fresh Title" || refreshedRecord.TrackArtist != "Fresh Artist" {
		t.Fatalf("RefreshTrackMetadata() record = %#v, want refreshed database metadata", refreshedRecord)
	}
}

func TestRefreshTrackMetadataRejectsUnsupportedPaths(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newTestAppWithLoadedSettings(AppSettings{LibraryPath: fixture.rootOne})
	app.activeLibraryRoots = []libraryRootConfig{{
		Path: fixture.rootOne,
		Name: "Library",
	}}

	if _, err := app.RefreshTrackMetadata(""); err == nil {
		t.Fatal("RefreshTrackMetadata(empty) error = nil, want error")
	}
	if _, err := app.RefreshTrackMetadata(fixture.outsideTrack); err == nil {
		t.Fatal("RefreshTrackMetadata(outside) error = nil, want error")
	}
	remoteTrack := buildRemoteLibraryPath(buildRemoteLibraryBasePath("example.com", 5005), "Library/Artist/Album/01 Track.flac")
	if _, err := app.RefreshTrackMetadata(remoteTrack); err == nil {
		t.Fatal("RefreshTrackMetadata(remote) error = nil, want error")
	}
}

func TestReadTrackTagsFromBlobsAdditionalTempAndDiscardBranches(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	app := newTestAppWithSettingsLoaded()

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

	app := newTestAppWithSettingsLoaded()
	if got := app.ReadTrackTagsFromBlobs([]TrackBlob{{
		Key:  "empty-blob",
		Name: "track.flac",
		Data: base64.StdEncoding.EncodeToString([]byte{}),
	}}); len(got) != 0 {
		t.Fatalf("ReadTrackTagsFromBlobs(no metadata discard) = %#v, want empty result", got)
	}
}
