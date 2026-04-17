package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"testing"
	"time"
)

func TestAudioBackendPlaybackMethods(t *testing.T) {
	helperPath := copyCurrentTestBinary(t, t.TempDir(), "ffmpeg.exe")
	pcmBytes := make([]byte, audioBytesPerFrame*4)
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")

	fakeContext := &fakeAudioContext{}
	useFakeAudioContext(t, fakeContext, nil)
	backend := NewAudioBackend()
	backend.ffmpegPath = helperPath

	preparedSegment, err := backend.prepareTrackSegment("track.flac", nil)
	if err != nil || len(preparedSegment.PCMData) != len(pcmBytes) {
		t.Fatalf("prepareTrackSegment() = (%#v, %v), want decoded PCM segment", preparedSegment, err)
	}

	state, err := backend.LoadTrack("track.flac")
	if err != nil || !state.Loaded {
		t.Fatalf("LoadTrack() = (%#v, %v), want loaded state", state, err)
	}
	if got := backend.State(); !got.Loaded {
		t.Fatalf("State() = %#v, want loaded snapshot", got)
	}
	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).LoadTrack("track.flac"); err == nil {
		t.Fatal("LoadTrack(initialize error) error = nil, want error")
	}

	if _, err := (&AudioBackend{ffmpegPath: helperPath}).Play(); err == nil {
		t.Fatal("Play(no track) error = nil, want error")
	}
	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).Play(); err == nil {
		t.Fatal("Play(initialize error) error = nil, want error")
	}
	if _, err := (&AudioBackend{ffmpegPath: helperPath}).Pause(); err == nil {
		t.Fatal("Pause(no track) error = nil, want error")
	}
	if playState, err := backend.Play(); err != nil || !playState.Playing || fakeContext.player.playCalls == 0 {
		t.Fatalf("Play() = (%#v, %v), want playing state and play call", playState, err)
	}

	if pauseState, err := backend.Pause(); err != nil || pauseState.Playing || fakeContext.player.pauseCalls == 0 {
		t.Fatalf("Pause() = (%#v, %v), want paused state and pause call", pauseState, err)
	}

	if _, err := (&AudioBackend{ffmpegPath: helperPath}).Seek(1); err == nil {
		t.Fatal("Seek(no track) error = nil, want error")
	}
	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).Seek(1); err == nil {
		t.Fatal("Seek(initialize error) error = nil, want error")
	}
	if seekState, err := backend.Seek(0.001); err != nil || !seekState.Loaded || fakeContext.player.seekCalls == 0 {
		t.Fatalf("Seek() = (%#v, %v), want loaded state and flush seek call", seekState, err)
	}

	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).SetVolume(0.5); err == nil {
		t.Fatal("SetVolume(initialize error) error = nil, want error")
	}
	if volumeState, err := backend.SetVolume(math.NaN()); err != nil || volumeState.Volume != 0.8 {
		t.Fatalf("SetVolume(NaN) = (%#v, %v), want unchanged default volume", volumeState, err)
	}
	if volumeState, err := backend.SetVolume(-1); err != nil || volumeState.Volume != 0 {
		t.Fatalf("SetVolume(-1) = (%#v, %v), want clamped volume of 0", volumeState, err)
	}
	if volumeState, err := backend.SetVolume(math.Inf(1)); err != nil || volumeState.Volume != 0 {
		t.Fatalf("SetVolume(+Inf) = (%#v, %v), want unchanged clamped volume of 0", volumeState, err)
	}
	if volumeState, err := backend.SetVolume(2); err != nil || volumeState.Volume != 1 {
		t.Fatalf("SetVolume(2) = (%#v, %v), want clamped volume of 1", volumeState, err)
	}

	loadFlushErrorContext := &fakeAudioContext{}
	useFakeAudioContext(t, loadFlushErrorContext, nil)
	loadFlushErrorBackend := NewAudioBackend()
	loadFlushErrorBackend.ffmpegPath = helperPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	loadFlushErrorContext.player = &fakeAudioPlayer{seekErr: errors.New("flush failed")}
	if _, err := loadFlushErrorBackend.LoadTrack("track.flac"); err == nil {
		t.Fatal("LoadTrack(flush error) error = nil, want error")
	}

	stopState, err := backend.Stop()
	if err != nil || stopState.Loaded {
		t.Fatalf("Stop() = (%#v, %v), want unloaded state", stopState, err)
	}
	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).Stop(); err == nil {
		t.Fatal("Stop(initialize error) error = nil, want error")
	}

	queueBackend := NewAudioBackend()
	queueBackend.ffmpegPath = helperPath
	useFakeAudioContext(t, &fakeAudioContext{}, nil)
	queueBackend.ApplyAudioSettings(AudioSettings{GaplessPlayback: true})
	if _, err := queueBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(queue backend) error = %v", err)
	}
	if queueState, err := queueBackend.QueueNextTrack("track.flac", "next.flac"); err != nil || !queueState.Loaded {
		t.Fatalf("QueueNextTrack() = (%#v, %v), want loaded state while queue prepares asynchronously", queueState, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		queueBackend.mutex.Lock()
		queuedSegmentCount := len(queueBackend.streamSegments)
		queueBackend.mutex.Unlock()
		if queuedSegmentCount == 2 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	queueBackend.mutex.Lock()
	queuedSegmentCount := len(queueBackend.streamSegments)
	queueBackend.mutex.Unlock()
	if queuedSegmentCount != 2 {
		t.Fatalf("QueueNextTrack() queued segment count = %d, want 2 after async preparation", queuedSegmentCount)
	}
	if queueState, err := queueBackend.QueueNextTrack("other.flac", "next.flac"); err != nil || !queueState.Loaded {
		t.Fatalf("QueueNextTrack(mismatched afterPath) = (%#v, %v), want unchanged snapshot", queueState, err)
	}
	if queueState, err := queueBackend.QueueNextTrack("track.flac", ""); err != nil || len(queueBackend.streamSegments) != 1 || !queueState.Loaded {
		t.Fatalf("QueueNextTrack(clear) = (%#v, %v), want cleared future queue", queueState, err)
	}
	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).QueueNextTrack("track.flac", "next.flac"); err == nil {
		t.Fatal("QueueNextTrack(initialize error) error = nil, want error")
	}
	if _, err := (&AudioBackend{ffmpegPath: helperPath}).QueueNextTrack("track.flac", "next.flac"); err == nil {
		t.Fatal("QueueNextTrack(no track loaded) error = nil, want error")
	}
	if queueState, err := (&AudioBackend{ffmpegPath: helperPath}).QueueNextTrack("", ""); err != nil || queueState.Loaded {
		t.Fatalf("QueueNextTrack(clear no active track) = (%#v, %v), want unloaded snapshot", queueState, err)
	}
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	if queueState, err := queueBackend.QueueNextTrack("track.flac", "broken.flac"); err != nil || !queueState.Loaded {
		t.Fatalf("QueueNextTrack(async prepare error) = (%#v, %v), want loaded state and async failure logging", queueState, err)
	}
	deadline = time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		queueBackend.mutex.Lock()
		queuedSegmentCount = len(queueBackend.streamSegments)
		queueBackend.mutex.Unlock()
		if queuedSegmentCount == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	queueBackend.mutex.Lock()
	queuedSegmentCount = len(queueBackend.streamSegments)
	queueBackend.mutex.Unlock()
	if queuedSegmentCount != 1 {
		t.Fatalf("QueueNextTrack(async prepare error) queued segment count = %d, want 1 after failed async preparation", queuedSegmentCount)
	}
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")

	dynamicRangeBackend := NewAudioBackend()
	dynamicRangeBackend.ffmpegPath = helperPath
	useFakeAudioContext(t, &fakeAudioContext{}, nil)
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "LRA: 12.0 LU")
	if dynamicRange, err := dynamicRangeBackend.ReplayGainReleaseDynamicRange([]string{"one.flac", "two.flac"}); err != nil || dynamicRange != 12 {
		t.Fatalf("ReplayGainReleaseDynamicRange() = (%d, %v), want (12, nil)", dynamicRange, err)
	}
	if dynamicRange, err := dynamicRangeBackend.ReplayGainReleaseDynamicRange([]string{"one.flac"}); err != nil || dynamicRange != 0 {
		t.Fatalf("ReplayGainReleaseDynamicRange(single track) = (%d, %v), want (0, nil)", dynamicRange, err)
	}
	if _, err := (&AudioBackend{ffmpegPath: filepath.Join(t.TempDir(), "missing-ffmpeg.exe")}).ReplayGainReleaseDynamicRange([]string{"one.flac", "two.flac"}); err == nil {
		t.Fatal("ReplayGainReleaseDynamicRange(initialize error) error = nil, want error")
	}

	errorContext := &fakeAudioContext{player: &fakeAudioPlayer{err: errors.New("playback failed")}}
	useFakeAudioContext(t, errorContext, nil)
	errorBackend := NewAudioBackend()
	errorBackend.ffmpegPath = helperPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	if _, err := errorBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(error backend) error = %v", err)
	}
	if _, err := errorBackend.Play(); err == nil {
		t.Fatal("Play(player error) error = nil, want error")
	}

	seekErrorContext := &fakeAudioContext{}
	useFakeAudioContext(t, seekErrorContext, nil)
	seekErrorBackend := NewAudioBackend()
	seekErrorBackend.ffmpegPath = helperPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	if _, err := seekErrorBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(seek error backend) error = %v", err)
	}
	seekErrorContext.player.seekErr = errors.New("seek failed")
	if _, err := seekErrorBackend.Seek(0.001); err == nil {
		t.Fatal("Seek(flush error) error = nil, want error")
	}

	resumeErrorContext := &fakeAudioContext{}
	useFakeAudioContext(t, resumeErrorContext, nil)
	resumeErrorBackend := NewAudioBackend()
	resumeErrorBackend.ffmpegPath = helperPath
	if _, err := resumeErrorBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(resume error backend) error = %v", err)
	}
	if _, err := resumeErrorBackend.Play(); err != nil {
		t.Fatalf("Play(resume error setup) error = %v", err)
	}
	resumeErrorContext.player.err = errors.New("resume failed")
	if _, err := resumeErrorBackend.Seek(0.001); err == nil {
		t.Fatal("Seek(resume error) error = nil, want error")
	}

	resetFlushErrorContext := &fakeAudioContext{}
	useFakeAudioContext(t, resetFlushErrorContext, nil)
	resetFlushErrorBackend := NewAudioBackend()
	resetFlushErrorBackend.ffmpegPath = helperPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	if _, err := resetFlushErrorBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(reset flush error backend) error = %v", err)
	}
	resetFlushErrorBackend.streamReadOffset = int64(len(resetFlushErrorBackend.streamSegments[0].PCMData))
	resetFlushErrorBackend.playbackBaseBytes = resetFlushErrorBackend.streamReadOffset
	resetFlushErrorContext.player.seekErr = errors.New("flush failed")
	if _, err := resetFlushErrorBackend.Play(); err == nil {
		t.Fatal("Play(reset flush error) error = nil, want error")
	}

	stopFlushErrorContext := &fakeAudioContext{}
	useFakeAudioContext(t, stopFlushErrorContext, nil)
	stopFlushErrorBackend := NewAudioBackend()
	stopFlushErrorBackend.ffmpegPath = helperPath
	if _, err := stopFlushErrorBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(stop flush error backend) error = %v", err)
	}
	stopFlushErrorContext.player.seekErr = errors.New("flush failed")
	if _, err := stopFlushErrorBackend.Stop(); err == nil {
		t.Fatal("Stop(flush error) error = nil, want error")
	}
}

func TestAudioBackendPlayResetAndReinitializeBranches(t *testing.T) {
	helperPath := copyCurrentTestBinary(t, t.TempDir(), "ffmpeg.exe")
	pcmBytes := make([]byte, audioBytesPerFrame*4)
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT_BASE64", base64.StdEncoding.EncodeToString(pcmBytes))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")

	resetContext := &fakeAudioContext{}
	useFakeAudioContext(t, resetContext, nil)
	resetBackend := NewAudioBackend()
	resetBackend.ffmpegPath = helperPath
	if _, err := resetBackend.LoadTrack("track.flac"); err != nil {
		t.Fatalf("LoadTrack(reset backend) error = %v", err)
	}
	resetBackend.streamReadOffset = int64(len(resetBackend.streamSegments[0].PCMData))
	resetBackend.playbackBaseBytes = resetBackend.streamReadOffset
	playState, err := resetBackend.Play()
	if err != nil || !playState.Playing {
		t.Fatalf("Play(reset timeline) = (%#v, %v), want playing state", playState, err)
	}
	if resetContext.player.seekCalls == 0 {
		t.Fatal("Play(reset timeline) should flush the player buffer before resuming playback")
	}
	if resetBackend.streamReadOffset != 0 || resetBackend.playbackBaseBytes != 0 {
		t.Fatalf("Play(reset timeline) offsets = read:%d base:%d, want zeroed timeline", resetBackend.streamReadOffset, resetBackend.playbackBaseBytes)
	}

	brokenReinitializeBackend := NewAudioBackend()
	brokenReinitializeBackend.ffmpegPath = filepath.Join(t.TempDir(), "missing-ffmpeg.exe")
	brokenReinitializeBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	if err := brokenReinitializeBackend.Reinitialize(); err == nil {
		t.Fatal("Reinitialize(initialize error) error = nil, want error")
	}

	resumeErrorContext := &fakeAudioContext{player: &fakeAudioPlayer{err: errors.New("resume failed")}}
	useFakeAudioContext(t, resumeErrorContext, nil)
	resumeErrorBackend := NewAudioBackend()
	resumeErrorBackend.ffmpegPath = helperPath
	resumeErrorBackend.volume = 0.4
	resumeErrorBackend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerSecond)}}
	resumeErrorBackend.playing = true
	if err := resumeErrorBackend.Reinitialize(); err == nil {
		t.Fatal("Reinitialize(playback resume error) error = nil, want error")
	}
	if resumeErrorBackend.playing {
		t.Fatal("Reinitialize(playback resume error) should clear the playing state")
	}
}

func TestRemoteStreamReadyLockedPredictsRequiredBuffer(t *testing.T) {
	backend := NewAudioBackend()
	backend.streamSegments = []audioTrackSegment{{
		SourcePath:       "silphium-remote://friend/track.flac",
		PCMData:          make([]byte, audioBytesPerSecond),
		ExpectedPCMBytes: int64(4 * audioBytesPerSecond),
	}}
	backend.streamDecodeExpectedBytes = int64(4 * audioBytesPerSecond)
	backend.streamDecodeStartedAt = time.Now().Add(-1500 * time.Millisecond)

	if backend.remoteStreamReadyLocked() {
		t.Fatal("remoteStreamReadyLocked() = true, want false when buffered data would still underrun")
	}

	backend.streamDecodeStartedAt = time.Now().Add(-200 * time.Millisecond)
	if !backend.remoteStreamReadyLocked() {
		t.Fatal("remoteStreamReadyLocked() = false, want true when current decode rate comfortably exceeds playback")
	}

	backend.streamDecodeDone = true
	if !backend.remoteStreamReadyLocked() {
		t.Fatal("remoteStreamReadyLocked(done) = false, want true once decode is complete")
	}
}

func TestLoadTrackFromDecodeSourceStreamsRemoteBeforeComplete(t *testing.T) {
	helperPath := copyCurrentTestBinary(t, t.TempDir(), "ffmpeg.exe")
	fakeContext := &fakeAudioContext{}
	useFakeAudioContext(t, fakeContext, nil)

	backend := NewAudioBackend()
	backend.ffmpegPath = helperPath
	t.Cleanup(func() {
		backend.mutex.Lock()
		backend.unloadTrackLocked()
		backend.mutex.Unlock()
	})

	t.Setenv("SILPHIUM_TEST_FFMPEG_STREAM_CHUNK_BYTES", fmt.Sprintf("%d;%d;%d;%d", audioBytesPerSecond, audioBytesPerSecond, audioBytesPerSecond, audioBytesPerSecond))
	t.Setenv("SILPHIUM_TEST_FFMPEG_STREAM_CHUNK_DELAY_MS", "160")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STREAM_BYTE", "7")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")

	state, err := backend.loadTrackFromDecodeSource(
		"silphium-remote://friend:41637/Library/Artist/Album/01 Remote.flac",
		"https://example.invalid/remote.flac",
		nil,
		nil,
		audioDecodeHints{ExpectedDurationSeconds: 4, Progressive: true},
	)
	if err != nil {
		t.Fatalf("loadTrackFromDecodeSource(progressive remote) error = %v", err)
	}
	if !state.Loaded || state.Duration != 4 {
		t.Fatalf("loadTrackFromDecodeSource(progressive remote) = %#v, want loaded 4s track", state)
	}

	backend.mutex.Lock()
	bufferedBytes := len(backend.streamSegments[0].PCMData)
	decodeDoneAtReturn := backend.streamDecodeDone
	backend.mutex.Unlock()
	if bufferedBytes >= 4*audioBytesPerSecond {
		t.Fatalf("loadTrackFromDecodeSource(progressive remote) buffered bytes = %d, want partial buffer before full decode completes", bufferedBytes)
	}
	if decodeDoneAtReturn {
		t.Fatalf("loadTrackFromDecodeSource(progressive remote) returned after decode completed; buffered bytes = %d", bufferedBytes)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		backend.mutex.Lock()
		decodeDone := backend.streamDecodeDone
		decodedBytes := len(backend.streamSegments[0].PCMData)
		backend.mutex.Unlock()
		if decodeDone {
			if decodedBytes != 4*audioBytesPerSecond {
				t.Fatalf("progressive decode bytes = %d, want %d", decodedBytes, 4*audioBytesPerSecond)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("progressive remote decode did not finish before timeout")
}
