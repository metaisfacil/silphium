package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/metaisfacil/oto/v3"
	taglib "go.senan.xyz/taglib"
)

const (
	audioSampleRate            = 44100
	audioChannelCount          = 2
	audioBytesPerFrame         = audioChannelCount * 2
	minVisualizationFrameCount = 64
	maxVisualizationFrameCount = 512
	visualizationWindowFactor  = 6
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
	SourcePath      string
	PCMData         []byte
	ReplayGainScale float64
}

func (s audioTrackSegment) byteLen() int64 {
	return int64(len(s.PCMData))
}

func (s audioTrackSegment) durationSeconds() float64 {
	return float64(len(s.PCMData)) / float64(audioBytesPerSecond)
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

func backendDisplayName(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "wasapi":
		return "WASAPI"
	case "winmm":
		return "WinMM"
	case "coreaudio":
		return "CoreAudio"
	case "pulseaudio":
		return "PulseAudio"
	case "webaudio":
		return "WebAudio"
	case "oboe":
		return "Oboe"
	case "console":
		return "Console"
	case "auto", "":
		return "Auto"
	default:
		return strings.ToUpper(strings.TrimSpace(raw))
	}
}

// AudioBackend manages decoded PCM playback and transport controls.
type AudioBackend struct {
	mutex                       sync.Mutex
	streamCond                  *sync.Cond
	ffmpegPath                  string
	context                     *oto.Context
	player                      *oto.Player
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
	return fmt.Sprintf(
		"loaded=%t playing=%t source=%q time=%.2f/%.2f queue=%d read=%d base=%d dropped=%d gapless=%t replayGain=%t",
		state.Loaded,
		state.Playing,
		state.SourcePath,
		state.CurrentTime,
		state.Duration,
		len(b.streamSegments),
		b.streamReadOffset,
		b.playbackBaseBytes,
		b.streamDroppedBytes,
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
	segmentIndex, _, ok := b.segmentForPlaybackOffsetLocked(playedLocalBytes)
	if !ok || segmentIndex < 0 || segmentIndex >= len(b.streamSegments) {
		if volume < 0 {
			return 0
		}
		return volume
	}

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

func (b *AudioBackend) flushPlayerBuffer(player *oto.Player) error {
	if player == nil {
		return nil
	}

	player.Pause()
	if _, err := player.Seek(0, io.SeekCurrent); err != nil {
		return fmt.Errorf("failed to resync audio buffer: %w", err)
	}

	return nil
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

	logAudioEvent(
		"ApplyAudioSettings device=%q buffer=%s gapless=%t replayGain=%t state=%s",
		b.outputDevice,
		b.outputBuffer,
		b.gaplessPlayback,
		b.replayGainEnabled,
		b.stateSummaryLocked(),
	)
}

// ListOutputDevices returns the audio output devices available on the current platform.
func (b *AudioBackend) ListOutputDevices() []AudioOutputDevice {
	devices, err := oto.OutputDevices()
	if err != nil || len(devices) == 0 {
		return []AudioOutputDevice{{
			ID:        defaultAudioOutputDevice,
			Name:      "Auto: System default output device",
			Backend:   "auto",
			IsDefault: true,
		}}
	}

	mapped := make([]AudioOutputDevice, 0, len(devices))
	for _, device := range devices {
		deviceID := strings.TrimSpace(device.ID)
		if deviceID == "" {
			continue
		}

		name := strings.TrimSpace(device.Name)
		if name == "" {
			name = deviceID
		}

		backend := strings.TrimSpace(string(device.Backend))
		name = fmt.Sprintf("%s: %s", backendDisplayName(backend), name)

		mapped = append(mapped, AudioOutputDevice{
			ID:        deviceID,
			Name:      name,
			Backend:   backend,
			IsDefault: device.IsDefault,
		})
	}

	if len(mapped) == 0 {
		return []AudioOutputDevice{{
			ID:        defaultAudioOutputDevice,
			Name:      "Auto: System default output device",
			Backend:   "auto",
			IsDefault: true,
		}}
	}

	return mapped
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

			if written > 0 {
				return written, nil
			}

			b.streamCond.Wait()
		}

		segmentIndex, segmentOffset, ok := b.segmentForByteOffsetLocked(b.streamReadOffset)
		if !ok {
			break
		}

		segment := b.streamSegments[segmentIndex]
		copied := copy(p[written:], segment.PCMData[segmentOffset:])
		if copied <= 0 {
			break
		}

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
			b.player.SetVolume(b.effectivePlayerVolumeLocked())
			logAudioEvent("Initialize attached player to existing context state=%s", b.stateSummaryLocked())
		}
		return nil
	}

	context, ready, err := oto.NewContext(&oto.NewContextOptions{
		SampleRate:   audioSampleRate,
		ChannelCount: audioChannelCount,
		Format:       oto.FormatSignedInt16LE,
		BufferSize:   b.outputBuffer,
		OutputDeviceID: func() string {
			if b.outputDevice == "" || b.outputDevice == defaultAudioOutputDevice {
				return ""
			}

			return b.outputDevice
		}(),
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
	b.player.SetVolume(b.effectivePlayerVolumeLocked())
	logAudioEvent("Initialize created context device=%q buffer=%s gapless=%t", b.outputDevice, b.outputBuffer, b.gaplessPlayback)
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

func parseITunSMPBValue(value string) (gaplessTrimInfo, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return gaplessTrimInfo{}, false
	}

	if separator := strings.Index(trimmed, "="); separator >= 0 {
		trimmed = strings.TrimSpace(trimmed[separator+1:])
	}

	fields := strings.Fields(trimmed)
	if len(fields) < 3 {
		return gaplessTrimInfo{}, false
	}

	leadSamples, err := strconv.ParseInt(fields[1], 16, 64)
	if err != nil || leadSamples < 0 {
		return gaplessTrimInfo{}, false
	}

	tailSamples, err := strconv.ParseInt(fields[2], 16, 64)
	if err != nil || tailSamples < 0 {
		return gaplessTrimInfo{}, false
	}

	return gaplessTrimInfo{
		LeadSamples: leadSamples,
		TailSamples: tailSamples,
	}, true
}

func readGaplessTrimInfoFromTags(tags map[string][]string) gaplessTrimInfo {
	if len(tags) == 0 {
		return gaplessTrimInfo{}
	}

	for key, values := range tags {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if !strings.Contains(normalizedKey, "itunsmpb") {
			continue
		}

		for _, value := range values {
			if parsed, ok := parseITunSMPBValue(value); ok {
				return parsed
			}
		}
	}

	return gaplessTrimInfo{
		LeadSamples: int64(parseIntValue(firstTagValue(tags, "ENC_DELAY", "ENCODER_DELAY"))),
		TailSamples: int64(parseIntValue(firstTagValue(tags, "ENC_PADDING", "ENCODER_PADDING"))),
	}
}

func trimPCMForGapless(decodedPCM []byte, trim gaplessTrimInfo) []byte {
	if len(decodedPCM) == 0 {
		return decodedPCM
	}

	leadBytes := trim.LeadSamples * int64(audioBytesPerFrame)
	tailBytes := trim.TailSamples * int64(audioBytesPerFrame)
	if leadBytes <= 0 && tailBytes <= 0 {
		return decodedPCM
	}

	if leadBytes < 0 {
		leadBytes = 0
	}
	if tailBytes < 0 {
		tailBytes = 0
	}

	totalBytes := int64(len(decodedPCM))
	if leadBytes > totalBytes {
		leadBytes = totalBytes
	}
	if tailBytes > totalBytes-leadBytes {
		tailBytes = totalBytes - leadBytes
	}

	start := leadBytes
	end := totalBytes - tailBytes
	if end <= start {
		return []byte{}
	}

	trimmed := make([]byte, end-start)
	copy(trimmed, decodedPCM[start:end])
	return trimmed
}

func (b *AudioBackend) prepareTrackSegment(path string, replayGainReleasePaths []string) (audioTrackSegment, error) {
	b.mutex.Lock()
	gaplessPlayback := b.gaplessPlayback
	replayGainEnabled := b.replayGainEnabled
	b.mutex.Unlock()

	var tags map[string][]string
	if gaplessPlayback {
		loadedTags, err := taglib.ReadTags(path)
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

	if err := b.seekLocked(seconds); err != nil {
		state := b.snapshotLocked()
		b.mutex.Unlock()
		return state, err
	}

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

func normalizeVisualizationFrameCount(frameCount int) int {
	if frameCount < minVisualizationFrameCount {
		return minVisualizationFrameCount
	}
	if frameCount > maxVisualizationFrameCount {
		return maxVisualizationFrameCount
	}
	return frameCount
}

// VisualizationFrame returns a decimated stereo sample window around the current playback position.
func (b *AudioBackend) VisualizationFrame(frameCount int) AudioVisualizationFrame {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.syncPlaybackLocked()
	state := b.snapshotLocked()
	if !state.Loaded {
		return AudioVisualizationFrame{
			Loaded:       false,
			Playing:      false,
			SampleRate:   audioSampleRate,
			ChannelCount: audioChannelCount,
			Samples:      []int16{},
		}
	}

	activeSegment, segmentOffset, ok := b.activeSegmentLocked()
	if !ok || len(activeSegment.PCMData) < audioBytesPerFrame {
		return AudioVisualizationFrame{
			Loaded:       state.Loaded,
			Playing:      state.Playing,
			SourcePath:   state.SourcePath,
			SampleRate:   audioSampleRate,
			ChannelCount: audioChannelCount,
			Samples:      []int16{},
		}
	}

	normalizedFrameCount := normalizeVisualizationFrameCount(frameCount)
	totalFrames := len(activeSegment.PCMData) / audioBytesPerFrame
	if totalFrames <= 0 {
		return AudioVisualizationFrame{
			Loaded:       state.Loaded,
			Playing:      state.Playing,
			SourcePath:   activeSegment.SourcePath,
			SampleRate:   audioSampleRate,
			ChannelCount: audioChannelCount,
			Samples:      []int16{},
		}
	}

	actualFrameCount := normalizedFrameCount
	if totalFrames < actualFrameCount {
		actualFrameCount = totalFrames
	}

	windowFrames := normalizedFrameCount * visualizationWindowFactor
	if windowFrames < actualFrameCount {
		windowFrames = actualFrameCount
	}
	if windowFrames > totalFrames {
		windowFrames = totalFrames
	}

	currentFrame := int(segmentOffset / int64(audioBytesPerFrame))
	endFrame := currentFrame
	if endFrame <= 0 {
		endFrame = windowFrames
	}
	if endFrame > totalFrames {
		endFrame = totalFrames
	}

	startFrame := endFrame - windowFrames
	if startFrame < 0 {
		startFrame = 0
	}

	availableFrames := endFrame - startFrame
	if availableFrames <= 0 {
		startFrame = 0
		availableFrames = totalFrames
		endFrame = totalFrames
	}

	stride := 0.0
	if actualFrameCount > 1 && availableFrames > 1 {
		stride = float64(availableFrames-1) / float64(actualFrameCount-1)
	}

	samples := make([]int16, actualFrameCount*audioChannelCount)
	peak := 0.0
	for index := 0; index < actualFrameCount; index++ {
		sourceFrame := startFrame
		if stride > 0 {
			sourceFrame = startFrame + int(math.Round(float64(index)*stride))
		}
		if sourceFrame >= endFrame {
			sourceFrame = endFrame - 1
		}
		if sourceFrame < 0 {
			sourceFrame = 0
		}

		byteOffset := sourceFrame * audioBytesPerFrame
		left := int16(binary.LittleEndian.Uint16(activeSegment.PCMData[byteOffset : byteOffset+2]))
		right := int16(binary.LittleEndian.Uint16(activeSegment.PCMData[byteOffset+2 : byteOffset+4]))
		samples[index*2] = left
		samples[index*2+1] = right

		peak = math.Max(peak, math.Abs(float64(left)))
		peak = math.Max(peak, math.Abs(float64(right)))
	}

	return AudioVisualizationFrame{
		Loaded:       state.Loaded,
		Playing:      state.Playing,
		SourcePath:   activeSegment.SourcePath,
		SampleRate:   audioSampleRate,
		ChannelCount: audioChannelCount,
		FrameCount:   actualFrameCount,
		Peak:         peak / 32768.0,
		Samples:      samples,
	}
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
	if byteOffset < 0 {
		byteOffset = 0
	}
	if byteOffset > activeSegment.byteLen() {
		byteOffset = activeSegment.byteLen()
	}

	if activeSegmentIndex > 0 {
		for index := 0; index < activeSegmentIndex; index++ {
			b.streamSegments[index].PCMData = nil
		}
		b.streamSegments = append([]audioTrackSegment(nil), b.streamSegments[activeSegmentIndex:]...)
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

func (b *AudioBackend) decodeTrack(path string, volumeScale float64) ([]byte, error) {
	if !isFiniteFloat64(volumeScale) || volumeScale <= 0 {
		volumeScale = 1
	}

	args := []string{
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-i", path,
	}
	if math.Abs(volumeScale-1) > 0.000001 {
		args = append(args, "-filter:a", fmt.Sprintf("volume=%.10f", volumeScale))
	}
	args = append(args,
		"-f", "s16le",
		"-acodec", "pcm_s16le",
		"-ac", "2",
		"-ar", "44100",
		"pipe:1",
	)

	command := exec.Command(b.ffmpegPath, args...)
	configureHiddenUtilityCommand(command)

	output, err := command.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
			return nil, fmt.Errorf("ffmpeg decode failed: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return nil, fmt.Errorf("ffmpeg decode failed: %w", err)
	}

	if len(output) == 0 {
		return nil, errors.New("ffmpeg decode failed: empty decoded stream")
	}

	return output, nil
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

	maxReadableGlobalBytes := b.streamDroppedBytes + b.streamReadOffset
	if playedBytes > maxReadableGlobalBytes {
		playedBytes = maxReadableGlobalBytes
	}

	totalGlobalBytes := b.streamDroppedBytes + b.totalTimelineBytesLocked()
	if playedBytes > totalGlobalBytes {
		playedBytes = totalGlobalBytes
	}

	return playedBytes
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

	totalTimelineBytes := b.totalTimelineBytesLocked()
	if playedLocalBytes > totalTimelineBytes {
		return totalTimelineBytes
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
	segmentIndex, segmentOffset, ok := b.segmentForPlaybackOffsetLocked(playedLocalBytes)
	if !ok {
		segmentIndex = len(b.streamSegments) - 1
		segmentOffset = b.streamSegments[segmentIndex].byteLen()
	}

	activeSegment := b.streamSegments[segmentIndex]
	currentTime := float64(segmentOffset) / float64(audioBytesPerSecond)
	duration := activeSegment.durationSeconds()
	if currentTime < 0 {
		currentTime = 0
	}
	if currentTime > duration {
		currentTime = duration
	}

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
	for index := range b.streamSegments {
		b.streamSegments[index].PCMData = nil
	}
	b.streamSegments = nil
	b.streamReadOffset = 0
	b.streamDroppedBytes = 0
	b.playStarted = time.Time{}
	b.playbackBaseBytes = 0
	b.playing = false
	b.endEventSent = false
	b.streamCond.Broadcast()
}
