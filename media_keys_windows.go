//go:build windows

package main

import (
	"syscall"
	"time"
)

const (
	vkMediaNextTrack = 0xB0
	vkMediaPrevTrack = 0xB1
	vkMediaStop      = 0xB2
	vkMediaPlayPause = 0xB3
)

var (
	user32DLL            = syscall.NewLazyDLL("user32.dll")
	procGetAsyncKeyState = user32DLL.NewProc("GetAsyncKeyState")
	getAsyncKeyState     = func(vk int32) uintptr {
		state, _, _ := procGetAsyncKeyState.Call(uintptr(vk))
		return state
	}
	mediaKeyWatcherPollInterval = 25 * time.Millisecond
)

func virtualKeyPressedSinceLastPoll(vk int32) bool {
	state := getAsyncKeyState(vk)
	return (uint16(state) & 0x0001) != 0
}

func (a *App) emitMediaKeyAction(action string) {
	runtimeState := a.runtimeState()
	if runtimeState.ctx == nil {
		return
	}

	runtimeEventsEmit(runtimeState.ctx, mediaKeyEvent, action)
}

func (a *App) startMediaKeyWatcher() {
	watcherState := a.mediaKeyWatcherState()
	if watcherState.stopCh != nil {
		return
	}

	stop := make(chan struct{})
	done := make(chan struct{})
	watcherState.stopCh = stop
	watcherState.doneCh = done

	go func() {
		defer close(done)

		ticker := time.NewTicker(mediaKeyWatcherPollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if virtualKeyPressedSinceLastPoll(vkMediaPlayPause) {
					a.emitMediaKeyAction("playpause")
				}
				if virtualKeyPressedSinceLastPoll(vkMediaNextTrack) {
					a.emitMediaKeyAction("next")
				}
				if virtualKeyPressedSinceLastPoll(vkMediaPrevTrack) {
					a.emitMediaKeyAction("previous")
				}
				if virtualKeyPressedSinceLastPoll(vkMediaStop) {
					a.emitMediaKeyAction("stop")
				}
			}
		}
	}()
}

func (a *App) stopMediaKeyWatcher() {
	watcherState := a.mediaKeyWatcherState()
	if watcherState.stopCh == nil {
		return
	}

	close(watcherState.stopCh)
	if watcherState.doneCh != nil {
		<-watcherState.doneCh
	}
	watcherState.stopCh = nil
	watcherState.doneCh = nil
}
