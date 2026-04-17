package profiling

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/metrics"
	pprofRuntime "runtime/pprof"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ringBuffer struct {
	items []MetricEvent
	head  int
	count int
}

func newRingBuffer(size int) ringBuffer {
	if size <= 0 {
		size = defaultMaxBufferSize
	}

	return ringBuffer{items: make([]MetricEvent, size)}
}

func (r *ringBuffer) append(event MetricEvent) {
	if len(r.items) == 0 {
		return
	}

	index := (r.head + r.count) % len(r.items)
	r.items[index] = event
	if r.count < len(r.items) {
		r.count++
		return
	}

	r.head = (r.head + 1) % len(r.items)
}

func (r *ringBuffer) snapshot() []MetricEvent {
	if r.count == 0 {
		return []MetricEvent{}
	}

	result := make([]MetricEvent, 0, r.count)
	for index := 0; index < r.count; index++ {
		result = append(result, r.items[(r.head+index)%len(r.items)])
	}
	return result
}

type bindingAggregate struct {
	name              string
	calls             uint64
	errors            uint64
	currentConcurrent int
	maxConcurrent     int
	lastDuration      time.Duration
	totalDuration     time.Duration
	lastStartedAt     time.Time
	lastCompletedAt   time.Time
}

type backendSample struct {
	at             time.Time
	cpuTotal       float64
	cpuUser        float64
	cpuGC          float64
	mutexWaitTotal float64
	gcPauseTotalNs uint64
	valid          bool
}

// Service manages backend and frontend profiler metrics.
type Service struct {
	mu                   sync.RWMutex
	config               Config
	buff                 ringBuffer
	active               bool
	startedAt            time.Time
	stoppedAt            time.Time
	httpAddr             string
	frontendBatchCount   uint64
	frontendLastIngest   time.Time
	bindings             map[string]*bindingAggregate
	callDepthByGoroutine map[uint64]int
	lastSample           backendSample
	subscribers          map[uint64]chan MetricEvent
	nextSubscriberID     uint64
	stopCh               chan struct{}
	doneCh               chan struct{}
	exportFile           *os.File
	cpuFile              *os.File
}

// NewService creates a profiler service using the provided config.
func NewService(config Config) *Service {
	if config.SampleInterval <= 0 {
		config.SampleInterval = defaultSampleInterval
	}
	if config.MaxBufferSize <= 0 {
		config.MaxBufferSize = defaultMaxBufferSize
	}
	if strings.TrimSpace(config.HTTPAddr) == "" {
		config.HTTPAddr = defaultHTTPAddr
	}
	if strings.TrimSpace(config.ExportPath) == "" {
		config.ExportPath = filepath.Join(os.TempDir(), "profiler-session.jsonl")
	}

	return &Service{
		config:               config,
		buff:                 newRingBuffer(config.MaxBufferSize),
		bindings:             make(map[string]*bindingAggregate),
		callDepthByGoroutine: make(map[uint64]int),
		subscribers:          make(map[uint64]chan MetricEvent),
		httpAddr:             config.HTTPAddr,
	}
}

// Enabled reports whether profiling is enabled by configuration.
func (s *Service) Enabled() bool {
	return s != nil && s.config.Enabled
}

// SetHTTPAddr stores the effective HTTP listener address for snapshot/export metadata.
func (s *Service) SetHTTPAddr(httpAddr string) {
	if s == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.httpAddr = strings.TrimSpace(httpAddr)
}

// StartSession enables background sampling and optional CPU profiling.
func (s *Service) StartSession() error {
	if s == nil || !s.config.Enabled {
		return nil
	}

	s.mu.Lock()
	if s.active {
		s.mu.Unlock()
		return nil
	}

	s.active = true
	s.startedAt = time.Now().UTC()
	s.stoppedAt = time.Time{}
	s.lastSample = backendSample{}
	s.stopCh = make(chan struct{})
	s.doneCh = make(chan struct{})
	stopCh := s.stopCh
	doneCh := s.doneCh
	config := s.config
	s.mu.Unlock()

	if err := s.openExportFile(); err != nil {
		return err
	}
	if config.CPUProfileEnabled {
		if err := s.startCPUProfile(); err != nil {
			return err
		}
	}

	go s.runCollector(stopCh, doneCh, config.SampleInterval)
	return nil
}

// StopSession stops background sampling and flushes profile files.
func (s *Service) StopSession() error {
	if s == nil {
		return nil
	}

	s.mu.Lock()
	if !s.active {
		s.mu.Unlock()
		return nil
	}

	stopCh := s.stopCh
	doneCh := s.doneCh
	s.active = false
	s.stoppedAt = time.Now().UTC()
	s.stopCh = nil
	s.doneCh = nil
	s.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}
	if doneCh != nil {
		<-doneCh
	}

	var stopErr error
	if err := s.stopCPUProfile(); err != nil {
		stopErr = err
	}
	if err := s.closeExportFile(); err != nil && stopErr == nil {
		stopErr = err
	}

	return stopErr
}

// Subscribe registers a new live metric subscriber.
func (s *Service) Subscribe(bufferSize int) (uint64, <-chan MetricEvent) {
	if s == nil {
		return 0, nil
	}
	if bufferSize <= 0 {
		bufferSize = 256
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextSubscriberID++
	id := s.nextSubscriberID
	channel := make(chan MetricEvent, bufferSize)
	s.subscribers[id] = channel
	return id, channel
}

// Unsubscribe removes a live metric subscriber.
func (s *Service) Unsubscribe(id uint64) {
	if s == nil {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	channel, ok := s.subscribers[id]
	if !ok {
		return
	}
	delete(s.subscribers, id)
	close(channel)
}

// Record stores a normalized metric event.
func (s *Service) Record(event MetricEvent) {
	if s == nil || !s.config.Enabled {
		return
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	} else {
		event.Timestamp = event.Timestamp.UTC()
	}
	if strings.TrimSpace(event.Source) == "" {
		event.Source = SourceBackend
	}
	if event.Meta == nil {
		event.Meta = map[string]any{}
	}

	s.mu.Lock()
	s.buff.append(event)
	subscribers := make([]chan MetricEvent, 0, len(s.subscribers))
	for _, subscriber := range s.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	s.mu.Unlock()

	_ = s.writeExportLine(event)
	for _, subscriber := range subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

// IngestFrontendBatch normalizes a frontend metric batch and records it.
func (s *Service) IngestFrontendBatch(batch FrontendBatch) int {
	if s == nil || !s.config.Enabled {
		return 0
	}

	count := 0
	batchTimestamp := batch.Timestamp.UTC()
	if batchTimestamp.IsZero() {
		batchTimestamp = time.Now().UTC()
	}

	for _, event := range batch.Events {
		if event.Timestamp.IsZero() {
			event.Timestamp = batchTimestamp
		}
		event.Source = SourceFrontend
		s.Record(event)
		count++
	}

	s.mu.Lock()
	s.frontendBatchCount++
	s.frontendLastIngest = time.Now().UTC()
	s.mu.Unlock()

	return count
}

// Snapshot returns the complete in-memory profiler state.
func (s *Service) Snapshot() Snapshot {
	if s == nil {
		return Snapshot{}
	}

	s.mu.RLock()
	metricsSnapshot := s.buff.snapshot()
	bindingSummaries := make([]BindingSummary, 0, len(s.bindings))
	for _, aggregate := range s.bindings {
		bindingSummaries = append(bindingSummaries, BindingSummary{
			Name:              aggregate.name,
			Calls:             aggregate.calls,
			Errors:            aggregate.errors,
			CurrentConcurrent: aggregate.currentConcurrent,
			MaxConcurrent:     aggregate.maxConcurrent,
			LastDurationMs:    durationMilliseconds(aggregate.lastDuration),
			TotalDurationMs:   durationMilliseconds(aggregate.totalDuration),
			LastStartedAt:     aggregate.lastStartedAt,
			LastCompletedAt:   aggregate.lastCompletedAt,
		})
	}
	sort.Slice(bindingSummaries, func(i int, j int) bool {
		return bindingSummaries[i].Name < bindingSummaries[j].Name
	})
	session := SessionState{
		Active:               s.active,
		StartedAt:            s.startedAt,
		StoppedAt:            s.stoppedAt,
		HTTPAddr:             s.httpAddr,
		ExportPath:           s.config.ExportPath,
		FrontendBatchCount:   s.frontendBatchCount,
		FrontendLastIngestAt: s.frontendLastIngest,
		MetricCount:          len(metricsSnapshot),
	}
	config := SnapshotConfig{
		Enabled:           s.config.Enabled,
		SampleIntervalMs:  s.config.SampleInterval.Milliseconds(),
		MaxBufferSize:     s.config.MaxBufferSize,
		HTTPAddr:          s.httpAddr,
		ExportPath:        s.config.ExportPath,
		CPUProfileEnabled: s.config.CPUProfileEnabled,
	}
	s.mu.RUnlock()

	return Snapshot{
		GeneratedAt:      time.Now().UTC(),
		Config:           config,
		Session:          session,
		Metrics:          metricsSnapshot,
		BindingSummaries: bindingSummaries,
	}
}

// ExportJSONL writes the current metric buffer as JSONL.
func (s *Service) ExportJSONL(writer io.Writer) error {
	if s == nil {
		return nil
	}

	bufferedWriter := bufio.NewWriter(writer)
	for _, event := range s.Snapshot().Metrics {
		encoded, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if _, err := bufferedWriter.Write(encoded); err != nil {
			return err
		}
		if err := bufferedWriter.WriteByte('\n'); err != nil {
			return err
		}
	}

	return bufferedWriter.Flush()
}

// Profiled wraps a generic callback with binding timing instrumentation.
func (s *Service) Profiled(name string, fn func() (any, error)) func() (any, error) {
	return func() (any, error) {
		finish := s.BeginBinding(name)
		result, err := fn()
		finish(err)
		return result, err
	}
}

// BeginBinding records concurrency and duration for a binding invocation.
func (s *Service) BeginBinding(name string) func(error) {
	if s == nil || !s.config.Enabled {
		return func(error) {}
	}

	startedAt := time.Now().UTC()
	goroutineID := currentGoroutineID()
	startedConcurrent := 0
	skip := false

	s.mu.Lock()
	if goroutineID != 0 {
		depth := s.callDepthByGoroutine[goroutineID]
		s.callDepthByGoroutine[goroutineID] = depth + 1
		if depth > 0 {
			skip = true
		}
	}
	if !skip {
		aggregate := s.bindingAggregate(name)
		aggregate.calls++
		aggregate.currentConcurrent++
		startedConcurrent = aggregate.currentConcurrent
		if aggregate.currentConcurrent > aggregate.maxConcurrent {
			aggregate.maxConcurrent = aggregate.currentConcurrent
		}
		aggregate.lastStartedAt = startedAt
	}
	s.mu.Unlock()

	return func(err error) {
		finishedAt := time.Now().UTC()
		duration := finishedAt.Sub(startedAt)

		s.mu.Lock()
		if goroutineID != 0 {
			depth := s.callDepthByGoroutine[goroutineID] - 1
			if depth <= 0 {
				delete(s.callDepthByGoroutine, goroutineID)
			} else {
				s.callDepthByGoroutine[goroutineID] = depth
			}
		}
		if skip {
			s.mu.Unlock()
			return
		}

		aggregate := s.bindingAggregate(name)
		if err != nil {
			aggregate.errors++
		}
		if aggregate.currentConcurrent > 0 {
			aggregate.currentConcurrent--
		}
		aggregate.lastDuration = duration
		aggregate.totalDuration += duration
		aggregate.lastCompletedAt = finishedAt
		s.mu.Unlock()

		meta := map[string]any{
			"binding":              name,
			"error":                err != nil,
			"concurrentExecutions": startedConcurrent,
		}
		if err != nil {
			meta["errorMessage"] = err.Error()
		}
		s.Record(MetricEvent{
			Timestamp: finishedAt,
			Source:    SourceBackend,
			Type:      TypeMeasure,
			Name:      "binding." + name,
			Value:     durationMilliseconds(duration),
			Meta:      meta,
		})
	}
}

func (s *Service) bindingAggregate(name string) *bindingAggregate {
	aggregate, ok := s.bindings[name]
	if ok {
		return aggregate
	}

	aggregate = &bindingAggregate{name: name}
	s.bindings[name] = aggregate
	return aggregate
}

func (s *Service) runCollector(stopCh <-chan struct{}, doneCh chan<- struct{}, sampleInterval time.Duration) {
	defer close(doneCh)
	if sampleInterval <= 0 {
		sampleInterval = defaultSampleInterval
	}

	s.collectRuntimeMetrics(time.Now().UTC())
	ticker := time.NewTicker(sampleInterval)
	defer ticker.Stop()

	for {
		select {
		case <-stopCh:
			return
		case sampledAt := <-ticker.C:
			s.collectRuntimeMetrics(sampledAt.UTC())
		}
	}
}

func (s *Service) collectRuntimeMetrics(sampledAt time.Time) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	metricNames := []string{
		"/cpu/classes/total:cpu-seconds",
		"/cpu/classes/user:cpu-seconds",
		"/cpu/classes/gc/total:cpu-seconds",
		"/sync/mutex/wait/total:seconds",
		"/sched/latencies:seconds",
	}
	samples := make([]metrics.Sample, 0, len(metricNames))
	for _, name := range metricNames {
		samples = append(samples, metrics.Sample{Name: name})
	}
	metrics.Read(samples)

	current := backendSample{
		at:             sampledAt,
		cpuTotal:       sampleFloat64(samples[0]),
		cpuUser:        sampleFloat64(samples[1]),
		cpuGC:          sampleFloat64(samples[2]),
		mutexWaitTotal: sampleFloat64(samples[3]),
		gcPauseTotalNs: mem.PauseTotalNs,
		valid:          true,
	}

	metaBase := map[string]any{
		"heapObjects": mem.HeapObjects,
		"gcCount":     mem.NumGC,
	}
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeEvent, Name: "runtime.goroutines", Value: float64(runtime.NumGoroutine())})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeMemory, Name: "memory.heap_alloc_bytes", Value: float64(mem.HeapAlloc), Meta: metaBase})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeMemory, Name: "memory.heap_sys_bytes", Value: float64(mem.HeapSys)})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeMemory, Name: "memory.stack_inuse_bytes", Value: float64(mem.StackInuse)})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeMemory, Name: "gc.pause_total_ms", Value: float64(mem.PauseTotalNs) / float64(time.Millisecond)})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeEvent, Name: "sched.latency_p95_ms", Value: histogramQuantileMilliseconds(sampleHistogram(samples[4]), 0.95)})

	s.mu.Lock()
	lastSample := s.lastSample
	s.lastSample = current
	s.mu.Unlock()

	if !lastSample.valid {
		return
	}

	wallSeconds := sampledAt.Sub(lastSample.at).Seconds()
	if wallSeconds <= 0 {
		return
	}

	cpuPercent := ((current.cpuTotal - lastSample.cpuTotal) / wallSeconds) * 100
	if cpuPercent < 0 {
		cpuPercent = 0
	}
	mutexWaitMs := (current.mutexWaitTotal - lastSample.mutexWaitTotal) * 1000
	if mutexWaitMs < 0 {
		mutexWaitMs = 0
	}
	gcPauseDeltaMs := float64(current.gcPauseTotalNs-lastSample.gcPauseTotalNs) / float64(time.Millisecond)
	if gcPauseDeltaMs < 0 {
		gcPauseDeltaMs = 0
	}

	s.Record(MetricEvent{
		Timestamp: sampledAt,
		Source:    SourceBackend,
		Type:      TypeCPU,
		Name:      "process.cpu_percent",
		Value:     cpuPercent,
		Meta: map[string]any{
			"userCPUSeconds": current.cpuUser - lastSample.cpuUser,
			"gcCPUSeconds":   current.cpuGC - lastSample.cpuGC,
			"gomaxprocs":     runtime.GOMAXPROCS(0),
		},
	})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeEvent, Name: "blocking.mutex_wait_ms", Value: mutexWaitMs})
	s.Record(MetricEvent{Timestamp: sampledAt, Source: SourceBackend, Type: TypeMemory, Name: "gc.pause_delta_ms", Value: gcPauseDeltaMs})
}

func (s *Service) openExportFile() error {
	s.mu.Lock()
	path := s.config.ExportPath
	alreadyOpen := s.exportFile != nil
	s.mu.Unlock()
	if alreadyOpen || strings.TrimSpace(path) == "" {
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.exportFile = file
	s.mu.Unlock()
	return nil
}

func (s *Service) closeExportFile() error {
	s.mu.Lock()
	file := s.exportFile
	s.exportFile = nil
	s.mu.Unlock()
	if file == nil {
		return nil
	}
	return file.Close()
}

func (s *Service) writeExportLine(event MetricEvent) error {
	s.mu.RLock()
	file := s.exportFile
	s.mu.RUnlock()
	if file == nil {
		return nil
	}

	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := file.Write(encoded); err != nil {
		return err
	}
	if _, err := file.Write([]byte("\n")); err != nil {
		return err
	}
	return nil
}

func (s *Service) startCPUProfile() error {
	s.mu.Lock()
	if s.cpuFile != nil {
		s.mu.Unlock()
		return nil
	}
	profilePath := strings.TrimSuffix(s.config.ExportPath, filepath.Ext(s.config.ExportPath)) + ".cpu.pprof"
	s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(profilePath), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(profilePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if err := pprofRuntime.StartCPUProfile(file); err != nil {
		_ = file.Close()
		return err
	}

	s.mu.Lock()
	s.cpuFile = file
	s.mu.Unlock()
	return nil
}

func (s *Service) stopCPUProfile() error {
	s.mu.Lock()
	file := s.cpuFile
	s.cpuFile = nil
	s.mu.Unlock()
	if file == nil {
		return nil
	}

	pprofRuntime.StopCPUProfile()
	return file.Close()
}

func sampleFloat64(sample metrics.Sample) float64 {
	if sample.Value.Kind() != metrics.KindFloat64 {
		return 0
	}
	return sample.Value.Float64()
}

func sampleHistogram(sample metrics.Sample) *metrics.Float64Histogram {
	if sample.Value.Kind() != metrics.KindFloat64Histogram {
		return nil
	}
	return sample.Value.Float64Histogram()
}

func histogramQuantileMilliseconds(histogram *metrics.Float64Histogram, quantile float64) float64 {
	if histogram == nil || len(histogram.Counts) == 0 || len(histogram.Buckets) == 0 {
		return 0
	}

	total := uint64(0)
	for _, count := range histogram.Counts {
		total += count
	}
	if total == 0 {
		return 0
	}

	target := uint64(float64(total) * quantile)
	if target == 0 {
		target = 1
	}
	seen := uint64(0)
	for index, count := range histogram.Counts {
		seen += count
		if seen >= target {
			bucketUpper := histogram.Buckets[min(index+1, len(histogram.Buckets)-1)]
			if bucketUpper < 0 {
				return 0
			}
			return bucketUpper * 1000
		}
	}

	return histogram.Buckets[len(histogram.Buckets)-1] * 1000
}

func durationMilliseconds(value time.Duration) float64 {
	return float64(value) / float64(time.Millisecond)
}

func currentGoroutineID() uint64 {
	buffer := make([]byte, 64)
	count := runtime.Stack(buffer, false)
	buffer = bytes.TrimPrefix(buffer[:count], []byte("goroutine "))
	spaceIndex := bytes.IndexByte(buffer, ' ')
	if spaceIndex <= 0 {
		return 0
	}

	parsed, err := strconv.ParseUint(string(buffer[:spaceIndex]), 10, 64)
	if err != nil {
		return 0
	}

	return parsed
}

// DecodeFrontendBatch parses a request body into a frontend batch payload.
func DecodeFrontendBatch(reader io.Reader) (FrontendBatch, error) {
	batch := FrontendBatch{}
	if err := json.NewDecoder(reader).Decode(&batch); err != nil {
		return FrontendBatch{}, err
	}
	if len(batch.Events) == 0 {
		return FrontendBatch{}, errors.New("frontend batch did not include events")
	}
	return batch, nil
}

// EncodeSnapshot writes the full profiler snapshot to a writer.
func EncodeSnapshot(writer io.Writer, snapshot Snapshot) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(snapshot)
}

// WriteSSEEvent writes a single metric event using Server-Sent Events framing.
func WriteSSEEvent(writer io.Writer, event MetricEvent) error {
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(writer, "event: metric\ndata: %s\n\n", encoded); err != nil {
		return err
	}
	return nil
}
