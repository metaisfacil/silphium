package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"Silphium/internal/profiling"
)

func TestProfilerFrontendHandlerAndSnapshot(t *testing.T) {
	app := NewApp()
	app.profilerState().service = profiling.NewService(profiling.Config{
		Enabled:        true,
		SampleInterval: time.Hour,
		MaxBufferSize:  16,
	})

	body := bytes.NewBufferString(`{"timestamp":"2026-04-17T00:00:00Z","events":[{"timestamp":"2026-04-17T00:00:00Z","source":"frontend","type":"render","name":"render.fps","value":60}]}`)
	request := httptest.NewRequest(http.MethodPost, "/debug/profiler/frontend", body)
	response := httptest.NewRecorder()
	app.handleProfilerFrontend(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("frontend handler status = %d, want 200", response.Code)
	}

	snapshotRequest := httptest.NewRequest(http.MethodGet, "/debug/profiler/snapshot", nil)
	snapshotResponse := httptest.NewRecorder()
	app.handleProfilerSnapshot(snapshotResponse, snapshotRequest)

	if snapshotResponse.Code != http.StatusOK {
		t.Fatalf("snapshot handler status = %d, want 200", snapshotResponse.Code)
	}

	var snapshot profiling.Snapshot
	if err := json.Unmarshal(snapshotResponse.Body.Bytes(), &snapshot); err != nil {
		t.Fatalf("snapshot decode error = %v", err)
	}
	if len(snapshot.Metrics) != 1 {
		t.Fatalf("len(snapshot.Metrics) = %d, want 1", len(snapshot.Metrics))
	}
	if snapshot.Metrics[0].Name != "render.fps" {
		t.Fatalf("snapshot metric name = %q, want render.fps", snapshot.Metrics[0].Name)
	}
}
