package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	taglib "go.senan.xyz/taglib"
)

// App struct
type App struct {
	ctx            context.Context
	libraryRoot    string
	audio          *AudioBackend
	settings       AppSettings
	settingsPath   string
	settingsLoaded bool
}

type LibraryIndexedFile struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	FolderPath   string `json:"folderPath"`
}

type LibraryScanResult struct {
	RootPath          string               `json:"rootPath"`
	RootName          string               `json:"rootName"`
	TrackFiles        []LibraryIndexedFile `json:"trackFiles"`
	TextFiles         []LibraryIndexedFile `json:"textFiles"`
	CoverPathByFolder map[string]string    `json:"coverPathByFolder"`
	TotalEntries      int                  `json:"totalEntries"`
	Truncated         bool                 `json:"truncated"`
	EntryLimit        int                  `json:"entryLimit"`
}

type TrackTags struct {
	Artist      string   `json:"artist"`
	Album       string   `json:"album"`
	Title       string   `json:"title"`
	TrackNumber string   `json:"trackNumber,omitempty"`
	TrackTotal  string   `json:"trackTotal,omitempty"`
	BitDepth    int      `json:"bitDepth,omitempty"`
	SampleRate  int      `json:"sampleRate,omitempty"`
	Codec       string   `json:"codec,omitempty"`
	RecordingID string   `json:"recordingId,omitempty"`
	ReleaseID   string   `json:"releaseId,omitempty"`
	ArtistID    string   `json:"artistId,omitempty"`
	ArtistIDs   []string `json:"artistIds,omitempty"`
}

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

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loadStoredSettings()
}

func (a *App) audioBackend() *AudioBackend {
	if a.audio == nil {
		a.audio = NewAudioBackend()
	}

	return a.audio
}

const maxLibraryEntries = 250000

var errLibraryScanLimit = errors.New("library scan entry limit reached")

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

func (a *App) SelectLibraryFolder() string {
	selectedPath, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Music Library Folder",
	})
	if err != nil {
		return ""
	}

	return selectedPath
}

func (a *App) ScanLibraryFolder(path string) LibraryScanResult {
	cleanRoot := normalizePath(path)
	result := LibraryScanResult{
		RootPath:          cleanRoot,
		RootName:          filepath.Base(cleanRoot),
		TrackFiles:        []LibraryIndexedFile{},
		TextFiles:         []LibraryIndexedFile{},
		CoverPathByFolder: map[string]string{},
		EntryLimit:        maxLibraryEntries,
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

	selectedCoverPriority := make(map[string]int)
	selectedCoverName := make(map[string]string)

	scanErr := filepath.WalkDir(cleanRoot, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}

		if currentPath == cleanRoot {
			return nil
		}

		result.TotalEntries += 1
		if result.TotalEntries > maxLibraryEntries {
			result.Truncated = true
			return errLibraryScanLimit
		}

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
		case isJpegPath(currentPath):
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

	if scanErr != nil && !errors.Is(scanErr, errLibraryScanLimit) {
		return result
	}

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

	a.libraryRoot = cleanRoot
	return result
}

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
			evenTotal += 1
			if value == 0 {
				evenZeros += 1
			}
			continue
		}

		oddTotal += 1
		if value == 0 {
			oddZeros += 1
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
	SampleRate       string `json:"sample_rate"`
	BitsPerRawSample string `json:"bits_per_raw_sample"`
	BitsPerSample    int    `json:"bits_per_sample"`
	SampleFmt        string `json:"sample_fmt"`
}

type ffprobeAudioOutput struct {
	Streams []ffprobeAudioStream `json:"streams"`
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

func readTrackTechnicalMetadata(path string) (int, int, string) {
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		return 0, 0, ""
	}

	command := exec.Command(
		ffprobePath,
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name,sample_rate,bits_per_raw_sample,bits_per_sample,sample_fmt",
		"-of", "json",
		path,
	)

	rawOutput, err := command.Output()
	if err != nil {
		return 0, 0, ""
	}

	var parsed ffprobeAudioOutput
	if err := json.Unmarshal(rawOutput, &parsed); err != nil {
		return 0, 0, ""
	}

	if len(parsed.Streams) == 0 {
		return 0, 0, ""
	}

	stream := parsed.Streams[0]
	sampleRate := 0
	if stream.SampleRate != "" {
		if parsedRate, parseErr := strconv.Atoi(stream.SampleRate); parseErr == nil {
			sampleRate = parsedRate
		}
	}

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

	return bitDepth, sampleRate, strings.ToUpper(strings.TrimSpace(stream.CodecName))
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
		trackNumber, trackTotal := extractTrackNumbers(tags)
		artistIDs := extractArtistMBIDs(tags)
		bitDepth, sampleRate, codec := readTrackTechnicalMetadata(path)

		if artist == "" && album == "" && title == "" {
			continue
		}

		tagByPath[path] = TrackTags{
			Artist:      artist,
			Album:       album,
			Title:       title,
			TrackNumber: trackNumber,
			TrackTotal:  trackTotal,
			BitDepth:    bitDepth,
			SampleRate:  sampleRate,
			Codec:       codec,
			RecordingID: firstTagValue(tags, "MUSICBRAINZ_TRACKID", "MusicBrainz Track Id"),
			ReleaseID:   firstTagValue(tags, "MUSICBRAINZ_ALBUMID", "MusicBrainz Album Id"),
			ArtistID:    firstTagValue(tags, "MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id"),
			ArtistIDs:   artistIDs,
		}
	}

	return tagByPath
}

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
		_ = os.Remove(tempPath)
		if err != nil {
			continue
		}

		artist := firstTagValue(tags, "ARTIST", "ALBUMARTIST")
		album := firstTagValue(tags, "ALBUM")
		title := firstTagValue(tags, "TITLE")
		trackNumber, trackTotal := extractTrackNumbers(tags)
		artistIDs := extractArtistMBIDs(tags)
		bitDepth, sampleRate, codec := readTrackTechnicalMetadata(tempPath)

		if artist == "" && album == "" && title == "" {
			continue
		}

		tagByKey[blob.Key] = TrackTags{
			Artist:      artist,
			Album:       album,
			Title:       title,
			TrackNumber: trackNumber,
			TrackTotal:  trackTotal,
			BitDepth:    bitDepth,
			SampleRate:  sampleRate,
			Codec:       codec,
			RecordingID: firstTagValue(tags, "MUSICBRAINZ_TRACKID", "MusicBrainz Track Id"),
			ReleaseID:   firstTagValue(tags, "MUSICBRAINZ_ALBUMID", "MusicBrainz Album Id"),
			ArtistID:    firstTagValue(tags, "MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id"),
			ArtistIDs:   artistIDs,
		}
	}

	return tagByKey
}

func (a *App) InitializeAudioBackend() (AudioPlaybackState, error) {
	backend := a.audioBackend()
	if err := backend.Initialize(); err != nil {
		return AudioPlaybackState{}, err
	}

	return backend.State(), nil
}

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

func (a *App) AudioPlay() (AudioPlaybackState, error) {
	return a.audioBackend().Play()
}

func (a *App) AudioPause() (AudioPlaybackState, error) {
	return a.audioBackend().Pause()
}

func (a *App) AudioStop() (AudioPlaybackState, error) {
	return a.audioBackend().Stop()
}

func (a *App) AudioSeek(seconds float64) (AudioPlaybackState, error) {
	return a.audioBackend().Seek(seconds)
}

func (a *App) AudioSetVolume(volume float64) (AudioPlaybackState, error) {
	return a.audioBackend().SetVolume(volume)
}

func (a *App) AudioGetState() AudioPlaybackState {
	return a.audioBackend().State()
}
