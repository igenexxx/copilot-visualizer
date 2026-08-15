import type { StationType, VisualizerEvent, WorkerAgent, Workstation } from '../types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export class WorkshopCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  private tileWidth = 64;
  private tileHeight = 32;
  private gridWidth = 9;
  private gridHeight = 9;

  public workstations: Map<StationType, Workstation> = new Map();
  public workers: Map<string, WorkerAgent> = new Map();
  private particles: Particle[] = [];
  private conveyorOffset = 0;
  private radarAngle = 0;

  public selectedStation: StationType | null = null;
  public selectedAgent: string | null = null;
  public onSelectElement?: (type: 'station' | 'agent', data: any) => void;

  private mouseX = 0;
  private mouseY = 0;
  private hoveredStation: StationType | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.initWorkstations();
    this.initWorkers();
    this.setupEventListeners();
    this.resize();
  }

  private initWorkstations(): void {
    const stations: Workstation[] = [
      {
        type: 'foreman_desk',
        name: 'Foreman Command Desk',
        gridX: 4,
        gridY: 4,
        color: '#f59e0b',
        description: 'Orchestration, planning & blueprint architecture',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'filing_vault',
        name: 'Codebase Filing Vault',
        gridX: 1,
        gridY: 2,
        color: '#3b82f6',
        description: 'File inspections, reading & document navigation',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'search_radar',
        name: 'Grep & Search Radar',
        gridX: 2,
        gridY: 6,
        color: '#06b6d4',
        description: 'Codebase symbol index & pattern scanning',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'cnc_lathe',
        name: 'CNC Machining Lathe',
        gridX: 7,
        gridY: 2,
        color: '#ec4899',
        description: 'Code forging, patch editing & file modification',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'test_furnace',
        name: 'Test Range & Furnace',
        gridX: 6,
        gridY: 6,
        color: '#10b981',
        description: 'Command execution, test suites & build verification',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'phone_booth',
        name: 'MCP Dispatch Booth',
        gridX: 1,
        gridY: 7,
        color: '#a855f7',
        description: 'External MCP Server bridges & remote RPC phone lines',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'conveyor',
        name: 'Shipping Conveyor',
        gridX: 7,
        gridY: 7,
        color: '#14b8a6',
        description: 'Output transit, PR commits & finished artifact dock',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
      {
        type: 'security_gate',
        name: 'Security Gate & Barrier',
        gridX: 4,
        gridY: 7,
        color: '#ef4444',
        description: 'Human-in-the-Loop approval gate & checkpoint barrier',
        active: false,
        pulseTime: 0,
        itemsCount: 0,
      },
    ];

    stations.forEach((st) => this.workstations.set(st.type, st));
  }

  public emergencyStopActive = false;

  private initWorkers(): void {
    const foreman: WorkerAgent = {
      id: 'agent-foreman',
      name: 'Foreman Alex',
      role: 'foreman',
      x: 4,
      y: 4,
      targetX: 4,
      targetY: 4,
      state: 'idle',
      color: '#f59e0b',
    };
    this.workers.set(foreman.id, foreman);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.checkHover();
    });

    this.canvas.addEventListener('click', () => {
      if (this.hoveredStation) {
        this.selectedStation = this.hoveredStation;
        const station = this.workstations.get(this.hoveredStation);
        if (this.onSelectElement && station) {
          this.onSelectElement('station', station);
        }
      }
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

  public isoToScreen(gx: number, gy: number, gz: number = 0): { x: number; y: number } {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const originX = width / 2;
    const originY = height / 2 - 30;

    const screenX = originX + (gx - gy) * (this.tileWidth / 2);
    const screenY = originY + (gx + gy) * (this.tileHeight / 2) - gz;
    return { x: screenX, y: screenY };
  }

  public handleEvent(evt: VisualizerEvent): void {
    // 1. Update or spawn agent
    let worker = this.workers.get(evt.agentId);
    if (!worker) {
      const colors = ['#ec4899', '#06b6d4', '#10b981', '#a855f7'];
      worker = {
        id: evt.agentId,
        name: evt.agentRole ? `${evt.agentRole.toUpperCase()} ${evt.agentId.slice(-4)}` : 'Specialist Agent',
        role: evt.agentRole || 'crafter',
        x: 8,
        y: 4, // walk in from workshop entrance
        targetX: 4,
        targetY: 4,
        state: 'walking',
        color: colors[this.workers.size % colors.length],
      };
      this.workers.set(worker.id, worker);
    }

    // 2. Route worker to station if specified
    if (evt.station && this.workstations.has(evt.station)) {
      const targetStation = this.workstations.get(evt.station)!;
      worker.targetX = targetStation.gridX;
      worker.targetY = targetStation.gridY;
      worker.currentStation = evt.station;
      worker.activeEvent = evt;

      targetStation.active = true;
      targetStation.pulseTime = 1.0;
      targetStation.lastEvent = evt;
      targetStation.itemsCount++;

      // Trigger station-specific visual effects
      this.spawnStationEffects(evt.station, targetStation.gridX, targetStation.gridY);
    }

    // Set speech bubble
    worker.speechBubble = {
      text: evt.title,
      expiresAt: Date.now() + 4000,
    };

    if (evt.type === 'emergency.stop') {
      this.emergencyStopActive = evt.payload?.active === true;
      for (const w of this.workers.values()) {
        w.state = this.emergencyStopActive ? 'stopped' : 'idle';
      }
    } else if (evt.type === 'mcp.call' || evt.type === 'mcp.response') {
      worker.state = 'on_phone';
    } else if (evt.type === 'agent.think') {
      worker.state = 'thinking';
    } else if (evt.type === 'file.write' || evt.type === 'command.run') {
      worker.state = 'working';
    }
  }

  private spawnStationEffects(station: StationType, gx: number, gy: number): void {
    const pos = this.isoToScreen(gx, gy, 15);
    if (station === 'cnc_lathe') {
      // Sparks
      for (let i = 0; i < 18; i++) {
        this.particles.push({
          x: pos.x,
          y: pos.y,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 5 - 2,
          color: Math.random() > 0.3 ? '#fbbf24' : '#ef4444',
          size: Math.random() * 3 + 1,
          life: 1.0,
          maxLife: 1.0,
        });
      }
    } else if (station === 'test_furnace') {
      // Steam & fire
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          x: pos.x + (Math.random() - 0.5) * 10,
          y: pos.y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 3 - 1,
          color: Math.random() > 0.5 ? '#10b981' : '#34d399',
          size: Math.random() * 4 + 2,
          life: 1.0,
          maxLife: 1.0,
        });
      }
    }
  }

  private checkHover(): void {
    this.hoveredStation = null;
    for (const [type, st] of this.workstations.entries()) {
      const pos = this.isoToScreen(st.gridX, st.gridY, 10);
      const dist = Math.hypot(this.mouseX - pos.x, this.mouseY - pos.y);
      if (dist < 32) {
        this.hoveredStation = type;
        break;
      }
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
    // 1. Move workers towards target
    for (const worker of this.workers.values()) {
      const dx = worker.targetX - worker.x;
      const dy = worker.targetY - worker.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0.05) {
        worker.x += (dx / dist) * 0.06;
        worker.y += (dy / dist) * 0.06;
        worker.state = 'walking';
      } else {
        worker.x = worker.targetX;
        worker.y = worker.targetY;
        if (worker.state === 'walking') {
          worker.state = 'working';
        }
      }
    }

    // 2. Decay station pulse
    for (const st of this.workstations.values()) {
      if (st.pulseTime > 0) {
        st.pulseTime = Math.max(0, st.pulseTime - 0.015);
      }
    }

    // 3. Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // gravity
      p.life -= 0.03;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    this.conveyorOffset = (this.conveyorOffset + 0.04) % 1;
    this.radarAngle += 0.05;
  }

  private render(): void {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    this.ctx.clearRect(0, 0, width, height);

    // 1. Floor grid & floor boundary
    this.renderFloorGrid();

    // 2. Factory floor paths & conveyor lines
    this.renderFloorMarkings();

    // 3. Render Workstations
    for (const st of this.workstations.values()) {
      this.renderWorkstation(st);
    }

    // 4. Render Workers
    for (const worker of this.workers.values()) {
      this.renderWorker(worker);
    }

    // 5. Render Particles
    for (const p of this.particles) {
      this.ctx.save();
      this.ctx.globalAlpha = p.life;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // 6. Emergency Stop Red Alert Tint
    if (this.emergencyStopActive) {
      const flash = (Math.sin(Date.now() / 200) + 1) / 2; // 0..1 pulse
      this.ctx.save();
      this.ctx.fillStyle = `rgba(239, 68, 68, ${0.12 + flash * 0.15})`;
      this.ctx.fillRect(0, 0, width, height);

      // Warning Banner across top of canvas
      this.ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      this.ctx.strokeStyle = '#ef4444';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.roundRect(width / 2 - 180, 16, 360, 36, 6);
      this.ctx.fill();
      this.ctx.stroke();

      this.ctx.font = 'bold 12px Inter, monospace';
      this.ctx.fillStyle = '#ef4444';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('🚨 EMERGENCY BRAKE ENGAGED — FACTORY PAUSED', width / 2, 34);
      this.ctx.restore();
    }
  }

  private renderFloorGrid(): void {
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const top = this.isoToScreen(x, y);
        const right = this.isoToScreen(x + 1, y);
        const bottom = this.isoToScreen(x + 1, y + 1);
        const left = this.isoToScreen(x, y + 1);

        this.ctx.beginPath();
        this.ctx.moveTo(top.x, top.y);
        this.ctx.lineTo(right.x, right.y);
        this.ctx.lineTo(bottom.x, bottom.y);
        this.ctx.lineTo(left.x, left.y);
        this.ctx.closePath();

        const isEven = (x + y) % 2 === 0;
        this.ctx.fillStyle = isEven ? '#121720' : '#0f131a';
        this.ctx.fill();

        this.ctx.strokeStyle = '#1e293b';
        this.ctx.lineWidth = 0.5;
        this.ctx.stroke();
      }
    }
  }

  private renderFloorMarkings(): void {
    // Safety hazard borders & walkways
    const p1 = this.isoToScreen(4, 0);
    const p2 = this.isoToScreen(4, 8);
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.strokeStyle = 'rgba(245, 158, 11, 0.15)';
    this.ctx.setLineDash([4, 4]);
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private renderWorkstation(st: Workstation): void {
    const pos = this.isoToScreen(st.gridX, st.gridY);
    const isHovered = this.hoveredStation === st.type;
    const isSelected = this.selectedStation === st.type;

    this.ctx.save();

    // Base glow if active
    if (st.pulseTime > 0 || isHovered || isSelected) {
      this.ctx.beginPath();
      this.ctx.ellipse(pos.x, pos.y, 28, 16, 0, 0, Math.PI * 2);
      this.ctx.fillStyle = isSelected
        ? 'rgba(245, 158, 11, 0.35)'
        : isHovered
        ? 'rgba(255, 255, 255, 0.2)'
        : `${st.color}33`;
      this.ctx.fill();
    }

    // Workstation isometric structure
    this.drawStationStructure(st, pos.x, pos.y);

    // Label and status pill
    this.ctx.font = '10px Inter, monospace';
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(st.name, pos.x, pos.y + 24);

    if (st.itemsCount > 0) {
      this.ctx.font = 'bold 9px monospace';
      this.ctx.fillStyle = st.color;
      this.ctx.fillText(`⚡ ${st.itemsCount}`, pos.x, pos.y + 35);
    }

    this.ctx.restore();
  }

  private drawStationStructure(st: Workstation, x: number, y: number): void {
    const ctx = this.ctx;

    switch (st.type) {
      case 'foreman_desk': {
        // Drafting desk
        ctx.fillStyle = '#334155';
        ctx.fillRect(x - 14, y - 18, 28, 14);
        // Glowing blueprint sheet
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(x - 10, y - 16, 20, 10);
        // Hologram projector beam
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 8, y - 14, 16, 6);
        break;
      }

      case 'filing_vault': {
        // Tall steel cabinet
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x - 12, y - 26, 24, 24);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(x - 8, y - 22, 16, 4);
        ctx.fillRect(x - 8, y - 14, 16, 4);
        ctx.fillRect(x - 8, y - 6, 16, 4);
        break;
      }

      case 'search_radar': {
        // Radar dish base
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(x, y - 10, 12, 0, Math.PI * 2);
        ctx.fill();
        // Oscillating sweep line
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x + Math.cos(this.radarAngle) * 12, y - 10 + Math.sin(this.radarAngle) * 12);
        ctx.stroke();
        break;
      }

      case 'cnc_lathe': {
        // Lathe base
        ctx.fillStyle = '#475569';
        ctx.fillRect(x - 16, y - 14, 32, 12);
        // Laser cutter arm
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(x - 4, y - 24, 8, 12);
        if (st.pulseTime > 0.2) {
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, y - 12);
          ctx.lineTo(x, y - 2);
          ctx.stroke();
        }
        break;
      }

      case 'test_furnace': {
        // Industrial power reactor
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(x, y - 12, 14, 0, Math.PI * 2);
        ctx.fill();
        // Heat core
        ctx.fillStyle = st.pulseTime > 0.1 ? '#10b981' : '#047857';
        ctx.beginPath();
        ctx.arc(x, y - 12, 7, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'phone_booth': {
        // Telephone booth
        ctx.fillStyle = '#581c87';
        ctx.fillRect(x - 10, y - 28, 20, 26);
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(x - 6, y - 24, 12, 10); // glass window
        // Handset
        ctx.fillStyle = '#f3e8ff';
        ctx.fillRect(x + 2, y - 18, 3, 6);
        break;
      }

      case 'conveyor': {
        // Conveyor belt rollers
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x - 18, y - 8, 36, 8);
        ctx.fillStyle = '#14b8a6';
        // Moving crates
        const crateX = x - 14 + this.conveyorOffset * 24;
        ctx.fillRect(crateX, y - 14, 8, 7);
        break;
      }

      case 'security_gate': {
        // Toll barrier pillars
        ctx.fillStyle = '#475569';
        ctx.fillRect(x - 16, y - 22, 6, 22);
        ctx.fillRect(x + 10, y - 22, 6, 22);

        // Striped barrier gate
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x - 16, y - 14, 32, 5);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(x - 10, y - 14, 6, 5);
        ctx.fillRect(x + 2, y - 14, 6, 5);

        // Warning lantern
        ctx.fillStyle = st.pulseTime > 0.1 || this.emergencyStopActive ? '#ef4444' : '#64748b';
        ctx.beginPath();
        ctx.arc(x - 13, y - 24, 3.5, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }

  private renderWorker(worker: WorkerAgent): void {
    const pos = this.isoToScreen(worker.x, worker.y);
    const ctx = this.ctx;

    ctx.save();

    // Shadow
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, 8, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();

    // Character Body
    const bounce = worker.state === 'walking' ? Math.sin(Date.now() / 120) * 2 : 0;
    const bodyY = pos.y - 12 + bounce;

    // Torso / Vest
    ctx.fillStyle = worker.color;
    ctx.beginPath();
    ctx.arc(pos.x, bodyY, 6, 0, Math.PI * 2);
    ctx.fill();

    // Safety Hard Hat
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(pos.x, bodyY - 5, 4, Math.PI, 0);
    ctx.fill();

    // Name tag
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(worker.name, pos.x, bodyY - 12);

    // Speech / Action bubble
    if (worker.speechBubble && worker.speechBubble.expiresAt > Date.now()) {
      this.drawSpeechBubble(pos.x, bodyY - 24, worker.speechBubble.text);
    }

    ctx.restore();
  }

  private drawSpeechBubble(x: number, y: number, text: string): void {
    const ctx = this.ctx;
    ctx.font = '10px Inter, monospace';
    const textMetrics = ctx.measureText(text);
    const padding = 6;
    const width = Math.min(220, textMetrics.width + padding * 2);
    const height = 18;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height, width, height, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      text.length > 28 ? text.slice(0, 26) + '…' : text,
      x,
      y - height / 2
    );
    ctx.restore();
  }
}
