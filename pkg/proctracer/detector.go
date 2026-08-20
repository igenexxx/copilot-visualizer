package proctracer

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Detector discovers AI coding assistant processes on the system.
type Detector struct {
	reader ProcReader
}

// NewDetector creates a new Detector.
func NewDetector(reader ProcReader) *Detector {
	if reader == nil {
		reader = NewDefaultProcReader()
	}
	return &Detector{reader: reader}
}

// Known target identifiers
const (
	SigAntigravity = "antigravity"
	SigAgy         = "agy"
	SigCopilot     = "copilot"
	SigClaude      = "claude"
	SigClaudeCode  = "claude-code"
	SigCursor      = "cursor"
	SigAider       = "aider"
)

// ScanAll finds all active AI coding assistant processes.
func (d *Detector) ScanAll() ([]TargetProcess, error) {
	pids, err := d.reader.ListPIDs()
	if err != nil {
		return nil, err
	}

	var targets []TargetProcess
	for _, pid := range pids {
		target, ok := d.InspectPID(pid)
		if ok {
			targets = append(targets, target)
		}
	}

	return targets, nil
}

// FindByPID inspects a specific PID and returns target process information.
func (d *Detector) FindByPID(pid int) (TargetProcess, bool) {
	return d.InspectPID(pid)
}

// InspectPID inspects a PID to see if it matches any AI assistant signature.
func (d *Detector) InspectPID(pid int) (TargetProcess, bool) {
	stat, err := d.reader.ReadStat(pid)
	if err != nil {
		return TargetProcess{}, false
	}

	cmdline, _ := d.reader.ReadCmdline(pid)
	environ, _ := d.reader.ReadEnviron(pid)
	cwd, _ := d.reader.ReadCwd(pid)
	exe, _ := d.reader.ReadExe(pid)

	fullCmd := strings.ToLower(strings.Join(cmdline, " "))
	commLower := strings.ToLower(stat.Comm)
	exeLower := strings.ToLower(exe)

	kind, matched := MatchKind(commLower, exeLower, fullCmd, environ)
	if !matched {
		return TargetProcess{}, false
	}

	// Extract model from flags or environ
	model := ExtractModel(cmdline, environ)

	// Approximate start time from system uptime & ticks
	uptime, _ := d.reader.GetSystemUptime()
	ticks := d.reader.GetClockTicks()
	startTime := time.Now()
	if uptime > 0 && ticks > 0 && stat.StartTime > 0 {
		bootTime := time.Now().Add(-time.Duration(uptime * float64(time.Second)))
		startTime = bootTime.Add(time.Duration(float64(stat.StartTime) / float64(ticks) * float64(time.Second)))
	}

	user := os.Getenv("USER")
	if u, ok := environ["USER"]; ok && u != "" {
		user = u
	}

	lockFile := findLockFileForKind(kind, pid)

	name := stat.Comm
	if len(cmdline) > 0 {
		name = filepath.Base(cmdline[0])
	}

	return TargetProcess{
		PID:         pid,
		PPID:        stat.PPID,
		Kind:        kind,
		Name:        name,
		Executable:  exe,
		CommandLine: cmdline,
		Cwd:         cwd,
		Model:       model,
		User:        user,
		StartTime:   startTime,
		State:       ProcessStateString(stat.State),
		Env:         environ,
		LockFile:    lockFile,
	}, true
}

// MatchKind classifies process characteristics into an AI Assistant TargetKind.
func MatchKind(comm, exe, fullCmd string, env map[string]string) (TargetKind, bool) {
	// Exclude visualizer or tracer own processes to avoid self-detection
	if strings.Contains(comm, "copilot-visualizer") || strings.Contains(exe, "copilot-visualizer") || strings.Contains(fullCmd, "copilot-visualizer") ||
		strings.Contains(comm, "copilot-tracer") || strings.Contains(exe, "copilot-tracer") || strings.Contains(fullCmd, "copilot-tracer") {
		return "", false
	}

	// 1. Antigravity / Agy CLI
	if comm == "antigravity" || comm == "agy" || comm == "antigravity-cli" ||
		filepath.Base(exe) == "antigravity" || filepath.Base(exe) == "agy" ||
		strings.Contains(fullCmd, "antigravity-cli") || strings.Contains(fullCmd, "agy ") || strings.HasSuffix(fullCmd, "agy") {
		return TargetKindAntigravity, true
	}
	if env != nil {
		if _, ok := env["GEMINI_CLI_DATA_DIR"]; ok && (comm == "antigravity" || comm == "agy" || comm == "main") {
			return TargetKindAntigravity, true
		}
	}

	// 2. GitHub Copilot CLI
	if comm == "copilot" || comm == "github-copilot-cli" || comm == "copilot-agent" ||
		filepath.Base(exe) == "copilot" || filepath.Base(exe) == "github-copilot-cli" ||
		strings.Contains(fullCmd, "github-copilot-cli") || strings.Contains(fullCmd, "copilot-agent") ||
		strings.Contains(fullCmd, "@github/copilot") ||
		(strings.Contains(fullCmd, "gh ") && strings.Contains(fullCmd, "copilot")) {
		return TargetKindCopilot, true
	}

	// 3. Claude Code
	if comm == "claude" || comm == "claude-code" ||
		filepath.Base(exe) == "claude" || filepath.Base(exe) == "claude-code" ||
		strings.Contains(fullCmd, "@anthropic-ai/claude-code") ||
		strings.Contains(fullCmd, "claude-code") ||
		(strings.Contains(fullCmd, "claude ") && !strings.Contains(fullCmd, "claudec")) {
		return TargetKindClaude, true
	}

	// 4. Other AI Assistants
	if comm == "aider" || strings.Contains(fullCmd, "aider ") || strings.HasSuffix(fullCmd, "aider") ||
		comm == "cursor" || strings.Contains(fullCmd, "cursor ") {
		return TargetKindGeneric, true
	}

	return "", false
}

// ExtractModel extracts model name from arguments or environment variables.
func ExtractModel(cmdline []string, env map[string]string) string {
	for i := 0; i < len(cmdline); i++ {
		arg := cmdline[i]
		if (arg == "--model" || arg == "-m" || arg == "--model-name") && i+1 < len(cmdline) {
			return cmdline[i+1]
		}
		if strings.HasPrefix(arg, "--model=") {
			return strings.TrimPrefix(arg, "--model=")
		}
		if strings.HasPrefix(arg, "-m=") {
			return strings.TrimPrefix(arg, "-m=")
		}
	}

	// Environment variable checks
	candidates := []string{
		"COPILOT_MODEL",
		"ANTHROPIC_MODEL",
		"CLAUDE_MODEL",
		"GEMINI_MODEL",
		"MODEL_NAME",
		"OPENAI_MODEL",
		"LLM_MODEL",
	}

	for _, k := range candidates {
		if val, ok := env[k]; ok && val != "" {
			return val
		}
	}

	return ""
}

// findLockFileForKind finds known lockfiles for the target assistant.
func findLockFileForKind(kind TargetKind, pid int) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	switch kind {
	case TargetKindCopilot:
		pattern := filepath.Join(home, ".copilot", "session-state", "*", "*")
		matches, _ := filepath.Glob(pattern)
		for _, m := range matches {
			if strings.Contains(m, string(rune(pid))) {
				return m
			}
		}
		return filepath.Join(home, ".copilot")
	case TargetKindClaude:
		claudeDir := filepath.Join(home, ".claude")
		if _, err := os.Stat(claudeDir); err == nil {
			return claudeDir
		}
	case TargetKindAntigravity:
		geminiDir := filepath.Join(home, ".gemini", "antigravity-cli")
		if _, err := os.Stat(geminiDir); err == nil {
			return geminiDir
		}
	}
	return ""
}
