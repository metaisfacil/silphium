package main

import (
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"
	"time"

	taglib "go.senan.xyz/taglib"
)

func TestTrackTagHelperFunctions(t *testing.T) {
	bitDepthCases := map[string]int{
		"u8":      8,
		"s16p":    16,
		"s24":     24,
		"flt":     32,
		"dblp":    64,
		"unknown": 0,
	}
	for sampleFmt, want := range bitDepthCases {
		if got := bitDepthFromSampleFmt(sampleFmt); got != want {
			t.Fatalf("bitDepthFromSampleFmt(%q) = %d, want %d", sampleFmt, got, want)
		}
	}

	channelLayoutCases := map[int]string{
		1: "mono",
		2: "stereo",
		3: "",
		6: "5.1",
		8: "7.1",
	}
	for channels, want := range channelLayoutCases {
		if got := inferChannelLayout(channels); got != want {
			t.Fatalf("inferChannelLayout(%d) = %q, want %q", channels, got, want)
		}
	}

	if got := inferCodecFromContainerAndTags("flac", map[string][]string{"CODEC": {"ALAC"}}); got != "ALAC" {
		t.Fatalf("inferCodecFromContainerAndTags(tag override) = %q, want ALAC", got)
	}
	if got := inferCodecFromContainerAndTags("mp3", nil); got != "MP3" {
		t.Fatalf("inferCodecFromContainerAndTags(container fallback) = %q, want MP3", got)
	}
}

func TestReadTrackTechnicalMetadataAndTagsWithTaglibSeams(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	originalReadTaglibProperties := readTaglibProperties
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
		readTaglibProperties = originalReadTaglibProperties
	})

	trackPath := filepath.Join(t.TempDir(), "track.flac")
	writeTestFile(t, trackPath, "fake-track")

	readTaglibProperties = func(_ string) (taglib.Properties, error) {
		return taglib.Properties{
			Length:     3 * time.Second,
			Channels:   2,
			SampleRate: 48000,
			Bitrate:    320,
		}, nil
	}
	metadata := readTrackTechnicalMetadata(trackPath, map[string][]string{
		"BITDEPTH":       {"24"},
		"FORMAT":         {"flac"},
		"CODECPROFILE":   {"Lossless"},
		"SAMPLEFORMAT":   {"s24"},
		"CHANNEL_LAYOUT": {"stereo"},
	}, "")
	if metadata.FileSizeBytes == 0 || metadata.SampleRate != 48000 || metadata.Channels != 2 || metadata.BitRate != 320000 {
		t.Fatalf("readTrackTechnicalMetadata() = %#v, want property-derived technical metadata", metadata)
	}
	if metadata.Container != "flac" || metadata.Codec != "FLAC" || metadata.BitDepth != 24 || metadata.ChannelLayout != "stereo" {
		t.Fatalf("readTrackTechnicalMetadata() = %#v, want tag-derived fallback metadata", metadata)
	}

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{
			"TITLE":                 {"Song"},
			"ARTIST":                {"Artist"},
			"ALBUM":                 {"Album"},
			"MUSICBRAINZ_RELEASEID": {"22222222-2222-4222-8222-222222222222"},
			"MUSICBRAINZ_ARTISTID":  {"11111111-1111-4111-8111-111111111111"},
			"TRACKNUMBER":           {"1"},
			"TRACKTOTAL":            {"9"},
			"DISCNUMBER":            {"1"},
			"DISCTOTAL":             {"1"},
		}, nil
	}
	tags, ok := readTrackTagsForPath(trackPath, "")
	if !ok || tags.Title != "Song" || tags.Container != "flac" || tags.Codec != "FLAC" {
		t.Fatalf("readTrackTagsForPath() = (%#v, %t), want populated tags and technical metadata", tags, ok)
	}

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return nil, errors.New("tag read failed")
	}
	if tags, ok := readTrackTagsForPath(trackPath, ""); ok || tags.Title != "" || tags.Container != "" || tags.Codec != "" {
		t.Fatalf("readTrackTagsForPath(tag error) = (%#v, %t), want empty result", tags, ok)
	}
}

func TestReadTrackTagsFromBlobsWithTaglibSeams(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	originalReadTaglibProperties := readTaglibProperties
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
		readTaglibProperties = originalReadTaglibProperties
	})

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{
			"TITLE":                 {"Blob Song"},
			"ARTIST":                {"Blob Artist"},
			"ALBUM":                 {"Blob Album"},
			"MUSICBRAINZ_RELEASEID": {"22222222-2222-4222-8222-222222222222"},
			"MUSICBRAINZ_ARTISTID":  {"11111111-1111-4111-8111-111111111111"},
		}, nil
	}
	readTaglibProperties = func(_ string) (taglib.Properties, error) {
		return taglib.Properties{Length: 2 * time.Second, Channels: 2, SampleRate: 44100, Bitrate: 320}, nil
	}

	app := &App{settingsLoaded: true}
	results := app.ReadTrackTagsFromBlobs([]TrackBlob{
		{Key: "blob-key", Name: "track.flac", Data: base64.StdEncoding.EncodeToString([]byte("blob-bytes"))},
	})

	tags, exists := results["blob-key"]
	if !exists {
		t.Fatalf("ReadTrackTagsFromBlobs() = %#v, want result for blob-key", results)
	}
	if tags.Title != "Blob Song" || tags.Artist != "Blob Artist" || tags.Container != "flac" || tags.SampleRate != 44100 {
		t.Fatalf("ReadTrackTagsFromBlobs() = %#v, want populated blob metadata", tags)
	}
}

func TestTrackTagHelperEdgeBranches(t *testing.T) {
	if got := collectAllTags(map[string][]string{"   ": {" ", "\t"}}); got != nil {
		t.Fatalf("collectAllTags(all empty) = %#v, want nil", got)
	}

	number, total := extractTrackNumbers(map[string][]string{"TRACKNUMBER": {" 07 / 11 "}})
	if number != "07" || total != "11" {
		t.Fatalf("extractTrackNumbers(split total fallback) = (%q, %q), want (%q, %q)", number, total, "07", "11")
	}

	if got := parseIntValue("not-a-number"); got != 0 {
		t.Fatalf("parseIntValue(no digits) = %d, want 0", got)
	}
	if got := inferCodecFromContainerAndTags("unknown", nil); got != "" {
		t.Fatalf("inferCodecFromContainerAndTags(unknown) = %q, want empty", got)
	}
}

func TestReadTrackTechnicalMetadataFFProbeMergeAndNoMetadataBranch(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	helperDir := t.TempDir()
	ffprobePath := copyCurrentTestBinary(t, helperDir, "ffprobe.exe")
	trackPath := filepath.Join(helperDir, "track.m4a")
	writeTestFile(t, trackPath, "fake-track")

	t.Setenv("SILPHIUM_TEST_FFPROBE_JSON", `{"streams":[{"codec_name":"aac","codec_long_name":"Advanced Audio Coding","profile":"LC","sample_rate":"48000","bits_per_sample":24,"sample_fmt":"fltp","channels":6,"channel_layout":"5.1","bit_rate":"256000","duration":"9.5"}],"format":{"format_name":"m4a","bit_rate":"320000","duration":"9.5"}}`)
	metadata := readTrackTechnicalMetadata(trackPath, nil, ffprobePath)
	if metadata.BitDepth != 24 || metadata.SampleRate != 48000 || metadata.Codec != "AAC" || metadata.CodecLong != "Advanced Audio Coding" || metadata.CodecProfile != "LC" || metadata.SampleFormat != "fltp" || metadata.Channels != 6 || metadata.ChannelLayout != "5.1" || metadata.BitRate != 256000 || metadata.OverallBitRate != 320000 || metadata.DurationSeconds != 9.5 || metadata.Container != "m4a" {
		t.Fatalf("readTrackTechnicalMetadata(ffprobe merge) = %#v, want ffprobe fields copied into metadata", metadata)
	}

	t.Setenv("SILPHIUM_TEST_FFPROBE_JSON", "")
	t.Setenv("SILPHIUM_TEST_FFPROBE_EXIT", "1")
	if _, ok := readTrackTechnicalMetadataFromFFProbe(trackPath, ffprobePath); ok {
		t.Fatal("readTrackTechnicalMetadataFromFFProbe(command error) = true, want false")
	}

	readTaglibTags = func(_ string) (map[string][]string, error) {
		return map[string][]string{}, nil
	}
	missingPath := filepath.Join(helperDir, "track")
	if tags, ok := readTrackTagsForPath(missingPath, ""); ok || tags.Title != "" || tags.Artist != "" || tags.Album != "" || tags.AllTags != nil || tags.Container != "" || tags.Codec != "" || tags.FileSizeBytes != 0 {
		t.Fatalf("readTrackTagsForPath(no metadata) = (%#v, %t), want empty false", tags, ok)
	}
}
