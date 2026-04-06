package main

import (
	"encoding/json"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const appSettingsFileName = "silphium.settings.json"

// FocusedKeyboardShortcuts stores the persisted key bindings for focused app commands.
type FocusedKeyboardShortcuts struct {
	PlayPauseToggle    string `json:"playPauseToggle"`
	NextTrack          string `json:"nextTrack"`
	PreviousTrack      string `json:"previousTrack"`
	StopPlayback       string `json:"stopPlayback"`
	FocusLibraryFilter string `json:"focusLibraryFilter"`
	OpenSettings       string `json:"openSettings"`
}

// AppLibraryFolder describes one configured library root and its optional metadata.
type AppLibraryFolder struct {
	Path         string `json:"path"`
	Label        string `json:"label,omitempty"`
	ReleaseDepth int    `json:"releaseDepth,omitempty"`
}

// AudioSettings stores persisted audio output and playback behavior preferences.
type AudioSettings struct {
	OutputDevice      string `json:"outputDevice,omitempty"`
	OutputBufferMs    int    `json:"outputBufferMs,omitempty"`
	GaplessPlayback   bool   `json:"gaplessPlayback,omitempty"`
	ReplayGainEnabled bool   `json:"replayGainEnabled,omitempty"`
}

// ScrobbleRule describes one persisted scrobble filtering rule.
type ScrobbleRule struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value,omitempty"`
}

// AppSettings stores persisted user configuration shared between frontend and backend.
type AppSettings struct {
	LibraryFolders                         []AppLibraryFolder       `json:"libraryFolders,omitempty"`
	LibraryPath                            string                   `json:"libraryPath,omitempty"`
	FFmpegPath                             string                   `json:"ffmpegPath,omitempty"`
	ListenBrainzUserToken                  string                   `json:"listenBrainzUserToken"`
	ScrobbleFilterMode                     string                   `json:"scrobbleFilterMode,omitempty"`
	ScrobbleRules                          []ScrobbleRule           `json:"scrobbleRules,omitempty"`
	ScrobbleFolders                        []string                 `json:"scrobbleFolders,omitempty"`
	MusicBrainzServerURL                   string                   `json:"musicBrainzServerUrl,omitempty"`
	MusicBrainzRequestRateMs               int                      `json:"musicBrainzRequestRateMs,omitempty"`
	ListenBrainzServerURL                  string                   `json:"listenBrainzServerUrl,omitempty"`
	ListenBrainzRequestRateMs              int                      `json:"listenBrainzRequestRateMs,omitempty"`
	PlaybackOrder                          string                   `json:"playbackOrder"`
	ReleaseDepth                           int                      `json:"releaseDepth,omitempty"`
	FavoritePlaylists                      []string                 `json:"favoritePlaylists,omitempty"`
	CoverArtPriority                       []string                 `json:"coverArtPriority,omitempty"`
	Audio                                  AudioSettings            `json:"audio,omitempty"`
	PreferMusicBrainzMetadata              bool                     `json:"preferMusicBrainzMetadata"`
	MusicBrainzTagDatabaseEnabled          bool                     `json:"musicBrainzTagDatabaseEnabled,omitempty"`
	MusicBrainzTagStaleDays                *int                     `json:"musicBrainzTagStaleDays,omitempty"`
	MusicBrainzTagRequestStaggeringEnabled bool                     `json:"musicBrainzTagRequestStaggeringEnabled,omitempty"`
	MusicBrainzTagWorkerCores              int                      `json:"musicBrainzTagWorkerCores,omitempty"`
	KeyboardShortcuts                      FocusedKeyboardShortcuts `json:"keyboardShortcuts"`
}

const defaultPlaybackOrder = "ordered-library"
const defaultScrobbleFilterMode = "blacklist"
const maxReleaseDepth = 64
const defaultMusicBrainzTagStaleDays = 30
const maxMusicBrainzTagStaleDays = 36500
const defaultShortcutPlayPauseToggle = "Space"
const defaultShortcutNextTrack = "N"
const defaultShortcutPreviousTrack = "P"
const defaultShortcutStopPlayback = "Z"
const defaultShortcutFocusLibraryFilter = "Ctrl+F"
const defaultShortcutOpenSettings = "Ctrl+P"
const coverArtPriorityFile = "file"
const coverArtPriorityEmbedded = "embedded"
const coverArtPriorityMusicBrainz = "musicbrainz"
const defaultAudioOutputDevice = "default"
const maxAudioOutputBufferMs = 1000

const scrobbleRuleFieldPath = "path"
const scrobbleRuleFieldAlbumArtist = "albumArtist"
const scrobbleRuleFieldTrackArtist = "trackArtist"
const scrobbleRuleFieldAlbumTitle = "albumTitle"
const scrobbleRuleFieldTrackTitle = "trackTitle"
const scrobbleRuleFieldGenre = "genre"
const scrobbleRuleFieldArtistMBID = "artistMbid"
const scrobbleRuleFieldAlbumMBID = "albumMbid"
const scrobbleRuleFieldTrackLength = "trackLength"

const scrobbleRuleOperatorContains = "contains"
const scrobbleRuleOperatorEquals = "equals"
const scrobbleRuleOperatorStartsWith = "starts_with"
const scrobbleRuleOperatorRegex = "regex"
const scrobbleRuleOperatorLessThan = "less_than"
const scrobbleRuleOperatorGreaterThan = "greater_than"

var defaultCoverArtPriority = []string{coverArtPriorityFile, coverArtPriorityEmbedded}

func intPointer(value int) *int {
	pointer := value
	return &pointer
}

func normalizeAudioOutputDevice(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return defaultAudioOutputDevice
	}

	return trimmed
}

func normalizeAudioOutputBufferMs(value int) int {
	if value < 0 {
		return 0
	}

	if value > maxAudioOutputBufferMs {
		return maxAudioOutputBufferMs
	}

	return value
}

func normalizeAudioSettings(settings AudioSettings) AudioSettings {
	return AudioSettings{
		OutputDevice:      normalizeAudioOutputDevice(settings.OutputDevice),
		OutputBufferMs:    normalizeAudioOutputBufferMs(settings.OutputBufferMs),
		GaplessPlayback:   settings.GaplessPlayback,
		ReplayGainEnabled: settings.ReplayGainEnabled,
	}
}

func normalizeFFmpegPath(value string) string {
	return normalizeToolExecutablePath(value)
}

func normalizePlaybackOrder(value string) string {
	switch strings.TrimSpace(value) {
	case "ordered-album", "ordered-library", "shuffle-album", "shuffle-library":
		return strings.TrimSpace(value)
	default:
		return defaultPlaybackOrder
	}
}

func normalizeScrobbleFilterMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "whitelist":
		return "whitelist"
	case "blacklist":
		return "blacklist"
	default:
		return defaultScrobbleFilterMode
	}
}

func normalizeScrobbleFolders(folders []string) []string {
	normalizedFolders := make([]string, 0, len(folders))
	seenFolders := make(map[string]struct{}, len(folders))
	for _, candidate := range folders {
		normalized := normalizePath(candidate)
		if normalized == "" {
			continue
		}

		if absolutePath, err := filepath.Abs(normalized); err == nil {
			normalized = filepath.Clean(absolutePath)
		}

		lookupKey := strings.ToLower(normalized)
		if _, exists := seenFolders[lookupKey]; exists {
			continue
		}

		seenFolders[lookupKey] = struct{}{}
		normalizedFolders = append(normalizedFolders, normalized)
	}

	return normalizedFolders
}

func normalizeScrobbleRuleField(value string) string {
	switch strings.TrimSpace(value) {
	case scrobbleRuleFieldPath,
		scrobbleRuleFieldAlbumArtist,
		scrobbleRuleFieldTrackArtist,
		scrobbleRuleFieldAlbumTitle,
		scrobbleRuleFieldTrackTitle,
		scrobbleRuleFieldGenre,
		scrobbleRuleFieldArtistMBID,
		scrobbleRuleFieldAlbumMBID,
		scrobbleRuleFieldTrackLength:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func defaultScrobbleRuleOperator(field string) string {
	if field == scrobbleRuleFieldTrackLength {
		return scrobbleRuleOperatorGreaterThan
	}

	if field == scrobbleRuleFieldPath {
		return scrobbleRuleOperatorStartsWith
	}

	return scrobbleRuleOperatorContains
}

func normalizeScrobbleRuleOperator(value string, field string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if field == scrobbleRuleFieldTrackLength {
		switch normalized {
		case scrobbleRuleOperatorLessThan, scrobbleRuleOperatorGreaterThan:
			return normalized
		default:
			return defaultScrobbleRuleOperator(field)
		}
	}

	switch normalized {
	case scrobbleRuleOperatorContains, scrobbleRuleOperatorEquals, scrobbleRuleOperatorStartsWith, scrobbleRuleOperatorRegex:
		return normalized
	default:
		return defaultScrobbleRuleOperator(field)
	}
}

func normalizeScrobbleRuleValue(field string, operator string, value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if field == scrobbleRuleFieldTrackLength {
		parsed, err := strconv.Atoi(trimmed)
		if err != nil || parsed < 0 {
			return ""
		}

		return strconv.Itoa(parsed)
	}

	if field == scrobbleRuleFieldPath && operator != scrobbleRuleOperatorRegex {
		normalizedPath := normalizePath(trimmed)
		if normalizedPath == "" {
			return ""
		}

		if absolutePath, err := filepath.Abs(normalizedPath); err == nil {
			normalizedPath = filepath.Clean(absolutePath)
		}

		return normalizedPath
	}

	return trimmed
}

func legacyScrobbleFolderRules(folders []string) []ScrobbleRule {
	normalizedFolders := normalizeScrobbleFolders(folders)
	legacyRules := make([]ScrobbleRule, 0, len(normalizedFolders))
	for _, folder := range normalizedFolders {
		legacyRules = append(legacyRules, ScrobbleRule{
			Field:    scrobbleRuleFieldPath,
			Operator: scrobbleRuleOperatorStartsWith,
			Value:    folder,
		})
	}

	return legacyRules
}

func normalizeScrobbleRules(rules []ScrobbleRule, legacyFolders []string) []ScrobbleRule {
	candidates := rules
	if len(candidates) == 0 {
		candidates = legacyScrobbleFolderRules(legacyFolders)
	}

	normalizedRules := make([]ScrobbleRule, 0, len(candidates))
	seenRules := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		field := normalizeScrobbleRuleField(candidate.Field)
		if field == "" {
			continue
		}

		operator := normalizeScrobbleRuleOperator(candidate.Operator, field)
		normalizedValue := normalizeScrobbleRuleValue(field, operator, candidate.Value)
		if normalizedValue == "" {
			continue
		}

		dedupeKey := strings.ToLower(field + "|" + operator + "|" + normalizedValue)
		if _, exists := seenRules[dedupeKey]; exists {
			continue
		}

		seenRules[dedupeKey] = struct{}{}
		normalizedRules = append(normalizedRules, ScrobbleRule{
			Field:    field,
			Operator: operator,
			Value:    normalizedValue,
		})
	}

	return normalizedRules
}

func maxMusicBrainzTagWorkerCores() int {
	workerCores := runtime.NumCPU()
	if workerCores < 1 {
		return 1
	}

	return workerCores
}

func defaultMusicBrainzTagWorkerCores() int {
	workerCores := maxMusicBrainzTagWorkerCores() / 2
	if workerCores < 1 {
		return 1
	}

	return workerCores
}

func normalizeMusicBrainzTagWorkerCores(value int) int {
	if value <= 0 {
		return defaultMusicBrainzTagWorkerCores()
	}

	if value > maxMusicBrainzTagWorkerCores() {
		return maxMusicBrainzTagWorkerCores()
	}

	return value
}

func normalizeMusicBrainzTagStaleDays(value *int) int {
	if value == nil {
		return defaultMusicBrainzTagStaleDays
	}

	normalized := *value
	if normalized < 0 {
		return defaultMusicBrainzTagStaleDays
	}

	if normalized > maxMusicBrainzTagStaleDays {
		return maxMusicBrainzTagStaleDays
	}

	return normalized
}

func normalizeKeyboardShortcutBinding(value, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}

	return trimmed
}

func normalizeFocusedKeyboardShortcuts(shortcuts FocusedKeyboardShortcuts) FocusedKeyboardShortcuts {
	return FocusedKeyboardShortcuts{
		PlayPauseToggle:    normalizeKeyboardShortcutBinding(shortcuts.PlayPauseToggle, defaultShortcutPlayPauseToggle),
		NextTrack:          normalizeKeyboardShortcutBinding(shortcuts.NextTrack, defaultShortcutNextTrack),
		PreviousTrack:      normalizeKeyboardShortcutBinding(shortcuts.PreviousTrack, defaultShortcutPreviousTrack),
		StopPlayback:       normalizeKeyboardShortcutBinding(shortcuts.StopPlayback, defaultShortcutStopPlayback),
		FocusLibraryFilter: normalizeKeyboardShortcutBinding(shortcuts.FocusLibraryFilter, defaultShortcutFocusLibraryFilter),
		OpenSettings:       normalizeKeyboardShortcutBinding(shortcuts.OpenSettings, defaultShortcutOpenSettings),
	}
}

func normalizeCoverArtPriority(priority []string) []string {
	if priority == nil {
		return append([]string{}, defaultCoverArtPriority...)
	}

	if len(priority) == 0 {
		return []string{}
	}

	ordered := make([]string, 0, 3)
	seen := make(map[string]struct{}, 3)
	for _, item := range priority {
		normalized := strings.ToLower(strings.TrimSpace(item))
		switch normalized {
		case coverArtPriorityFile, coverArtPriorityEmbedded, coverArtPriorityMusicBrainz:
			if _, exists := seen[normalized]; exists {
				continue
			}

			seen[normalized] = struct{}{}
			ordered = append(ordered, normalized)
		}
	}

	if len(ordered) == 0 {
		return append([]string{}, defaultCoverArtPriority...)
	}

	return ordered
}

func normalizeBrainzServerURL(value string) string {
	return strings.TrimRight(strings.TrimSpace(value), "/")
}

const publicBrainzMinRateLimitMs = 1000

func isLocalBrainzServerURL(normalizedServerURL string) bool {
	trimmed := strings.TrimSpace(normalizedServerURL)
	if trimmed == "" {
		return false
	}

	withScheme := trimmed
	if !strings.Contains(withScheme, "://") {
		withScheme = "http://" + withScheme
	}

	parsed, err := url.Parse(withScheme)
	if err != nil {
		return false
	}

	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return false
	}

	if strings.EqualFold(host, "localhost") {
		return true
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}

	if ip.IsLoopback() {
		return true
	}

	ipv4 := ip.To4()
	if ipv4 == nil {
		return false
	}

	if ipv4[0] == 192 && ipv4[1] == 168 {
		return true
	}

	return ipv4[0] == 10 && ipv4[1] == 0
}

func normalizeMusicBrainzRequestRateMs(rateMs int, normalizedServerURL string) int {
	if isLocalBrainzServerURL(normalizedServerURL) {
		if rateMs < 0 {
			return 0
		}

		return rateMs
	}

	if rateMs < publicBrainzMinRateLimitMs {
		return publicBrainzMinRateLimitMs
	}

	return rateMs
}

func normalizeListenBrainzRequestRateMs(rateMs int, normalizedServerURL string) int {
	if isLocalBrainzServerURL(normalizedServerURL) {
		if rateMs < 0 {
			return 0
		}

		return rateMs
	}

	if rateMs < publicBrainzMinRateLimitMs {
		return publicBrainzMinRateLimitMs
	}

	return rateMs
}

func normalizeReleaseDepth(value int) int {
	if value < 0 {
		return 0
	}

	if value > maxReleaseDepth {
		return maxReleaseDepth
	}

	return value
}

func normalizeLibraryFolderLabel(value string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\\", " "), "/", " "))
	if normalized == "" {
		return ""
	}

	return strings.Join(strings.Fields(normalized), " ")
}

func normalizeLibraryFolders(folders []AppLibraryFolder, legacyPath string, legacyReleaseDepth int) []AppLibraryFolder {
	candidates := make([]AppLibraryFolder, 0, len(folders)+1)
	if len(folders) > 0 {
		candidates = append(candidates, folders...)
	} else if strings.TrimSpace(legacyPath) != "" {
		candidates = append(candidates, AppLibraryFolder{
			Path:         legacyPath,
			ReleaseDepth: legacyReleaseDepth,
		})
	}

	normalizedFolders := make([]AppLibraryFolder, 0, len(candidates))
	seenPaths := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		normalizedPath := normalizePath(candidate.Path)
		if normalizedPath == "" {
			continue
		}

		if absolutePath, err := filepath.Abs(normalizedPath); err == nil {
			normalizedPath = filepath.Clean(absolutePath)
		}

		if _, exists := seenPaths[normalizedPath]; exists {
			continue
		}

		seenPaths[normalizedPath] = struct{}{}
		normalizedFolders = append(normalizedFolders, AppLibraryFolder{
			Path:         normalizedPath,
			Label:        normalizeLibraryFolderLabel(candidate.Label),
			ReleaseDepth: normalizeReleaseDepth(candidate.ReleaseDepth),
		})
	}

	return normalizedFolders
}

func normalizeAppSettings(settings AppSettings) AppSettings {
	token := strings.TrimSpace(settings.ListenBrainzUserToken)
	playbackOrder := normalizePlaybackOrder(settings.PlaybackOrder)
	libraryFolders := normalizeLibraryFolders(settings.LibraryFolders, settings.LibraryPath, settings.ReleaseDepth)
	coverArtPriority := normalizeCoverArtPriority(settings.CoverArtPriority)
	preferMusicBrainzMetadata := settings.PreferMusicBrainzMetadata
	musicBrainzTagStaleDays := normalizeMusicBrainzTagStaleDays(settings.MusicBrainzTagStaleDays)
	audio := normalizeAudioSettings(settings.Audio)
	keyboardShortcuts := normalizeFocusedKeyboardShortcuts(settings.KeyboardShortcuts)
	favoritePlaylists := make([]string, 0, len(settings.FavoritePlaylists))
	seenFavoritePlaylists := make(map[string]struct{})
	for _, candidate := range settings.FavoritePlaylists {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" {
			continue
		}

		normalized := normalizePath(trimmed)
		if absolutePath, err := filepath.Abs(normalized); err == nil {
			normalized = filepath.Clean(absolutePath)
		}

		if _, exists := seenFavoritePlaylists[normalized]; exists {
			continue
		}

		seenFavoritePlaylists[normalized] = struct{}{}
		favoritePlaylists = append(favoritePlaylists, normalized)
	}
	legacyLibraryPath := ""
	legacyReleaseDepth := 0
	if len(libraryFolders) > 0 {
		legacyLibraryPath = libraryFolders[0].Path
		legacyReleaseDepth = libraryFolders[0].ReleaseDepth
	}
	musicBrainzServerURL := normalizeBrainzServerURL(settings.MusicBrainzServerURL)
	listenBrainzServerURL := normalizeBrainzServerURL(settings.ListenBrainzServerURL)
	scrobbleFilterMode := normalizeScrobbleFilterMode(settings.ScrobbleFilterMode)
	scrobbleRules := normalizeScrobbleRules(settings.ScrobbleRules, settings.ScrobbleFolders)

	return AppSettings{
		LibraryFolders:                         libraryFolders,
		LibraryPath:                            legacyLibraryPath,
		FFmpegPath:                             normalizeFFmpegPath(settings.FFmpegPath),
		ListenBrainzUserToken:                  token,
		ScrobbleFilterMode:                     scrobbleFilterMode,
		ScrobbleRules:                          scrobbleRules,
		MusicBrainzServerURL:                   musicBrainzServerURL,
		MusicBrainzRequestRateMs:               normalizeMusicBrainzRequestRateMs(settings.MusicBrainzRequestRateMs, musicBrainzServerURL),
		ListenBrainzServerURL:                  listenBrainzServerURL,
		ListenBrainzRequestRateMs:              normalizeListenBrainzRequestRateMs(settings.ListenBrainzRequestRateMs, listenBrainzServerURL),
		PlaybackOrder:                          playbackOrder,
		ReleaseDepth:                           legacyReleaseDepth,
		FavoritePlaylists:                      favoritePlaylists,
		CoverArtPriority:                       coverArtPriority,
		Audio:                                  audio,
		PreferMusicBrainzMetadata:              preferMusicBrainzMetadata,
		MusicBrainzTagDatabaseEnabled:          settings.MusicBrainzTagDatabaseEnabled,
		MusicBrainzTagStaleDays:                intPointer(musicBrainzTagStaleDays),
		MusicBrainzTagRequestStaggeringEnabled: settings.MusicBrainzTagRequestStaggeringEnabled,
		MusicBrainzTagWorkerCores:              normalizeMusicBrainzTagWorkerCores(settings.MusicBrainzTagWorkerCores),
		KeyboardShortcuts:                      keyboardShortcuts,
	}
}

func defaultSettingsPath() string {
	executablePath, err := os.Executable()
	if err != nil {
		return appSettingsFileName
	}

	return filepath.Join(filepath.Dir(executablePath), appSettingsFileName)
}

func readAppSettings(path string) (AppSettings, error) {
	rawBytes, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return AppSettings{}, nil
		}
		return AppSettings{}, err
	}

	var settings AppSettings
	if err := json.Unmarshal(rawBytes, &settings); err != nil {
		return AppSettings{}, err
	}

	return normalizeAppSettings(settings), nil
}

func writeAppSettings(path string, settings AppSettings) error {
	rawBytes, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}

	rawBytes = append(rawBytes, '\n')
	return os.WriteFile(path, rawBytes, 0o644)
}

func (a *App) ensureSettingsPath() string {
	if strings.TrimSpace(a.settingsPath) == "" {
		a.settingsPath = defaultSettingsPath()
	}

	return a.settingsPath
}

func (a *App) loadStoredSettings() {
	a.settingsLoaded = true
	settingsPath := a.ensureSettingsPath()
	settings, err := readAppSettings(settingsPath)
	if err != nil {
		return
	}

	a.settings = settings
}

func (a *App) ensureSettingsLoaded() {
	if a.settingsLoaded {
		return
	}

	a.loadStoredSettings()
}

// GetSettings returns the currently persisted application settings.
func (a *App) GetSettings() AppSettings {
	a.ensureSettingsLoaded()
	return a.settings
}

// SaveSettings validates, persists, and returns normalized application settings.
func (a *App) SaveSettings(settings AppSettings) (AppSettings, error) {
	a.ensureSettingsLoaded()

	normalized := normalizeAppSettings(settings)
	if err := writeAppSettings(a.ensureSettingsPath(), normalized); err != nil {
		return AppSettings{}, err
	}

	a.settings = normalized
	a.audioBackend().SetFFmpegPath(normalized.FFmpegPath)
	a.audioBackend().ApplyAudioSettings(normalized.Audio)
	a.notifyMusicBrainzTagWorker()
	return normalized, nil
}
