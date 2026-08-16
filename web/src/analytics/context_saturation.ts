import type { VisualizerEvent } from '../types';
import { ALL_PRICING_MODELS } from '../tokenomics/tracker';

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
  private activeModel: string = 'gemini-3.7-flash';
  private totalInputTokens: number = 0;
  private totalOutputTokens: number = 0;
  private totalCachedTokens: number = 0;
  private accumulatedFileTokens: number = 0;

  constructor(initialModel: string = 'gemini-3.7-flash') {
    this.setModel(initialModel);
  }

  public setModel(modelId: string): void {
    if (modelId) {
      this.activeModel = modelId;
    }
  }

  public reset(): void {
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.accumulatedFileTokens = 0;
  }

  public processEvent(event: VisualizerEvent): ContextSaturationTelemetry {
    const rawModel = event.payload?.detectedModel || event.payload?.model;
    if (rawModel) {
      this.setModel(String(rawModel));
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

  public syncWithTokenomics(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number,
    totalContextTokens?: number
  ): ContextSaturationTelemetry {
    if (modelId) this.activeModel = modelId;
    this.totalInputTokens = inputTokens;
    this.totalOutputTokens = outputTokens;
    this.totalCachedTokens = cachedTokens;
    if (typeof totalContextTokens === 'number') {
      this.activeContextTokens = totalContextTokens;
    }
    return this.getTelemetry();
  }

  private activeContextTokens: number = 0;

  public getTelemetry(): ContextSaturationTelemetry {
    const modelPricing = ALL_PRICING_MODELS[this.activeModel];
    const maxContext = modelPricing ? modelPricing.maxContext : 200000;

    const baseSystemTokens = Math.min(8500, this.totalInputTokens > 0 ? 8500 : 0);
    const historyTokens = Math.round(this.totalInputTokens * 0.4);
    const fileTokens = Math.max(this.accumulatedFileTokens, Math.round(this.totalInputTokens * 0.5));
    const outputBufferTokens = this.totalOutputTokens;

    const currentTokens = this.activeContextTokens > 0
      ? Math.min(maxContext, this.activeContextTokens)
      : Math.min(maxContext, this.totalInputTokens + this.totalOutputTokens);
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
