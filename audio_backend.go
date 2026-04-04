package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/metaisfacil/oto/v3"
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
	mutex        sync.Mutex
	ffmpegPath   string
	context      *oto.Context
	player       *oto.Player
	pcmData      []byte
	sourcePath   string
	duration     float64
	position     float64
	playStarted  time.Time
	playing      bool
	volume       float64
	endEventID   uint64
	outputDevice string
	outputBuffer time.Duration
}

// NewAudioBackend creates an audio backend with default playback volume.
func NewAudioBackend() *AudioBackend {
	return &AudioBackend{
		volume:       0.8,
		outputDevice: defaultAudioOutputDevice,
	}
}

func (b *AudioBackend) ApplyAudioSettings(settings AudioSettings) {
	b.mutex.Lock()
	defer b.mutex.Unlock()

	normalized := normalizeAudioSettings(settings)
	b.outputDevice = normalized.OutputDevice
	b.outputBuffer = time.Duration(normalized.OutputBufferMs) * time.Millisecond
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
	return nil
}

// LoadTrack decodes and loads a track into the playback backend.
func (b *AudioBackend) LoadTrack(path string) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	decodedPCM, err := b.decodeTrack(path)
	if err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.unloadTrackLocked()

	source := bytes.NewReader(decodedPCM)
	player := b.context.NewPlayer(source)
	player.SetVolume(b.volume)

	b.player = player
	b.pcmData = decodedPCM
	b.sourcePath = path
	b.duration = float64(len(decodedPCM)) / float64(audioBytesPerSecond)
	b.position = 0
	b.playStarted = time.Time{}
	b.playing = false

	return b.snapshotLocked(), nil
}

// Play starts playback of the currently loaded track.
func (b *AudioBackend) Play() (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	if b.player == nil {
		return b.snapshotLocked(), errors.New("no track loaded")
	}

	b.syncPositionLocked()
	if b.duration > 0 && b.position >= b.duration {
		if err := b.seekLocked(0); err != nil {
			return b.snapshotLocked(), err
		}
	}

	b.player.Play()
	if b.player.Err() != nil {
		return b.snapshotLocked(), fmt.Errorf("audio playback failed: %w", b.player.Err())
	}

	b.playing = true
	b.playStarted = time.Now()
	return b.snapshotLocked(), nil
}

// Pause pauses playback of the currently loaded track.
func (b *AudioBackend) Pause() (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	if b.player == nil {
		return b.snapshotLocked(), errors.New("no track loaded")
	}

	b.syncPositionLocked()
	b.player.Pause()
	b.playing = false
	b.playStarted = time.Time{}

	return b.snapshotLocked(), nil
}

// Stop stops playback and unloads the current track.
func (b *AudioBackend) Stop() (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	b.unloadTrackLocked()
	return b.snapshotLocked(), nil
}

// Seek updates playback position in seconds.
func (b *AudioBackend) Seek(seconds float64) (AudioPlaybackState, error) {
	if err := b.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	b.mutex.Lock()
	defer b.mutex.Unlock()

	if b.player == nil {
		return b.snapshotLocked(), errors.New("no track loaded")
	}

	if err := b.seekLocked(seconds); err != nil {
		return b.snapshotLocked(), err
	}

	return b.snapshotLocked(), nil
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

	b.syncPositionLocked()
	return b.snapshotLocked()
}

func (b *AudioBackend) seekLocked(seconds float64) error {
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		seconds = 0
	}

	if seconds < 0 {
		seconds = 0
	}
	if seconds > b.duration {
		seconds = b.duration
	}

	byteOffset := int64(seconds * float64(audioBytesPerSecond))
	byteOffset -= byteOffset % int64(audioBytesPerFrame)

	if _, err := b.player.Seek(byteOffset, io.SeekStart); err != nil {
		return fmt.Errorf("failed to seek: %w", err)
	}

	b.position = float64(byteOffset) / float64(audioBytesPerSecond)
	if b.playing {
		b.playStarted = time.Now()
	} else {
		b.playStarted = time.Time{}
	}

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

func (b *AudioBackend) syncPositionLocked() {
	if !b.playing {
		return
	}

	elapsed := time.Since(b.playStarted).Seconds()
	if elapsed <= 0 {
		return
	}

	b.position += elapsed
	b.playStarted = time.Now()

	if b.position >= b.duration {
		b.position = b.duration
		b.playing = false
		b.playStarted = time.Time{}
		b.endEventID++
		if b.player != nil {
			b.player.Pause()
		}
	}
}

func (b *AudioBackend) snapshotLocked() AudioPlaybackState {
	currentTime := b.position
	if currentTime < 0 {
		currentTime = 0
	}
	if currentTime > b.duration {
		currentTime = b.duration
	}

	return AudioPlaybackState{
		Loaded:      b.player != nil,
		Playing:     b.playing,
		CurrentTime: currentTime,
		Duration:    b.duration,
		Volume:      b.volume,
		SourcePath:  b.sourcePath,
		EndEventID:  b.endEventID,
	}
}

func (b *AudioBackend) unloadTrackLocked() {
	if b.player != nil {
		_ = b.player.Close()
		b.player = nil
	}

	b.pcmData = nil
	b.sourcePath = ""
	b.duration = 0
	b.position = 0
	b.playStarted = time.Time{}
	b.playing = false
}
