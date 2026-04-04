//go:build windows

package main

import (
	"syscall"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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
)

func virtualKeyPressedSinceLastPoll(vk int32) bool {
	state, _, _ := procGetAsyncKeyState.Call(uintptr(vk))
	return (uint16(state) & 0x0001) != 0
}

func (a *App) emitMediaKeyAction(action string) {
	if a.ctx == nil {
		return
	}

	runtime.EventsEmit(a.ctx, mediaKeyEvent, action)
}

func (a *App) startMediaKeyWatcher() {
	if a.mediaKeyWatcherStop != nil {
		return
	}

	stop := make(chan struct{})
	done := make(chan struct{})
	a.mediaKeyWatcherStop = stop
	a.mediaKeyWatcherDone = done

	go func() {
		defer close(done)

		ticker := time.NewTicker(25 * time.Millisecond)
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
	if a.mediaKeyWatcherStop == nil {
		return
	}

	close(a.mediaKeyWatcherStop)
	if a.mediaKeyWatcherDone != nil {
		<-a.mediaKeyWatcherDone
	}
	a.mediaKeyWatcherStop = nil
	a.mediaKeyWatcherDone = nil
}
