package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"

	"github.com/metaisfacil/oto/v3"
)

var listAudioOutputDevices = oto.OutputDevices

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

// ListOutputDevices returns the audio output devices available on the current platform.
func (b *AudioBackend) ListOutputDevices() []AudioOutputDevice {
	devices, err := listAudioOutputDevices()
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
			SampleStride: 1,
			Samples:      []int16{},
		}
	}

	activeSegment, segmentOffset, _ := b.activeSegmentLocked()
	if len(activeSegment.PCMData) < audioBytesPerFrame {
		return AudioVisualizationFrame{
			Loaded:       state.Loaded,
			Playing:      state.Playing,
			SourcePath:   state.SourcePath,
			SampleRate:   audioSampleRate,
			ChannelCount: audioChannelCount,
			SampleStride: 1,
			Samples:      []int16{},
		}
	}

	normalizedFrameCount := normalizeVisualizationFrameCount(frameCount)
	totalFrames := len(activeSegment.PCMData) / audioBytesPerFrame

	actualFrameCount := normalizedFrameCount
	if totalFrames < actualFrameCount {
		actualFrameCount = totalFrames
	}

	windowFrames := normalizedFrameCount * visualizationWindowFactor
	if normalizedFrameCount >= longVisualizationFrameThreshold {
		longWindowFrames := int(float64(audioSampleRate) * longVisualizationWindowSeconds)
		if longWindowFrames > windowFrames {
			windowFrames = longWindowFrames
		}
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

	stride := 0.0
	if actualFrameCount > 1 && availableFrames > 1 {
		stride = float64(availableFrames-1) / float64(actualFrameCount-1)
	}
	sampleStride := 1.0
	if stride > 0 {
		sampleStride = math.Max(1, stride)
	}

	samples := make([]int16, actualFrameCount*audioChannelCount)
	peak := 0.0
	for index := 0; index < actualFrameCount; index++ {
		sourceFrame := startFrame
		if stride > 0 {
			sourceFrame = startFrame + int(math.Round(float64(index)*stride))
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
		SampleStride: sampleStride,
		Peak:         peak / 32768.0,
		Samples:      samples,
	}
}
