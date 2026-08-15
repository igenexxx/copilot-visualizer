import type { VisualizerEvent } from '../types';

export type CognitiveMode =
  | 'RECONNAISSANCE'
  | 'CONSTRUCTION'
  | 'VERIFICATION'
  | 'DEEP_REFLECTION'
  | 'MCP_BRIDGE'
  | 'AWAITING_INPUT'
  | 'IDLE';

export interface CognitiveTelemetry {
  currentMode: CognitiveMode;
  modeLabel: string;
  modeIcon: string;
  modeColor: string;
  confidencePct: number;
  activeActionPerMin: number;
  timeInCurrentModeMs: number;
  modeDistribution: Record<CognitiveMode, number>; // total milliseconds spent
}

export class CognitiveClassifierEngine {
  private currentMode: CognitiveMode = 'IDLE';
  private modeStartTime: number = Date.now();
  private recentTimestamps: number[] = [];
  private modeDurations: Record<CognitiveMode, number> = {
    RECONNAISSANCE: 0,
    CONSTRUCTION: 0,
    VERIFICATION: 0,
    DEEP_REFLECTION: 0,
    MCP_BRIDGE: 0,
    AWAITING_INPUT: 0,
    IDLE: 0,
  };

  /**
   * Resets classifier telemetry.
   */
  public reset(): void {
    this.currentMode = 'IDLE';
    this.modeStartTime = Date.now();
    this.recentTimestamps = [];
    this.modeDurations = {
      RECONNAISSANCE: 0,
      CONSTRUCTION: 0,
      VERIFICATION: 0,
      DEEP_REFLECTION: 0,
      MCP_BRIDGE: 0,
      AWAITING_INPUT: 0,
      IDLE: 0,
    };
  }

  /**
   * Classifies an event into a CognitiveMode.
   */
  public classifyEvent(event: VisualizerEvent): CognitiveMode {
    const type = event.type || '';

    if (type === 'intervention.prompt' || type === 'checkpoint.request') {
      return 'AWAITING_INPUT';
    }

    if (type.startsWith('mcp.')) {
      return 'MCP_BRIDGE';
    }

    if (type.startsWith('file.write') || type === 'code.forge' || type === 'patch.apply') {
      return 'CONSTRUCTION';
    }

    if (type.startsWith('file.read') || type === 'search.symbol' || type === 'dir.list' || type === 'repo.scan') {
      return 'RECONNAISSANCE';
    }

    if (type.startsWith('command.') || type === 'test.run' || type === 'test.output') {
      return 'VERIFICATION';
    }

    if (type === 'agent.think') {
      return 'DEEP_REFLECTION';
    }

    return 'IDLE';
  }

  /**
   * Ingests an event and updates cognitive mode telemetry.
   */
  public processEvent(event: VisualizerEvent): CognitiveTelemetry {
    const now = event.timestamp || Date.now();
    this.recentTimestamps.push(now);

    // Filter timestamps older than 60s
    const windowStart = now - 60000;
    this.recentTimestamps = this.recentTimestamps.filter((t) => t >= windowStart);

    const newMode = this.classifyEvent(event);
    const elapsed = Math.max(0, now - this.modeStartTime);

    if (newMode !== this.currentMode) {
      this.modeDurations[this.currentMode] += elapsed;
      this.currentMode = newMode;
      this.modeStartTime = now;
    }

    return this.getTelemetry(now);
  }

  /**
   * Returns current cognitive telemetry snapshot.
   */
  public getTelemetry(now: number = Date.now()): CognitiveTelemetry {
    const timeInCurrentMode = Math.max(0, now - this.modeStartTime);

    let modeLabel = 'Idle';
    let modeIcon = '💤';
    let modeColor = '#94a3b8';

    switch (this.currentMode) {
      case 'RECONNAISSANCE':
        modeLabel = 'Reconnaissance (Search & Read)';
        modeIcon = '🔍';
        modeColor = '#06b6d4';
        break;
      case 'CONSTRUCTION':
        modeLabel = 'Construction (Forging Code)';
        modeIcon = '🏗️';
        modeColor = '#ec4899';
        break;
      case 'VERIFICATION':
        modeLabel = 'Verification (Tests & Build)';
        modeIcon = '🧪';
        modeColor = '#10b981';
        break;
      case 'DEEP_REFLECTION':
        modeLabel = 'Deep Reflection (Planning)';
        modeIcon = '🧘';
        modeColor = '#f59e0b';
        break;
      case 'MCP_BRIDGE':
        modeLabel = 'MCP Bridge (External Tools)';
        modeIcon = '🌐';
        modeColor = '#a855f7';
        break;
      case 'AWAITING_INPUT':
        modeLabel = 'Awaiting Developer Input';
        modeIcon = '⏸️';
        modeColor = '#ef4444';
        break;
    }

    const currentDist = { ...this.modeDurations };
    currentDist[this.currentMode] += timeInCurrentMode;

    return {
      currentMode: this.currentMode,
      modeLabel,
      modeIcon,
      modeColor,
      confidencePct: 95,
      activeActionPerMin: this.recentTimestamps.length,
      timeInCurrentModeMs: timeInCurrentMode,
      modeDistribution: currentDist,
    };
  }
}
