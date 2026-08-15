import { describe, it, expect, beforeEach } from 'vitest';
import { GoalTrackerEngine } from './goal_tracker';
import type { VisualizerEvent } from '../types';

describe('GoalTrackerEngine', () => {
  let tracker: GoalTrackerEngine;

  beforeEach(() => {
    tracker = new GoalTrackerEngine();
  });

  it('should initialize with default orchestration goal', () => {
    const telemetry = tracker.getTelemetry();
    expect(telemetry.rootGoal).toBe('General Orchestration');
    expect(telemetry.activeSubtask).toBe('Idle');
    expect(telemetry.completedCount).toBe(0);
    expect(telemetry.totalChecklistCount).toBe(0);
  });

  it('should parse markdown checklists from thought payloads', () => {
    const thinkContent = `
      Planning steps:
      - [ ] Refactor session store with batch flusher
      - [x] Create 3D isometric stations
      - [ ] Add Vitest tests
    `;

    const items = tracker.parseChecklist(thinkContent);
    expect(items.length).toBe(3);
    expect(items[0].completed).toBe(false);
    expect(items[1].completed).toBe(true);
    expect(items[2].completed).toBe(false);
  });

  it('should update root goal and breadcrumbs on user prompt event', () => {
    const promptEvt: VisualizerEvent = {
      id: 'p1',
      sessionId: 's1',
      type: 'user.prompt',
      timestamp: Date.now(),
      title: 'feat: add multi-floor factory view',
    };

    tracker.processEvent(promptEvt);
    const telemetry = tracker.getTelemetry();
    expect(telemetry.rootGoal).toBe('feat: add multi-floor factory view');
    expect(telemetry.breadcrumbs[0]).toBe('feat: add multi-floor factory view');
  });

  it('should auto-mark verification tasks when tests succeed', () => {
    tracker.processEvent({
      id: 't1',
      sessionId: 's1',
      type: 'agent.think',
      timestamp: Date.now(),
      title: 'Thinking',
      summary: '- [ ] Run unit tests for server',
    });

    expect(tracker.getTelemetry().checklist[0].completed).toBe(false);

    tracker.processEvent({
      id: 'c1',
      sessionId: 's1',
      type: 'command.run',
      timestamp: Date.now(),
      title: 'task test',
      payload: { exitCode: 0 },
      summary: 'PASS: all 24 tests ok',
    });

    expect(tracker.getTelemetry().checklist[0].completed).toBe(true);
    expect(tracker.getTelemetry().completedCount).toBe(1);
  });

  it('should reset state cleanly', () => {
    tracker.processEvent({
      id: 'p1',
      sessionId: 's1',
      type: 'user.prompt',
      timestamp: Date.now(),
      title: 'Refactor code',
    });
    tracker.reset();
    expect(tracker.getTelemetry().rootGoal).toBe('General Orchestration');
    expect(tracker.getTelemetry().checklist.length).toBe(0);
  });
});
