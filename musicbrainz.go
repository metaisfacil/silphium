package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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

// MusicBrainzTrackMetadata contains normalized display metadata for a track lookup.
type MusicBrainzTrackMetadata struct {
	Found         bool                          `json:"found"`
	RecordingID   string                        `json:"recordingId"`
	ReleaseID     string                        `json:"releaseId"`
	LabelID       string                        `json:"labelId"`
	Title         string                        `json:"title"`
	Album         string                        `json:"album"`
	Artist        string                        `json:"artist"`
	ArtistCredits []MusicBrainzArtistCreditPart `json:"artistCredits"`
}

// MusicBrainzArtistCreditPart represents one artist plus its trailing join phrase.
type MusicBrainzArtistCreditPart struct {
	Name       string `json:"name"`
	ArtistID   string `json:"artistId"`
	JoinPhrase string `json:"joinPhrase"`
}

// MusicBrainzExplorationNode is one node in the exploration graph.
type MusicBrainzExplorationNode struct {
	ID         string `json:"id"`
	EntityType string `json:"entityType"`
	Kind       string `json:"kind"`
	MBID       string `json:"mbid"`
	Label      string `json:"label"`
	Subtitle   string `json:"subtitle"`
	Accent     string `json:"accent"`
	Emphasis   int    `json:"emphasis"`
	URL        string `json:"url"`
}

// MusicBrainzExplorationEdge is one relationship in the exploration graph.
type MusicBrainzExplorationEdge struct {
	ID       string `json:"id"`
	SourceID string `json:"sourceId"`
	TargetID string `json:"targetId"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
}

// MusicBrainzExplorationProgress reports in-flight exploration lookup progress.
type MusicBrainzExplorationProgress struct {
	RequestID string `json:"requestId"`
	Message   string `json:"message"`
	Current   int    `json:"current"`
	Total     int    `json:"total"`
	Done      bool   `json:"done"`
}

// MusicBrainzExplorationGraph contains a graph of related MusicBrainz entities.
type MusicBrainzExplorationGraph struct {
	Found    bool                         `json:"found"`
	Title    string                       `json:"title"`
	Summary  string                       `json:"summary"`
	Nodes    []MusicBrainzExplorationNode `json:"nodes"`
	Edges    []MusicBrainzExplorationEdge `json:"edges"`
	Warnings []string                     `json:"warnings"`
}

type musicBrainzExplorationBuilder struct {
	nodes    map[string]MusicBrainzExplorationNode
	edges    map[string]MusicBrainzExplorationEdge
	warnings []string
}

type musicBrainzExplorationProgressTracker struct {
	app       *App
	requestID string
	current   int
	total     int
	message   string
}

const musicBrainzUserAgent = "Silphium/1.0 (metaisfacil@users.noreply.github.com)"
const musicBrainzPublicServerURL = "https://musicbrainz.org"
const musicBrainzVariousArtistsID = "89ad4ac3-39f7-470e-963a-56509c546377"
const musicBrainzNoLabelName = "[no label]"
const musicBrainzExplorationProgressEvent = "silphium:musicbrainz:exploration-progress"
const musicBrainzExplorationArtistRelationDepth = 2
const musicBrainzExplorationPrimaryArtistLimit = 4
const musicBrainzExplorationCompilationArtistLimit = 12
const musicBrainzExplorationAlternateReleaseLimit = 4
const musicBrainzExplorationAlternateReleaseCheckLimit = 12
const musicBrainzExplorationLabelBrowseLimit = "18"
const musicBrainzExplorationLabelArtistLimit = 10
const musicBrainzExplorationLabelCompilationLimit = 6
const musicBrainzExplorationBandRelationLimit = 6

func newMusicBrainzExplorationBuilder() *musicBrainzExplorationBuilder {
	return &musicBrainzExplorationBuilder{
		nodes:    make(map[string]MusicBrainzExplorationNode),
		edges:    make(map[string]MusicBrainzExplorationEdge),
		warnings: make([]string, 0),
	}
}

func newMusicBrainzExplorationProgressTracker(app *App, requestID string) *musicBrainzExplorationProgressTracker {
	cleanRequestID := strings.TrimSpace(requestID)
	if app == nil || app.ctx == nil || cleanRequestID == "" {
		return nil
	}

	return &musicBrainzExplorationProgressTracker{
		app:       app,
		requestID: cleanRequestID,
	}
}

func (t *musicBrainzExplorationProgressTracker) emit(message string, done bool) {
	if t == nil || t.app == nil || t.app.ctx == nil || t.requestID == "" {
		return
	}

	cleanMessage := strings.TrimSpace(message)
	if cleanMessage != "" {
		t.message = cleanMessage
	}

	runtime.EventsEmit(t.app.ctx, musicBrainzExplorationProgressEvent, MusicBrainzExplorationProgress{
		RequestID: t.requestID,
		Message:   t.message,
		Current:   t.current,
		Total:     t.total,
		Done:      done,
	})
}

func (t *musicBrainzExplorationProgressTracker) queueStep() {
	if t == nil {
		return
	}

	t.total++
	if t.total < t.current {
		t.total = t.current
	}
	t.emit(t.message, false)
}

func (t *musicBrainzExplorationProgressTracker) announce(message string) {
	if t == nil {
		return
	}

	t.emit(message, false)
}

func (t *musicBrainzExplorationProgressTracker) step(message string) {
	if t == nil {
		return
	}

	t.current++
	if t.total < t.current {
		t.total = t.current
	}
	t.emit(message, false)
}

func (t *musicBrainzExplorationProgressTracker) finish(message string) {
	if t == nil {
		return
	}

	if t.total < t.current {
		t.total = t.current
	}
	t.current = t.total
	t.emit(message, true)
}

func (b *musicBrainzExplorationBuilder) addWarning(message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	for _, existing := range b.warnings {
		if existing == message {
			return
		}
	}

	b.warnings = append(b.warnings, message)
}

func (b *musicBrainzExplorationBuilder) addNode(node MusicBrainzExplorationNode) string {
	node.ID = strings.TrimSpace(node.ID)
	if node.ID == "" {
		return ""
	}

	node.EntityType = strings.TrimSpace(strings.ToLower(node.EntityType))
	node.Kind = strings.TrimSpace(strings.ToLower(node.Kind))
	node.MBID = strings.TrimSpace(strings.ToLower(node.MBID))
	node.Label = strings.TrimSpace(node.Label)
	node.Subtitle = strings.TrimSpace(node.Subtitle)
	node.Accent = strings.TrimSpace(node.Accent)
	node.URL = strings.TrimSpace(node.URL)
	if node.Emphasis <= 0 {
		node.Emphasis = 1
	}

	existing, exists := b.nodes[node.ID]
	if !exists {
		b.nodes[node.ID] = node
		return node.ID
	}

	if existing.Label == "" && node.Label != "" {
		existing.Label = node.Label
	}
	if existing.Subtitle == "" && node.Subtitle != "" {
		existing.Subtitle = node.Subtitle
	}
	if existing.Accent == "" && node.Accent != "" {
		existing.Accent = node.Accent
	}
	if existing.Kind == "" && node.Kind != "" {
		existing.Kind = node.Kind
	}
	if existing.EntityType == "" && node.EntityType != "" {
		existing.EntityType = node.EntityType
	}
	if existing.MBID == "" && node.MBID != "" {
		existing.MBID = node.MBID
	}
	if existing.URL == "" && node.URL != "" {
		existing.URL = node.URL
	}
	if node.Emphasis > existing.Emphasis {
		existing.Emphasis = node.Emphasis
	}

	b.nodes[node.ID] = existing
	return node.ID
}

func (b *musicBrainzExplorationBuilder) addEdge(sourceID string, targetID string, label string, kind string) string {
	cleanSourceID := strings.TrimSpace(sourceID)
	cleanTargetID := strings.TrimSpace(targetID)
	cleanLabel := strings.TrimSpace(label)
	cleanKind := strings.TrimSpace(strings.ToLower(kind))
	if cleanSourceID == "" || cleanTargetID == "" || cleanSourceID == cleanTargetID {
		return ""
	}

	edgeID := fmt.Sprintf("%s|%s|%s|%s", cleanSourceID, cleanTargetID, strings.ToLower(cleanLabel), cleanKind)
	b.edges[edgeID] = MusicBrainzExplorationEdge{
		ID:       edgeID,
		SourceID: cleanSourceID,
		TargetID: cleanTargetID,
		Label:    cleanLabel,
		Kind:     cleanKind,
	}

	return edgeID
}

func (b *musicBrainzExplorationBuilder) sortedNodes() []MusicBrainzExplorationNode {
	nodes := make([]MusicBrainzExplorationNode, 0, len(b.nodes))
	for _, node := range b.nodes {
		nodes = append(nodes, node)
	}

	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].Emphasis == nodes[j].Emphasis {
			if nodes[i].Kind == nodes[j].Kind {
				return nodes[i].Label < nodes[j].Label
			}
			return nodes[i].Kind < nodes[j].Kind
		}
		return nodes[i].Emphasis > nodes[j].Emphasis
	})

	return nodes
}

func (b *musicBrainzExplorationBuilder) sortedEdges() []MusicBrainzExplorationEdge {
	edges := make([]MusicBrainzExplorationEdge, 0, len(b.edges))
	for _, edge := range b.edges {
		edges = append(edges, edge)
	}

	sort.SliceStable(edges, func(i, j int) bool {
		if edges[i].SourceID == edges[j].SourceID {
			if edges[i].TargetID == edges[j].TargetID {
				return edges[i].Label < edges[j].Label
			}
			return edges[i].TargetID < edges[j].TargetID
		}
		return edges[i].SourceID < edges[j].SourceID
	})

	return edges
}

func fetchMusicBrainzJSON(requestURL string, rateLimitMs int) ([]byte, bool) {
	return fetchMusicBrainzJSONWithPriority(requestURL, musicBrainzRequestPriorityInteractive, rateLimitMs)
}

func fetchMusicBrainzPayload(requestURL string, rateLimitMs int) (map[string]any, bool) {
	return fetchMusicBrainzPayloadWithPriority(requestURL, musicBrainzRequestPriorityInteractive, rateLimitMs)
}

func (a *App) musicBrainzServerURL() string {
	a.ensureSettingsLoaded()
	u := strings.TrimRight(strings.TrimSpace(a.settings.MusicBrainzServerURL), "/")
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
	return a.settings.MusicBrainzRequestRateMs
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

// LookupMusicBrainzExploration builds a compact graph of related MusicBrainz entities.
func (a *App) LookupMusicBrainzExploration(recordingID string, releaseID string, artistIDs []string, labelID string, requestID string) MusicBrainzExplorationGraph {
	cleanRecordingID := sanitizeMusicBrainzID(recordingID)
	cleanReleaseID := sanitizeMusicBrainzID(releaseID)
	cleanArtistIDs := sanitizeMusicBrainzIDs(artistIDs)
	cleanLabelID := sanitizeMusicBrainzID(labelID)
	progress := newMusicBrainzExplorationProgressTracker(a, requestID)

	result := MusicBrainzExplorationGraph{
		Found:    false,
		Title:    "MusicBrainz exploration",
		Summary:  "No MusicBrainz exploration data found.",
		Nodes:    []MusicBrainzExplorationNode{},
		Edges:    []MusicBrainzExplorationEdge{},
		Warnings: []string{},
	}

	if cleanRecordingID == "" && cleanReleaseID == "" && len(cleanArtistIDs) == 0 && cleanLabelID == "" {
		progress.finish("Nothing to explore.")
		return result
	}

	progress.announce("Preparing MusicBrainz exploration...")
	fetchPayload := func(requestURL string, message string) (map[string]any, bool) {
		progress.queueStep()
		progress.announce(message)
		payload, ok := fetchMusicBrainzPayload(requestURL, a.musicBrainzRequestRateMs())
		if ok {
			progress.step(message)
		} else {
			progress.step(message + " unavailable")
		}
		return payload, ok
	}

	builder := newMusicBrainzExplorationBuilder()
	recordingPayload := map[string]any{}
	releasePayload := map[string]any{}
	recordingReleaseIDs := make(map[string]struct{})
	seedArtistNames := make(map[string]string)
	seedArtistSet := make(map[string]struct{})
	seedArtistNodeIDs := make(map[string]string)
	relatedBandEdgeCount := 0
	type artistRelationSource struct {
		artistID string
		nodeID   string
		depth    int
	}
	artistRelationQueue := make([]artistRelationSource, 0, len(cleanArtistIDs))
	artistRelationQueuedDepth := make(map[string]int)
	queueArtistRelationSource := func(artistID string, nodeID string, depth int) {
		cleanArtistID := sanitizeMusicBrainzID(artistID)
		if cleanArtistID == "" || strings.TrimSpace(nodeID) == "" || depth >= musicBrainzExplorationArtistRelationDepth {
			return
		}

		if existingDepth, exists := artistRelationQueuedDepth[cleanArtistID]; exists && existingDepth <= depth {
			return
		}

		artistRelationQueuedDepth[cleanArtistID] = depth
		artistRelationQueue = append(artistRelationQueue, artistRelationSource{
			artistID: cleanArtistID,
			nodeID:   strings.TrimSpace(nodeID),
			depth:    depth,
		})
	}

	appendSeedArtistID := func(artistID string) {
		cleanArtistID := sanitizeMusicBrainzID(artistID)
		if cleanArtistID == "" {
			return
		}

		if _, exists := seedArtistSet[cleanArtistID]; exists {
			return
		}

		seedArtistSet[cleanArtistID] = struct{}{}
		cleanArtistIDs = append(cleanArtistIDs, cleanArtistID)
	}

	for _, artistID := range cleanArtistIDs {
		seedArtistSet[artistID] = struct{}{}
	}

	if cleanRecordingID != "" {
		requestURL := fmt.Sprintf("%s/recording/%s?fmt=json&inc=artists+releases", a.musicBrainzAPIBaseURL(), cleanRecordingID)
		if payload, ok := fetchPayload(requestURL, "Loading recording details..."); ok {
			recordingPayload = payload
		} else {
			builder.addWarning("Recording details could not be loaded from MusicBrainz.")
		}
	}

	if cleanReleaseID != "" {
		requestURL := fmt.Sprintf("%s/release/%s?fmt=json&inc=artists+labels+release-groups", a.musicBrainzAPIBaseURL(), cleanReleaseID)
		if payload, ok := fetchPayload(requestURL, "Loading current release details..."); ok {
			releasePayload = payload
		} else {
			builder.addWarning("Release details could not be loaded from MusicBrainz.")
		}
	}

	for artistID, artistName := range musicBrainzArtistNameMap(recordingPayload) {
		seedArtistNames[artistID] = artistName
		appendSeedArtistID(artistID)
	}
	for artistID, artistName := range musicBrainzArtistNameMap(releasePayload) {
		if _, exists := seedArtistNames[artistID]; !exists {
			seedArtistNames[artistID] = artistName
		}
		appendSeedArtistID(artistID)
	}

	if len(cleanArtistIDs) > musicBrainzExplorationPrimaryArtistLimit {
		builder.addWarning("Limited primary artist relationships to 4 tagged artists.")
		cleanArtistIDs = cleanArtistIDs[:musicBrainzExplorationPrimaryArtistLimit]
		seedArtistSet = make(map[string]struct{})
		for _, artistID := range cleanArtistIDs {
			seedArtistSet[artistID] = struct{}{}
		}
	}

	recordingTitle := objectString(recordingPayload, "title")
	releaseTitle := objectString(releasePayload, "title")
	if recordingTitle != "" {
		result.Title = recordingTitle
	} else if releaseTitle != "" {
		result.Title = releaseTitle
	} else if len(cleanArtistIDs) > 0 {
		result.Title = seedArtistNames[cleanArtistIDs[0]]
	}

	recordingNodeID := ""
	if cleanRecordingID != "" || recordingTitle != "" {
		recordingNodeID = addMusicBrainzRecordingNode(builder, cleanRecordingID, recordingTitle, 5)
	}

	releaseNodeID := ""
	if len(releasePayload) > 0 {
		releaseNodeID = addMusicBrainzReleaseNode(builder, releasePayload, 4)
	} else if cleanReleaseID != "" {
		releaseNodeID = builder.addNode(MusicBrainzExplorationNode{
			ID:         musicBrainzExplorationNodeID("release", cleanReleaseID, "release:current"),
			EntityType: "release",
			Kind:       "release",
			MBID:       cleanReleaseID,
			Label:      "Current release",
			Subtitle:   "Release",
			Accent:     musicBrainzExplorationAccent("release"),
			Emphasis:   4,
			URL:        musicBrainzExplorationURL("release", cleanReleaseID),
		})
	}

	if recordingNodeID != "" && releaseNodeID != "" {
		builder.addEdge(recordingNodeID, releaseNodeID, "current release", "recording-release")
	}

	resolvedLabelID, resolvedLabelName := musicBrainzReleaseLabelInfo(releasePayload)
	if cleanLabelID == "" {
		cleanLabelID = resolvedLabelID
	}
	if cleanLabelID != "" && resolvedLabelName == "" {
		labelRequestURL := fmt.Sprintf("%s/label/%s?fmt=json", a.musicBrainzAPIBaseURL(), cleanLabelID)
		if labelPayload, ok := fetchPayload(labelRequestURL, "Loading label details..."); ok {
			resolvedLabelName = objectString(labelPayload, "name")
		}
	}
	if isExcludedMusicBrainzLabel(resolvedLabelName) {
		cleanLabelID = ""
		resolvedLabelName = ""
	}

	labelNodeID := ""
	if cleanLabelID != "" || resolvedLabelName != "" {
		labelNodeID = addMusicBrainzLabelNode(builder, cleanLabelID, resolvedLabelName, 3)
		if releaseNodeID != "" {
			builder.addEdge(releaseNodeID, labelNodeID, "released on", "label-release")
		}
	}

	for _, artistID := range cleanArtistIDs {
		artistName := strings.TrimSpace(seedArtistNames[artistID])
		if artistName == "" {
			artistName = "Tagged artist"
		}

		artistNodeID := addMusicBrainzArtistNode(builder, artistID, artistName, "Artist", "artist", 3)
		seedArtistNodeIDs[artistID] = artistNodeID
		if recordingNodeID != "" {
			builder.addEdge(artistNodeID, recordingNodeID, "performed by", "artist-recording")
		}
		if releaseNodeID != "" {
			builder.addEdge(artistNodeID, releaseNodeID, "credited on", "artist-release")
		}
		queueArtistRelationSource(artistID, artistNodeID, 0)
	}

	compilationArtistCount := 0
	compilationArtistLimitHit := false
	ensureReleaseTrackArtists := func(releasePayload map[string]any, releaseID string, message string) map[string]any {
		if len(asArray(releasePayload["media"])) > 0 {
			return releasePayload
		}

		cleanReleaseID := sanitizeMusicBrainzID(releaseID)
		if cleanReleaseID == "" {
			return releasePayload
		}

		requestURL := fmt.Sprintf("%s/release/%s?fmt=json&inc=recordings+artist-credits+labels+release-groups", a.musicBrainzAPIBaseURL(), cleanReleaseID)
		if payload, ok := fetchPayload(requestURL, message); ok {
			return payload
		}

		return releasePayload
	}
	addCompilationArtistsForRelease := func(releasePayload map[string]any, releaseNodeID string) {
		for _, credit := range musicBrainzCompilationArtistRefs(releasePayload) {
			artistID := sanitizeMusicBrainzID(credit.ArtistID)
			artistName := strings.TrimSpace(credit.Name)
			_, isSeedArtist := seedArtistSet[artistID]
			if !isSeedArtist && compilationArtistCount >= musicBrainzExplorationCompilationArtistLimit {
				if !compilationArtistLimitHit {
					builder.addWarning("Limited compilation artist links to 12 artists.")
					compilationArtistLimitHit = true
				}
				break
			}
			if !isSeedArtist {
				compilationArtistCount++
			}

			artistNodeID := addMusicBrainzArtistNode(builder, artistID, artistName, "Artist", "artist", 2)
			builder.addEdge(artistNodeID, releaseNodeID, "appears on", "artist-release")
		}
	}
	relatedRecordingReleaseCount := 0
	relatedRecordingReleaseLookups := 0
	for _, releaseValue := range asArray(recordingPayload["releases"]) {
		relatedReleaseSummary := asObject(releaseValue)
		relatedReleaseID := sanitizeMusicBrainzID(objectString(relatedReleaseSummary, "id"))
		if relatedReleaseID == "" {
			continue
		}

		recordingReleaseIDs[relatedReleaseID] = struct{}{}
		if relatedReleaseID == cleanReleaseID || recordingNodeID == "" {
			continue
		}

		if relatedRecordingReleaseCount >= musicBrainzExplorationAlternateReleaseLimit {
			builder.addWarning("Limited alternate release appearances to 4 releases.")
			break
		}
		if relatedRecordingReleaseLookups >= musicBrainzExplorationAlternateReleaseCheckLimit {
			builder.addWarning("Limited alternate release checks to 12 candidate releases.")
			break
		}

		relatedRecordingReleaseLookups++
		relatedRelease := relatedReleaseSummary
		if !isVariousArtistsCompilationRelease(relatedRelease) || len(asArray(relatedRelease["artist-credit"])) == 0 || len(asObject(relatedRelease["release-group"])) == 0 {
			requestURL := fmt.Sprintf("%s/release/%s?fmt=json&inc=artists+labels+release-groups", a.musicBrainzAPIBaseURL(), relatedReleaseID)
			payload, ok := fetchPayload(requestURL, "Checking alternate Various Artists compilations...")
			if !ok {
				continue
			}
			relatedRelease = payload
		}

		if !isVariousArtistsCompilationRelease(relatedRelease) {
			continue
		}

		relatedRelease = ensureReleaseTrackArtists(relatedRelease, relatedReleaseID, "Loading compilation artists...")

		relatedReleaseNodeID := addMusicBrainzReleaseNode(builder, relatedRelease, 2)
		builder.addEdge(recordingNodeID, relatedReleaseNodeID, "appears on", "recording-appearance")
		addCompilationArtistsForRelease(relatedRelease, relatedReleaseNodeID)
		relatedRecordingReleaseCount++
	}

	labelArtistCount := 0
	labelArtistSeen := make(map[string]struct{})
	labelArtistLimitHit := false
	if cleanLabelID != "" {
		browseValues := url.Values{}
		browseValues.Set("label", cleanLabelID)
		browseValues.Set("limit", musicBrainzExplorationLabelBrowseLimit)
		browseURL := musicBrainzBrowseURL(a.musicBrainzAPIBaseURL(), "release", browseValues, "artist-credits+release-groups+labels")
		if browsePayload, ok := fetchPayload(browseURL, "Browsing label releases..."); ok {
			addedLabelReleaseCount := 0
			for _, releaseValue := range asArray(browsePayload["releases"]) {
				labelRelease := asObject(releaseValue)
				labelReleaseID := sanitizeMusicBrainzID(objectString(labelRelease, "id"))
				if labelReleaseID == "" || labelReleaseID == cleanReleaseID {
					continue
				}

				for _, credit := range musicBrainzArtistRefs(labelRelease) {
					artistID := sanitizeMusicBrainzID(credit.ArtistID)
					if artistID == "" || artistID == musicBrainzVariousArtistsID {
						continue
					}

					if _, isSeedArtist := seedArtistSet[artistID]; isSeedArtist {
						continue
					}

					if _, exists := labelArtistSeen[artistID]; exists {
						continue
					}

					if labelArtistCount >= musicBrainzExplorationLabelArtistLimit {
						if !labelArtistLimitHit {
							builder.addWarning("Limited same-label artist links to 10 artists.")
							labelArtistLimitHit = true
						}
						break
					}

					artistNodeID := addMusicBrainzArtistNode(builder, artistID, credit.Name, "Artist", "artist", 1)
					if labelNodeID != "" {
						builder.addEdge(artistNodeID, labelNodeID, "released on", "artist-label")
					}
					labelArtistSeen[artistID] = struct{}{}
					labelArtistCount++
				}

				if !isVariousArtistsCompilationRelease(labelRelease) {
					continue
				}

				if addedLabelReleaseCount >= musicBrainzExplorationLabelCompilationLimit {
					builder.addWarning("Limited label connections to 6 Various Artists compilations.")
					break
				}

				labelRelease = ensureReleaseTrackArtists(labelRelease, labelReleaseID, "Loading label compilation artists...")

				labelReleaseNodeID := addMusicBrainzReleaseNode(builder, labelRelease, 2)
				if labelNodeID != "" {
					builder.addEdge(labelReleaseNodeID, labelNodeID, "released on", "label-release")
				}
				if recordingNodeID != "" {
					if _, exists := recordingReleaseIDs[labelReleaseID]; exists {
						builder.addEdge(recordingNodeID, labelReleaseNodeID, "appears on", "recording-appearance")
					}
				}

				addCompilationArtistsForRelease(labelRelease, labelReleaseNodeID)

				addedLabelReleaseCount++
			}
		} else {
			builder.addWarning("Label roster details could not be loaded from MusicBrainz.")
		}
	}

	for len(artistRelationQueue) > 0 {
		if relatedBandEdgeCount >= musicBrainzExplorationBandRelationLimit {
			builder.addWarning("Limited artist membership relationships to 6 connections.")
			break
		}

		source := artistRelationQueue[0]
		artistRelationQueue = artistRelationQueue[1:]
		if source.depth >= musicBrainzExplorationArtistRelationDepth {
			continue
		}

		artistRequestURL := fmt.Sprintf("%s/artist/%s?fmt=json&inc=artist-rels", a.musicBrainzAPIBaseURL(), source.artistID)
		artistPayload, ok := fetchPayload(artistRequestURL, "Expanding artist relationships...")
		if !ok {
			continue
		}

		for _, relationValue := range asArray(artistPayload["relations"]) {
			if relatedBandEdgeCount >= musicBrainzExplorationBandRelationLimit {
				builder.addWarning("Limited artist membership relationships to 6 connections.")
				break
			}

			relation := asObject(relationValue)
			if !strings.EqualFold(objectString(relation, "target-type"), "artist") {
				continue
			}

			relationType := objectString(relation, "type")
			if !isMusicBrainzBandRelation(relationType) {
				continue
			}

			targetArtist := asObject(relation["artist"])
			targetArtistID := sanitizeMusicBrainzID(objectString(targetArtist, "id"))
			targetArtistName := objectString(targetArtist, "name")
			if targetArtistID == "" || targetArtistName == "" {
				continue
			}

			targetType := objectString(targetArtist, "type")
			targetKind := "artist"
			targetSubtitle := "Artist"
			if targetType != "" {
				targetSubtitle = targetType
				if !strings.EqualFold(targetType, "Person") {
					targetKind = "group"
				}
			}

			targetNodeID := addMusicBrainzArtistNode(builder, targetArtistID, targetArtistName, targetSubtitle, targetKind, 1)
			builder.addEdge(source.nodeID, targetNodeID, relationType, "artist-relation")
			relatedBandEdgeCount++
			if source.depth+1 < musicBrainzExplorationArtistRelationDepth {
				queueArtistRelationSource(targetArtistID, targetNodeID, source.depth+1)
			}
		}
	}

	summaryParts := make([]string, 0, 3)
	if labelNodeID != "" {
		summaryParts = append(summaryParts, "compilations")
	}
	if labelArtistCount > 0 {
		summaryParts = append(summaryParts, "other artists with releases on the same label")
	}
	if compilationArtistCount > 0 {
		summaryParts = append(summaryParts, "other artists on shared compilations")
	}
	if relatedRecordingReleaseCount > 0 {
		summaryParts = append(summaryParts, "Various Artists appearances of the current recording")
	}
	if relatedBandEdgeCount > 0 {
		summaryParts = append(summaryParts, "artist membership relationships")
	}
	if len(summaryParts) == 0 {
		summaryParts = append(summaryParts, "tagged MusicBrainz entities around this track")
	}

	result.Summary = fmt.Sprintf("Connections shown through %s.", strings.Join(summaryParts, ", "))
	result.Nodes = builder.sortedNodes()
	result.Edges = builder.sortedEdges()
	result.Warnings = builder.warnings
	result.Found = len(result.Nodes) > 0
	if !result.Found {
		result.Summary = "No connected MusicBrainz entities were available for this track."
		progress.finish("No MusicBrainz connections found.")
		return result
	}

	progress.finish("MusicBrainz exploration ready.")
	return result
}
