package main

import (
	"errors"
	"fmt"
	"strings"
)

func (a *App) audioLoadDecodeHints(path string) audioDecodeHints {
	hints := audioDecodeHints{}
	signature, ok := trackTagsFileSignatureForPath(path)
	if !ok {
		return hints
	}

	if cachedTags, cachedHasMetadata, cacheHit := a.getTrackTagsCache(path, signature); cacheHit && cachedHasMetadata && cachedTags.DurationSecs > 0 {
		return audioDecodeHints{
			ExpectedDurationSeconds: cachedTags.DurationSecs,
			Progressive:             true,
		}
	}

	if !a.localLibraryFilesDatabaseEnabled() {
		return hints
	}

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()

	a.ensureMusicBrainzTagDatabaseLoadedLocked()
	record, exists := a.musicBrainzTagStore.Tracks[path]
	if !exists || record.Signature != signature || record.DurationSeconds <= 0 {
		return hints
	}

	return audioDecodeHints{
		ExpectedDurationSeconds: record.DurationSeconds,
		Progressive:             true,
	}
}

func (a *App) normalizeReplayGainContextPaths(paths []string, requiredPath string) ([]string, error) {
	trimmedRequiredPath := strings.TrimSpace(requiredPath)
	normalized := make([]string, 0, len(paths)+1)
	seen := make(map[string]struct{}, len(paths)+1)

	appendPath := func(rawPath string) error {
		cleanPath := normalizePath(rawPath)
		if cleanPath == "" {
			return nil
		}
		if !a.isAllowedLibraryPath(cleanPath) {
			return errors.New("replaygain context path is outside the selected library")
		}

		normalizedKey := strings.ToLower(cleanPath)
		if _, exists := seen[normalizedKey]; exists {
			return nil
		}

		seen[normalizedKey] = struct{}{}
		normalized = append(normalized, cleanPath)
		return nil
	}

	if trimmedRequiredPath != "" {
		if err := appendPath(trimmedRequiredPath); err != nil {
			return nil, err
		}
	}

	for _, path := range paths {
		if err := appendPath(path); err != nil {
			return nil, err
		}
	}

	return normalized, nil
}

func (a *App) audioLoadTrackWithReplayGainContext(path string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return AudioPlaybackState{}, errors.New("track path is required")
	}

	if !a.isAllowedLibraryPath(cleanPath) {
		return AudioPlaybackState{}, errors.New("track path is outside the selected library")
	}

	normalizedReplayGainReleasePaths, err := a.normalizeReplayGainContextPaths(replayGainReleasePaths, cleanPath)
	if err != nil {
		return AudioPlaybackState{}, err
	}

	return a.audioBackend().loadTrackFromDecodeSource(cleanPath, cleanPath, nil, normalizedReplayGainReleasePaths, a.audioLoadDecodeHints(cleanPath))
}

func (a *App) audioQueueNextTrackWithReplayGainContext(currentPath string, nextPath string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	trimmedCurrentPath := strings.TrimSpace(currentPath)
	trimmedNextPath := strings.TrimSpace(nextPath)

	cleanCurrentPath := ""
	if trimmedCurrentPath != "" {
		cleanCurrentPath = normalizePath(trimmedCurrentPath)
	}

	cleanNextPath := ""
	if trimmedNextPath != "" {
		cleanNextPath = normalizePath(trimmedNextPath)
	}

	if cleanCurrentPath != "" && !a.isAllowedLibraryPath(cleanCurrentPath) {
		return AudioPlaybackState{}, errors.New("current track path is outside the selected library")
	}

	if cleanNextPath != "" && !a.isAllowedLibraryPath(cleanNextPath) {
		return AudioPlaybackState{}, errors.New("next track path is outside the selected library")
	}

	normalizedReplayGainReleasePaths, err := a.normalizeReplayGainContextPaths(replayGainReleasePaths, cleanNextPath)
	if err != nil {
		return AudioPlaybackState{}, err
	}

	return a.audioBackend().queueNextTrackFromDecodeSource(cleanCurrentPath, cleanNextPath, cleanNextPath, nil, normalizedReplayGainReleasePaths, a.audioLoadDecodeHints(cleanNextPath))
}

// InitializeAudioBackend initializes the audio backend and returns its current state.
func (a *App) InitializeAudioBackend() (AudioPlaybackState, error) {
	return profiledResult(a, "InitializeAudioBackend", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "InitializeAudioBackend", "")
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		backend := a.audioBackend()
		if err = backend.Initialize(); err != nil {
			return AudioPlaybackState{}, err
		}

		state = backend.State()
		a.syncSystemMediaTransportControlsAfterAudioCall(state, nil)
		return state, nil
	})
}

// AudioLoadTrack loads a track path into the audio backend.
func (a *App) AudioLoadTrack(path string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioLoadTrack", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioLoadTrack", "path="+bridgeTraceLogString(path))
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioLoadTrackWithReplayGainContext(path, nil)
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioLoadTrackWithReplayGainContext loads a track path into the audio backend with optional release-aware ReplayGain context.
func (a *App) AudioLoadTrackWithReplayGainContext(path string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioLoadTrackWithReplayGainContext", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace(
			"transport",
			"AudioLoadTrackWithReplayGainContext",
			"path="+bridgeTraceLogString(path)+" replayGainReleasePaths="+bridgeTraceLogStringSlice(replayGainReleasePaths),
		)
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioLoadTrackWithReplayGainContext(path, replayGainReleasePaths)
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioQueueNextTrack prepares or clears the immediate next track for transition reuse.
func (a *App) AudioQueueNextTrack(currentPath string, nextPath string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioQueueNextTrack", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace(
			"transport",
			"AudioQueueNextTrack",
			"currentPath="+bridgeTraceLogString(currentPath)+" nextPath="+bridgeTraceLogString(nextPath),
		)
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioQueueNextTrackWithReplayGainContext(currentPath, nextPath, nil)
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioQueueNextTrackWithReplayGainContext prepares or clears the immediate next track using optional release-aware ReplayGain context.
func (a *App) AudioQueueNextTrackWithReplayGainContext(currentPath string, nextPath string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioQueueNextTrackWithReplayGainContext", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace(
			"transport",
			"AudioQueueNextTrackWithReplayGainContext",
			"currentPath="+bridgeTraceLogString(currentPath)+" nextPath="+bridgeTraceLogString(nextPath)+" replayGainReleasePaths="+bridgeTraceLogStringSlice(replayGainReleasePaths),
		)
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioQueueNextTrackWithReplayGainContext(currentPath, nextPath, replayGainReleasePaths)
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioPlay starts playback of the currently loaded track.
func (a *App) AudioPlay() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioPlay", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioPlay", "")
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioBackend().Play()
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioPause pauses playback of the currently loaded track.
func (a *App) AudioPause() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioPause", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioPause", "")
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioBackend().Pause()
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioStop stops playback and unloads the current track.
func (a *App) AudioStop() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioStop", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioStop", "")
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioBackend().Stop()
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioSeek moves playback to the given position in seconds.
func (a *App) AudioSeek(seconds float64) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioSeek", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioSeek", fmt.Sprintf("seconds=%.3f", seconds))
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioBackend().Seek(seconds)
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioSetVolume sets playback volume in the range [0, 1].
func (a *App) AudioSetVolume(volume float64) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioSetVolume", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioSetVolume", fmt.Sprintf("volume=%.3f", volume))
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		state, err = a.audioBackend().SetVolume(volume)
		a.syncSystemMediaTransportControlsAfterAudioCall(state, err)
		return state, err
	})
}

// AudioGetState returns the current audio playback state.
func (a *App) AudioGetState() AudioPlaybackState {
	return profiledValue(a, "AudioGetState", func() AudioPlaybackState {
		trace := a.beginBridgeTrace("transport", "AudioGetState", "")
		state := a.audioBackend().State()
		a.syncSystemMediaTransportControlsState(state)
		trace.finish(audioPlaybackStateForLog(state), nil)
		return state
	})
}

// AudioGetVisualizationFrame returns a decimated stereo sample window for frontend visualizations.
func (a *App) AudioGetVisualizationFrame(frameCount int) AudioVisualizationFrame {
	return profiledValue(a, "AudioGetVisualizationFrame", func() AudioVisualizationFrame {
		return a.audioBackend().VisualizationFrame(frameCount)
	})
}

// AudioListOutputDevices returns available audio output devices.
func (a *App) AudioListOutputDevices() []AudioOutputDevice {
	return profiledValue(a, "AudioListOutputDevices", func() []AudioOutputDevice {
		trace := a.beginBridgeTrace("transport", "AudioListOutputDevices", "")
		devices := a.audioBackend().ListOutputDevices()
		trace.finish(fmt.Sprintf("devices=%d", len(devices)), nil)
		return devices
	})
}

// AudioReinitializeBackend rebuilds the audio backend using the currently saved audio settings.
func (a *App) AudioReinitializeBackend() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioReinitializeBackend", func() (state AudioPlaybackState, err error) {
		trace := a.beginBridgeTrace("transport", "AudioReinitializeBackend", "")
		defer func() {
			trace.finish(audioPlaybackStateForLog(state), err)
		}()

		a.ensureSettingsLoaded()
		backend := a.audioBackend()
		backend.ApplyAudioSettings(a.settingsState().settings.Audio)
		if err = backend.Reinitialize(); err != nil {
			return AudioPlaybackState{}, err
		}

		state = backend.State()
		a.syncSystemMediaTransportControlsAfterAudioCall(state, nil)
		return state, nil
	})
}
