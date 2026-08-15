import { describe, it, expect, beforeEach } from 'vitest';
import { BlastRadiusEngine } from './blast_radius';
import type { VisualizerEvent } from '../types';

describe('BlastRadiusEngine', () => {
  let engine: BlastRadiusEngine;

  beforeEach(() => {
    engine = new BlastRadiusEngine();
  });

  it('should initialize with zero blast radius and LOW severity', () => {
    const telemetry = engine.getTelemetry();
    expect(telemetry.totalFilesTouched).toBe(0);
    expect(telemetry.totalLinesAdded).toBe(0);
    expect(telemetry.totalLinesRemoved).toBe(0);
    expect(telemetry.severity).toBe('LOW');
    expect(telemetry.packages.length).toBe(0);
  });

  it('should extract top-level package paths correctly', () => {
    expect(engine.extractPackageName('pkg/server/server.go')).toBe('pkg/server');
    expect(engine.extractPackageName('web/src/canvas/workshop.ts')).toBe('web/src/canvas');
    expect(engine.extractPackageName('Taskfile.yml')).toBe('root');
  });

  it('should calculate blast radius metrics and package groupings', () => {
    const evt1: VisualizerEvent = {
      id: 'e1',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'edit server.go',
      payload: { file: 'pkg/server/server.go', added: 45, removed: 10 },
    };

    const evt2: VisualizerEvent = {
      id: 'e2',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'edit hub.go',
      payload: { file: 'pkg/server/hub.go', added: 20, removed: 5 },
    };

    engine.processEvent(evt1);
    const telemetry = engine.processEvent(evt2);

    expect(telemetry.totalFilesTouched).toBe(2);
    expect(telemetry.totalLinesAdded).toBe(65);
    expect(telemetry.totalLinesRemoved).toBe(15);
    expect(telemetry.severity).toBe('MEDIUM');
    expect(telemetry.packages.length).toBe(1);
    expect(telemetry.packages[0].packageName).toBe('pkg/server');
    expect(telemetry.packages[0].filesTouched).toBe(2);
  });

  it('should scale severity to HIGH and EXTREME on large refactors', () => {
    engine.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'massive rewrite',
      payload: { file: 'web/src/main.ts', added: 600, removed: 200 },
    });

    const telemetry = engine.getTelemetry();
    expect(telemetry.severity).toBe('EXTREME');
    expect(telemetry.totalLinesAdded).toBe(600);
  });

  it('should handle reset cleanly', () => {
    engine.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'write',
      payload: { file: 'main.go', added: 30 },
    });
    engine.reset();
    expect(engine.getTelemetry().totalFilesTouched).toBe(0);
  });
});
