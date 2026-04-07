package main

import (
	"encoding/base64"
	"errors"
	"math"
	"path/filepath"
	"testing"
)

func TestPrepareTrackSegmentAndReplayGainTagFallbacks(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	helperDir := t.TempDir()
	ffmpegPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	trackOne := filepath.Join(helperDir, "01 One.flac")
	trackTwo := filepath.Join(helperDir, "02 Two.flac")
	writeTestFile(t, trackOne, "track one")
	writeTestFile(t, trackTwo, "track two")

	payload := []byte{1, 0, 1, 0, 2, 0, 2, 0, 3, 0, 3, 0, 4, 0, 4, 0}
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(payload))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")

	readTaglibTags = func(path string) (map[string][]string, error) {
		switch normalizePath(path) {
		case normalizePath(trackOne):
			return map[string][]string{
				"iTunSMPB":              {"00000000 00000001 00000001"},
				"REPLAYGAIN_TRACK_GAIN": {"-6 dB"},
				"REPLAYGAIN_TRACK_PEAK": {"0.5"},
				"REPLAYGAIN_ALBUM_GAIN": {"-3 dB"},
				"REPLAYGAIN_ALBUM_PEAK": {"0.8"},
			}, nil
		case normalizePath(trackTwo):
			return map[string][]string{
				"REPLAYGAIN_ALBUM_GAIN": {"-4 dB"},
				"REPLAYGAIN_ALBUM_PEAK": {"0.9"},
			}, nil
		default:
			return nil, errors.New("missing tags")
		}
	}

	backend := NewAudioBackend()
	backend.ffmpegPath = ffmpegPath
	backend.gaplessPlayback = true
	backend.replayGainEnabled = true
	segment, err := backend.prepareTrackSegment(trackOne, nil)
	if err != nil {
		t.Fatalf("prepareTrackSegment() error = %v", err)
	}
	if got, want := len(segment.PCMData), 8; got != want {
		t.Fatalf("prepareTrackSegment() len = %d, want %d after gapless trim", got, want)
	}
	if math.Abs(segment.ReplayGainScale-ReplayGainInfo{GainDB: -6, Peak: 0.5}.Scale()) > 0.000001 {
		t.Fatalf("prepareTrackSegment() scale = %.6f, want track-tag scale", segment.ReplayGainScale)
	}

	albumInfo, ok := backend.resolveAlbumReplayGainInfo(nil, []string{trackOne, trackTwo})
	if !ok || albumInfo.Source != string(replayGainSourceAlbumTag) || albumInfo.GainDB != -3 {
		t.Fatalf("resolveAlbumReplayGainInfo(taglib tags) = (%#v, %t), want album-tag info", albumInfo, ok)
	}
	backend.putReplayGainReleaseCache("cache-key", ReplayGainInfo{GainDB: -2, Peak: 0.7}, true)
	if cachedInfo, hasValue, cacheHit := backend.getReplayGainReleaseCache("cache-key"); !cacheHit || !hasValue || cachedInfo.GainDB != -2 {
		t.Fatalf("getReplayGainReleaseCache(cache-key) = (%#v, %t, %t), want cached info", cachedInfo, hasValue, cacheHit)
	}

	trackInfo := backend.resolveReplayGainInfo(trackOne, nil, nil)
	if trackInfo.Source != string(replayGainSourceTrackTag) || trackInfo.GainDB != -6 {
		t.Fatalf("resolveReplayGainInfo(taglib fallback) = %#v, want track-tag info", trackInfo)
	}

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return nil, errors.New("tag read failed")
	}
	backendWithoutTags := NewAudioBackend()
	backendWithoutTags.ffmpegPath = ""
	if albumInfo, ok := backendWithoutTags.resolveAlbumReplayGainInfo(nil, []string{trackOne, trackTwo}); ok || albumInfo != (ReplayGainInfo{}) {
		t.Fatalf("resolveAlbumReplayGainInfo(no tags, no ffmpeg) = (%#v, %t), want empty false", albumInfo, ok)
	}
	if trackInfo := backendWithoutTags.resolveReplayGainInfo(trackOne, nil, nil); trackInfo != (ReplayGainInfo{}) {
		t.Fatalf("resolveReplayGainInfo(no tags, no ffmpeg) = %#v, want empty info", trackInfo)
	}
}
