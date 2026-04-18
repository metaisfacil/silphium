package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"
)

func (b *AudioBackend) prepareTrackSegment(path string, replayGainReleasePaths []string) (audioTrackSegment, error) {
	return b.prepareTrackSegmentForSource(path, path, nil, replayGainReleasePaths, audioDecodeHints{})
}

func (b *AudioBackend) prepareTrackSegmentForSource(displayPath string, decodePath string, preloadedTags map[string][]string, replayGainReleasePaths []string, decodeHints audioDecodeHints) (audioTrackSegment, error) {
	b.mutex.Lock()
	gaplessPlayback := b.gaplessPlayback
	replayGainEnabled := b.replayGainEnabled
	b.mutex.Unlock()

	tags := preloadedTags
	if gaplessPlayback && tags == nil {
		loadedTags, err := readTaglibTags(displayPath)
		if err == nil {
			tags = loadedTags
		}
	}

	trimInfo := gaplessTrimInfo{}

	replayGainInfo := ReplayGainInfo{}
	if replayGainEnabled {
		replayGainInfo = b.resolveReplayGainInfo(decodePath, tags, replayGainReleasePaths)
	}

	decodedPCM, err := b.decodeTrack(decodePath, replayGainInfo.Scale())
	if err != nil {
		return audioTrackSegment{}, err
	}

	if gaplessPlayback {
		trimInfo = readGaplessTrimInfoFromTags(tags)
		decodedPCM = trimPCMForGapless(decodedPCM, trimInfo)
		if trimInfo.LeadSamples > 0 || trimInfo.TailSamples > 0 {
			logAudioEvent("prepareTrackSegment path=%q leadSamples=%d tailSamples=%d trimmedBytes=%d", displayPath, trimInfo.LeadSamples, trimInfo.TailSamples, len(decodedPCM))
		}
	}

	if replayGainEnabled && replayGainInfo.Source != "" {
		logAudioEvent(
			"prepareTrackSegment replaygain path=%q source=%s gain=%.2fdB peak=%.6f scale=%.6f",
			displayPath,
			replayGainInfo.Source,
			replayGainInfo.GainDB,
			replayGainInfo.Peak,
			replayGainInfo.Scale(),
		)
	}

	expectedPCMBytes := expectedPCMBytesFromDurationSeconds(decodeHints.ExpectedDurationSeconds)
	if expectedPCMBytes > 0 && gaplessPlayback {
		trimmedBytes := (trimInfo.LeadSamples + trimInfo.TailSamples) * int64(audioBytesPerFrame)
		if trimmedBytes > 0 && expectedPCMBytes > trimmedBytes {
			expectedPCMBytes -= trimmedBytes
		}
	}

	return audioTrackSegment{
		SourcePath:       displayPath,
		PCMData:          decodedPCM,
		ReplayGainScale:  replayGainInfo.Scale(),
		ExpectedPCMBytes: expectedPCMBytes,
	}, nil
}

func (b *AudioBackend) loadTrackFromStreamingDecodeSource(displayPath string, decodePath string, preloadedTags map[string][]string, replayGainReleasePaths []string, decodeHints audioDecodeHints) (AudioPlaybackState, error) {
	b.mutex.Lock()
	gaplessPlayback := b.gaplessPlayback
	replayGainEnabled := b.replayGainEnabled
	b.mutex.Unlock()

	tags := preloadedTags
	if gaplessPlayback && tags == nil {
		loadedTags, err := readTaglibTags(displayPath)
		if err == nil {
			tags = loadedTags
		}
	}

	replayGainInfo := ReplayGainInfo{}
	if replayGainEnabled {
		replayGainInfo = b.resolveReplayGainInfo(decodePath, tags, replayGainReleasePaths)
	}

	trimInfo := gaplessTrimInfo{}
	if gaplessPlayback {
		trimInfo = readGaplessTrimInfoFromTags(tags)
	}

	expectedPCMBytes := expectedPCMBytesFromDurationSeconds(decodeHints.ExpectedDurationSeconds)
	trimmedExpectedBytes := expectedPCMBytes
	if trimmedExpectedBytes > 0 {
		trimmedBytes := (trimInfo.LeadSamples + trimInfo.TailSamples) * int64(audioBytesPerFrame)
		if trimmedBytes > 0 && trimmedExpectedBytes > trimmedBytes {
			trimmedExpectedBytes -= trimmedBytes
		}
	}

	segment := audioTrackSegment{
		SourcePath:       displayPath,
		ReplayGainScale:  replayGainInfo.Scale(),
		ExpectedPCMBytes: trimmedExpectedBytes,
	}

	decodeCtx, cancelDecode := context.WithCancel(context.Background())
	b.mutex.Lock()
	b.unloadTrackLocked()
	b.streamDecodeGeneration++
	generation := b.streamDecodeGeneration
	b.streamDecodeCancel = cancelDecode
	b.streamDecodeStartedAt = time.Now()
	b.streamDecodeExpectedBytes = trimmedExpectedBytes
	b.streamDecodeDone = false
	b.streamDecodeErr = nil
	b.streamSegments = []audioTrackSegment{segment}
	b.streamReadOffset = 0
	b.streamDroppedBytes = 0
	b.playStarted = time.Time{}
	b.playbackBaseBytes = 0
	b.endEventSent = false
	b.playing = false
	player := b.player
	if b.player != nil {
		b.player.SetVolume(b.effectivePlayerVolumeLocked())
	}
	b.streamCond.Broadcast()
	b.mutex.Unlock()

	go func() {
		leadTrimBytes := trimInfo.LeadSamples * int64(audioBytesPerFrame)
		tailTrimBytes := trimInfo.TailSamples * int64(audioBytesPerFrame)
		pendingTail := make([]byte, 0, tailTrimBytes+int64(audioBytesPerFrame))

		emit := func(chunk []byte) error {
			if len(chunk) == 0 {
				return nil
			}

			if leadTrimBytes > 0 {
				if int64(len(chunk)) <= leadTrimBytes {
					leadTrimBytes -= int64(len(chunk))
					return nil
				}
				chunk = chunk[leadTrimBytes:]
				leadTrimBytes = 0
			}

			if tailTrimBytes > 0 {
				pendingTail = append(pendingTail, chunk...)
				if int64(len(pendingTail)) <= tailTrimBytes {
					return nil
				}
				emitBytes := len(pendingTail) - int(tailTrimBytes)
				emitChunk := append([]byte(nil), pendingTail[:emitBytes]...)
				pendingTail = append(pendingTail[:0], pendingTail[emitBytes:]...)
				return b.appendStreamDecodedPCM(displayPath, generation, emitChunk)
			}

			return b.appendStreamDecodedPCM(displayPath, generation, chunk)
		}

		err := b.decodeTrackStream(decodeCtx, decodePath, replayGainInfo.Scale(), emit)
		b.finishStreamDecodedPCM(displayPath, generation, err)
	}()

	if err := b.flushPlayerBuffer(player); err != nil {
		b.mutex.Lock()
		b.unloadTrackLocked()
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()
	for {
		if generation != b.streamDecodeGeneration {
			return b.snapshotLocked(), errors.New("track load canceled")
		}

		if b.streamDecodeErr != nil && !b.remoteStreamReadyLocked() {
			err := b.streamDecodeErr
			b.unloadTrackLocked()
			return b.snapshotLocked(), err
		}

		if b.remoteStreamReadyLocked() {
			state := b.snapshotLocked()
			logAudioEvent("LoadTrack streaming path=%q bufferedBytes=%d expectedBytes=%d state=%s", displayPath, len(b.streamSegments[0].PCMData), b.streamDecodeExpectedBytes, b.stateSummaryLocked())
			return state, nil
		}

		b.streamCond.Wait()
	}
}

func (b *AudioBackend) loadTrackFromDecodeSource(displayPath string, decodePath string, preloadedTags map[string][]string, replayGainReleasePaths []string, decodeHints audioDecodeHints) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	if decodeHints.Progressive {
		return b.loadTrackFromStreamingDecodeSource(displayPath, decodePath, preloadedTags, replayGainReleasePaths, decodeHints)
	}

	segment, err := b.prepareTrackSegmentForSource(displayPath, decodePath, preloadedTags, replayGainReleasePaths, decodeHints)
	if err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	b.unloadTrackLocked()
	b.streamSegments = []audioTrackSegment{segment}
	b.streamReadOffset = 0
	b.streamDroppedBytes = 0
	b.playStarted = time.Time{}
	b.playbackBaseBytes = 0
	b.endEventSent = false
	b.playing = false
	player := b.player
	if b.player != nil {
		b.player.SetVolume(b.effectivePlayerVolumeLocked())
	}
	b.streamCond.Broadcast()
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if err := b.flushPlayerBuffer(player); err != nil {
		return state, err
	}

	logAudioEvent("LoadTrack path=%q bytes=%d state=%s", displayPath, len(segment.PCMData), summary)

	return state, nil
}

func (b *AudioBackend) queueNextTrackFromDecodeSource(afterDisplayPath string, nextDisplayPath string, nextDecodePath string, preloadedTags map[string][]string, replayGainReleasePaths []string, decodeHints audioDecodeHints) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	trimmedAfterPath := strings.TrimSpace(afterDisplayPath)
	trimmedNextDisplayPath := strings.TrimSpace(nextDisplayPath)
	trimmedNextDecodePath := strings.TrimSpace(nextDecodePath)

	b.mutex.Lock()
	b.syncPlaybackLocked()
	if len(b.streamSegments) == 0 {
		state := b.snapshotLocked()
		b.mutex.Unlock()
		if trimmedNextDisplayPath == "" {
			logAudioEvent("QueueNextTrack cleared with no active track")
			return state, nil
		}
		return state, errors.New("no track loaded")
	}

	if trimmedAfterPath != "" {
		activeSegment, _, ok := b.activeSegmentLocked()
		if !ok || !strings.EqualFold(strings.TrimSpace(activeSegment.SourcePath), trimmedAfterPath) {
			activePath := ""
			if ok {
				activePath = activeSegment.SourcePath
			}
			state := b.snapshotLocked()
			b.mutex.Unlock()
			logAudioEvent("QueueNextTrack skipped afterPath=%q activePath=%q nextPath=%q", trimmedAfterPath, activePath, trimmedNextDisplayPath)
			return state, nil
		}
	}

	b.trimConsumedSegmentsLocked(b.currentPlayedGlobalBytesLocked())
	b.invalidatePendingQueuedTrackLocked()
	b.clearFutureQueueLocked()
	if !b.gaplessPlayback || trimmedNextDisplayPath == "" {
		state := b.snapshotLocked()
		b.streamCond.Broadcast()
		summary := b.stateSummaryLocked()
		gaplessPlayback := b.gaplessPlayback
		b.mutex.Unlock()
		logAudioEvent("QueueNextTrack cleared gapless=%t state=%s", gaplessPlayback, summary)
		return state, nil
	}

	requestGeneration := b.nextQueueRequestGeneration
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	logAudioEvent("QueueNextTrack preparing nextPath=%q state=%s", trimmedNextDisplayPath, summary)

	go func(generation uint64, expectedAfterPath string, expectedNextDisplayPath string, expectedNextDecodePath string, expectedReplayGainReleasePaths []string, expectedDecodeHints audioDecodeHints, expectedTags map[string][]string) {
		nextSegment, err := b.prepareTrackSegmentForSource(expectedNextDisplayPath, expectedNextDecodePath, expectedTags, expectedReplayGainReleasePaths, expectedDecodeHints)

		b.mutex.Lock()
		defer b.mutex.Unlock()

		if generation != b.nextQueueRequestGeneration {
			return
		}

		b.syncPlaybackLocked()
		if len(b.streamSegments) == 0 || !b.gaplessPlayback {
			return
		}

		if expectedAfterPath != "" {
			activeSegment, _, ok := b.activeSegmentLocked()
			if !ok || !strings.EqualFold(strings.TrimSpace(activeSegment.SourcePath), expectedAfterPath) {
				return
			}
		}

		b.trimConsumedSegmentsLocked(b.currentPlayedGlobalBytesLocked())
		b.clearFutureQueueLocked()

		if err != nil {
			logAudioEvent("QueueNextTrack failed nextPath=%q error=%v state=%s", expectedNextDisplayPath, err, b.stateSummaryLocked())
			return
		}

		b.streamSegments = append(b.streamSegments, nextSegment)
		b.streamCond.Broadcast()
		logAudioEvent("QueueNextTrack queued nextPath=%q state=%s", expectedNextDisplayPath, b.stateSummaryLocked())
	}(requestGeneration, trimmedAfterPath, trimmedNextDisplayPath, trimmedNextDecodePath, replayGainReleasePaths, decodeHints, preloadedTags)

	return state, nil
}

// LoadTrack decodes and loads a track into the playback backend.
func (b *AudioBackend) LoadTrack(path string) (AudioPlaybackState, error) {
	return b.LoadTrackWithReplayGainContext(path, nil)
}

// LoadTrackWithReplayGainContext decodes and loads a track using release-aware ReplayGain when provided.
func (b *AudioBackend) LoadTrackWithReplayGainContext(path string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	return b.loadTrackFromDecodeSource(path, path, nil, replayGainReleasePaths, audioDecodeHints{})
}

// QueueNextTrack prepares the immediate next track for seamless playback.
func (b *AudioBackend) QueueNextTrack(afterPath string, nextPath string) (AudioPlaybackState, error) {
	return b.QueueNextTrackWithReplayGainContext(afterPath, nextPath, nil)
}

// QueueNextTrackWithReplayGainContext prepares the immediate next track using release-aware ReplayGain when provided.
func (b *AudioBackend) QueueNextTrackWithReplayGainContext(afterPath string, nextPath string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	return b.queueNextTrackFromDecodeSource(afterPath, nextPath, nextPath, nil, replayGainReleasePaths, audioDecodeHints{})
}

// ReplayGainReleaseDynamicRange resolves the album dynamic range for a release-scoped ReplayGain context.
func (b *AudioBackend) ReplayGainReleaseDynamicRange(replayGainReleasePaths []string) (int, error) {
	if err := b.Initialize(); err != nil {
		return 0, err
	}

	if dynamicRange, ok := b.resolveReplayGainReleaseDynamicRange(replayGainReleasePaths); ok {
		return dynamicRange, nil
	}

	return 0, nil
}

// Play starts playback of the currently loaded track.
func (b *AudioBackend) Play() (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	if b.player == nil || len(b.streamSegments) == 0 {
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, errors.New("no track loaded")
	}

	b.syncPlaybackLocked()
	resumeBaseBytes := b.currentPlayedGlobalBytesLocked()
	shouldReset := false
	if totalTimelineBytes := b.totalTimelineBytesLocked(); totalTimelineBytes > 0 && b.currentPlayedLocalBytesLocked() >= totalTimelineBytes {
		b.resetTimelineLocked()
		resumeBaseBytes = 0
		shouldReset = true
	}

	player := b.player
	outputContext := b.context
	b.playing = true
	b.playStarted = time.Now()
	b.notePendingPlayResumeLocked(resumeBaseBytes)
	resumeRequestedAt := b.playResumeRequestedAt
	b.endEventSent = false
	b.streamCond.Broadcast()
	b.mutex.Unlock()

	if shouldReset {
		if err := b.flushPlayerBuffer(player); err != nil {
			b.mutex.Lock()
			b.playing = false
			b.playStarted = time.Time{}
			b.clearPendingPlayResumeLocked()
			state := b.snapshotLocked()
			b.mutex.Unlock()
			return state, err
		}
	}
	player.Play()
	if outputContext != nil {
		if err := outputContext.Resume(); err != nil {
			b.mutex.Lock()
			b.playing = false
			b.playStarted = time.Time{}
			b.clearPendingPlayResumeLocked()
			state := b.snapshotLocked()
			b.mutex.Unlock()
			return state, fmt.Errorf("audio playback resume failed: %w", err)
		}
	}
	if player.Err() != nil {
		b.mutex.Lock()
		b.playing = false
		b.playStarted = time.Time{}
		b.clearPendingPlayResumeLocked()
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, fmt.Errorf("audio playback failed: %w", player.Err())
	}
	go b.observePendingPlayResumeBufferDrain(player, resumeRequestedAt)

	b.mutex.Lock()
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()
	logAudioEvent("Play state=%s", summary)
	return state, nil
}

// Pause pauses playback of the currently loaded track.
func (b *AudioBackend) Pause() (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	if b.player == nil || len(b.streamSegments) == 0 {
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, errors.New("no track loaded")
	}

	b.syncPlaybackLocked()
	outputContext := b.context
	player := b.player
	b.playing = false
	b.playStarted = time.Time{}
	b.clearPendingPlayResumeLocked()
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	player.Pause()
	if outputContext != nil {
		if err := outputContext.Suspend(); err != nil {
			return state, fmt.Errorf("audio playback suspend failed: %w", err)
		}
	}
	logAudioEvent("Pause state=%s", summary)

	return state, nil
}

// Stop stops playback and unloads the current track.
func (b *AudioBackend) Stop() (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	player := b.player
	b.unloadTrackLocked()
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if err := b.flushPlayerBuffer(player); err != nil {
		return state, err
	}

	logAudioEvent("Stop state=%s", summary)
	return state, nil
}

// stopWithoutInitialize unloads playback state even when backend initialization is unavailable.
func (b *AudioBackend) stopWithoutInitialize() AudioPlaybackState {
	b.mutex.Lock()
	player := b.player
	b.unloadTrackLocked()
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if err := b.flushPlayerBuffer(player); err != nil {
		log.Printf("failed to resync audio buffer while forcing stop: %v", err)
	}

	logAudioEvent("Stop state=%s", summary)
	return state
}

// Seek updates playback position in seconds.
func (b *AudioBackend) Seek(seconds float64) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	if len(b.streamSegments) == 0 {
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, errors.New("no track loaded")
	}

	_ = b.seekLocked(seconds)

	player := b.player
	outputContext := b.context
	shouldResume := b.playing
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if player != nil {
		if err := b.flushPlayerBuffer(player); err != nil {
			return state, err
		}
		if shouldResume {
			player.Play()
			if outputContext != nil {
				if err := outputContext.Resume(); err != nil {
					b.mutex.Lock()
					b.playing = false
					b.playStarted = time.Time{}
					state = b.snapshotLocked()
					b.mutex.Unlock()
					return state, fmt.Errorf("audio playback resume failed after seek: %w", err)
				}
			}
			if player.Err() != nil {
				b.mutex.Lock()
				b.playing = false
				b.playStarted = time.Time{}
				state = b.snapshotLocked()
				b.mutex.Unlock()
				return state, fmt.Errorf("audio playback failed after seek: %w", player.Err())
			}
		}
	}

	logAudioEvent("Seek seconds=%.2f state=%s", seconds, summary)

	return state, nil
}

// SetVolume sets the playback volume in the range [0, 1].
func (b *AudioBackend) SetVolume(volume float64) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	if math.IsNaN(volume) || math.IsInf(volume, 0) {
		volume = b.volume
	}

	if volume < 0 {
		volume = 0
	}
	if volume > 1 {
		volume = 1
	}

	b.volume = volume
	if b.player != nil {
		b.player.SetVolume(b.effectivePlayerVolumeLocked())
	}

	return b.snapshotLocked(), nil
}

// State returns the current playback snapshot.
func (b *AudioBackend) State() AudioPlaybackState {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.syncPlaybackLocked()
	return b.snapshotLocked()
}
