package enricher

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AntigravityEnricher extracts token metrics and session metadata from Antigravity / Gemini logs and SQLite DBs.
type AntigravityEnricher struct {
	baseDir string
}

// NewAntigravityEnricher creates a new Antigravity enricher.
func NewAntigravityEnricher(baseDir string) *AntigravityEnricher {
	if baseDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			baseDir = filepath.Join(home, ".gemini")
		}
	}
	return &AntigravityEnricher{
		baseDir: baseDir,
	}
}

func (a *AntigravityEnricher) ID() string {
	return "antigravity_enricher"
}

func (a *AntigravityEnricher) Source() string {
	return "antigravity"
}

func (a *AntigravityEnricher) WatchTargets(homeDir string) []string {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	ideDir := filepath.Join(homeDir, ".gemini", "antigravity-ide", "conversations")
	cliDir := filepath.Join(homeDir, ".gemini", "antigravity-cli", "brain")
	histDir := filepath.Join(homeDir, ".gemini", "history")
	return []string{ideDir, cliDir, histDir}
}

func (a *AntigravityEnricher) CanEnrich(sessionID string) bool {
	if sessionID == "" || a.baseDir == "" {
		return false
	}
	// Check CLI brain directory
	cliPath := filepath.Join(a.baseDir, "antigravity-cli", "brain", sessionID)
	if info, err := os.Stat(cliPath); err == nil && info.IsDir() {
		return true
	}
	// Check IDE database
	ideDB := filepath.Join(a.baseDir, "antigravity-ide", "conversations", sessionID+".db")
	if info, err := os.Stat(ideDB); err == nil && !info.IsDir() {
		return true
	}
	return false
}

func (a *AntigravityEnricher) EnrichUsage(sessionID string) (*UsageSummary, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("sessionID cannot be empty")
	}

	summary := &UsageSummary{
		SessionID: sessionID,
		Provider:  "antigravity",
		Model:     "gemini-3.7-flash",
		UpdatedAt: time.Now().UnixMilli(),
	}

	// Try reading transcript.jsonl if available
	transcriptPath := filepath.Join(a.baseDir, "antigravity-cli", "brain", sessionID, ".system_generated", "logs", "transcript.jsonl")
	file, err := os.Open(transcriptPath)
	if err == nil {
		defer file.Close()
		scanner := bufio.NewScanner(file)
		// Max line size buffer for large steps
		buf := make([]byte, 1024*1024)
		scanner.Buffer(buf, 10*1024*1024)

		var inputChars, outputChars int64
		var turnCount int

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			turnCount++

			var raw map[string]any
			if err := json.Unmarshal([]byte(line), &raw); err != nil {
				continue
			}

			content, _ := raw["content"].(string)
			src, _ := raw["source"].(string)

			thinking, _ := raw["thinking"].(string)
			outputChars += int64(len(thinking))

			if tools, ok := raw["tool_calls"].([]any); ok {
				for _, t := range tools {
					if tMap, ok := t.(map[string]any); ok {
						if args, ok := tMap["args"].(map[string]any); ok {
							argsBytes, _ := json.Marshal(args)
							inputChars += int64(len(argsBytes))
						}
					}
				}
			}

			// Detect model changes
			if strings.Contains(content, "Model Selection") {
				if strings.Contains(content, "Gemini 3.7 Flash") {
					summary.Model = "gemini-3.7-flash"
				} else if strings.Contains(content, "Gemini 2.5 Pro") || strings.Contains(content, "Gemini Pro") {
					summary.Model = "gemini-2.5-pro"
				}
			}

			if src == "USER_EXPLICIT" || src == "SYSTEM" {
				inputChars += int64(len(content))
			} else if src == "MODEL" {
				outputChars += int64(len(content))
			}
		}

		// Base system context (system prompt 9k + system tools 14.2k + skills 4.4k + subagents 0.6k = ~28.2k tokens)
		const systemOverheadTokens = 28250

		// Gemini tokenizer averages ~3.65 chars per token on code & Markdown
		summary.InputTokens = (inputChars / 365 * 100) + systemOverheadTokens
		summary.OutputTokens = outputChars / 365 * 100
		summary.TurnCount = turnCount

		// Pricing: Gemini 3.7 Flash ($0.075 / 1M in, $0.30 / 1M out)
		inRate := 0.075 / 1_000_000.0
		outRate := 0.30 / 1_000_000.0
		if strings.Contains(summary.Model, "pro") {
			inRate = 1.25 / 1_000_000.0
			outRate = 5.00 / 1_000_000.0
		}
		summary.TotalCostUSD = (float64(summary.InputTokens) * inRate) + (float64(summary.OutputTokens) * outRate)
		return summary, nil
	}

	return summary, nil
}

func (a *AntigravityEnricher) EnrichMetadata(sessionID string) (*SessionMetadata, error) {
	meta := &SessionMetadata{
		SessionID: sessionID,
		Provider:  "antigravity",
	}

	// Try reading projects.json
	projectsPath := filepath.Join(a.baseDir, "projects.json")
	if data, err := os.ReadFile(projectsPath); err == nil {
		var projects map[string]any
		if err := json.Unmarshal(data, &projects); err == nil {
			if recent, ok := projects["recentProjects"].([]any); ok && len(recent) > 0 {
				if first, ok := recent[0].(string); ok {
					meta.Cwd = first
					meta.Repository = filepath.Base(first)
				}
			}
		}
	}

	return meta, nil
}
