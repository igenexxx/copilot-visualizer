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

func (a *AntigravityEnricher) EnrichContext(sessionID string) (*SessionContext, error) {
	ctx := &SessionContext{
		SessionID:     sessionID,
		Provider:      "antigravity",
		Skills:        make([]SkillItem, 0),
		MCPServers:    make([]MCPServerItem, 0),
		Rules:         make([]RuleItem, 0),
		SlashCommands: make([]SlashCommandItem, 0),
		UpdatedAt:     time.Now().UnixMilli(),
	}

	// 1. Discover Registered Skills from all skill directories
	homeDir, _ := os.UserHomeDir()
	skillDirs := []string{
		filepath.Join(a.baseDir, "config", "skills"),
		filepath.Join(a.baseDir, "antigravity-cli", "builtin", "skills"),
		filepath.Join(homeDir, ".agents", "skills"),
	}

	skillMap := make(map[string]*SkillItem)
	for _, dir := range skillDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			skillPath := filepath.Join(dir, entry.Name())
			skillMdPath := filepath.Join(skillPath, "SKILL.md")
			// Resolve symlinks if needed
			if entry.Type()&os.ModeSymlink != 0 {
				if target, err := filepath.EvalSymlinks(skillPath); err == nil {
					skillMdPath = filepath.Join(target, "SKILL.md")
				}
			}

			contentBytes, err := os.ReadFile(skillMdPath)
			if err != nil {
				continue
			}

			name, desc := parseSkillFrontmatter(string(contentBytes), entry.Name())
			if _, exists := skillMap[name]; !exists {
				category := "general"
				if strings.Contains(name, "angular") || strings.Contains(name, "web") || strings.Contains(name, "ngrx") {
					category = "frontend"
				} else if strings.Contains(name, "go") || strings.Contains(name, "adk") {
					category = "backend"
				} else if strings.Contains(name, "deploy") || strings.Contains(name, "publish") || strings.Contains(name, "server") {
					category = "devops"
				} else if strings.Contains(name, "eval") || strings.Contains(name, "observability") {
					category = "analytics"
				}

				icon := pickSkillIcon(name)
				item := &SkillItem{
					ID:          name,
					Name:        name,
					Description: desc,
					Path:        skillMdPath,
					Icon:        icon,
					Category:    category,
					Active:      false,
				}
				skillMap[name] = item
			}
		}
	}

	// 2. Discover MCP Servers from ~/.gemini/antigravity-cli/mcp/
	mcpDir := filepath.Join(a.baseDir, "antigravity-cli", "mcp")
	mcpMap := make(map[string]*MCPServerItem)
	if entries, err := os.ReadDir(mcpDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			serverName := entry.Name()
			serverPath := filepath.Join(mcpDir, serverName)
			toolFiles, _ := os.ReadDir(serverPath)
			tools := make([]string, 0)
			for _, tf := range toolFiles {
				if strings.HasSuffix(tf.Name(), ".json") {
					tools = append(tools, strings.TrimSuffix(tf.Name(), ".json"))
				}
			}
			icon := pickMCPIcon(serverName)
			mcpMap[serverName] = &MCPServerItem{
				ID:         serverName,
				Name:       serverName,
				ToolsCount: len(tools),
				Tools:      tools,
				Icon:       icon,
				Active:     false,
			}
		}
	}

	// 3. Scan transcript to detect active skills & MCP usage
	transcriptPath := filepath.Join(a.baseDir, "antigravity-cli", "brain", sessionID, ".system_generated", "logs", "transcript.jsonl")
	if file, err := os.Open(transcriptPath); err == nil {
		defer file.Close()
		scanner := bufio.NewScanner(file)
		buf := make([]byte, 1024*1024)
		scanner.Buffer(buf, 10*1024*1024)

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			var raw map[string]any
			if err := json.Unmarshal([]byte(line), &raw); err != nil {
				continue
			}

			// Check tool calls
			if tools, ok := raw["tool_calls"].([]any); ok {
				for _, t := range tools {
					if tMap, ok := t.(map[string]any); ok {
						toolName, _ := tMap["name"].(string)
						args, _ := tMap["args"].(map[string]any)

						// Skill activation check
						if (toolName == "view_file" || toolName == "read_file") && args != nil {
							absPath, _ := args["AbsolutePath"].(string)
							if absPath == "" {
								absPath, _ = args["path"].(string)
							}
							for name, sk := range skillMap {
								if strings.Contains(absPath, name) || (sk.Path != "" && absPath == sk.Path) {
									sk.Active = true
									sk.ActivationsCount++
									sk.LastUsed = time.Now().UnixMilli()
								}
							}
						}

						// MCP usage check
						if toolName == "call_mcp_tool" && args != nil {
							sName, _ := args["ServerName"].(string)
							if mcp, exists := mcpMap[sName]; exists {
								mcp.Active = true
								mcp.CallsCount++
								mcp.LastUsed = time.Now().UnixMilli()
							}
						}
					}
				}
			}
		}
	}

	for _, sk := range skillMap {
		ctx.Skills = append(ctx.Skills, *sk)
	}
	for _, mcp := range mcpMap {
		ctx.MCPServers = append(ctx.MCPServers, *mcp)
	}

	// 4. Default Rules & Instructions
	rulesDir := filepath.Join(a.baseDir, "config", "rules")
	if entries, err := os.ReadDir(rulesDir); err == nil {
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".md") || strings.HasSuffix(entry.Name(), ".txt") {
				c, _ := os.ReadFile(filepath.Join(rulesDir, entry.Name()))
				ctx.Rules = append(ctx.Rules, RuleItem{
					ID:      entry.Name(),
					Title:   strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())),
					Content: string(c),
					Type:    "global",
					Icon:    "📜",
				})
			}
		}
	}
	// Add user memory rule
	ctx.Rules = append(ctx.Rules, RuleItem{
		ID:      "user_global_memory",
		Title:   "Engineering Guidelines (Zhenya)",
		Content: "SOLID, DRY, KISS, YAGNI. Aim for 90%+ test coverage. Table-driven adversarial Go tests with -race. English UI only. iconv UTF-16LE for clipboard.",
		Type:    "memory",
		Icon:    "🧠",
	})

	// 5. Slash Commands
	ctx.SlashCommands = []SlashCommandItem{
		{Name: "/plan", Description: "Step-by-step implementation plan and architectural breakdown", Icon: "📋"},
		{Name: "/grill-me", Description: "Adversarial interview to resolve design decisions and edge cases", Icon: "🔥"},
		{Name: "/learn", Description: "Persist lessons learned and developer corrections for future tasks", Icon: "🧠"},
		{Name: "/schedule", Description: "Set one-shot timers or recurring cron tasks for notifications", Icon: "⏰"},
	}

	return ctx, nil
}

func parseSkillFrontmatter(content string, fallbackName string) (string, string) {
	name := fallbackName
	desc := "Agent skill extension"

	lines := strings.Split(content, "\n")
	inFrontmatter := false
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed == "---" {
			if inFrontmatter {
				break
			}
			inFrontmatter = true
			continue
		}
		if inFrontmatter {
			if strings.HasPrefix(trimmed, "name:") {
				name = strings.TrimSpace(strings.TrimPrefix(trimmed, "name:"))
			} else if strings.HasPrefix(trimmed, "description:") {
				desc = strings.TrimSpace(strings.TrimPrefix(trimmed, "description:"))
			}
		}
	}
	return name, desc
}

func pickSkillIcon(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "angular"):
		return "🅰️"
	case strings.Contains(n, "go") || strings.Contains(n, "adk"):
		return "🐹"
	case strings.Contains(n, "deploy") || strings.Contains(n, "publish"):
		return "🚀"
	case strings.Contains(n, "eval") || strings.Contains(n, "observability"):
		return "⚖️"
	case strings.Contains(n, "server") || strings.Contains(n, "home"):
		return "🖥️"
	case strings.Contains(n, "web") || strings.Contains(n, "chrome"):
		return "🌐"
	case strings.Contains(n, "find") || strings.Contains(n, "guide"):
		return "🧭"
	default:
		return "⚡"
	}
}

func pickMCPIcon(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "chrome") || strings.Contains(n, "web"):
		return "🌐"
	case strings.Contains(n, "github"):
		return "🐙"
	case strings.Contains(n, "gopls"):
		return "📐"
	case strings.Contains(n, "firebase"):
		return "🔥"
	case strings.Contains(n, "genkit"):
		return "🧬"
	case strings.Contains(n, "stitch"):
		return "🎨"
	default:
		return "🔌"
	}
}
