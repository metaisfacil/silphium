package main

import (
	"fmt"
	"net/url"
	"strings"
)

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
