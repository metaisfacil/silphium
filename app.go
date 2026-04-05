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
const mediaKeyEvent = "silphium:media:key"

// AppVersion is set at build time via -ldflags "-X main.AppVersion=...".
var AppVersion = "dev"

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
	indexMu                                sync.Mutex
	trackByPath                            map[string]LibraryIndexedFile
	textByPath                             map[string]LibraryIndexedFile
	imageByPath                            map[string]LibraryIndexedFile
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
	trackTagsCacheMu                       sync.Mutex
	trackTagsCacheByPath                   map[string]trackTagsCacheEntry
	trackTagsCacheOrder                    []string
	mediaKeyWatcherStop                    chan struct{}
	mediaKeyWatcherDone                    chan struct{}
	libraryScan                            LibraryScanResult
	scanInProgress                         bool
	scanRemainingImmediateChildrenByFolder map[string]int
	scanLastTotalEntries                   int
	scanPreCountMs                         float64
	scanEntryMs                            float64
	scanFinalizeMs                         float64
	scanWatcherMs                          float64
	searchGeneration                       atomic.Uint64
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
		runtime.EventsEmit(a.ctx, libraryRescanLogEvent, logLine)
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadStoredSettings()
	a.audioBackend().ApplyAudioSettings(a.settings.Audio)
	a.startMediaKeyWatcher()
}

func (a *App) shutdown(context.Context) {
	a.stopMediaKeyWatcher()
	a.stopLibraryWatcher()
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

// LogFrontendMessage logs a message from the frontend to the backend console
func (a *App) LogFrontendMessage(message string) {
	log.Println("[FRONTEND] " + message)
}
