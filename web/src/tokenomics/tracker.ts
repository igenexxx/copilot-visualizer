import type { VisualizerEvent } from '../types';

export interface ModelPricing {
  id: string;
  name: string;
  maxContext: number;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
}

export const PRICING_MODELS: Record<string, ModelPricing> = {
  claude35: {
    id: 'claude35',
    name: 'Claude 3.5 Sonnet',
    maxContext: 200000,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachePerMillion: 0.3,
  },
  gpt4o: {
    id: 'gpt4o',
    name: 'GPT-4o (Omni)',
    maxContext: 128000,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachePerMillion: 1.25,
  },
  gemini15: {
    id: 'gemini15',
    name: 'Gemini 1.5 Pro',
    maxContext: 1000000,
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachePerMillion: 0.3,
  },
};

export interface TokenomicsState {
  currentModel: ModelPricing;
  contextTokens: number;
  maxContextTokens: number;
  contextPercent: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalCostUSD: number;
}

export class TokenomicsTracker {
  public model: ModelPricing = PRICING_MODELS.claude35;

  public contextTokens = 0;
  public inputTokens = 0;
  public outputTokens = 0;
  public cachedTokens = 0;
  public totalCostUSD = 0.0;

  public onUpdate?: (state: TokenomicsState) => void;

  public setModel(modelId: string): void {
    if (PRICING_MODELS[modelId]) {
      this.model = PRICING_MODELS[modelId];
      this.recompute();
    }
  }

  public handleEvent(evt: VisualizerEvent): void {
    // Estimate token consumption based on payload or event type
    let inTokens = 0;
    let outTokens = 0;
    let cacheTokens = 0;

    if (evt.type === 'tool.call' || evt.type === 'file.read' || evt.type === 'mcp.call') {
      inTokens = 650 + Math.floor(Math.random() * 400);
      outTokens = 120 + Math.floor(Math.random() * 80);
      cacheTokens = 300;
    } else if (evt.type === 'file.write' || evt.type === 'command.run') {
      inTokens = 1200 + Math.floor(Math.random() * 800);
      outTokens = 450 + Math.floor(Math.random() * 300);
    } else if (evt.type === 'agent.think') {
      inTokens = 800;
      outTokens = 350;
    } else {
      inTokens = 250;
      outTokens = 80;
    }

    this.inputTokens += inTokens;
    this.outputTokens += outTokens;
    this.cachedTokens += cacheTokens;

    // Context depth increases with conversation history
    this.contextTokens = Math.min(this.model.maxContext, this.contextTokens + inTokens + outTokens);

    this.recompute();
  }

  private recompute(): void {
    const inCost = (this.inputTokens / 1_000_000) * this.model.inputPerMillion;
    const outCost = (this.outputTokens / 1_000_000) * this.model.outputPerMillion;
    const cacheCost = (this.cachedTokens / 1_000_000) * this.model.cachePerMillion;
    this.totalCostUSD = inCost + outCost + cacheCost;

    if (this.onUpdate) {
      this.onUpdate(this.getState());
    }
  }

  public getState(): TokenomicsState {
    return {
      currentModel: this.model,
      contextTokens: this.contextTokens,
      maxContextTokens: this.model.maxContext,
      contextPercent: Math.min(100, (this.contextTokens / this.model.maxContext) * 100),
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedTokens: this.cachedTokens,
      totalCostUSD: this.totalCostUSD,
    };
  }
}
