//go:build windows

package main

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/getlantern/systray"
)

func TestTrayManagerHelpersAndRefresh(t *testing.T) {
	originalWindowsTray := windowsTray
	originalSystrayRun := systrayRun
	originalSystrayQuit := systrayQuit
	originalSystraySetIcon := systraySetIcon
	originalSystraySetTooltip := systraySetTooltip
	originalSystraySetOnClick := systraySetOnClick
	originalSystrayAddMenuItem := systrayAddMenuItem
	originalSystrayAddSeparator := systrayAddSeparator
	originalRuntimeWindowShow := runtimeWindowShow
	originalRuntimeWindowUnminimise := runtimeWindowUnminimise
	originalRuntimeQuit := runtimeQuit
	originalRuntimeEventsEmit := runtimeEventsEmit
	t.Cleanup(func() {
		windowsTray = originalWindowsTray
		systrayRun = originalSystrayRun
		systrayQuit = originalSystrayQuit
		systraySetIcon = originalSystraySetIcon
		systraySetTooltip = originalSystraySetTooltip
		systraySetOnClick = originalSystraySetOnClick
		systrayAddMenuItem = originalSystrayAddMenuItem
		systrayAddSeparator = originalSystrayAddSeparator
		runtimeWindowShow = originalRuntimeWindowShow
		runtimeWindowUnminimise = originalRuntimeWindowUnminimise
		runtimeQuit = originalRuntimeQuit
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	ready := make(chan struct{}, 1)
	menuItems := map[string]*systray.MenuItem{}
	var quitCalls int
	var windowShowCalls int
	var windowUnminimiseCalls int
	var runtimeQuitCalls int
	var emittedActions []string
	var onClick func()
	var emittedMu sync.Mutex

	systrayRun = func(onReady func(), onExit func()) {
		onReady()
		ready <- struct{}{}
		onExit()
	}
	systrayQuit = func() {
		quitCalls++
	}
	systraySetIcon = func([]byte) {}
	systraySetTooltip = func(string) {}
	systraySetOnClick = func(handler func()) {
		onClick = handler
	}
	systrayAddSeparator = func() {}
	systrayAddMenuItem = func(title string, _ string) *systray.MenuItem {
		item := &systray.MenuItem{ClickedCh: make(chan struct{}, 1)}
		menuItems[title] = item
		return item
	}
	runtimeWindowShow = func(context.Context) {
		windowShowCalls++
	}
	runtimeWindowUnminimise = func(context.Context) {
		windowUnminimiseCalls++
	}
	runtimeQuit = func(context.Context) {
		runtimeQuitCalls++
	}
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName == mediaKeyEvent && len(optionalData) > 0 {
			emittedMu.Lock()
			emittedActions = append(emittedActions, optionalData[0].(string))
			emittedMu.Unlock()
		}
	}

	app := &App{ctx: context.Background(), settingsLoaded: true, settings: AppSettings{MinimizeToTrayOnClose: true}}
	manager := &trayManager{}
	manager.start(app)
	select {
	case <-ready:
	case <-time.After(time.Second):
		t.Fatal("trayManager.start() did not invoke the systray ready callback")
	}

	managerWithExistingInstance := &trayManager{started: true}
	managerWithExistingInstance.start(app)
	if managerWithExistingInstance.app != app {
		t.Fatal("trayManager.start(existing instance) should update the stored app reference")
	}

	manager.app = app
	if got := manager.appInstance(); got != app {
		t.Fatalf("trayManager.appInstance() = %#v, want stored app", got)
	}
	manager.showMainWindow()
	if windowShowCalls == 0 || windowUnminimiseCalls == 0 {
		t.Fatal("trayManager.showMainWindow() should show and unminimise the main window")
	}
	if onClick == nil {
		t.Fatal("trayManager.start() should register a systray click handler")
	}
	onClick()
	if windowShowCalls < 2 || windowUnminimiseCalls < 2 {
		t.Fatal("systray click handler should route to showMainWindow()")
	}

	playItem := &systray.MenuItem{ClickedCh: make(chan struct{}, 1)}
	playDone := make(chan struct{})
	go func() {
		manager.handlePlaybackMenuItem(playItem, "playpause")
		close(playDone)
	}()
	playItem.ClickedCh <- struct{}{}
	close(playItem.ClickedCh)
	<-playDone
	if len(emittedActions) == 0 || emittedActions[0] != "playpause" {
		t.Fatalf("handlePlaybackMenuItem() emitted %#v, want playpause action", emittedActions)
	}

	nilPlayItem := &systray.MenuItem{ClickedCh: make(chan struct{}, 1)}
	nilPlayDone := make(chan struct{})
	playActionsBefore := len(emittedActions)
	go func() {
		(&trayManager{}).handlePlaybackMenuItem(nilPlayItem, "next")
		close(nilPlayDone)
	}()
	nilPlayItem.ClickedCh <- struct{}{}
	close(nilPlayItem.ClickedCh)
	<-nilPlayDone
	if len(emittedActions) != playActionsBefore {
		t.Fatalf("handlePlaybackMenuItem(nil app) emitted %#v, want no new actions", emittedActions)
	}

	showItem := &systray.MenuItem{ClickedCh: make(chan struct{}, 1)}
	showDone := make(chan struct{})
	go func() {
		manager.handleShowMenuItem(showItem)
		close(showDone)
	}()
	showItem.ClickedCh <- struct{}{}
	close(showItem.ClickedCh)
	<-showDone
	if windowShowCalls < 2 || windowUnminimiseCalls < 2 {
		t.Fatal("handleShowMenuItem() should route to showMainWindow()")
	}
	showCallsBefore := windowShowCalls
	unminimiseCallsBefore := windowUnminimiseCalls
	(&trayManager{}).showMainWindow()
	if windowShowCalls != showCallsBefore || windowUnminimiseCalls != unminimiseCallsBefore {
		t.Fatal("trayManager.showMainWindow(nil app) should not touch the runtime window helpers")
	}

	exitItem := &systray.MenuItem{ClickedCh: make(chan struct{}, 1)}
	exitDone := make(chan struct{})
	go func() {
		manager.handleExitMenuItem(exitItem)
		close(exitDone)
	}()
	exitItem.ClickedCh <- struct{}{}
	<-exitDone
	if !app.quitRequested.Load() || runtimeQuitCalls == 0 || quitCalls == 0 {
		t.Fatal("handleExitMenuItem() should request app quit and quit the systray")
	}

	nilManager := &trayManager{}
	nilExitItem := &systray.MenuItem{ClickedCh: make(chan struct{}, 1)}
	nilExitDone := make(chan struct{})
	go func() {
		nilManager.handleExitMenuItem(nilExitItem)
		close(nilExitDone)
	}()
	nilExitItem.ClickedCh <- struct{}{}
	<-nilExitDone
	if quitCalls < 2 {
		t.Fatal("handleExitMenuItem(nil app) should still quit the systray")
	}

	app.quitRequested.Store(false)
	windowsTray = &trayManager{started: true}
	app.refreshSystemTrayForSettings()
	if windowsTray.app != app {
		t.Fatal("refreshSystemTrayForSettings(enabled) should start the tray manager with the current app")
	}

	windowsTray = &trayManager{started: true}
	app.settings.MinimizeToTrayOnClose = false
	app.refreshSystemTrayForSettings()
	if quitCalls < 2 {
		t.Fatal("refreshSystemTrayForSettings(disabled) should stop the existing tray")
	}

	windowsTray = &trayManager{started: true}
	app.quitRequested.Store(true)
	app.refreshSystemTrayForSettings()
	if quitCalls < 3 {
		t.Fatal("refreshSystemTrayForSettings(quitting) should stop the existing tray")
	}

	trayApp := &App{ctx: context.Background()}
	windowsTray = &trayManager{started: true, app: trayApp}
	trayApp.stopSystemTray()
	if quitCalls < 4 {
		t.Fatal("stopSystemTray() should stop the tray manager")
	}
}
