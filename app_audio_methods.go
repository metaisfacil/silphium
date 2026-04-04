package main

import "errors"

// InitializeAudioBackend initializes the audio backend and returns its current state.
func (a *App) InitializeAudioBackend() (AudioPlaybackState, error) {
	backend := a.audioBackend()
	if err := backend.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	return backend.State(), nil
}

// AudioLoadTrack loads a track path into the audio backend.
func (a *App) AudioLoadTrack(path string) (AudioPlaybackState, error) {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return AudioPlaybackState{}, errors.New("track path is required")
	}

	if !a.isAllowedLibraryPath(cleanPath) {
		return AudioPlaybackState{}, errors.New("track path is outside the selected library")
	}

	return a.audioBackend().LoadTrack(cleanPath)
}

// AudioPlay starts playback of the currently loaded track.
func (a *App) AudioPlay() (AudioPlaybackState, error) {
	return a.audioBackend().Play()
}

// AudioPause pauses playback of the currently loaded track.
func (a *App) AudioPause() (AudioPlaybackState, error) {
	return a.audioBackend().Pause()
}

// AudioStop stops playback and unloads the current track.
func (a *App) AudioStop() (AudioPlaybackState, error) {
	return a.audioBackend().Stop()
}

// AudioSeek moves playback to the given position in seconds.
func (a *App) AudioSeek(seconds float64) (AudioPlaybackState, error) {
	return a.audioBackend().Seek(seconds)
}

// AudioSetVolume sets playback volume in the range [0, 1].
func (a *App) AudioSetVolume(volume float64) (AudioPlaybackState, error) {
	return a.audioBackend().SetVolume(volume)
}

// AudioGetState returns the current audio playback state.
func (a *App) AudioGetState() AudioPlaybackState {
	return a.audioBackend().State()
}

// AudioListOutputDevices returns available audio output devices.
func (a *App) AudioListOutputDevices() []AudioOutputDevice {
	return a.audioBackend().ListOutputDevices()
}

// AudioReinitializeBackend rebuilds the audio backend using the currently saved audio settings.
func (a *App) AudioReinitializeBackend() (AudioPlaybackState, error) {
	a.ensureSettingsLoaded()
	backend := a.audioBackend()
	backend.ApplyAudioSettings(a.settings.Audio)

	backend.mutex.Lock()
	initialized := backend.context != nil
	backend.mutex.Unlock()

	if !initialized {
		if err := backend.Initialize(); err != nil {
			return AudioPlaybackState{}, err
		}
	}

	return backend.State(), nil
}
