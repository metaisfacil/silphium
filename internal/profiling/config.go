package profiling

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHTTPAddr       = "127.0.0.1:6061"
	defaultSampleInterval = time.Second
	defaultMaxBufferSize  = 6000
)

// LoadConfigFromEnv reads profiler configuration from environment variables.
func LoadConfigFromEnv() Config {
	return Config{
		Enabled:           envBool("PROFILER_ENABLED", false),
		SampleInterval:    envDuration("PROFILER_SAMPLE_RATE", defaultSampleInterval),
		MaxBufferSize:     envInt("PROFILER_MAX_BUFFER_SIZE", defaultMaxBufferSize),
		HTTPAddr:          envString("PROFILER_HTTP_ADDR", defaultHTTPAddr),
		ExportPath:        envString("PROFILER_EXPORT_PATH", filepath.Join(os.TempDir(), "profiler-session.jsonl")),
		CPUProfileEnabled: envBool("PROFILER_CPU_ENABLED", false),
	}
}

func envBool(name string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}

	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}

	return parsed
}

func envInt(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(raw)
	if err != nil || parsed <= 0 {
		return fallback
	}

	return parsed
}

func envString(name string, fallback string) string {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}

	return raw
}
