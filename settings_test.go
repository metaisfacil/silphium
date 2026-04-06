package main

import "testing"

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
			name:             "trailing slash is removed",
			musicBrainzServerURL:  "https://musicbrainz.org/",
			listenBrainzServerURL: "https://api.listenbrainz.org/",
			wantMusicBrainz:  "https://musicbrainz.org",
			wantListenBrainz: "https://api.listenbrainz.org",
		},
		{
			name:             "local server URLs preserved",
			musicBrainzServerURL:  "http://localhost:5000",
			listenBrainzServerURL: "http://localhost:6000",
			wantMusicBrainz:  "http://localhost:5000",
			wantListenBrainz: "http://localhost:6000",
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
			name:      "custom URL: zero is allowed (no rate limit)",
			rateMs:    0,
			serverURL: "http://localhost:5000",
			want:      0,
		},
		{
			name:      "custom URL: negative is clamped to zero",
			rateMs:    -1,
			serverURL: "http://localhost:5000",
			want:      0,
		},
		{
			name:      "custom URL: positive value is preserved",
			rateMs:    250,
			serverURL: "https://mb.example.com",
			want:      250,
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
			name:      "custom URL: zero is allowed (no rate limit)",
			rateMs:    0,
			serverURL: "http://localhost:6000",
			want:      0,
		},
		{
			name:      "custom URL: negative is clamped to zero",
			rateMs:    -1,
			serverURL: "http://localhost:6000",
			want:      0,
		},
		{
			name:      "custom URL: positive value is preserved",
			rateMs:    250,
			serverURL: "https://lb.example.com",
			want:      250,
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

	t.Run("custom server rate is preserved as-is (including zero)", func(t *testing.T) {
		settings := normalizeAppSettings(AppSettings{
			MusicBrainzServerURL:      "http://localhost:5000",
			MusicBrainzRequestRateMs:  0,
			ListenBrainzServerURL:     "http://localhost:6000",
			ListenBrainzRequestRateMs: 250,
		})
		if settings.MusicBrainzRequestRateMs != 0 {
			t.Fatalf("MusicBrainzRequestRateMs = %d, want 0", settings.MusicBrainzRequestRateMs)
		}
		if settings.ListenBrainzRequestRateMs != 250 {
			t.Fatalf("ListenBrainzRequestRateMs = %d, want 250", settings.ListenBrainzRequestRateMs)
		}
	})
}
