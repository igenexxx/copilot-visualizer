import { describe, it, expect } from 'vitest';
import { RPGEngine } from './rpg/engine';
import { TokenomicsTracker } from './tokenomics/tracker';
import { ContextSaturationEngine } from './analytics/context_saturation';
import { GoalTrackerEngine } from './analytics/goal_tracker';
import { BlastRadiusEngine } from './analytics/blast_radius';
import { WaterfallTimelineEngine } from './analytics/waterfall_timeline';
import { CognitiveClassifierEngine } from './analytics/cognitive_classifier';
import { LoopDetectorEngine } from './analytics/loop_detector';
import type { VisualizerEvent } from './types';

describe('Copilot CLI History End-to-End Processing', () => {
  const sampleCopilotHistory: VisualizerEvent[] = [
    {
      id: 'evt-copilot-start',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820000000,
      type: 'session.start',
      agentId: 'agent-copilot',
      agentRole: 'foreman',
      station: 'foreman_desk',
      title: 'Copilot Session Started',
      summary: 'Producer: copilot-agent, Model: gpt-5',
      payload: { detectedSource: 'copilot_cli', detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-prompt',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820001000,
      type: 'user.prompt',
      agentId: 'agent-copilot',
      agentRole: 'foreman',
      station: 'foreman_desk',
      title: 'Refactor and test auth module',
      summary: 'Please update JWT validator and run unit tests',
      payload: { prompt: 'Please update JWT validator and run unit tests', detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-think',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820002000,
      type: 'agent.think',
      agentId: 'agent-copilot',
      agentRole: 'foreman',
      station: 'foreman_desk',
      title: 'Analyzing authentication dependencies',
      summary: 'I will inspect auth.go and run tests to verify current state\n- [ ] Update validator\n- [ ] Run test suite',
      payload: { thinking: 'I will inspect auth.go and run tests to verify current state', detectedModel: 'gpt-5', inputTokens: 4500, outputTokens: 800 },
    },
    {
      id: 'evt-copilot-read',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820003000,
      type: 'file.read',
      agentId: 'agent-copilot',
      agentRole: 'inspector',
      station: 'repo_shelf',
      title: 'Reading auth.go',
      summary: 'Inspecting file: pkg/auth/auth.go',
      payload: { tool: 'view', args: { path: 'pkg/auth/auth.go' }, lines: 60, detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-perm-req',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820004000,
      type: 'checkpoint.request',
      agentId: 'agent-copilot',
      agentRole: 'inspector',
      station: 'security_gate',
      title: 'Checkpoint: Permission Required',
      summary: 'Execute bash command: go test -v ./pkg/auth/...',
      payload: { permissionData: { intention: 'Execute bash command: go test -v ./pkg/auth/...' }, detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-perm-done',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820005000,
      type: 'checkpoint.decision',
      agentId: 'agent-copilot',
      agentRole: 'inspector',
      station: 'security_gate',
      title: 'Checkpoint: Approved',
      summary: 'Permission decision: approved',
      payload: { decision: 'approved', detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-cmd-run',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820006000,
      type: 'command.run',
      agentId: 'agent-copilot',
      agentRole: 'tester',
      station: 'test_furnace',
      title: 'Exec: go test -v ./pkg/auth/...',
      summary: 'Running shell command: go test -v ./pkg/auth/...',
      payload: { tool: 'bash', args: { command: 'go test -v ./pkg/auth/...' }, durationMs: 1200, detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-cmd-out',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820007000,
      type: 'command.output',
      agentId: 'agent-copilot',
      agentRole: 'tester',
      station: 'test_furnace',
      title: 'PASS: 8 tests passed',
      summary: 'PASS: 8 tests passed in 0.04s',
      payload: { success: true, exitCode: 0, output: 'PASS: 8 tests passed in 0.04s', detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-write',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820008000,
      type: 'file.write',
      agentId: 'agent-copilot',
      agentRole: 'crafter',
      station: 'cnc_lathe',
      title: 'Forging: auth.go',
      summary: 'Modifying code in pkg/auth/auth.go',
      payload: { tool: 'edit', args: { path: 'pkg/auth/auth.go' }, file: 'pkg/auth/auth.go', added: 25, removed: 4, lines: 45, detectedModel: 'gpt-5' },
    },
    {
      id: 'evt-copilot-end',
      sessionId: 'f6cc59be-7d6f-48c3-880a-7398dbbeac5a',
      timestamp: 1723820009000,
      type: 'session.end',
      agentId: 'agent-copilot',
      agentRole: 'foreman',
      station: 'foreman_desk',
      title: 'Copilot Session Finished',
      summary: 'Session shutdown complete',
      payload: { detectedModel: 'gpt-5' },
    },
  ];

  it('validates RPG Engine progression on Copilot history', () => {
    const rpg = new RPGEngine();
    sampleCopilotHistory.forEach((evt) => rpg.handleEvent(evt, false));

    expect(rpg.stats.level).toBeGreaterThanOrEqual(1);
    expect(rpg.stats.xp).toBeGreaterThan(0);
    expect(rpg.stats.hp).toBeGreaterThan(0);
    expect(rpg.stats.maxHp).toBeGreaterThan(0);
    expect(rpg.stats.spellsCast).toBeGreaterThan(0);
    expect(rpg.skills.length).toBeGreaterThanOrEqual(1);
  });

  it('validates Tokenomics tracking and USD cost estimation for Copilot models', () => {
    const tokenomics = new TokenomicsTracker();
    tokenomics.setSource('copilot_cli');

    sampleCopilotHistory.forEach((evt) => tokenomics.handleEvent(evt));

    expect(tokenomics.meters.totalTokens).toBeGreaterThan(0);
    expect(tokenomics.meters.inputTokens).toBeGreaterThan(0);
    expect(tokenomics.meters.totalCostUSD).toBeGreaterThanOrEqual(0);
    expect(tokenomics.activeModel).toBeDefined();
  });

  it('validates Context Saturation Silo calculation', () => {
    const contextSat = new ContextSaturationEngine('gpt-5');
    sampleCopilotHistory.forEach((evt) => contextSat.processEvent(evt));

    const telemetry = contextSat.getTelemetry();
    expect(telemetry.currentTokens).toBeGreaterThan(0);
    expect(telemetry.maxContextTokens).toBeGreaterThan(0);
    expect(telemetry.saturationPct).toBeGreaterThanOrEqual(0);
    expect(telemetry.safetyTier).toBeDefined();
  });

  it('validates Goal Tracker and subtask decomposition', () => {
    const goalTracker = new GoalTrackerEngine();
    sampleCopilotHistory.forEach((evt) => goalTracker.processEvent(evt));

    const telemetry = goalTracker.getTelemetry();
    expect(telemetry.rootGoal).toContain('Refactor');
    expect(telemetry.checklist.length).toBeGreaterThan(0);
  });

  it('validates Blast Radius Calculator on file edits', () => {
    const blast = new BlastRadiusEngine();
    sampleCopilotHistory.forEach((evt) => blast.processEvent(evt));

    const telemetry = blast.getTelemetry();
    expect(telemetry.totalFilesTouched).toBeGreaterThanOrEqual(1);
    expect(telemetry.packages.some((p) => p.packageName.includes('pkg/auth'))).toBe(true);
    expect(telemetry.totalLinesAdded).toBeGreaterThanOrEqual(25);
  });

  it('validates Waterfall Timeline phase segmentation', () => {
    const waterfall = new WaterfallTimelineEngine();
    sampleCopilotHistory.forEach((evt) => waterfall.processEvent(evt));

    const telemetry = waterfall.getTelemetry();
    expect(telemetry.spans.length).toBeGreaterThanOrEqual(3);
    expect(telemetry.totalToolTimeMs).toBeGreaterThan(0);
  });

  it('validates Cognitive Classifier & Loop Detector', () => {
    const cog = new CognitiveClassifierEngine();
    const loop = new LoopDetectorEngine();

    sampleCopilotHistory.forEach((evt) => {
      cog.processEvent(evt);
      loop.processEvent(evt);
    });

    const cogTel = cog.getTelemetry();
    const loopStatus = loop.evaluateCurrentStatus();

    expect(cogTel.currentMode).toBeDefined();
    expect(loopStatus.level).toBe('NORMAL');
    expect(loopStatus.thrashingScore).toBe(0);
  });
});
