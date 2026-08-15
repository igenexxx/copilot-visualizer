import './style.css';
import confetti from 'canvas-confetti';
import type { VisualizerEvent } from './types';
import { VisualizerClient } from './services/ws';
import { WorkshopCanvas } from './canvas/workshop';
import { FlowGraphCanvas } from './canvas/graph';

class App {
  private client: VisualizerClient;
  private workshopCanvas!: WorkshopCanvas;
  private graphCanvas!: FlowGraphCanvas;

  private events: VisualizerEvent[] = [];
  private isSimRunning = true;
  private emergencyStopActive = false;
  private activeSessionId = 'global';

  // Metrics
  private stats = {
    totalEvents: 0,
    filesWritten: 0,
    mcpCalls: 0,
    testsRun: 0,
    activeAgents: 1,
  };

  constructor() {
    this.client = new VisualizerClient();
    this.initDOM();
    this.initCanvases();
    this.setupSubscriptions();
    this.client.connect();
    this.loadInitialHistory();
  }

  private initDOM(): void {
    const appEl = document.getElementById('app')!;
    appEl.innerHTML = `
      <header class="header">
        <div class="brand">
          <span class="brand-icon">🏭</span>
          <span class="brand-title">COPILOT VISUALIZER</span>
          <span class="brand-sub">WORKSHOP ENGINE</span>
        </div>

        <div class="header-center">
          <button id="btn-view-workshop" class="view-btn active">🏭 Workshop Floor</button>
          <button id="btn-view-graph" class="view-btn">🕸️ Flow Graph</button>
          <button id="btn-view-split" class="view-btn">⚡ Split Dual</button>
          <button id="btn-spread-graph" class="view-btn" title="Unfold and neatly organize graph columns">📐 Spread Graph</button>
          <button id="btn-center-graph" class="view-btn" title="Center & Fit View">🎯 Center View</button>
        </div>

        <div class="header-right">
          <button id="btn-estop" class="btn-estop" title="Emergency Stop Lever">
            <span>🚨</span>
            <span id="estop-label">E-STOP BRAKE</span>
          </button>

          <div id="session-badge" class="session-badge" title="Auto-discovered session">
            <span class="session-dot"></span>
            <span id="session-text">SEARCHING SESSIONS...</span>
          </div>

          <div class="status-pill">
            <span id="ws-dot" class="status-dot"></span>
            <span id="ws-text">CONNECTING...</span>
          </div>

          <button id="btn-sim-toggle" class="control-btn">⏸ Pause</button>
          <select id="sim-speed" class="speed-select">
            <option value="0.5">0.5x Speed</option>
            <option value="1.0" selected>1.0x Speed</option>
            <option value="2.0">2.0x Speed</option>
            <option value="4.0">4.0x Speed</option>
          </select>
          <button id="btn-trigger-burst" class="control-btn" title="Inject custom test event">⚡ Inject Event</button>
          <button id="btn-clear" class="control-btn">Clear</button>
        </div>
      </header>

      <div class="main-container">
        <main class="viewport-area">
          <div id="workshop-container" class="canvas-container">
            <canvas id="workshop-canvas"></canvas>
          </div>
          <div id="graph-container" class="canvas-container" style="display: none;">
            <canvas id="graph-canvas"></canvas>
          </div>

          <div class="hud-overlay">
            <div class="hud-card">
              <span>EVENTS</span>
              <span id="hud-events" class="hud-val">0</span>
            </div>
            <div class="hud-card">
              <span>ACTIVE WORKERS</span>
              <span id="hud-workers" class="hud-val">1</span>
            </div>
            <div class="hud-card">
              <span>FILES FORGED</span>
              <span id="hud-files" class="hud-val">0</span>
            </div>
            <div class="hud-card">
              <span>MCP RPC CALLS</span>
              <span id="hud-mcp" class="hud-val">0</span>
            </div>
          </div>
        </main>

        <aside class="sidebar">
          <!-- Foreman Intercom Section -->
          <div class="intercom-section">
            <div class="intercom-title">
              <span>📻</span>
              <span>Foreman Intercom (Guide Agent)</span>
            </div>
            <form id="intercom-form" class="intercom-form">
              <input
                id="intercom-input"
                class="intercom-input"
                type="text"
                placeholder="Send prompt or guidance to agent..."
                autocomplete="off"
              />
              <button type="submit" class="intercom-send-btn">Send</button>
            </form>
            <div class="intercom-chips">
              <button type="button" class="chip-btn" data-msg="Focus on fixing unit test failures">🎯 Fix Tests</button>
              <button type="button" class="chip-btn" data-msg="Verify concurrency and race condition safety">🏎️ Race Safe</button>
              <button type="button" class="chip-btn" data-msg="Revert last modification and try alternate approach">↩️ Revert Last</button>
              <button type="button" class="chip-btn" data-msg="Perform security audit on all input bounds">🛡️ Security Check</button>
            </div>
          </div>

          <div class="sidebar-header">
            <span class="sidebar-title">Station & Agent Inspector</span>
          </div>

          <div id="inspector-pane" class="inspector-pane">
            <div class="inspector-title">
              <span id="insp-icon">🏭</span>
              <span id="insp-title">Select any Station or Worker</span>
            </div>
            <div id="insp-desc" class="inspector-desc">
              Click on a workstation on the shop floor or node in the graph to inspect live telemetry and execution parameters.
            </div>
            <pre id="insp-payload" class="inspector-json" style="display: none;"></pre>
          </div>

          <div class="sidebar-header">
            <span class="sidebar-title">Live Event Stream</span>
            <span id="stream-count" style="font-size: 10px; font-family: monospace; color: var(--text-muted);">0 events</span>
          </div>

          <div id="feed-pane" class="feed-pane"></div>
        </aside>
      </div>

      <!-- Checkpoint Approval Dialog Modal Container -->
      <div id="checkpoint-modal" class="checkpoint-overlay" style="display: none;">
        <div class="checkpoint-card">
          <div class="checkpoint-header">
            <span>⚠️</span>
            <span id="cp-modal-title">HUMAN-IN-THE-LOOP CHECKPOINT</span>
          </div>
          <div id="cp-modal-desc" class="checkpoint-desc"></div>
          <div class="checkpoint-actions">
            <button id="btn-cp-reject" class="btn-reject">❌ Reject Action</button>
            <button id="btn-cp-approve" class="btn-approve">✅ Approve & Execute</button>
          </div>
        </div>
      </div>
    `;

    this.bindControls();
  }

  private initCanvases(): void {
    const wsCanvasEl = document.getElementById('workshop-canvas') as HTMLCanvasElement;
    const grCanvasEl = document.getElementById('graph-canvas') as HTMLCanvasElement;

    this.workshopCanvas = new WorkshopCanvas(wsCanvasEl);
    this.graphCanvas = new FlowGraphCanvas(grCanvasEl);

    this.workshopCanvas.onSelectElement = (type, data) => {
      this.renderInspector(type === 'station' ? `⚙️ ${data.name}` : `👷 ${data.name}`, data.description || 'Specialist agent on duty', data.lastEvent?.payload);
    };

    this.graphCanvas.onSelectNode = (node) => {
      this.renderInspector(`🕸️ ${node.label}`, `Group: ${node.group.toUpperCase()} | ID: ${node.id}`, { sublabel: node.sublabel, timestamp: node.timestamp });
    };

    this.workshopCanvas.start();
    this.graphCanvas.start();
  }

  private bindControls(): void {
    const btnWorkshop = document.getElementById('btn-view-workshop')!;
    const btnGraph = document.getElementById('btn-view-graph')!;
    const btnSplit = document.getElementById('btn-view-split')!;

    const wsCont = document.getElementById('workshop-container')!;
    const grCont = document.getElementById('graph-container')!;

    const setView = (view: 'workshop' | 'graph' | 'split') => {
      btnWorkshop.classList.toggle('active', view === 'workshop');
      btnGraph.classList.toggle('active', view === 'graph');
      btnSplit.classList.toggle('active', view === 'split');

      if (view === 'workshop') {
        wsCont.style.display = 'block';
        grCont.style.display = 'none';
      } else if (view === 'graph') {
        wsCont.style.display = 'none';
        grCont.style.display = 'block';
      } else {
        wsCont.style.display = 'block';
        grCont.style.display = 'block';
      }
      this.workshopCanvas.resize();
      this.graphCanvas.resize();
    };

    btnWorkshop.addEventListener('click', () => setView('workshop'));
    btnGraph.addEventListener('click', () => {
      setView('graph');
      this.graphCanvas.centerView();
    });
    btnSplit.addEventListener('click', () => setView('split'));

    const btnSpread = document.getElementById('btn-spread-graph')!;
    btnSpread.addEventListener('click', () => {
      this.graphCanvas.spreadLayout();
    });

    const btnCenter = document.getElementById('btn-center-graph')!;
    btnCenter.addEventListener('click', () => {
      this.graphCanvas.centerView();
    });

    // Emergency Stop Button
    const btnEstop = document.getElementById('btn-estop')!;
    btnEstop.addEventListener('click', async () => {
      this.emergencyStopActive = !this.emergencyStopActive;
      btnEstop.classList.toggle('active', this.emergencyStopActive);
      document.getElementById('estop-label')!.textContent = this.emergencyStopActive ? 'BRAKE ACTIVE (LIFT)' : 'E-STOP BRAKE';
      await this.client.toggleEmergencyStop(this.emergencyStopActive, this.emergencyStopActive ? 'Manual developer emergency brake' : 'Developer cleared emergency stop');
    });

    // Intercom Submission
    const intercomForm = document.getElementById('intercom-form') as HTMLFormElement;
    const intercomInput = document.getElementById('intercom-input') as HTMLInputElement;

    intercomForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = intercomInput.value.trim();
      if (!msg) return;
      await this.client.sendIntercom(this.activeSessionId, msg);
      intercomInput.value = '';
    });

    // Intercom Quick Chips
    document.querySelectorAll('.chip-btn').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const msg = chip.getAttribute('data-msg');
        if (msg) {
          await this.client.sendIntercom(this.activeSessionId, msg);
        }
      });
    });

    // Simulation toggle
    const btnSim = document.getElementById('btn-sim-toggle')!;
    btnSim.addEventListener('click', async () => {
      if (this.isSimRunning) {
        await this.client.stopSimulator();
        this.isSimRunning = false;
        btnSim.textContent = '▶ Resume';
      } else {
        await this.client.startSimulator(true);
        this.isSimRunning = true;
        btnSim.textContent = '⏸ Pause';
      }
    });

    // Speed selector
    const speedSelect = document.getElementById('sim-speed') as HTMLSelectElement;
    speedSelect.addEventListener('change', async () => {
      const speed = parseFloat(speedSelect.value);
      await this.client.setSimulatorSpeed(speed);
    });

    // Inject custom event (includes checkpoint simulation)
    const btnInject = document.getElementById('btn-trigger-burst')!;
    btnInject.addEventListener('click', async () => {
      const sampleEvents: Partial<VisualizerEvent>[] = [
        {
          id: `manual-cp-${Date.now()}`,
          sessionId: this.activeSessionId,
          type: 'checkpoint.request',
          agentId: 'agent-crafter-1',
          agentRole: 'crafter',
          station: 'security_gate',
          title: '⚠️ Checkpoint: rm -rf build/ && git push',
          summary: 'Agent requests permission to wipe build directory and push to remote',
          payload: { checkpointId: `cp-${Date.now()}`, actionType: 'run_command', description: 'rm -rf build/ && git push' },
        },
        {
          id: `manual-write-${Date.now()}`,
          sessionId: this.activeSessionId,
          type: 'file.write',
          agentId: 'agent-crafter-1',
          agentRole: 'crafter',
          station: 'cnc_lathe',
          title: 'Manual Forge: api_client.go',
          summary: 'Injected custom code write event with sparks',
          payload: { file: 'pkg/api/client.go', lines: 54 },
        },
      ];
      const randomEvt = sampleEvents[Math.floor(Math.random() * sampleEvents.length)];
      await this.client.ingestEvent(randomEvt);
    });

    // Clear feed
    const btnClear = document.getElementById('btn-clear')!;
    btnClear.addEventListener('click', () => {
      this.events = [];
      const feed = document.getElementById('feed-pane')!;
      feed.innerHTML = '';
      document.getElementById('stream-count')!.textContent = '0 events';
    });
  }

  private setupSubscriptions(): void {
    const wsDot = document.getElementById('ws-dot')!;
    const wsText = document.getElementById('ws-text')!;

    this.client.onStatus((connected) => {
      wsDot.classList.toggle('connected', connected);
      wsText.textContent = connected ? 'LIVE WS CONNECTED' : 'DISCONNECTED (RETRYING)';
    });

    this.client.onEvent((event) => {
      this.handleIncomingEvent(event);
    });
  }

  private async loadInitialHistory(): Promise<void> {
    const history = await this.client.fetchHistory();
    history.forEach((evt) => this.handleIncomingEvent(evt));

    const sessions = await this.client.fetchSessions();
    if (sessions && sessions.length > 0) {
      const active = sessions[0];
      this.activeSessionId = active.id;
      const sessEl = document.getElementById('session-text');
      if (sessEl) {
        sessEl.textContent = `${active.source.toUpperCase()}: ${active.id.slice(0, 10)}`;
      }
    }
  }

  private handleIncomingEvent(event: VisualizerEvent): void {
    this.events.unshift(event);
    if (this.events.length > 100) this.events.pop();

    if (event.sessionId && event.sessionId !== 'global') {
      this.activeSessionId = event.sessionId;
      const sessEl = document.getElementById('session-text');
      if (sessEl) {
        sessEl.textContent = `LIVE: ${event.sessionId.slice(0, 12)}`;
      }
    }

    // Handle Emergency Stop event
    if (event.type === 'emergency.stop') {
      this.emergencyStopActive = event.payload?.active === true;
      const btnEstop = document.getElementById('btn-estop')!;
      btnEstop.classList.toggle('active', this.emergencyStopActive);
      document.getElementById('estop-label')!.textContent = this.emergencyStopActive ? 'BRAKE ACTIVE (LIFT)' : 'E-STOP BRAKE';
    }

    // Handle Checkpoint Approval Prompt Modal
    if (event.type === 'checkpoint.request') {
      this.showCheckpointModal(event);
    }

    // Update stats
    this.stats.totalEvents++;
    if (event.type === 'file.write') this.stats.filesWritten++;
    if (event.type === 'mcp.call') this.stats.mcpCalls++;
    if (event.type === 'command.run' || event.type === 'command.output') this.stats.testsRun++;
    this.stats.activeAgents = Math.max(1, this.workshopCanvas.workers.size);

    this.updateHUD();

    // Pass to canvas engines
    this.workshopCanvas.handleEvent(event);
    this.graphCanvas.handleEvent(event);

    // Celebrate session completion with confetti
    if (event.type === 'session.end') {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#f59e0b', '#06b6d4', '#10b981'],
      });
    }

    this.appendFeedItem(event);
  }

  private showCheckpointModal(event: VisualizerEvent): void {
    const modal = document.getElementById('checkpoint-modal')!;
    const descEl = document.getElementById('cp-modal-desc')!;
    const btnApprove = document.getElementById('btn-cp-approve')!;
    const btnReject = document.getElementById('btn-cp-reject')!;

    const cpId = event.payload?.checkpointId || event.id;
    const actionDesc = event.summary || event.title;

    descEl.textContent = actionDesc;
    modal.style.display = 'flex';

    btnApprove.onclick = async () => {
      await this.client.respondCheckpoint(cpId, 'APPROVED', 'Developer manually approved via UI checkpoint');
      modal.style.display = 'none';
    };

    btnReject.onclick = async () => {
      await this.client.respondCheckpoint(cpId, 'REJECTED', 'Developer rejected operation');
      modal.style.display = 'none';
    };
  }

  private updateHUD(): void {
    document.getElementById('hud-events')!.textContent = String(this.stats.totalEvents);
    document.getElementById('hud-workers')!.textContent = String(this.stats.activeAgents);
    document.getElementById('hud-files')!.textContent = String(this.stats.filesWritten);
    document.getElementById('hud-mcp')!.textContent = String(this.stats.mcpCalls);
    document.getElementById('stream-count')!.textContent = `${this.events.length} events`;
  }

  private appendFeedItem(event: VisualizerEvent): void {
    const feed = document.getElementById('feed-pane')!;
    const item = document.createElement('div');
    item.className = 'feed-item';

    let badgeClass = 'badge-think';
    if (event.type.startsWith('file.write')) badgeClass = 'badge-file-write';
    else if (event.type.startsWith('file.read')) badgeClass = 'badge-file-read';
    else if (event.type.startsWith('mcp.')) badgeClass = 'badge-mcp';
    else if (event.type.startsWith('command.')) badgeClass = 'badge-command';
    else if (event.type.startsWith('session.')) badgeClass = 'badge-session';
    else if (event.type === 'checkpoint.request' || event.type === 'checkpoint.decision') badgeClass = 'badge-checkpoint';
    else if (event.type === 'intervention.prompt') badgeClass = 'badge-intercom';
    else if (event.type === 'emergency.stop') badgeClass = 'badge-estop';

    const timeStr = new Date(event.timestamp).toLocaleTimeString([], { hour12: false });

    item.innerHTML = `
      <div class="feed-item-header">
        <span class="feed-badge ${badgeClass}">${event.type}</span>
        <span class="feed-time">${timeStr}</span>
      </div>
      <div class="feed-title">${event.title}</div>
      ${event.summary ? `<div class="feed-summary">${event.summary}</div>` : ''}
    `;

    item.addEventListener('click', () => {
      this.renderInspector(`⚡ ${event.title}`, event.summary || event.type, event.payload);
    });

    feed.prepend(item);

    while (feed.children.length > 50) {
      feed.removeChild(feed.lastChild!);
    }
  }

  private renderInspector(title: string, desc: string, payload?: Record<string, any>): void {
    document.getElementById('insp-title')!.textContent = title;
    document.getElementById('insp-desc')!.textContent = desc;

    const payloadEl = document.getElementById('insp-payload')!;
    if (payload && Object.keys(payload).length > 0) {
      payloadEl.style.display = 'block';
      payloadEl.textContent = JSON.stringify(payload, null, 2);
    } else {
      payloadEl.style.display = 'none';
    }
  }
}

// Launch application
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
