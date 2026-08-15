package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/autodiscover"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/intervention"
	"github.com/zhenya/copilot-visualizer/pkg/recorder"
	"github.com/zhenya/copilot-visualizer/pkg/server"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
)

func setupTestServer(t *testing.T) (*server.Server, *hub.Hub, *simulator.Simulator, *intervention.Manager, *recorder.Recorder) {
	tempDir := t.TempDir()
	h := hub.NewHub(50)
	sim := simulator.New(h)
	eng := autodiscover.NewEngineWithWatchPaths(h, nil)
	interv := intervention.NewManager(h)
	rec, _ := recorder.New(tempDir)
	srv := server.NewServer(h, sim, eng, interv, rec, nil)
	t.Cleanup(func() {
		h.Close()
		sim.Stop()
	})
	return srv, h, sim, interv, rec
}

func TestServer_RESTEndpoints(t *testing.T) {
	srv, h, sim, interv, rec := setupTestServer(t)

	// 1. Test GET /api/status
	req := httptest.NewRequest(http.MethodGet, "/api/status", nil)
	recRes := httptest.NewRecorder()
	srv.ServeHTTP(recRes, req)

	if recRes.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recRes.Code)
	}

	var statusResp map[string]any
	if err := json.NewDecoder(recRes.Body).Decode(&statusResp); err != nil {
		t.Fatalf("failed to decode status response: %v", err)
	}
	if statusResp["status"] != "running" {
		t.Errorf("expected status 'running', got %v", statusResp["status"])
	}

	// 2. Test GET /api/sessions
	sessReq := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	sessRec := httptest.NewRecorder()
	srv.ServeHTTP(sessRec, sessReq)
	if sessRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on /api/sessions, got %d", sessRec.Code)
	}

	// 3. Test Ingest Event POST /api/events
	evt := events.NewEvent("e-custom-1", "sess-test", events.TypeToolCall, "agent-1", "Custom Tool")
	body, _ := json.Marshal(evt)
	ingestReq := httptest.NewRequest(http.MethodPost, "/api/events", bytes.NewReader(body))
	ingestRec := httptest.NewRecorder()
	srv.ServeHTTP(ingestRec, ingestReq)

	if ingestRec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202 Accepted, got %d", ingestRec.Code)
	}

	// 4. Test GET /api/history
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

	// 5. Test Tape Endpoints: Current, Save, List, Load
	currTapeReq := httptest.NewRequest(http.MethodGet, "/api/tape/current", nil)
	currTapeRec := httptest.NewRecorder()
	srv.ServeHTTP(currTapeRec, currTapeReq)
	if currTapeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/tape/current, got %d", currTapeRec.Code)
	}

	saveTapeReq := httptest.NewRequest(http.MethodPost, "/api/tape/save", nil)
	saveTapeRec := httptest.NewRecorder()
	srv.ServeHTTP(saveTapeRec, saveTapeReq)
	if saveTapeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/tape/save, got %d", saveTapeRec.Code)
	}

	var savedMeta recorder.TapeMeta
	_ = json.NewDecoder(saveTapeRec.Body).Decode(&savedMeta)

	listTapeReq := httptest.NewRequest(http.MethodGet, "/api/tape/list", nil)
	listTapeRec := httptest.NewRecorder()
	srv.ServeHTTP(listTapeRec, listTapeReq)
	if listTapeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/tape/list, got %d", listTapeRec.Code)
	}

	loadTapeReq := httptest.NewRequest(http.MethodGet, "/api/tape/load?id="+savedMeta.ID, nil)
	loadTapeRec := httptest.NewRecorder()
	srv.ServeHTTP(loadTapeRec, loadTapeReq)
	if loadTapeRec.Code != http.StatusOK {
		t.Fatalf("expected 200 on /api/tape/load, got %d", loadTapeRec.Code)
	}

	// 6. Test Simulator controls: Start, Speed, Stop
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

	// 7. Test Intervention: Emergency Stop
	estopReq := httptest.NewRequest(http.MethodPost, "/api/intervention/emergency-stop", bytes.NewReader([]byte(`{"active":true,"reason":"Manual halt"}`)))
	estopRec := httptest.NewRecorder()
	srv.ServeHTTP(estopRec, estopReq)
	if estopRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on emergency stop, got %d", estopRec.Code)
	}
	if !interv.IsEmergencyStopActive() {
		t.Fatalf("expected emergency stop to be active")
	}

	// 8. Test Intervention: Intercom
	intercomReq := httptest.NewRequest(http.MethodPost, "/api/intervention/intercom", bytes.NewReader([]byte(`{"sessionId":"sess-1","message":"Speed up tests"}`)))
	intercomRec := httptest.NewRecorder()
	srv.ServeHTTP(intercomRec, intercomReq)
	if intercomRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on intercom, got %d", intercomRec.Code)
	}

	// 9. Test Intervention: Checkpoint request and response
	cp, _ := interv.RequestCheckpoint("sess-1", "run_command", "git push", nil)
	decisionReq := httptest.NewRequest(http.MethodPost, "/api/intervention/checkpoint/respond", bytes.NewReader([]byte(`{"checkpointId":"`+cp.ID+`","decision":"APPROVED","feedback":"Looks good"}`)))
	decisionRec := httptest.NewRecorder()
	srv.ServeHTTP(decisionRec, decisionReq)
	if decisionRec.Code != http.StatusOK {
		t.Fatalf("expected status 200 on checkpoint response, got %d", decisionRec.Code)
	}

	// 10. Test OPTIONS method (CORS)
	optReq := httptest.NewRequest(http.MethodOptions, "/api/status", nil)
	optRec := httptest.NewRecorder()
	srv.ServeHTTP(optRec, optReq)
	if optRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for OPTIONS, got %d", optRec.Code)
	}

	_ = h
	_ = rec
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

	srv := server.NewServer(h, sim, nil, nil, nil, os.DirFS(tmpDir))

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
