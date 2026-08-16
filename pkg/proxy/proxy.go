package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// TelemetryMetric represents captured LLM telemetry from proxied HTTP/HTTPS calls.
type TelemetryMetric struct {
	Timestamp        int64          `json:"timestamp"`
	Host             string         `json:"host"`
	Path             string         `json:"path"`
	Method           string         `json:"method"`
	Model            string         `json:"model,omitempty"`
	PromptTokens     int64          `json:"promptTokens,omitempty"`
	CompletionTokens int64          `json:"completionTokens,omitempty"`
	TotalTokens      int64          `json:"totalTokens,omitempty"`
	DurationMs       int64          `json:"durationMs"`
	StatusCode       int            `json:"statusCode"`
	Headers          map[string]any `json:"headers,omitempty"`
}

// TelemetryHandler is a callback invoked whenever an AI API call telemetry is intercepted.
type TelemetryHandler func(metric *TelemetryMetric)

// Server is a built-in lightweight HTTP/HTTPS proxy that extracts telemetry from AI APIs.
type Server struct {
	mu         sync.RWMutex
	addr       string
	httpServer *http.Server
	handler    TelemetryHandler
	transport  http.RoundTripper
	running    bool
}

// NewServer creates a new telemetry proxy server.
func NewServer(addr string, handler TelemetryHandler) *Server {
	if addr == "" {
		addr = "127.0.0.1:9099"
	}
	return &Server{
		addr:      addr,
		handler:   handler,
		transport: http.DefaultTransport,
	}
}

// Addr returns the configured listening address.
func (s *Server) Addr() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.addr
}

// Start starts listening on the configured address.
func (s *Server) Start() error {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return fmt.Errorf("proxy server already running")
	}

	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("failed to listen on %s: %w", s.addr, err)
	}
	s.addr = listener.Addr().String()

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleProxy)

	s.httpServer = &http.Server{
		Handler:      mux,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
	}
	s.running = true
	s.mu.Unlock()

	go func() {
		_ = s.httpServer.Serve(listener)
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	return nil
}

// Stop gracefully shuts down the proxy server.
func (s *Server) Stop(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running || s.httpServer == nil {
		return nil
	}
	s.running = false
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) handleProxy(w http.ResponseWriter, req *http.Request) {
	if req.Method == http.MethodConnect {
		s.handleConnect(w, req)
		return
	}
	s.handleHTTP(w, req)
}

func (s *Server) handleConnect(w http.ResponseWriter, req *http.Request) {
	destConn, err := net.DialTimeout("tcp", req.Host, 10*time.Second)
	if err != nil {
		http.Error(w, fmt.Sprintf("CONNECT destination dial failed: %v", err), http.StatusServiceUnavailable)
		return
	}
	defer destConn.Close()

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "Hijacking not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	defer clientConn.Close()

	_, _ = clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	// Pipe bidirectionally
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(destConn, clientConn)
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(clientConn, destConn)
	}()
	wg.Wait()

	if s.handler != nil {
		s.handler(&TelemetryMetric{
			Timestamp:  time.Now().UnixMilli(),
			Host:       req.Host,
			Method:     "CONNECT",
			StatusCode: 200,
		})
	}
}

func (s *Server) handleHTTP(w http.ResponseWriter, req *http.Request) {
	startTime := time.Now()

	// Clone request
	outReq := req.Clone(req.Context())
	outReq.RequestURI = ""

	var reqBodyBytes []byte
	if req.Body != nil {
		reqBodyBytes, _ = io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewReader(reqBodyBytes))
		outReq.Body = io.NopCloser(bytes.NewReader(reqBodyBytes))
	}

	resp, err := s.transport.RoundTrip(outReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("Proxy roundtrip failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	respBodyBytes, _ := io.ReadAll(resp.Body)
	durationMs := time.Since(startTime).Milliseconds()

	// Copy headers to client
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(respBodyBytes)

	// Extract telemetry
	if s.handler != nil {
		metric := &TelemetryMetric{
			Timestamp:  time.Now().UnixMilli(),
			Host:       req.Host,
			Path:       req.URL.Path,
			Method:     req.Method,
			StatusCode: resp.StatusCode,
			DurationMs: durationMs,
			Headers:    make(map[string]any),
		}

		// Check headers
		if val := resp.Header.Get("openai-processing-ms"); val != "" {
			metric.Headers["openai-processing-ms"] = val
		}
		if val := resp.Header.Get("anthropic-tokens"); val != "" {
			metric.Headers["anthropic-tokens"] = val
		}

		// Try parsing JSON usage from request or response
		if len(reqBodyBytes) > 0 {
			var reqJSON map[string]any
			if err := json.Unmarshal(reqBodyBytes, &reqJSON); err == nil {
				if m, ok := reqJSON["model"].(string); ok && m != "" {
					metric.Model = m
				}
			}
		}

		if len(respBodyBytes) > 0 {
			var respJSON map[string]any
			if err := json.Unmarshal(respBodyBytes, &respJSON); err == nil {
				if m, ok := respJSON["model"].(string); ok && m != "" {
					metric.Model = m
				}
				if usage, ok := respJSON["usage"].(map[string]any); ok {
					if pt, ok := usage["prompt_tokens"].(float64); ok {
						metric.PromptTokens = int64(pt)
					}
					if ct, ok := usage["completion_tokens"].(float64); ok {
						metric.CompletionTokens = int64(ct)
					}
					if tt, ok := usage["total_tokens"].(float64); ok {
						metric.TotalTokens = int64(tt)
					}
				}
			}
		}

		s.handler(metric)
	}
}
