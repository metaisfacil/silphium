package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// MusicBrainzArtistInfo contains enriched artist details returned by MusicBrainz lookup.
type MusicBrainzArtistInfo struct {
	Found          bool             `json:"found"`
	MBID           string           `json:"mbid"`
	Name           string           `json:"name"`
	Type           string           `json:"type"`
	Country        string           `json:"country"`
	Disambiguation string           `json:"disambiguation"`
	LifeSpan       string           `json:"lifeSpan"`
	Genres         []string         `json:"genres"`
	URLs           []MusicBrainzURL `json:"urls"`
}

// MusicBrainzURL describes an external URL relation attached to a MusicBrainz entity.
type MusicBrainzURL struct {
	Type     string `json:"type"`
	Resource string `json:"resource"`
}

// MusicBrainzEntityFact is a label/value fact row shown in MusicBrainz entity details.
type MusicBrainzEntityFact struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// MusicBrainzEntityInfo contains normalized lookup data for recording, release, or artist entities.
type MusicBrainzEntityInfo struct {
	Found      bool                    `json:"found"`
	EntityType string                  `json:"entityType"`
	MBID       string                  `json:"mbid"`
	Title      string                  `json:"title"`
	Subtitle   string                  `json:"subtitle"`
	Summary    string                  `json:"summary"`
	Facts      []MusicBrainzEntityFact `json:"facts"`
	Tags       []string                `json:"tags"`
	URLs       []MusicBrainzURL        `json:"urls"`
	RawJSON    string                  `json:"rawJson"`
}

const musicBrainzUserAgent = "Silphium/1.0 (metaisfacil@users.noreply.github.com)"

func fetchMusicBrainzJSON(requestURL string) ([]byte, bool) {
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, false
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", musicBrainzUserAgent)

	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, false
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, false
	}

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, false
	}

	return responseBody, true
}

func musicBrainzEntitySubtitle(entityType string) string {
	switch entityType {
	case "recording":
		return "Recording"
	case "release":
		return "Release"
	case "artist":
		return "Artist"
	default:
		return "Entity"
	}
}

func asObject(value any) map[string]any {
	if parsed, ok := value.(map[string]any); ok {
		return parsed
	}

	return map[string]any{}
}

func asArray(value any) []any {
	if parsed, ok := value.([]any); ok {
		return parsed
	}

	return []any{}
}

func asString(value any) string {
	if parsed, ok := value.(string); ok {
		return strings.TrimSpace(parsed)
	}

	return ""
}

func objectString(object map[string]any, key string) string {
	if object == nil {
		return ""
	}

	return asString(object[key])
}

func objectNumber(object map[string]any, key string) (float64, bool) {
	if object == nil {
		return 0, false
	}

	value, exists := object[key]
	if !exists || value == nil {
		return 0, false
	}

	parsed, ok := value.(float64)
	if !ok {
		return 0, false
	}

	return parsed, true
}

func objectBool(object map[string]any, key string) (bool, bool) {
	if object == nil {
		return false, false
	}

	value, exists := object[key]
	if !exists || value == nil {
		return false, false
	}

	parsed, ok := value.(bool)
	if !ok {
		return false, false
	}

	return parsed, true
}

func appendFact(facts []MusicBrainzEntityFact, label string, value string) []MusicBrainzEntityFact {
	cleanLabel := strings.TrimSpace(label)
	cleanValue := strings.TrimSpace(value)
	if cleanLabel == "" || cleanValue == "" {
		return facts
	}

	return append(facts, MusicBrainzEntityFact{Label: cleanLabel, Value: cleanValue})
}

func formatDurationMillis(millis float64) string {
	if millis <= 0 {
		return ""
	}

	totalSeconds := int((millis + 500) / 1000)
	hours := totalSeconds / 3600
	minutes := (totalSeconds % 3600) / 60
	seconds := totalSeconds % 60

	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%02d", hours, minutes, seconds)
	}

	return fmt.Sprintf("%d:%02d", minutes, seconds)
}

func musicBrainzLifeSpan(payload map[string]any) string {
	lifeSpan := asObject(payload["life-span"])
	begin := objectString(lifeSpan, "begin")
	end := objectString(lifeSpan, "end")
	ended, hasEnded := objectBool(lifeSpan, "ended")

	if end != "" {
		if begin == "" {
			begin = "?"
		}
		return fmt.Sprintf("%s – %s", begin, end)
	}

	if hasEnded && ended {
		if begin == "" {
			begin = "?"
		}
		return fmt.Sprintf("%s –", begin)
	}

	return begin
}

func musicBrainzArtistCredit(payload map[string]any) string {
	parts := make([]string, 0)
	for _, entry := range asArray(payload["artist-credit"]) {
		if textEntry, ok := entry.(string); ok {
			if trimmed := strings.TrimSpace(textEntry); trimmed != "" {
				parts = append(parts, trimmed)
			}
			continue
		}

		entryMap := asObject(entry)
		if len(entryMap) == 0 {
			continue
		}

		name := objectString(entryMap, "name")
		if name == "" {
			name = objectString(asObject(entryMap["artist"]), "name")
		}
		if name == "" {
			continue
		}

		joinPhrase := objectString(entryMap, "joinphrase")
		parts = append(parts, fmt.Sprintf("%s%s", name, joinPhrase))
	}

	return strings.TrimSpace(strings.Join(parts, ""))
}

func collectMusicBrainzTagNames(payload map[string]any) []string {
	type weightedTag struct {
		name  string
		count float64
	}

	weightedTags := make([]weightedTag, 0)
	for _, key := range []string{"genres", "tags"} {
		for _, rawTag := range asArray(payload[key]) {
			tag := asObject(rawTag)
			name := objectString(tag, "name")
			if name == "" {
				continue
			}

			count, ok := objectNumber(tag, "count")
			if !ok {
				count = 0
			}

			weightedTags = append(weightedTags, weightedTag{name: name, count: count})
		}
	}

	sort.SliceStable(weightedTags, func(i, j int) bool {
		if weightedTags[i].count == weightedTags[j].count {
			return weightedTags[i].name < weightedTags[j].name
		}
		return weightedTags[i].count > weightedTags[j].count
	})

	seen := make(map[string]struct{})
	names := make([]string, 0, len(weightedTags))
	for _, tag := range weightedTags {
		key := strings.ToLower(tag.name)
		if _, exists := seen[key]; exists {
			continue
		}

		seen[key] = struct{}{}
		names = append(names, tag.name)
	}

	return names
}

func collectMusicBrainzURLRelations(payload map[string]any) []MusicBrainzURL {
	urls := make([]MusicBrainzURL, 0)
	seen := make(map[string]struct{})

	for _, relationValue := range asArray(payload["relations"]) {
		relation := asObject(relationValue)
		if !strings.EqualFold(objectString(relation, "target-type"), "url") {
			continue
		}

		resource := objectString(asObject(relation["url"]), "resource")
		if resource == "" {
			continue
		}

		if _, exists := seen[resource]; exists {
			continue
		}

		seen[resource] = struct{}{}
		urls = append(urls, MusicBrainzURL{Type: objectString(relation, "type"), Resource: resource})
	}

	sort.SliceStable(urls, func(i, j int) bool {
		if urls[i].Type == urls[j].Type {
			return urls[i].Resource < urls[j].Resource
		}
		return urls[i].Type < urls[j].Type
	})

	return urls
}

func prettyJSON(raw []byte) string {
	var output bytes.Buffer
	if err := json.Indent(&output, raw, "", "  "); err != nil {
		return string(raw)
	}

	return output.String()
}

// LookupArtistByMBID fetches artist metadata from MusicBrainz for the provided MBID.
func (a *App) LookupArtistByMBID(mbid string) MusicBrainzArtistInfo {
	cleanMBID := strings.ToLower(strings.TrimSpace(mbid))
	if !mbidPattern.MatchString(cleanMBID) {
		return MusicBrainzArtistInfo{Found: false}
	}

	requestURL := fmt.Sprintf("https://musicbrainz.org/ws/2/artist/%s?fmt=json&inc=genres+tags+url-rels", cleanMBID)
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", musicBrainzUserAgent)

	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return MusicBrainzArtistInfo{Found: false}
	}

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}

	type mbGenre struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	type mbLifeSpan struct {
		Begin string `json:"begin"`
		End   string `json:"end"`
		Ended bool   `json:"ended"`
	}

	type mbArtistResponse struct {
		ID             string     `json:"id"`
		Name           string     `json:"name"`
		Type           string     `json:"type"`
		Country        string     `json:"country"`
		Disambiguation string     `json:"disambiguation"`
		LifeSpan       mbLifeSpan `json:"life-span"`
		Genres         []mbGenre  `json:"genres"`
		Tags           []mbGenre  `json:"tags"`
		Relations      []struct {
			Type       string `json:"type"`
			TargetType string `json:"target-type"`
			URL        struct {
				Resource string `json:"resource"`
			} `json:"url"`
		} `json:"relations"`
	}

	var payload mbArtistResponse
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return MusicBrainzArtistInfo{Found: false}
	}

	lifeSpan := strings.TrimSpace(payload.LifeSpan.Begin)
	if payload.LifeSpan.End != "" {
		if lifeSpan == "" {
			lifeSpan = "?"
		}
		lifeSpan = fmt.Sprintf("%s – %s", lifeSpan, payload.LifeSpan.End)
	} else if payload.LifeSpan.Ended {
		if lifeSpan == "" {
			lifeSpan = "?"
		}
		lifeSpan = fmt.Sprintf("%s –", lifeSpan)
	}

	genres := payload.Genres
	if len(genres) == 0 {
		genres = payload.Tags
	}

	sort.SliceStable(genres, func(i, j int) bool {
		return genres[i].Count > genres[j].Count
	})

	genreNames := make([]string, 0, 6)
	seenGenres := make(map[string]struct{})
	for _, genre := range genres {
		name := strings.TrimSpace(genre.Name)
		if name == "" {
			continue
		}

		key := strings.ToLower(name)
		if _, exists := seenGenres[key]; exists {
			continue
		}

		seenGenres[key] = struct{}{}
		genreNames = append(genreNames, name)
		if len(genreNames) >= 6 {
			break
		}
	}

	if payload.Name == "" {
		return MusicBrainzArtistInfo{Found: false}
	}

	urls := make([]MusicBrainzURL, 0)
	seenURL := make(map[string]struct{})
	for _, relation := range payload.Relations {
		if !strings.EqualFold(relation.TargetType, "url") {
			continue
		}

		resource := strings.TrimSpace(relation.URL.Resource)
		if resource == "" {
			continue
		}

		if _, exists := seenURL[resource]; exists {
			continue
		}

		seenURL[resource] = struct{}{}
		urls = append(urls, MusicBrainzURL{
			Type:     strings.TrimSpace(relation.Type),
			Resource: resource,
		})
	}

	sort.SliceStable(urls, func(i, j int) bool {
		if urls[i].Type == urls[j].Type {
			return urls[i].Resource < urls[j].Resource
		}
		return urls[i].Type < urls[j].Type
	})

	return MusicBrainzArtistInfo{
		Found:          true,
		MBID:           payload.ID,
		Name:           payload.Name,
		Type:           payload.Type,
		Country:        payload.Country,
		Disambiguation: payload.Disambiguation,
		LifeSpan:       lifeSpan,
		Genres:         genreNames,
		URLs:           urls,
	}
}

// LookupMusicBrainzEntity fetches recording, release, or artist metadata by entity type and MBID.
func (a *App) LookupMusicBrainzEntity(entityType string, mbid string) MusicBrainzEntityInfo {
	cleanEntityType := strings.ToLower(strings.TrimSpace(entityType))
	cleanMBID := strings.ToLower(strings.TrimSpace(mbid))

	result := MusicBrainzEntityInfo{
		Found:      false,
		EntityType: cleanEntityType,
		MBID:       cleanMBID,
		Subtitle:   musicBrainzEntitySubtitle(cleanEntityType),
		Facts:      []MusicBrainzEntityFact{},
		Tags:       []string{},
		URLs:       []MusicBrainzURL{},
	}

	if !mbidPattern.MatchString(cleanMBID) {
		return result
	}

	incClause := ""
	switch cleanEntityType {
	case "recording":
		incClause = "artists+releases+genres+tags+url-rels"
	case "release":
		incClause = "recordings+artists+labels+genres+tags+url-rels+release-groups"
	case "artist":
		incClause = "genres+tags+url-rels"
	default:
		return result
	}

	requestURL := fmt.Sprintf("https://musicbrainz.org/ws/2/%s/%s?fmt=json&inc=%s", cleanEntityType, cleanMBID, incClause)
	responseBody, ok := fetchMusicBrainzJSON(requestURL)
	if !ok {
		return result
	}

	payload := make(map[string]any)
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return result
	}

	result.Found = true
	result.RawJSON = prettyJSON(responseBody)
	result.Tags = collectMusicBrainzTagNames(payload)
	result.URLs = collectMusicBrainzURLRelations(payload)

	facts := make([]MusicBrainzEntityFact, 0)
	facts = appendFact(facts, "MBID", cleanMBID)

	switch cleanEntityType {
	case "recording":
		result.Title = objectString(payload, "title")
		result.Summary = objectString(payload, "disambiguation")

		facts = appendFact(facts, "Artist credit", musicBrainzArtistCredit(payload))
		facts = appendFact(facts, "First release date", objectString(payload, "first-release-date"))
		if lengthMillis, hasLength := objectNumber(payload, "length"); hasLength {
			facts = appendFact(facts, "Length", formatDurationMillis(lengthMillis))
		}

		if video, hasVideo := objectBool(payload, "video"); hasVideo {
			if video {
				facts = appendFact(facts, "Video recording", "Yes")
			} else {
				facts = appendFact(facts, "Video recording", "No")
			}
		}

		releases := asArray(payload["releases"])
		if len(releases) > 0 {
			facts = appendFact(facts, "Release count", fmt.Sprintf("%d", len(releases)))

			releaseTitles := make([]string, 0, 4)
			for _, releaseValue := range releases {
				releaseTitle := objectString(asObject(releaseValue), "title")
				if releaseTitle == "" {
					continue
				}

				releaseTitles = append(releaseTitles, releaseTitle)
				if len(releaseTitles) >= 4 {
					break
				}
			}

			if len(releaseTitles) > 0 {
				facts = appendFact(facts, "Releases", strings.Join(releaseTitles, ", "))
			}
		}

	case "release":
		result.Title = objectString(payload, "title")
		result.Summary = objectString(payload, "disambiguation")

		facts = appendFact(facts, "Artist credit", musicBrainzArtistCredit(payload))
		facts = appendFact(facts, "Status", objectString(payload, "status"))
		facts = appendFact(facts, "Date", objectString(payload, "date"))
		facts = appendFact(facts, "Country", objectString(payload, "country"))
		facts = appendFact(facts, "Barcode", objectString(payload, "barcode"))
		facts = appendFact(facts, "Packaging", objectString(payload, "packaging"))
		facts = appendFact(facts, "Quality", objectString(payload, "quality"))

		labelNames := make([]string, 0)
		catalogNumbers := make([]string, 0)
		seenLabelNames := make(map[string]struct{})
		seenCatalogNumbers := make(map[string]struct{})
		for _, labelInfoValue := range asArray(payload["label-info"]) {
			labelInfo := asObject(labelInfoValue)

			labelName := objectString(asObject(labelInfo["label"]), "name")
			if labelName != "" {
				labelKey := strings.ToLower(labelName)
				if _, exists := seenLabelNames[labelKey]; !exists {
					seenLabelNames[labelKey] = struct{}{}
					labelNames = append(labelNames, labelName)
				}
			}

			catalogNumber := objectString(labelInfo, "catalog-number")
			if catalogNumber != "" {
				catalogKey := strings.ToLower(catalogNumber)
				if _, exists := seenCatalogNumbers[catalogKey]; !exists {
					seenCatalogNumbers[catalogKey] = struct{}{}
					catalogNumbers = append(catalogNumbers, catalogNumber)
				}
			}
		}

		if len(labelNames) > 0 {
			facts = appendFact(facts, "Label", strings.Join(labelNames, ", "))
		}
		if len(catalogNumbers) > 0 {
			facts = appendFact(facts, "Catalog #", strings.Join(catalogNumbers, ", "))
		}

		textRepresentation := asObject(payload["text-representation"])
		facts = appendFact(facts, "Language", objectString(textRepresentation, "language"))
		facts = appendFact(facts, "Script", objectString(textRepresentation, "script"))

		releaseGroup := asObject(payload["release-group"])
		facts = appendFact(facts, "Release group", objectString(releaseGroup, "title"))
		facts = appendFact(facts, "Release group type", objectString(releaseGroup, "primary-type"))

		media := asArray(payload["media"])
		if len(media) > 0 {
			totalTracks := 0
			mediaFormats := make([]string, 0, len(media))

			for _, mediaValue := range media {
				mediaObject := asObject(mediaValue)
				if trackCount, hasTrackCount := objectNumber(mediaObject, "track-count"); hasTrackCount {
					totalTracks += int(trackCount)
				}

				formatLabel := objectString(mediaObject, "format")
				if formatLabel == "" {
					formatLabel = "Medium"
				}

				titleLabel := objectString(mediaObject, "title")
				if titleLabel != "" {
					mediaFormats = append(mediaFormats, fmt.Sprintf("%s (%s)", formatLabel, titleLabel))
				} else {
					mediaFormats = append(mediaFormats, formatLabel)
				}
			}

			if totalTracks > 0 {
				facts = appendFact(facts, "Total tracks", fmt.Sprintf("%d", totalTracks))
			}
			if len(mediaFormats) > 0 {
				facts = appendFact(facts, "Media", strings.Join(mediaFormats, ", "))
			}
		}

	case "artist":
		result.Title = objectString(payload, "name")
		result.Summary = objectString(payload, "disambiguation")

		facts = appendFact(facts, "Type", objectString(payload, "type"))
		facts = appendFact(facts, "Gender", objectString(payload, "gender"))
		facts = appendFact(facts, "Country", objectString(payload, "country"))
		facts = appendFact(facts, "Sort name", objectString(payload, "sort-name"))
		facts = appendFact(facts, "Life span", musicBrainzLifeSpan(payload))
		facts = appendFact(facts, "Begin area", objectString(asObject(payload["begin-area"]), "name"))
		facts = appendFact(facts, "Area", objectString(asObject(payload["area"]), "name"))
	}

	if result.Title == "" {
		result.Title = fmt.Sprintf("%s info", result.Subtitle)
	}

	result.Facts = facts
	return result
}
