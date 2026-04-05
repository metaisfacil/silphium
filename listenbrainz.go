package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const listenBrainzPublicServerURL = "https://api.listenbrainz.org"
const listenBrainzSubmitPath = "/1/submit-listens"
const listenBrainzRecordingFeedbackPath = "/1/feedback/recording-feedback"
const listenBrainzValidateTokenPath = "/1/validate-token"
const listenBrainzGetFeedbackForRecordingsPath = "/1/feedback/user/%s/get-feedback-for-recordings"

var listenBrainzFetchMu sync.Mutex
var nextListenBrainzFetchAt time.Time
var listenBrainzUserNameCacheMu sync.Mutex
var listenBrainzUserNameCache = map[string]string{}

// ListenBrainzTrackMetadata is the frontend-facing metadata shape for listen submissions.
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

type listenBrainzValidateTokenResponse struct {
	Code     int    `json:"code"`
	Error    string `json:"error"`
	Message  string `json:"message"`
	Valid    bool   `json:"valid"`
	UserName string `json:"user_name"`
}

type listenBrainzRecordingFeedbackRequest struct {
	RecordingMBID string `json:"recording_mbid,omitempty"`
	Score         int    `json:"score"`
}

type listenBrainzRecordingFeedbackLookupRequest struct {
	RecordingMBIDs []string `json:"recording_mbids,omitempty"`
}

type listenBrainzRecordingFeedbackItem struct {
	UserID        string `json:"user_id"`
	RecordingMSID string `json:"recording_msid"`
	RecordingMBID string `json:"recording_mbid"`
	Score         int    `json:"score"`
}

type listenBrainzRecordingFeedbackLookupResponse struct {
	Code     int                                 `json:"code"`
	Error    string                              `json:"error"`
	Message  string                              `json:"message"`
	Count    int                                 `json:"count"`
	Total    int                                 `json:"total_count"`
	Offset   int                                 `json:"offset"`
	Feedback []listenBrainzRecordingFeedbackItem `json:"feedback"`
}

func waitForListenBrainzRequestSlot() {
	listenBrainzFetchMu.Lock()
	defer listenBrainzFetchMu.Unlock()

	now := time.Now()
	if now.Before(nextListenBrainzFetchAt) {
		time.Sleep(nextListenBrainzFetchAt.Sub(now))
	}

	nextListenBrainzFetchAt = time.Now().Add(1 * time.Second)
}

func normalizedListenBrainzFeedbackScore(score int) int {
	switch score {
	case -1, 0, 1:
		return score
	default:
		return 0
	}
}

func parseListenBrainzError(statusCode int, responseBody []byte, fallback string) error {
	parsedResponse := listenBrainzSubmitResponse{}
	if err := json.Unmarshal(responseBody, &parsedResponse); err == nil {
		if strings.TrimSpace(parsedResponse.Error) != "" {
			return errors.New(strings.TrimSpace(parsedResponse.Error))
		}

		if strings.TrimSpace(parsedResponse.Message) != "" {
			return errors.New(strings.TrimSpace(parsedResponse.Message))
		}
	}

	return fmt.Errorf("%s with status %d", fallback, statusCode)
}

func (a *App) listenBrainzServerURL() string {
	a.ensureSettingsLoaded()
	u := strings.TrimRight(strings.TrimSpace(a.settings.ListenBrainzServerURL), "/")
	if u == "" {
		return listenBrainzPublicServerURL
	}

	return u
}

func (a *App) listenBrainzRateLimit() bool {
	return strings.EqualFold(a.listenBrainzServerURL(), listenBrainzPublicServerURL)
}

func (a *App) waitForListenBrainzRequestSlotIfNeeded() {
	if a.listenBrainzRateLimit() {
		waitForListenBrainzRequestSlot()
	}
}

func (a *App) listenBrainzToken() (string, error) {
	a.ensureSettingsLoaded()

	token := strings.TrimSpace(a.settings.ListenBrainzUserToken)
	if token == "" {
		return "", errors.New("listenbrainz token is not configured")
	}

	return token, nil
}

func (a *App) listenBrainzUserName(token string) (string, error) {
	listenBrainzUserNameCacheMu.Lock()
	cachedUserName, hasCachedUserName := listenBrainzUserNameCache[token]
	listenBrainzUserNameCacheMu.Unlock()
	if hasCachedUserName && strings.TrimSpace(cachedUserName) != "" {
		return cachedUserName, nil
	}

	a.waitForListenBrainzRequestSlotIfNeeded()

	request, err := http.NewRequest(http.MethodGet, a.listenBrainzServerURL()+listenBrainzValidateTokenPath, nil)
	if err != nil {
		return "", err
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", fmt.Sprintf("Token %s", token))

	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return "", fmt.Errorf("unable to read listenbrainz validate-token response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", parseListenBrainzError(response.StatusCode, responseBody, "listenbrainz validate-token request failed")
	}

	parsedResponse := listenBrainzValidateTokenResponse{}
	if err := json.Unmarshal(responseBody, &parsedResponse); err != nil {
		return "", errors.New("invalid listenbrainz validate-token response")
	}

	if !parsedResponse.Valid {
		if strings.TrimSpace(parsedResponse.Message) != "" {
			return "", errors.New(strings.TrimSpace(parsedResponse.Message))
		}
		return "", errors.New("listenbrainz token is invalid")
	}

	userName := strings.TrimSpace(parsedResponse.UserName)
	if userName == "" {
		return "", errors.New("listenbrainz validate-token response did not include user name")
	}

	listenBrainzUserNameCacheMu.Lock()
	listenBrainzUserNameCache[token] = userName
	listenBrainzUserNameCacheMu.Unlock()

	return userName, nil
}

// SubmitListenBrainz sends a playing_now or single listen event to the ListenBrainz API.
func (a *App) SubmitListenBrainz(listenType string, metadata ListenBrainzTrackMetadata, listenedAt int64) error {
	token, err := a.listenBrainzToken()
	if err != nil {
		return err
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

	a.waitForListenBrainzRequestSlotIfNeeded()

	httpRequest, err := http.NewRequest(http.MethodPost, a.listenBrainzServerURL()+listenBrainzSubmitPath, bytes.NewReader(rawRequest))
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

	return parseListenBrainzError(response.StatusCode, responseBody, "listenbrainz submit failed")
}

// SubmitListenBrainzRecordingFeedback submits love/hate feedback (-1, 0, or 1) for a recording MBID.
func (a *App) SubmitListenBrainzRecordingFeedback(recordingMBID string, score int) error {
	token, err := a.listenBrainzToken()
	if err != nil {
		return err
	}

	cleanRecordingMBID := strings.TrimSpace(recordingMBID)
	if cleanRecordingMBID == "" {
		return errors.New("recording mbid is required")
	}

	normalizedScore := normalizedListenBrainzFeedbackScore(score)
	if normalizedScore != score {
		return errors.New("listenbrainz feedback score must be -1, 0, or 1")
	}

	requestBody := listenBrainzRecordingFeedbackRequest{
		RecordingMBID: cleanRecordingMBID,
		Score:         normalizedScore,
	}

	rawRequest, err := json.Marshal(requestBody)
	if err != nil {
		return err
	}

	a.waitForListenBrainzRequestSlotIfNeeded()

	httpRequest, err := http.NewRequest(http.MethodPost, a.listenBrainzServerURL()+listenBrainzRecordingFeedbackPath, bytes.NewReader(rawRequest))
	if err != nil {
		return err
	}

	httpRequest.Header.Set("Accept", "application/json")
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
		return fmt.Errorf("listenbrainz feedback submit failed with status %d", response.StatusCode)
	}

	return parseListenBrainzError(response.StatusCode, responseBody, "listenbrainz feedback submit failed")
}

// GetListenBrainzRecordingFeedback fetches this user's current feedback score for a recording MBID.
func (a *App) GetListenBrainzRecordingFeedback(recordingMBID string) (int, error) {
	token, err := a.listenBrainzToken()
	if err != nil {
		return 0, err
	}

	cleanRecordingMBID := strings.TrimSpace(recordingMBID)
	if cleanRecordingMBID == "" {
		return 0, errors.New("recording mbid is required")
	}

	userName, err := a.listenBrainzUserName(token)
	if err != nil {
		return 0, err
	}

	requestBody := listenBrainzRecordingFeedbackLookupRequest{
		RecordingMBIDs: []string{cleanRecordingMBID},
	}

	rawRequest, err := json.Marshal(requestBody)
	if err != nil {
		return 0, err
	}

	requestURL := fmt.Sprintf(
		a.listenBrainzServerURL()+listenBrainzGetFeedbackForRecordingsPath,
		url.PathEscape(userName),
	)

	a.waitForListenBrainzRequestSlotIfNeeded()

	httpRequest, err := http.NewRequest(http.MethodPost, requestURL, bytes.NewReader(rawRequest))
	if err != nil {
		return 0, err
	}

	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Authorization", fmt.Sprintf("Token %s", token))

	httpClient := &http.Client{Timeout: 15 * time.Second}
	response, err := httpClient.Do(httpRequest)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return 0, fmt.Errorf("unable to read listenbrainz feedback response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return 0, parseListenBrainzError(response.StatusCode, responseBody, "listenbrainz feedback lookup failed")
	}

	parsedResponse := listenBrainzRecordingFeedbackLookupResponse{}
	if err := json.Unmarshal(responseBody, &parsedResponse); err != nil {
		return 0, errors.New("invalid listenbrainz feedback response")
	}

	for _, feedback := range parsedResponse.Feedback {
		if strings.EqualFold(strings.TrimSpace(feedback.RecordingMBID), cleanRecordingMBID) {
			return normalizedListenBrainzFeedbackScore(feedback.Score), nil
		}
	}

	return 0, nil
}
