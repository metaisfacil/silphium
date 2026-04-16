package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/metaisfacil/oto/v3"
)

const (
	audioSampleRate                  = 44100
	audioChannelCount                = 2
	audioBytesPerFrame               = audioChannelCount * 2
	defaultAudioOutputBuffer         = 256 * time.Millisecond
	defaultAudioPlayerBuffer         = 1500 * time.Millisecond
	maxAudioPlayerBuffer             = 3 * time.Second
	playerBufferHeadroomFactor       = 4
	playbackHeadroomLowThreshold     = 150 * time.Millisecond
	playbackHeadroomRecoverThreshold = 500 * time.Millisecond
	remoteStreamReadinessMinProbe    = 150 * time.Millisecond
	remoteStreamReadinessBaseBuffer  = 1 * time.Second
	remoteStreamSafetyFactor         = 0.92
	minVisualizationFrameCount       = 64
	maxVisualizationFrameCount       = 2048
	visualizationWindowFactor        = 6
	longVisualizationFrameThreshold  = 768
	longVisualizationWindowSeconds   = 10
)

var audioBytesPerSecond = audioSampleRate * audioBytesPerFrame

// AudioPlaybackState reports the current playback state exposed to the frontend.
type AudioPlaybackState struct {
	Loaded      bool    `json:"loaded"`
	Playing     bool    `json:"playing"`
	CurrentTime float64 `json:"currentTime"`
	Duration    float64 `json:"duration"`
	Volume      float64 `json:"volume"`
	SourcePath  string  `json:"sourcePath"`
	EndEventID  uint64  `json:"endEventId"`
}

// AudioVisualizationFrame contains a lightweight stereo PCM window for frontend visualizations.
type AudioVisualizationFrame struct {
	Loaded       bool    `json:"loaded"`
	Playing      bool    `json:"playing"`
	SourcePath   string  `json:"sourcePath"`
	SampleRate   int     `json:"sampleRate"`
	ChannelCount int     `json:"channelCount"`
	FrameCount   int     `json:"frameCount"`
	SampleStride float64 `json:"sampleStride"`
	Peak         float64 `json:"peak"`
	Samples      []int16 `json:"samples"`
}

// AudioOutputDevice describes an available audio output target for playback.
type AudioOutputDevice struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Backend   string `json:"backend"`
	IsDefault bool   `json:"isDefault"`
}

type audioTrackSegment struct {
	SourcePath       string
	PCMData          []byte
	ReplayGainScale  float64
	ExpectedPCMBytes int64
}

func (s audioTrackSegment) byteLen() int64 {
	return int64(len(s.PCMData))
}

func (s audioTrackSegment) durationSeconds() float64 {
	durationBytes := int64(len(s.PCMData))
	if s.ExpectedPCMBytes > durationBytes {
		durationBytes = s.ExpectedPCMBytes
	}

	return float64(durationBytes) / float64(audioBytesPerSecond)
}

type audioDecodeHints struct {
	ExpectedDurationSeconds float64
	Progressive             bool
}

type gaplessTrimInfo struct {
	LeadSamples int64
	TailSamples int64
}

func logAudioEvent(message string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	formattedMessage := fmt.Sprintf(message, args...)
	log.Printf("[%s] [AUDIO] %s", timestamp, formattedMessage)
}

type audioPlayerSource struct {
	backend *AudioBackend
}

func (s *audioPlayerSource) Read(p []byte) (int, error) {
	return s.backend.Read(p)
}

func (s *audioPlayerSource) Seek(offset int64, whence int) (int64, error) {
	return s.backend.seekStream(offset, whence)
}

type audioOutputPlayer interface {
	SetVolume(volume float64)
	SetBufferSize(bufferSize int)
	BufferedSize() int
	Play()
	Pause()
	Err() error
	Seek(offset int64, whence int) (int64, error)
}

type audioOutputContext interface {
	NewPlayer(source io.Reader) audioOutputPlayer
	Err() error
	Close() error
}

type otoPlayerAdapter struct {
	setVolume func(volume float64)
	setBuffer func(bufferSize int)
	buffered  func() int
	play      func()
	pause     func()
	err       func() error
	seek      func(offset int64, whence int) (int64, error)
}

func (a *otoPlayerAdapter) SetVolume(volume float64) {
	if a.setVolume != nil {
		a.setVolume(volume)
	}
}

func (a *otoPlayerAdapter) SetBufferSize(bufferSize int) {
	if a.setBuffer != nil {
		a.setBuffer(bufferSize)
	}
}

func (a *otoPlayerAdapter) BufferedSize() int {
	if a.buffered == nil {
		return 0
	}

	return a.buffered()
}

func (a *otoPlayerAdapter) Play() {
	if a.play != nil {
		a.play()
	}
}

func (a *otoPlayerAdapter) Pause() {
	if a.pause != nil {
		a.pause()
	}
}

func (a *otoPlayerAdapter) Err() error {
	if a.err == nil {
		return nil
	}

	return a.err()
}

func (a *otoPlayerAdapter) Seek(offset int64, whence int) (int64, error) {
	if a.seek == nil {
		return offset, nil
	}

	return a.seek(offset, whence)
}

type otoContextAdapter struct {
	newPlayer func(source io.Reader) audioOutputPlayer
	err       func() error
	close     func() error
}

func (a *otoContextAdapter) NewPlayer(source io.Reader) audioOutputPlayer {
	if a.newPlayer == nil {
		return nil
	}

	return a.newPlayer(source)
}

func (a *otoContextAdapter) Err() error {
	if a.err == nil {
		return nil
	}

	return a.err()
}

func (a *otoContextAdapter) Close() error {
	if a.close == nil {
		return nil
	}

	return a.close()
}

var newAudioOutputContext = func(options *oto.NewContextOptions) (audioOutputContext, <-chan struct{}, error) {
	context, ready, err := oto.NewContext(options)
	if err != nil {
		return nil, nil, err
	}

	return &otoContextAdapter{
		newPlayer: func(source io.Reader) audioOutputPlayer {
			player := context.NewPlayer(source)
			return &otoPlayerAdapter{
				setVolume: player.SetVolume,
				setBuffer: player.SetBufferSize,
				buffered:  player.BufferedSize,
				play:      player.Play,
				pause:     player.Pause,
				err:       player.Err,
				seek:      player.Seek,
			}
		},
		err:   context.Err,
		close: context.Close,
	}, ready, nil
}

// AudioBackend manages decoded PCM playback and transport controls.
type AudioBackend struct {
	mutex                       sync.Mutex
	streamCond                  *sync.Cond
	ffmpegPath                  string
	context                     audioOutputContext
	player                      audioOutputPlayer
	streamSegments              []audioTrackSegment
	streamReadOffset            int64
	streamDroppedBytes          int64
	playStarted                 time.Time
	playbackBaseBytes           int64
	playing                     bool
	volume                      float64
	endEventID                  uint64
	endEventSent                bool
	outputDevice                string
	outputBuffer                time.Duration
	gaplessPlayback             bool
	replayGainEnabled           bool
	streamDecodeCancel          context.CancelFunc
	streamDecodeGeneration      uint64
	streamDecodeStartedAt       time.Time
	streamDecodeExpectedBytes   int64
	streamDecodeDone            bool
	streamDecodeErr             error
	nextQueueRequestGeneration  uint64
	playbackHeadroomLow         bool
	replayGainCacheMu           sync.Mutex
	replayGainCacheByPath       map[string]replayGainCacheEntry
	replayGainCacheOrder        []string
	replayGainReleaseCacheMu    sync.Mutex
	replayGainReleaseCacheByKey map[string]replayGainReleaseCacheEntry
	replayGainReleaseCacheOrder []string
}

// NewAudioBackend creates an audio backend with default playback volume.
func NewAudioBackend() *AudioBackend {
	backend := &AudioBackend{
		volume:       0.8,
		outputDevice: defaultAudioOutputDevice,
	}
	backend.streamCond = sync.NewCond(&backend.mutex)
	return backend
}

func (b *AudioBackend) stateSummaryLocked() string {
	state := b.snapshotLocked()
	streamDecodeState := "idle"
	if b.streamDecodeCancel != nil && !b.streamDecodeDone {
		streamDecodeState = "loading"
	} else if b.streamDecodeDone && len(b.streamSegments) > 0 {
		streamDecodeState = "ready"
	}
	if b.streamDecodeErr != nil {
		streamDecodeState = "error"
	}
	return fmt.Sprintf(
		"loaded=%t playing=%t source=%q time=%.2f/%.2f queue=%d read=%d base=%d dropped=%d decode=%s gapless=%t replayGain=%t",
		state.Loaded,
		state.Playing,
		state.SourcePath,
		state.CurrentTime,
		state.Duration,
		len(b.streamSegments),
		b.streamReadOffset,
		b.playbackBaseBytes,
		b.streamDroppedBytes,
		streamDecodeState,
		b.gaplessPlayback,
		b.replayGainEnabled,
	)
}

func normalizeReplayGainScale(scale float64) float64 {
	if math.IsNaN(scale) || math.IsInf(scale, 0) || scale <= 0 {
		return 1
	}

	return scale
}

func durationToAlignedAudioBytes(duration time.Duration) int {
	if duration <= 0 {
		return 0
	}

	byteCount := int((duration * time.Duration(audioBytesPerSecond)) / time.Second)
	if byteCount <= 0 {
		return 0
	}

	remainder := byteCount % audioBytesPerFrame
	if remainder != 0 {
		byteCount += audioBytesPerFrame - remainder
	}

	return byteCount
}

func audioDurationForByteCount(byteCount int64) time.Duration {
	if byteCount <= 0 {
		return 0
	}

	return (time.Duration(byteCount) * time.Second) / time.Duration(audioBytesPerSecond)
}

func (b *AudioBackend) effectiveOutputBufferLocked() time.Duration {
	if b.outputBuffer > 0 {
		return b.outputBuffer
	}

	return defaultAudioOutputBuffer
}

func (b *AudioBackend) desiredPlayerBufferSizeLocked() int {
	target := defaultAudioPlayerBuffer
	headroomTarget := b.effectiveOutputBufferLocked() * playerBufferHeadroomFactor
	if headroomTarget > target {
		target = headroomTarget
	}
	if target > maxAudioPlayerBuffer {
		target = maxAudioPlayerBuffer
	}

	return durationToAlignedAudioBytes(target)
}

func (b *AudioBackend) playerBufferedBytesLocked() int64 {
	if b.player == nil {
		return 0
	}

	bufferedBytes := int64(b.player.BufferedSize())
	if bufferedBytes < 0 {
		return 0
	}
	if bufferedBytes > b.streamReadOffset {
		return b.streamReadOffset
	}

	return bufferedBytes
}

func (b *AudioBackend) reportPlaybackHeadroomLocked() {
	if !b.playing || len(b.streamSegments) == 0 || b.player == nil {
		b.playbackHeadroomLow = false
		return
	}

	bufferedDuration := audioDurationForByteCount(b.playerBufferedBytesLocked())
	lowThreshold := playbackHeadroomLowThreshold
	if derivedThreshold := b.effectiveOutputBufferLocked() / 2; derivedThreshold > lowThreshold {
		lowThreshold = derivedThreshold
	}
	recoverThreshold := playbackHeadroomRecoverThreshold
	if derivedThreshold := b.effectiveOutputBufferLocked(); derivedThreshold > recoverThreshold {
		recoverThreshold = derivedThreshold
	}

	if bufferedDuration <= lowThreshold {
		if !b.playbackHeadroomLow {
			b.playbackHeadroomLow = true
			logAudioEvent(
				"PlaybackHeadroomLow buffered=%s threshold=%s playerBuffer=%s outputBuffer=%s state=%s",
				bufferedDuration,
				lowThreshold,
				audioDurationForByteCount(int64(b.desiredPlayerBufferSizeLocked())),
				b.effectiveOutputBufferLocked(),
				b.stateSummaryLocked(),
			)
		}
		return
	}

	if b.playbackHeadroomLow && bufferedDuration >= recoverThreshold {
		b.playbackHeadroomLow = false
		logAudioEvent(
			"PlaybackHeadroomRecovered buffered=%s threshold=%s state=%s",
			bufferedDuration,
			recoverThreshold,
			b.stateSummaryLocked(),
		)
	}
}

func (b *AudioBackend) effectivePlayerVolumeLocked() float64 {
	volume := b.volume
	if math.IsNaN(volume) || math.IsInf(volume, 0) {
		return 0
	}

	if len(b.streamSegments) == 0 {
		if volume < 0 {
			return 0
		}
		return volume
	}

	playedLocalBytes := b.currentPlayedLocalBytesLocked()
	segmentIndex, _, _ := b.segmentForPlaybackOffsetLocked(playedLocalBytes)

	segment := b.streamSegments[segmentIndex]
	decodedScale := normalizeReplayGainScale(segment.ReplayGainScale)
	desiredScale := 1.0
	if b.replayGainEnabled {
		desiredScale = decodedScale
		if math.Abs(decodedScale-1) < 1e-9 {
			replayGainInfo := b.resolveReplayGainInfo(segment.SourcePath, nil, nil)
			desiredScale = normalizeReplayGainScale(replayGainInfo.Scale())
		}
	}

	effectiveVolume := volume * (desiredScale / decodedScale)
	if math.IsNaN(effectiveVolume) || math.IsInf(effectiveVolume, 0) || effectiveVolume < 0 {
		return 0
	}

	return effectiveVolume
}

func (b *AudioBackend) flushPlayerBuffer(player audioOutputPlayer) error {
	if player == nil {
		return nil
	}

	player.Pause()
	if _, err := player.Seek(0, io.SeekCurrent); err != nil {
		return fmt.Errorf("failed to resync audio buffer: %w", err)
	}

	return nil
}

func (b *AudioBackend) selectedOutputDeviceIDLocked() string {
	selectedOutputDevice := strings.TrimSpace(b.outputDevice)
	if selectedOutputDevice == "" || selectedOutputDevice == defaultAudioOutputDevice {
		return ""
	}

	for _, device := range b.ListOutputDevices() {
		if strings.TrimSpace(device.ID) == selectedOutputDevice {
			return selectedOutputDevice
		}
	}

	logAudioEvent("Initialize falling back to default audio output because device=%q is unavailable", selectedOutputDevice)
	b.outputDevice = defaultAudioOutputDevice
	return ""
}

// SetFFmpegPath updates the configured ffmpeg executable path used by the backend.
func (b *AudioBackend) SetFFmpegPath(path string) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.ffmpegPath = normalizeFFmpegPath(path)
}

// ApplyAudioSettings updates the backend with normalized persisted audio settings.
func (b *AudioBackend) ApplyAudioSettings(settings AudioSettings) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	normalized := normalizeAudioSettings(settings)
	b.outputDevice = normalized.OutputDevice
	b.outputBuffer = time.Duration(normalized.OutputBufferMs) * time.Millisecond
	b.gaplessPlayback = normalized.GaplessPlayback
	previousReplayGainEnabled := b.replayGainEnabled
	b.replayGainEnabled = normalized.ReplayGainEnabled
	if !b.gaplessPlayback {
		b.trimConsumedSegmentsLocked(b.currentPlayedGlobalBytesLocked())
		b.clearFutureQueueLocked()
	}
	if previousReplayGainEnabled != b.replayGainEnabled {
		b.clearFutureQueueLocked()
		if b.player != nil && len(b.streamSegments) > 0 {
			b.player.SetVolume(b.effectivePlayerVolumeLocked())
		}
	}
	if b.player != nil {
		b.player.SetBufferSize(b.desiredPlayerBufferSizeLocked())
	}

	logAudioEvent(
		"ApplyAudioSettings device=%q buffer=%s effectiveBuffer=%s gapless=%t replayGain=%t state=%s",
		b.outputDevice,
		b.outputBuffer,
		b.effectiveOutputBufferLocked(),
		b.gaplessPlayback,
		b.replayGainEnabled,
		b.stateSummaryLocked(),
	)
}

// Read implements io.Reader for the long-lived Oto player.
func (b *AudioBackend) Read(p []byte) (int, error) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	if len(p) == 0 {
		return 0, nil
	}

	written := 0
	for written < len(p) {
		for {
			totalTimelineBytes := b.totalTimelineBytesLocked()
			if totalTimelineBytes > 0 && b.streamReadOffset < totalTimelineBytes {
				break
			}

			b.streamCond.Wait()
		}

		segmentIndex, segmentOffset, _ := b.segmentForByteOffsetLocked(b.streamReadOffset)

		segment := b.streamSegments[segmentIndex]
		copied := copy(p[written:], segment.PCMData[segmentOffset:])

		written += copied
		b.streamReadOffset += int64(copied)

		if b.streamReadOffset >= b.totalTimelineBytesLocked() {
			break
		}
	}

	if written > 0 {
		return written, nil
	}

	return 0, io.EOF
}

func (b *AudioBackend) seekStream(offset int64, whence int) (int64, error) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	baseOffset := int64(0)
	switch whence {
	case io.SeekStart:
		baseOffset = 0
	case io.SeekCurrent:
		baseOffset = b.streamReadOffset
	case io.SeekEnd:
		baseOffset = b.totalTimelineBytesLocked()
	default:
		return 0, errors.New("invalid seek whence")
	}

	nextOffset := baseOffset + offset
	if nextOffset < 0 {
		return 0, errors.New("negative seek position")
	}

	totalTimelineBytes := b.totalTimelineBytesLocked()
	if nextOffset > totalTimelineBytes {
		nextOffset = totalTimelineBytes
	}

	b.streamReadOffset = nextOffset
	b.streamCond.Broadcast()
	return nextOffset, nil
}

// Initialize prepares ffmpeg and the audio output context.
func (b *AudioBackend) Initialize() error {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	resolvedFFmpegPath, err := resolveFFmpegPath(b.ffmpegPath)
	if err != nil {
		return err
	}
	b.ffmpegPath = resolvedFFmpegPath

	if b.context != nil {
		if b.player == nil {
			b.player = b.context.NewPlayer(&audioPlayerSource{backend: b})
			b.player.SetBufferSize(b.desiredPlayerBufferSizeLocked())
			b.player.SetVolume(b.effectivePlayerVolumeLocked())
			logAudioEvent("Initialize attached player to existing context state=%s", b.stateSummaryLocked())
		}
		return nil
	}

	selectedOutputDeviceID := b.selectedOutputDeviceIDLocked()

	context, ready, err := newAudioOutputContext(&oto.NewContextOptions{
		SampleRate:     audioSampleRate,
		ChannelCount:   audioChannelCount,
		Format:         oto.FormatSignedInt16LE,
		BufferSize:     b.effectiveOutputBufferLocked(),
		OutputDeviceID: selectedOutputDeviceID,
	})
	if err != nil {
		return fmt.Errorf("failed to initialize audio output: %w", err)
	}

	<-ready
	if context.Err() != nil {
		return fmt.Errorf("audio output context failed: %w", context.Err())
	}

	b.context = context
	b.player = context.NewPlayer(&audioPlayerSource{backend: b})
	b.player.SetBufferSize(b.desiredPlayerBufferSizeLocked())
	b.player.SetVolume(b.effectivePlayerVolumeLocked())
	logAudioEvent("Initialize created context device=%q buffer=%s effectiveBuffer=%s gapless=%t playerBuffer=%s", b.outputDevice, b.outputBuffer, b.effectiveOutputBufferLocked(), b.gaplessPlayback, audioDurationForByteCount(int64(b.desiredPlayerBufferSizeLocked())))
	return nil
}

// Close releases the active audio context and player while preserving decoded state.
func (b *AudioBackend) Close() error {
	b.mutex.Lock()
	context := b.context
	b.context = nil
	b.player = nil
	b.playing = false
	b.playStarted = time.Time{}
	b.streamCond.Broadcast()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if context != nil {
		if err := context.Close(); err != nil {
			return fmt.Errorf("failed to close audio output: %w", err)
		}
	}

	logAudioEvent("CloseAudioBackend state=%s", summary)
	return nil
}

// Reinitialize rebuilds the audio context using the current settings and restores playback state.
func (b *AudioBackend) Reinitialize() error {
	b.mutex.Lock()
	b.syncPlaybackLocked()

	playedGlobalBytes := b.currentPlayedGlobalBytesLocked()
	b.trimConsumedSegmentsLocked(playedGlobalBytes)
	playedLocalBytes := playedGlobalBytes - b.streamDroppedBytes
	if playedLocalBytes < 0 {
		playedLocalBytes = 0
	}

	totalTimelineBytes := b.totalTimelineBytesLocked()
	if playedLocalBytes > totalTimelineBytes {
		playedLocalBytes = totalTimelineBytes
	}

	wasPlaying := b.playing && totalTimelineBytes > 0 && playedLocalBytes < totalTimelineBytes
	b.streamReadOffset = playedLocalBytes
	b.playbackBaseBytes = b.streamDroppedBytes + playedLocalBytes
	b.playStarted = time.Time{}
	b.playing = false
	b.streamCond.Broadcast()
	beforeSummary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if err := b.Close(); err != nil {
		return err
	}

	if err := b.Initialize(); err != nil {
		return err
	}

	b.mutex.Lock()
	player := b.player
	if player != nil {
		player.SetVolume(b.effectivePlayerVolumeLocked())
	}
	if wasPlaying && player != nil && len(b.streamSegments) > 0 {
		b.playing = true
		b.playStarted = time.Now()
		b.endEventSent = false
	}
	afterSummary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if wasPlaying && player != nil {
		player.Play()
		if player.Err() != nil {
			b.mutex.Lock()
			b.playing = false
			b.playStarted = time.Time{}
			b.mutex.Unlock()
			return fmt.Errorf("audio playback failed after reinitialize: %w", player.Err())
		}
	}

	logAudioEvent("ReinitializeAudioBackend before=%s after=%s", beforeSummary, afterSummary)
	return nil
}

func (b *AudioBackend) seekLocked(seconds float64) error {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		seconds = 0
	}
	if seconds < 0 {
		seconds = 0
	}

	playedLocalBytes := b.currentPlayedLocalBytesLocked()
	activeSegmentIndex, _, ok := b.segmentForPlaybackOffsetLocked(playedLocalBytes)
	if !ok {
		return errors.New("no track loaded")
	}

	activeSegment := b.streamSegments[activeSegmentIndex]
	activeDuration := activeSegment.durationSeconds()
	if seconds > activeDuration {
		seconds = activeDuration
	}

	byteOffset := int64(seconds * float64(audioBytesPerSecond))
	byteOffset -= byteOffset % int64(audioBytesPerFrame)
	if byteOffset > activeSegment.byteLen() {
		byteOffset = activeSegment.byteLen()
	}

	b.streamReadOffset = byteOffset
	b.streamDroppedBytes = 0
	b.playbackBaseBytes = byteOffset
	if b.playing {
		b.playStarted = time.Now()
	} else {
		b.playStarted = time.Time{}
	}
	b.endEventSent = false
	b.streamCond.Broadcast()

	return nil
}

func (b *AudioBackend) totalTimelineBytesLocked() int64 {
	total := int64(0)
	for _, segment := range b.streamSegments {
		total += segment.byteLen()
	}

	return total
}

func (b *AudioBackend) currentPlayedGlobalBytesLocked() int64 {
	playedBytes := b.playbackBaseBytes
	if b.playing && !b.playStarted.IsZero() {
		elapsedBytes := int64(time.Since(b.playStarted).Seconds() * float64(audioBytesPerSecond))
		elapsedBytes -= elapsedBytes % int64(audioBytesPerFrame)
		if elapsedBytes > 0 {
			playedBytes += elapsedBytes
		}
	}
	if playedBytes < 0 {
		return 0
	}

	maxReadableGlobalBytes := b.streamDroppedBytes + b.streamReadOffset - b.playerBufferedBytesLocked()
	if maxReadableGlobalBytes < b.streamDroppedBytes {
		maxReadableGlobalBytes = b.streamDroppedBytes
	}
	if playedBytes > maxReadableGlobalBytes {
		playedBytes = maxReadableGlobalBytes
	}

	totalGlobalBytes := b.streamDroppedBytes + b.totalTimelineBytesLocked()
	if playedBytes > totalGlobalBytes {
		playedBytes = totalGlobalBytes
	}

	return playedBytes
}

func expectedPCMBytesFromDurationSeconds(durationSeconds float64) int64 {
	if !isFiniteFloat64(durationSeconds) || durationSeconds <= 0 {
		return 0
	}

	pcmBytes := int64(durationSeconds * float64(audioBytesPerSecond))
	if pcmBytes <= 0 {
		return 0
	}

	remainder := pcmBytes % int64(audioBytesPerFrame)
	if remainder != 0 {
		pcmBytes += int64(audioBytesPerFrame) - remainder
	}

	return pcmBytes
}

func (b *AudioBackend) remoteStreamMinimumBufferBytesLocked() int64 {
	minimum := int64(remoteStreamReadinessBaseBuffer.Seconds() * float64(audioBytesPerSecond))
	if minimum <= 0 {
		minimum = int64(audioBytesPerSecond)
	}

	if b.outputBuffer > 0 {
		outputBytes := int64(b.outputBuffer.Seconds() * float64(audioBytesPerSecond))
		if outputBytes > 0 {
			scaledOutputBytes := outputBytes * 3
			if scaledOutputBytes > minimum {
				minimum = scaledOutputBytes
			}
		}
	}

	remainder := minimum % int64(audioBytesPerFrame)
	if remainder != 0 {
		minimum += int64(audioBytesPerFrame) - remainder
	}

	return minimum
}

func (b *AudioBackend) remoteStreamReadyLocked() bool {
	if len(b.streamSegments) == 0 {
		return false
	}

	bufferedBytes := b.streamSegments[0].byteLen()
	if bufferedBytes <= 0 {
		return false
	}

	if b.streamDecodeDone {
		return true
	}

	minimumBufferBytes := b.remoteStreamMinimumBufferBytesLocked()
	if bufferedBytes < minimumBufferBytes || b.streamDecodeStartedAt.IsZero() {
		return false
	}

	elapsed := time.Since(b.streamDecodeStartedAt)
	if elapsed < remoteStreamReadinessMinProbe {
		return false
	}

	measuredRateBytesPerSecond := float64(bufferedBytes) / elapsed.Seconds()
	conservativeRateBytesPerSecond := measuredRateBytesPerSecond * remoteStreamSafetyFactor
	if conservativeRateBytesPerSecond <= 0 {
		return false
	}

	playbackRateBytesPerSecond := float64(audioBytesPerSecond)
	if conservativeRateBytesPerSecond >= playbackRateBytesPerSecond {
		return true
	}

	expectedBytes := b.streamDecodeExpectedBytes
	if expectedBytes <= bufferedBytes {
		return false
	}

	remainingBytes := float64(expectedBytes - bufferedBytes)
	requiredBufferedBytes := (playbackRateBytesPerSecond - conservativeRateBytesPerSecond) * (remainingBytes / conservativeRateBytesPerSecond)
	if requiredBufferedBytes < 0 {
		requiredBufferedBytes = 0
	}

	return float64(bufferedBytes) >= requiredBufferedBytes+float64(minimumBufferBytes)
}

func (b *AudioBackend) appendStreamDecodedPCM(displayPath string, generation uint64, chunk []byte) error {
	if len(chunk) == 0 {
		return nil
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	if generation != b.streamDecodeGeneration || len(b.streamSegments) == 0 || b.streamSegments[0].SourcePath != displayPath {
		return context.Canceled
	}

	b.streamSegments[0].PCMData = append(b.streamSegments[0].PCMData, chunk...)
	b.streamCond.Broadcast()
	return nil
}

func (b *AudioBackend) finishStreamDecodedPCM(displayPath string, generation uint64, err error) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	if generation != b.streamDecodeGeneration {
		return
	}

	b.streamDecodeDone = true
	b.streamDecodeCancel = nil
	if errors.Is(err, context.Canceled) {
		b.streamDecodeErr = nil
	} else {
		b.streamDecodeErr = err
	}
	if len(b.streamSegments) > 0 && b.streamSegments[0].SourcePath == displayPath {
		decodedBytes := b.streamSegments[0].byteLen()
		if err == nil && decodedBytes > 0 {
			b.streamSegments[0].ExpectedPCMBytes = decodedBytes
			b.streamDecodeExpectedBytes = decodedBytes
		} else if decodedBytes > b.streamDecodeExpectedBytes {
			b.streamSegments[0].ExpectedPCMBytes = decodedBytes
			b.streamDecodeExpectedBytes = decodedBytes
		}
	}
	b.streamCond.Broadcast()
}

func (b *AudioBackend) stopStreamDecodeLocked() {
	b.streamDecodeGeneration++
	if b.streamDecodeCancel != nil {
		b.streamDecodeCancel()
	}
	b.streamDecodeCancel = nil
	b.streamDecodeStartedAt = time.Time{}
	b.streamDecodeExpectedBytes = 0
	b.streamDecodeDone = true
	b.streamDecodeErr = nil
}

func (b *AudioBackend) trimConsumedSegmentsLocked(playedGlobalBytes int64) {
	for len(b.streamSegments) > 1 {
		playedLocalBytes := playedGlobalBytes - b.streamDroppedBytes
		firstSegmentLength := b.streamSegments[0].byteLen()
		if firstSegmentLength <= 0 {
			b.streamSegments[0].PCMData = nil
			b.streamSegments = b.streamSegments[1:]
			continue
		}
		if playedLocalBytes < firstSegmentLength || b.streamReadOffset < firstSegmentLength {
			break
		}

		b.streamSegments[0].PCMData = nil
		b.streamSegments = b.streamSegments[1:]
		b.streamDroppedBytes += firstSegmentLength
		b.streamReadOffset -= firstSegmentLength
	}
}

func (b *AudioBackend) currentPlayedLocalBytesLocked() int64 {
	playedGlobalBytes := b.currentPlayedGlobalBytesLocked()
	b.trimConsumedSegmentsLocked(playedGlobalBytes)
	playedLocalBytes := playedGlobalBytes - b.streamDroppedBytes
	if playedLocalBytes < 0 {
		return 0
	}

	return playedLocalBytes
}

func (b *AudioBackend) segmentForByteOffsetLocked(offset int64) (int, int64, bool) {
	if len(b.streamSegments) == 0 {
		return -1, 0, false
	}

	if offset < 0 {
		offset = 0
	}

	totalTimelineBytes := b.totalTimelineBytesLocked()
	if offset >= totalTimelineBytes {
		return -1, 0, false
	}

	runningOffset := int64(0)
	for index, segment := range b.streamSegments {
		nextOffset := runningOffset + segment.byteLen()
		if offset < nextOffset {
			return index, offset - runningOffset, true
		}

		runningOffset = nextOffset
	}

	return -1, 0, false
}

func (b *AudioBackend) segmentForPlaybackOffsetLocked(offset int64) (int, int64, bool) {
	if len(b.streamSegments) == 0 {
		return -1, 0, false
	}

	if offset <= 0 {
		return 0, 0, true
	}

	runningOffset := int64(0)
	for index, segment := range b.streamSegments {
		nextOffset := runningOffset + segment.byteLen()
		if offset < nextOffset {
			return index, offset - runningOffset, true
		}

		runningOffset = nextOffset
	}

	lastIndex := len(b.streamSegments) - 1
	return lastIndex, b.streamSegments[lastIndex].byteLen(), true
}

func (b *AudioBackend) activeSegmentLocked() (audioTrackSegment, int64, bool) {
	playedLocalBytes := b.currentPlayedLocalBytesLocked()
	segmentIndex, segmentOffset, ok := b.segmentForPlaybackOffsetLocked(playedLocalBytes)
	if !ok {
		return audioTrackSegment{}, 0, false
	}

	return b.streamSegments[segmentIndex], segmentOffset, true
}

func (b *AudioBackend) resetTimelineLocked() {
	b.streamReadOffset = 0
	b.streamDroppedBytes = 0
	b.playbackBaseBytes = 0
	b.playStarted = time.Time{}
	b.endEventSent = false
	b.streamCond.Broadcast()
}

func (b *AudioBackend) invalidatePendingQueuedTrackLocked() {
	b.nextQueueRequestGeneration++
}

func (b *AudioBackend) clearFutureQueueLocked() {
	if len(b.streamSegments) <= 1 {
		return
	}

	for index := 1; index < len(b.streamSegments); index++ {
		b.streamSegments[index].PCMData = nil
	}
	b.streamSegments = b.streamSegments[:1]
}

func (b *AudioBackend) syncPlaybackLocked() {
	totalTimelineBytes := b.totalTimelineBytesLocked()
	if totalTimelineBytes == 0 {
		b.playing = false
		b.playStarted = time.Time{}
		b.playbackBaseBytes = 0
		b.endEventSent = false
		b.playbackHeadroomLow = false
		return
	}

	playedGlobalBytes := b.currentPlayedGlobalBytesLocked()
	b.trimConsumedSegmentsLocked(playedGlobalBytes)
	playedLocalBytes := playedGlobalBytes - b.streamDroppedBytes
	if playedLocalBytes < 0 {
		playedLocalBytes = 0
	}
	if playedLocalBytes >= totalTimelineBytes {
		b.playbackBaseBytes = b.streamDroppedBytes + totalTimelineBytes
		b.playStarted = time.Time{}
		if b.playing {
			b.playing = false
		}
		b.playbackHeadroomLow = false
		if !b.endEventSent {
			b.endEventID++
			b.endEventSent = true
			logAudioEvent("TrackEnded endEventId=%d state=%s", b.endEventID, b.stateSummaryLocked())
		}
		return
	}

	if b.playing && !b.playStarted.IsZero() {
		b.playbackBaseBytes = playedGlobalBytes
		b.playStarted = time.Now()
	}

	b.endEventSent = false
	b.reportPlaybackHeadroomLocked()
}

func (b *AudioBackend) snapshotLocked() AudioPlaybackState {
	if len(b.streamSegments) == 0 {
		return AudioPlaybackState{
			Loaded:      false,
			Playing:     false,
			CurrentTime: 0,
			Duration:    0,
			Volume:      b.volume,
			SourcePath:  "",
			EndEventID:  b.endEventID,
		}
	}

	playedLocalBytes := b.currentPlayedLocalBytesLocked()
	segmentIndex, segmentOffset, _ := b.segmentForPlaybackOffsetLocked(playedLocalBytes)

	activeSegment := b.streamSegments[segmentIndex]
	currentTime := float64(segmentOffset) / float64(audioBytesPerSecond)
	duration := activeSegment.durationSeconds()

	return AudioPlaybackState{
		Loaded:      true,
		Playing:     b.playing && playedLocalBytes < b.totalTimelineBytesLocked(),
		CurrentTime: currentTime,
		Duration:    duration,
		Volume:      b.volume,
		SourcePath:  activeSegment.SourcePath,
		EndEventID:  b.endEventID,
	}
}

func (b *AudioBackend) unloadTrackLocked() {
	b.stopStreamDecodeLocked()
	b.invalidatePendingQueuedTrackLocked()
	for index := range b.streamSegments {
		b.streamSegments[index].PCMData = nil
	}
	b.streamSegments = nil
	b.streamReadOffset = 0
	b.streamDroppedBytes = 0
	b.playStarted = time.Time{}
	b.playbackBaseBytes = 0
	b.playing = false
	b.playbackHeadroomLow = false
	b.endEventSent = false
	b.streamCond.Broadcast()
}
