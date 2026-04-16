package main

import (
	"encoding/base64"
	"path/filepath"
	"strings"
	"testing"

	"github.com/metaisfacil/oto/v3"
	taglib "go.senan.xyz/taglib"
)

func newAudioTestApp(t *testing.T) (*App, libraryTestFixture, string) {
	t.Helper()

	fixture := createLibraryTestFixture(t)
	helperPath := copyCurrentTestBinary(t, t.TempDir(), "ffmpeg.exe")
	app := NewApp()
	app.settingsLoaded = true
	app.settings = AppSettings{
		FFmpegPath: helperPath,
		Audio: AudioSettings{
			GaplessPlayback: true,
		},
		LibraryFolders: []AppLibraryFolder{{
			Path:         fixture.rootOne,
			ReleaseDepth: 2,
		}},
	}
	app.activeLibraryRoots = []libraryRootConfig{{
		Path:         normalizePath(fixture.rootOne),
		Name:         filepath.Base(fixture.rootOne),
		ReleaseDepth: 2,
	}}
	app.audioBackend().SetFFmpegPath(helperPath)
	app.audioBackend().ApplyAudioSettings(app.settings.Audio)
	return app, fixture, helperPath
}

func TestAppAudioMethodsAndWrappers(t *testing.T) {
	pcmBytes := make([]byte, audioBytesPerFrame*8)
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")

	fakeContext := &fakeAudioContext{}
	useFakeAudioContext(t, fakeContext, nil)
	app, fixture, helperPath := newAudioTestApp(t)
	secondTrack := filepath.Join(fixture.albumOneFolder, "02 Song.flac")
	writeTestFile(t, secondTrack, "track two")
	outsideTrack := filepath.Join(t.TempDir(), "outside.flac")
	remoteTrack := buildRemoteLibraryPath(buildRemoteLibraryBasePath("example.com", 5005), "Library/Album/03 Remote.flac")
	writeTestFile(t, outsideTrack, "outside")

	if status := app.ValidateFFmpegPath(helperPath); !status.Available {
		t.Fatalf("ValidateFFmpegPath() = %#v, want available ffmpeg path", status)
	}

	normalizedPaths, err := app.normalizeReplayGainContextPaths([]string{fixture.trackOne, fixture.trackOne, " "}, fixture.trackOne)
	if err != nil {
		t.Fatalf("normalizeReplayGainContextPaths() error = %v", err)
	}
	if len(normalizedPaths) != 1 || normalizedPaths[0] != normalizePath(fixture.trackOne) {
		t.Fatalf("normalizeReplayGainContextPaths() = %#v, want one normalized track path", normalizedPaths)
	}
	if _, err := app.normalizeReplayGainContextPaths(nil, outsideTrack); err == nil {
		t.Fatal("normalizeReplayGainContextPaths(outside required path) error = nil, want error")
	}
	if _, err := app.normalizeReplayGainContextPaths([]string{outsideTrack}, ""); err == nil {
		t.Fatal("normalizeReplayGainContextPaths(outside path) error = nil, want error")
	}

	if initializedState, err := app.InitializeAudioBackend(); err != nil || initializedState.Loaded {
		t.Fatalf("InitializeAudioBackend() = (%#v, %v), want initialized unloaded state", initializedState, err)
	}
	if _, err := app.AudioLoadTrack(""); err == nil {
		t.Fatal("AudioLoadTrack(empty path) error = nil, want error")
	}
	if _, err := app.AudioLoadTrack(outsideTrack); err == nil {
		t.Fatal("AudioLoadTrack(outside path) error = nil, want error")
	}
	if _, err := app.AudioLoadTrack(remoteTrack); err == nil {
		t.Fatal("AudioLoadTrack(remote path) error = nil, want error")
	}
	if _, err := app.AudioLoadTrackWithReplayGainContext(fixture.trackOne, []string{outsideTrack}); err == nil {
		t.Fatal("AudioLoadTrackWithReplayGainContext(outside replaygain path) error = nil, want error")
	}
	if _, err := app.AudioLoadTrackWithReplayGainContext(fixture.trackOne, []string{remoteTrack}); err == nil {
		t.Fatal("AudioLoadTrackWithReplayGainContext(remote replaygain path) error = nil, want error")
	}
	if _, err := app.AudioQueueNextTrackWithReplayGainContext(outsideTrack, secondTrack, nil); err == nil {
		t.Fatal("AudioQueueNextTrackWithReplayGainContext(outside current path) error = nil, want error")
	}
	if _, err := app.AudioQueueNextTrackWithReplayGainContext(fixture.trackOne, outsideTrack, nil); err == nil {
		t.Fatal("AudioQueueNextTrackWithReplayGainContext(outside next path) error = nil, want error")
	}
	if _, err := app.AudioQueueNextTrackWithReplayGainContext(fixture.trackOne, remoteTrack, nil); err == nil {
		t.Fatal("AudioQueueNextTrackWithReplayGainContext(remote next path) error = nil, want error")
	}
	if _, err := app.AudioQueueNextTrackWithReplayGainContext(fixture.trackOne, secondTrack, []string{outsideTrack}); err == nil {
		t.Fatal("AudioQueueNextTrackWithReplayGainContext(outside replaygain path) error = nil, want error")
	}
	if _, err := app.AudioQueueNextTrackWithReplayGainContext(fixture.trackOne, secondTrack, []string{remoteTrack}); err == nil {
		t.Fatal("AudioQueueNextTrackWithReplayGainContext(remote replaygain path) error = nil, want error")
	}

	loadState, err := app.AudioLoadTrackWithReplayGainContext(fixture.trackOne, []string{fixture.trackOne, secondTrack})
	if err != nil || !loadState.Loaded {
		t.Fatalf("AudioLoadTrackWithReplayGainContext() = (%#v, %v), want loaded state", loadState, err)
	}
	queueState, err := app.AudioQueueNextTrack(fixture.trackOne, secondTrack)
	if err != nil || !queueState.Loaded {
		t.Fatalf("AudioQueueNextTrack() = (%#v, %v), want loaded state", queueState, err)
	}
	queueState, err = app.AudioQueueNextTrackWithReplayGainContext(fixture.trackOne, "", []string{fixture.trackOne, secondTrack})
	if err != nil || !queueState.Loaded {
		t.Fatalf("AudioQueueNextTrackWithReplayGainContext(clear) = (%#v, %v), want loaded state", queueState, err)
	}

	playState, err := app.AudioPlay()
	if err != nil || !playState.Playing {
		t.Fatalf("AudioPlay() = (%#v, %v), want playing state", playState, err)
	}
	pauseState, err := app.AudioPause()
	if err != nil || pauseState.Playing {
		t.Fatalf("AudioPause() = (%#v, %v), want paused state", pauseState, err)
	}
	seekState, err := app.AudioSeek(0.002)
	if err != nil || !seekState.Loaded {
		t.Fatalf("AudioSeek() = (%#v, %v), want loaded state", seekState, err)
	}
	volumeState, err := app.AudioSetVolume(0.25)
	if err != nil || volumeState.Volume != 0.25 {
		t.Fatalf("AudioSetVolume() = (%#v, %v), want volume 0.25", volumeState, err)
	}
	if got := app.AudioGetState(); !got.Loaded {
		t.Fatalf("AudioGetState() = %#v, want loaded state", got)
	}
	if frame := app.AudioGetVisualizationFrame(4); !frame.Loaded || frame.ChannelCount != audioChannelCount || frame.FrameCount < 4 || frame.SampleStride <= 0 {
		t.Fatalf("AudioGetVisualizationFrame() = %#v, want loaded stereo frame metadata", frame)
	}

	originalListAudioOutputDevices := listAudioOutputDevices
	listAudioOutputDevices = func() ([]oto.OutputDevice, error) {
		return []oto.OutputDevice{{ID: "default", Name: "Speakers", Backend: "wasapi", IsDefault: true}}, nil
	}
	t.Cleanup(func() {
		listAudioOutputDevices = originalListAudioOutputDevices
	})
	if devices := app.AudioListOutputDevices(); len(devices) != 1 || devices[0].Name != "WASAPI: Speakers" {
		t.Fatalf("AudioListOutputDevices() = %#v, want mapped output device", devices)
	}

	if _, err := app.AudioPlay(); err != nil {
		t.Fatalf("AudioPlay(before reinitialize) error = %v", err)
	}
	app.settings.Audio.OutputDevice = "default"
	reinitializedState, err := app.AudioReinitializeBackend()
	if err != nil || !reinitializedState.Loaded || !reinitializedState.Playing {
		t.Fatalf("AudioReinitializeBackend() = (%#v, %v), want playing loaded state", reinitializedState, err)
	}

	if dynamicRange, err := app.AudioGetReplayGainReleaseDynamicRange([]string{fixture.trackOne}); err != nil || dynamicRange != 0 {
		t.Fatalf("AudioGetReplayGainReleaseDynamicRange(single path) = (%d, %v), want (0, nil)", dynamicRange, err)
	}
	if _, err := app.AudioGetReplayGainReleaseDynamicRange([]string{outsideTrack}); err == nil {
		t.Fatal("AudioGetReplayGainReleaseDynamicRange(outside path) error = nil, want error")
	}
	if _, err := app.AudioGetReplayGainReleaseDynamicRange([]string{remoteTrack}); err == nil {
		t.Fatal("AudioGetReplayGainReleaseDynamicRange(remote path) error = nil, want error")
	}
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "LRA: 11.0 LU")
	if dynamicRange, err := app.AudioGetReplayGainReleaseDynamicRange([]string{fixture.trackOne, secondTrack}); err != nil || dynamicRange != 11 {
		t.Fatalf("AudioGetReplayGainReleaseDynamicRange() = (%d, %v), want (11, nil)", dynamicRange, err)
	}

	stopState, err := app.AudioStop()
	if err != nil || stopState.Loaded {
		t.Fatalf("AudioStop() = (%#v, %v), want unloaded state", stopState, err)
	}
}

func TestInitializeAudioBackendError(t *testing.T) {
	app := NewApp()
	app.audioBackend().SetFFmpegPath(filepath.Join(t.TempDir(), "missing-ffmpeg.exe"))

	if _, err := app.InitializeAudioBackend(); err == nil {
		t.Fatal("InitializeAudioBackend(missing ffmpeg) error = nil, want error")
	}
}

func TestAudioReinitializeBackendError(t *testing.T) {
	app := NewApp()
	app.settingsLoaded = true
	app.audioBackend().SetFFmpegPath(filepath.Join(t.TempDir(), "missing-ffmpeg.exe"))
	app.audioBackend().streamSegments = []audioTrackSegment{{
		SourcePath: "track.flac",
		PCMData:    make([]byte, audioBytesPerSecond),
	}}

	if _, err := app.AudioReinitializeBackend(); err == nil {
		t.Fatal("AudioReinitializeBackend(missing ffmpeg) error = nil, want error")
	}
}

func TestAudioWriteReplayGainTags(t *testing.T) {
	originalWriteTaglibTags := writeTaglibTags
	t.Cleanup(func() {
		writeTaglibTags = originalWriteTaglibTags
	})

	app, fixture, _ := newAudioTestApp(t)
	secondTrack := filepath.Join(fixture.albumOneFolder, "02 Song.flac")
	writeTestFile(t, secondTrack, "track two")

	writtenTagsByPath := make(map[string]map[string][]string)
	writeTaglibTags = func(path string, tags map[string][]string, _ taglib.WriteOption) error {
		copied := make(map[string][]string, len(tags))
		for key, values := range tags {
			copied[key] = append([]string(nil), values...)
		}
		writtenTagsByPath[path] = copied
		return nil
	}

	trackOneSignature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", fixture.trackOne)
	}
	trackTwoSignature, ok := trackTagsFileSignatureForPath(secondTrack)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", secondTrack)
	}
	app.audioBackend().putReplayGainCache(fixture.trackOne, trackOneSignature, ReplayGainInfo{GainDB: -2, Peak: 0.6}, true)
	app.audioBackend().putReplayGainCache(secondTrack, trackTwoSignature, ReplayGainInfo{GainDB: -3, Peak: 0.7}, true)
	releaseCacheKey, ok := buildReplayGainReleaseCacheKey([]string{fixture.trackOne, secondTrack})
	if !ok {
		t.Fatal("buildReplayGainReleaseCacheKey(two tracks) = false, want true")
	}
	app.audioBackend().putReplayGainReleaseCache(releaseCacheKey, ReplayGainInfo{GainDB: -4, Peak: 0.8}, true)
	app.putTrackTagsCache(fixture.trackOne, trackOneSignature, TrackTags{Title: "Cached One"}, true)
	app.putTrackTagsCache(secondTrack, trackTwoSignature, TrackTags{Title: "Cached Two"}, true)

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "[Parsed_replaygain_0 @ 0] track_gain = -5.00 dB\n[Parsed_replaygain_0 @ 0] track_peak = 0.70")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")

	if err := app.AudioWriteReplayGainTags([]string{fixture.trackOne, secondTrack}); err != nil {
		t.Fatalf("AudioWriteReplayGainTags() error = %v", err)
	}

	if len(writtenTagsByPath) != 2 {
		t.Fatalf("AudioWriteReplayGainTags() wrote %d paths, want 2", len(writtenTagsByPath))
	}
	for _, path := range []string{fixture.trackOne, secondTrack} {
		writtenTags := writtenTagsByPath[path]
		if writtenTags == nil {
			t.Fatalf("AudioWriteReplayGainTags() missing write for %q", path)
		}
		if got := strings.Join(writtenTags["REPLAYGAIN_TRACK_GAIN"], "|"); got != "-5.00 dB" {
			t.Fatalf("REPLAYGAIN_TRACK_GAIN for %q = %q, want -5.00 dB", path, got)
		}
		if got := strings.Join(writtenTags["REPLAYGAIN_TRACK_PEAK"], "|"); got != "0.700000" {
			t.Fatalf("REPLAYGAIN_TRACK_PEAK for %q = %q, want 0.700000", path, got)
		}
		if got := strings.Join(writtenTags["REPLAYGAIN_ALBUM_GAIN"], "|"); got != "-5.00 dB" {
			t.Fatalf("REPLAYGAIN_ALBUM_GAIN for %q = %q, want -5.00 dB", path, got)
		}
		if got := strings.Join(writtenTags["REPLAYGAIN_ALBUM_PEAK"], "|"); got != "0.700000" {
			t.Fatalf("REPLAYGAIN_ALBUM_PEAK for %q = %q, want 0.700000", path, got)
		}
	}

	if _, _, cacheHit := app.audioBackend().getReplayGainCache(fixture.trackOne, trackOneSignature); cacheHit {
		t.Fatal("getReplayGainCache(track one) hit after AudioWriteReplayGainTags(), want invalidated cache")
	}
	if _, _, cacheHit := app.audioBackend().getReplayGainCache(secondTrack, trackTwoSignature); cacheHit {
		t.Fatal("getReplayGainCache(track two) hit after AudioWriteReplayGainTags(), want invalidated cache")
	}
	if _, _, cacheHit := app.audioBackend().getReplayGainReleaseCache(releaseCacheKey); cacheHit {
		t.Fatal("getReplayGainReleaseCache() hit after AudioWriteReplayGainTags(), want invalidated release cache")
	}
	if _, _, cacheHit := app.getTrackTagsCache(fixture.trackOne, trackOneSignature); cacheHit {
		t.Fatal("getTrackTagsCache(track one) hit after AudioWriteReplayGainTags(), want invalidated cache")
	}
	if _, _, cacheHit := app.getTrackTagsCache(secondTrack, trackTwoSignature); cacheHit {
		t.Fatal("getTrackTagsCache(track two) hit after AudioWriteReplayGainTags(), want invalidated cache")
	}
}
