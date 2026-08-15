import { describe, it, expect, beforeEach } from 'vitest';
import { WaterfallTimelineEngine } from './waterfall_timeline';
import type { VisualizerEvent } from '../types';

describe('WaterfallTimelineEngine', () => {
  let engine: WaterfallTimelineEngine;

  beforeEach(() => {
    engine = new WaterfallTimelineEngine(15);
  });

  it('should initialize with empty spans and zero latency counters', () => {
    const telemetry = engine.getTelemetry();
    expect(telemetry.spans.length).toBe(0);
    expect(telemetry.totalLlmTimeMs).toBe(0);
    expect(telemetry.totalToolTimeMs).toBe(0);
    expect(telemetry.averageToolDurationMs).toBe(0);
  });

  it('should categorize events into FILE_IO, COMMAND_EXEC, MCP_RPC, and LLM_INFERENCE', () => {
    expect(engine.determineCategory('file.write').category).toBe('FILE_IO');
    expect(engine.determineCategory('command.run').category).toBe('COMMAND_EXEC');
    expect(engine.determineCategory('mcp.call').category).toBe('MCP_RPC');
    expect(engine.determineCategory('agent.think').category).toBe('LLM_INFERENCE');
  });

  it('should compute durations, aggregate totals, and identify the slowest span', () => {
    const base = Date.now();

    const evt1: VisualizerEvent = {
      id: 'e1',
      sessionId: 's1',
      type: 'agent.think',
      timestamp: base + 1000,
      title: 'Planning',
      payload: { durationMs: 1200 },
    };

    const evt2: VisualizerEvent = {
      id: 'e2',
      sessionId: 's1',
      type: 'command.run',
      timestamp: base + 3000,
      title: 'Run go test',
      payload: { durationMs: 4500, CommandLine: 'go test ./...' },
    };

    const evt3: VisualizerEvent = {
      id: 'e3',
      sessionId: 's1',
      type: 'file.write',
      timestamp: base + 4000,
      title: 'Write file',
      payload: { durationMs: 50, file: 'main.go' },
    };

    engine.processEvent(evt1);
    engine.processEvent(evt2);
    const telemetry = engine.processEvent(evt3);

    expect(telemetry.spans.length).toBe(3);
    expect(telemetry.totalLlmTimeMs).toBe(1200);
    expect(telemetry.totalToolTimeMs).toBe(4550);
    expect(telemetry.slowestSpan?.id).toBe('e2');
    expect(telemetry.slowestSpan?.durationMs).toBe(4500);
    expect(telemetry.averageToolDurationMs).toBe(Math.round(4550 / 2));
  });

  it('should handle reset cleanly', () => {
    engine.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'file.read',
      timestamp: Date.now(),
      title: 'read',
    });
    engine.reset();
    expect(engine.getTelemetry().spans.length).toBe(0);
  });
});
