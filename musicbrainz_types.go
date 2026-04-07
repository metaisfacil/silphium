package main

import (
	"fmt"
	"sort"
	"strings"
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

	runtimeEventsEmit(t.app.ctx, musicBrainzExplorationProgressEvent, MusicBrainzExplorationProgress{
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
