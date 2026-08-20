package proctracer

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Collector coordinates procfs polling, network tracking, and event aggregation for a single target process.
type Collector struct {
	mu             sync.RWMutex
	target         TargetProcess
	reader         ProcReader
	stateTracker   *ProcessStateTracker
	treeScanner    *ProcessTreeScanner
	netTracker     *NetworkTracker
	prevChildren   map[int]string
	recentEvents   []TraceEvent
	latestSnapshot *Snapshot
	stopChan       chan struct{}
	running        bool
	maxEvents      int
}

// NewCollector creates an integrated telemetry collector for a target.
func NewCollector(target TargetProcess, reader ProcReader) *Collector {
	if reader == nil {
		reader = NewDefaultProcReader()
	}

	c := &Collector{
		target:       target,
		reader:       reader,
		stateTracker: NewProcessStateTracker(reader),
		treeScanner:  NewProcessTreeScanner(reader),
		netTracker:   NewNetworkTracker(),
		prevChildren: make(map[int]string),
		recentEvents: make([]TraceEvent, 0, 50),
		stopChan:     make(chan struct{}),
		maxEvents:    50,
	}

	c.addEvent(TraceEvent{
		Timestamp: time.Now(),
		Kind:      EventKindAgentState,
		Severity:  SeveritySuccess,
		Source:    "tracer",
		Summary:   fmt.Sprintf("Attached to %s (PID: %d)", target.Name, target.PID),
		Details:   fmt.Sprintf("Model: %s | Cwd: %s", target.Model, target.Cwd),
	})

	return c
}

func (c *Collector) addEvent(evt TraceEvent) {
	if len(c.recentEvents) >= c.maxEvents {
		c.recentEvents = c.recentEvents[1:]
	}
	c.recentEvents = append(c.recentEvents, evt)
}

// Sample collects a single point-in-time snapshot.
func (c *Collector) Sample() (*Snapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Verify target process is still alive
	if !IsProcessAlive(c.target.PID) {
		c.target.State = "Terminated"
		c.addEvent(TraceEvent{
			Timestamp: time.Now(),
			Kind:      EventKindProcessExit,
			Severity:  SeverityWarning,
			Source:    "kernel",
			Summary:   fmt.Sprintf("Target process %d terminated", c.target.PID),
		})
	}

	metrics, err := c.stateTracker.Sample(c.target.PID)
	if err != nil && IsProcessAlive(c.target.PID) {
		metrics = ResourceMetrics{Timestamp: time.Now()}
	}

	// Scan child processes
	children, _ := c.treeScanner.ScanChildren(c.target.PID)
	metrics.ChildCount = len(children)

	// Check child process changes for spawn/exit events
	currChildren := make(map[int]string)
	for _, child := range children {
		currChildren[child.PID] = child.Name
		if _, existed := c.prevChildren[child.PID]; !existed {
			c.addEvent(TraceEvent{
				Timestamp: time.Now(),
				Kind:      EventKindProcessSpawn,
				Severity:  SeverityAction,
				Source:    "procfs",
				Summary:   fmt.Sprintf("Spawned subprocess: %s (PID: %d)", child.Name, child.PID),
				Details:   child.Cmdline,
			})
		}
	}
	for oldPID, oldName := range c.prevChildren {
		if _, exists := currChildren[oldPID]; !exists {
			c.addEvent(TraceEvent{
				Timestamp: time.Now(),
				Kind:      EventKindProcessExit,
				Severity:  SeverityInfo,
				Source:    "procfs",
				Summary:   fmt.Sprintf("Subprocess exited: %s (PID: %d)", oldName, oldPID),
			})
		}
	}
	c.prevChildren = currChildren

	// Scan network sockets
	conns, _ := c.netTracker.GetProcessConnections(c.target.PID)

	// Check for high I/O burst
	if metrics.ReadBytesSec > 5*1024*1024 || metrics.WriteBytesSec > 5*1024*1024 {
		c.addEvent(TraceEvent{
			Timestamp: time.Now(),
			Kind:      EventKindFileIO,
			Severity:  SeverityInfo,
			Source:    "io",
			Summary:   fmt.Sprintf("High Disk I/O: R: %.1f MB/s, W: %.1f MB/s", metrics.ReadBytesSec/1048576, metrics.WriteBytesSec/1048576),
		})
	}

	eventsCopy := make([]TraceEvent, len(c.recentEvents))
	copy(eventsCopy, c.recentEvents)

	snap := &Snapshot{
		Supported:    true,
		Target:       c.target,
		Metrics:      metrics,
		Children:     children,
		Connections:  conns,
		RecentEvents: eventsCopy,
		Timestamp:    time.Now(),
	}

	c.latestSnapshot = snap
	return snap, nil
}

// StartPolling starts continuous background polling.
func (c *Collector) StartPolling(ctx context.Context, interval time.Duration) <-chan Snapshot {
	out := make(chan Snapshot, 10)

	c.mu.Lock()
	c.running = true
	c.mu.Unlock()

	go func() {
		defer close(out)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		if snap, err := c.Sample(); err == nil {
			out <- *snap
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-c.stopChan:
				return
			case <-ticker.C:
				snap, err := c.Sample()
				if err == nil && snap != nil {
					select {
					case out <- *snap:
					default:
					}
				}
			}
		}
	}()

	return out
}

// Stop stops the background polling.
func (c *Collector) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.running {
		c.running = false
		close(c.stopChan)
	}
}

// GetLatestSnapshot returns the most recently collected snapshot.
func (c *Collector) GetLatestSnapshot() *Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.latestSnapshot
}
