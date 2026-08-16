package server

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"strconv"

	"github.com/zhenya/copilot-visualizer/pkg/autodiscover"
	"github.com/zhenya/copilot-visualizer/pkg/copilotstore"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/intervention"
	"github.com/zhenya/copilot-visualizer/pkg/recorder"
	"github.com/zhenya/copilot-visualizer/pkg/repotree"
	"github.com/zhenya/copilot-visualizer/pkg/sessionstore"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
)

// Server coordinates the visualizer HTTP and WebSocket services.
type Server struct {
	hub          *hub.Hub
	simulator    *simulator.Simulator
	engine       *autodiscover.Engine
	intervention *intervention.Manager
	recorder     *recorder.Recorder
	sessionStore *sessionstore.Store
	copilotStore *copilotstore.Reader
	mux          *http.ServeMux
	staticFS     fs.FS
}

// NewServer initializes the server dependencies and registers HTTP routes.
func NewServer(
	h *hub.Hub,
	sim *simulator.Simulator,
	engine *autodiscover.Engine,
	interv *intervention.Manager,
	rec *recorder.Recorder,
	store *sessionstore.Store,
	staticFS fs.FS,
) *Server {
	s := &Server{
		hub:          h,
		simulator:    sim,
		engine:       engine,
		intervention: interv,
		recorder:     rec,
		sessionStore: store,
		copilotStore: copilotstore.NewReader(""),
		mux:          http.NewServeMux(),
		staticFS:     staticFS,
	}
	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("/ws", s.hub.HandleWebSocket)
	s.mux.HandleFunc("/api/status", s.handleStatus)
	s.mux.HandleFunc("/api/history", s.handleHistory)
	s.mux.HandleFunc("/api/events", s.handleIngestEvent)
	s.mux.HandleFunc("/api/sessions", s.handleSessions)
	s.mux.HandleFunc("/api/sessions/attach", s.handleSessionAttach)
	s.mux.HandleFunc("/api/sessions/state", s.handleSessionState)
	s.mux.HandleFunc("/api/copilot/usage", s.handleCopilotUsage)
	s.mux.HandleFunc("/api/simulator/start", s.handleSimStart)
	s.mux.HandleFunc("/api/simulator/stop", s.handleSimStop)
	s.mux.HandleFunc("/api/simulator/speed", s.handleSimSpeed)

	// Intervention routes
	s.mux.HandleFunc("/api/intervention/emergency-stop", s.handleEmergencyStop)
	s.mux.HandleFunc("/api/intervention/intercom", s.handleIntercom)
	s.mux.HandleFunc("/api/intervention/checkpoints", s.handleCheckpoints)
	s.mux.HandleFunc("/api/intervention/checkpoint/respond", s.handleCheckpointDecision)

	// Time-Travel Tape routes
	s.mux.HandleFunc("/api/tape/list", s.handleTapeList)
	s.mux.HandleFunc("/api/tape/load", s.handleTapeLoad)
	s.mux.HandleFunc("/api/tape/save", s.handleTapeSave)
	s.mux.HandleFunc("/api/tape/current", s.handleTapeCurrent)

	// Repo Tree scanner
	s.mux.HandleFunc("/api/repo-tree", s.handleRepoTree)

	if s.staticFS != nil {
		fileServer := http.FileServer(http.FS(s.staticFS))
		s.mux.Handle("/", fileServer)
	}
}

// ServeHTTP delegates to the internal ServeMux.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	var emergencyStop bool
	if s.intervention != nil {
		emergencyStop = s.intervention.IsEmergencyStopActive()
	}

	resp := map[string]any{
		"status":          "running",
		"clientsCount":    s.hub.ClientCount(),
		"eventsCount":     len(s.hub.History()),
		"simulatorActive": s.simulator.IsRunning(),
		"simulatorSpeed":  s.simulator.GetSpeed(),
		"emergencyStop":   emergencyStop,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	var sessions []autodiscover.DiscoveredSession
	if s.engine != nil {
		sessions = s.engine.ScanSessions()
	}
	_ = json.NewEncoder(w).Encode(sessions)
}

func (s *Server) handleSessionAttach(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("id")
	if sessionID == "" {
		sessionID = r.URL.Query().Get("sessionId")
	}
	if sessionID == "" {
		http.Error(w, "Session ID parameter required", http.StatusBadRequest)
		return
	}

	if s.engine != nil {
		if err := s.engine.AttachSession(sessionID); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "attached", "sessionId": sessionID})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := r.URL.Query().Get("sessionId")
	if sessionID == "" {
		sessionID = r.URL.Query().Get("id")
	}

	w.Header().Set("Content-Type", "application/json")
	if sessionID != "" && sessionID != "global" {
		if s.engine != nil {
			if fileEvents := s.engine.GetSessionEvents(sessionID); len(fileEvents) > 0 {
				_ = json.NewEncoder(w).Encode(fileEvents)
				return
			}
		}
		_ = json.NewEncoder(w).Encode(s.hub.HistoryForSession(sessionID))
		return
	}
	_ = json.NewEncoder(w).Encode(s.hub.History())
}

func (s *Server) handleIngestEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var evt events.Event
	if err := json.NewDecoder(r.Body).Decode(&evt); err != nil {
		http.Error(w, "Invalid event JSON", http.StatusBadRequest)
		return
	}

	if s.recorder != nil {
		s.recorder.RecordEvent(&evt)
	}

	if err := s.hub.BroadcastEvent(&evt); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "id": evt.ID})
}

func (s *Server) handleTapeList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if s.recorder == nil {
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}

	tapes, err := s.recorder.ListTapes()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(tapes)
}

func (s *Server) handleTapeLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	tapeID := r.URL.Query().Get("id")
	if tapeID == "" {
		http.Error(w, "Tape ID parameter is required", http.StatusBadRequest)
		return
	}

	if s.recorder == nil {
		http.Error(w, "Recorder not initialized", http.StatusInternalServerError)
		return
	}

	tape, err := s.recorder.LoadTape(tapeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(tape)
}

func (s *Server) handleTapeSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	if s.recorder == nil {
		http.Error(w, "Recorder not initialized", http.StatusInternalServerError)
		return
	}

	meta, err := s.recorder.SaveCurrentTape()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(meta)
}

func (s *Server) handleTapeCurrent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if s.recorder == nil {
		_ = json.NewEncoder(w).Encode(nil)
		return
	}

	tape := s.recorder.GetCurrentTape()
	_ = json.NewEncoder(w).Encode(tape)
}

func (s *Server) handleEmergencyStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Active bool   `json:"active"`
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if s.intervention != nil {
		_ = s.intervention.SetEmergencyStop(req.Active, req.Reason)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"active": req.Active})
}

func (s *Server) handleIntercom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SessionID string `json:"sessionId"`
		Message   string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Message == "" {
		http.Error(w, "Message is required", http.StatusBadRequest)
		return
	}

	if s.intervention != nil {
		if err := s.intervention.SendIntercom(req.SessionID, req.Message); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "sent"})
}

func (s *Server) handleCheckpoints(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	var list []*intervention.Checkpoint
	if s.intervention != nil {
		list = s.intervention.ListPendingCheckpoints()
	}
	_ = json.NewEncoder(w).Encode(list)
}

func (s *Server) handleCheckpointDecision(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CheckpointID string                `json:"checkpointId"`
		Decision     intervention.Decision `json:"decision"`
		Feedback     string                `json:"feedback"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CheckpointID == "" {
		http.Error(w, "Checkpoint ID is required", http.StatusBadRequest)
		return
	}

	if s.intervention != nil {
		if err := s.intervention.SubmitDecision(req.CheckpointID, req.Decision, req.Feedback); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "recorded"})
}

func (s *Server) handleSimStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	loop := r.URL.Query().Get("loop") == "true"
	s.simulator.Start(loop)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "started", "loop": loop})
}

func (s *Server) handleSimStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	s.simulator.Stop()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

func (s *Server) handleSimSpeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	rawMultiplier := r.URL.Query().Get("multiplier")
	multiplier, err := strconv.ParseFloat(rawMultiplier, 64)
	if err != nil || multiplier <= 0 {
		http.Error(w, "Invalid multiplier parameter", http.StatusBadRequest)
		return
	}

	s.simulator.SetSpeed(multiplier)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "updated", "speed": multiplier})
}

func (s *Server) handleRepoTree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	scanner := repotree.NewScanner(".")
	folders, err := scanner.ScanTopLevelFolders()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_ = json.NewEncoder(w).Encode(folders)
}

func (s *Server) handleSessionState(w http.ResponseWriter, r *http.Request) {
	if s.sessionStore == nil {
		http.Error(w, "Session store not initialized", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if r.Method == http.MethodGet {
		sessionID := r.URL.Query().Get("id")
		if sessionID == "" {
			sessionID = "global"
		}

		st, err := s.sessionStore.GetState(sessionID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(st)
		return
	}

	if r.Method == http.MethodPost {
		var st sessionstore.SessionState
		if err := json.NewDecoder(r.Body).Decode(&st); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}

		if err := s.sessionStore.SaveState(&st); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{"status": "saved", "sessionId": st.SessionID})
		return
	}

	http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
}

func (s *Server) handleCopilotUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := r.URL.Query().Get("id")
	if sessionID == "" {
		sessionID = r.URL.Query().Get("sessionId")
	}
	if sessionID == "" && s.engine != nil {
		if active := s.engine.GetActiveSession(); active != nil {
			sessionID = active.ID
		}
	}

	if sessionID == "" {
		http.Error(w, "Session ID required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if s.copilotStore == nil || !s.copilotStore.Exists() {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"available": false,
			"sessionId": sessionID,
			"message":   "copilot session-store.db not found",
		})
		return
	}

	usage, err := s.copilotStore.GetSessionUsage(sessionID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to query copilot usage: %v", err), http.StatusInternalServerError)
		return
	}

	meta, _ := s.copilotStore.GetSessionMetadata(sessionID)

	resp := map[string]any{
		"available": true,
		"sessionId": sessionID,
		"usage":     usage,
		"metadata":  meta,
	}
	_ = json.NewEncoder(w).Encode(resp)
}


