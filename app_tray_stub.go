//go:build !windows

package main

func (a *App) shouldMinimizeToTrayOnClose() bool {
	return false
}

func (a *App) refreshSystemTrayForSettings() {
}

func (a *App) stopSystemTray() {
}
