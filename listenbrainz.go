package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const listenBrainzSubmitURL = "https://api.listenbrainz.org/1/submit-listens"

type ListenBrainzTrackMetadata struct {
	ArtistName    string   `json:"artistName"`
	TrackName     string   `json:"trackName"`
	ReleaseName   string   `json:"releaseName"`
	RecordingMBID string   `json:"recordingMbid,omitempty"`
	ReleaseMBID   string   `json:"releaseMbid,omitempty"`
	ArtistMBIDs   []string `json:"artistMbids,omitempty"`
}

type listenBrainzAdditionalInfo struct {
	RecordingMBID string   `json:"recording_mbid,omitempty"`
	ReleaseMBID   string   `json:"release_mbid,omitempty"`
	ArtistMBIDs   []string `json:"artist_mbids,omitempty"`
	MediaPlayer   string   `json:"media_player,omitempty"`
}

type listenBrainzPayloadItem struct {
	TrackMetadata listenBrainzTrackMetadataRequest `json:"track_metadata"`
	ListenedAt    int64                            `json:"listened_at,omitempty"`
}

type listenBrainzTrackMetadataRequest struct {
	ArtistName     string                     `json:"artist_name"`
	TrackName      string                     `json:"track_name"`
	ReleaseName    string                     `json:"release_name,omitempty"`
	AdditionalInfo listenBrainzAdditionalInfo `json:"additional_info,omitempty"`
}

type listenBrainzSubmitRequest struct {
	ListenType string                    `json:"listen_type"`
	Payload    []listenBrainzPayloadItem `json:"payload"`
}

type listenBrainzSubmitResponse struct {
	Code    int    `json:"code"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

func (a *App) SubmitListenBrainz(listenType string, metadata ListenBrainzTrackMetadata, listenedAt int64) error {
	a.ensureSettingsLoaded()

	token := strings.TrimSpace(a.settings.ListenBrainzUserToken)
	if token == "" {
		return errors.New("listenbrainz token is not configured")
	}

	normalizedType := strings.TrimSpace(strings.ToLower(listenType))
	if normalizedType != "playing_now" && normalizedType != "single" {
		return errors.New("listen type must be either playing_now or single")
	}

	artistName := strings.TrimSpace(metadata.ArtistName)
	trackName := strings.TrimSpace(metadata.TrackName)
	if artistName == "" || trackName == "" {
		return errors.New("artist name and track name are required for ListenBrainz submissions")
	}

	if normalizedType == "single" && listenedAt <= 0 {
		listenedAt = time.Now().Unix()
	}

	requestBody := listenBrainzSubmitRequest{
		ListenType: normalizedType,
		Payload: []listenBrainzPayloadItem{{
			TrackMetadata: listenBrainzTrackMetadataRequest{
				ArtistName:  artistName,
				TrackName:   trackName,
				ReleaseName: strings.TrimSpace(metadata.ReleaseName),
				AdditionalInfo: listenBrainzAdditionalInfo{
					RecordingMBID: strings.TrimSpace(metadata.RecordingMBID),
					ReleaseMBID:   strings.TrimSpace(metadata.ReleaseMBID),
					ArtistMBIDs:   metadata.ArtistMBIDs,
					MediaPlayer:   "Silphium",
				},
			},
			ListenedAt: listenedAt,
		}},
	}

	rawRequest, err := json.Marshal(requestBody)
	if err != nil {
		return err
	}

	httpRequest, err := http.NewRequest(http.MethodPost, listenBrainzSubmitURL, bytes.NewReader(rawRequest))
	if err != nil {
		return err
	}

	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", fmt.Sprintf("Token %s", token))

	httpClient := &http.Client{Timeout: 15 * time.Second}
	response, err := httpClient.Do(httpRequest)
	if err != nil {
		return err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}

	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return fmt.Errorf("listenbrainz submit failed with status %d", response.StatusCode)
	}

	parsedResponse := listenBrainzSubmitResponse{}
	if err := json.Unmarshal(responseBody, &parsedResponse); err == nil {
		if strings.TrimSpace(parsedResponse.Error) != "" {
			return fmt.Errorf("listenbrainz submit failed: %s", parsedResponse.Error)
		}
		if strings.TrimSpace(parsedResponse.Message) != "" {
			return fmt.Errorf("listenbrainz submit failed: %s", parsedResponse.Message)
		}
	}

	return fmt.Errorf("listenbrainz submit failed with status %d", response.StatusCode)
}
