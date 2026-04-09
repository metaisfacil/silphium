package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

func fetchMusicBrainzJSON(requestURL string, rateLimitMs int) ([]byte, bool) {
	return fetchMusicBrainzJSONWithPriority(requestURL, musicBrainzRequestPriorityInteractive, rateLimitMs)
}

func fetchMusicBrainzPayload(requestURL string, rateLimitMs int) (map[string]any, bool) {
	return fetchMusicBrainzPayloadWithPriority(requestURL, musicBrainzRequestPriorityInteractive, rateLimitMs)
}

func (a *App) musicBrainzServerURL() string {
	a.ensureSettingsLoaded()
	u := strings.TrimRight(strings.TrimSpace(a.settingsState().settings.MusicBrainzServerURL), "/")
	if u == "" {
		return musicBrainzPublicServerURL
	}

	return u
}

func (a *App) musicBrainzAPIBaseURL() string {
	return a.musicBrainzServerURL() + "/ws/2"
}

func (a *App) musicBrainzRequestRateMs() int {
	a.ensureSettingsLoaded()
	return a.settingsState().settings.MusicBrainzRequestRateMs
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

func objectRawString(object map[string]any, key string) string {
	if object == nil {
		return ""
	}

	if parsed, ok := object[key].(string); ok {
		return parsed
	}

	return ""
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
	credits := musicBrainzArtistCredits(payload)
	if len(credits) == 0 {
		return ""
	}

	parts := make([]string, 0, len(credits))
	for _, credit := range credits {
		parts = append(parts, fmt.Sprintf("%s%s", credit.Name, credit.JoinPhrase))
	}

	return strings.TrimSpace(strings.Join(parts, ""))
}

func musicBrainzArtistCredits(payload map[string]any) []MusicBrainzArtistCreditPart {
	credits := make([]MusicBrainzArtistCreditPart, 0)
	for _, entry := range asArray(payload["artist-credit"]) {
		if _, ok := entry.(string); ok {
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

		joinPhrase := objectRawString(entryMap, "joinphrase")
		artistID := objectString(asObject(entryMap["artist"]), "id")
		credits = append(credits, MusicBrainzArtistCreditPart{
			Name:       name,
			ArtistID:   artistID,
			JoinPhrase: joinPhrase,
		})
	}

	if len(credits) > 0 {
		return credits
	}

	return []MusicBrainzArtistCreditPart{}
}

func firstMusicBrainzReleaseTitle(payload map[string]any) string {
	for _, releaseValue := range asArray(payload["releases"]) {
		releaseTitle := objectString(asObject(releaseValue), "title")
		if releaseTitle != "" {
			return releaseTitle
		}
	}

	return ""
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

func sanitizeMusicBrainzID(value string) string {
	cleanValue := strings.ToLower(strings.TrimSpace(value))
	if !mbidPattern.MatchString(cleanValue) {
		return ""
	}

	return cleanValue
}

func sanitizeMusicBrainzIDs(values []string) []string {
	cleanValues := make([]string, 0, len(values))
	seen := make(map[string]struct{})
	for _, value := range values {
		cleanValue := sanitizeMusicBrainzID(value)
		if cleanValue == "" {
			continue
		}

		if _, exists := seen[cleanValue]; exists {
			continue
		}

		seen[cleanValue] = struct{}{}
		cleanValues = append(cleanValues, cleanValue)
	}

	return cleanValues
}

func musicBrainzExplorationNodeID(entityType string, mbid string, fallback string) string {
	cleanEntityType := strings.TrimSpace(strings.ToLower(entityType))
	cleanMBID := sanitizeMusicBrainzID(mbid)
	if cleanEntityType != "" && cleanMBID != "" {
		return fmt.Sprintf("%s:%s", cleanEntityType, cleanMBID)
	}

	return strings.TrimSpace(fallback)
}

func musicBrainzExplorationURL(entityType string, mbid string) string {
	cleanEntityType := strings.TrimSpace(strings.ToLower(entityType))
	cleanMBID := sanitizeMusicBrainzID(mbid)
	if cleanEntityType == "" || cleanMBID == "" {
		return ""
	}

	return fmt.Sprintf("https://musicbrainz.org/%s/%s", cleanEntityType, cleanMBID)
}

func musicBrainzExplorationAccent(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "recording":
		return "#d29a38"
	case "release":
		return "#5c88c6"
	case "compilation":
		return "#3b9c8f"
	case "label":
		return "#b56f5f"
	case "group":
		return "#6b8f50"
	default:
		return "#6f6f77"
	}
}

func musicBrainzArtistRefs(payload map[string]any) []MusicBrainzArtistCreditPart {
	return musicBrainzArtistCredits(payload)
}

func musicBrainzArtistNameMap(payload map[string]any) map[string]string {
	names := make(map[string]string)
	for _, credit := range musicBrainzArtistRefs(payload) {
		artistID := sanitizeMusicBrainzID(credit.ArtistID)
		if artistID == "" {
			continue
		}

		name := strings.TrimSpace(credit.Name)
		if name == "" {
			continue
		}

		if _, exists := names[artistID]; !exists {
			names[artistID] = name
		}
	}

	return names
}

func isExcludedMusicBrainzLabel(labelName string) bool {
	cleanLabelName := strings.TrimSpace(strings.ToLower(labelName))
	if cleanLabelName == "" {
		return false
	}

	return cleanLabelName == strings.ToLower(musicBrainzNoLabelName) || cleanLabelName == "no label"
}

func musicBrainzReleaseLabelInfo(payload map[string]any) (string, string) {
	for _, labelInfoValue := range asArray(payload["label-info"]) {
		labelInfo := asObject(labelInfoValue)
		labelObject := asObject(labelInfo["label"])
		labelID := sanitizeMusicBrainzID(objectString(labelObject, "id"))
		labelName := objectString(labelObject, "name")
		if isExcludedMusicBrainzLabel(labelName) {
			continue
		}
		if labelID != "" || labelName != "" {
			return labelID, labelName
		}
	}

	for _, labelValue := range asArray(payload["labels"]) {
		labelObject := asObject(labelValue)
		labelID := sanitizeMusicBrainzID(objectString(labelObject, "id"))
		labelName := objectString(labelObject, "name")
		if isExcludedMusicBrainzLabel(labelName) {
			continue
		}
		if labelID != "" || labelName != "" {
			return labelID, labelName
		}
	}

	return "", ""
}

func musicBrainzReleaseDateLabel(payload map[string]any) string {
	date := objectString(payload, "date")
	if date != "" {
		return date
	}

	return objectString(payload, "first-release-date")
}

func musicBrainzReleaseGroupSummary(payload map[string]any) string {
	releaseGroup := asObject(payload["release-group"])
	primaryType := objectString(releaseGroup, "primary-type")
	secondaryTypes := make([]string, 0)
	for _, secondaryTypeValue := range asArray(releaseGroup["secondary-types"]) {
		secondaryType := asString(secondaryTypeValue)
		if secondaryType == "" {
			continue
		}
		secondaryTypes = append(secondaryTypes, secondaryType)
	}

	if primaryType == "" && len(secondaryTypes) == 0 {
		return ""
	}

	parts := make([]string, 0, 1+len(secondaryTypes))
	if primaryType != "" {
		parts = append(parts, primaryType)
	}
	parts = append(parts, secondaryTypes...)

	return strings.Join(parts, " / ")
}

func isMusicBrainzCompilationRelease(payload map[string]any) bool {
	releaseGroup := asObject(payload["release-group"])
	if strings.EqualFold(objectString(releaseGroup, "primary-type"), "Compilation") {
		return true
	}

	for _, secondaryTypeValue := range asArray(releaseGroup["secondary-types"]) {
		if strings.EqualFold(asString(secondaryTypeValue), "Compilation") {
			return true
		}
	}

	return false
}

func isVariousArtistsRelease(payload map[string]any) bool {
	for _, scope := range []map[string]any{payload, asObject(payload["release-group"])} {
		if len(scope) == 0 {
			continue
		}

		for _, credit := range musicBrainzArtistRefs(scope) {
			if sanitizeMusicBrainzID(credit.ArtistID) == musicBrainzVariousArtistsID {
				return true
			}
			if strings.EqualFold(strings.TrimSpace(credit.Name), "Various Artists") {
				return true
			}
		}

		if strings.EqualFold(strings.TrimSpace(musicBrainzArtistCredit(scope)), "Various Artists") {
			return true
		}
	}

	return strings.EqualFold(strings.TrimSpace(objectString(payload, "artist-credit-phrase")), "Various Artists")
}

func isVariousArtistsCompilationRelease(payload map[string]any) bool {
	return isVariousArtistsRelease(payload) && isMusicBrainzCompilationRelease(payload)
}

func musicBrainzCompilationArtistRefs(payload map[string]any) []MusicBrainzArtistCreditPart {
	refs := make([]MusicBrainzArtistCreditPart, 0)
	seen := make(map[string]struct{})

	appendRefs := func(scope map[string]any) {
		for _, credit := range musicBrainzArtistRefs(scope) {
			artistID := sanitizeMusicBrainzID(credit.ArtistID)
			artistName := strings.TrimSpace(credit.Name)
			if artistID == musicBrainzVariousArtistsID || strings.EqualFold(artistName, "Various Artists") {
				continue
			}

			key := artistID
			if key == "" {
				key = strings.ToLower(artistName)
			}
			if key == "" {
				continue
			}

			if _, exists := seen[key]; exists {
				continue
			}

			seen[key] = struct{}{}
			refs = append(refs, MusicBrainzArtistCreditPart{
				Name:     artistName,
				ArtistID: artistID,
			})
		}
	}

	for _, mediaValue := range asArray(payload["media"]) {
		mediaObject := asObject(mediaValue)
		for _, trackValue := range asArray(mediaObject["tracks"]) {
			trackObject := asObject(trackValue)
			appendRefs(trackObject)
			appendRefs(asObject(trackObject["recording"]))
		}
	}

	return refs
}

func isMusicBrainzBandRelation(relationType string) bool {
	cleanRelationType := strings.ToLower(strings.TrimSpace(relationType))
	if cleanRelationType == "" {
		return false
	}

	return strings.Contains(cleanRelationType, "member") || cleanRelationType == "founder" || cleanRelationType == "subgroup"
}

func addMusicBrainzArtistNode(builder *musicBrainzExplorationBuilder, mbid string, label string, subtitle string, kind string, emphasis int) string {
	cleanMBID := sanitizeMusicBrainzID(mbid)
	cleanKind := strings.TrimSpace(strings.ToLower(kind))
	if cleanKind == "" {
		cleanKind = "artist"
	}

	if subtitle == "" {
		subtitle = "Artist"
	}

	return builder.addNode(MusicBrainzExplorationNode{
		ID:         musicBrainzExplorationNodeID("artist", cleanMBID, fmt.Sprintf("artist:%s", strings.ToLower(strings.TrimSpace(label)))),
		EntityType: "artist",
		Kind:       cleanKind,
		MBID:       cleanMBID,
		Label:      label,
		Subtitle:   subtitle,
		Accent:     musicBrainzExplorationAccent(cleanKind),
		Emphasis:   emphasis,
		URL:        musicBrainzExplorationURL("artist", cleanMBID),
	})
}

func addMusicBrainzReleaseNode(builder *musicBrainzExplorationBuilder, payload map[string]any, emphasis int) string {
	releaseID := sanitizeMusicBrainzID(objectString(payload, "id"))
	kind := "release"
	subtitle := "Release"
	if isMusicBrainzCompilationRelease(payload) {
		kind = "compilation"
		subtitle = "Compilation"
	}

	date := musicBrainzReleaseDateLabel(payload)
	groupSummary := musicBrainzReleaseGroupSummary(payload)
	if date != "" && groupSummary != "" {
		subtitle = fmt.Sprintf("%s • %s", subtitle, date)
	} else if date != "" {
		subtitle = fmt.Sprintf("%s • %s", subtitle, date)
	} else if groupSummary != "" {
		subtitle = fmt.Sprintf("%s • %s", subtitle, groupSummary)
	}

	return builder.addNode(MusicBrainzExplorationNode{
		ID:         musicBrainzExplorationNodeID("release", releaseID, fmt.Sprintf("release:%s", strings.ToLower(objectString(payload, "title")))),
		EntityType: "release",
		Kind:       kind,
		MBID:       releaseID,
		Label:      objectString(payload, "title"),
		Subtitle:   subtitle,
		Accent:     musicBrainzExplorationAccent(kind),
		Emphasis:   emphasis,
		URL:        musicBrainzExplorationURL("release", releaseID),
	})
}

func addMusicBrainzRecordingNode(builder *musicBrainzExplorationBuilder, recordingID string, label string, emphasis int) string {
	cleanRecordingID := sanitizeMusicBrainzID(recordingID)
	return builder.addNode(MusicBrainzExplorationNode{
		ID:         musicBrainzExplorationNodeID("recording", cleanRecordingID, fmt.Sprintf("recording:%s", strings.ToLower(strings.TrimSpace(label)))),
		EntityType: "recording",
		Kind:       "recording",
		MBID:       cleanRecordingID,
		Label:      strings.TrimSpace(label),
		Subtitle:   "Recording",
		Accent:     musicBrainzExplorationAccent("recording"),
		Emphasis:   emphasis,
		URL:        musicBrainzExplorationURL("recording", cleanRecordingID),
	})
}

func addMusicBrainzLabelNode(builder *musicBrainzExplorationBuilder, labelID string, label string, emphasis int) string {
	cleanLabelID := sanitizeMusicBrainzID(labelID)
	return builder.addNode(MusicBrainzExplorationNode{
		ID:         musicBrainzExplorationNodeID("label", cleanLabelID, fmt.Sprintf("label:%s", strings.ToLower(strings.TrimSpace(label)))),
		EntityType: "label",
		Kind:       "label",
		MBID:       cleanLabelID,
		Label:      strings.TrimSpace(label),
		Subtitle:   "Label",
		Accent:     musicBrainzExplorationAccent("label"),
		Emphasis:   emphasis,
		URL:        musicBrainzExplorationURL("label", cleanLabelID),
	})
}

func musicBrainzBrowseURL(apiBaseURL string, resource string, values url.Values, incClause string) string {
	query := values.Encode()
	if incClause != "" {
		if query != "" {
			query += "&"
		}
		query += "inc=" + url.QueryEscape(incClause)
	}

	if query != "" {
		query = "?fmt=json&" + query
	} else {
		query = "?fmt=json"
	}

	return fmt.Sprintf("%s/%s%s", apiBaseURL, resource, query)
}
