import './style.css';
import confetti from 'canvas-confetti';
import type { VisualizerEvent } from './types';
import { VisualizerClient } from './services/ws';
import { WorkshopCanvas } from './canvas/workshop';
import { FlowGraphCanvas } from './canvas/graph';
import { RPGEngine } from './rpg/engine';
import { TokenomicsTracker } from './tokenomics/tracker';
import { SoundscapeEngine } from './audio/soundscape';

class App {
  private client: VisualizerClient;
  private workshopCanvas!: WorkshopCanvas;
  private graphCanvas!: FlowGraphCanvas;
  private rpg: RPGEngine;
  private tokenomics: TokenomicsTracker;
  private soundscape: SoundscapeEngine;

  private allEvents: VisualizerEvent[] = [];
  private currentPlaybackIndex = -1;
  private isPlayingTape = false;
  private tapePlayInterval: number | null = null;

  private isInitialLoading = false;
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

  private repoFolders: any[] = [];
  private saveTimer: any = null;

  constructor() {
    this.client = new VisualizerClient();
    this.rpg = new RPGEngine();
    this.tokenomics = new TokenomicsTracker();
    this.soundscape = new SoundscapeEngine();
    this.initDOM();
    this.initCanvases();
    this.setupSubscriptions();
    this.client.connect();
    this.loadInitialHistory();
    this.setupRPG();
    this.setupTokenomics();
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
          <!-- Web Audio Soundscape Control -->
          <div class="sound-control-group" style="display: flex; align-items: center; gap: 4px; background: rgba(15, 23, 42, 0.85); border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 6px;">
            <button id="btn-sound-toggle" class="control-btn" style="padding: 2px 5px; font-size: 11px;" title="Toggle 8-Bit Audio Soundscape">🔊</button>
            <input id="sound-vol-slider" type="range" min="0" max="1" step="0.05" value="0.6" style="width: 42px; height: 4px; cursor: pointer;" title="Sound Volume">
          </div>

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
            <div id="graph-filter-bar" class="graph-filter-bar">
              <button class="filter-btn active" data-mode="all">⚡ Full Semantic DAG</button>
              <button class="filter-btn" data-mode="files">📁 File Impact</button>
              <button class="filter-btn" data-mode="agents">🌳 Agent Hierarchy</button>
              <button class="filter-btn" data-mode="services">📞 MCP Services</button>
            </div>
          </div>

          <!-- Top-Left: RPG Character Card -->
          <div class="hud-top-left">
            <div class="rpg-card">
              <div class="rpg-header">
                <div class="rpg-name-badge">
                  <span id="rpg-level" class="rpg-level-pill">Lv. 1</span>
                  <span id="rpg-title" class="rpg-char-title">Junior Code Crafter</span>
                </div>
                <span id="rpg-spells" class="rpg-spells-count">0 Casts</span>
              </div>

              <div class="rpg-bar-group">
                <!-- HP Bar -->
                <div class="rpg-bar-wrapper">
                  <div class="rpg-bar-label">
                    <span>HP (Stability)</span>
                    <span id="rpg-hp-val">100/100</span>
                  </div>
                  <div class="rpg-progress-track">
                    <div id="rpg-hp-fill" class="rpg-fill-hp" style="width: 100%;"></div>
                  </div>
                </div>

                <!-- MP Bar -->
                <div class="rpg-bar-wrapper">
                  <div class="rpg-bar-label">
                    <span>MP (Context Mana)</span>
                    <span id="rpg-mp-val">200k/200k</span>
                  </div>
                  <div class="rpg-progress-track">
                    <div id="rpg-mp-fill" class="rpg-fill-mp" style="width: 100%;"></div>
                  </div>
                </div>

                <!-- XP Bar -->
                <div class="rpg-bar-wrapper">
                  <div class="rpg-bar-label">
                    <span>EXP (Progression)</span>
                    <span id="rpg-xp-val">0/350 XP</span>
                  </div>
                  <div class="rpg-progress-track">
                    <div id="rpg-xp-fill" class="rpg-fill-xp" style="width: 0%;"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Top-Center: Metrics Summary Bar -->
          <div class="hud-top-center">
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

          <!-- Top-Right: Mechanical USD Cost Odometer -->
          <div class="hud-top-right">
            <div class="odometer-card" title="Real-time LLM API Cost Odometer based on active agent telemetry">
              <div class="odometer-title-row">
                <span id="odometer-agent-badge" class="odometer-model-badge">⚡ Gemini 3.7 Flash</span>
                <select id="pricing-model-select" class="speed-select" style="padding: 1px 4px; font-size: 8px;"></select>
              </div>
              <div class="odometer-counter">
                <span class="odometer-currency">$</span>
                <span id="odometer-val" class="odometer-val">0.0000</span>
                <span style="font-size: 9px; color: var(--text-muted); font-family: monospace;">USD</span>
              </div>
              <div class="odometer-breakdown">
                <span id="odometer-in">In: 0.0k</span>
                <span id="odometer-out">Out: 0.0k</span>
                <span id="odometer-cache">Cache: 0.0k</span>
              </div>
            </div>
          </div>

          <!-- Right Viewport Dock: Vertical Analog Context Window Silo Gauge -->
          <div class="silo-dock" title="Analog Context Window Depth Silo (Scale 0 to Max Model Limit)">
            <div class="silo-tank-wrapper">
              <div id="silo-fill" class="silo-plasma-fill" style="height: 3%;"></div>
              <div class="silo-ticks">
                <div class="silo-tick-line"></div>
                <div class="silo-tick-line"></div>
                <div class="silo-tick-line"></div>
                <div class="silo-tick-line"></div>
              </div>
            </div>
            <div class="silo-info">
              <span class="silo-title">CONTEXT SILO</span>
              <span id="silo-depth" class="silo-depth-val">0k / 2.0M</span>
              <span id="silo-percent" class="silo-pct">0.0% FULL</span>
            </div>
          </div>

          <!-- RPG Action Spells & MCP Hotbar -->
          <div id="rpg-hotbar" class="rpg-hotbar"></div>

          <!-- Elevator Floor Selector Bar -->
          <div id="floor-selector-bar" class="floor-selector-bar"></div>

          <!-- Time-Travel Scrubber Bar -->
          <div id="timeline-bar" class="timeline-bar">
            <div class="tape-controls">
              <button id="tape-btn-start" class="tape-btn" title="Rewind to start">⏮</button>
              <button id="tape-btn-step-back" class="tape-btn" title="Step back 1 event">◀</button>
              <button id="tape-btn-play" class="tape-btn" title="Play/Pause recording">▶ Play</button>
              <button id="tape-btn-step-fwd" class="tape-btn" title="Step forward 1 event">▶</button>
              <button id="tape-btn-live" class="tape-btn active" title="Jump to live stream">⏭ Live</button>
              <button id="tape-btn-save" class="tape-btn" title="Save session tape to disk">💾 Save Tape</button>
            </div>

            <div class="timeline-slider-wrapper">
              <input
                id="timeline-slider"
                class="timeline-slider"
                type="range"
                min="0"
                max="0"
                value="0"
                step="1"
              />
              <div class="timeline-meta">
                <span id="timeline-curr-time">00:00</span>
                <span id="timeline-evt-count">LIVE STREAM</span>
                <span id="timeline-total-time">00:00</span>
              </div>
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

      <!-- Side-by-Side Code Diff Modal -->
      <div id="diff-modal" class="diff-modal-overlay" style="display: none;">
        <div class="diff-modal">
          <div class="diff-modal-header">
            <div id="diff-modal-title" class="diff-title">📄 Code Revision Diff</div>
            <button id="btn-diff-close" class="diff-close-btn">✕</button>
          </div>
          <div class="diff-body">
            <div class="diff-pane diff-pane-left">
              <div class="diff-pane-title">Previous Snapshot (Before)</div>
              <div id="diff-left-content"></div>
            </div>
            <div class="diff-pane diff-pane-right">
              <div class="diff-pane-title">Applied Patch (After)</div>
              <div id="diff-right-content"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Level Up RPG Modal -->
      <div id="levelup-modal" class="levelup-overlay" style="display: none;">
        <div class="levelup-card">
          <div class="levelup-badge">🏆</div>
          <div class="levelup-heading">LEVEL UP!</div>
          <div id="levelup-modal-title" class="levelup-title">Senior Logic Artisan</div>
          <div id="levelup-modal-perks" class="levelup-perks">
            ✨ Max Mana +75,000 MP<br />
            ❤️ Max HP +25<br />
            🛡️ Cooldowns -10%
          </div>
          <button id="btn-levelup-ack" class="levelup-btn">CLAIM REWARDS ⚔️</button>
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
      if (type === 'station') {
        const thermalStatus = data.overheating ? '🔥 OVERHEATING' : data.heatLevel > 30 ? '🌡️ WARM' : '❄️ OPTIMAL';
        
        let details: Record<string, any> = {
          temperature: `${data.temperatureC}°C (${thermalStatus})`,
          heatLevel: `${data.heatLevel.toFixed(1)}%`,
          wearAndTear: `${data.wearPct.toFixed(1)}%`,
          totalOperations: `${data.totalOperations} cycles`,
          itemsCrafted: data.itemsCount,
          lastOperation: data.lastEvent?.title || 'None',
        };

        if (data.type === 'server_rack') {
          details = {
            cabinetStatus: 'ONLINE (Blinking LED Array)',
            cooling: 'Ventilation Grilles Active',
            mcpRPCCalls: `${this.stats.mcpCalls} invocations`,
            fiberBridges: 'Antigravity, Stitch, GitHub, Gopls',
            ...details,
          };
        } else if (data.type === 'subagent_office') {
          details = {
            seatedAgents: `${this.stats.activeAgents} subagent specialists`,
            isolationStatus: 'Glass Partition Sealed',
            blueprintDrafting: 'Active & Synchronized',
            ...details,
          };
        } else if (data.type === 'repo_shelf') {
          const breakdown = this.repoFolders.map(f => `${f.name}/ (${f.fileCount} files)`).join(', ');
          details = {
            topLevelFolders: `${this.repoFolders.length || 3} compartments`,
            directoryShelves: breakdown || '/cmd, /pkg, /web',
            filesForged: this.stats.filesWritten,
            ...details,
          };
        }

        this.renderInspector(
          `⚙️ ${data.name}`,
          `${data.description}`,
          details
        );

        const pane = document.getElementById('inspector-content');
        if (pane) {
          const btnCool = document.createElement('button');
          btnCool.className = 'intercom-send-btn';
          btnCool.style.cssText = 'background: #06b6d4; color: #000; font-weight: 700; width: 100%; margin-top: 12px; padding: 6px;';
          btnCool.textContent = '🧊 VENT STEAM & COOLDOWN (24°C)';
          btnCool.onclick = () => {
            const flLevel = this.workshopCanvas.activeFloorIndex === 'all' ? 0 : this.workshopCanvas.activeFloorIndex;
            this.workshopCanvas.cooldownStation(data.type, flLevel);
            this.soundscape.playSteamVent();
            btnCool.textContent = '✅ MACHINE COOLED (24°C)';
            btnCool.disabled = true;
          };
          pane.appendChild(btnCool);
        }
      } else {
        this.renderInspector(`👷 ${data.name}`, data.description || 'Specialist agent on duty', data.lastEvent?.payload);
      }
    };

    this.graphCanvas.onSelectNode = (node) => {
      this.renderInspector(
        `${node.icon} ${node.title}`,
        `${node.subtitle} [${node.badge}]`,
        {
          stage: node.stageTitle,
          primaryMetric: `${node.stats.primaryLabel}: ${node.stats.primaryValue}`,
          secondaryMetric: `${node.stats.secondaryLabel}: ${node.stats.secondaryValue}`,
          status: node.stats.status,
          ...node.details,
        }
      );
      if (node.id.includes('domain')) {
        this.openDiffModal(node.title, 'Domain Codebase Delta', node.details);
      }
    };

    this.workshopCanvas.onFloorChanged = () => {
      this.renderFloorSelector();
    };

    this.workshopCanvas.start();
    this.graphCanvas.start();
    this.renderFloorSelector();
  }

  private renderFloorSelector(): void {
    const bar = document.getElementById('floor-selector-bar');
    if (!bar) return;

    bar.innerHTML = '';

    // 1. Tower Overview button
    const allBtn = document.createElement('button');
    allBtn.className = `floor-btn ${this.workshopCanvas.activeFloorIndex === 'all' ? 'active' : ''}`;
    allBtn.innerHTML = `<span>🏢</span><span>Tower View (${this.workshopCanvas.floors.length}F)</span>`;
    allBtn.onclick = () => {
      this.workshopCanvas.setFloorView('all');
    };
    bar.appendChild(allBtn);

    // 2. Individual Floor buttons
    this.workshopCanvas.floors.forEach((fl, idx) => {
      const flBtn = document.createElement('button');
      flBtn.className = `floor-btn ${this.workshopCanvas.activeFloorIndex === idx ? 'active' : ''}`;
      flBtn.style.color = fl.color;
      flBtn.innerHTML = `<span>●</span><span>${fl.name}</span>`;
      flBtn.onclick = () => {
        this.workshopCanvas.setFloorView(idx);
      };
      bar.appendChild(flBtn);
    });
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

    // Graph Filters
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-mode') as any;
        if (mode) {
          this.graphCanvas.setFilterMode(mode);
        }
      });
    });

    const btnSpread = document.getElementById('btn-spread-graph')!;
    btnSpread.addEventListener('click', () => {
      this.graphCanvas.spreadLayout();
    });

    const btnCenter = document.getElementById('btn-center-graph')!;
    btnCenter.addEventListener('click', () => {
      this.graphCanvas.centerView();
    });

    // Time-Travel Playback Controls
    const slider = document.getElementById('timeline-slider') as HTMLInputElement;
    const btnPlay = document.getElementById('tape-btn-play')!;
    const btnStart = document.getElementById('tape-btn-start')!;
    const btnStepBack = document.getElementById('tape-btn-step-back')!;
    const btnStepFwd = document.getElementById('tape-btn-step-fwd')!;
    const btnLive = document.getElementById('tape-btn-live')!;
    const btnSaveTape = document.getElementById('tape-btn-save')!;

    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value, 10);
      this.seekToEventIndex(idx);
    });

    btnPlay.addEventListener('click', () => {
      if (this.isPlayingTape) {
        this.pauseTapePlayback();
      } else {
        this.startTapePlayback();
      }
    });

    btnStart.addEventListener('click', () => {
      this.seekToEventIndex(0);
    });

    btnStepBack.addEventListener('click', () => {
      const curr = this.currentPlaybackIndex < 0 ? this.allEvents.length - 1 : this.currentPlaybackIndex;
      this.seekToEventIndex(Math.max(0, curr - 1));
    });

    btnStepFwd.addEventListener('click', () => {
      const curr = this.currentPlaybackIndex < 0 ? this.allEvents.length - 1 : this.currentPlaybackIndex;
      this.seekToEventIndex(Math.min(this.allEvents.length - 1, curr + 1));
    });

    btnLive.addEventListener('click', () => {
      this.pauseTapePlayback();
      this.currentPlaybackIndex = -1;
      btnLive.classList.add('active');
      this.replayAllEventsUpTo(this.allEvents.length - 1);
      document.getElementById('timeline-evt-count')!.textContent = 'LIVE STREAM';
    });

    btnSaveTape.addEventListener('click', async () => {
      const meta = await this.client.saveTape();
      if (meta) {
        alert(`Tape saved successfully: ${meta.id} (${meta.eventCount} events)`);
      }
    });

    // Diff modal close
    document.getElementById('btn-diff-close')!.onclick = () => {
      document.getElementById('diff-modal')!.style.display = 'none';
    };

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

    // Inject custom event
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
          title: 'Forge: pkg/intervention/recorder.go',
          summary: 'Time-travel tape serialization snapshot',
          payload: { file: 'pkg/intervention/recorder.go', lines: 72 },
        },
      ];
      const randomEvt = sampleEvents[Math.floor(Math.random() * sampleEvents.length)];
      await this.client.ingestEvent(randomEvt);
    });

    // Web Audio Soundscape Controls
    const btnSound = document.getElementById('btn-sound-toggle');
    const volSlider = document.getElementById('sound-vol-slider') as HTMLInputElement;

    if (btnSound && volSlider) {
      volSlider.value = String(this.soundscape.getVolume());
      btnSound.textContent = this.soundscape.getMuted() ? '🔇' : '🔊';

      btnSound.addEventListener('click', () => {
        const isMuted = this.soundscape.toggleMute();
        btnSound.textContent = isMuted ? '🔇' : '🔊';
      });

      volSlider.addEventListener('input', () => {
        const vol = parseFloat(volSlider.value);
        this.soundscape.setVolume(vol);
        if (vol > 0 && this.soundscape.getMuted()) {
          this.soundscape.setMuted(false);
          btnSound.textContent = '🔊';
        }
      });
    }

    // Clear feed
    const btnClear = document.getElementById('btn-clear')!;
    btnClear.addEventListener('click', () => {
      this.allEvents = [];
      const feed = document.getElementById('feed-pane')!;
      feed.innerHTML = '';
      document.getElementById('stream-count')!.textContent = '0 events';
    });
  }

  private seekToEventIndex(index: number): void {
    if (this.allEvents.length === 0) return;
    this.currentPlaybackIndex = Math.max(0, Math.min(this.allEvents.length - 1, index));

    const slider = document.getElementById('timeline-slider') as HTMLInputElement;
    slider.value = String(this.currentPlaybackIndex);

    document.getElementById('tape-btn-live')!.classList.remove('active');
    document.getElementById('timeline-evt-count')!.textContent = `EVENT ${this.currentPlaybackIndex + 1} / ${this.allEvents.length}`;

    const targetEvt = this.allEvents[this.currentPlaybackIndex];
    if (targetEvt) {
      const timeStr = new Date(targetEvt.timestamp).toLocaleTimeString();
      document.getElementById('timeline-curr-time')!.textContent = timeStr;
    }

    this.replayAllEventsUpTo(this.currentPlaybackIndex);
  }

  private startTapePlayback(): void {
    this.isPlayingTape = true;
    const btnPlay = document.getElementById('tape-btn-play')!;
    btnPlay.classList.add('active');
    btnPlay.textContent = '⏸ Pause';

    if (this.currentPlaybackIndex < 0 || this.currentPlaybackIndex >= this.allEvents.length - 1) {
      this.currentPlaybackIndex = 0;
    }

    this.tapePlayInterval = window.setInterval(() => {
      if (this.currentPlaybackIndex < this.allEvents.length - 1) {
        this.seekToEventIndex(this.currentPlaybackIndex + 1);
      } else {
        this.pauseTapePlayback();
      }
    }, 600);
  }

  private pauseTapePlayback(): void {
    this.isPlayingTape = false;
    if (this.tapePlayInterval !== null) {
      clearInterval(this.tapePlayInterval);
      this.tapePlayInterval = null;
    }
    const btnPlay = document.getElementById('tape-btn-play')!;
    btnPlay.classList.remove('active');
    btnPlay.textContent = '▶ Play';
  }

  private replayAllEventsUpTo(endIndex: number): void {
    // Reset canvas models
    const wsCanvasEl = document.getElementById('workshop-canvas') as HTMLCanvasElement;
    const grCanvasEl = document.getElementById('graph-canvas') as HTMLCanvasElement;

    this.workshopCanvas.stop();
    this.graphCanvas.stop();

    this.workshopCanvas = new WorkshopCanvas(wsCanvasEl);
    this.graphCanvas = new FlowGraphCanvas(grCanvasEl);

    this.workshopCanvas.onFloorChanged = () => this.renderFloorSelector();
    this.workshopCanvas.start();
    this.graphCanvas.start();

    // Re-apply events chronologically
    for (let i = 0; i <= endIndex && i < this.allEvents.length; i++) {
      const evt = this.allEvents[i];
      this.workshopCanvas.handleEvent(evt);
      this.graphCanvas.handleEvent(evt);
    }
    this.renderFloorSelector();
  }

  private openDiffModal(title: string, filePath?: string, details?: Record<string, any>): void {
    const modal = document.getElementById('diff-modal')!;
    const titleEl = document.getElementById('diff-modal-title')!;
    const leftEl = document.getElementById('diff-left-content')!;
    const rightEl = document.getElementById('diff-right-content')!;

    titleEl.innerHTML = `<span>📄 ${filePath || title}</span> <span class="diff-badge-add">+${details?.linesChanged || 12}</span> <span class="diff-badge-del">-2</span>`;

    leftEl.innerHTML = `
      <span class="diff-line-del">- // Old implementation snapshot</span>
      <span class="diff-line-del">- func ProcessSession(id string) error {</span>
      <span class="diff-line-del">-     return nil</span>
      <span>  }</span>
    `;

    rightEl.innerHTML = `
      <span class="diff-line-add">+ // Time-Travel Playback Enabled</span>
      <span class="diff-line-add">+ func ProcessSession(id string, tape *recorder.SessionTape) error {</span>
      <span class="diff-line-add">+     if tape != nil { tape.Record() }</span>
      <span>      return nil</span>
      <span>  }</span>
    `;

    modal.style.display = 'flex';
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
    this.isInitialLoading = true;
    try {
      this.tokenomics.resetSession('gemini-3.7-flash');
      this.repoFolders = await this.client.fetchRepoTree();

      const sessions = await this.client.fetchSessions();
      if (sessions && sessions.length > 0) {
        const active = sessions[0];
        this.activeSessionId = active.id;
        this.tokenomics.setSource(active.source);
        const sessEl = document.getElementById('session-text');
        if (sessEl) {
          sessEl.textContent = `${active.source.toUpperCase()}: ${active.id.slice(0, 10)}`;
        }
        await this.restoreSessionState(active.id);
      }

      const history = await this.client.fetchHistory();
      history.forEach((evt) => this.handleIncomingEvent(evt, true));

      // Re-apply persisted session state after history replay to guarantee exact metrics and normal thermals
      if (sessions && sessions.length > 0) {
        await this.restoreSessionState(sessions[0].id);
      }
    } finally {
      this.isInitialLoading = false;
      this.updateHUD();
      this.updateRPGStatsUI();
    }
  }

  private exportWorkstationsState(): Record<string, any> {
    const wsObj: Record<string, any> = {};
    for (const fl of this.workshopCanvas.floors) {
      for (const [stType, st] of fl.workstations.entries()) {
        wsObj[stType] = {
          heatLevel: st.heatLevel,
          temperatureC: st.temperatureC,
          wearPct: st.wearPct,
          totalOperations: st.totalOperations,
          itemsCount: st.itemsCount,
        };
      }
    }
    return wsObj;
  }

  private scheduleAutoSaveState(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(async () => {
      const statePayload = {
        sessionId: this.activeSessionId,
        source: this.tokenomics.activeSource || 'antigravity',
        rpg: this.rpg.exportState(),
        tokenomics: this.tokenomics.exportState(),
        workstations: this.exportWorkstationsState(),
        metrics: this.stats,
      };
      await this.client.saveSessionState(statePayload);
    }, 1200);
  }

  private async restoreSessionState(sessionId: string): Promise<void> {
    const saved = await this.client.fetchSessionState(sessionId);
    if (!saved) return;

    if (saved.rpg) {
      this.rpg.loadState(saved.rpg);
    }
    if (saved.tokenomics) {
      this.tokenomics.loadState(saved.tokenomics);
    }
    if (saved.metrics) {
      if (typeof saved.metrics.totalEvents === 'number') this.stats.totalEvents = saved.metrics.totalEvents;
      if (typeof saved.metrics.filesWritten === 'number') this.stats.filesWritten = saved.metrics.filesWritten;
      if (typeof saved.metrics.mcpCalls === 'number') this.stats.mcpCalls = saved.metrics.mcpCalls;
      if (typeof saved.metrics.testsRun === 'number') this.stats.testsRun = saved.metrics.testsRun;
    }
    if (saved.workstations) {
      for (const fl of this.workshopCanvas.floors) {
        for (const [stType, st] of fl.workstations.entries()) {
          const wData = saved.workstations[stType];
          if (wData) {
            if (typeof wData.heatLevel === 'number') st.heatLevel = wData.heatLevel;
            if (typeof wData.temperatureC === 'number') st.temperatureC = wData.temperatureC;
            if (typeof wData.wearPct === 'number') st.wearPct = wData.wearPct;
            if (typeof wData.totalOperations === 'number') st.totalOperations = wData.totalOperations;
            if (typeof wData.itemsCount === 'number') st.itemsCount = wData.itemsCount;
            st.overheating = st.heatLevel >= 70;
            st.pulseTime = 0;
            st.active = false;
          }
        }
      }
    }
    this.updateHUD();
  }

  private handleIncomingEvent(event: VisualizerEvent, isHistory: boolean = false): void {
    this.allEvents.push(event);

    // Update time slider bounds
    const slider = document.getElementById('timeline-slider') as HTMLInputElement;
    if (slider) {
      slider.max = String(Math.max(0, this.allEvents.length - 1));
      if (this.currentPlaybackIndex < 0) {
        slider.value = slider.max;
        const timeStr = new Date(event.timestamp).toLocaleTimeString();
        document.getElementById('timeline-total-time')!.textContent = timeStr;
      }
    }

    if (event.sessionId && event.sessionId !== 'global' && event.sessionId !== this.activeSessionId) {
      this.activeSessionId = event.sessionId;
      const sessEl = document.getElementById('session-text');
      if (sessEl) {
        sessEl.textContent = `LIVE: ${event.sessionId.slice(0, 12)}`;
      }
      this.restoreSessionState(event.sessionId);
    }

    // Handle Emergency Stop event
    if (event.type === 'emergency.stop') {
      this.emergencyStopActive = event.payload?.active === true;
      const btnEstop = document.getElementById('btn-estop')!;
      btnEstop.classList.toggle('active', this.emergencyStopActive);
      document.getElementById('estop-label')!.textContent = this.emergencyStopActive ? 'BRAKE ACTIVE (LIFT)' : 'E-STOP BRAKE';
    }

    // Handle Checkpoint Approval Prompt Modal (live only)
    if (event.type === 'checkpoint.request' && !isHistory) {
      this.showCheckpointModal(event);
    }

    // Update stats & RPG & Tokenomics
    this.stats.totalEvents++;
    if (event.type === 'file.write') this.stats.filesWritten++;
    if (event.type === 'mcp.call') this.stats.mcpCalls++;
    if (event.type === 'command.run' || event.type === 'command.output') this.stats.testsRun++;
    this.stats.activeAgents = Math.max(1, this.workshopCanvas.floors.reduce((acc, fl) => acc + fl.workers.size, 0));

    this.rpg.handleEvent(event);
    this.tokenomics.handleEvent(event);
    this.updateHUD();
    if (!isHistory) {
      this.scheduleAutoSaveState();
    }

    // If currently on live stream, process event and play procedural audio
    if (this.currentPlaybackIndex < 0) {
      this.workshopCanvas.handleEvent(event, isHistory);
      this.graphCanvas.handleEvent(event, isHistory);

      // Web Audio Soundscape Dispatch (LIVE ONLY)
      if (!isHistory) {
        if (event.type === 'file.write') this.soundscape.playLaserCut();
        else if (event.type === 'agent.think') this.soundscape.playThinkClick();
        else if (event.type === 'mcp.call') this.soundscape.playPhoneRing();
        else if (event.type === 'intervention.prompt') this.soundscape.playIntercom();
        else if (event.type === 'command.run') this.soundscape.playTestRun(true);
        else if (event.type === 'emergency.stop') this.soundscape.playEmergencyStop();
      }
    }

    // Celebrate session completion with confetti (LIVE ONLY)
    if (event.type === 'session.end' && !isHistory) {
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
    document.getElementById('stream-count')!.textContent = `${this.allEvents.length} events`;
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
    const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const safeTitle = escape(event.title || 'Event');
    const safeSummary = event.summary ? escape(event.summary) : '';

    item.innerHTML = `
      <div class="feed-item-header">
        <span class="feed-badge ${badgeClass}">${event.type}</span>
        <span class="feed-time">${timeStr}</span>
      </div>
      <div class="feed-title">${safeTitle}</div>
      ${safeSummary ? `<div class="feed-summary">${safeSummary}</div>` : ''}
    `;

    item.addEventListener('click', () => {
      this.renderInspector(`⚡ ${event.title}`, event.summary || event.type, event.payload);
      if (event.type === 'file.write') {
        this.openDiffModal(event.title, event.payload?.file, event.payload);
      }
    });

    feed.prepend(item);

    while (feed.children.length > 50) {
      feed.removeChild(feed.lastChild!);
    }
  }

  private setupRPG(): void {
    this.renderRPGHotbar();
    this.updateRPGStatsUI();

    this.rpg.onLevelUp = (lvl, title) => {
      this.updateRPGStatsUI();
      if (this.isInitialLoading) return;
      this.soundscape.playLevelUp();
      confetti({
        particleCount: 160,
        spread: 100,
        origin: { y: 0.4 },
        colors: ['#fbbf24', '#f59e0b', '#38bdf8', '#a855f7'],
      });
      this.showLevelUpModal(lvl, title);
    };

    this.rpg.onStatsChanged = () => {
      this.updateRPGStatsUI();
      this.renderRPGHotbar();
    };
  }

  private showLevelUpModal(lvl: number, title: string): void {
    const modal = document.getElementById('levelup-modal');
    if (!modal) return;

    const titleEl = document.getElementById('levelup-modal-title');
    const perksEl = document.getElementById('levelup-modal-perks');
    const ackBtn = document.getElementById('btn-levelup-ack');

    if (titleEl) titleEl.textContent = `Level ${lvl}: ${title}`;
    if (perksEl) {
      perksEl.innerHTML = `
        ✨ Max Mana: +75,000 MP<br />
        ❤️ Max Stability: +25 HP<br />
        ⚡ Next Level Requirement: ${this.rpg.stats.nextLevelXp} XP
      `;
    }

    modal.style.display = 'flex';

    if (ackBtn) {
      ackBtn.onclick = () => {
        modal.style.display = 'none';
      };
    }
  }

  private setupTokenomics(): void {
    const select = document.getElementById('pricing-model-select') as HTMLSelectElement;
    if (select) {
      select.addEventListener('change', () => {
        this.tokenomics.setModel(select.value);
      });
    }

    const odoCard = document.querySelector('.odometer-card');
    if (odoCard) {
      odoCard.addEventListener('click', () => {
        const state = this.tokenomics.getState();
        const breakdownObj: Record<string, any> = {};
        Object.entries(state.modelBreakdown).forEach(([, rec]) => {
          breakdownObj[rec.model.name] = {
            provider: rec.model.provider,
            inputTokens: `${rec.inputTokens.toLocaleString()} ($${rec.model.inputPerMillion}/1M)`,
            outputTokens: `${rec.outputTokens.toLocaleString()} ($${rec.model.outputPerMillion}/1M)`,
            cachedTokens: `${rec.cachedTokens.toLocaleString()} ($${rec.model.cachePerMillion}/1M)`,
            subtotalUSD: `$${rec.costUSD.toFixed(5)}`,
          };
        });

        this.renderInspector(
          '💰 Tokenomics & Multi-Model Cost Breakdown',
          `Total Session Cost: $${state.totalCostUSD.toFixed(4)} USD across ${Object.keys(state.modelBreakdown).length} active model(s)`,
          {
            activeModel: state.activeModel.name,
            contextWindowDepth: `${state.totalContextTokens.toLocaleString()} / ${state.maxContextTokens.toLocaleString()} (${state.contextPercent.toFixed(1)}%)`,
            totalInputTokens: state.totalInputTokens.toLocaleString(),
            totalOutputTokens: state.totalOutputTokens.toLocaleString(),
            totalCachedTokens: state.totalCachedTokens.toLocaleString(),
            totalSessionCostUSD: `$${state.totalCostUSD.toFixed(5)}`,
            perModelItemization: breakdownObj,
          }
        );
      });
    }

    this.tokenomics.onUpdate = (state) => {
      // 0. Update Model Badge & Dynamic Dropdown
      const badgeEl = document.getElementById('odometer-agent-badge');
      if (badgeEl) {
        badgeEl.textContent = state.activeModel.agentLabel;
        badgeEl.style.borderColor = state.activeModel.badgeColor;
        badgeEl.style.color = state.activeModel.badgeColor;
      }

      if (select) {
        select.innerHTML = '';
        state.detectedModelsList.forEach((m) => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = `${m.provider}: ${m.name}`;
          select.appendChild(opt);
        });
        select.value = state.activeModel.id;
      }

      // 1. Update Silo Tank Fill & Depth
      const fillEl = document.getElementById('silo-fill');
      const depthEl = document.getElementById('silo-depth');
      const pctEl = document.getElementById('silo-percent');

      if (fillEl) {
        fillEl.style.height = `${Math.max(3, Math.min(100, state.contextPercent))}%`;
        fillEl.classList.toggle('warn', state.contextPercent >= 60 && state.contextPercent < 80);
        fillEl.classList.toggle('danger', state.contextPercent >= 80);
      }

      if (depthEl) {
        const currK = (state.totalContextTokens / 1000).toFixed(1);
        const maxK = state.maxContextTokens >= 1_000_000 
          ? `${(state.maxContextTokens / 1_000_000).toFixed(1)}M` 
          : `${(state.maxContextTokens / 1000).toFixed(0)}k`;
        depthEl.textContent = `${currK}k / ${maxK}`;
      }

      if (pctEl) {
        pctEl.textContent = `${state.contextPercent.toFixed(1)}% FULL`;
      }

      // 2. Update Mechanical Odometer
      const odoVal = document.getElementById('odometer-val');
      const odoIn = document.getElementById('odometer-in');
      const odoOut = document.getElementById('odometer-out');
      const odoCache = document.getElementById('odometer-cache');

      if (odoVal) {
        odoVal.textContent = state.totalCostUSD.toFixed(4);
      }
      if (odoIn) odoIn.textContent = `In: ${(state.totalInputTokens / 1000).toFixed(1)}k`;
      if (odoOut) odoOut.textContent = `Out: ${(state.totalOutputTokens / 1000).toFixed(1)}k`;
      if (odoCache) odoCache.textContent = `Cache: ${(state.totalCachedTokens / 1000).toFixed(1)}k`;
    };

    // Trigger initial render
    this.tokenomics.onUpdate(this.tokenomics.getState());
  }

  private renderRPGHotbar(): void {
    const bar = document.getElementById('rpg-hotbar');
    if (!bar) return;

    bar.innerHTML = '';

    const classSkills = this.rpg.skills.filter((s) => s.category === 'skill');
    const mcpSpells = this.rpg.skills.filter((s) => s.category === 'mcp');

    classSkills.forEach((sk) => {
      bar.appendChild(this.createSkillSlotElement(sk));
    });

    const divider = document.createElement('div');
    divider.className = 'rpg-slot-divider';
    bar.appendChild(divider);

    mcpSpells.forEach((sk) => {
      bar.appendChild(this.createSkillSlotElement(sk));
    });
  }

  private createSkillSlotElement(sk: any): HTMLElement {
    const slot = document.createElement('div');
    slot.className = `rpg-slot ${sk.active ? 'active' : ''}`;
    slot.title = `${sk.name} [${sk.keybind}]: ${sk.description} (${sk.manaCost} MP)`;

    slot.innerHTML = `
      <span class="rpg-keybind">${sk.keybind}</span>
      <span class="rpg-icon">${sk.icon}</span>
      <span class="rpg-cost">${sk.manaCost} MP</span>
    `;

    slot.onclick = () => {
      this.renderInspector(`✨ Spell: ${sk.name}`, `${sk.description} | Mana Cost: ${sk.manaCost} MP`, {
        category: sk.category,
        keybind: sk.keybind,
        cooldown: `${sk.cooldownMs}ms`,
        lastUsed: sk.lastUsed ? new Date(sk.lastUsed).toLocaleTimeString() : 'Ready',
      });
    };

    return slot;
  }

  private updateRPGStatsUI(): void {
    const s = this.rpg.stats;
    const lvlEl = document.getElementById('rpg-level');
    const titleEl = document.getElementById('rpg-title');
    const spellsEl = document.getElementById('rpg-spells');

    const hpVal = document.getElementById('rpg-hp-val');
    const hpFill = document.getElementById('rpg-hp-fill');

    const mpVal = document.getElementById('rpg-mp-val');
    const mpFill = document.getElementById('rpg-mp-fill');

    const xpVal = document.getElementById('rpg-xp-val');
    const xpFill = document.getElementById('rpg-xp-fill');

    if (lvlEl) lvlEl.textContent = `Lv. ${s.level}`;
    if (titleEl) titleEl.textContent = s.title;
    if (spellsEl) spellsEl.textContent = `${s.spellsCast} Casts`;

    if (hpVal && hpFill) {
      hpVal.textContent = `${s.hp}/${s.maxHp} HP`;
      hpFill.style.width = `${Math.min(100, (s.hp / s.maxHp) * 100)}%`;
    }

    if (mpVal && mpFill) {
      const mpK = (s.mp / 1000).toFixed(0);
      const maxMpK = (s.maxMp / 1000).toFixed(0);
      mpVal.textContent = `${mpK}k/${maxMpK}k MP`;
      mpFill.style.width = `${Math.min(100, (s.mp / s.maxMp) * 100)}%`;
    }

    if (xpVal && xpFill) {
      xpVal.textContent = `${s.xp}/${s.nextLevelXp} XP`;
      xpFill.style.width = `${Math.min(100, (s.xp / s.nextLevelXp) * 100)}%`;
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
