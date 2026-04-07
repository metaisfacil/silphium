package main

import (
	"errors"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestMainBuildsWailsAppOptions(t *testing.T) {
	originalRunWailsApp := runWailsApp
	var capturedOptions *options.App
	runWailsApp = func(app *options.App) error {
		capturedOptions = app
		return errors.New("boom")
	}
	t.Cleanup(func() {
		runWailsApp = originalRunWailsApp
	})

	main()

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
