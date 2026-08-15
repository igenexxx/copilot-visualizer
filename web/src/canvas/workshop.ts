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
  floorLevel: number;
}

export interface FactoryFloor {
  id: string;
  level: number; // 0 = 1F Ground, 1 = 2F, 2 = 3F...
  agentId: string;
  name: string;
  role: string;
  color: string;
  workstations: Map<StationType, Workstation>;
  workers: Map<string, WorkerAgent>;
  active: boolean;
}

export class WorkshopCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  private tileWidth = 52;
  private tileHeight = 26;
  private gridWidth = 11;
  private gridHeight = 11;
  private floorElevationStep = 170; // vertical separation between stacked floors in tower mode

  public floors: FactoryFloor[] = [];
  public activeFloorIndex: number | 'all' = 'all'; // 'all' for full tower overview, or floor index (0, 1, 2)
  private particles: Particle[] = [];

  private conveyorOffset = 0;
  private radarAngle = 0;
  private elevatorCabLevel = 0;
  private elevatorTargetLevel = 0;

  public selectedStation: StationType | null = null;
  public selectedAgent: string | null = null;
  public onSelectElement?: (type: 'station' | 'agent' | 'floor', data: any) => void;
  public onFloorChanged?: (floorIndex: number | 'all') => void;

  // Camera Pan & Zoom
  public zoom = 0.9;
  public panX = 0;
  public panY = 0;
  private isPanning = false;
  private startMouseX = 0;
  private startMouseY = 0;

  private mouseX = 0;
  private mouseY = 0;
  private hoveredStation: { station: StationType; floor: number } | null = null;
  private hoveredFloorLevel: number | null = null;
  public emergencyStopActive = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.initDefaultFloors();
    this.setupEventListeners();
    this.resize();
  }

  private createDefaultStations(level: number): Map<StationType, Workstation> {
    const stations = new Map<StationType, Workstation>();
    const createStation = (
      type: StationType,
      name: string,
      gridX: number,
      gridY: number,
      color: string,
      description: string
    ): Workstation => ({
      type,
      name,
      gridX,
      gridY,
      color,
      description,
      active: false,
      pulseTime: 0,
      itemsCount: 0,
      heatLevel: 0,
      temperatureC: 24,
      wearPct: 0,
      totalOperations: 0,
      overheating: false,
    });

    const list: Workstation[] = [
      createStation('foreman_desk', level === 0 ? 'Master Command Desk' : `Subagent Desk ${level}F`, 5, 5, '#f59e0b', 'Orchestration, planning & blueprint architecture'),
      createStation('server_rack', 'MCP Server Vault', 2, 2, '#38bdf8', '19" Enterprise server racks & MCP fiber bridges'),
      createStation('subagent_office', 'Subagent Glass Suite', 2, 8, '#a855f7', 'Subagent isolation cubicles & blueprint drafting'),
      createStation('repo_shelf', 'Repo Shelves (/pkg /cmd /web)', 8, 2, '#3b82f6', 'Project repository directory compartment shelves'),
      createStation('cnc_lathe', 'CNC Machining Lathe', 8, 5, '#ec4899', 'Code forging, patch editing & file modification'),
      createStation('test_furnace', 'Test Range & Furnace', 8, 8, '#10b981', 'Command execution, test suites & build verification'),
      createStation('search_radar', 'Search Radar', 5, 2, '#06b6d4', 'Codebase symbol index & pattern scanning'),
      createStation('phone_booth', 'MCP Dispatch', 1, 5, '#a855f7', 'External MCP Server bridges & remote RPC phone lines'),
      createStation('conveyor', 'Conveyor & Elevator', 9, 5, '#14b8a6', 'Inter-floor transport & shipping dock'),
      createStation('security_gate', 'Security Gate', 5, 9, '#ef4444', 'Human-in-the-Loop approval gate & checkpoint barrier'),
    ];

    list.forEach((st) => stations.set(st.type, st));
    return stations;
  }

  private initDefaultFloors(): void {
    // 1F: Ground Floor (Master Foreman)
    const groundFloor: FactoryFloor = {
      id: 'floor-0',
      level: 0,
      agentId: 'agent-foreman',
      name: '1F: Master Orchestrator',
      role: 'foreman',
      color: '#f59e0b',
      workstations: this.createDefaultStations(0),
      workers: new Map(),
      active: true,
    };

    const foremanWorker: WorkerAgent = {
      id: 'agent-foreman',
      name: 'Foreman Alex',
      role: 'foreman',
      x: 5,
      y: 5,
      targetX: 5,
      targetY: 5,
      state: 'idle',
      color: '#f59e0b',
    };
    groundFloor.workers.set(foremanWorker.id, foremanWorker);
    this.floors.push(groundFloor);
  }

  public getOrCreateFloorForAgent(agentId: string, role: string = 'crafter'): FactoryFloor {
    for (const fl of this.floors) {
      if (fl.agentId === agentId) return fl;
    }

    // Spawn new floor in the tower!
    const newLevel = this.floors.length;
    const colors = ['#06b6d4', '#ec4899', '#10b981', '#a855f7', '#38bdf8'];
    const floorColor = colors[newLevel % colors.length];

    const newFloor: FactoryFloor = {
      id: `floor-${newLevel}`,
      level: newLevel,
      agentId: agentId,
      name: `${newLevel + 1}F: ${role.toUpperCase()} WORKSHOP`,
      role: role,
      color: floorColor,
      workstations: this.createDefaultStations(newLevel),
      workers: new Map(),
      active: true,
    };

    const worker: WorkerAgent = {
      id: agentId,
      name: `${role.toUpperCase()} ${agentId.slice(-4)}`,
      role: role as any,
      x: 5,
      y: 5,
      targetX: 5,
      targetY: 5,
      state: 'working',
      color: floorColor,
    };
    newFloor.workers.set(worker.id, worker);
    this.floors.push(newFloor);

    // Animate elevator dispatching to new floor
    this.elevatorTargetLevel = newLevel;

    if (this.onFloorChanged) {
      this.onFloorChanged(this.activeFloorIndex);
    }
    return newFloor;
  }

  public setFloorView(floorIndex: number | 'all'): void {
    this.activeFloorIndex = floorIndex;
    if (floorIndex === 'all') {
      this.zoom = Math.max(0.6, 0.9 - this.floors.length * 0.08);
      this.panX = 0;
      this.panY = (this.floors.length - 1) * 60;
    } else {
      this.zoom = 1.05;
      this.panX = 0;
      this.panY = 0;
    }
    if (this.onFloorChanged) {
      this.onFloorChanged(this.activeFloorIndex);
    }
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
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

      if (!this.hoveredStation) {
        this.isPanning = true;
        this.startMouseX = clientX - this.panX;
        this.startMouseY = clientY - this.panY;
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      this.mouseX = clientX;
      this.mouseY = clientY;

      if (this.isPanning) {
        this.panX = clientX - this.startMouseX;
        this.panY = clientY - this.startMouseY;
      } else {
        this.checkHover();
      }
    });

    window.addEventListener('mouseup', () => {
      this.isPanning = false;
    });

    this.canvas.addEventListener('click', () => {
      if (this.hoveredStation) {
        this.selectedStation = this.hoveredStation.station;
        const floor = this.floors[this.hoveredStation.floor];
        if (floor) {
          const station = floor.workstations.get(this.hoveredStation.station);
          if (this.onSelectElement && station) {
            this.onSelectElement('station', station);
          }
        }
      } else if (this.activeFloorIndex === 'all' && this.hoveredFloorLevel !== null) {
        // Clicking floor in tower mode selects that floor!
        this.setFloorView(this.hoveredFloorLevel);
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

  public isoToScreen(gx: number, gy: number, floorLevel: number = 0, gz: number = 0): { x: number; y: number } {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const originX = width / 2;
    const originY = height / 2 + (this.activeFloorIndex === 'all' ? (this.floors.length - 1) * 60 : 0);

    const verticalFloorOffset = this.activeFloorIndex === 'all' ? floorLevel * this.floorElevationStep : 0;

    const baseScreenX = originX + (gx - gy) * (this.tileWidth / 2);
    const baseScreenY = originY + (gx + gy) * (this.tileHeight / 2) - verticalFloorOffset - gz;

    return {
      x: baseScreenX * this.zoom + this.panX + (1 - this.zoom) * originX,
      y: baseScreenY * this.zoom + this.panY + (1 - this.zoom) * originY,
    };
  }

  public handleEvent(evt: VisualizerEvent): void {
    // 1. Determine Floor for agent
    const floor = this.getOrCreateFloorForAgent(evt.agentId, evt.agentRole || 'crafter');
    this.elevatorTargetLevel = floor.level;

    // 2. Find or update worker on this floor
    let worker = floor.workers.get(evt.agentId);
    if (!worker) {
      worker = {
        id: evt.agentId,
        name: `${(evt.agentRole || 'agent').toUpperCase()} ${evt.agentId.slice(-4)}`,
        role: (evt.agentRole || 'crafter') as any,
        x: 10,
        y: 5,
        targetX: 5,
        targetY: 5,
        state: 'walking',
        color: floor.color,
      };
      floor.workers.set(worker.id, worker);
    }

    // 3. Route worker to station on this floor
    if (evt.station && floor.workstations.has(evt.station)) {
      const targetStation = floor.workstations.get(evt.station)!;
      worker.targetX = targetStation.gridX;
      worker.targetY = targetStation.gridY;
      worker.currentStation = evt.station;
      worker.activeEvent = evt;

      targetStation.active = true;
      targetStation.pulseTime = 1.0;
      targetStation.lastEvent = evt;
      targetStation.itemsCount++;
      targetStation.totalOperations++;

      // Machine Wear & Heat calculation
      let heatBoost = 12;
      let wearBoost = 0.6;
      if (evt.station === 'cnc_lathe') {
        heatBoost = 24;
        wearBoost = 1.6;
      } else if (evt.station === 'test_furnace') {
        heatBoost = 28;
        wearBoost = 1.8;
      } else if (evt.station === 'search_radar') {
        heatBoost = 18;
        wearBoost = 1.1;
      } else if (evt.station === 'filing_vault') {
        heatBoost = 14;
        wearBoost = 0.8;
      }

      targetStation.heatLevel = Math.min(100, targetStation.heatLevel + heatBoost);
      targetStation.wearPct = Math.min(100, targetStation.wearPct + wearBoost);
      targetStation.temperatureC = Math.round(24 + (targetStation.heatLevel / 100) * 780);
      targetStation.overheating = targetStation.heatLevel >= 70;

      this.spawnStationEffects(evt.station, targetStation.gridX, targetStation.gridY, floor.level);
    }

    // Set speech bubble
    worker.speechBubble = {
      text: evt.title,
      expiresAt: Date.now() + 4000,
    };

    if (evt.type === 'emergency.stop') {
      this.emergencyStopActive = evt.payload?.active === true;
      for (const fl of this.floors) {
        for (const w of fl.workers.values()) {
          w.state = this.emergencyStopActive ? 'stopped' : 'idle';
        }
      }
    } else if (evt.type === 'mcp.call' || evt.type === 'mcp.response') {
      worker.state = 'on_phone';
    } else if (evt.type === 'agent.think') {
      worker.state = 'thinking';
    } else if (evt.type === 'file.write' || evt.type === 'command.run') {
      worker.state = 'working';
    }
  }

  private spawnStationEffects(station: StationType, gx: number, gy: number, floorLevel: number): void {
    const pos = this.isoToScreen(gx, gy, floorLevel, 15);
    if (station === 'cnc_lathe') {
      for (let i = 0; i < 16; i++) {
        this.particles.push({
          x: pos.x,
          y: pos.y,
          vx: (Math.random() - 0.5) * 4,
          vy: -Math.random() * 5 - 2,
          color: Math.random() > 0.3 ? '#fbbf24' : '#ef4444',
          size: Math.random() * 3 + 1,
          life: 1.0,
          maxLife: 1.0,
          floorLevel,
        });
      }
    } else if (station === 'test_furnace') {
      for (let i = 0; i < 12; i++) {
        this.particles.push({
          x: pos.x + (Math.random() - 0.5) * 10,
          y: pos.y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 3 - 1,
          color: Math.random() > 0.5 ? '#10b981' : '#34d399',
          size: Math.random() * 4 + 2,
          life: 1.0,
          maxLife: 1.0,
          floorLevel,
        });
      }
    } else if (station === 'server_rack') {
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          x: pos.x + (Math.random() - 0.5) * 16,
          y: pos.y,
          vx: (Math.random() - 0.5) * 1.2,
          vy: -Math.random() * 3 - 1,
          color: Math.random() > 0.5 ? '#38bdf8' : '#06b6d4',
          size: Math.random() * 3 + 1,
          life: 1.0,
          maxLife: 1.0,
          floorLevel,
        });
      }
    } else if (station === 'subagent_office') {
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: pos.x + (Math.random() - 0.5) * 18,
          y: pos.y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 2.5 - 0.8,
          color: Math.random() > 0.4 ? '#c084fc' : '#a855f7',
          size: Math.random() * 3 + 1,
          life: 1.0,
          maxLife: 1.0,
          floorLevel,
        });
      }
    } else if (station === 'repo_shelf') {
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: pos.x + (Math.random() - 0.5) * 16,
          y: pos.y,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -Math.random() * 2.5 - 0.5,
          color: Math.random() > 0.5 ? '#3b82f6' : '#60a5fa',
          size: Math.random() * 3 + 1,
          life: 1.0,
          maxLife: 1.0,
          floorLevel,
        });
      }
    }
  }

  private checkHover(): void {
    this.hoveredStation = null;
    this.hoveredFloorLevel = null;

    const visibleFloors = this.activeFloorIndex === 'all'
      ? this.floors
      : [this.floors[this.activeFloorIndex]].filter(Boolean);

    for (const fl of visibleFloors) {
      for (const [type, st] of fl.workstations.entries()) {
        const pos = this.isoToScreen(st.gridX, st.gridY, fl.level, 10);
        const dist = Math.hypot(this.mouseX - pos.x, this.mouseY - pos.y);
        if (dist < 28 * this.zoom) {
          this.hoveredStation = { station: type, floor: fl.level };
          this.hoveredFloorLevel = fl.level;
          return;
        }
      }
    }

    // Check floor plane hover in tower mode
    if (this.activeFloorIndex === 'all') {
      for (const fl of this.floors) {
        const center = this.isoToScreen(5, 5, fl.level);
        const dist = Math.hypot(this.mouseX - center.x, this.mouseY - center.y);
        if (dist < 120 * this.zoom) {
          this.hoveredFloorLevel = fl.level;
          return;
        }
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
    // 1. Move workers towards target across all floors
    for (const fl of this.floors) {
      for (const worker of fl.workers.values()) {
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

      // Decay station pulse and thermal load
      for (const st of fl.workstations.values()) {
        if (st.pulseTime > 0) {
          st.pulseTime = Math.max(0, st.pulseTime - 0.015);
        }
        if (st.heatLevel > 0) {
          st.heatLevel = Math.max(0, st.heatLevel - 0.04);
          st.temperatureC = Math.round(24 + (st.heatLevel / 100) * 780);
          st.overheating = st.heatLevel >= 70;

          // Smoke / steam puffs when machine is warm or hot
          if (st.heatLevel > 28 && Math.random() < 0.08) {
            const pos = this.isoToScreen(st.gridX, st.gridY, fl.level, 16);
            this.particles.push({
              x: pos.x + (Math.random() - 0.5) * 10,
              y: pos.y,
              vx: (Math.random() - 0.5) * 0.6,
              vy: -Math.random() * 1.5 - 0.5,
              color: st.overheating ? (Math.random() > 0.4 ? '#ef4444' : '#f97316') : '#94a3b8',
              size: Math.random() * 3 + 2,
              life: 1.0,
              maxLife: 1.0,
              floorLevel: fl.level,
            });
          }
        }
      }
    }

    // 2. Elevator cab smooth interpolation
    const elevDelta = this.elevatorTargetLevel - this.elevatorCabLevel;
    this.elevatorCabLevel += elevDelta * 0.08;

    // 3. Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.life -= 0.025;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    this.conveyorOffset = (this.conveyorOffset + 0.04) % 1;
    this.radarAngle += 0.05;
  }

  public cooldownStation(stationType: StationType, floorLevel: number = 0): void {
    const floor = this.floors[floorLevel] || this.floors[0];
    if (!floor) return;
    const st = floor.workstations.get(stationType);
    if (!st) return;

    st.heatLevel = 0;
    st.temperatureC = 24;
    st.overheating = false;

    // Burst of white steam particles
    const pos = this.isoToScreen(st.gridX, st.gridY, floor.level, 10);
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * 16,
        y: pos.y,
        vx: (Math.random() - 0.5) * 2.5,
        vy: -Math.random() * 3.5 - 1,
        color: Math.random() > 0.3 ? '#e2e8f0' : '#38bdf8',
        size: Math.random() * 5 + 2,
        life: 1.0,
        maxLife: 1.0,
        floorLevel: floor.level,
      });
    }
  }

  private render(): void {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);

    this.ctx.clearRect(0, 0, width, height);

    const floorsToRender = this.activeFloorIndex === 'all'
      ? this.floors
      : [this.floors[this.activeFloorIndex]].filter(Boolean);

    // 1. Draw Vertical Glass Tower Elevator Columns in overview mode
    if (this.activeFloorIndex === 'all' && this.floors.length > 1) {
      this.renderTowerElevatorShaft();
    }

    // 2. Render Each Floor Plane (bottom to top)
    for (const fl of floorsToRender) {
      this.renderSingleFloor(fl);
    }

    // 3. Render Particles
    for (const p of this.particles) {
      if (this.activeFloorIndex !== 'all' && p.floorLevel !== this.activeFloorIndex) continue;
      this.ctx.save();
      this.ctx.globalAlpha = p.life;
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size * this.zoom, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    }

    // 4. Emergency Stop Red Alert Tint
    if (this.emergencyStopActive) {
      const flash = (Math.sin(Date.now() / 200) + 1) / 2;
      this.ctx.save();
      this.ctx.fillStyle = `rgba(239, 68, 68, ${0.12 + flash * 0.15})`;
      this.ctx.fillRect(0, 0, width, height);

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

  private renderTowerElevatorShaft(): void {
    const bottomLevel = 0;
    const topLevel = this.floors.length - 1;

    // Corner pillar coordinates
    const pTopLeft = this.isoToScreen(0, 0, topLevel);
    const pBottomLeft = this.isoToScreen(0, 0, bottomLevel);
    const pTopRight = this.isoToScreen(10, 0, topLevel);
    const pBottomRight = this.isoToScreen(10, 0, bottomLevel);

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    this.ctx.lineWidth = 1.5 * this.zoom;
    this.ctx.setLineDash([6, 6]);

    // Glass corner supports
    this.ctx.beginPath();
    this.ctx.moveTo(pBottomLeft.x, pBottomLeft.y);
    this.ctx.lineTo(pTopLeft.x, pTopLeft.y);
    this.ctx.moveTo(pBottomRight.x, pBottomRight.y);
    this.ctx.lineTo(pTopRight.x, pTopRight.y);
    this.ctx.stroke();

    // Elevator Cab on right flank
    const elevPos = this.isoToScreen(10, 5, this.elevatorCabLevel, 0);
    this.ctx.fillStyle = '#0284c7';
    this.ctx.strokeStyle = '#38bdf8';
    this.ctx.setLineDash([]);
    this.ctx.lineWidth = 2 * this.zoom;

    this.ctx.beginPath();
    this.ctx.roundRect(elevPos.x - 12 * this.zoom, elevPos.y - 18 * this.zoom, 24 * this.zoom, 24 * this.zoom, 4 * this.zoom);
    this.ctx.fill();
    this.ctx.stroke();

    // Elevator light
    this.ctx.fillStyle = '#f8fafc';
    this.ctx.font = `bold ${Math.max(7, 8 * this.zoom)}px monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`▲`, elevPos.x, elevPos.y - 4 * this.zoom);

    this.ctx.restore();
  }

  private renderSingleFloor(fl: FactoryFloor): void {
    const isHoveredFloor = this.activeFloorIndex === 'all' && this.hoveredFloorLevel === fl.level;

    // Floor Base Tile Grid
    for (let x = 0; x < this.gridWidth; x++) {
      for (let y = 0; y < this.gridHeight; y++) {
        const top = this.isoToScreen(x, y, fl.level);
        const right = this.isoToScreen(x + 1, y, fl.level);
        const bottom = this.isoToScreen(x + 1, y + 1, fl.level);
        const left = this.isoToScreen(x, y + 1, fl.level);

        this.ctx.beginPath();
        this.ctx.moveTo(top.x, top.y);
        this.ctx.lineTo(right.x, right.y);
        this.ctx.lineTo(bottom.x, bottom.y);
        this.ctx.lineTo(left.x, left.y);
        this.ctx.closePath();

        const isEven = (x + y) % 2 === 0;
        this.ctx.fillStyle = isHoveredFloor
          ? (isEven ? '#182436' : '#141d2c')
          : (isEven ? '#121720' : '#0f131a');
        this.ctx.fill();

        this.ctx.strokeStyle = isHoveredFloor ? fl.color : '#1e293b';
        this.ctx.lineWidth = isHoveredFloor ? 0.8 : 0.4;
        this.ctx.stroke();
      }
    }

    // Multi-Room Architectural Glass Partitions & Zones
    this.renderRoomZone(0, 0, 4, 4, fl.level, '⚡ MCP SERVER VAULT', '#38bdf8', 'rgba(56, 189, 248, 0.06)');
    this.renderRoomZone(0, 6, 4, 10, fl.level, '👥 SUBAGENT GLASS OFFICE', '#a855f7', 'rgba(168, 85, 247, 0.06)');
    this.renderRoomZone(6, 0, 10, 4, fl.level, '📁 REPO TREE MODULE SHELVES', '#3b82f6', 'rgba(59, 130, 246, 0.05)');

    // Floor Title Plaque in Tower Mode
    const plaquePos = this.isoToScreen(0, 5, fl.level);
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    this.ctx.strokeStyle = fl.color;
    this.ctx.lineWidth = 1 * this.zoom;
    this.ctx.beginPath();
    this.ctx.roundRect(plaquePos.x - 70 * this.zoom, plaquePos.y - 12 * this.zoom, 140 * this.zoom, 22 * this.zoom, 4 * this.zoom);
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.font = `bold ${Math.max(8, 10 * this.zoom)}px Inter, sans-serif`;
    this.ctx.fillStyle = fl.color;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(fl.name, plaquePos.x, plaquePos.y);
    this.ctx.restore();

    // Render Workstations on this floor
    for (const st of fl.workstations.values()) {
      this.renderWorkstation(st, fl.level);
    }

    // Render Workers on this floor
    for (const worker of fl.workers.values()) {
      this.renderWorker(worker, fl.level);
    }
  }

  private renderRoomZone(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    floorLevel: number,
    title: string,
    borderColor: string,
    fillColor: string
  ): void {
    const p1 = this.isoToScreen(x1, y1, floorLevel);
    const p2 = this.isoToScreen(x2, y1, floorLevel);
    const p3 = this.isoToScreen(x2, y2, floorLevel);
    const p4 = this.isoToScreen(x1, y2, floorLevel);

    this.ctx.save();

    // Floor area tint
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.lineTo(p3.x, p3.y);
    this.ctx.lineTo(p4.x, p4.y);
    this.ctx.closePath();
    this.ctx.fillStyle = fillColor;
    this.ctx.fill();

    // Glass wall perimeter
    this.ctx.strokeStyle = borderColor;
    this.ctx.lineWidth = 1.2 * this.zoom;
    this.ctx.setLineDash([4 * this.zoom, 2 * this.zoom]);
    this.ctx.stroke();
    this.ctx.setLineDash([]);

    // Room Label
    const centerX = (p1.x + p3.x) / 2;
    const topY = Math.min(p1.y, p2.y, p3.y, p4.y) - 6 * this.zoom;

    this.ctx.font = `bold ${Math.max(6, 8 * this.zoom)}px Inter, monospace`;
    this.ctx.fillStyle = borderColor;
    this.ctx.textAlign = 'center';
    this.ctx.fillText(title, centerX, topY);

    this.ctx.restore();
  }

  private renderWorkstation(st: Workstation, floorLevel: number): void {
    const pos = this.isoToScreen(st.gridX, st.gridY, floorLevel);
    const isHovered = this.hoveredStation?.station === st.type && this.hoveredStation.floor === floorLevel;
    const isSelected = this.selectedStation === st.type;

    this.ctx.save();

    // 1. Thermal Heatmap Aura
    if (st.heatLevel > 15) {
      const heatFactor = st.heatLevel / 100;
      const auraRadius = (22 + heatFactor * 16) * this.zoom;
      const auraColor = st.overheating
        ? `rgba(239, 68, 68, ${0.25 + heatFactor * 0.35})`
        : `rgba(245, 158, 11, ${0.15 + heatFactor * 0.25})`;

      this.ctx.beginPath();
      this.ctx.ellipse(pos.x, pos.y, auraRadius, auraRadius * 0.58, 0, 0, Math.PI * 2);
      this.ctx.fillStyle = auraColor;
      this.ctx.fill();
    }

    if (st.pulseTime > 0 || isHovered || isSelected) {
      this.ctx.beginPath();
      this.ctx.ellipse(pos.x, pos.y, 24 * this.zoom, 14 * this.zoom, 0, 0, Math.PI * 2);
      this.ctx.fillStyle = isSelected
        ? 'rgba(245, 158, 11, 0.35)'
        : isHovered
        ? 'rgba(255, 255, 255, 0.2)'
        : `${st.color}33`;
      this.ctx.fill();
    }

    this.drawStationStructure(st, pos.x, pos.y);

    // 2. Station Name
    this.ctx.font = `${Math.max(7, 9 * this.zoom)}px Inter, monospace`;
    this.ctx.fillStyle = '#94a3b8';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(st.name, pos.x, pos.y + 20 * this.zoom);

    // 3. Thermal Gauge / Overheat Badge
    if (st.heatLevel > 20) {
      const isCritical = st.overheating;
      const badgeText = isCritical ? `🔥 ${st.temperatureC}°C [OVERHEAT]` : `🌡️ ${st.temperatureC}°C`;
      this.ctx.font = `bold ${Math.max(6, 8 * this.zoom)}px monospace`;
      this.ctx.fillStyle = isCritical ? '#ef4444' : '#f59e0b';
      this.ctx.fillText(badgeText, pos.x, pos.y - 28 * this.zoom);

      // Mini Wear bar
      const barW = 28 * this.zoom;
      const barH = 3 * this.zoom;
      this.ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
      this.ctx.fillRect(pos.x - barW / 2, pos.y - 23 * this.zoom, barW, barH);
      this.ctx.fillStyle = isCritical ? '#ef4444' : '#f59e0b';
      this.ctx.fillRect(pos.x - barW / 2, pos.y - 23 * this.zoom, barW * (st.heatLevel / 100), barH);
    }

    if (st.itemsCount > 0) {
      this.ctx.font = `bold ${Math.max(6, 8 * this.zoom)}px monospace`;
      this.ctx.fillStyle = st.color;
      this.ctx.fillText(`⚡ ${st.itemsCount} ops (Wear: ${st.wearPct.toFixed(0)}%)`, pos.x, pos.y + 30 * this.zoom);
    }

    this.ctx.restore();
  }

  private drawStationStructure(st: Workstation, x: number, y: number): void {
    const ctx = this.ctx;
    const z = this.zoom;

    switch (st.type) {
      case 'foreman_desk': {
        ctx.fillStyle = '#334155';
        ctx.fillRect(x - 12 * z, y - 16 * z, 24 * z, 12 * z);
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(x - 8 * z, y - 14 * z, 16 * z, 8 * z);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1 * z;
        ctx.strokeRect(x - 6 * z, y - 12 * z, 12 * z, 5 * z);
        break;
      }

      case 'server_rack': {
        // 19" Enterprise Server Cabinet
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x - 12 * z, y - 26 * z, 24 * z, 26 * z);
        ctx.strokeStyle = st.pulseTime > 0 ? '#38bdf8' : '#334155';
        ctx.lineWidth = 1 * z;
        ctx.strokeRect(x - 12 * z, y - 26 * z, 24 * z, 26 * z);

        // Rack Units (4U slots)
        for (let u = 0; u < 4; u++) {
          const uY = y - 24 * z + u * 6 * z;
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x - 10 * z, uY, 20 * z, 4.5 * z);

          // Blinking LED cluster
          const time = Date.now() * 0.005 + u;
          const led1 = Math.sin(time * 3) > 0;
          const led2 = Math.cos(time * 2) > 0;

          ctx.fillStyle = led1 ? (st.overheating ? '#ef4444' : '#10b981') : '#064e3b';
          ctx.fillRect(x - 8 * z, uY + 1.5 * z, 2 * z, 2 * z);

          ctx.fillStyle = led2 ? '#38bdf8' : '#0c4a6e';
          ctx.fillRect(x - 4 * z, uY + 1.5 * z, 2 * z, 2 * z);

          ctx.fillStyle = st.pulseTime > 0.1 ? '#f59e0b' : '#78350f';
          ctx.fillRect(x, uY + 1.5 * z, 2 * z, 2 * z);
        }
        break;
      }

      case 'subagent_office': {
        // Glass walled subagent workspace with holo-screen
        ctx.fillStyle = 'rgba(168, 85, 247, 0.15)';
        ctx.fillRect(x - 14 * z, y - 20 * z, 28 * z, 20 * z);
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 1 * z;
        ctx.strokeRect(x - 14 * z, y - 20 * z, 28 * z, 20 * z);

        // Desk
        ctx.fillStyle = '#334155';
        ctx.fillRect(x - 10 * z, y - 10 * z, 20 * z, 6 * z);

        // Holo monitor
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(x - 5 * z, y - 18 * z, 10 * z, 6 * z);
        ctx.strokeStyle = '#e9d5ff';
        ctx.lineWidth = 0.8 * z;
        ctx.strokeRect(x - 5 * z, y - 18 * z, 10 * z, 6 * z);
        break;
      }

      case 'repo_shelf': {
        // Warehouse Shelving Compartments for /pkg, /cmd, /web
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x - 14 * z, y - 24 * z, 28 * z, 24 * z);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1 * z;
        ctx.strokeRect(x - 14 * z, y - 24 * z, 28 * z, 24 * z);

        // Top Shelf (/pkg)
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(x - 11 * z, y - 21 * z, 22 * z, 4 * z);

        // Middle Shelf (/cmd)
        ctx.fillStyle = '#10b981';
        ctx.fillRect(x - 11 * z, y - 14 * z, 22 * z, 4 * z);

        // Bottom Shelf (/web)
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(x - 11 * z, y - 7 * z, 22 * z, 4 * z);
        break;
      }

      case 'filing_vault': {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x - 10 * z, y - 22 * z, 20 * z, 20 * z);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(x - 7 * z, y - 18 * z, 14 * z, 3 * z);
        ctx.fillRect(x - 7 * z, y - 12 * z, 14 * z, 3 * z);
        break;
      }

      case 'search_radar': {
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(x, y - 8 * z, 10 * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2 * z;
        ctx.beginPath();
        ctx.moveTo(x, y - 8 * z);
        ctx.lineTo(x + Math.cos(this.radarAngle) * 10 * z, y - 8 * z + Math.sin(this.radarAngle) * 10 * z);
        ctx.stroke();
        break;
      }

      case 'cnc_lathe': {
        ctx.fillStyle = '#475569';
        ctx.fillRect(x - 14 * z, y - 12 * z, 28 * z, 10 * z);
        ctx.fillStyle = '#ec4899';
        ctx.fillRect(x - 3 * z, y - 20 * z, 6 * z, 10 * z);
        if (st.pulseTime > 0.2) {
          ctx.strokeStyle = '#f43f5e';
          ctx.lineWidth = 1.5 * z;
          ctx.beginPath();
          ctx.moveTo(x, y - 10 * z);
          ctx.lineTo(x, y - 2 * z);
          ctx.stroke();
        }
        break;
      }

      case 'test_furnace': {
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(x, y - 10 * z, 12 * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = st.pulseTime > 0.1 ? '#10b981' : '#047857';
        ctx.beginPath();
        ctx.arc(x, y - 10 * z, 6 * z, 0, Math.PI * 2);
        ctx.fill();
        break;
      }

      case 'phone_booth': {
        ctx.fillStyle = '#581c87';
        ctx.fillRect(x - 8 * z, y - 24 * z, 16 * z, 22 * z);
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(x - 5 * z, y - 20 * z, 10 * z, 8 * z);
        break;
      }

      case 'conveyor': {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x - 14 * z, y - 7 * z, 28 * z, 7 * z);
        ctx.fillStyle = '#14b8a6';
        const crateX = x - 12 * z + this.conveyorOffset * 20 * z;
        ctx.fillRect(crateX, y - 12 * z, 6 * z, 6 * z);
        break;
      }

      case 'security_gate': {
        ctx.fillStyle = '#475569';
        ctx.fillRect(x - 14 * z, y - 18 * z, 5 * z, 18 * z);
        ctx.fillRect(x + 9 * z, y - 18 * z, 5 * z, 18 * z);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x - 14 * z, y - 12 * z, 28 * z, 4 * z);
        break;
      }
    }
  }

  private renderWorker(worker: WorkerAgent, floorLevel: number): void {
    const pos = this.isoToScreen(worker.x, worker.y, floorLevel);
    const ctx = this.ctx;
    const z = this.zoom;

    ctx.save();

    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, 7 * z, 3.5 * z, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fill();

    const bounce = worker.state === 'walking' ? Math.sin(Date.now() / 120) * 2 * z : 0;
    const bodyY = pos.y - 10 * z + bounce;

    ctx.fillStyle = worker.color;
    ctx.beginPath();
    ctx.arc(pos.x, bodyY, 5 * z, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(pos.x, bodyY - 4 * z, 3.5 * z, Math.PI, 0);
    ctx.fill();

    ctx.font = `bold ${Math.max(7, 8 * z)}px Inter, sans-serif`;
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(worker.name, pos.x, bodyY - 10 * z);

    if (worker.speechBubble && worker.speechBubble.expiresAt > Date.now()) {
      this.drawSpeechBubble(pos.x, bodyY - 20 * z, worker.speechBubble.text);
    }

    ctx.restore();
  }

  private drawSpeechBubble(x: number, y: number, text: string): void {
    const ctx = this.ctx;
    ctx.font = `${Math.max(7, 9 * this.zoom)}px Inter, monospace`;
    const textMetrics = ctx.measureText(text);
    const padding = 5 * this.zoom;
    const width = Math.min(220 * this.zoom, textMetrics.width + padding * 2);
    const height = 16 * this.zoom;

    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1 * this.zoom;

    ctx.beginPath();
    ctx.roundRect(x - width / 2, y - height, width, height, 3 * this.zoom);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      text.length > 24 ? text.slice(0, 22) + '…' : text,
      x,
      y - height / 2
    );
    ctx.restore();
  }
}
