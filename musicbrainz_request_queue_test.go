package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestMusicBrainzRequestQueueAndFetchHelpers(t *testing.T) {
	originalCooldownOverride := musicBrainzRequestCooldownOverrideMs
	originalSemaphoreOverride := musicBrainzRequestSemaphoreOverride
	originalDefaultSemaphore := defaultMusicBrainzRequestSemaphore
	t.Cleanup(func() {
		musicBrainzRequestCooldownOverrideMs = originalCooldownOverride
		musicBrainzRequestSemaphoreOverride = originalSemaphoreOverride
		defaultMusicBrainzRequestSemaphore = originalDefaultSemaphore
	})

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.Header.Get("Accept"); got != "application/json" {
			t.Fatalf("Accept header = %q, want %q", got, "application/json")
		}
		if got := request.Header.Get("User-Agent"); got != musicBrainzUserAgent {
			t.Fatalf("User-Agent header = %q, want %q", got, musicBrainzUserAgent)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"name":"ok"}`))
	}))
	defer server.Close()

	if got := effectiveMusicBrainzRequestCooldownMs(250); got != 250 {
		t.Fatalf("effectiveMusicBrainzRequestCooldownMs() = %d, want %d", got, 250)
	}
	musicBrainzRequestCooldownOverrideMs = 99
	if got := effectiveMusicBrainzRequestCooldownMs(250); got != 99 {
		t.Fatalf("effectiveMusicBrainzRequestCooldownMs(override) = %d, want 99", got)
	}
	musicBrainzRequestCooldownOverrideMs = 0
	if got := effectiveMusicBrainzRequestCooldownMs(0); got != 0 {
		t.Fatalf("effectiveMusicBrainzRequestCooldownMs(0) = %d, want 0", got)
	}
	if got := effectiveMusicBrainzRequestSemaphoreCapacity(); got != 1 {
		t.Fatalf("effectiveMusicBrainzRequestSemaphoreCapacity() = %d, want 1", got)
	}
	musicBrainzRequestSemaphoreOverride = 3
	if got := effectiveMusicBrainzRequestSemaphoreCapacity(); got != 3 {
		t.Fatalf("effectiveMusicBrainzRequestSemaphoreCapacity(override) = %d, want 3", got)
	}
	musicBrainzRequestSemaphoreOverride = 0
	defaultMusicBrainzRequestSemaphore = 0
	if got := effectiveMusicBrainzRequestSemaphoreCapacity(); got != 1 {
		t.Fatalf("effectiveMusicBrainzRequestSemaphoreCapacity(fallback) = %d, want 1", got)
	}
	defaultMusicBrainzRequestSemaphore = 1

	queue := newMusicBrainzRequestQueue()
	if body, ok := queue.do("   ", musicBrainzRequestPriorityInteractive, 0); ok || body != nil {
		t.Fatalf("queue.do(empty) = (%q, %t), want (nil, false)", string(body), ok)
	}
	if body, ok := queue.do(server.URL, musicBrainzRequestPriorityBackground, 0); !ok || string(body) != `{"name":"ok"}` {
		t.Fatalf("queue.do(success) = (%q, %t), want valid JSON body", string(body), ok)
	}

	queued := &musicBrainzRequestQueue{}
	interactiveRequest := &musicBrainzFetchRequest{requestURL: "interactive"}
	backgroundRequest := &musicBrainzFetchRequest{requestURL: "background"}
	queued.interactive = []*musicBrainzFetchRequest{interactiveRequest}
	queued.background = []*musicBrainzFetchRequest{backgroundRequest}
	if popped := queued.popNextLocked(); popped != interactiveRequest {
		t.Fatalf("popNextLocked(interactive) = %#v, want interactive request", popped)
	}
	if popped := queued.popNextLocked(); popped != backgroundRequest {
		t.Fatalf("popNextLocked(background) = %#v, want background request", popped)
	}
	if popped := queued.popNextLocked(); popped != nil {
		t.Fatalf("popNextLocked(empty) = %#v, want nil", popped)
	}

	if body, ok := fetchMusicBrainzJSON(server.URL, 0); !ok || string(body) != `{"name":"ok"}` {
		t.Fatalf("fetchMusicBrainzJSON() = (%q, %t), want valid JSON body", string(body), ok)
	}
	if payload, ok := fetchMusicBrainzPayload(server.URL, 0); !ok || payload["name"] != "ok" {
		t.Fatalf("fetchMusicBrainzPayload() = (%#v, %t), want parsed payload", payload, ok)
	}

	badJSONServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`not-json`))
	}))
	defer badJSONServer.Close()
	if payload, ok := fetchMusicBrainzPayloadWithPriority(badJSONServer.URL, musicBrainzRequestPriorityInteractive, 0); ok || payload != nil {
		t.Fatalf("fetchMusicBrainzPayloadWithPriority(invalid JSON) = (%#v, %t), want (nil, false)", payload, ok)
	}

	if _, ok := fetchMusicBrainzHTTPRequest(":bad-url"); ok {
		t.Fatal("fetchMusicBrainzHTTPRequest(invalid URL) = true, want false")
	}

	statusServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusTeapot)
	}))
	defer statusServer.Close()
	if _, ok := fetchMusicBrainzHTTPRequest(statusServer.URL); ok {
		t.Fatal("fetchMusicBrainzHTTPRequest(non-200) = true, want false")
	}
}

func TestMusicBrainzRequestQueueRateLimitAndHTTPErrorBranches(t *testing.T) {
	originalCooldownOverride := musicBrainzRequestCooldownOverrideMs
	originalSemaphoreOverride := musicBrainzRequestSemaphoreOverride
	originalDefaultSemaphore := defaultMusicBrainzRequestSemaphore
	t.Cleanup(func() {
		musicBrainzRequestCooldownOverrideMs = originalCooldownOverride
		musicBrainzRequestSemaphoreOverride = originalSemaphoreOverride
		defaultMusicBrainzRequestSemaphore = originalDefaultSemaphore
	})

	musicBrainzRequestCooldownOverrideMs = 0
	musicBrainzRequestSemaphoreOverride = 0
	defaultMusicBrainzRequestSemaphore = 1

	var arrivalsMu sync.Mutex
	arrivals := make([]time.Time, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		arrivalsMu.Lock()
		arrivals = append(arrivals, time.Now())
		arrivalsMu.Unlock()
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	queue := newMusicBrainzRequestQueue()
	start := make(chan struct{})
	results := make(chan musicBrainzFetchResult, 2)
	for requestIndex := 0; requestIndex < 2; requestIndex++ {
		go func() {
			<-start
			body, ok := queue.do(server.URL, musicBrainzRequestPriorityBackground, 80)
			results <- musicBrainzFetchResult{body: body, ok: ok}
		}()
	}
	close(start)

	for requestIndex := 0; requestIndex < 2; requestIndex++ {
		result := <-results
		if !result.ok || string(result.body) != `{"ok":true}` {
			t.Fatalf("queue.do(rate limited) = (%q, %t), want valid JSON body", string(result.body), result.ok)
		}
	}

	arrivalsMu.Lock()
	recordedArrivals := append([]time.Time(nil), arrivals...)
	arrivalsMu.Unlock()
	if len(recordedArrivals) != 2 {
		t.Fatalf("recorded arrivals = %d, want 2", len(recordedArrivals))
	}
	if diff := recordedArrivals[1].Sub(recordedArrivals[0]); diff < 40*time.Millisecond {
		t.Fatalf("rate-limited request spacing = %s, want at least 40ms", diff)
	}

	if _, ok := fetchMusicBrainzHTTPRequest("http://127.0.0.1:1"); ok {
		t.Fatal("fetchMusicBrainzHTTPRequest(connect failure) = true, want false")
	}

	brokenListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Listen() error = %v", err)
	}
	brokenDone := make(chan struct{})
	go func() {
		defer close(brokenDone)
		conn, acceptErr := brokenListener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()
		_, _ = conn.Write([]byte("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 10\r\nConnection: close\r\n\r\nabc"))
	}()

	if _, ok := fetchMusicBrainzHTTPRequest("http://" + brokenListener.Addr().String()); ok {
		t.Fatal("fetchMusicBrainzHTTPRequest(short body) = true, want false")
	}
	_ = brokenListener.Close()
	<-brokenDone
}
