import { describe, it, expect, beforeEach } from 'vitest';
import { CognitiveClassifierEngine } from './cognitive_classifier';
import type { VisualizerEvent } from '../types';

describe('CognitiveClassifierEngine', () => {
  let classifier: CognitiveClassifierEngine;

  beforeEach(() => {
    classifier = new CognitiveClassifierEngine();
  });

  it('should start in IDLE mode', () => {
    const telemetry = classifier.getTelemetry();
    expect(telemetry.currentMode).toBe('IDLE');
    expect(telemetry.modeIcon).toBe('💤');
    expect(telemetry.activeActionPerMin).toBe(0);
  });

  it('should correctly classify Reconnaissance events', () => {
    const evt: VisualizerEvent = {
      id: 'e1',
      sessionId: 's1',
      type: 'file.read',
      timestamp: Date.now(),
      title: 'Read file',
    };
    const telemetry = classifier.processEvent(evt);
    expect(telemetry.currentMode).toBe('RECONNAISSANCE');
    expect(telemetry.modeIcon).toBe('🔍');
    expect(telemetry.modeColor).toBe('#06b6d4');
  });

  it('should correctly classify Construction events', () => {
    const evt: VisualizerEvent = {
      id: 'e2',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'Write code',
    };
    const telemetry = classifier.processEvent(evt);
    expect(telemetry.currentMode).toBe('CONSTRUCTION');
    expect(telemetry.modeIcon).toBe('🏗️');
    expect(telemetry.modeColor).toBe('#ec4899');
  });

  it('should correctly classify Verification events', () => {
    const evt: VisualizerEvent = {
      id: 'e3',
      sessionId: 's1',
      type: 'command.run',
      timestamp: Date.now(),
      title: 'Run test suite',
    };
    const telemetry = classifier.processEvent(evt);
    expect(telemetry.currentMode).toBe('VERIFICATION');
    expect(telemetry.modeIcon).toBe('🧪');
    expect(telemetry.modeColor).toBe('#10b981');
  });

  it('should correctly classify Deep Reflection events', () => {
    const evt: VisualizerEvent = {
      id: 'e4',
      sessionId: 's1',
      type: 'agent.think',
      timestamp: Date.now(),
      title: 'Thinking...',
    };
    const telemetry = classifier.processEvent(evt);
    expect(telemetry.currentMode).toBe('DEEP_REFLECTION');
    expect(telemetry.modeIcon).toBe('🧘');
  });

  it('should track active APM (actions per minute) accurately', () => {
    const baseTime = Date.now();
    for (let i = 0; i < 5; i++) {
      classifier.processEvent({
        id: `e-${i}`,
        sessionId: 's1',
        type: 'file.read',
        timestamp: baseTime + i * 1000,
        title: `Read ${i}`,
      });
    }

    const telemetry = classifier.getTelemetry(baseTime + 6000);
    expect(telemetry.activeActionPerMin).toBe(5);
  });

  it('should handle reset cleanly', () => {
    classifier.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'Write',
    });
    classifier.reset();
    expect(classifier.getTelemetry().currentMode).toBe('IDLE');
  });
});
