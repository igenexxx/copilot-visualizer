package proctracer

import (
	"testing"
)

// MockProcReader provides a mock implementation of ProcReader for unit testing.
type MockProcReader struct {
	PIDs       []int
	Cmdlines   map[int][]string
	Environs   map[int]map[string]string
	Stats      map[int]*ProcessRawStat
	IOs        map[int]*ProcessRawIO
	Statms     map[int]*ProcessRawStatm
	Cwds       map[int]string
	Exes       map[int]string
	FDCounts   map[int]int
	Uptime     float64
	ClockTicks int64
	PageSize   uint64
}

func NewMockProcReader() *MockProcReader {
	return &MockProcReader{
		PIDs:       []int{},
		Cmdlines:   make(map[int][]string),
		Environs:   make(map[int]map[string]string),
		Stats:      make(map[int]*ProcessRawStat),
		IOs:        make(map[int]*ProcessRawIO),
		Statms:     make(map[int]*ProcessRawStatm),
		Cwds:       make(map[int]string),
		Exes:       make(map[int]string),
		FDCounts:   make(map[int]int),
		Uptime:     1000.0,
		ClockTicks: 100,
		PageSize:   4096,
	}
}

func (m *MockProcReader) ListPIDs() ([]int, error) {
	return m.PIDs, nil
}
func (m *MockProcReader) ReadCmdline(pid int) ([]string, error) {
	if cmd, ok := m.Cmdlines[pid]; ok {
		return cmd, nil
	}
	return nil, ErrProcessNotFound
}
func (m *MockProcReader) ReadEnviron(pid int) (map[string]string, error) {
	if env, ok := m.Environs[pid]; ok {
		return env, nil
	}
	return nil, ErrProcessNotFound
}
func (m *MockProcReader) ReadStat(pid int) (*ProcessRawStat, error) {
	if s, ok := m.Stats[pid]; ok {
		return s, nil
	}
	return nil, ErrProcessNotFound
}
func (m *MockProcReader) ReadIO(pid int) (*ProcessRawIO, error) {
	if io, ok := m.IOs[pid]; ok {
		return io, nil
	}
	return &ProcessRawIO{}, nil
}
func (m *MockProcReader) ReadStatm(pid int) (*ProcessRawStatm, error) {
	if sm, ok := m.Statms[pid]; ok {
		return sm, nil
	}
	return &ProcessRawStatm{}, nil
}
func (m *MockProcReader) ReadCwd(pid int) (string, error) {
	if cwd, ok := m.Cwds[pid]; ok {
		return cwd, nil
	}
	return "/home/user/project", nil
}
func (m *MockProcReader) ReadExe(pid int) (string, error) {
	if exe, ok := m.Exes[pid]; ok {
		return exe, nil
	}
	return "/usr/bin/node", nil
}
func (m *MockProcReader) CountFDs(pid int) (int, error) {
	if count, ok := m.FDCounts[pid]; ok {
		return count, nil
	}
	return 10, nil
}
func (m *MockProcReader) GetSystemUptime() (float64, error) {
	return m.Uptime, nil
}
func (m *MockProcReader) GetClockTicks() int64 {
	return m.ClockTicks
}
func (m *MockProcReader) GetPageSize() uint64 {
	return m.PageSize
}

func TestMatchKind(t *testing.T) {
	tests := []struct {
		name     string
		comm     string
		exe      string
		fullCmd  string
		env      map[string]string
		wantKind TargetKind
		wantOK   bool
	}{
		{
			name:     "Antigravity CLI by comm",
			comm:     "antigravity",
			exe:      "/home/user/.gemini/bin/antigravity",
			fullCmd:  "antigravity --model gemini-3.7-flash",
			wantKind: TargetKindAntigravity,
			wantOK:   true,
		},
		{
			name:     "Agy CLI by exe",
			comm:     "agy",
			exe:      "/usr/local/bin/agy",
			fullCmd:  "agy",
			wantKind: TargetKindAntigravity,
			wantOK:   true,
		},
		{
			name:     "Antigravity by GEMINI_CLI_DATA_DIR env",
			comm:     "main",
			exe:      "/tmp/go-build/main",
			fullCmd:  "main",
			env:      map[string]string{"GEMINI_CLI_DATA_DIR": "/home/user/.gemini"},
			wantKind: TargetKindAntigravity,
			wantOK:   true,
		},
		{
			name:     "GitHub Copilot CLI",
			comm:     "copilot",
			exe:      "/usr/bin/github-copilot-cli",
			fullCmd:  "github-copilot-cli --model gpt-4o",
			wantKind: TargetKindCopilot,
			wantOK:   true,
		},
		{
			name:     "Claude Code",
			comm:     "claude",
			exe:      "/usr/local/bin/claude",
			fullCmd:  "claude-code",
			wantKind: TargetKindClaude,
			wantOK:   true,
		},
		{
			name:     "Generic Aider assistant",
			comm:     "aider",
			exe:      "/usr/bin/aider",
			fullCmd:  "aider --model sonnet",
			wantKind: TargetKindGeneric,
			wantOK:   true,
		},
		{
			name:     "Exclude self-detection",
			comm:     "copilot-visualizer",
			exe:      "/home/user/bin/copilot-visualizer",
			fullCmd:  "./copilot-visualizer",
			wantKind: "",
			wantOK:   false,
		},
		{
			name:     "Regular bash process",
			comm:     "bash",
			exe:      "/bin/bash",
			fullCmd:  "bash",
			wantKind: "",
			wantOK:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			kind, ok := MatchKind(tc.comm, tc.exe, tc.fullCmd, tc.env)
			if ok != tc.wantOK {
				t.Errorf("MatchKind() ok = %v, want %v", ok, tc.wantOK)
			}
			if kind != tc.wantKind {
				t.Errorf("MatchKind() kind = %q, want %q", kind, tc.wantKind)
			}
		})
	}
}

func TestExtractModel(t *testing.T) {
	tests := []struct {
		name    string
		cmdline []string
		env     map[string]string
		want    string
	}{
		{
			name:    "flag --model",
			cmdline: []string{"agy", "--model", "gemini-3.7-flash"},
			env:     nil,
			want:    "gemini-3.7-flash",
		},
		{
			name:    "flag --model=",
			cmdline: []string{"copilot", "--model=claude-3-7-sonnet"},
			env:     nil,
			want:    "claude-3-7-sonnet",
		},
		{
			name:    "flag -m",
			cmdline: []string{"claude", "-m", "claude-3-5-sonnet"},
			env:     nil,
			want:    "claude-3-5-sonnet",
		},
		{
			name:    "from environment variable",
			cmdline: []string{"copilot"},
			env:     map[string]string{"COPILOT_MODEL": "gpt-4o"},
			want:    "gpt-4o",
		},
		{
			name:    "empty fallback",
			cmdline: []string{"node", "index.js"},
			env:     map[string]string{},
			want:    "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ExtractModel(tc.cmdline, tc.env)
			if got != tc.want {
				t.Errorf("ExtractModel() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDetector_ScanAllAndFindByPID(t *testing.T) {
	mock := NewMockProcReader()
	mock.PIDs = []int{101, 102, 103}

	// PID 101: Antigravity
	mock.Stats[101] = &ProcessRawStat{PID: 101, PPID: 1, Comm: "antigravity", State: "S", StartTime: 100}
	mock.Cmdlines[101] = []string{"antigravity", "--model", "gemini-3.7-flash"}
	mock.Environs[101] = map[string]string{"USER": "testuser"}
	mock.Exes[101] = "/usr/bin/antigravity"

	// PID 102: Random bash
	mock.Stats[102] = &ProcessRawStat{PID: 102, PPID: 1, Comm: "bash", State: "S"}
	mock.Cmdlines[102] = []string{"bash"}

	// PID 103: Copilot CLI
	mock.Stats[103] = &ProcessRawStat{PID: 103, PPID: 1, Comm: "copilot", State: "R"}
	mock.Cmdlines[103] = []string{"copilot", "--model", "gpt-4o"}
	mock.Exes[103] = "/usr/bin/copilot"

	detector := NewDetector(mock)

	targets, err := detector.ScanAll()
	if err != nil {
		t.Fatalf("ScanAll() error: %v", err)
	}

	if len(targets) != 2 {
		t.Fatalf("ScanAll() found %d targets, want 2", len(targets))
	}

	if targets[0].PID != 101 || targets[0].Kind != TargetKindAntigravity || targets[0].Model != "gemini-3.7-flash" {
		t.Errorf("Target 0 mismatch: %+v", targets[0])
	}
	if targets[1].PID != 103 || targets[1].Kind != TargetKindCopilot || targets[1].Model != "gpt-4o" {
		t.Errorf("Target 1 mismatch: %+v", targets[1])
	}

	// Test FindByPID
	t1, ok1 := detector.FindByPID(101)
	if !ok1 || t1.PID != 101 {
		t.Errorf("FindByPID(101) failed: ok=%v, t=%+v", ok1, t1)
	}

	_, ok2 := detector.FindByPID(102)
	if ok2 {
		t.Errorf("FindByPID(102) should not match non-AI process")
	}

	_, ok999 := detector.FindByPID(999)
	if ok999 {
		t.Errorf("FindByPID(999) non-existent PID should be false")
	}
}
