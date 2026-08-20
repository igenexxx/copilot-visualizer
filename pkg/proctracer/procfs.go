package proctracer

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

var (
	ErrProcessNotFound  = errors.New("process not found")
	ErrPermissionDenied = errors.New("permission denied reading process data")
	ErrInvalidProcData  = errors.New("invalid procfs format")
	ErrNotSupported     = errors.New("process telemetry is only supported on Linux / WSL")
)

// IsLinuxOrWSL checks if current runtime environment is Linux or WSL.
func IsLinuxOrWSL() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	// Verify /proc exists and is accessible
	if fi, err := os.Stat("/proc"); err == nil && fi.IsDir() {
		return true
	}
	return false
}

// ProcessRawStat contains raw tick counters from /proc/[pid]/stat.
type ProcessRawStat struct {
	PID        int
	Comm       string
	State      string
	PPID       int
	PGRP       int
	UTime      uint64
	STime      uint64
	CUTime     uint64
	CSTime     uint64
	NumThreads int
	StartTime  uint64
	VSize      uint64
	RSSPages   int64
}

// ProcessRawIO contains disk I/O counters from /proc/[pid]/io.
type ProcessRawIO struct {
	ReadBytes  uint64
	WriteBytes uint64
	ReadCalls  uint64
	WriteCalls uint64
}

// ProcessRawStatm contains memory page counts from /proc/[pid]/statm.
type ProcessRawStatm struct {
	Size     uint64
	Resident uint64
	Shared   uint64
	Text     uint64
	Data     uint64
}

// ProcReader provides an interface to read procfs (abstractable for unit tests).
type ProcReader interface {
	ReadCmdline(pid int) ([]string, error)
	ReadEnviron(pid int) (map[string]string, error)
	ReadStat(pid int) (*ProcessRawStat, error)
	ReadIO(pid int) (*ProcessRawIO, error)
	ReadStatm(pid int) (*ProcessRawStatm, error)
	ReadCwd(pid int) (string, error)
	ReadExe(pid int) (string, error)
	CountFDs(pid int) (int, error)
	ListPIDs() ([]int, error)
	GetSystemUptime() (float64, error)
	GetClockTicks() int64
	GetPageSize() uint64
}

// DefaultProcReader reads from Linux /proc.
type DefaultProcReader struct {
	procRoot string
}

// NewDefaultProcReader creates a ProcReader rooted at /proc (or custom path for tests).
func NewDefaultProcReader(procRoot ...string) *DefaultProcReader {
	root := "/proc"
	if len(procRoot) > 0 && procRoot[0] != "" {
		root = procRoot[0]
	}
	return &DefaultProcReader{procRoot: root}
}

func (r *DefaultProcReader) pidPath(pid int, sub ...string) string {
	elems := append([]string{r.procRoot, strconv.Itoa(pid)}, sub...)
	return filepath.Join(elems...)
}

func (r *DefaultProcReader) GetPageSize() uint64 {
	return uint64(os.Getpagesize())
}

func (r *DefaultProcReader) GetClockTicks() int64 {
	// Standard Linux clock ticks per second (USER_HZ). Default is 100.
	return 100
}

func (r *DefaultProcReader) GetSystemUptime() (float64, error) {
	data, err := os.ReadFile(filepath.Join(r.procRoot, "uptime"))
	if err != nil {
		return 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0, ErrInvalidProcData
	}
	return strconv.ParseFloat(fields[0], 64)
}

func (r *DefaultProcReader) ListPIDs() ([]int, error) {
	entries, err := os.ReadDir(r.procRoot)
	if err != nil {
		return nil, err
	}
	var pids []int
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err == nil && pid > 0 {
			pids = append(pids, pid)
		}
	}
	return pids, nil
}

func (r *DefaultProcReader) ReadCmdline(pid int) ([]string, error) {
	data, err := os.ReadFile(r.pidPath(pid, "cmdline"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrProcessNotFound
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermissionDenied
		}
		return nil, err
	}
	if len(data) == 0 {
		return nil, nil
	}
	// Split by null byte
	parts := bytes.Split(data, []byte{0})
	var args []string
	for _, p := range parts {
		if len(p) > 0 {
			args = append(args, string(p))
		}
	}
	return args, nil
}

func (r *DefaultProcReader) ReadEnviron(pid int) (map[string]string, error) {
	data, err := os.ReadFile(r.pidPath(pid, "environ"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrProcessNotFound
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermissionDenied
		}
		return nil, err
	}
	env := make(map[string]string)
	parts := bytes.Split(data, []byte{0})
	for _, p := range parts {
		if len(p) == 0 {
			continue
		}
		s := string(p)
		idx := strings.IndexByte(s, '=')
		if idx > 0 {
			env[s[:idx]] = s[idx+1:]
		}
	}
	return env, nil
}

func (r *DefaultProcReader) ReadStat(pid int) (*ProcessRawStat, error) {
	data, err := os.ReadFile(r.pidPath(pid, "stat"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrProcessNotFound
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermissionDenied
		}
		return nil, err
	}
	return ParseStatData(data)
}

func (r *DefaultProcReader) ReadIO(pid int) (*ProcessRawIO, error) {
	data, err := os.ReadFile(r.pidPath(pid, "io"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrProcessNotFound
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermissionDenied
		}
		return &ProcessRawIO{}, nil
	}
	return ParseIOData(data)
}

func (r *DefaultProcReader) ReadStatm(pid int) (*ProcessRawStatm, error) {
	data, err := os.ReadFile(r.pidPath(pid, "statm"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrProcessNotFound
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, ErrPermissionDenied
		}
		return nil, err
	}
	return ParseStatmData(data)
}

func (r *DefaultProcReader) ReadCwd(pid int) (string, error) {
	target, err := os.Readlink(r.pidPath(pid, "cwd"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrProcessNotFound
		}
		return "", err
	}
	return target, nil
}

func (r *DefaultProcReader) ReadExe(pid int) (string, error) {
	target, err := os.Readlink(r.pidPath(pid, "exe"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", ErrProcessNotFound
		}
		return "", err
	}
	return target, nil
}

func (r *DefaultProcReader) CountFDs(pid int) (int, error) {
	dir, err := os.Open(r.pidPath(pid, "fd"))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, ErrProcessNotFound
		}
		return 0, nil
	}
	defer dir.Close()

	names, err := dir.Readdirnames(-1)
	if err != nil {
		return 0, nil
	}
	return len(names), nil
}

// ParseStatData parses the contents of /proc/[pid]/stat accurately, handling process names with spaces or parens.
func ParseStatData(data []byte) (*ProcessRawStat, error) {
	str := string(data)
	firstParen := strings.IndexByte(str, '(')
	lastParen := strings.LastIndexByte(str, ')')
	if firstParen == -1 || lastParen == -1 || lastParen <= firstParen {
		return nil, ErrInvalidProcData
	}

	pidStr := strings.TrimSpace(str[:firstParen])
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid pid %q", ErrInvalidProcData, pidStr)
	}

	comm := str[firstParen+1 : lastParen]
	rest := strings.TrimSpace(str[lastParen+1:])
	fields := strings.Fields(rest)
	if len(fields) < 22 {
		return nil, fmt.Errorf("%w: stat fields count too low (%d)", ErrInvalidProcData, len(fields))
	}

	state := fields[0]
	ppid, _ := strconv.Atoi(fields[1])
	pgrp, _ := strconv.Atoi(fields[2])
	utime, _ := strconv.ParseUint(fields[11], 10, 64)
	stime, _ := strconv.ParseUint(fields[12], 10, 64)
	cutime, _ := strconv.ParseUint(fields[13], 10, 64)
	cstime, _ := strconv.ParseUint(fields[14], 10, 64)
	numThreads, _ := strconv.Atoi(fields[17])
	startTime, _ := strconv.ParseUint(fields[19], 10, 64)
	vsize, _ := strconv.ParseUint(fields[20], 10, 64)
	rss, _ := strconv.ParseInt(fields[21], 10, 64)

	return &ProcessRawStat{
		PID:        pid,
		Comm:       comm,
		State:      state,
		PPID:       ppid,
		PGRP:       pgrp,
		UTime:      utime,
		STime:      stime,
		CUTime:     cutime,
		CSTime:     cstime,
		NumThreads: numThreads,
		StartTime:  startTime,
		VSize:      vsize,
		RSSPages:   rss,
	}, nil
}

// ParseIOData parses the contents of /proc/[pid]/io.
func ParseIOData(data []byte) (*ProcessRawIO, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	res := &ProcessRawIO{}
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val, _ := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 64)
		switch key {
		case "read_bytes":
			res.ReadBytes = val
		case "write_bytes":
			res.WriteBytes = val
		case "syscr":
			res.ReadCalls = val
		case "syscw":
			res.WriteCalls = val
		}
	}
	return res, nil
}

// ParseStatmData parses the contents of /proc/[pid]/statm.
func ParseStatmData(data []byte) (*ProcessRawStatm, error) {
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return nil, ErrInvalidProcData
	}
	size, _ := strconv.ParseUint(fields[0], 10, 64)
	resident, _ := strconv.ParseUint(fields[1], 10, 64)
	shared, _ := strconv.ParseUint(fields[2], 10, 64)

	var text, dataPages uint64
	if len(fields) >= 6 {
		text, _ = strconv.ParseUint(fields[3], 10, 64)
		dataPages, _ = strconv.ParseUint(fields[5], 10, 64)
	}

	return &ProcessRawStatm{
		Size:     size,
		Resident: resident,
		Shared:   shared,
		Text:     text,
		Data:     dataPages,
	}, nil
}

// ProcessStateString returns a descriptive text for the single-char process state.
func ProcessStateString(state string) string {
	switch state {
	case "R":
		return "Running"
	case "S":
		return "Sleeping"
	case "D":
		return "Disk Sleep"
	case "Z":
		return "Zombie"
	case "T":
		return "Stopped"
	case "t":
		return "Tracing Stop"
	case "X", "x":
		return "Dead"
	case "K":
		return "Wakekill"
	case "W":
		return "Waking"
	case "P":
		return "Parked"
	case "I":
		return "Idle"
	default:
		return state
	}
}
