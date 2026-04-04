package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	taglib "go.senan.xyz/taglib"
)

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

const (
	trackTagsWorkerLimit = 8
	trackTagsCacheLimit  = 4096
)

type trackTagsFileSignature struct {
	Size      int64
	ModUnixNs int64
}

type trackTagsCacheEntry struct {
	Signature   trackTagsFileSignature
	Tags        TrackTags
	HasMetadata bool
}

type readTrackTagsJob struct {
	path      string
	signature trackTagsFileSignature
}

type readTrackTagsResult struct {
	path        string
	signature   trackTagsFileSignature
	tags        TrackTags
	hasMetadata bool
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

// TrackTechnicalMetadata contains parsed audio technical properties.
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

var trackTagsIntegerPattern = regexp.MustCompile(`\d+`)

var codecByContainer = map[string]string{
	"flac": "FLAC",
	"mp3":  "MP3",
	"ogg":  "VORBIS",
	"oga":  "VORBIS",
	"opus": "OPUS",
	"m4a":  "AAC",
	"aac":  "AAC",
	"wav":  "PCM",
	"aif":  "PCM",
	"aiff": "PCM",
	"wma":  "WMA",
	"ape":  "APE",
	"wv":   "WAVPACK",
}

func parseIntValue(value string) int {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	parsed, err := strconv.Atoi(trimmed)
	if err == nil {
		if parsed > 0 {
			return parsed
		}
		return 0
	}

	match := trackTagsIntegerPattern.FindString(trimmed)
	if match == "" {
		return 0
	}

	parsed, err = strconv.Atoi(match)
	if err != nil || parsed <= 0 {
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
	if err != nil || parsed <= 0 {
		return 0
	}

	return parsed
}

func inferContainerFromPath(path string) string {
	return strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
}

func inferChannelLayout(channels int) string {
	switch channels {
	case 1:
		return "mono"
	case 2:
		return "stereo"
	case 6:
		return "5.1"
	case 8:
		return "7.1"
	default:
		return ""
	}
}

func parseBitDepthFromTags(tags map[string][]string) int {
	return parseIntValue(firstTagValue(tags,
		"BITDEPTH",
		"BITS_PER_SAMPLE",
		"BITSPERSAMPLE",
		"BPS",
		"BITS",
	))
}

func inferCodecFromContainerAndTags(container string, tags map[string][]string) string {
	codec := strings.ToUpper(strings.TrimSpace(firstTagValue(tags,
		"CODEC",
		"AUDIOCODEC",
		"AUDIO_CODEC",
		"MEDIA_CODEC",
		"FORMAT",
	)))
	if codec != "" {
		return codec
	}

	if mapped, ok := codecByContainer[container]; ok {
		return mapped
	}

	return ""
}

func readTrackTechnicalMetadata(path string, tags map[string][]string) TrackTechnicalMetadata {
	metadata := TrackTechnicalMetadata{}

	if fileInfo, statErr := os.Stat(path); statErr == nil && !fileInfo.IsDir() {
		metadata.FileSizeBytes = fileInfo.Size()
	}

	if properties, err := taglib.ReadProperties(path); err == nil {
		metadata.SampleRate = int(properties.SampleRate)
		metadata.Channels = int(properties.Channels)
		if properties.Bitrate > 0 {
			bitRate := int(properties.Bitrate) * 1000
			metadata.BitRate = bitRate
			metadata.OverallBitRate = bitRate
		}
		if properties.Length > 0 {
			metadata.DurationSeconds = properties.Length.Seconds()
		}
	}

	container := strings.TrimSpace(strings.ToLower(firstTagValue(tags, "CONTAINER", "FILETYPE", "FORMAT")))
	if container == "" {
		container = inferContainerFromPath(path)
	}
	metadata.Container = container
	metadata.Codec = inferCodecFromContainerAndTags(container, tags)
	if metadata.Codec != "" {
		metadata.CodecLong = metadata.Codec
	}
	metadata.CodecProfile = firstTagValue(tags, "CODECPROFILE", "CODEC_PROFILE", "PROFILE")
	metadata.SampleFormat = firstTagValue(tags, "SAMPLEFORMAT", "SAMPLE_FMT", "SAMPLE_FORMAT")
	metadata.ChannelLayout = firstTagValue(tags, "CHANNELLAYOUT", "CHANNEL_LAYOUT")
	if metadata.ChannelLayout == "" {
		metadata.ChannelLayout = inferChannelLayout(metadata.Channels)
	}
	metadata.BitDepth = parseBitDepthFromTags(tags)

	if metadata.SampleRate == 0 {
		metadata.SampleRate = parseIntValue(firstTagValue(tags, "SAMPLERATE", "SAMPLE_RATE", "SAMPLE RATE"))
	}
	if metadata.Channels == 0 {
		metadata.Channels = parseIntValue(firstTagValue(tags, "CHANNELS", "CHANNEL_COUNT", "CHANNELCOUNT"))
		if metadata.ChannelLayout == "" {
			metadata.ChannelLayout = inferChannelLayout(metadata.Channels)
		}
	}
	if metadata.BitRate == 0 {
		bitRate := parseIntValue(firstTagValue(tags, "BITRATE", "BIT_RATE", "BANDWIDTH"))
		if bitRate > 0 {
			if bitRate < 1000 {
				bitRate *= 1000
			}
			metadata.BitRate = bitRate
			metadata.OverallBitRate = bitRate
		}
	}
	if metadata.DurationSeconds == 0 {
		durationSeconds := parseFloatValue(firstTagValue(tags, "DURATION", "LENGTH"))
		if durationSeconds > 0 {
			metadata.DurationSeconds = durationSeconds
		}
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

func buildTrackTags(tags map[string][]string, technical TrackTechnicalMetadata) TrackTags {
	trackNumber, trackTotal := extractTrackNumbers(tags)

	return TrackTags{
		Artist:         firstTagValue(tags, "ARTIST", "ALBUMARTIST"),
		Album:          firstTagValue(tags, "ALBUM"),
		Title:          firstTagValue(tags, "TITLE"),
		AllTags:        collectAllTags(tags),
		Lyrics:         firstTagValue(tags, "LYRICS"),
		UnsyncedLyrics: firstTagValue(tags, "UNSYNCEDLYRICS"),
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
		ArtistIDs:      extractArtistMBIDs(tags),
	}
}

func hasAnyTrackMetadata(trackTags TrackTags) bool {
	return trackTags.Artist != "" ||
		trackTags.Album != "" ||
		trackTags.Title != "" ||
		len(trackTags.AllTags) > 0 ||
		trackTags.TrackNumber != "" ||
		trackTags.TrackTotal != "" ||
		trackTags.BitDepth != 0 ||
		trackTags.SampleRate != 0 ||
		trackTags.Codec != "" ||
		trackTags.BitRate != 0 ||
		trackTags.OverallBitRate != 0 ||
		trackTags.DurationSecs != 0 ||
		trackTags.Container != "" ||
		trackTags.FileSizeBytes != 0 ||
		trackTags.Lyrics != "" ||
		trackTags.UnsyncedLyrics != ""
}

func trackTagsFileSignatureForPath(path string) (trackTagsFileSignature, bool) {
	fileInfo, err := os.Stat(path)
	if err != nil || fileInfo.IsDir() {
		return trackTagsFileSignature{}, false
	}

	return trackTagsFileSignature{
		Size:      fileInfo.Size(),
		ModUnixNs: fileInfo.ModTime().UnixNano(),
	}, true
}

func (a *App) normalizeTrackTagPaths(paths []string) []string {
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))

	for _, rawPath := range paths {
		path := strings.TrimSpace(rawPath)
		if path == "" || !a.isAllowedLibraryPath(path) {
			continue
		}

		if _, exists := seen[path]; exists {
			continue
		}

		seen[path] = struct{}{}
		normalized = append(normalized, path)
	}

	return normalized
}

func resolveTrackTagsWorkerCount(jobCount int) int {
	if jobCount <= 0 {
		return 0
	}

	workerCount := runtime.NumCPU()
	if workerCount < 2 {
		workerCount = 2
	}
	if workerCount > trackTagsWorkerLimit {
		workerCount = trackTagsWorkerLimit
	}
	if workerCount > jobCount {
		workerCount = jobCount
	}

	return workerCount
}

func (a *App) removeTrackTagsCacheOrderEntryLocked(path string) {
	for idx, cachedPath := range a.trackTagsCacheOrder {
		if cachedPath != path {
			continue
		}

		a.trackTagsCacheOrder = append(a.trackTagsCacheOrder[:idx], a.trackTagsCacheOrder[idx+1:]...)
		return
	}
}

func (a *App) touchTrackTagsCacheOrderLocked(path string) {
	a.removeTrackTagsCacheOrderEntryLocked(path)
	a.trackTagsCacheOrder = append(a.trackTagsCacheOrder, path)
}

func (a *App) getTrackTagsCache(path string, signature trackTagsFileSignature) (TrackTags, bool, bool) {
	a.trackTagsCacheMu.Lock()
	defer a.trackTagsCacheMu.Unlock()

	entry, exists := a.trackTagsCacheByPath[path]
	if !exists {
		return TrackTags{}, false, false
	}

	if entry.Signature != signature {
		delete(a.trackTagsCacheByPath, path)
		a.removeTrackTagsCacheOrderEntryLocked(path)
		return TrackTags{}, false, false
	}

	a.touchTrackTagsCacheOrderLocked(path)
	return entry.Tags, entry.HasMetadata, true
}

func (a *App) putTrackTagsCache(path string, signature trackTagsFileSignature, tags TrackTags, hasMetadata bool) {
	a.trackTagsCacheMu.Lock()
	defer a.trackTagsCacheMu.Unlock()

	if a.trackTagsCacheByPath == nil {
		a.trackTagsCacheByPath = make(map[string]trackTagsCacheEntry, trackTagsCacheLimit)
	}

	a.trackTagsCacheByPath[path] = trackTagsCacheEntry{
		Signature:   signature,
		Tags:        tags,
		HasMetadata: hasMetadata,
	}
	a.touchTrackTagsCacheOrderLocked(path)

	for len(a.trackTagsCacheOrder) > trackTagsCacheLimit {
		evictedPath := a.trackTagsCacheOrder[0]
		a.trackTagsCacheOrder = a.trackTagsCacheOrder[1:]
		delete(a.trackTagsCacheByPath, evictedPath)
	}
}

func readTrackTagsForPath(path string) (TrackTags, bool) {
	tags, err := taglib.ReadTags(path)
	if err != nil {
		return TrackTags{}, false
	}

	trackTags := buildTrackTags(tags, readTrackTechnicalMetadata(path, tags))
	if !hasAnyTrackMetadata(trackTags) {
		return TrackTags{}, false
	}

	return trackTags, true
}

// ReadTrackTags reads tag and technical metadata for track files by path.
func (a *App) ReadTrackTags(paths []string) map[string]TrackTags {
	startedAt := time.Now()
	normalizedPaths := a.normalizeTrackTagPaths(paths)
	tagByPath := make(map[string]TrackTags, len(normalizedPaths))
	if len(normalizedPaths) == 0 {
		return tagByPath
	}

	jobs := make(chan readTrackTagsJob, len(normalizedPaths))
	results := make(chan readTrackTagsResult, len(normalizedPaths))
	queuedJobs := 0
	cacheHits := 0

	for _, path := range normalizedPaths {
		signature, ok := trackTagsFileSignatureForPath(path)
		if !ok {
			continue
		}

		if cachedTags, cachedHasMetadata, cacheHit := a.getTrackTagsCache(path, signature); cacheHit {
			cacheHits++
			if cachedHasMetadata {
				tagByPath[path] = cachedTags
			}
			continue
		}

		jobs <- readTrackTagsJob{
			path:      path,
			signature: signature,
		}
		queuedJobs++
	}
	close(jobs)

	workerCount := resolveTrackTagsWorkerCount(queuedJobs)
	if workerCount == 0 {
		if len(normalizedPaths) > 1 {
			a.logRescanEvent(
				"ReadTrackTags END: requested=%d cacheHits=%d parsed=%d returned=%d workers=%d took %.2fms",
				len(normalizedPaths),
				cacheHits,
				queuedJobs,
				len(tagByPath),
				workerCount,
				time.Since(startedAt).Seconds()*1000,
			)
		}
		return tagByPath
	}

	var workerWaitGroup sync.WaitGroup
	for workerIndex := 0; workerIndex < workerCount; workerIndex++ {
		workerWaitGroup.Add(1)
		go func() {
			defer workerWaitGroup.Done()
			for job := range jobs {
				trackTags, hasMetadata := readTrackTagsForPath(job.path)
				results <- readTrackTagsResult{
					path:        job.path,
					signature:   job.signature,
					tags:        trackTags,
					hasMetadata: hasMetadata,
				}
			}
		}()
	}

	go func() {
		workerWaitGroup.Wait()
		close(results)
	}()

	for result := range results {
		a.putTrackTagsCache(result.path, result.signature, result.tags, result.hasMetadata)
		if !result.hasMetadata {
			continue
		}

		tagByPath[result.path] = result.tags
	}

	if len(normalizedPaths) > 1 {
		a.logRescanEvent(
			"ReadTrackTags END: requested=%d cacheHits=%d parsed=%d returned=%d workers=%d took %.2fms",
			len(normalizedPaths),
			cacheHits,
			queuedJobs,
			len(tagByPath),
			workerCount,
			time.Since(startedAt).Seconds()*1000,
		)
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

		technical := readTrackTechnicalMetadata(tempPath, tags)
		_ = os.Remove(tempPath)
		trackTags := buildTrackTags(tags, technical)
		if !hasAnyTrackMetadata(trackTags) {
			continue
		}

		tagByKey[blob.Key] = trackTags
	}

	return tagByKey
}
