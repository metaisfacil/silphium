package main

import (
	"context"
	"errors"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func TestAppDialogHelpers(t *testing.T) {
	originalOpenDirectoryDialog := runtimeOpenDirectoryDialog
	originalOpenFileDialog := runtimeOpenFileDialog
	originalSaveFileDialog := runtimeSaveFileDialog
	originalMessageDialog := runtimeMessageDialog
	t.Cleanup(func() {
		runtimeOpenDirectoryDialog = originalOpenDirectoryDialog
		runtimeOpenFileDialog = originalOpenFileDialog
		runtimeSaveFileDialog = originalSaveFileDialog
		runtimeMessageDialog = originalMessageDialog
	})

	if got := sanitizeShareImageFilename("  Artist: Album?  "); got != "Artist_ Album_" {
		t.Fatalf("sanitizeShareImageFilename() = %q, want %q", got, "Artist_ Album_")
	}
	if got := sanitizeShareImageFilename("   "); got != "silphium-share.png" {
		t.Fatalf("sanitizeShareImageFilename(empty) = %q, want %q", got, "silphium-share.png")
	}
	if got := sanitizeShareImageFilename(" ... "); got != "silphium-share.png" {
		t.Fatalf("sanitizeShareImageFilename(invalid-only) = %q, want %q", got, "silphium-share.png")
	}

	app := &App{}
	app.ctx = context.Background()
	runtimeOpenDirectoryDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return `C:\Music`, nil
	}
	if got := app.SelectLibraryFolder(); got != `C:\Music` {
		t.Fatalf("SelectLibraryFolder() = %q, want %q", got, `C:\Music`)
	}
	runtimeOpenDirectoryDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return "", errors.New("boom")
	}
	if got := app.SelectLibraryFolder(); got != "" {
		t.Fatalf("SelectLibraryFolder(error) = %q, want empty", got)
	}

	runtimeOpenFileDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return `C:\Playlists\queue.m3u8`, nil
	}
	if got := app.SelectPlaylistFile(); got != `C:\Playlists\queue.m3u8` {
		t.Fatalf("SelectPlaylistFile() = %q, want %q", got, `C:\Playlists\queue.m3u8`)
	}
	runtimeOpenFileDialog = func(context.Context, runtime.OpenDialogOptions) (string, error) {
		return "", errors.New("boom")
	}
	if got := app.SelectPlaylistFile(); got != "" {
		t.Fatalf("SelectPlaylistFile(error) = %q, want empty", got)
	}

	runtimeSaveFileDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return `C:\Playlists\queue`, nil
	}
	if got := app.SelectPlaylistSaveFile(); got != `C:\Playlists\queue.m3u8` {
		t.Fatalf("SelectPlaylistSaveFile() = %q, want %q", got, `C:\Playlists\queue.m3u8`)
	}
	runtimeSaveFileDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return `C:\Playlists\queue.m3u`, nil
	}
	if got := app.SelectPlaylistSaveFile(); got != `C:\Playlists\queue.m3u` {
		t.Fatalf("SelectPlaylistSaveFile(existing ext) = %q, want %q", got, `C:\Playlists\queue.m3u`)
	}
	runtimeSaveFileDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return "   ", nil
	}
	if got := app.SelectPlaylistSaveFile(); got != "" {
		t.Fatalf("SelectPlaylistSaveFile(blank) = %q, want empty", got)
	}
	runtimeSaveFileDialog = func(context.Context, runtime.SaveDialogOptions) (string, error) {
		return "", errors.New("boom")
	}
	if got := app.SelectPlaylistSaveFile(); got != "" {
		t.Fatalf("SelectPlaylistSaveFile(error) = %q, want empty", got)
	}

	var capturedSaveOptions runtime.SaveDialogOptions
	runtimeSaveFileDialog = func(_ context.Context, options runtime.SaveDialogOptions) (string, error) {
		capturedSaveOptions = options
		return `C:\Images\share`, nil
	}
	if got := app.SelectShareImageSaveFile("  Artist: Album?  "); got != `C:\Images\share.png` {
		t.Fatalf("SelectShareImageSaveFile() = %q, want %q", got, `C:\Images\share.png`)
	}
	if capturedSaveOptions.DefaultFilename != "Artist_ Album_" {
		t.Fatalf("SelectShareImageSaveFile() default filename = %q, want %q", capturedSaveOptions.DefaultFilename, "Artist_ Album_")
	}
	runtimeSaveFileDialog = func(_ context.Context, options runtime.SaveDialogOptions) (string, error) {
		capturedSaveOptions = options
		return `C:\Images\share.PNG`, nil
	}
	if got := app.SelectShareImageSaveFile("cover"); got != `C:\Images\share.PNG` {
		t.Fatalf("SelectShareImageSaveFile(existing ext) = %q, want %q", got, `C:\Images\share.PNG`)
	}
	runtimeSaveFileDialog = func(_ context.Context, options runtime.SaveDialogOptions) (string, error) {
		capturedSaveOptions = options
		return "   ", nil
	}
	if got := app.SelectShareImageSaveFile("cover"); got != "" {
		t.Fatalf("SelectShareImageSaveFile(blank) = %q, want empty", got)
	}
	runtimeSaveFileDialog = func(_ context.Context, options runtime.SaveDialogOptions) (string, error) {
		capturedSaveOptions = options
		return "", errors.New("boom")
	}
	if got := app.SelectShareImageSaveFile("cover"); got != "" {
		t.Fatalf("SelectShareImageSaveFile(error) = %q, want empty", got)
	}

	var capturedMessageOptions runtime.MessageDialogOptions
	runtimeMessageDialog = func(_ context.Context, options runtime.MessageDialogOptions) (string, error) {
		capturedMessageOptions = options
		return "OK", nil
	}
	app.ShowErrorDialog("  ", "  ")
	if capturedMessageOptions.Title != "Error" || capturedMessageOptions.Message != "An unexpected error occurred." {
		t.Fatalf("ShowErrorDialog(defaults) = %#v, want default title/message", capturedMessageOptions)
	}
	app.ShowErrorDialog(" Title ", " Message ")
	if capturedMessageOptions.Title != "Title" || capturedMessageOptions.Message != "Message" {
		t.Fatalf("ShowErrorDialog(trimmed) = %#v, want trimmed title/message", capturedMessageOptions)
	}
}
