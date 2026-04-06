//go:build windows
// +build windows

package systray

import (
	"crypto/md5"
	"encoding/hex"
	"io/ioutil"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Helpful sources: https://github.com/golang/exp/blob/master/shiny/driver/internal/win32

var (
	g32                     = windows.NewLazySystemDLL("Gdi32.dll")
	pCreateCompatibleBitmap = g32.NewProc("CreateCompatibleBitmap")
	pCreateCompatibleDC     = g32.NewProc("CreateCompatibleDC")
	pDeleteDC               = g32.NewProc("DeleteDC")
	pSelectObject           = g32.NewProc("SelectObject")

	k32              = windows.NewLazySystemDLL("Kernel32.dll")
	pGetModuleHandle = k32.NewProc("GetModuleHandleW")

	s32              = windows.NewLazySystemDLL("Shell32.dll")
	pShellNotifyIcon = s32.NewProc("Shell_NotifyIconW")

	u32                    = windows.NewLazySystemDLL("User32.dll")
	pCreateMenu            = u32.NewProc("CreateMenu")
	pCreatePopupMenu       = u32.NewProc("CreatePopupMenu")
	pCreateWindowEx        = u32.NewProc("CreateWindowExW")
	pDefWindowProc         = u32.NewProc("DefWindowProcW")
	pRemoveMenu            = u32.NewProc("RemoveMenu")
	pDestroyWindow         = u32.NewProc("DestroyWindow")
	pDispatchMessage       = u32.NewProc("DispatchMessageW")
	pDrawIconEx            = u32.NewProc("DrawIconEx")
	pGetCursorPos          = u32.NewProc("GetCursorPos")
	pGetDC                 = u32.NewProc("GetDC")
	pGetMessage            = u32.NewProc("GetMessageW")
	pGetSystemMetrics      = u32.NewProc("GetSystemMetrics")
	pInsertMenuItem        = u32.NewProc("InsertMenuItemW")
	pLoadCursor            = u32.NewProc("LoadCursorW")
	pLoadIcon              = u32.NewProc("LoadIconW")
	pLoadImage             = u32.NewProc("LoadImageW")
	pPostMessage           = u32.NewProc("PostMessageW")
	pPostQuitMessage       = u32.NewProc("PostQuitMessage")
	pRegisterClass         = u32.NewProc("RegisterClassExW")
	pRegisterWindowMessage = u32.NewProc("RegisterWindowMessageW")
	pReleaseDC             = u32.NewProc("ReleaseDC")
	pSetForegroundWindow   = u32.NewProc("SetForegroundWindow")
	pSetMenuInfo           = u32.NewProc("SetMenuInfo")
	pSetMenuItemInfo       = u32.NewProc("SetMenuItemInfoW")
	pShowWindow            = u32.NewProc("ShowWindow")
	pTrackPopupMenu        = u32.NewProc("TrackPopupMenu")
	pTranslateMessage      = u32.NewProc("TranslateMessage")
	pUnregisterClass       = u32.NewProc("UnregisterClassW")
	pUpdateWindow          = u32.NewProc("UpdateWindow")
)

// Contains window class information.
// It is used with the RegisterClassEx and GetClassInfoEx functions.
// https://msdn.microsoft.com/en-us/library/ms633577.aspx
type wndClassEx struct {
	Size, Style                        uint32
	WndProc                            uintptr
	ClsExtra, WndExtra                 int32
	Instance, Icon, Cursor, Background windows.Handle
	MenuName, ClassName                *uint16
	IconSm                             windows.Handle
}

// Registers a window class for subsequent use in calls to the CreateWindow or CreateWindowEx function.
// https://msdn.microsoft.com/en-us/library/ms633587.aspx
func (w *wndClassEx) register() error {
	w.Size = uint32(unsafe.Sizeof(*w))
	res, _, err := pRegisterClass.Call(uintptr(unsafe.Pointer(w)))
	if res == 0 {
		return err
	}
	return nil
}

// Unregisters a window class, freeing the memory required for the class.
// https://msdn.microsoft.com/en-us/library/ms644899.aspx
func (w *wndClassEx) unregister() error {
	res, _, err := pUnregisterClass.Call(
		uintptr(unsafe.Pointer(w.ClassName)),
		uintptr(w.Instance),
	)
	if res == 0 {
		return err
	}
	return nil
}

// Contains information that the system needs to display notifications in the notification area.
// Used by Shell_NotifyIcon.
// https://msdn.microsoft.com/en-us/library/windows/desktop/bb773352(v=vs.85).aspx
// https://msdn.microsoft.com/en-us/library/windows/desktop/bb762159
type notifyIconData struct {
	Size                       uint32
	Wnd                        windows.Handle
	ID, Flags, CallbackMessage uint32
	Icon                       windows.Handle
	Tip                        [128]uint16
	State, StateMask           uint32
	Info                       [256]uint16
	Timeout, Version           uint32
	InfoTitle                  [64]uint16
	InfoFlags                  uint32
	GUIDItem                   windows.GUID
	BalloonIcon                windows.Handle
}

func (nid *notifyIconData) add() error {
	const nimAdd = 0x00000000
	res, _, err := pShellNotifyIcon.Call(
		uintptr(nimAdd),
		uintptr(unsafe.Pointer(nid)),
	)
	if res == 0 {
		return err
	}
	return nil
}

func (nid *notifyIconData) modify() error {
	const nimModify = 0x00000001
	res, _, err := pShellNotifyIcon.Call(
		uintptr(nimModify),
		uintptr(unsafe.Pointer(nid)),
	)
	if res == 0 {
		return err
	}
	return nil
}

func (nid *notifyIconData) delete() error {
	const nimDelete = 0x00000002
	res, _, err := pShellNotifyIcon.Call(
		uintptr(nimDelete),
		uintptr(unsafe.Pointer(nid)),
	)
	if res == 0 {
		return err
	}
	return nil
}

// Contains information about a menu item.
// https://msdn.microsoft.com/en-us/library/windows/desktop/ms647578(v=vs.85).aspx
type menuItemInfo struct {
	Size, Mask, Type, State     uint32
	ID                          uint32
	SubMenu, Checked, Unchecked windows.Handle
	ItemData                    uintptr
	TypeData                    *uint16
	Cch                         uint32
	BMPItem                     windows.Handle
}

// The POINT structure defines the x- and y- coordinates of a point.
// https://msdn.microsoft.com/en-us/library/windows/desktop/dd162805(v=vs.85).aspx
type point struct {
	X, Y int32
}

// Contains information about loaded resources
type winTray struct {
	instance,
	icon,
	cursor,
	window windows.Handle

	loadedImages   map[string]windows.Handle
	muLoadedImages sync.RWMutex
	// menus keeps track of the submenus keyed by the menu item ID, plus 0
	// which corresponds to the main popup menu.
	menus   map[uint32]windows.Handle
	muMenus sync.RWMutex
	// menuOf keeps track of the menu each menu item belongs to.
	menuOf   map[uint32]windows.Handle
	muMenuOf sync.RWMutex
	// menuItemIcons maintains the bitmap of each menu item (if applies). It's
	// needed to show the icon correctly when showing a previously hidden menu
	// item again.
	menuItemIcons   map[uint32]windows.Handle
	muMenuItemIcons sync.RWMutex
	visibleItems    map[uint32][]uint32
	muVisibleItems  sync.RWMutex

	nid   *notifyIconData
	muNID sync.RWMutex
	wcex  *wndClassEx

	wmSystrayMessage,
	wmTaskbarCreated uint32
}

// Loads an image from file and shows it in tray.
// Shell_NotifyIcon: https://msdn.microsoft.com/en-us/library/windows/desktop/bb762159(v=vs.85).aspx
func (t *winTray) setIcon(src string) error {
	const nifIcon = 0x00000002

	h, err := t.loadIconFrom(src)
	if err != nil {
		return err
	}

	t.muNID.Lock()
	defer t.muNID.Unlock()
	t.nid.Icon = h
	t.nid.Flags |= nifIcon
	t.nid.Size = uint32(unsafe.Sizeof(*t.nid))

	return t.nid.modify()
}

// Sets tooltip on icon.
// Shell_NotifyIcon: https://msdn.microsoft.com/en-us/library/windows/desktop/bb762159(v=vs.85).aspx
func (t *winTray) setTooltip(src string) error {
	const nifTip = 0x00000004
	b, err := windows.UTF16FromString(src)
	if err != nil {
		return err
	}

	t.muNID.Lock()
	defer t.muNID.Unlock()
	copy(t.nid.Tip[:], b[:])
	t.nid.Flags |= nifTip
	t.nid.Size = uint32(unsafe.Sizeof(*t.nid))

	return t.nid.modify()
}

var wt winTray

// WindowProc callback function that processes messages sent to a window.
// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633573(v=vs.85).aspx
func (t *winTray) wndProc(hWnd windows.Handle, message uint32, wParam, lParam uintptr) (lResult uintptr) {
	const (
		wmRButtonUp  = 0x0205
		wmLButtonUp  = 0x0202
		wmCommand    = 0x0111
		wmEndSession = 0x0016
		wmClose      = 0x0010
		wmDestroy    = 0x0002
	)
	switch message {
	case wmCommand:
		menuItemID := int32(wParam)
		// https://docs.microsoft.com/en-us/windows/win32/menurc/wm-command#menus
		if menuItemID != -1 {
			systrayMenuItemSelected(uint32(wParam))
		}
	case wmClose:
		pDestroyWindow.Call(uintptr(t.window))
		t.wcex.unregister()
	case wmDestroy:
		// same as wmEndSession, but throws 0 exit code after all
		defer pPostQuitMessage.Call(uintptr(int32(0)))
		fallthrough
	case wmEndSession:
		t.muNID.Lock()
		if t.nid != nil {
			t.nid.delete()
		}
		t.muNID.Unlock()
		systrayExit()
	case t.wmSystrayMessage:
		switch lParam {
		case wmRButtonUp:
			t.showMenu()
		case wmLButtonUp:
			if onClick != nil {
				go onClick()
				break
			}

			t.showMenu()
		}
	case t.wmTaskbarCreated: // on explorer.exe restarts
		t.muNID.Lock()
		t.nid.add()
		t.muNID.Unlock()
	default:
		// Calls the default window procedure to provide default processing for any window messages that an application does not process.
		// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633572(v=vs.85).aspx
		lResult, _, _ = pDefWindowProc.Call(
			uintptr(hWnd),
			uintptr(message),
			uintptr(wParam),
			uintptr(lParam),
		)
	}
	return
}

func (t *winTray) initInstance() error {
	const idiApplication = 32512
	const idcArrow = 32512 // Standard arrow
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms633548(v=vs.85).aspx
	const swHide = 0
	const cwUseDefault = 0x80000000
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms632600(v=vs.85).aspx
	const (
		wsCaption     = 0x00C00000
		wsMaximizeBox = 0x00010000
		wsMinimizeBox = 0x00020000
		wsOverlapped  = 0x00000000
		wsSysMenu     = 0x00080000
		wsThickFrame  = 0x00040000

		wsOverlappedWindow = wsOverlapped | wsCaption | wsSysMenu | wsThickFrame | wsMinimizeBox | wsMaximizeBox
	)
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ff729176
	const (
		csHRedraw = 0x0002
		csVRedraw = 0x0001
	)
	const nifMessage = 0x00000001

	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms644931(v=vs.85).aspx
	const wmUser = 0x0400

	const (
		className  = "SystrayClass"
		windowName = ""
	)

	t.wmSystrayMessage = wmUser + 1
	t.visibleItems = make(map[uint32][]uint32)
	t.menus = make(map[uint32]windows.Handle)
	t.menuOf = make(map[uint32]windows.Handle)
	t.menuItemIcons = make(map[uint32]windows.Handle)

	taskbarEventNamePtr, _ := windows.UTF16PtrFromString("TaskbarCreated")
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms644947
	res, _, err := pRegisterWindowMessage.Call(
		uintptr(unsafe.Pointer(taskbarEventNamePtr)),
	)
	t.wmTaskbarCreated = uint32(res)

	t.loadedImages = make(map[string]windows.Handle)

	instanceHandle, _, err := pGetModuleHandle.Call(0)
	if instanceHandle == 0 {
		return err
	}
	t.instance = windows.Handle(instanceHandle)

	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms648072(v=vs.85).aspx
	iconHandle, _, err := pLoadIcon.Call(0, uintptr(idiApplication))
	if iconHandle == 0 {
		return err
	}
	t.icon = windows.Handle(iconHandle)

	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms648391(v=vs.85).aspx
	cursorHandle, _, err := pLoadCursor.Call(0, uintptr(idcArrow))
	if cursorHandle == 0 {
		return err
	}
	t.cursor = windows.Handle(cursorHandle)

	classNamePtr, err := windows.UTF16PtrFromString(className)
	if err != nil {
		return err
	}

	windowNamePtr, err := windows.UTF16PtrFromString(windowName)
	if err != nil {
		return err
	}

	t.wcex = &wndClassEx{
		Style:      csHRedraw | csVRedraw,
		WndProc:    windows.NewCallback(t.wndProc),
		Instance:   t.instance,
		Icon:       t.icon,
		Cursor:     t.cursor,
		Background: windows.Handle(6), // (COLOR_WINDOW + 1)
		ClassName:  classNamePtr,
		IconSm:     t.icon,
	}
	if err := t.wcex.register(); err != nil {
		return err
	}

	windowHandle, _, err := pCreateWindowEx.Call(
		uintptr(0),
		uintptr(unsafe.Pointer(classNamePtr)),
		uintptr(unsafe.Pointer(windowNamePtr)),
		uintptr(wsOverlappedWindow),
		uintptr(cwUseDefault),
		uintptr(cwUseDefault),
		uintptr(cwUseDefault),
		uintptr(cwUseDefault),
		uintptr(0),
		uintptr(0),
		uintptr(t.instance),
		uintptr(0),
	)
	if windowHandle == 0 {
		return err
	}
	t.window = windows.Handle(windowHandle)

	pShowWindow.Call(
		uintptr(t.window),
		uintptr(swHide),
	)

	pUpdateWindow.Call(
		uintptr(t.window),
	)

	t.muNID.Lock()
	defer t.muNID.Unlock()
	t.nid = &notifyIconData{
		Wnd:             windows.Handle(t.window),
		ID:              100,
		Flags:           nifMessage,
		CallbackMessage: t.wmSystrayMessage,
	}
	t.nid.Size = uint32(unsafe.Sizeof(*t.nid))

	return t.nid.add()
}

func (t *winTray) createMenu() error {
	const mimApplyToSubmenus = 0x80000000 // Settings apply to the menu and all of its submenus

	menuHandle, _, err := pCreatePopupMenu.Call()
	if menuHandle == 0 {
		return err
	}
	t.menus[0] = windows.Handle(menuHandle)

	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms647575(v=vs.85).aspx
	mi := struct {
		Size, Mask, Style, Max uint32
		Background             windows.Handle
		ContextHelpID          uint32
		MenuData               uintptr
	}{
		Mask: mimApplyToSubmenus,
	}
	mi.Size = uint32(unsafe.Sizeof(mi))

	res, _, err := pSetMenuInfo.Call(
		uintptr(t.menus[0]),
		uintptr(unsafe.Pointer(&mi)),
	)
	if res == 0 {
		return err
	}
	return nil
}

func (t *winTray) convertToSubMenu(menuItemID uint32) (windows.Handle, error) {
	const miimSubmenu = 0x00000004

	res, _, err := pCreateMenu.Call()
	if res == 0 {
		return 0, err
	}
	menu := windows.Handle(res)

	mi := menuItemInfo{Mask: miimSubmenu, SubMenu: menu}
	mi.Size = uint32(unsafe.Sizeof(mi))
	t.muMenuOf.RLock()
	hMenu := t.menuOf[menuItemID]
	t.muMenuOf.RUnlock()
	res, _, err = pSetMenuItemInfo.Call(
		uintptr(hMenu),
		uintptr(menuItemID),
		0,
		uintptr(unsafe.Pointer(&mi)),
	)
	if res == 0 {
		return 0, err
	}
	t.muMenus.Lock()
	t.menus[menuItemID] = menu
	t.muMenus.Unlock()
	return menu, nil
}

func (t *winTray) addOrUpdateMenuItem(menuItemID uint32, parentID uint32, title string, disabled, checked bool) error {
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms647578(v=vs.85).aspx
	const (
		miimFType   = 0x00000100
		miimBitmap  = 0x00000080
		miimString  = 0x00000040
		miimSubmenu = 0x00000004
		miimID      = 0x00000002
		miimState   = 0x00000001
	)
	const mftString = 0x00000000
	const (
		mfsChecked  = 0x00000008
		mfsDisabled = 0x00000003
	)
	titlePtr, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return err
	}

	mi := menuItemInfo{
		Mask:     miimFType | miimString | miimID | miimState,
		Type:     mftString,
		ID:       uint32(menuItemID),
		TypeData: titlePtr,
		Cch:      uint32(len(title)),
	}
	mi.Size = uint32(unsafe.Sizeof(mi))
	if disabled {
		mi.State |= mfsDisabled
	}
	if checked {
		mi.State |= mfsChecked
	}
	t.muMenuItemIcons.RLock()
	hIcon := t.menuItemIcons[menuItemID]
	t.muMenuItemIcons.RUnlock()
	if hIcon > 0 {
		mi.Mask |= miimBitmap
		mi.BMPItem = hIcon
	}

	var res uintptr
	t.muMenus.RLock()
	menu, exists := t.menus[parentID]
	t.muMenus.RUnlock()
	if !exists {
		menu, err = t.convertToSubMenu(parentID)
		if err != nil {
			return err
		}
		t.muMenus.Lock()
		t.menus[parentID] = menu
		t.muMenus.Unlock()
	} else if t.getVisibleItemIndex(parentID, menuItemID) != -1 {
		// We set the menu item info based on the menuID
		res, _, err = pSetMenuItemInfo.Call(
			uintptr(menu),
			uintptr(menuItemID),
			0,
			uintptr(unsafe.Pointer(&mi)),
		)
	}

	if res == 0 {
		// Menu item does not already exist, create it
		t.muMenus.RLock()
		submenu, exists := t.menus[menuItemID]
		t.muMenus.RUnlock()
		if exists {
			mi.Mask |= miimSubmenu
			mi.SubMenu = submenu
		}
		t.addToVisibleItems(parentID, menuItemID)
		position := t.getVisibleItemIndex(parentID, menuItemID)
		res, _, err = pInsertMenuItem.Call(
			uintptr(menu),
			uintptr(position),
			1,
			uintptr(unsafe.Pointer(&mi)),
		)
		if res == 0 {
			t.delFromVisibleItems(parentID, menuItemID)
			return err
		}
		t.muMenuOf.Lock()
		t.menuOf[menuItemID] = menu
		t.muMenuOf.Unlock()
	}

	return nil
}

func (t *winTray) addSeparatorMenuItem(menuItemID, parentID uint32) error {
	// https://msdn.microsoft.com/en-us/library/windows/desktop/ms647578(v=vs.85).aspx
	const (
		miimFType = 0x00000100
		miimID    = 0x00000002
		miimState = 0x00000001
	)
	const mftSeparator = 0x00000800

	mi := menuItemInfo{
		Mask: miimFType | miimID | miimState,
		Type: mftSeparator,
		ID:   uint32(menuItemID),
	}

	mi.Size = uint32(unsafe.Sizeof(mi))

	t.addToVisibleItems(parentID, menuItemID)
	position := t.getVisibleItemIndex(parentID, menuItemID)
	t.muMenus.RLock()
	menu := uintptr(t.menus[parentID])
	t.muMenus.RUnlock()
	res, _, err := pInsertMenuItem.Call(
		menu,
		uintptr(position),
		1,
		uintptr(unsafe.Pointer(&mi)),
	)
	if res == 0 {
		return err
	}

	return nil
}

func (t *winTray) hideMenuItem(menuItemID, parentID uint32) error {
	// https://docs.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-removemenu
	const mfByCommand = 0x00000000
	const errorSuccess syscall.Errno = 0

	t.muMenus.RLock()
	menu := uintptr(t.menus[parentID])
	t.muMenus.RUnlock()
	res, _, err := pRemoveMenu.Call(
		menu,
		uintptr(menuItemID),
		mfByCommand,
	)
	if res == 0 && err.(syscall.Errno) != errorSuccess {
		return err
	}
	t.delFromVisibleItems(parentID, menuItemID)

	return nil
}

func (t *winTray) showMenu() error {
	const (
		tpmBottomAlign = 0x0020
		tpmLeftAlign   = 0x0000
	)
	p := point{}
	res, _, err := pGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	if res == 0 {
		return err
	}
	pSetForegroundWindow.Call(uintptr(t.window))

	res, _, err = pTrackPopupMenu.Call(
		uintptr(t.menus[0]),
		tpmBottomAlign|tpmLeftAlign,
		uintptr(p.X),
		uintptr(p.Y),
		0,
		uintptr(t.window),
		0,
	)
	if res == 0 {
		return err
	}

	return nil
}

func (t *winTray) delFromVisibleItems(parent, val uint32) {
	t.muVisibleItems.Lock()
	defer t.muVisibleItems.Unlock()
	visibleItems := t.visibleItems[parent]
	for i, itemval := range visibleItems {
		if val == itemval {
			t.visibleItems[parent] = append(visibleItems[:i], visibleItems[i+1:]...)
			break
		}
	}
}

func (t *winTray) addToVisibleItems(parent, val uint32) {
	t.muVisibleItems.Lock()
	defer t.muVisibleItems.Unlock()
	if visibleItems, exists := t.visibleItems[parent]; !exists {
		t.visibleItems[parent] = []uint32{val}
	} else {
		newvisible := append(visibleItems, val)
		sort.Slice(newvisible, func(i, j int) bool { return newvisible[i] < newvisible[j] })
		t.visibleItems[parent] = newvisible
	}
}

func (t *winTray) getVisibleItemIndex(parent, val uint32) int {
	t.muVisibleItems.RLock()
	defer t.muVisibleItems.RUnlock()
	for i, itemval := range t.visibleItems[parent] {
		if val == itemval {
			return i
		}
	}
	return -1
}

// Loads an image from file to be shown in tray or menu item.
// LoadImage: https://msdn.microsoft.com/en-us/library/windows/desktop/ms648045(v=vs.85).aspx
func (t *winTray) loadIconFrom(src string) (windows.Handle, error) {
	const imageIcon = 1               // Loads an icon
	const lrLoadFromFile = 0x00000010 // Loads the stand-alone image from the file
	const lrDefaultSize = 0x00000040  // Loads default-size icon for windows(SM_CXICON x SM_CYICON) if cx, cy are set to zero

	// Save and reuse handles of loaded images
	t.muLoadedImages.RLock()
	h, ok := t.loadedImages[src]
	t.muLoadedImages.RUnlock()
	if !ok {
		srcPtr, err := windows.UTF16PtrFromString(src)
		if err != nil {
			return 0, err
		}
		res, _, err := pLoadImage.Call(
			0,
			uintptr(unsafe.Pointer(srcPtr)),
			imageIcon,
			0,
			0,
			lrLoadFromFile|lrDefaultSize,
		)
		if res == 0 {
			return 0, err
		}
		h = windows.Handle(res)
		t.muLoadedImages.Lock()
		t.loadedImages[src] = h
		t.muLoadedImages.Unlock()
	}
	return h, nil
}

func (t *winTray) iconToBitmap(hIcon windows.Handle) (windows.Handle, error) {
	const smCxSmIcon = 49
	const smCySmIcon = 50
	const diNormal = 0x3
	hDC, _, err := pGetDC.Call(uintptr(0))
	if hDC == 0 {
		return 0, err
	}
	defer pReleaseDC.Call(uintptr(0), hDC)
	hMemDC, _, err := pCreateCompatibleDC.Call(hDC)
	if hMemDC == 0 {
		return 0, err
	}
	defer pDeleteDC.Call(hMemDC)
	cx, _, _ := pGetSystemMetrics.Call(smCxSmIcon)
	cy, _, _ := pGetSystemMetrics.Call(smCySmIcon)
	hMemBmp, _, err := pCreateCompatibleBitmap.Call(hDC, cx, cy)
	if hMemBmp == 0 {
		return 0, err
	}
	hOriginalBmp, _, _ := pSelectObject.Call(hMemDC, hMemBmp)
	defer pSelectObject.Call(hMemDC, hOriginalBmp)
	res, _, err := pDrawIconEx.Call(hMemDC, 0, 0, uintptr(hIcon), cx, cy, 0, uintptr(0), diNormal)
	if res == 0 {
		return 0, err
	}
	return windows.Handle(hMemBmp), nil
}

func registerSystray() {
	if err := wt.initInstance(); err != nil {
		log.Errorf("Unable to init instance: %v", err)
		return
	}

	if err := wt.createMenu(); err != nil {
		log.Errorf("Unable to create menu: %v", err)
		return
	}

	systrayReady()
}

func nativeLoop() {
	// Main message pump.
	m := &struct {
		WindowHandle windows.Handle
		Message      uint32
		Wparam       uintptr
		Lparam       uintptr
		Time         uint32
		Pt           point
	}{}
	for {
		ret, _, err := pGetMessage.Call(uintptr(unsafe.Pointer(m)), 0, 0, 0)

		// If the function retrieves a message other than WM_QUIT, the return value is nonzero.
		// If the function retrieves the WM_QUIT message, the return value is zero.
		// If there is an error, the return value is -1
		// https://msdn.microsoft.com/en-us/library/windows/desktop/ms644936(v=vs.85).aspx
		switch int32(ret) {
		case -1:
			log.Errorf("Error at message loop: %v", err)
			return
		case 0:
			return
		default:
			pTranslateMessage.Call(uintptr(unsafe.Pointer(m)))
			pDispatchMessage.Call(uintptr(unsafe.Pointer(m)))
		}
	}
}

func quit() {
	const wmClose = 0x0010

	pPostMessage.Call(
		uintptr(wt.window),
		wmClose,
		0,
		0,
	)
}

func iconBytesToFilePath(iconBytes []byte) (string, error) {
	bh := md5.Sum(iconBytes)
	dataHash := hex.EncodeToString(bh[:])
	iconFilePath := filepath.Join(os.TempDir(), "systray_temp_icon_"+dataHash)

	if _, err := os.Stat(iconFilePath); os.IsNotExist(err) {
		if err := ioutil.WriteFile(iconFilePath, iconBytes, 0644); err != nil {
			return "", err
		}
	}
	return iconFilePath, nil
}

// SetIcon sets the systray icon.
// iconBytes should be the content of .ico for windows and .ico/.jpg/.png
// for other platforms.
func SetIcon(iconBytes []byte) {
	iconFilePath, err := iconBytesToFilePath(iconBytes)
	if err != nil {
		log.Errorf("Unable to write icon data to temp file: %v", err)
		return
	}
	if err := wt.setIcon(iconFilePath); err != nil {
		log.Errorf("Unable to set icon: %v", err)
		return
	}
}

// SetTemplateIcon sets the systray icon as a template icon (on macOS), falling back
// to a regular icon on other platforms.
// templateIconBytes and iconBytes should be the content of .ico for windows and
// .ico/.jpg/.png for other platforms.
func SetTemplateIcon(templateIconBytes []byte, regularIconBytes []byte) {
	SetIcon(regularIconBytes)
}

// SetTitle sets the systray title, only available on Mac and Linux.
func SetTitle(title string) {
	// do nothing
}

func (item *MenuItem) parentID() uint32 {
	if item.parent != nil {
		return uint32(item.parent.id)
	}
	return 0
}

// SetIcon sets the icon of a menu item. Only works on macOS and Windows.
// iconBytes should be the content of .ico/.jpg/.png
func (item *MenuItem) SetIcon(iconBytes []byte) {
	iconFilePath, err := iconBytesToFilePath(iconBytes)
	if err != nil {
		log.Errorf("Unable to write icon data to temp file: %v", err)
		return
	}

	h, err := wt.loadIconFrom(iconFilePath)
	if err != nil {
		log.Errorf("Unable to load icon from temp file: %v", err)
		return
	}

	h, err = wt.iconToBitmap(h)
	if err != nil {
		log.Errorf("Unable to convert icon to bitmap: %v", err)
		return
	}
	wt.muMenuItemIcons.Lock()
	wt.menuItemIcons[uint32(item.id)] = h
	wt.muMenuItemIcons.Unlock()

	err = wt.addOrUpdateMenuItem(uint32(item.id), item.parentID(), item.title, item.disabled, item.checked)
	if err != nil {
		log.Errorf("Unable to addOrUpdateMenuItem: %v", err)
		return
	}
}

// SetTooltip sets the systray tooltip to display on mouse hover of the tray icon,
// only available on Mac and Windows.
func SetTooltip(tooltip string) {
	if err := wt.setTooltip(tooltip); err != nil {
		log.Errorf("Unable to set tooltip: %v", err)
		return
	}
}

func addOrUpdateMenuItem(item *MenuItem) {
	err := wt.addOrUpdateMenuItem(uint32(item.id), item.parentID(), item.title, item.disabled, item.checked)
	if err != nil {
		log.Errorf("Unable to addOrUpdateMenuItem: %v", err)
		return
	}
}

// SetTemplateIcon sets the icon of a menu item as a template icon (on macOS). On Windows, it
// falls back to the regular icon bytes and on Linux it does nothing.
// templateIconBytes and regularIconBytes should be the content of .ico for windows and
// .ico/.jpg/.png for other platforms.
func (item *MenuItem) SetTemplateIcon(templateIconBytes []byte, regularIconBytes []byte) {
	item.SetIcon(regularIconBytes)
}

func addSeparator(id uint32) {
	err := wt.addSeparatorMenuItem(id, 0)
	if err != nil {
		log.Errorf("Unable to addSeparator: %v", err)
		return
	}
}

func hideMenuItem(item *MenuItem) {
	err := wt.hideMenuItem(uint32(item.id), item.parentID())
	if err != nil {
		log.Errorf("Unable to hideMenuItem: %v", err)
		return
	}
}

func showMenuItem(item *MenuItem) {
	addOrUpdateMenuItem(item)
}
