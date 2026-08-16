export interface SkillItem {
  id: string;
  name: string;
  description: string;
  path: string;
  icon: string;
  category: string;
  active: boolean;
  activationsCount?: number;
  lastUsed?: number;
}

export interface MCPServerItem {
  id: string;
  name: string;
  toolsCount: number;
  tools: string[];
  icon: string;
  active: boolean;
  callsCount?: number;
  lastUsed?: number;
}

export interface RuleItem {
  id: string;
  title: string;
  content: string;
  type: string;
  icon: string;
}

export interface SlashCommandItem {
  name: string;
  description: string;
  icon: string;
}

export interface SessionContextData {
  sessionId: string;
  provider: string;
  skills: SkillItem[];
  mcpServers: MCPServerItem[];
  rules: RuleItem[];
  slashCommands: SlashCommandItem[];
  updatedAt: number;
}

export interface MechanicLoreItem {
  id: string;
  name: string;
  title: string;
  icon: string;
  type: string;
  category: string;
  description: string;
  isBudgetController?: boolean;
}

export const MECHANICS_ENTRIES: MechanicLoreItem[] = [
  {
    id: 'mech-health',
    name: 'Health (HP) & Daily Token Budget',
    title: 'Health (HP) & Daily Token Budget',
    icon: '💚',
    type: 'vitality',
    category: 'core',
    description: `### 💚 Health (HP) & Daily Token Quota

**Health (HP)** represents the agent's **Daily Token Budget & Operational Stability**.

#### 📐 How It Works:
- **Maximum HP (Max HP):** Represents your daily token allocation (e.g. 250k, 500k, 1,000,000, 2,000,000 tokens).
- **Token Consumption:** As the agent reads files, generates reasoning tokens, and executes MCP tools across sessions today, HP proportionally declines.
- **Thermal Damage Penalty:** If workshop stations overheat (>= 70% heat), the agent takes direct HP damage (-3 HP/s periodic, -8 HP/action) due to mechanical wear and token waste.
- **Pass Test Recovery:** Passing unit tests and solving build issues restores +5 HP stability.

#### ⚙️ Configure Daily Token Budget:
Adjust your daily budget below to calibrate your agent's health bar.`,
    isBudgetController: true,
  },
  {
    id: 'mech-mana',
    name: 'Mana (MP) & Context Window Reservoir',
    title: 'Mana (MP) & Context Window Reservoir',
    icon: '🔷',
    type: 'energy',
    category: 'core',
    description: `### 🔷 Mana (MP) & Context Window Dynamics

**Mana (MP)** represents the current session's **Active Context Window Capacity & Operational Energy**.

#### 📐 Spell Costs & Token Depletion:
- **Code Forge (\`file.write\` / \`edit\`):** 850 MP
- **Search Radar (\`file.read\` / \`grep\`):** 350 MP
- **Test Crucible (\`run_command\` / \`bash\`):** 1,200 MP
- **Safety Barrier (\`checkpoint.request\`):** 500 MP
- **MCP Shard Bridge (\`mcp.call\`):** 1,500 MP

#### 💡 Visual Indicators:
- Every action triggers floating MP cost numbers (e.g. \`-850 MP\`) that float above the character's head in the workshop.
- Context Silo gauge on the right viewport tracks current context saturation percentage.`,
  },
  {
    id: 'mech-xp',
    name: 'Leveling, XP & Agentic Titles',
    title: 'Leveling, XP & Agentic Titles',
    icon: '⭐',
    type: 'progression',
    category: 'core',
    description: `### ⭐ Progression, XP & Agentic Titles

As the AI agent solves issues, runs commands, and modifies codebase artifacts, it earns **Experience Points (XP)**.

#### 🎖️ Mastery Titles:
- **Level 1:** Junior Code Crafter (0 XP)
- **Level 2:** Apprentice Automator (300 XP)
- **Level 3:** Journeyman Refactorer (750 XP)
- **Level 4:** Senior Systems Engineer (1,500 XP)
- **Level 5:** Staff Protocol Architect (2,800 XP)
- **Level 6:** Principal Tool Virtuoso (4,800 XP)
- **Level 7:** Autonomous Swarm Master (7,800 XP)
- **Level 8:** Ascended AI Grandmaster (12,000 XP)
- **Level 9+:** Omnipotent Agentic Deity (20,000+ XP)

Level-ups trigger golden fireworks, level up soundscapes, and boost stability reserves!`,
  },
  {
    id: 'mech-thermal',
    name: 'Machine Heat, Overheating & Wear',
    title: 'Machine Heat, Overheating & Wear',
    icon: '🔥',
    type: 'environment',
    category: 'core',
    description: `### 🔥 Machine Heat, Overheating & Thermal Damage

Workstations in the factory simulate **Mechanical Friction & Compute Load**.

#### 🌡️ Heat Dynamics:
- **CNC Lathe & Laser:** +24% heat per code generation.
- **Test Furnace:** +28% heat per test suite execution.
- **Search Radar:** +18% heat per deep repo scan.
- **Cooldown Rate:** Natural cooldown decays at 2.4% per second.

#### 💥 Overheat Threshold (>= 70% Heat):
- Machine begins venting hot red steam and emitting warning sparks.
- Characters working on overheated machines take -8 HP immediate thermal stress.
- Unattended overheated machines trigger -3 HP/sec periodic environmental damage across the shop floor until cooled!`,
  },
  {
    id: 'mech-velocity',
    name: 'Dynamic Worker Velocity & Task Queues',
    title: 'Dynamic Worker Velocity & Task Queues',
    icon: '🏃',
    type: 'movement',
    category: 'core',
    description: `### 🏃 Dynamic Worker Velocity & Waypoint Queuing

Workers in the factory do not instantly teleport; they navigate between stations with realistic, adaptive physics.

#### 🏎️ Adaptive Speed Multipliers:
- **Single Destination (0 in Queue):** 1.0x (Relaxed walk ~0.06 tiles/frame).
- **1 Task in Queue:** 1.4x (Brisk focused walk).
- **2 Tasks in Queue:** 1.9x (Energetic jog).
- **3+ Tasks Backlogged:** 2.6x (Sprint rush with speed dust particles and \`⚡ +N\` queue badge).`,
  },
  {
    id: 'mech-security',
    name: 'Security Gate, Approvals & Checkpoints',
    title: 'Security Gate, Approvals & Checkpoints',
    icon: '🛡️',
    type: 'governance',
    category: 'core',
    description: `### 🛡️ Security Gate & CLI Approvals

When an agent requests execution of risky shell commands or destructive file operations:
- Event is routed to the **Security Gate** (1F checkpoint).
- Execution pauses in CLI awaiting Human-in-the-loop confirmation.
- Live stream displays a highlighted **⚠️ PERMISSION REQUIRED** card with the exact command and target parameters.
- Terminal snackbar displays the exact command awaiting approval.`,
  },
];

export class InventoryModal {
  private container: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private isOpen = false;
  private activeTab: 'skills' | 'mcp' | 'rules' | 'commands' | 'mechanics' = 'skills';
  private currentContext: SessionContextData | null = null;
  private selectedItem: any = null;
  private bannerTimer: any = null;

  constructor() {
    this.createDOM();
    this.createActiveSkillBanner();
  }

  private createDOM(): void {
    // 1. Overlay & Modal Window
    const overlay = document.createElement('div');
    overlay.id = 'inventory-modal-overlay';
    overlay.className = 'inventory-modal-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="inventory-window">
        <div class="inventory-header">
          <div class="inventory-title-group">
            <span class="inventory-icon">🎒</span>
            <div>
              <div class="inventory-main-title">AGENT CAPABILITIES INVENTORY</div>
              <div class="inventory-subtitle" id="inv-provider-label">AI Agent Toolchain & Knowledge Matrix</div>
            </div>
          </div>
          <div class="inventory-header-actions">
            <span class="inventory-hotkey-badge">Press [I] to Toggle</span>
            <button class="inventory-close-btn" id="btn-inv-close" title="Close Inventory">✕</button>
          </div>
        </div>

        <div class="inventory-body">
          <!-- Left: Tab Selector -->
          <div class="inventory-tabs">
            <button class="inv-tab-btn active" data-tab="skills">
              <span>🧭</span>
              <span>Skills (<span id="inv-count-skills">0</span>)</span>
            </button>
            <button class="inv-tab-btn" data-tab="mcp">
              <span>🔌</span>
              <span>MCP Servers (<span id="inv-count-mcp">0</span>)</span>
            </button>
            <button class="inv-tab-btn" data-tab="rules">
              <span>📜</span>
              <span>Governance & Rules (<span id="inv-count-rules">0</span>)</span>
            </button>
            <button class="inv-tab-btn" data-tab="commands">
              <span>⚡</span>
              <span>Slash Runes (<span id="inv-count-commands">0</span>)</span>
            </button>
            <button class="inv-tab-btn" data-tab="mechanics">
              <span>📖</span>
              <span>Arcane Codex (6)</span>
            </button>
          </div>

          <!-- Center: RPG Item Grid Matrix -->
          <div class="inventory-grid-container">
            <div class="inv-grid-header">
              <span id="inv-grid-section-title">SKILLS & SPECIALIZATIONS</span>
              <span class="inv-grid-hint">Click or hover over any slot to inspect specifications</span>
            </div>
            <div class="inventory-slots-grid" id="inv-slots-grid">
              <!-- Dynamically populated item slots -->
            </div>
          </div>

          <!-- Right: Item Details Inspector -->
          <div class="inventory-details-card" id="inv-details-card">
            <div class="inv-details-placeholder">
              <span class="inv-empty-icon">🔍</span>
              <div>Select an artifact from inventory to view detailed lore, trigger conditions & runtime telemetry.</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.container = overlay;

    // Bind event listeners
    document.getElementById('btn-inv-close')?.addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    // Tab buttons
    overlay.querySelectorAll('.inv-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.inv-tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTab = btn.getAttribute('data-tab') as any;
        this.selectedItem = null;
        this.renderGrid();
      });
    });

    // Keyboard shortcut [I]
    window.addEventListener('keydown', (e) => {
      if (e.key === 'i' || e.key === 'I' || e.key === 'ш' || e.key === 'Ш') {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea' && activeTag !== 'select') {
          this.toggle();
        }
      } else if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  private createActiveSkillBanner(): void {
    let banner = document.getElementById('hud-active-skill-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hud-active-skill-banner';
      banner.className = 'hud-active-skill-banner';
      banner.style.display = 'none';
      document.body.appendChild(banner);
    }
    this.bannerEl = banner;
  }

  public setContext(context: SessionContextData): void {
    this.currentContext = context;
    const providerLabel = document.getElementById('inv-provider-label');
    if (providerLabel) {
      providerLabel.textContent = `Provider: ${context.provider.toUpperCase()} | Session: ${context.sessionId.slice(0, 14)}…`;
    }

    // Update tab count badges
    const countSkills = document.getElementById('inv-count-skills');
    const countMcp = document.getElementById('inv-count-mcp');
    const countRules = document.getElementById('inv-count-rules');
    const countCmds = document.getElementById('inv-count-commands');

    if (countSkills) countSkills.textContent = String(context.skills?.length || 0);
    if (countMcp) countMcp.textContent = String(context.mcpServers?.length || 0);
    if (countRules) countRules.textContent = String(context.rules?.length || 0);
    if (countCmds) countCmds.textContent = String(context.slashCommands?.length || 0);

    if (this.isOpen) {
      this.renderGrid();
    }
  }

  public open(): void {
    if (!this.container) return;
    this.isOpen = true;
    this.container.style.display = 'flex';
    this.renderGrid();
  }

  public close(): void {
    if (!this.container) return;
    this.isOpen = false;
    this.container.style.display = 'none';
  }

  public toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public showActiveSkillBanner(skillName: string, icon: string = '✨', desc?: string): void {
    if (!this.bannerEl) return;
    if (this.bannerTimer) {
      clearTimeout(this.bannerTimer);
    }

    this.bannerEl.innerHTML = `
      <div class="skill-banner-aura"></div>
      <div class="skill-banner-icon">${icon}</div>
      <div class="skill-banner-content">
        <div class="skill-banner-label">ACTIVE SPECIALIZATION CAST</div>
        <div class="skill-banner-name">${skillName}</div>
        ${desc ? `<div class="skill-banner-desc">${desc}</div>` : ''}
      </div>
    `;

    this.bannerEl.style.display = 'flex';
    this.bannerEl.classList.remove('banner-fade-out');
    this.bannerEl.classList.add('banner-pulse-in');

    this.bannerTimer = setTimeout(() => {
      if (this.bannerEl) {
        this.bannerEl.classList.add('banner-fade-out');
        setTimeout(() => {
          if (this.bannerEl) this.bannerEl.style.display = 'none';
        }, 400);
      }
    }, 4000);
  }

  private renderGrid(): void {
    const grid = document.getElementById('inv-slots-grid');
    const titleEl = document.getElementById('inv-grid-section-title');
    if (!grid) return;

    grid.innerHTML = '';
    if (!this.currentContext) {
      grid.innerHTML = `<div class="inv-loading">Loading capabilities context from agent...</div>`;
      return;
    }

    let items: any[] = [];
    if (this.activeTab === 'skills') {
      if (titleEl) titleEl.textContent = 'AGENT SKILLS & SPECIALIZATIONS';
      items = this.currentContext?.skills || [];
    } else if (this.activeTab === 'mcp') {
      if (titleEl) titleEl.textContent = 'MCP SHARDS & PROTOCOL BRIDGES';
      items = this.currentContext?.mcpServers || [];
    } else if (this.activeTab === 'rules') {
      if (titleEl) titleEl.textContent = 'SCROLLS OF GOVERNANCE & MEMORY RULES';
      items = this.currentContext?.rules || [];
    } else if (this.activeTab === 'commands') {
      if (titleEl) titleEl.textContent = 'RUNES OF COMMAND & SLASH MACROS';
      items = this.currentContext?.slashCommands || [];
    } else if (this.activeTab === 'mechanics') {
      if (titleEl) titleEl.textContent = 'ARCANE CODEX OF FACTORY & RPG MECHANICS';
      items = MECHANICS_ENTRIES;
    }

    if (items.length === 0) {
      grid.innerHTML = `<div class="inv-empty-tab">No items discovered in this category for active session.</div>`;
      return;
    }

    items.forEach((item, idx) => {
      const slot = document.createElement('div');
      const isActive = item.active === true;
      const rarityClass = isActive ? 'rarity-active' : item.category === 'devops' || item.category === 'backend' ? 'rarity-rare' : 'rarity-common';
      
      slot.className = `inv-slot ${rarityClass} ${this.selectedItem === item ? 'selected' : ''}`;
      
      let badgeHtml = '';
      if (isActive) {
        badgeHtml = `<span class="inv-slot-badge live">ACTIVE</span>`;
      } else if (item.toolsCount > 0) {
        badgeHtml = `<span class="inv-slot-badge tools">${item.toolsCount} Tools</span>`;
      } else if (item.type) {
        badgeHtml = `<span class="inv-slot-badge type">${item.type}</span>`;
      }

      slot.innerHTML = `
        ${badgeHtml}
        <div class="inv-slot-icon">${item.icon || '⚡'}</div>
        <div class="inv-slot-name">${item.name || item.title}</div>
      `;

      slot.onmouseenter = () => {
        this.renderDetails(item);
      };

      slot.onclick = () => {
        this.selectedItem = item;
        grid.querySelectorAll('.inv-slot').forEach(s => s.classList.remove('selected'));
        slot.classList.add('selected');
        this.renderDetails(item);
      };

      grid.appendChild(slot);

      // Auto-select first item if none selected
      if (idx === 0 && !this.selectedItem) {
        this.selectedItem = item;
        slot.classList.add('selected');
        this.renderDetails(item);
      }
    });
  }

  private renderDetails(item: any): void {
    const card = document.getElementById('inv-details-card');
    if (!card) return;

    if (!item) {
      card.innerHTML = `
        <div class="inv-details-placeholder">
          <span class="inv-empty-icon">🔍</span>
          <div>Select an artifact from inventory to view detailed lore and specifications.</div>
        </div>
      `;
      return;
    }

    const isActive = item.active === true;
    const name = item.name || item.title;
    const icon = item.icon || '⚡';
    const desc = item.description || item.content || 'No detailed lore available.';
    const path = item.path || '';

    let toolsListHtml = '';
    if (Array.isArray(item.tools) && item.tools.length > 0) {
      toolsListHtml = `
        <div class="inv-detail-section">
          <div class="inv-detail-section-title">AVAILABLE PROTOCOL TOOLS (${item.tools.length})</div>
          <div class="inv-tools-tag-cloud">
            ${item.tools.map((t: string) => `<span class="inv-tool-tag">${t}</span>`).join('')}
          </div>
        </div>
      `;
    }

    let statsHtml = '';
    if (typeof item.activationsCount === 'number' || typeof item.callsCount === 'number') {
      const count = item.activationsCount ?? item.callsCount ?? 0;
      statsHtml = `
        <div class="inv-detail-stat-row">
          <span class="inv-stat-label">Session Invocations:</span>
          <span class="inv-stat-val ${count > 0 ? 'highlight' : ''}">${count} times</span>
        </div>
      `;
    }

    let budgetControlsHtml = '';
    if (item.isBudgetController) {
      const currentBudget = (window as any).visualizerApp?.rpg?.dailyTokenBudget || 1000000;
      budgetControlsHtml = `
        <div class="inv-detail-section">
          <div class="inv-detail-section-title">⚙️ CONFIGURE DAILY TOKEN BUDGET</div>
          <div class="daily-budget-controls">
            <button class="budget-preset-btn ${currentBudget === 250000 ? 'active' : ''}" data-budget="250000">250k</button>
            <button class="budget-preset-btn ${currentBudget === 500000 ? 'active' : ''}" data-budget="500000">500k</button>
            <button class="budget-preset-btn ${currentBudget === 1000000 ? 'active' : ''}" data-budget="1000000">1.0M</button>
            <button class="budget-preset-btn ${currentBudget === 2000000 ? 'active' : ''}" data-budget="2000000">2.0M</button>
            <button class="budget-preset-btn ${currentBudget === 5000000 ? 'active' : ''}" data-budget="5000000">5.0M</button>
          </div>
          <div class="custom-budget-row">
            <input type="number" id="input-custom-budget" class="custom-budget-input" placeholder="Custom token limit..." value="${currentBudget}" min="10000" step="50000" />
            <button id="btn-apply-custom-budget" class="custom-budget-apply-btn">Apply Limit</button>
          </div>
          <div id="budget-saved-indicator" style="display: none; font-size: 9.5px; color: #34d399; font-weight: 700; font-family: var(--font-mono); margin-top: 4px;">✓ Daily Token Budget Saved & Applied Live!</div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="inv-card-header">
        <div class="inv-card-icon-frame ${isActive ? 'active' : ''}">
          <span class="inv-card-icon">${icon}</span>
        </div>
        <div class="inv-card-titles">
          <div class="inv-card-name">${name}</div>
          <div class="inv-card-status ${isActive ? 'active' : 'idle'}">
            ${isActive ? '● ACTIVE & EQUIPPED' : '⚪ READY IN INVENTORY'}
          </div>
        </div>
      </div>

      <div class="inv-card-divider"></div>

      <div class="inv-detail-section">
        <div class="inv-detail-section-title">SPECIFICATION & INSTRUCTIONS</div>
        <div class="inv-card-lore">${escapeHtml(desc)}</div>
      </div>

      ${budgetControlsHtml}
      ${toolsListHtml}

      <div class="inv-detail-section">
        <div class="inv-detail-section-title">RUNTIME METADATA</div>
        ${statsHtml}
        ${path ? `
          <div class="inv-detail-stat-row">
            <span class="inv-stat-label">Artifact Path:</span>
            <span class="inv-stat-val mono" title="${escapeHtml(path)}">${escapeHtml(path.length > 36 ? '…' + path.slice(-34) : path)}</span>
          </div>
        ` : ''}
        ${item.category ? `
          <div class="inv-detail-stat-row">
            <span class="inv-stat-label">Category:</span>
            <span class="inv-stat-val capitalize">${item.category}</span>
          </div>
        ` : ''}
      </div>
    `;

    if (item.isBudgetController) {
      card.querySelectorAll('.budget-preset-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const val = parseInt(btn.getAttribute('data-budget') || '1000000', 10);
          (window as any).visualizerApp?.rpg?.setDailyTokenBudget(val);
          card.querySelectorAll('.budget-preset-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          const inputEl = document.getElementById('input-custom-budget') as HTMLInputElement;
          if (inputEl) inputEl.value = String(val);
          const ind = document.getElementById('budget-saved-indicator');
          if (ind) {
            ind.style.display = 'block';
            setTimeout(() => { if (ind) ind.style.display = 'none'; }, 3000);
          }
        });
      });

      document.getElementById('btn-apply-custom-budget')?.addEventListener('click', () => {
        const inputEl = document.getElementById('input-custom-budget') as HTMLInputElement;
        if (inputEl) {
          const val = parseInt(inputEl.value, 10);
          if (!isNaN(val) && val > 0) {
            (window as any).visualizerApp?.rpg?.setDailyTokenBudget(val);
            card.querySelectorAll('.budget-preset-btn').forEach((b) => b.classList.remove('active'));
            const ind = document.getElementById('budget-saved-indicator');
            if (ind) {
              ind.style.display = 'block';
              setTimeout(() => { if (ind) ind.style.display = 'none'; }, 3000);
            }
          }
        }
      });
    }
  }
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
