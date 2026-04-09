//go:build windows

package main

import (
	"context"
	"testing"
	"time"
)

func TestMediaKeyWatcherAndEmitter(t *testing.T) {
	originalGetAsyncKeyState := getAsyncKeyState
	originalPollInterval := mediaKeyWatcherPollInterval
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		getAsyncKeyState = originalGetAsyncKeyState
		mediaKeyWatcherPollInterval = originalPollInterval
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	_ = originalGetAsyncKeyState(vkMediaPlayPause)

	getAsyncKeyState = func(vk int32) uintptr {
		if vk == vkMediaPlayPause {
			return 1
		}
		return 0
	}
	if !virtualKeyPressedSinceLastPoll(vkMediaPlayPause) {
		t.Fatal("virtualKeyPressedSinceLastPoll(playpause) = false, want true")
	}
	if virtualKeyPressedSinceLastPoll(vkMediaNextTrack) {
		t.Fatal("virtualKeyPressedSinceLastPoll(next) = true, want false")
	}

	app := &App{}
	app.emitMediaKeyAction("playpause")

	mediaKeyWatcherPollInterval = time.Millisecond
	pressedByKey := map[int32]int{
		vkMediaPlayPause: 1,
		vkMediaNextTrack: 1,
		vkMediaPrevTrack: 1,
		vkMediaStop:      1,
	}
	events := make(chan string, 8)
	getAsyncKeyState = func(vk int32) uintptr {
		if pressedByKey[vk] > 0 {
			pressedByKey[vk]--
			return 1
		}
		return 0
	}
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == mediaKeyEvent && len(optionalData) > 0 {
			events <- optionalData[0].(string)
		}
	}
	app.ctx = context.Background()
	app.startMediaKeyWatcher()
	watcherState := app.mediaKeyWatcherState()
	firstStop := watcherState.stopCh
	app.startMediaKeyWatcher()
	if watcherState.stopCh != firstStop {
		t.Fatal("startMediaKeyWatcher() should not replace an already-running watcher")
	}

	seen := map[string]bool{}
	deadline := time.After(time.Second)
	for len(seen) < 4 {
		select {
		case action := <-events:
			seen[action] = true
		case <-deadline:
			t.Fatalf("timed out waiting for media key events, saw %#v", seen)
		}
	}

	app.stopMediaKeyWatcher()
	if watcherState.stopCh != nil || watcherState.doneCh != nil {
		t.Fatal("stopMediaKeyWatcher() should clear watcher channels")
	}
	if !seen["playpause"] || !seen["next"] || !seen["previous"] || !seen["stop"] {
		t.Fatalf("media key events = %#v, want all four transport actions", seen)
	}

	app.stopMediaKeyWatcher()
}
