package proctracer

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/events"
)

// Broadcaster sends parsed live events to hub.
type Broadcaster interface {
	BroadcastEvent(evt *events.Event) error
}

// Manager coordinates automated AI process detection, telemetry tracking, and visualizer event forwarding.
type Manager struct {
	mu           sync.RWMutex
	broadcaster  Broadcaster
	reader       ProcReader
	detector     *Detector
	collector    *Collector
	activePID    int
	pollInterval time.Duration
	running      bool
	cancel       context.CancelFunc
	discovered   []TargetProcess
	supported    bool
}

// NewManager creates a new process telemetry manager.
func NewManager(broadcaster Broadcaster, reader ProcReader) *Manager {
	if reader == nil {
		reader = NewDefaultProcReader()
	}

	supported := IsLinuxOrWSL()
	return &Manager{
		broadcaster:  broadcaster,
		reader:       reader,
		detector:     NewDetector(reader),
		pollInterval: 1500 * time.Millisecond,
		supported:    supported,
		discovered:   make([]TargetProcess, 0),
	}
}

// IsSupported returns true if running on Linux/WSL.
func (m *Manager) IsSupported() bool {
	return m.supported
}

// SetPollInterval sets the background telemetry sampling interval.
func (m *Manager) SetPollInterval(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pollInterval = d
}

// Start launches the background discovery and telemetry collection loop.
func (m *Manager) Start(ctx context.Context) {
	m.mu.Lock()
	if m.running || !m.supported {
		m.mu.Unlock()
		return
	}

	ctx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	m.running = true
	m.mu.Unlock()

	go m.runLoop(ctx)
}

// Stop halts the telemetry manager.
func (m *Manager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.running {
		return
	}
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	if m.collector != nil {
		m.collector.Stop()
		m.collector = nil
	}
	m.running = false
}

func (m *Manager) runLoop(ctx context.Context) {
	ticker := time.NewTicker(m.pollInterval)
	defer ticker.Stop()

	// Initial scan & attach
	m.scanAndSync()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.scanAndSync()
			m.sampleAndBroadcast()
		}
	}
}

func (m *Manager) scanAndSync() {
	targets, err := m.detector.ScanAll()
	if err != nil {
		return
	}

	m.mu.Lock()
	m.discovered = targets
	hasActive := m.activePID > 0 && IsProcessAlive(m.activePID)

	if !hasActive && len(targets) > 0 {
		// Auto-attach to the newest or first detected target
		target := targets[0]
		m.activePID = target.PID
		if m.collector != nil {
			m.collector.Stop()
		}
		m.collector = NewCollector(target, m.reader)
		log.Printf("⚡ [ProcTracer] Auto-attached to %s PID: %d (%s)", target.Kind, target.PID, target.Name)
	}
	m.mu.Unlock()
}

func (m *Manager) sampleAndBroadcast() {
	m.mu.RLock()
	c := m.collector
	m.mu.RUnlock()

	if c == nil {
		return
	}

	_, _ = c.Sample()
}

// GetStatus returns the current status and latest snapshot.
func (m *Manager) GetStatus() *TracerStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	status := &TracerStatus{
		Supported:   m.supported,
		Attached:    m.collector != nil && m.activePID > 0,
		TargetPID:   m.activePID,
		TargetsList: m.discovered,
	}

	if m.collector != nil {
		if snap := m.collector.GetLatestSnapshot(); snap != nil {
			status.Snapshot = snap
			status.TargetKind = snap.Target.Kind
			status.TargetName = snap.Target.Name
		}
	}

	return status
}

// GetDiscoveredTargets returns all detected AI processes.
func (m *Manager) GetDiscoveredTargets() []TargetProcess {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]TargetProcess, len(m.discovered))
	copy(res, m.discovered)
	return res
}

// AttachPID manually attaches the collector to a specific target PID.
func (m *Manager) AttachPID(pid int) (*Snapshot, error) {
	if !m.supported {
		return nil, ErrNotSupported
	}

	target, ok := m.detector.FindByPID(pid)
	if !ok {
		// Fallback: build target from raw PID
		stat, err := m.reader.ReadStat(pid)
		if err != nil {
			return nil, fmt.Errorf("cannot inspect pid %d: %w", pid, err)
		}
		cmdline, _ := m.reader.ReadCmdline(pid)
		cwd, _ := m.reader.ReadCwd(pid)
		exe, _ := m.reader.ReadExe(pid)
		environ, _ := m.reader.ReadEnviron(pid)

		target = TargetProcess{
			PID:         pid,
			PPID:        stat.PPID,
			Kind:        TargetKindGeneric,
			Name:        stat.Comm,
			Executable:  exe,
			CommandLine: cmdline,
			Cwd:         cwd,
			StartTime:   time.Now(),
			State:       ProcessStateString(stat.State),
			Env:         environ,
		}
	}

	m.mu.Lock()
	if m.collector != nil {
		m.collector.Stop()
	}
	m.activePID = pid
	m.collector = NewCollector(target, m.reader)
	collector := m.collector
	m.mu.Unlock()

	snap, err := collector.Sample()
	if err == nil && m.broadcaster != nil {
		evt := events.NewEvent(
			fmt.Sprintf("proctracer-attach-%d", time.Now().UnixNano()),
			fmt.Sprintf("pid-%d", target.PID),
			events.TypeSessionStart,
			"proctracer",
			fmt.Sprintf("Attached to Process PID: %d (%s)", target.PID, target.Name),
		).
			WithRole(events.RoleForeman).
			WithStation(events.StationServerRack).
			WithSummary(fmt.Sprintf("Attached to %s (PID: %d)", target.Name, target.PID)).
			WithPayload("target", target)
		_ = m.broadcaster.BroadcastEvent(evt)
	}

	return snap, err
}

// GetSnapshot returns the latest sampled snapshot or takes a fresh sample.
func (m *Manager) GetSnapshot() (*Snapshot, error) {
	m.mu.RLock()
	c := m.collector
	supported := m.supported
	m.mu.RUnlock()

	if !supported {
		return &Snapshot{Supported: false}, nil
	}

	if c == nil {
		return &Snapshot{Supported: true}, nil
	}

	return c.Sample()
}
