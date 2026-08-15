import { describe, it, expect, beforeEach } from 'vitest';
import { LoopDetectorEngine } from './loop_detector';
import type { VisualizerEvent } from '../types';

describe('LoopDetectorEngine', () => {
  let detector: LoopDetectorEngine;

  beforeEach(() => {
    detector = new LoopDetectorEngine(10);
  });

  it('should initialize with normal status and zero thrashing score', () => {
    const status = detector.evaluateCurrentStatus();
    expect(status.level).toBe('NORMAL');
    expect(status.thrashingScore).toBe(0);
    expect(status.repeatedActionCount).toBe(0);
    expect(status.consecutiveErrorCount).toBe(0);
  });

  it('should generate normalized fingerprints for various event targets', () => {
    const evtFile: VisualizerEvent = {
      id: 'e1',
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'Write file',
      payload: { TargetFile: '/pkg/server/server.go' },
    };
    expect(detector.getFingerprint(evtFile)).toBe('file.write::/pkg/server/server.go');

    const evtCmd: VisualizerEvent = {
      id: 'e2',
      sessionId: 's1',
      type: 'command.run',
      timestamp: Date.now(),
      title: 'Run tests',
      payload: { CommandLine: 'task test' },
    };
    expect(detector.getFingerprint(evtCmd)).toBe('command.run::task test');
  });

  it('should transition to CAUTION when action repeats 3 times', () => {
    const makeEvt = (id: string): VisualizerEvent => ({
      id,
      sessionId: 's1',
      type: 'file.write',
      timestamp: Date.now(),
      title: 'Write store.go',
      payload: { file: 'pkg/store.go' },
    });

    detector.processEvent(makeEvt('1'));
    detector.processEvent(makeEvt('2'));
    const status = detector.processEvent(makeEvt('3'));

    expect(status.level).toBe('CAUTION');
    expect(status.repeatedActionCount).toBe(3);
    expect(status.thrashingScore).toBeGreaterThanOrEqual(30);
    expect(status.culpritTarget).toBe('pkg/store.go');
  });

  it('should transition to CRITICAL when action repeats 5+ times or error storm occurs', () => {
    const makeFailingCmd = (id: string): VisualizerEvent => ({
      id,
      sessionId: 's1',
      type: 'command.run',
      timestamp: Date.now(),
      title: 'Run build',
      payload: { CommandLine: 'go build ./...', exitCode: 1, error: 'compilation error' },
    });

    for (let i = 1; i <= 4; i++) {
      detector.processEvent(makeFailingCmd(String(i)));
    }
    const status = detector.processEvent(makeFailingCmd('5'));

    expect(status.level).toBe('CRITICAL');
    expect(status.thrashingScore).toBeGreaterThanOrEqual(75);
    expect(status.consecutiveErrorCount).toBeGreaterThanOrEqual(4);
    expect(status.reason).toContain('Agent is thrashing');
    expect(status.suggestedIntervention).toBeDefined();
  });

  it('should recover consecutive error count when healthy events occur', () => {
    const errorEvt: VisualizerEvent = {
      id: 'err',
      sessionId: 's1',
      type: 'error',
      timestamp: Date.now(),
      title: 'Compile fail',
      summary: 'fatal error: missing package',
    };

    const healthyEvt = (id: string): VisualizerEvent => ({
      id,
      sessionId: 's1',
      type: 'file.read',
      timestamp: Date.now(),
      title: `Read file ${id}`,
      payload: { file: `doc_${id}.md` },
    });

    detector.processEvent(errorEvt);
    detector.processEvent(errorEvt);
    expect(detector.evaluateCurrentStatus().consecutiveErrorCount).toBe(2);

    detector.processEvent(healthyEvt('1'));
    detector.processEvent(healthyEvt('2'));
    expect(detector.evaluateCurrentStatus().consecutiveErrorCount).toBe(0);
  });

  it('should handle reset properly', () => {
    detector.processEvent({
      id: 'e1',
      sessionId: 's1',
      type: 'command.run',
      timestamp: Date.now(),
      title: 'test',
      payload: { exitCode: 1 },
    });
    detector.reset();
    const status = detector.evaluateCurrentStatus();
    expect(status.level).toBe('NORMAL');
    expect(status.thrashingScore).toBe(0);
    expect(status.consecutiveErrorCount).toBe(0);
  });
});
