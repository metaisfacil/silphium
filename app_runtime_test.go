package main

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
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
	if !app.beforeClose(context.Background()) {
		t.Fatal("beforeClose(minimize enabled) = false, want true")
	}
	if !windowHidden {
		t.Fatal("beforeClose(minimize enabled) should hide the window")
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
	if app.mediaKeyWatcherStop == nil || app.musicBrainzTagWorkerWake == nil {
		t.Fatal("startup() should initialize background workers")
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
