package main

import (
	"errors"
	"strings"
)

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

// InitializeAudioBackend initializes the audio backend and returns its current state.
func (a *App) InitializeAudioBackend() (AudioPlaybackState, error) {
	return profiledResult(a, "InitializeAudioBackend", func() (AudioPlaybackState, error) {
		backend := a.audioBackend()
		if err := backend.Initialize(); err != nil {
			return AudioPlaybackState{}, err
		}

		return backend.State(), nil
	})
}

// AudioLoadTrack loads a track path into the audio backend.
func (a *App) AudioLoadTrack(path string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioLoadTrack", func() (AudioPlaybackState, error) {
		return a.AudioLoadTrackWithReplayGainContext(path, nil)
	})
}

// AudioLoadTrackWithReplayGainContext loads a track path into the audio backend with optional release-aware ReplayGain context.
func (a *App) AudioLoadTrackWithReplayGainContext(path string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioLoadTrackWithReplayGainContext", func() (AudioPlaybackState, error) {
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

		return a.audioBackend().LoadTrackWithReplayGainContext(cleanPath, normalizedReplayGainReleasePaths)
	})
}

// AudioQueueNextTrack prepares or clears the next track used for seamless playback.
func (a *App) AudioQueueNextTrack(currentPath string, nextPath string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioQueueNextTrack", func() (AudioPlaybackState, error) {
		return a.AudioQueueNextTrackWithReplayGainContext(currentPath, nextPath, nil)
	})
}

// AudioQueueNextTrackWithReplayGainContext prepares or clears the next track using optional release-aware ReplayGain context.
func (a *App) AudioQueueNextTrackWithReplayGainContext(currentPath string, nextPath string, replayGainReleasePaths []string) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioQueueNextTrackWithReplayGainContext", func() (AudioPlaybackState, error) {
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

		return a.audioBackend().QueueNextTrackWithReplayGainContext(cleanCurrentPath, cleanNextPath, normalizedReplayGainReleasePaths)
	})
}

// AudioPlay starts playback of the currently loaded track.
func (a *App) AudioPlay() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioPlay", func() (AudioPlaybackState, error) {
		return a.audioBackend().Play()
	})
}

// AudioPause pauses playback of the currently loaded track.
func (a *App) AudioPause() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioPause", func() (AudioPlaybackState, error) {
		return a.audioBackend().Pause()
	})
}

// AudioStop stops playback and unloads the current track.
func (a *App) AudioStop() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioStop", func() (AudioPlaybackState, error) {
		return a.audioBackend().Stop()
	})
}

// AudioSeek moves playback to the given position in seconds.
func (a *App) AudioSeek(seconds float64) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioSeek", func() (AudioPlaybackState, error) {
		return a.audioBackend().Seek(seconds)
	})
}

// AudioSetVolume sets playback volume in the range [0, 1].
func (a *App) AudioSetVolume(volume float64) (AudioPlaybackState, error) {
	return profiledResult(a, "AudioSetVolume", func() (AudioPlaybackState, error) {
		return a.audioBackend().SetVolume(volume)
	})
}

// AudioGetState returns the current audio playback state.
func (a *App) AudioGetState() AudioPlaybackState {
	return profiledValue(a, "AudioGetState", func() AudioPlaybackState {
		return a.audioBackend().State()
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
		return a.audioBackend().ListOutputDevices()
	})
}

// AudioReinitializeBackend rebuilds the audio backend using the currently saved audio settings.
func (a *App) AudioReinitializeBackend() (AudioPlaybackState, error) {
	return profiledResult(a, "AudioReinitializeBackend", func() (AudioPlaybackState, error) {
		a.ensureSettingsLoaded()
		backend := a.audioBackend()
		backend.ApplyAudioSettings(a.settingsState().settings.Audio)
		if err := backend.Reinitialize(); err != nil {
			return AudioPlaybackState{}, err
		}

		return backend.State(), nil
	})
}
