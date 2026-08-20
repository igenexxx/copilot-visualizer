import type { ProcSnapshot, ProcTracerStatus, TargetProcess } from '../types';
import type { VisualizerClient } from '../services/ws';
import { getProviderColor } from './icons';

export class ProcTelemetryPanel {
  private client: VisualizerClient;
  private container: HTMLElement;
  private modalEl: HTMLElement;
  private badgeEl: HTMLElement;
  public isOpen: boolean = false;
  private currentSnapshot: ProcSnapshot | null = null;
  private currentStatus: ProcTracerStatus | null = null;
  private targetsList: TargetProcess[] = [];
  private pollTimer: number | null = null;
  private activeTab: 'overview' | 'children' | 'network' | 'events' = 'overview';

  constructor(client: VisualizerClient, containerId: string = 'proc-telemetry-container') {
    this.client = client;

    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      el.className = 'proc-telemetry-wrapper';
      const headerRight = document.querySelector('.header-right');
      if (headerRight) {
        headerRight.insertBefore(el, headerRight.firstChild);
      } else {
        document.body.appendChild(el);
      }
    }
    this.container = el;

    // Create modal element
    let modal = document.getElementById('proc-telemetry-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'proc-telemetry-modal';
      modal.className = 'proc-modal-overlay';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }
    this.modalEl = modal;

    this.badgeEl = document.createElement('button');
    this.badgeEl.id = 'btn-proc-telemetry-badge';
    this.badgeEl.className = 'proc-badge-btn';
    this.badgeEl.title = 'Linux/WSL Process Telemetry & Sockets Inspector';
    this.container.appendChild(this.badgeEl);

    this.renderBadgeInitial();
    this.renderModalLayout();
    this.bindEvents();
    this.fetchInitial();
  }

  private renderBadgeInitial(): void {
    this.badgeEl.innerHTML = `
      <span class="proc-badge-icon">⚡</span>
      <span class="proc-badge-dot"></span>
      <span class="proc-badge-text" id="proc-badge-text">OS: CHECKING...</span>
    `;
  }

  private renderModalLayout(): void {
    this.modalEl.innerHTML = `
      <div class="proc-modal-dialog">
        <div class="proc-modal-header">
          <div class="proc-header-title-group">
            <div class="proc-modal-title">
              <span class="proc-title-icon">⚡</span>
              <span>Linux / WSL Process Telemetry</span>
              <span class="proc-env-pill" id="proc-modal-env-pill">LINUX/WSL</span>
            </div>
            <div class="proc-modal-subtitle">Real-time /proc kernel inspection, active network sockets, and subprocess tree</div>
          </div>
          <button class="proc-modal-close-btn" id="btn-proc-modal-close" title="Close [Esc]">✕</button>
        </div>

        <div class="proc-modal-toolbar">
          <div class="proc-target-picker-group">
            <label class="proc-toolbar-label">Target Process:</label>
            <select class="proc-target-select" id="proc-target-select" title="Select detected AI Assistant process"></select>
            <button class="proc-btn-action" id="btn-proc-refresh" title="Force Refresh Snapshot">🔄 Refresh</button>
          </div>

          <div class="proc-custom-pid-group">
            <input type="number" id="proc-custom-pid-input" class="proc-pid-input" placeholder="PID..." min="1" />
            <button class="proc-btn-action" id="btn-proc-attach-pid">Attach PID</button>
          </div>
        </div>

        <div class="proc-modal-tabs">
          <button class="proc-tab-btn active" data-tab="overview">📊 Metrics & Overview</button>
          <button class="proc-tab-btn" data-tab="children">🌳 Subprocess Tree <span class="proc-tab-count" id="proc-count-children">0</span></button>
          <button class="proc-tab-btn" data-tab="network">🌐 Network & Cloud APIs <span class="proc-tab-count" id="proc-count-network">0</span></button>
          <button class="proc-tab-btn" data-tab="events">📜 Activity Events <span class="proc-tab-count" id="proc-count-events">0</span></button>
        </div>

        <div class="proc-modal-body" id="proc-modal-body">
          <!-- Dynamically populated tab content -->
        </div>

        <div class="proc-modal-footer">
          <div class="proc-footer-left" id="proc-footer-status">
            <span class="proc-footer-dot"></span>
            <span id="proc-footer-text">Monitoring live system metrics</span>
          </div>
          <div class="proc-footer-right">
            <span id="proc-footer-uptime">Updated just now</span>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.badgeEl.addEventListener('click', () => {
      this.toggleModal();
    });

    const closeBtn = document.getElementById('btn-proc-modal-close');
    closeBtn?.addEventListener('click', () => {
      this.close();
    });

    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) {
        this.close();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Tab buttons
    const tabBtns = this.modalEl.querySelectorAll('.proc-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab') as any;
        if (tab) {
          this.activeTab = tab;
          this.renderActiveTabContent();
        }
      });
    });

    // Target select
    const select = document.getElementById('proc-target-select') as HTMLSelectElement;
    select?.addEventListener('change', () => {
      const pid = parseInt(select.value, 10);
      if (pid > 0) {
        this.attachPID(pid);
      }
    });

    // Refresh button
    const btnRefresh = document.getElementById('btn-proc-refresh');
    btnRefresh?.addEventListener('click', () => {
      this.fetchSnapshot();
    });

    // Attach PID button
    const btnAttach = document.getElementById('btn-proc-attach-pid');
    btnAttach?.addEventListener('click', () => {
      const input = document.getElementById('proc-custom-pid-input') as HTMLInputElement;
      const pid = parseInt(input?.value || '0', 10);
      if (pid > 0) {
        this.attachPID(pid);
        if (input) input.value = '';
      }
    });
  }

  public async fetchInitial(): Promise<void> {
    const status = await this.client.getProcStatus();
    if (status) {
      this.updateStatus(status);
    }
  }

  public toggleModal(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  public open(): void {
    this.isOpen = true;
    this.modalEl.style.display = 'flex';
    this.fetchSnapshot();
    this.startPolling();
  }

  public close(): void {
    this.isOpen = false;
    this.modalEl.style.display = 'none';
    this.stopPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      if (this.isOpen) {
        this.fetchSnapshot();
      }
    }, 1500);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public async fetchSnapshot(): Promise<void> {
    const [status, snapshot, targets] = await Promise.all([
      this.client.getProcStatus(),
      this.client.getProcSnapshot(),
      this.client.getProcTargets(),
    ]);

    if (status) {
      this.updateStatus(status);
    }
    if (targets && targets.length > 0) {
      this.targetsList = targets;
      this.populateTargetsSelect();
    }
    if (snapshot) {
      this.updateSnapshot(snapshot);
    }
  }

  public async attachPID(pid: number): Promise<void> {
    const snap = await this.client.attachProcPID(pid);
    if (snap) {
      this.updateSnapshot(snap);
      this.fetchInitial();
    }
  }

  public updateStatus(status: ProcTracerStatus): void {
    this.currentStatus = status;
    const badgeText = document.getElementById('proc-badge-text');
    const badge = this.badgeEl;

    if (!status.supported) {
      if (badgeText) badgeText.textContent = 'OS: N/A (Non-Linux)';
      badge.classList.remove('attached', 'live');
      badge.classList.add('disabled');
      badge.title = 'Process telemetry is only available on Linux/WSL environments';
      return;
    }

    badge.classList.remove('disabled');
    if (status.attached && status.target_pid > 0) {
      badge.classList.add('attached', 'live');
      const name = status.target_name || status.target_kind || 'agent';
      if (badgeText) {
        const cpuStr = status.snapshot?.metrics ? ` | ${status.snapshot.metrics.cpu_percent.toFixed(1)}% CPU` : '';
        badgeText.textContent = `OS: [${status.target_pid}] ${name}${cpuStr}`;
      }
    } else {
      badge.classList.remove('attached', 'live');
      if (badgeText) badgeText.textContent = 'OS: IDLE (Scan /proc)';
    }

    if (status.targets_list) {
      this.targetsList = status.targets_list;
      this.populateTargetsSelect();
    }

    if (status.snapshot) {
      this.updateSnapshot(status.snapshot);
    }
  }

  public updateSnapshot(snap: ProcSnapshot): void {
    this.currentSnapshot = snap;

    // Update counts on tabs
    const countChildren = document.getElementById('proc-count-children');
    const countNet = document.getElementById('proc-count-network');
    const countEvents = document.getElementById('proc-count-events');

    if (countChildren) countChildren.textContent = String(snap.children?.length || 0);
    if (countNet) countNet.textContent = String(snap.connections?.length || 0);
    if (countEvents) countEvents.textContent = String(snap.recent_events?.length || 0);

    // Update footer
    const footerText = document.getElementById('proc-footer-text');
    const footerTime = document.getElementById('proc-footer-uptime');
    if (footerText && snap.target) {
      footerText.textContent = `Attached: ${snap.target.name || 'AI Assistant'} (PID: ${snap.target.pid}) • State: ${snap.target.state || 'Active'}`;
    }
    if (footerTime) {
      footerTime.textContent = `Sampled at ${new Date(snap.timestamp || Date.now()).toLocaleTimeString()}`;
    }

    // Update badge text if open
    const badgeText = document.getElementById('proc-badge-text');
    if (badgeText && snap.target) {
      const rssMB = snap.metrics ? (snap.metrics.rss_bytes / (1024 * 1024)).toFixed(0) : '0';
      badgeText.textContent = `OS: [${snap.target.pid}] ${snap.target.name} | ${snap.metrics?.cpu_percent.toFixed(1)}% | ${rssMB}MB`;
    }

    if (this.isOpen) {
      this.renderActiveTabContent();
    }
  }

  private populateTargetsSelect(): void {
    const select = document.getElementById('proc-target-select') as HTMLSelectElement;
    if (!select) return;

    const currentVal = this.currentStatus?.target_pid || this.currentSnapshot?.target?.pid;
    select.innerHTML = '';

    if (this.targetsList.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No AI Assistants Detected';
      select.appendChild(opt);
      return;
    }

    this.targetsList.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = String(t.pid);
      const modelStr = t.model ? ` (${t.model})` : '';
      opt.textContent = `[PID ${t.pid}] ${t.kind.toUpperCase()} - ${t.name}${modelStr}`;
      if (t.pid === currentVal) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  private renderActiveTabContent(): void {
    const body = document.getElementById('proc-modal-body');
    if (!body) return;

    const snap = this.currentSnapshot;
    if (!snap || !snap.supported) {
      body.innerHTML = `
        <div class="proc-empty-state">
          <div class="proc-empty-icon">⚠️</div>
          <div class="proc-empty-title">Process Telemetry Unavailable</div>
          <div class="proc-empty-desc">
            Process telemetry requires Linux or WSL with accessible <code>/proc</code> filesystem.<br />
            Make sure an AI assistant (Antigravity CLI, Copilot CLI, Claude Code, etc.) is running.
          </div>
        </div>
      `;
      return;
    }

    switch (this.activeTab) {
      case 'overview':
        this.renderOverviewTab(body, snap);
        break;
      case 'children':
        this.renderChildrenTab(body, snap);
        break;
      case 'network':
        this.renderNetworkTab(body, snap);
        break;
      case 'events':
        this.renderEventsTab(body, snap);
        break;
    }
  }

  private renderOverviewTab(body: HTMLElement, snap: ProcSnapshot): void {
    const t = snap.target;
    const m = snap.metrics || ({} as any);

    const rssMB = ((m.rss_bytes || 0) / (1024 * 1024)).toFixed(1);
    const vmsMB = ((m.vms_bytes || 0) / (1024 * 1024)).toFixed(1);
    const peakMB = ((m.peak_rss_bytes || 0) / (1024 * 1024)).toFixed(1);
    const readRateMB = ((m.read_bytes_sec || 0) / (1024 * 1024)).toFixed(2);
    const writeRateMB = ((m.write_bytes_sec || 0) / (1024 * 1024)).toFixed(2);
    const totalReadMB = ((m.total_read_bytes || 0) / (1024 * 1024)).toFixed(1);
    const totalWriteMB = ((m.total_write_bytes || 0) / (1024 * 1024)).toFixed(1);
    const cpuPct = (m.cpu_percent || 0).toFixed(1);

    const kindColor = getProviderColor(t?.kind || 'generic');

    body.innerHTML = `
      <div class="proc-overview-grid">
        <!-- Target Info Card -->
        <div class="proc-card proc-card-hero">
          <div class="proc-card-header">
            <div class="proc-hero-title-wrap">
              <span class="proc-kind-pill" style="background: ${kindColor}22; color: ${kindColor}; border-color: ${kindColor}">
                ${t?.kind ? t.kind.toUpperCase() : 'AGENT'}
              </span>
              <span class="proc-hero-name">${this.escape(t?.name || 'Process')}</span>
              <span class="proc-hero-pid">PID ${t?.pid || 0}</span>
            </div>
            <span class="proc-state-pill ${t?.state === 'Running' ? 'state-running' : 'state-sleep'}">${t?.state || 'Active'}</span>
          </div>

          <div class="proc-hero-fields">
            <div class="proc-prop-row">
              <span class="proc-prop-label">MODEL</span>
              <span class="proc-prop-val proc-val-highlight">${this.escape(t?.model || 'Unknown Model')}</span>
            </div>
            <div class="proc-prop-row">
              <span class="proc-prop-label">EXECUTABLE</span>
              <span class="proc-prop-val proc-val-mono" title="${this.escape(t?.executable || '')}">${this.escape(t?.executable || '--')}</span>
            </div>
            <div class="proc-prop-row">
              <span class="proc-prop-label">WORKING DIR</span>
              <span class="proc-prop-val proc-val-mono" title="${this.escape(t?.cwd || '')}">${this.escape(t?.cwd || '--')}</span>
            </div>
            <div class="proc-prop-row">
              <span class="proc-prop-label">USER / PPID</span>
              <span class="proc-prop-val">${this.escape(t?.user || 'user')} (Parent PID: ${t?.ppid || 1})</span>
            </div>
          </div>
        </div>

        <!-- Telemetry Gauges Grid -->
        <div class="proc-gauges-grid">
          <!-- CPU Gauge -->
          <div class="proc-card">
            <div class="proc-gauge-header">
              <span>⚡ CPU Utilization</span>
              <span class="proc-gauge-val-badge">${cpuPct}%</span>
            </div>
            <div class="proc-gauge-track">
              <div class="proc-gauge-fill gauge-cpu" style="width: ${Math.min(100, Math.max(0, m.cpu_percent || 0))}%;"></div>
            </div>
            <div class="proc-gauge-sub">Threads: <b>${m.thread_count || 1}</b> • Children: <b>${snap.children?.length || 0}</b></div>
          </div>

          <!-- Memory Gauge -->
          <div class="proc-card">
            <div class="proc-gauge-header">
              <span>🧠 Memory (RSS)</span>
              <span class="proc-gauge-val-badge">${rssMB} MB</span>
            </div>
            <div class="proc-gauge-track">
              <div class="proc-gauge-fill gauge-mem" style="width: ${Math.min(100, (m.rss_bytes || 0) / (512 * 1024 * 1024) * 100)}%;"></div>
            </div>
            <div class="proc-gauge-sub">Peak RSS: <b>${peakMB} MB</b> • VMS: <b>${vmsMB} MB</b></div>
          </div>

          <!-- Disk I/O Card -->
          <div class="proc-card">
            <div class="proc-gauge-header">
              <span>💾 Disk I/O Rate</span>
              <span class="proc-gauge-val-badge">${readRateMB} R / ${writeRateMB} W MB/s</span>
            </div>
            <div class="proc-io-stats">
              <div>Syscalls: <b>${(m.read_syscalls_sec || 0).toFixed(0)} R / ${(m.write_syscalls_sec || 0).toFixed(0)} W /s</b></div>
              <div>Lifetime: <b>${totalReadMB} MB Read • ${totalWriteMB} MB Written</b></div>
            </div>
          </div>

          <!-- System Handles Card -->
          <div class="proc-card">
            <div class="proc-gauge-header">
              <span>📁 Open File Handles</span>
              <span class="proc-gauge-val-badge">${m.fd_count || 0} FDs</span>
            </div>
            <div class="proc-io-stats">
              <div>Active Sockets: <b>${snap.connections?.length || 0} TCP</b></div>
              <div>Process State: <b>${t?.state || 'Running'}</b></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderChildrenTab(body: HTMLElement, snap: ProcSnapshot): void {
    const children = snap.children || [];
    if (children.length === 0) {
      body.innerHTML = `
        <div class="proc-empty-state">
          <div class="proc-empty-icon">🌳</div>
          <div class="proc-empty-title">No Active Subprocesses</div>
          <div class="proc-empty-desc">The AI assistant has not spawned any child processes (bash, compilers, tools, git) at this moment.</div>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="proc-table-container">
        <table class="proc-table">
          <thead>
            <tr>
              <th>PID</th>
              <th>PPID</th>
              <th>SUBPROCESS</th>
              <th>COMMAND LINE</th>
              <th>MEMORY (RSS)</th>
              <th>STATE</th>
            </tr>
          </thead>
          <tbody>
            ${children.map((c) => `
              <tr>
                <td class="proc-td-mono">${c.pid}</td>
                <td class="proc-td-mono">${c.ppid}</td>
                <td><b class="proc-child-name">${this.escape(c.name)}</b></td>
                <td class="proc-td-cmd" title="${this.escape(c.cmdline)}">${this.escape(c.cmdline)}</td>
                <td class="proc-td-mono">${((c.rss_bytes || 0) / (1024 * 1024)).toFixed(1)} MB</td>
                <td><span class="proc-child-state">${c.state || 'Running'}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderNetworkTab(body: HTMLElement, snap: ProcSnapshot): void {
    const conns = snap.connections || [];
    if (conns.length === 0) {
      body.innerHTML = `
        <div class="proc-empty-state">
          <div class="proc-empty-icon">🌐</div>
          <div class="proc-empty-title">No Active Network Sockets</div>
          <div class="proc-empty-desc">No active TCP sockets detected in /proc/${snap.target?.pid || '0'}/net/tcp.</div>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="proc-table-container">
        <table class="proc-table">
          <thead>
            <tr>
              <th>SERVICE / ENDPOINT</th>
              <th>PROTOCOL</th>
              <th>LOCAL ADDRESS</th>
              <th>REMOTE HOST / IP</th>
              <th>PORT</th>
              <th>STATE</th>
            </tr>
          </thead>
          <tbody>
            ${conns.map((c) => {
              const isCloudAPI = c.service_category?.includes('API');
              return `
                <tr>
                  <td>
                    <span class="proc-service-badge ${isCloudAPI ? 'service-cloud' : 'service-local'}">
                      ${this.escape(c.service_category || 'TCP Socket')}
                    </span>
                  </td>
                  <td class="proc-td-mono">${c.protocol || 'TCP'}</td>
                  <td class="proc-td-mono">${this.escape(c.local_addr)}</td>
                  <td class="proc-td-mono"><b>${this.escape(c.remote_host || c.remote_addr)}</b></td>
                  <td class="proc-td-mono">${c.remote_port}</td>
                  <td><span class="proc-tcp-state ${c.state === 'ESTABLISHED' ? 'tcp-established' : ''}">${c.state}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderEventsTab(body: HTMLElement, snap: ProcSnapshot): void {
    const events = snap.recent_events || [];
    if (events.length === 0) {
      body.innerHTML = `
        <div class="proc-empty-state">
          <div class="proc-empty-icon">📜</div>
          <div class="proc-empty-title">No Activity Events Yet</div>
          <div class="proc-empty-desc">Process and system events will appear here as subprocesses spawn or network connections are established.</div>
        </div>
      `;
      return;
    }

    body.innerHTML = `
      <div class="proc-events-stream">
        ${events.slice().reverse().map((e) => `
          <div class="proc-event-row sev-${(e.severity || 'info').toLowerCase()}">
            <div class="proc-evt-header">
              <span class="proc-evt-kind">[${e.kind || 'TRACE'}]</span>
              <span class="proc-evt-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
              <span class="proc-evt-source">${this.escape(e.source || 'kernel')}</span>
            </div>
            <div class="proc-evt-summary">${this.escape(e.summary)}</div>
            ${e.details ? `<div class="proc-evt-details">${this.escape(e.details)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  private escape(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
