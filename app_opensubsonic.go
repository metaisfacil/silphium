package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/md5"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"math/rand"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	pathpkg "path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	defaultOpenSubsonicPort                = 4040
	openSubsonicRESTPrefix                 = "/rest/"
	openSubsonicAPIVersion                 = "1.16.1"
	openSubsonicExtensionVersion           = 1
	openSubsonicExtensionAPIKeyAuth        = "apiKeyAuthentication"
	openSubsonicExtensionFormPost          = "formPost"
	openSubsonicIDKindMusicFolder          = "mf"
	openSubsonicIDKindDirectory            = "dir"
	openSubsonicIDKindArtist               = "artist"
	openSubsonicIDKindAlbum                = "album"
	openSubsonicIDKindSong                 = "song"
	openSubsonicIDKindPlaylist             = "playlist"
	openSubsonicIDKindFolderCover          = "cover-folder"
	openSubsonicIDKindTrackCover           = "cover-track"
	openSubsonicAuthHelpURL                = ""
	openSubsonicMaxListLimit               = 1 << 20
	openSubsonicErrorGeneric               = 0
	openSubsonicErrorMissingParameter      = 10
	openSubsonicErrorClientMustUpgrade     = 20
	openSubsonicErrorServerMustUpgrade     = 30
	openSubsonicErrorWrongUsernamePassword = 40
	openSubsonicErrorAuthUnsupported       = 42
	openSubsonicErrorConflictingAuth       = 43
	openSubsonicErrorInvalidAPIKey         = 44
	openSubsonicErrorUnauthorized          = 50
	openSubsonicErrorNotFound              = 70
	openSubsonicMediaTypeMusic             = "music"
	openSubsonicMediaTypeSong              = "song"
)

type openSubsonicEnvelope struct {
	Response openSubsonicResponse `json:"subsonic-response"`
}

type openSubsonicXMLEnvelope struct {
	XMLName xml.Name `xml:"subsonic-response"`
	XMLNS   string   `xml:"xmlns,attr"`
	openSubsonicResponse
}

type openSubsonicResponse struct {
	Status                 string                     `json:"status" xml:"status,attr"`
	Version                string                     `json:"version" xml:"version,attr"`
	Type                   string                     `json:"type" xml:"type,attr"`
	ServerVersion          string                     `json:"serverVersion" xml:"serverVersion,attr"`
	OpenSubsonic           bool                       `json:"openSubsonic" xml:"openSubsonic,attr"`
	Error                  *openSubsonicError         `json:"error,omitempty" xml:"error,omitempty"`
	Lyrics                 *openSubsonicLyrics        `json:"lyrics,omitempty" xml:"lyrics,omitempty"`
	MusicFolders           *openSubsonicMusicFolders  `json:"musicFolders,omitempty" xml:"musicFolders,omitempty"`
	Genres                 *openSubsonicGenres        `json:"genres,omitempty" xml:"genres,omitempty"`
	Indexes                *openSubsonicIndexes       `json:"indexes,omitempty" xml:"indexes,omitempty"`
	Artists                *openSubsonicArtists       `json:"artists,omitempty" xml:"artists,omitempty"`
	Directory              *openSubsonicDirectory     `json:"directory,omitempty" xml:"directory,omitempty"`
	Artist                 *openSubsonicArtist        `json:"artist,omitempty" xml:"artist,omitempty"`
	Album                  *openSubsonicAlbumDetails  `json:"album,omitempty" xml:"album,omitempty"`
	Playlist               *openSubsonicPlaylist      `json:"playlist,omitempty" xml:"playlist,omitempty"`
	Song                   *openSubsonicChild         `json:"song,omitempty" xml:"song,omitempty"`
	SearchResult           *openSubsonicSearchResult  `json:"searchResult,omitempty" xml:"searchResult,omitempty"`
	SearchResult2          *openSubsonicSearchResult2 `json:"searchResult2,omitempty" xml:"searchResult2,omitempty"`
	SearchResult3          *openSubsonicSearchResult3 `json:"searchResult3,omitempty" xml:"searchResult3,omitempty"`
	SimilarSongs           *openSubsonicSimilarSongs  `json:"similarSongs,omitempty" xml:"similarSongs,omitempty"`
	User                   *openSubsonicUser          `json:"user,omitempty" xml:"user,omitempty"`
	AlbumList2             *openSubsonicAlbumList2    `json:"albumList2,omitempty" xml:"albumList2,omitempty"`
	Playlists              *openSubsonicPlaylists     `json:"playlists,omitempty" xml:"playlists,omitempty"`
	ScanStatus             *openSubsonicScanStatus    `json:"scanStatus,omitempty" xml:"scanStatus,omitempty"`
	RandomSongs            *openSubsonicRandomSongs   `json:"randomSongs,omitempty" xml:"randomSongs,omitempty"`
	License                *openSubsonicLicense       `json:"license,omitempty" xml:"license,omitempty"`
	OpenSubsonicExtensions []openSubsonicExtension    `json:"openSubsonicExtensions,omitempty" xml:"openSubsonicExtensions>openSubsonicExtension,omitempty"`
}

type openSubsonicError struct {
	Code    int    `json:"code" xml:"code,attr"`
	Message string `json:"message,omitempty" xml:"message,attr,omitempty"`
	HelpURL string `json:"helpUrl,omitempty" xml:"helpUrl,attr,omitempty"`
}

type openSubsonicLyrics struct {
	Artist string `json:"artist,omitempty" xml:"artist,attr,omitempty"`
	Title  string `json:"title,omitempty" xml:"title,attr,omitempty"`
	Value  string `json:"value" xml:",chardata"`
}

type openSubsonicExtension struct {
	Name     string `json:"name" xml:"name,attr"`
	Versions []int  `json:"versions" xml:"versions>int"`
}

type openSubsonicMusicFolders struct {
	MusicFolder []openSubsonicMusicFolder `json:"musicFolder" xml:"musicFolder"`
}

type openSubsonicMusicFolder struct {
	ID   string `json:"id" xml:"id,attr"`
	Name string `json:"name" xml:"name,attr"`
}

type openSubsonicGenres struct {
	Genre []openSubsonicGenre `json:"genre,omitempty" xml:"genre,omitempty"`
}

type openSubsonicGenre struct {
	Name       string `json:"value,omitempty" xml:",chardata"`
	SongCount  int    `json:"songCount" xml:"songCount,attr"`
	AlbumCount int    `json:"albumCount" xml:"albumCount,attr"`
}

type openSubsonicIndexes struct {
	Shortcut        []openSubsonicArtistRef `json:"shortcut,omitempty" xml:"shortcut,omitempty"`
	Index           []openSubsonicIndex     `json:"index,omitempty" xml:"index,omitempty"`
	Child           []openSubsonicChild     `json:"child,omitempty" xml:"child,omitempty"`
	LastModified    int64                   `json:"lastModified,omitempty" xml:"lastModified,attr,omitempty"`
	IgnoredArticles string                  `json:"ignoredArticles,omitempty" xml:"ignoredArticles,attr,omitempty"`
}

type openSubsonicIndex struct {
	Name   string                  `json:"name" xml:"name,attr"`
	Artist []openSubsonicArtistRef `json:"artist,omitempty" xml:"artist,omitempty"`
}

type openSubsonicArtistRef struct {
	ID   string `json:"id" xml:"id,attr"`
	Name string `json:"name" xml:"name,attr"`
}

type openSubsonicArtists struct {
	Index []openSubsonicIndex `json:"index,omitempty" xml:"index,omitempty"`
}

type openSubsonicDirectory struct {
	ID     string              `json:"id" xml:"id,attr"`
	Parent string              `json:"parent,omitempty" xml:"parent,attr,omitempty"`
	Name   string              `json:"name" xml:"name,attr"`
	Child  []openSubsonicChild `json:"child,omitempty" xml:"child,omitempty"`
}

type openSubsonicSearchResult struct {
	Offset    int                 `json:"offset,omitempty" xml:"offset,attr,omitempty"`
	TotalHits int                 `json:"totalHits,omitempty" xml:"totalHits,attr,omitempty"`
	Match     []openSubsonicChild `json:"match,omitempty" xml:"match,omitempty"`
}

type openSubsonicSearchResult2 struct {
	Artist []openSubsonicArtist `json:"artist,omitempty" xml:"artist,omitempty"`
	Album  []openSubsonicAlbum  `json:"album,omitempty" xml:"album,omitempty"`
	Song   []openSubsonicChild  `json:"song,omitempty" xml:"song,omitempty"`
}

type openSubsonicSearchResult3 struct {
	Artist []openSubsonicArtist `json:"artist,omitempty" xml:"artist,omitempty"`
	Album  []openSubsonicAlbum  `json:"album,omitempty" xml:"album,omitempty"`
	Song   []openSubsonicChild  `json:"song,omitempty" xml:"song,omitempty"`
}

type openSubsonicChild struct {
	ID            string `json:"id" xml:"id,attr"`
	Parent        string `json:"parent,omitempty" xml:"parent,attr,omitempty"`
	IsDir         bool   `json:"isDir" xml:"isDir,attr"`
	Title         string `json:"title" xml:"title,attr"`
	Album         string `json:"album,omitempty" xml:"album,attr,omitempty"`
	Artist        string `json:"artist,omitempty" xml:"artist,attr,omitempty"`
	Track         int    `json:"track,omitempty" xml:"track,attr,omitempty"`
	Year          int    `json:"year,omitempty" xml:"year,attr,omitempty"`
	Genre         string `json:"genre,omitempty" xml:"genre,attr,omitempty"`
	CoverArt      string `json:"coverArt,omitempty" xml:"coverArt,attr,omitempty"`
	Size          int64  `json:"size,omitempty" xml:"size,attr,omitempty"`
	ContentType   string `json:"contentType,omitempty" xml:"contentType,attr,omitempty"`
	Suffix        string `json:"suffix,omitempty" xml:"suffix,attr,omitempty"`
	Duration      int    `json:"duration,omitempty" xml:"duration,attr,omitempty"`
	BitRate       int    `json:"bitRate,omitempty" xml:"bitRate,attr,omitempty"`
	BitDepth      int    `json:"bitDepth,omitempty" xml:"bitDepth,attr,omitempty"`
	SamplingRate  int    `json:"samplingRate,omitempty" xml:"samplingRate,attr,omitempty"`
	ChannelCount  int    `json:"channelCount,omitempty" xml:"channelCount,attr,omitempty"`
	Path          string `json:"path,omitempty" xml:"path,attr,omitempty"`
	Created       string `json:"created,omitempty" xml:"created,attr,omitempty"`
	AlbumID       string `json:"albumId,omitempty" xml:"albumId,attr,omitempty"`
	ArtistID      string `json:"artistId,omitempty" xml:"artistId,attr,omitempty"`
	Type          string `json:"type,omitempty" xml:"type,attr,omitempty"`
	MediaType     string `json:"mediaType,omitempty" xml:"mediaType,attr,omitempty"`
	MusicBrainzID string `json:"musicBrainzId,omitempty" xml:"musicBrainzId,attr,omitempty"`
}

type openSubsonicLicense struct {
	Valid bool `json:"valid" xml:"valid,attr"`
}

type openSubsonicUser struct {
	Username            string `json:"username" xml:"username,attr"`
	Email               string `json:"email,omitempty" xml:"email,attr,omitempty"`
	ScrobblingEnabled   bool   `json:"scrobblingEnabled" xml:"scrobblingEnabled,attr"`
	AdminRole           bool   `json:"adminRole" xml:"adminRole,attr"`
	SettingsRole        bool   `json:"settingsRole" xml:"settingsRole,attr"`
	DownloadRole        bool   `json:"downloadRole" xml:"downloadRole,attr"`
	UploadRole          bool   `json:"uploadRole" xml:"uploadRole,attr"`
	PlaylistRole        bool   `json:"playlistRole" xml:"playlistRole,attr"`
	CoverArtRole        bool   `json:"coverArtRole" xml:"coverArtRole,attr"`
	CommentRole         bool   `json:"commentRole" xml:"commentRole,attr"`
	PodcastRole         bool   `json:"podcastRole" xml:"podcastRole,attr"`
	StreamRole          bool   `json:"streamRole" xml:"streamRole,attr"`
	JukeboxRole         bool   `json:"jukeboxRole" xml:"jukeboxRole,attr"`
	ShareRole           bool   `json:"shareRole" xml:"shareRole,attr"`
	VideoConversionRole bool   `json:"videoConversionRole" xml:"videoConversionRole,attr"`
}

type openSubsonicAlbumList2 struct {
	Album []openSubsonicAlbum `json:"album,omitempty" xml:"album,omitempty"`
}

type openSubsonicAlbum struct {
	ID        string `json:"id" xml:"id,attr"`
	Parent    string `json:"parent,omitempty" xml:"parent,attr,omitempty"`
	IsDir     bool   `json:"isDir" xml:"isDir,attr"`
	Title     string `json:"title" xml:"title,attr"`
	Name      string `json:"name" xml:"name,attr"`
	Album     string `json:"album,omitempty" xml:"album,attr,omitempty"`
	Artist    string `json:"artist,omitempty" xml:"artist,attr,omitempty"`
	ArtistID  string `json:"artistId,omitempty" xml:"artistId,attr,omitempty"`
	CoverArt  string `json:"coverArt,omitempty" xml:"coverArt,attr,omitempty"`
	Created   string `json:"created,omitempty" xml:"created,attr,omitempty"`
	Year      int    `json:"year,omitempty" xml:"year,attr,omitempty"`
	Genre     string `json:"genre,omitempty" xml:"genre,attr,omitempty"`
	Duration  int    `json:"duration,omitempty" xml:"duration,attr,omitempty"`
	SongCount int    `json:"songCount,omitempty" xml:"songCount,attr,omitempty"`
}

type openSubsonicArtist struct {
	ID         string              `json:"id" xml:"id,attr"`
	Name       string              `json:"name" xml:"name,attr"`
	CoverArt   string              `json:"coverArt,omitempty" xml:"coverArt,attr,omitempty"`
	AlbumCount int                 `json:"albumCount,omitempty" xml:"albumCount,attr,omitempty"`
	Album      []openSubsonicAlbum `json:"album,omitempty" xml:"album,omitempty"`
}

type openSubsonicAlbumDetails struct {
	ID        string              `json:"id" xml:"id,attr"`
	Parent    string              `json:"parent,omitempty" xml:"parent,attr,omitempty"`
	IsDir     bool                `json:"isDir" xml:"isDir,attr"`
	Title     string              `json:"title" xml:"title,attr"`
	Name      string              `json:"name" xml:"name,attr"`
	Album     string              `json:"album,omitempty" xml:"album,attr,omitempty"`
	Artist    string              `json:"artist,omitempty" xml:"artist,attr,omitempty"`
	ArtistID  string              `json:"artistId,omitempty" xml:"artistId,attr,omitempty"`
	CoverArt  string              `json:"coverArt,omitempty" xml:"coverArt,attr,omitempty"`
	Created   string              `json:"created,omitempty" xml:"created,attr,omitempty"`
	Year      int                 `json:"year,omitempty" xml:"year,attr,omitempty"`
	Genre     string              `json:"genre,omitempty" xml:"genre,attr,omitempty"`
	Duration  int                 `json:"duration,omitempty" xml:"duration,attr,omitempty"`
	SongCount int                 `json:"songCount,omitempty" xml:"songCount,attr,omitempty"`
	Song      []openSubsonicChild `json:"song,omitempty" xml:"song,omitempty"`
}

type openSubsonicPlaylists struct {
	Playlist []openSubsonicPlaylist `json:"playlist,omitempty" xml:"playlist,omitempty"`
}

type openSubsonicPlaylist struct {
	ID        string              `json:"id" xml:"id,attr"`
	Name      string              `json:"name" xml:"name,attr"`
	SongCount int                 `json:"songCount,omitempty" xml:"songCount,attr,omitempty"`
	Duration  int                 `json:"duration,omitempty" xml:"duration,attr,omitempty"`
	Created   string              `json:"created,omitempty" xml:"created,attr,omitempty"`
	Entry     []openSubsonicChild `json:"entry,omitempty" xml:"entry,omitempty"`
}

type openSubsonicScanStatus struct {
	Scanning bool `json:"scanning" xml:"scanning,attr"`
	Count    int  `json:"count,omitempty" xml:"count,attr,omitempty"`
}

type openSubsonicRandomSongs struct {
	Song []openSubsonicChild `json:"song,omitempty" xml:"song,omitempty"`
}

type openSubsonicSimilarSongs struct {
	Song []openSubsonicChild `json:"song" xml:"song,omitempty"`
}

type openSubsonicIndexedTrackSnapshot struct {
	Root  libraryRootConfig
	Track LibraryIndexedFile
}

type openSubsonicAlbumSnapshot struct {
	Album      openSubsonicAlbum
	ModifiedAt int64
	Root       libraryRootConfig
	FolderPath string
	ArtistKey  string
	ArtistName string
	Tracks     []openSubsonicTrackMetadataSnapshot
}

type openSubsonicTrackMetadataSnapshot struct {
	Root   libraryRootConfig
	Track  LibraryIndexedFile
	Record musicBrainzTagTrackRecord
}

type openSubsonicArtistSnapshot struct {
	Artist     openSubsonicArtist
	ModifiedAt int64
	Root       libraryRootConfig
	FolderPath string
	Albums     []openSubsonicAlbumSnapshot
}

type openSubsonicLibrarySnapshot struct {
	LibraryVersion uint64
	Roots          []libraryRootConfig
	RootsByName    map[string]libraryRootConfig
	Tracks         []openSubsonicIndexedTrackSnapshot
	CoverFolders   map[string]struct{}
}

type openSubsonicTrackRecordsSnapshot struct {
	Version uint64
	ByPath  map[string]musicBrainzTagTrackRecord
}

type openSubsonicAlbumListLibrarySnapshot struct {
	LibraryVersion uint64
	Folders        []openSubsonicAlbumListFolderSnapshot
	CoverFolders   map[string]struct{}
}

type openSubsonicAlbumListFolderSnapshot struct {
	Root                libraryRootConfig
	FolderPath          string
	RepresentativeTrack LibraryIndexedFile
	TrackCount          int
	ModifiedAt          int64
}

type openSubsonicAlbumListEntry struct {
	Album      openSubsonicAlbum
	ModifiedAt int64
	RootName   string
}

type openSubsonicAlbumListIndex struct {
	LibraryVersion     uint64
	MusicBrainzVersion uint64
	AlbumsNewest       []openSubsonicAlbumListEntry
	AlbumsAlphabetical []openSubsonicAlbumListEntry
}

type openSubsonicBrowseIndex struct {
	LibraryVersion     uint64
	MusicBrainzVersion uint64
	Roots              []libraryRootConfig
	RootsByName        map[string]libraryRootConfig
	CoverFolders       map[string]struct{}
	Tracks             []openSubsonicTrackMetadataSnapshot
	TracksBySongID     map[string]openSubsonicTrackMetadataSnapshot
	TracksByFolder     map[string][]openSubsonicTrackMetadataSnapshot
	Albums             []openSubsonicAlbumSnapshot
	AlbumsByID         map[string]openSubsonicAlbumSnapshot
	AlbumByFolder      map[string]openSubsonicAlbumSnapshot
	Artists            []openSubsonicArtistSnapshot
	ArtistsByID        map[string]openSubsonicArtistSnapshot
	ArtistByFolder     map[string]openSubsonicArtistSnapshot
}

type openSubsonicStreamOptions struct {
	RequiresTranscode bool
	Format            string
	BitrateKbps       int
	TimeOffsetSeconds float64
}

type openSubsonicLoggingResponseWriter struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int64
}

func (w *openSubsonicLoggingResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *openSubsonicLoggingResponseWriter) Write(payload []byte) (int, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}
	written, err := w.ResponseWriter.Write(payload)
	w.bytesWritten += int64(written)
	return written, err
}

func (w *openSubsonicLoggingResponseWriter) StatusCode() int {
	if w.statusCode == 0 {
		return http.StatusOK
	}
	return w.statusCode
}

func (w *openSubsonicLoggingResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		if w.statusCode == 0 {
			w.statusCode = http.StatusOK
		}
		flusher.Flush()
	}
}

func (w *openSubsonicLoggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}

	return hijacker.Hijack()
}

func (w *openSubsonicLoggingResponseWriter) Push(target string, opts *http.PushOptions) error {
	pusher, ok := w.ResponseWriter.(http.Pusher)
	if !ok {
		return http.ErrNotSupported
	}

	return pusher.Push(target, opts)
}

func (w *openSubsonicLoggingResponseWriter) ReadFrom(reader io.Reader) (int64, error) {
	if w.statusCode == 0 {
		w.statusCode = http.StatusOK
	}

	if readerFrom, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		readCount, err := readerFrom.ReadFrom(reader)
		w.bytesWritten += readCount
		return readCount, err
	}

	readCount, err := io.Copy(w.ResponseWriter, reader)
	w.bytesWritten += readCount
	return readCount, err
}

func normalizeOpenSubsonicPort(value int) int {
	if value <= 0 || value > 65535 {
		return defaultOpenSubsonicPort
	}

	return value
}

func logOpenSubsonicEvent(message string, args ...interface{}) {
	timestamp := time.Now().Format("2006-01-02 15:04:05.000")
	formattedMessage := fmt.Sprintf(message, args...)
	log.Printf("[%s] opensubsonic %s", timestamp, formattedMessage)
}

func openSubsonicSanitizedQuery(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	return values.Encode()
}

func openSubsonicLoggableRequestValues(r *http.Request) url.Values {
	if r == nil {
		return nil
	}
	if err := r.ParseForm(); err != nil {
		return r.URL.Query()
	}
	return r.Form
}

func (a *App) openSubsonicAPIKeyHash() string {
	a.ensureSettingsLoaded()
	return strings.TrimSpace(a.settings.OpenSubsonicAPIKeyHash)
}

func (a *App) syncOpenSubsonicServer() {
	a.ensureSettingsLoaded()
	enabled := a.settings.OpenSubsonicEnabled
	port := normalizeOpenSubsonicPort(a.settings.OpenSubsonicPort)
	addr := fmt.Sprintf(":%d", port)

	a.openSubsonicMu.Lock()
	defer a.openSubsonicMu.Unlock()

	if !enabled {
		a.stopOpenSubsonicServerLocked()
		return
	}

	if a.openSubsonicServer != nil && a.openSubsonicServer.Addr == addr {
		return
	}

	a.stopOpenSubsonicServerLocked()

	server := &http.Server{
		Addr:              addr,
		Handler:           a.newOpenSubsonicServeMux(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	a.openSubsonicServer = server

	go func(activeServer *http.Server, activeAddr string) {
		logOpenSubsonicEvent("server listen requested addr=%s", activeAddr)
		if err := activeServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("OpenSubsonic server failed on %s: %v", activeAddr, err)
			a.openSubsonicMu.Lock()
			if a.openSubsonicServer == activeServer {
				a.openSubsonicServer = nil
			}
			a.openSubsonicMu.Unlock()
		}
	}(server, addr)
}

func (a *App) stopOpenSubsonicServerLocked() {
	server := a.openSubsonicServer
	a.openSubsonicServer = nil
	if server == nil {
		return
	}

	logOpenSubsonicEvent("server stop requested addr=%s", server.Addr)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("failed to stop OpenSubsonic server: %v", err)
		return
	}
	logOpenSubsonicEvent("server stop complete addr=%s", server.Addr)
}

func (a *App) stopOpenSubsonicServer() {
	a.openSubsonicMu.Lock()
	defer a.openSubsonicMu.Unlock()
	a.stopOpenSubsonicServerLocked()
}

func (a *App) newOpenSubsonicServeMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc(openSubsonicRESTPrefix, a.handleOpenSubsonicREST)
	return mux
}

func newOpenSubsonicBaseResponse() openSubsonicResponse {
	return openSubsonicResponse{
		Status:        "ok",
		Version:       openSubsonicAPIVersion,
		Type:          "Silphium",
		ServerVersion: AppVersion,
		OpenSubsonic:  true,
	}
}

func openSubsonicFormatFromRequest(r *http.Request) string {
	if r == nil {
		return "xml"
	}
	format := strings.ToLower(strings.TrimSpace(openSubsonicLoggableRequestValues(r).Get("f")))
	if format == "json" {
		return "json"
	}
	return "xml"
}

func writeOpenSubsonicResponse(w http.ResponseWriter, r *http.Request, response openSubsonicResponse) {
	if openSubsonicFormatFromRequest(r) == "json" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(openSubsonicEnvelope{Response: response})
		return
	}

	w.Header().Set("Content-Type", "application/xml")
	_, _ = w.Write([]byte(xml.Header))
	xmlResponse := openSubsonicXMLEnvelope{
		XMLNS:                "http://subsonic.org/restapi",
		openSubsonicResponse: response,
	}
	_ = xml.NewEncoder(w).Encode(xmlResponse)
}

func writeOpenSubsonicError(w http.ResponseWriter, r *http.Request, code int, message string, helpURL string) {
	response := newOpenSubsonicBaseResponse()
	response.Status = "failed"
	response.Error = &openSubsonicError{
		Code:    code,
		Message: strings.TrimSpace(message),
		HelpURL: strings.TrimSpace(helpURL),
	}
	writeOpenSubsonicResponse(w, r, response)
}

func openSubsonicRequestValues(r *http.Request) (url.Values, error) {
	if err := r.ParseForm(); err != nil {
		return nil, err
	}

	return r.Form, nil
}

func openSubsonicVersionCompare(left string, right string) int {
	parse := func(value string) [3]int {
		parts := strings.Split(strings.TrimSpace(value), ".")
		parsed := [3]int{}
		for index := range parsed {
			if index >= len(parts) {
				break
			}
			parsed[index], _ = strconv.Atoi(strings.TrimSpace(parts[index]))
		}
		return parsed
	}

	leftParts := parse(left)
	rightParts := parse(right)
	for index := range leftParts {
		if leftParts[index] < rightParts[index] {
			return -1
		}
		if leftParts[index] > rightParts[index] {
			return 1
		}
	}

	return 0
}

func openSubsonicClientNameFromUserAgent(userAgent string) string {
	trimmed := strings.TrimSpace(userAgent)
	if trimmed == "" {
		return "UnknownClient"
	}

	fields := strings.Fields(trimmed)
	client := trimmed
	if len(fields) > 0 {
		client = strings.TrimSpace(fields[0])
	}
	if slashIndex := strings.Index(client, "/"); slashIndex > 0 {
		client = client[:slashIndex]
	}
	client = strings.TrimSpace(client)
	if client == "" {
		return "UnknownClient"
	}

	return client
}

func normalizeOpenSubsonicCommonParams(values url.Values, userAgent string) {
	if strings.TrimSpace(values.Get("v")) == "" {
		values.Set("v", openSubsonicAPIVersion)
	}
	if strings.TrimSpace(values.Get("c")) == "" {
		values.Set("c", openSubsonicClientNameFromUserAgent(userAgent))
	}
}

func validateOpenSubsonicCommonParams(values url.Values) *openSubsonicError {
	version := strings.TrimSpace(values.Get("v"))
	if version == "" {
		return &openSubsonicError{Code: openSubsonicErrorMissingParameter, Message: "required parameter is missing: v"}
	}
	if strings.TrimSpace(values.Get("c")) == "" {
		return &openSubsonicError{Code: openSubsonicErrorMissingParameter, Message: "required parameter is missing: c"}
	}
	if openSubsonicVersionCompare(version, openSubsonicAPIVersion) > 0 {
		return &openSubsonicError{Code: openSubsonicErrorServerMustUpgrade, Message: "incompatible Subsonic REST protocol version"}
	}

	return nil
}

func openSubsonicDecodePassword(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", false
	}
	if !strings.HasPrefix(trimmed, "enc:") {
		return trimmed, true
	}

	encoded := strings.TrimSpace(strings.TrimPrefix(trimmed, "enc:"))
	if encoded == "" {
		return "", false
	}

	decoded, err := hex.DecodeString(encoded)
	if err != nil {
		return "", false
	}
	return string(decoded), true
}

func openSubsonicExpectedToken(secret string, salt string) string {
	sum := md5.Sum([]byte(secret + salt))
	return hex.EncodeToString(sum[:])
}

func (a *App) openSubsonicAuthSecret() string {
	a.ensureSettingsLoaded()
	if plaintext := strings.TrimSpace(a.settings.OpenSubsonicAPIKey); plaintext != "" {
		return plaintext
	}
	return strings.TrimSpace(a.settings.OpenSubsonicAPIKeyHash)
}

func (a *App) openSubsonicPasswordMatches(candidate string) bool {
	a.ensureSettingsLoaded()

	if expectedPlaintext := strings.TrimSpace(a.settings.OpenSubsonicAPIKey); expectedPlaintext != "" {
		if subtle.ConstantTimeCompare([]byte(expectedPlaintext), []byte(candidate)) == 1 {
			return true
		}
	}

	expectedHash := a.openSubsonicAPIKeyHash()
	if expectedHash == "" {
		return false
	}

	providedHash := hashNetworkPassword(candidate)
	return subtle.ConstantTimeCompare([]byte(expectedHash), []byte(providedHash)) == 1
}

func (a *App) authenticateOpenSubsonic(values url.Values) *openSubsonicError {
	apiKey := strings.TrimSpace(values.Get("apiKey"))
	username := strings.TrimSpace(values.Get("u"))
	password := strings.TrimSpace(values.Get("p"))
	token := strings.TrimSpace(values.Get("t"))
	salt := strings.TrimSpace(values.Get("s"))

	hasAPIKey := apiKey != ""
	hasUsername := username != ""
	hasPasswordAuth := password != ""
	hasTokenAuth := token != "" || salt != ""
	hasUsernamePasswordAuth := hasPasswordAuth

	mechanismCount := 0
	if hasAPIKey {
		mechanismCount++
	}
	if hasUsernamePasswordAuth {
		mechanismCount++
	}
	if hasTokenAuth {
		mechanismCount++
	}
	if mechanismCount > 1 {
		return &openSubsonicError{
			Code:    openSubsonicErrorConflictingAuth,
			Message: "multiple conflicting authentication mechanisms provided",
		}
	}

	if hasAPIKey {
		expectedHash := a.openSubsonicAPIKeyHash()
		if expectedHash == "" {
			return &openSubsonicError{
				Code:    openSubsonicErrorAuthUnsupported,
				Message: "authentication mechanism not supported. Use API keys",
				HelpURL: openSubsonicAuthHelpURL,
			}
		}
		providedHash := hashNetworkPassword(apiKey)
		if subtle.ConstantTimeCompare([]byte(expectedHash), []byte(providedHash)) != 1 {
			return &openSubsonicError{Code: openSubsonicErrorInvalidAPIKey, Message: "invalid API key"}
		}
		return nil
	}

	if hasUsernamePasswordAuth {
		expectedHash := a.openSubsonicAPIKeyHash()
		if expectedHash == "" {
			return &openSubsonicError{
				Code:    openSubsonicErrorAuthUnsupported,
				Message: "authentication mechanism not configured. Set an OpenSubsonic API key in settings first",
				HelpURL: openSubsonicAuthHelpURL,
			}
		}
		if !hasUsername {
			return &openSubsonicError{Code: openSubsonicErrorWrongUsernamePassword, Message: "wrong username or password"}
		}
		decodedPassword, ok := openSubsonicDecodePassword(password)
		if !ok {
			return &openSubsonicError{Code: openSubsonicErrorWrongUsernamePassword, Message: "wrong username or password"}
		}
		if !a.openSubsonicPasswordMatches(decodedPassword) {
			return &openSubsonicError{Code: openSubsonicErrorWrongUsernamePassword, Message: "wrong username or password"}
		}
		return nil
	}

	if hasTokenAuth {
		secret := strings.TrimSpace(a.openSubsonicAuthSecret())
		if secret == "" {
			return &openSubsonicError{
				Code:    openSubsonicErrorAuthUnsupported,
				Message: "authentication mechanism not configured. Set an OpenSubsonic API key in settings first",
				HelpURL: openSubsonicAuthHelpURL,
			}
		}
		if !hasUsername || token == "" || salt == "" {
			return &openSubsonicError{Code: openSubsonicErrorWrongUsernamePassword, Message: "wrong username or password"}
		}

		expectedToken := openSubsonicExpectedToken(secret, salt)
		if subtle.ConstantTimeCompare([]byte(strings.ToLower(strings.TrimSpace(token))), []byte(expectedToken)) != 1 {
			return &openSubsonicError{Code: openSubsonicErrorWrongUsernamePassword, Message: "wrong username or password"}
		}
		return nil
	}

	return &openSubsonicError{
		Code:    openSubsonicErrorAuthUnsupported,
		Message: "authentication mechanism not supported. Use API keys or username/password",
		HelpURL: openSubsonicAuthHelpURL,
	}
}

func openSubsonicEncodeID(kind string, value string) string {
	if strings.TrimSpace(kind) == "" || strings.TrimSpace(value) == "" {
		return ""
	}

	return kind + ":" + base64.RawURLEncoding.EncodeToString([]byte(value))
}

func openSubsonicDecodeID(id string, expectedKind string) (string, bool) {
	kind, encoded, ok := strings.Cut(strings.TrimSpace(id), ":")
	if !ok || kind != expectedKind || strings.TrimSpace(encoded) == "" {
		return "", false
	}

	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", false
	}

	return string(decoded), true
}

func openSubsonicMusicFolderID(rootName string) string {
	return openSubsonicEncodeID(openSubsonicIDKindMusicFolder, rootName)
}

func openSubsonicDirectoryID(folderPath string) string {
	return openSubsonicEncodeID(openSubsonicIDKindDirectory, folderPath)
}

func openSubsonicArtistID(artistKey string) string {
	return openSubsonicEncodeID(openSubsonicIDKindArtist, artistKey)
}

func openSubsonicAlbumID(albumKey string) string {
	return openSubsonicEncodeID(openSubsonicIDKindAlbum, albumKey)
}

func openSubsonicSongID(virtualPath string) string {
	return openSubsonicEncodeID(openSubsonicIDKindSong, virtualPath)
}

func openSubsonicPlaylistID(playlistPath string) string {
	return openSubsonicEncodeID(openSubsonicIDKindPlaylist, normalizePath(playlistPath))
}

func openSubsonicFolderCoverID(folderPath string) string {
	return openSubsonicEncodeID(openSubsonicIDKindFolderCover, folderPath)
}

func openSubsonicTrackCoverID(virtualPath string) string {
	return openSubsonicEncodeID(openSubsonicIDKindTrackCover, virtualPath)
}

func openSubsonicNormalizedLookupKey(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func openSubsonicDecodeIDWithAliases(id string, expectedKinds ...string) (string, string, bool) {
	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return "", "", false
	}

	candidates := []string{trimmedID}
	if strings.HasPrefix(trimmedID, "al-") {
		candidates = append(candidates, strings.TrimPrefix(trimmedID, "al-"))
	}

	for _, candidate := range candidates {
		for _, expectedKind := range expectedKinds {
			if decoded, ok := openSubsonicDecodeID(candidate, expectedKind); ok {
				return decoded, expectedKind, true
			}
		}
	}

	return "", "", false
}

func (a *App) openSubsonicLibraryVersion() uint64 {
	contentState := a.libraryContentState()
	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	return a.libraryIndexState().libraryDerivedIndexGeneration
}

func (a *App) openSubsonicLocalRootsSnapshot() []libraryRootConfig {
	contentState := a.libraryContentState()
	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	roots := make([]libraryRootConfig, 0, len(contentState.activeLibraryRoots))
	for _, root := range contentState.activeLibraryRoots {
		if _, remote := parseRemoteLibraryPath(root.Path); remote {
			continue
		}
		roots = append(roots, root)
	}

	return roots
}

func openSubsonicRootByName(roots []libraryRootConfig, rootName string) (libraryRootConfig, bool) {
	for _, root := range roots {
		if root.Name == rootName {
			return root, true
		}
	}

	return libraryRootConfig{}, false
}

func openSubsonicSelectedRoots(roots []libraryRootConfig, requestedMusicFolderID string) ([]libraryRootConfig, bool) {
	trimmedID := strings.TrimSpace(requestedMusicFolderID)
	if trimmedID == "" {
		return roots, true
	}

	rootName, ok := openSubsonicDecodeID(trimmedID, openSubsonicIDKindMusicFolder)
	if !ok {
		return nil, false
	}
	root, ok := openSubsonicRootByName(roots, rootName)
	if !ok {
		return nil, false
	}

	return []libraryRootConfig{root}, true
}

func openSubsonicAllowedRootNames(roots []libraryRootConfig) map[string]struct{} {
	allowedRoots := make(map[string]struct{}, len(roots))
	for _, root := range roots {
		allowedRoots[root.Name] = struct{}{}
	}

	return allowedRoots
}

func (a *App) openSubsonicFavoritePlaylistPaths() []string {
	settings := a.GetSettings()
	paths := make([]string, 0, len(settings.FavoritePlaylists))
	for _, candidate := range settings.FavoritePlaylists {
		normalized := normalizePath(candidate)
		if normalized == "" {
			continue
		}

		paths = append(paths, normalized)
	}

	return paths
}

func (a *App) openSubsonicResolveFavoritePlaylist(id string) (string, bool) {
	playlistPath, ok := openSubsonicDecodeID(strings.TrimSpace(id), openSubsonicIDKindPlaylist)
	if !ok {
		return "", false
	}

	normalized := normalizePath(playlistPath)
	if normalized == "" {
		return "", false
	}

	for _, favoritePath := range a.openSubsonicFavoritePlaylistPaths() {
		if normalizePath(favoritePath) == normalized {
			return normalized, true
		}
	}

	return "", false
}

func openSubsonicPlaylistTrackLookup(browse *openSubsonicBrowseIndex) map[string]openSubsonicTrackMetadataSnapshot {
	lookup := make(map[string]openSubsonicTrackMetadataSnapshot, len(browse.Tracks))
	for _, trackSnapshot := range browse.Tracks {
		lookup[normalizePath(trackSnapshot.Track.Path)] = trackSnapshot
	}

	return lookup
}

func openSubsonicPlaylistName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}

	base := filepath.Base(trimmed)
	if base == "" || base == "." {
		return ""
	}

	ext := strings.ToLower(filepath.Ext(base))
	switch ext {
	case ".m3u", ".m3u8", ".pls", ".xspf":
		withoutExt := strings.TrimSuffix(base, filepath.Ext(base))
		if withoutExt != "" {
			return withoutExt
		}
	}

	return base
}

func (a *App) openSubsonicBuildPlaylist(path string, trackLookup map[string]openSubsonicTrackMetadataSnapshot) openSubsonicPlaylist {
	normalizedPath := normalizePath(path)
	playlist := openSubsonicPlaylist{
		ID:   openSubsonicPlaylistID(normalizedPath),
		Name: openSubsonicPlaylistName(normalizedPath),
	}

	loaded := a.LoadPlaylistFile(normalizedPath)
	if loadedName := openSubsonicPlaylistName(loaded.Name); loadedName != "" {
		playlist.Name = loadedName
	}
	playlist.SongCount = len(loaded.TrackFiles)
	for _, trackFile := range loaded.TrackFiles {
		trackSnapshot, ok := trackLookup[normalizePath(trackFile.Path)]
		if !ok || trackSnapshot.Record.DurationSeconds <= 0 {
			continue
		}

		playlist.Duration += int(trackSnapshot.Record.DurationSeconds + 0.5)
	}

	if info, err := os.Stat(normalizedPath); err == nil && !info.IsDir() {
		playlist.Created = info.ModTime().UTC().Format(time.RFC3339Nano)
	}

	return playlist
}

func (a *App) openSubsonicBuildPlaylistEntry(trackFile LibraryIndexedFile, trackLookup map[string]openSubsonicTrackMetadataSnapshot, coverFolders map[string]struct{}) (openSubsonicChild, bool) {
	if trackSnapshot, ok := trackLookup[normalizePath(trackFile.Path)]; ok {
		trackSnapshot = a.openSubsonicHydrateTrackSnapshot(trackSnapshot)
		return a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshot)), trackSnapshot, coverFolders), true
	}

	root, ok := a.activeLibraryRootForPath(trackFile.Path)
	if !ok {
		return openSubsonicChild{}, false
	}

	fallbackSnapshot := openSubsonicTrackMetadataSnapshot{Root: root, Track: trackFile}
	fallbackSnapshot = a.openSubsonicHydrateTrackSnapshot(fallbackSnapshot)
	return a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(fallbackSnapshot)), fallbackSnapshot, coverFolders), true
}

func (a *App) openSubsonicBuildPlaylistDetails(path string, trackLookup map[string]openSubsonicTrackMetadataSnapshot, coverFolders map[string]struct{}) openSubsonicPlaylist {
	playlist := a.openSubsonicBuildPlaylist(path, trackLookup)
	loaded := a.LoadPlaylistFile(path)
	playlist.Entry = make([]openSubsonicChild, 0, len(loaded.TrackFiles))
	for _, trackFile := range loaded.TrackFiles {
		entry, ok := a.openSubsonicBuildPlaylistEntry(trackFile, trackLookup, coverFolders)
		if !ok {
			continue
		}

		playlist.Entry = append(playlist.Entry, entry)
	}

	playlist.SongCount = len(playlist.Entry)
	return playlist
}

func openSubsonicScrobblePathKey(path string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	normalized = strings.TrimRight(normalized, "/")
	return strings.ToLower(normalized)
}

func openSubsonicParseScrobbleRegex(pattern string) (*regexp.Regexp, bool) {
	trimmed := strings.TrimSpace(pattern)
	if trimmed == "" {
		return nil, false
	}

	if strings.HasPrefix(trimmed, "/") {
		lastSlashIndex := strings.LastIndex(trimmed, "/")
		if lastSlashIndex > 0 {
			body := trimmed[1:lastSlashIndex]
			flags := trimmed[lastSlashIndex+1:]
			patternBody := body
			if flags != "" {
				patternBody = "(?" + flags + ")" + body
			}
			compiled, err := regexp.Compile(patternBody)
			if err == nil {
				return compiled, true
			}
		}
	}

	compiled, err := regexp.Compile("(?i)" + trimmed)
	if err != nil {
		return nil, false
	}

	return compiled, true
}

func openSubsonicNormalizeScrobbleRuleText(field string, value string) string {
	if field == scrobbleRuleFieldPath {
		return openSubsonicScrobblePathKey(value)
	}

	return strings.ToLower(strings.TrimSpace(value))
}

func openSubsonicTrackNumberString(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) string {
	if value := strings.TrimSpace(tags.TrackNumber); value != "" {
		return value
	}
	if snapshot.Record.TrackNumber > 0 {
		return strconv.Itoa(snapshot.Record.TrackNumber)
	}

	return ""
}

func openSubsonicTrackDurationSeconds(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) int {
	if snapshot.Record.DurationSeconds > 0 {
		return int(snapshot.Record.DurationSeconds + 0.5)
	}
	if tags.DurationSecs > 0 {
		return int(tags.DurationSecs + 0.5)
	}

	return 0
}

func (a *App) openSubsonicReadTrackTags(snapshot openSubsonicTrackMetadataSnapshot) TrackTags {
	signature, ok := trackTagsFileSignatureForPath(snapshot.Track.Path)
	if !ok {
		return TrackTags{}
	}

	if cachedTags, _, cacheHit := a.getTrackTagsCache(snapshot.Track.Path, signature); cacheHit {
		return cachedTags
	}

	a.ensureSettingsLoaded()
	ffprobePath := resolveFFProbePath(a.settingsState().settings.FFmpegPath)
	tags, hasMetadata := readTrackTagsForPath(snapshot.Track.Path, ffprobePath)
	a.putTrackTagsCache(snapshot.Track.Path, signature, tags, hasMetadata)
	return tags
}

func openSubsonicUniqueStrings(values ...string) []string {
	uniqueValues := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, candidate := range values {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}

		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		uniqueValues = append(uniqueValues, trimmed)
	}

	return uniqueValues
}

func openSubsonicAllTagValues(tags TrackTags) []string {
	if len(tags.AllTags) == 0 {
		return nil
	}

	values := make([]string, 0)
	for _, rawValues := range tags.AllTags {
		for _, rawValue := range rawValues {
			trimmed := strings.TrimSpace(rawValue)
			if trimmed == "" {
				continue
			}
			values = append(values, trimmed)
		}
	}

	return openSubsonicUniqueStrings(values...)
}

func openSubsonicArtistMBIDs(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) []string {
	candidates := make([]string, 0, 1+len(tags.ArtistIDs)+len(snapshot.Record.ArtistIDs))
	candidates = append(candidates, strings.TrimSpace(tags.ArtistID))
	candidates = append(candidates, tags.ArtistIDs...)
	candidates = append(candidates, snapshot.Record.ArtistIDs...)
	return openSubsonicUniqueStrings(candidates...)
}

func openSubsonicAlbumMBID(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) string {
	return firstNonEmptyString(strings.TrimSpace(tags.ReleaseID), strings.TrimSpace(snapshot.Record.ReleaseID))
}

func (a *App) openSubsonicScrobbleTextCandidates(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags, field string) []string {
	switch field {
	case scrobbleRuleFieldPath:
		return openSubsonicUniqueStrings(snapshot.Track.Path)
	case scrobbleRuleFieldAlbumArtist:
		fallbackArtist := openSubsonicArtistNameFromSnapshot(snapshot)
		return openSubsonicUniqueStrings(tags.AlbumArtist, snapshot.Record.AlbumArtist, fallbackArtist)
	case scrobbleRuleFieldTrackArtist:
		fallbackArtist := openSubsonicArtistNameFromSnapshot(snapshot)
		return openSubsonicUniqueStrings(tags.Artist, snapshot.Record.TrackArtist, fallbackArtist)
	case scrobbleRuleFieldAlbumTitle:
		return openSubsonicUniqueStrings(tags.Album, snapshot.Record.AlbumTitle, openSubsonicAlbumTitleFromSnapshot(snapshot))
	case scrobbleRuleFieldTrackTitle:
		return openSubsonicUniqueStrings(tags.Title, snapshot.Record.Title, openSubsonicTrackTitleFromSnapshot(snapshot))
	case scrobbleRuleFieldGenre:
		genreCandidates := append([]string{}, tags.Genres...)
		genreCandidates = append(genreCandidates, strings.TrimSpace(tags.Genre))
		genreCandidates = append(genreCandidates, openSubsonicTrackGenresFromRecord(snapshot.Record)...)
		return openSubsonicUniqueStrings(genreCandidates...)
	case scrobbleRuleFieldAnyTag:
		if values := openSubsonicAllTagValues(tags); len(values) > 0 {
			return values
		}
		fallbackValues := make([]string, 0)
		fallbackValues = append(fallbackValues, tags.Artist, tags.AlbumArtist, tags.Album, tags.Title, tags.Date, tags.RecordLabel, tags.CatalogNumber, tags.Genre)
		fallbackValues = append(fallbackValues, tags.Genres...)
		fallbackValues = append(fallbackValues, tags.ArtistIDs...)
		fallbackValues = append(fallbackValues, tags.AlbumArtistIDs...)
		fallbackValues = append(fallbackValues,
			snapshot.Record.TrackArtist,
			snapshot.Record.AlbumArtist,
			snapshot.Record.AlbumTitle,
			snapshot.Record.Title,
			snapshot.Record.Date,
			snapshot.Record.RecordLabel,
			snapshot.Record.CatalogNumber,
			snapshot.Record.ReleaseID,
			snapshot.Record.RecordingID,
		)
		fallbackValues = append(fallbackValues, snapshot.Record.Genres...)
		fallbackValues = append(fallbackValues, snapshot.Record.ArtistIDs...)
		return openSubsonicUniqueStrings(fallbackValues...)
	case scrobbleRuleFieldArtistMBID:
		return openSubsonicArtistMBIDs(snapshot, tags)
	case scrobbleRuleFieldAlbumMBID:
		return openSubsonicUniqueStrings(openSubsonicAlbumMBID(snapshot, tags))
	default:
		return nil
	}
}

func openSubsonicMatchesScrobbleTextRule(candidate string, rule ScrobbleRule) bool {
	if rule.Field == scrobbleRuleFieldTrackLength {
		return false
	}

	if rule.Operator == scrobbleRuleOperatorRegex {
		compiled, ok := openSubsonicParseScrobbleRegex(rule.Value)
		return ok && compiled.MatchString(candidate)
	}

	normalizedCandidate := openSubsonicNormalizeScrobbleRuleText(rule.Field, candidate)
	normalizedRuleValue := openSubsonicNormalizeScrobbleRuleText(rule.Field, rule.Value)
	if normalizedRuleValue == "" {
		return false
	}

	switch rule.Operator {
	case scrobbleRuleOperatorEquals:
		return normalizedCandidate == normalizedRuleValue
	case scrobbleRuleOperatorStartsWith:
		if rule.Field == scrobbleRuleFieldPath {
			return normalizedCandidate == normalizedRuleValue || strings.HasPrefix(normalizedCandidate, normalizedRuleValue+"/")
		}
		return strings.HasPrefix(normalizedCandidate, normalizedRuleValue)
	default:
		return strings.Contains(normalizedCandidate, normalizedRuleValue)
	}
}

func (a *App) openSubsonicMatchesScrobbleRule(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags, rule ScrobbleRule) bool {
	if rule.Field == scrobbleRuleFieldTrackLength {
		durationSeconds := openSubsonicTrackDurationSeconds(snapshot, tags)
		if durationSeconds <= 0 {
			return false
		}

		thresholdSeconds, err := strconv.Atoi(strings.TrimSpace(rule.Value))
		if err != nil {
			return false
		}

		if rule.Operator == scrobbleRuleOperatorLessThan {
			return durationSeconds < thresholdSeconds
		}

		return durationSeconds > thresholdSeconds
	}

	for _, candidate := range a.openSubsonicScrobbleTextCandidates(snapshot, tags, rule.Field) {
		if openSubsonicMatchesScrobbleTextRule(candidate, rule) {
			return true
		}
	}

	return false
}

func (a *App) openSubsonicScrobbleAllowed(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) bool {
	settings := a.GetSettings()
	if len(settings.ScrobbleRules) == 0 {
		return settings.ScrobbleFilterMode == "blacklist"
	}

	for _, rule := range settings.ScrobbleRules {
		if a.openSubsonicMatchesScrobbleRule(snapshot, tags, rule) {
			return settings.ScrobbleFilterMode == "whitelist"
		}
	}

	return settings.ScrobbleFilterMode == "blacklist"
}

func openSubsonicLastFmConfigured(settings AppSettings) bool {
	return strings.TrimSpace(settings.LastFmAPIKey) != "" && strings.TrimSpace(settings.LastFmAPISecret) != "" && strings.TrimSpace(settings.LastFmSessionKey) != ""
}

func openSubsonicListenBrainzConfigured(settings AppSettings) bool {
	return strings.TrimSpace(settings.ListenBrainzUserToken) != ""
}

func openSubsonicBuildLastFmMetadata(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) LastFmTrackMetadata {
	trackName := firstNonEmptyString(strings.TrimSpace(tags.Title), openSubsonicTrackTitleFromSnapshot(snapshot), snapshot.Track.Name)
	artistName := firstNonEmptyString(strings.TrimSpace(tags.Artist), strings.TrimSpace(snapshot.Record.TrackArtist), openSubsonicArtistNameFromSnapshot(snapshot), "Unknown Artist")
	return LastFmTrackMetadata{
		ArtistName:      artistName,
		TrackName:       trackName,
		ReleaseName:     firstNonEmptyString(strings.TrimSpace(tags.Album), openSubsonicAlbumTitleFromSnapshot(snapshot)),
		AlbumArtist:     firstNonEmptyString(strings.TrimSpace(tags.AlbumArtist), strings.TrimSpace(snapshot.Record.AlbumArtist)),
		TrackNumber:     openSubsonicTrackNumberString(snapshot, tags),
		RecordingMBID:   firstNonEmptyString(strings.TrimSpace(tags.RecordingID), strings.TrimSpace(snapshot.Record.RecordingID)),
		DurationSeconds: openSubsonicTrackDurationSeconds(snapshot, tags),
	}
}

func openSubsonicBuildListenBrainzMetadata(snapshot openSubsonicTrackMetadataSnapshot, tags TrackTags) ListenBrainzTrackMetadata {
	trackName := firstNonEmptyString(strings.TrimSpace(tags.Title), openSubsonicTrackTitleFromSnapshot(snapshot), snapshot.Track.Name)
	artistName := firstNonEmptyString(strings.TrimSpace(tags.Artist), strings.TrimSpace(snapshot.Record.TrackArtist), openSubsonicArtistNameFromSnapshot(snapshot), "Unknown Artist")
	return ListenBrainzTrackMetadata{
		ArtistName:    artistName,
		TrackName:     trackName,
		ReleaseName:   firstNonEmptyString(strings.TrimSpace(tags.Album), openSubsonicAlbumTitleFromSnapshot(snapshot)),
		RecordingMBID: firstNonEmptyString(strings.TrimSpace(tags.RecordingID), strings.TrimSpace(snapshot.Record.RecordingID)),
		ReleaseMBID:   openSubsonicAlbumMBID(snapshot, tags),
		ArtistMBIDs:   openSubsonicArtistMBIDs(snapshot, tags),
	}
}

func openSubsonicParseScrobbleTimeMillis(raw string) int64 {
	parsed, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || parsed <= 0 {
		return 0
	}
	if parsed > 100000000000 {
		return parsed / 1000
	}
	return parsed
}

func openSubsonicScrobbleSubmission(values url.Values) (bool, bool) {
	rawValue := strings.TrimSpace(values.Get("submission"))
	if rawValue == "" {
		return false, false
	}

	switch strings.ToLower(rawValue) {
	case "0", "false", "no":
		return true, false
	case "1", "true", "yes":
		return true, true
	default:
		parsed, err := strconv.ParseBool(rawValue)
		if err != nil {
			return true, true
		}
		return true, parsed
	}
}

func (a *App) openSubsonicTrackSnapshotForSongID(requestedID string, browse *openSubsonicBrowseIndex) (openSubsonicTrackMetadataSnapshot, bool) {
	virtualTrackPath, ok := openSubsonicDecodeID(strings.TrimSpace(requestedID), openSubsonicIDKindSong)
	if !ok {
		return openSubsonicTrackMetadataSnapshot{}, false
	}

	if trackSnapshot, exists := browse.TracksBySongID[openSubsonicSongID(virtualTrackPath)]; exists {
		return trackSnapshot, true
	}

	root, relativeTrackPath, absoluteTrackPath, ok := openSubsonicResolveAbsolutePath(browse.Roots, virtualTrackPath)
	if !ok || !isAudioPath(absoluteTrackPath) {
		return openSubsonicTrackMetadataSnapshot{}, false
	}

	return openSubsonicTrackMetadataSnapshot{
		Root: root,
		Track: LibraryIndexedFile{
			Name:         filepath.Base(absoluteTrackPath),
			Path:         absoluteTrackPath,
			RelativePath: relativeTrackPath,
			FolderPath:   pathpkg.Dir(relativeTrackPath),
			RootPath:     root.Path,
			RootName:     root.Name,
		},
	}, true
}

func openSubsonicAppendUniqueTrackSnapshots(dst []openSubsonicTrackMetadataSnapshot, seen map[string]struct{}, snapshots ...openSubsonicTrackMetadataSnapshot) []openSubsonicTrackMetadataSnapshot {
	for _, snapshot := range snapshots {
		key := normalizePath(snapshot.Track.Path)
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		dst = append(dst, snapshot)
	}

	return dst
}

func (a *App) openSubsonicFeedbackTrackSnapshots(values url.Values, browse *openSubsonicBrowseIndex) ([]openSubsonicTrackMetadataSnapshot, *openSubsonicError) {
	seen := make(map[string]struct{})
	snapshots := make([]openSubsonicTrackMetadataSnapshot, 0)

	appendAlbumTracks := func(albumID string) *openSubsonicError {
		decodedAlbumID, _, ok := openSubsonicDecodeIDWithAliases(albumID, openSubsonicIDKindAlbum)
		if !ok {
			return &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "album not found"}
		}
		albumSnapshot, exists := browse.AlbumsByID[openSubsonicAlbumID(decodedAlbumID)]
		if !exists {
			return &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "album not found"}
		}
		snapshots = openSubsonicAppendUniqueTrackSnapshots(snapshots, seen, albumSnapshot.Tracks...)
		return nil
	}

	appendArtistTracks := func(artistID string) *openSubsonicError {
		decodedArtistID, _, ok := openSubsonicDecodeIDWithAliases(artistID, openSubsonicIDKindArtist)
		if !ok {
			return &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "artist not found"}
		}
		artistSnapshot, exists := browse.ArtistsByID[openSubsonicArtistID(decodedArtistID)]
		if !exists {
			return &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "artist not found"}
		}
		for _, albumSnapshot := range artistSnapshot.Albums {
			snapshots = openSubsonicAppendUniqueTrackSnapshots(snapshots, seen, albumSnapshot.Tracks...)
		}
		return nil
	}

	appendDirectoryTracks := func(directoryID string) *openSubsonicError {
		decodedDirectoryID, ok := openSubsonicDecodeID(strings.TrimSpace(directoryID), openSubsonicIDKindDirectory)
		if !ok {
			return &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "directory not found"}
		}
		if albumSnapshot, exists := browse.AlbumByFolder[openSubsonicNormalizedLookupKey(decodedDirectoryID)]; exists {
			snapshots = openSubsonicAppendUniqueTrackSnapshots(snapshots, seen, albumSnapshot.Tracks...)
			return nil
		}
		if trackSnapshots, exists := browse.TracksByFolder[openSubsonicNormalizedLookupKey(decodedDirectoryID)]; exists {
			snapshots = openSubsonicAppendUniqueTrackSnapshots(snapshots, seen, trackSnapshots...)
			return nil
		}
		return &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "directory not found"}
	}

	for _, rawID := range values["id"] {
		decodedID, kind, ok := openSubsonicDecodeIDWithAliases(rawID, openSubsonicIDKindSong, openSubsonicIDKindAlbum, openSubsonicIDKindArtist, openSubsonicIDKindDirectory)
		if !ok {
			return nil, &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "item not found"}
		}

		switch kind {
		case openSubsonicIDKindSong:
			trackSnapshot, exists := a.openSubsonicTrackSnapshotForSongID(openSubsonicSongID(decodedID), browse)
			if !exists {
				return nil, &openSubsonicError{Code: openSubsonicErrorNotFound, Message: "song not found"}
			}
			snapshots = openSubsonicAppendUniqueTrackSnapshots(snapshots, seen, trackSnapshot)
		case openSubsonicIDKindAlbum:
			if err := appendAlbumTracks(openSubsonicAlbumID(decodedID)); err != nil {
				return nil, err
			}
		case openSubsonicIDKindArtist:
			if err := appendArtistTracks(openSubsonicArtistID(decodedID)); err != nil {
				return nil, err
			}
		case openSubsonicIDKindDirectory:
			if err := appendDirectoryTracks(openSubsonicDirectoryID(decodedID)); err != nil {
				return nil, err
			}
		}
	}

	for _, rawAlbumID := range values["albumId"] {
		if err := appendAlbumTracks(rawAlbumID); err != nil {
			return nil, err
		}
	}

	for _, rawArtistID := range values["artistId"] {
		if err := appendArtistTracks(rawArtistID); err != nil {
			return nil, err
		}
	}

	return snapshots, nil
}

func (a *App) openSubsonicApplyTrackFeedback(snapshot openSubsonicTrackMetadataSnapshot, score int) error {
	snapshot = a.openSubsonicHydrateTrackSnapshot(snapshot)
	tags := a.openSubsonicReadTrackTags(snapshot)
	settings := a.GetSettings()

	if openSubsonicListenBrainzConfigured(settings) {
		recordingMBID := firstNonEmptyString(strings.TrimSpace(tags.RecordingID), strings.TrimSpace(snapshot.Record.RecordingID))
		if recordingMBID != "" {
			if err := a.SubmitListenBrainzRecordingFeedback(recordingMBID, score); err != nil {
				return err
			}
		}
	}

	if openSubsonicLastFmConfigured(settings) {
		metadata := openSubsonicBuildLastFmMetadata(snapshot, tags)
		if score == 1 {
			if err := a.SubmitLastFmLove(metadata); err != nil {
				return err
			}
		} else {
			if err := a.SubmitLastFmUnlove(metadata); err != nil {
				return err
			}
		}
	}

	return nil
}

func openSubsonicParseNonNegativeInt(values url.Values, key string, defaultValue int) int {
	rawValue := strings.TrimSpace(values.Get(key))
	if rawValue == "" {
		return defaultValue
	}

	parsedValue, err := strconv.Atoi(rawValue)
	if err != nil {
		return defaultValue
	}
	if parsedValue < 0 {
		return 0
	}

	return parsedValue
}

func openSubsonicClampWindow(total int, offset int, count int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if count < 0 {
		count = 0
	}
	if offset > total {
		offset = total
	}
	end := offset + count
	if end > total {
		end = total
	}

	return offset, end
}

func openSubsonicSearchTerms(rawQuery string) []string {
	trimmedQuery := strings.TrimSpace(rawQuery)
	if trimmedQuery == "" || trimmedQuery == `""` {
		return nil
	}

	return strings.Fields(strings.ToLower(trimmedQuery))
}

func openSubsonicMatchesSearchTerms(terms []string, fields ...string) bool {
	if len(terms) == 0 {
		return true
	}

	haystackParts := make([]string, 0, len(fields))
	for _, field := range fields {
		trimmedField := strings.TrimSpace(field)
		if trimmedField == "" {
			continue
		}
		haystackParts = append(haystackParts, strings.ToLower(trimmedField))
	}
	haystack := strings.Join(haystackParts, " ")
	if haystack == "" {
		return false
	}

	for _, term := range terms {
		if !strings.Contains(haystack, term) {
			return false
		}
	}

	return true
}

func openSubsonicArtistMatchesSearch(snapshot openSubsonicArtistSnapshot, terms []string) bool {
	return openSubsonicMatchesSearchTerms(terms, snapshot.Artist.Name, snapshot.FolderPath)
}

func openSubsonicAlbumMatchesSearch(snapshot openSubsonicAlbumSnapshot, terms []string) bool {
	return openSubsonicMatchesSearchTerms(terms, snapshot.Album.Name, snapshot.Album.Artist, snapshot.FolderPath)
}

func openSubsonicTrackMatchesSearch(snapshot openSubsonicTrackMetadataSnapshot, terms []string) bool {
	relativePath := openSubsonicTrackRelativePath(snapshot.Root, snapshot.Track.RelativePath)
	return openSubsonicMatchesSearchTerms(
		terms,
		openSubsonicTrackTitleFromSnapshot(snapshot),
		openSubsonicAlbumTitleFromSnapshot(snapshot),
		openSubsonicArtistNameFromSnapshot(snapshot),
		relativePath,
	)
}

func openSubsonicLegacySearchMatches(
	snapshot openSubsonicTrackMetadataSnapshot,
	artistTerms []string,
	albumTerms []string,
	titleTerms []string,
	anyTerms []string,
	newerThanMs int64,
) bool {
	if newerThanMs > 0 && snapshot.Track.ModifiedAtMs <= newerThanMs {
		return false
	}

	relativePath := openSubsonicTrackRelativePath(snapshot.Root, snapshot.Track.RelativePath)
	artistName := openSubsonicArtistNameFromSnapshot(snapshot)
	albumName := openSubsonicAlbumTitleFromSnapshot(snapshot)
	trackTitle := openSubsonicTrackTitleFromSnapshot(snapshot)
	if !openSubsonicMatchesSearchTerms(artistTerms, artistName) {
		return false
	}
	if !openSubsonicMatchesSearchTerms(albumTerms, albumName, artistName) {
		return false
	}
	if !openSubsonicMatchesSearchTerms(titleTerms, trackTitle, artistName) {
		return false
	}
	if !openSubsonicMatchesSearchTerms(anyTerms, trackTitle, albumName, artistName, relativePath) {
		return false
	}

	return true
}

func openSubsonicArtistSearchLess(left openSubsonicArtistSnapshot, right openSubsonicArtistSnapshot) bool {
	leftName := strings.ToLower(strings.TrimSpace(left.Artist.Name))
	rightName := strings.ToLower(strings.TrimSpace(right.Artist.Name))
	if leftName == rightName {
		return left.Artist.ID < right.Artist.ID
	}

	return leftName < rightName
}

func openSubsonicAlbumSearchLess(left openSubsonicAlbumSnapshot, right openSubsonicAlbumSnapshot) bool {
	leftArtist := strings.ToLower(strings.TrimSpace(left.Album.Artist))
	rightArtist := strings.ToLower(strings.TrimSpace(right.Album.Artist))
	if leftArtist != rightArtist {
		return leftArtist < rightArtist
	}

	leftAlbum := strings.ToLower(strings.TrimSpace(left.Album.Name))
	rightAlbum := strings.ToLower(strings.TrimSpace(right.Album.Name))
	if leftAlbum == rightAlbum {
		return left.Album.ID < right.Album.ID
	}

	return leftAlbum < rightAlbum
}

func openSubsonicSearchTrackLess(left openSubsonicTrackMetadataSnapshot, right openSubsonicTrackMetadataSnapshot) bool {
	leftArtist := strings.ToLower(strings.TrimSpace(openSubsonicArtistNameFromSnapshot(left)))
	rightArtist := strings.ToLower(strings.TrimSpace(openSubsonicArtistNameFromSnapshot(right)))
	if leftArtist != rightArtist {
		return leftArtist < rightArtist
	}

	leftAlbum := strings.ToLower(strings.TrimSpace(openSubsonicAlbumTitleFromSnapshot(left)))
	rightAlbum := strings.ToLower(strings.TrimSpace(openSubsonicAlbumTitleFromSnapshot(right)))
	if leftAlbum != rightAlbum {
		return leftAlbum < rightAlbum
	}

	return openSubsonicTrackLess(left, right)
}

func openSubsonicCollectSearchMatches(
	browse *openSubsonicBrowseIndex,
	allowedRoots map[string]struct{},
	query string,
) ([]openSubsonicArtistSnapshot, []openSubsonicAlbumSnapshot, []openSubsonicTrackMetadataSnapshot) {
	terms := openSubsonicSearchTerms(query)
	artistMatches := make([]openSubsonicArtistSnapshot, 0)
	albumMatches := make([]openSubsonicAlbumSnapshot, 0)
	trackMatches := make([]openSubsonicTrackMetadataSnapshot, 0)

	for _, artistSnapshot := range browse.Artists {
		if _, ok := allowedRoots[artistSnapshot.Root.Name]; !ok {
			continue
		}
		if openSubsonicArtistMatchesSearch(artistSnapshot, terms) {
			artistMatches = append(artistMatches, artistSnapshot)
		}
	}
	for _, albumSnapshot := range browse.Albums {
		if _, ok := allowedRoots[albumSnapshot.Root.Name]; !ok {
			continue
		}
		if openSubsonicAlbumMatchesSearch(albumSnapshot, terms) {
			albumMatches = append(albumMatches, albumSnapshot)
		}
	}
	for _, trackSnapshot := range browse.Tracks {
		if _, ok := allowedRoots[trackSnapshot.Root.Name]; !ok {
			continue
		}
		if openSubsonicTrackMatchesSearch(trackSnapshot, terms) {
			trackMatches = append(trackMatches, trackSnapshot)
		}
	}

	sort.SliceStable(artistMatches, func(i int, j int) bool {
		return openSubsonicArtistSearchLess(artistMatches[i], artistMatches[j])
	})
	sort.SliceStable(albumMatches, func(i int, j int) bool {
		return openSubsonicAlbumSearchLess(albumMatches[i], albumMatches[j])
	})
	sort.SliceStable(trackMatches, func(i int, j int) bool {
		return openSubsonicSearchTrackLess(trackMatches[i], trackMatches[j])
	})

	return artistMatches, albumMatches, trackMatches
}

func openSubsonicResolveAbsolutePath(roots []libraryRootConfig, virtualPath string) (libraryRootConfig, string, string, bool) {
	normalizedVirtualPath, ok := normalizeLibraryRelativePath(virtualPath)
	if !ok || normalizedVirtualPath == "" {
		return libraryRootConfig{}, "", "", false
	}

	for _, root := range roots {
		if normalizedVirtualPath == root.Name {
			return root, "", root.Path, true
		}

		prefix := root.Name + "/"
		if !strings.HasPrefix(normalizedVirtualPath, prefix) {
			continue
		}

		relativePath := strings.TrimPrefix(normalizedVirtualPath, prefix)
		absolutePath := filepath.Join(root.Path, filepath.FromSlash(relativePath))
		if !pathResolvesWithinRoot(root.Path, absolutePath) {
			return libraryRootConfig{}, "", "", false
		}

		return root, relativePath, absolutePath, true
	}

	return libraryRootConfig{}, "", "", false
}

func openSubsonicTrackFallbackFields(root libraryRootConfig, relativePath string) (string, string, string, string) {
	normalizedRelativePath, _ := normalizeLibraryRelativePath(relativePath)
	folderPath := pathpkg.Dir(normalizedRelativePath)
	if folderPath == "." {
		folderPath = ""
	}

	title := strings.TrimSuffix(pathpkg.Base(normalizedRelativePath), pathpkg.Ext(normalizedRelativePath))
	album := ""
	artist := ""
	if strings.TrimSpace(folderPath) != "" {
		segments := strings.Split(folderPath, "/")
		album = strings.TrimSpace(segments[len(segments)-1])
		if len(segments) > 1 {
			artist = strings.TrimSpace(segments[len(segments)-2])
		}
	}

	virtualFolderPath := root.Name
	if strings.TrimSpace(folderPath) != "" {
		virtualFolderPath = buildVirtualLibraryPath(root.Name, folderPath)
	}

	return strings.TrimSpace(title), album, artist, virtualFolderPath
}

func openSubsonicContentType(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if contentType, ok := openSubsonicKnownContentTypes[ext]; ok {
		return contentType
	}

	contentType := strings.TrimSpace(mime.TypeByExtension(ext))
	if contentType != "" {
		if separatorIndex := strings.Index(contentType, ";"); separatorIndex >= 0 {
			contentType = contentType[:separatorIndex]
		}
		return contentType
	}

	file, err := os.Open(path)
	if err != nil {
		return "application/octet-stream"
	}
	defer file.Close()

	head := make([]byte, 512)
	readCount, _ := file.Read(head)
	if readCount <= 0 {
		return "application/octet-stream"
	}

	return http.DetectContentType(head[:readCount])
}

func openSubsonicStreamContentType(path string) string {
	return openSubsonicContentType(path)
}

func openSubsonicBitrateKbps(bitRate int) int {
	if bitRate <= 0 {
		return 0
	}

	return (bitRate + 500) / 1000
}

func openSubsonicIndexGroupName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "#"
	}

	r, _ := utf8.DecodeRuneInString(trimmed)
	if r == utf8.RuneError {
		return "#"
	}
	r = unicode.ToUpper(r)
	if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
		return "#"
	}

	return string(r)
}

func (a *App) openSubsonicFolderCoverIDForPath(folderPath string) string {
	if strings.TrimSpace(folderPath) == "" {
		return ""
	}
	if strings.TrimSpace(a.GetLibraryFolderCoverPath(folderPath)) == "" {
		return ""
	}

	return openSubsonicFolderCoverID(folderPath)
}

func (a *App) openSubsonicTrackCoverIDForPath(folderPath string, virtualTrackPath string, absoluteTrackPath string) string {
	if coverID := a.openSubsonicFolderCoverIDForPath(folderPath); coverID != "" {
		return coverID
	}
	if cover := a.ReadTrackEmbeddedCover(absoluteTrackPath); strings.TrimSpace(cover.Base64) != "" {
		return openSubsonicTrackCoverID(virtualTrackPath)
	}

	return ""
}

func (a *App) openSubsonicLibrarySnapshot() openSubsonicLibrarySnapshot {
	contentState := a.libraryContentState()
	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()

	snapshot := openSubsonicLibrarySnapshot{
		LibraryVersion: a.libraryIndexState().libraryDerivedIndexGeneration,
		Roots:          make([]libraryRootConfig, 0, len(contentState.activeLibraryRoots)),
		RootsByName:    make(map[string]libraryRootConfig, len(contentState.activeLibraryRoots)),
		Tracks:         make([]openSubsonicIndexedTrackSnapshot, 0, len(contentState.trackByPath)),
		CoverFolders:   make(map[string]struct{}, len(contentState.libraryScan.CoverPathByFolder)),
	}

	for _, root := range contentState.activeLibraryRoots {
		if _, remote := parseRemoteLibraryPath(root.Path); remote {
			continue
		}
		snapshot.Roots = append(snapshot.Roots, root)
		snapshot.RootsByName[root.Name] = root
	}

	for folderKey, coverPath := range contentState.libraryScan.CoverPathByFolder {
		if strings.TrimSpace(coverPath) == "" {
			continue
		}
		snapshot.CoverFolders[strings.ToLower(strings.TrimSpace(folderKey))] = struct{}{}
	}

	for _, track := range contentState.trackByPath {
		root, ok := snapshot.RootsByName[track.RootName]
		if !ok {
			continue
		}
		snapshot.Tracks = append(snapshot.Tracks, openSubsonicIndexedTrackSnapshot{Root: root, Track: track})
	}

	sort.SliceStable(snapshot.Tracks, func(i int, j int) bool {
		return strings.ToLower(snapshot.Tracks[i].Track.RelativePath) < strings.ToLower(snapshot.Tracks[j].Track.RelativePath)
	})

	return snapshot
}

func (a *App) openSubsonicAlbumListLibrarySnapshot() openSubsonicAlbumListLibrarySnapshot {
	contentState := a.libraryContentState()
	contentState.indexMu.Lock()
	defer contentState.indexMu.Unlock()
	indexState := a.libraryIndexState()

	rootsByName := make(map[string]libraryRootConfig, len(contentState.activeLibraryRoots))
	for _, root := range contentState.activeLibraryRoots {
		if _, remote := parseRemoteLibraryPath(root.Path); remote {
			continue
		}
		rootsByName[root.Name] = root
	}

	snapshot := openSubsonicAlbumListLibrarySnapshot{
		LibraryVersion: a.libraryIndexState().libraryDerivedIndexGeneration,
		Folders:        make([]openSubsonicAlbumListFolderSnapshot, 0, len(indexState.trackFilesByFolder)),
		CoverFolders:   make(map[string]struct{}, len(contentState.libraryScan.CoverPathByFolder)),
	}

	for folderKey, coverPath := range contentState.libraryScan.CoverPathByFolder {
		if strings.TrimSpace(coverPath) == "" {
			continue
		}
		snapshot.CoverFolders[strings.ToLower(strings.TrimSpace(folderKey))] = struct{}{}
	}

	appendFolderSnapshot := func(folderPath string, representativeTrack LibraryIndexedFile, trackCount int, modifiedAt int64) {
		root, ok := rootsByName[representativeTrack.RootName]
		if !ok || trackCount <= 0 {
			return
		}
		if modifiedAt <= 0 {
			modifiedAt = representativeTrack.ModifiedAtMs
		}
		snapshot.Folders = append(snapshot.Folders, openSubsonicAlbumListFolderSnapshot{
			Root:                root,
			FolderPath:          folderPath,
			RepresentativeTrack: representativeTrack,
			TrackCount:          trackCount,
			ModifiedAt:          modifiedAt,
		})
	}

	if indexState.trackFilesByFolder != nil {
		for folderPath, tracks := range indexState.trackFilesByFolder {
			if len(tracks) == 0 {
				continue
			}
			appendFolderSnapshot(folderPath, tracks[0], len(tracks), indexState.folderModifiedAtByPath[folderPath])
		}
		return snapshot
	}

	type albumFolderAccumulator struct {
		representativeTrack LibraryIndexedFile
		trackCount          int
		modifiedAt          int64
	}
	foldersByPath := make(map[string]*albumFolderAccumulator)
	collectTrack := func(track LibraryIndexedFile) {
		if _, ok := rootsByName[track.RootName]; !ok {
			return
		}
		folderPath := strings.TrimSpace(track.FolderPath)
		if folderPath == "" {
			return
		}
		accumulator, exists := foldersByPath[folderPath]
		if !exists {
			accumulator = &albumFolderAccumulator{representativeTrack: track}
			foldersByPath[folderPath] = accumulator
		}
		accumulator.trackCount++
		if track.ModifiedAtMs > accumulator.modifiedAt {
			accumulator.modifiedAt = track.ModifiedAtMs
		}
	}

	if len(contentState.libraryScan.TrackFiles) > 0 {
		for _, track := range contentState.libraryScan.TrackFiles {
			collectTrack(track)
		}
	} else {
		for _, track := range contentState.trackByPath {
			collectTrack(track)
		}
	}

	for folderPath, accumulator := range foldersByPath {
		appendFolderSnapshot(folderPath, accumulator.representativeTrack, accumulator.trackCount, accumulator.modifiedAt)
	}

	return snapshot
}

func (a *App) openSubsonicTrackRecordsSnapshot() openSubsonicTrackRecordsSnapshot {
	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	a.ensureMusicBrainzTagDatabaseLoadedLocked()

	records := make(map[string]musicBrainzTagTrackRecord, len(a.musicBrainzTagStore.Tracks))
	for path, record := range a.musicBrainzTagStore.Tracks {
		records[path] = record
	}

	return openSubsonicTrackRecordsSnapshot{
		Version: a.musicBrainzTagVersion.Load(),
		ByPath:  records,
	}
}

var openSubsonicKnownContentTypes = map[string]string{
	".aac":  "audio/aac",
	".flac": "audio/flac",
	".m4a":  "audio/mp4",
	".mp3":  "audio/mpeg",
	".ogg":  "audio/ogg",
	".opus": "audio/ogg",
	".wav":  "audio/wav",
	".mka":  "audio/x-matroska",
}

func openSubsonicTrackRelativePath(root libraryRootConfig, virtualTrackPath string) string {
	_, relativePath, _, ok := openSubsonicResolveAbsolutePath([]libraryRootConfig{root}, virtualTrackPath)
	if ok {
		return relativePath
	}

	prefix := root.Name + "/"
	return strings.TrimPrefix(virtualTrackPath, prefix)
}

func openSubsonicTrackRecordNeedsHydration(record musicBrainzTagTrackRecord) bool {
	return record.DurationSeconds <= 0 || record.BitRate <= 0 || record.SampleRate <= 0 || record.Channels <= 0 || record.FileSizeBytes <= 0
}

func openSubsonicTrackRecordFromTags(tags TrackTags, signature trackTagsFileSignature) musicBrainzTagTrackRecord {
	fileSizeBytes := tags.FileSizeBytes
	if fileSizeBytes <= 0 {
		fileSizeBytes = signature.Size
	}

	return musicBrainzTagTrackRecord{
		Title:           strings.TrimSpace(tags.Title),
		TrackArtist:     strings.TrimSpace(tags.Artist),
		AlbumTitle:      strings.TrimSpace(tags.Album),
		AlbumArtist:     strings.TrimSpace(tags.AlbumArtist),
		Date:            strings.TrimSpace(tags.Date),
		RecordLabel:     strings.TrimSpace(tags.RecordLabel),
		CatalogNumber:   strings.TrimSpace(tags.CatalogNumber),
		Genres:          append([]string(nil), tags.Genres...),
		TrackNumber:     parseIntValue(tags.TrackNumber),
		TrackTotal:      parseIntValue(tags.TrackTotal),
		DiscNumber:      parseIntValue(tags.DiscNumber),
		DiscTotal:       parseIntValue(tags.DiscTotal),
		DurationSeconds: tags.DurationSecs,
		BitRate:         tags.BitRate,
		BitDepth:        tags.BitDepth,
		SampleRate:      tags.SampleRate,
		Channels:        tags.Channels,
		FileSizeBytes:   fileSizeBytes,
		RecordingID:     sanitizeMusicBrainzID(tags.RecordingID),
		ReleaseID:       sanitizeMusicBrainzID(tags.ReleaseID),
		ArtistIDs:       normalizeMusicBrainzArtistIDsForTags(tags.ArtistID, tags.ArtistIDs),
		AlbumArtistIDs:  sanitizeMusicBrainzIDs(tags.AlbumArtistIDs),
	}
}

func openSubsonicMergeTrackRecord(base musicBrainzTagTrackRecord, fallback musicBrainzTagTrackRecord) musicBrainzTagTrackRecord {
	if strings.TrimSpace(base.Title) == "" {
		base.Title = fallback.Title
	}
	if strings.TrimSpace(base.TrackArtist) == "" {
		base.TrackArtist = fallback.TrackArtist
	}
	if strings.TrimSpace(base.AlbumTitle) == "" {
		base.AlbumTitle = fallback.AlbumTitle
	}
	if strings.TrimSpace(base.AlbumArtist) == "" {
		base.AlbumArtist = fallback.AlbumArtist
	}
	if strings.TrimSpace(base.Date) == "" {
		base.Date = fallback.Date
	}
	if strings.TrimSpace(base.RecordLabel) == "" {
		base.RecordLabel = fallback.RecordLabel
	}
	if strings.TrimSpace(base.CatalogNumber) == "" {
		base.CatalogNumber = fallback.CatalogNumber
	}
	if len(base.Genres) == 0 && len(fallback.Genres) > 0 {
		base.Genres = append([]string(nil), fallback.Genres...)
	}
	if base.TrackNumber <= 0 {
		base.TrackNumber = fallback.TrackNumber
	}
	if base.TrackTotal <= 0 {
		base.TrackTotal = fallback.TrackTotal
	}
	if base.DiscNumber <= 0 {
		base.DiscNumber = fallback.DiscNumber
	}
	if base.DiscTotal <= 0 {
		base.DiscTotal = fallback.DiscTotal
	}
	if base.DurationSeconds <= 0 {
		base.DurationSeconds = fallback.DurationSeconds
	}
	if base.BitRate <= 0 {
		base.BitRate = fallback.BitRate
	}
	if base.BitDepth <= 0 {
		base.BitDepth = fallback.BitDepth
	}
	if base.SampleRate <= 0 {
		base.SampleRate = fallback.SampleRate
	}
	if base.Channels <= 0 {
		base.Channels = fallback.Channels
	}
	if base.FileSizeBytes <= 0 {
		base.FileSizeBytes = fallback.FileSizeBytes
	}
	if strings.TrimSpace(base.RecordingID) == "" {
		base.RecordingID = fallback.RecordingID
	}
	if strings.TrimSpace(base.ReleaseID) == "" {
		base.ReleaseID = fallback.ReleaseID
	}
	if len(base.ArtistIDs) == 0 && len(fallback.ArtistIDs) > 0 {
		base.ArtistIDs = append([]string(nil), fallback.ArtistIDs...)
	}
	if len(base.AlbumArtistIDs) == 0 && len(fallback.AlbumArtistIDs) > 0 {
		base.AlbumArtistIDs = append([]string(nil), fallback.AlbumArtistIDs...)
	}

	return base
}

func (a *App) openSubsonicHydrateTrackSnapshot(snapshot openSubsonicTrackMetadataSnapshot) openSubsonicTrackMetadataSnapshot {
	if !openSubsonicTrackRecordNeedsHydration(snapshot.Record) {
		return snapshot
	}

	signature, ok := trackTagsFileSignatureForPath(snapshot.Track.Path)
	if !ok {
		return snapshot
	}

	if cachedTags, cachedHasMetadata, cacheHit := a.getTrackTagsCache(snapshot.Track.Path, signature); cacheHit {
		if cachedHasMetadata {
			snapshot.Record = openSubsonicMergeTrackRecord(snapshot.Record, openSubsonicTrackRecordFromTags(cachedTags, signature))
		} else if snapshot.Record.FileSizeBytes <= 0 {
			snapshot.Record.FileSizeBytes = signature.Size
		}
		return snapshot
	}

	a.ensureSettingsLoaded()
	ffprobePath := resolveFFProbePath(a.settingsState().settings.FFmpegPath)
	tags, hasMetadata := readTrackTagsForPath(snapshot.Track.Path, ffprobePath)
	a.putTrackTagsCache(snapshot.Track.Path, signature, tags, hasMetadata)
	if hasMetadata {
		snapshot.Record = openSubsonicMergeTrackRecord(snapshot.Record, openSubsonicTrackRecordFromTags(tags, signature))
	} else if snapshot.Record.FileSizeBytes <= 0 {
		snapshot.Record.FileSizeBytes = signature.Size
	}

	return snapshot
}

func openSubsonicTrackMetadataSnapshots(librarySnapshot openSubsonicLibrarySnapshot, recordsByPath map[string]musicBrainzTagTrackRecord) []openSubsonicTrackMetadataSnapshot {
	tracks := make([]openSubsonicTrackMetadataSnapshot, 0, len(librarySnapshot.Tracks))
	for _, indexedTrack := range librarySnapshot.Tracks {
		tracks = append(tracks, openSubsonicTrackMetadataSnapshot{
			Root:   indexedTrack.Root,
			Track:  indexedTrack.Track,
			Record: recordsByPath[indexedTrack.Track.Path],
		})
	}

	return tracks
}

func openSubsonicTrackTitleFromSnapshot(snapshot openSubsonicTrackMetadataSnapshot) string {
	if title := strings.TrimSpace(snapshot.Record.Title); title != "" {
		return title
	}
	if title := strings.TrimSpace(snapshot.Track.CachedTrackTitle); title != "" {
		return title
	}
	relativePath := openSubsonicTrackRelativePath(snapshot.Root, snapshot.Track.RelativePath)
	title, _, _, _ := openSubsonicTrackFallbackFields(snapshot.Root, relativePath)
	return title
}

func openSubsonicAlbumTitleFromSnapshot(snapshot openSubsonicTrackMetadataSnapshot) string {
	if album := strings.TrimSpace(snapshot.Record.AlbumTitle); album != "" {
		return album
	}
	relativePath := openSubsonicTrackRelativePath(snapshot.Root, snapshot.Track.RelativePath)
	_, album, _, _ := openSubsonicTrackFallbackFields(snapshot.Root, relativePath)
	return album
}

func openSubsonicArtistNameFromSnapshot(snapshot openSubsonicTrackMetadataSnapshot) string {
	if artist := strings.TrimSpace(snapshot.Record.AlbumArtist); artist != "" {
		return artist
	}
	if artist := strings.TrimSpace(snapshot.Record.TrackArtist); artist != "" {
		return artist
	}
	if artist := strings.TrimSpace(snapshot.Track.CachedArtistName); artist != "" {
		return artist
	}
	relativePath := openSubsonicTrackRelativePath(snapshot.Root, snapshot.Track.RelativePath)
	_, _, artist, _ := openSubsonicTrackFallbackFields(snapshot.Root, relativePath)
	return artist
}

func openSubsonicTrackGenreFromRecord(record musicBrainzTagTrackRecord) string {
	if len(record.Genres) == 0 {
		return ""
	}

	return strings.TrimSpace(record.Genres[0])
}

func openSubsonicTrackGenresFromRecord(record musicBrainzTagTrackRecord) []string {
	if len(record.Genres) == 0 {
		return nil
	}

	genres := make([]string, 0, len(record.Genres))
	seen := make(map[string]struct{}, len(record.Genres))
	for _, rawGenre := range record.Genres {
		genre := strings.TrimSpace(rawGenre)
		if genre == "" {
			continue
		}
		key := strings.ToLower(genre)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		genres = append(genres, genre)
	}
	if len(genres) == 0 {
		return nil
	}

	return genres
}

func openSubsonicBuildGenres(browse *openSubsonicBrowseIndex) []openSubsonicGenre {
	if browse == nil || len(browse.Albums) == 0 {
		return []openSubsonicGenre{}
	}

	type genreAccumulator struct {
		songCount int
		albums    map[string]struct{}
	}

	genresByName := map[string]*genreAccumulator{}
	genreNames := make([]string, 0)
	for _, albumSnapshot := range browse.Albums {
		albumGenres := make(map[string]struct{})
		for _, trackSnapshot := range albumSnapshot.Tracks {
			for _, genre := range openSubsonicTrackGenresFromRecord(trackSnapshot.Record) {
				accumulator, exists := genresByName[genre]
				if !exists {
					accumulator = &genreAccumulator{albums: map[string]struct{}{}}
					genresByName[genre] = accumulator
					genreNames = append(genreNames, genre)
				}
				accumulator.songCount++
				albumGenres[genre] = struct{}{}
			}
		}
		for genre := range albumGenres {
			genresByName[genre].albums[albumSnapshot.Album.ID] = struct{}{}
		}
	}

	sort.SliceStable(genreNames, func(i int, j int) bool {
		left := strings.ToLower(genreNames[i])
		right := strings.ToLower(genreNames[j])
		if left == right {
			return genreNames[i] < genreNames[j]
		}
		return left < right
	})

	genres := make([]openSubsonicGenre, 0, len(genreNames))
	for _, genreName := range genreNames {
		accumulator := genresByName[genreName]
		genres = append(genres, openSubsonicGenre{
			Name:       genreName,
			SongCount:  accumulator.songCount,
			AlbumCount: len(accumulator.albums),
		})
	}

	return genres
}

func openSubsonicTrackYearFromRecord(record musicBrainzTagTrackRecord) int {
	return parseIntValue(record.Date)
}

func openSubsonicArtistKey(snapshot openSubsonicTrackMetadataSnapshot) string {
	browseArtistIDs := musicBrainzTagBrowseArtistIDs(snapshot.Record)
	if len(browseArtistIDs) > 0 {
		return snapshot.Root.Name + "|mbid|" + browseArtistIDs[0]
	}

	artistName := strings.ToLower(strings.TrimSpace(openSubsonicArtistNameFromSnapshot(snapshot)))
	if artistName != "" {
		return snapshot.Root.Name + "|name|" + artistName
	}

	return snapshot.Root.Name + "|folder|" + strings.ToLower(strings.TrimSpace(snapshot.Track.FolderPath))
}

func openSubsonicAlbumKey(snapshot openSubsonicTrackMetadataSnapshot) string {
	if releaseID := strings.TrimSpace(snapshot.Record.ReleaseID); releaseID != "" {
		return snapshot.Root.Name + "|release|" + releaseID
	}
	if releaseFolderPath := strings.TrimSpace(snapshot.Record.ReleaseFolderPath); releaseFolderPath != "" {
		return snapshot.Root.Name + "|folder|" + strings.ToLower(releaseFolderPath)
	}
	albumName := strings.ToLower(strings.TrimSpace(openSubsonicAlbumTitleFromSnapshot(snapshot)))
	date := strings.ToLower(strings.TrimSpace(snapshot.Record.Date))
	return openSubsonicArtistKey(snapshot) + "|album|" + albumName + "|date|" + date
}

func openSubsonicAlbumFolderPath(snapshot openSubsonicTrackMetadataSnapshot) string {
	if folderPath := strings.TrimSpace(snapshot.Record.ReleaseFolderPath); folderPath != "" {
		return folderPath
	}

	return strings.TrimSpace(snapshot.Track.FolderPath)
}

func openSubsonicArtistFolderPath(snapshot openSubsonicTrackMetadataSnapshot) string {
	if len(snapshot.Record.ArtistFolderPaths) > 0 {
		return strings.TrimSpace(snapshot.Record.ArtistFolderPaths[0])
	}

	albumFolderPath := openSubsonicAlbumFolderPath(snapshot)
	if albumFolderPath == "" {
		return snapshot.Root.Name
	}
	artistFolderPath := pathpkg.Dir(albumFolderPath)
	if artistFolderPath == "." || artistFolderPath == "" {
		return snapshot.Root.Name
	}

	return artistFolderPath
}

func openSubsonicTrackLess(left openSubsonicTrackMetadataSnapshot, right openSubsonicTrackMetadataSnapshot) bool {
	if left.Record.DiscNumber != right.Record.DiscNumber {
		if left.Record.DiscNumber == 0 {
			return false
		}
		if right.Record.DiscNumber == 0 {
			return true
		}
		return left.Record.DiscNumber < right.Record.DiscNumber
	}
	if left.Record.TrackNumber != right.Record.TrackNumber {
		if left.Record.TrackNumber == 0 {
			return false
		}
		if right.Record.TrackNumber == 0 {
			return true
		}
		return left.Record.TrackNumber < right.Record.TrackNumber
	}
	leftTitle := strings.ToLower(openSubsonicTrackTitleFromSnapshot(left))
	rightTitle := strings.ToLower(openSubsonicTrackTitleFromSnapshot(right))
	if leftTitle == rightTitle {
		return strings.ToLower(left.Track.RelativePath) < strings.ToLower(right.Track.RelativePath)
	}

	return leftTitle < rightTitle
}

func openSubsonicBuildAlbumSnapshots(librarySnapshot openSubsonicLibrarySnapshot, trackSnapshots []openSubsonicTrackMetadataSnapshot) []openSubsonicAlbumSnapshot {
	if len(trackSnapshots) == 0 {
		return []openSubsonicAlbumSnapshot{}
	}

	type albumAccumulator struct {
		snapshot openSubsonicAlbumSnapshot
	}

	albumsByKey := make(map[string]*albumAccumulator, len(trackSnapshots))
	albumOrder := make([]string, 0, len(trackSnapshots))
	for _, trackSnapshot := range trackSnapshots {
		albumKey := openSubsonicAlbumKey(trackSnapshot)
		albumFolderPath := openSubsonicAlbumFolderPath(trackSnapshot)
		artistKey := openSubsonicArtistKey(trackSnapshot)
		artistName := openSubsonicArtistNameFromSnapshot(trackSnapshot)
		albumName := openSubsonicAlbumTitleFromSnapshot(trackSnapshot)
		modifiedAt := trackSnapshot.Track.ModifiedAtMs

		accumulator, exists := albumsByKey[albumKey]
		if !exists {
			coverArt := ""
			if _, ok := librarySnapshot.CoverFolders[strings.ToLower(albumFolderPath)]; ok {
				coverArt = openSubsonicFolderCoverID(albumFolderPath)
			}
			album := openSubsonicAlbum{
				ID:       openSubsonicAlbumID(albumKey),
				Parent:   openSubsonicArtistID(artistKey),
				IsDir:    true,
				Title:    albumName,
				Name:     albumName,
				Album:    albumName,
				Artist:   artistName,
				ArtistID: openSubsonicArtistID(artistKey),
				CoverArt: coverArt,
			}
			accumulator = &albumAccumulator{snapshot: openSubsonicAlbumSnapshot{
				Album:      album,
				ModifiedAt: modifiedAt,
				Root:       trackSnapshot.Root,
				FolderPath: albumFolderPath,
				ArtistKey:  artistKey,
				ArtistName: artistName,
				Tracks:     []openSubsonicTrackMetadataSnapshot{},
			}}
			albumsByKey[albumKey] = accumulator
			albumOrder = append(albumOrder, albumKey)
		}

		accumulator.snapshot.Tracks = append(accumulator.snapshot.Tracks, trackSnapshot)
		if modifiedAt > accumulator.snapshot.ModifiedAt {
			accumulator.snapshot.ModifiedAt = modifiedAt
		}
		if year := openSubsonicTrackYearFromRecord(trackSnapshot.Record); accumulator.snapshot.Album.Year == 0 && year > 0 {
			accumulator.snapshot.Album.Year = year
		}
		if genre := openSubsonicTrackGenreFromRecord(trackSnapshot.Record); accumulator.snapshot.Album.Genre == "" && genre != "" {
			accumulator.snapshot.Album.Genre = genre
		}
		if trackSnapshot.Record.DurationSeconds > 0 {
			accumulator.snapshot.Album.Duration += int(trackSnapshot.Record.DurationSeconds + 0.5)
		}
		accumulator.snapshot.Album.SongCount++
	}

	albums := make([]openSubsonicAlbumSnapshot, 0, len(albumOrder))
	for _, albumKey := range albumOrder {
		albumSnapshot := albumsByKey[albumKey].snapshot
		sort.SliceStable(albumSnapshot.Tracks, func(i int, j int) bool {
			return openSubsonicTrackLess(albumSnapshot.Tracks[i], albumSnapshot.Tracks[j])
		})
		if albumSnapshot.ModifiedAt > 0 {
			albumSnapshot.Album.Created = time.UnixMilli(albumSnapshot.ModifiedAt).UTC().Format(time.RFC3339Nano)
		}
		albums = append(albums, albumSnapshot)
	}

	return albums
}

func openSubsonicBuildArtistSnapshots(albums []openSubsonicAlbumSnapshot) []openSubsonicArtistSnapshot {
	if len(albums) == 0 {
		return []openSubsonicArtistSnapshot{}
	}

	type artistAccumulator struct {
		snapshot openSubsonicArtistSnapshot
	}

	artistsByKey := make(map[string]*artistAccumulator, len(albums))
	artistOrder := make([]string, 0, len(albums))
	for _, albumSnapshot := range albums {
		accumulator, exists := artistsByKey[albumSnapshot.ArtistKey]
		if !exists {
			artist := openSubsonicArtist{
				ID:       openSubsonicArtistID(albumSnapshot.ArtistKey),
				Name:     albumSnapshot.ArtistName,
				CoverArt: albumSnapshot.Album.CoverArt,
			}
			accumulator = &artistAccumulator{snapshot: openSubsonicArtistSnapshot{
				Artist:     artist,
				ModifiedAt: albumSnapshot.ModifiedAt,
				Root:       albumSnapshot.Root,
				FolderPath: openSubsonicArtistFolderPath(albumSnapshot.Tracks[0]),
				Albums:     []openSubsonicAlbumSnapshot{},
			}}
			artistsByKey[albumSnapshot.ArtistKey] = accumulator
			artistOrder = append(artistOrder, albumSnapshot.ArtistKey)
		}

		accumulator.snapshot.Albums = append(accumulator.snapshot.Albums, albumSnapshot)
		if albumSnapshot.ModifiedAt > accumulator.snapshot.ModifiedAt {
			accumulator.snapshot.ModifiedAt = albumSnapshot.ModifiedAt
		}
		if accumulator.snapshot.Artist.CoverArt == "" && albumSnapshot.Album.CoverArt != "" {
			accumulator.snapshot.Artist.CoverArt = albumSnapshot.Album.CoverArt
		}
	}

	artists := make([]openSubsonicArtistSnapshot, 0, len(artistOrder))
	for _, artistKey := range artistOrder {
		artistSnapshot := artistsByKey[artistKey].snapshot
		sort.SliceStable(artistSnapshot.Albums, func(i int, j int) bool {
			left := strings.ToLower(artistSnapshot.Albums[i].Album.Name)
			right := strings.ToLower(artistSnapshot.Albums[j].Album.Name)
			if left == right {
				return artistSnapshot.Albums[i].ModifiedAt > artistSnapshot.Albums[j].ModifiedAt
			}
			return left < right
		})
		artistSnapshot.Artist.AlbumCount = len(artistSnapshot.Albums)
		artistSnapshot.Artist.Album = make([]openSubsonicAlbum, 0, len(artistSnapshot.Albums))
		for _, albumSnapshot := range artistSnapshot.Albums {
			artistSnapshot.Artist.Album = append(artistSnapshot.Artist.Album, albumSnapshot.Album)
		}
		artists = append(artists, artistSnapshot)
	}

	return artists
}

func openSubsonicAlbumListAlphabeticalLess(left openSubsonicAlbumListEntry, right openSubsonicAlbumListEntry) bool {
	leftName := strings.ToLower(strings.TrimSpace(left.Album.Name))
	rightName := strings.ToLower(strings.TrimSpace(right.Album.Name))
	if leftName == rightName {
		return left.Album.ID < right.Album.ID
	}

	return leftName < rightName
}

func openSubsonicAlbumListNewestLess(left openSubsonicAlbumListEntry, right openSubsonicAlbumListEntry) bool {
	if left.ModifiedAt == right.ModifiedAt {
		return openSubsonicAlbumListAlphabeticalLess(left, right)
	}

	return left.ModifiedAt > right.ModifiedAt
}

func (a *App) openSubsonicBuildAlbumListIndex() *openSubsonicAlbumListIndex {
	librarySnapshot := a.openSubsonicAlbumListLibrarySnapshot()
	recordsSnapshot := a.openSubsonicTrackRecordsSnapshot()

	type albumAccumulator struct {
		entry openSubsonicAlbumListEntry
	}

	albumsByKey := make(map[string]*albumAccumulator, len(librarySnapshot.Folders))
	albumOrder := make([]string, 0, len(librarySnapshot.Folders))
	for _, folderSnapshot := range librarySnapshot.Folders {
		record := recordsSnapshot.ByPath[folderSnapshot.RepresentativeTrack.Path]
		snapshot := openSubsonicTrackMetadataSnapshot{Root: folderSnapshot.Root, Track: folderSnapshot.RepresentativeTrack, Record: record}
		albumKey := openSubsonicAlbumKey(snapshot)
		modifiedAt := folderSnapshot.ModifiedAt

		accumulator, exists := albumsByKey[albumKey]
		if !exists {
			albumFolderPath := openSubsonicAlbumFolderPath(snapshot)
			artistKey := openSubsonicArtistKey(snapshot)
			artistName := openSubsonicArtistNameFromSnapshot(snapshot)
			albumName := openSubsonicAlbumTitleFromSnapshot(snapshot)
			coverArt := ""
			if _, ok := librarySnapshot.CoverFolders[strings.ToLower(strings.TrimSpace(albumFolderPath))]; ok {
				coverArt = openSubsonicFolderCoverID(albumFolderPath)
			}

			accumulator = &albumAccumulator{entry: openSubsonicAlbumListEntry{
				Album: openSubsonicAlbum{
					ID:       openSubsonicAlbumID(albumKey),
					Parent:   openSubsonicArtistID(artistKey),
					IsDir:    true,
					Title:    albumName,
					Name:     albumName,
					Album:    albumName,
					Artist:   artistName,
					ArtistID: openSubsonicArtistID(artistKey),
					CoverArt: coverArt,
				},
				ModifiedAt: modifiedAt,
				RootName:   folderSnapshot.Root.Name,
			}}
			albumsByKey[albumKey] = accumulator
			albumOrder = append(albumOrder, albumKey)
		}

		if modifiedAt > accumulator.entry.ModifiedAt {
			accumulator.entry.ModifiedAt = modifiedAt
		}
		if year := openSubsonicTrackYearFromRecord(record); accumulator.entry.Album.Year == 0 && year > 0 {
			accumulator.entry.Album.Year = year
		}
		if genre := openSubsonicTrackGenreFromRecord(record); accumulator.entry.Album.Genre == "" && genre != "" {
			accumulator.entry.Album.Genre = genre
		}
		accumulator.entry.Album.SongCount += folderSnapshot.TrackCount
	}

	index := &openSubsonicAlbumListIndex{
		LibraryVersion:     librarySnapshot.LibraryVersion,
		MusicBrainzVersion: recordsSnapshot.Version,
		AlbumsNewest:       make([]openSubsonicAlbumListEntry, 0, len(albumOrder)),
		AlbumsAlphabetical: make([]openSubsonicAlbumListEntry, 0, len(albumOrder)),
	}
	for _, albumKey := range albumOrder {
		entry := albumsByKey[albumKey].entry
		if entry.ModifiedAt > 0 {
			entry.Album.Created = time.UnixMilli(entry.ModifiedAt).UTC().Format(time.RFC3339Nano)
		}
		index.AlbumsNewest = append(index.AlbumsNewest, entry)
		index.AlbumsAlphabetical = append(index.AlbumsAlphabetical, entry)
	}

	sort.SliceStable(index.AlbumsNewest, func(i int, j int) bool {
		return openSubsonicAlbumListNewestLess(index.AlbumsNewest[i], index.AlbumsNewest[j])
	})
	sort.SliceStable(index.AlbumsAlphabetical, func(i int, j int) bool {
		return openSubsonicAlbumListAlphabeticalLess(index.AlbumsAlphabetical[i], index.AlbumsAlphabetical[j])
	})

	return index
}

func (a *App) openSubsonicAlbumListIndex() *openSubsonicAlbumListIndex {
	libraryVersion := a.openSubsonicLibraryVersion()
	musicBrainzVersion := a.musicBrainzTagVersion.Load()
	workerProgress := a.musicBrainzTagWorkerProgressSnapshot()

	for {
		a.openSubsonicAlbumListMu.Lock()

		if a.openSubsonicAlbumList != nil && a.openSubsonicAlbumList.LibraryVersion == libraryVersion {
			if a.openSubsonicAlbumList.MusicBrainzVersion == musicBrainzVersion || workerProgress.Active {
				albumList := a.openSubsonicAlbumList
				a.openSubsonicAlbumListMu.Unlock()
				return albumList
			}
		}

		if buildCh := a.openSubsonicAlbumListCh; buildCh != nil {
			a.openSubsonicAlbumListMu.Unlock()
			<-buildCh
			libraryVersion = a.openSubsonicLibraryVersion()
			musicBrainzVersion = a.musicBrainzTagVersion.Load()
			workerProgress = a.musicBrainzTagWorkerProgressSnapshot()
			continue
		}

		buildCh := make(chan struct{})
		a.openSubsonicAlbumListCh = buildCh
		a.openSubsonicAlbumListMu.Unlock()

		albumList := a.openSubsonicBuildAlbumListIndex()

		a.openSubsonicAlbumListMu.Lock()
		a.openSubsonicAlbumList = albumList
		if a.openSubsonicAlbumListCh == buildCh {
			a.openSubsonicAlbumListCh = nil
			close(buildCh)
		}
		a.openSubsonicAlbumListMu.Unlock()
		return albumList
	}
}

func (a *App) openSubsonicWriteAlbumListJSONKeepAlive(w http.ResponseWriter, r *http.Request) {
	if openSubsonicFormatFromRequest(r) != "json" {
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if _, err := io.WriteString(w, "\n"); err != nil {
		return
	}
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (a *App) openSubsonicBuildBrowseIndex() *openSubsonicBrowseIndex {
	librarySnapshot := a.openSubsonicLibrarySnapshot()
	recordsSnapshot := a.openSubsonicTrackRecordsSnapshot()
	trackSnapshots := openSubsonicTrackMetadataSnapshots(librarySnapshot, recordsSnapshot.ByPath)
	albums := openSubsonicBuildAlbumSnapshots(librarySnapshot, trackSnapshots)
	artists := openSubsonicBuildArtistSnapshots(albums)

	browse := &openSubsonicBrowseIndex{
		LibraryVersion:     librarySnapshot.LibraryVersion,
		MusicBrainzVersion: recordsSnapshot.Version,
		Roots:              append([]libraryRootConfig(nil), librarySnapshot.Roots...),
		RootsByName:        make(map[string]libraryRootConfig, len(librarySnapshot.RootsByName)),
		CoverFolders:       make(map[string]struct{}, len(librarySnapshot.CoverFolders)),
		Tracks:             append([]openSubsonicTrackMetadataSnapshot(nil), trackSnapshots...),
		TracksBySongID:     make(map[string]openSubsonicTrackMetadataSnapshot, len(trackSnapshots)),
		TracksByFolder:     make(map[string][]openSubsonicTrackMetadataSnapshot),
		Albums:             append([]openSubsonicAlbumSnapshot(nil), albums...),
		AlbumsByID:         make(map[string]openSubsonicAlbumSnapshot, len(albums)),
		AlbumByFolder:      make(map[string]openSubsonicAlbumSnapshot, len(albums)),
		Artists:            append([]openSubsonicArtistSnapshot(nil), artists...),
		ArtistsByID:        make(map[string]openSubsonicArtistSnapshot, len(artists)),
		ArtistByFolder:     make(map[string]openSubsonicArtistSnapshot, len(artists)),
	}

	for rootName, root := range librarySnapshot.RootsByName {
		browse.RootsByName[rootName] = root
	}
	for folderPath := range librarySnapshot.CoverFolders {
		browse.CoverFolders[folderPath] = struct{}{}
	}
	for _, trackSnapshot := range trackSnapshots {
		songID := openSubsonicSongID(trackSnapshot.Track.RelativePath)
		browse.TracksBySongID[songID] = trackSnapshot
		folderKey := openSubsonicNormalizedLookupKey(trackSnapshot.Track.FolderPath)
		browse.TracksByFolder[folderKey] = append(browse.TracksByFolder[folderKey], trackSnapshot)
	}
	for folderKey, tracks := range browse.TracksByFolder {
		sort.SliceStable(tracks, func(i int, j int) bool {
			return openSubsonicTrackLess(tracks[i], tracks[j])
		})
		browse.TracksByFolder[folderKey] = tracks
	}
	for _, albumSnapshot := range albums {
		browse.AlbumsByID[albumSnapshot.Album.ID] = albumSnapshot
		if folderKey := openSubsonicNormalizedLookupKey(albumSnapshot.FolderPath); folderKey != "" {
			browse.AlbumByFolder[folderKey] = albumSnapshot
		}
	}
	for _, artistSnapshot := range artists {
		browse.ArtistsByID[artistSnapshot.Artist.ID] = artistSnapshot
		if folderKey := openSubsonicNormalizedLookupKey(artistSnapshot.FolderPath); folderKey != "" {
			browse.ArtistByFolder[folderKey] = artistSnapshot
		}
	}

	return browse
}

func (a *App) openSubsonicBrowseIndex() *openSubsonicBrowseIndex {
	libraryVersion := a.openSubsonicLibraryVersion()
	musicBrainzVersion := a.musicBrainzTagVersion.Load()
	workerProgress := a.musicBrainzTagWorkerProgressSnapshot()

	a.openSubsonicBrowseMu.Lock()
	defer a.openSubsonicBrowseMu.Unlock()

	if a.openSubsonicBrowse != nil && a.openSubsonicBrowse.LibraryVersion == libraryVersion {
		if a.openSubsonicBrowse.MusicBrainzVersion == musicBrainzVersion || workerProgress.Active {
			return a.openSubsonicBrowse
		}
	}

	a.openSubsonicBrowse = a.openSubsonicBuildBrowseIndex()
	return a.openSubsonicBrowse
}

func (a *App) openSubsonicResolveTrackPath(roots []libraryRootConfig, virtualTrackPath string) (string, bool) {
	_, _, absoluteTrackPath, ok := openSubsonicResolveAbsolutePath(roots, virtualTrackPath)
	if !ok || !isAudioPath(absoluteTrackPath) {
		return "", false
	}

	return absoluteTrackPath, true
}

func (a *App) openSubsonicResolveCoverArtSource(browse *openSubsonicBrowseIndex, requestedID string) (string, string, bool) {
	if browse == nil {
		browse = a.openSubsonicBrowseIndex()
	}

	decodedID, kind, ok := openSubsonicDecodeIDWithAliases(
		requestedID,
		openSubsonicIDKindFolderCover,
		openSubsonicIDKindTrackCover,
		openSubsonicIDKindAlbum,
		openSubsonicIDKindArtist,
		openSubsonicIDKindSong,
		openSubsonicIDKindDirectory,
	)
	if !ok {
		return "", "", false
	}

	useTrackSnapshot := func(trackSnapshot openSubsonicTrackMetadataSnapshot) (string, string, bool) {
		if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(trackSnapshot.Track.FolderPath)); coverPath != "" {
			return trackSnapshot.Track.FolderPath, "", true
		}
		if strings.TrimSpace(trackSnapshot.Track.Path) != "" {
			return "", trackSnapshot.Track.Path, true
		}
		absoluteTrackPath, ok := a.openSubsonicResolveTrackPath(browse.Roots, trackSnapshot.Track.RelativePath)
		if !ok {
			return "", "", false
		}
		return "", absoluteTrackPath, true
	}

	switch kind {
	case openSubsonicIDKindFolderCover:
		if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(decodedID)); coverPath != "" {
			return decodedID, "", true
		}
	case openSubsonicIDKindTrackCover:
		if trackSnapshot, exists := browse.TracksBySongID[openSubsonicSongID(decodedID)]; exists {
			return useTrackSnapshot(trackSnapshot)
		}
		if absoluteTrackPath, ok := a.openSubsonicResolveTrackPath(browse.Roots, decodedID); ok {
			return "", absoluteTrackPath, true
		}
	case openSubsonicIDKindSong:
		if trackSnapshot, exists := browse.TracksBySongID[openSubsonicSongID(decodedID)]; exists {
			return useTrackSnapshot(trackSnapshot)
		}
		if absoluteTrackPath, ok := a.openSubsonicResolveTrackPath(browse.Roots, decodedID); ok {
			return "", absoluteTrackPath, true
		}
	case openSubsonicIDKindAlbum:
		if albumSnapshot, exists := browse.AlbumsByID[openSubsonicAlbumID(decodedID)]; exists {
			if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(albumSnapshot.FolderPath)); coverPath != "" {
				return albumSnapshot.FolderPath, "", true
			}
			if len(albumSnapshot.Tracks) > 0 {
				return useTrackSnapshot(albumSnapshot.Tracks[0])
			}
		}
	case openSubsonicIDKindArtist:
		if artistSnapshot, exists := browse.ArtistsByID[openSubsonicArtistID(decodedID)]; exists {
			if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(artistSnapshot.FolderPath)); coverPath != "" {
				return artistSnapshot.FolderPath, "", true
			}
			for _, albumSnapshot := range artistSnapshot.Albums {
				if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(albumSnapshot.FolderPath)); coverPath != "" {
					return albumSnapshot.FolderPath, "", true
				}
				if len(albumSnapshot.Tracks) > 0 {
					return useTrackSnapshot(albumSnapshot.Tracks[0])
				}
			}
		}
	case openSubsonicIDKindDirectory:
		if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(decodedID)); coverPath != "" {
			return decodedID, "", true
		}
		if albumSnapshot, exists := browse.AlbumByFolder[openSubsonicNormalizedLookupKey(decodedID)]; exists {
			if len(albumSnapshot.Tracks) > 0 {
				return useTrackSnapshot(albumSnapshot.Tracks[0])
			}
		}
		if trackSnapshots, exists := browse.TracksByFolder[openSubsonicNormalizedLookupKey(decodedID)]; exists && len(trackSnapshots) > 0 {
			return useTrackSnapshot(trackSnapshots[0])
		}
	}

	return "", "", false
}

func (a *App) openSubsonicBuildBrowseChild(parentID string, id string, title string, coverArt string) openSubsonicChild {
	return openSubsonicChild{
		ID:       id,
		Parent:   parentID,
		IsDir:    true,
		Title:    strings.TrimSpace(title),
		CoverArt: strings.TrimSpace(coverArt),
	}
}

func (a *App) openSubsonicBuildTrackChild(parentID string, snapshot openSubsonicTrackMetadataSnapshot, coverFolders map[string]struct{}) openSubsonicChild {
	relativePath := openSubsonicTrackRelativePath(snapshot.Root, snapshot.Track.RelativePath)
	_, fallbackAlbum, fallbackArtist, virtualFolderPath := openSubsonicTrackFallbackFields(snapshot.Root, relativePath)
	trackTitle := openSubsonicTrackTitleFromSnapshot(snapshot)
	album := openSubsonicAlbumTitleFromSnapshot(snapshot)
	if album == "" {
		album = fallbackAlbum
	}
	artist := openSubsonicArtistNameFromSnapshot(snapshot)
	if artist == "" {
		artist = fallbackArtist
	}
	coverArt := ""
	if _, ok := coverFolders[strings.ToLower(strings.TrimSpace(virtualFolderPath))]; ok {
		coverArt = openSubsonicFolderCoverID(virtualFolderPath)
	} else {
		coverArt = a.openSubsonicTrackCoverIDForPath(virtualFolderPath, snapshot.Track.RelativePath, snapshot.Track.Path)
	}

	child := openSubsonicChild{
		ID:            openSubsonicSongID(snapshot.Track.RelativePath),
		Parent:        parentID,
		IsDir:         false,
		Title:         trackTitle,
		Album:         album,
		Artist:        artist,
		AlbumID:       openSubsonicAlbumID(openSubsonicAlbumKey(snapshot)),
		ArtistID:      openSubsonicArtistID(openSubsonicArtistKey(snapshot)),
		CoverArt:      coverArt,
		ContentType:   openSubsonicContentType(snapshot.Track.Path),
		Suffix:        strings.TrimPrefix(strings.ToLower(filepath.Ext(snapshot.Track.Path)), "."),
		BitRate:       openSubsonicBitrateKbps(snapshot.Record.BitRate),
		BitDepth:      snapshot.Record.BitDepth,
		SamplingRate:  snapshot.Record.SampleRate,
		ChannelCount:  snapshot.Record.Channels,
		Path:          relativePath,
		Type:          openSubsonicMediaTypeMusic,
		MediaType:     openSubsonicMediaTypeSong,
		MusicBrainzID: strings.TrimSpace(snapshot.Record.RecordingID),
	}

	if snapshot.Record.FileSizeBytes > 0 {
		child.Size = snapshot.Record.FileSizeBytes
	}
	if child.Size == 0 {
		if info, err := os.Stat(snapshot.Track.Path); err == nil {
			child.Size = info.Size()
			if !info.ModTime().IsZero() {
				child.Created = info.ModTime().UTC().Format(time.RFC3339Nano)
			}
		}
	} else if snapshot.Track.ModifiedAtMs > 0 {
		child.Created = time.UnixMilli(snapshot.Track.ModifiedAtMs).UTC().Format(time.RFC3339Nano)
	}
	if snapshot.Record.DurationSeconds > 0 {
		child.Duration = int(snapshot.Record.DurationSeconds + 0.5)
	}
	if snapshot.Record.TrackNumber > 0 {
		child.Track = snapshot.Record.TrackNumber
	}
	if year := openSubsonicTrackYearFromRecord(snapshot.Record); year > 0 {
		child.Year = year
	}
	if genre := openSubsonicTrackGenreFromRecord(snapshot.Record); genre != "" {
		child.Genre = genre
	}

	return child
}

func openSubsonicRequestedSize(values url.Values) int {
	size, _ := strconv.Atoi(strings.TrimSpace(values.Get("size")))
	if size <= 0 {
		return 0
	}
	if size > maxImageThumbnailMaxEdge {
		return maxImageThumbnailMaxEdge
	}
	return size
}

func openSubsonicRequestedStreamOptions(values url.Values) openSubsonicStreamOptions {
	requestedFormat := strings.ToLower(strings.TrimSpace(values.Get("format")))
	maxBitRate, _ := strconv.Atoi(strings.TrimSpace(values.Get("maxBitRate")))
	timeOffset, _ := strconv.ParseFloat(strings.TrimSpace(values.Get("timeOffset")), 64)
	options := openSubsonicStreamOptions{
		Format:            requestedFormat,
		BitrateKbps:       normalizeRemoteLibraryTranscodingBitrateKbps(maxBitRate),
		TimeOffsetSeconds: timeOffset,
	}
	if options.TimeOffsetSeconds > 0 {
		options.RequiresTranscode = true
	}
	if requestedFormat != "" && requestedFormat != "raw" {
		options.RequiresTranscode = true
	}
	if maxBitRate > 0 {
		options.RequiresTranscode = true
	}

	return options
}

func openSubsonicTranscodeFormat(format string) (string, string, string, []string) {
	switch format {
	case "ogg", "opus":
		return "audio/ogg", "ogg", "ogg", []string{"-c:a", "libopus"}
	default:
		return "audio/mpeg", "mp3", "mp3", []string{"-c:a", "libmp3lame"}
	}
}

func openSubsonicCanFallbackToStaticTrack(options openSubsonicStreamOptions) bool {
	return options.TimeOffsetSeconds <= 0 && strings.TrimSpace(options.Format) == ""
}

func openSubsonicSetStreamHeaders(w http.ResponseWriter, contentType string, durationSeconds float64) {
	if strings.TrimSpace(contentType) != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if durationSeconds > 0 {
		w.Header().Set("X-Content-Duration", strconv.FormatFloat(durationSeconds, 'G', -1, 32))
	}
}

func openSubsonicServeStaticTrack(w http.ResponseWriter, r *http.Request, absoluteTrackPath string, durationSeconds float64) {
	file, err := os.Open(absoluteTrackPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}

	openSubsonicSetStreamHeaders(w, openSubsonicStreamContentType(absoluteTrackPath), durationSeconds)
	w.Header().Set("Accept-Ranges", "bytes")
	http.ServeContent(w, r, filepath.Base(absoluteTrackPath), info.ModTime(), file)
}

func (a *App) openSubsonicServeTrack(w http.ResponseWriter, r *http.Request, absoluteTrackPath string, options openSubsonicStreamOptions, durationSeconds float64) {
	if !options.RequiresTranscode {
		openSubsonicServeStaticTrack(w, r, absoluteTrackPath, durationSeconds)
		return
	}

	resolvedFFmpegPath, err := resolveFFmpegPath(a.settings.FFmpegPath)
	if err != nil {
		openSubsonicServeStaticTrack(w, r, absoluteTrackPath, durationSeconds)
		return
	}
	if !tryAcquireRemoteLibraryTranscodeSlot() {
		writeOpenSubsonicError(w, r, openSubsonicErrorGeneric, "transcode capacity reached", "")
		return
	}
	defer releaseRemoteLibraryTranscodeSlot()

	contentType, formatName, _, codecArgs := openSubsonicTranscodeFormat(options.Format)
	if options.BitrateKbps <= 0 {
		options.BitrateKbps = defaultRemoteLibraryTranscodingBitrateKbps
	}

	commandArgs := []string{"-v", "error", "-nostdin"}
	if options.TimeOffsetSeconds > 0 {
		commandArgs = append(commandArgs, "-ss", fmt.Sprintf("%.3f", options.TimeOffsetSeconds))
	}
	commandArgs = append(commandArgs,
		"-i", absoluteTrackPath,
		"-map", "0:a:0",
		"-vn",
		"-sn",
		"-dn",
	)
	commandArgs = append(commandArgs, codecArgs...)
	commandArgs = append(commandArgs,
		"-b:a", fmt.Sprintf("%dk", options.BitrateKbps),
		"-f", formatName,
		"pipe:1",
	)

	command := exec.CommandContext(r.Context(), resolvedFFmpegPath, commandArgs...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		logOpenSubsonicEvent("transcode stdout pipe failed path=%q err=%v", absoluteTrackPath, err)
		openSubsonicServeStaticTrack(w, r, absoluteTrackPath, durationSeconds)
		return
	}
	stderr := &bytes.Buffer{}
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		logOpenSubsonicEvent("transcode start failed path=%q err=%v stderr=%q", absoluteTrackPath, err, strings.TrimSpace(stderr.String()))
		openSubsonicServeStaticTrack(w, r, absoluteTrackPath, durationSeconds)
		return
	}

	firstChunk := make([]byte, 32*1024)
	readCount, readErr := stdout.Read(firstChunk)
	if readCount == 0 {
		waitErr := command.Wait()
		if waitErr != nil && !errors.Is(waitErr, context.Canceled) {
			logOpenSubsonicEvent("transcode failed path=%q err=%v stderr=%q", absoluteTrackPath, waitErr, strings.TrimSpace(stderr.String()))
		} else if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, context.Canceled) {
			logOpenSubsonicEvent("transcode read failed path=%q err=%v stderr=%q", absoluteTrackPath, readErr, strings.TrimSpace(stderr.String()))
		}

		if openSubsonicCanFallbackToStaticTrack(options) {
			openSubsonicServeStaticTrack(w, r, absoluteTrackPath, durationSeconds)
			return
		}

		writeOpenSubsonicError(w, r, openSubsonicErrorGeneric, "transcode failed", "")
		return
	}

	openSubsonicSetStreamHeaders(w, contentType, durationSeconds)
	w.Header().Set("Accept-Ranges", "none")
	if _, err := w.Write(firstChunk[:readCount]); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return
	}
	if _, err := io.Copy(w, stdout); err != nil && !errors.Is(err, context.Canceled) {
		logOpenSubsonicEvent("transcode stream copy failed path=%q err=%v stderr=%q", absoluteTrackPath, err, strings.TrimSpace(stderr.String()))
	}
	if err := command.Wait(); err != nil && !errors.Is(err, context.Canceled) {
		logOpenSubsonicEvent("transcode failed path=%q err=%v stderr=%q", absoluteTrackPath, err, strings.TrimSpace(stderr.String()))
	}
}

func (a *App) handleOpenSubsonicREST(w http.ResponseWriter, r *http.Request) {
	loggedWriter := &openSubsonicLoggingResponseWriter{ResponseWriter: w}
	startedAt := time.Now()
	rawQuery := openSubsonicSanitizedQuery(openSubsonicLoggableRequestValues(r))
	defer func() {
		durationMs := time.Since(startedAt).Milliseconds()
		logOpenSubsonicEvent(
			"request method=%s path=%q query=%q remote=%q ua=%q status=%d bytes=%d duration_ms=%d",
			r.Method,
			r.URL.Path,
			rawQuery,
			r.RemoteAddr,
			strings.TrimSpace(r.UserAgent()),
			loggedWriter.StatusCode(),
			loggedWriter.bytesWritten,
			durationMs,
		)
	}()

	endpoint := strings.TrimPrefix(r.URL.Path, openSubsonicRESTPrefix)
	if endpoint == r.URL.Path {
		http.NotFound(loggedWriter, r)
		return
	}
	endpoint = strings.TrimSuffix(endpoint, ".view")
	endpoint = strings.Trim(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		logOpenSubsonicEvent("request rejected endpoint=%q code=%d message=%q", endpoint, openSubsonicErrorNotFound, "endpoint not found")
		writeOpenSubsonicError(loggedWriter, r, openSubsonicErrorNotFound, "endpoint not found", "")
		return
	}

	values, err := openSubsonicRequestValues(r)
	if err != nil {
		logOpenSubsonicEvent("request rejected endpoint=%q code=%d message=%q", endpoint, openSubsonicErrorGeneric, err.Error())
		writeOpenSubsonicError(loggedWriter, r, openSubsonicErrorGeneric, err.Error(), "")
		return
	}
	normalizeOpenSubsonicCommonParams(values, r.UserAgent())

	if endpoint != "getOpenSubsonicExtensions" {
		if validationErr := validateOpenSubsonicCommonParams(values); validationErr != nil {
			logOpenSubsonicEvent("request rejected endpoint=%q code=%d message=%q", endpoint, validationErr.Code, validationErr.Message)
			writeOpenSubsonicError(loggedWriter, r, validationErr.Code, validationErr.Message, validationErr.HelpURL)
			return
		}
		if authErr := a.authenticateOpenSubsonic(values); authErr != nil {
			logOpenSubsonicEvent("request rejected endpoint=%q code=%d message=%q", endpoint, authErr.Code, authErr.Message)
			writeOpenSubsonicError(loggedWriter, r, authErr.Code, authErr.Message, authErr.HelpURL)
			return
		}
	}

	switch endpoint {
	case "ping":
		a.handleOpenSubsonicPing(loggedWriter, r)
	case "getLicense":
		a.handleOpenSubsonicGetLicense(loggedWriter, r)
	case "getOpenSubsonicExtensions":
		a.handleOpenSubsonicGetExtensions(loggedWriter, r)
	case "getLyrics":
		a.handleOpenSubsonicGetLyrics(loggedWriter, r, values)
	case "getMusicFolders":
		a.handleOpenSubsonicGetMusicFolders(loggedWriter, r)
	case "getGenres":
		a.handleOpenSubsonicGetGenres(loggedWriter, r)
	case "getIndexes":
		a.handleOpenSubsonicGetIndexes(loggedWriter, r, values)
	case "getArtists":
		a.handleOpenSubsonicGetArtists(loggedWriter, r, values)
	case "getMusicDirectory":
		a.handleOpenSubsonicGetMusicDirectory(loggedWriter, r, values)
	case "getArtist":
		a.handleOpenSubsonicGetArtist(loggedWriter, r, values)
	case "getAlbum":
		a.handleOpenSubsonicGetAlbum(loggedWriter, r, values)
	case "getSong":
		a.handleOpenSubsonicGetSong(loggedWriter, r, values)
	case "search":
		a.handleOpenSubsonicSearch(loggedWriter, r, values)
	case "search2":
		a.handleOpenSubsonicSearch2(loggedWriter, r, values)
	case "search3":
		a.handleOpenSubsonicSearch3(loggedWriter, r, values)
	case "getUser":
		a.handleOpenSubsonicGetUser(loggedWriter, r, values)
	case "getAlbumList2":
		a.handleOpenSubsonicGetAlbumList2(loggedWriter, r, values)
	case "getPlaylists":
		a.handleOpenSubsonicGetPlaylists(loggedWriter, r)
	case "getPlaylist":
		a.handleOpenSubsonicGetPlaylist(loggedWriter, r, values)
	case "updatePlaylist":
		a.handleOpenSubsonicUpdatePlaylist(loggedWriter, r, values)
	case "getScanStatus":
		a.handleOpenSubsonicGetScanStatus(loggedWriter, r)
	case "getRandomSongs":
		a.handleOpenSubsonicGetRandomSongs(loggedWriter, r, values)
	case "getSimilarSongs":
		a.handleOpenSubsonicGetSimilarSongs(loggedWriter, r)
	case "getCoverArt":
		a.handleOpenSubsonicGetCoverArt(loggedWriter, r, values)
	case "scrobble":
		a.handleOpenSubsonicScrobble(loggedWriter, r, values)
	case "star":
		a.handleOpenSubsonicStar(loggedWriter, r, values)
	case "unstar":
		a.handleOpenSubsonicUnstar(loggedWriter, r, values)
	case "stream":
		a.handleOpenSubsonicStream(loggedWriter, r, values)
	case "download":
		a.handleOpenSubsonicDownload(loggedWriter, r, values)
	default:
		logOpenSubsonicEvent("request rejected endpoint=%q code=%d message=%q", endpoint, openSubsonicErrorNotFound, "endpoint not found")
		writeOpenSubsonicError(loggedWriter, r, openSubsonicErrorNotFound, "endpoint not found", "")
	}
}

func (a *App) handleOpenSubsonicPing(w http.ResponseWriter, r *http.Request) {
	writeOpenSubsonicResponse(w, r, newOpenSubsonicBaseResponse())
}

func (a *App) handleOpenSubsonicGetLicense(w http.ResponseWriter, r *http.Request) {
	response := newOpenSubsonicBaseResponse()
	response.License = &openSubsonicLicense{Valid: true}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetExtensions(w http.ResponseWriter, r *http.Request) {
	response := newOpenSubsonicBaseResponse()
	response.OpenSubsonicExtensions = []openSubsonicExtension{
		{Name: openSubsonicExtensionAPIKeyAuth, Versions: []int{openSubsonicExtensionVersion}},
		{Name: openSubsonicExtensionFormPost, Versions: []int{openSubsonicExtensionVersion}},
	}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetLyrics(w http.ResponseWriter, r *http.Request, values url.Values) {
	response := newOpenSubsonicBaseResponse()
	response.Lyrics = &openSubsonicLyrics{
		Artist: strings.TrimSpace(values.Get("artist")),
		Title:  strings.TrimSpace(values.Get("title")),
		Value:  "",
	}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetMusicFolders(w http.ResponseWriter, r *http.Request) {
	roots := a.openSubsonicLocalRootsSnapshot()
	folders := make([]openSubsonicMusicFolder, 0, len(roots))
	for _, root := range roots {
		folders = append(folders, openSubsonicMusicFolder{ID: openSubsonicMusicFolderID(root.Name), Name: root.Name})
	}

	response := newOpenSubsonicBaseResponse()
	response.MusicFolders = &openSubsonicMusicFolders{MusicFolder: folders}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetGenres(w http.ResponseWriter, r *http.Request) {
	response := newOpenSubsonicBaseResponse()
	response.Genres = &openSubsonicGenres{Genre: openSubsonicBuildGenres(a.openSubsonicBrowseIndex())}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicSearch(w http.ResponseWriter, r *http.Request, values url.Values) {
	browse := a.openSubsonicBrowseIndex()
	artistTerms := openSubsonicSearchTerms(values.Get("artist"))
	albumTerms := openSubsonicSearchTerms(values.Get("album"))
	titleTerms := openSubsonicSearchTerms(values.Get("title"))
	anyTerms := openSubsonicSearchTerms(values.Get("any"))
	offset := openSubsonicParseNonNegativeInt(values, "offset", 0)
	count := openSubsonicParseNonNegativeInt(values, "count", 20)
	newerThanMs, _ := strconv.ParseInt(strings.TrimSpace(values.Get("newerThan")), 10, 64)

	matches := make([]openSubsonicTrackMetadataSnapshot, 0)
	for _, trackSnapshot := range browse.Tracks {
		if openSubsonicLegacySearchMatches(trackSnapshot, artistTerms, albumTerms, titleTerms, anyTerms, newerThanMs) {
			matches = append(matches, trackSnapshot)
		}
	}
	sort.SliceStable(matches, func(i int, j int) bool {
		return openSubsonicSearchTrackLess(matches[i], matches[j])
	})

	start, end := openSubsonicClampWindow(len(matches), offset, count)
	searchMatches := make([]openSubsonicChild, 0, end-start)
	for _, trackSnapshot := range matches[start:end] {
		searchMatches = append(searchMatches, a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshot)), trackSnapshot, browse.CoverFolders))
	}

	response := newOpenSubsonicBaseResponse()
	response.SearchResult = &openSubsonicSearchResult{
		Offset:    offset,
		TotalHits: len(matches),
		Match:     searchMatches,
	}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicSearch2(w http.ResponseWriter, r *http.Request, values url.Values) {
	browse := a.openSubsonicBrowseIndex()
	selectedRoots, ok := openSubsonicSelectedRoots(browse.Roots, values.Get("musicFolderId"))
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "music folder not found", "")
		return
	}
	allowedRoots := openSubsonicAllowedRootNames(selectedRoots)
	artistMatches, albumMatches, trackMatches := openSubsonicCollectSearchMatches(browse, allowedRoots, values.Get("query"))

	artistOffset := openSubsonicParseNonNegativeInt(values, "artistOffset", 0)
	artistCount := openSubsonicParseNonNegativeInt(values, "artistCount", 20)
	artistStart, artistEnd := openSubsonicClampWindow(len(artistMatches), artistOffset, artistCount)
	artists := make([]openSubsonicArtist, 0, artistEnd-artistStart)
	for _, artistSnapshot := range artistMatches[artistStart:artistEnd] {
		artists = append(artists, artistSnapshot.Artist)
	}

	albumOffset := openSubsonicParseNonNegativeInt(values, "albumOffset", 0)
	albumCount := openSubsonicParseNonNegativeInt(values, "albumCount", 20)
	albumStart, albumEnd := openSubsonicClampWindow(len(albumMatches), albumOffset, albumCount)
	albums := make([]openSubsonicAlbum, 0, albumEnd-albumStart)
	for _, albumSnapshot := range albumMatches[albumStart:albumEnd] {
		albums = append(albums, albumSnapshot.Album)
	}

	songOffset := openSubsonicParseNonNegativeInt(values, "songOffset", 0)
	songCount := openSubsonicParseNonNegativeInt(values, "songCount", 20)
	songStart, songEnd := openSubsonicClampWindow(len(trackMatches), songOffset, songCount)
	songs := make([]openSubsonicChild, 0, songEnd-songStart)
	for _, trackSnapshot := range trackMatches[songStart:songEnd] {
		songs = append(songs, a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshot)), trackSnapshot, browse.CoverFolders))
	}

	response := newOpenSubsonicBaseResponse()
	response.SearchResult2 = &openSubsonicSearchResult2{Artist: artists, Album: albums, Song: songs}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicSearch3(w http.ResponseWriter, r *http.Request, values url.Values) {
	browse := a.openSubsonicBrowseIndex()
	selectedRoots, ok := openSubsonicSelectedRoots(browse.Roots, values.Get("musicFolderId"))
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "music folder not found", "")
		return
	}
	allowedRoots := openSubsonicAllowedRootNames(selectedRoots)
	artistMatches, albumMatches, trackMatches := openSubsonicCollectSearchMatches(browse, allowedRoots, values.Get("query"))

	artistOffset := openSubsonicParseNonNegativeInt(values, "artistOffset", 0)
	artistCount := openSubsonicParseNonNegativeInt(values, "artistCount", 20)
	artistStart, artistEnd := openSubsonicClampWindow(len(artistMatches), artistOffset, artistCount)
	artists := make([]openSubsonicArtist, 0, artistEnd-artistStart)
	for _, artistSnapshot := range artistMatches[artistStart:artistEnd] {
		artists = append(artists, artistSnapshot.Artist)
	}

	albumOffset := openSubsonicParseNonNegativeInt(values, "albumOffset", 0)
	albumCount := openSubsonicParseNonNegativeInt(values, "albumCount", 20)
	albumStart, albumEnd := openSubsonicClampWindow(len(albumMatches), albumOffset, albumCount)
	albums := make([]openSubsonicAlbum, 0, albumEnd-albumStart)
	for _, albumSnapshot := range albumMatches[albumStart:albumEnd] {
		albums = append(albums, albumSnapshot.Album)
	}

	songOffset := openSubsonicParseNonNegativeInt(values, "songOffset", 0)
	songCount := openSubsonicParseNonNegativeInt(values, "songCount", 20)
	songStart, songEnd := openSubsonicClampWindow(len(trackMatches), songOffset, songCount)
	songs := make([]openSubsonicChild, 0, songEnd-songStart)
	for _, trackSnapshot := range trackMatches[songStart:songEnd] {
		songs = append(songs, a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshot)), trackSnapshot, browse.CoverFolders))
	}

	response := newOpenSubsonicBaseResponse()
	response.SearchResult3 = &openSubsonicSearchResult3{Artist: artists, Album: albums, Song: songs}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetIndexes(w http.ResponseWriter, r *http.Request, values url.Values) {
	browse := a.openSubsonicBrowseIndex()
	roots := browse.Roots
	if len(roots) == 0 {
		response := newOpenSubsonicBaseResponse()
		response.Indexes = &openSubsonicIndexes{Index: []openSubsonicIndex{}, Child: []openSubsonicChild{}}
		writeOpenSubsonicResponse(w, r, response)
		return
	}

	selectedRoots := roots
	if requestedMusicFolderID := strings.TrimSpace(values.Get("musicFolderId")); requestedMusicFolderID != "" {
		rootName, ok := openSubsonicDecodeID(requestedMusicFolderID, openSubsonicIDKindMusicFolder)
		if !ok {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "music folder not found", "")
			return
		}
		root, ok := openSubsonicRootByName(roots, rootName)
		if !ok {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "music folder not found", "")
			return
		}
		selectedRoots = []libraryRootConfig{root}
	}

	allowedRoots := make(map[string]struct{}, len(selectedRoots))
	for _, root := range selectedRoots {
		allowedRoots[root.Name] = struct{}{}
	}
	artistSnapshots := browse.Artists
	groupedArtists := map[string][]openSubsonicArtistRef{}
	children := make([]openSubsonicChild, 0)
	lastModified := int64(0)
	for _, artistSnapshot := range artistSnapshots {
		if _, ok := allowedRoots[artistSnapshot.Root.Name]; !ok {
			continue
		}
		groupName := openSubsonicIndexGroupName(artistSnapshot.Artist.Name)
		groupedArtists[groupName] = append(groupedArtists[groupName], openSubsonicArtistRef{ID: artistSnapshot.Artist.ID, Name: artistSnapshot.Artist.Name})
		if artistSnapshot.ModifiedAt > lastModified {
			lastModified = artistSnapshot.ModifiedAt
		}
	}
	for _, trackSnapshot := range browse.Tracks {
		if _, ok := allowedRoots[trackSnapshot.Root.Name]; !ok {
			continue
		}
		children = append(children, a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshot)), trackSnapshot, browse.CoverFolders))
		if trackSnapshot.Track.ModifiedAtMs > lastModified {
			lastModified = trackSnapshot.Track.ModifiedAtMs
		}
	}

	groupNames := make([]string, 0, len(groupedArtists))
	for groupName := range groupedArtists {
		groupNames = append(groupNames, groupName)
	}
	sort.Strings(groupNames)

	indexes := make([]openSubsonicIndex, 0, len(groupNames))
	for _, groupName := range groupNames {
		artists := groupedArtists[groupName]
		sort.SliceStable(artists, func(i int, j int) bool {
			return strings.ToLower(artists[i].Name) < strings.ToLower(artists[j].Name)
		})
		indexes = append(indexes, openSubsonicIndex{Name: groupName, Artist: artists})
	}

	response := newOpenSubsonicBaseResponse()
	response.Indexes = &openSubsonicIndexes{
		Index:           indexes,
		Child:           children,
		LastModified:    lastModified,
		IgnoredArticles: "The El La Los Las Le Les",
	}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetArtists(w http.ResponseWriter, r *http.Request, values url.Values) {
	browse := a.openSubsonicBrowseIndex()
	roots := browse.Roots
	selectedRoots := roots
	if requestedMusicFolderID := strings.TrimSpace(values.Get("musicFolderId")); requestedMusicFolderID != "" {
		rootName, ok := openSubsonicDecodeID(requestedMusicFolderID, openSubsonicIDKindMusicFolder)
		if !ok {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "music folder not found", "")
			return
		}
		root, ok := openSubsonicRootByName(roots, rootName)
		if !ok {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "music folder not found", "")
			return
		}
		selectedRoots = []libraryRootConfig{root}
	}

	allowedRoots := make(map[string]struct{}, len(selectedRoots))
	for _, root := range selectedRoots {
		allowedRoots[root.Name] = struct{}{}
	}

	groupedArtists := map[string][]openSubsonicArtistRef{}
	for _, artistSnapshot := range browse.Artists {
		if _, ok := allowedRoots[artistSnapshot.Root.Name]; !ok {
			continue
		}
		groupName := openSubsonicIndexGroupName(artistSnapshot.Artist.Name)
		groupedArtists[groupName] = append(groupedArtists[groupName], openSubsonicArtistRef{ID: artistSnapshot.Artist.ID, Name: artistSnapshot.Artist.Name})
	}

	groupNames := make([]string, 0, len(groupedArtists))
	for groupName := range groupedArtists {
		groupNames = append(groupNames, groupName)
	}
	sort.Strings(groupNames)

	indexes := make([]openSubsonicIndex, 0, len(groupNames))
	for _, groupName := range groupNames {
		artists := groupedArtists[groupName]
		sort.SliceStable(artists, func(i int, j int) bool {
			return strings.ToLower(artists[i].Name) < strings.ToLower(artists[j].Name)
		})
		indexes = append(indexes, openSubsonicIndex{Name: groupName, Artist: artists})
	}

	response := newOpenSubsonicBaseResponse()
	response.Artists = &openSubsonicArtists{Index: indexes}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetMusicDirectory(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}

	browse := a.openSubsonicBrowseIndex()
	roots := browse.Roots
	if len(roots) == 0 {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "directory not found", "")
		return
	}

	if rootName, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindMusicFolder); ok {
		root, found := openSubsonicRootByName(roots, rootName)
		if !found {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "directory not found", "")
			return
		}
		children := make([]openSubsonicChild, 0)
		for _, artistSnapshot := range browse.Artists {
			if artistSnapshot.Root.Name != root.Name {
				continue
			}
			children = append(children, a.openSubsonicBuildBrowseChild(openSubsonicMusicFolderID(root.Name), artistSnapshot.Artist.ID, artistSnapshot.Artist.Name, artistSnapshot.Artist.CoverArt))
		}
		response := newOpenSubsonicBaseResponse()
		response.Directory = &openSubsonicDirectory{ID: requestedID, Name: root.Name, Child: children}
		writeOpenSubsonicResponse(w, r, response)
		return
	}

	if artistKey, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindArtist); ok {
		if artistSnapshot, exists := browse.ArtistsByID[openSubsonicArtistID(artistKey)]; exists {
			children := make([]openSubsonicChild, 0, len(artistSnapshot.Albums))
			for _, albumSnapshot := range artistSnapshot.Albums {
				children = append(children, a.openSubsonicBuildBrowseChild(artistSnapshot.Artist.ID, albumSnapshot.Album.ID, albumSnapshot.Album.Name, albumSnapshot.Album.CoverArt))
			}
			response := newOpenSubsonicBaseResponse()
			response.Directory = &openSubsonicDirectory{ID: requestedID, Parent: openSubsonicMusicFolderID(artistSnapshot.Root.Name), Name: artistSnapshot.Artist.Name, Child: children}
			writeOpenSubsonicResponse(w, r, response)
			return
		}
	}

	if albumKey, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindAlbum); ok {
		if albumSnapshot, exists := browse.AlbumsByID[openSubsonicAlbumID(albumKey)]; exists {
			children := make([]openSubsonicChild, 0, len(albumSnapshot.Tracks))
			for _, trackSnapshot := range albumSnapshot.Tracks {
				children = append(children, a.openSubsonicBuildTrackChild(albumSnapshot.Album.ID, trackSnapshot, browse.CoverFolders))
			}
			response := newOpenSubsonicBaseResponse()
			response.Directory = &openSubsonicDirectory{ID: requestedID, Parent: albumSnapshot.Album.Parent, Name: albumSnapshot.Album.Name, Child: children}
			writeOpenSubsonicResponse(w, r, response)
			return
		}
	}

	if decodedFolderPath, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindDirectory); ok {
		normalizedFolderPath, normalizeOK := normalizeLibraryRelativePath(decodedFolderPath)
		if !normalizeOK || normalizedFolderPath == "" {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "directory not found", "")
			return
		}
		folderKey := openSubsonicNormalizedLookupKey(normalizedFolderPath)
		if artistSnapshot, exists := browse.ArtistByFolder[folderKey]; exists {
			children := make([]openSubsonicChild, 0, len(artistSnapshot.Albums))
			for _, albumSnapshot := range artistSnapshot.Albums {
				children = append(children, a.openSubsonicBuildBrowseChild(requestedID, albumSnapshot.Album.ID, albumSnapshot.Album.Name, albumSnapshot.Album.CoverArt))
			}
			response := newOpenSubsonicBaseResponse()
			response.Directory = &openSubsonicDirectory{ID: requestedID, Parent: openSubsonicMusicFolderID(artistSnapshot.Root.Name), Name: artistSnapshot.Artist.Name, Child: children}
			writeOpenSubsonicResponse(w, r, response)
			return
		}
		if albumSnapshot, exists := browse.AlbumByFolder[folderKey]; exists {
			children := make([]openSubsonicChild, 0, len(albumSnapshot.Tracks))
			for _, trackSnapshot := range albumSnapshot.Tracks {
				children = append(children, a.openSubsonicBuildTrackChild(requestedID, trackSnapshot, browse.CoverFolders))
			}
			response := newOpenSubsonicBaseResponse()
			response.Directory = &openSubsonicDirectory{ID: requestedID, Parent: albumSnapshot.Album.Parent, Name: albumSnapshot.Album.Name, Child: children}
			writeOpenSubsonicResponse(w, r, response)
			return
		}
		if trackSnapshots, exists := browse.TracksByFolder[folderKey]; exists && len(trackSnapshots) > 0 {
			albumID := openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshots[0]))
			children := make([]openSubsonicChild, 0, len(trackSnapshots))
			for _, sibling := range trackSnapshots {
				children = append(children, a.openSubsonicBuildTrackChild(albumID, sibling, browse.CoverFolders))
			}
			response := newOpenSubsonicBaseResponse()
			response.Directory = &openSubsonicDirectory{ID: requestedID, Name: pathpkg.Base(normalizedFolderPath), Child: children}
			writeOpenSubsonicResponse(w, r, response)
			return
		}
	}

	writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "directory not found", "")
}

func (a *App) handleOpenSubsonicGetArtist(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}
	artistKey, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindArtist)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "artist not found", "")
		return
	}
	browse := a.openSubsonicBrowseIndex()
	if artistSnapshot, exists := browse.ArtistsByID[openSubsonicArtistID(artistKey)]; exists {
		response := newOpenSubsonicBaseResponse()
		artist := artistSnapshot.Artist
		artist.Album = make([]openSubsonicAlbum, 0, len(artistSnapshot.Albums))
		for _, albumSnapshot := range artistSnapshot.Albums {
			artist.Album = append(artist.Album, albumSnapshot.Album)
		}
		response.Artist = &artist
		writeOpenSubsonicResponse(w, r, response)
		return
	}
	writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "artist not found", "")
}

func (a *App) handleOpenSubsonicGetAlbum(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}
	albumKey, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindAlbum)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "album not found", "")
		return
	}
	browse := a.openSubsonicBrowseIndex()
	if albumSnapshot, exists := browse.AlbumsByID[openSubsonicAlbumID(albumKey)]; exists {
		album := openSubsonicAlbumDetails{
			ID:        albumSnapshot.Album.ID,
			Parent:    albumSnapshot.Album.Parent,
			IsDir:     albumSnapshot.Album.IsDir,
			Title:     albumSnapshot.Album.Title,
			Name:      albumSnapshot.Album.Name,
			Album:     albumSnapshot.Album.Album,
			Artist:    albumSnapshot.Album.Artist,
			ArtistID:  albumSnapshot.Album.ArtistID,
			CoverArt:  albumSnapshot.Album.CoverArt,
			Created:   albumSnapshot.Album.Created,
			Year:      albumSnapshot.Album.Year,
			Genre:     albumSnapshot.Album.Genre,
			Duration:  albumSnapshot.Album.Duration,
			SongCount: albumSnapshot.Album.SongCount,
			Song:      make([]openSubsonicChild, 0, len(albumSnapshot.Tracks)),
		}
		for _, trackSnapshot := range albumSnapshot.Tracks {
			album.Song = append(album.Song, a.openSubsonicBuildTrackChild(album.ID, trackSnapshot, browse.CoverFolders))
		}
		response := newOpenSubsonicBaseResponse()
		response.Album = &album
		writeOpenSubsonicResponse(w, r, response)
		return
	}
	writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "album not found", "")
}

func (a *App) handleOpenSubsonicGetSong(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}

	virtualTrackPath, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindSong)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
		return
	}

	browse := a.openSubsonicBrowseIndex()
	if trackSnapshot, exists := browse.TracksBySongID[openSubsonicSongID(virtualTrackPath)]; exists {
		trackSnapshot = a.openSubsonicHydrateTrackSnapshot(trackSnapshot)
		albumID := openSubsonicAlbumID(openSubsonicAlbumKey(trackSnapshot))
		child := a.openSubsonicBuildTrackChild(albumID, trackSnapshot, browse.CoverFolders)
		response := newOpenSubsonicBaseResponse()
		response.Song = &child
		writeOpenSubsonicResponse(w, r, response)
		return
	}

	root, _, absoluteTrackPath, ok := openSubsonicResolveAbsolutePath(browse.Roots, virtualTrackPath)
	if !ok || !isAudioPath(absoluteTrackPath) {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
		return
	}

	trackSnapshot := openSubsonicTrackMetadataSnapshot{
		Root:  root,
		Track: LibraryIndexedFile{Path: absoluteTrackPath, RelativePath: virtualTrackPath, FolderPath: pathpkg.Dir(virtualTrackPath), RootName: root.Name},
	}
	trackSnapshot = a.openSubsonicHydrateTrackSnapshot(trackSnapshot)
	child := a.openSubsonicBuildTrackChild(openSubsonicDirectoryID(pathpkg.Dir(virtualTrackPath)), trackSnapshot, browse.CoverFolders)

	response := newOpenSubsonicBaseResponse()
	response.Song = &child
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetUser(w http.ResponseWriter, r *http.Request, values url.Values) {
	username := strings.TrimSpace(values.Get("username"))
	if username == "" {
		username = strings.TrimSpace(values.Get("u"))
	}
	if username == "" {
		username = "silphium"
	}

	response := newOpenSubsonicBaseResponse()
	response.User = &openSubsonicUser{
		Username:            username,
		ScrobblingEnabled:   true,
		AdminRole:           true,
		SettingsRole:        true,
		DownloadRole:        true,
		UploadRole:          false,
		PlaylistRole:        true,
		CoverArtRole:        true,
		CommentRole:         false,
		PodcastRole:         false,
		StreamRole:          true,
		JukeboxRole:         false,
		ShareRole:           false,
		VideoConversionRole: false,
	}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetAlbumList2(w http.ResponseWriter, r *http.Request, values url.Values) {
	a.openSubsonicWriteAlbumListJSONKeepAlive(w, r)
	albumList := a.openSubsonicAlbumListIndex()
	typeName := strings.ToLower(strings.TrimSpace(values.Get("type")))
	albums := albumList.AlbumsAlphabetical
	switch typeName {
	case "random":
		albums = append([]openSubsonicAlbumListEntry(nil), albumList.AlbumsAlphabetical...)
		rng := rand.New(rand.NewSource(time.Now().UnixNano()))
		rng.Shuffle(len(albums), func(i int, j int) {
			albums[i], albums[j] = albums[j], albums[i]
		})
	case "frequent", "recent", "newest", "":
		albums = albumList.AlbumsNewest
	}

	offset, _ := strconv.Atoi(strings.TrimSpace(values.Get("offset")))
	size, _ := strconv.Atoi(strings.TrimSpace(values.Get("size")))
	if offset < 0 {
		offset = 0
	}
	if size <= 0 {
		size = 20
	}
	if offset > len(albums) {
		offset = len(albums)
	}
	end := offset + size
	if end > len(albums) {
		end = len(albums)
	}

	albumValues := make([]openSubsonicAlbum, 0, end-offset)
	for _, album := range albums[offset:end] {
		albumValues = append(albumValues, album.Album)
	}

	response := newOpenSubsonicBaseResponse()
	response.AlbumList2 = &openSubsonicAlbumList2{Album: albumValues}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetPlaylists(w http.ResponseWriter, r *http.Request) {
	browse := a.openSubsonicBrowseIndex()
	trackLookup := openSubsonicPlaylistTrackLookup(browse)
	playlists := make([]openSubsonicPlaylist, 0, len(a.openSubsonicFavoritePlaylistPaths()))
	for _, playlistPath := range a.openSubsonicFavoritePlaylistPaths() {
		playlists = append(playlists, a.openSubsonicBuildPlaylist(playlistPath, trackLookup))
	}

	response := newOpenSubsonicBaseResponse()
	response.Playlists = &openSubsonicPlaylists{Playlist: playlists}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetPlaylist(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}

	playlistPath, ok := a.openSubsonicResolveFavoritePlaylist(requestedID)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "playlist not found", "")
		return
	}

	browse := a.openSubsonicBrowseIndex()
	trackLookup := openSubsonicPlaylistTrackLookup(browse)
	response := newOpenSubsonicBaseResponse()
	playlist := a.openSubsonicBuildPlaylistDetails(playlistPath, trackLookup, browse.CoverFolders)
	response.Playlist = &playlist
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicUpdatePlaylist(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedPlaylistID := strings.TrimSpace(values.Get("playlistId"))
	if requestedPlaylistID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: playlistId", "")
		return
	}

	playlistPath, ok := a.openSubsonicResolveFavoritePlaylist(requestedPlaylistID)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "playlist not found", "")
		return
	}

	browse := a.openSubsonicBrowseIndex()
	trackPathsToAdd := make([]string, 0, len(values["songIdToAdd"]))
	for _, requestedSongID := range values["songIdToAdd"] {
		virtualTrackPath, ok := openSubsonicDecodeID(strings.TrimSpace(requestedSongID), openSubsonicIDKindSong)
		if !ok {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
			return
		}

		trackSnapshot, exists := browse.TracksBySongID[openSubsonicSongID(virtualTrackPath)]
		if !exists {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
			return
		}

		trackPathsToAdd = append(trackPathsToAdd, trackSnapshot.Track.Path)
	}

	if len(trackPathsToAdd) > 0 && !a.AppendTracksToPlaylistFile(playlistPath, trackPathsToAdd) {
		writeOpenSubsonicError(w, r, openSubsonicErrorGeneric, "playlist update failed", "")
		return
	}

	response := newOpenSubsonicBaseResponse()
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetScanStatus(w http.ResponseWriter, r *http.Request) {
	scanState := a.libraryScanState()
	response := newOpenSubsonicBaseResponse()
	response.ScanStatus = &openSubsonicScanStatus{
		Scanning: scanState.scanInProgress,
		Count:    scanState.scanLastTotalEntries,
	}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetRandomSongs(w http.ResponseWriter, r *http.Request, values url.Values) {
	browse := a.openSubsonicBrowseIndex()
	tracks := append([]openSubsonicTrackMetadataSnapshot(nil), browse.Tracks...)
	size, _ := strconv.Atoi(strings.TrimSpace(values.Get("size")))
	if size <= 0 {
		size = 10
	}
	if size > len(tracks) {
		size = len(tracks)
	}
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	rng.Shuffle(len(tracks), func(i int, j int) {
		tracks[i], tracks[j] = tracks[j], tracks[i]
	})
	selected := tracks[:size]
	songs := make([]openSubsonicChild, 0, len(selected))
	for _, track := range selected {
		songs = append(songs, a.openSubsonicBuildTrackChild(openSubsonicAlbumID(openSubsonicAlbumKey(track)), track, browse.CoverFolders))
	}
	response := newOpenSubsonicBaseResponse()
	response.RandomSongs = &openSubsonicRandomSongs{Song: songs}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetSimilarSongs(w http.ResponseWriter, r *http.Request) {
	response := newOpenSubsonicBaseResponse()
	response.SimilarSongs = &openSubsonicSimilarSongs{Song: []openSubsonicChild{}}
	writeOpenSubsonicResponse(w, r, response)
}

func (a *App) handleOpenSubsonicGetCoverArt(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}

	requestedSize := openSubsonicRequestedSize(values)
	browse := a.openSubsonicBrowseIndex()
	folderPath, absoluteTrackPath, ok := a.openSubsonicResolveCoverArtSource(browse, requestedID)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "cover art not found", "")
		return
	}
	coverBytes, mimeType, ok := a.resolveCoverArtBytes(folderPath, absoluteTrackPath, requestedSize)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "cover art not found", "")
		return
	}
	w.Header().Set("Content-Type", mimeType)
	_, _ = w.Write(coverBytes)
}

func (a *App) handleOpenSubsonicStream(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}
	virtualTrackPath, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindSong)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
		return
	}
	roots := a.openSubsonicLocalRootsSnapshot()
	root, _, absoluteTrackPath, ok := openSubsonicResolveAbsolutePath(roots, virtualTrackPath)
	if !ok || !isAudioPath(absoluteTrackPath) {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
		return
	}

	durationSeconds := 0.0
	browse := a.openSubsonicBrowseIndex()
	if trackSnapshot, exists := browse.TracksBySongID[openSubsonicSongID(virtualTrackPath)]; exists {
		trackSnapshot = a.openSubsonicHydrateTrackSnapshot(trackSnapshot)
		durationSeconds = trackSnapshot.Record.DurationSeconds
	} else {
		trackSnapshot := openSubsonicTrackMetadataSnapshot{
			Root: root,
			Track: LibraryIndexedFile{
				Path:         absoluteTrackPath,
				RelativePath: virtualTrackPath,
				FolderPath:   pathpkg.Dir(virtualTrackPath),
				RootName:     root.Name,
			},
		}
		trackSnapshot = a.openSubsonicHydrateTrackSnapshot(trackSnapshot)
		durationSeconds = trackSnapshot.Record.DurationSeconds
	}

	a.openSubsonicServeTrack(w, r, absoluteTrackPath, openSubsonicRequestedStreamOptions(values), durationSeconds)
}

func (a *App) handleOpenSubsonicScrobble(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedIDs := values["id"]
	if len(requestedIDs) == 0 {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}

	browse := a.openSubsonicBrowseIndex()
	submissionProvided, submissionRequested := openSubsonicScrobbleSubmission(values)
	requestedTimes := values["time"]
	settings := a.GetSettings()
	listenType := "playing_now"
	if submissionProvided && submissionRequested {
		listenType = "single"
	}

	for index, requestedID := range requestedIDs {
		trackSnapshot, ok := a.openSubsonicTrackSnapshotForSongID(requestedID, browse)
		if !ok {
			writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
			return
		}

		trackSnapshot = a.openSubsonicHydrateTrackSnapshot(trackSnapshot)
		tags := a.openSubsonicReadTrackTags(trackSnapshot)
		if !a.openSubsonicScrobbleAllowed(trackSnapshot, tags) {
			continue
		}

		listenedAt := int64(0)
		if listenType == "single" && index < len(requestedTimes) {
			listenedAt = openSubsonicParseScrobbleTimeMillis(requestedTimes[index])
		}

		lastFmMetadata := openSubsonicBuildLastFmMetadata(trackSnapshot, tags)
		listenBrainzMetadata := openSubsonicBuildListenBrainzMetadata(trackSnapshot, tags)
		if openSubsonicLastFmConfigured(settings) {
			if err := a.SubmitLastFm(listenType, lastFmMetadata, listenedAt); err != nil {
				writeOpenSubsonicError(w, r, openSubsonicErrorGeneric, err.Error(), "")
				return
			}
		}
		if openSubsonicListenBrainzConfigured(settings) {
			if err := a.SubmitListenBrainz(listenType, listenBrainzMetadata, listenedAt); err != nil {
				writeOpenSubsonicError(w, r, openSubsonicErrorGeneric, err.Error(), "")
				return
			}
		}
		if listenType == "single" {
			a.AddListenHistoryEntry(trackSnapshot.Track.Path, lastFmMetadata.TrackName, lastFmMetadata.ArtistName, lastFmMetadata.ReleaseName, listenedAt, 100)
		}
	}

	writeOpenSubsonicResponse(w, r, newOpenSubsonicBaseResponse())
}

func (a *App) handleOpenSubsonicStar(w http.ResponseWriter, r *http.Request, values url.Values) {
	a.handleOpenSubsonicTrackFeedback(w, r, values, 1)
}

func (a *App) handleOpenSubsonicUnstar(w http.ResponseWriter, r *http.Request, values url.Values) {
	a.handleOpenSubsonicTrackFeedback(w, r, values, 0)
}

func (a *App) handleOpenSubsonicTrackFeedback(w http.ResponseWriter, r *http.Request, values url.Values, score int) {
	browse := a.openSubsonicBrowseIndex()
	trackSnapshots, feedbackErr := a.openSubsonicFeedbackTrackSnapshots(values, browse)
	if feedbackErr != nil {
		writeOpenSubsonicError(w, r, feedbackErr.Code, feedbackErr.Message, feedbackErr.HelpURL)
		return
	}

	for _, trackSnapshot := range trackSnapshots {
		if err := a.openSubsonicApplyTrackFeedback(trackSnapshot, score); err != nil {
			writeOpenSubsonicError(w, r, openSubsonicErrorGeneric, err.Error(), "")
			return
		}
	}

	writeOpenSubsonicResponse(w, r, newOpenSubsonicBaseResponse())
}

func (a *App) handleOpenSubsonicDownload(w http.ResponseWriter, r *http.Request, values url.Values) {
	requestedID := strings.TrimSpace(values.Get("id"))
	if requestedID == "" {
		writeOpenSubsonicError(w, r, openSubsonicErrorMissingParameter, "required parameter is missing: id", "")
		return
	}
	virtualTrackPath, ok := openSubsonicDecodeID(requestedID, openSubsonicIDKindSong)
	if !ok {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
		return
	}
	roots := a.openSubsonicLocalRootsSnapshot()
	_, _, absoluteTrackPath, ok := openSubsonicResolveAbsolutePath(roots, virtualTrackPath)
	if !ok || !isAudioPath(absoluteTrackPath) {
		writeOpenSubsonicError(w, r, openSubsonicErrorNotFound, "song not found", "")
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(absoluteTrackPath)))
	http.ServeFile(w, r, absoluteTrackPath)
}
