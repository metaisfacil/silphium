package main

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestSettingsHelperNormalizers(t *testing.T) {
	originalRuntimeNumCPU := runtimeNumCPU
	t.Cleanup(func() {
		runtimeNumCPU = originalRuntimeNumCPU
	})

	if got := normalizePlaybackOrder("ordered-album"); got != "ordered-release" {
		t.Fatalf("normalizePlaybackOrder(ordered-album) = %q, want %q", got, "ordered-release")
	}
	if got := normalizePlaybackOrder("shuffle-album"); got != "shuffle-release" {
		t.Fatalf("normalizePlaybackOrder(shuffle-album) = %q, want %q", got, "shuffle-release")
	}
	if got := normalizePlaybackOrder("ordered-source"); got != "ordered-source" {
		t.Fatalf("normalizePlaybackOrder(ordered-source) = %q, want %q", got, "ordered-source")
	}
	if got := normalizePlaybackOrder("bad"); got != defaultPlaybackOrder {
		t.Fatalf("normalizePlaybackOrder(bad) = %q, want %q", got, defaultPlaybackOrder)
	}
	if got := defaultScrobbleRuleOperator(scrobbleRuleFieldTrackLength); got != scrobbleRuleOperatorGreaterThan {
		t.Fatalf("defaultScrobbleRuleOperator(track length) = %q, want greater-than", got)
	}
	if got := defaultScrobbleRuleOperator(scrobbleRuleFieldPath); got != scrobbleRuleOperatorStartsWith {
		t.Fatalf("defaultScrobbleRuleOperator(path) = %q, want starts-with", got)
	}
	if got := defaultScrobbleRuleOperator(scrobbleRuleFieldAlbumTitle); got != scrobbleRuleOperatorContains {
		t.Fatalf("defaultScrobbleRuleOperator(other) = %q, want contains", got)
	}
	if got := normalizeScrobbleRuleField("bad"); got != "" {
		t.Fatalf("normalizeScrobbleRuleField(bad) = %q, want empty", got)
	}
	if got := normalizeScrobbleRuleOperator("bad", scrobbleRuleFieldTrackLength); got != scrobbleRuleOperatorGreaterThan {
		t.Fatalf("normalizeScrobbleRuleOperator(track length) = %q, want default greater-than", got)
	}
	if got := normalizeSendToActionScope(" album "); got != sendToActionScopeAlbum {
		t.Fatalf("normalizeSendToActionScope(album) = %q, want album", got)
	}
	if got := normalizeSendToActionScope("file"); got != sendToActionScopeFile {
		t.Fatalf("normalizeSendToActionScope(file) = %q, want file", got)
	}
	if got := normalizeSendToActionScope("folder"); got != sendToActionScopeFolder {
		t.Fatalf("normalizeSendToActionScope(folder) = %q, want folder", got)
	}
	if got := normalizeSendToActionScope("bad"); got != "" {
		t.Fatalf("normalizeSendToActionScope(bad) = %q, want empty", got)
	}

	actions := normalizeCustomSendToActions([]CustomSendToAction{
		{Title: "  Add   tag ", Scope: sendToActionScopeTrack, CommandTemplate: " cmd /c tag "},
		{Title: "Add tag", Scope: sendToActionScopeTrack, CommandTemplate: "cmd /c tag"},
		{Title: "", Scope: sendToActionScopeAlbum, CommandTemplate: "cmd"},
	})
	if len(actions) != 1 {
		t.Fatalf("normalizeCustomSendToActions() = %#v, want one normalized action", actions)
	}
	if actions[0].Title != "Add tag" || actions[0].Scope != sendToActionScopeTrack || actions[0].CommandTemplate != "cmd /c tag" {
		t.Fatalf("normalizeCustomSendToActions() = %#v, want normalized unique action", actions)
	}
	runtimeNumCPU = func() int { return 0 }
	if got := maxMusicBrainzTagWorkerCores(); got != 1 {
		t.Fatalf("maxMusicBrainzTagWorkerCores(zero CPUs) = %d, want 1", got)
	}
	if got := defaultMusicBrainzTagWorkerCores(); got != 1 {
		t.Fatalf("defaultMusicBrainzTagWorkerCores(zero CPUs) = %d, want 1", got)
	}
	runtimeNumCPU = func() int { return 8 }
	if got := maxMusicBrainzTagWorkerCores(); got < 1 {
		t.Fatalf("maxMusicBrainzTagWorkerCores() = %d, want >= 1", got)
	}
	if got := defaultMusicBrainzTagWorkerCores(); got != 4 {
		t.Fatalf("defaultMusicBrainzTagWorkerCores() = %d, want 4", got)
	}
	if got := normalizeAudioOutputBufferMs(-1); got != 0 {
		t.Fatalf("normalizeAudioOutputBufferMs(-1) = %d, want 0", got)
	}
	if got := normalizeAudioOutputBufferMs(maxAudioOutputBufferMs + 1); got != maxAudioOutputBufferMs {
		t.Fatalf("normalizeAudioOutputBufferMs(too large) = %d, want %d", got, maxAudioOutputBufferMs)
	}
	if got := normalizeScrobbleRuleOperator(scrobbleRuleOperatorLessThan, scrobbleRuleFieldTrackLength); got != scrobbleRuleOperatorLessThan {
		t.Fatalf("normalizeScrobbleRuleOperator(track length less-than) = %q, want %q", got, scrobbleRuleOperatorLessThan)
	}
	if got := normalizeScrobbleRuleOperator(scrobbleRuleOperatorRegex, scrobbleRuleFieldPath); got != scrobbleRuleOperatorRegex {
		t.Fatalf("normalizeScrobbleRuleOperator(path regex) = %q, want %q", got, scrobbleRuleOperatorRegex)
	}
	if got := normalizeScrobbleRuleValue(scrobbleRuleFieldTrackLength, scrobbleRuleOperatorGreaterThan, "003"); got != "3" {
		t.Fatalf("normalizeScrobbleRuleValue(track length) = %q, want %q", got, "3")
	}
	if got := normalizeScrobbleRuleValue(scrobbleRuleFieldTrackLength, scrobbleRuleOperatorGreaterThan, "-1"); got != "" {
		t.Fatalf("normalizeScrobbleRuleValue(negative length) = %q, want empty", got)
	}
	absoluteRulePath, err := filepath.Abs(filepath.Join("Music", "Artist", "..", "Artist"))
	if err != nil {
		t.Fatalf("Abs(rule path) error = %v", err)
	}
	if got := normalizeScrobbleRuleValue(scrobbleRuleFieldPath, scrobbleRuleOperatorStartsWith, filepath.Join("Music", "Artist", "..", "Artist")); got != filepath.Clean(absoluteRulePath) {
		t.Fatalf("normalizeScrobbleRuleValue(path) = %q, want %q", got, filepath.Clean(absoluteRulePath))
	}
	legacyRules := normalizeScrobbleRules(nil, []string{filepath.Join("Music", "Artist"), filepath.Join("Music", "Artist")})
	if len(legacyRules) != 1 || legacyRules[0].Field != scrobbleRuleFieldPath || legacyRules[0].Operator != scrobbleRuleOperatorStartsWith {
		t.Fatalf("normalizeScrobbleRules(legacy folders) = %#v, want one path rule", legacyRules)
	}
	if got := normalizeMusicBrainzTagWorkerCores(99); got != maxMusicBrainzTagWorkerCores() {
		t.Fatalf("normalizeMusicBrainzTagWorkerCores(too large) = %d, want %d", got, maxMusicBrainzTagWorkerCores())
	}
	if got := normalizeMusicBrainzTagWorkerCores(3); got != 3 {
		t.Fatalf("normalizeMusicBrainzTagWorkerCores(3) = %d, want 3", got)
	}
	if got := normalizeCoverArtPriority(nil); !reflect.DeepEqual(got, defaultCoverArtPriority) {
		t.Fatalf("normalizeCoverArtPriority(nil) = %#v, want %#v", got, defaultCoverArtPriority)
	}
	if got := normalizeCoverArtPriority([]string{" embedded ", "file", "embedded", "bad"}); !reflect.DeepEqual(got, []string{coverArtPriorityEmbedded, coverArtPriorityFile}) {
		t.Fatalf("normalizeCoverArtPriority(filtered) = %#v, want %#v", got, []string{coverArtPriorityEmbedded, coverArtPriorityFile})
	}
	if got := normalizeCoverArtPriority([]string{"bad"}); !reflect.DeepEqual(got, defaultCoverArtPriority) {
		t.Fatalf("normalizeCoverArtPriority(invalid-only) = %#v, want %#v", got, defaultCoverArtPriority)
	}
	if got := normalizeReleaseDepth(-1); got != 0 {
		t.Fatalf("normalizeReleaseDepth(-1) = %d, want 0", got)
	}
	if got := normalizeReleaseDepth(maxReleaseDepth + 1); got != maxReleaseDepth {
		t.Fatalf("normalizeReleaseDepth(too large) = %d, want %d", got, maxReleaseDepth)
	}
}
