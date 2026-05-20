//go:build windows

package main

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	shell32DLL                                  = windows.NewLazySystemDLL("Shell32.dll")
	procSetCurrentProcessExplicitAppUserModelID = shell32DLL.NewProc("SetCurrentProcessExplicitAppUserModelID")
	setCurrentProcessExplicitAppUserModelID     = func(appUserModelID string) error {
		return callSetCurrentProcessExplicitAppUserModelID(appUserModelID)
	}
)

func initializePlatformIdentityImpl() error {
	return setCurrentProcessExplicitAppUserModelID(silphiumWindowsAppUserModelID)
}

func callSetCurrentProcessExplicitAppUserModelID(appUserModelID string) error {
	if err := procSetCurrentProcessExplicitAppUserModelID.Find(); err != nil {
		return fmt.Errorf("locate SetCurrentProcessExplicitAppUserModelID: %w", err)
	}

	appUserModelIDUTF16, err := windows.UTF16PtrFromString(appUserModelID)
	if err != nil {
		return fmt.Errorf("encode AppUserModelID: %w", err)
	}

	hresult, _, _ := procSetCurrentProcessExplicitAppUserModelID.Call(uintptr(unsafe.Pointer(appUserModelIDUTF16)))
	if hresult != 0 {
		return fmt.Errorf("set AppUserModelID %q: HRESULT 0x%08X", appUserModelID, uint32(hresult))
	}

	return nil
}
