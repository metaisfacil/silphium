package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestNormalizeAppSettingsDropsRemoteLibrariesAndSharing(t *testing.T) {
	settings := normalizeAppSettings(AppSettings{
		LibraryFolders: []AppLibraryFolder{
			{Kind: librarySourceKindRemote, Host: " http://Example.com:5005/share ", Port: 0, Label: " Friend ", Password: "remote-pass-01", ReleaseDepth: 7},
			{Kind: librarySourceKindRemote, Path: "silphium-remote://example.com:5005", Label: "Duplicate", PasswordHash: hashNetworkPassword("remote-pass-01"), ReleaseDepth: 1},
		},
		LibrarySharingEnabled:  true,
		LibrarySharingPort:     99999,
		LibrarySharingPassword: "sharing-pass-01",
	})

	if settings.LibrarySharingEnabled {
		t.Fatal("LibrarySharingEnabled = true, want false")
	}
	if settings.LibrarySharingPort != defaultLibrarySharingPort {
		t.Fatalf("LibrarySharingPort = %d, want %d", settings.LibrarySharingPort, defaultLibrarySharingPort)
	}
	if len(settings.LibraryFolders) != 0 {
		t.Fatalf("len(LibraryFolders) = %d, want 0", len(settings.LibraryFolders))
	}
	if settings.LibraryPath != "" {
		t.Fatalf("LibraryPath = %q, want empty after remote folders are discarded", settings.LibraryPath)
	}
}

func TestRemoteLibraryPathHelpers(t *testing.T) {
	host, port, ok := parseRemoteLibraryConnectionInput("http://Example.com:5005/share")
	if !ok || host != "example.com" || port != 5005 {
		t.Fatalf("parseRemoteLibraryConnectionInput() = (%q, %d, %t), want (%q, %d, true)", host, port, ok, "example.com", 5005)
	}

	basePath := buildRemoteLibraryBasePath(host, port)
	if basePath != "silphium-remote://example.com:5005" {
		t.Fatalf("buildRemoteLibraryBasePath() = %q, want %q", basePath, "silphium-remote://example.com:5005")
	}

	trackPath := buildRemoteLibraryPath(basePath, "Shared Root/Album/Track.flac")
	parsedPath, ok := parseRemoteLibraryPath(trackPath)
	if !ok {
		t.Fatalf("parseRemoteLibraryPath(%q) = false, want true", trackPath)
	}
	if parsedPath.Host != "example.com" || parsedPath.Port != 5005 || parsedPath.VirtualPath != "Shared Root/Album/Track.flac" {
		t.Fatalf("parseRemoteLibraryPath(%q) = %#v, want host example.com, port 5005, virtual path Shared Root/Album/Track.flac", trackPath, parsedPath)
	}

	if !pathWithinRoot(buildRemoteLibraryPath(basePath, "Shared Root"), trackPath) {
		t.Fatalf("pathWithinRoot(shared root, %q) = false, want true", trackPath)
	}
	if pathWithinRoot(buildRemoteLibraryPath(basePath, "Other Root"), trackPath) {
		t.Fatalf("pathWithinRoot(other root, %q) = true, want false", trackPath)
	}
	if got := rebaseRemoteDisplayPath("Shared Root/Album/Track.flac", "Shared Root", "Friend"); got != "Friend/Album/Track.flac" {
		t.Fatalf("rebaseRemoteDisplayPath() = %q, want %q", got, "Friend/Album/Track.flac")
	}
}

func TestRemoteLibraryRawFileURLIncludesScopedAccessToken(t *testing.T) {
	authHash := hashNetworkPassword("secret-pass-01")
	plainURL := remoteLibraryRawFileURL("example.com", 41637, "Library/Album/track.flac", authHash, remoteLibraryTranscodeOptions{})
	parsedPlainURL, err := url.Parse(plainURL)
	if err != nil {
		t.Fatalf("url.Parse(plainURL) error = %v", err)
	}
	plainQuery := parsedPlainURL.Query()
	if got := plainQuery.Get(remoteLibraryAuthHashQueryParam); got != "" {
		t.Fatalf("remoteLibraryRawFileURL() auth hash query = %q, want empty", got)
	}
	if got := plainQuery.Get(remoteLibraryRawAccessTokenQueryParam); got == "" {
		t.Fatalf("remoteLibraryRawFileURL() access token query = %q, want non-empty", got)
	}
	if plainQuery.Get(remoteLibraryRawAccessTokenQueryParam) != remoteLibraryRawAccessToken("Library/Album/track.flac", authHash, remoteLibraryTranscodeOptions{}) {
		t.Fatalf("remoteLibraryRawFileURL() access token = %q, want scoped token", plainQuery.Get(remoteLibraryRawAccessTokenQueryParam))
	}
	if strings.Contains(plainURL, "transcode=1") {
		t.Fatalf("remoteLibraryRawFileURL() = %q, should not include transcode when disabled", plainURL)
	}

	transcodeOptions := remoteLibraryTranscodeOptions{Enabled: true, BitrateKbps: 256}
	transcodedURL := remoteLibraryRawFileURL("example.com", 41637, "Library/Album/track.flac", authHash, transcodeOptions)
	parsedTranscodedURL, err := url.Parse(transcodedURL)
	if err != nil {
		t.Fatalf("url.Parse(transcodedURL) error = %v", err)
	}
	transcodedQuery := parsedTranscodedURL.Query()
	if got := transcodedQuery.Get("transcode"); got != "1" {
		t.Fatalf("remoteLibraryRawFileURL() transcode = %q, want 1", got)
	}
	if got := transcodedQuery.Get("bitrateKbps"); got != "256" {
		t.Fatalf("remoteLibraryRawFileURL() bitrateKbps = %q, want 256", got)
	}
	if transcodedQuery.Get(remoteLibraryRawAccessTokenQueryParam) != remoteLibraryRawAccessToken("Library/Album/track.flac", authHash, transcodeOptions) {
		t.Fatalf("remoteLibraryRawFileURL() transcoded access token = %q, want scoped token", transcodedQuery.Get(remoteLibraryRawAccessTokenQueryParam))
	}
}

func TestRemoteLibraryQuerySummaryRedactsSensitiveParams(t *testing.T) {
	query := url.Values{}
	query.Set("path", "Library/Album/track.flac")
	query.Set(remoteLibraryAuthHashQueryParam, hashNetworkPassword("secret-pass-01"))
	query.Set(remoteLibraryRawAccessTokenQueryParam, "scoped-token")

	summary := remoteLibraryQuerySummary(query)
	if strings.Contains(summary, hashNetworkPassword("secret-pass-01")) {
		t.Fatalf("remoteLibraryQuerySummary() = %q, should redact auth hash", summary)
	}
	if strings.Contains(summary, "scoped-token") {
		t.Fatalf("remoteLibraryQuerySummary() = %q, should redact access token", summary)
	}
	parsedSummary, err := url.ParseQuery(summary)
	if err != nil {
		t.Fatalf("url.ParseQuery(summary) error = %v", err)
	}
	if got := parsedSummary.Get(remoteLibraryAuthHashQueryParam); got != "[REDACTED]" {
		t.Fatalf("remoteLibraryQuerySummary() auth hash = %q, want [REDACTED]", got)
	}
	if got := parsedSummary.Get(remoteLibraryRawAccessTokenQueryParam); got != "[REDACTED]" {
		t.Fatalf("remoteLibraryQuerySummary() access token = %q, want [REDACTED]", got)
	}
}
