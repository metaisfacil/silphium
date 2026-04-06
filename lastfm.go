package main

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

var lastFmAPIBaseURL = "https://ws.audioscrobbler.com/2.0"

const lastFmDuplicateScrobbleWindow = 15 * time.Minute

type lastFmScrobbleDedupEntry struct {
	seenAt     time.Time
	listenedAt int64
}

type lastFmErrorResponse struct {
	Code    int    `xml:"code,attr"`
	Message string `xml:",chardata"`
}

type lastFmAPIResponse struct {
	XMLName xml.Name             `xml:"lfm"`
	Status  string               `xml:"status,attr"`
	Error   *lastFmErrorResponse `xml:"error"`
}

type lastFmGetTokenResponse struct {
	XMLName xml.Name             `xml:"lfm"`
	Status  string               `xml:"status,attr"`
	Error   *lastFmErrorResponse `xml:"error"`
	Token   string               `xml:"token"`
}

type lastFmGetSessionResponse struct {
	XMLName xml.Name             `xml:"lfm"`
	Status  string               `xml:"status,attr"`
	Error   *lastFmErrorResponse `xml:"error"`
	Session struct {
		Name string `xml:"name"`
		Key  string `xml:"key"`
	} `xml:"session"`
}

type lastFmJSONErrorResponse struct {
	Error   int    `json:"error"`
	Message string `json:"message"`
}

type lastFmUserGetInfoResponse struct {
	lastFmJSONErrorResponse
	User struct {
		Name string `json:"name"`
	} `json:"user"`
}

type lastFmUserGetFriendsResponse struct {
	lastFmJSONErrorResponse
	Friends struct {
		Users []struct {
			Name string `json:"name"`
		} `json:"user"`
	} `json:"friends"`
}

type lastFmUserGetRecentTracksResponse struct {
	lastFmJSONErrorResponse
	RecentTracks struct {
		Tracks []struct {
			Name   string `json:"name"`
			Artist struct {
				Name string `json:"#text"`
			} `json:"artist"`
			Album struct {
				Name string `json:"#text"`
			} `json:"album"`
			MBID string `json:"mbid"`
			Date struct {
				UnixTime string `json:"uts"`
			} `json:"date"`
			Attr struct {
				NowPlaying string `json:"nowplaying"`
			} `json:"@attr"`
		} `json:"track"`
	} `json:"recenttracks"`
}

// LastFmTrackMetadata stores the frontend-facing metadata shape for Last.fm submissions.
type LastFmTrackMetadata struct {
	ArtistName      string `json:"artistName"`
	TrackName       string `json:"trackName"`
	ReleaseName     string `json:"releaseName,omitempty"`
	AlbumArtist     string `json:"albumArtist,omitempty"`
	TrackNumber     string `json:"trackNumber,omitempty"`
	RecordingMBID   string `json:"recordingMbid,omitempty"`
	DurationSeconds int    `json:"durationSeconds,omitempty"`
}

func signLastFmParams(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	builder := strings.Builder{}
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteString(params[key])
	}
	builder.WriteString(secret)

	sum := md5.Sum([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}

func parseLastFmResponse(responseBody []byte, fallback string) error {
	parsedResponse := lastFmAPIResponse{}
	if err := xml.Unmarshal(responseBody, &parsedResponse); err != nil {
		if strings.TrimSpace(string(responseBody)) == "" {
			return nil
		}

		return errors.New(fallback)
	}

	if strings.EqualFold(strings.TrimSpace(parsedResponse.Status), "ok") {
		return nil
	}

	if parsedResponse.Error != nil {
		message := strings.TrimSpace(parsedResponse.Error.Message)
		if message != "" {
			return errors.New(message)
		}
	}

	return errors.New(fallback)
}

func lastFmAuthCredentials(apiKey string, apiSecret string) (string, string, error) {
	cleanAPIKey := strings.TrimSpace(apiKey)
	cleanAPISecret := strings.TrimSpace(apiSecret)
	if cleanAPIKey == "" || cleanAPISecret == "" {
		return "", "", errors.New("last.fm auth requires both API key and shared secret")
	}

	return cleanAPIKey, cleanAPISecret, nil
}

func callLastFmAPI(params map[string]string) ([]byte, error) {
	requestBody := url.Values{}
	for key, value := range params {
		requestBody.Set(key, value)
	}

	httpRequest, err := http.NewRequest(http.MethodPost, lastFmAPIBaseURL, strings.NewReader(requestBody.Encode()))
	if err != nil {
		return nil, err
	}

	httpRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")

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
		return nil, fmt.Errorf("unable to read last.fm response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fallback := fmt.Sprintf("last.fm request failed with status %d", response.StatusCode)
		if parseErr := parseLastFmResponse(responseBody, fallback); parseErr != nil {
			return nil, parseErr
		}

		return nil, errors.New(fallback)
	}

	return responseBody, nil
}

func callLastFmReadAPI(params map[string]string) ([]byte, error) {
	requestQuery := url.Values{}
	for key, value := range params {
		requestQuery.Set(key, value)
	}
	requestQuery.Set("format", "json")

	endpoint := strings.TrimRight(lastFmAPIBaseURL, "/") + "?" + requestQuery.Encode()
	httpRequest, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	httpRequest.Header.Set("Accept", "application/json")

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
		return nil, fmt.Errorf("unable to read last.fm response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		parsedError := lastFmJSONErrorResponse{}
		if err := json.Unmarshal(responseBody, &parsedError); err == nil {
			if strings.TrimSpace(parsedError.Message) != "" {
				return nil, errors.New(strings.TrimSpace(parsedError.Message))
			}
		}

		return nil, fmt.Errorf("last.fm request failed with status %d", response.StatusCode)
	}

	parsedError := lastFmJSONErrorResponse{}
	if err := json.Unmarshal(responseBody, &parsedError); err == nil {
		if strings.TrimSpace(parsedError.Message) != "" && parsedError.Error != 0 {
			return nil, errors.New(strings.TrimSpace(parsedError.Message))
		}
	}

	return responseBody, nil
}

// GetLastFmRequestToken requests a desktop-auth request token from Last.fm.
func (a *App) GetLastFmRequestToken(apiKey string, apiSecret string) (string, error) {
	cleanAPIKey, cleanAPISecret, err := lastFmAuthCredentials(apiKey, apiSecret)
	if err != nil {
		return "", err
	}

	params := map[string]string{
		"api_key": cleanAPIKey,
		"method":  "auth.getToken",
	}
	params["api_sig"] = signLastFmParams(params, cleanAPISecret)

	responseBody, err := callLastFmAPI(params)
	if err != nil {
		return "", err
	}

	parsedResponse := lastFmGetTokenResponse{}
	if err := xml.Unmarshal(responseBody, &parsedResponse); err != nil {
		return "", errors.New("invalid last.fm auth token response")
	}
	if !strings.EqualFold(strings.TrimSpace(parsedResponse.Status), "ok") {
		if parsedResponse.Error != nil && strings.TrimSpace(parsedResponse.Error.Message) != "" {
			return "", errors.New(strings.TrimSpace(parsedResponse.Error.Message))
		}

		return "", errors.New("last.fm auth token request failed")
	}

	token := strings.TrimSpace(parsedResponse.Token)
	if token == "" {
		return "", errors.New("last.fm auth token response did not include a token")
	}

	return token, nil
}

// GetLastFmSessionKey exchanges an authorized request token for a Last.fm session key.
func (a *App) GetLastFmSessionKey(apiKey string, apiSecret string, requestToken string) (string, error) {
	cleanAPIKey, cleanAPISecret, err := lastFmAuthCredentials(apiKey, apiSecret)
	if err != nil {
		return "", err
	}

	cleanRequestToken := strings.TrimSpace(requestToken)
	if cleanRequestToken == "" {
		return "", errors.New("last.fm session exchange requires a request token")
	}

	params := map[string]string{
		"api_key": cleanAPIKey,
		"method":  "auth.getSession",
		"token":   cleanRequestToken,
	}
	params["api_sig"] = signLastFmParams(params, cleanAPISecret)

	responseBody, err := callLastFmAPI(params)
	if err != nil {
		return "", err
	}

	parsedResponse := lastFmGetSessionResponse{}
	if err := xml.Unmarshal(responseBody, &parsedResponse); err != nil {
		return "", errors.New("invalid last.fm session response")
	}
	if !strings.EqualFold(strings.TrimSpace(parsedResponse.Status), "ok") {
		if parsedResponse.Error != nil && strings.TrimSpace(parsedResponse.Error.Message) != "" {
			return "", errors.New(strings.TrimSpace(parsedResponse.Error.Message))
		}

		return "", errors.New("last.fm session request failed")
	}

	sessionKey := strings.TrimSpace(parsedResponse.Session.Key)
	if sessionKey == "" {
		return "", errors.New("last.fm session response did not include a session key")
	}

	return sessionKey, nil
}

func (a *App) lastFmCredentials() (string, string, string, error) {
	a.ensureSettingsLoaded()

	apiKey := strings.TrimSpace(a.settings.LastFmAPIKey)
	apiSecret := strings.TrimSpace(a.settings.LastFmAPISecret)
	sessionKey := strings.TrimSpace(a.settings.LastFmSessionKey)
	if apiKey == "" || apiSecret == "" || sessionKey == "" {
		return "", "", "", errors.New("last.fm scrobbling requires an API key, shared secret, and session key")
	}

	return apiKey, apiSecret, sessionKey, nil
}

func lastFmDurationSeconds(value int) string {
	if value <= 0 {
		return ""
	}

	return strconv.Itoa(value)
}

func lastFmTrackNumber(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if slashIndex := strings.Index(trimmed, "/"); slashIndex >= 0 {
		trimmed = strings.TrimSpace(trimmed[:slashIndex])
	}

	if trimmed == "" {
		return ""
	}

	parsed, err := strconv.Atoi(trimmed)
	if err != nil || parsed <= 0 {
		return ""
	}

	return strconv.Itoa(parsed)
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}

	return value
}

func lastFmScrobbleFingerprint(metadata LastFmTrackMetadata) string {
	cleanRecordingMBID := strings.ToLower(strings.TrimSpace(metadata.RecordingMBID))
	if cleanRecordingMBID != "" {
		return "mbid:" + cleanRecordingMBID
	}

	cleanTrackName := strings.ToLower(strings.TrimSpace(metadata.TrackName))
	cleanReleaseName := strings.ToLower(strings.TrimSpace(metadata.ReleaseName))
	cleanTrackNumber := strings.ToLower(strings.TrimSpace(lastFmTrackNumber(metadata.TrackNumber)))
	cleanDuration := strconv.Itoa(metadata.DurationSeconds)

	return strings.Join([]string{
		"track:" + cleanTrackName,
		"release:" + cleanReleaseName,
		"number:" + cleanTrackNumber,
		"duration:" + cleanDuration,
	}, "\x1f")
}

func (a *App) shouldSkipLastFmDuplicateScrobble(metadata LastFmTrackMetadata, listenedAt int64) bool {
	if listenedAt <= 0 {
		return false
	}

	cleanArtistName := strings.ToLower(strings.TrimSpace(metadata.ArtistName))
	cleanTrackName := strings.ToLower(strings.TrimSpace(metadata.TrackName))
	if cleanArtistName == "" || cleanTrackName == "" {
		return false
	}
	duplicateKey := lastFmScrobbleFingerprint(metadata)

	now := time.Now()
	a.lastFmScrobbleMu.Lock()
	defer a.lastFmScrobbleMu.Unlock()

	if a.lastFmRecentScrobbles == nil {
		a.lastFmRecentScrobbles = make(map[string]lastFmScrobbleDedupEntry)
	}

	cutoff := now.Add(-lastFmDuplicateScrobbleWindow)
	for key, entry := range a.lastFmRecentScrobbles {
		if entry.seenAt.Before(cutoff) {
			delete(a.lastFmRecentScrobbles, key)
		}
	}

	if entry, found := a.lastFmRecentScrobbles[duplicateKey]; found && !entry.seenAt.Before(cutoff) {
		if absInt64(entry.listenedAt-listenedAt) <= int64(lastFmDuplicateScrobbleWindow/time.Second) {
			return true
		}
	}

	a.lastFmRecentScrobbles[duplicateKey] = lastFmScrobbleDedupEntry{
		seenAt:     now,
		listenedAt: listenedAt,
	}
	return false
}

// SubmitLastFm sends a now-playing or scrobble event to the Last.fm API.
func (a *App) SubmitLastFm(listenType string, metadata LastFmTrackMetadata, listenedAt int64) error {
	apiKey, apiSecret, sessionKey, err := a.lastFmCredentials()
	if err != nil {
		return err
	}

	cleanArtistName := strings.TrimSpace(metadata.ArtistName)
	cleanTrackName := strings.TrimSpace(metadata.TrackName)
	if cleanArtistName == "" || cleanTrackName == "" {
		return errors.New("artist name and track name are required for Last.fm submissions")
	}

	normalizedType := strings.TrimSpace(strings.ToLower(listenType))
	methodName := ""
	submitTimestamp := int64(0)
	switch normalizedType {
	case "playing_now":
		methodName = "track.updateNowPlaying"
	case "single":
		methodName = "track.scrobble"
		if listenedAt <= 0 {
			listenedAt = time.Now().Unix()
		}
		if a.shouldSkipLastFmDuplicateScrobble(metadata, listenedAt) {
			return nil
		}
		submitTimestamp = listenedAt
	default:
		return errors.New("listen type must be either playing_now or single")
	}

	params := map[string]string{
		"api_key": apiKey,
		"artist":  cleanArtistName,
		"method":  methodName,
		"sk":      sessionKey,
		"track":   cleanTrackName,
	}

	if releaseName := strings.TrimSpace(metadata.ReleaseName); releaseName != "" {
		params["album"] = releaseName
	}
	if albumArtist := strings.TrimSpace(metadata.AlbumArtist); albumArtist != "" {
		params["albumArtist"] = albumArtist
	}
	if trackNumber := lastFmTrackNumber(metadata.TrackNumber); trackNumber != "" {
		params["trackNumber"] = trackNumber
	}
	if recordingMBID := strings.TrimSpace(metadata.RecordingMBID); recordingMBID != "" {
		params["mbid"] = recordingMBID
	}
	if durationSeconds := lastFmDurationSeconds(metadata.DurationSeconds); durationSeconds != "" {
		params["duration"] = durationSeconds
	}
	if submitTimestamp > 0 {
		params["timestamp"] = strconv.FormatInt(submitTimestamp, 10)
	}

	params["api_sig"] = signLastFmParams(params, apiSecret)

	requestBody := url.Values{}
	for key, value := range params {
		requestBody.Set(key, value)
	}

	httpRequest, err := http.NewRequest(http.MethodPost, lastFmAPIBaseURL, strings.NewReader(requestBody.Encode()))
	if err != nil {
		return err
	}

	httpRequest.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	httpClient := &http.Client{Timeout: 15 * time.Second}
	response, err := httpClient.Do(httpRequest)
	if err != nil {
		return err
	}
	defer func() {
		_ = response.Body.Close()
	}()

	responseBody, readErr := io.ReadAll(response.Body)
	if readErr != nil {
		return fmt.Errorf("unable to read last.fm response")
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fallback := fmt.Sprintf("last.fm request failed with status %d", response.StatusCode)
		if parseErr := parseLastFmResponse(responseBody, fallback); parseErr != nil {
			return parseErr
		}

		return errors.New(fallback)
	}

	fallback := "invalid last.fm response"
	if parseErr := parseLastFmResponse(responseBody, fallback); parseErr != nil {
		return parseErr
	}

	return nil
}

// SubmitLastFmLove submits a Last.fm track.love event for a track.
func (a *App) SubmitLastFmLove(metadata LastFmTrackMetadata) error {
	apiKey, apiSecret, sessionKey, err := a.lastFmCredentials()
	if err != nil {
		return err
	}

	cleanArtistName := strings.TrimSpace(metadata.ArtistName)
	cleanTrackName := strings.TrimSpace(metadata.TrackName)
	if cleanArtistName == "" || cleanTrackName == "" {
		return errors.New("artist name and track name are required for Last.fm love submissions")
	}

	params := map[string]string{
		"api_key": apiKey,
		"artist":  cleanArtistName,
		"method":  "track.love",
		"sk":      sessionKey,
		"track":   cleanTrackName,
	}
	if recordingMBID := strings.TrimSpace(metadata.RecordingMBID); recordingMBID != "" {
		params["mbid"] = recordingMBID
	}

	params["api_sig"] = signLastFmParams(params, apiSecret)

	responseBody, err := callLastFmAPI(params)
	if err != nil {
		return err
	}

	fallback := "invalid last.fm love response"
	if parseErr := parseLastFmResponse(responseBody, fallback); parseErr != nil {
		return parseErr
	}

	return nil
}

// SubmitLastFmUnlove submits a Last.fm track.unlove event for a track.
func (a *App) SubmitLastFmUnlove(metadata LastFmTrackMetadata) error {
	apiKey, apiSecret, sessionKey, err := a.lastFmCredentials()
	if err != nil {
		return err
	}

	cleanArtistName := strings.TrimSpace(metadata.ArtistName)
	cleanTrackName := strings.TrimSpace(metadata.TrackName)
	if cleanArtistName == "" || cleanTrackName == "" {
		return errors.New("artist name and track name are required for Last.fm unlove submissions")
	}

	params := map[string]string{
		"api_key": apiKey,
		"artist":  cleanArtistName,
		"method":  "track.unlove",
		"sk":      sessionKey,
		"track":   cleanTrackName,
	}
	if recordingMBID := strings.TrimSpace(metadata.RecordingMBID); recordingMBID != "" {
		params["mbid"] = recordingMBID
	}

	params["api_sig"] = signLastFmParams(params, apiSecret)

	responseBody, err := callLastFmAPI(params)
	if err != nil {
		return err
	}

	fallback := "invalid last.fm unlove response"
	if parseErr := parseLastFmResponse(responseBody, fallback); parseErr != nil {
		return parseErr
	}

	return nil
}

func (a *App) lastFmSessionCredentials() (string, string, error) {
	a.ensureSettingsLoaded()

	apiKey := strings.TrimSpace(a.settings.LastFmAPIKey)
	sessionKey := strings.TrimSpace(a.settings.LastFmSessionKey)
	if apiKey == "" || sessionKey == "" {
		return "", "", errors.New("last.fm social feed requires an API key and session key")
	}

	return apiKey, sessionKey, nil
}

// GetLastFmFollowing returns the Last.fm friends list for the authenticated user.
func (a *App) GetLastFmFollowing() ([]string, error) {
	apiKey, sessionKey, err := a.lastFmSessionCredentials()
	if err != nil {
		return nil, err
	}

	infoBody, err := callLastFmReadAPI(map[string]string{
		"method":  "user.getinfo",
		"api_key": apiKey,
		"sk":      sessionKey,
	})
	if err != nil {
		return nil, err
	}

	infoResponse := lastFmUserGetInfoResponse{}
	if err := json.Unmarshal(infoBody, &infoResponse); err != nil {
		return nil, errors.New("invalid last.fm user info response")
	}

	userName := strings.TrimSpace(infoResponse.User.Name)
	if userName == "" {
		return nil, errors.New("last.fm user info response did not include a username")
	}

	friendsBody, err := callLastFmReadAPI(map[string]string{
		"method":  "user.getfriends",
		"api_key": apiKey,
		"user":    userName,
		"limit":   "200",
	})
	if err != nil {
		return nil, err
	}

	friendsResponse := lastFmUserGetFriendsResponse{}
	if err := json.Unmarshal(friendsBody, &friendsResponse); err != nil {
		return nil, errors.New("invalid last.fm friends response")
	}

	seen := make(map[string]struct{})
	following := make([]string, 0, len(friendsResponse.Friends.Users))
	for _, friend := range friendsResponse.Friends.Users {
		name := strings.TrimSpace(friend.Name)
		if name == "" {
			continue
		}
		normalized := strings.ToLower(name)
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		following = append(following, name)
	}

	sort.Strings(following)
	return following, nil
}

func normalizeLastFmSocialCount(count int) int {
	if count <= 0 {
		return 25
	}

	if count > 200 {
		return 200
	}

	return count
}

func stableLastFmSocialID(userName string, trackName string, listenedAt int64) int {
	hashSeed := strings.ToLower(strings.TrimSpace(userName)) + "\x1f" + strings.TrimSpace(trackName) + "\x1f" + strconv.FormatInt(listenedAt, 10)
	hash := md5.Sum([]byte(hashSeed))
	return int(uint32(hash[0])<<24 | uint32(hash[1])<<16 | uint32(hash[2])<<8 | uint32(hash[3]))
}

func parseLastFmUnixTimestamp(value string) int64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0
	}

	parsed, err := strconv.ParseInt(trimmed, 10, 64)
	if err != nil || parsed <= 0 {
		return 0
	}

	return parsed
}

// GetLastFmFollowingFeed returns recent listens for followed Last.fm users.
func (a *App) GetLastFmFollowingFeed(count int) ([]ListenBrainzSocialEvent, error) {
	apiKey, _, err := a.lastFmSessionCredentials()
	if err != nil {
		return nil, err
	}

	followingUsers, err := a.GetLastFmFollowing()
	if err != nil {
		return nil, err
	}

	maxUsers := normalizeLastFmSocialCount(count)
	if len(followingUsers) > maxUsers {
		followingUsers = followingUsers[:maxUsers]
	}

	events := make([]ListenBrainzSocialEvent, 0, len(followingUsers))
	for _, friend := range followingUsers {
		recentTracksBody, requestErr := callLastFmReadAPI(map[string]string{
			"method":  "user.getrecenttracks",
			"api_key": apiKey,
			"user":    friend,
			"limit":   "1",
		})
		if requestErr != nil {
			continue
		}

		recentTracksResponse := lastFmUserGetRecentTracksResponse{}
		if unmarshalErr := json.Unmarshal(recentTracksBody, &recentTracksResponse); unmarshalErr != nil {
			continue
		}

		if len(recentTracksResponse.RecentTracks.Tracks) == 0 {
			continue
		}

		track := recentTracksResponse.RecentTracks.Tracks[0]
		trackName := strings.TrimSpace(track.Name)
		if trackName == "" {
			continue
		}

		artistName := strings.TrimSpace(track.Artist.Name)
		if artistName == "" {
			artistName = "Unknown artist"
		}

		listenedAt := parseLastFmUnixTimestamp(track.Date.UnixTime)
		playingNow := strings.EqualFold(strings.TrimSpace(track.Attr.NowPlaying), "true")
		if playingNow && listenedAt <= 0 {
			listenedAt = time.Now().Unix()
		}

		eventID := stableLastFmSocialID(friend, trackName, listenedAt)
		events = append(events, ListenBrainzSocialEvent{
			ID:         eventID,
			Created:    listenedAt,
			EventType:  "listen",
			Hidden:     false,
			UserName:   friend,
			ListenedAt: listenedAt,
			PlayingNow: playingNow,
			TrackMetadata: ListenBrainzSocialTrackMetadata{
				ArtistName:  artistName,
				TrackName:   trackName,
				ReleaseName: strings.TrimSpace(track.Album.Name),
				AdditionalInfo: ListenBrainzSocialAdditionalInfo{
					MusicService:     "last.fm",
					MusicServiceName: "Last.fm",
					RecordingMBID:    strings.TrimSpace(track.MBID),
				},
			},
		})
	}

	sort.Slice(events, func(i, j int) bool {
		if events[i].ListenedAt == events[j].ListenedAt {
			return events[i].ID > events[j].ID
		}
		return events[i].ListenedAt > events[j].ListenedAt
	})

	if len(events) > count && count > 0 {
		return events[:count], nil
	}

	return events, nil
}
