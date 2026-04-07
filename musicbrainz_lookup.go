package main

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// LookupArtistByMBID fetches artist metadata from MusicBrainz for the provided MBID.
func (a *App) LookupArtistByMBID(mbid string) MusicBrainzArtistInfo {
	cleanMBID := strings.ToLower(strings.TrimSpace(mbid))
	if !mbidPattern.MatchString(cleanMBID) {
		return MusicBrainzArtistInfo{Found: false}
	}

	requestURL := fmt.Sprintf("%s/artist/%s?fmt=json&inc=genres+tags+url-rels", a.musicBrainzAPIBaseURL(), cleanMBID)
	responseBody, ok := fetchMusicBrainzJSON(requestURL, a.musicBrainzRequestRateMs())
	if !ok {
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

// LookupTrackMusicBrainzMetadata fetches display metadata for a track using recording and release MBIDs.
func (a *App) LookupTrackMusicBrainzMetadata(recordingID string, releaseID string) MusicBrainzTrackMetadata {
	cleanRecordingID := strings.ToLower(strings.TrimSpace(recordingID))
	cleanReleaseID := strings.ToLower(strings.TrimSpace(releaseID))

	if !mbidPattern.MatchString(cleanRecordingID) {
		cleanRecordingID = ""
	}
	if !mbidPattern.MatchString(cleanReleaseID) {
		cleanReleaseID = ""
	}

	result := MusicBrainzTrackMetadata{
		Found:         false,
		RecordingID:   cleanRecordingID,
		ReleaseID:     cleanReleaseID,
		ArtistCredits: []MusicBrainzArtistCreditPart{},
	}

	if cleanRecordingID == "" && cleanReleaseID == "" {
		return result
	}

	recordingPayload := map[string]any{}
	releasePayload := map[string]any{}

	if cleanRecordingID != "" {
		requestURL := fmt.Sprintf("%s/recording/%s?fmt=json&inc=artists+releases", a.musicBrainzAPIBaseURL(), cleanRecordingID)
		if responseBody, ok := fetchMusicBrainzJSON(requestURL, a.musicBrainzRequestRateMs()); ok {
			if err := json.Unmarshal(responseBody, &recordingPayload); err != nil {
				recordingPayload = map[string]any{}
			}
		}
	}

	if cleanReleaseID != "" {
		requestURL := fmt.Sprintf("%s/release/%s?fmt=json&inc=artists+labels", a.musicBrainzAPIBaseURL(), cleanReleaseID)
		if responseBody, ok := fetchMusicBrainzJSON(requestURL, a.musicBrainzRequestRateMs()); ok {
			if err := json.Unmarshal(responseBody, &releasePayload); err != nil {
				releasePayload = map[string]any{}
			}
		}
	}

	title := objectString(recordingPayload, "title")
	album := objectString(releasePayload, "title")
	if album == "" {
		album = firstMusicBrainzReleaseTitle(recordingPayload)
	}

	artist := musicBrainzArtistCredit(recordingPayload)
	artistCredits := musicBrainzArtistCredits(recordingPayload)
	if artist == "" {
		artist = musicBrainzArtistCredit(releasePayload)
		artistCredits = musicBrainzArtistCredits(releasePayload)
	}

	result.LabelID = musicBrainzReleaseLabelID(releasePayload)
	result.Title = title
	result.Album = album
	result.Artist = artist
	result.ArtistCredits = artistCredits
	result.Found = result.Title != "" || result.Album != "" || result.Artist != ""

	return result
}

func musicBrainzReleaseLabelID(payload map[string]any) string {
	for _, labelInfoValue := range asArray(payload["label-info"]) {
		labelInfo := asObject(labelInfoValue)
		labelValue := asObject(labelInfo["label"])
		labelID := objectString(labelValue, "id")
		if labelID != "" {
			return strings.ToLower(strings.TrimSpace(labelID))
		}
	}

	for _, labelValue := range asArray(payload["labels"]) {
		labelObj := asObject(labelValue)
		labelID := objectString(labelObj, "id")
		if labelID != "" {
			return strings.ToLower(strings.TrimSpace(labelID))
		}
	}

	return ""
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
	case "label":
		incClause = "releases+genres+tags+url-rels"
	default:
		return result
	}

	requestURL := fmt.Sprintf("%s/%s/%s?fmt=json&inc=%s", a.musicBrainzAPIBaseURL(), cleanEntityType, cleanMBID, incClause)
	responseBody, ok := fetchMusicBrainzJSON(requestURL, a.musicBrainzRequestRateMs())
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

	case "label":
		result.Title = objectString(payload, "name")
		result.Summary = objectString(payload, "disambiguation")

		facts = appendFact(facts, "Label code", objectString(payload, "label-code"))
		facts = appendFact(facts, "Type", objectString(payload, "type"))
		facts = appendFact(facts, "Country", objectString(payload, "country"))
		facts = appendFact(facts, "Begin date", objectString(payload, "begin-date"))
		facts = appendFact(facts, "End date", objectString(payload, "end-date"))
		facts = appendFact(facts, "Artist credit", musicBrainzArtistCredit(payload))

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
