package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"github.com/zhenya/copilot-visualizer/pkg/autodiscover"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/intervention"
	"github.com/zhenya/copilot-visualizer/pkg/recorder"
	"github.com/zhenya/copilot-visualizer/pkg/repotree"
	"github.com/zhenya/copilot-visualizer/pkg/sessionstore"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
)

// App struct manages desktop application lifecycle and Go bindings
type App struct {
	ctx        context.Context
	cancel     context.CancelFunc
	eventHub   *hub.Hub
	engine     *autodiscover.Engine
	store      *sessionstore.Store
	recorder   *recorder.Recorder
	simulator  *simulator.Simulator
	intervMgr  *intervention.Manager
	isDemoMode bool
}

// NewApp creates a new App application struct
func NewApp(demoMode bool) *App {
	eventHub := hub.NewHub(500)
	sim := simulator.New(eventHub)
	interv := intervention.NewManager(eventHub)

	rec, _ := recorder.New(".tapes")
	store, _ := sessionstore.New("")
	engine := autodiscover.NewEngine(eventHub, nil)

	return &App{
		eventHub:   eventHub,
		engine:     engine,
		store:      store,
		recorder:   rec,
		simulator:  sim,
		intervMgr:  interv,
		isDemoMode: demoMode,
	}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	appCtx, cancel := context.WithCancel(ctx)
	a.ctx = appCtx
	a.cancel = cancel

	// Subscribe to Hub and broadcast real-time events to Frontend via Wails IPC
	// The hub delivers events to WebSocket clients; for Wails we tap the history and
	// poll for new events by attaching a virtual WebSocket-compatible listener via BroadcastEvent.
	// We replace this with a goroutine that relays events from a dedicated channel.
	go func() {
		// We use a ticker to forward any new hub history events to the frontend.
		// This is a lightweight approach: the hub stores history and we diff/forward periodically.
		// For production use, hub.Hub should be extended with a proper subscriber channel.
		var lastLen int
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-ticker.C:
				history := a.eventHub.History()
				if len(history) > lastLen {
					for _, evt := range history[lastLen:] {
						runtime.EventsEmit(a.ctx, "visualizer:event", evt)
					}
					lastLen = len(history)
				}
			}
		}
	}()

	// Start Auto-Discovery Engine
	if a.engine != nil {
		a.engine.StartWatcher(a.ctx)
	}

	// If Demo mode requested, start simulator stream
	if a.isDemoMode && a.simulator != nil {
		a.simulator.Start(true)
	}
}

// shutdown is called when the app terminates
func (a *App) shutdown(ctx context.Context) {
	if a.cancel != nil {
		a.cancel()
	}
	if a.store != nil {
		_ = a.store.Close()
	}
	if a.eventHub != nil {
		a.eventHub.Close()
	}
}

// domReady is called after front-end resources are loaded
func (a *App) domReady(ctx context.Context) {
	// Replay existing history to the newly loaded frontend
	history := a.eventHub.History()
	if len(history) > 0 {
		runtime.EventsEmit(ctx, "visualizer:history", history)
	}
	runtime.EventsEmit(ctx, "visualizer:ready", true)
}

// --- Exported Wails Go Methods (Callable from Frontend TypeScript) ---

// GetSessionState returns the aggregated session state by ID.
func (a *App) GetSessionState(sessionId string) (*sessionstore.SessionState, error) {
	if a.store == nil {
		return sessionstore.NewDefaultState(sessionId, "desktop"), nil
	}
	return a.store.GetState(sessionId)
}

// GetHistory returns all recorded events from the hub.
func (a *App) GetHistory() []*events.Event {
	return a.eventHub.History()
}

// GetSessionHistory returns history filtered for a session ID or loaded from session transcript.
func (a *App) GetSessionHistory(sessionId string) []*events.Event {
	if a.engine != nil && sessionId != "" && sessionId != "global" {
		if evts := a.engine.GetSessionEvents(sessionId); len(evts) > 0 {
			return evts
		}
	}
	if a.eventHub != nil {
		return a.eventHub.HistoryForSession(sessionId)
	}
	return nil
}

// AttachSession points auto-discovery engine to track a specific session ID.
func (a *App) AttachSession(sessionId string) error {
	if a.engine == nil {
		return fmt.Errorf("engine not initialized")
	}
	return a.engine.AttachSession(sessionId)
}

// SaveTape saves the current tape recording to disk.
func (a *App) SaveTape(id string) (string, error) {
	if a.recorder == nil {
		return "", fmt.Errorf("recorder not initialized")
	}
	if id == "" {
		id = fmt.Sprintf("tape-%d", time.Now().Unix())
	}
	tape := a.recorder.GetCurrentTape()
	if tape == nil {
		return "", fmt.Errorf("no active recording tape")
	}
	tape.ID = id
	tape.Title = fmt.Sprintf("Desktop Session Tape (%s)", time.Now().Format("15:04:05"))

	if _, err := a.recorder.SaveTape(tape); err != nil {
		return "", err
	}
	return id, nil
}

// LoadTape retrieves a recorded tape by ID.
func (a *App) LoadTape(id string) (*recorder.SessionTape, error) {
	if a.recorder == nil {
		return nil, fmt.Errorf("recorder not initialized")
	}
	return a.recorder.LoadTape(id)
}

// ListTapes returns all available tape metadata.
func (a *App) ListTapes() ([]recorder.TapeMeta, error) {
	if a.recorder == nil {
		return nil, fmt.Errorf("recorder not initialized")
	}
	return a.recorder.ListTapes()
}

// ScanRepoTree scans project directory for voxel layout.
func (a *App) ScanRepoTree(rootDir string) ([]repotree.FolderNode, error) {
	if rootDir == "" {
		var err error
		rootDir, err = os.Getwd()
		if err != nil {
			return nil, err
		}
	}
	scanner := repotree.NewScanner(rootDir)
	return scanner.ScanTopLevelFolders()
}

// SendIntercomPrompt broadcasts a human-in-the-loop intervention event.
func (a *App) SendIntercomPrompt(prompt string) string {
	evt := &events.Event{
		ID:        fmt.Sprintf("intercom-%d", time.Now().UnixNano()),
		Type:      events.TypeInterventionPrompt,
		Timestamp: time.Now().UnixMilli(),
		AgentID:   "foreman",
		Title:     "Operator Intercom Guidance",
		Station:   events.StationSecurityGate,
		Payload: map[string]interface{}{
			"prompt": prompt,
			"sender": "operator",
		},
	}
	_ = a.eventHub.BroadcastEvent(evt)
	return "Guidance dispatched to agents"
}

// TriggerEmergencyStop broadcasts an emergency stop event.
func (a *App) TriggerEmergencyStop(reason string) {
	evt := &events.Event{
		ID:        fmt.Sprintf("estop-%d", time.Now().UnixNano()),
		Type:      events.TypeEmergencyStop,
		Timestamp: time.Now().UnixMilli(),
		AgentID:   "system",
		Title:     "🚨 Factory Emergency Stop Engaged",
		Payload: map[string]interface{}{
			"reason": reason,
		},
	}
	_ = a.eventHub.BroadcastEvent(evt)
}

// InjectCustomEvent emits an ad-hoc event into the hub.
func (a *App) InjectCustomEvent(evt *events.Event) {
	if evt.ID == "" {
		evt.ID = fmt.Sprintf("evt-%d", time.Now().UnixNano())
	}
	if evt.Timestamp == 0 {
		evt.Timestamp = time.Now().UnixMilli()
	}
	_ = a.eventHub.BroadcastEvent(evt)
}
