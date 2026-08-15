package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/server"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
)

func setupTestServer(t *testing.T) (*server.Server, *hub.Hub, *simulator.Simulator) {
	h := hub.NewHub(50)
	sim := simulator.New(h)
	srv := server.NewServer(h, sim, nil)
	t.Cleanup(func() {
		h.Close()
		sim.Stop()
	})
	return srv, h, sim
}

func TestServer_RESTEndpoints(t *testing.T) {
	srv, h, sim := setupTestServer(t)

	// 1. Test GET /api/status
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var statusResp map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&statusResp); err != nil {
		t.Fatalf("failed to decode status response: %v", err)
	}
	if statusResp["status"] != "running" {
		t.Errorf("expected status 'running', got %v", statusResp["status"])
	}

	// 2. Test Ingest Event POST /api/events
	evt := events.NewEvent("e-custom-1", "sess-test", events.TypeToolCall, "agent-1", "Custom Tool")
	body, _ := json.Marshal(evt)
	ingestReq := httptest.NewRequest(http.MethodPost, "/api/events", bytes.NewReader(body))
	ingestRec := httptest.NewRecorder()
	srv.ServeHTTP(ingestRec, ingestReq)

	if ingestRec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202 Accepted, got %d", ingestRec.Code)
	}

	// 3. Test GET /api/history
	histReq := httptest.NewRequest(http.MethodGet, "/api/history", nil)
	histRec := httptest.NewRecorder()
	srv.ServeHTTP(histRec, histReq)

	if histRec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", histRec.Code)
	}

	var history []*events.Event
	if err := json.NewDecoder(histRec.Body).Decode(&history); err != nil {
		t.Fatalf("failed to decode history response: %v", err)
	}
	if len(history) != 1 || history[0].ID != "e-custom-1" {
		t.Fatalf("expected 1 history item with ID 'e-custom-1', got %+v", history)
	}

	// 4. Test Simulator controls: Start, Speed, Stop
	sim.SetSpeed(100.0)
	startReq := httptest.NewRequest(http.MethodPost, "/api/simulator/start?loop=false", nil)
	startRec := httptest.NewRecorder()
	srv.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on start, got %d", startRec.Code)
	}

	speedReq := httptest.NewRequest(http.MethodPost, "/api/simulator/speed?multiplier=2.5", nil)
	speedRec := httptest.NewRecorder()
	srv.ServeHTTP(speedRec, speedReq)
	if speedRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on speed, got %d", speedRec.Code)
	}
	if sim.GetSpeed() != 2.5 {
		t.Errorf("expected sim speed 2.5, got %f", sim.GetSpeed())
	}

	stopReq := httptest.NewRequest(http.MethodPost, "/api/simulator/stop", nil)
	stopRec := httptest.NewRecorder()
	srv.ServeHTTP(stopRec, stopReq)
	if stopRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on stop, got %d", stopRec.Code)
	}

	// 5. Test OPTIONS method (CORS)
	optReq := httptest.NewRequest(http.MethodOptions, "/api/status", nil)
	optRec := httptest.NewRecorder()
	srv.ServeHTTP(optRec, optReq)
	if optRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for OPTIONS, got %d", optRec.Code)
	}

	// 6. Test Method Not Allowed
	wrongMethodReq := httptest.NewRequest(http.MethodDelete, "/api/status", nil)
	wrongMethodRec := httptest.NewRecorder()
	srv.ServeHTTP(wrongMethodRec, wrongMethodReq)
	if wrongMethodRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 Method Not Allowed, got %d", wrongMethodRec.Code)
	}

	// 7. Test invalid JSON ingest
	badIngestReq := httptest.NewRequest(http.MethodPost, "/api/events", bytes.NewReader([]byte("{invalid-json")))
	badIngestRec := httptest.NewRecorder()
	srv.ServeHTTP(badIngestRec, badIngestReq)
	if badIngestRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on invalid JSON, got %d", badIngestRec.Code)
	}

	// 8. Test invalid speed multiplier
	badSpeedReq := httptest.NewRequest(http.MethodPost, "/api/simulator/speed?multiplier=-10", nil)
	badSpeedRec := httptest.NewRecorder()
	srv.ServeHTTP(badSpeedRec, badSpeedReq)
	if badSpeedRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on invalid multiplier, got %d", badSpeedRec.Code)
	}
	_ = h
}

func TestServer_StaticFileServing(t *testing.T) {
	tmpDir := t.TempDir()
	testFilePath := filepath.Join(tmpDir, "asset.txt")
	if err := os.WriteFile(testFilePath, []byte("Workshop UI Asset"), 0o600); err != nil {
		t.Fatalf("failed to write test asset file: %v", err)
	}

	h := hub.NewHub(10)
	sim := simulator.New(h)
	defer h.Close()
	defer sim.Stop()

	srv := server.NewServer(h, sim, os.DirFS(tmpDir))

	req := httptest.NewRequest(http.MethodGet, "/asset.txt", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200 for static file, got %d", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("Workshop UI Asset")) {
		t.Fatalf("expected body to contain 'Workshop UI Asset', got: %s", rec.Body.String())
	}
}
