import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkshopCanvas } from './workshop';
import type { VisualizerEvent } from '../types';

describe('WorkshopCanvas', () => {
  let canvasEl: HTMLCanvasElement;
  let workshop: WorkshopCanvas;

  beforeEach(() => {
    canvasEl = document.createElement('canvas');
    canvasEl.width = 1200;
    canvasEl.height = 800;

    // Mock getContext('2d')
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      roundRect: vi.fn(),
      fillText: vi.fn(),
      setLineDash: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      canvas: canvasEl,
    };
    canvasEl.getContext = vi.fn(() => mockCtx as any);

    workshop = new WorkshopCanvas(canvasEl);
  });

  afterEach(() => {
    workshop.stop();
  });

  it('should initialize with default Ground Floor and default workstations', () => {
    expect(workshop.floors.length).toBe(1);
    const groundFloor = workshop.floors[0];
    expect(groundFloor.name).toBe('1F: Master Orchestrator');
    expect(groundFloor.workstations.size).toBeGreaterThanOrEqual(8);
    expect(groundFloor.workstations.has('cnc_lathe')).toBe(true);
    expect(groundFloor.workstations.has('repo_shelf')).toBe(true);
    expect(groundFloor.workstations.has('server_rack')).toBe(true);
    expect(groundFloor.workstations.has('subagent_office')).toBe(true);
  });

  it('should route worker and pulse target station on event dispatch', () => {
    const groundFloor = workshop.floors[0];
    const cncStation = groundFloor.workstations.get('cnc_lathe')!;

    const evt: VisualizerEvent = {
      id: 'e-1',
      sessionId: 'sess-1',
      timestamp: Date.now(),
      type: 'file.write',
      agentId: 'agent-foreman',
      agentRole: 'crafter',
      station: 'cnc_lathe',
      title: 'Editing src/main.rs',
      summary: 'Updating logic',
      payload: {},
    };

    workshop.handleEvent(evt);

    expect(cncStation.active).toBe(true);
    expect(cncStation.pulseTime).toBe(1.0);
    expect(cncStation.itemsCount).toBe(1);
    expect(cncStation.heatLevel).toBeGreaterThan(0);
  });

  it('should cool down overheated station on manual flush', () => {
    const groundFloor = workshop.floors[0];
    const cncStation = groundFloor.workstations.get('cnc_lathe')!;
    cncStation.heatLevel = 90;
    cncStation.temperatureC = 720;
    cncStation.overheating = true;

    workshop.cooldownStation('cnc_lathe', 0);

    expect(cncStation.heatLevel).toBe(0);
    expect(cncStation.temperatureC).toBe(24);
    expect(cncStation.overheating).toBe(false);
  });

  it('should spawn new tower floor when subagent delegates to a new level', () => {
    const evt: VisualizerEvent = {
      id: 'e-sub',
      sessionId: 'sess-1',
      timestamp: Date.now(),
      type: 'subagent.delegate',
      agentId: 'subagent-crafter',
      agentRole: 'crafter',
      station: 'subagent_office',
      title: 'Delegating to Crafter',
      summary: 'Spawning child worker',
      payload: {},
    };

    workshop.handleEvent(evt);

    expect(workshop.floors.length).toBe(2);
    expect(workshop.floors[1].name).toBe('2F: CRAFTER WORKSHOP');
  });

  it('should switch active floor level smoothly', () => {
    workshop.getOrCreateFloorForAgent('crafter-agent', 'crafter');
    expect(workshop.floors.length).toBe(2);

    workshop.setActiveFloor(1);
    expect(workshop.activeFloorIndex).toBe(1);

    workshop.setActiveFloor(0);
    expect(workshop.activeFloorIndex).toBe(0);
  });
});
