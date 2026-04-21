package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"
)

const internalCoverArtPath = "/internal/cover"

// InternalCoverArtConfig provides the loopback endpoint details used by the frontend.
type InternalCoverArtConfig struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

func newInternalCoverArtToken() string {
	tokenBytes := make([]byte, 16)
	if _, err := rand.Read(tokenBytes); err != nil {
		return ""
	}

	return hex.EncodeToString(tokenBytes)
}

func internalCoverArtRemoteAllowed(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err != nil {
		host = strings.TrimSpace(remoteAddr)
	}
	if host == "" {
		return false
	}

	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}

	return strings.EqualFold(host, "localhost")
}

func (a *App) internalCoverArtConfigLocked() InternalCoverArtConfig {
	state := a.internalCoverArtState()
	return InternalCoverArtConfig{
		BaseURL: strings.TrimSpace(state.baseURL),
		Token:   strings.TrimSpace(state.token),
	}
}

func (a *App) internalCoverArtConfig() InternalCoverArtConfig {
	state := a.internalCoverArtState()
	state.mu.Lock()
	defer state.mu.Unlock()

	return a.internalCoverArtConfigLocked()
}

// GetInternalCoverArtConfig returns the runtime loopback endpoint details used for direct cover image URLs.
func (a *App) GetInternalCoverArtConfig() InternalCoverArtConfig {
	return profiledValue(a, "GetInternalCoverArtConfig", func() InternalCoverArtConfig {
		return a.internalCoverArtConfig()
	})
}

func (a *App) syncInternalCoverArtServer() {
	state := a.internalCoverArtState()
	state.mu.Lock()
	defer state.mu.Unlock()

	if state.server != nil && strings.TrimSpace(state.baseURL) != "" && strings.TrimSpace(state.token) != "" {
		return
	}

	a.stopInternalCoverArtServerLocked()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Printf("failed to start internal cover art server: %v", err)
		return
	}

	token := newInternalCoverArtToken()
	if token == "" {
		_ = listener.Close()
		log.Printf("failed to create internal cover art token")
		return
	}

	server := &http.Server{
		Handler:           a.newInternalCoverArtServeMux(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	state.server = server
	state.baseURL = "http://" + listener.Addr().String()
	state.token = token

	go func(activeServer *http.Server, activeListener net.Listener) {
		if err := activeServer.Serve(activeListener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("internal cover art server failed on %s: %v", activeListener.Addr().String(), err)
			state := a.internalCoverArtState()
			state.mu.Lock()
			if state.server == activeServer {
				state.server = nil
				state.baseURL = ""
				state.token = ""
			}
			state.mu.Unlock()
		}
	}(server, listener)
}

func (a *App) stopInternalCoverArtServerLocked() {
	state := a.internalCoverArtState()
	server := state.server
	state.server = nil
	state.baseURL = ""
	state.token = ""
	if server == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("failed to stop internal cover art server: %v", err)
	}
}

func (a *App) stopInternalCoverArtServer() {
	state := a.internalCoverArtState()
	state.mu.Lock()
	defer state.mu.Unlock()

	a.stopInternalCoverArtServerLocked()
}

func (a *App) newInternalCoverArtServeMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc(internalCoverArtPath, a.handleInternalCoverArt)
	return mux
}

func (a *App) resolveCoverArtBytes(folderPath string, absoluteTrackPath string, requestedSize int) ([]byte, string, bool) {
	if folderPath != "" {
		coverPath := a.GetLibraryFolderCoverPath(folderPath)
		if strings.TrimSpace(coverPath) == "" {
			return nil, "", false
		}

		if requestedSize > 0 {
			thumbnailBytes, mimeType, ok := a.readImageThumbnailBytes(coverPath, requestedSize)
			if ok {
				return thumbnailBytes, mimeType, true
			}
		}

		rawBytes, ok := a.readLibraryFileBytes(coverPath)
		if !ok {
			return nil, "", false
		}

		return rawBytes, openSubsonicContentType(coverPath), true
	}

	if requestedSize > 0 {
		thumbnailBytes, mimeType, ok := a.readTrackEmbeddedCoverThumbnailBytes(absoluteTrackPath, requestedSize)
		if ok {
			return thumbnailBytes, mimeType, true
		}
	}

	return a.readTrackEmbeddedCoverBytes(absoluteTrackPath)
}

func (a *App) resolveInternalCoverArtSource(requestedID string) (string, string, bool) {
	decodedID, kind, ok := openSubsonicDecodeIDWithAliases(
		requestedID,
		openSubsonicIDKindFolderCover,
		openSubsonicIDKindTrackCover,
	)
	if !ok {
		return a.openSubsonicResolveCoverArtSource(nil, requestedID)
	}

	switch kind {
	case openSubsonicIDKindFolderCover:
		if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(decodedID)); coverPath != "" {
			return decodedID, "", true
		}
		return "", "", false
	case openSubsonicIDKindTrackCover:
		absoluteTrackPath, ok := a.openSubsonicResolveTrackPath(a.openSubsonicLocalRootsSnapshot(), decodedID)
		if !ok {
			return "", "", false
		}

		if folderPath := strings.TrimSpace(a.ResolveLibraryFolderForPath(absoluteTrackPath)); folderPath != "" {
			if coverPath := strings.TrimSpace(a.GetLibraryFolderCoverPath(folderPath)); coverPath != "" {
				return folderPath, "", true
			}
		}

		return "", absoluteTrackPath, true
	default:
		return a.openSubsonicResolveCoverArtSource(nil, requestedID)
	}
}

func (a *App) handleInternalCoverArt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Private-Network", "true")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !internalCoverArtRemoteAllowed(r.RemoteAddr) {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}

	config := a.internalCoverArtConfig()
	providedToken := strings.TrimSpace(r.URL.Query().Get("token"))
	if strings.TrimSpace(config.Token) == "" || subtle.ConstantTimeCompare([]byte(config.Token), []byte(providedToken)) != 1 {
		http.Error(w, http.StatusText(http.StatusUnauthorized), http.StatusUnauthorized)
		return
	}

	requestedID := strings.TrimSpace(r.URL.Query().Get("id"))
	if requestedID == "" {
		http.NotFound(w, r)
		return
	}

	requestedSize := openSubsonicRequestedSize(r.URL.Query())
	folderPath, absoluteTrackPath, ok := a.resolveInternalCoverArtSource(requestedID)
	if !ok {
		http.NotFound(w, r)
		return
	}

	coverBytes, mimeType, ok := a.resolveCoverArtBytes(folderPath, absoluteTrackPath, requestedSize)
	if !ok {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method != http.MethodHead {
		_, _ = w.Write(coverBytes)
	}
}
