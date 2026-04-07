package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

type musicBrainzRequestPriority int

const (
	musicBrainzRequestPriorityBackground musicBrainzRequestPriority = iota
	musicBrainzRequestPriorityInteractive
)

var (
	// Global backend override for MBZ queue cooldown in milliseconds.
	// Keep at 0 to use the configured per-request rate limit.
	musicBrainzRequestCooldownOverrideMs = 0
	// Global backend override for MBZ request semaphore capacity.
	// Keep at 0 to use the default scheduler capacity.
	musicBrainzRequestSemaphoreOverride = 0
	defaultMusicBrainzRequestSemaphore  = 1
)

type musicBrainzFetchResult struct {
	body []byte
	ok   bool
}

type musicBrainzFetchRequest struct {
	requestURL  string
	rateLimitMs int
	result      chan musicBrainzFetchResult
}

type musicBrainzRequestQueue struct {
	mu          sync.Mutex
	cond        *sync.Cond
	interactive []*musicBrainzFetchRequest
	background  []*musicBrainzFetchRequest
	semaphore   chan struct{}
}

var defaultMusicBrainzRequestQueue = newMusicBrainzRequestQueue()

func newMusicBrainzRequestQueue() *musicBrainzRequestQueue {
	queue := &musicBrainzRequestQueue{
		semaphore: make(chan struct{}, effectiveMusicBrainzRequestSemaphoreCapacity()),
	}
	queue.cond = sync.NewCond(&queue.mu)
	for i := 0; i < cap(queue.semaphore); i++ {
		queue.semaphore <- struct{}{}
	}
	go queue.run()
	return queue
}

func (q *musicBrainzRequestQueue) do(requestURL string, priority musicBrainzRequestPriority, rateLimitMs int) ([]byte, bool) {
	cleanRequestURL := strings.TrimSpace(requestURL)
	if cleanRequestURL == "" {
		return nil, false
	}

	request := &musicBrainzFetchRequest{
		requestURL:  cleanRequestURL,
		rateLimitMs: rateLimitMs,
		result:      make(chan musicBrainzFetchResult, 1),
	}

	q.mu.Lock()
	if priority == musicBrainzRequestPriorityInteractive {
		q.interactive = append(q.interactive, request)
	} else {
		q.background = append(q.background, request)
	}
	q.cond.Signal()
	q.mu.Unlock()

	result := <-request.result
	return result.body, result.ok
}

func (q *musicBrainzRequestQueue) run() {
	nextAllowedAt := time.Time{}

	for {
		q.mu.Lock()
		for len(q.interactive) == 0 && len(q.background) == 0 {
			q.cond.Wait()
		}
		q.mu.Unlock()

		now := time.Now()
		if !nextAllowedAt.IsZero() && now.Before(nextAllowedAt) {
			time.Sleep(nextAllowedAt.Sub(now))
		}

		q.mu.Lock()
		request := q.popNextLocked()
		q.mu.Unlock()
		if request == nil {
			continue
		}

		<-q.semaphore
		go func(activeRequest *musicBrainzFetchRequest) {
			defer func() {
				q.semaphore <- struct{}{}
			}()

			responseBody, ok := fetchMusicBrainzHTTPRequest(activeRequest.requestURL)
			activeRequest.result <- musicBrainzFetchResult{body: responseBody, ok: ok}
			close(activeRequest.result)
		}(request)

		effectiveCooldownMs := effectiveMusicBrainzRequestCooldownMs(request.rateLimitMs)
		if effectiveCooldownMs > 0 {
			nextAllowedAt = time.Now().Add(time.Duration(effectiveCooldownMs) * time.Millisecond)
		} else {
			nextAllowedAt = time.Time{}
		}
	}
}

func effectiveMusicBrainzRequestCooldownMs(configuredRateLimitMs int) int {
	if musicBrainzRequestCooldownOverrideMs >= 1 {
		return musicBrainzRequestCooldownOverrideMs
	}

	if configuredRateLimitMs >= 1 {
		return configuredRateLimitMs
	}

	return 0
}

func effectiveMusicBrainzRequestSemaphoreCapacity() int {
	if musicBrainzRequestSemaphoreOverride >= 1 {
		return musicBrainzRequestSemaphoreOverride
	}

	if defaultMusicBrainzRequestSemaphore >= 1 {
		return defaultMusicBrainzRequestSemaphore
	}

	return 1
}

func (q *musicBrainzRequestQueue) popNextLocked() *musicBrainzFetchRequest {
	if len(q.interactive) > 0 {
		request := q.interactive[0]
		q.interactive = q.interactive[1:]
		return request
	}

	if len(q.background) > 0 {
		request := q.background[0]
		q.background = q.background[1:]
		return request
	}

	return nil
}

func fetchMusicBrainzJSONWithPriority(requestURL string, priority musicBrainzRequestPriority, rateLimitMs int) ([]byte, bool) {
	return defaultMusicBrainzRequestQueue.do(requestURL, priority, rateLimitMs)
}

func fetchMusicBrainzPayloadWithPriority(requestURL string, priority musicBrainzRequestPriority, rateLimitMs int) (map[string]any, bool) {
	responseBody, ok := fetchMusicBrainzJSONWithPriority(requestURL, priority, rateLimitMs)
	if !ok {
		return nil, false
	}

	payload := make(map[string]any)
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, false
	}

	return payload, true
}

func fetchMusicBrainzHTTPRequest(requestURL string) ([]byte, bool) {
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, false
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", musicBrainzUserAgent)

	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, false
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, false
	}

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, false
	}

	return responseBody, true
}
