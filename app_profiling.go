package main

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	pprofHTTP "net/http/pprof"
	"strings"
	"time"

	"Silphium/internal/profiling"
)

const (
	profilerFrontendBatchEvent  = "silphium:profiler:frontend-batch"
	profilerFrontendReadyEvent  = "silphium:profiler:frontend-ready"
	profilerFrontendConfigEvent = "silphium:profiler:config"
)

var defaultProfilingService = struct {
	service *profiling.Service
}{}

// Profiled wraps a callback with the default profiler service when one is available.
func Profiled(name string, fn func() (any, error)) func() (any, error) {
	service := defaultProfilingService.service
	if service == nil {
		return fn
	}

	return service.Profiled(name, fn)
}

func (a *App) profilerService() *profiling.Service {
	if a == nil {
		return nil
	}

	return a.profilerState().service
}

func (a *App) startProfiler() {
	service := a.profilerService()
	if service == nil || !service.Enabled() {
		return
	}

	defaultProfilingService.service = service
	if err := service.StartSession(); err != nil {
		log.Printf("failed to start profiler session: %v", err)
		return
	}
	a.bindProfilerFrontendEvents()
	a.startProfilerHTTPServer()
}

func (a *App) stopProfiler() {
	state := a.profilerState()
	state.mu.Lock()
	server := state.server
	frontendEventsOff := state.frontendEventsOff
	state.server = nil
	state.httpAddr = ""
	state.frontendEventsOff = nil
	state.mu.Unlock()

	if frontendEventsOff != nil {
		frontendEventsOff()
	}

	if server != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}

	service := a.profilerService()
	if service != nil {
		if err := service.StopSession(); err != nil {
			log.Printf("failed to stop profiler session: %v", err)
		}
	}

	defaultProfilingService.service = nil
}

func (a *App) bindProfilerFrontendEvents() {
	runtimeState := a.runtimeState()
	service := a.profilerService()
	if runtimeState.ctx == nil || service == nil {
		return
	}

	state := a.profilerState()
	state.mu.Lock()
	if state.frontendEventsOff != nil {
		state.mu.Unlock()
		return
	}
	state.mu.Unlock()

	offBatch := runtimeEventsOn(runtimeState.ctx, profilerFrontendBatchEvent, func(optionalData ...interface{}) {
		if len(optionalData) == 0 {
			return
		}
		payload, ok := optionalData[0].(string)
		if !ok || strings.TrimSpace(payload) == "" {
			return
		}

		batch := profiling.FrontendBatch{}
		if err := json.Unmarshal([]byte(payload), &batch); err != nil {
			log.Printf("failed to decode frontend profiler batch: %v", err)
			return
		}
		service.IngestFrontendBatch(batch)
	})

	offReady := runtimeEventsOn(runtimeState.ctx, profilerFrontendReadyEvent, func(...interface{}) {
		emitRuntimeEvent(runtimeState.ctx, profilerFrontendConfigEvent, service.Snapshot().Config)
	})

	state.mu.Lock()
	state.frontendEventsOff = func() {
		offBatch()
		offReady()
	}
	state.mu.Unlock()
}

func (a *App) startProfilerHTTPServer() {
	service := a.profilerService()
	state := a.profilerState()
	if service == nil || !service.Enabled() {
		return
	}

	state.mu.Lock()
	if state.server != nil {
		state.mu.Unlock()
		return
	}
	state.mu.Unlock()

	listener, err := net.Listen("tcp", service.Snapshot().Config.HTTPAddr)
	if err != nil {
		log.Printf("failed to start profiler http listener on %s: %v", service.Snapshot().Config.HTTPAddr, err)
		return
	}

	effectiveAddr := listener.Addr().String()
	service.SetHTTPAddr(effectiveAddr)

	mux := http.NewServeMux()
	mux.HandleFunc("/debug/profiler/snapshot", a.handleProfilerSnapshot)
	mux.HandleFunc("/debug/profiler/export", a.handleProfilerExport)
	mux.HandleFunc("/debug/profiler/stream", a.handleProfilerStream)
	mux.HandleFunc("/debug/profiler/frontend", a.handleProfilerFrontend)
	mux.HandleFunc("/debug/profiler/start", a.handleProfilerStart)
	mux.HandleFunc("/debug/profiler/stop", a.handleProfilerStop)
	mux.HandleFunc("/debug/pprof/", pprofHTTP.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprofHTTP.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprofHTTP.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprofHTTP.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprofHTTP.Trace)

	server := &http.Server{
		Addr:              effectiveAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	state.mu.Lock()
	state.server = server
	state.httpAddr = effectiveAddr
	state.mu.Unlock()

	log.Printf("profiler listening on http://%s/debug/profiler/snapshot", effectiveAddr)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			log.Printf("profiler http server stopped unexpectedly: %v", serveErr)
		}
	}()
}

func (a *App) handleProfilerSnapshot(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	if err := profiling.EncodeSnapshot(writer, a.profilerService().Snapshot()); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
	}
}

func (a *App) handleProfilerExport(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	writer.Header().Set("Content-Type", "application/x-ndjson; charset=utf-8")
	writer.Header().Set("Content-Disposition", "attachment; filename=profiler-session.jsonl")
	if err := a.profilerService().ExportJSONL(writer); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
	}
}

func (a *App) handleProfilerStream(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	flusher, ok := writer.(http.Flusher)
	if !ok {
		http.Error(writer, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.Header().Set("Connection", "keep-alive")

	service := a.profilerService()
	subscriberID, channel := service.Subscribe(512)
	defer service.Unsubscribe(subscriberID)

	_, _ = io.WriteString(writer, ": profiler stream\n\n")
	flusher.Flush()

	keepAliveTicker := time.NewTicker(15 * time.Second)
	defer keepAliveTicker.Stop()

	for {
		select {
		case <-request.Context().Done():
			return
		case <-keepAliveTicker.C:
			_, _ = io.WriteString(writer, ": keepalive\n\n")
			flusher.Flush()
		case event, ok := <-channel:
			if !ok {
				return
			}
			if err := profiling.WriteSSEEvent(writer, event); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (a *App) handleProfilerFrontend(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	reader := request.Body
	defer func() {
		_ = reader.Close()
	}()

	var payloadReader io.Reader = reader
	if strings.EqualFold(strings.TrimSpace(request.Header.Get("Content-Encoding")), "gzip") {
		gzipReader, err := gzip.NewReader(reader)
		if err != nil {
			http.Error(writer, "invalid gzip body", http.StatusBadRequest)
			return
		}
		defer func() {
			_ = gzipReader.Close()
		}()
		payloadReader = gzipReader
	}

	batch, err := profiling.DecodeFrontendBatch(payloadReader)
	if err != nil {
		http.Error(writer, err.Error(), http.StatusBadRequest)
		return
	}

	ingested := a.profilerService().IngestFrontendBatch(batch)
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = fmt.Fprintf(writer, "{\"ingested\":%d}\n", ingested)
}

func (a *App) handleProfilerStart(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := a.profilerService().StartSession(); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = io.WriteString(writer, "{\"active\":true}\n")
}

func (a *App) handleProfilerStop(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := a.profilerService().StopSession(); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = io.WriteString(writer, "{\"active\":false}\n")
}

// ProfilerSnapshot returns the current machine-readable profiler state.
func (a *App) ProfilerSnapshot() profiling.Snapshot {
	if a.profilerService() == nil {
		return profiling.Snapshot{}
	}
	return a.profilerService().Snapshot()
}

// StartProfilerSession starts backend sampling if the profiler is enabled.
func (a *App) StartProfilerSession() bool {
	if a.profilerService() == nil {
		return false
	}
	if err := a.profilerService().StartSession(); err != nil {
		return false
	}
	return true
}

// StopProfilerSession stops backend sampling and flushes active profiler files.
func (a *App) StopProfilerSession() bool {
	if a.profilerService() == nil {
		return false
	}
	if err := a.profilerService().StopSession(); err != nil {
		return false
	}
	return true
}

// GetProfilerHTTPAddress returns the effective profiler debug server address.
func (a *App) GetProfilerHTTPAddress() string {
	state := a.profilerState()
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.httpAddr
}

func profiledResult[T any](app *App, name string, fn func() (T, error)) (result T, err error) {
	finish := beginProfiledBinding(app, name)
	defer func() {
		finish(err)
	}()
	return fn()
}

func profiledValue[T any](app *App, name string, fn func() T) T {
	finish := beginProfiledBinding(app, name)
	defer finish(nil)
	return fn()
}

func profiledVoid(app *App, name string, fn func()) {
	finish := beginProfiledBinding(app, name)
	defer finish(nil)
	fn()
}

func profiledError(app *App, name string, fn func() error) (err error) {
	finish := beginProfiledBinding(app, name)
	defer func() {
		finish(err)
	}()
	return fn()
}

func beginProfiledBinding(app *App, name string) func(error) {
	service := app.profilerService()
	if service == nil {
		return func(error) {}
	}
	return service.BeginBinding(name)
}
