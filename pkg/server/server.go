package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"strconv"

	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
)

// Server coordinates the visualizer HTTP and WebSocket services.
type Server struct {
	hub       *hub.Hub
	simulator *simulator.Simulator
	mux       *http.ServeMux
	staticFS  fs.FS
}

// NewServer initializes the server dependencies and registers HTTP routes.
func NewServer(h *hub.Hub, sim *simulator.Simulator, staticFS fs.FS) *Server {
	s := &Server{
		hub:       h,
		simulator: sim,
		mux:       http.NewServeMux(),
		staticFS:  staticFS,
	}
	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	s.mux.HandleFunc("/ws", s.hub.HandleWebSocket)
	s.mux.HandleFunc("/api/status", s.handleStatus)
	s.mux.HandleFunc("/api/history", s.handleHistory)
	s.mux.HandleFunc("/api/events", s.handleIngestEvent)
	s.mux.HandleFunc("/api/simulator/start", s.handleSimStart)
	s.mux.HandleFunc("/api/simulator/stop", s.handleSimStop)
	s.mux.HandleFunc("/api/simulator/speed", s.handleSimSpeed)

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
	resp := map[string]any{
		"status":          "running",
		"clientsCount":    s.hub.ClientCount(),
		"eventsCount":     len(s.hub.History()),
		"simulatorActive": s.simulator.IsRunning(),
		"simulatorSpeed":  s.simulator.GetSpeed(),
	}
	_ = json.NewEncoder(w).Encode(resp)
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
