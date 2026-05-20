package main

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestMainBuildsWailsAppOptions(t *testing.T) {
	originalInitializePlatformIdentity := initializePlatformIdentity
	originalRunWailsApp := runWailsApp
	var capturedOptions *options.App
	callOrder := make([]string, 0, 2)
	initializePlatformIdentity = func() error {
		callOrder = append(callOrder, "initializePlatformIdentity")
		return nil
	}
	runWailsApp = func(app *options.App) error {
		callOrder = append(callOrder, "runWailsApp")
		capturedOptions = app
		return errors.New("boom")
	}
	t.Cleanup(func() {
		initializePlatformIdentity = originalInitializePlatformIdentity
		runWailsApp = originalRunWailsApp
	})

	main()

	if got, want := len(callOrder), 2; got != want {
		t.Fatalf("main() call count = %d, want %d", got, want)
	}
	if callOrder[0] != "initializePlatformIdentity" || callOrder[1] != "runWailsApp" {
		t.Fatalf("main() call order = %#v, want initializePlatformIdentity before runWailsApp", callOrder)
	}

	if capturedOptions == nil {
		t.Fatal("main() did not invoke runWailsApp")
	}
	if capturedOptions.Title != "Silphium" {
		t.Fatalf("main() title = %q, want %q", capturedOptions.Title, "Silphium")
	}
	if capturedOptions.OnStartup == nil || capturedOptions.OnBeforeClose == nil || capturedOptions.OnShutdown == nil {
		t.Fatalf("main() lifecycle hooks = %#v, want non-nil hooks", capturedOptions)
	}
	if got, want := len(capturedOptions.Bind), 1; got != want {
		t.Fatalf("main() bind len = %d, want %d", got, want)
	}
}
