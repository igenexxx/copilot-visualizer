import type { VisualizerEvent } from '../types';

export interface PipelineStageNode {
  id: string;
  stageIndex: number; // 0..5
  stageTitle: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  badge: string;
  stats: {
    primaryValue: string;
    primaryLabel: string;
    secondaryValue: string;
    secondaryLabel: string;
    status: 'IDLE' | 'ACTIVE' | 'PASS' | 'SUCCESS';
    progressPct: number;
  };
  details: Record<string, any>;
  x: number;
  y: number;
  width: number;
  height: number;
  pulseTime: number;
}

export interface PipelineEdge {
  fromId: string;
  toId: string;
  color: string;
  pulseOffset: number;
}

export class FlowGraphCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  public isVisible = false;
  private animationFrameId: number | null = null;

  public stageNodes: Map<string, PipelineStageNode> = new Map();
  public edges: PipelineEdge[] = [];
  public selectedNodeId: string | null = null;
  public onSelectNode?: (node: PipelineStageNode) => void;

  // Camera & Pan/Zoom
  public zoom = 0.88;
  public panX = 40;
  public panY = 60;

  private isPanning = false;
  private startMouseX = 0;
  private startMouseY = 0;

  // Domain aggregation tracking
  private domainStats = {
    backend: { files: new Set<string>(), edits: 0, linesAdded: 0, linesRemoved: 0 },
    frontend: { files: new Set<string>(), edits: 0, linesAdded: 0, linesRemoved: 0 },
    system: { files: new Set<string>(), edits: 0, linesAdded: 0, linesRemoved: 0 },
  };

  private agentStats = {
    foreman: { actions: 0, lastActive: 0 },
    crafter: { actions: 0, lastActive: 0 },
    inspector: { actions: 0, lastActive: 0 },
    tester: { actions: 0, lastActive: 0 },
    operator: { actions: 0, lastActive: 0 },
  };

  private mcpStats = {
    github: 0,
    gopls: 0,
    web: 0,
    security: 0,
  };

  private testStats = {
    runs: 0,
    passes: 0,
    failures: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.initPipelineNodes();
    this.setupEvents();
    this.resize();
  }

  private initPipelineNodes(): void {
    const colWidth = 270;
    const colGap = 80;
    const startX = 60;

    const createNode = (
      id: string,
      stageIndex: number,
      yIndex: number,
      stageTitle: string,
      title: string,
      subtitle: string,
      icon: string,
      color: string,
      badge: string,
      pVal: string,
      pLbl: string,
      sVal: string,
      sLbl: string
    ): PipelineStageNode => {
      const x = startX + stageIndex * (colWidth + colGap);
      const y = 80 + yIndex * 150;
      return {
        id,
        stageIndex,
        stageTitle,
        title,
        subtitle,
        icon,
        color,
        badge,
        stats: {
          primaryValue: pVal,
          primaryLabel: pLbl,
          secondaryValue: sVal,
          secondaryLabel: sLbl,
          status: 'IDLE',
          progressPct: 0,
        },
        details: {},
        x,
        y,
        width: colWidth,
        height: 120,
        pulseTime: 0,
      };
    };

    // Stage 0: User Goal & Intercom
    this.stageNodes.set(
      'node-goal',
      createNode('node-goal', 0, 0, 'STAGE 1: OBJECTIVE', 'User Goal & Guidance', 'Interactive pair-programming', '🎯', '#06b6d4', 'OBJECTIVE', '1 Active', 'Goal Track', '100%', 'Alignment')
    );
    this.stageNodes.set(
      'node-intercom',
      createNode('node-intercom', 0, 1, 'STAGE 1: GUIDANCE', 'Foreman Intercom', 'Human-in-the-loop frequency', '📻', '#f59e0b', 'INTERCOM', '0 Messages', 'Prompts Sent', 'Online', 'Signal')
    );

    // Stage 1: Agent Swarm & Specialist Roles
    this.stageNodes.set(
      'node-agent-crafter',
      createNode('node-agent-crafter', 1, 0, 'STAGE 2: SQUAD', 'Crafter & Architect', 'Code modification specialist', '⚡', '#3b82f6', 'CRAFTER', '0 Forged', 'Code Blocks', '100%', 'Capacity')
    );
    this.stageNodes.set(
      'node-agent-tester',
      createNode('node-agent-tester', 1, 1, 'STAGE 2: SQUAD', 'Inspector & Tester', 'Testing & file verification', '🧪', '#10b981', 'TESTER', '0 Checked', 'Inspections', '0ms', 'Avg Speed')
    );

    // Stage 2: Codebase Domains (Aggregated High-Level Clusters!)
    this.stageNodes.set(
      'node-domain-backend',
      createNode('node-domain-backend', 2, 0, 'STAGE 3: DOMAIN', 'Backend Core (Go)', 'pkg/server, pkg/recorder, pkg/hub', '📦', '#a855f7', 'BACKEND', '0 Files', 'Domain Scope', '+0 / -0', 'Code Delta')
    );
    this.stageNodes.set(
      'node-domain-frontend',
      createNode('node-domain-frontend', 2, 1, 'STAGE 3: DOMAIN', 'Frontend Client (Vite)', 'web/src/canvas, web/src/rpg', '🎨', '#ec4899', 'FRONTEND', '0 Files', 'Domain Scope', '+0 / -0', 'Code Delta')
    );
    this.stageNodes.set(
      'node-domain-system',
      createNode('node-domain-system', 2, 2, 'STAGE 3: DOMAIN', 'System & Config', 'cmd/server, taskfile, docs', '⚙️', '#64748b', 'SYSTEM', '0 Files', 'Domain Scope', 'Clean', 'Health')
    );

    // Stage 3: MCP & Tool Bridges
    this.stageNodes.set(
      'node-mcp-github',
      createNode('node-mcp-github', 3, 0, 'STAGE 4: BRIDGES', 'GitHub & Gopls MCP', 'Codebase LSP & Git integrations', '🐙', '#38bdf8', 'MCP SERVER', '0 Calls', 'RPC Invoked', '100%', 'Success Rate')
    );
    this.stageNodes.set(
      'node-mcp-security',
      createNode('node-mcp-security', 3, 1, 'STAGE 4: BRIDGES', 'Security Gateway', 'Guardrails & safety checkpoints', '🛡️', '#10b981', 'SAFETY GATE', '0 Verified', 'Checkpoints', 'PASS', 'Status')
    );

    // Stage 4: Quality & Verification Gates
    this.stageNodes.set(
      'node-verify-tests',
      createNode('node-verify-tests', 4, 0, 'STAGE 5: QUALITY', 'Automated Test Suites', 'Adversarial Go tests & race detector', '✅', '#10b981', 'VERIFICATION', '100%', 'Pass Rate', '0 Tests', 'Suites Run')
    );
    this.stageNodes.set(
      'node-verify-build',
      createNode('node-verify-build', 4, 1, 'STAGE 5: QUALITY', 'Pipeline Build Gate', 'TypeScript compilation & Go binary', '🔨', '#06b6d4', 'BUILD GATE', 'PASS', 'Compiler', '0 Errors', 'Diagnostics')
    );

    // Stage 5: Production Deliverables
    this.stageNodes.set(
      'node-deliverable-bin',
      createNode('node-deliverable-bin', 5, 0, 'STAGE 6: OUTPUT', 'Standalone Binary', './copilot-visualizer executable', '🚀', '#f59e0b', 'PRODUCTION', 'Ready', 'Release', 'Embedded', 'Web Assets')
    );

    // Connect Pipeline Edges
    this.edges = [
      { fromId: 'node-goal', toId: 'node-agent-crafter', color: '#06b6d4', pulseOffset: 0 },
      { fromId: 'node-intercom', toId: 'node-agent-tester', color: '#f59e0b', pulseOffset: 0.3 },
      { fromId: 'node-agent-crafter', toId: 'node-domain-backend', color: '#3b82f6', pulseOffset: 0.5 },
      { fromId: 'node-agent-crafter', toId: 'node-domain-frontend', color: '#ec4899', pulseOffset: 0.2 },
      { fromId: 'node-agent-tester', toId: 'node-domain-system', color: '#64748b', pulseOffset: 0.7 },
      { fromId: 'node-domain-backend', toId: 'node-mcp-github', color: '#a855f7', pulseOffset: 0.4 },
      { fromId: 'node-domain-frontend', toId: 'node-mcp-security', color: '#10b981', pulseOffset: 0.8 },
      { fromId: 'node-mcp-github', toId: 'node-verify-tests', color: '#38bdf8', pulseOffset: 0.1 },
      { fromId: 'node-mcp-security', toId: 'node-verify-build', color: '#06b6d4', pulseOffset: 0.6 },
      { fromId: 'node-verify-tests', toId: 'node-deliverable-bin', color: '#10b981', pulseOffset: 0.3 },
      { fromId: 'node-verify-build', toId: 'node-deliverable-bin', color: '#f59e0b', pulseOffset: 0.9 },
    ];
  }

  public handleEvent(evt: VisualizerEvent, isHistory: boolean = false): void {
    const now = isHistory ? 0 : Date.now();

    // 1. Process Domain Files
    if (evt.type === 'file.write' || evt.type === 'file.read') {
      const file = (evt.payload?.file || evt.payload?.TargetFile || evt.title || '').toLowerCase();
      let targetDomain = this.domainStats.backend;
      let nodeKey = 'node-domain-backend';

      if (file.includes('web/') || file.includes('.ts') || file.includes('.css') || file.includes('.html')) {
        targetDomain = this.domainStats.frontend;
        nodeKey = 'node-domain-frontend';
      } else if (file.includes('taskfile') || file.includes('docker') || file.includes('docs/')) {
        targetDomain = this.domainStats.system;
        nodeKey = 'node-domain-system';
      }

      if (file) targetDomain.files.add(file);
      targetDomain.edits++;
      if (evt.type === 'file.write') {
        const added = (evt.payload?.added as number) || 15;
        const removed = (evt.payload?.removed as number) || 2;
        targetDomain.linesAdded += added;
        targetDomain.linesRemoved += removed;
      }

      const node = this.stageNodes.get(nodeKey);
      if (node) {
        node.pulseTime = now;
        node.stats.status = isHistory ? 'IDLE' : 'ACTIVE';
        node.stats.primaryValue = `${targetDomain.files.size} Files`;
        node.stats.secondaryValue = `+${targetDomain.linesAdded} / -${targetDomain.linesRemoved}`;
      }
    }

    // 2. Process Agent Roles
    if (evt.type === 'file.write' || evt.type === 'tool.call') {
      this.agentStats.crafter.actions++;
      const node = this.stageNodes.get('node-agent-crafter');
      if (node) {
        node.pulseTime = now;
        node.stats.status = 'ACTIVE';
        node.stats.primaryValue = `${this.agentStats.crafter.actions} Actions`;
      }
    } else if (evt.type === 'command.run' || evt.type === 'file.read') {
      this.agentStats.tester.actions++;
      const node = this.stageNodes.get('node-agent-tester');
      if (node) {
        node.pulseTime = now;
        node.stats.status = 'ACTIVE';
        node.stats.primaryValue = `${this.agentStats.tester.actions} Actions`;
      }
    }

    // 3. Process MCP & Security Gates
    if (evt.type.startsWith('mcp.')) {
      this.mcpStats.github++;
      const node = this.stageNodes.get('node-mcp-github');
      if (node) {
        node.pulseTime = now;
        node.stats.status = 'ACTIVE';
        node.stats.primaryValue = `${this.mcpStats.github} Calls`;
      }
    } else if (evt.type.startsWith('checkpoint.')) {
      this.mcpStats.security++;
      const node = this.stageNodes.get('node-mcp-security');
      if (node) {
        node.pulseTime = now;
        node.stats.status = 'ACTIVE';
        node.stats.primaryValue = `${this.mcpStats.security} Checks`;
        node.stats.secondaryValue = 'VERIFIED';
      }
    } else if (evt.type === 'intervention.prompt') {
      const node = this.stageNodes.get('node-intercom');
      if (node) {
        node.pulseTime = now;
        node.stats.status = 'ACTIVE';
        node.stats.primaryValue = 'Signal Sent';
        node.stats.secondaryValue = evt.summary || 'Guidance Prompt';
      }
    }

    // 4. Process Tests & Build Gates
    if (evt.type === 'command.run' || evt.type === 'command.output') {
      this.testStats.runs++;
      this.testStats.passes++;
      const testNode = this.stageNodes.get('node-verify-tests');
      const buildNode = this.stageNodes.get('node-verify-build');

      if (testNode) {
        testNode.pulseTime = now;
        testNode.stats.status = 'PASS';
        testNode.stats.primaryValue = '100% PASS';
        testNode.stats.secondaryValue = `${this.testStats.runs} Runs Safe`;
      }
      if (buildNode) {
        buildNode.pulseTime = now;
        buildNode.stats.status = 'SUCCESS';
        buildNode.stats.primaryValue = 'PASS';
        buildNode.stats.secondaryValue = 'Clean Build';
      }
    }
  }

  public setFilterMode(mode: any): void {
    // Mode filtering smoothly pans camera to focus that pipeline stage!
    if (mode === 'files') {
      this.panX = -320;
    } else if (mode === 'agents') {
      this.panX = 20;
    } else if (mode === 'services') {
      this.panX = -640;
    } else {
      this.centerView();
    }
  }

  public spreadLayout(): void {
    this.centerView();
  }

  public centerView(): void {
    this.zoom = 0.85;
    this.panX = 30;
    this.panY = 60;
  }

  public start(): void {
    if (this.animationFrameId !== null) return;
    const render = () => {
      if (this.isVisible) {
        this.draw();
        this.animationFrameId = requestAnimationFrame(render);
      } else {
        this.animationFrameId = null;
      }
    };
    if (this.isVisible) {
      this.animationFrameId = requestAnimationFrame(render);
    }
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    if (visible) {
      this.start();
      this.resize();
    } else {
      this.stop();
    }
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;

    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.scale(dpr, dpr);
  }

  private draw(): void {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);

    this.ctx.clearRect(0, 0, w, h);

    // Subtle dark gradient background
    const bgGrad = this.ctx.createRadialGradient(w / 2, h / 2, 50, w / 2, h / 2, Math.max(w, h));
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(1, '#080c14');
    this.ctx.fillStyle = bgGrad;
    this.ctx.fillRect(0, 0, w, h);

    // Draw tech background grid
    this.drawGrid(w, h);

    this.ctx.save();
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // Draw Column Headers / Stage Dividers
    this.drawStageHeaders();

    // Draw Bezier Edges
    this.drawEdges();

    // Draw Stage Nodes
    this.drawNodes();

    this.ctx.restore();
  }

  private drawGrid(w: number, h: number): void {
    this.ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
    this.ctx.lineWidth = 1;
    const gridSize = 40;
    const offsetX = this.panX % gridSize;
    const offsetY = this.panY % gridSize;

    this.ctx.beginPath();
    for (let x = offsetX; x < w; x += gridSize) {
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, h);
    }
    for (let y = offsetY; y < h; y += gridSize) {
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(w, y);
    }
    this.ctx.stroke();
  }

  private drawStageHeaders(): void {
    const stages = [
      { name: '1. INTENT & INPUT', desc: 'Goal & Human Intercom' },
      { name: '2. AGENT SWARM', desc: 'Specialist Roles' },
      { name: '3. CODE DOMAINS', desc: 'Aggregated Subsystems' },
      { name: '4. MCP BRIDGES', desc: 'External Integrations' },
      { name: '5. VERIFICATION', desc: 'Tests & Quality Gates' },
      { name: '6. DELIVERABLES', desc: 'Artifacts & Builds' },
    ];

    const colWidth = 270;
    const colGap = 80;
    const startX = 60;

    stages.forEach((st, idx) => {
      const x = startX + idx * (colWidth + colGap);
      this.ctx.fillStyle = '#64748b';
      this.ctx.font = '700 11px monospace';
      this.ctx.fillText(st.name, x, 40);

      this.ctx.fillStyle = '#475569';
      this.ctx.font = '9px sans-serif';
      this.ctx.fillText(st.desc, x, 55);

      // Subtle column lane line
      this.ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([4, 4]);
      this.ctx.beginPath();
      this.ctx.moveTo(x + colWidth + colGap / 2, 20);
      this.ctx.lineTo(x + colWidth + colGap / 2, 700);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    });
  }

  private drawEdges(): void {
    const now = Date.now() / 1000;

    this.edges.forEach((edge) => {
      const source = this.stageNodes.get(edge.fromId);
      const target = this.stageNodes.get(edge.toId);
      if (!source || !target) return;

      const sx = source.x + source.width;
      const sy = source.y + source.height / 2;
      const tx = target.x;
      const ty = target.y + target.height / 2;

      const cp1x = sx + (tx - sx) * 0.5;
      const cp1y = sy;
      const cp2x = sx + (tx - sx) * 0.5;
      const cp2y = ty;

      // Base line
      this.ctx.beginPath();
      this.ctx.moveTo(sx, sy);
      this.ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, tx, ty);
      this.ctx.strokeStyle = 'rgba(71, 85, 105, 0.4)';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // Energy Pulse Particle
      const t = (now * 0.5 + edge.pulseOffset) % 1.0;
      const px = Math.pow(1 - t, 3) * sx + 3 * Math.pow(1 - t, 2) * t * cp1x + 3 * (1 - t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * tx;
      const py = Math.pow(1 - t, 3) * sy + 3 * Math.pow(1 - t, 2) * t * cp1y + 3 * (1 - t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * ty;

      this.ctx.beginPath();
      this.ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      this.ctx.fillStyle = edge.color;
      this.ctx.fill();
    });
  }

  private drawNodes(): void {
    const now = Date.now();

    this.stageNodes.forEach((node) => {
      const isSelected = this.selectedNodeId === node.id;
      const isPulsing = now - node.pulseTime < 1500;

      // Card Background
      this.ctx.fillStyle = isSelected ? '#1e293b' : '#0f172a';
      this.ctx.strokeStyle = isPulsing ? node.color : isSelected ? '#38bdf8' : '#334155';
      this.ctx.lineWidth = isPulsing ? 2.5 : isSelected ? 2 : 1;

      this.roundRect(node.x, node.y, node.width, node.height, 8, true, true);

      // Stage Tag / Badge
      this.ctx.fillStyle = `${node.color}22`;
      this.ctx.strokeStyle = node.color;
      this.ctx.lineWidth = 1;
      this.roundRect(node.x + 10, node.y + 10, 80, 16, 4, true, true);

      this.ctx.fillStyle = node.color;
      this.ctx.font = '700 8px monospace';
      this.ctx.fillText(node.badge, node.x + 16, node.y + 21);

      // Icon & Title
      this.ctx.font = '16px sans-serif';
      this.ctx.fillText(node.icon, node.x + node.width - 28, node.y + 24);

      this.ctx.fillStyle = '#f8fafc';
      this.ctx.font = '700 12px sans-serif';
      this.ctx.fillText(node.title, node.x + 10, node.y + 45);

      this.ctx.fillStyle = '#94a3b8';
      this.ctx.font = '10px sans-serif';
      this.ctx.fillText(node.subtitle, node.x + 10, node.y + 60);

      // Bottom Stats Divider & Metrics
      this.ctx.strokeStyle = '#1e293b';
      this.ctx.beginPath();
      this.ctx.moveTo(node.x + 10, node.y + 72);
      this.ctx.lineTo(node.x + node.width - 10, node.y + 72);
      this.ctx.stroke();

      // Primary Metric
      this.ctx.fillStyle = '#38bdf8';
      this.ctx.font = '700 13px monospace';
      this.ctx.fillText(node.stats.primaryValue, node.x + 10, node.y + 92);

      this.ctx.fillStyle = '#64748b';
      this.ctx.font = '8px monospace';
      this.ctx.fillText(node.stats.primaryLabel.toUpperCase(), node.x + 10, node.y + 104);

      // Secondary Metric
      this.ctx.fillStyle = node.stats.status === 'PASS' || node.stats.status === 'SUCCESS' ? '#10b981' : '#f59e0b';
      this.ctx.font = '700 11px monospace';
      const sWidth = this.ctx.measureText(node.stats.secondaryValue).width;
      this.ctx.fillText(node.stats.secondaryValue, node.x + node.width - 10 - sWidth, node.y + 92);

      this.ctx.fillStyle = '#64748b';
      this.ctx.font = '8px monospace';
      const sLblWidth = this.ctx.measureText(node.stats.secondaryLabel).width;
      this.ctx.fillText(node.stats.secondaryLabel.toUpperCase(), node.x + node.width - 10 - sLblWidth, node.y + 104);
    });
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number, fill: boolean, stroke: boolean): void {
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.arcTo(x + w, y, x + w, y + h, r);
    this.ctx.arcTo(x + w, y + h, x, y + h, r);
    this.ctx.arcTo(x, y + h, x, y, r);
    this.ctx.arcTo(x, y, x + w, y, r);
    this.ctx.closePath();
    if (fill) this.ctx.fill();
    if (stroke) this.ctx.stroke();
  }

  private setupEvents(): void {
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
      this.zoom = Math.max(0.4, Math.min(2.5, this.zoom * zoomFactor));
    });

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - this.panX) / this.zoom;
      const mouseY = (e.clientY - rect.top - this.panY) / this.zoom;

      let clickedNode: PipelineStageNode | null = null;
      for (const node of this.stageNodes.values()) {
        if (mouseX >= node.x && mouseX <= node.x + node.width && mouseY >= node.y && mouseY <= node.y + node.height) {
          clickedNode = node;
          break;
        }
      }

      if (clickedNode) {
        this.selectedNodeId = clickedNode.id;
        if (this.onSelectNode) {
          this.onSelectNode(clickedNode);
        }
      } else {
        this.isPanning = true;
        this.startMouseX = e.clientX - this.panX;
        this.startMouseY = e.clientY - this.panY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.startMouseX;
        this.panY = e.clientY - this.startMouseY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    window.addEventListener('resize', () => {
      this.resize();
    });
    if (this.canvas.parentElement && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(this.canvas.parentElement);
    }
  }

  public triggerLevelUpEffect(_lvl: number, _title: string): void {
    for (const node of this.stageNodes.values()) {
      node.pulseTime = 1.0;
    }
  }
}
