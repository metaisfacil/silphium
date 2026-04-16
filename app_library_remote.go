package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
)

const remoteLibraryPathScheme = "silphium-remote://"
const remoteLibraryShareRawFilePath = "/silphium/share/raw"
const remoteLibraryAuthHashQueryParam = "authHash"
const remoteLibraryRawAccessTokenQueryParam = "accessToken"
const defaultLibrarySharingPort = 41637
const librarySourceKindLocal = "local"
const librarySourceKindRemote = "remote"
const remoteLibraryTranscodeConcurrencyLimit = 2

type remoteLibraryPath struct {
	Host        string
	Port        int
	VirtualPath string
}

type remoteLibraryTranscodeOptions struct {
	Enabled     bool
	BitrateKbps int
}

var remoteLibraryTranscodeSemaphore = make(chan struct{}, remoteLibraryTranscodeConcurrencyLimit)

func tryAcquireRemoteLibraryTranscodeSlot() bool {
	select {
	case remoteLibraryTranscodeSemaphore <- struct{}{}:
		return true
	default:
		return false
	}
}

func releaseRemoteLibraryTranscodeSlot() {
	select {
	case <-remoteLibraryTranscodeSemaphore:
	default:
	}
}

func redactedRemoteLibraryQueryValues(query url.Values) url.Values {
	if len(query) == 0 {
		return nil
	}

	redacted := url.Values{}
	for key, values := range query {
		switch strings.ToLower(strings.TrimSpace(key)) {
		case strings.ToLower(remoteLibraryAuthHashQueryParam), strings.ToLower(remoteLibraryRawAccessTokenQueryParam):
			redacted.Set(key, "[REDACTED]")
		default:
			redacted[key] = append([]string(nil), values...)
		}
	}

	return redacted
}

func remoteLibraryQuerySummary(query url.Values) string {
	if len(query) == 0 {
		return "none"
	}

	return redactedRemoteLibraryQueryValues(query).Encode()
}

func normalizeRemoteLibraryHost(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if parsed, err := url.Parse(trimmed); err == nil && strings.TrimSpace(parsed.Host) != "" {
		trimmed = parsed.Hostname()
	}

	if strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]") {
		trimmed = strings.TrimPrefix(strings.TrimSuffix(trimmed, "]"), "[")
	}

	if host, _, err := net.SplitHostPort(trimmed); err == nil {
		trimmed = host
	}

	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" || strings.ContainsAny(trimmed, " /?#&") {
		return ""
	}

	if parsedIP := net.ParseIP(trimmed); parsedIP != nil {
		return parsedIP.String()
	}

	return strings.ToLower(trimmed)
}

func parseRemoteLibraryConnectionInput(value string) (string, int, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", 0, false
	}

	withScheme := trimmed
	if parsed, err := url.Parse(trimmed); err == nil && strings.TrimSpace(parsed.Host) != "" {
		host := normalizeRemoteLibraryHost(parsed.Hostname())
		if host == "" {
			return "", 0, false
		}

		if strings.TrimSpace(parsed.Port()) == "" {
			return host, 0, true
		}

		port, err := strconv.Atoi(strings.TrimSpace(parsed.Port()))
		if err != nil || port <= 0 || port > 65535 {
			return host, 0, true
		}

		return host, port, true
	}

	if !strings.Contains(withScheme, "://") {
		withScheme = remoteLibraryPathScheme + trimmed
	}

	parsed, err := url.Parse(withScheme)
	if err != nil {
		return "", 0, false
	}

	host := normalizeRemoteLibraryHost(parsed.Hostname())
	if host == "" {
		return "", 0, false
	}

	if strings.TrimSpace(parsed.Port()) == "" {
		return host, 0, true
	}

	port, err := strconv.Atoi(strings.TrimSpace(parsed.Port()))
	if err != nil || port <= 0 || port > 65535 {
		return host, 0, true
	}

	return host, port, true
}

func normalizeLibrarySharingPort(value int) int {
	if value <= 0 || value > 65535 {
		return defaultLibrarySharingPort
	}

	return value
}

func buildRemoteLibraryBasePath(host string, port int) string {
	normalizedHost := normalizeRemoteLibraryHost(host)
	if normalizedHost == "" {
		return ""
	}

	normalizedPort := normalizeLibrarySharingPort(port)
	return remoteLibraryPathScheme + net.JoinHostPort(normalizedHost, strconv.Itoa(normalizedPort))
}

func splitRemoteLibraryHostPort(value string) (string, int, bool) {
	host, portText, err := net.SplitHostPort(strings.TrimSpace(value))
	if err != nil {
		return "", 0, false
	}

	normalizedHost := normalizeRemoteLibraryHost(host)
	if normalizedHost == "" {
		return "", 0, false
	}

	port, err := strconv.Atoi(strings.TrimSpace(portText))
	if err != nil || port <= 0 || port > 65535 {
		return "", 0, false
	}

	return normalizedHost, port, true
}

func parseRemoteLibraryBasePath(path string) (string, int, bool) {
	trimmed := strings.TrimSpace(path)
	if !strings.HasPrefix(strings.ToLower(trimmed), remoteLibraryPathScheme) {
		return "", 0, false
	}

	rest := trimmed[len(remoteLibraryPathScheme):]
	if rest == "" {
		return "", 0, false
	}

	hostPort := rest
	if slash := strings.Index(hostPort, "/"); slash >= 0 {
		hostPort = hostPort[:slash]
	}

	return splitRemoteLibraryHostPort(hostPort)
}

func normalizeRemoteLibraryBasePath(path string) (string, bool) {
	host, port, ok := parseRemoteLibraryBasePath(path)
	if !ok {
		return "", false
	}

	return buildRemoteLibraryBasePath(host, port), true
}

func isRemoteLibraryBasePath(path string) bool {
	_, _, ok := parseRemoteLibraryBasePath(path)
	return ok
}

func parseRemoteLibraryPath(path string) (remoteLibraryPath, bool) {
	trimmed := strings.TrimSpace(path)
	if !strings.HasPrefix(strings.ToLower(trimmed), remoteLibraryPathScheme) {
		return remoteLibraryPath{}, false
	}

	rest := trimmed[len(remoteLibraryPathScheme):]
	if rest == "" {
		return remoteLibraryPath{}, false
	}

	hostPort := rest
	virtualPath := ""
	if slash := strings.Index(rest, "/"); slash >= 0 {
		hostPort = rest[:slash]
		virtualPath = rest[slash+1:]
	}

	host, port, ok := splitRemoteLibraryHostPort(hostPort)
	if !ok {
		return remoteLibraryPath{}, false
	}

	normalizedVirtualPath, ok := normalizeLibraryRelativePath(virtualPath)
	if !ok {
		return remoteLibraryPath{}, false
	}

	return remoteLibraryPath{Host: host, Port: port, VirtualPath: normalizedVirtualPath}, true
}

func buildRemoteLibraryPath(basePath string, virtualPath string) string {
	normalizedBasePath, ok := normalizeRemoteLibraryBasePath(basePath)
	if !ok {
		return ""
	}

	normalizedVirtualPath, ok := normalizeLibraryRelativePath(virtualPath)
	if !ok || normalizedVirtualPath == "" {
		return normalizedBasePath
	}

	return normalizedBasePath + "/" + normalizedVirtualPath
}

func remoteLibraryBaseURL(host string, port int) string {
	return "http://" + net.JoinHostPort(host, strconv.Itoa(port))
}

func remoteLibraryRawAccessToken(virtualPath string, authHash string, transcodeOptions remoteLibraryTranscodeOptions) string {
	normalizedAuthHash := normalizeNetworkPasswordHash(authHash)
	normalizedVirtualPath, ok := normalizeLibraryRelativePath(virtualPath)
	if normalizedAuthHash == "" || !ok || normalizedVirtualPath == "" {
		return ""
	}

	normalizedTranscodeOptions := remoteLibraryTranscodeOptions{}
	if transcodeOptions.Enabled {
		normalizedTranscodeOptions.Enabled = true
		normalizedTranscodeOptions.BitrateKbps = normalizeRemoteLibraryTranscodingBitrateKbps(transcodeOptions.BitrateKbps)
	}

	mac := hmac.New(sha256.New, []byte(normalizedAuthHash))
	_, _ = io.WriteString(mac, normalizedVirtualPath)
	if normalizedTranscodeOptions.Enabled {
		_, _ = io.WriteString(mac, "\ntranscode=1")
		_, _ = io.WriteString(mac, "\nbitrateKbps="+strconv.Itoa(normalizedTranscodeOptions.BitrateKbps))
	} else {
		_, _ = io.WriteString(mac, "\ntranscode=0")
		_, _ = io.WriteString(mac, "\nbitrateKbps=0")
	}

	return hex.EncodeToString(mac.Sum(nil))
}

func remoteLibraryRawFileURL(host string, port int, virtualPath string, authHash string, transcodeOptions remoteLibraryTranscodeOptions) string {
	normalizedVirtualPath, ok := normalizeLibraryRelativePath(virtualPath)
	if !ok {
		normalizedVirtualPath = strings.TrimSpace(virtualPath)
	}

	values := url.Values{}
	values.Set("path", normalizedVirtualPath)
	if accessToken := remoteLibraryRawAccessToken(normalizedVirtualPath, authHash, transcodeOptions); accessToken != "" {
		values.Set(remoteLibraryRawAccessTokenQueryParam, accessToken)
	}
	if transcodeOptions.Enabled {
		values.Set("transcode", "1")
		values.Set("bitrateKbps", strconv.Itoa(normalizeRemoteLibraryTranscodingBitrateKbps(transcodeOptions.BitrateKbps)))
	}

	return remoteLibraryBaseURL(host, port) + remoteLibraryShareRawFilePath + "?" + values.Encode()
}

func isRemoteLibraryPath(path string) bool {
	_, ok := parseRemoteLibraryPath(path)
	return ok
}

func partitionConfiguredLibraryFolders(folders []AppLibraryFolder) ([]AppLibraryFolder, []AppLibraryFolder) {
	localFolders := make([]AppLibraryFolder, 0, len(folders))
	remoteFolders := make([]AppLibraryFolder, 0, len(folders))
	for _, folder := range folders {
		if normalizeLibraryFolderKind(folder.Kind) == librarySourceKindRemote {
			remoteFolders = append(remoteFolders, folder)
			continue
		}

		localFolders = append(localFolders, folder)
	}

	return localFolders, remoteFolders
}

func rebaseRemoteDisplayPath(path string, remoteRootName string, localRootName string) string {
	trimmedPath := strings.TrimSpace(path)
	trimmedRemoteRootName := strings.TrimSpace(remoteRootName)
	trimmedLocalRootName := strings.TrimSpace(localRootName)
	if trimmedPath == "" || trimmedRemoteRootName == "" || trimmedLocalRootName == "" {
		return trimmedPath
	}

	if trimmedPath == trimmedRemoteRootName {
		return trimmedLocalRootName
	}

	prefix := trimmedRemoteRootName + "/"
	if strings.HasPrefix(trimmedPath, prefix) {
		return trimmedLocalRootName + "/" + strings.TrimPrefix(trimmedPath, prefix)
	}

	return trimmedPath
}
