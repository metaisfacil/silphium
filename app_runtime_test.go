package main

import (
	"context"
	"errors"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestAppRuntimeHelpers(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	originalRuntimeWindowHide := runtimeWindowHide
	emittedEventName := ""
	windowHidden := false
	runtimeEventsEmit = func(_ context.Context, eventName string, _ ...interface{}) {
		emittedEventName = eventName
	}
	runtimeWindowHide = func(_ context.Context) {
		windowHidden = true
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
		runtimeWindowHide = originalRuntimeWindowHide
	})

	app := &App{ctx: context.Background()}
	app.logRescanEvent("hello %s", "world")
	if emittedEventName != libraryRescanLogEvent {
		t.Fatalf("logRescanEvent() emitted %q, want %q", emittedEventName, libraryRescanLogEvent)
	}

	backend := app.audioBackend()
	if backend == nil || app.audioBackend() != backend {
		t.Fatal("audioBackend() should lazily allocate and reuse the backend")
	}

	originalVersion := AppVersion
	AppVersion = "1.2.3"
	t.Cleanup(func() {
		AppVersion = originalVersion
	})
	if got := app.GetAppVersion(); got != "1.2.3" {
		t.Fatalf("GetAppVersion() = %q, want %q", got, "1.2.3")
	}

	app.quitRequested.Store(true)
	if app.beforeClose(context.Background()) {
		t.Fatal("beforeClose(quit requested) = true, want false")
	}
	app.quitRequested.Store(false)
	app.settingsLoaded = true
	app.settings.MinimizeToTrayOnClose = false
	if app.beforeClose(context.Background()) {
		t.Fatal("beforeClose(minimize disabled) = true, want false")
	}
	app.settings.MinimizeToTrayOnClose = true
	if runtime.GOOS == "windows" {
		if !app.beforeClose(context.Background()) {
			t.Fatal("beforeClose(minimize enabled) = false, want true")
		}
		if !windowHidden {
			t.Fatal("beforeClose(minimize enabled) should hide the window")
		}
	} else {
		if app.beforeClose(context.Background()) {
			t.Fatal("beforeClose(minimize enabled) = true, want false on non-Windows platforms")
		}
		if windowHidden {
			t.Fatal("beforeClose(minimize enabled) should not hide the window on non-Windows platforms")
		}
	}

	app.LogFrontendMessage("hello from frontend")
}

func TestAppStartupAndShutdown(t *testing.T) {
	app := NewApp()
	app.settingsPath = filepath.Join(t.TempDir(), appSettingsFileName)
	app.startup(context.Background())
	if app.ctx == nil {
		t.Fatal("startup() should capture the app context")
	}
	if !app.settingsLoaded {
		t.Fatal("startup() should mark settings as loaded")
	}
	if app.musicBrainzTagWorkerWake == nil {
		t.Fatal("startup() should initialize the MusicBrainz background worker")
	}
	if runtime.GOOS == "windows" && app.mediaKeyWatcherStop == nil {
		t.Fatal("startup() should initialize the media key watcher on Windows")
	}

	app.shutdown(context.Background())
	if !app.quitRequested.Load() {
		t.Fatal("shutdown() should mark quitRequested")
	}
	if app.mediaKeyWatcherStop != nil || app.musicBrainzTagWorkerWake != nil {
		t.Fatal("shutdown() should stop background workers")
	}

	closeErrorApp := &App{audio: NewAudioBackend()}
	closeErrorApp.audio.context = &fakeAudioContext{closeErr: errors.New("close failed")}
	closeErrorApp.shutdown(context.Background())
	if !closeErrorApp.quitRequested.Load() {
		t.Fatal("shutdown(close error) should still mark quitRequested")
	}
	if closeErrorApp.audio.context != nil {
		t.Fatal("shutdown(close error) should clear the audio context")
	}
}

func TestShutdownDoesNotBlockOnMusicBrainzWorkerStop(t *testing.T) {
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	app := &App{
		audio:                    NewAudioBackend(),
		musicBrainzTagWorkerStop: stopCh,
		musicBrainzTagWorkerDone: doneCh,
	}
	app.audio.context = &fakeAudioContext{}

	originalTimeout := musicBrainzTagWorkerStopTimeout
	musicBrainzTagWorkerStopTimeout = 10 * time.Millisecond
	t.Cleanup(func() {
		musicBrainzTagWorkerStopTimeout = originalTimeout
	})

	shutdownDone := make(chan struct{})
	go func() {
		app.shutdown(context.Background())
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("shutdown() timed out waiting for MusicBrainz worker stop")
	}

	if !app.quitRequested.Load() {
		t.Fatal("shutdown() should mark quitRequested")
	}
	if app.audio.context != nil {
		t.Fatal("shutdown() should close and clear the audio context")
	}
	if app.musicBrainzTagWorkerStop != nil || app.musicBrainzTagWorkerDone != nil || app.musicBrainzTagWorkerWake != nil {
		t.Fatal("shutdown() should clear MusicBrainz worker channels")
	}

	select {
	case <-stopCh:
	default:
		t.Fatal("shutdown() should close the MusicBrainz worker stop channel")
	}
}
