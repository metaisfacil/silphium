package main

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

func (b *AudioBackend) prepareTrackSegment(path string, replayGainReleasePaths []string) (audioTrackSegment, error) {
	b.mutex.Lock()
	gaplessPlayback := b.gaplessPlayback
	replayGainEnabled := b.replayGainEnabled
	b.mutex.Unlock()

	var tags map[string][]string
	if gaplessPlayback {
		loadedTags, err := readTaglibTags(path)
		if err == nil {
			tags = loadedTags
		}
	}

	replayGainInfo := ReplayGainInfo{}
	if replayGainEnabled {
		replayGainInfo = b.resolveReplayGainInfo(path, tags, replayGainReleasePaths)
	}

	decodedPCM, err := b.decodeTrack(path, replayGainInfo.Scale())
	if err != nil {
		return audioTrackSegment{}, err
	}

	if gaplessPlayback {
		trimInfo := readGaplessTrimInfoFromTags(tags)
		decodedPCM = trimPCMForGapless(decodedPCM, trimInfo)
		if trimInfo.LeadSamples > 0 || trimInfo.TailSamples > 0 {
			logAudioEvent("prepareTrackSegment path=%q leadSamples=%d tailSamples=%d trimmedBytes=%d", path, trimInfo.LeadSamples, trimInfo.TailSamples, len(decodedPCM))
		}
	}

	if replayGainEnabled && replayGainInfo.Source != "" {
		logAudioEvent(
			"prepareTrackSegment replaygain path=%q source=%s gain=%.2fdB peak=%.6f scale=%.6f",
			path,
			replayGainInfo.Source,
			replayGainInfo.GainDB,
			replayGainInfo.Peak,
			replayGainInfo.Scale(),
		)
	}

	return audioTrackSegment{
		SourcePath:      path,
		PCMData:         decodedPCM,
		ReplayGainScale: replayGainInfo.Scale(),
	}, nil
}

// LoadTrack decodes and loads a track into the playback backend.
func (b *AudioBackend) LoadTrack(path string) (AudioPlaybackState, error) {
	return b.LoadTrackWithReplayGainContext(path, nil)
}

// LoadTrackWithReplayGainContext decodes and loads a track using release-aware ReplayGain when provided.
func (b *AudioBackend) LoadTrackWithReplayGainContext(path string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	segment, err := b.prepareTrackSegment(path, replayGainReleasePaths)
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

	logAudioEvent("LoadTrack path=%q bytes=%d state=%s", path, len(segment.PCMData), summary)

	return state, nil
}

// QueueNextTrack prepares the immediate next track for seamless playback.
func (b *AudioBackend) QueueNextTrack(afterPath string, nextPath string) (AudioPlaybackState, error) {
	return b.QueueNextTrackWithReplayGainContext(afterPath, nextPath, nil)
}

// QueueNextTrackWithReplayGainContext prepares the immediate next track using release-aware ReplayGain when provided.
func (b *AudioBackend) QueueNextTrackWithReplayGainContext(afterPath string, nextPath string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	trimmedAfterPath := strings.TrimSpace(afterPath)
	trimmedNextPath := strings.TrimSpace(nextPath)

	var nextSegment audioTrackSegment
	var err error
	if trimmedNextPath != "" {
		nextSegment, err = b.prepareTrackSegment(trimmedNextPath, replayGainReleasePaths)
		if err != nil {
			return AudioPlaybackState{}, err
		}
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.syncPlaybackLocked()
	if len(b.streamSegments) == 0 {
		if trimmedNextPath == "" {
			logAudioEvent("QueueNextTrack cleared with no active track")
			return b.snapshotLocked(), nil
		}
		return b.snapshotLocked(), errors.New("no track loaded")
	}

	if trimmedAfterPath != "" {
		activeSegment, _, ok := b.activeSegmentLocked()
		if !ok || !strings.EqualFold(strings.TrimSpace(activeSegment.SourcePath), trimmedAfterPath) {
			activePath := ""
			if ok {
				activePath = activeSegment.SourcePath
			}
			logAudioEvent("QueueNextTrack skipped afterPath=%q activePath=%q nextPath=%q", trimmedAfterPath, activePath, trimmedNextPath)
			return b.snapshotLocked(), nil
		}
	}

	b.trimConsumedSegmentsLocked(b.currentPlayedGlobalBytesLocked())
	b.clearFutureQueueLocked()
	if !b.gaplessPlayback || trimmedNextPath == "" {
		b.streamCond.Broadcast()
		logAudioEvent("QueueNextTrack cleared gapless=%t state=%s", b.gaplessPlayback, b.stateSummaryLocked())
		return b.snapshotLocked(), nil
	}

	b.streamSegments = append(b.streamSegments, nextSegment)
	b.streamCond.Broadcast()
	logAudioEvent("QueueNextTrack queued nextPath=%q state=%s", trimmedNextPath, b.stateSummaryLocked())
	return b.snapshotLocked(), nil
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
	shouldReset := false
	if totalTimelineBytes := b.totalTimelineBytesLocked(); totalTimelineBytes > 0 && b.currentPlayedLocalBytesLocked() >= totalTimelineBytes {
		b.resetTimelineLocked()
		shouldReset = true
	}

	player := b.player
	b.playing = true
	b.playStarted = time.Now()
	b.endEventSent = false
	b.streamCond.Broadcast()
	b.mutex.Unlock()

	if shouldReset {
		if err := b.flushPlayerBuffer(player); err != nil {
			b.mutex.Lock()
			b.playing = false
			b.playStarted = time.Time{}
			state := b.snapshotLocked()
			b.mutex.Unlock()
			return state, err
		}
	}
	player.Play()
	if player.Err() != nil {
		b.mutex.Lock()
		b.playing = false
		b.playStarted = time.Time{}
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, fmt.Errorf("audio playback failed: %w", player.Err())
	}

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
	player := b.player
	b.playing = false
	b.playStarted = time.Time{}
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	player.Pause()
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
