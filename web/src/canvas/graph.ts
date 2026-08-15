import type { VisualizerEvent } from '../types';

export interface GraphNode {
  id: string;
  label: string;
  sublabel: string;
  type: 'session' | 'agent' | 'tool' | 'file' | 'mcp' | 'output';
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pulse: number;
  timestamp: number;
}

export interface GraphLink {
  source: string;
  target: string;
  color: string;
  pulseProgress: number;
}

export class FlowGraphCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  public nodes: Map<string, GraphNode> = new Map();
  public links: GraphLink[] = [];

  private selectedNodeId: string | null = null;
  public onSelectNode?: (node: GraphNode) => void;

  private isDragging = false;
  private dragNode: GraphNode | null = null;
  private offsetX = 0;
  private offsetY = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.setupEvents();
    this.resize();
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left - this.offsetX;
      const my = e.clientY - rect.top - this.offsetY;

      for (const node of this.nodes.values()) {
        const dist = Math.hypot(node.x - mx, node.y - my);
        if (dist < 26) {
          this.isDragging = true;
          this.dragNode = node;
          this.selectedNodeId = node.id;
          if (this.onSelectNode) this.onSelectNode(node);
          return;
        }
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging && this.dragNode) {
        const rect = this.canvas.getBoundingClientRect();
        this.dragNode.x = e.clientX - rect.left - this.offsetX;
        this.dragNode.y = e.clientY - rect.top - this.offsetY;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
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

  public handleEvent(evt: VisualizerEvent): void {
    const height = (this.canvas.height / (window.devicePixelRatio || 1)) || 500;

    // 1. Session node
    const sessionNodeId = `sess-${evt.sessionId}`;
    if (!this.nodes.has(sessionNodeId)) {
      this.nodes.set(sessionNodeId, {
        id: sessionNodeId,
        label: 'Session',
        sublabel: evt.sessionId.slice(0, 12),
        type: 'session',
        color: '#f59e0b',
        x: 80,
        y: height / 2,
        vx: 0,
        vy: 0,
        pulse: 1.0,
        timestamp: evt.timestamp,
      });
    }

    // 2. Agent node
    const agentNodeId = `agent-${evt.agentId}`;
    if (!this.nodes.has(agentNodeId)) {
      this.nodes.set(agentNodeId, {
        id: agentNodeId,
        label: evt.agentRole ? evt.agentRole.toUpperCase() : 'Agent',
        sublabel: evt.agentId,
        type: 'agent',
        color: '#38bdf8',
        x: 240,
        y: height / 2 + (this.nodes.size % 4 - 1.5) * 80,
        vx: 0,
        vy: 0,
        pulse: 1.0,
        timestamp: evt.timestamp,
      });
      this.addLink(sessionNodeId, agentNodeId, '#f59e0b');
    }

    // 3. Tool / Action node
    const toolNodeId = `evt-${evt.id}`;
    let nodeType: GraphNode['type'] = 'tool';
    let nodeColor = '#ec4899';

    if (evt.type.startsWith('file.')) {
      nodeType = 'file';
      nodeColor = '#10b981';
    } else if (evt.type.startsWith('mcp.')) {
      nodeType = 'mcp';
      nodeColor = '#a855f7';
    } else if (evt.type === 'session.end') {
      nodeType = 'output';
      nodeColor = '#14b8a6';
    }

    this.nodes.set(toolNodeId, {
      id: toolNodeId,
      label: evt.title,
      sublabel: evt.summary || evt.type,
      type: nodeType,
      color: nodeColor,
      x: 440 + Math.random() * 80,
      y: 100 + (this.nodes.size * 45) % Math.max(300, height - 120),
      vx: 0,
      vy: 0,
      pulse: 1.0,
      timestamp: evt.timestamp,
    });

    this.addLink(agentNodeId, toolNodeId, nodeColor);
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
    // Pulse decay and link animation
    for (const node of this.nodes.values()) {
      if (node.pulse > 0) {
        node.pulse = Math.max(0, node.pulse - 0.02);
      }
    }

    for (const link of this.links) {
      link.pulseProgress = (link.pulseProgress + 0.03) % 1;
    }
  }

  private render(): void {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);

    // 1. Draw Links
    for (const link of this.links) {
      const src = this.nodes.get(link.source);
      const tgt = this.nodes.get(link.target);
      if (!src || !tgt) continue;

      // Draw connection line
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.bezierCurveTo((src.x + tgt.x) / 2, src.y, (src.x + tgt.x) / 2, tgt.y, tgt.x, tgt.y);
      ctx.stroke();

      // Traveling data packet
      const t = link.pulseProgress;
      const cp1x = (src.x + tgt.x) / 2;
      const cp1y = src.y;
      const cp2x = (src.x + tgt.x) / 2;
      const cp2y = tgt.y;

      const px = Math.pow(1 - t, 3) * src.x + 3 * Math.pow(1 - t, 2) * t * cp1x + 3 * (1 - t) * Math.pow(t, 2) * cp2x + Math.pow(t, 3) * tgt.x;
      const py = Math.pow(1 - t, 3) * src.y + 3 * Math.pow(1 - t, 2) * t * cp1y + 3 * (1 - t) * Math.pow(t, 2) * cp2y + Math.pow(t, 3) * tgt.y;

      ctx.fillStyle = link.color;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Draw Nodes
    for (const node of this.nodes.values()) {
      const isSelected = this.selectedNodeId === node.id;

      // Outer glow on pulse or select
      if (node.pulse > 0 || isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 28, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.3)' : `${node.color}33`;
        ctx.fill();
      }

      // Node Body
      ctx.beginPath();
      ctx.arc(node.x, node.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.strokeStyle = node.color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.stroke();

      // Node Label
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.fillText(node.label.slice(0, 14), node.x, node.y + 32);

      // Sublabel
      ctx.font = '9px monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(node.sublabel.slice(0, 16), node.x, node.y + 44);
    }

    ctx.restore();
  }
}
