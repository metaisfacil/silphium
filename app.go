package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"Silphium/internal/profiling"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func init() {
	// Configure logger to only output the message without timestamp (we add our own)
	log.SetFlags(0)
}

const libraryScanUpdatedEvent = "silphium:library:scan-updated"
const libraryScanProgressEvent = "silphium:library:scan-progress"
const libraryRescanLogEvent = "silphium:library:rescan-log"
const musicBrainzTagWorkerProgressEvent = "silphium:musicbrainz:tag-worker-progress"
const mediaKeyEvent = "silphium:media:key"

// AppVersion is set at build time via -ldflags "-X main.AppVersion=...".
var AppVersion = "dev"
var runtimeEventsEmit = runtime.EventsEmit
var runtimeEventsOn = runtime.EventsOn
var runtimeWindowHide = runtime.WindowHide

// App contains runtime state and service dependencies for the Wails backend.
type App struct {
	appAudioState
	appRuntimeState
	appSettingsState
	watchers appWatcherState
	appProfilerState
	appLibraryState
	appMusicBrainzTagState
	scrobble appScrobbleState

	openSubsonicMu          sync.Mutex
	openSubsonicServer      *http.Server
	openSubsonicAlbumListMu sync.Mutex
	openSubsonicAlbumList   *openSubsonicAlbumListIndex
	openSubsonicAlbumListCh chan struct{}
	openSubsonicBrowseMu    sync.Mutex
	openSubsonicBrowse      *openSubsonicBrowseIndex
}

type appAudioState struct {
	audio *AudioBackend
}

type appSettingsState struct {
	appSettingsStorageState
	settings       AppSettings
	settingsLoaded bool
}

type appProfilerState struct {
	mu                sync.Mutex
	service           *profiling.Service
	server            *http.Server
	httpAddr          string
	frontendEventsOff func()
}

type appSettingsStorageState struct {
	settingsPath string
}

type appRuntimeState struct {
	ctx           context.Context
	quitRequested atomic.Bool
}

type appWatcherState struct {
	library   appLibraryWatcherState
	mediaKeys appMediaKeyWatcherState
}

type libraryEventWatcher interface {
	Close() error
	Events() <-chan fsnotify.Event
	Errors() <-chan error
	HandleCreatePath(path string)
	DebounceDuration() time.Duration
	IsClosed() bool
}

type appLibraryState struct {
	appLibraryContentState
	appTrackTagsCacheState
	appLibraryScanState
	appLibraryGenerationState
	appLibraryIndexState
	appLibraryDatabaseState
}

type appLibraryContentState struct {
	activeLibraryRoots []libraryRootConfig
	indexMu            sync.RWMutex
	trackByPath        map[string]LibraryIndexedFile
	textByPath         map[string]LibraryIndexedFile
	imageByPath        map[string]LibraryIndexedFile
	libraryScan        LibraryScanResult
}

type appTrackTagsCacheState struct {
	mu     sync.Mutex
	byPath map[string]trackTagsCacheEntry
	order  []string
}

type appLibraryScanState struct {
	scanInProgress                         bool
	scanRemainingImmediateChildrenByFolder map[string]int
	scanDiscoveredChildFoldersByParent     map[string]map[string]struct{}
	scanLastTotalEntries                   int
	scanPreCountMs                         float64
	scanEntryMs                            float64
	scanFinalizeMs                         float64
	scanWatcherMs                          float64
}

type appLibraryGenerationState struct {
	libraryScanGeneration atomic.Uint64
	searchGeneration      atomic.Uint64
}

type appLibraryIndexState struct {
	libraryFolderEntriesCache     map[string][]LibraryBrowserEntry
	libraryWatchDirectoryPaths    []string
	folderEntriesByFolder         map[string][]LibraryBrowserEntry
	folderChildPathsByFolder      map[string][]string
	trackFilesByFolder            map[string][]LibraryIndexedFile
	directTextEntriesByFolder     map[string][]LibraryBrowserEntry
	directImageEntriesByFolder    map[string][]LibraryBrowserEntry
	folderModifiedAtByPath        map[string]int64
	searchFolderEntries           []LibraryBrowserEntry
	searchTrackEntries            []LibraryBrowserEntry
	searchTextEntries             []LibraryBrowserEntry
	searchImageEntries            []LibraryBrowserEntry
	searchResultsByQuery          map[string][]LibraryBrowserEntry
	searchCacheOrder              []string
	searchLastQuery               string
	searchLastResults             []LibraryBrowserEntry
	libraryDerivedIndexDirty      bool
	libraryDerivedIndexBuilding   bool
	libraryDerivedIndexGeneration uint64
	libraryFileHydrationPending   bool
}

type appLibraryDatabaseState struct {
	mu                             sync.Mutex
	wakeCh                         chan struct{}
	stopCh                         chan struct{}
	doneCh                         chan struct{}
	pendingFullSnapshot            bool
	pendingIncrementalTotalEntries int
	pendingIncrementalChanges      []preparedIncrementalLibraryChange
}

type appLibraryWatcherState struct {
	mu         sync.Mutex
	watcher    libraryEventWatcher
	stopCh     chan struct{}
	generation atomic.Uint64
}

type appMediaKeyWatcherState struct {
	stopCh chan struct{}
	doneCh chan struct{}
}

type appScrobbleState struct {
	listenBrainzScrobbleMu      sync.Mutex
	listenBrainzRecentScrobbles map[string]listenBrainzScrobbleDedupEntry
	lastFmScrobbleMu            sync.Mutex
	lastFmRecentScrobbles       map[string]lastFmScrobbleDedupEntry
}

type appMusicBrainzTagState struct {
	appMusicBrainzTagDatabaseState
	worker appMusicBrainzTagWorkerRuntimeState
}

type appMusicBrainzTagDatabaseState struct {
	musicBrainzTagMu                       sync.Mutex
	musicBrainzTagStore                    musicBrainzTagDatabaseStore
	musicBrainzTagStoreLoaded              bool
	musicBrainzTagStoreDirty               bool
	musicBrainzTagVersion                  atomic.Uint64
	musicBrainzTagLastPersistAt            time.Time
	musicBrainzTagEntityKeysByTag          map[string]map[string]struct{}
	musicBrainzTagReleaseFoldersByID       map[string]map[string]struct{}
	musicBrainzTagReleaseFoldersByArtistID map[string]map[string]struct{}
	musicBrainzTagArtistFoldersByID        map[string]map[string]struct{}
}

type appMusicBrainzTagWorkerRuntimeState struct {
	wakeCh     chan struct{}
	stopCh     chan struct{}
	doneCh     chan struct{}
	generation atomic.Uint64
	progressMu sync.Mutex
	progress   MusicBrainzTagWorkerProgress
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		appAudioState:    appAudioState{audio: NewAudioBackend()},
		appProfilerState: appProfilerState{service: profiling.NewService(profiling.LoadConfigFromEnv())},
	}
}

// logRescanEvent logs a rescan-related event with precise timestamp to both console and frontend
func (a *App) logRescanEvent(message string, args ...interface{}) {
	runtimeState := a.runtimeState()
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	formattedMessage := fmt.Sprintf(message, args...)
	logLine := fmt.Sprintf("[%s] %s", timestamp, formattedMessage)
	log.Println(logLine)
	if runtimeState.ctx != nil {
		runtimeEventsEmit(runtimeState.ctx, libraryRescanLogEvent, logLine)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	runtimeState := a.runtimeState()
	settingsState := a.settingsState()
	runtimeState.ctx = ctx
	a.startProfiler()
	a.loadStoredSettings()
	a.audioBackend().SetFFmpegPath(settingsState.settings.FFmpegPath)
	a.audioBackend().ApplyAudioSettings(settingsState.settings.Audio)
	a.syncOpenSubsonicServer()
	a.refreshSystemTrayForSettings()
	a.startMediaKeyWatcher()
	a.startMusicBrainzTagWorker()
	a.notifyMusicBrainzTagWorker()
}

func (a *App) shutdown(context.Context) {
	a.runtimeState().quitRequested.Store(true)
	a.stopProfiler()
	a.stopOpenSubsonicServer()
	a.stopSystemTray()
	a.stopMediaKeyWatcher()
	a.stopLibraryWatcher()
	a.stopLibraryFilesDatabaseWorker()
	if err := a.audioBackend().Close(); err != nil {
		log.Printf("failed to close audio backend: %v", err)
	}
	a.stopMusicBrainzTagWorker()
}

func (a *App) audioBackend() *AudioBackend {
	audioState := a.audioState()
	if audioState.audio == nil {
		audioState.audio = NewAudioBackend()
	}

	return audioState.audio
}

func (a *App) audioState() *appAudioState {
	return &a.appAudioState
}

func (a *App) runtimeState() *appRuntimeState {
	return &a.appRuntimeState
}

func (a *App) settingsState() *appSettingsState {
	return &a.appSettingsState
}

func (a *App) settingsStorageState() *appSettingsStorageState {
	return &a.settingsState().appSettingsStorageState
}

func (a *App) profilerState() *appProfilerState {
	return &a.appProfilerState

}

func (a *App) libraryState() *appLibraryState {
	return &a.appLibraryState
}

func (a *App) libraryContentState() *appLibraryContentState {
	return &a.libraryState().appLibraryContentState
}

func (a *App) libraryScanState() *appLibraryScanState {
	return &a.libraryState().appLibraryScanState
}

func (a *App) libraryGenerationState() *appLibraryGenerationState {
	return &a.libraryState().appLibraryGenerationState
}

func (a *App) libraryIndexState() *appLibraryIndexState {
	return &a.libraryState().appLibraryIndexState
}

func (a *App) libraryDatabaseState() *appLibraryDatabaseState {
	return &a.libraryState().appLibraryDatabaseState
}

func (a *App) libraryWatcherState() *appLibraryWatcherState {
	return &a.watchers.library
}

func (a *App) mediaKeyWatcherState() *appMediaKeyWatcherState {
	return &a.watchers.mediaKeys
}

func (a *App) trackTagsCacheState() *appTrackTagsCacheState {
	return &a.appLibraryState.appTrackTagsCacheState
}

func (a *App) scrobbleState() *appScrobbleState {
	return &a.scrobble
}

func (a *App) musicBrainzTagState() *appMusicBrainzTagState {
	return &a.appMusicBrainzTagState
}

func (a *App) musicBrainzTagWorkerState() *appMusicBrainzTagWorkerRuntimeState {
	return &a.musicBrainzTagState().worker
}

// GetAppVersion returns the backend application version string.
func (a *App) GetAppVersion() string {
	return profiledValue(a, "GetAppVersion", func() string {
		return AppVersion
	})
}

func (a *App) beforeClose(context.Context) bool {
	runtimeState := a.runtimeState()
	if runtimeState.quitRequested.Load() {
		return false
	}

	if !a.shouldMinimizeToTrayOnClose() {
		return false
	}

	runtimeWindowHide(runtimeState.ctx)
	return true
}

// LogFrontendMessage logs a message from the frontend to the backend console
func (a *App) LogFrontendMessage(message string) {
	profiledVoid(a, "LogFrontendMessage", func() {
		log.Println("[FRONTEND] " + message)
	})
}

// DisposeFrontendSessionState clears backend runtime state bound to the current frontend session.
func (a *App) DisposeFrontendSessionState() {
	profiledVoid(a, "DisposeFrontendSessionState", func() {
		libraryGenerationState := a.libraryGenerationState()
		libraryGenerationState.libraryScanGeneration.Add(1)
		libraryGenerationState.searchGeneration.Add(1)
		a.stopLibraryWatcher()

		state := a.audioBackend().State()
		if state.Loaded || state.Playing {
			if _, err := a.audioBackend().Stop(); err != nil {
				log.Printf("failed to stop audio backend while disposing frontend session: %v", err)
				a.audioBackend().stopWithoutInitialize()
			}
		}
	})
}
