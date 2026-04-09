//go:build !windows

package main

func (a *App) startMediaKeyWatcher() {
	_ = mediaKeyEvent
	_ = a.mediaKeyWatcherState().stopCh
	_ = a.mediaKeyWatcherState().doneCh
}

func (a *App) stopMediaKeyWatcher() {
	_ = a.mediaKeyWatcherState().stopCh
	_ = a.mediaKeyWatcherState().doneCh
}
