package main

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

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
