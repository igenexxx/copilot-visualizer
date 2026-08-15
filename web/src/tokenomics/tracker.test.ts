import { describe, it, expect, beforeEach } from 'vitest';
import { TokenomicsTracker } from './tracker';
import type { VisualizerEvent } from '../types';

describe('TokenomicsTracker', () => {
  let tracker: TokenomicsTracker;

  beforeEach(() => {
    tracker = new TokenomicsTracker();
  });

  it('should initialize with default active model and zeroed meters', () => {
    expect(tracker.activeModelId).toBe('gemini-3.7-flash');
    expect(tracker.meters.inputTokens).toBe(0);
    expect(tracker.meters.outputTokens).toBe(0);
    expect(tracker.meters.totalTokens).toBe(0);
    expect(tracker.meters.totalCostUSD).toBe(0);
  });

  it('should switch model and recalculate pricing', () => {
    tracker.setModel('claude-3-7-sonnet');
    expect(tracker.activeModelId).toBe('claude-3-7-sonnet');
    expect(tracker.activeModel.provider).toBe('Anthropic');
    expect(tracker.activeModel.maxContext).toBe(200000);
  });

  it('should process events and accurately compute tokens and cost', () => {
    tracker.setModel('gemini-3.7-flash');

    const evt: VisualizerEvent = {
      id: 'e-1',
      sessionId: 's-1',
      timestamp: Date.now(),
      type: 'agent.think',
      agentId: 'a-1',
      agentRole: 'foreman',
      title: 'Planning',
      summary: 'Thinking steps',
      payload: {
        detectedModel: 'gemini-3.7-flash',
        inputTokens: 10000,
        outputTokens: 2000,
      },
    };

    tracker.processEvent(evt);

    expect(tracker.meters.inputTokens).toBe(10000);
    expect(tracker.meters.outputTokens).toBe(2000);
    expect(tracker.meters.totalTokens).toBe(12000);
    expect(tracker.meters.totalCostUSD).toBeGreaterThan(0);
    expect(tracker.detectedModels.has('gemini-3.7-flash')).toBe(true);
  });

  it('should track only actually used models for session dropdown', () => {
    expect(tracker.getUsedModels().length).toBe(1); // default active model
    expect(tracker.getUsedModels()[0].id).toBe('gemini-3.7-flash');

    const evt: VisualizerEvent = {
      id: 'e-2',
      sessionId: 's-1',
      timestamp: Date.now(),
      type: 'tool.call',
      agentId: 'a-1',
      agentRole: 'foreman',
      title: 'Tool Call',
      summary: 'Inspect',
      payload: {
        detectedModel: 'claude-3-5-sonnet',
      },
    };

    tracker.processEvent(evt);

    const used = tracker.getUsedModels();
    expect(used.length).toBe(2);
    expect(used.some((m) => m.id === 'claude-3-5-sonnet')).toBe(true);
  });

  it('should export and load tokenomics state safely', () => {
    tracker.setModel('gpt-4o');
    tracker.totalInputTokens = 50000;
    tracker.totalOutputTokens = 10000;
    tracker.totalCostUSD = 0.25;

    const state = tracker.exportState();
    expect(state.activeModelId).toBe('gpt-4o');
    expect(state.meters.totalTokens).toBe(60000);

    const fresh = new TokenomicsTracker();
    fresh.loadState(state);

    expect(fresh.activeModelId).toBe('gpt-4o');
    expect(fresh.meters.totalTokens).toBe(60000);
    expect(fresh.meters.totalCostUSD).toBe(0.25);
  });

  it('should handle adversarial / corrupted state safely', () => {
    expect(() => tracker.loadState(null as any)).not.toThrow();
    expect(() => tracker.loadState(undefined as any)).not.toThrow();
    expect(() => tracker.loadState({} as any)).not.toThrow();
    expect(() => tracker.loadState({ activeModelId: 'non-existent-model' } as any)).not.toThrow();
  });
});
