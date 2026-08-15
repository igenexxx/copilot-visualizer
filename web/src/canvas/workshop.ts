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

export interface FlyingReport {
  id: string;
  floorLevel: number;
  startGridX: number;
  startGridY: number;
  targetGridX: number;
  targetGridY: number;
  progress: number;
  title: string;
  color: string;
}

export interface WorkerTrailPoint {
  agentId: string;
  x: number;
  y: number;
  floorLevel: number;
  color: string;
  opacity: number;
  createdAt: number;
}

export class WorkshopCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrameId: number | null = null;

  private tileWidth = 60;
  private tileHeight = 30;
  private gridWidth = 16;
  private gridHeight = 16;
  private floorElevationStep = 220; // vertical separation between stacked floors in tower mode

  public floors: FactoryFloor[] = [];
  public activeFloorIndex: number | 'all' = 'all'; // 'all' for full tower overview, or floor index (0, 1, 2)
  private particles: Particle[] = [];
  private flyingReports: FlyingReport[] = [];
  private workerTrails: WorkerTrailPoint[] = [];

  private conveyorOffset = 0;
  private radarAngle = 0;
  private elevatorCabLevel = 0;
  private elevatorTargetLevel = 0;

  public selectedStation: StationType | null = null;
  public selectedAgent: string | null = null;
  public onSelectElement?: (type: 'station' | 'agent' | 'floor', data: any) => void;
  public onFloorChanged?: (floorIndex: number | 'all') => void;

  // Camera Pan & Zoom
  public zoom = 0.85;
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
      createStation('foreman_desk', level === 0 ? 'Master Command Desk' : `Subagent Desk ${level}F`, 8, 8, '#f59e0b', 'Orchestration, planning & blueprint architecture'),
      createStation('server_rack', 'MCP Server Vault', 3, 3, '#38bdf8', '19" Enterprise server racks & MCP fiber bridges'),
      createStation('phone_booth', 'MCP Dispatch', 2, 5, '#a855f7', 'External MCP Server bridges & remote RPC phone lines'),
      createStation('subagent_office', 'Subagent Glass Suite', 3, 13, '#a855f7', 'Subagent isolation cubicles & blueprint drafting'),
      createStation('repo_shelf', 'Repo Shelves (/pkg /cmd /web)', 13, 3, '#3b82f6', 'Project repository directory compartment shelves'),
      createStation('search_radar', 'Search Radar', 8, 3, '#06b6d4', 'Codebase symbol index & pattern scanning'),
      createStation('cnc_lathe', 'CNC Machining Lathe', 13, 8, '#ec4899', 'Code forging, patch editing & file modification'),
      createStation('test_furnace', 'Test Range & Furnace', 13, 13, '#10b981', 'Command execution, test suites & build verification'),
      createStation('conveyor', 'Conveyor & Elevator', 15, 8, '#14b8a6', 'Inter-floor transport & shipping dock'),
      createStation('security_gate', 'Security Gate', 8, 15, '#ef4444', 'Human-in-the-Loop approval gate & checkpoint barrier'),
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
      x: 8,
      y: 8,
      targetX: 8,
      targetY: 8,
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
      x: 15,
      y: 8,
      targetX: 8,
      targetY: 8,
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
    const gridCenterOffsetY = (this.gridWidth + this.gridHeight) * (this.tileHeight / 4);

    const baseScreenX = originX + (gx - gy) * (this.tileWidth / 2);
    const baseScreenY = originY + (gx + gy) * (this.tileHeight / 2) - gridCenterOffsetY - verticalFloorOffset - gz;

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

      // Trigger holographic report flight from Subagent Office (3, 13) to Master Foreman (8, 8)
      if (evt.station === 'subagent_office' || evt.type === 'subagent.delegate' || evt.type === 'subagent.return') {
        this.flyingReports.push({
          id: `rep-${Date.now()}-${Math.random()}`,
          floorLevel: floor.level,
          startGridX: 3,
          startGridY: 13,
          targetGridX: 8,
          targetGridY: 8,
          progress: 0,
          title: evt.title || 'Subagent Blueprint Report',
          color: '#a855f7',
        });
      }
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
        const center = this.isoToScreen(8, 8, fl.level);
        const dist = Math.hypot(this.mouseX - center.x, this.mouseY - center.y);
        if (dist < 180 * this.zoom) {
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

          // Record motion breadcrumb trail point
          let lastPoint: WorkerTrailPoint | undefined;
          for (let idx = this.workerTrails.length - 1; idx >= 0; idx--) {
            if (this.workerTrails[idx].agentId === worker.id && this.workerTrails[idx].floorLevel === fl.level) {
              lastPoint = this.workerTrails[idx];
              break;
            }
          }
          if (!lastPoint || Math.hypot(worker.x - lastPoint.x, worker.y - lastPoint.y) >= 0.28) {
            this.workerTrails.push({
              agentId: worker.id,
              x: worker.x,
              y: worker.y,
              floorLevel: fl.level,
              color: worker.color || '#38bdf8',
              opacity: 1.0,
              createdAt: Date.now(),
            });
          }
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

    // 4. Update Flying Subagent Reports in transit
    for (let i = this.flyingReports.length - 1; i >= 0; i--) {
      const rep = this.flyingReports[i];
      rep.progress += 0.016;
      if (rep.progress >= 1.0) {
        const foremanPos = this.isoToScreen(rep.targetGridX, rep.targetGridY, rep.floorLevel, 10);
        for (let p = 0; p < 12; p++) {
          this.particles.push({
            x: foremanPos.x + (Math.random() - 0.5) * 16,
            y: foremanPos.y - 10,
            vx: (Math.random() - 0.5) * 2.2,
            vy: -Math.random() * 2.8 - 1,
            color: Math.random() > 0.4 ? '#fbbf24' : '#c084fc',
            size: Math.random() * 3 + 2,
            life: 1.0,
            maxLife: 1.0,
            floorLevel: rep.floorLevel,
          });
        }
        this.flyingReports.splice(i, 1);
      }
    }

    // 5. Update worker breadcrumb trails (decay opacity smoothly over 2.5 seconds)
    const now = Date.now();
    for (let i = this.workerTrails.length - 1; i >= 0; i--) {
      const tp = this.workerTrails[i];
      const age = now - tp.createdAt;
      tp.opacity = Math.max(0, 1.0 - age / 2500);
      if (tp.opacity <= 0) {
        this.workerTrails.splice(i, 1);
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
    const pTopRight = this.isoToScreen(this.gridWidth - 1, 0, topLevel);
    const pBottomRight = this.isoToScreen(this.gridWidth - 1, 0, bottomLevel);

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
    const elevPos = this.isoToScreen(this.gridWidth - 1, 8, this.elevatorCabLevel, 0);
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

    // Multi-Room Architectural Glass Partitions & Zones on spacious 16x16 layout
    this.renderRoomZone(1, 1, 6, 6, fl.level, '⚡ MCP SERVER VAULT', '#38bdf8', 'rgba(56, 189, 248, 0.08)');
    this.renderRoomZone(1, 10, 6, 15, fl.level, '👥 SUBAGENT GLASS OFFICE', '#a855f7', 'rgba(168, 85, 247, 0.08)');
    this.renderRoomZone(10, 1, 15, 6, fl.level, '📁 REPO TREE MODULE SHELVES', '#3b82f6', 'rgba(59, 130, 246, 0.07)');

    // Floor Title Plaque in Tower Mode
    const plaquePos = this.isoToScreen(0, 8, fl.level);
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

    // Render Floor Fiber Optic Cables (Photons surge only during active station calls)
    this.renderFloorCables(fl);

    // Render Worker Motion Trails / Footstep Trace on floor
    this.renderWorkerTrails(fl.level);

    // Render Workstations on this floor
    for (const st of fl.workstations.values()) {
      this.renderWorkstation(st, fl.level);
    }

    // Render Flying Subagent Reports in transit
    this.renderFlyingReports(fl.level);

    // Render Workers on this floor
    for (const worker of fl.workers.values()) {
      this.renderWorker(worker, fl.level);
    }
  }

  private renderFloorCables(fl: FactoryFloor): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const centerPos = this.isoToScreen(8, 8, fl.level);

    const connections = [
      { gx: 3, gy: 3, color: '#38bdf8', active: (fl.workstations.get('server_rack')?.pulseTime || 0) > 0.05 },
      { gx: 3, gy: 13, color: '#a855f7', active: (fl.workstations.get('subagent_office')?.pulseTime || 0) > 0.05 },
      { gx: 13, gy: 3, color: '#3b82f6', active: (fl.workstations.get('repo_shelf')?.pulseTime || 0) > 0.05 },
      { gx: 13, gy: 8, color: '#ec4899', active: (fl.workstations.get('cnc_lathe')?.pulseTime || 0) > 0.05 },
      { gx: 13, gy: 13, color: '#10b981', active: (fl.workstations.get('test_furnace')?.pulseTime || 0) > 0.05 },
    ];

    for (const conn of connections) {
      const destPos = this.isoToScreen(conn.gx, conn.gy, fl.level);

      ctx.save();
      // 1. Dark floor conduit groove
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5 * z;
      ctx.beginPath();
      ctx.moveTo(centerPos.x, centerPos.y);
      ctx.lineTo(destPos.x, destPos.y);
      ctx.stroke();

      // 2. Glowing fiber core
      ctx.strokeStyle = conn.active ? conn.color : `${conn.color}33`;
      ctx.lineWidth = (conn.active ? 2.0 : 0.8) * z;
      ctx.stroke();

      // 3. Flowing light photons ONLY during active station calls/pulses
      if (conn.active) {
        const activeTime = (Date.now() * 0.003) % 1.0;
        for (let p = 0; p < 4; p++) {
          const t = (activeTime + p * 0.25) % 1.0;
          const px = centerPos.x + (destPos.x - centerPos.x) * t;
          const py = centerPos.y + (destPos.y - centerPos.y) * t;

          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = conn.color;
          ctx.shadowBlur = 12 * z;
          ctx.beginPath();
          ctx.arc(px, py, 2.5 * z, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }
  }

  private renderWorkerTrails(floorLevel: number): void {
    const ctx = this.ctx;
    const z = this.zoom;

    // Group trail points by agentId
    const trailsByAgent = new Map<string, WorkerTrailPoint[]>();
    for (const tp of this.workerTrails) {
      if (tp.floorLevel !== floorLevel) continue;
      if (!trailsByAgent.has(tp.agentId)) {
        trailsByAgent.set(tp.agentId, []);
      }
      trailsByAgent.get(tp.agentId)!.push(tp);
    }

    for (const [, points] of trailsByAgent.entries()) {
      if (points.length === 0) continue;

      // 1. Draw glowing connecting dashed spline line
      ctx.save();
      const primaryColor = points[points.length - 1].color || '#38bdf8';
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1.6 * z;
      ctx.setLineDash([4 * z, 3 * z]);
      ctx.shadowColor = primaryColor;
      ctx.shadowBlur = 6 * z;

      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const screenPos = this.isoToScreen(pt.x, pt.y, floorLevel);
        if (i === 0) {
          ctx.moveTo(screenPos.x, screenPos.y);
        } else {
          ctx.lineTo(screenPos.x, screenPos.y);
        }
      }
      ctx.globalAlpha = 0.45;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 2. Draw individual fading breadcrumb footprint rings
      for (const pt of points) {
        const screenPos = this.isoToScreen(pt.x, pt.y, floorLevel);

        ctx.save();
        ctx.globalAlpha = pt.opacity;

        // Outer soft glow ring
        ctx.fillStyle = pt.color;
        ctx.shadowColor = pt.color;
        ctx.shadowBlur = 8 * z * pt.opacity;
        ctx.beginPath();
        ctx.ellipse(screenPos.x, screenPos.y, 4.5 * z, 2.5 * z, 0, 0, Math.PI * 2);
        ctx.fill();

        // Bright core dot
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(screenPos.x, screenPos.y, 1.8 * z, 1.0 * z, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }
  }

  private renderFlyingReports(floorLevel: number): void {
    const ctx = this.ctx;
    const z = this.zoom;

    for (const rep of this.flyingReports) {
      if (rep.floorLevel !== floorLevel) continue;

      const pStart = this.isoToScreen(rep.startGridX, rep.startGridY, floorLevel);
      const pEnd = this.isoToScreen(rep.targetGridX, rep.targetGridY, floorLevel);

      const curX = pStart.x + (pEnd.x - pStart.x) * rep.progress;
      const curY = pStart.y + (pEnd.y - pStart.y) * rep.progress - Math.sin(rep.progress * Math.PI) * 40 * z;

      ctx.save();

      // Glowing Trail
      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur = 14 * z;

      // Report Folder Icon
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.roundRect(curX - 10 * z, curY - 10 * z, 20 * z, 16 * z, 3 * z);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1 * z;
      ctx.stroke();

      // Mini Folder Tab
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.roundRect(curX - 10 * z, curY - 13 * z, 8 * z, 4 * z, 1.5 * z);
      ctx.fill();

      // Document Text Lines
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(curX - 6 * z, curY - 5 * z, 12 * z, 1.5 * z);
      ctx.fillRect(curX - 6 * z, curY - 1 * z, 9 * z, 1.5 * z);

      // Label floating above
      ctx.font = `bold ${Math.max(6, 7.5 * z)}px Inter, sans-serif`;
      ctx.fillStyle = '#e9d5ff';
      ctx.textAlign = 'center';
      ctx.fillText('📋 Subagent Report', curX, curY - 16 * z);

      ctx.restore();
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
    this.ctx.fillStyle = isSelected ? '#f59e0b' : '#94a3b8';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(st.name, pos.x, pos.y + 16 * this.zoom);

    // 3. Thermal Wear Indicator Tag
    if (st.heatLevel > 20 || st.wearPct > 10) {
      const heatBadge = `${st.temperatureC}°C`;
      this.ctx.font = `bold ${Math.max(6, 7.5 * this.zoom)}px monospace`;
      this.ctx.fillStyle = st.overheating ? '#ef4444' : st.heatLevel > 30 ? '#f59e0b' : '#38bdf8';
      this.ctx.fillText(heatBadge, pos.x, pos.y - 30 * this.zoom);
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
        // Dual 3D Isometric 19" Server Cabinets (Server Vault)
        const isPulse = st.pulseTime > 0.05;

        // Left Cabinet (Tool Database)
        ctx.fillStyle = '#0b1329';
        ctx.fillRect(x - 18 * z, y - 28 * z, 16 * z, 28 * z);
        ctx.strokeStyle = isPulse ? '#38bdf8' : '#1e293b';
        ctx.lineWidth = 1 * z;
        ctx.strokeRect(x - 18 * z, y - 28 * z, 16 * z, 28 * z);

        // Right Cabinet (MCP Server Bridge)
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x + 2 * z, y - 28 * z, 16 * z, 28 * z);
        ctx.strokeStyle = isPulse ? '#06b6d4' : '#334155';
        ctx.strokeRect(x + 2 * z, y - 28 * z, 16 * z, 28 * z);

        // Server Blades & Blinking LED Array
        for (let u = 0; u < 5; u++) {
          const uY = y - 25 * z + u * 5 * z;

          // Left rack blades
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(x - 16 * z, uY, 12 * z, 3.5 * z);

          // Right rack blades
          ctx.fillRect(x + 4 * z, uY, 12 * z, 3.5 * z);

          const time = Date.now() * 0.006 + u;
          const led1 = Math.sin(time * 3.5) > 0;
          const led2 = Math.cos(time * 2.8) > 0;

          // Left LEDs (Green/Cyan)
          ctx.fillStyle = led1 ? (st.overheating ? '#ef4444' : '#10b981') : '#064e3b';
          ctx.fillRect(x - 14 * z, uY + 1 * z, 1.8 * z, 1.8 * z);

          // Right LEDs (Cyan/Amber)
          ctx.fillStyle = led2 ? '#38bdf8' : '#0c4a6e';
          ctx.fillRect(x + 6 * z, uY + 1 * z, 1.8 * z, 1.8 * z);
          ctx.fillStyle = isPulse ? '#f59e0b' : '#78350f';
          ctx.fillRect(x + 9 * z, uY + 1 * z, 1.8 * z, 1.8 * z);
        }

        // Top Roof Ventilation Fans
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(x - 15 * z, y - 27 * z, 10 * z, 1.5 * z);
        ctx.fillStyle = '#06b6d4';
        ctx.fillRect(x + 5 * z, y - 27 * z, 10 * z, 1.5 * z);

        // Active Cyber Data Aura
        if (isPulse) {
          ctx.save();
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 14 * z;
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5 * z;
          ctx.strokeRect(x - 18 * z, y - 28 * z, 36 * z, 28 * z);
          ctx.restore();
        }
        break;
      }

      case 'subagent_office': {
        // Isometric Glass Suite with Dual Workstations & Sitting Subagents
        const isPulse = st.pulseTime > 0.05;

        // Glass acoustic perimeter
        ctx.fillStyle = 'rgba(168, 85, 247, 0.12)';
        ctx.fillRect(x - 20 * z, y - 22 * z, 40 * z, 22 * z);
        ctx.strokeStyle = isPulse ? '#c084fc' : '#a855f7';
        ctx.lineWidth = 1.2 * z;
        ctx.strokeRect(x - 20 * z, y - 22 * z, 40 * z, 22 * z);

        // Desk 1 (Left - Researcher)
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x - 18 * z, y - 10 * z, 15 * z, 6 * z);

        // Curved Holo Screen (Blue)
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x - 16 * z, y - 18 * z, 11 * z, 6 * z);
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 0.8 * z;
        ctx.strokeRect(x - 16 * z, y - 18 * z, 11 * z, 6 * z);

        // Sitting Subagent 1 (Researcher Avatar)
        const bob1 = Math.sin(Date.now() * 0.005) * 1 * z;
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath();
        ctx.arc(x - 10 * z, y - 6 * z + bob1, 3.5 * z, 0, Math.PI * 2); // head
        ctx.fill();
        ctx.fillStyle = '#1e40af';
        ctx.fillRect(x - 12 * z, y - 2 * z + bob1, 4 * z, 4 * z); // body

        // Desk 2 (Right - Crafter / Tester)
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x + 3 * z, y - 10 * z, 15 * z, 6 * z);

        // Curved Holo Screen (Purple)
        ctx.fillStyle = '#c084fc';
        ctx.fillRect(x + 5 * z, y - 18 * z, 11 * z, 6 * z);
        ctx.strokeStyle = '#e9d5ff';
        ctx.strokeRect(x + 5 * z, y - 18 * z, 11 * z, 6 * z);

        // Sitting Subagent 2 (Crafter Avatar)
        const bob2 = Math.cos(Date.now() * 0.006) * 1 * z;
        ctx.fillStyle = '#a855f7';
        ctx.beginPath();
        ctx.arc(x + 11 * z, y - 6 * z + bob2, 3.5 * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7e22ce';
        ctx.fillRect(x + 9 * z, y - 2 * z + bob2, 4 * z, 4 * z);

        // Thought Glyphs above subagents when active
        if (isPulse) {
          ctx.font = `bold ${Math.max(7, 8.5 * z)}px monospace`;
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText('⚡ DRAFTING', x, y - 24 * z);
        }
        break;
      }

      case 'repo_shelf': {
        // 3D Isometric Modular Voxel Cubes & Repository Storage Blocks
        const drawIsoVoxelCube = (
          cx: number,
          cy: number,
          sizeW: number,
          sizeH: number,
          topColor: string,
          leftColor: string,
          rightColor: string,
          borderColor: string,
          label: string,
          badgeColor: string,
          isPulsing: boolean
        ) => {
          const halfW = sizeW * 0.5 * z;
          const halfH = sizeW * 0.25 * z;
          const h = sizeH * z;

          // Left Face
          ctx.beginPath();
          ctx.moveTo(cx - halfW, cy);
          ctx.lineTo(cx, cy + halfH);
          ctx.lineTo(cx, cy + halfH - h);
          ctx.lineTo(cx - halfW, cy - h);
          ctx.closePath();
          ctx.fillStyle = leftColor;
          ctx.fill();
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 0.8 * z;
          ctx.stroke();

          // Right Face
          ctx.beginPath();
          ctx.moveTo(cx, cy + halfH);
          ctx.lineTo(cx + halfW, cy);
          ctx.lineTo(cx + halfW, cy - h);
          ctx.lineTo(cx, cy + halfH - h);
          ctx.closePath();
          ctx.fillStyle = rightColor;
          ctx.fill();
          ctx.strokeStyle = borderColor;
          ctx.lineWidth = 0.8 * z;
          ctx.stroke();

          // Top Face
          ctx.beginPath();
          ctx.moveTo(cx, cy - h - halfH);
          ctx.lineTo(cx + halfW, cy - h);
          ctx.lineTo(cx, cy - h + halfH);
          ctx.lineTo(cx - halfW, cy - h);
          ctx.closePath();
          ctx.fillStyle = isPulsing ? '#ffffff' : topColor;
          ctx.fill();
          ctx.strokeStyle = isPulsing ? '#ffffff' : borderColor;
          ctx.lineWidth = isPulsing ? 1.5 * z : 0.8 * z;
          ctx.stroke();

          // Glowing Aura Shockwave if active
          if (isPulsing) {
            ctx.save();
            ctx.shadowColor = badgeColor;
            ctx.shadowBlur = 18 * z;
            ctx.strokeStyle = badgeColor;
            ctx.lineWidth = 2 * z;
            ctx.stroke();
            ctx.restore();
          }

          // Floating Directory Label Badge
          ctx.save();
          ctx.font = `bold ${Math.max(7, 8 * z)}px monospace`;
          ctx.fillStyle = isPulsing ? '#ffffff' : badgeColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(label, cx, cy - h - halfH - 2 * z);
          ctx.restore();
        };

        const pulse = st.pulseTime > 0.05;
        const lastTitle = (st.lastEvent?.title || st.lastEvent?.summary || '').toLowerCase();
        const pulsePkg = pulse && (lastTitle.includes('pkg') || lastTitle.includes('go') || !lastTitle.includes('web'));
        const pulseCmd = pulse && (lastTitle.includes('cmd') || lastTitle.includes('main'));
        const pulseWeb = pulse && (lastTitle.includes('web') || lastTitle.includes('src') || lastTitle.includes('css') || lastTitle.includes('ts'));

        // Base Industrial Concrete Foundation Platform
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1 * z;
        ctx.beginPath();
        ctx.ellipse(x, y + 8 * z, 38 * z, 18 * z, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 1. Blue Voxel Tower: /pkg (Top-Left block)
        drawIsoVoxelCube(
          x - 16 * z,
          y - 4 * z,
          24,
          28,
          '#3b82f6',
          '#1d4ed8',
          '#1e40af',
          '#60a5fa',
          '📁 /pkg',
          '#38bdf8',
          pulsePkg
        );

        // 2. Green Voxel Tower: /cmd (Center-Top block)
        drawIsoVoxelCube(
          x + 14 * z,
          y - 12 * z,
          22,
          20,
          '#10b981',
          '#059669',
          '#047857',
          '#34d399',
          '📁 /cmd',
          '#34d399',
          pulseCmd
        );

        // 3. Pink/Purple Voxel Tower: /web (Front-Right block)
        drawIsoVoxelCube(
          x + 6 * z,
          y + 8 * z,
          24,
          24,
          '#ec4899',
          '#db2777',
          '#be185d',
          '#f472b6',
          '📁 /web',
          '#f472b6',
          pulseWeb
        );

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
