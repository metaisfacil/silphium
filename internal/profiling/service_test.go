package profiling

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestServiceRecordsBindingMetricsAndRetainsNewestEvents(t *testing.T) {
	service := NewService(Config{
		Enabled:        true,
		SampleInterval: time.Hour,
		MaxBufferSize:  2,
	})

	service.Record(MetricEvent{Timestamp: time.Unix(1, 0), Source: SourceBackend, Type: TypeEvent, Name: "first", Value: 1})
	finish := service.BeginBinding("AudioPlay")
	finish(errors.New("boom"))
	service.Record(MetricEvent{Timestamp: time.Unix(2, 0), Source: SourceBackend, Type: TypeEvent, Name: "last", Value: 3})

	snapshot := service.Snapshot()
	if len(snapshot.Metrics) != 2 {
		t.Fatalf("len(snapshot.Metrics) = %d, want 2", len(snapshot.Metrics))
	}
	if snapshot.Metrics[0].Name == "first" {
		t.Fatal("ring buffer should drop the oldest metric once full")
	}
	if len(snapshot.BindingSummaries) != 1 {
		t.Fatalf("len(snapshot.BindingSummaries) = %d, want 1", len(snapshot.BindingSummaries))
	}
	if snapshot.BindingSummaries[0].Errors != 1 {
		t.Fatalf("binding error count = %d, want 1", snapshot.BindingSummaries[0].Errors)
	}
}

func TestServiceIngestsFrontendBatchAndExportsJSONL(t *testing.T) {
	service := NewService(Config{
		Enabled:        true,
		SampleInterval: time.Hour,
		MaxBufferSize:  8,
	})

	ingested := service.IngestFrontendBatch(FrontendBatch{
		Timestamp: time.Unix(10, 0),
		Events: []MetricEvent{{
			Timestamp: time.Unix(10, 0),
			Type:      TypeRender,
			Name:      "render.fps",
			Value:     58,
		}},
	})
	if ingested != 1 {
		t.Fatalf("IngestFrontendBatch() = %d, want 1", ingested)
	}

	buffer := bytes.Buffer{}
	if err := service.ExportJSONL(&buffer); err != nil {
		t.Fatalf("ExportJSONL() error = %v", err)
	}
	if !strings.Contains(buffer.String(), "render.fps") {
		t.Fatalf("ExportJSONL() = %q, want render metric", buffer.String())
	}

	snapshot := service.Snapshot()
	if snapshot.Session.FrontendBatchCount != 1 {
		t.Fatalf("frontend batch count = %d, want 1", snapshot.Session.FrontendBatchCount)
	}
	if got := snapshot.Metrics[0].Source; got != SourceFrontend {
		t.Fatalf("frontend metric source = %q, want %q", got, SourceFrontend)
	}
}
