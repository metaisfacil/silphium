package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/fsnotify/fsnotify"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	taglib "go.senan.xyz/taglib"
)

func init() {
	// Configure logger to only output the message without timestamp (we add our own)
	log.SetFlags(0)
}

const libraryScanUpdatedEvent = "silphium:library:scan-updated"
const libraryScanProgressEvent = "silphium:library:scan-progress"
const libraryRescanLogEvent = "silphium:library:rescan-log"

// AppVersion is set at build time via -ldflags "-X main.AppVersion=...".
var AppVersion = "dev"

// App contains runtime state and service dependencies for the Wails backend.
type App struct {
	ctx            context.Context
	libraryRoot    string
	audio          *AudioBackend
	settings       AppSettings
	settingsPath   string
	settingsLoaded bool
	watchMu        sync.Mutex
	libraryWatcher *fsnotify.Watcher
	watchStop      chan struct{}
	indexMu        sync.Mutex
	trackByPath    map[string]LibraryIndexedFile
	textByPath     map[string]LibraryIndexedFile
	imageByPath    map[string]LibraryIndexedFile
	libraryScan    LibraryScanResult
	scanFinalizeMs float64
}

// LibraryIndexedFile represents a discovered file with normalized library-relative metadata.
type LibraryIndexedFile struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	FolderPath   string `json:"folderPath"`
}

// LibraryScanResult contains indexed library content and scan metadata.
type LibraryScanResult struct {
	RootPath          string               `json:"rootPath"`
	RootName          string               `json:"rootName"`
	TrackFiles        []LibraryIndexedFile `json:"trackFiles"`
	TextFiles         []LibraryIndexedFile `json:"textFiles"`
	ImageFiles        []LibraryIndexedFile `json:"imageFiles"`
	CoverPathByFolder map[string]string    `json:"coverPathByFolder"`
	TotalEntries      int                  `json:"totalEntries"`
	TrackCount        int                  `json:"trackCount"`
	TextFileCount     int                  `json:"textFileCount"`
	ImageFileCount    int                  `json:"imageFileCount"`
	Truncated         bool                 `json:"truncated"`
	EntryLimit        int                  `json:"entryLimit"`
}

// LibraryScanProgress reports scan progress and an ETA for long-running scans.
type LibraryScanProgress struct {
	RootPath       string `json:"rootPath"`
	EntriesScanned int    `json:"entriesScanned"`
	TotalEntries   int    `json:"totalEntries"`
	ElapsedMs      int64  `json:"elapsedMs"`
	EtaSeconds     int    `json:"etaSeconds"`
	Phase          string `json:"phase"`
}

// LibraryBrowserEntry is a single server-side sidebar/search result row.
type LibraryBrowserEntry struct {
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Path         string `json:"path"`
	FolderPath   string `json:"folderPath"`
	RelativePath string `json:"relativePath"`
}

// LibraryFolderPage contains one paginated folder view from the backend.
type LibraryFolderPage struct {
	FolderPath   string                `json:"folderPath"`
	Offset       int                   `json:"offset"`
	Limit        int                   `json:"limit"`
	TotalEntries int                   `json:"totalEntries"`
	Entries      []LibraryBrowserEntry `json:"entries"`
}

// LibrarySearchPage contains one paginated search result page from the backend.
type LibrarySearchPage struct {
	Query        string                `json:"query"`
	Offset       int                   `json:"offset"`
	Limit        int                   `json:"limit"`
	TotalEntries int                   `json:"totalEntries"`
	Entries      []LibraryBrowserEntry `json:"entries"`
}

// LibraryIndexedFilePage contains a paginated slice of indexed library files.
type LibraryIndexedFilePage struct {
	Kind         string               `json:"kind"`
	Offset       int                  `json:"offset"`
	Limit        int                  `json:"limit"`
	TotalEntries int                  `json:"totalEntries"`
	Entries      []LibraryIndexedFile `json:"entries"`
}

// PlaylistLoadResult contains parsed playlist metadata and indexed tracks.
type PlaylistLoadResult struct {
	Name       string               `json:"name"`
	TrackFiles []LibraryIndexedFile `json:"trackFiles"`
}

// TrackTags contains resolved textual, technical, and MusicBrainz metadata for a track.
type TrackTags struct {
	Artist         string              `json:"artist"`
	Album          string              `json:"album"`
	Title          string              `json:"title"`
	AllTags        map[string][]string `json:"allTags,omitempty"`
	Lyrics         string              `json:"lyrics,omitempty"`
	UnsyncedLyrics string              `json:"unsyncedLyrics,omitempty"`
	TrackNumber    string              `json:"trackNumber,omitempty"`
	TrackTotal     string              `json:"trackTotal,omitempty"`
	BitDepth       int                 `json:"bitDepth,omitempty"`
	SampleRate     int                 `json:"sampleRate,omitempty"`
	Codec          string              `json:"codec,omitempty"`
	CodecLong      string              `json:"codecLong,omitempty"`
	CodecProfile   string              `json:"codecProfile,omitempty"`
	SampleFormat   string              `json:"sampleFormat,omitempty"`
	Channels       int                 `json:"channels,omitempty"`
	ChannelLayout  string              `json:"channelLayout,omitempty"`
	BitRate        int                 `json:"bitRate,omitempty"`
	OverallBitRate int                 `json:"overallBitRate,omitempty"`
	DurationSecs   float64             `json:"durationSeconds,omitempty"`
	Container      string              `json:"container,omitempty"`
	FileSizeBytes  int64               `json:"fileSizeBytes,omitempty"`
	RecordingID    string              `json:"recordingId,omitempty"`
	ReleaseID      string              `json:"releaseId,omitempty"`
	ArtistID       string              `json:"artistId,omitempty"`
	ArtistIDs      []string            `json:"artistIds,omitempty"`
}

// TrackBlob carries in-memory file data used for tag extraction without disk references.
type TrackBlob struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Data string `json:"data"`
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
}

func (a *App) shutdown(context.Context) {
	a.stopLibraryWatcher()
}

func (a *App) audioBackend() *AudioBackend {
	if a.audio == nil {
		a.audio = NewAudioBackend()
	}

	return a.audio
}

func (a *App) GetAppVersion() string {
	return AppVersion
}

// LogFrontendMessage logs a message from the frontend to the backend console
func (a *App) LogFrontendMessage(message string) {
	log.Println("[FRONTEND] " + message)
}

var audioExtensions = map[string]struct{}{
	".mp3":  {},
	".m4a":  {},
	".aac":  {},
	".wav":  {},
	".flac": {},
	".ogg":  {},
	".opus": {},
}

var textExtensions = map[string]struct{}{
	".txt": {},
	".log": {},
}

var imageExtensions = map[string]struct{}{
	".jpg":  {},
	".jpeg": {},
	".png":  {},
	".gif":  {},
	".webp": {},
	".bmp":  {},
}

func isAudioPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".m3u8" {
		return false
	}
	_, ok := audioExtensions[ext]
	return ok
}

func isTextPath(path string) bool {
	_, ok := textExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func isImagePath(path string) bool {
	_, ok := imageExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func isJpegPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".jpg" || ext == ".jpeg"
}

func folderAndRelative(rootPath string, fullPath string) (string, string, bool) {
	relativePath, err := filepath.Rel(rootPath, fullPath)
	if err != nil {
		return "", "", false
	}

	relativePath = filepath.ToSlash(relativePath)
	folderPath := filepath.ToSlash(filepath.Dir(relativePath))
	if folderPath == "." {
		folderPath = ""
	}

	return folderPath, relativePath, true
}

func coverPriority(name string) int {
	switch {
	case strings.EqualFold(name, "cover.jpg"):
		return 0
	case strings.EqualFold(name, "folder.jpg"):
		return 1
	case strings.HasPrefix(strings.ToLower(name), "albumart"):
		return 2
	default:
		return 3
	}
}

func normalizePath(path string) string {
	return filepath.Clean(strings.TrimSpace(path))
}

func normalizeLibraryRelativePath(path string) (string, bool) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" || trimmed == "." {
		return "", true
	}

	cleaned := filepath.ToSlash(filepath.Clean(strings.ReplaceAll(trimmed, "/", string(filepath.Separator))))
	if cleaned == "." {
		return "", true
	}

	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false
	}

	return cleaned, true
}

func directChildFolderPath(parentPath string, candidateFolderPath string) (string, bool) {
	normalizedParent := strings.TrimSpace(parentPath)
	normalizedCandidate := strings.TrimSpace(candidateFolderPath)
	if normalizedCandidate == "" {
		return "", false
	}

	if normalizedParent == "" {
		segments := strings.Split(normalizedCandidate, "/")
		if len(segments) == 0 || segments[0] == "" {
			return "", false
		}

		return segments[0], true
	}

	if normalizedCandidate == normalizedParent {
		return "", false
	}

	prefix := normalizedParent + "/"
	if !strings.HasPrefix(normalizedCandidate, prefix) {
		return "", false
	}

	remainder := strings.TrimPrefix(normalizedCandidate, prefix)
	if remainder == "" {
		return "", false
	}

	segments := strings.Split(remainder, "/")
	if len(segments) == 0 || segments[0] == "" {
		return "", false
	}

	return normalizedParent + "/" + segments[0], true
}

func folderBrowserEntry(path string) LibraryBrowserEntry {
	segments := strings.Split(path, "/")
	name := path
	parentPath := ""
	if len(segments) > 0 {
		name = segments[len(segments)-1]
		if len(segments) > 1 {
			parentPath = strings.Join(segments[:len(segments)-1], "/")
		}
	}

	return LibraryBrowserEntry{
		Kind:         "folder",
		Name:         name,
		Path:         path,
		FolderPath:   parentPath,
		RelativePath: path,
	}
}

func browserEntryFromIndexedFile(kind string, indexed LibraryIndexedFile) LibraryBrowserEntry {
	return LibraryBrowserEntry{
		Kind:         kind,
		Name:         indexed.Name,
		Path:         indexed.Path,
		FolderPath:   indexed.FolderPath,
		RelativePath: indexed.RelativePath,
	}
}

func relativePathWithinFolder(folderPath string, relativePath string) string {
	normalizedFolder := strings.TrimSpace(folderPath)
	if normalizedFolder == "" {
		return relativePath
	}

	prefix := normalizedFolder + "/"
	if !strings.HasPrefix(relativePath, prefix) {
		return relativePath
	}

	return strings.TrimPrefix(relativePath, prefix)
}

func pagedLibraryEntries(entries []LibraryBrowserEntry, offset int, limit int) []LibraryBrowserEntry {
	if offset < 0 {
		offset = 0
	}

	if limit <= 0 {
		limit = 100
	}

	if offset >= len(entries) {
		return []LibraryBrowserEntry{}
	}

	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}

	return entries[offset:end]
}

func pagedIndexedFiles(kind string, entries []LibraryIndexedFile, offset int, limit int) LibraryIndexedFilePage {
	if offset < 0 {
		offset = 0
	}

	if limit <= 0 {
		limit = 1000
	}

	if offset >= len(entries) {
		return LibraryIndexedFilePage{
			Kind:         kind,
			Offset:       offset,
			Limit:        limit,
			TotalEntries: len(entries),
			Entries:      []LibraryIndexedFile{},
		}
	}

	end := offset + limit
	if end > len(entries) {
		end = len(entries)
	}

	pageEntries := append([]LibraryIndexedFile(nil), entries[offset:end]...)
	return LibraryIndexedFilePage{
		Kind:         kind,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pageEntries,
	}
}

func (a *App) isAllowedLibraryPath(path string) bool {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return false
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return false
	}

	if strings.TrimSpace(a.libraryRoot) == "" {
		return true
	}

	relativeToRoot, err := filepath.Rel(a.libraryRoot, absolutePath)
	if err != nil {
		return false
	}

	if relativeToRoot == "." {
		return true
	}

	parentPrefix := ".." + string(filepath.Separator)
	return relativeToRoot != ".." && !strings.HasPrefix(relativeToRoot, parentPrefix)
}

// SelectLibraryFolder opens a directory picker and returns the selected library path.
func (a *App) SelectLibraryFolder() string {
	selectedPath, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Music Library Folder",
	})
	if err != nil {
		return ""
	}

	return selectedPath
}

// SelectPlaylistFile opens a file picker and returns a selected M3U/M3U8 playlist path.
func (a *App) SelectPlaylistFile() string {
	selectedPath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Playlist File",
		Filters: []runtime.FileFilter{{
			DisplayName: "Playlists",
			Pattern:     "*.m3u;*.m3u8",
		}},
	})
	if err != nil {
		return ""
	}

	return selectedPath
}

// SelectPlaylistSaveFile opens a save dialog and returns a target M3U/M3U8 path.
func (a *App) SelectPlaylistSaveFile() string {
	selectedPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Playlist As",
		DefaultFilename: "playlist.m3u8",
		Filters: []runtime.FileFilter{{
			DisplayName: "Playlists",
			Pattern:     "*.m3u;*.m3u8",
		}},
	})
	if err != nil {
		return ""
	}

	cleanPath := strings.TrimSpace(selectedPath)
	if cleanPath == "" {
		return ""
	}

	ext := strings.ToLower(filepath.Ext(cleanPath))
	if ext != ".m3u" && ext != ".m3u8" {
		cleanPath += ".m3u8"
	}

	return cleanPath
}

// SavePlaylistFile writes the provided track paths to an M3U/M3U8 playlist file.
func (a *App) SavePlaylistFile(path string, trackPaths []string) bool {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return false
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return false
	}
	cleanPath = filepath.Clean(absolutePath)

	if mkdirErr := os.MkdirAll(filepath.Dir(cleanPath), 0o755); mkdirErr != nil {
		return false
	}

	var builder strings.Builder
	builder.WriteString("#EXTM3U\n")
	for _, trackPath := range trackPaths {
		trimmed := strings.TrimSpace(trackPath)
		if trimmed == "" {
			continue
		}

		builder.WriteString(trimmed)
		builder.WriteByte('\n')
	}

	if writeErr := os.WriteFile(cleanPath, []byte(builder.String()), 0o644); writeErr != nil {
		return false
	}

	return true
}

func resolvePlaylistEntryPath(playlistPath string, entry string) (string, bool) {
	clean := strings.TrimSpace(entry)
	if clean == "" || strings.HasPrefix(clean, "#") {
		return "", false
	}

	if strings.Contains(clean, "://") {
		return "", false
	}

	trimmed := strings.TrimLeftFunc(clean, unicode.IsSpace)
	if trimmed == "" {
		return "", false
	}

	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed), true
	}

	baseDir := filepath.Dir(playlistPath)
	return filepath.Clean(filepath.Join(baseDir, trimmed)), true
}

// LoadPlaylistFile parses a playlist and returns valid audio entries within the allowed library scope.
func (a *App) LoadPlaylistFile(path string) PlaylistLoadResult {
	cleanPath := normalizePath(path)
	result := PlaylistLoadResult{
		Name:       filepath.Base(cleanPath),
		TrackFiles: []LibraryIndexedFile{},
	}

	if cleanPath == "" {
		return result
	}

	absolutePath, err := filepath.Abs(cleanPath)
	if err != nil {
		return result
	}
	cleanPath = filepath.Clean(absolutePath)
	result.Name = filepath.Base(cleanPath)

	fileHandle, err := os.Open(cleanPath)
	if err != nil {
		return result
	}
	defer fileHandle.Close()

	scanner := bufio.NewScanner(fileHandle)
	for scanner.Scan() {
		resolved, ok := resolvePlaylistEntryPath(cleanPath, scanner.Text())
		if !ok || !isAudioPath(resolved) {
			continue
		}

		if !a.isAllowedLibraryPath(resolved) {
			continue
		}

		fileInfo, statErr := os.Stat(resolved)
		if statErr != nil || fileInfo.IsDir() {
			continue
		}

		result.TrackFiles = append(result.TrackFiles, LibraryIndexedFile{
			Name:         filepath.Base(resolved),
			Path:         resolved,
			RelativePath: filepath.Base(resolved),
			FolderPath:   filepath.ToSlash(filepath.Dir(resolved)),
		})
	}

	return result
}

func (a *App) scanLibraryFolder(path string, restartWatcher bool) LibraryScanResult {
	cleanRoot := normalizePath(path)
	result := LibraryScanResult{
		RootPath:          cleanRoot,
		RootName:          filepath.Base(cleanRoot),
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		ImageFiles:        []LibraryIndexedFile{},
		CoverPathByFolder: map[string]string{},
		EntryLimit:        0,
	}

	if cleanRoot == "" {
		return result
	}

	absoluteRoot, err := filepath.Abs(cleanRoot)
	if err != nil {
		return result
	}

	cleanRoot = filepath.Clean(absoluteRoot)
	result.RootPath = cleanRoot
	result.RootName = filepath.Base(cleanRoot)

	totalEntries := 0
	_ = filepath.WalkDir(cleanRoot, func(currentPath string, _ fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if currentPath == cleanRoot {
			return nil
		}

		totalEntries++
		return nil
	})

	scanStartedAt := time.Now()
	lastProgressEmit := time.Time{}
	scannedEntries := 0
	finalizationStartedAt := time.Time{}
	finalizationBudgetMs := 0.0

	a.indexMu.Lock()
	learnedFinalizeMs := a.scanFinalizeMs
	a.indexMu.Unlock()

	estimateFinalizationBudgetMs := func(elapsed time.Duration, entriesDone int) float64 {
		if learnedFinalizeMs > 0 {
			return learnedFinalizeMs
		}

		if totalEntries <= 0 {
			return 8000
		}

		if entriesDone <= 0 {
			entriesDone = 1
		}

		progress := float64(entriesDone) / float64(totalEntries)
		if progress < 0.02 {
			progress = 0.02
		}

		estimatedScanTotalMs := float64(elapsed.Milliseconds()) / progress
		fallback := estimatedScanTotalMs * 0.22
		if fallback < 4000 {
			fallback = 4000
		}
		if fallback > 180000 {
			fallback = 180000
		}

		return fallback
	}

	emitProgress := func(force bool, phase string) {
		if a.ctx == nil || totalEntries <= 0 {
			return
		}

		now := time.Now()
		if !force {
			if !lastProgressEmit.IsZero() && now.Sub(lastProgressEmit) < 120*time.Millisecond {
				return
			}
		}

		elapsed := now.Sub(scanStartedAt)
		etaSeconds := 0
		if phase == "scanning" {
			remainingScanSeconds := 0.0
			if scannedEntries < totalEntries {
				elapsedSeconds := elapsed.Seconds()
				if elapsedSeconds > 0 && scannedEntries > 0 {
					rate := float64(scannedEntries) / elapsedSeconds
					if rate > 0 {
						remainingEntries := totalEntries - scannedEntries
						remainingScanSeconds = float64(remainingEntries) / rate
					}
				}
			}

			remainingFinalizeSeconds := estimateFinalizationBudgetMs(elapsed, scannedEntries) / 1000
			etaSeconds = int(math.Ceil(remainingScanSeconds + remainingFinalizeSeconds))
		} else if phase == "finalizing" {
			if finalizationBudgetMs <= 0 {
				finalizationBudgetMs = estimateFinalizationBudgetMs(elapsed, scannedEntries)
			}

			elapsedFinalizationMs := 0.0
			if !finalizationStartedAt.IsZero() {
				elapsedFinalizationMs = float64(now.Sub(finalizationStartedAt).Milliseconds())
			}

			remainingMs := finalizationBudgetMs - elapsedFinalizationMs
			if remainingMs < 0 {
				remainingMs = 0
			}

			etaSeconds = int(math.Ceil(remainingMs / 1000))
		}

		runtime.EventsEmit(a.ctx, libraryScanProgressEvent, LibraryScanProgress{
			RootPath:       cleanRoot,
			EntriesScanned: scannedEntries,
			TotalEntries:   totalEntries,
			ElapsedMs:      elapsed.Milliseconds(),
			EtaSeconds:     etaSeconds,
			Phase:          phase,
		})
		lastProgressEmit = now
	}

	emitProgress(true, "scanning")

	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)

	scanErr := filepath.WalkDir(cleanRoot, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if currentPath == cleanRoot {
			return nil
		}

		result.TotalEntries++
		scannedEntries++
		emitProgress(false, "scanning")

		if entry.IsDir() {
			return nil
		}

		folderPath, relativePath, ok := folderAndRelative(cleanRoot, currentPath)
		if !ok {
			return nil
		}

		indexed := LibraryIndexedFile{
			Name:         entry.Name(),
			Path:         currentPath,
			RelativePath: relativePath,
			FolderPath:   folderPath,
		}

		switch {
		case isAudioPath(currentPath):
			result.TrackFiles = append(result.TrackFiles, indexed)
		case isTextPath(currentPath):
			result.TextFiles = append(result.TextFiles, indexed)
		case isImagePath(currentPath):
			result.ImageFiles = append(result.ImageFiles, indexed)

			if !isJpegPath(currentPath) {
				break
			}

			folderKey := strings.ToLower(folderPath)
			name := strings.ToLower(entry.Name())
			priority := coverPriority(name)
			currentPriority, hasCurrent := selectedCoverPriority[folderKey]
			currentName := selectedCoverName[folderKey]

			if !hasCurrent || priority < currentPriority || (priority == currentPriority && name < currentName) {
				selectedCoverPriority[folderKey] = priority
				selectedCoverName[folderKey] = name
				result.CoverPathByFolder[folderKey] = currentPath
			}
		}

		return nil
	})

	if scanErr != nil {
		result.TrackCount = len(result.TrackFiles)
		result.TextFileCount = len(result.TextFiles)
		result.ImageFileCount = len(result.ImageFiles)
		finalizationStartedAt = time.Now()
		finalizationBudgetMs = estimateFinalizationBudgetMs(finalizationStartedAt.Sub(scanStartedAt), scannedEntries)
		emitProgress(true, "finalizing")
		return result
	}

	scannedEntries = totalEntries
	finalizationStartedAt = time.Now()
	finalizationBudgetMs = estimateFinalizationBudgetMs(finalizationStartedAt.Sub(scanStartedAt), scannedEntries)
	emitProgress(true, "finalizing")

	sort.SliceStable(result.TrackFiles, func(i int, j int) bool {
		left := strings.ToLower(result.TrackFiles[i].RelativePath)
		right := strings.ToLower(result.TrackFiles[j].RelativePath)
		return left < right
	})

	sort.SliceStable(result.TextFiles, func(i int, j int) bool {
		left := strings.ToLower(result.TextFiles[i].RelativePath)
		right := strings.ToLower(result.TextFiles[j].RelativePath)
		return left < right
	})

	sort.SliceStable(result.ImageFiles, func(i int, j int) bool {
		left := strings.ToLower(result.ImageFiles[i].RelativePath)
		right := strings.ToLower(result.ImageFiles[j].RelativePath)
		return left < right
	})

	result.TrackCount = len(result.TrackFiles)
	result.TextFileCount = len(result.TextFiles)
	result.ImageFileCount = len(result.ImageFiles)

	a.libraryRoot = cleanRoot
	a.setLibraryIndexFromScan(result)
	if restartWatcher {
		a.startLibraryWatcher(cleanRoot)
	}

	actualFinalizationMs := float64(time.Since(finalizationStartedAt).Milliseconds())
	if actualFinalizationMs > 0 {
		a.indexMu.Lock()
		if a.scanFinalizeMs <= 0 {
			a.scanFinalizeMs = actualFinalizationMs
		} else {
			a.scanFinalizeMs = (a.scanFinalizeMs * 0.72) + (actualFinalizationMs * 0.28)
		}
		a.indexMu.Unlock()
	}

	response := result
	response.TrackFiles = []LibraryIndexedFile{}
	response.TextFiles = []LibraryIndexedFile{}
	response.ImageFiles = []LibraryIndexedFile{}
	return response
}

// ScanLibraryFolder indexes audio, text, and image files under the selected root folder.
func (a *App) ScanLibraryFolder(path string) LibraryScanResult {
	return a.scanLibraryFolder(path, true)
}

// GetLibraryIndexedFilePage returns a paginated slice of indexed files for initial frontend hydration.
func (a *App) GetLibraryIndexedFilePage(kind string, offset int, limit int) LibraryIndexedFilePage {
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	switch normalizedKind {
	case "track":
		return pagedIndexedFiles("track", a.libraryScan.TrackFiles, offset, limit)
	case "text-file":
		return pagedIndexedFiles("text-file", a.libraryScan.TextFiles, offset, limit)
	case "image-file":
		return pagedIndexedFiles("image-file", a.libraryScan.ImageFiles, offset, limit)
	default:
		return LibraryIndexedFilePage{
			Kind:         normalizedKind,
			Offset:       offset,
			Limit:        limit,
			TotalEntries: 0,
			Entries:      []LibraryIndexedFile{},
		}
	}
}

// GetLibraryFolderPage returns a paginated folder listing from the current backend index.
func (a *App) GetLibraryFolderPage(folderPath string, offset int, limit int) LibraryFolderPage {
	queryStartTime := time.Now()
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return LibraryFolderPage{
			FolderPath: normalizedFolderPath,
			Offset:     offset,
			Limit:      limit,
			Entries:    []LibraryBrowserEntry{},
		}
	}

	if limit <= 0 {
		limit = 100
	}

	lockWaitStart := time.Now()
	a.logRescanEvent("GetLibraryFolderPage waiting for indexMu lock: %s", normalizedFolderPath)
	a.indexMu.Lock()
	a.logRescanEvent("GetLibraryFolderPage acquired lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer a.indexMu.Unlock()

	folderEntriesByPath := make(map[string]LibraryBrowserEntry)
	trackEntries := make([]LibraryBrowserEntry, 0)
	textEntries := make([]LibraryBrowserEntry, 0)
	imageEntries := make([]LibraryBrowserEntry, 0)

	appendEntry := func(indexed LibraryIndexedFile, kind string, destination *[]LibraryBrowserEntry) {
		if indexed.FolderPath == normalizedFolderPath {
			*destination = append(*destination, browserEntryFromIndexedFile(kind, indexed))
			return
		}

		childFolderPath, childOk := directChildFolderPath(normalizedFolderPath, indexed.FolderPath)
		if !childOk {
			return
		}

		if _, exists := folderEntriesByPath[childFolderPath]; !exists {
			folderEntriesByPath[childFolderPath] = folderBrowserEntry(childFolderPath)
		}
	}

	for _, indexed := range a.trackByPath {
		appendEntry(indexed, "track", &trackEntries)
	}
	for _, indexed := range a.textByPath {
		appendEntry(indexed, "text-file", &textEntries)
	}
	for _, indexed := range a.imageByPath {
		appendEntry(indexed, "image-file", &imageEntries)
	}

	folderEntries := make([]LibraryBrowserEntry, 0, len(folderEntriesByPath))
	for _, entry := range folderEntriesByPath {
		folderEntries = append(folderEntries, entry)
	}

	sort.SliceStable(folderEntries, func(i int, j int) bool {
		return strings.ToLower(folderEntries[i].Path) < strings.ToLower(folderEntries[j].Path)
	})
	sort.SliceStable(trackEntries, func(i int, j int) bool {
		return strings.ToLower(trackEntries[i].Name) < strings.ToLower(trackEntries[j].Name)
	})
	sort.SliceStable(textEntries, func(i int, j int) bool {
		return strings.ToLower(textEntries[i].Name) < strings.ToLower(textEntries[j].Name)
	})
	sort.SliceStable(imageEntries, func(i int, j int) bool {
		return strings.ToLower(imageEntries[i].Name) < strings.ToLower(imageEntries[j].Name)
	})

	entries := make([]LibraryBrowserEntry, 0, len(folderEntries)+len(trackEntries)+len(textEntries)+len(imageEntries))
	entries = append(entries, folderEntries...)
	entries = append(entries, trackEntries...)
	entries = append(entries, textEntries...)
	entries = append(entries, imageEntries...)

	result := LibraryFolderPage{
		FolderPath:   normalizedFolderPath,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedLibraryEntries(entries, offset, limit),
	}
	a.logRescanEvent("GetLibraryFolderPage END: %d total entries, took %.2fms", len(entries), time.Since(queryStartTime).Seconds()*1000)
	return result
}

// SearchLibrary returns paginated server-side search results across folders and indexed files.
func (a *App) SearchLibrary(query string, offset int, limit int) LibrarySearchPage {
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	if limit <= 0 {
		limit = 100
	}

	if normalizedQuery == "" {
		return LibrarySearchPage{
			Query:   query,
			Offset:  offset,
			Limit:   limit,
			Entries: []LibraryBrowserEntry{},
		}
	}

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	folderPaths := make(map[string]struct{})
	folderMatchesByPath := make(map[string]LibraryBrowserEntry)
	trackMatches := make([]LibraryBrowserEntry, 0)
	textMatches := make([]LibraryBrowserEntry, 0)
	imageMatches := make([]LibraryBrowserEntry, 0)

	collectFolderAncestors := func(folderPath string) {
		if folderPath == "" {
			return
		}

		segments := strings.Split(folderPath, "/")
		cumulative := ""
		for _, segment := range segments {
			if segment == "" {
				continue
			}

			if cumulative == "" {
				cumulative = segment
			} else {
				cumulative += "/" + segment
			}

			folderPaths[cumulative] = struct{}{}
		}
	}

	matchIndexedFile := func(indexed LibraryIndexedFile, kind string, destination *[]LibraryBrowserEntry) {
		collectFolderAncestors(indexed.FolderPath)
		candidateName := strings.ToLower(indexed.Name)
		candidateRelativePath := strings.ToLower(indexed.RelativePath)
		if strings.Contains(candidateName, normalizedQuery) || strings.Contains(candidateRelativePath, normalizedQuery) {
			*destination = append(*destination, browserEntryFromIndexedFile(kind, indexed))
		}
	}

	for _, indexed := range a.trackByPath {
		matchIndexedFile(indexed, "track", &trackMatches)
	}
	for _, indexed := range a.textByPath {
		matchIndexedFile(indexed, "text-file", &textMatches)
	}
	for _, indexed := range a.imageByPath {
		matchIndexedFile(indexed, "image-file", &imageMatches)
	}

	for folderPath := range folderPaths {
		folderName := folderPath
		if lastSlash := strings.LastIndex(folderPath, "/"); lastSlash >= 0 {
			folderName = folderPath[lastSlash+1:]
		}

		if strings.Contains(strings.ToLower(folderPath), normalizedQuery) || strings.Contains(strings.ToLower(folderName), normalizedQuery) {
			folderMatchesByPath[folderPath] = folderBrowserEntry(folderPath)
		}
	}

	folderMatches := make([]LibraryBrowserEntry, 0, len(folderMatchesByPath))
	for _, entry := range folderMatchesByPath {
		folderMatches = append(folderMatches, entry)
	}

	sort.SliceStable(folderMatches, func(i int, j int) bool {
		return strings.ToLower(folderMatches[i].Path) < strings.ToLower(folderMatches[j].Path)
	})
	sort.SliceStable(trackMatches, func(i int, j int) bool {
		return strings.ToLower(trackMatches[i].RelativePath) < strings.ToLower(trackMatches[j].RelativePath)
	})
	sort.SliceStable(textMatches, func(i int, j int) bool {
		return strings.ToLower(textMatches[i].RelativePath) < strings.ToLower(textMatches[j].RelativePath)
	})
	sort.SliceStable(imageMatches, func(i int, j int) bool {
		return strings.ToLower(imageMatches[i].RelativePath) < strings.ToLower(imageMatches[j].RelativePath)
	})

	entries := make([]LibraryBrowserEntry, 0, len(folderMatches)+len(trackMatches)+len(textMatches)+len(imageMatches))
	entries = append(entries, folderMatches...)
	entries = append(entries, trackMatches...)
	entries = append(entries, textMatches...)
	entries = append(entries, imageMatches...)

	return LibrarySearchPage{
		Query:        query,
		Offset:       offset,
		Limit:        limit,
		TotalEntries: len(entries),
		Entries:      pagedLibraryEntries(entries, offset, limit),
	}
}

// GetLibraryFolderTrackPaths resolves all audio tracks under a folder subtree for queue actions.
func (a *App) GetLibraryFolderTrackPaths(folderPath string) []string {
	normalizedFolderPath, ok := normalizeLibraryRelativePath(folderPath)
	if !ok {
		return []string{}
	}

	a.indexMu.Lock()
	defer a.indexMu.Unlock()

	prefix := ""
	if normalizedFolderPath != "" {
		prefix = normalizedFolderPath + "/"
	}

	trackFiles := make([]LibraryIndexedFile, 0)
	for _, indexed := range a.trackByPath {
		if normalizedFolderPath == "" || indexed.FolderPath == normalizedFolderPath || strings.HasPrefix(indexed.FolderPath, prefix) {
			trackFiles = append(trackFiles, indexed)
		}
	}

	sort.SliceStable(trackFiles, func(i int, j int) bool {
		left := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, trackFiles[i].RelativePath))
		right := strings.ToLower(relativePathWithinFolder(normalizedFolderPath, trackFiles[j].RelativePath))
		return left < right
	})

	paths := make([]string, 0, len(trackFiles))
	for _, indexed := range trackFiles {
		paths = append(paths, indexed.Path)
	}

	return paths
}

func cloneCoverPathByFolder(input map[string]string) map[string]string {
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}

	return cloned
}

func (a *App) setLibraryIndexFromScan(scan LibraryScanResult) {
	setStartTime := time.Now()
	a.logRescanEvent("setLibraryIndexFromScan START: %d tracks, %d text, %d images",
		len(scan.TrackFiles), len(scan.TextFiles), len(scan.ImageFiles))

	lockWaitStart := time.Now()
	a.indexMu.Lock()
	a.logRescanEvent("  - setLibraryIndexFromScan acquired lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer a.indexMu.Unlock()

	mapStartTime := time.Now()
	a.trackByPath = make(map[string]LibraryIndexedFile, len(scan.TrackFiles))
	a.textByPath = make(map[string]LibraryIndexedFile, len(scan.TextFiles))
	a.imageByPath = make(map[string]LibraryIndexedFile, len(scan.ImageFiles))

	for _, entry := range scan.TrackFiles {
		a.trackByPath[entry.Path] = entry
	}
	for _, entry := range scan.TextFiles {
		a.textByPath[entry.Path] = entry
	}
	for _, entry := range scan.ImageFiles {
		a.imageByPath[entry.Path] = entry
	}
	a.logRescanEvent("  - indexed maps populated (%.2fms)", time.Since(mapStartTime).Seconds()*1000)

	copyCoverStartTime := time.Now()
	a.libraryScan = scan
	a.libraryScan.CoverPathByFolder = cloneCoverPathByFolder(scan.CoverPathByFolder)
	a.logRescanEvent("  - cover paths copied (%.2fms)", time.Since(copyCoverStartTime).Seconds()*1000)
	a.logRescanEvent("setLibraryIndexFromScan END: total time %.2fms", time.Since(setStartTime).Seconds()*1000)
}

func (a *App) removePathAndDescendants(path string) {
	delete(a.trackByPath, path)
	delete(a.textByPath, path)
	delete(a.imageByPath, path)

	prefix := path + string(filepath.Separator)
	for candidatePath := range a.trackByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(a.trackByPath, candidatePath)
		}
	}
	for candidatePath := range a.textByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(a.textByPath, candidatePath)
		}
	}
	for candidatePath := range a.imageByPath {
		if strings.HasPrefix(candidatePath, prefix) {
			delete(a.imageByPath, candidatePath)
		}
	}
}

func indexFileForRoot(rootPath string, fullPath string, fileName string) (LibraryIndexedFile, bool) {
	folderPath, relativePath, ok := folderAndRelative(rootPath, fullPath)
	if !ok {
		return LibraryIndexedFile{}, false
	}

	return LibraryIndexedFile{
		Name:         fileName,
		Path:         fullPath,
		RelativePath: relativePath,
		FolderPath:   folderPath,
	}, true
}

func (a *App) addOrUpdateIndexedFile(rootPath string, fullPath string, fileName string) {
	a.removePathAndDescendants(fullPath)

	indexed, ok := indexFileForRoot(rootPath, fullPath, fileName)
	if !ok {
		return
	}

	switch {
	case isAudioPath(fullPath):
		a.trackByPath[fullPath] = indexed
	case isTextPath(fullPath):
		a.textByPath[fullPath] = indexed
	case isImagePath(fullPath):
		a.imageByPath[fullPath] = indexed
	}
}

func (a *App) addOrUpdatePathRecursive(rootPath string, targetPath string) {
	startTime := time.Now()
	info, err := os.Stat(targetPath)
	if err != nil {
		a.removePathAndDescendants(targetPath)
		return
	}

	if !info.IsDir() {
		a.addOrUpdateIndexedFile(rootPath, targetPath, info.Name())
		a.logRescanEvent("  - processed single file: %s", targetPath)
		return
	}

	a.removePathAndDescendants(targetPath)
	fileCount := 0
	_ = filepath.WalkDir(targetPath, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}

		a.addOrUpdateIndexedFile(rootPath, currentPath, entry.Name())
		fileCount++
		return nil
	})
	a.logRescanEvent("  - processed directory: %s (%d files in %.2fms)", targetPath, fileCount, time.Since(startTime).Seconds()*1000)
}

func (a *App) rebuildCoverPathByFolderLocked() map[string]string {
	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)
	coverPathByFolder := make(map[string]string)

	for _, entry := range a.imageByPath {
		if !isJpegPath(entry.Path) {
			continue
		}

		folderKey := strings.ToLower(entry.FolderPath)
		name := strings.ToLower(entry.Name)
		priority := coverPriority(name)
		currentPriority, hasCurrent := selectedCoverPriority[folderKey]
		currentName := selectedCoverName[folderKey]

		if !hasCurrent || priority < currentPriority || (priority == currentPriority && name < currentName) {
			selectedCoverPriority[folderKey] = priority
			selectedCoverName[folderKey] = name
			coverPathByFolder[folderKey] = entry.Path
		}
	}

	return coverPathByFolder
}

func (a *App) snapshotLibraryScanLocked(rootPath string) LibraryScanResult {
	trackFiles := make([]LibraryIndexedFile, 0, len(a.trackByPath))
	for _, entry := range a.trackByPath {
		trackFiles = append(trackFiles, entry)
	}

	textFiles := make([]LibraryIndexedFile, 0, len(a.textByPath))
	for _, entry := range a.textByPath {
		textFiles = append(textFiles, entry)
	}

	imageFiles := make([]LibraryIndexedFile, 0, len(a.imageByPath))
	for _, entry := range a.imageByPath {
		imageFiles = append(imageFiles, entry)
	}

	sort.SliceStable(trackFiles, func(i int, j int) bool {
		left := strings.ToLower(trackFiles[i].RelativePath)
		right := strings.ToLower(trackFiles[j].RelativePath)
		return left < right
	})

	sort.SliceStable(textFiles, func(i int, j int) bool {
		left := strings.ToLower(textFiles[i].RelativePath)
		right := strings.ToLower(textFiles[j].RelativePath)
		return left < right
	})

	sort.SliceStable(imageFiles, func(i int, j int) bool {
		left := strings.ToLower(imageFiles[i].RelativePath)
		right := strings.ToLower(imageFiles[j].RelativePath)
		return left < right
	})

	coverPathByFolder := a.rebuildCoverPathByFolderLocked()
	return LibraryScanResult{
		RootPath:          rootPath,
		RootName:          filepath.Base(rootPath),
		TrackFiles:        trackFiles,
		TextFiles:         textFiles,
		ImageFiles:        imageFiles,
		CoverPathByFolder: coverPathByFolder,
		TotalEntries:      len(trackFiles) + len(textFiles) + len(imageFiles),
		TrackCount:        len(trackFiles),
		TextFileCount:     len(textFiles),
		ImageFileCount:    len(imageFiles),
		Truncated:         a.libraryScan.Truncated,
		EntryLimit:        a.libraryScan.EntryLimit,
	}
}

func (a *App) applyIncrementalLibraryChanges(rootPath string, changedPaths []string) (LibraryScanResult, bool) {
	startTime := time.Now()
	a.logRescanEvent("applyIncrementalLibraryChanges START with %d paths", len(changedPaths))

	lockWaitStart := time.Now()
	a.logRescanEvent("  - waiting for indexMu lock...")
	a.indexMu.Lock()
	a.logRescanEvent("  - acquired indexMu lock (waited %.2fms)", time.Since(lockWaitStart).Seconds()*1000)
	defer a.indexMu.Unlock()

	if len(changedPaths) == 0 {
		return LibraryScanResult{}, false
	}

	hasChanges := false
	processStartTime := time.Now()
	for _, changedPath := range changedPaths {
		cleanChangedPath := normalizePath(changedPath)
		if cleanChangedPath == "" {
			continue
		}

		absoluteChangedPath, err := filepath.Abs(cleanChangedPath)
		if err != nil {
			continue
		}

		normalizedChangedPath := filepath.Clean(absoluteChangedPath)
		if relToRoot, relErr := filepath.Rel(rootPath, normalizedChangedPath); relErr != nil || strings.HasPrefix(relToRoot, "..") {
			continue
		}

		a.addOrUpdatePathRecursive(rootPath, normalizedChangedPath)
		hasChanges = true
	}
	a.logRescanEvent("applyIncrementalLibraryChanges path processing took %.2fms for %d paths",
		time.Since(processStartTime).Seconds()*1000, len(changedPaths))

	if !hasChanges {
		return LibraryScanResult{}, false
	}

	// Avoid expensive full snapshot rebuild for incremental changes.
	// Just update the counts in the cached snapshot without re-sorting all files.
	// The file arrays are still valid (items may have been added/removed from the maps,
	// but the snapshot lists are consistent for the event emission).
	updateStartTime := time.Now()
	a.libraryScan.TrackCount = len(a.trackByPath)
	a.libraryScan.TextFileCount = len(a.textByPath)
	a.libraryScan.ImageFileCount = len(a.imageByPath)
	a.libraryScan.TotalEntries = a.libraryScan.TrackCount + a.libraryScan.TextFileCount + a.libraryScan.ImageFileCount

	// Emit only the lightweight metadata — the frontend no longer uses the file arrays
	// for incremental updates, and serializing 150K+ entries over IPC takes several seconds.
	notification := LibraryScanResult{
		RootPath:     a.libraryScan.RootPath,
		RootName:     a.libraryScan.RootName,
		TotalEntries: a.libraryScan.TotalEntries,
		TrackCount:   a.libraryScan.TrackCount,
		TextFileCount: a.libraryScan.TextFileCount,
		ImageFileCount: a.libraryScan.ImageFileCount,
		Truncated:    a.libraryScan.Truncated,
		EntryLimit:   a.libraryScan.EntryLimit,
	}
	a.logRescanEvent("applyIncrementalLibraryChanges update took %.2fms, total time %.2fms",
		time.Since(updateStartTime).Seconds()*1000, time.Since(startTime).Seconds()*1000)

	return notification, true
}

func isRelevantWatchEvent(event fsnotify.Event) bool {
	interestingOps := fsnotify.Create | fsnotify.Write | fsnotify.Remove | fsnotify.Rename
	return event.Op&interestingOps != 0
}

func addLibraryWatchesRecursive(watcher *fsnotify.Watcher, rootPath string) {
	_ = filepath.WalkDir(rootPath, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if !entry.IsDir() {
			return nil
		}

		_ = watcher.Add(currentPath)
		return nil
	})
}

func (a *App) startLibraryWatcher(rootPath string) {
	a.logRescanEvent("Starting library watcher for: %s", rootPath)
	normalizedRoot := normalizePath(rootPath)
	if normalizedRoot == "" {
		a.stopLibraryWatcher()
		return
	}

	absRoot, err := filepath.Abs(normalizedRoot)
	if err != nil {
		return
	}

	cleanRoot := filepath.Clean(absRoot)
	if info, statErr := os.Stat(cleanRoot); statErr != nil || !info.IsDir() {
		return
	}

	a.indexMu.Lock()
	indexMissing := a.libraryScan.RootPath != cleanRoot || a.trackByPath == nil || a.textByPath == nil || a.imageByPath == nil
	a.indexMu.Unlock()
	if indexMissing {
		a.logRescanEvent("Library index missing, performing initial scan")
		_ = a.scanLibraryFolder(cleanRoot, false)
	}

	watcher, watcherErr := fsnotify.NewWatcher()
	if watcherErr != nil {
		a.logRescanEvent("Failed to create filesystem watcher: %v", watcherErr)
		return
	}
	a.logRescanEvent("Watcher created, registering all directories")

	addLibraryWatchesRecursive(watcher, cleanRoot)
	a.logRescanEvent("Watcher ready, listening for changes")
	stopCh := make(chan struct{})

	a.watchMu.Lock()
	previousWatcher := a.libraryWatcher
	previousStopCh := a.watchStop
	a.libraryWatcher = watcher
	a.watchStop = stopCh
	a.watchMu.Unlock()

	if previousStopCh != nil {
		close(previousStopCh)
	}
	if previousWatcher != nil {
		_ = previousWatcher.Close()
	}

	go func(root string, activeWatcher *fsnotify.Watcher, activeStopCh chan struct{}) {
		defer func() {
			_ = activeWatcher.Close()
		}()

		const debounceDuration = 500 * time.Millisecond
		var timer *time.Timer
		var timerC <-chan time.Time
		pendingPaths := make(map[string]struct{})

		resetDebounce := func() {
			if timer == nil {
				timer = time.NewTimer(debounceDuration)
				timerC = timer.C
				return
			}

			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}

			timer.Reset(debounceDuration)
			timerC = timer.C
		}

		for {
			select {
			case <-activeStopCh:
				if timer != nil {
					timer.Stop()
				}
				return

			case event, ok := <-activeWatcher.Events:
				if !ok {
					if timer != nil {
						timer.Stop()
					}
					return
				}

				if event.Op&fsnotify.Create != 0 {
					if info, statErr := os.Stat(event.Name); statErr == nil && info.IsDir() {
						addLibraryWatchesRecursive(activeWatcher, event.Name)
					}
				}

				if isRelevantWatchEvent(event) {
					pendingPaths[event.Name] = struct{}{}
					resetDebounce()
				}

			case <-timerC:
				timerC = nil
				changedPaths := make([]string, 0, len(pendingPaths))
				for changedPath := range pendingPaths {
					changedPaths = append(changedPaths, changedPath)
				}
				pendingPaths = make(map[string]struct{})
				a.logRescanEvent("Debounce timer fired, applying incremental changes to %d paths", len(changedPaths))

				scan, changed := a.applyIncrementalLibraryChanges(root, changedPaths)
				if changed && a.ctx != nil {
					emitStartTime := time.Now()
					a.logRescanEvent("EventsEmit START: sending scan update event")
					runtime.EventsEmit(a.ctx, libraryScanUpdatedEvent, scan)
					a.logRescanEvent("EventsEmit END: took %.2fms", time.Since(emitStartTime).Seconds()*1000)
				}

			case _, ok := <-activeWatcher.Errors:
				if !ok {
					if timer != nil {
						timer.Stop()
					}
					return
				}
			}
		}
	}(cleanRoot, watcher, stopCh)
}

func (a *App) stopLibraryWatcher() {
	a.watchMu.Lock()
	watcher := a.libraryWatcher
	stopCh := a.watchStop
	a.libraryWatcher = nil
	a.watchStop = nil
	a.watchMu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}

	if watcher != nil {
		_ = watcher.Close()
	}
}

// ReadFileBase64 reads a file from the allowed library scope and returns its base64 content.
func (a *App) ReadFileBase64(path string) string {
	if !a.isAllowedLibraryPath(path) {
		return ""
	}

	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	return base64.StdEncoding.EncodeToString(rawBytes)
}

// ReadTextFile reads and decodes a text file from the allowed library scope.
func (a *App) ReadTextFile(path string) string {
	if !a.isAllowedLibraryPath(path) {
		return ""
	}

	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	return decodeTextFileBytes(rawBytes)
}

func decodeTextFileBytes(rawBytes []byte) string {
	if len(rawBytes) == 0 {
		return ""
	}

	if bytes.HasPrefix(rawBytes, []byte{0xEF, 0xBB, 0xBF}) {
		return string(rawBytes[3:])
	}

	if bytes.HasPrefix(rawBytes, []byte{0xFF, 0xFE}) {
		return decodeUTF16Bytes(rawBytes[2:], binary.LittleEndian)
	}

	if bytes.HasPrefix(rawBytes, []byte{0xFE, 0xFF}) {
		return decodeUTF16Bytes(rawBytes[2:], binary.BigEndian)
	}

	if utf8.Valid(rawBytes) {
		return string(rawBytes)
	}

	evenZeroRatio, oddZeroRatio := utf16ZeroRatios(rawBytes)
	if oddZeroRatio > 0.6 && evenZeroRatio < 0.2 {
		return decodeUTF16Bytes(rawBytes, binary.LittleEndian)
	}

	if evenZeroRatio > 0.6 && oddZeroRatio < 0.2 {
		return decodeUTF16Bytes(rawBytes, binary.BigEndian)
	}

	return string(rawBytes)
}

func decodeUTF16Bytes(rawBytes []byte, order binary.ByteOrder) string {
	if len(rawBytes) == 0 {
		return ""
	}

	if len(rawBytes)%2 != 0 {
		rawBytes = rawBytes[:len(rawBytes)-1]
	}

	if len(rawBytes) == 0 {
		return ""
	}

	units := make([]uint16, 0, len(rawBytes)/2)
	for index := 0; index+1 < len(rawBytes); index += 2 {
		units = append(units, order.Uint16(rawBytes[index:index+2]))
	}

	decoded := utf16.Decode(units)
	if len(decoded) > 0 && decoded[0] == '\ufeff' {
		decoded = decoded[1:]
	}

	return string(decoded)
}

func utf16ZeroRatios(rawBytes []byte) (float64, float64) {
	if len(rawBytes) < 2 {
		return 0, 0
	}

	evenTotal := 0
	evenZeros := 0
	oddTotal := 0
	oddZeros := 0

	for index, value := range rawBytes {
		if index%2 == 0 {
			evenTotal++
			if value == 0 {
				evenZeros++
			}
			continue
		}

		oddTotal++
		if value == 0 {
			oddZeros++
		}
	}

	if evenTotal == 0 || oddTotal == 0 {
		return 0, 0
	}

	return float64(evenZeros) / float64(evenTotal), float64(oddZeros) / float64(oddTotal)
}

func firstTagValue(tags map[string][]string, keys ...string) string {
	for _, key := range keys {
		for tagKey, values := range tags {
			if !strings.EqualFold(tagKey, key) || len(values) == 0 {
				continue
			}

			value := strings.TrimSpace(values[0])
			if value != "" {
				return value
			}
		}
	}

	return ""
}

func collectAllTags(tags map[string][]string) map[string][]string {
	if len(tags) == 0 {
		return nil
	}

	collected := make(map[string][]string, len(tags))
	for key, values := range tags {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}

		trimmedValues := make([]string, 0, len(values))
		for _, value := range values {
			trimmedValue := strings.TrimSpace(value)
			if trimmedValue == "" {
				continue
			}

			trimmedValues = append(trimmedValues, trimmedValue)
		}

		if len(trimmedValues) == 0 {
			continue
		}

		collected[trimmedKey] = trimmedValues
	}

	if len(collected) == 0 {
		return nil
	}

	return collected
}

func splitSlashPair(value string) (string, string) {
	clean := strings.TrimSpace(value)
	if clean == "" {
		return "", ""
	}

	parts := strings.SplitN(clean, "/", 2)
	if len(parts) == 1 {
		return strings.TrimSpace(parts[0]), ""
	}

	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
}

func extractTrackNumbers(tags map[string][]string) (string, string) {
	number := firstTagValue(tags, "TRACKNUMBER", "TRACK", "TRCK")
	total := firstTagValue(tags, "TRACKTOTAL", "TOTALTRACKS", "TOTALTRACKCOUNT")

	numberPart, totalPart := splitSlashPair(number)
	if numberPart != "" {
		number = numberPart
	}

	if total == "" && totalPart != "" {
		total = totalPart
	}

	if total != "" {
		total, _ = splitSlashPair(total)
	}

	return strings.TrimSpace(number), strings.TrimSpace(total)
}

type ffprobeAudioStream struct {
	CodecName        string `json:"codec_name"`
	CodecLongName    string `json:"codec_long_name"`
	Profile          string `json:"profile"`
	SampleRate       string `json:"sample_rate"`
	BitsPerRawSample string `json:"bits_per_raw_sample"`
	BitsPerSample    int    `json:"bits_per_sample"`
	SampleFmt        string `json:"sample_fmt"`
	Channels         int    `json:"channels"`
	ChannelLayout    string `json:"channel_layout"`
	BitRate          string `json:"bit_rate"`
	Duration         string `json:"duration"`
}

type ffprobeFormatOutput struct {
	FormatName string `json:"format_name"`
	BitRate    string `json:"bit_rate"`
	Duration   string `json:"duration"`
	Size       string `json:"size"`
}

type ffprobeAudioOutput struct {
	Streams []ffprobeAudioStream `json:"streams"`
	Format  ffprobeFormatOutput  `json:"format"`
}

// TrackTechnicalMetadata contains parsed ffprobe-derived technical audio properties.
type TrackTechnicalMetadata struct {
	BitDepth        int
	SampleRate      int
	Codec           string
	CodecLong       string
	CodecProfile    string
	SampleFormat    string
	Channels        int
	ChannelLayout   string
	BitRate         int
	OverallBitRate  int
	DurationSeconds float64
	Container       string
	FileSizeBytes   int64
}

func bitDepthFromSampleFmt(sampleFmt string) int {
	switch strings.ToLower(strings.TrimSpace(sampleFmt)) {
	case "u8", "u8p":
		return 8
	case "s16", "s16p":
		return 16
	case "s24", "s24p":
		return 24
	case "s32", "s32p", "flt", "fltp":
		return 32
	case "dbl", "dblp":
		return 64
	default:
		return 0
	}
}

func parseIntValue(value string) int {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	parsed, err := strconv.Atoi(trimmed)
	if err != nil {
		return 0
	}

	return parsed
}

func parseInt64Value(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil {
		return 0
	}

	return parsed
}

func parseFloatValue(value string) float64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0
	}

	return parsed
}

func readTrackTechnicalMetadata(path string) TrackTechnicalMetadata {
	metadata := TrackTechnicalMetadata{}

	if fileInfo, statErr := os.Stat(path); statErr == nil && !fileInfo.IsDir() {
		metadata.FileSizeBytes = fileInfo.Size()
	}

	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		return metadata
	}

	command := exec.Command(
		ffprobePath,
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name,codec_long_name,profile,sample_rate,bits_per_raw_sample,bits_per_sample,sample_fmt,channels,channel_layout,bit_rate,duration:format=format_name,bit_rate,duration,size",
		"-of", "json",
		path,
	)

	rawOutput, err := command.Output()
	if err != nil {
		return metadata
	}

	var parsed ffprobeAudioOutput
	if err := json.Unmarshal(rawOutput, &parsed); err != nil {
		return metadata
	}

	metadata.Container = strings.TrimSpace(parsed.Format.FormatName)
	metadata.OverallBitRate = parseIntValue(parsed.Format.BitRate)
	metadata.DurationSeconds = parseFloatValue(parsed.Format.Duration)
	if metadata.FileSizeBytes == 0 {
		metadata.FileSizeBytes = parseInt64Value(parsed.Format.Size)
	}

	if len(parsed.Streams) == 0 {
		return metadata
	}

	stream := parsed.Streams[0]
	metadata.SampleRate = parseIntValue(stream.SampleRate)
	metadata.Codec = strings.ToUpper(strings.TrimSpace(stream.CodecName))
	metadata.CodecLong = strings.TrimSpace(stream.CodecLongName)
	metadata.CodecProfile = strings.TrimSpace(stream.Profile)
	metadata.SampleFormat = strings.TrimSpace(stream.SampleFmt)
	metadata.Channels = stream.Channels
	metadata.ChannelLayout = strings.TrimSpace(stream.ChannelLayout)
	metadata.BitRate = parseIntValue(stream.BitRate)

	bitDepth := 0
	if stream.BitsPerRawSample != "" {
		if parsedDepth, parseErr := strconv.Atoi(stream.BitsPerRawSample); parseErr == nil {
			bitDepth = parsedDepth
		}
	}
	if bitDepth == 0 {
		bitDepth = stream.BitsPerSample
	}
	if bitDepth == 0 {
		bitDepth = bitDepthFromSampleFmt(stream.SampleFmt)
	}
	metadata.BitDepth = bitDepth

	if metadata.DurationSeconds == 0 {
		metadata.DurationSeconds = parseFloatValue(stream.Duration)
	}

	return metadata
}

var mbidPattern = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`)

func extractArtistMBIDs(tags map[string][]string) []string {
	keys := []string{"MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id", "TXXX:MusicBrainz Artist Id"}
	unique := make(map[string]struct{})
	mbids := make([]string, 0)

	for _, targetKey := range keys {
		for key, values := range tags {
			if !strings.EqualFold(key, targetKey) {
				continue
			}

			for _, value := range values {
				for _, match := range mbidPattern.FindAllString(value, -1) {
					normalized := strings.ToLower(strings.TrimSpace(match))
					if normalized == "" {
						continue
					}

					if _, exists := unique[normalized]; exists {
						continue
					}

					unique[normalized] = struct{}{}
					mbids = append(mbids, normalized)
				}
			}
		}
	}

	return mbids
}

// ReadTrackTags reads tag and technical metadata for track files by path.
func (a *App) ReadTrackTags(paths []string) map[string]TrackTags {
	tagByPath := make(map[string]TrackTags, len(paths))

	for _, path := range paths {
		if strings.TrimSpace(path) == "" || !a.isAllowedLibraryPath(path) {
			continue
		}

		tags, err := taglib.ReadTags(path)
		if err != nil {
			continue
		}

		artist := firstTagValue(tags, "ARTIST", "ALBUMARTIST")
		album := firstTagValue(tags, "ALBUM")
		title := firstTagValue(tags, "TITLE")
		allTags := collectAllTags(tags)
		trackNumber, trackTotal := extractTrackNumbers(tags)
		artistIDs := extractArtistMBIDs(tags)
		technical := readTrackTechnicalMetadata(path)
		lyrics := firstTagValue(tags, "LYRICS")
		unsyncedLyrics := firstTagValue(tags, "UNSYNCEDLYRICS")

		if artist == "" && album == "" && title == "" && len(allTags) == 0 && trackNumber == "" && trackTotal == "" && technical.BitDepth == 0 && technical.SampleRate == 0 && technical.Codec == "" && technical.BitRate == 0 && technical.OverallBitRate == 0 && technical.DurationSeconds == 0 && technical.Container == "" && technical.FileSizeBytes == 0 && lyrics == "" && unsyncedLyrics == "" {
			continue
		}

		tagByPath[path] = TrackTags{
			Artist:         artist,
			Album:          album,
			Title:          title,
			AllTags:        allTags,
			Lyrics:         lyrics,
			UnsyncedLyrics: unsyncedLyrics,
			TrackNumber:    trackNumber,
			TrackTotal:     trackTotal,
			BitDepth:       technical.BitDepth,
			SampleRate:     technical.SampleRate,
			Codec:          technical.Codec,
			CodecLong:      technical.CodecLong,
			CodecProfile:   technical.CodecProfile,
			SampleFormat:   technical.SampleFormat,
			Channels:       technical.Channels,
			ChannelLayout:  technical.ChannelLayout,
			BitRate:        technical.BitRate,
			OverallBitRate: technical.OverallBitRate,
			DurationSecs:   technical.DurationSeconds,
			Container:      technical.Container,
			FileSizeBytes:  technical.FileSizeBytes,
			RecordingID:    firstTagValue(tags, "MUSICBRAINZ_TRACKID", "MusicBrainz Track Id"),
			ReleaseID:      firstTagValue(tags, "MUSICBRAINZ_ALBUMID", "MusicBrainz Album Id"),
			ArtistID:       firstTagValue(tags, "MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id"),
			ArtistIDs:      artistIDs,
		}
	}

	return tagByPath
}

// ReadTrackTagsFromBlobs reads tag and technical metadata from in-memory track blobs.
func (a *App) ReadTrackTagsFromBlobs(blobs []TrackBlob) map[string]TrackTags {
	tagByKey := make(map[string]TrackTags, len(blobs))

	for _, blob := range blobs {
		if strings.TrimSpace(blob.Key) == "" || strings.TrimSpace(blob.Data) == "" {
			continue
		}

		rawBytes, err := base64.StdEncoding.DecodeString(blob.Data)
		if err != nil {
			continue
		}

		extension := filepath.Ext(blob.Name)
		tempFile, err := os.CreateTemp("", "silphium-tag-*"+extension)
		if err != nil {
			continue
		}

		tempPath := tempFile.Name()
		_, writeErr := tempFile.Write(rawBytes)
		closeErr := tempFile.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(tempPath)
			continue
		}

		tags, err := taglib.ReadTags(tempPath)
		if err != nil {
			_ = os.Remove(tempPath)
			continue
		}

		artist := firstTagValue(tags, "ARTIST", "ALBUMARTIST")
		album := firstTagValue(tags, "ALBUM")
		title := firstTagValue(tags, "TITLE")
		allTags := collectAllTags(tags)
		trackNumber, trackTotal := extractTrackNumbers(tags)
		artistIDs := extractArtistMBIDs(tags)
		technical := readTrackTechnicalMetadata(tempPath)
		_ = os.Remove(tempPath)
		lyrics := firstTagValue(tags, "LYRICS")
		unsyncedLyrics := firstTagValue(tags, "UNSYNCEDLYRICS")

		if artist == "" && album == "" && title == "" && len(allTags) == 0 && trackNumber == "" && trackTotal == "" && technical.BitDepth == 0 && technical.SampleRate == 0 && technical.Codec == "" && technical.BitRate == 0 && technical.OverallBitRate == 0 && technical.DurationSeconds == 0 && technical.Container == "" && technical.FileSizeBytes == 0 && lyrics == "" && unsyncedLyrics == "" {
			continue
		}

		tagByKey[blob.Key] = TrackTags{
			Artist:         artist,
			Album:          album,
			Title:          title,
			AllTags:        allTags,
			Lyrics:         lyrics,
			UnsyncedLyrics: unsyncedLyrics,
			TrackNumber:    trackNumber,
			TrackTotal:     trackTotal,
			BitDepth:       technical.BitDepth,
			SampleRate:     technical.SampleRate,
			Codec:          technical.Codec,
			CodecLong:      technical.CodecLong,
			CodecProfile:   technical.CodecProfile,
			SampleFormat:   technical.SampleFormat,
			Channels:       technical.Channels,
			ChannelLayout:  technical.ChannelLayout,
			BitRate:        technical.BitRate,
			OverallBitRate: technical.OverallBitRate,
			DurationSecs:   technical.DurationSeconds,
			Container:      technical.Container,
			FileSizeBytes:  technical.FileSizeBytes,
			RecordingID:    firstTagValue(tags, "MUSICBRAINZ_TRACKID", "MusicBrainz Track Id"),
			ReleaseID:      firstTagValue(tags, "MUSICBRAINZ_ALBUMID", "MusicBrainz Album Id"),
			ArtistID:       firstTagValue(tags, "MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id"),
			ArtistIDs:      artistIDs,
		}
	}

	return tagByKey
}

// InitializeAudioBackend initializes the audio backend and returns its current state.
func (a *App) InitializeAudioBackend() (AudioPlaybackState, error) {
	backend := a.audioBackend()
	if err := backend.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	return backend.State(), nil
}

// AudioLoadTrack loads a track path into the audio backend.
func (a *App) AudioLoadTrack(path string) (AudioPlaybackState, error) {
	cleanPath := normalizePath(path)
	if cleanPath == "" {
		return AudioPlaybackState{}, errors.New("track path is required")
	}

	if !a.isAllowedLibraryPath(cleanPath) {
		return AudioPlaybackState{}, errors.New("track path is outside the selected library")
	}

	return a.audioBackend().LoadTrack(cleanPath)
}

// AudioPlay starts playback of the currently loaded track.
func (a *App) AudioPlay() (AudioPlaybackState, error) {
	return a.audioBackend().Play()
}

// AudioPause pauses playback of the currently loaded track.
func (a *App) AudioPause() (AudioPlaybackState, error) {
	return a.audioBackend().Pause()
}

// AudioStop stops playback and unloads the current track.
func (a *App) AudioStop() (AudioPlaybackState, error) {
	return a.audioBackend().Stop()
}

// AudioSeek moves playback to the given position in seconds.
func (a *App) AudioSeek(seconds float64) (AudioPlaybackState, error) {
	return a.audioBackend().Seek(seconds)
}

// AudioSetVolume sets playback volume in the range [0, 1].
func (a *App) AudioSetVolume(volume float64) (AudioPlaybackState, error) {
	return a.audioBackend().SetVolume(volume)
}

// AudioGetState returns the current audio playback state.
func (a *App) AudioGetState() AudioPlaybackState {
	return a.audioBackend().State()
}
