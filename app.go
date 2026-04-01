package main

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	taglib "go.senan.xyz/taglib"
)

// App struct
type App struct {
	ctx context.Context
}

type TrackTags struct {
	Artist      string   `json:"artist"`
	Album       string   `json:"album"`
	Title       string   `json:"title"`
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
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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
		if strings.TrimSpace(path) == "" {
			continue
		}

		tags, err := taglib.ReadTags(path)
		if err != nil {
			continue
		}

		artist := firstTagValue(tags, "ARTIST", "ALBUMARTIST")
		album := firstTagValue(tags, "ALBUM")
		title := firstTagValue(tags, "TITLE")
		artistIDs := extractArtistMBIDs(tags)

		if artist == "" && album == "" && title == "" {
			continue
		}

		tagByPath[path] = TrackTags{
			Artist:      artist,
			Album:       album,
			Title:       title,
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
		artistIDs := extractArtistMBIDs(tags)

		if artist == "" && album == "" && title == "" {
			continue
		}

		tagByKey[blob.Key] = TrackTags{
			Artist:      artist,
			Album:       album,
			Title:       title,
			RecordingID: firstTagValue(tags, "MUSICBRAINZ_TRACKID", "MusicBrainz Track Id"),
			ReleaseID:   firstTagValue(tags, "MUSICBRAINZ_ALBUMID", "MusicBrainz Album Id"),
			ArtistID:    firstTagValue(tags, "MUSICBRAINZ_ARTISTID", "MusicBrainz Artist Id"),
			ArtistIDs:   artistIDs,
		}
	}

	return tagByKey
}
