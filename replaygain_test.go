package main

import (
	"math"
	"testing"
)

func TestExtractReplayGainFromTagsPrefersTrackGain(t *testing.T) {
	tags := map[string][]string{
		"REPLAYGAIN_TRACK_GAIN": {"-7.50 dB"},
		"REPLAYGAIN_TRACK_PEAK": {"0.9231"},
		"REPLAYGAIN_ALBUM_GAIN": {"-4.00 dB"},
	}

	info, ok := extractReplayGainFromTags(tags)
	if !ok {
		t.Fatal("expected replaygain tags to be extracted")
	}
	if info.Source != string(replayGainSourceTrackTag) {
		t.Fatalf("expected track tag source, got %q", info.Source)
	}
	if math.Abs(info.GainDB-(-7.5)) > 0.0001 {
		t.Fatalf("expected track gain -7.5 dB, got %.4f", info.GainDB)
	}
	if math.Abs(info.Peak-0.9231) > 0.000001 {
		t.Fatalf("expected track peak 0.9231, got %.6f", info.Peak)
	}
}

func TestExtractAlbumReplayGainFromTagsIgnoresTrackGain(t *testing.T) {
	tags := map[string][]string{
		"REPLAYGAIN_TRACK_GAIN": {"-7.50 dB"},
		"REPLAYGAIN_ALBUM_GAIN": {"-4.00 dB"},
		"REPLAYGAIN_ALBUM_PEAK": {"0.991"},
	}

	info, ok := extractAlbumReplayGainFromTags(tags)
	if !ok {
		t.Fatal("expected album replaygain tags to be extracted")
	}
	if info.Source != string(replayGainSourceAlbumTag) {
		t.Fatalf("expected album tag source, got %q", info.Source)
	}
	if math.Abs(info.GainDB-(-4.0)) > 0.0001 {
		t.Fatalf("expected album gain -4.0 dB, got %.4f", info.GainDB)
	}
	if math.Abs(info.Peak-0.991) > 0.000001 {
		t.Fatalf("expected album peak 0.991, got %.6f", info.Peak)
	}
}

func TestParseReplayGainAnalysisOutput(t *testing.T) {
	output := `[Parsed_replaygain_0 @ 0000000000000000] track_gain = +6.93 dB
[Parsed_replaygain_0 @ 0000000000000000] track_peak = 0.088367`

	info, ok := parseReplayGainAnalysisOutput(output)
	if !ok {
		t.Fatal("expected ffmpeg replaygain analysis output to parse")
	}
	if info.Source != string(replayGainSourceCalculated) {
		t.Fatalf("expected calculated source, got %q", info.Source)
	}
	if math.Abs(info.GainDB-6.93) > 0.0001 {
		t.Fatalf("expected gain 6.93 dB, got %.4f", info.GainDB)
	}
	if math.Abs(info.Peak-0.088367) > 0.000001 {
		t.Fatalf("expected peak 0.088367, got %.6f", info.Peak)
	}
}

func TestReplayGainScalePreventsClippingWhenPeakIsKnown(t *testing.T) {
	info := ReplayGainInfo{
		GainDB: 6,
		Peak:   0.9,
		Source: string(replayGainSourceCalculated),
	}

	scale := info.Scale()
	expected := 1 / 0.9
	if math.Abs(scale-expected) > 0.000001 {
		t.Fatalf("expected scale %.6f, got %.6f", expected, scale)
	}
}
