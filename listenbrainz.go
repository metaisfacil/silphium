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
const listenBrainzFollowingPath = "/1/user/%s/following"
const listenBrainzFeedEventsFollowingPath = "/1/user/%s/feed/events/listens/following"
const listenBrainzDuplicateScrobbleWindow = 15 * time.Minute

var listenBrainzFetchMu sync.Mutex
var nextListenBrainzFetchAt time.Time
var listenBrainzUserNameCacheMu sync.Mutex
var listenBrainzUserNameCache = map[string]string{}

type listenBrainzScrobbleDedupEntry struct {
	seenAt     time.Time
	listenedAt int64
}

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

// ListenBrainzSocialAdditionalInfo stores the auxiliary metadata returned for a social listen event.
type ListenBrainzSocialAdditionalInfo struct {
	RecordingMBID    string   `json:"recordingMbid,omitempty"`
	RecordingMSID    string   `json:"recordingMsid,omitempty"`
	ReleaseMBID      string   `json:"releaseMbid,omitempty"`
	ReleaseGroupMBID string   `json:"releaseGroupMbid,omitempty"`
	ArtistMBIDs      []string `json:"artistMbids,omitempty"`
	OriginURL        string   `json:"originUrl,omitempty"`
	MusicService     string   `json:"musicService,omitempty"`
	MusicServiceName string   `json:"musicServiceName,omitempty"`
	DurationMs       int      `json:"durationMs,omitempty"`
}

// ListenBrainzSocialTrackMetadata stores the track details for one social listen event.
type ListenBrainzSocialTrackMetadata struct {
	ArtistName     string                           `json:"artistName"`
	TrackName      string                           `json:"trackName"`
	ReleaseName    string                           `json:"releaseName,omitempty"`
	AdditionalInfo ListenBrainzSocialAdditionalInfo `json:"additionalInfo"`
}

// ListenBrainzSocialEvent stores one listen event returned by the ListenBrainz social feed.
type ListenBrainzSocialEvent struct {
	ID            int                             `json:"id"`
	Created       int64                           `json:"created"`
	EventType     string                          `json:"eventType"`
	Hidden        bool                            `json:"hidden"`
	Message       string                          `json:"message,omitempty"`
	UserName      string                          `json:"userName"`
	ListenedAt    int64                           `json:"listenedAt,omitempty"`
	ListenedAtISO string                          `json:"listenedAtIso,omitempty"`
	PlayingNow    bool                            `json:"playingNow,omitempty"`
	TrackMetadata ListenBrainzSocialTrackMetadata `json:"trackMetadata"`
}

type listenBrainzFollowingResponse struct {
	Following []string `json:"following"`
	User      string   `json:"user"`
}

type listenBrainzSocialAdditionalInfoResponse struct {
	RecordingMBID    string   `json:"recording_mbid,omitempty"`
	RecordingMSID    string   `json:"recording_msid,omitempty"`
	ReleaseMBID      string   `json:"release_mbid,omitempty"`
	ReleaseGroupMBID string   `json:"release_group_mbid,omitempty"`
	ArtistMBIDs      []string `json:"artist_mbids,omitempty"`
	OriginURL        string   `json:"origin_url,omitempty"`
	MusicService     string   `json:"music_service,omitempty"`
	MusicServiceName string   `json:"music_service_name,omitempty"`
	DurationMs       int      `json:"duration_ms,omitempty"`
}

type listenBrainzSocialTrackMetadataResponse struct {
	AdditionalInfo listenBrainzSocialAdditionalInfoResponse `json:"additional_info"`
	ArtistName     string                                   `json:"artist_name"`
	ReleaseName    string                                   `json:"release_name"`
	TrackName      string                                   `json:"track_name"`
}

type listenBrainzSocialMetadataResponse struct {
	Created          int64                                   `json:"created,omitempty"`
	RelationshipType string                                  `json:"relationship_type,omitempty"`
	Message          string                                  `json:"message,omitempty"`
	BlurbContent     string                                  `json:"blurb_content,omitempty"`
	InsertedAt       int64                                   `json:"inserted_at,omitempty"`
	ListenedAt       int64                                   `json:"listened_at,omitempty"`
	ListenedAtISO    string                                  `json:"listened_at_iso,omitempty"`
	PlayingNow       bool                                    `json:"playing_now,omitempty"`
	TrackMetadata    listenBrainzSocialTrackMetadataResponse `json:"track_metadata"`
	UserName         string                                  `json:"user_name,omitempty"`
}

type listenBrainzSocialEventResponse struct {
	Created   int64                              `json:"created"`
	EventType string                             `json:"event_type"`
	Hidden    bool                               `json:"hidden"`
	ID        int                                `json:"id"`
	Message   string                             `json:"message,omitempty"`
	Metadata  listenBrainzSocialMetadataResponse `json:"metadata"`
	UserName  string                             `json:"user_name"`
}

type listenBrainzSocialFeedResponse struct {
	Payload struct {
		Count  int                               `json:"count"`
		Events []listenBrainzSocialEventResponse `json:"events"`
		UserID string                            `json:"user_id"`
	} `json:"payload"`
}

func waitForListenBrainzRequestSlot(rateLimitMs int) {
	if rateLimitMs <= 0 {
		return
	}

	listenBrainzFetchMu.Lock()
	defer listenBrainzFetchMu.Unlock()

	now := time.Now()
	if now.Before(nextListenBrainzFetchAt) {
		time.Sleep(nextListenBrainzFetchAt.Sub(now))
	}

	nextListenBrainzFetchAt = time.Now().Add(time.Duration(rateLimitMs) * time.Millisecond)
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

func normalizeListenBrainzSocialCount(count int) int {
	if count <= 0 {
		return 25
	}

	if count > 1000 {
		return 1000
	}

	return count
}

func (a *App) listenBrainzServerURL() string {
	a.ensureSettingsLoaded()
	u := strings.TrimRight(strings.TrimSpace(a.settings.ListenBrainzServerURL), "/")
	if u == "" {
		return listenBrainzPublicServerURL
	}

	return u
}

func (a *App) listenBrainzRequestRateMs() int {
	a.ensureSettingsLoaded()
	return a.settings.ListenBrainzRequestRateMs
}

func (a *App) waitForListenBrainzRequestSlotIfNeeded() {
	waitForListenBrainzRequestSlot(a.listenBrainzRequestRateMs())
}

func (a *App) listenBrainzToken() (string, error) {
	a.ensureSettingsLoaded()

	token := strings.TrimSpace(a.settings.ListenBrainzUserToken)
	if token == "" {
		return "", errors.New("listenbrainz token is not configured")
	}

	return token, nil
}

func listenBrainzScrobbleFingerprint(metadata ListenBrainzTrackMetadata) string {
	cleanRecordingMBID := strings.ToLower(strings.TrimSpace(metadata.RecordingMBID))
	if cleanRecordingMBID != "" {
		return "mbid:" + cleanRecordingMBID
	}

	cleanTrackName := strings.ToLower(strings.TrimSpace(metadata.TrackName))
	cleanReleaseName := strings.ToLower(strings.TrimSpace(metadata.ReleaseName))

	return strings.Join([]string{
		"track:" + cleanTrackName,
		"release:" + cleanReleaseName,
	}, "\x1f")
}

func (a *App) shouldSkipListenBrainzDuplicateScrobble(metadata ListenBrainzTrackMetadata, listenedAt int64) bool {
	if listenedAt <= 0 {
		return false
	}

	cleanTrackName := strings.ToLower(strings.TrimSpace(metadata.TrackName))
	if cleanTrackName == "" {
		return false
	}

	duplicateKey := listenBrainzScrobbleFingerprint(metadata)
	now := time.Now()

	a.listenBrainzScrobbleMu.Lock()
	defer a.listenBrainzScrobbleMu.Unlock()

	if a.listenBrainzRecentScrobbles == nil {
		a.listenBrainzRecentScrobbles = make(map[string]listenBrainzScrobbleDedupEntry)
	}

	cutoff := now.Add(-listenBrainzDuplicateScrobbleWindow)
	for key, entry := range a.listenBrainzRecentScrobbles {
		if entry.seenAt.Before(cutoff) {
			delete(a.listenBrainzRecentScrobbles, key)
		}
	}

	if entry, found := a.listenBrainzRecentScrobbles[duplicateKey]; found && !entry.seenAt.Before(cutoff) {
		if absInt64(entry.listenedAt-listenedAt) <= int64(listenBrainzDuplicateScrobbleWindow/time.Second) {
			return true
		}
	}

	a.listenBrainzRecentScrobbles[duplicateKey] = listenBrainzScrobbleDedupEntry{
		seenAt:     now,
		listenedAt: listenedAt,
	}

	return false
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
	if normalizedType == "single" && a.shouldSkipListenBrainzDuplicateScrobble(metadata, listenedAt) {
		return nil
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

// GetListenBrainzFollowing fetches the usernames followed by the configured ListenBrainz account.
func (a *App) GetListenBrainzFollowing() ([]string, error) {
	token, err := a.listenBrainzToken()
	if err != nil {
		return nil, err
	}

	userName, err := a.listenBrainzUserName(token)
	if err != nil {
		return nil, err
	}

	requestURL := fmt.Sprintf(
		a.listenBrainzServerURL()+listenBrainzFollowingPath,
		url.PathEscape(userName),
	)

	a.waitForListenBrainzRequestSlotIfNeeded()

	httpRequest, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}

	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Authorization", fmt.Sprintf("Token %s", token))

	httpClient := &http.Client{Timeout: 15 * time.Second}
	response, err := httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return nil, fmt.Errorf("unable to read listenbrainz following response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, parseListenBrainzError(response.StatusCode, responseBody, "listenbrainz following lookup failed")
	}

	parsedResponse := listenBrainzFollowingResponse{}
	if err := json.Unmarshal(responseBody, &parsedResponse); err != nil {
		return nil, errors.New("invalid listenbrainz following response")
	}

	following := make([]string, 0, len(parsedResponse.Following))
	for _, rawUserName := range parsedResponse.Following {
		trimmedUserName := strings.TrimSpace(rawUserName)
		if trimmedUserName == "" {
			continue
		}

		following = append(following, trimmedUserName)
	}

	return following, nil
}

// GetListenBrainzFollowingFeed fetches recent listen events for the configured account's followed users.
func (a *App) GetListenBrainzFollowingFeed(count int) ([]ListenBrainzSocialEvent, error) {
	token, err := a.listenBrainzToken()
	if err != nil {
		return nil, err
	}

	userName, err := a.listenBrainzUserName(token)
	if err != nil {
		return nil, err
	}

	requestURL := fmt.Sprintf(
		a.listenBrainzServerURL()+listenBrainzFeedEventsFollowingPath,
		url.PathEscape(userName),
	)

	query := url.Values{}
	query.Set("count", fmt.Sprintf("%d", normalizeListenBrainzSocialCount(count)))
	requestURL = requestURL + "?" + query.Encode()

	a.waitForListenBrainzRequestSlotIfNeeded()

	httpRequest, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}

	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Authorization", fmt.Sprintf("Token %s", token))

	httpClient := &http.Client{Timeout: 15 * time.Second}
	response, err := httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return nil, fmt.Errorf("unable to read listenbrainz following feed response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, parseListenBrainzError(response.StatusCode, responseBody, "listenbrainz following feed lookup failed")
	}

	parsedResponse := listenBrainzSocialFeedResponse{}
	if err := json.Unmarshal(responseBody, &parsedResponse); err != nil {
		return nil, errors.New("invalid listenbrainz following feed response")
	}

	events := make([]ListenBrainzSocialEvent, 0, len(parsedResponse.Payload.Events))
	for _, event := range parsedResponse.Payload.Events {
		mappedEvent := ListenBrainzSocialEvent{
			ID:            event.ID,
			Created:       event.Created,
			EventType:     strings.TrimSpace(event.EventType),
			Hidden:        event.Hidden,
			Message:       strings.TrimSpace(event.Message),
			UserName:      strings.TrimSpace(event.UserName),
			ListenedAt:    event.Metadata.ListenedAt,
			ListenedAtISO: strings.TrimSpace(event.Metadata.ListenedAtISO),
			PlayingNow:    event.Metadata.PlayingNow,
			TrackMetadata: ListenBrainzSocialTrackMetadata{
				ArtistName:  strings.TrimSpace(event.Metadata.TrackMetadata.ArtistName),
				TrackName:   strings.TrimSpace(event.Metadata.TrackMetadata.TrackName),
				ReleaseName: strings.TrimSpace(event.Metadata.TrackMetadata.ReleaseName),
				AdditionalInfo: ListenBrainzSocialAdditionalInfo{
					RecordingMBID:    strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.RecordingMBID),
					RecordingMSID:    strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.RecordingMSID),
					ReleaseMBID:      strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.ReleaseMBID),
					ReleaseGroupMBID: strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.ReleaseGroupMBID),
					ArtistMBIDs:      event.Metadata.TrackMetadata.AdditionalInfo.ArtistMBIDs,
					OriginURL:        strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.OriginURL),
					MusicService:     strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.MusicService),
					MusicServiceName: strings.TrimSpace(event.Metadata.TrackMetadata.AdditionalInfo.MusicServiceName),
					DurationMs:       event.Metadata.TrackMetadata.AdditionalInfo.DurationMs,
				},
			},
		}

		if mappedEvent.UserName == "" {
			mappedEvent.UserName = strings.TrimSpace(event.Metadata.UserName)
		}
		if mappedEvent.Created <= 0 {
			mappedEvent.Created = event.Metadata.Created
		}
		if mappedEvent.Created <= 0 {
			mappedEvent.Created = event.Metadata.InsertedAt
		}
		if mappedEvent.Created <= 0 {
			mappedEvent.Created = mappedEvent.ListenedAt
		}

		events = append(events, mappedEvent)
	}

	return events, nil
}
