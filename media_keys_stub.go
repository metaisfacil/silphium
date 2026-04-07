//go:build !windows

package main

func (a *App) startMediaKeyWatcher() {
	_ = mediaKeyEvent
	_ = a.mediaKeyWatcherStop
	_ = a.mediaKeyWatcherDone
}

func (a *App) stopMediaKeyWatcher() {
	_ = a.mediaKeyWatcherStop
	_ = a.mediaKeyWatcherDone
}
