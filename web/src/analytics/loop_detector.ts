import type { VisualizerEvent } from '../types';

export type ThrashingLevel = 'NORMAL' | 'CAUTION' | 'CRITICAL';

export interface ActionFingerprint {
  id: string;
  type: string;
  target: string;
  fingerprint: string;
  timestamp: number;
  isError: boolean;
}

export interface LoopStatus {
  level: ThrashingLevel;
  thrashingScore: number; // 0 to 100
  repeatedActionCount: number;
  consecutiveErrorCount: number;
  culpritTarget?: string;
  reason?: string;
  suggestedIntervention?: string;
}

export class LoopDetectorEngine {
  private history: ActionFingerprint[] = [];
  private readonly maxWindowSize: number;
  private consecutiveErrors = 0;

  constructor(windowSize: number = 15) {
    this.maxWindowSize = Math.max(5, windowSize);
  }

  /**
   * Resets the analyzer sliding history.
   */
  public reset(): void {
    this.history = [];
    this.consecutiveErrors = 0;
  }

  /**
   * Generates a normalized action fingerprint to identify identical or cycling operations.
   */
  public getFingerprint(event: VisualizerEvent): string {
    const type = event.type || 'unknown';
    let target = '';

    if (event.payload?.file || event.payload?.TargetFile) {
      target = String(event.payload.file || event.payload.TargetFile).trim().toLowerCase();
    } else if (event.payload?.CommandLine || event.payload?.command) {
      target = String(event.payload.CommandLine || event.payload.command).trim().toLowerCase();
    } else if (event.payload?.query || event.payload?.Query) {
      target = String(event.payload.query || event.payload.Query).trim().toLowerCase();
    } else if (event.title) {
      target = event.title.trim().toLowerCase();
    }

    return `${type}::${target}`;
  }

  /**
   * Ingests a new event into the sliding window and returns the current loop analysis.
   */
  public processEvent(event: VisualizerEvent): LoopStatus {
    if (
      event.agentId === 'proctracer' ||
      event.type === 'os.telemetry' ||
      event.payload?.proctracer_snapshot
    ) {
      return this.evaluateCurrentStatus();
    }

    const isError =
      event.type === 'error' ||
      event.payload?.error != null ||
      event.payload?.exitCode != null && event.payload.exitCode !== 0 ||
      (event.summary && /error|failed|fatal|exception/i.test(event.summary)) === true;

    if (isError) {
      this.consecutiveErrors++;
    } else {
      this.consecutiveErrors = Math.max(0, this.consecutiveErrors - 1);
    }

    const fingerprint = this.getFingerprint(event);
    const target = event.payload?.file || event.payload?.CommandLine || event.title || 'operation';

    const action: ActionFingerprint = {
      id: event.id,
      type: event.type,
      target: String(target),
      fingerprint,
      timestamp: event.timestamp || Date.now(),
      isError,
    };

    this.history.push(action);
    if (this.history.length > this.maxWindowSize) {
      this.history.shift();
    }

    return this.evaluateCurrentStatus();
  }

  /**
   * Evaluates thrashing metrics over the recent sliding window.
   */
  public evaluateCurrentStatus(): LoopStatus {
    if (this.history.length < 3) {
      return {
        level: 'NORMAL',
        thrashingScore: 0,
        repeatedActionCount: 0,
        consecutiveErrorCount: this.consecutiveErrors,
      };
    }

    // 1. Count identical fingerprints frequency in recent window
    const counts = new Map<string, number>();
    const targets = new Map<string, string>();

    for (const item of this.history) {
      counts.set(item.fingerprint, (counts.get(item.fingerprint) || 0) + 1);
      targets.set(item.fingerprint, item.target);
    }

    let maxRepeatCount = 0;
    let culpritFingerprint = '';

    for (const [fp, count] of counts.entries()) {
      if (count > maxRepeatCount) {
        maxRepeatCount = count;
        culpritFingerprint = fp;
      }
    }

    const culpritTarget = targets.get(culpritFingerprint);

    // 2. Compute thrashing score (0 to 100)
    let score = 0;

    // Repetition factor: 3 repeats = 40, 4 repeats = 70, 5+ repeats = 95
    if (maxRepeatCount >= 5) score += 75;
    else if (maxRepeatCount >= 4) score += 50;
    else if (maxRepeatCount >= 3) score += 30;

    // Consecutive error factor
    if (this.consecutiveErrors >= 4) score += 40;
    else if (this.consecutiveErrors >= 2) score += 20;

    score = Math.min(100, score);

    // 3. Determine Level and Recommendations
    if (score >= 70 || maxRepeatCount >= 5 || this.consecutiveErrors >= 4) {
      return {
        level: 'CRITICAL',
        thrashingScore: score,
        repeatedActionCount: maxRepeatCount,
        consecutiveErrorCount: this.consecutiveErrors,
        culpritTarget,
        reason: `Agent is thrashing: repeated ${maxRepeatCount} times on '${culpritTarget}' with ${this.consecutiveErrors} consecutive errors.`,
        suggestedIntervention: `Suggested guidance: 'Check compilation errors in ${culpritTarget} or consider alternative approaches.'`,
      };
    }

    if (score >= 35 || maxRepeatCount >= 3 || this.consecutiveErrors >= 2) {
      return {
        level: 'CAUTION',
        thrashingScore: score,
        repeatedActionCount: maxRepeatCount,
        consecutiveErrorCount: this.consecutiveErrors,
        culpritTarget,
        reason: `Potential loop pattern: repeated ${maxRepeatCount} times on '${culpritTarget}'.`,
        suggestedIntervention: `Suggested action: Provide hint or check active command.`,
      };
    }

    return {
      level: 'NORMAL',
      thrashingScore: score,
      repeatedActionCount: maxRepeatCount,
      consecutiveErrorCount: this.consecutiveErrors,
    };
  }
}
