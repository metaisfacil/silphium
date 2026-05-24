//go:build windows

package main

import (
	"crypto/sha1" // #nosec G505 -- used only for WinRT GUID derivation.
	"encoding/binary"
	"errors"
	"log"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"golang.org/x/sys/windows"
)

const (
	roInitMultithreaded                                   = 1
	systemMediaTransportControlsClassName                 = "Windows.Media.SystemMediaTransportControls"
	smtcInitializeRetryInterval                           = 200 * time.Millisecond
	smtcMinTimelineSyncInterval                           = time.Second
	smtcTypedEventHandlerGUID                             = "9de1c534-6ae1-11e0-84e1-18a905bcc53f"
	smtcISystemMediaTransportControlsGUID                 = "99fa3ff4-1742-42a6-902e-087d41f965ec"
	smtcISystemMediaTransportControls2GUID                = "ea98d2f6-7f3c-4af2-a586-72889808efb1"
	smtcISystemMediaTransportControlsInteropGUID          = "ddb0472d-c911-4a1f-86d9-dc3d71a95f5a"
	smtcISystemMediaTransportControlsDisplayUpdaterGUID   = "8abbc53e-fa55-4ecf-ad8e-c984e5dd1550"
	smtcIUriRuntimeClassFactoryGUID                       = "44a9796f-723e-4fdf-a218-033e75b0c084"
	smtcIRandomAccessStreamReferenceStaticsGUID           = "857309dc-3fbf-4e7d-986f-ef3b1a07a964"
	smtcIMusicDisplayPropertiesGUID                       = "6bbf0c59-d0a0-4d26-92a0-f978e1d18e7b"
	smtcIMusicDisplayProperties2GUID                      = "00368462-97d3-44b9-b00f-008afcefaf18"
	smtcIButtonPressedEventArgsGUID                       = "b7f47116-a56f-4dc8-9e11-92031f4a87c2"
	smtcIPlaybackPositionChangeRequestedEventArgsGUID     = "b4493f88-eb28-4961-9c14-335e44f3e125"
	smtcSignatureSystemMediaTransportControls             = "rc(Windows.Media.SystemMediaTransportControls;{99fa3ff4-1742-42a6-902e-087d41f965ec})"
	smtcSignatureButtonPressedEventArgs                   = "rc(Windows.Media.SystemMediaTransportControlsButtonPressedEventArgs;{b7f47116-a56f-4dc8-9e11-92031f4a87c2})"
	smtcSignaturePlaybackPositionChangeRequestedEventArgs = "rc(Windows.Media.PlaybackPositionChangeRequestedEventArgs;{b4493f88-eb28-4961-9c14-335e44f3e125})"
	gwOwner                                               = 4

	mediaPlaybackTypeMusic = 1

	smtcButtonPlay     = 0
	smtcButtonPause    = 1
	smtcButtonStop     = 2
	smtcButtonNext     = 6
	smtcButtonPrevious = 7

	sOk = 0
)

var (
	errSystemMediaTransportControlsWindowNotFound = errors.New("system media transport controls window not ready")

	combaseDLL         = windows.NewLazySystemDLL("combase.dll")
	procRoUninitialize = combaseDLL.NewProc("RoUninitialize")

	user32SMTCDLL                = windows.NewLazySystemDLL("user32.dll")
	procEnumWindows              = user32SMTCDLL.NewProc("EnumWindows")
	procGetWindowThreadProcessID = user32SMTCDLL.NewProc("GetWindowThreadProcessId")
	procGetWindowTextW           = user32SMTCDLL.NewProc("GetWindowTextW")
	procGetWindowTextLengthW     = user32SMTCDLL.NewProc("GetWindowTextLengthW")
	procIsWindowVisible          = user32SMTCDLL.NewProc("IsWindowVisible")
	procGetWindow                = user32SMTCDLL.NewProc("GetWindow")

	smtcButtonPressedHandlerIID = ole.NewGUID(parameterizedInstanceGUID(
		smtcTypedEventHandlerGUID,
		smtcSignatureSystemMediaTransportControls,
		smtcSignatureButtonPressedEventArgs,
	))
	smtcPlaybackPositionChangeRequestedHandlerIID = ole.NewGUID(parameterizedInstanceGUID(
		smtcTypedEventHandlerGUID,
		smtcSignatureSystemMediaTransportControls,
		smtcSignaturePlaybackPositionChangeRequestedEventArgs,
	))
)

type windowsSystemMediaTransportControlsManager struct {
	mu          sync.Mutex
	app         *App
	signalCh    chan struct{}
	stopCh      chan struct{}
	doneCh      chan struct{}
	hasSnapshot bool
	snapshot    systemMediaTransportControlsSnapshot
}

type windowsSystemMediaTransportControlsWorkerState struct {
	app                *App
	controls           *systemMediaTransportControls
	updater            *systemMediaTransportControlsDisplayUpdater
	buttonHandler      *typedEventHandler
	buttonToken        eventRegistrationToken
	hasButtonToken     bool
	seekHandler        *typedEventHandler
	seekToken          eventRegistrationToken
	hasSeekToken       bool
	lastSnapshot       systemMediaTransportControlsSnapshot
	hasLastSnapshot    bool
	lastMetadataKey    string
	lastTimelineSynced time.Time
	ready              bool
}

type eventRegistrationToken struct {
	Value int64
}

type systemMediaTransportControls struct {
	ole.IUnknown
}

type systemMediaTransportControlsDisplayUpdater struct {
	ole.IUnknown
}

type musicDisplayProperties struct {
	ole.IUnknown
}

type uriRuntimeClass struct {
	ole.IUnknown
}

type randomAccessStreamReference struct {
	ole.IUnknown
}

type systemMediaTransportControlsTimelineProperties struct {
	ole.IUnknown
}

type systemMediaTransportControlsButtonPressedEventArgs struct {
	ole.IUnknown
}

type playbackPositionChangeRequestedEventArgs struct {
	ole.IUnknown
}

type systemMediaTransportControlsInterop struct {
	ole.IInspectable
}

type iSystemMediaTransportControls struct {
	ole.IInspectable
}

type iSystemMediaTransportControls2 struct {
	ole.IInspectable
}

type iSystemMediaTransportControlsDisplayUpdater struct {
	ole.IInspectable
}

type iMusicDisplayProperties struct {
	ole.IInspectable
}

type iMusicDisplayProperties2 struct {
	ole.IInspectable
}

type iURIRuntimeClassFactory struct {
	ole.IInspectable
}

type iRandomAccessStreamReferenceStatics struct {
	ole.IInspectable
}

type iSystemMediaTransportControlsTimelineProperties struct {
	ole.IInspectable
}

type iSystemMediaTransportControlsButtonPressedEventArgs struct {
	ole.IInspectable
}

type iPlaybackPositionChangeRequestedEventArgs struct {
	ole.IInspectable
}

type systemMediaTransportControlsInteropVtbl struct {
	ole.IInspectableVtbl
	GetForWindow uintptr
}

type iSystemMediaTransportControlsVtbl struct {
	ole.IInspectableVtbl
	GetPlaybackStatus       uintptr
	SetPlaybackStatus       uintptr
	GetDisplayUpdater       uintptr
	GetSoundLevel           uintptr
	GetIsEnabled            uintptr
	SetIsEnabled            uintptr
	GetIsPlayEnabled        uintptr
	SetIsPlayEnabled        uintptr
	GetIsStopEnabled        uintptr
	SetIsStopEnabled        uintptr
	GetIsPauseEnabled       uintptr
	SetIsPauseEnabled       uintptr
	GetIsRecordEnabled      uintptr
	SetIsRecordEnabled      uintptr
	GetIsFastForwardEnabled uintptr
	SetIsFastForwardEnabled uintptr
	GetIsRewindEnabled      uintptr
	SetIsRewindEnabled      uintptr
	GetIsPreviousEnabled    uintptr
	SetIsPreviousEnabled    uintptr
	GetIsNextEnabled        uintptr
	SetIsNextEnabled        uintptr
	GetIsChannelUpEnabled   uintptr
	SetIsChannelUpEnabled   uintptr
	GetIsChannelDownEnabled uintptr
	SetIsChannelDownEnabled uintptr
	AddButtonPressed        uintptr
	RemoveButtonPressed     uintptr
	AddPropertyChanged      uintptr
	RemovePropertyChanged   uintptr
}

type iSystemMediaTransportControls2Vtbl struct {
	ole.IInspectableVtbl
	GetAutoRepeatMode                     uintptr
	SetAutoRepeatMode                     uintptr
	GetShuffleEnabled                     uintptr
	SetShuffleEnabled                     uintptr
	GetPlaybackRate                       uintptr
	SetPlaybackRate                       uintptr
	UpdateTimelineProperties              uintptr
	AddPlaybackPositionChangeRequested    uintptr
	RemovePlaybackPositionChangeRequested uintptr
	AddPlaybackRateChangeRequested        uintptr
	RemovePlaybackRateChangeRequested     uintptr
	AddShuffleEnabledChangeRequested      uintptr
	RemoveShuffleEnabledChangeRequested   uintptr
	AddAutoRepeatModeChangeRequested      uintptr
	RemoveAutoRepeatModeChangeRequested   uintptr
}

type iSystemMediaTransportControlsDisplayUpdaterVtbl struct {
	ole.IInspectableVtbl
	GetType            uintptr
	SetType            uintptr
	GetAppMediaID      uintptr
	SetAppMediaID      uintptr
	GetThumbnail       uintptr
	SetThumbnail       uintptr
	GetMusicProperties uintptr
	GetVideoProperties uintptr
	GetImageProperties uintptr
	CopyFromFileAsync  uintptr
	ClearAll           uintptr
	Update             uintptr
}

type iMusicDisplayPropertiesVtbl struct {
	ole.IInspectableVtbl
	GetTitle       uintptr
	SetTitle       uintptr
	GetAlbumArtist uintptr
	SetAlbumArtist uintptr
	GetArtist      uintptr
	SetArtist      uintptr
}

type iMusicDisplayProperties2Vtbl struct {
	ole.IInspectableVtbl
	GetAlbumTitle  uintptr
	SetAlbumTitle  uintptr
	GetTrackNumber uintptr
	SetTrackNumber uintptr
	GetGenres      uintptr
}

type iURIRuntimeClassFactoryVtbl struct {
	ole.IInspectableVtbl
	CreateURI             uintptr
	CreateWithRelativeURI uintptr
}

type iRandomAccessStreamReferenceStaticsVtbl struct {
	ole.IInspectableVtbl
	CreateFromFile   uintptr
	CreateFromURI    uintptr
	CreateFromStream uintptr
}

type iSystemMediaTransportControlsTimelinePropertiesVtbl struct {
	ole.IInspectableVtbl
	GetStartTime   uintptr
	SetStartTime   uintptr
	GetEndTime     uintptr
	SetEndTime     uintptr
	GetMinSeekTime uintptr
	SetMinSeekTime uintptr
	GetMaxSeekTime uintptr
	SetMaxSeekTime uintptr
	GetPosition    uintptr
	SetPosition    uintptr
}

type iSystemMediaTransportControlsButtonPressedEventArgsVtbl struct {
	ole.IInspectableVtbl
	GetButton uintptr
}

type iPlaybackPositionChangeRequestedEventArgsVtbl struct {
	ole.IInspectableVtbl
	GetRequestedPlaybackPosition uintptr
}

type typedEventHandler struct {
	ole.IUnknown
	refs         int32
	interfaceIID *ole.GUID
	invoke       func(uintptr) uintptr
}

type typedEventHandlerVtbl struct {
	ole.IUnknownVtbl
	Invoke uintptr
}

var typedEventHandlerVTable = typedEventHandlerVtbl{
	IUnknownVtbl: ole.IUnknownVtbl{
		QueryInterface: syscall.NewCallback(typedEventHandlerQueryInterface),
		AddRef:         syscall.NewCallback(typedEventHandlerAddRef),
		Release:        syscall.NewCallback(typedEventHandlerRelease),
	},
	Invoke: syscall.NewCallback(typedEventHandlerInvoke),
}

func newSystemMediaTransportControlsManager() systemMediaTransportControlsManager {
	return &windowsSystemMediaTransportControlsManager{}
}

func (m *windowsSystemMediaTransportControlsManager) Start(app *App) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stopCh != nil {
		return
	}

	m.app = app
	m.signalCh = make(chan struct{}, 1)
	m.stopCh = make(chan struct{})
	m.doneCh = make(chan struct{})

	go m.runWorker(m.app, m.signalCh, m.stopCh, m.doneCh)
}

func (m *windowsSystemMediaTransportControlsManager) Stop() {
	m.mu.Lock()
	if m.stopCh == nil {
		m.mu.Unlock()
		return
	}

	stopCh := m.stopCh
	doneCh := m.doneCh
	m.signalCh = nil
	m.stopCh = nil
	m.doneCh = nil
	m.hasSnapshot = false
	m.snapshot = systemMediaTransportControlsSnapshot{}
	m.mu.Unlock()

	close(stopCh)
	<-doneCh
}

func (m *windowsSystemMediaTransportControlsManager) Sync(snapshot systemMediaTransportControlsSnapshot) {
	m.mu.Lock()
	if m.signalCh == nil {
		m.mu.Unlock()
		return
	}

	m.snapshot = snapshot
	m.hasSnapshot = true
	signalCh := m.signalCh
	m.mu.Unlock()

	select {
	case signalCh <- struct{}{}:
	default:
	}
}

func (m *windowsSystemMediaTransportControlsManager) runWorker(app *App, signalCh <-chan struct{}, stopCh <-chan struct{}, doneCh chan<- struct{}) {
	defer close(doneCh)

	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	initialized := false
	if err := ole.RoInitialize(roInitMultithreaded); err != nil {
		log.Printf("failed to initialize WinRT for system media transport controls: %v", err)
	} else {
		initialized = true
		defer func() {
			_, _, _ = procRoUninitialize.Call()
		}()
	}

	workerState := &windowsSystemMediaTransportControlsWorkerState{app: app}
	ticker := time.NewTicker(smtcInitializeRetryInterval)
	defer ticker.Stop()
	defer workerState.release()

	for {
		select {
		case <-stopCh:
			return
		case <-signalCh:
			if !initialized {
				continue
			}
			if snapshot, ok := m.currentSnapshot(); ok {
				workerState.lastSnapshot = snapshot
				workerState.hasLastSnapshot = true
				if workerState.ready {
					workerState.applySnapshot(snapshot)
				}
			}
		case <-ticker.C:
			if !initialized || workerState.ready {
				continue
			}
			if err := workerState.tryInitialize(); err != nil {
				if !errors.Is(err, errSystemMediaTransportControlsWindowNotFound) {
					log.Printf("failed to initialize system media transport controls: %v", err)
				}
				continue
			}
			if snapshot, ok := m.currentSnapshot(); ok {
				workerState.lastSnapshot = snapshot
				workerState.hasLastSnapshot = true
				workerState.applySnapshot(snapshot)
			}
		}
	}
}

func (m *windowsSystemMediaTransportControlsManager) currentSnapshot() (systemMediaTransportControlsSnapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.snapshot, m.hasSnapshot
}

func (s *windowsSystemMediaTransportControlsWorkerState) tryInitialize() error {
	hwnd, err := findCurrentProcessMainWindow()
	if err != nil {
		return err
	}

	controls, updater, buttonHandler, buttonToken, seekHandler, seekToken, err := createSystemMediaTransportControlsForWindow(hwnd, func(button uintptr) {
		action := mediaKeyActionForSMTCButton(button)
		if action == "" {
			return
		}
		s.app.emitMediaKeyAction(action)
	}, func(seconds float64) {
		s.app.handleSystemMediaTransportControlsSeekRequested(seconds)
	})
	if err != nil {
		return err
	}

	s.controls = controls
	s.updater = updater
	s.buttonHandler = buttonHandler
	s.buttonToken = buttonToken
	s.hasButtonToken = true
	s.seekHandler = seekHandler
	s.seekToken = seekToken
	s.hasSeekToken = true
	s.ready = true
	return nil
}

func (s *windowsSystemMediaTransportControlsWorkerState) release() {
	if s.controls != nil {
		if err := s.controls.SetPlaybackStatus(systemMediaTransportControlsResetPlaybackStatus()); err != nil {
			log.Printf("failed to reset system media transport controls playback status: %v", err)
		}
	}
	if s.updater != nil {
		if err := s.updater.ClearAll(); err != nil {
			log.Printf("failed to clear system media transport controls metadata on release: %v", err)
		} else if err := s.updater.Update(); err != nil {
			log.Printf("failed to publish cleared system media transport controls metadata on release: %v", err)
		}
	}
	if s.controls != nil && s.hasSeekToken {
		if err := s.controls.RemovePlaybackPositionChangeRequested(s.seekToken); err != nil {
			log.Printf("failed to detach system media transport controls seek handler: %v", err)
		}
	}
	if s.controls != nil && s.hasButtonToken {
		if err := s.controls.RemoveButtonPressed(s.buttonToken); err != nil {
			log.Printf("failed to detach system media transport controls button handler: %v", err)
		}
	}
	if s.seekHandler != nil {
		s.seekHandler.Release()
		s.seekHandler = nil
	}
	if s.buttonHandler != nil {
		s.buttonHandler.Release()
		s.buttonHandler = nil
	}
	if s.updater != nil {
		s.updater.Release()
		s.updater = nil
	}
	if s.controls != nil {
		if err := s.controls.SetIsEnabled(false); err != nil {
			log.Printf("failed to disable system media transport controls on release: %v", err)
		}
		s.controls.Release()
		s.controls = nil
	}
	s.ready = false
	s.hasSeekToken = false
	s.hasButtonToken = false
	s.lastMetadataKey = ""
	s.hasLastSnapshot = false
	s.lastSnapshot = systemMediaTransportControlsSnapshot{}
	s.lastTimelineSynced = time.Time{}
}

func (s *windowsSystemMediaTransportControlsWorkerState) applySnapshot(snapshot systemMediaTransportControlsSnapshot) {
	if s.controls == nil || s.updater == nil {
		return
	}

	if err := s.controls.SetPlaybackStatus(playbackStatusForSnapshot(snapshot)); err != nil {
		log.Printf("failed to update system media transport controls playback status: %v", err)
	}

	metadataKey := snapshot.SourcePath + "\n" + snapshot.Title + "\n" + snapshot.Artist + "\n" + snapshot.AlbumTitle + "\n" + snapshot.AlbumArtist + "\n" + snapshot.CoverArtURL
	metadataChanged := !s.hasLastSnapshot || metadataKey != s.lastMetadataKey || snapshot.Loaded != s.lastSnapshot.Loaded
	if metadataChanged {
		if err := s.syncMetadata(snapshot); err != nil {
			log.Printf("failed to update system media transport controls metadata: %v", err)
		} else {
			s.lastMetadataKey = metadataKey
		}
	}

	shouldSyncTimeline := metadataChanged || !s.hasLastSnapshot || snapshot.Playing != s.lastSnapshot.Playing || snapshot.Duration != s.lastSnapshot.Duration || (!s.lastTimelineSynced.IsZero() && time.Since(s.lastTimelineSynced) >= smtcMinTimelineSyncInterval)
	if !shouldSyncTimeline && absFloat64(snapshot.CurrentTime-s.lastSnapshot.CurrentTime) >= 0.75 {
		shouldSyncTimeline = true
	}
	if shouldSyncTimeline {
		if err := s.syncTimeline(snapshot); err != nil {
			log.Printf("failed to update system media transport controls timeline: %v", err)
		} else {
			s.lastTimelineSynced = time.Now()
		}
	}

	s.lastSnapshot = snapshot
	s.hasLastSnapshot = true
}

func (s *windowsSystemMediaTransportControlsWorkerState) syncMetadata(snapshot systemMediaTransportControlsSnapshot) error {
	if err := s.updater.ClearAll(); err != nil {
		return err
	}
	if err := s.updater.SetType(mediaPlaybackTypeMusic); err != nil {
		return err
	}
	if !snapshot.Loaded || snapshot.SourcePath == "" {
		return s.updater.Update()
	}

	musicProperties, err := s.updater.GetMusicProperties()
	if err != nil {
		return err
	}
	defer musicProperties.Release()

	if err := musicProperties.SetTitle(snapshot.Title); err != nil {
		return err
	}
	if err := musicProperties.SetArtist(snapshot.Artist); err != nil {
		return err
	}
	if err := musicProperties.SetAlbumArtist(snapshot.AlbumArtist); err != nil {
		return err
	}
	if err := musicProperties.SetAlbumTitle(snapshot.AlbumTitle); err != nil {
		return err
	}
	if snapshot.CoverArtURL != "" {
		thumbnail, err := newRandomAccessStreamReferenceFromURIString(snapshot.CoverArtURL)
		if err != nil {
			log.Printf("failed to build system media transport controls thumbnail reference: %v", err)
		} else {
			defer thumbnail.Release()
			if err := s.updater.SetThumbnail(thumbnail); err != nil {
				log.Printf("failed to update system media transport controls thumbnail: %v", err)
			}
		}
	}

	return s.updater.Update()
}

func (s *windowsSystemMediaTransportControlsWorkerState) syncTimeline(snapshot systemMediaTransportControlsSnapshot) error {
	if !snapshot.Loaded || snapshot.Duration <= 0 {
		return nil
	}

	timeline, err := newSystemMediaTransportControlsTimelineProperties()
	if err != nil {
		return err
	}
	defer timeline.Release()

	start := secondsToTimeSpan(0)
	position := secondsToTimeSpan(snapshot.CurrentTime)
	end := secondsToTimeSpan(snapshot.Duration)
	if err := timeline.SetStartTime(start); err != nil {
		return err
	}
	if err := timeline.SetMinSeekTime(start); err != nil {
		return err
	}
	if err := timeline.SetPosition(position); err != nil {
		return err
	}
	if err := timeline.SetEndTime(end); err != nil {
		return err
	}
	if err := timeline.SetMaxSeekTime(end); err != nil {
		return err
	}

	return s.controls.UpdateTimelineProperties(timeline)
}

func createSystemMediaTransportControlsForWindow(hwnd windows.HWND, onButtonPressed func(button uintptr), onSeekRequested func(seconds float64)) (*systemMediaTransportControls, *systemMediaTransportControlsDisplayUpdater, *typedEventHandler, eventRegistrationToken, *typedEventHandler, eventRegistrationToken, error) {
	inspectable, err := ole.RoGetActivationFactory(systemMediaTransportControlsClassName, ole.NewGUID(smtcISystemMediaTransportControlsInteropGUID))
	if err != nil {
		return nil, nil, nil, eventRegistrationToken{}, nil, eventRegistrationToken{}, err
	}
	interop := (*systemMediaTransportControlsInterop)(unsafe.Pointer(inspectable))
	defer interop.Release()

	controls, err := interop.GetForWindow(hwnd, ole.NewGUID(smtcISystemMediaTransportControlsGUID))
	if err != nil {
		return nil, nil, nil, eventRegistrationToken{}, nil, eventRegistrationToken{}, err
	}

	updater, err := controls.GetDisplayUpdater()
	if err != nil {
		controls.Release()
		return nil, nil, nil, eventRegistrationToken{}, nil, eventRegistrationToken{}, err
	}

	for _, configure := range []func() error{
		func() error { return controls.SetIsEnabled(true) },
		func() error { return controls.SetIsPlayEnabled(true) },
		func() error { return controls.SetIsPauseEnabled(true) },
		func() error { return controls.SetIsNextEnabled(true) },
		func() error { return controls.SetIsPreviousEnabled(true) },
		func() error { return controls.SetIsStopEnabled(true) },
		func() error { return controls.SetPlaybackStatus(systemMediaTransportControlsResetPlaybackStatus()) },
		func() error { return updater.SetType(mediaPlaybackTypeMusic) },
	} {
		if configureErr := configure(); configureErr != nil {
			updater.Release()
			controls.Release()
			return nil, nil, nil, eventRegistrationToken{}, nil, eventRegistrationToken{}, configureErr
		}
	}

	buttonHandler := newButtonPressedEventHandler(onButtonPressed)
	buttonToken, err := controls.AddButtonPressed(buttonHandler)
	if err != nil {
		buttonHandler.Release()
		updater.Release()
		controls.Release()
		return nil, nil, nil, eventRegistrationToken{}, nil, eventRegistrationToken{}, err
	}

	seekHandler := newPlaybackPositionChangeRequestedEventHandler(onSeekRequested)
	seekToken, err := controls.AddPlaybackPositionChangeRequested(seekHandler)
	if err != nil {
		_ = controls.RemoveButtonPressed(buttonToken)
		seekHandler.Release()
		buttonHandler.Release()
		updater.Release()
		controls.Release()
		return nil, nil, nil, eventRegistrationToken{}, nil, eventRegistrationToken{}, err
	}

	return controls, updater, buttonHandler, buttonToken, seekHandler, seekToken, nil
}

func findCurrentProcessMainWindow() (windows.HWND, error) {
	targetPID := uint32(os.Getpid())
	var found windows.HWND
	bestTitleScore := -1

	callback := syscall.NewCallback(func(hwnd uintptr, _ uintptr) uintptr {
		var windowPID uint32
		_, _, _ = procGetWindowThreadProcessID.Call(hwnd, uintptr(unsafe.Pointer(&windowPID)))
		if windowPID != targetPID {
			return 1
		}
		visible, _, _ := procIsWindowVisible.Call(hwnd)
		if visible == 0 {
			return 1
		}
		owner, _, _ := procGetWindow.Call(hwnd, gwOwner)
		if owner != 0 {
			return 1
		}
		textLength, _, _ := procGetWindowTextLengthW.Call(hwnd)
		if textLength == 0 {
			return 1
		}
		buffer := make([]uint16, textLength+1)
		_, _, _ = procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buffer[0])), textLength+1)
		titleScore := systemMediaTransportControlsWindowTitleScore(windows.UTF16ToString(buffer))
		if titleScore < 0 {
			return 1
		}
		if found == 0 || titleScore > bestTitleScore {
			found = windows.HWND(hwnd)
			bestTitleScore = titleScore
		}
		if titleScore >= 2 {
			return 0
		}
		return 1
	})

	ret, _, callErr := procEnumWindows.Call(callback, 0)
	if found != 0 {
		return found, nil
	}
	if ret == 0 && callErr != windows.ERROR_SUCCESS {
		return 0, callErr
	}

	return 0, errSystemMediaTransportControlsWindowNotFound
}

func mediaKeyActionForSMTCButton(button uintptr) string {
	switch button {
	case smtcButtonPlay, smtcButtonPause:
		return "playpause"
	case smtcButtonStop:
		return "stop"
	case smtcButtonNext:
		return "next"
	case smtcButtonPrevious:
		return "previous"
	default:
		return ""
	}
}

func (a *App) handleSystemMediaTransportControlsSeekRequested(seconds float64) {
	normalizedSeconds, ok := normalizeSystemMediaTransportControlsSeekSeconds(seconds)
	if !ok {
		return
	}

	go func() {
		if _, err := a.AudioSeek(normalizedSeconds); err != nil {
			log.Printf("failed to handle system media transport controls seek request: %v", err)
		}
	}()
}

func absFloat64(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

func parameterizedInstanceGUID(baseGUID string, signatures ...string) string {
	return guidFromSignature("pinterface({" + baseGUID + "};" + stringsJoin(signatures, ";") + ")")
}

func guidFromSignature(signature string) string {
	data := []byte{0x11, 0xf4, 0x7a, 0xd5, 0x7b, 0x73, 0x42, 0xc0, 0xab, 0xae, 0x87, 0x8b, 0x1e, 0x16, 0xad, 0xee}
	data = append(data, []byte(signature)...)

	hash := sha1.Sum(data)
	first := binary.BigEndian.Uint32(hash[0:4])
	second := binary.BigEndian.Uint16(hash[4:6])
	third := (binary.BigEndian.Uint16(hash[6:8]) & 0x0fff) | (5 << 12)
	fourth := (hash[8] & 0x3f) | 0x80

	guid := ole.GUID{
		Data1: first,
		Data2: second,
		Data3: third,
		Data4: [8]byte{fourth, hash[9], hash[10], hash[11], hash[12], hash[13], hash[14], hash[15]},
	}
	return (&guid).String()
}

func stringsJoin(parts []string, separator string) string {
	if len(parts) == 0 {
		return ""
	}
	joined := parts[0]
	for _, part := range parts[1:] {
		joined += separator + part
	}
	return joined
}

func newTypedEventHandler(interfaceIID *ole.GUID, invoke func(uintptr) uintptr) *typedEventHandler {
	return &typedEventHandler{
		IUnknown:     ole.IUnknown{RawVTable: (*interface{})(unsafe.Pointer(&typedEventHandlerVTable))},
		refs:         1,
		interfaceIID: interfaceIID,
		invoke:       invoke,
	}
}

func newButtonPressedEventHandler(callback func(button uintptr)) *typedEventHandler {
	return newTypedEventHandler(smtcButtonPressedHandlerIID, func(args uintptr) uintptr {
		if callback == nil {
			return sOk
		}
		eventArgs := (*systemMediaTransportControlsButtonPressedEventArgs)(unsafe.Pointer(args))
		button, err := eventArgs.GetButton()
		if err != nil {
			return ole.E_FAIL
		}
		callback(button)
		return sOk
	})
}

func newPlaybackPositionChangeRequestedEventHandler(callback func(seconds float64)) *typedEventHandler {
	return newTypedEventHandler(smtcPlaybackPositionChangeRequestedHandlerIID, func(args uintptr) uintptr {
		if callback == nil {
			return sOk
		}
		eventArgs := (*playbackPositionChangeRequestedEventArgs)(unsafe.Pointer(args))
		position, err := eventArgs.GetRequestedPlaybackPosition()
		if err != nil {
			return ole.E_FAIL
		}
		callback(timeSpanToSeconds(position))
		return sOk
	})
}

func typedEventHandlerQueryInterface(this uintptr, iidPtr uintptr, object uintptr) uintptr {
	if object == 0 {
		return ole.E_POINTER
	}

	iid := (*ole.GUID)(unsafe.Pointer(iidPtr))
	handler := (*typedEventHandler)(unsafe.Pointer(this))
	if !ole.IsEqualGUID(iid, ole.IID_IUnknown) && !ole.IsEqualGUID(iid, ole.IID_IInspectable) && (handler.interfaceIID == nil || !ole.IsEqualGUID(iid, handler.interfaceIID)) {
		*(*uintptr)(unsafe.Pointer(object)) = 0
		return ole.E_NOINTERFACE
	}

	*(*uintptr)(unsafe.Pointer(object)) = this
	typedEventHandlerAddRef(this)
	return sOk
}

func typedEventHandlerAddRef(this uintptr) uintptr {
	handler := (*typedEventHandler)(unsafe.Pointer(this))
	return uintptr(atomic.AddInt32(&handler.refs, 1))
}

func typedEventHandlerRelease(this uintptr) uintptr {
	handler := (*typedEventHandler)(unsafe.Pointer(this))
	remaining := atomic.AddInt32(&handler.refs, -1)
	if remaining < 0 {
		atomic.StoreInt32(&handler.refs, 0)
		return 0
	}
	return uintptr(remaining)
}

func typedEventHandlerInvoke(this uintptr, sender uintptr, args uintptr) uintptr {
	handler := (*typedEventHandler)(unsafe.Pointer(this))
	if handler.invoke == nil {
		return sOk
	}
	return handler.invoke(args)
}

func (v *systemMediaTransportControlsInterop) VTable() *systemMediaTransportControlsInteropVtbl {
	return (*systemMediaTransportControlsInteropVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *systemMediaTransportControlsInterop) GetForWindow(hwnd windows.HWND, iid *ole.GUID) (*systemMediaTransportControls, error) {
	var out *systemMediaTransportControls
	hr, _, _ := syscall.SyscallN(
		v.VTable().GetForWindow,
		uintptr(unsafe.Pointer(v)),
		uintptr(hwnd),
		uintptr(unsafe.Pointer(iid)),
		uintptr(unsafe.Pointer(&out)),
	)
	if hr != 0 {
		return nil, ole.NewError(hr)
	}
	return out, nil
}

func (v *iSystemMediaTransportControls) VTable() *iSystemMediaTransportControlsVtbl {
	return (*iSystemMediaTransportControlsVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iSystemMediaTransportControls2) VTable() *iSystemMediaTransportControls2Vtbl {
	return (*iSystemMediaTransportControls2Vtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iSystemMediaTransportControlsDisplayUpdater) VTable() *iSystemMediaTransportControlsDisplayUpdaterVtbl {
	return (*iSystemMediaTransportControlsDisplayUpdaterVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iMusicDisplayProperties) VTable() *iMusicDisplayPropertiesVtbl {
	return (*iMusicDisplayPropertiesVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iMusicDisplayProperties2) VTable() *iMusicDisplayProperties2Vtbl {
	return (*iMusicDisplayProperties2Vtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iURIRuntimeClassFactory) VTable() *iURIRuntimeClassFactoryVtbl {
	return (*iURIRuntimeClassFactoryVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iRandomAccessStreamReferenceStatics) VTable() *iRandomAccessStreamReferenceStaticsVtbl {
	return (*iRandomAccessStreamReferenceStaticsVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iSystemMediaTransportControlsTimelineProperties) VTable() *iSystemMediaTransportControlsTimelinePropertiesVtbl {
	return (*iSystemMediaTransportControlsTimelinePropertiesVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iSystemMediaTransportControlsButtonPressedEventArgs) VTable() *iSystemMediaTransportControlsButtonPressedEventArgsVtbl {
	return (*iSystemMediaTransportControlsButtonPressedEventArgsVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *iPlaybackPositionChangeRequestedEventArgs) VTable() *iPlaybackPositionChangeRequestedEventArgsVtbl {
	return (*iPlaybackPositionChangeRequestedEventArgsVtbl)(unsafe.Pointer(v.RawVTable))
}

func (v *systemMediaTransportControls) SetPlaybackStatus(value uintptr) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsGUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(controls.VTable().SetPlaybackStatus, uintptr(unsafe.Pointer(controls)), value)
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControls) GetDisplayUpdater() (*systemMediaTransportControlsDisplayUpdater, error) {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsGUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls)(unsafe.Pointer(itf))
	var out *systemMediaTransportControlsDisplayUpdater
	hr, _, _ := syscall.SyscallN(controls.VTable().GetDisplayUpdater, uintptr(unsafe.Pointer(controls)), uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return nil, ole.NewError(hr)
	}
	return out, nil
}

func (v *systemMediaTransportControls) SetIsEnabled(value bool) error {
	return v.setBoolProperty(smtcISystemMediaTransportControlsGUID, func(controls *iSystemMediaTransportControls) uintptr {
		return controls.VTable().SetIsEnabled
	}, value)
}

func (v *systemMediaTransportControls) SetIsPlayEnabled(value bool) error {
	return v.setBoolProperty(smtcISystemMediaTransportControlsGUID, func(controls *iSystemMediaTransportControls) uintptr {
		return controls.VTable().SetIsPlayEnabled
	}, value)
}

func (v *systemMediaTransportControls) SetIsPauseEnabled(value bool) error {
	return v.setBoolProperty(smtcISystemMediaTransportControlsGUID, func(controls *iSystemMediaTransportControls) uintptr {
		return controls.VTable().SetIsPauseEnabled
	}, value)
}

func (v *systemMediaTransportControls) SetIsNextEnabled(value bool) error {
	return v.setBoolProperty(smtcISystemMediaTransportControlsGUID, func(controls *iSystemMediaTransportControls) uintptr {
		return controls.VTable().SetIsNextEnabled
	}, value)
}

func (v *systemMediaTransportControls) SetIsPreviousEnabled(value bool) error {
	return v.setBoolProperty(smtcISystemMediaTransportControlsGUID, func(controls *iSystemMediaTransportControls) uintptr {
		return controls.VTable().SetIsPreviousEnabled
	}, value)
}

func (v *systemMediaTransportControls) SetIsStopEnabled(value bool) error {
	return v.setBoolProperty(smtcISystemMediaTransportControlsGUID, func(controls *iSystemMediaTransportControls) uintptr {
		return controls.VTable().SetIsStopEnabled
	}, value)
}

func (v *systemMediaTransportControls) AddButtonPressed(handler *typedEventHandler) (eventRegistrationToken, error) {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsGUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls)(unsafe.Pointer(itf))
	var token eventRegistrationToken
	hr, _, _ := syscall.SyscallN(
		controls.VTable().AddButtonPressed,
		uintptr(unsafe.Pointer(controls)),
		uintptr(unsafe.Pointer(handler)),
		uintptr(unsafe.Pointer(&token)),
	)
	if hr != 0 {
		return eventRegistrationToken{}, ole.NewError(hr)
	}
	return token, nil
}

func (v *systemMediaTransportControls) RemoveButtonPressed(token eventRegistrationToken) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsGUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(controls.VTable().RemoveButtonPressed, uintptr(unsafe.Pointer(controls)), uintptr(unsafe.Pointer(&token)))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControls) AddPlaybackPositionChangeRequested(handler *typedEventHandler) (eventRegistrationToken, error) {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControls2GUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls2)(unsafe.Pointer(itf))
	var token eventRegistrationToken
	hr, _, _ := syscall.SyscallN(
		controls.VTable().AddPlaybackPositionChangeRequested,
		uintptr(unsafe.Pointer(controls)),
		uintptr(unsafe.Pointer(handler)),
		uintptr(unsafe.Pointer(&token)),
	)
	if hr != 0 {
		return eventRegistrationToken{}, ole.NewError(hr)
	}
	return token, nil
}

func (v *systemMediaTransportControls) RemovePlaybackPositionChangeRequested(token eventRegistrationToken) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControls2GUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls2)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(controls.VTable().RemovePlaybackPositionChangeRequested, uintptr(unsafe.Pointer(controls)), uintptr(unsafe.Pointer(&token)))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControls) UpdateTimelineProperties(properties *systemMediaTransportControlsTimelineProperties) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControls2GUID))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls2)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(controls.VTable().UpdateTimelineProperties, uintptr(unsafe.Pointer(controls)), uintptr(unsafe.Pointer(properties)))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControls) setBoolProperty(guid string, method func(*iSystemMediaTransportControls) uintptr, value bool) error {
	itf := v.MustQueryInterface(ole.NewGUID(guid))
	defer itf.Release()
	controls := (*iSystemMediaTransportControls)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(method(controls), uintptr(unsafe.Pointer(controls)), uintptr(*(*byte)(unsafe.Pointer(&value))))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControlsDisplayUpdater) SetType(value uintptr) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsDisplayUpdaterGUID))
	defer itf.Release()
	updater := (*iSystemMediaTransportControlsDisplayUpdater)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(updater.VTable().SetType, uintptr(unsafe.Pointer(updater)), value)
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControlsDisplayUpdater) GetMusicProperties() (*musicDisplayProperties, error) {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsDisplayUpdaterGUID))
	defer itf.Release()
	updater := (*iSystemMediaTransportControlsDisplayUpdater)(unsafe.Pointer(itf))
	var out *musicDisplayProperties
	hr, _, _ := syscall.SyscallN(updater.VTable().GetMusicProperties, uintptr(unsafe.Pointer(updater)), uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return nil, ole.NewError(hr)
	}
	return out, nil
}

func (v *systemMediaTransportControlsDisplayUpdater) SetThumbnail(value *randomAccessStreamReference) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsDisplayUpdaterGUID))
	defer itf.Release()
	updater := (*iSystemMediaTransportControlsDisplayUpdater)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(updater.VTable().SetThumbnail, uintptr(unsafe.Pointer(updater)), uintptr(unsafe.Pointer(value)))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControlsDisplayUpdater) ClearAll() error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsDisplayUpdaterGUID))
	defer itf.Release()
	updater := (*iSystemMediaTransportControlsDisplayUpdater)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(updater.VTable().ClearAll, uintptr(unsafe.Pointer(updater)))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControlsDisplayUpdater) Update() error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcISystemMediaTransportControlsDisplayUpdaterGUID))
	defer itf.Release()
	updater := (*iSystemMediaTransportControlsDisplayUpdater)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(updater.VTable().Update, uintptr(unsafe.Pointer(updater)))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *musicDisplayProperties) SetTitle(value string) error {
	return v.setStringProperty(smtcIMusicDisplayPropertiesGUID, func(properties *iMusicDisplayProperties) uintptr {
		return properties.VTable().SetTitle
	}, value)
}

func (v *musicDisplayProperties) SetArtist(value string) error {
	return v.setStringProperty(smtcIMusicDisplayPropertiesGUID, func(properties *iMusicDisplayProperties) uintptr {
		return properties.VTable().SetArtist
	}, value)
}

func (v *musicDisplayProperties) SetAlbumArtist(value string) error {
	return v.setStringProperty(smtcIMusicDisplayPropertiesGUID, func(properties *iMusicDisplayProperties) uintptr {
		return properties.VTable().SetAlbumArtist
	}, value)
}

func (v *musicDisplayProperties) SetAlbumTitle(value string) error {
	itf := v.MustQueryInterface(ole.NewGUID(smtcIMusicDisplayProperties2GUID))
	defer itf.Release()
	properties := (*iMusicDisplayProperties2)(unsafe.Pointer(itf))
	valueHString, err := ole.NewHString(value)
	if err != nil {
		return err
	}
	defer func() {
		_ = ole.DeleteHString(valueHString)
	}()
	hr, _, _ := syscall.SyscallN(properties.VTable().SetAlbumTitle, uintptr(unsafe.Pointer(properties)), uintptr(valueHString))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *musicDisplayProperties) setStringProperty(guid string, method func(*iMusicDisplayProperties) uintptr, value string) error {
	itf := v.MustQueryInterface(ole.NewGUID(guid))
	defer itf.Release()
	properties := (*iMusicDisplayProperties)(unsafe.Pointer(itf))
	valueHString, err := ole.NewHString(value)
	if err != nil {
		return err
	}
	defer func() {
		_ = ole.DeleteHString(valueHString)
	}()
	hr, _, _ := syscall.SyscallN(method(properties), uintptr(unsafe.Pointer(properties)), uintptr(valueHString))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func newURI(value string) (*uriRuntimeClass, error) {
	inspectable, err := ole.RoGetActivationFactory("Windows.Foundation.Uri", ole.NewGUID(smtcIUriRuntimeClassFactoryGUID))
	if err != nil {
		return nil, err
	}
	factory := (*iURIRuntimeClassFactory)(unsafe.Pointer(inspectable))
	defer factory.Release()

	valueHString, err := ole.NewHString(value)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = ole.DeleteHString(valueHString)
	}()

	var out *uriRuntimeClass
	hr, _, _ := syscall.SyscallN(factory.VTable().CreateURI, uintptr(unsafe.Pointer(factory)), uintptr(valueHString), uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return nil, ole.NewError(hr)
	}

	return out, nil
}

func newRandomAccessStreamReferenceFromURIString(value string) (*randomAccessStreamReference, error) {
	uri, err := newURI(value)
	if err != nil {
		return nil, err
	}
	defer uri.Release()

	inspectable, err := ole.RoGetActivationFactory("Windows.Storage.Streams.RandomAccessStreamReference", ole.NewGUID(smtcIRandomAccessStreamReferenceStaticsGUID))
	if err != nil {
		return nil, err
	}
	statics := (*iRandomAccessStreamReferenceStatics)(unsafe.Pointer(inspectable))
	defer statics.Release()

	var out *randomAccessStreamReference
	hr, _, _ := syscall.SyscallN(statics.VTable().CreateFromURI, uintptr(unsafe.Pointer(statics)), uintptr(unsafe.Pointer(uri)), uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return nil, ole.NewError(hr)
	}

	return out, nil
}

func newSystemMediaTransportControlsTimelineProperties() (*systemMediaTransportControlsTimelineProperties, error) {
	inspectable, err := ole.RoActivateInstance("Windows.Media.SystemMediaTransportControlsTimelineProperties")
	if err != nil {
		return nil, err
	}
	return (*systemMediaTransportControlsTimelineProperties)(unsafe.Pointer(inspectable)), nil
}

func (v *systemMediaTransportControlsTimelineProperties) SetStartTime(value timeSpan) error {
	return v.setTimeSpanProperty(func(properties *iSystemMediaTransportControlsTimelineProperties) uintptr {
		return properties.VTable().SetStartTime
	}, value)
}

func (v *systemMediaTransportControlsTimelineProperties) SetEndTime(value timeSpan) error {
	return v.setTimeSpanProperty(func(properties *iSystemMediaTransportControlsTimelineProperties) uintptr {
		return properties.VTable().SetEndTime
	}, value)
}

func (v *systemMediaTransportControlsTimelineProperties) SetMinSeekTime(value timeSpan) error {
	return v.setTimeSpanProperty(func(properties *iSystemMediaTransportControlsTimelineProperties) uintptr {
		return properties.VTable().SetMinSeekTime
	}, value)
}

func (v *systemMediaTransportControlsTimelineProperties) SetMaxSeekTime(value timeSpan) error {
	return v.setTimeSpanProperty(func(properties *iSystemMediaTransportControlsTimelineProperties) uintptr {
		return properties.VTable().SetMaxSeekTime
	}, value)
}

func (v *systemMediaTransportControlsTimelineProperties) SetPosition(value timeSpan) error {
	return v.setTimeSpanProperty(func(properties *iSystemMediaTransportControlsTimelineProperties) uintptr {
		return properties.VTable().SetPosition
	}, value)
}

func (v *systemMediaTransportControlsTimelineProperties) setTimeSpanProperty(method func(*iSystemMediaTransportControlsTimelineProperties) uintptr, value timeSpan) error {
	itf := v.MustQueryInterface(ole.NewGUID("5125316a-c3a2-475b-8507-93534dc88f15"))
	defer itf.Release()
	properties := (*iSystemMediaTransportControlsTimelineProperties)(unsafe.Pointer(itf))
	hr, _, _ := syscall.SyscallN(method(properties), uintptr(unsafe.Pointer(properties)), timeSpanSyscallArg(value))
	if hr != 0 {
		return ole.NewError(hr)
	}
	return nil
}

func (v *systemMediaTransportControlsButtonPressedEventArgs) GetButton() (uintptr, error) {
	itf := v.MustQueryInterface(ole.NewGUID(smtcIButtonPressedEventArgsGUID))
	defer itf.Release()
	args := (*iSystemMediaTransportControlsButtonPressedEventArgs)(unsafe.Pointer(itf))
	var out int32
	hr, _, _ := syscall.SyscallN(args.VTable().GetButton, uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return smtcButtonPlay, ole.NewError(hr)
	}
	return uintptr(out), nil
}

func (v *playbackPositionChangeRequestedEventArgs) GetRequestedPlaybackPosition() (timeSpan, error) {
	itf := v.MustQueryInterface(ole.NewGUID(smtcIPlaybackPositionChangeRequestedEventArgsGUID))
	defer itf.Release()
	args := (*iPlaybackPositionChangeRequestedEventArgs)(unsafe.Pointer(itf))
	var out timeSpan
	hr, _, _ := syscall.SyscallN(args.VTable().GetRequestedPlaybackPosition, uintptr(unsafe.Pointer(args)), uintptr(unsafe.Pointer(&out)))
	if hr != 0 {
		return timeSpan{}, ole.NewError(hr)
	}
	return out, nil
}
