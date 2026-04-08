package main

import (
	"encoding/base64"
	"errors"
	"math"
	"testing"

	"github.com/metaisfacil/oto/v3"
)

func TestAudioBackendDecodeHelpers(t *testing.T) {
	backendNames := map[string]string{
		"wasapi":      "WASAPI",
		"winmm":       "WinMM",
		" coreaudio ": "CoreAudio",
		"pulseaudio":  "PulseAudio",
		"webaudio":    "WebAudio",
		"oboe":        "Oboe",
		"console":     "Console",
		"":            "Auto",
		"auto":        "Auto",
		"custom":      "CUSTOM",
	}
	for input, want := range backendNames {
		if got := backendDisplayName(input); got != want {
			t.Fatalf("backendDisplayName(%q) = %q, want %q", input, got, want)
		}
	}

	trimInfo, ok := parseITunSMPBValue("iTunSMPB= 00000000 00000840 00000210")
	if !ok || trimInfo.LeadSamples != 0x840 || trimInfo.TailSamples != 0x210 {
		t.Fatalf("parseITunSMPBValue(valid) = (%#v, %t), want parsed values", trimInfo, ok)
	}
	if _, ok := parseITunSMPBValue("   "); ok {
		t.Fatal("parseITunSMPBValue(blank) = ok, want false")
	}
	if _, ok := parseITunSMPBValue("broken"); ok {
		t.Fatal("parseITunSMPBValue(invalid) = ok, want false")
	}
	if _, ok := parseITunSMPBValue("iTunSMPB= 00000000 -0000001 00000210"); ok {
		t.Fatal("parseITunSMPBValue(negative lead) = ok, want false")
	}
	if _, ok := parseITunSMPBValue("iTunSMPB= 00000000 00000010 -0000001"); ok {
		t.Fatal("parseITunSMPBValue(negative tail) = ok, want false")
	}

	if got := readGaplessTrimInfoFromTags(nil); got != (gaplessTrimInfo{}) {
		t.Fatalf("readGaplessTrimInfoFromTags(nil) = %#v, want empty", got)
	}
	if got := readGaplessTrimInfoFromTags(map[string][]string{"iTunSMPB": {" 00000000 00000010 00000020 "}}); got.LeadSamples != 0x10 || got.TailSamples != 0x20 {
		t.Fatalf("readGaplessTrimInfoFromTags(iTunSMPB) = %#v, want parsed trim", got)
	}
	fallbackTrim := readGaplessTrimInfoFromTags(map[string][]string{
		"ENC_DELAY":   {"32"},
		"ENC_PADDING": {"64"},
	})
	if fallbackTrim.LeadSamples != 32 || fallbackTrim.TailSamples != 64 {
		t.Fatalf("readGaplessTrimInfoFromTags(fallback) = %#v, want 32/64", fallbackTrim)
	}

	payload := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	if got := trimPCMForGapless(nil, gaplessTrimInfo{}); got != nil {
		t.Fatalf("trimPCMForGapless(nil) = %#v, want nil", got)
	}
	if got := trimPCMForGapless(payload, gaplessTrimInfo{}); string(got) != string(payload) {
		t.Fatalf("trimPCMForGapless(no trim) = %#v, want original payload", got)
	}
	trimmed := trimPCMForGapless(payload, gaplessTrimInfo{LeadSamples: 1, TailSamples: 1})
	if got, want := len(trimmed), len(payload)-2*audioBytesPerFrame; got != want {
		t.Fatalf("trimPCMForGapless(trimmed) len = %d, want %d", got, want)
	}
	if got := trimPCMForGapless(payload, gaplessTrimInfo{LeadSamples: 99, TailSamples: 99}); len(got) != 0 {
		t.Fatalf("trimPCMForGapless(overtrim) len = %d, want 0", len(got))
	}

	if got := normalizeVisualizationFrameCount(1); got != minVisualizationFrameCount {
		t.Fatalf("normalizeVisualizationFrameCount(low) = %d, want %d", got, minVisualizationFrameCount)
	}
	if got := normalizeVisualizationFrameCount(maxVisualizationFrameCount + 99); got != maxVisualizationFrameCount {
		t.Fatalf("normalizeVisualizationFrameCount(high) = %d, want %d", got, maxVisualizationFrameCount)
	}
	if got := normalizeVisualizationFrameCount(128); got != 128 {
		t.Fatalf("normalizeVisualizationFrameCount(mid) = %d, want %d", got, 128)
	}
}

func TestListOutputDevicesAdditionalBranches(t *testing.T) {
	originalListAudioOutputDevices := listAudioOutputDevices
	t.Cleanup(func() {
		listAudioOutputDevices = originalListAudioOutputDevices
	})

	backend := NewAudioBackend()

	listAudioOutputDevices = func() ([]oto.OutputDevice, error) {
		return nil, errors.New("device enumeration failed")
	}
	fallbackDevices := backend.ListOutputDevices()
	if len(fallbackDevices) != 1 || fallbackDevices[0].ID != defaultAudioOutputDevice || !fallbackDevices[0].IsDefault {
		t.Fatalf("ListOutputDevices(error fallback) = %#v, want default auto device", fallbackDevices)
	}

	listAudioOutputDevices = func() ([]oto.OutputDevice, error) {
		return []oto.OutputDevice{{ID: " ", Name: "Ignored", Backend: oto.DeviceBackend("wasapi")}}, nil
	}
	fallbackDevices = backend.ListOutputDevices()
	if len(fallbackDevices) != 1 || fallbackDevices[0].ID != defaultAudioOutputDevice {
		t.Fatalf("ListOutputDevices(empty mapped fallback) = %#v, want default auto device", fallbackDevices)
	}

	listAudioOutputDevices = func() ([]oto.OutputDevice, error) {
		return []oto.OutputDevice{
			{ID: " ", Name: "Ignored", Backend: oto.DeviceBackend("wasapi")},
			{ID: "device-1", Name: " ", Backend: oto.DeviceBackend("wasapi"), IsDefault: true},
		}, nil
	}
	mappedDevices := backend.ListOutputDevices()
	if len(mappedDevices) != 1 {
		t.Fatalf("ListOutputDevices(mapped) len = %d, want 1", len(mappedDevices))
	}
	if mappedDevices[0].ID != "device-1" || mappedDevices[0].Name != "WASAPI: device-1" || mappedDevices[0].Backend != "wasapi" || !mappedDevices[0].IsDefault {
		t.Fatalf("ListOutputDevices(mapped) = %#v, want mapped wasapi device with fallback name", mappedDevices[0])
	}
}

func TestDecodeTrackUsesHelperFFmpeg(t *testing.T) {
	helperDir := t.TempDir()
	helperPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	backend := NewAudioBackend()
	backend.ffmpegPath = helperPath

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString([]byte{1, 2, 3, 4}))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	decoded, err := backend.decodeTrack("track.flac", 1)
	if err != nil {
		t.Fatalf("decodeTrack(success) error = %v", err)
	}
	if got, want := len(decoded), 4; got != want {
		t.Fatalf("decodeTrack(success) len = %d, want %d", got, want)
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	if _, err := backend.decodeTrack("track.flac", 1); err == nil {
		t.Fatal("decodeTrack(empty output) error = nil, want error")
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "ffmpeg exploded")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "1")
	if _, err := backend.decodeTrack("track.flac", 1); err == nil || err.Error() != "ffmpeg decode failed: ffmpeg exploded" {
		t.Fatalf("decodeTrack(error) = %v, want ffmpeg stderr error", err)
	}
}

func TestAudioBackendDecodeAdditionalCoverageBranches(t *testing.T) {
	payload := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	if got := trimPCMForGapless(payload, gaplessTrimInfo{LeadSamples: -1, TailSamples: 1}); string(got) != string(payload[:len(payload)-audioBytesPerFrame]) {
		t.Fatalf("trimPCMForGapless(negative lead) = %#v, want trailing trim only", got)
	}
	if got := trimPCMForGapless(payload, gaplessTrimInfo{LeadSamples: 1, TailSamples: -1}); string(got) != string(payload[audioBytesPerFrame:]) {
		t.Fatalf("trimPCMForGapless(negative tail) = %#v, want leading trim only", got)
	}

	helperDir := t.TempDir()
	helperPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	backend := NewAudioBackend()
	backend.ffmpegPath = helperPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString([]byte{1, 2, 3, 4}))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	if decoded, err := backend.decodeTrack("track.flac", 0); err != nil || len(decoded) != 4 {
		t.Fatalf("decodeTrack(zero scale) = (%d, %v), want successful decoded output", len(decoded), err)
	}
	if decoded, err := backend.decodeTrack("track.flac", math.NaN()); err != nil || len(decoded) != 4 {
		t.Fatalf("decodeTrack(nan scale) = (%d, %v), want successful decoded output", len(decoded), err)
	}

	emptyBackend := NewAudioBackend()
	emptyFrame := emptyBackend.VisualizationFrame(minVisualizationFrameCount)
	if emptyFrame.Loaded || emptyFrame.Playing || emptyFrame.FrameCount != 0 || len(emptyFrame.Samples) != 0 || emptyFrame.SampleStride != 1 {
		t.Fatalf("VisualizationFrame(unloaded) = %#v, want unloaded empty frame", emptyFrame)
	}

	shortBackend := NewAudioBackend()
	shortBackend.streamSegments = []audioTrackSegment{{SourcePath: "short.flac", PCMData: []byte{1, 2}}}
	shortFrame := shortBackend.VisualizationFrame(minVisualizationFrameCount)
	if !shortFrame.Loaded || shortFrame.SourcePath != "short.flac" || len(shortFrame.Samples) != 0 || shortFrame.SampleStride != 1 {
		t.Fatalf("VisualizationFrame(short pcm) = %#v, want loaded empty frame", shortFrame)
	}

	startBackend := NewAudioBackend()
	startBackend.streamSegments = []audioTrackSegment{{
		SourcePath: "track.flac",
		PCMData:    encodeStereoPCM([][2]int16{{100, -100}, {200, -200}, {300, -300}}),
	}}
	frame := startBackend.VisualizationFrame(2)
	if !frame.Loaded || frame.FrameCount != 3 || len(frame.Samples) != 6 || frame.SampleStride != 1 {
		t.Fatalf("VisualizationFrame(start of track) = %#v, want three emitted frames", frame)
	}
	if frame.Samples[0] != 100 || frame.Samples[1] != -100 || frame.Samples[4] != 300 || frame.Samples[5] != -300 {
		t.Fatalf("VisualizationFrame(start of track) samples = %#v, want first and last frame preserved", frame.Samples)
	}

	decimatedBackend := NewAudioBackend()
	frames := make([][2]int16, 512)
	for index := range frames {
		value := int16(index % 32768)
		frames[index] = [2]int16{value, -value}
	}
	decimatedBackend.streamSegments = []audioTrackSegment{{
		SourcePath: "decimated.flac",
		PCMData:    encodeStereoPCM(frames),
	}}
	decimatedBackend.streamReadOffset = int64(len(decimatedBackend.streamSegments[0].PCMData))
	decimatedBackend.playbackBaseBytes = decimatedBackend.streamReadOffset
	decimatedFrame := decimatedBackend.VisualizationFrame(minVisualizationFrameCount)
	if decimatedFrame.SampleStride <= 6 {
		t.Fatalf("VisualizationFrame(decimated) sample stride = %.4f, want > 6", decimatedFrame.SampleStride)
	}
}
