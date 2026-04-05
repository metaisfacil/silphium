package main

import "testing"

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
