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

func TestMusicBrainzRateLimit(t *testing.T) {
	testCases := []struct {
		name          string
		serverURL     string
		wantRateLimit bool
	}{
		{
			name:          "empty URL defaults to public server (rate limited)",
			serverURL:     "",
			wantRateLimit: true,
		},
		{
			name:          "public server URL is rate limited",
			serverURL:     "https://musicbrainz.org",
			wantRateLimit: true,
		},
		{
			name:          "public server URL case-insensitive match is rate limited",
			serverURL:     "HTTPS://MUSICBRAINZ.ORG",
			wantRateLimit: true,
		},
		{
			name:          "local server URL is not rate limited",
			serverURL:     "http://localhost:5000",
			wantRateLimit: false,
		},
		{
			name:          "custom server URL is not rate limited",
			serverURL:     "https://mb.example.com",
			wantRateLimit: false,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			app := &App{
				settings:       AppSettings{MusicBrainzServerURL: testCase.serverURL},
				settingsLoaded: true,
			}
			got := app.musicBrainzRateLimit()
			if got != testCase.wantRateLimit {
				t.Fatalf("musicBrainzRateLimit() = %v, want %v (serverURL=%q)", got, testCase.wantRateLimit, testCase.serverURL)
			}
		})
	}
}

func TestListenBrainzRateLimit(t *testing.T) {
	testCases := []struct {
		name          string
		serverURL     string
		wantRateLimit bool
	}{
		{
			name:          "empty URL defaults to public server (rate limited)",
			serverURL:     "",
			wantRateLimit: true,
		},
		{
			name:          "public server URL is rate limited",
			serverURL:     "https://api.listenbrainz.org",
			wantRateLimit: true,
		},
		{
			name:          "public server URL case-insensitive match is rate limited",
			serverURL:     "HTTPS://API.LISTENBRAINZ.ORG",
			wantRateLimit: true,
		},
		{
			name:          "local server URL is not rate limited",
			serverURL:     "http://localhost:6000",
			wantRateLimit: false,
		},
		{
			name:          "custom server URL is not rate limited",
			serverURL:     "https://lb.example.com",
			wantRateLimit: false,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			app := &App{
				settings:       AppSettings{ListenBrainzServerURL: testCase.serverURL},
				settingsLoaded: true,
			}
			got := app.listenBrainzRateLimit()
			if got != testCase.wantRateLimit {
				t.Fatalf("listenBrainzRateLimit() = %v, want %v (serverURL=%q)", got, testCase.wantRateLimit, testCase.serverURL)
			}
		})
	}
}
