package proctracer

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestParseStatData(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantErr   bool
		checkStat func(t *testing.T, s *ProcessRawStat)
	}{
		{
			name: "valid standard process stat",
			raw:  "12345 (antigravity) S 1000 12345 12345 0 -1 4194304 100 0 0 0 50 25 0 0 20 0 8 0 100000 10485760 2560 18446744073709551615",
			wantErr: false,
			checkStat: func(t *testing.T, s *ProcessRawStat) {
				if s.PID != 12345 {
					t.Errorf("PID = %d, want 12345", s.PID)
				}
				if s.Comm != "antigravity" {
					t.Errorf("Comm = %q, want 'antigravity'", s.Comm)
				}
				if s.State != "S" {
					t.Errorf("State = %q, want 'S'", s.State)
				}
				if s.PPID != 1000 {
					t.Errorf("PPID = %d, want 1000", s.PPID)
				}
				if s.UTime != 50 {
					t.Errorf("UTime = %d, want 50", s.UTime)
				}
				if s.STime != 25 {
					t.Errorf("STime = %d, want 25", s.STime)
				}
				if s.NumThreads != 8 {
					t.Errorf("NumThreads = %d, want 8", s.NumThreads)
				}
				if s.RSSPages != 2560 {
					t.Errorf("RSSPages = %d, want 2560", s.RSSPages)
				}
			},
		},
		{
			name: "process name with spaces and parenthesis",
			raw:  "9999 (worker (sub) task) R 1 9999 9999 0 -1 4194304 100 0 0 0 10 20 0 0 20 0 4 0 200000 20971520 5120 18446744073709551615",
			wantErr: false,
			checkStat: func(t *testing.T, s *ProcessRawStat) {
				if s.PID != 9999 {
					t.Errorf("PID = %d, want 9999", s.PID)
				}
				if s.Comm != "worker (sub) task" {
					t.Errorf("Comm = %q, want 'worker (sub) task'", s.Comm)
				}
				if s.State != "R" {
					t.Errorf("State = %q, want 'R'", s.State)
				}
			},
		},
		{
			name:    "empty string",
			raw:     "",
			wantErr: true,
		},
		{
			name:    "missing parenthesis",
			raw:     "12345 antigravity S 100 200",
			wantErr: true,
		},
		{
			name:    "invalid PID prefix",
			raw:     "abc (antigravity) S 1000 12345 12345 0 -1 4194304 100 0 0 0 50 25 0 0 20 0 8 0 100000 10485760 2560 0",
			wantErr: true,
		},
		{
			name:    "insufficient fields",
			raw:     "12345 (antigravity) S 100",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			stat, err := ParseStatData([]byte(tc.raw))
			if tc.wantErr {
				if err == nil {
					t.Errorf("ParseStatData(%q) expected error, got nil", tc.raw)
				}
				if !errors.Is(err, ErrInvalidProcData) {
					t.Errorf("ParseStatData(%q) error should wrap ErrInvalidProcData, got %v", tc.raw, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseStatData(%q) unexpected error: %v", tc.raw, err)
			}
			if tc.checkStat != nil {
				tc.checkStat(t, stat)
			}
		})
	}
}

func FuzzParseStatData(f *testing.F) {
	f.Add([]byte("12345 (antigravity) S 1000 12345 12345 0 -1 4194304 100 0 0 0 50 25 0 0 20 0 8 0 100000 10485760 2560 0"))
	f.Add([]byte("1 (systemd) S 0 1 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0"))
	f.Add([]byte(""))
	f.Add([]byte("invalid stat line without parens"))

	f.Fuzz(func(t *testing.T, data []byte) {
		// Ensure it never panics on random input
		_, _ = ParseStatData(data)
	})
}

func TestParseIOData(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		checkIO func(t *testing.T, io *ProcessRawIO)
	}{
		{
			name: "standard /proc/[pid]/io content",
			raw: `rchar: 123456
wchar: 654321
syscr: 500
syscw: 250
read_bytes: 1048576
write_bytes: 2097152
cancelled_write_bytes: 0`,
			checkIO: func(t *testing.T, io *ProcessRawIO) {
				if io.ReadBytes != 1048576 {
					t.Errorf("ReadBytes = %d, want 1048576", io.ReadBytes)
				}
				if io.WriteBytes != 2097152 {
					t.Errorf("WriteBytes = %d, want 2097152", io.WriteBytes)
				}
				if io.ReadCalls != 500 {
					t.Errorf("ReadCalls = %d, want 500", io.ReadCalls)
				}
				if io.WriteCalls != 250 {
					t.Errorf("WriteCalls = %d, want 250", io.WriteCalls)
				}
			},
		},
		{
			name: "empty input",
			raw:  "",
			checkIO: func(t *testing.T, io *ProcessRawIO) {
				if io.ReadBytes != 0 || io.WriteBytes != 0 {
					t.Errorf("empty input should return zero stats")
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res, err := ParseIOData([]byte(tc.raw))
			if err != nil {
				t.Fatalf("ParseIOData() unexpected error: %v", err)
			}
			tc.checkIO(t, res)
		})
	}
}

func FuzzParseIOData(f *testing.F) {
	f.Add([]byte("read_bytes: 1000\nwrite_bytes: 2000\nsyscr: 10\nsyscw: 20\n"))
	f.Add([]byte(""))
	f.Add([]byte("random: garbage: 123"))

	f.Fuzz(func(t *testing.T, data []byte) {
		_, _ = ParseIOData(data)
	})
}

func TestParseStatmData(t *testing.T) {
	tests := []struct {
		name      string
		raw       string
		wantErr   bool
		checkStat func(t *testing.T, m *ProcessRawStatm)
	}{
		{
			name: "valid statm",
			raw:  "1000 500 200 100 0 400 0",
			wantErr: false,
			checkStat: func(t *testing.T, m *ProcessRawStatm) {
				if m.Size != 1000 {
					t.Errorf("Size = %d, want 1000", m.Size)
				}
				if m.Resident != 500 {
					t.Errorf("Resident = %d, want 500", m.Resident)
				}
				if m.Shared != 200 {
					t.Errorf("Shared = %d, want 200", m.Shared)
				}
				if m.Text != 100 {
					t.Errorf("Text = %d, want 100", m.Text)
				}
				if m.Data != 400 {
					t.Errorf("Data = %d, want 400", m.Data)
				}
			},
		},
		{
			name:    "empty string",
			raw:     "",
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			m, err := ParseStatmData([]byte(tc.raw))
			if tc.wantErr {
				if err == nil {
					t.Errorf("ParseStatmData(%q) expected error", tc.raw)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseStatmData(%q) unexpected error: %v", tc.raw, err)
			}
			tc.checkStat(t, m)
		})
	}
}

func TestProcessStateString(t *testing.T) {
	cases := map[string]string{
		"R": "Running",
		"S": "Sleeping",
		"D": "Disk Sleep",
		"Z": "Zombie",
		"T": "Stopped",
		"X": "Dead",
		"I": "Idle",
		"?": "?",
	}

	for input, want := range cases {
		t.Run("state_"+input, func(t *testing.T) {
			got := ProcessStateString(input)
			if got != want {
				t.Errorf("ProcessStateString(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

func TestIsProcessAlive(t *testing.T) {
	if IsProcessAlive(-1) {
		t.Errorf("IsProcessAlive(-1) should be false")
	}
	if IsProcessAlive(0) {
		t.Errorf("IsProcessAlive(0) should be false")
	}

	myPID := os.Getpid()
	if !IsProcessAlive(myPID) {
		t.Errorf("IsProcessAlive(current PID %d) should be true", myPID)
	}
}

func TestDefaultProcReader_MockFS(t *testing.T) {
	tempDir := t.TempDir()
	pidDir := filepath.Join(tempDir, "42")
	if err := os.MkdirAll(filepath.Join(pidDir, "fd"), 0755); err != nil {
		t.Fatalf("failed to create mock proc dir: %v", err)
	}

	_ = os.WriteFile(filepath.Join(tempDir, "uptime"), []byte("12345.67 8910.11\n"), 0644)
	_ = os.WriteFile(filepath.Join(pidDir, "stat"), []byte("42 (test-agent) S 1 42 42 0 -1 4194304 100 0 0 0 50 25 0 0 20 0 8 0 100000 10485760 2560 0\n"), 0644)
	_ = os.WriteFile(filepath.Join(pidDir, "cmdline"), []byte("test-agent\x00--model\x00gpt-4\x00"), 0644)
	_ = os.WriteFile(filepath.Join(pidDir, "environ"), []byte("USER=tester\x00FOO=BAR\x00"), 0644)
	_ = os.WriteFile(filepath.Join(pidDir, "io"), []byte("read_bytes: 100\nwrite_bytes: 200\n"), 0644)
	_ = os.WriteFile(filepath.Join(pidDir, "statm"), []byte("100 50 10 5 0 20 0\n"), 0644)

	reader := NewDefaultProcReader(tempDir)

	uptime, err := reader.GetSystemUptime()
	if err != nil || uptime != 12345.67 {
		t.Errorf("GetSystemUptime() = %f, err = %v; want 12345.67", uptime, err)
	}

	pids, err := reader.ListPIDs()
	if err != nil || len(pids) != 1 || pids[0] != 42 {
		t.Errorf("ListPIDs() = %v, err = %v; want [42]", pids, err)
	}

	cmd, err := reader.ReadCmdline(42)
	if err != nil || len(cmd) != 3 || cmd[0] != "test-agent" {
		t.Errorf("ReadCmdline(42) = %v, err = %v", cmd, err)
	}

	env, err := reader.ReadEnviron(42)
	if err != nil || env["USER"] != "tester" || env["FOO"] != "BAR" {
		t.Errorf("ReadEnviron(42) = %v, err = %v", env, err)
	}

	stat, err := reader.ReadStat(42)
	if err != nil || stat.PID != 42 || stat.Comm != "test-agent" {
		t.Errorf("ReadStat(42) = %+v, err = %v", stat, err)
	}

	ioStat, err := reader.ReadIO(42)
	if err != nil || ioStat.ReadBytes != 100 || ioStat.WriteBytes != 200 {
		t.Errorf("ReadIO(42) = %+v, err = %v", ioStat, err)
	}

	statm, err := reader.ReadStatm(42)
	if err != nil || statm.Size != 100 || statm.Resident != 50 {
		t.Errorf("ReadStatm(42) = %+v, err = %v", statm, err)
	}
}

func TestDefaultProcReader_RealSystem(t *testing.T) {
	if !IsLinuxOrWSL() {
		t.Skip("skipping real procfs test on non-Linux")
	}

	reader := NewDefaultProcReader()
	if reader.GetPageSize() == 0 {
		t.Errorf("GetPageSize() returned 0")
	}
	if reader.GetClockTicks() == 0 {
		t.Errorf("GetClockTicks() returned 0")
	}

	pid := os.Getpid()
	stat, err := reader.ReadStat(pid)
	if err != nil || stat.PID != pid {
		t.Errorf("ReadStat(%d) = %+v, err = %v", pid, stat, err)
	}

	cwd, err := reader.ReadCwd(pid)
	if err != nil || cwd == "" {
		t.Errorf("ReadCwd(%d) = %q, err = %v", pid, cwd, err)
	}

	exe, err := reader.ReadExe(pid)
	if err != nil || exe == "" {
		t.Errorf("ReadExe(%d) = %q, err = %v", pid, exe, err)
	}

	fds, err := reader.CountFDs(pid)
	if err != nil || fds == 0 {
		t.Errorf("CountFDs(%d) = %d, err = %v", pid, fds, err)
	}

	cmdline, err := reader.ReadCmdline(pid)
	if err != nil || len(cmdline) == 0 {
		t.Errorf("ReadCmdline(%d) = %v, err = %v", pid, cmdline, err)
	}

	env, err := reader.ReadEnviron(pid)
	if err != nil || len(env) == 0 {
		t.Errorf("ReadEnviron(%d) = %v, err = %v", pid, env, err)
	}

	statm, err := reader.ReadStatm(pid)
	if err != nil || statm.Size == 0 {
		t.Errorf("ReadStatm(%d) = %+v, err = %v", pid, statm, err)
	}

	_, _ = reader.ReadIO(pid)
}

func TestTypes_DisplayTitle(t *testing.T) {
	tp := TargetProcess{
		PID:   1234,
		Kind:  TargetKindAntigravity,
		Name:  "antigravity",
		Model: "gemini-3.7-flash",
	}

	got := tp.DisplayTitle()
	want := "[antigravity] PID 1234 - antigravity (gemini-3.7-flash)"
	if got != want {
		t.Errorf("DisplayTitle() = %q, want %q", got, want)
	}

	tpEmptyModel := TargetProcess{
		PID:  1234,
		Kind: TargetKindCopilot,
		Name: "copilot",
	}
	got2 := tpEmptyModel.DisplayTitle()
	want2 := "[copilot] PID 1234 - copilot (Unknown Model)"
	if got2 != want2 {
		t.Errorf("DisplayTitle() = %q, want %q", got2, want2)
	}
}
