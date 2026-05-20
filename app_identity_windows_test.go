//go:build windows

package main

import "testing"

func TestInitializePlatformIdentityUsesSilphiumAppUserModelID(t *testing.T) {
	if silphiumWindowsAppUserModelID != "metaisfacil.Silphium" {
		t.Fatalf("silphiumWindowsAppUserModelID = %q, want %q", silphiumWindowsAppUserModelID, "metaisfacil.Silphium")
	}

	originalSetCurrentProcessExplicitAppUserModelID := setCurrentProcessExplicitAppUserModelID
	var gotAppUserModelID string
	setCurrentProcessExplicitAppUserModelID = func(appUserModelID string) error {
		gotAppUserModelID = appUserModelID
		return nil
	}
	t.Cleanup(func() {
		setCurrentProcessExplicitAppUserModelID = originalSetCurrentProcessExplicitAppUserModelID
	})

	if err := initializePlatformIdentityImpl(); err != nil {
		t.Fatalf("initializePlatformIdentityImpl() error = %v", err)
	}
	if gotAppUserModelID != silphiumWindowsAppUserModelID {
		t.Fatalf("initializePlatformIdentityImpl() AppUserModelID = %q, want %q", gotAppUserModelID, silphiumWindowsAppUserModelID)
	}
}
