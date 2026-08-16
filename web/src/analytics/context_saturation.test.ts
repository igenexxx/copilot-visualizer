import { describe, it, expect, beforeEach } from 'vitest';
import { ContextSaturationEngine } from './context_saturation';
import type { VisualizerEvent } from '../types';

describe('ContextSaturationEngine', () => {
  let engine: ContextSaturationEngine;

  beforeEach(() => {
    engine = new ContextSaturationEngine('gemini-3.7-flash');
  });

  it('should initialize with Gemini 1M context limit and safe tier', () => {
    const telemetry = engine.getTelemetry();
    expect(telemetry.modelId).toBe('gemini-3.7-flash');
    expect(telemetry.maxContextTokens).toBe(1000000);
    expect(telemetry.safetyTier).toBe('SAFE');
    expect(telemetry.saturationPct).toBeLessThan(10);
  });

  it('should update context limit when model changes to Claude or GPT', () => {
    engine.setModel('claude-3-7-sonnet');
    expect(engine.getTelemetry().maxContextTokens).toBe(200000);

    engine.setModel('gpt-4o');
    expect(engine.getTelemetry().maxContextTokens).toBe(128000);
  });

  it('should calculate saturation percentage and breakdown correctly', () => {
    engine.setModel('claude-3-7-sonnet'); // 200k limit

    const event: VisualizerEvent = {
      id: 'e1',
      sessionId: 's1',
      type: 'agent.think',
      timestamp: Date.now(),
      title: 'Token ingestion',
      payload: {
        inputTokens: 120000,
        outputTokens: 8000,
        cachedTokens: 40000,
      },
    };

    const telemetry = engine.processEvent(event);
    expect(telemetry.currentTokens).toBeGreaterThan(50000);
    expect(telemetry.cacheHitRatio).toBeCloseTo(0.25, 1);
    expect(telemetry.breakdown.systemPromptTokens).toBe(8500);
  });

  it('should transition to CAUTION and DANGER tiers as saturation rises', () => {
    engine.setModel('gpt-4o'); // 128k limit

    engine.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'agent.think',
      timestamp: Date.now(),
      title: 'Heavy context',
      payload: { inputTokens: 160000, outputTokens: 4000 },
    });

    const telemetry = engine.getTelemetry();
    expect(telemetry.safetyTier).toBe('DANGER');
    expect(telemetry.saturationPct).toBeGreaterThanOrEqual(80);
  });

  it('should reset accurately', () => {
    engine.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'file.read',
      timestamp: Date.now(),
      title: 'read',
      payload: { lines: 500 },
    });
    engine.reset();
    expect(engine.getTelemetry().currentTokens).toBeLessThan(20000);
  });
});
