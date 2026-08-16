package proxy_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/proxy"
)

func TestProxy_HTTPForwardAndTelemetry(t *testing.T) {
	// Mock upstream LLM API server
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("openai-processing-ms", "420")
		w.Header().Set("anthropic-tokens", "input=1500,output=250")

		resp := map[string]any{
			"model": "gpt-5.6-terra",
			"usage": map[string]any{
				"prompt_tokens":     1500,
				"completion_tokens": 250,
				"total_tokens":      1750,
			},
			"choices": []any{
				map[string]any{"message": map[string]any{"content": "Hello from model"}},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer upstream.Close()

	var capturedMetric *proxy.TelemetryMetric
	var mu sync.Mutex

	// Start local proxy server
	p := proxy.NewServer("127.0.0.1:0", func(m *proxy.TelemetryMetric) {
		mu.Lock()
		capturedMetric = m
		mu.Unlock()
	})

	if err := p.Start(); err != nil {
		t.Fatalf("failed to start proxy: %v", err)
	}
	defer func() {
		_ = p.Stop(context.Background())
	}()

	proxyURL, err := url.Parse("http://" + p.Addr())
	if err != nil {
		t.Fatalf("failed to parse proxy addr: %v", err)
	}

	client := &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyURL(proxyURL),
		},
		Timeout: 5 * time.Second,
	}

	reqBody := `{"model":"gpt-5.6-terra","messages":[{"role":"user","content":"Hi"}]}`
	req, err := http.NewRequest(http.MethodPost, upstream.URL+"/v1/chat/completions", bytes.NewBufferString(reqBody))
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("client.Do through proxy failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(body, []byte("gpt-5.6-terra")) {
		t.Errorf("unexpected body: %s", string(body))
	}

	mu.Lock()
	metric := capturedMetric
	mu.Unlock()

	if metric == nil {
		t.Fatalf("expected telemetry metric to be captured")
	}

	if metric.Model != "gpt-5.6-terra" {
		t.Errorf("expected model gpt-5.6-terra, got %q", metric.Model)
	}
	if metric.PromptTokens != 1500 {
		t.Errorf("expected prompt_tokens 1500, got %d", metric.PromptTokens)
	}
	if metric.CompletionTokens != 250 {
		t.Errorf("expected completion_tokens 250, got %d", metric.CompletionTokens)
	}
	if metric.TotalTokens != 1750 {
		t.Errorf("expected total_tokens 1750, got %d", metric.TotalTokens)
	}
	if metric.Headers["openai-processing-ms"] != "420" {
		t.Errorf("expected header openai-processing-ms 420, got %v", metric.Headers["openai-processing-ms"])
	}
}

func TestProxy_LifecycleAndConcurrency(t *testing.T) {
	p := proxy.NewServer("127.0.0.1:0", nil)
	if err := p.Start(); err != nil {
		t.Fatalf("failed to start proxy: %v", err)
	}

	// Starting twice should error
	if err := p.Start(); err == nil {
		t.Errorf("expected error when starting already running proxy")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := p.Stop(ctx); err != nil {
		t.Errorf("Stop failed: %v", err)
	}

	// Stopping again should be a no-op
	if err := p.Stop(ctx); err != nil {
		t.Errorf("second Stop failed: %v", err)
	}
}
