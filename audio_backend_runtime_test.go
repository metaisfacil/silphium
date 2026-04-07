package main

import (
	"errors"
	"io"
	"math"
	"path/filepath"
	"testing"
	"time"

	"github.com/metaisfacil/oto/v3"
)

func TestOTOAdapters(t *testing.T) {
	if emptyPlayer := (&otoPlayerAdapter{}); emptyPlayer.Err() != nil {
		t.Fatalf("otoPlayerAdapter.Err(nil) = %v, want nil", emptyPlayer.Err())
	}
	if got, err := (&otoPlayerAdapter{}).Seek(4, io.SeekCurrent); err != nil || got != 4 {
		t.Fatalf("otoPlayerAdapter.Seek(nil) = (%d, %v), want (4, nil)", got, err)
	}
	if emptyContext := (&otoContextAdapter{}); emptyContext.NewPlayer(nil) != nil || emptyContext.Err() != nil {
		t.Fatalf("otoContextAdapter(nil funcs) = player:%#v err:%v, want nils", emptyContext.NewPlayer(nil), emptyContext.Err())
	} else if err := emptyContext.Close(); err != nil {
		t.Fatalf("otoContextAdapter.Close(nil) = %v, want nil", err)
	}

	playerPlayed := false
	playerPaused := false
	playerVolume := 0.0
	playerSeekCalls := 0
	playerErr := errors.New("player failed")
	playerAdapter := &otoPlayerAdapter{
		setVolume: func(volume float64) { playerVolume = volume },
		play:      func() { playerPlayed = true },
		pause:     func() { playerPaused = true },
		err:       func() error { return playerErr },
		seek: func(offset int64, whence int) (int64, error) {
			playerSeekCalls++
			return offset + int64(whence), nil
		},
	}
	playerAdapter.SetVolume(0.5)
	playerAdapter.Play()
	playerAdapter.Pause()
	if got, err := playerAdapter.Seek(4, io.SeekCurrent); err != nil || got != 5 {
		t.Fatalf("otoPlayerAdapter.Seek() = (%d, %v), want (5, nil)", got, err)
	}
	if !playerPlayed || !playerPaused || playerVolume != 0.5 || playerSeekCalls != 1 || !errors.Is(playerAdapter.Err(), playerErr) {
		t.Fatalf("otoPlayerAdapter() state = played:%t paused:%t volume:%.2f seeks:%d err:%v", playerPlayed, playerPaused, playerVolume, playerSeekCalls, playerAdapter.Err())
	}

	contextClosed := false
	contextErr := errors.New("context failed")
	contextAdapter := &otoContextAdapter{
		newPlayer: func(_ io.Reader) audioOutputPlayer { return playerAdapter },
		err:       func() error { return contextErr },
		close: func() error {
			contextClosed = true
			return nil
		},
	}
	if got := contextAdapter.NewPlayer(nil); got != playerAdapter {
		t.Fatalf("otoContextAdapter.NewPlayer() = %#v, want player adapter", got)
	}
	if !errors.Is(contextAdapter.Err(), contextErr) {
		t.Fatalf("otoContextAdapter.Err() = %v, want %v", contextAdapter.Err(), contextErr)
	}
	if err := contextAdapter.Close(); err != nil || !contextClosed {
		t.Fatalf("otoContextAdapter.Close() = (%v, %t), want (nil, true)", err, contextClosed)
	}
}

type fakeAudioPlayer struct {
	volume     float64
	playCalls  int
	pauseCalls int
	seekCalls  int
	seekErr    error
	err        error
}

func (p *fakeAudioPlayer) SetVolume(volume float64) {
	p.volume = volume
}

func (p *fakeAudioPlayer) Play() {
	p.playCalls++
}

func (p *fakeAudioPlayer) Pause() {
	p.pauseCalls++
}

func (p *fakeAudioPlayer) Err() error {
	return p.err
}

func (p *fakeAudioPlayer) Seek(offset int64, _ int) (int64, error) {
	p.seekCalls++
	if p.seekErr != nil {
		return 0, p.seekErr
	}

	return offset, nil
}

type fakeAudioContext struct {
	player   *fakeAudioPlayer
	err      error
	closeErr error
}

func (c *fakeAudioContext) NewPlayer(_ io.Reader) audioOutputPlayer {
	if c.player == nil {
		c.player = &fakeAudioPlayer{}
	}

	return c.player
}

func (c *fakeAudioContext) Err() error {
	return c.err
}

func (c *fakeAudioContext) Close() error {
	return c.closeErr
}

func useFakeAudioContext(t *testing.T, context audioOutputContext, err error) {
	t.Helper()

	originalNewAudioOutputContext := newAudioOutputContext
	newAudioOutputContext = func(_ *oto.NewContextOptions) (audioOutputContext, <-chan struct{}, error) {
		ready := make(chan struct{})
		close(ready)
		return context, ready, err
	}
	t.Cleanup(func() {
		newAudioOutputContext = originalNewAudioOutputContext
	})
}

func TestAudioBackendInitializeCloseAndOutputDevices(t *testing.T) {
	originalListAudioOutputDevices := listAudioOutputDevices
	t.Cleanup(func() {
		listAudioOutputDevices = originalListAudioOutputDevices
	})

	listAudioOutputDevices = func() ([]oto.OutputDevice, error) {
		return nil, errors.New("no devices")
	}
	if devices := NewAudioBackend().ListOutputDevices(); len(devices) != 1 || !devices[0].IsDefault {
		t.Fatalf("ListOutputDevices(fallback) = %#v, want default auto device", devices)
	}

	listAudioOutputDevices = func() ([]oto.OutputDevice, error) {
		return []oto.OutputDevice{{ID: "dev-1", Name: "Speakers", Backend: "wasapi", IsDefault: true}, {ID: "", Name: "skip"}}, nil
	}
	if devices := NewAudioBackend().ListOutputDevices(); len(devices) != 1 || devices[0].Name != "WASAPI: Speakers" {
		t.Fatalf("ListOutputDevices(mapped) = %#v, want mapped output device", devices)
	}

	helperPath := copyCurrentTestBinary(t, t.TempDir(), "ffmpeg.exe")
	if err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing.exe")}).Initialize(); err == nil {
		t.Fatal("Initialize(missing ffmpeg) error = nil, want error")
	}

	fakeContext := &fakeAudioContext{}
	useFakeAudioContext(t, fakeContext, nil)
	backend := NewAudioBackend()
	backend.ffmpegPath = helperPath
	if err := backend.Initialize(); err != nil {
		t.Fatalf("Initialize(success) error = %v", err)
	}
	if backend.context == nil || backend.player == nil {
		t.Fatal("Initialize(success) should populate the audio context and player")
	}

	backendWithExistingContext := NewAudioBackend()
	backendWithExistingContext.ffmpegPath = helperPath
	backendWithExistingContext.context = fakeContext
	if err := backendWithExistingContext.Initialize(); err != nil {
		t.Fatalf("Initialize(existing context) error = %v", err)
	}
	if backendWithExistingContext.player == nil {
		t.Fatal("Initialize(existing context) should attach a player when one is missing")
	}

	failingContext := &fakeAudioContext{err: errors.New("context failed")}
	useFakeAudioContext(t, failingContext, nil)
	backendWithFailingContext := NewAudioBackend()
	backendWithFailingContext.ffmpegPath = helperPath
	if err := backendWithFailingContext.Initialize(); err == nil {
		t.Fatal("Initialize(context failure) error = nil, want error")
	}

	if err := NewAudioBackend().Close(); err != nil {
		t.Fatalf("Close(nil context) error = %v, want nil", err)
	}
	backendToClose := NewAudioBackend()
	backendToClose.context = &fakeAudioContext{}
	backendToClose.player = &fakeAudioPlayer{}
	if err := backendToClose.Close(); err != nil {
		t.Fatalf("Close(success) error = %v", err)
	}
	backendToClose = NewAudioBackend()
	backendToClose.context = &fakeAudioContext{closeErr: errors.New("close failed")}
	if err := backendToClose.Close(); err == nil {
		t.Fatal("Close(close error) error = nil, want error")
	}
}

func TestAudioBackendTransportAndStateHelpers(t *testing.T) {
	backend := NewAudioBackend()
	backend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: []byte{1, 2, 3, 4}}}

	source := &audioPlayerSource{backend: backend}
	buffer := make([]byte, 4)
	if read, err := source.Read(buffer); err != nil || read != 4 {
		t.Fatalf("audioPlayerSource.Read() = (%d, %v), want (4, nil)", read, err)
	}
	if buffer[0] != 1 || buffer[3] != 4 {
		t.Fatalf("audioPlayerSource.Read() buffer = %#v, want copied PCM data", buffer)
	}

	backend.streamReadOffset = 0
	if offset, err := source.Seek(2, io.SeekStart); err != nil || offset != 2 {
		t.Fatalf("audioPlayerSource.Seek() = (%d, %v), want (2, nil)", offset, err)
	}

	waitingBackend := NewAudioBackend()
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		readBuffer := make([]byte, 4)
		_, _ = waitingBackend.Read(readBuffer)
	}()
	time.Sleep(20 * time.Millisecond)
	waitingBackend.mutex.Lock()
	waitingBackend.streamSegments = []audioTrackSegment{{PCMData: []byte{9, 8, 7, 6}}}
	waitingBackend.streamCond.Broadcast()
	waitingBackend.mutex.Unlock()
	<-readDone

	if read, err := backend.Read(nil); err != nil || read != 0 {
		t.Fatalf("Read(nil buffer) = (%d, %v), want (0, nil)", read, err)
	}
	backend.streamReadOffset = 0
	partialBuffer := make([]byte, 8)
	if read, err := backend.Read(partialBuffer); err != nil || read != 4 {
		t.Fatalf("Read(partial) = (%d, %v), want (4, nil)", read, err)
	}

	fakePlayer := &fakeAudioPlayer{}
	if err := backend.flushPlayerBuffer(nil); err != nil {
		t.Fatalf("flushPlayerBuffer(nil) error = %v, want nil", err)
	}
	fakePlayer.seekErr = errors.New("seek failed")
	if err := backend.flushPlayerBuffer(fakePlayer); err == nil {
		t.Fatal("flushPlayerBuffer(seek error) error = nil, want error")
	}

	transportBackend := NewAudioBackend()
	transportBackend.streamSegments = []audioTrackSegment{{PCMData: make([]byte, 8)}}
	if _, err := transportBackend.seekStream(0, 99); err == nil {
		t.Fatal("seekStream(invalid whence) error = nil, want error")
	}
	if _, err := transportBackend.seekStream(-1, io.SeekStart); err == nil {
		t.Fatal("seekStream(negative) error = nil, want error")
	}
	if offset, err := transportBackend.seekStream(99, io.SeekStart); err != nil || offset != 8 {
		t.Fatalf("seekStream(clamp) = (%d, %v), want (8, nil)", offset, err)
	}
	transportBackend.streamReadOffset = 2
	if offset, err := transportBackend.seekStream(2, io.SeekCurrent); err != nil || offset != 4 {
		t.Fatalf("seekStream(current) = (%d, %v), want (4, nil)", offset, err)
	}
	if offset, err := transportBackend.seekStream(-2, io.SeekEnd); err != nil || offset != 6 {
		t.Fatalf("seekStream(end) = (%d, %v), want (6, nil)", offset, err)
	}

	if got := normalizeReplayGainScale(math.NaN()); got != 1 {
		t.Fatalf("normalizeReplayGainScale(NaN) = %.2f, want 1", got)
	}
	transportBackend.volume = -1
	if got := transportBackend.effectivePlayerVolumeLocked(); got != 0 {
		t.Fatalf("effectivePlayerVolumeLocked(negative volume) = %.2f, want 0", got)
	}

	seekBackend := NewAudioBackend()
	if err := seekBackend.seekLocked(1); err == nil {
		t.Fatal("seekLocked(no track) error = nil, want error")
	}
	seekBackend.streamSegments = []audioTrackSegment{
		{SourcePath: "first.flac", PCMData: make([]byte, audioBytesPerSecond)},
		{SourcePath: "second.flac", PCMData: make([]byte, 2*audioBytesPerSecond)},
	}
	seekBackend.streamReadOffset = int64(audioBytesPerSecond + audioBytesPerSecond/2)
	seekBackend.playbackBaseBytes = seekBackend.streamReadOffset
	if err := seekBackend.seekLocked(0.5); err != nil {
		t.Fatalf("seekLocked(success) error = %v", err)
	}
	if got, want := len(seekBackend.streamSegments), 1; got != want {
		t.Fatalf("seekLocked() segment len = %d, want %d", got, want)
	}
	if seekBackend.streamSegments[0].SourcePath != "second.flac" {
		t.Fatalf("seekLocked() active segment = %q, want %q", seekBackend.streamSegments[0].SourcePath, "second.flac")
	}

	if _, _, ok := seekBackend.segmentForByteOffsetLocked(-1); !ok {
		t.Fatal("segmentForByteOffsetLocked(negative offset) = false, want true")
	}
	if _, _, ok := seekBackend.segmentForByteOffsetLocked(99_999_999); ok {
		t.Fatal("segmentForByteOffsetLocked(out of range) = true, want false")
	}

	seekBackend.resetTimelineLocked()
	if seekBackend.streamReadOffset != 0 || seekBackend.playbackBaseBytes != 0 {
		t.Fatalf("resetTimelineLocked() = read:%d base:%d, want zeroed offsets", seekBackend.streamReadOffset, seekBackend.playbackBaseBytes)
	}

	syncBackend := NewAudioBackend()
	syncBackend.syncPlaybackLocked()
	if syncBackend.playing {
		t.Fatal("syncPlaybackLocked(empty timeline) should clear playing state")
	}
	syncBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: []byte{1, 2, 3, 4}}}
	syncBackend.streamReadOffset = 4
	syncBackend.playbackBaseBytes = 4
	syncBackend.playing = true
	syncBackend.syncPlaybackLocked()
	if syncBackend.endEventID == 0 {
		t.Fatal("syncPlaybackLocked(ended) should increment the end event id")
	}

	state := syncBackend.snapshotLocked()
	if !state.Loaded {
		t.Fatal("snapshotLocked() should remain loaded when segments exist")
	}

	syncBackend.unloadTrackLocked()
	if len(syncBackend.streamSegments) != 0 || syncBackend.playing {
		t.Fatal("unloadTrackLocked() should clear all track state")
	}
}

func TestAudioBackendStateHelperEdgeCases(t *testing.T) {
	tempDir := t.TempDir()
	trackPath := filepath.Join(tempDir, "track.flac")
	writeTestFile(t, trackPath, "track")

	volumeBackend := NewAudioBackend()
	volumeBackend.volume = math.Inf(1)
	if got := volumeBackend.effectivePlayerVolumeLocked(); got != 0 {
		t.Fatalf("effectivePlayerVolumeLocked(inf) = %.2f, want 0", got)
	}
	volumeBackend.volume = 0.75
	if got := volumeBackend.effectivePlayerVolumeLocked(); got != 0.75 {
		t.Fatalf("effectivePlayerVolumeLocked(no segments) = %.2f, want 0.75", got)
	}

	signature, ok := trackTagsFileSignatureForPath(trackPath)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", trackPath)
	}
	volumeBackend.streamSegments = []audioTrackSegment{{SourcePath: trackPath, PCMData: make([]byte, audioBytesPerSecond), ReplayGainScale: 1}}
	volumeBackend.replayGainEnabled = true
	volumeBackend.putReplayGainCache(trackPath, signature, ReplayGainInfo{GainDB: -6, Peak: 0.5}, true)
	if got := volumeBackend.effectivePlayerVolumeLocked(); math.Abs(got-ReplayGainInfo{GainDB: -6, Peak: 0.5}.Scale()*0.75) > 0.000001 {
		t.Fatalf("effectivePlayerVolumeLocked(cache-derived replaygain) = %.6f, want %.6f", got, ReplayGainInfo{GainDB: -6, Peak: 0.5}.Scale()*0.75)
	}

	trimBackend := NewAudioBackend()
	trimBackend.streamSegments = []audioTrackSegment{{PCMData: nil}, {SourcePath: "next.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	trimBackend.trimConsumedSegmentsLocked(0)
	if got, want := len(trimBackend.streamSegments), 1; got != want {
		t.Fatalf("trimConsumedSegmentsLocked(zero-length) len = %d, want %d", got, want)
	}

	trimBackend = NewAudioBackend()
	trimBackend.streamSegments = []audioTrackSegment{{SourcePath: "first.flac", PCMData: make([]byte, audioBytesPerSecond)}, {SourcePath: "second.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	trimBackend.streamReadOffset = int64(audioBytesPerSecond + audioBytesPerFrame)
	trimBackend.trimConsumedSegmentsLocked(int64(audioBytesPerSecond + audioBytesPerFrame))
	if got, want := trimBackend.streamDroppedBytes, int64(audioBytesPerSecond); got != want {
		t.Fatalf("trimConsumedSegmentsLocked(dropped bytes) = %d, want %d", got, want)
	}
	if got, want := trimBackend.streamReadOffset, int64(audioBytesPerFrame); got != want {
		t.Fatalf("trimConsumedSegmentsLocked(read offset) = %d, want %d", got, want)
	}
	if trimBackend.streamSegments[0].SourcePath != "second.flac" {
		t.Fatalf("trimConsumedSegmentsLocked(active path) = %q, want %q", trimBackend.streamSegments[0].SourcePath, "second.flac")
	}

	snapshotBackend := NewAudioBackend()
	snapshotBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	snapshotBackend.streamReadOffset = int64(2 * audioBytesPerSecond)
	snapshotBackend.playbackBaseBytes = snapshotBackend.streamReadOffset
	state := snapshotBackend.snapshotLocked()
	if state.CurrentTime != state.Duration || state.Duration != 1 {
		t.Fatalf("snapshotLocked(clamped) = %#v, want clamped currentTime=duration=1", state)
	}
}

func TestAudioBackendBoundaryStateHelpers(t *testing.T) {
	emptyBackend := NewAudioBackend()
	emptyState := emptyBackend.snapshotLocked()
	if emptyState.Loaded || emptyState.Playing || emptyState.SourcePath != "" || emptyState.Duration != 0 {
		t.Fatalf("snapshotLocked(empty) = %#v, want unloaded zero-value snapshot", emptyState)
	}
	if _, _, ok := emptyBackend.segmentForByteOffsetLocked(0); ok {
		t.Fatal("segmentForByteOffsetLocked(empty) = true, want false")
	}
	if _, _, ok := emptyBackend.activeSegmentLocked(); ok {
		t.Fatal("activeSegmentLocked(empty) = true, want false")
	}

	clampedBackend := NewAudioBackend()
	clampedBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	clampedBackend.streamReadOffset = int64(3 * audioBytesPerSecond)
	clampedBackend.playbackBaseBytes = clampedBackend.streamReadOffset
	if got, want := clampedBackend.currentPlayedLocalBytesLocked(), int64(audioBytesPerSecond); got != want {
		t.Fatalf("currentPlayedLocalBytesLocked(clamped) = %d, want %d", got, want)
	}
}

func TestAudioBackendSeekNormalizationAndByteAccounting(t *testing.T) {
	seekBackend := NewAudioBackend()
	seekBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	seekBackend.streamReadOffset = int64(audioBytesPerSecond / 2)
	seekBackend.playbackBaseBytes = seekBackend.streamReadOffset
	seekBackend.endEventSent = true

	if err := seekBackend.seekLocked(math.NaN()); err != nil {
		t.Fatalf("seekLocked(NaN) error = %v", err)
	}
	if seekBackend.streamReadOffset != 0 || seekBackend.playbackBaseBytes != 0 {
		t.Fatalf("seekLocked(NaN) offsets = read:%d base:%d, want 0/0", seekBackend.streamReadOffset, seekBackend.playbackBaseBytes)
	}
	if !seekBackend.playStarted.IsZero() {
		t.Fatal("seekLocked(NaN) should leave playStarted zero while paused")
	}
	if seekBackend.endEventSent {
		t.Fatal("seekLocked(NaN) should clear the end-event flag")
	}

	seekBackend.playing = true
	if err := seekBackend.seekLocked(-5); err != nil {
		t.Fatalf("seekLocked(negative) error = %v", err)
	}
	if seekBackend.streamReadOffset != 0 || seekBackend.playbackBaseBytes != 0 {
		t.Fatalf("seekLocked(negative) offsets = read:%d base:%d, want 0/0", seekBackend.streamReadOffset, seekBackend.playbackBaseBytes)
	}
	if seekBackend.playStarted.IsZero() {
		t.Fatal("seekLocked(negative) should restart playStarted while playing")
	}
	playingState := seekBackend.snapshotLocked()
	if !playingState.Loaded || !playingState.Playing || playingState.CurrentTime != 0 || playingState.Duration != 1 {
		t.Fatalf("snapshotLocked(after seek to start) = %#v, want loaded playing state at the beginning", playingState)
	}

	if err := seekBackend.seekLocked(99); err != nil {
		t.Fatalf("seekLocked(clamp to end) error = %v", err)
	}
	if got, want := seekBackend.streamReadOffset, int64(audioBytesPerSecond); got != want {
		t.Fatalf("seekLocked(clamp to end) readOffset = %d, want %d", got, want)
	}
	endedState := seekBackend.snapshotLocked()
	if !endedState.Loaded || endedState.Playing || endedState.CurrentTime != endedState.Duration || endedState.SourcePath != "track.flac" {
		t.Fatalf("snapshotLocked(after seek to end) = %#v, want loaded non-playing end-of-track state", endedState)
	}

	accountingBackend := NewAudioBackend()
	accountingBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	accountingBackend.playbackBaseBytes = -int64(audioBytesPerSecond)
	if got := accountingBackend.currentPlayedGlobalBytesLocked(); got != 0 {
		t.Fatalf("currentPlayedGlobalBytesLocked(negative base) = %d, want 0", got)
	}

	accountingBackend.playbackBaseBytes = int64(2 * audioBytesPerSecond)
	accountingBackend.streamReadOffset = int64(audioBytesPerSecond / 4)
	if got, want := accountingBackend.currentPlayedGlobalBytesLocked(), accountingBackend.streamReadOffset; got != want {
		t.Fatalf("currentPlayedGlobalBytesLocked(max readable clamp) = %d, want %d", got, want)
	}

	accountingBackend.streamDroppedBytes = int64(audioBytesPerSecond / 2)
	accountingBackend.playbackBaseBytes = 0
	accountingBackend.streamReadOffset = 0
	if got := accountingBackend.currentPlayedLocalBytesLocked(); got != 0 {
		t.Fatalf("currentPlayedLocalBytesLocked(negative local) = %d, want 0", got)
	}

	accountingBackend.streamDroppedBytes = 0
	accountingBackend.streamSegments = []audioTrackSegment{
		{SourcePath: "first.flac", PCMData: make([]byte, audioBytesPerSecond)},
		{SourcePath: "second.flac", PCMData: make([]byte, audioBytesPerSecond)},
	}
	segmentIndex, segmentOffset, ok := accountingBackend.segmentForByteOffsetLocked(int64(audioBytesPerSecond + audioBytesPerFrame))
	if !ok || segmentIndex != 1 || segmentOffset != int64(audioBytesPerFrame) {
		t.Fatalf("segmentForByteOffsetLocked(second segment) = (%d, %d, %t), want (1, %d, true)", segmentIndex, segmentOffset, ok, audioBytesPerFrame)
	}
}
