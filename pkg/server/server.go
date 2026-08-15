package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strconv"

	"github.com/zhenya/copilot-visualizer/pkg/autodiscover"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/intervention"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
)

// Server coordinates the visualizer HTTP and WebSocket services.
type Server struct {
	hub          *hub.Hub
	simulator    *simulator.Simulator
	engine       *autodiscover.Engine
	intervention *intervention.Manager
	mux          *http.ServeMux
	staticFS     fs.FS
}

// NewServer initializes the server dependencies and registers HTTP routes.
func NewServer(
	h *hub.Hub,
	sim *simulator.Simulator,
	engine *autodiscover.Engine,
	interv *intervention.Manager,
	staticFS fs.FS,
) *Server {
	s := &Server{
		hub:          h,
		simulator:    sim,
		engine:       engine,
		intervention: interv,
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
	s.mux.HandleFunc("/api/simulator/start", s.handleSimStart)
	s.mux.HandleFunc("/api/simulator/stop", s.handleSimStop)
	s.mux.HandleFunc("/api/simulator/speed", s.handleSimSpeed)

	// Intervention routes
	s.mux.HandleFunc("/api/intervention/emergency-stop", s.handleEmergencyStop)
	s.mux.HandleFunc("/api/intervention/intercom", s.handleIntercom)
	s.mux.HandleFunc("/api/intervention/checkpoints", s.handleCheckpoints)
	s.mux.HandleFunc("/api/intervention/checkpoint/respond", s.handleCheckpointDecision)

	if s.staticFS != nil {
		fileServer := http.FileServer(http.FS(s.staticFS))
		s.mux.Handle("/", fileServer)
	}
}

// ServeHTTP delegates to the internal ServeMux.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Enable CORS for development
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

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
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

	if err := s.hub.BroadcastEvent(&evt); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "id": evt.ID})
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
