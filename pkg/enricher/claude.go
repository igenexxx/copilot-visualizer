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

// ClaudeEnricher extracts token metrics and session context from Claude Code files and transcripts.
type ClaudeEnricher struct {
	baseDir string
}

// NewClaudeEnricher creates a new Claude enricher.
func NewClaudeEnricher(baseDir string) *ClaudeEnricher {
	if baseDir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			baseDir = filepath.Join(home, ".claude")
		}
	}
	return &ClaudeEnricher{
		baseDir: baseDir,
	}
}

func (c *ClaudeEnricher) ID() string {
	return "claude_enricher"
}

func (c *ClaudeEnricher) Source() string {
	return "claude_code"
}

func (c *ClaudeEnricher) WatchTargets(homeDir string) []string {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	claudeDir := filepath.Join(homeDir, ".claude")
	claudeJson := filepath.Join(homeDir, ".claude.json")
	return []string{claudeDir, claudeJson}
}

func (c *ClaudeEnricher) CanEnrich(sessionID string) bool {
	if sessionID == "" || c.baseDir == "" {
		return false
	}
	// Check if session transcript exists in .claude/
	transcript := filepath.Join(c.baseDir, "projects", sessionID+".jsonl")
	if _, err := os.Stat(transcript); err == nil {
		return true
	}
	return false
}

func (c *ClaudeEnricher) EnrichUsage(sessionID string) (*UsageSummary, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("sessionID cannot be empty")
	}

	summary := &UsageSummary{
		SessionID: sessionID,
		Provider:  "claude_code",
		Model:     "claude-3-7-sonnet",
		UpdatedAt: time.Now().UnixMilli(),
	}

	// Try reading transcript jsonl
	candidates := []string{
		filepath.Join(c.baseDir, "projects", sessionID+".jsonl"),
		filepath.Join(c.baseDir, "transcripts", sessionID+".jsonl"),
		filepath.Join(c.baseDir, sessionID+".jsonl"),
	}

	for _, p := range candidates {
		f, err := os.Open(p)
		if err == nil {
			defer f.Close()
			scanner := bufio.NewScanner(f)

			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "" {
					continue
				}
				summary.TurnCount++

				var raw map[string]any
				if err := json.Unmarshal([]byte(line), &raw); err != nil {
					continue
				}

				if m, ok := raw["model"].(string); ok && m != "" {
					summary.Model = m
				}

				if usage, ok := raw["usage"].(map[string]any); ok {
					var turnIn, turnCacheRead int64
					if in, ok := usage["input_tokens"].(float64); ok {
						summary.InputTokens += int64(in)
						turnIn = int64(in)
					}
					if out, ok := usage["output_tokens"].(float64); ok {
						summary.OutputTokens += int64(out)
					}
					if cr, ok := usage["cache_read_input_tokens"].(float64); ok {
						summary.CacheReadTokens += int64(cr)
						turnCacheRead = int64(cr)
					}
					if cw, ok := usage["cache_creation_input_tokens"].(float64); ok {
						summary.CacheWriteTokens += int64(cw)
					}
					summary.ActiveContextTokens = turnIn + turnCacheRead
				}
			}
			break
		}
	}

	// Claude pricing: Sonnet 3.7 ($3.00/M in, $15.00/M out, $0.30/M cache read, $3.75/M cache write)
	inRate := 3.00 / 1_000_000.0
	outRate := 15.00 / 1_000_000.0
	cacheReadRate := 0.30 / 1_000_000.0
	cacheWriteRate := 3.75 / 1_000_000.0

	if strings.Contains(summary.Model, "opus") {
		inRate = 15.00 / 1_000_000.0
		outRate = 75.00 / 1_000_000.0
		cacheReadRate = 1.50 / 1_000_000.0
		cacheWriteRate = 18.75 / 1_000_000.0
	} else if strings.Contains(summary.Model, "haiku") {
		inRate = 0.80 / 1_000_000.0
		outRate = 4.00 / 1_000_000.0
		cacheReadRate = 0.08 / 1_000_000.0
		cacheWriteRate = 1.00 / 1_000_000.0
	}

	summary.TotalCostUSD = (float64(summary.InputTokens) * inRate) +
		(float64(summary.OutputTokens) * outRate) +
		(float64(summary.CacheReadTokens) * cacheReadRate) +
		(float64(summary.CacheWriteTokens) * cacheWriteRate)

	return summary, nil
}

func (c *ClaudeEnricher) EnrichMetadata(sessionID string) (*SessionMetadata, error) {
	return &SessionMetadata{
		SessionID: sessionID,
		Provider:  "claude_code",
	}, nil
}

func (c *ClaudeEnricher) EnrichContext(sessionID string) (*SessionContext, error) {
	ctx := &SessionContext{
		SessionID:     sessionID,
		Provider:      "claude_code",
		Skills:        make([]SkillItem, 0),
		MCPServers:    make([]MCPServerItem, 0),
		Rules:         make([]RuleItem, 0),
		SlashCommands: make([]SlashCommandItem, 0),
		UpdatedAt:     time.Now().UnixMilli(),
	}

	// 1. Built-in Tools
	tools := []struct {
		id   string
		name string
		desc string
		icon string
		cat  string
	}{
		{"View", "File Viewer", "View file contents with line slices", "🔍", "inspector"},
		{"Edit", "StrReplace Editor", "Contiguous snippet block replace editor", "🛠️", "crafter"},
		{"Bash", "Bash Shell", "Terminal execution sandbox", "🧪", "tester"},
		{"Grep", "Ripgrep Search", "Regex pattern matcher across project tree", "⚡", "search"},
		{"Glob", "Glob Tool", "File and folder matching pattern finder", "📁", "inspector"},
	}
	for _, t := range tools {
		ctx.Skills = append(ctx.Skills, SkillItem{
			ID:          t.id,
			Name:        t.name,
			Description: t.desc,
			Path:        "claude-builtin://" + t.id,
			Icon:        t.icon,
			Category:    t.cat,
			Active:      true,
		})
	}

	// 2. Discover MCP Servers from ~/.claude/config.json
	home, _ := os.UserHomeDir()
	configPath := filepath.Join(home, ".claude", "config.json")
	if data, err := os.ReadFile(configPath); err == nil {
		var cfg map[string]any
		if err := json.Unmarshal(data, &cfg); err == nil {
			if servers, ok := cfg["mcpServers"].(map[string]any); ok {
				for sName := range servers {
					ctx.MCPServers = append(ctx.MCPServers, MCPServerItem{
						ID:     sName,
						Name:   sName,
						Icon:   "🔌",
						Active: true,
					})
				}
			}
		}
	}

	// 3. Rules & Guidelines (CLAUDE.md)
	ctx.Rules = append(ctx.Rules, RuleItem{
		ID:      "claude_md",
		Title:   "Project Instructions (CLAUDE.md)",
		Content: "Project guidance, code style, and test commands from CLAUDE.md.",
		Type:    "project",
		Icon:    "📜",
	})

	// 4. Slash Commands
	ctx.SlashCommands = []SlashCommandItem{
		{Name: "/compact", Description: "Compact conversation history to reclaim context window", Icon: "📦"},
		{Name: "/cost", Description: "Display token usage statistics and monetary cost", Icon: "💰"},
		{Name: "/doctor", Description: "Health check for toolchains and environment variables", Icon: "🩺"},
		{Name: "/help", Description: "List all built-in commands and operational manual", Icon: "❓"},
		{Name: "/init", Description: "Generate starter CLAUDE.md memory configuration", Icon: "⚡"},
		{Name: "/review", Description: "Request peer review from LLM reviewer", Icon: "🔍"},
	}

	return ctx, nil
}
