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
	settings := normalizeAppSettings(AppSettings{
		ScrobbleFilterMode: "whitelist",
		ScrobbleFolders: []string{
			"  C:/Music/Main  ",
			"c:/music/main",
			"",
			"/music/archive",
			"/music/archive/",
		},
	})

	if settings.ScrobbleFilterMode != "whitelist" {
		t.Fatalf("ScrobbleFilterMode = %q, want %q", settings.ScrobbleFilterMode, "whitelist")
	}

	if len(settings.ScrobbleFolders) != 2 {
		t.Fatalf("ScrobbleFolders length = %d, want 2", len(settings.ScrobbleFolders))
	}

	if settings.ScrobbleFolders[0] == settings.ScrobbleFolders[1] {
		t.Fatalf("ScrobbleFolders were not deduplicated: %#v", settings.ScrobbleFolders)
	}

	fallback := normalizeAppSettings(AppSettings{ScrobbleFilterMode: ""})
	if fallback.ScrobbleFilterMode != "blacklist" {
		t.Fatalf("default ScrobbleFilterMode = %q, want %q", fallback.ScrobbleFilterMode, "blacklist")
	}
}
