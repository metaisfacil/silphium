package main

import (
	"encoding/binary"
	"testing"
)

func TestCurrentPlayedGlobalBytesUsesDroppedPrefix(t *testing.T) {
	backend := NewAudioBackend()
	backend.streamSegments = []audioTrackSegment{{SourcePath: "queued.flac", PCMData: make([]byte, 12_981_864)}}
	backend.streamDroppedBytes = 44_965_536
	backend.streamReadOffset = 12_981_864
	backend.playbackBaseBytes = 57_950_000

	got := backend.currentPlayedGlobalBytesLocked()
	want := backend.streamDroppedBytes + backend.streamReadOffset
	if got != want {
		t.Fatalf("currentPlayedGlobalBytesLocked() = %d, want %d", got, want)
	}
}

func TestSnapshotLockedRetainsProgressAfterDroppedSegment(t *testing.T) {
	backend := NewAudioBackend()
	backend.streamSegments = []audioTrackSegment{
		{SourcePath: "current.flac", PCMData: make([]byte, 1*audioBytesPerSecond)},
		{SourcePath: "next.flac", PCMData: make([]byte, 3*audioBytesPerSecond)},
	}
	backend.streamDroppedBytes = int64(len(backend.streamSegments[0].PCMData))
	backend.streamSegments = backend.streamSegments[1:]
	backend.streamReadOffset = int64(2 * audioBytesPerSecond)
	backend.playbackBaseBytes = backend.streamDroppedBytes + int64(audioBytesPerSecond)

	state := backend.snapshotLocked()
	if !state.Loaded {
		t.Fatal("expected snapshot to remain loaded")
	}
	if state.SourcePath != "next.flac" {
		t.Fatalf("snapshot sourcePath = %q, want %q", state.SourcePath, "next.flac")
	}
	if state.CurrentTime != 1 {
		t.Fatalf("snapshot currentTime = %.2f, want 1.00", state.CurrentTime)
	}
	if state.Duration != 3 {
		t.Fatalf("snapshot duration = %.2f, want 3.00", state.Duration)
	}
}

func TestEffectivePlayerVolumeLockedCompensatesDecodedReplayGainScale(t *testing.T) {
	backend := NewAudioBackend()
	backend.volume = 0.8
	backend.streamSegments = []audioTrackSegment{{
		SourcePath:      "track.flac",
		PCMData:         make([]byte, audioBytesPerSecond),
		ReplayGainScale: 2,
	}}

	backend.replayGainEnabled = true
	if got, want := backend.effectivePlayerVolumeLocked(), 0.8; got != want {
		t.Fatalf("effectivePlayerVolumeLocked() replaygain-on = %.4f, want %.4f", got, want)
	}

	backend.replayGainEnabled = false
	if got, want := backend.effectivePlayerVolumeLocked(), 0.4; got != want {
		t.Fatalf("effectivePlayerVolumeLocked() replaygain-off = %.4f, want %.4f", got, want)
	}
}

func TestApplyAudioSettingsClearsQueuedTrackOnReplayGainToggle(t *testing.T) {
	backend := NewAudioBackend()
	backend.gaplessPlayback = true
	backend.replayGainEnabled = false
	backend.streamSegments = []audioTrackSegment{
		{SourcePath: "current.flac", PCMData: make([]byte, audioBytesPerSecond), ReplayGainScale: 1},
		{SourcePath: "next.flac", PCMData: make([]byte, audioBytesPerSecond), ReplayGainScale: 1},
	}

	backend.ApplyAudioSettings(AudioSettings{
		OutputDevice:      defaultAudioOutputDevice,
		OutputBufferMs:    0,
		GaplessPlayback:   true,
		ReplayGainEnabled: true,
	})

	if got, want := len(backend.streamSegments), 1; got != want {
		t.Fatalf("queued segments after replaygain toggle = %d, want %d", got, want)
	}
}

func encodeStereoPCM(frames [][2]int16) []byte {
	pcm := make([]byte, len(frames)*audioBytesPerFrame)
	for index, frame := range frames {
		byteOffset := index * audioBytesPerFrame
		binary.LittleEndian.PutUint16(pcm[byteOffset:byteOffset+2], uint16(frame[0]))
		binary.LittleEndian.PutUint16(pcm[byteOffset+2:byteOffset+4], uint16(frame[1]))
	}
	return pcm
}

func TestVisualizationFrameReturnsStereoWindow(t *testing.T) {
	backend := NewAudioBackend()
	backend.streamSegments = []audioTrackSegment{{
		SourcePath: "track.flac",
		PCMData: encodeStereoPCM([][2]int16{
			{1000, -1000},
			{2000, -2000},
			{3000, -3000},
			{4000, -4000},
		}),
	}}
	backend.streamReadOffset = int64(len(backend.streamSegments[0].PCMData))
	backend.playbackBaseBytes = backend.streamReadOffset

	frame := backend.VisualizationFrame(4)
	if !frame.Loaded {
		t.Fatal("expected visualization frame to be loaded")
	}
	if frame.SourcePath != "track.flac" {
		t.Fatalf("visualization frame sourcePath = %q, want %q", frame.SourcePath, "track.flac")
	}
	if frame.FrameCount != 4 {
		t.Fatalf("visualization frame count = %d, want %d", frame.FrameCount, 4)
	}
	if got, want := len(frame.Samples), 8; got != want {
		t.Fatalf("visualization sample len = %d, want %d", got, want)
	}
	if frame.Samples[0] != 1000 || frame.Samples[1] != -1000 {
		t.Fatalf("unexpected first stereo sample pair = [%d %d]", frame.Samples[0], frame.Samples[1])
	}
	if frame.Samples[6] != 4000 || frame.Samples[7] != -4000 {
		t.Fatalf("unexpected last stereo sample pair = [%d %d]", frame.Samples[6], frame.Samples[7])
	}
	if frame.Peak <= 0.12 || frame.Peak > 0.13 {
		t.Fatalf("visualization peak = %.4f, want approx 0.1221", frame.Peak)
	}
}
