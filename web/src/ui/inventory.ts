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

export class InventoryModal {
  private container: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private isOpen = false;
  private activeTab: 'skills' | 'mcp' | 'rules' | 'commands' = 'skills';
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
      items = this.currentContext.skills || [];
    } else if (this.activeTab === 'mcp') {
      if (titleEl) titleEl.textContent = 'MCP SHARDS & PROTOCOL BRIDGES';
      items = this.currentContext.mcpServers || [];
    } else if (this.activeTab === 'rules') {
      if (titleEl) titleEl.textContent = 'SCROLLS OF GOVERNANCE & MEMORY RULES';
      items = this.currentContext.rules || [];
    } else if (this.activeTab === 'commands') {
      if (titleEl) titleEl.textContent = 'RUNES OF COMMAND & SLASH MACROS';
      items = this.currentContext.slashCommands || [];
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
