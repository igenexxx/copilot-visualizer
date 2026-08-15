import type { VisualizerEvent } from '../types';

export type NodeGroup = 'session' | 'agents' | 'files' | 'commands' | 'mcp' | 'security' | 'output';

export interface GraphNode {
  id: string;
  label: string;
  sublabel: string;
  group: NodeGroup;
  color: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  pulse: number;
  timestamp: number;
  width: number;
  height: number;
}

export interface GraphLink {
  source: string;
  target: string;
  color: string;
  pulseProgress: number;
}

export interface GroupHull {
  group: NodeGroup;
  title: string;
  color: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class FlowGraphCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  public nodes: Map<string, GraphNode> = new Map();
  public links: GraphLink[] = [];

  private selectedNodeId: string | null = null;
  public onSelectNode?: (node: GraphNode) => void;

  // Transform / Camera
  public zoom = 1.0;
  public panX = 0;
  public panY = 0;

  private isDragging = false;
  private isPanning = false;
  private dragNode: GraphNode | null = null;
  private startMouseX = 0;
  private startMouseY = 0;

  private physicsActive = true;
  private alpha = 1.0; // simulation energy

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.setupEvents();
    this.resize();
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.3, Math.min(3.0, this.zoom * zoomFactor));

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Zoom towards mouse pointer
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

      // Check node click
      let clickedNode: GraphNode | null = null;
      for (const node of this.nodes.values()) {
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
        // Start canvas panning
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
    this.alpha = 1.0;
    this.physicsActive = true;
  }

  public handleEvent(evt: VisualizerEvent): void {
    // 1. Session Node
    const sessionNodeId = `sess-${evt.sessionId}`;
    if (!this.nodes.has(sessionNodeId)) {
      this.nodes.set(sessionNodeId, {
        id: sessionNodeId,
        label: 'Session Root',
        sublabel: evt.sessionId.slice(0, 12),
        group: 'session',
        color: '#f59e0b',
        x: 60,
        y: 260,
        targetX: 60,
        targetY: 260,
        vx: 0,
        vy: 0,
        pulse: 1.0,
        timestamp: evt.timestamp,
        width: 140,
        height: 48,
      });
    }

    // 2. Agent Node
    const agentNodeId = `agent-${evt.agentId}`;
    if (!this.nodes.has(agentNodeId)) {
      const idx = Array.from(this.nodes.values()).filter((n) => n.group === 'agents').length;
      this.nodes.set(agentNodeId, {
        id: agentNodeId,
        label: evt.agentRole ? `${evt.agentRole.toUpperCase()} AGENT` : 'MAIN AGENT',
        sublabel: evt.agentId,
        group: 'agents',
        color: '#06b6d4',
        x: 260,
        y: 180 + idx * 80,
        targetX: 260,
        targetY: 180 + idx * 80,
        vx: 0,
        vy: 0,
        pulse: 1.0,
        timestamp: evt.timestamp,
        width: 150,
        height: 48,
      });
      this.addLink(sessionNodeId, agentNodeId, '#f59e0b');
    }

    // 3. Classify Group & Colors
    let group: NodeGroup = 'files';
    let color = '#ec4899';

    if (evt.type.startsWith('file.')) {
      group = 'files';
      color = '#10b981';
    } else if (evt.type.startsWith('command.')) {
      group = 'commands';
      color = '#38bdf8';
    } else if (evt.type.startsWith('mcp.')) {
      group = 'mcp';
      color = '#a855f7';
    } else if (evt.type.startsWith('checkpoint.') || evt.type.startsWith('emergency.') || evt.type.startsWith('intervention.')) {
      group = 'security';
      color = '#ef4444';
    } else if (evt.type === 'session.end') {
      group = 'output';
      color = '#14b8a6';
    }

    const toolNodeId = `evt-${evt.id}`;
    if (!this.nodes.has(toolNodeId)) {
      // Auto-position inside group swimlane
      const groupColumn = this.getGroupColumnX(group);
      const groupCount = Array.from(this.nodes.values()).filter((n) => n.group === group).length;

      this.nodes.set(toolNodeId, {
        id: toolNodeId,
        label: evt.title.length > 22 ? evt.title.slice(0, 20) + '…' : evt.title,
        sublabel: evt.summary ? (evt.summary.length > 26 ? evt.summary.slice(0, 24) + '…' : evt.summary) : evt.type,
        group,
        color,
        x: groupColumn,
        y: 120 + groupCount * 65,
        targetX: groupColumn,
        targetY: 120 + groupCount * 65,
        vx: 0,
        vy: 0,
        pulse: 1.0,
        timestamp: evt.timestamp,
        width: 170,
        height: 52,
      });

      this.addLink(agentNodeId, toolNodeId, color);
      this.wakePhysics();
    }
  }

  private getGroupColumnX(group: NodeGroup): number {
    switch (group) {
      case 'session': return 60;
      case 'agents': return 260;
      case 'files': return 480;
      case 'commands': return 700;
      case 'mcp': return 920;
      case 'security': return 1140;
      case 'output': return 1360;
    }
  }

  // Spread / Unfold graph into clean, readable hierarchical columns
  public spreadLayout(): void {
    const groupsOrder: NodeGroup[] = ['session', 'agents', 'files', 'commands', 'mcp', 'security', 'output'];
    const colSpacing = 240;
    const rowSpacing = 70;
    const startX = 60;
    const startY = 100;

    groupsOrder.forEach((grp, colIdx) => {
      const groupNodes = Array.from(this.nodes.values()).filter((n) => n.group === grp);
      groupNodes.forEach((node, rowIdx) => {
        node.targetX = startX + colIdx * colSpacing;
        node.targetY = startY + rowIdx * rowSpacing;
      });
    });

    this.wakePhysics();
    this.centerView();
  }

  public centerView(): void {
    if (this.nodes.size === 0) return;
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of this.nodes.values()) {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    }

    const graphWidth = maxX - minX + 120;
    const graphHeight = maxY - minY + 120;

    this.zoom = Math.min(1.2, Math.max(0.5, Math.min(width / graphWidth, height / graphHeight)));
    this.panX = width / 2 - ((minX + maxX) / 2) * this.zoom;
    this.panY = height / 2 - ((minY + maxY) / 2) * this.zoom;
  }

  private addLink(source: string, target: string, color: string): void {
    const exists = this.links.some((l) => l.source === source && l.target === target);
    if (!exists) {
      this.links.push({
        source,
        target,
        color,
        pulseProgress: 0,
      });
    }
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
    // 1. Smooth interpolation to target positions
    if (this.physicsActive) {
      let maxDelta = 0;
      for (const node of this.nodes.values()) {
        const dx = node.targetX - node.x;
        const dy = node.targetY - node.y;
        node.x += dx * 0.15;
        node.y += dy * 0.15;
        maxDelta = Math.max(maxDelta, Math.hypot(dx, dy));
      }

      this.alpha *= 0.95;
      if (maxDelta < 0.2 && this.alpha < 0.05) {
        this.physicsActive = false;
      }
    }

    // 2. Pulse decays
    for (const node of this.nodes.values()) {
      if (node.pulse > 0) {
        node.pulse = Math.max(0, node.pulse - 0.02);
      }
    }

    // 3. Links animation
    for (const link of this.links) {
      link.pulseProgress = (link.pulseProgress + 0.02) % 1;
    }
  }

  private calculateGroupHulls(): GroupHull[] {
    const groupDefs: { group: NodeGroup; title: string; color: string }[] = [
      { group: 'session', title: '🎯 SESSION', color: '#f59e0b' },
      { group: 'agents', title: '👷 AGENTS', color: '#06b6d4' },
      { group: 'files', title: '📁 FILE OPS', color: '#10b981' },
      { group: 'commands', title: '⚙️ COMMANDS & TESTS', color: '#38bdf8' },
      { group: 'mcp', title: '📞 MCP BRIDGES', color: '#a855f7' },
      { group: 'security', title: '🛡️ SECURITY & CHECKPOINTS', color: '#ef4444' },
    ];

    const hulls: GroupHull[] = [];
    for (const def of groupDefs) {
      const nodes = Array.from(this.nodes.values()).filter((n) => n.group === def.group);
      if (nodes.length === 0) continue;

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        minX = Math.min(minX, n.x - n.width / 2);
        minY = Math.min(minY, n.y - n.height / 2);
        maxX = Math.max(maxX, n.x + n.width / 2);
        maxY = Math.max(maxY, n.y + n.height / 2);
      }

      hulls.push({
        group: def.group,
        title: `${def.title} (${nodes.length})`,
        color: def.color,
        minX: minX - 16,
        minY: minY - 28,
        maxX: maxX + 16,
        maxY: maxY + 16,
      });
    }

    return hulls;
  }

  private render(): void {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    ctx.save();

    // Apply Camera Transform
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.zoom, this.zoom);

    // 1. Draw Group Containers (Swimlanes / Hulls)
    const hulls = this.calculateGroupHulls();
    for (const hull of hulls) {
      const w = hull.maxX - hull.minX;
      const h = hull.maxY - hull.minY;

      ctx.save();
      ctx.fillStyle = `${hull.color}0a`;
      ctx.strokeStyle = `${hull.color}33`;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);

      ctx.beginPath();
      ctx.roundRect(hull.minX, hull.minY, w, h, 10);
      ctx.fill();
      ctx.stroke();

      // Group Header Label
      ctx.setLineDash([]);
      ctx.fillStyle = hull.color;
      ctx.font = 'bold 10px Inter, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(hull.title, hull.minX + 10, hull.minY + 16);
      ctx.restore();
    }

    // 2. Draw Links & Animated Packets
    for (const link of this.links) {
      const src = this.nodes.get(link.source);
      const tgt = this.nodes.get(link.target);
      if (!src || !tgt) continue;

      const sx = src.x + src.width / 2;
      const sy = src.y;
      const tx = tgt.x - tgt.width / 2;
      const ty = tgt.y;

      // Smooth Bezier Curve
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo((sx + tx) / 2, sy, (sx + tx) / 2, ty, tx, ty);
      ctx.stroke();

      // Traveling packet
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
    }

    // 3. Draw Nodes (Cards with crisp labels)
    for (const node of this.nodes.values()) {
      const isSelected = this.selectedNodeId === node.id;
      const rx = node.x - node.width / 2;
      const ry = node.y - node.height / 2;

      ctx.save();

      // Glow on pulse or select
      if (node.pulse > 0 || isSelected) {
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.25)' : `${node.color}22`;
        ctx.beginPath();
        ctx.roundRect(rx - 4, ry - 4, node.width + 8, node.height + 8, 8);
        ctx.fill();
      }

      // Card Body
      ctx.fillStyle = '#111827';
      ctx.strokeStyle = isSelected ? '#38bdf8' : node.color;
      ctx.lineWidth = isSelected ? 2 : 1.2;

      ctx.beginPath();
      ctx.roundRect(rx, ry, node.width, node.height, 6);
      ctx.fill();
      ctx.stroke();

      // Left Accent Strip
      ctx.fillStyle = node.color;
      ctx.fillRect(rx, ry, 4, node.height);

      // Title
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.fillText(node.label, rx + 10, ry + 18);

      // Subtitle / summary
      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(node.sublabel, rx + 10, ry + 36);

      ctx.restore();
    }

    ctx.restore();
  }
}
