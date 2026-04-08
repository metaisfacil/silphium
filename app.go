package main

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

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
var runtimeWindowHide = runtime.WindowHide

// App contains runtime state and service dependencies for the Wails backend.
type App struct {
	ctx                                    context.Context
	activeLibraryRoots                     []libraryRootConfig
	audio                                  *AudioBackend
	settings                               AppSettings
	settingsPath                           string
	settingsLoaded                         bool
	watchMu                                sync.Mutex
	libraryWatcher                         *fsnotify.Watcher
	watchStop                              chan struct{}
	libraryWatcherGeneration               atomic.Uint64
	libraryScanGeneration                  atomic.Uint64
	indexMu                                sync.Mutex
	trackByPath                            map[string]LibraryIndexedFile
	textByPath                             map[string]LibraryIndexedFile
	imageByPath                            map[string]LibraryIndexedFile
	libraryFolderEntriesCache              map[string][]LibraryBrowserEntry
	libraryWatchDirectoryPaths             []string
	folderEntriesByFolder                  map[string][]LibraryBrowserEntry
	folderChildPathsByFolder               map[string][]string
	trackFilesByFolder                     map[string][]LibraryIndexedFile
	searchFolderEntries                    []LibraryBrowserEntry
	searchTrackEntries                     []LibraryBrowserEntry
	searchTextEntries                      []LibraryBrowserEntry
	searchImageEntries                     []LibraryBrowserEntry
	searchResultsByQuery                   map[string][]LibraryBrowserEntry
	searchCacheOrder                       []string
	searchLastQuery                        string
	searchLastResults                      []LibraryBrowserEntry
	libraryDerivedIndexDirty               bool
	libraryDerivedIndexBuilding            bool
	libraryDerivedIndexGeneration          uint64
	libraryFileHydrationPending            bool
	trackTagsCacheMu                       sync.Mutex
	trackTagsCacheByPath                   map[string]trackTagsCacheEntry
	trackTagsCacheOrder                    []string
	musicBrainzTagMu                       sync.Mutex
	musicBrainzTagStore                    musicBrainzTagDatabaseStore
	musicBrainzTagStoreLoaded              bool
	musicBrainzTagStoreDirty               bool
	musicBrainzTagLastPersistAt            time.Time
	musicBrainzTagEntityKeysByTag          map[string]map[string]struct{}
	musicBrainzTagReleaseFoldersByID       map[string]map[string]struct{}
	musicBrainzTagReleaseFoldersByArtistID map[string]map[string]struct{}
	musicBrainzTagArtistFoldersByID        map[string]map[string]struct{}
	musicBrainzTagWorkerWake               chan struct{}
	musicBrainzTagWorkerStop               chan struct{}
	musicBrainzTagWorkerDone               chan struct{}
	musicBrainzTagWorkGeneration           atomic.Uint64
	musicBrainzTagProgressMu               sync.Mutex
	musicBrainzTagProgress                 MusicBrainzTagWorkerProgress
	mediaKeyWatcherStop                    chan struct{}
	mediaKeyWatcherDone                    chan struct{}
	quitRequested                          atomic.Bool
	libraryScan                            LibraryScanResult
	scanInProgress                         bool
	scanRemainingImmediateChildrenByFolder map[string]int
	scanDiscoveredChildFoldersByParent     map[string]map[string]struct{}
	scanLastTotalEntries                   int
	scanPreCountMs                         float64
	scanEntryMs                            float64
	scanFinalizeMs                         float64
	scanWatcherMs                          float64
	searchGeneration                       atomic.Uint64
	listenBrainzScrobbleMu                 sync.Mutex
	listenBrainzRecentScrobbles            map[string]listenBrainzScrobbleDedupEntry
	lastFmScrobbleMu                       sync.Mutex
	lastFmRecentScrobbles                  map[string]lastFmScrobbleDedupEntry
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		audio: NewAudioBackend(),
	}
}

// logRescanEvent logs a rescan-related event with precise timestamp to both console and frontend
func (a *App) logRescanEvent(message string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	formattedMessage := fmt.Sprintf(message, args...)
	logLine := fmt.Sprintf("[%s] %s", timestamp, formattedMessage)
	log.Println(logLine)
	if a.ctx != nil {
		runtimeEventsEmit(a.ctx, libraryRescanLogEvent, logLine)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadStoredSettings()
	a.audioBackend().SetFFmpegPath(a.settings.FFmpegPath)
	a.audioBackend().ApplyAudioSettings(a.settings.Audio)
	a.refreshSystemTrayForSettings()
	a.startMediaKeyWatcher()
	a.startMusicBrainzTagWorker()
	a.notifyMusicBrainzTagWorker()
}

func (a *App) shutdown(context.Context) {
	a.quitRequested.Store(true)
	a.stopSystemTray()
	a.stopMediaKeyWatcher()
	a.stopLibraryWatcher()
	if err := a.audioBackend().Close(); err != nil {
		log.Printf("failed to close audio backend: %v", err)
	}
	a.stopMusicBrainzTagWorker()
}

func (a *App) audioBackend() *AudioBackend {
	if a.audio == nil {
		a.audio = NewAudioBackend()
	}

	return a.audio
}

// GetAppVersion returns the backend application version string.
func (a *App) GetAppVersion() string {
	return AppVersion
}

func (a *App) beforeClose(context.Context) bool {
	if a.quitRequested.Load() {
		return false
	}

	if !a.shouldMinimizeToTrayOnClose() {
		return false
	}

	runtimeWindowHide(a.ctx)
	return true
}

// LogFrontendMessage logs a message from the frontend to the backend console
func (a *App) LogFrontendMessage(message string) {
	log.Println("[FRONTEND] " + message)
}

// DisposeFrontendSessionState clears backend runtime state bound to the current frontend session.
func (a *App) DisposeFrontendSessionState() {
	a.libraryScanGeneration.Add(1)
	a.searchGeneration.Add(1)
	a.stopLibraryWatcher()

	state := a.audioBackend().State()
	if state.Loaded || state.Playing {
		if _, err := a.audioBackend().Stop(); err != nil {
			log.Printf("failed to stop audio backend while disposing frontend session: %v", err)
			a.audioBackend().stopWithoutInitialize()
		}
	}
}
