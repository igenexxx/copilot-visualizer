import type { ContextSaturationTelemetry } from '../analytics/context_saturation';
import type { GoalStackTelemetry } from '../analytics/goal_tracker';
import type { BlastRadiusTelemetry } from '../analytics/blast_radius';
import type { WaterfallTelemetry } from '../analytics/waterfall_timeline';

export class MissionControlPanel {
  private container: HTMLElement;
  public isExpanded: boolean = false;
  public onToggle?: (isExpanded: boolean) => void;

  constructor(containerId: string = 'mission-control-drawer') {
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      el.className = 'mission-control-drawer';
      document.body.appendChild(el);
    }
    this.container = el;
    this.renderLayout();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="mc-toggle-bar" id="mc-toggle-bar">
        <div class="mc-toggle-title">
          <span>🛰️ Mission Control</span>
          <span class="mc-badge-context" id="mc-quick-context">Context: 0%</span>
          <span class="mc-badge-blast" id="mc-quick-blast">Blast: LOW</span>
        </div>
        <button class="btn-mc-toggle" id="btn-mc-toggle">▲ Expand Analytics</button>
      </div>

      <div class="mc-body" id="mc-body" style="display: none;">
        <div class="mc-grid">
          <!-- 1. Context Saturation & Cache Tracker -->
          <div class="mc-card">
            <div class="mc-card-header">
              <span>🔋 Context Saturation</span>
              <div>
                <span class="mc-model-badge" id="mc-gauge-tokens" style="color: var(--text-primary); margin-right: 4px;">0k / 1M</span>
                <span class="mc-model-badge" id="mc-model-badge">gemini-3.7-flash</span>
              </div>
            </div>
            <div class="mc-gauge-container">
              <div class="mc-radial-gauge" id="mc-radial-gauge">
                <span class="mc-gauge-val" id="mc-gauge-pct">0%</span>
              </div>
              <div class="mc-breakdown-legend">
                <div class="mc-legend-item"><span class="dot dot-sys"></span> System: <b id="mc-tok-sys">8.5k</b></div>
                <div class="mc-legend-item"><span class="dot dot-file"></span> Files: <b id="mc-tok-file">0k</b></div>
                <div class="mc-legend-item"><span class="dot dot-hist"></span> History: <b id="mc-tok-hist">0k</b></div>
                <div class="mc-legend-item"><span class="dot dot-cache"></span> Cache Hit: <b id="mc-cache-hit">0%</b></div>
              </div>
            </div>
          </div>

          <!-- 2. Goal Hierarchy & Dynamic Checklist -->
          <div class="mc-card">
            <div class="mc-card-header">
              <span>🧠 Goal Hierarchy & Checklist</span>
              <span class="mc-progress-badge" id="mc-checklist-progress">0/0 Done</span>
            </div>
            <div class="mc-breadcrumbs" id="mc-breadcrumbs">
              <span class="crumb-root">General Orchestration</span> ➔ <span class="crumb-sub">Idle</span>
            </div>
            <div class="mc-checklist-box" id="mc-checklist-box">
              <div class="mc-empty-hint">Awaiting structured plan steps...</div>
            </div>
          </div>

          <!-- 3. Blast Radius & Package Heatmap -->
          <div class="mc-card">
            <div class="mc-card-header">
              <span>🗺️ Blast Radius & Heatmap</span>
              <span class="mc-severity-badge severity-low" id="mc-severity-badge">LOW</span>
            </div>
            <div class="mc-blast-metrics">
              <div>Files Touched: <b id="mc-files-touched">0</b></div>
              <div>Diff: <span class="diff-add" id="mc-lines-add">+0</span> / <span class="diff-rem" id="mc-lines-rem">-0</span></div>
            </div>
            <div class="mc-package-list" id="mc-package-list">
              <div class="mc-empty-hint">No packages modified yet</div>
            </div>
          </div>

          <!-- 4. Tool Execution Waterfall Gantt -->
          <div class="mc-card">
            <div class="mc-card-header">
              <span>⏱️ Tool Execution Waterfall</span>
              <span class="mc-avg-latency" id="mc-avg-latency">Avg Tool: 0ms</span>
            </div>
            <div class="mc-waterfall-stats">
              <span>🧠 LLM Total: <b id="mc-llm-total">0.0s</b></span>
              <span>🔧 Tool Total: <b id="mc-tool-total">0.0s</b></span>
            </div>
            <div class="mc-waterfall-stream" id="mc-waterfall-stream">
              <div class="mc-empty-hint">Waiting for tool execution spans...</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const toggleBtn = document.getElementById('btn-mc-toggle');
    const toggleBar = document.getElementById('mc-toggle-bar');
    const body = document.getElementById('mc-body');

    const toggle = () => {
      this.isExpanded = !this.isExpanded;
      document.body.classList.toggle('has-mc-expanded', this.isExpanded);
      if (body && toggleBtn) {
        body.style.display = this.isExpanded ? 'block' : 'none';
        toggleBtn.textContent = this.isExpanded ? '▼ Collapse' : '▲ Expand Analytics';
      }
      if (this.onToggle) {
        this.onToggle(this.isExpanded);
      }
    };

    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    toggleBar?.addEventListener('click', toggle);
  }

  public update(
    context?: ContextSaturationTelemetry | null,
    goal?: GoalStackTelemetry | null,
    blast?: BlastRadiusTelemetry | null,
    waterfall?: WaterfallTelemetry | null
  ): void {
    if (!this.isExpanded || !context || !goal || !blast || !waterfall) return;
    // 1. Quick Bar
    const qContext = document.getElementById('mc-quick-context');
    const qBlast = document.getElementById('mc-quick-blast');
    if (qContext) qContext.textContent = `Context: ${context.saturationPct}%`;
    if (qBlast) {
      qBlast.textContent = `Blast: ${blast.severity}`;
      qBlast.className = `mc-badge-blast blast-${blast.severity.toLowerCase()}`;
    }

    // 2. Context Gauge
    const modelId = document.getElementById('mc-model-badge');
    const gaugePct = document.getElementById('mc-gauge-pct');
    const gaugeTokens = document.getElementById('mc-gauge-tokens');
    const radial = document.getElementById('mc-radial-gauge');
    const tokSys = document.getElementById('mc-tok-sys');
    const tokFile = document.getElementById('mc-tok-file');
    const tokHist = document.getElementById('mc-tok-hist');
    const cacheHit = document.getElementById('mc-cache-hit');

    if (modelId) modelId.textContent = context.modelId;
    if (gaugePct) gaugePct.textContent = `${context.saturationPct}%`;
    if (gaugeTokens) {
      const maxK = Math.round(context.maxContextTokens / 1000);
      const currK = Math.round(context.currentTokens / 1000);
      gaugeTokens.textContent = `${currK}k / ${maxK}k`;
    }
    if (radial) {
      radial.className = `mc-radial-gauge gauge-${context.safetyTier.toLowerCase()}`;
    }
    if (tokSys) tokSys.textContent = `${Math.round(context.breakdown.systemPromptTokens / 1000)}k`;
    if (tokFile) tokFile.textContent = `${Math.round(context.breakdown.fileContentTokens / 1000)}k`;
    if (tokHist) tokHist.textContent = `${Math.round(context.breakdown.historyTokens / 1000)}k`;
    if (cacheHit) cacheHit.textContent = `${Math.round(context.cacheHitRatio * 100)}%`;

    // 3. Goal Hierarchy
    const breadcrumbs = document.getElementById('mc-breadcrumbs');
    const checklistBox = document.getElementById('mc-checklist-box');
    const checklistProgress = document.getElementById('mc-checklist-progress');

    if (checklistProgress) {
      checklistProgress.textContent = `${goal.completedCount}/${goal.totalChecklistCount} Done`;
    }
    if (breadcrumbs && goal.breadcrumbs.length > 0) {
      breadcrumbs.innerHTML = goal.breadcrumbs
        .map((crumb, idx) => `<span class="crumb-${idx === 0 ? 'root' : idx === 1 ? 'sub' : 'action'}">${this.escape(crumb)}</span>`)
        .join(' ➔ ');
    }
    if (checklistBox) {
      if (goal.checklist.length === 0) {
        checklistBox.innerHTML = `<div class="mc-empty-hint">Awaiting structured plan steps...</div>`;
      } else {
        checklistBox.innerHTML = goal.checklist
          .map((item) => `
            <div class="mc-checklist-item ${item.completed ? 'completed' : ''}">
              <span class="chk-box">${item.completed ? '✅' : '⬜'}</span>
              <span class="chk-text">${this.escape(item.text)}</span>
            </div>
          `)
          .join('');
      }
    }

    // 4. Blast Radius
    const sevBadge = document.getElementById('mc-severity-badge');
    const filesTouched = document.getElementById('mc-files-touched');
    const linesAdd = document.getElementById('mc-lines-add');
    const linesRem = document.getElementById('mc-lines-rem');
    const pkgList = document.getElementById('mc-package-list');

    if (sevBadge) {
      sevBadge.textContent = blast.severity;
      sevBadge.className = `mc-severity-badge severity-${blast.severity.toLowerCase()}`;
    }
    if (filesTouched) filesTouched.textContent = String(blast.totalFilesTouched);
    if (linesAdd) linesAdd.textContent = `+${blast.totalLinesAdded}`;
    if (linesRem) linesRem.textContent = `-${blast.totalLinesRemoved}`;

    if (pkgList) {
      if (blast.packages.length === 0) {
        pkgList.innerHTML = `<div class="mc-empty-hint">No packages modified yet</div>`;
      } else {
        pkgList.innerHTML = blast.packages
          .slice(0, 4)
          .map((pkg) => `
            <div class="mc-pkg-row">
              <span class="pkg-name">${this.escape(pkg.packageName)}</span>
              <span class="pkg-stats">${pkg.filesTouched} files (+${pkg.linesAdded}/-${pkg.linesRemoved})</span>
            </div>
          `)
          .join('');
      }
    }

    // 5. Tool Execution Waterfall
    const llmTotal = document.getElementById('mc-llm-total');
    const toolTotal = document.getElementById('mc-tool-total');
    const avgLatency = document.getElementById('mc-avg-latency');
    const stream = document.getElementById('mc-waterfall-stream');

    if (llmTotal) llmTotal.textContent = `${(waterfall.totalLlmTimeMs / 1000).toFixed(1)}s`;
    if (toolTotal) toolTotal.textContent = `${(waterfall.totalToolTimeMs / 1000).toFixed(1)}s`;
    if (avgLatency) avgLatency.textContent = `Avg Tool: ${waterfall.averageToolDurationMs}ms`;

    if (stream) {
      if (waterfall.spans.length === 0) {
        stream.innerHTML = `<div class="mc-empty-hint">Waiting for tool execution spans...</div>`;
      } else {
        stream.innerHTML = waterfall.spans
          .slice(-6)
          .map((span) => `
            <div class="mc-span-row">
              <div class="span-header">
                <span class="span-title" style="color: ${span.color}">${this.escape(span.title)}</span>
                <span class="span-dur">${span.durationMs}ms</span>
              </div>
              <div class="span-bar-track">
                <div class="span-bar-fill" style="width: ${Math.min(100, Math.max(8, span.durationMs / 40))}%; background: ${span.color}"></div>
              </div>
            </div>
          `)
          .join('');
      }
    }
  }

  private escape(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
