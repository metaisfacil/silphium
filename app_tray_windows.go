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

func (a *App) shouldMinimizeToTrayOnClose() bool {
	a.ensureSettingsLoaded()
	return a.settings.MinimizeToTrayOnClose
}

func (a *App) refreshSystemTrayForSettings() {
	if a.quitRequested.Load() {
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

	go systray.Run(func() {
		systray.SetIcon(trayIconICO)
		systray.SetTooltip("Silphium")
		systray.SetOnClick(func() {
			t.showMainWindow()
		})

		show := systray.AddMenuItem("Show", "Show Silphium")
		systray.AddSeparator()
		playPause := systray.AddMenuItem("Play/Pause", "Toggle playback")
		stop := systray.AddMenuItem("Stop", "Stop playback")
		back := systray.AddMenuItem("Back", "Play previous track")
		forward := systray.AddMenuItem("Forward", "Play next track")
		systray.AddSeparator()
		exit := systray.AddMenuItem("Exit", "Exit Silphium")

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

	systray.Quit()
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

	runtime.WindowShow(app.ctx)
	runtime.WindowUnminimise(app.ctx)
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
		systray.Quit()
		return
	}

	app.quitRequested.Store(true)
	runtime.Quit(app.ctx)
	systray.Quit()
}
