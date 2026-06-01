package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
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

var readTaglibTags = taglib.ReadTags
var writeTaglibTags = taglib.WriteTags

// TrackTags contains resolved textual, technical, and MusicBrainz metadata for a track.
type TrackTags struct {
	Artist         string              `json:"artist"`
	AlbumArtist    string              `json:"albumArtist,omitempty"`
	Album          string              `json:"album"`
	Title          string              `json:"title"`
	Date           string              `json:"date,omitempty"`
	Genre          string              `json:"genre,omitempty"`
	RecordLabel    string              `json:"recordLabel,omitempty"`
	CatalogNumber  string              `json:"catalogNumber,omitempty"`
	Genres         []string            `json:"genres,omitempty"`
	AllTags        map[string][]string `json:"allTags,omitempty"`
	Lyrics         string              `json:"lyrics,omitempty"`
	UnsyncedLyrics string              `json:"unsyncedLyrics,omitempty"`
	TrackNumber    string              `json:"trackNumber,omitempty"`
	TrackTotal     string              `json:"trackTotal,omitempty"`
	DiscNumber     string              `json:"discNumber,omitempty"`
	DiscTotal      string              `json:"discTotal,omitempty"`
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
	AlbumArtistID  string              `json:"albumArtistId,omitempty"`
	AlbumArtistIDs []string            `json:"albumArtistIds,omitempty"`
}

// TrackBlob carries in-memory file data used for tag extraction without disk references.
type TrackBlob struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Data string `json:"data"`
}

const (
	trackTagsWorkerLimit       = 8
	remoteTrackTagsWorkerLimit = 2
	trackTagsCacheLimit        = 4096
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

type trackTagsInflightEntry struct {
	waitCh      chan struct{}
	tags        TrackTags
	hasMetadata bool
}

type ffprobeAudioStream struct {
	CodecName        string            `json:"codec_name"`
	CodecLongName    string            `json:"codec_long_name"`
	Profile          string            `json:"profile"`
	SampleRate       string            `json:"sample_rate"`
	BitsPerRawSample string            `json:"bits_per_raw_sample"`
	BitsPerSample    int               `json:"bits_per_sample"`
	SampleFmt        string            `json:"sample_fmt"`
	Channels         int               `json:"channels"`
	ChannelLayout    string            `json:"channel_layout"`
	BitRate          string            `json:"bit_rate"`
	Duration         string            `json:"duration"`
	Tags             map[string]string `json:"tags"`
}

type ffprobeFormatOutput struct {
	FormatName string            `json:"format_name"`
	BitRate    string            `json:"bit_rate"`
	Duration   string            `json:"duration"`
	Tags       map[string]string `json:"tags"`
}

type ffprobeAudioOutput struct {
	Streams []ffprobeAudioStream `json:"streams"`
	Format  ffprobeFormatOutput  `json:"format"`
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

func collectTagValues(tags map[string][]string, keys ...string) []string {
	if len(tags) == 0 || len(keys) == 0 {
		return nil
	}

	values := make([]string, 0)
	for _, key := range keys {
		for tagKey, tagValues := range tags {
			if !strings.EqualFold(tagKey, key) {
				continue
			}

			for _, value := range tagValues {
				trimmedValue := strings.TrimSpace(value)
				if trimmedValue == "" {
					continue
				}

				values = append(values, trimmedValue)
			}
		}
	}

	if len(values) == 0 {
		return nil
	}

	return values
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

func extractDiscNumbers(tags map[string][]string) (string, string) {
	number := firstTagValue(tags, "DISCNUMBER", "DISC", "TPOS")
	total := firstTagValue(tags, "DISCTOTAL", "TOTALDISCS", "TOTALDISCCOUNT")

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

func readTrackTechnicalMetadataFromFFProbe(path string, ffprobePath string) (TrackTechnicalMetadata, bool) {
	if ffprobePath == "" {
		return TrackTechnicalMetadata{}, false
	}

	command := newHiddenUtilityCommand(
		ffprobePath,
		"-v", "error",
		"-select_streams", "a:0",
		"-show_entries", "stream=codec_name,codec_long_name,profile,sample_rate,bits_per_raw_sample,bits_per_sample,sample_fmt,channels,channel_layout,bit_rate,duration:format=format_name,bit_rate,duration",
		"-of", "json",
		path,
	)

	rawOutput, err := command.Output()
	if err != nil {
		return TrackTechnicalMetadata{}, false
	}

	var parsed ffprobeAudioOutput
	if err := json.Unmarshal(rawOutput, &parsed); err != nil {
		return TrackTechnicalMetadata{}, false
	}

	metadata := TrackTechnicalMetadata{}
	metadata.Container = strings.TrimSpace(strings.ToLower(parsed.Format.FormatName))
	metadata.OverallBitRate = parseIntValue(parsed.Format.BitRate)
	metadata.DurationSeconds = parseFloatValue(parsed.Format.Duration)

	if len(parsed.Streams) == 0 {
		return metadata, true
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

	bitDepth := parseIntValue(stream.BitsPerRawSample)
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

	return metadata, true
}

func appendFFProbeTags(dst map[string][]string, raw map[string]string) map[string][]string {
	if len(raw) == 0 {
		return dst
	}
	if dst == nil {
		dst = make(map[string][]string, len(raw))
	}

	for rawKey, rawValue := range raw {
		key := strings.TrimSpace(rawKey)
		value := strings.TrimSpace(rawValue)
		if key == "" || value == "" {
			continue
		}

		existingKey := key
		for candidate := range dst {
			if strings.EqualFold(candidate, key) {
				existingKey = candidate
				break
			}
		}

		duplicate := false
		for _, existingValue := range dst[existingKey] {
			if strings.EqualFold(strings.TrimSpace(existingValue), value) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}

		dst[existingKey] = append(dst[existingKey], value)
	}

	if len(dst) == 0 {
		return nil
	}

	return dst
}

func mergeTrackTagMaps(primary map[string][]string, fallback map[string][]string) map[string][]string {
	if len(fallback) == 0 {
		return primary
	}

	merged := make(map[string][]string, len(primary)+len(fallback))
	for key, values := range primary {
		merged[key] = append([]string(nil), values...)
	}

	for fallbackKey, fallbackValues := range fallback {
		key := fallbackKey
		hasPrimaryValues := false
		for existingKey, existingValues := range merged {
			if !strings.EqualFold(existingKey, fallbackKey) {
				continue
			}
			key = existingKey
			for _, existingValue := range existingValues {
				if strings.TrimSpace(existingValue) != "" {
					hasPrimaryValues = true
					break
				}
			}
			break
		}
		if hasPrimaryValues {
			continue
		}

		merged[key] = append([]string(nil), fallbackValues...)
	}

	return merged
}

func trackTagsNeedFFProbeTextFallback(tags map[string][]string) bool {
	if len(tags) == 0 {
		return true
	}

	title := firstTagValue(tags, "TITLE")
	artist := firstTagValue(tags, "TRACKARTIST", "TRACK_ARTIST", "ARTIST", "ALBUMARTIST", "ALBUM_ARTIST")
	album := firstTagValue(tags, "ALBUM")
	albumArtist := firstTagValue(tags, "ALBUMARTIST", "ALBUM_ARTIST", "ARTIST")
	return title == "" && artist == "" && album == "" && albumArtist == ""
}

func readTrackTextTagsFromFFProbe(path string, ffprobePath string) map[string][]string {
	if ffprobePath == "" {
		return nil
	}

	command := newHiddenUtilityCommand(
		ffprobePath,
		"-v", "error",
		"-show_entries", "stream_tags:format_tags",
		"-of", "json",
		path,
	)

	rawOutput, err := command.Output()
	if err != nil {
		return nil
	}

	var parsed ffprobeAudioOutput
	if err := json.Unmarshal(rawOutput, &parsed); err != nil {
		return nil
	}

	tags := appendFFProbeTags(nil, parsed.Format.Tags)
	for _, stream := range parsed.Streams {
		tags = appendFFProbeTags(tags, stream.Tags)
	}
	return tags
}

func readTrackTechnicalMetadata(path string, tags map[string][]string, ffprobePath string) TrackTechnicalMetadata {
	metadata := TrackTechnicalMetadata{}

	if fileInfo, statErr := os.Stat(path); statErr == nil && !fileInfo.IsDir() {
		metadata.FileSizeBytes = fileInfo.Size()
	}

	if properties, err := readTaglibProperties(path); err == nil {
		if metadata.SampleRate == 0 {
			metadata.SampleRate = int(properties.SampleRate)
		}
		if metadata.Channels == 0 {
			metadata.Channels = int(properties.Channels)
		}
		if properties.Bitrate > 0 {
			bitRate := int(properties.Bitrate) * 1000
			if metadata.BitRate == 0 {
				metadata.BitRate = bitRate
			}
			if metadata.OverallBitRate == 0 {
				metadata.OverallBitRate = bitRate
			}
		}
		if properties.Length > 0 && metadata.DurationSeconds == 0 {
			metadata.DurationSeconds = properties.Length.Seconds()
		}
	}

	if metadata.Container == "" {
		container := strings.TrimSpace(strings.ToLower(firstTagValue(tags, "CONTAINER", "FILETYPE", "FORMAT")))
		if container == "" {
			container = inferContainerFromPath(path)
		}
		metadata.Container = container
	}
	metadata.Codec = strings.ToUpper(strings.TrimSpace(metadata.Codec))
	if metadata.Codec == "" {
		metadata.Codec = inferCodecFromContainerAndTags(metadata.Container, tags)
	}
	if metadata.Codec != "" {
		if metadata.CodecLong == "" {
			metadata.CodecLong = metadata.Codec
		}
	}
	if metadata.CodecProfile == "" {
		metadata.CodecProfile = firstTagValue(tags, "CODECPROFILE", "CODEC_PROFILE", "PROFILE")
	}
	if metadata.SampleFormat == "" {
		metadata.SampleFormat = firstTagValue(tags, "SAMPLEFORMAT", "SAMPLE_FMT", "SAMPLE_FORMAT")
	}
	if metadata.ChannelLayout == "" {
		metadata.ChannelLayout = firstTagValue(tags, "CHANNELLAYOUT", "CHANNEL_LAYOUT")
	}
	if metadata.ChannelLayout == "" {
		metadata.ChannelLayout = inferChannelLayout(metadata.Channels)
	}
	if metadata.BitDepth == 0 {
		metadata.BitDepth = parseBitDepthFromTags(tags)
	}

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

	if metadata.BitDepth == 0 || metadata.SampleRate == 0 || metadata.Codec == "" || metadata.Channels == 0 || metadata.BitRate == 0 || metadata.OverallBitRate == 0 || metadata.DurationSeconds == 0 || metadata.Container == "" {
		if ffprobeMetadata, ok := readTrackTechnicalMetadataFromFFProbe(path, ffprobePath); ok {
			if ffprobeMetadata.BitDepth != 0 {
				metadata.BitDepth = ffprobeMetadata.BitDepth
			}
			if ffprobeMetadata.SampleRate != 0 {
				metadata.SampleRate = ffprobeMetadata.SampleRate
			}
			if ffprobeMetadata.Codec != "" {
				metadata.Codec = ffprobeMetadata.Codec
			}
			if ffprobeMetadata.CodecLong != "" {
				metadata.CodecLong = ffprobeMetadata.CodecLong
			}
			if ffprobeMetadata.CodecProfile != "" {
				metadata.CodecProfile = ffprobeMetadata.CodecProfile
			}
			if ffprobeMetadata.SampleFormat != "" {
				metadata.SampleFormat = ffprobeMetadata.SampleFormat
			}
			if ffprobeMetadata.Channels != 0 {
				metadata.Channels = ffprobeMetadata.Channels
			}
			if ffprobeMetadata.ChannelLayout != "" {
				metadata.ChannelLayout = ffprobeMetadata.ChannelLayout
			}
			if ffprobeMetadata.BitRate != 0 {
				metadata.BitRate = ffprobeMetadata.BitRate
			}
			if ffprobeMetadata.OverallBitRate != 0 {
				metadata.OverallBitRate = ffprobeMetadata.OverallBitRate
			}
			if ffprobeMetadata.DurationSeconds != 0 {
				metadata.DurationSeconds = ffprobeMetadata.DurationSeconds
			}
			if ffprobeMetadata.Container != "" {
				metadata.Container = ffprobeMetadata.Container
			}
		}
	}

	return metadata
}

var mbidPattern = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`)

func extractMusicBrainzIDs(tags map[string][]string, keys ...string) []string {
	unique := make(map[string]struct{})
	mbids := make([]string, 0)

	for _, value := range collectTagValues(tags, keys...) {
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

	return mbids
}

func extractArtistMBIDs(tags map[string][]string) []string {
	return extractMusicBrainzIDs(tags, "MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id", "TXXX:MusicBrainz Artist Id")
}

func extractAlbumArtistMBIDs(tags map[string][]string) []string {
	return extractMusicBrainzIDs(tags, "MUSICBRAINZ_ALBUMARTISTID", "MusicBrainz Album Artist Id", "TXXX:MusicBrainz Album Artist Id")
}

func extractFirstMusicBrainzID(tags map[string][]string, keys ...string) string {
	ids := extractMusicBrainzIDs(tags, keys...)
	if len(ids) == 0 {
		return ""
	}

	return ids[0]
}

func extractGenres(tags map[string][]string) []string {
	rawValues := collectTagValues(tags, "GENRE")
	if len(rawValues) == 0 {
		return nil
	}

	genres := make([]string, 0, len(rawValues))
	seen := make(map[string]struct{}, len(rawValues))
	for _, rawValue := range rawValues {
		parts := strings.Split(rawValue, ";")
		for _, part := range parts {
			genre := strings.TrimSpace(part)
			if genre == "" {
				continue
			}

			lookupKey := strings.ToLower(genre)
			if _, exists := seen[lookupKey]; exists {
				continue
			}

			seen[lookupKey] = struct{}{}
			genres = append(genres, genre)
		}
	}

	if len(genres) == 0 {
		return nil
	}

	return genres
}

func buildTrackTags(tags map[string][]string, technical TrackTechnicalMetadata) TrackTags {
	trackNumber, trackTotal := extractTrackNumbers(tags)
	discNumber, discTotal := extractDiscNumbers(tags)
	artistIDs := extractArtistMBIDs(tags)
	albumArtistIDs := extractAlbumArtistMBIDs(tags)
	genres := extractGenres(tags)
	genre := ""
	if len(genres) > 0 {
		genre = genres[0]
	}

	return TrackTags{
		Artist:         firstTagValue(tags, "TRACKARTIST", "TRACK_ARTIST", "Track Artist", "ARTIST", "ALBUMARTIST"),
		AlbumArtist:    firstTagValue(tags, "ALBUMARTIST", "ALBUM_ARTIST", "Album Artist", "ARTIST"),
		Album:          firstTagValue(tags, "ALBUM"),
		Title:          firstTagValue(tags, "TITLE"),
		Date:           firstTagValue(tags, "DATE", "YEAR", "ORIGINALDATE"),
		Genre:          genre,
		RecordLabel:    firstTagValue(tags, "LABEL", "ORGANIZATION"),
		CatalogNumber:  firstTagValue(tags, "CATALOGNUMBER", "CATALOG"),
		Genres:         genres,
		AllTags:        collectAllTags(tags),
		Lyrics:         firstTagValue(tags, "LYRICS"),
		UnsyncedLyrics: firstTagValue(tags, "UNSYNCEDLYRICS"),
		TrackNumber:    trackNumber,
		TrackTotal:     trackTotal,
		DiscNumber:     discNumber,
		DiscTotal:      discTotal,
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
		RecordingID:    extractFirstMusicBrainzID(tags, "MUSICBRAINZ_TRACKID", "MusicBrainz Track Id"),
		ReleaseID:      extractFirstMusicBrainzID(tags, "MUSICBRAINZ_ALBUMID", "MusicBrainz Album Id"),
		ArtistID:       firstNonEmptyString(artistIDs...),
		ArtistIDs:      artistIDs,
		AlbumArtistID:  firstNonEmptyString(albumArtistIDs...),
		AlbumArtistIDs: albumArtistIDs,
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}

	return ""
}

func hasAnyTrackMetadata(trackTags TrackTags) bool {
	return trackTags.Artist != "" ||
		trackTags.AlbumArtist != "" ||
		trackTags.Album != "" ||
		trackTags.Title != "" ||
		trackTags.Date != "" ||
		trackTags.Genre != "" ||
		trackTags.RecordLabel != "" ||
		trackTags.CatalogNumber != "" ||
		len(trackTags.Genres) > 0 ||
		len(trackTags.AllTags) > 0 ||
		trackTags.TrackNumber != "" ||
		trackTags.TrackTotal != "" ||
		trackTags.DiscNumber != "" ||
		trackTags.DiscTotal != "" ||
		trackTags.BitDepth != 0 ||
		trackTags.SampleRate != 0 ||
		trackTags.Codec != "" ||
		trackTags.BitRate != 0 ||
		trackTags.OverallBitRate != 0 ||
		trackTags.DurationSecs != 0 ||
		trackTags.Container != "" ||
		trackTags.FileSizeBytes != 0 ||
		trackTags.RecordingID != "" ||
		trackTags.ReleaseID != "" ||
		trackTags.ArtistID != "" ||
		len(trackTags.ArtistIDs) > 0 ||
		trackTags.AlbumArtistID != "" ||
		len(trackTags.AlbumArtistIDs) > 0 ||
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

func resolveTrackTagsWorkerCountWithMax(jobCount int, maxWorkerCount int) int {
	if jobCount <= 0 {
		return 0
	}
	if maxWorkerCount <= 0 {
		return 0
	}

	workerCount := runtime.NumCPU()
	if workerCount < 2 {
		workerCount = 2
	}
	if workerCount > maxWorkerCount {
		workerCount = maxWorkerCount
	}
	if workerCount > jobCount {
		workerCount = jobCount
	}

	return workerCount
}

func resolveTrackTagsWorkerCount(jobCount int) int {
	return resolveTrackTagsWorkerCountWithMax(jobCount, trackTagsWorkerLimit)
}

func trackTagsInflightKey(path string, signature trackTagsFileSignature) string {
	return path + "|" + strconv.FormatInt(signature.Size, 10) + "|" + strconv.FormatInt(signature.ModUnixNs, 10)
}

func (a *App) beginTrackTagsInflight(path string, signature trackTagsFileSignature) (*trackTagsInflightEntry, bool) {
	cacheState := a.trackTagsCacheState()
	cacheState.mu.Lock()
	defer cacheState.mu.Unlock()

	if cacheState.inflightBy == nil {
		cacheState.inflightBy = make(map[string]*trackTagsInflightEntry)
	}

	key := trackTagsInflightKey(path, signature)
	if existing, exists := cacheState.inflightBy[key]; exists {
		return existing, false
	}

	entry := &trackTagsInflightEntry{waitCh: make(chan struct{})}
	cacheState.inflightBy[key] = entry
	return entry, true
}

func (a *App) finishTrackTagsInflight(path string, signature trackTagsFileSignature, tags TrackTags, hasMetadata bool) {
	cacheState := a.trackTagsCacheState()
	cacheState.mu.Lock()
	defer cacheState.mu.Unlock()

	key := trackTagsInflightKey(path, signature)
	entry, exists := cacheState.inflightBy[key]
	if !exists {
		return
	}

	entry.tags = tags
	entry.hasMetadata = hasMetadata
	delete(cacheState.inflightBy, key)
	close(entry.waitCh)
}

func (a *App) removeTrackTagsCacheOrderEntryLocked(path string) {
	cacheState := a.trackTagsCacheState()
	for idx, cachedPath := range cacheState.order {
		if cachedPath != path {
			continue
		}

		cacheState.order = append(cacheState.order[:idx], cacheState.order[idx+1:]...)
		return
	}
}

func (a *App) touchTrackTagsCacheOrderLocked(path string) {
	cacheState := a.trackTagsCacheState()
	a.removeTrackTagsCacheOrderEntryLocked(path)
	cacheState.order = append(cacheState.order, path)
}

func (a *App) invalidateTrackTagsCachePaths(paths []string) {
	cacheState := a.trackTagsCacheState()
	cacheState.mu.Lock()
	defer cacheState.mu.Unlock()

	for _, path := range paths {
		delete(cacheState.byPath, path)
		a.removeTrackTagsCacheOrderEntryLocked(path)
	}
}

func (a *App) getTrackTagsCache(path string, signature trackTagsFileSignature) (TrackTags, bool, bool) {
	cacheState := a.trackTagsCacheState()
	cacheState.mu.Lock()
	defer cacheState.mu.Unlock()

	entry, exists := cacheState.byPath[path]
	if !exists {
		return TrackTags{}, false, false
	}

	if entry.Signature != signature {
		delete(cacheState.byPath, path)
		a.removeTrackTagsCacheOrderEntryLocked(path)
		return TrackTags{}, false, false
	}

	a.touchTrackTagsCacheOrderLocked(path)
	return entry.Tags, entry.HasMetadata, true
}

func (a *App) putTrackTagsCache(path string, signature trackTagsFileSignature, tags TrackTags, hasMetadata bool) {
	cacheState := a.trackTagsCacheState()
	cacheState.mu.Lock()
	defer cacheState.mu.Unlock()

	if cacheState.byPath == nil {
		cacheState.byPath = make(map[string]trackTagsCacheEntry, trackTagsCacheLimit)
	}

	cacheState.byPath[path] = trackTagsCacheEntry{
		Signature:   signature,
		Tags:        tags,
		HasMetadata: hasMetadata,
	}
	a.touchTrackTagsCacheOrderLocked(path)

	for len(cacheState.order) > trackTagsCacheLimit {
		evictedPath := cacheState.order[0]
		cacheState.order = cacheState.order[1:]
		delete(cacheState.byPath, evictedPath)
	}
}

func readTrackTagsForPath(path string, ffprobePath string) (TrackTags, bool) {
	tags, err := readTaglibTags(path)
	if err != nil {
		tags = readTrackTextTagsFromFFProbe(path, ffprobePath)
		if len(tags) == 0 {
			return TrackTags{}, false
		}
	} else if trackTagsNeedFFProbeTextFallback(tags) {
		tags = mergeTrackTagMaps(tags, readTrackTextTagsFromFFProbe(path, ffprobePath))
	}

	trackTags := buildTrackTags(tags, readTrackTechnicalMetadata(path, tags, ffprobePath))
	if !hasAnyTrackMetadata(trackTags) {
		return TrackTags{}, false
	}

	return trackTags, true
}

func storedTrackRecordHasReadTrackTagsMetadata(record musicBrainzTagTrackRecord) bool {
	if strings.TrimSpace(record.Title) != "" || strings.TrimSpace(record.TrackArtist) != "" || strings.TrimSpace(record.AlbumTitle) != "" || strings.TrimSpace(record.AlbumArtist) != "" {
		return true
	}
	if strings.TrimSpace(record.Date) != "" || strings.TrimSpace(record.RecordLabel) != "" || strings.TrimSpace(record.CatalogNumber) != "" {
		return true
	}
	if len(record.Genres) > 0 || record.TrackNumber > 0 || record.TrackTotal > 0 || record.DiscNumber > 0 || record.DiscTotal > 0 {
		return true
	}
	if record.DurationSeconds > 0 || record.BitRate > 0 || record.BitDepth > 0 || record.SampleRate > 0 || record.Channels > 0 {
		return true
	}
	if strings.TrimSpace(record.RecordingID) != "" || strings.TrimSpace(record.ReleaseID) != "" || len(record.ArtistIDs) > 0 || len(record.AlbumArtistIDs) > 0 {
		return true
	}

	return false
}

func trackTagsFromStoredTrackRecord(path string, signature trackTagsFileSignature, record musicBrainzTagTrackRecord) (TrackTags, bool) {
	if record.Signature != signature {
		return TrackTags{}, false
	}
	if !storedTrackRecordHasReadTrackTagsMetadata(record) {
		return TrackTags{}, false
	}

	container := inferContainerFromPath(path)
	codec := inferCodecFromContainerAndTags(container, nil)
	genre := ""
	if len(record.Genres) > 0 {
		genre = record.Genres[0]
	}
	artistID := ""
	if len(record.ArtistIDs) > 0 {
		artistID = record.ArtistIDs[0]
	}
	albumArtistID := ""
	if len(record.AlbumArtistIDs) > 0 {
		albumArtistID = record.AlbumArtistIDs[0]
	}
	fileSizeBytes := record.FileSizeBytes
	if fileSizeBytes <= 0 {
		fileSizeBytes = signature.Size
	}

	tags := TrackTags{
		Artist:         record.TrackArtist,
		AlbumArtist:    record.AlbumArtist,
		Album:          record.AlbumTitle,
		Title:          record.Title,
		Date:           record.Date,
		Genre:          genre,
		RecordLabel:    record.RecordLabel,
		CatalogNumber:  record.CatalogNumber,
		Genres:         append([]string(nil), record.Genres...),
		TrackNumber:    strconv.Itoa(record.TrackNumber),
		TrackTotal:     strconv.Itoa(record.TrackTotal),
		DiscNumber:     strconv.Itoa(record.DiscNumber),
		DiscTotal:      strconv.Itoa(record.DiscTotal),
		BitDepth:       record.BitDepth,
		SampleRate:     record.SampleRate,
		Codec:          codec,
		Channels:       record.Channels,
		ChannelLayout:  inferChannelLayout(record.Channels),
		BitRate:        record.BitRate,
		OverallBitRate: record.BitRate,
		DurationSecs:   record.DurationSeconds,
		Container:      container,
		FileSizeBytes:  fileSizeBytes,
		RecordingID:    record.RecordingID,
		ReleaseID:      record.ReleaseID,
		ArtistID:       artistID,
		ArtistIDs:      append([]string(nil), record.ArtistIDs...),
		AlbumArtistID:  albumArtistID,
		AlbumArtistIDs: append([]string(nil), record.AlbumArtistIDs...),
	}

	if tags.TrackNumber == "0" {
		tags.TrackNumber = ""
	}
	if tags.TrackTotal == "0" {
		tags.TrackTotal = ""
	}
	if tags.DiscNumber == "0" {
		tags.DiscNumber = ""
	}
	if tags.DiscTotal == "0" {
		tags.DiscTotal = ""
	}

	return tags, true
}

func cachedIndexedTrackMetadataFromStoredTrackRecord(record musicBrainzTagTrackRecord) (string, string, string, string, string, bool) {
	title := strings.TrimSpace(record.Title)
	album := strings.TrimSpace(record.AlbumTitle)
	albumArtist := strings.TrimSpace(record.AlbumArtist)
	artist := strings.TrimSpace(record.TrackArtist)
	trackNumber := ""
	trackTotal := ""
	if record.TrackNumber > 0 {
		trackNumber = strconv.Itoa(record.TrackNumber)
	}
	if record.TrackTotal > 0 {
		trackTotal = strconv.Itoa(record.TrackTotal)
	}

	if title == "" && album == "" && albumArtist == "" && artist == "" && trackNumber == "" && trackTotal == "" {
		return "", "", "", "", "", false
	}

	return title, album, albumArtist, artist, trackNumber, trackTotal != "" || trackNumber != "" || title != "" || album != "" || albumArtist != "" || artist != ""
}

func (a *App) applyStoredMetadataToIndexedTracks(entries []LibraryIndexedFile) []LibraryIndexedFile {
	if len(entries) == 0 || !a.localLibraryFilesDatabaseEnabled() {
		return entries
	}

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()
	if !a.musicBrainzTagStoreLoaded {
		return entries
	}

	enriched := append([]LibraryIndexedFile(nil), entries...)
	for index, entry := range enriched {
		record, exists := a.musicBrainzTagStore.Tracks[entry.Path]
		if !exists {
			continue
		}

		title, album, albumArtist, artist, trackNumber, hasMetadata := cachedIndexedTrackMetadataFromStoredTrackRecord(record)
		if !hasMetadata {
			continue
		}

		if title != "" {
			enriched[index].CachedTrackTitle = title
		}
		if album != "" {
			enriched[index].CachedAlbumTitle = album
		}
		if albumArtist != "" {
			enriched[index].CachedAlbumArtist = albumArtist
		}
		if artist != "" {
			enriched[index].CachedArtistName = artist
		}
		if trackNumber != "" {
			enriched[index].CachedTrackNumber = trackNumber
		}
		if record.TrackTotal > 0 {
			enriched[index].CachedTrackTotal = strconv.Itoa(record.TrackTotal)
		}
	}

	return enriched
}

func (a *App) readTrackTagsFromMetadataDatabase(jobs []readTrackTagsJob) map[string]TrackTags {
	if len(jobs) == 0 {
		return nil
	}

	a.musicBrainzTagMu.Lock()
	if a.musicBrainzTagStoreLoaded {
		defer a.musicBrainzTagMu.Unlock()

		var tagByPath map[string]TrackTags
		for _, job := range jobs {
			record, exists := a.musicBrainzTagStore.Tracks[job.path]
			if !exists {
				continue
			}

			tags, ok := trackTagsFromStoredTrackRecord(job.path, job.signature, record)
			if !ok {
				continue
			}

			if tagByPath == nil {
				tagByPath = make(map[string]TrackTags, len(jobs))
			}
			tagByPath[job.path] = tags
		}

		return tagByPath
	}
	a.musicBrainzTagMu.Unlock()

	paths := make([]string, 0, len(jobs))
	for _, job := range jobs {
		paths = append(paths, job.path)
	}
	recordByPath := loadMusicBrainzTagTrackRecordsFromSQLite(a.musicBrainzTagDatabasePath(), paths)

	var tagByPath map[string]TrackTags
	for _, job := range jobs {
		record, exists := recordByPath[job.path]
		if !exists {
			continue
		}

		tags, ok := trackTagsFromStoredTrackRecord(job.path, job.signature, record)
		if !ok {
			continue
		}

		if tagByPath == nil {
			tagByPath = make(map[string]TrackTags, len(jobs))
		}
		tagByPath[job.path] = tags
	}

	return tagByPath
}

// ReadTrackTags reads tag and technical metadata for track files by path.
func (a *App) ReadTrackTags(paths []string) map[string]TrackTags {
	return profiledValue(a, "ReadTrackTags", func() map[string]TrackTags {
		tagByPath := a.readTrackTagsWithWorkerLimit(paths, trackTagsWorkerLimit, true)
		if len(tagByPath) != 0 {
			resolvedPaths := make([]string, 0, len(tagByPath))
			for path := range tagByPath {
				resolvedPaths = append(resolvedPaths, path)
			}
			a.syncSystemMediaTransportControlsForTrackPaths(resolvedPaths)
		}
		return tagByPath
	})
}

func (a *App) refreshTrackMetadataDatabaseRecord(path string, signature trackTagsFileSignature, tags TrackTags) {
	if !a.localLibraryFilesDatabaseEnabled() {
		return
	}

	contentState := a.libraryContentState()
	contentState.indexMu.RLock()
	indexed, exists := contentState.trackByPath[path]
	contentState.indexMu.RUnlock()
	if !exists {
		return
	}

	releaseDepthByRootPath := a.musicBrainzTagReleaseDepthByRootPath()
	releaseDepth := releaseDepthByRootPath[strings.ToLower(normalizePath(indexed.RootPath))]
	record := musicBrainzTagTrackRecordFromIndexedTrack(indexed, releaseDepth, signature, tags)

	a.musicBrainzTagMu.Lock()
	defer a.musicBrainzTagMu.Unlock()

	a.ensureMusicBrainzTagDatabaseLoadedLocked()
	a.upsertMusicBrainzTagTrackRecordLocked(indexed.Path, record)
}

// RefreshTrackMetadata forces a fresh metadata read for a library track without interrupting playback.
func (a *App) RefreshTrackMetadata(path string) (TrackTags, error) {
	return profiledResult(a, "RefreshTrackMetadata", func() (TrackTags, error) {
		cleanPath := normalizePath(path)
		if cleanPath == "" {
			return TrackTags{}, errors.New("track path is required")
		}
		if _, ok := parseRemoteLibraryPath(cleanPath); ok {
			return TrackTags{}, errors.New("remote track metadata refresh is not supported")
		}
		if !a.isAllowedLibraryPath(cleanPath) {
			return TrackTags{}, errors.New("track path is outside the selected library")
		}
		if !isAudioPath(cleanPath) {
			return TrackTags{}, errors.New("track path is not an audio file")
		}

		a.invalidateTrackTagsCachePaths([]string{cleanPath})
		tagByPath := a.readTrackTagsWithWorkerLimit([]string{cleanPath}, 1, false)
		tags := tagByPath[cleanPath]
		if signature, ok := trackTagsFileSignatureForPath(cleanPath); ok {
			a.refreshTrackMetadataDatabaseRecord(cleanPath, signature, tags)
		}
		a.syncSystemMediaTransportControlsForTrackPaths([]string{cleanPath})
		return tags, nil
	})
}

func (a *App) readTrackTagsWithWorkerLimit(paths []string, maxWorkerCount int, allowMetadataDatabase bool) map[string]TrackTags {
	startedAt := time.Now()
	normalizedPaths := a.normalizeTrackTagPaths(paths)
	tagByPath := make(map[string]TrackTags, len(normalizedPaths))
	if len(normalizedPaths) == 0 {
		return tagByPath
	}

	localPaths := make([]string, 0, len(normalizedPaths))
	for _, path := range normalizedPaths {
		if _, ok := parseRemoteLibraryPath(path); ok {
			continue
		}
		localPaths = append(localPaths, path)
	}

	jobs := make(chan readTrackTagsJob, len(localPaths))
	results := make(chan readTrackTagsResult, len(localPaths))
	queuedJobs := 0
	cacheHits := 0
	databaseHits := 0
	a.ensureSettingsLoaded()
	ffprobePath := resolveFFProbePath(a.settingsState().settings.FFmpegPath)
	useMetadataDatabase := allowMetadataDatabase && a.localLibraryFilesDatabaseEnabled()
	pendingJobs := make([]readTrackTagsJob, 0, len(localPaths))

	for _, path := range localPaths {
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

		pendingJobs = append(pendingJobs, readTrackTagsJob{
			path:      path,
			signature: signature,
		})
	}

	if useMetadataDatabase {
		databaseTagByPath := a.readTrackTagsFromMetadataDatabase(pendingJobs)
		if len(databaseTagByPath) > 0 {
			filteredJobs := pendingJobs[:0]
			for _, job := range pendingJobs {
				databaseTags, ok := databaseTagByPath[job.path]
				if !ok {
					filteredJobs = append(filteredJobs, job)
					continue
				}

				databaseHits++
				tagByPath[job.path] = databaseTags
				a.putTrackTagsCache(job.path, job.signature, databaseTags, true)
			}
			pendingJobs = filteredJobs
		}
	}

	ownedJobs := make([]readTrackTagsJob, 0, len(pendingJobs))
	type trackTagsWaiter struct {
		path  string
		entry *trackTagsInflightEntry
	}
	waiters := make([]trackTagsWaiter, 0, len(pendingJobs))
	for _, job := range pendingJobs {
		entry, shouldRead := a.beginTrackTagsInflight(job.path, job.signature)
		if shouldRead {
			ownedJobs = append(ownedJobs, job)
			continue
		}

		waiters = append(waiters, trackTagsWaiter{path: job.path, entry: entry})
	}
	pendingJobs = ownedJobs

	for _, job := range pendingJobs {
		jobs <- job
		queuedJobs++
	}
	close(jobs)

	workerCount := resolveTrackTagsWorkerCountWithMax(queuedJobs, maxWorkerCount)
	if workerCount > 0 {
		var workerWaitGroup sync.WaitGroup
		for workerIndex := 0; workerIndex < workerCount; workerIndex++ {
			workerWaitGroup.Add(1)
			go func() {
				defer workerWaitGroup.Done()
				for job := range jobs {
					trackTags, hasMetadata := readTrackTagsForPath(job.path, ffprobePath)
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
			a.finishTrackTagsInflight(result.path, result.signature, result.tags, result.hasMetadata)
			if !result.hasMetadata {
				continue
			}

			tagByPath[result.path] = result.tags
		}
	}

	for _, waiter := range waiters {
		<-waiter.entry.waitCh
		if !waiter.entry.hasMetadata {
			continue
		}

		tagByPath[waiter.path] = waiter.entry.tags
	}

	if len(normalizedPaths) > 1 {
		a.logRescanEvent(
			"ReadTrackTags END: requested=%d cacheHits=%d databaseHits=%d parsed=%d returned=%d workers=%d took %.2fms",
			len(normalizedPaths),
			cacheHits,
			databaseHits,
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
	return profiledValue(a, "ReadTrackTagsFromBlobs", func() map[string]TrackTags {
		tagByKey := make(map[string]TrackTags, len(blobs))
		a.ensureSettingsLoaded()
		ffprobePath := resolveFFProbePath(a.settingsState().settings.FFmpegPath)

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

			tags, err := readTaglibTags(tempPath)
			if err != nil {
				_ = os.Remove(tempPath)
				continue
			}

			technical := readTrackTechnicalMetadata(tempPath, tags, ffprobePath)
			_ = os.Remove(tempPath)
			trackTags := buildTrackTags(tags, technical)
			if !hasAnyTrackMetadata(trackTags) {
				continue
			}

			tagByKey[blob.Key] = trackTags
		}

		return tagByKey
	})
}
