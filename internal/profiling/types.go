package profiling

import "time"

// Normalized profiler sources and metric types shared across backend and frontend events.
const (
	SourceBackend  = "backend"
	SourceFrontend = "frontend"

	TypeCPU      = "cpu"
	TypeMemory   = "memory"
	TypeRender   = "render"
	TypeEvent    = "event"
	TypeMeasure  = "measure"
	TypeLongTask = "longtask"
)

// MetricEvent is the normalized profiler payload emitted by backend and frontend collectors.
type MetricEvent struct {
	Timestamp time.Time      `json:"timestamp"`
	Source    string         `json:"source"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	Value     float64        `json:"value"`
	Meta      map[string]any `json:"meta,omitempty"`
}

// FrontendBatch is the HTTP payload sent by the frontend profiling agent.
type FrontendBatch struct {
	Timestamp time.Time     `json:"timestamp"`
	Sequence  int64         `json:"sequence,omitempty"`
	Events    []MetricEvent `json:"events"`
}

// Config controls profiler activation and retention.
type Config struct {
	Enabled           bool
	SampleInterval    time.Duration
	MaxBufferSize     int
	HTTPAddr          string
	ExportPath        string
	CPUProfileEnabled bool
}

// SnapshotConfig is the machine-readable config returned from the snapshot endpoint.
type SnapshotConfig struct {
	Enabled           bool   `json:"enabled"`
	SampleIntervalMs  int64  `json:"sampleIntervalMs"`
	MaxBufferSize     int    `json:"maxBufferSize"`
	HTTPAddr          string `json:"httpAddr"`
	ExportPath        string `json:"exportPath"`
	CPUProfileEnabled bool   `json:"cpuProfileEnabled"`
}

// BindingSummary aggregates timing and error data for one Wails binding.
type BindingSummary struct {
	Name              string    `json:"name"`
	Calls             uint64    `json:"calls"`
	Errors            uint64    `json:"errors"`
	CurrentConcurrent int       `json:"currentConcurrent"`
	MaxConcurrent     int       `json:"maxConcurrent"`
	LastDurationMs    float64   `json:"lastDurationMs"`
	TotalDurationMs   float64   `json:"totalDurationMs"`
	LastStartedAt     time.Time `json:"lastStartedAt,omitempty"`
	LastCompletedAt   time.Time `json:"lastCompletedAt,omitempty"`
}

// SessionState exposes the live state of the profiler runtime.
type SessionState struct {
	Active               bool      `json:"active"`
	StartedAt            time.Time `json:"startedAt,omitempty"`
	StoppedAt            time.Time `json:"stoppedAt,omitempty"`
	HTTPAddr             string    `json:"httpAddr"`
	ExportPath           string    `json:"exportPath"`
	FrontendBatchCount   uint64    `json:"frontendBatchCount"`
	FrontendLastIngestAt time.Time `json:"frontendLastIngestAt,omitempty"`
	MetricCount          int       `json:"metricCount"`
}

// Snapshot is the full profiler API response used by HTTP and automation clients.
type Snapshot struct {
	GeneratedAt      time.Time        `json:"generatedAt"`
	Config           SnapshotConfig   `json:"config"`
	Session          SessionState     `json:"session"`
	Metrics          []MetricEvent    `json:"metrics"`
	BindingSummaries []BindingSummary `json:"bindingSummaries"`
}
