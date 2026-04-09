//go:build windows

package main

import (
	_ "embed"
	"sync"

	"github.com/getlantern/systray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed build/windows/icon.ico
var trayIconICO []byte

type trayManager struct {
	mu      sync.Mutex
	started bool
	app     *App
}

var windowsTray = &trayManager{}
var systrayRun = systray.Run
var systrayQuit = systray.Quit
var systraySetIcon = systray.SetIcon
var systraySetTooltip = systray.SetTooltip
var systraySetOnClick = systray.SetOnClick
var systrayAddMenuItem = systray.AddMenuItem
var systrayAddSeparator = systray.AddSeparator
var runtimeWindowShow = runtime.WindowShow
var runtimeWindowUnminimise = runtime.WindowUnminimise
var runtimeQuit = runtime.Quit

func (a *App) shouldMinimizeToTrayOnClose() bool {
	a.ensureSettingsLoaded()
	return a.settingsState().settings.MinimizeToTrayOnClose
}

func (a *App) refreshSystemTrayForSettings() {
	if a.runtimeState().quitRequested.Load() {
		windowsTray.stop()
		return
	}

	if !a.shouldMinimizeToTrayOnClose() {
		windowsTray.stop()
		return
	}

	windowsTray.start(a)
}

func (a *App) stopSystemTray() {
	windowsTray.stop()
}

func (t *trayManager) start(app *App) {
	t.mu.Lock()
	if t.started {
		t.app = app
		t.mu.Unlock()
		return
	}

	t.started = true
	t.app = app
	t.mu.Unlock()

	go systrayRun(func() {
		systraySetIcon(trayIconICO)
		systraySetTooltip("Silphium")
		systraySetOnClick(func() {
			t.showMainWindow()
		})

		show := systrayAddMenuItem("Show", "Show Silphium")
		systrayAddSeparator()
		playPause := systrayAddMenuItem("Play/Pause", "Toggle playback")
		stop := systrayAddMenuItem("Stop", "Stop playback")
		back := systrayAddMenuItem("Back", "Play previous track")
		forward := systrayAddMenuItem("Forward", "Play next track")
		systrayAddSeparator()
		exit := systrayAddMenuItem("Exit", "Exit Silphium")

		go t.handleShowMenuItem(show)
		go t.handlePlaybackMenuItem(playPause, "playpause")
		go t.handlePlaybackMenuItem(stop, "stop")
		go t.handlePlaybackMenuItem(back, "previous")
		go t.handlePlaybackMenuItem(forward, "next")
		go t.handleExitMenuItem(exit)
	}, func() {
		t.mu.Lock()
		t.started = false
		t.app = nil
		t.mu.Unlock()
	})
}

func (t *trayManager) stop() {
	t.mu.Lock()
	started := t.started
	t.mu.Unlock()
	if !started {
		return
	}

	systrayQuit()
}

func (t *trayManager) appInstance() *App {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.app
}

func (t *trayManager) handlePlaybackMenuItem(item *systray.MenuItem, action string) {
	for range item.ClickedCh {
		app := t.appInstance()
		if app == nil {
			continue
		}

		app.emitMediaKeyAction(action)
	}
}

func (t *trayManager) showMainWindow() {
	app := t.appInstance()
	if app == nil {
		return
	}

	runtimeWindowShow(app.ctx)
	runtimeWindowUnminimise(app.ctx)
}

func (t *trayManager) handleShowMenuItem(item *systray.MenuItem) {
	for range item.ClickedCh {
		t.showMainWindow()
	}
}

func (t *trayManager) handleExitMenuItem(item *systray.MenuItem) {
	<-item.ClickedCh

	app := t.appInstance()
	if app == nil {
		systrayQuit()
		return
	}

	app.quitRequested.Store(true)
	runtimeQuit(app.ctx)
	systrayQuit()
}
