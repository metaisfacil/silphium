package main

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestAppRuntimeHelpers(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	originalRuntimeWindowHide := runtimeWindowHide
	emittedEventName := ""
	windowHidden := false
	runtimeEventsEmit = func(_ context.Context, eventName string, _ ...interface{}) {
		emittedEventName = eventName
	}
	runtimeWindowHide = func(_ context.Context) {
		windowHidden = true
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
		runtimeWindowHide = originalRuntimeWindowHide
	})

	app := &App{}
	app.ctx = context.Background()
	app.logRescanEvent("hello %s", "world")
	if emittedEventName != libraryRescanLogEvent {
		t.Fatalf("logRescanEvent() emitted %q, want %q", emittedEventName, libraryRescanLogEvent)
	}

	backend := app.audioBackend()
	if backend == nil || app.audioBackend() != backend {
		t.Fatal("audioBackend() should lazily allocate and reuse the backend")
	}

	originalVersion := AppVersion
	AppVersion = "1.2.3"
	t.Cleanup(func() {
		AppVersion = originalVersion
	})
	if got := app.GetAppVersion(); got != "1.2.3" {
		t.Fatalf("GetAppVersion() = %q, want %q", got, "1.2.3")
	}

	app.quitRequested.Store(true)
	if app.beforeClose(context.Background()) {
		t.Fatal("beforeClose(quit requested) = true, want false")
	}
	app.quitRequested.Store(false)
	app.settingsLoaded = true
	app.settings.MinimizeToTrayOnClose = false
	if app.beforeClose(context.Background()) {
		t.Fatal("beforeClose(minimize disabled) = true, want false")
	}
	app.settings.MinimizeToTrayOnClose = true
	if runtime.GOOS == "windows" {
		if !app.beforeClose(context.Background()) {
			t.Fatal("beforeClose(minimize enabled) = false, want true")
		}
		if !windowHidden {
			t.Fatal("beforeClose(minimize enabled) should hide the window")
		}
	} else {
		if app.beforeClose(context.Background()) {
			t.Fatal("beforeClose(minimize enabled) = true, want false on non-Windows platforms")
		}
		if windowHidden {
			t.Fatal("beforeClose(minimize enabled) should not hide the window on non-Windows platforms")
		}
	}

	app.LogFrontendMessage("hello from frontend")
}

func TestFormatFrontendLogLine(t *testing.T) {
	now := time.Date(2026, time.April, 16, 18, 56, 29, 944_000_000, time.UTC)

	t.Run("adds backend timestamp for plain frontend messages", func(t *testing.T) {
		got := formatFrontendLogLine("hello from frontend", now)
		wantPattern := `^\[2026-04-16 18:56:29\.944\] \[FRONTEND\] hello from frontend$`
		if !regexp.MustCompile(wantPattern).MatchString(got) {
			t.Fatalf("formatFrontendLogLine() = %q, want pattern %q", got, wantPattern)
		}
	})

	t.Run("reuses existing timestamped frontend messages without duplication", func(t *testing.T) {
		got := formatFrontendLogLine("[2026-04-16 18:56:29.944] [PERF] slow bridge", now)
		want := "[2026-04-16 18:56:29.944] [FRONTEND] [PERF] slow bridge"
		if got != want {
			t.Fatalf("formatFrontendLogLine(timestamped) = %q, want %q", got, want)
		}
	})

	t.Run("does not duplicate frontend prefix when already present", func(t *testing.T) {
		got := formatFrontendLogLine("[2026-04-16 18:56:29.944] [FRONTEND] existing", now)
		want := "[2026-04-16 18:56:29.944] [FRONTEND] existing"
		if got != want {
			t.Fatalf("formatFrontendLogLine(existing prefix) = %q, want %q", got, want)
		}
	})
}

func TestBridgeTraceFinishUsesBackendElapsedLabel(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	var emittedLogLine string
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != libraryRescanLogEvent || len(optionalData) == 0 {
			return
		}
		if message, ok := optionalData[0].(string); ok {
			emittedLogLine = message
		}
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	app := &App{}
	app.ctx = context.Background()

	trace := app.beginBridgeTrace("transport", "AudioPlay", "")
	trace.finish("loaded=true", nil)

	wantPattern := `\[BRIDGE\] BE #1 transport AudioPlay END loaded=true backendElapsed=\d+\.\d{2}ms$`
	if !regexp.MustCompile(wantPattern).MatchString(emittedLogLine) {
		t.Fatalf("bridge trace finish log = %q, want pattern %q", emittedLogLine, wantPattern)
	}

	legacyPattern := `\[BRIDGE\] BE #1 transport AudioPlay END loaded=true elapsed=`
	if regexp.MustCompile(legacyPattern).MatchString(emittedLogLine) {
		t.Fatalf("bridge trace finish log = %q, unexpectedly matched legacy pattern %q", emittedLogLine, legacyPattern)
	}
}

func TestReserveBridgeTraceRequestIDCorrelatesBridgeLogs(t *testing.T) {
	originalRuntimeEventsEmit := runtimeEventsEmit
	emittedLogLines := make([]string, 0, 2)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != libraryRescanLogEvent || len(optionalData) == 0 {
			return
		}
		message, ok := optionalData[0].(string)
		if !ok {
			return
		}
		emittedLogLines = append(emittedLogLines, message)
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	app := &App{}
	app.ctx = context.Background()

	requestID := app.ReserveBridgeTraceRequestID("transport", "AudioPlay")
	if requestID == 0 {
		t.Fatal("ReserveBridgeTraceRequestID() = 0, want non-zero request id")
	}

	trace := app.beginBridgeTrace("transport", "AudioPlay", "")
	trace.finish("loaded=true", nil)

	if len(emittedLogLines) != 2 {
		t.Fatalf("emitted bridge logs = %d, want 2", len(emittedLogLines))
	}

	requestToken := "requestId=" + strconv.FormatUint(requestID, 10)
	if !strings.Contains(emittedLogLines[0], requestToken) {
		t.Fatalf("bridge trace start log = %q, want %q", emittedLogLines[0], requestToken)
	}
	if !strings.Contains(emittedLogLines[1], requestToken) {
		t.Fatalf("bridge trace end log = %q, want %q", emittedLogLines[1], requestToken)
	}
	if !strings.Contains(emittedLogLines[1], "backendElapsed=") {
		t.Fatalf("bridge trace end log = %q, want backendElapsed label", emittedLogLines[1])
	}
}

func TestAppStartupAndShutdown(t *testing.T) {
	app := NewApp()
	fakeSMTC := &fakeSystemMediaTransportControlsManager{}
	app.systemMediaTransportControlsState().manager = fakeSMTC
	app.settingsPath = filepath.Join(t.TempDir(), appSettingsFileName)
	app.startup(context.Background())
	if app.ctx == nil {
		t.Fatal("startup() should capture the app context")
	}
	if config := app.GetInternalCoverArtConfig(); config.BaseURL == "" || config.Token == "" {
		t.Fatalf("GetInternalCoverArtConfig() after startup = %#v, want non-empty loopback config", config)
	}
	if !app.settingsLoaded {
		t.Fatal("startup() should mark settings as loaded")
	}
	if app.musicBrainzTagWorkerState().wakeCh == nil {
		t.Fatal("startup() should initialize the MusicBrainz background worker")
	}
	if generation := app.musicBrainzTagWorkerState().generation.Load(); generation != 0 {
		t.Fatalf("startup() musicbrainz worker generation = %d, want 0 before the first library/index notification", generation)
	}
	if runtime.GOOS == "windows" && app.mediaKeyWatcherState().stopCh == nil {
		t.Fatal("startup() should initialize the media key watcher on Windows")
	}
	if fakeSMTC.startCalls != 1 {
		t.Fatalf("startup() SMTC start calls = %d, want %d", fakeSMTC.startCalls, 1)
	}
	if fakeSMTC.syncCalls == 0 {
		t.Fatal("startup() should sync system media transport controls state")
	}

	app.shutdown(context.Background())
	if !app.quitRequested.Load() {
		t.Fatal("shutdown() should mark quitRequested")
	}
	if config := app.GetInternalCoverArtConfig(); config != (InternalCoverArtConfig{}) {
		t.Fatalf("GetInternalCoverArtConfig() after shutdown = %#v, want empty config", config)
	}
	if app.mediaKeyWatcherState().stopCh != nil || app.musicBrainzTagWorkerState().wakeCh != nil {
		t.Fatal("shutdown() should stop background workers")
	}
	if fakeSMTC.stopCalls != 1 {
		t.Fatalf("shutdown() SMTC stop calls = %d, want %d", fakeSMTC.stopCalls, 1)
	}

	closeErrorApp := &App{}
	closeErrorApp.audio = NewAudioBackend()
	closeErrorApp.audio.context = &fakeAudioContext{closeErr: errors.New("close failed")}
	closeErrorApp.shutdown(context.Background())
	if !closeErrorApp.quitRequested.Load() {
		t.Fatal("shutdown(close error) should still mark quitRequested")
	}
	if closeErrorApp.audio.context != nil {
		t.Fatal("shutdown(close error) should clear the audio context")
	}
}

func TestSystemMediaTransportControlsSnapshotForStateUsesIndexedMetadata(t *testing.T) {
	app := NewApp()
	fixture := createLibraryTestFixture(t)
	app.trackByPath = map[string]LibraryIndexedFile{
		normalizePath(fixture.trackOne): {
			Path:             normalizePath(fixture.trackOne),
			RelativePath:     "Library/Artist One/Album One/01 Intro.flac",
			FolderPath:       "Library/Artist One/Album One",
			CachedTrackTitle: "Intro",
			CachedArtistName: "Artist One",
			CachedAlbumTitle: "Album One",
		},
	}
	app.internalCoverArtState().baseURL = "http://127.0.0.1:9876"
	app.internalCoverArtState().token = "secret-token"
	app.libraryScan.CoverPathByFolder = map[string]string{
		strings.ToLower("Library/Artist One/Album One"): fixture.coverOne,
	}

	snapshot := app.systemMediaTransportControlsSnapshotForState(AudioPlaybackState{
		Loaded:      true,
		Playing:     true,
		CurrentTime: 12.5,
		Duration:    180,
		SourcePath:  fixture.trackOne,
	})

	if snapshot.Title != "Intro" {
		t.Fatalf("snapshot.Title = %q, want %q", snapshot.Title, "Intro")
	}
	if snapshot.Artist != "Artist One" {
		t.Fatalf("snapshot.Artist = %q, want %q", snapshot.Artist, "Artist One")
	}
	if snapshot.AlbumTitle != "Album One" {
		t.Fatalf("snapshot.AlbumTitle = %q, want %q", snapshot.AlbumTitle, "Album One")
	}
	if snapshot.AlbumArtist != "Artist One" {
		t.Fatalf("snapshot.AlbumArtist = %q, want %q", snapshot.AlbumArtist, "Artist One")
	}
	if snapshot.SourcePath != normalizePath(fixture.trackOne) {
		t.Fatalf("snapshot.SourcePath = %q, want %q", snapshot.SourcePath, normalizePath(fixture.trackOne))
	}
	if !snapshot.Playing || !snapshot.Loaded {
		t.Fatalf("snapshot = %#v, want loaded playing state preserved", snapshot)
	}
	if snapshot.CoverArtURL == "" {
		t.Fatal("snapshot.CoverArtURL = empty, want loopback cover art URL")
	}
}

func TestSystemMediaTransportControlsSnapshotFallsBackToFilename(t *testing.T) {
	app := NewApp()
	snapshot := app.systemMediaTransportControlsSnapshotForState(AudioPlaybackState{
		Loaded:     true,
		SourcePath: `C:\Music\Artist\01 Sample Track.flac`,
	})

	if snapshot.Title != "01 Sample Track" {
		t.Fatalf("snapshot.Title = %q, want %q", snapshot.Title, "01 Sample Track")
	}
	if snapshot.Artist != "" || snapshot.AlbumTitle != "" || snapshot.AlbumArtist != "" {
		t.Fatalf("snapshot = %#v, want only filename fallback metadata", snapshot)
	}
}

func TestSystemMediaTransportControlsSnapshotUsesTrackTagsCacheFallback(t *testing.T) {
	app := NewApp()
	fixture := createLibraryTestFixture(t)
	trackPath := normalizePath(fixture.trackOne)
	signature, ok := trackTagsFileSignatureForPath(trackPath)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", trackPath)
	}
	app.putTrackTagsCache(trackPath, signature, TrackTags{
		Title:       "Cached Title",
		Artist:      "Cached Artist",
		Album:       "Cached Album",
		AlbumArtist: "Cached Album Artist",
	}, true)

	snapshot := app.systemMediaTransportControlsSnapshotForState(AudioPlaybackState{
		Loaded:     true,
		SourcePath: trackPath,
	})

	if snapshot.Title != "Cached Title" {
		t.Fatalf("snapshot.Title = %q, want %q", snapshot.Title, "Cached Title")
	}
	if snapshot.Artist != "Cached Artist" {
		t.Fatalf("snapshot.Artist = %q, want %q", snapshot.Artist, "Cached Artist")
	}
	if snapshot.AlbumTitle != "Cached Album" {
		t.Fatalf("snapshot.AlbumTitle = %q, want %q", snapshot.AlbumTitle, "Cached Album")
	}
	if snapshot.AlbumArtist != "Cached Album Artist" {
		t.Fatalf("snapshot.AlbumArtist = %q, want %q", snapshot.AlbumArtist, "Cached Album Artist")
	}
}

func TestSystemMediaTransportControlsSnapshotDoesNotReadTrackTagsOnCacheMiss(t *testing.T) {
	app := NewApp()
	fixture := createLibraryTestFixture(t)
	trackPath := normalizePath(fixture.trackOne)
	originalReadTaglibTags := readTaglibTags
	readCalls := 0
	readTaglibTags = func(string) (map[string][]string, error) {
		readCalls++
		return map[string][]string{"TITLE": {"Should Not Be Read"}}, nil
	}
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	snapshot := app.systemMediaTransportControlsSnapshotForState(AudioPlaybackState{
		Loaded:     true,
		SourcePath: trackPath,
	})

	if readCalls != 0 {
		t.Fatalf("systemMediaTransportControlsSnapshotForState() read tag calls = %d, want 0", readCalls)
	}
	if snapshot.Title != "01 Intro" {
		t.Fatalf("snapshot.Title = %q, want %q", snapshot.Title, "01 Intro")
	}
}

func TestAudioGetStateSyncsSystemMediaTransportControls(t *testing.T) {
	app := NewApp()
	fakeSMTC := &fakeSystemMediaTransportControlsManager{}
	app.systemMediaTransportControlsState().manager = fakeSMTC
	state := app.AudioGetState()

	if fakeSMTC.syncCalls != 1 {
		t.Fatalf("AudioGetState() sync calls = %d, want %d", fakeSMTC.syncCalls, 1)
	}
	if fakeSMTC.lastSnapshot.Loaded != state.Loaded || fakeSMTC.lastSnapshot.Playing != state.Playing {
		t.Fatalf("AudioGetState() synced snapshot = %#v, want playback state %#v", fakeSMTC.lastSnapshot, state)
	}
}

func TestReadTrackTagsSyncsSystemMediaTransportControlsCurrentTrack(t *testing.T) {
	app := NewApp()
	fakeSMTC := &fakeSystemMediaTransportControlsManager{}
	app.systemMediaTransportControlsState().manager = fakeSMTC
	fixture := createLibraryTestFixture(t)
	trackPath := normalizePath(fixture.trackOne)
	app.activeLibraryRoots = []libraryRootConfig{{Path: normalizePath(fixture.rootOne), Name: "Library"}}
	app.audioBackend().streamSegments = []audioTrackSegment{{SourcePath: trackPath, PCMData: make([]byte, audioBytesPerFrame*8)}}

	originalReadTaglibTags := readTaglibTags
	readTaglibTags = func(string) (map[string][]string, error) {
		return map[string][]string{
			"TITLE":       {"Hydrated Title"},
			"ARTIST":      {"Hydrated Artist"},
			"ALBUM":       {"Hydrated Album"},
			"ALBUMARTIST": {"Hydrated Album Artist"},
		}, nil
	}
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	tags := app.ReadTrackTags([]string{trackPath})
	if got := tags[trackPath].Title; got != "Hydrated Title" {
		t.Fatalf("ReadTrackTags()[track].Title = %q, want %q", got, "Hydrated Title")
	}
	if fakeSMTC.syncCalls != 1 {
		t.Fatalf("ReadTrackTags() sync calls = %d, want %d", fakeSMTC.syncCalls, 1)
	}
	if fakeSMTC.lastSnapshot.Title != "Hydrated Title" || fakeSMTC.lastSnapshot.Artist != "Hydrated Artist" || fakeSMTC.lastSnapshot.AlbumTitle != "Hydrated Album" {
		t.Fatalf("ReadTrackTags() snapshot = %#v, want hydrated metadata", fakeSMTC.lastSnapshot)
	}
	if fakeSMTC.lastSnapshot.AlbumArtist != "Hydrated Album Artist" {
		t.Fatalf("ReadTrackTags() album artist = %q, want %q", fakeSMTC.lastSnapshot.AlbumArtist, "Hydrated Album Artist")
	}
}

func TestSetLibraryIndexFromScanSyncsSystemMediaTransportControlsCurrentTrackMetadata(t *testing.T) {
	app := NewApp()
	fakeSMTC := &fakeSystemMediaTransportControlsManager{}
	app.systemMediaTransportControlsState().manager = fakeSMTC
	fixture := createLibraryTestFixture(t)
	rootPath := normalizePath(fixture.rootOne)
	trackPath := normalizePath(fixture.trackOne)
	app.activeLibraryRoots = []libraryRootConfig{{Path: rootPath, Name: "Library"}}
	app.internalCoverArtState().baseURL = "http://127.0.0.1:9876"
	app.internalCoverArtState().token = "secret-token"
	app.audioBackend().streamSegments = []audioTrackSegment{{SourcePath: trackPath, PCMData: make([]byte, audioBytesPerFrame*8)}}

	updated := app.setLibraryIndexFromScan(LibraryScanResult{
		TrackFiles: []LibraryIndexedFile{{
			Name:             filepath.Base(trackPath),
			Path:             trackPath,
			RelativePath:     "Library/Artist One/Album One/01 Intro.flac",
			FolderPath:       "Library/Artist One/Album One",
			RootPath:         rootPath,
			RootName:         "Library",
			CachedTrackTitle: "Track Title",
			CachedArtistName: "Track Artist",
			CachedAlbumTitle: "Track Album",
		}},
		CoverPathByFolder: map[string]string{
			strings.ToLower("Library/Artist One/Album One"): fixture.coverOne,
		},
	}, 0)
	if !updated {
		t.Fatal("setLibraryIndexFromScan() = false, want true")
	}
	if fakeSMTC.syncCalls != 1 {
		t.Fatalf("setLibraryIndexFromScan() sync calls = %d, want %d", fakeSMTC.syncCalls, 1)
	}
	if fakeSMTC.lastSnapshot.Title != "Track Title" || fakeSMTC.lastSnapshot.Artist != "Track Artist" || fakeSMTC.lastSnapshot.AlbumTitle != "Track Album" {
		t.Fatalf("setLibraryIndexFromScan() snapshot = %#v, want indexed track metadata", fakeSMTC.lastSnapshot)
	}
	if fakeSMTC.lastSnapshot.CoverArtURL == "" {
		t.Fatal("setLibraryIndexFromScan() cover art URL = empty, want loopback cover art")
	}
	parsedURL, err := url.Parse(fakeSMTC.lastSnapshot.CoverArtURL)
	if err != nil {
		t.Fatalf("url.Parse(cover art URL) error = %v", err)
	}
	if parsedURL.Path != internalCoverArtPath {
		t.Fatalf("cover art URL path = %q, want %q", parsedURL.Path, internalCoverArtPath)
	}
	if got := parsedURL.Query().Get("id"); got != openSubsonicFolderCoverID("Library/Artist One/Album One") {
		t.Fatalf("cover art id = %q, want folder cover id", got)
	}
	if got := parsedURL.Query().Get("token"); got != "secret-token" {
		t.Fatalf("cover art token = %q, want %q", got, "secret-token")
	}
	if got := parsedURL.Query().Get("size"); got != "256" {
		t.Fatalf("cover art size = %q, want %q", got, "256")
	}
}

func TestShutdownDoesNotBlockOnMusicBrainzWorkerStop(t *testing.T) {
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	app := &App{}
	app.audio = NewAudioBackend()
	workerState := app.musicBrainzTagWorkerState()
	workerState.stopCh = stopCh
	workerState.doneCh = doneCh
	app.audio.context = &fakeAudioContext{}

	originalTimeout := musicBrainzTagWorkerStopTimeout
	musicBrainzTagWorkerStopTimeout = 10 * time.Millisecond
	t.Cleanup(func() {
		musicBrainzTagWorkerStopTimeout = originalTimeout
	})

	shutdownDone := make(chan struct{})
	go func() {
		app.shutdown(context.Background())
		close(shutdownDone)
	}()

	select {
	case <-shutdownDone:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("shutdown() timed out waiting for MusicBrainz worker stop")
	}

	if !app.quitRequested.Load() {
		t.Fatal("shutdown() should mark quitRequested")
	}
	if app.audio.context != nil {
		t.Fatal("shutdown() should close and clear the audio context")
	}
	if workerState.stopCh != nil || workerState.doneCh != nil || workerState.wakeCh != nil {
		t.Fatal("shutdown() should clear MusicBrainz worker channels")
	}

	select {
	case <-stopCh:
	default:
		t.Fatal("shutdown() should close the MusicBrainz worker stop channel")
	}
}

func TestDisposeFrontendSessionState(t *testing.T) {
	watchStop := make(chan struct{})
	fakeContext := &fakeAudioContext{player: &fakeAudioPlayer{}}
	backend := NewAudioBackend()
	backend.context = fakeContext
	backend.player = fakeContext.player
	backend.streamSegments = []audioTrackSegment{{SourcePath: "track.flac", PCMData: make([]byte, audioBytesPerFrame*8)}}
	backend.playing = true
	app := &App{
		watchers: appWatcherState{library: appLibraryWatcherState{stopCh: watchStop}},
	}
	app.audio = backend
	app.searchGeneration.Store(7)
	app.libraryScanGeneration.Store(3)

	app.DisposeFrontendSessionState()

	if got := app.searchGeneration.Load(); got != 8 {
		t.Fatalf("DisposeFrontendSessionState() searchGeneration = %d, want 8", got)
	}
	if got := app.libraryScanGeneration.Load(); got != 4 {
		t.Fatalf("DisposeFrontendSessionState() libraryScanGeneration = %d, want 4", got)
	}
	if app.libraryWatcherState().stopCh != nil {
		t.Fatal("DisposeFrontendSessionState() should clear watchStop")
	}
	state := app.audioBackend().State()
	if state.Loaded || state.Playing {
		t.Fatalf("DisposeFrontendSessionState() audio state = %#v, want unloaded stopped playback", state)
	}
	if fakeContext.player.pauseCalls == 0 {
		t.Fatal("DisposeFrontendSessionState() should pause the player while stopping playback")
	}

	select {
	case <-watchStop:
	default:
		t.Fatal("DisposeFrontendSessionState() should close the library watcher stop channel")
	}
}

type fakeSystemMediaTransportControlsManager struct {
	startCalls   int
	stopCalls    int
	syncCalls    int
	lastSnapshot systemMediaTransportControlsSnapshot
}

func (f *fakeSystemMediaTransportControlsManager) Start(*App) {
	f.startCalls++
}

func (f *fakeSystemMediaTransportControlsManager) Stop() {
	f.stopCalls++
}

func (f *fakeSystemMediaTransportControlsManager) Sync(snapshot systemMediaTransportControlsSnapshot) {
	f.syncCalls++
	f.lastSnapshot = snapshot
}
