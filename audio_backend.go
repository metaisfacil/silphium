package main

import (
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
	audioSampleRate    = 44100
	audioChannelCount  = 2
	audioBytesPerFrame = audioChannelCount * 2
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

type AudioOutputDevice struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Backend   string `json:"backend"`
	IsDefault bool   `json:"isDefault"`
}

type audioTrackSegment struct {
	SourcePath string
	PCMData    []byte
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
	log.Println(fmt.Sprintf("[%s] [AUDIO] %s", timestamp, formattedMessage))
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
	mutex              sync.Mutex
	streamCond         *sync.Cond
	ffmpegPath         string
	context            *oto.Context
	player             *oto.Player
	streamSegments     []audioTrackSegment
	streamReadOffset   int64
	streamDroppedBytes int64
	playStarted        time.Time
	playbackBaseBytes  int64
	playing            bool
	volume             float64
	endEventID         uint64
	endEventSent       bool
	outputDevice       string
	outputBuffer       time.Duration
	gaplessPlayback    bool
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
		"loaded=%t playing=%t source=%q time=%.2f/%.2f queue=%d read=%d base=%d dropped=%d gapless=%t",
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
	)
}

func (b *AudioBackend) ApplyAudioSettings(settings AudioSettings) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	normalized := normalizeAudioSettings(settings)
	b.outputDevice = normalized.OutputDevice
	b.outputBuffer = time.Duration(normalized.OutputBufferMs) * time.Millisecond
	b.gaplessPlayback = normalized.GaplessPlayback
	if !b.gaplessPlayback {
		b.trimConsumedSegmentsLocked(b.currentPlayedGlobalBytesLocked())
		b.clearFutureQueueLocked()
	}

	logAudioEvent(
		"ApplyAudioSettings device=%q buffer=%s gapless=%t state=%s",
		b.outputDevice,
		b.outputBuffer,
		b.gaplessPlayback,
		b.stateSummaryLocked(),
	)
}

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

// Initialize prepares ffmpeg and the audio output context.
func (b *AudioBackend) Initialize() error {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	if b.ffmpegPath == "" {
		ffmpegPath, err := exec.LookPath("ffmpeg")
		if err != nil {
			return errors.New("ffmpeg executable was not found in PATH")
		}
		b.ffmpegPath = ffmpegPath
	}

	if b.context != nil {
		if b.player == nil {
			b.player = b.context.NewPlayer(b)
			b.player.SetVolume(b.volume)
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
	b.player = context.NewPlayer(b)
	b.player.SetVolume(b.volume)
	logAudioEvent("Initialize created context device=%q buffer=%s gapless=%t", b.outputDevice, b.outputBuffer, b.gaplessPlayback)
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

func readGaplessTrimInfo(path string) gaplessTrimInfo {
	tags, err := taglib.ReadTags(path)
	if err != nil {
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

func (b *AudioBackend) prepareTrackSegment(path string) (audioTrackSegment, error) {
	b.mutex.Lock()
	gaplessPlayback := b.gaplessPlayback
	b.mutex.Unlock()

	decodedPCM, err := b.decodeTrack(path)
	if err != nil {
		return audioTrackSegment{}, err
	}

	if gaplessPlayback {
		trimInfo := readGaplessTrimInfo(path)
		decodedPCM = trimPCMForGapless(decodedPCM, trimInfo)
		if trimInfo.LeadSamples > 0 || trimInfo.TailSamples > 0 {
			logAudioEvent("prepareTrackSegment path=%q leadSamples=%d tailSamples=%d trimmedBytes=%d", path, trimInfo.LeadSamples, trimInfo.TailSamples, len(decodedPCM))
		}
	}

	return audioTrackSegment{
		SourcePath: path,
		PCMData:    decodedPCM,
	}, nil
}

// LoadTrack decodes and loads a track into the playback backend.
func (b *AudioBackend) LoadTrack(path string) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	segment, err := b.prepareTrackSegment(path)
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
		b.player.SetVolume(b.volume)
	}
	b.streamCond.Broadcast()
	state := b.snapshotLocked()
	summary := b.stateSummaryLocked()
	b.mutex.Unlock()

	if player != nil {
		player.Reset()
	}

	logAudioEvent("LoadTrack path=%q bytes=%d state=%s", path, len(segment.PCMData), summary)

	return state, nil
}

// QueueNextTrack prepares the immediate next track for seamless playback.
func (b *AudioBackend) QueueNextTrack(afterPath string, nextPath string) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	trimmedAfterPath := strings.TrimSpace(afterPath)
	trimmedNextPath := strings.TrimSpace(nextPath)

	var nextSegment audioTrackSegment
	var err error
	if trimmedNextPath != "" {
		nextSegment, err = b.prepareTrackSegment(trimmedNextPath)
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

	if shouldReset && player != nil {
		player.Reset()
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

	if player != nil {
		player.Pause()
		player.Reset()
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
		player.Reset()
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
		b.player.SetVolume(volume)
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

func (b *AudioBackend) decodeTrack(path string) ([]byte, error) {
	command := exec.Command(
		b.ffmpegPath,
		"-nostdin",
		"-hide_banner",
		"-loglevel", "error",
		"-i", path,
		"-f", "s16le",
		"-acodec", "pcm_s16le",
		"-ac", "2",
		"-ar", "44100",
		"pipe:1",
	)

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

	if playedBytes > b.streamReadOffset {
		playedBytes = b.streamReadOffset
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
