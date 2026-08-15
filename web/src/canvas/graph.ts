import type { VisualizerEvent } from '../types';
import type { HullResult, WorkerNodeData } from '../workers/layout.worker';

export type SemanticNodeType =
  | 'goal'
  | 'agent'
  | 'file'
  | 'service'
  | 'test_suite'
  | 'checkpoint'
  | 'deliverable';

export type GraphFilterMode = 'all' | 'files' | 'agents' | 'services';

export interface SemanticNode {
  id: string;
  type: SemanticNodeType;
  title: string;
  subtitle: string;
  badge: string;
  color: string;
  icon: string;
  agentId?: string;
  filePath?: string;
  metrics: {
    editsCount?: number;
    linesChanged?: number;
    callsCount?: number;
    status?: 'PASS' | 'FAIL' | 'ACTIVE' | 'PENDING' | 'DONE';
    lastUpdated: number;
  };
  details: Record<string, any>;

  // Layout & rendering coordinates
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  pulse: number;
  width: number;
  height: number;
}

export interface SemanticLink {
  id: string;
  source: string;
  target: string;
  label?: string;
  color: string;
  pulseProgress: number;
}

export class FlowGraphCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;
  private worker: Worker | null = null;

  public nodes: Map<string, SemanticNode> = new Map();
  public links: Map<string, SemanticLink> = new Map();
  public hulls: HullResult[] = [];
  public filterMode: GraphFilterMode = 'all';

  private selectedNodeId: string | null = null;
  public onSelectNode?: (node: SemanticNode) => void;

  // Transform / Camera
  public zoom = 1.0;
  public panX = 0;
  public panY = 0;

  private isDragging = false;
  private isPanning = false;
  private dragNode: SemanticNode | null = null;
  private startMouseX = 0;
  private startMouseY = 0;

  private physicsActive = true;
  private isWorkerBusy = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.initWorker();
    this.setupEvents();
    this.resize();
  }

  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('../workers/layout.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        this.isWorkerBusy = false;
        const { type, nodes, hulls, energy } = e.data;

        if (type === 'LAYOUT_RESULT' || type === 'PHYSICS_TICK') {
          for (const wn of nodes as WorkerNodeData[]) {
            const local = this.nodes.get(wn.id);
            if (local && (!this.isDragging || this.dragNode?.id !== local.id)) {
              local.x = wn.x;
              local.y = wn.y;
              local.targetX = wn.targetX;
              local.targetY = wn.targetY;
            }
          }

          if (hulls) {
            this.hulls = hulls;
          }

          if (energy !== undefined && energy < 0.2) {
            this.physicsActive = false;
          }
        }
      };
    } catch (err) {
      console.warn('Web Worker initialization fallback to main thread:', err);
    }
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
      const newZoom = Math.max(0.3, Math.min(2.5, this.zoom * zoomFactor));

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;
    }, { passive: false });

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      const worldX = (clientX - this.panX) / this.zoom;
      const worldY = (clientY - this.panY) / this.zoom;

      let clickedNode: SemanticNode | null = null;
      for (const node of this.getVisibleNodes()) {
        const halfW = node.width / 2;
        const halfH = node.height / 2;
        if (
          worldX >= node.x - halfW &&
          worldX <= node.x + halfW &&
          worldY >= node.y - halfH &&
          worldY <= node.y + halfH
        ) {
          clickedNode = node;
          break;
        }
      }

      if (clickedNode) {
        this.isDragging = true;
        this.dragNode = clickedNode;
        this.selectedNodeId = clickedNode.id;
        if (this.onSelectNode) this.onSelectNode(clickedNode);
      } else {
        this.isPanning = true;
        this.startMouseX = clientX - this.panX;
        this.startMouseY = clientY - this.panY;
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      if (this.isDragging && this.dragNode) {
        this.dragNode.x = (clientX - this.panX) / this.zoom;
        this.dragNode.y = (clientY - this.panY) / this.zoom;
        this.dragNode.targetX = this.dragNode.x;
        this.dragNode.targetY = this.dragNode.y;
        this.wakePhysics();
      } else if (this.isPanning) {
        this.panX = clientX - this.startMouseX;
        this.panY = clientY - this.startMouseY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.isPanning = false;
      this.dragNode = null;
    });
  }

  public resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.parentElement?.getBoundingClientRect() || { width: 800, height: 600 };
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.resetTransform?.();
    this.ctx.scale(dpr, dpr);
  }

  public wakePhysics(): void {
    this.physicsActive = true;
  }

  public setFilterMode(mode: GraphFilterMode): void {
    this.filterMode = mode;
    this.spreadLayout();
  }

  public getVisibleNodes(): SemanticNode[] {
    const all = Array.from(this.nodes.values());
    if (this.filterMode === 'all') return all;
    if (this.filterMode === 'files') {
      return all.filter((n) => n.type === 'file' || n.type === 'agent' || n.type === 'goal');
    }
    if (this.filterMode === 'agents') {
      return all.filter((n) => n.type === 'goal' || n.type === 'agent' || n.type === 'checkpoint' || n.type === 'deliverable');
    }
    if (this.filterMode === 'services') {
      return all.filter((n) => n.type === 'service' || n.type === 'agent');
    }
    return all;
  }

  public handleEvent(evt: VisualizerEvent): void {
    // 1. Root Goal Node
    const goalNodeId = `goal-${evt.sessionId}`;
    if (!this.nodes.has(goalNodeId)) {
      this.nodes.set(goalNodeId, {
        id: goalNodeId,
        type: 'goal',
        title: 'User Prompt & Goal',
        subtitle: evt.sessionId.slice(0, 16),
        badge: 'ACTIVE OBJECTIVE',
        color: '#f59e0b',
        icon: '🎯',
        metrics: { lastUpdated: evt.timestamp, status: 'ACTIVE' },
        details: { sessionId: evt.sessionId },
        x: 80,
        y: 240,
        targetX: 80,
        targetY: 240,
        pulse: 1.0,
        width: 170,
        height: 56,
      });
    }

    // 2. Agent Node
    const agentNodeId = `agent-${evt.agentId}`;
    if (!this.nodes.has(agentNodeId)) {
      const isForeman = evt.agentId.includes('foreman') || !evt.agentRole || evt.agentRole === 'foreman';
      this.nodes.set(agentNodeId, {
        id: agentNodeId,
        type: 'agent',
        title: isForeman ? 'Foreman Orchestrator' : `${(evt.agentRole || 'Crafter').toUpperCase()} Specialist`,
        subtitle: evt.agentId,
        badge: isForeman ? '1F Master' : 'Subagent',
        color: isForeman ? '#f59e0b' : '#06b6d4',
        icon: '👷',
        agentId: evt.agentId,
        metrics: { lastUpdated: evt.timestamp },
        details: { role: evt.agentRole, agentId: evt.agentId },
        x: 350,
        y: 180 + this.getAgentCount() * 80,
        targetX: 350,
        targetY: 180 + this.getAgentCount() * 80,
        pulse: 1.0,
        width: 180,
        height: 56,
      });
      this.addOrUpdateLink(goalNodeId, agentNodeId, '#f59e0b', 'delegates');
    }

    // 3. Aggregate Files into Unique File Entities
    if (evt.type === 'file.write' || evt.type === 'file.read') {
      const rawPath = evt.payload?.file || evt.title.replace(/^(Forge|Read|Modify|Edit):\s*/i, '');
      const cleanPath = this.sanitizeFilePath(rawPath);
      const fileNodeId = `file-${cleanPath}`;

      let fileNode = this.nodes.get(fileNodeId);
      if (!fileNode) {
        fileNode = {
          id: fileNodeId,
          type: 'file',
          title: cleanPath.split('/').pop() || cleanPath,
          subtitle: cleanPath,
          badge: evt.type === 'file.write' ? '1 revision' : 'read inspection',
          color: '#10b981',
          icon: '📄',
          filePath: cleanPath,
          metrics: {
            editsCount: evt.type === 'file.write' ? 1 : 0,
            linesChanged: evt.payload?.lines || 0,
            lastUpdated: evt.timestamp,
          },
          details: { fullPath: cleanPath, lastAgent: evt.agentId, history: [evt.title] },
          x: 620,
          y: 140 + this.getFileCount() * 70,
          targetX: 620,
          targetY: 140 + this.getFileCount() * 70,
          pulse: 1.0,
          width: 190,
          height: 56,
        };
        this.nodes.set(fileNodeId, fileNode);
      } else {
        if (evt.type === 'file.write') {
          fileNode.metrics.editsCount = (fileNode.metrics.editsCount || 0) + 1;
          fileNode.metrics.linesChanged = (fileNode.metrics.linesChanged || 0) + (evt.payload?.lines || 0);
          fileNode.badge = `${fileNode.metrics.editsCount} revisions`;
          fileNode.color = '#ec4899';
        }
        fileNode.metrics.lastUpdated = evt.timestamp;
        fileNode.pulse = 1.0;
        fileNode.details.history = fileNode.details.history || [];
        fileNode.details.history.push(evt.title);
      }

      this.addOrUpdateLink(agentNodeId, fileNodeId, fileNode.color, evt.type === 'file.write' ? 'forges' : 'inspects');
    }

    // 4. Aggregate External MCP & Tools into Services
    else if (evt.type === 'mcp.call' || evt.type === 'mcp.response') {
      const serverName = evt.payload?.server || this.extractServiceName(evt.title);
      const serviceNodeId = `service-${serverName}`;

      let serviceNode = this.nodes.get(serviceNodeId);
      if (!serviceNode) {
        serviceNode = {
          id: serviceNodeId,
          type: 'service',
          title: `${serverName.toUpperCase()} MCP`,
          subtitle: evt.summary || 'External MCP Server Bridge',
          badge: '1 RPC call',
          color: '#a855f7',
          icon: '📞',
          metrics: { callsCount: 1, lastUpdated: evt.timestamp },
          details: { serverName, lastMethod: evt.payload?.method },
          x: 890,
          y: 140 + this.getServiceCount() * 70,
          targetX: 890,
          targetY: 140 + this.getServiceCount() * 70,
          pulse: 1.0,
          width: 180,
          height: 56,
        };
        this.nodes.set(serviceNodeId, serviceNode);
      } else {
        serviceNode.metrics.callsCount = (serviceNode.metrics.callsCount || 0) + 1;
        serviceNode.badge = `${serviceNode.metrics.callsCount} RPC calls`;
        serviceNode.metrics.lastUpdated = evt.timestamp;
        serviceNode.pulse = 1.0;
      }

      this.addOrUpdateLink(agentNodeId, serviceNodeId, '#a855f7', 'calls');
    }

    // 5. Test Verifications & Test Suites
    else if (evt.type === 'command.run' || evt.type === 'command.output') {
      const isTest = evt.title.includes('test') || (evt.payload?.cmd && evt.payload.cmd.includes('test'));
      if (isTest) {
        const testNodeId = 'test-suite-main';
        let testNode = this.nodes.get(testNodeId);
        if (!testNode) {
          testNode = {
            id: testNodeId,
            type: 'test_suite',
            title: 'Automated Test Suite',
            subtitle: 'Go table-driven verification',
            badge: 'PASSING (92%)',
            color: '#10b981',
            icon: '🧪',
            metrics: { status: 'PASS', lastUpdated: evt.timestamp },
            details: { command: evt.title },
            x: 890,
            y: 320,
            targetX: 890,
            targetY: 320,
            pulse: 1.0,
            width: 185,
            height: 56,
          };
          this.nodes.set(testNodeId, testNode);
        } else {
          testNode.pulse = 1.0;
          testNode.metrics.lastUpdated = evt.timestamp;
        }
        this.addOrUpdateLink(agentNodeId, testNodeId, '#10b981', 'executes');
      }
    }

    // 6. Security & Checkpoint Gates
    else if (evt.type === 'checkpoint.request' || evt.type === 'checkpoint.decision') {
      const cpId = evt.payload?.checkpointId || evt.id;
      const cpNodeId = `cp-${cpId}`;
      const isApproved = evt.payload?.decision === 'APPROVED';

      this.nodes.set(cpNodeId, {
        id: cpNodeId,
        type: 'checkpoint',
        title: 'Safety Checkpoint',
        subtitle: evt.summary || evt.title,
        badge: evt.type === 'checkpoint.decision' ? (isApproved ? '✅ APPROVED' : '❌ REJECTED') : '⚠️ PENDING APPROVAL',
        color: '#ef4444',
        icon: '🛡️',
        metrics: { status: isApproved ? 'PASS' : 'PENDING', lastUpdated: evt.timestamp },
        details: evt.payload || {},
        x: 620,
        y: 380,
        targetX: 620,
        targetY: 380,
        pulse: 1.0,
        width: 190,
        height: 56,
      });

      this.addOrUpdateLink(agentNodeId, cpNodeId, '#ef4444', 'guards');
    }

    // 7. Deliverable / Session Finished
    else if (evt.type === 'session.end') {
      const deliverableId = 'artifact-release';
      this.nodes.set(deliverableId, {
        id: deliverableId,
        type: 'deliverable',
        title: 'Release Deliverable',
        subtitle: 'Standalone Binary & UI Embedded',
        badge: 'READY',
        color: '#14b8a6',
        icon: '📦',
        metrics: { status: 'DONE', lastUpdated: evt.timestamp },
        details: {},
        x: 1160,
        y: 240,
        targetX: 1160,
        targetY: 240,
        pulse: 1.0,
        width: 190,
        height: 56,
      });

      this.addOrUpdateLink(agentNodeId, deliverableId, '#14b8a6', 'ships');
    }

    this.wakePhysics();
  }

  private sanitizeFilePath(raw: string): string {
    return raw.replace(/^(modified|created|edited|read|wrote):\s*/i, '').trim();
  }

  private extractServiceName(title: string): string {
    if (title.toLowerCase().includes('github')) return 'github';
    if (title.toLowerCase().includes('gopls')) return 'gopls';
    if (title.toLowerCase().includes('web')) return 'web-search';
    return 'mcp-server';
  }

  private getAgentCount(): number {
    return Array.from(this.nodes.values()).filter((n) => n.type === 'agent').length;
  }

  private getFileCount(): number {
    return Array.from(this.nodes.values()).filter((n) => n.type === 'file').length;
  }

  private getServiceCount(): number {
    return Array.from(this.nodes.values()).filter((n) => n.type === 'service').length;
  }

  private addOrUpdateLink(source: string, target: string, color: string, label?: string): void {
    const linkId = `${source}->${target}`;
    if (!this.links.has(linkId)) {
      this.links.set(linkId, {
        id: linkId,
        source,
        target,
        color,
        label,
        pulseProgress: Math.random(),
      });
    }
  }

  // Offloaded to Web Worker!
  public spreadLayout(): void {
    if (this.worker) {
      const workerNodes = Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        type: n.type,
        width: n.width,
        height: n.height,
        x: n.x,
        y: n.y,
        targetX: n.targetX,
        targetY: n.targetY,
        vx: 0,
        vy: 0,
      }));

      const workerLinks = Array.from(this.links.values()).map((l) => ({
        id: l.id,
        source: l.source,
        target: l.target,
      }));

      this.worker.postMessage({
        type: 'COMPUTE_SPREAD_LAYOUT',
        payload: {
          nodes: workerNodes,
          links: workerLinks,
          filterMode: this.filterMode,
        },
      });
    }

    this.wakePhysics();
    setTimeout(() => this.centerView(), 50);
  }

  public centerView(): void {
    const visible = this.getVisibleNodes();
    if (visible.length === 0) return;

    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of visible) {
      minX = Math.min(minX, node.x - node.width / 2);
      minY = Math.min(minY, node.y - node.height / 2);
      maxX = Math.max(maxX, node.x + node.width / 2);
      maxY = Math.max(maxY, node.y + node.height / 2);
    }

    const graphWidth = maxX - minX + 160;
    const graphHeight = maxY - minY + 160;

    this.zoom = Math.min(1.15, Math.max(0.45, Math.min(width / graphWidth, height / graphHeight)));
    this.panX = width / 2 - ((minX + maxX) / 2) * this.zoom;
    this.panY = height / 2 - ((minY + maxY) / 2) * this.zoom;
  }

  public start(): void {
    if (this.animationFrameId !== null) return;
    const loop = () => {
      this.update();
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private update(): void {
    // Dispatch physics step to worker if active
    if (this.physicsActive && this.worker && !this.isWorkerBusy) {
      this.isWorkerBusy = true;
      const workerNodes = Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        type: n.type,
        width: n.width,
        height: n.height,
        x: n.x,
        y: n.y,
        targetX: n.targetX,
        targetY: n.targetY,
        vx: 0,
        vy: 0,
      }));

      const workerLinks = Array.from(this.links.values()).map((l) => ({
        id: l.id,
        source: l.source,
        target: l.target,
      }));

      this.worker.postMessage({
        type: 'SIMULATE_PHYSICS_STEP',
        payload: { nodes: workerNodes, links: workerLinks },
      });
    }

    for (const node of this.nodes.values()) {
      if (node.pulse > 0) {
        node.pulse = Math.max(0, node.pulse - 0.02);
      }
    }

    for (const link of this.links.values()) {
      link.pulseProgress = (link.pulseProgress + 0.02) % 1;
    }
  }

  private render(): void {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    const visibleNodes = this.getVisibleNodes();
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    // 1. Draw Precomputed Semantic Group Hulls from Web Worker
    for (const hull of this.hulls) {
      const w = hull.maxX - hull.minX;
      const h = hull.maxY - hull.minY;

      ctx.save();
      ctx.fillStyle = `${hull.color}0a`;
      ctx.strokeStyle = `${hull.color}33`;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      ctx.roundRect(hull.minX, hull.minY, w, h, 8);
      ctx.fill();
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.fillStyle = hull.color;
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(hull.title, hull.minX + 10, hull.minY + 16);
      ctx.restore();
    }

    // 2. Draw Links & Animated Packets
    for (const link of this.links.values()) {
      if (!visibleNodeIds.has(link.source) || !visibleNodeIds.has(link.target)) continue;

      const src = this.nodes.get(link.source);
      const tgt = this.nodes.get(link.target);
      if (!src || !tgt) continue;

      const sx = src.x + src.width / 2;
      const sy = src.y;
      const tx = tgt.x - tgt.width / 2;
      const ty = tgt.y;

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo((sx + tx) / 2, sy, (sx + tx) / 2, ty, tx, ty);
      ctx.stroke();

      const t = link.pulseProgress;
      const cp1x = (sx + tx) / 2;
      const cp1y = sy;
      const cp2x = (sx + tx) / 2;
      const cp2y = ty;

      const px = Math.pow(1 - t, 3) * sx + 3 * Math.pow(1 - t, 2) * t * cp1x + 3 * (1 - t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * tx;
      const py = Math.pow(1 - t, 3) * sy + 3 * Math.pow(1 - t, 2) * t * cp1y + 3 * (1 - t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * ty;

      ctx.fillStyle = link.color;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();

      if (link.label) {
        ctx.font = '8px monospace';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText(link.label, (sx + tx) / 2, (sy + ty) / 2 - 6);
      }
    }

    // 3. Draw Semantic Node Cards
    for (const node of visibleNodes) {
      const isSelected = this.selectedNodeId === node.id;
      const rx = node.x - node.width / 2;
      const ry = node.y - node.height / 2;

      ctx.save();

      if (node.pulse > 0 || isSelected) {
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.25)' : `${node.color}22`;
        ctx.beginPath();
        ctx.roundRect(rx - 3, ry - 3, node.width + 6, node.height + 6, 8);
        ctx.fill();
      }

      ctx.fillStyle = '#111827';
      ctx.strokeStyle = isSelected ? '#38bdf8' : node.color;
      ctx.lineWidth = isSelected ? 2 : 1.2;

      ctx.beginPath();
      ctx.roundRect(rx, ry, node.width, node.height, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = node.color;
      ctx.fillRect(rx, ry, 4, node.height);

      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.fillText(`${node.icon} ${node.title}`, rx + 10, ry + 20);

      ctx.font = 'bold 8px monospace';
      ctx.fillStyle = node.color;
      ctx.textAlign = 'right';
      ctx.fillText(node.badge, rx + node.width - 8, ry + 20);

      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'left';
      const shortSub = node.subtitle.length > 24 ? '…' + node.subtitle.slice(-22) : node.subtitle;
      ctx.fillText(shortSub, rx + 10, ry + 40);

      ctx.restore();
    }

    ctx.restore();
  }
}
