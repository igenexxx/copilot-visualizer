import type { VisualizerEvent } from '../types';

export type ContextSafetyTier = 'SAFE' | 'CAUTION' | 'DANGER';

export interface ContextBreakdown {
  systemPromptTokens: number;
  fileContentTokens: number;
  historyTokens: number;
  outputBufferTokens: number;
}

export interface ContextSaturationTelemetry {
  modelId: string;
  maxContextTokens: number;
  currentTokens: number;
  saturationPct: number;
  safetyTier: ContextSafetyTier;
  breakdown: ContextBreakdown;
  cacheHitRatio: number;
}

export class ContextSaturationEngine {
  private static readonly MODEL_LIMITS: Record<string, number> = {
    'gemini-3.7-flash': 1048576,
    'gemini-3.7-pro': 1048576,
    'gemini-2.5-flash': 1048576,
    'gemini-2.5-pro': 1048576,
    'claude-3-7-sonnet': 200000,
    'claude-3-5-sonnet': 200000,
    'claude-3-5-haiku': 200000,
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4.5-preview': 128000,
    'o3-mini': 128000,
  };

  private activeModel: string = 'gemini-3.7-flash';
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalCachedTokens: number = 0;
  private accumulatedFileTokens: number = 0;

  constructor(initialModel: string = 'gemini-3.7-flash') {
    this.setModel(initialModel);
  }

  public setModel(modelId: string): void {
    this.activeModel = modelId || 'gemini-3.7-flash';
  }

  public reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.accumulatedFileTokens = 0;
  }

  public processEvent(event: VisualizerEvent): ContextSaturationTelemetry {
    if (event.payload?.model) {
      this.setModel(String(event.payload.model));
    }

    if (typeof event.payload?.inputTokens === 'number') {
      this.totalInputTokens += event.payload.inputTokens;
    }
    if (typeof event.payload?.outputTokens === 'number') {
      this.totalOutputTokens += event.payload.outputTokens;
    }
    if (typeof event.payload?.cachedTokens === 'number') {
      this.totalCachedTokens += event.payload.cachedTokens;
    }

    // Estimate file reading context weight if explicit tokens are not present
    if (event.type === 'file.read' || event.type === 'file.write') {
      const lineCount = (event.payload?.lines as number) || 80;
      this.accumulatedFileTokens += Math.round(lineCount * 3.5);
    }

    return this.getTelemetry();
  }

  public getTelemetry(): ContextSaturationTelemetry {
    const maxContext = ContextSaturationEngine.MODEL_LIMITS[this.activeModel] || 200000;

    const baseSystemTokens = 8500;
    const historyTokens = Math.max(1200, Math.round(this.totalInputTokens * 0.35));
    const fileTokens = Math.max(this.accumulatedFileTokens, Math.round(this.totalInputTokens * 0.45));
    const outputBufferTokens = Math.max(4096, this.totalOutputTokens);

    const currentTokens = Math.min(maxContext, baseSystemTokens + historyTokens + fileTokens + outputBufferTokens);
    const saturationPct = Math.min(100, Math.round((currentTokens / maxContext) * 1000) / 10);

    let safetyTier: ContextSafetyTier = 'SAFE';
    if (saturationPct >= 80) safetyTier = 'DANGER';
    else if (saturationPct >= 60) safetyTier = 'CAUTION';

    const totalProcessed = this.totalInputTokens + this.totalCachedTokens;
    const cacheHitRatio = totalProcessed > 0
      ? Math.round((this.totalCachedTokens / totalProcessed) * 100) / 100
      : 0.0;

    return {
      modelId: this.activeModel,
      maxContextTokens: maxContext,
      currentTokens,
      saturationPct,
      safetyTier,
      breakdown: {
        systemPromptTokens: baseSystemTokens,
        fileContentTokens: fileTokens,
        historyTokens,
        outputBufferTokens,
      },
      cacheHitRatio,
    };
  }
}
