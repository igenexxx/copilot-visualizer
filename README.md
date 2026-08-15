# 🏭 Copilot Visualizer // Industrial Workshop & Flow Graph

![Copilot Visualizer Screenshot](docs/assets/screenshot.png)

**Copilot Visualizer** is a real-time event visualization and telemetry system for AI coding sessions (GitHub Copilot CLI, MCP servers, and Agent frameworks).

It translates coding agent workflows into an interactive **Factory Workshop Game Floor** (isometric 2D canvas) and a **Causal Flow Graph**, featuring live worker sprites, workstations, conveyor belts, spark particle systems, and live inspection drawers.

---

## 🌟 Workshop Metaphor Mapping

| Agent Activity | Workshop Element | Visual Behavior |
| :--- | :--- | :--- |
| **Foreman / Orchestrator** | **Master Command Desk** | Central drafting board with glowing blueprints & planning thought bubbles |
| **Code Reading (`view_file`)** | **Filing Vault** | Steel archive cabinets with blue scanning light |
| **Code Search (`grep_search`)** | **Search Radar** | Hexagonal base with oscillating radar sweep beam |
| **File Writing & Patching** | **CNC Machining Lathe** | High-precision laser cutter, forging new code parts with flying sparks |
| **Command & Test Execution** | **Test Furnace** | Reactor furnace with steam/exhaust & green pass flame |
| **MCP Server Call** | **Phone Booth & Dispatch** | Vintage telephone booth with ringing lights & pneumatic delivery tube |
| **Subagent Delegation** | **Specialist Worker** | Worker clocks in through workshop entrance, walks to assigned station |
| **Session Completion / PR** | **Shipping Conveyor** | Finished code crate delivered along conveyor belt with confetti celebration |

---

## 🚀 Quick Start (Single Standalone Binary)

### 1. Build Single Binary with Embedded UI

```bash
# Build frontend assets
npm --prefix web run build

# Compile single standalone binary with embedded UI
go build -o copilot-visualizer ./cmd/server
```

### 2. Run Anywhere (Zero Dependencies)

```bash
./copilot-visualizer
```

Open [http://localhost:9876](http://localhost:9876) in your browser. All HTML, CSS, JS, and SVG assets are compiled directly into the binary!

---

## 🕹️ Modes of Operation

### 1. Interactive Demo Simulator (Default)
Simulates realistic multi-agent sessions (Foreman planning, Grep searching, subagent delegation, CNC lathe code forging, MCP security scanning, and test running).
* **Speed Slider**: `0.5x`, `1.0x`, `2.0x`, `4.0x`
* **Controls**: Play / Pause / Step / Inject custom test event

### 2. MCP Proxy Mode (Transparent JSON-RPC Shim)
Wrap any MCP server toolchain to automatically intercept tool calls and stream live factory telemetry:
```bash
./bin/copilot-visualizer --mcp-proxy
```

### 3. Log / Session Transcript Tailer Mode
Watch JSONL session logs from Copilot or CLI agent transcripts:
```bash
./bin/copilot-visualizer --tail=/path/to/session.jsonl
```

### 4. Direct REST / WebSocket Ingestion
Send events from any script or shell hook:
```bash
curl -X POST http://localhost:9876/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt-101",
    "sessionId": "sess-live",
    "type": "file.write",
    "agentId": "agent-crafter",
    "agentRole": "crafter",
    "station": "cnc_lathe",
    "title": "Forging auth_middleware.go",
    "summary": "Added rate limiter token bucket",
    "payload": { "lines": 42 }
  }'
```

---

## 🧪 Testing & Quality Standards

The backend is built in idiomatic Go with **~90% test coverage**, zero-value edge cases, and `-race` safety:
```bash
go test ./pkg/... -v -race -cover
```
