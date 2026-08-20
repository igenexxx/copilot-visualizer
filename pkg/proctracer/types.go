package proctracer

import (
	"fmt"
	"time"
)

// TargetKind represents the type of AI assistant detected.
type TargetKind string

const (
	TargetKindAntigravity TargetKind = "antigravity"
	TargetKindCopilot     TargetKind = "copilot"
	TargetKindClaude      TargetKind = "claude"
	TargetKindGeneric     TargetKind = "generic-ai"
)

// TargetProcess represents a detected or attached AI assistant process.
type TargetProcess struct {
	PID         int               `json:"pid"`
	PPID        int               `json:"ppid"`
	Kind        TargetKind        `json:"kind"`
	Name        string            `json:"name"`
	Executable  string            `json:"executable"`
	CommandLine []string          `json:"command_line"`
	Cwd         string            `json:"cwd"`
	Model       string            `json:"model"`
	User        string            `json:"user"`
	StartTime   time.Time         `json:"start_time"`
	State       string            `json:"state"`
	Env         map[string]string `json:"env,omitempty"`
	LockFile    string            `json:"lock_file,omitempty"`
}

// DisplayTitle returns a friendly formatted title for the target process.
func (tp TargetProcess) DisplayTitle() string {
	modelStr := tp.Model
	if modelStr == "" {
		modelStr = "Unknown Model"
	}
	return fmt.Sprintf("[%s] PID %d - %s (%s)", tp.Kind, tp.PID, tp.Name, modelStr)
}

// ResourceMetrics contains real-time resource utilization for a process.
type ResourceMetrics struct {
	Timestamp        time.Time `json:"timestamp"`
	CPUPercent       float64   `json:"cpu_percent"`
	RSSBytes         uint64    `json:"rss_bytes"`
	VMSBytes         uint64    `json:"vms_bytes"`
	PeakRSSBytes     uint64    `json:"peak_rss_bytes"`
	ReadBytesSec     float64   `json:"read_bytes_sec"`
	WriteBytesSec    float64   `json:"write_bytes_sec"`
	ReadSyscallsSec  float64   `json:"read_syscalls_sec"`
	WriteSyscallsSec float64   `json:"write_syscalls_sec"`
	TotalReadBytes   uint64    `json:"total_read_bytes"`
	TotalWriteBytes  uint64    `json:"total_write_bytes"`
	FDCount          int       `json:"fd_count"`
	ThreadCount      int       `json:"thread_count"`
	ChildCount       int       `json:"child_count"`
}

// NetworkEndpoint contains network socket connection details.
type NetworkEndpoint struct {
	LocalAddr       string `json:"local_addr"`
	RemoteAddr      string `json:"remote_addr"`
	RemoteHost      string `json:"remote_host"`
	RemotePort      int    `json:"remote_port"`
	Protocol        string `json:"protocol"`
	State           string `json:"state"`
	ServiceCategory string `json:"service_category"`
	TxQueue         int    `json:"tx_queue"`
	RxQueue         int    `json:"rx_queue"`
}

// SubprocessInfo represents a child process spawned by the agent (e.g. bash, compiler, git).
type SubprocessInfo struct {
	PID        int       `json:"pid"`
	PPID       int       `json:"ppid"`
	Name       string    `json:"name"`
	Cmdline    string    `json:"cmdline"`
	State      string    `json:"state"`
	RSSBytes   uint64    `json:"rss_bytes"`
	CPUPercent float64   `json:"cpu_percent"`
	StartTime  time.Time `json:"start_time"`
}

// EventKind represents the category of a telemetry trace event.
type EventKind string

const (
	EventKindProcessSpawn EventKind = "SPAWN"
	EventKindProcessExit  EventKind = "EXIT"
	EventKindNetConnect   EventKind = "NET_CONN"
	EventKindFileIO       EventKind = "FILE_IO"
	EventKindAgentState   EventKind = "AGENT"
	EventKindSyscallBurst EventKind = "SYSCALL"
)

// EventSeverity represents severity level of an event.
type EventSeverity string

const (
	SeverityInfo    EventSeverity = "INFO"
	SeverityWarning EventSeverity = "WARN"
	SeveritySuccess EventSeverity = "SUCCESS"
	SeverityAction  EventSeverity = "ACTION"
)

// TraceEvent represents a single activity event captured during tracing.
type TraceEvent struct {
	Timestamp time.Time     `json:"timestamp"`
	Kind      EventKind     `json:"kind"`
	Severity  EventSeverity `json:"severity"`
	Source    string        `json:"source"`
	Summary   string        `json:"summary"`
	Details   string        `json:"details,omitempty"`
}

// Snapshot aggregates the complete state of a tracked assistant at an instant.
type Snapshot struct {
	Supported    bool              `json:"supported"`
	Target       TargetProcess     `json:"target"`
	Metrics      ResourceMetrics   `json:"metrics"`
	Children     []SubprocessInfo  `json:"children"`
	Connections  []NetworkEndpoint `json:"connections"`
	RecentEvents []TraceEvent      `json:"recent_events"`
	Timestamp    time.Time         `json:"timestamp"`
}

// TracerStatus represents high-level telemetry state for REST/Wails APIs.
type TracerStatus struct {
	Supported   bool            `json:"supported"`
	Attached    bool            `json:"attached"`
	TargetPID   int             `json:"target_pid"`
	TargetKind  TargetKind      `json:"target_kind"`
	TargetName  string          `json:"target_name"`
	Snapshot    *Snapshot       `json:"snapshot,omitempty"`
	TargetsList []TargetProcess `json:"targets_list,omitempty"`
}
