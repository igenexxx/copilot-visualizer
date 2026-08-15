package simulator

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// Broadcaster sends simulated events to the Hub.
type Broadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Simulator generates real-time demo scenarios illustrating workshop activity.
type Simulator struct {
	broadcaster Broadcaster
	speed       float64 // 1.0 = normal, 2.0 = double speed, etc.
	mu          sync.Mutex
	running     bool
	cancel      context.CancelFunc
}

// New creates a new Simulator.
func New(broadcaster Broadcaster) *Simulator {
	return &Simulator{
		broadcaster: broadcaster,
		speed:       1.0,
	}
}

// SetSpeed adjusts playback speed (e.g. 0.5x, 1x, 2x, 4x).
func (s *Simulator) SetSpeed(multiplier float64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if multiplier <= 0 {
		multiplier = 1.0
	}
	s.speed = multiplier
}

// GetSpeed returns the current simulation speed.
func (s *Simulator) GetSpeed() float64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.speed
}

// IsRunning reports whether simulation is actively broadcasting.
func (s *Simulator) IsRunning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running
}

// Start launches the simulated event cycle in background.
func (s *Simulator) Start(loop bool) {
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.running = true
	s.mu.Unlock()

	go s.runLoop(ctx, loop)
}

// Stop halts the simulation.
func (s *Simulator) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.running = false
}

func (s *Simulator) sleep(ctx context.Context, baseMs int) bool {
	s.mu.Lock()
	speed := s.speed
	s.mu.Unlock()

	adjustedMs := float64(baseMs) / speed
	timer := time.NewTimer(time.Duration(adjustedMs) * time.Millisecond)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Simulator) runLoop(ctx context.Context, loop bool) {
	defer func() {
		s.mu.Lock()
		s.running = false
		s.mu.Unlock()
	}()

	for {
		if !s.runScenario(ctx) {
			return
		}
		if !loop {
			return
		}
		if !s.sleep(ctx, 3000) {
			return
		}
	}
}

func (s *Simulator) runScenario(ctx context.Context) bool {
	sessionID := fmt.Sprintf("sess-demo-%d", time.Now().Unix()%10000)

	steps := []*events.Event{
		events.NewEvent("step-1", sessionID, events.TypeSessionStart, "agent-foreman", "Session Started: Refactor Token Cache").
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary("Goal: Implement lock-free RingBuffer cache and verify race conditions.").
			WithPayload("goal", "Optimize high-load JWT validator"),

		events.NewEvent("step-2", sessionID, events.TypeAgentSpawn, "agent-foreman", "Foreman Clocked In").
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary("Master Foreman takes position at central drafting table."),

		events.NewEvent("step-3", sessionID, events.TypeAgentThink, "agent-foreman", "Reviewing Architecture").
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary("Examining call graph: Need to inspect existing token validator before rewriting."),

		events.NewEvent("step-4", sessionID, events.TypeToolCall, "agent-foreman", "Grep Search: TokenValidator").
			WithRole(events.RoleInspector).
			WithStation(events.StationSearchRadar).
			WithSummary("Scanning codebase for TokenValidator structs").
			WithPayload("query", "type TokenValidator struct").
			WithPayload("matches", 4),

		events.NewEvent("step-5", sessionID, events.TypeFileRead, "agent-foreman", "Reading auth/jwt.go").
			WithRole(events.RoleInspector).
			WithStation(events.StationFilingVault).
			WithSummary("Examining mutex locks and token expiration checks").
			WithPayload("file", "pkg/auth/jwt.go").
			WithPayload("lines", 142),

		events.NewEvent("step-6", sessionID, events.TypeSubagentDelegate, "agent-foreman", "Summoning Subagent Crafter").
			WithRole(events.RoleForeman).
			WithStation(events.StationForemanDesk).
			WithSummary("Foreman delegates memory-efficient ring buffer implementation to Specialist Crafter.").
			WithPayload("subagentId", "agent-crafter-1"),

		events.NewEvent("step-7", sessionID, events.TypeAgentSpawn, "agent-crafter-1", "Crafter Clocked In").
			WithRole(events.RoleCrafter).
			WithStation(events.StationCNCLathe).
			WithSummary("Specialist Crafter walks into the workshop and powers up CNC Machining Lathe."),

		events.NewEvent("step-8", sessionID, events.TypeFileWrite, "agent-crafter-1", "Forging ring_buffer.go").
			WithRole(events.RoleCrafter).
			WithStation(events.StationCNCLathe).
			WithSummary("Forging new lock-free atomic buffer; sparks flying from the lathe!").
			WithPayload("file", "pkg/auth/ring_buffer.go").
			WithPayload("linesAdded", 88).
			WithPayload("sparkIntensity", "high"),

		events.NewEvent("step-9", sessionID, events.TypeMCPCall, "agent-crafter-1", "Calling Security Audit MCP").
			WithRole(events.RoleOperator).
			WithStation(events.StationPhoneBooth).
			WithSummary("Operator dials external Security Audit MCP server over JSON-RPC").
			WithPayload("server", "gosec-mcp").
			WithPayload("method", "tools/call").
			WithPayload("tool", "scan_memory_safety"),

		events.NewEvent("step-10", sessionID, events.TypeMCPResponse, "agent-crafter-1", "Security MCP: 0 Vulnerabilities").
			WithRole(events.RoleOperator).
			WithStation(events.StationPhoneBooth).
			WithSummary("Operator receives clean bill of health: No buffer overflows or data races detected.").
			WithPayload("status", "SUCCESS").
			WithPayload("durationMs", 185),

		events.NewEvent("step-11", sessionID, events.TypeCommandRun, "agent-crafter-1", "Testing: go test -race ./pkg/auth/...").
			WithRole(events.RoleTester).
			WithStation(events.StationTestFurnace).
			WithSummary("Firing up Test Furnace: Stress testing atomic invariants.").
			WithPayload("cmd", "go test -race -v -count=10 ./pkg/auth/..."),

		events.NewEvent("step-12", sessionID, events.TypeCommandOutput, "agent-crafter-1", "All 18 Tests Passed").
			WithRole(events.RoleTester).
			WithStation(events.StationTestFurnace).
			WithSummary("PASS: 18/18 subtests passed in 0.06s. Zero race conditions detected.").
			WithPayload("exitCode", 0).
			WithPayload("passCount", 18),

		events.NewEvent("step-13", sessionID, events.TypeSubagentReturn, "agent-crafter-1", "Crafter Completed Assignment").
			WithRole(events.RoleCrafter).
			WithStation(events.StationForemanDesk).
			WithSummary("Crafter hands finished component blueprint to Foreman."),

		events.NewEvent("step-14", sessionID, events.TypeSessionEnd, "agent-foreman", "Session Complete: Artifact Delivered").
			WithRole(events.RoleForeman).
			WithStation(events.StationConveyor).
			WithSummary("Finished ring buffer artifact shipped via conveyor. Ready for production!").
			WithPayload("status", "SUCCESS").
			WithPayload("totalDurationMs", 4200),
	}

	delays := []int{
		800, 900, 1100, 1300, 1200, 1000, 900, 1500, 1200, 1000, 1400, 1100, 1000, 1500,
	}

	for i, step := range steps {
		if s.broadcaster != nil {
			_ = s.broadcaster.BroadcastEvent(step)
		}
		delay := 1000
		if i < len(delays) {
			delay = delays[i]
		}
		if !s.sleep(ctx, delay) {
			return false
		}
	}

	return true
}
