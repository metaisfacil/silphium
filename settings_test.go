package main

import (
	"math"
	"testing"
)

func TestNormalizeBrainzServerURL(t *testing.T) {
	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
		{
			name:  "whitespace only",
			input: "   ",
			want:  "",
		},
		{
			name:  "plain URL",
			input: "https://musicbrainz.org",
			want:  "https://musicbrainz.org",
		},
		{
			name:  "URL with trailing slash",
			input: "https://musicbrainz.org/",
			want:  "https://musicbrainz.org",
		},
		{
			name:  "URL with surrounding whitespace",
			input: "  https://example.com/mb  ",
			want:  "https://example.com/mb",
		},
		{
			name:  "URL with trailing slash and whitespace",
			input: "  https://example.com/mb/  ",
			want:  "https://example.com/mb",
		},
		{
			name:  "local server URL",
			input: "http://localhost:5000",
			want:  "http://localhost:5000",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got := normalizeBrainzServerURL(testCase.input)
			if got != testCase.want {
				t.Fatalf("normalizeBrainzServerURL(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
}

func TestNormalizeAppSettingsBrainzServerURLs(t *testing.T) {
	testCases := []struct {
		name                  string
		musicBrainzServerURL  string
		listenBrainzServerURL string
		wantMusicBrainz       string
		wantListenBrainz      string
	}{
		{
			name:             "empty URLs stay empty",
			wantMusicBrainz:  "",
			wantListenBrainz: "",
		},
		{
			name:                  "trailing slash is removed",
			musicBrainzServerURL:  "https://musicbrainz.org/",
			listenBrainzServerURL: "https://api.listenbrainz.org/",
			wantMusicBrainz:       "https://musicbrainz.org",
			wantListenBrainz:      "https://api.listenbrainz.org",
		},
		{
			name:                  "local server URLs preserved",
			musicBrainzServerURL:  "http://localhost:5000",
			listenBrainzServerURL: "http://localhost:6000",
			wantMusicBrainz:       "http://localhost:5000",
			wantListenBrainz:      "http://localhost:6000",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			settings := normalizeAppSettings(AppSettings{
				MusicBrainzServerURL:  testCase.musicBrainzServerURL,
				ListenBrainzServerURL: testCase.listenBrainzServerURL,
			})
			if settings.MusicBrainzServerURL != testCase.wantMusicBrainz {
				t.Fatalf("MusicBrainzServerURL = %q, want %q", settings.MusicBrainzServerURL, testCase.wantMusicBrainz)
			}
			if settings.ListenBrainzServerURL != testCase.wantListenBrainz {
				t.Fatalf("ListenBrainzServerURL = %q, want %q", settings.ListenBrainzServerURL, testCase.wantListenBrainz)
			}
		})
	}
}

func TestNormalizeMusicBrainzRequestRateMs(t *testing.T) {
	testCases := []struct {
		name      string
		rateMs    int
		serverURL string
		want      int
	}{
		{
			name:      "empty URL (public): zero is clamped to 1000",
			rateMs:    0,
			serverURL: "",
			want:      1000,
		},
		{
			name:      "public URL: below minimum is clamped to 1000",
			rateMs:    500,
			serverURL: "https://musicbrainz.org",
			want:      1000,
		},
		{
			name:      "public URL case-insensitive: below minimum is clamped",
			rateMs:    0,
			serverURL: "HTTPS://MUSICBRAINZ.ORG",
			want:      1000,
		},
		{
			name:      "public URL: value above minimum is preserved",
			rateMs:    2000,
			serverURL: "https://musicbrainz.org",
			want:      2000,
		},
		{
			name:      "loopback URL: zero is allowed",
			rateMs:    0,
			serverURL: "http://localhost:5000",
			want:      0,
		},
		{
			name:      "loopback URL: negative is clamped to zero",
			rateMs:    -1,
			serverURL: "http://localhost:5000",
			want:      0,
		},
		{
			name:      "loopback URL: positive value below 1000 is preserved",
			rateMs:    250,
			serverURL: "http://127.0.0.1:5000",
			want:      250,
		},
		{
			name:      "192.168.x.x URL: positive value below 1000 is preserved",
			rateMs:    250,
			serverURL: "http://192.168.1.15:5000",
			want:      250,
		},
		{
			name:      "10.0.x.x URL: positive value below 1000 is preserved",
			rateMs:    250,
			serverURL: "http://10.0.2.7:5000",
			want:      250,
		},
		{
			name:      "non-loopback custom URL: values below minimum are clamped",
			rateMs:    250,
			serverURL: "https://mb.example.com",
			want:      1000,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got := normalizeMusicBrainzRequestRateMs(testCase.rateMs, normalizeBrainzServerURL(testCase.serverURL))
			if got != testCase.want {
				t.Fatalf("normalizeMusicBrainzRequestRateMs(%d, %q) = %d, want %d", testCase.rateMs, testCase.serverURL, got, testCase.want)
			}
		})
	}
}

func TestNormalizeListenBrainzRequestRateMs(t *testing.T) {
	testCases := []struct {
		name      string
		rateMs    int
		serverURL string
		want      int
	}{
		{
			name:      "empty URL (public): zero is clamped to 1000",
			rateMs:    0,
			serverURL: "",
			want:      1000,
		},
		{
			name:      "public URL: below minimum is clamped to 1000",
			rateMs:    500,
			serverURL: "https://api.listenbrainz.org",
			want:      1000,
		},
		{
			name:      "public URL case-insensitive: below minimum is clamped",
			rateMs:    0,
			serverURL: "HTTPS://API.LISTENBRAINZ.ORG",
			want:      1000,
		},
		{
			name:      "public URL: value above minimum is preserved",
			rateMs:    2000,
			serverURL: "https://api.listenbrainz.org",
			want:      2000,
		},
		{
			name:      "loopback URL: zero is allowed",
			rateMs:    0,
			serverURL: "http://localhost:6000",
			want:      0,
		},
		{
			name:      "loopback URL: negative is clamped to zero",
			rateMs:    -1,
			serverURL: "http://localhost:6000",
			want:      0,
		},
		{
			name:      "loopback URL: positive value below 1000 is preserved",
			rateMs:    250,
			serverURL: "http://127.0.0.1:6000",
			want:      250,
		},
		{
			name:      "192.168.x.x URL: positive value below 1000 is preserved",
			rateMs:    250,
			serverURL: "http://192.168.1.15:6000",
			want:      250,
		},
		{
			name:      "10.0.x.x URL: positive value below 1000 is preserved",
			rateMs:    250,
			serverURL: "http://10.0.2.7:6000",
			want:      250,
		},
		{
			name:      "non-loopback custom URL: values below minimum are clamped",
			rateMs:    250,
			serverURL: "https://lb.example.com",
			want:      1000,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got := normalizeListenBrainzRequestRateMs(testCase.rateMs, normalizeBrainzServerURL(testCase.serverURL))
			if got != testCase.want {
				t.Fatalf("normalizeListenBrainzRequestRateMs(%d, %q) = %d, want %d", testCase.rateMs, testCase.serverURL, got, testCase.want)
			}
		})
	}
}

func TestNormalizeAppSettingsDefaultsLissajousEnabledToTrue(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{})
	if settings.LocalLibraryFilesDatabaseEnabled == nil {
		t.Fatal("LocalLibraryFilesDatabaseEnabled should be populated")
	}
	if !*settings.LocalLibraryFilesDatabaseEnabled {
		t.Fatal("LocalLibraryFilesDatabaseEnabled should default to true")
	}
	if settings.LocalLibraryFilesDatabaseLoadOnStartup == nil {
		t.Fatal("LocalLibraryFilesDatabaseLoadOnStartup should be populated")
	}
	if !*settings.LocalLibraryFilesDatabaseLoadOnStartup {
		t.Fatal("LocalLibraryFilesDatabaseLoadOnStartup should default to true")
	}
	if settings.ScrobblingEnabled == nil {
		t.Fatal("ScrobblingEnabled should be populated")
	}
	if !*settings.ScrobblingEnabled {
		t.Fatal("ScrobblingEnabled should default to true")
	}
	if settings.LissajousEnabled == nil {
		t.Fatal("LissajousEnabled should be populated")
	}
	if !*settings.LissajousEnabled {
		t.Fatal("LissajousEnabled should default to true")
	}
}

func TestNormalizeAppSettingsPreservesDisabledLocalLibraryDatabase(t *testing.T) {
	disabled := false
	settings := normalizeAppSettings(AppSettings{
		LocalLibraryFilesDatabaseEnabled:       &disabled,
		LocalLibraryFilesDatabaseLoadOnStartup: &disabled,
	})
	if settings.LocalLibraryFilesDatabaseEnabled == nil {
		t.Fatal("LocalLibraryFilesDatabaseEnabled should be populated")
	}
	if *settings.LocalLibraryFilesDatabaseEnabled {
		t.Fatal("LocalLibraryFilesDatabaseEnabled should remain false when explicitly disabled")
	}
	if settings.LocalLibraryFilesDatabaseLoadOnStartup == nil {
		t.Fatal("LocalLibraryFilesDatabaseLoadOnStartup should be populated")
	}
	if *settings.LocalLibraryFilesDatabaseLoadOnStartup {
		t.Fatal("LocalLibraryFilesDatabaseLoadOnStartup should remain false when explicitly disabled")
	}
}

func TestNormalizeAppSettingsPreservesDisabledLissajous(t *testing.T) {
	disabled := false
	settings := normalizeAppSettings(AppSettings{LissajousEnabled: &disabled})
	if settings.LissajousEnabled == nil {
		t.Fatal("LissajousEnabled should be populated")
	}
	if *settings.LissajousEnabled {
		t.Fatal("LissajousEnabled should remain false when explicitly disabled")
	}
}

func TestNormalizeAppSettingsDefaultsLissajousScale(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{})
	if math.Abs(settings.LissajousScale-defaultLissajousScale) > 1e-9 {
		t.Fatalf("LissajousScale = %v, want %v", settings.LissajousScale, defaultLissajousScale)
	}
}

func TestNormalizeAppSettingsClampsLissajousScale(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{LissajousScale: 5})
	if math.Abs(settings.LissajousScale-maxLissajousScale) > 1e-9 {
		t.Fatalf("LissajousScale = %v, want %v", settings.LissajousScale, maxLissajousScale)
	}

	settings = normalizeAppSettings(AppSettings{LissajousScale: 0.01})
	if math.Abs(settings.LissajousScale-minLissajousScale) > 1e-9 {
		t.Fatalf("LissajousScale = %v, want %v", settings.LissajousScale, minLissajousScale)
	}
}

func TestNormalizeAppSettingsPreservesLissajousScale(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{LissajousScale: 0.4})
	if math.Abs(settings.LissajousScale-0.4) > 1e-9 {
		t.Fatalf("LissajousScale = %v, want %v", settings.LissajousScale, 0.4)
	}
}

func TestNormalizeAppSettingsDefaultsVisualizerModeToLissajous(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{})
	if settings.VisualizerMode != "lissajous" {
		t.Fatalf("VisualizerMode = %q, want %q", settings.VisualizerMode, "lissajous")
	}
}

func TestNormalizeAppSettingsPreservesEqualizerVisualizerMode(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{VisualizerMode: "equalizer"})
	if settings.VisualizerMode != "equalizer" {
		t.Fatalf("VisualizerMode = %q, want %q", settings.VisualizerMode, "equalizer")
	}
}

func TestNormalizeAppSettingsFallsBackForInvalidVisualizerMode(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{VisualizerMode: "vector-scope"})
	if settings.VisualizerMode != "lissajous" {
		t.Fatalf("VisualizerMode = %q, want %q", settings.VisualizerMode, "lissajous")
	}
}

func TestNormalizeAppSettingsDefaultsEqualizerPositionToBottom(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{})
	if settings.EqualizerPosition != "bottom" {
		t.Fatalf("EqualizerPosition = %q, want %q", settings.EqualizerPosition, "bottom")
	}
}

func TestNormalizeAppSettingsPreservesTopEqualizerPosition(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{EqualizerPosition: "top"})
	if settings.EqualizerPosition != "top" {
		t.Fatalf("EqualizerPosition = %q, want %q", settings.EqualizerPosition, "top")
	}
}

func TestNormalizeAppSettingsFallsBackForInvalidEqualizerPosition(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{EqualizerPosition: "left"})
	if settings.EqualizerPosition != "bottom" {
		t.Fatalf("EqualizerPosition = %q, want %q", settings.EqualizerPosition, "bottom")
	}
}

func TestNormalizeAppSettingsDefaultsUIDitheringEnabledToTrue(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{})
	if settings.UIDitheringEnabled == nil {
		t.Fatal("UIDitheringEnabled should be populated")
	}
	if !*settings.UIDitheringEnabled {
		t.Fatal("UIDitheringEnabled should default to true")
	}
}

func TestNormalizeAppSettingsPreservesDisabledUIDithering(t *testing.T) {
	disabled := false
	settings := normalizeAppSettings(AppSettings{UIDitheringEnabled: &disabled})
	if settings.UIDitheringEnabled == nil {
		t.Fatal("UIDitheringEnabled should be populated")
	}
	if *settings.UIDitheringEnabled {
		t.Fatal("UIDitheringEnabled should remain false when explicitly disabled")
	}
}

func TestNormalizeAppSettingsRateMs(t *testing.T) {
	t.Run("public server rate is enforced at minimum 1000ms", func(t *testing.T) {
		settings := normalizeAppSettings(AppSettings{
			MusicBrainzRequestRateMs:  0,
			ListenBrainzRequestRateMs: 500,
		})
		if settings.MusicBrainzRequestRateMs != 1000 {
			t.Fatalf("MusicBrainzRequestRateMs = %d, want 1000", settings.MusicBrainzRequestRateMs)
		}
		if settings.ListenBrainzRequestRateMs != 1000 {
			t.Fatalf("ListenBrainzRequestRateMs = %d, want 1000", settings.ListenBrainzRequestRateMs)
		}
	})

	t.Run("loopback server rate can be below 1000ms", func(t *testing.T) {
		settings := normalizeAppSettings(AppSettings{
			MusicBrainzServerURL:      "http://localhost:5000",
			MusicBrainzRequestRateMs:  1,
			ListenBrainzServerURL:     "http://localhost:6000",
			ListenBrainzRequestRateMs: 1,
		})
		if settings.MusicBrainzRequestRateMs != 1 {
			t.Fatalf("MusicBrainzRequestRateMs = %d, want 1", settings.MusicBrainzRequestRateMs)
		}
		if settings.ListenBrainzRequestRateMs != 1 {
			t.Fatalf("ListenBrainzRequestRateMs = %d, want 1", settings.ListenBrainzRequestRateMs)
		}
	})

	t.Run("private LAN server rate can be below 1000ms", func(t *testing.T) {
		settings := normalizeAppSettings(AppSettings{
			MusicBrainzServerURL:      "http://192.168.1.15:5000",
			MusicBrainzRequestRateMs:  1,
			ListenBrainzServerURL:     "http://10.0.2.7:6000",
			ListenBrainzRequestRateMs: 1,
		})
		if settings.MusicBrainzRequestRateMs != 1 {
			t.Fatalf("MusicBrainzRequestRateMs = %d, want 1", settings.MusicBrainzRequestRateMs)
		}
		if settings.ListenBrainzRequestRateMs != 1 {
			t.Fatalf("ListenBrainzRequestRateMs = %d, want 1", settings.ListenBrainzRequestRateMs)
		}
	})

	t.Run("non-loopback custom server rate is clamped to minimum 1000ms", func(t *testing.T) {
		settings := normalizeAppSettings(AppSettings{
			MusicBrainzServerURL:      "https://mb.example.com",
			MusicBrainzRequestRateMs:  1,
			ListenBrainzServerURL:     "https://lb.example.com",
			ListenBrainzRequestRateMs: 1,
		})
		if settings.MusicBrainzRequestRateMs != 1000 {
			t.Fatalf("MusicBrainzRequestRateMs = %d, want 1000", settings.MusicBrainzRequestRateMs)
		}
		if settings.ListenBrainzRequestRateMs != 1000 {
			t.Fatalf("ListenBrainzRequestRateMs = %d, want 1000", settings.ListenBrainzRequestRateMs)
		}
	})
}

func TestNormalizeScrobbleFilterMode(t *testing.T) {
	testCases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "whitelist is preserved",
			input: "whitelist",
			want:  "whitelist",
		},
		{
			name:  "blacklist is preserved",
			input: "blacklist",
			want:  "blacklist",
		},
		{
			name:  "invalid falls back to blacklist",
			input: "allowlist",
			want:  "blacklist",
		},
		{
			name:  "empty falls back to blacklist",
			input: "",
			want:  "blacklist",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := normalizeScrobbleFilterMode(testCase.input); got != testCase.want {
				t.Fatalf("normalizeScrobbleFilterMode(%q) = %q, want %q", testCase.input, got, testCase.want)
			}
		})
	}
}

func TestNormalizeAppSettingsScrobbleRules(t *testing.T) {
	disabled := false
	settings := normalizeAppSettings(AppSettings{
		LastFmAPIKey:       " api-key ",
		LastFmAPISecret:    " shared-secret ",
		LastFmSessionKey:   " session-key ",
		ScrobblingEnabled:  &disabled,
		ScrobbleFilterMode: "whitelist",
		ScrobbleRules: []ScrobbleRule{
			{Field: scrobbleRuleFieldTrackArtist, Operator: scrobbleRuleOperatorRegex, Value: " /foo/i "},
			{Field: scrobbleRuleFieldTrackArtist, Operator: scrobbleRuleOperatorRegex, Value: "/foo/i"},
			{Field: scrobbleRuleFieldAnyTag, Operator: scrobbleRuleOperatorContains, Value: "  ambient  "},
			{Field: scrobbleRuleFieldAnyTag, Operator: scrobbleRuleOperatorContains, Value: "ambient"},
			{Field: scrobbleRuleFieldTrackLength, Operator: scrobbleRuleOperatorLessThan, Value: "240"},
			{Field: scrobbleRuleFieldTrackLength, Operator: scrobbleRuleOperatorLessThan, Value: "-10"},
		},
	})

	if settings.ScrobbleFilterMode != "whitelist" {
		t.Fatalf("ScrobbleFilterMode = %q, want %q", settings.ScrobbleFilterMode, "whitelist")
	}

	if settings.LastFmAPIKey != "api-key" || settings.LastFmAPISecret != "shared-secret" || settings.LastFmSessionKey != "session-key" {
		t.Fatalf("Last.fm credentials = (%q, %q, %q), want trimmed values", settings.LastFmAPIKey, settings.LastFmAPISecret, settings.LastFmSessionKey)
	}
	if settings.ScrobblingEnabled == nil || *settings.ScrobblingEnabled {
		t.Fatalf("ScrobblingEnabled = %#v, want false", settings.ScrobblingEnabled)
	}

	if len(settings.ScrobbleRules) != 3 {
		t.Fatalf("ScrobbleRules length = %d, want 3", len(settings.ScrobbleRules))
	}

	if settings.ScrobbleRules[0].Field != scrobbleRuleFieldTrackArtist || settings.ScrobbleRules[0].Operator != scrobbleRuleOperatorRegex || settings.ScrobbleRules[0].Value != "/foo/i" {
		t.Fatalf("first ScrobbleRule = %#v, want normalized regex track-artist rule", settings.ScrobbleRules[0])
	}

	if settings.ScrobbleRules[1].Field != scrobbleRuleFieldAnyTag || settings.ScrobbleRules[1].Operator != scrobbleRuleOperatorContains || settings.ScrobbleRules[1].Value != "ambient" {
		t.Fatalf("second ScrobbleRule = %#v, want normalized any-tag rule", settings.ScrobbleRules[1])
	}

	if settings.ScrobbleRules[2].Field != scrobbleRuleFieldTrackLength || settings.ScrobbleRules[2].Operator != scrobbleRuleOperatorLessThan || settings.ScrobbleRules[2].Value != "240" {
		t.Fatalf("third ScrobbleRule = %#v, want normalized track-length rule", settings.ScrobbleRules[2])
	}

	fallback := normalizeAppSettings(AppSettings{ScrobbleFilterMode: ""})
	if fallback.ScrobbleFilterMode != "blacklist" {
		t.Fatalf("default ScrobbleFilterMode = %q, want %q", fallback.ScrobbleFilterMode, "blacklist")
	}
}

func TestNormalizeAppSettingsMigratesLegacyScrobbleFolders(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{
		ScrobbleFilterMode: "blacklist",
		ScrobbleFolders: []string{
			"  C:/Music/Main  ",
			"c:/music/main",
			"",
			"/music/archive",
			"/music/archive/",
		},
	})

	if len(settings.ScrobbleRules) != 2 {
		t.Fatalf("ScrobbleRules length = %d, want 2", len(settings.ScrobbleRules))
	}

	for _, rule := range settings.ScrobbleRules {
		if rule.Field != scrobbleRuleFieldPath {
			t.Fatalf("legacy migrated rule field = %q, want %q", rule.Field, scrobbleRuleFieldPath)
		}

		if rule.Operator != scrobbleRuleOperatorStartsWith {
			t.Fatalf("legacy migrated rule operator = %q, want %q", rule.Operator, scrobbleRuleOperatorStartsWith)
		}

		if rule.Value == "" {
			t.Fatalf("legacy migrated rule value should not be empty: %#v", rule)
		}
	}
}
