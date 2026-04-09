package main

import (
	"context"
	"testing"
)

func TestMusicBrainzTypesAndProgressTracker(t *testing.T) {
	newAppWithContext := func() *App {
		app := &App{}
		app.ctx = context.Background()
		return app
	}

	originalRuntimeEventsEmit := runtimeEventsEmit
	emitted := make([]MusicBrainzExplorationProgress, 0, 4)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != musicBrainzExplorationProgressEvent {
			t.Fatalf("runtimeEventsEmit event = %q, want %q", eventName, musicBrainzExplorationProgressEvent)
		}
		if len(optionalData) != 1 {
			t.Fatalf("runtimeEventsEmit args len = %d, want 1", len(optionalData))
		}
		payload, ok := optionalData[0].(MusicBrainzExplorationProgress)
		if !ok {
			t.Fatalf("runtimeEventsEmit payload type = %T, want MusicBrainzExplorationProgress", optionalData[0])
		}
		emitted = append(emitted, payload)
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	if tracker := newMusicBrainzExplorationProgressTracker(nil, "req"); tracker != nil {
		t.Fatalf("newMusicBrainzExplorationProgressTracker(nil app) = %#v, want nil", tracker)
	}
	if tracker := newMusicBrainzExplorationProgressTracker(&App{}, "req"); tracker != nil {
		t.Fatalf("newMusicBrainzExplorationProgressTracker(nil ctx) = %#v, want nil", tracker)
	}
	if tracker := newMusicBrainzExplorationProgressTracker(newAppWithContext(), " "); tracker != nil {
		t.Fatalf("newMusicBrainzExplorationProgressTracker(empty request) = %#v, want nil", tracker)
	}

	tracker := newMusicBrainzExplorationProgressTracker(newAppWithContext(), "request-1")
	if tracker == nil {
		t.Fatal("newMusicBrainzExplorationProgressTracker(valid) = nil, want tracker")
	}
	tracker.queueStep()
	tracker.announce("Queued")
	tracker.step("Working")
	tracker.finish("Done")
	if got, want := len(emitted), 4; got != want {
		t.Fatalf("progress emissions = %d, want %d", got, want)
	}
	if !emitted[len(emitted)-1].Done || emitted[len(emitted)-1].Current != emitted[len(emitted)-1].Total {
		t.Fatalf("final progress emission = %#v, want done snapshot", emitted[len(emitted)-1])
	}

	var nilTracker *musicBrainzExplorationProgressTracker
	nilTracker.queueStep()
	nilTracker.announce("ignored")
	nilTracker.step("ignored")
	nilTracker.finish("ignored")

	builder := newMusicBrainzExplorationBuilder()
	builder.addWarning(" warning ")
	builder.addWarning("warning")
	builder.addWarning("")
	if got, want := len(builder.warnings), 1; got != want {
		t.Fatalf("addWarning() len = %d, want %d", got, want)
	}

	if got := builder.addNode(MusicBrainzExplorationNode{}); got != "" {
		t.Fatalf("addNode(empty) = %q, want empty", got)
	}
	artistNodeID := builder.addNode(MusicBrainzExplorationNode{ID: "artist:1", Label: "Artist", Kind: "artist", EntityType: "artist", Emphasis: 1})
	builder.addNode(MusicBrainzExplorationNode{ID: artistNodeID, Subtitle: "Subtitle", Accent: "#fff", URL: "https://example.com", Emphasis: 4})
	releaseNodeID := builder.addNode(MusicBrainzExplorationNode{ID: "release:1", Label: "Release", Kind: "release", EntityType: "release", Emphasis: 2})
	if artistNodeID == "" || releaseNodeID == "" {
		t.Fatalf("addNode() returned empty ids: %q %q", artistNodeID, releaseNodeID)
	}
	mergedArtistNode := builder.nodes[artistNodeID]
	if mergedArtistNode.Subtitle != "Subtitle" || mergedArtistNode.Emphasis != 4 {
		t.Fatalf("addNode(merge) = %#v, want merged subtitle and emphasis", mergedArtistNode)
	}

	if got := builder.addEdge("", releaseNodeID, "ignored", "rel"); got != "" {
		t.Fatalf("addEdge(empty source) = %q, want empty", got)
	}
	if got := builder.addEdge(artistNodeID, artistNodeID, "self", "rel"); got != "" {
		t.Fatalf("addEdge(self) = %q, want empty", got)
	}
	edgeID := builder.addEdge(artistNodeID, releaseNodeID, "created", "membership")
	if edgeID == "" {
		t.Fatal("addEdge(valid) = empty, want edge id")
	}

	sortedNodes := builder.sortedNodes()
	if got, want := len(sortedNodes), 2; got != want {
		t.Fatalf("sortedNodes() len = %d, want %d", got, want)
	}
	if sortedNodes[0].ID != artistNodeID {
		t.Fatalf("sortedNodes()[0] = %#v, want highest-emphasis artist node", sortedNodes[0])
	}

	sortedEdges := builder.sortedEdges()
	if got, want := len(sortedEdges), 1; got != want {
		t.Fatalf("sortedEdges() len = %d, want %d", got, want)
	}
	if sortedEdges[0].ID != edgeID {
		t.Fatalf("sortedEdges()[0] = %#v, want stored edge", sortedEdges[0])
	}
}

func TestMusicBrainzTypesAdditionalEdgeBranches(t *testing.T) {
	newAppWithContext := func() *App {
		app := &App{}
		app.ctx = context.Background()
		return app
	}

	originalRuntimeEventsEmit := runtimeEventsEmit
	emitted := make([]MusicBrainzExplorationProgress, 0, 4)
	runtimeEventsEmit = func(_ context.Context, eventName string, optionalData ...interface{}) {
		if eventName != musicBrainzExplorationProgressEvent || len(optionalData) != 1 {
			return
		}
		if payload, ok := optionalData[0].(MusicBrainzExplorationProgress); ok {
			emitted = append(emitted, payload)
		}
	}
	t.Cleanup(func() {
		runtimeEventsEmit = originalRuntimeEventsEmit
	})

	invalidTracker := &musicBrainzExplorationProgressTracker{}
	invalidTracker.emit("ignored", false)

	tracker := &musicBrainzExplorationProgressTracker{
		app:       newAppWithContext(),
		requestID: "request-2",
		current:   3,
		total:     1,
	}
	tracker.queueStep()
	if tracker.total != 3 {
		t.Fatalf("queueStep(current>total) total = %d, want 3", tracker.total)
	}
	tracker.step("Working")
	if tracker.current != 4 || tracker.total != 4 {
		t.Fatalf("step(current>total) = current:%d total:%d, want 4/4", tracker.current, tracker.total)
	}

	finishingTracker := &musicBrainzExplorationProgressTracker{
		app:       newAppWithContext(),
		requestID: "request-3",
		current:   5,
		total:     1,
	}
	finishingTracker.finish("Done")
	if finishingTracker.current != 5 || finishingTracker.total != 5 {
		t.Fatalf("finish(current>total) = current:%d total:%d, want 5/5", finishingTracker.current, finishingTracker.total)
	}
	if got := len(emitted); got < 3 {
		t.Fatalf("progress emissions additional = %d, want at least 3", got)
	}

	builder := newMusicBrainzExplorationBuilder()
	defaultNodeID := builder.addNode(MusicBrainzExplorationNode{ID: "default-node"})
	if builder.nodes[defaultNodeID].Emphasis != 1 {
		t.Fatalf("addNode(default emphasis) = %#v, want emphasis 1", builder.nodes[defaultNodeID])
	}

	const artistMBID = "11111111-1111-4111-8111-111111111111"
	mergeNodeID := builder.addNode(MusicBrainzExplorationNode{ID: "merge-node"})
	builder.addNode(MusicBrainzExplorationNode{
		ID:         mergeNodeID,
		Label:      "Artist",
		Subtitle:   "Artist subtitle",
		Accent:     "#abc",
		Kind:       "artist",
		EntityType: "artist",
		MBID:       artistMBID,
		URL:        "https://musicbrainz.org/artist/" + artistMBID,
	})
	mergedNode := builder.nodes[mergeNodeID]
	if mergedNode.Label != "Artist" || mergedNode.Accent != "#abc" || mergedNode.Kind != "artist" || mergedNode.EntityType != "artist" || mergedNode.MBID != artistMBID || mergedNode.URL == "" {
		t.Fatalf("addNode(field merge) = %#v, want merged label/accent/kind/entityType/mbid/url", mergedNode)
	}

	edgeOne := builder.addEdge("artist:1", "release:1", "b-label", "rel")
	edgeTwo := builder.addEdge("artist:1", "release:1", "a-label", "rel")
	sortedEdges := builder.sortedEdges()
	if len(sortedEdges) < 2 || sortedEdges[0].ID != edgeTwo || sortedEdges[1].ID != edgeOne {
		t.Fatalf("sortedEdges(label tie-break) = %#v, want a-label before b-label", sortedEdges)
	}
}
