import type { VisualizerEvent } from '../types';

export interface ModelPricing {
  id: string;
  source: 'antigravity' | 'claude_code' | 'copilot_cli' | 'openai' | 'generic';
  name: string;
  agentLabel: string;
  provider: 'Google' | 'Anthropic' | 'OpenAI';
  maxContext: number;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  badgeColor: string;
}

export const ALL_PRICING_MODELS: Record<string, ModelPricing> = {
  // Google / Antigravity Family (Gemini 3.7 & 2.5)
  'gemini-3.7-flash': {
    id: 'gemini-3.7-flash',
    source: 'antigravity',
    name: 'Gemini 3.7 Flash',
    agentLabel: '⚡ Gemini 3.7 Flash (Antigravity)',
    provider: 'Google',
    maxContext: 1000000,
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachePerMillion: 0.0375,
    badgeColor: '#06b6d4',
  },
  'gemini-3.7-pro': {
    id: 'gemini-3.7-pro',
    source: 'antigravity',
    name: 'Gemini 3.7 Pro',
    agentLabel: '🔮 Gemini 3.7 Pro (Antigravity)',
    provider: 'Google',
    maxContext: 2000000,
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachePerMillion: 0.31,
    badgeColor: '#a855f7',
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    source: 'antigravity',
    name: 'Gemini 2.5 Pro',
    agentLabel: '🔮 Gemini 2.5 Pro',
    provider: 'Google',
    maxContext: 2000000,
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachePerMillion: 0.31,
    badgeColor: '#8b5cf6',
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    source: 'antigravity',
    name: 'Gemini 2.5 Flash',
    agentLabel: '⚡ Gemini 2.5 Flash',
    provider: 'Google',
    maxContext: 1000000,
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachePerMillion: 0.0375,
    badgeColor: '#a855f7',
  },

  // Anthropic / Claude Code Family
  'claude-3-7-sonnet': {
    id: 'claude-3-7-sonnet',
    source: 'claude_code',
    name: 'Claude 3.7 Sonnet',
    agentLabel: '🤖 Claude 3.7 Sonnet (Claude Code)',
    provider: 'Anthropic',
    maxContext: 200000,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachePerMillion: 0.3,
    badgeColor: '#f97316',
  },
  'claude-3-5-sonnet': {
    id: 'claude-3-5-sonnet',
    source: 'claude_code',
    name: 'Claude 3.5 Sonnet',
    agentLabel: '🤖 Claude 3.5 Sonnet',
    provider: 'Anthropic',
    maxContext: 200000,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachePerMillion: 0.3,
    badgeColor: '#fb923c',
  },
  'claude-3-5-haiku': {
    id: 'claude-3-5-haiku',
    source: 'claude_code',
    name: 'Claude 3.5 Haiku',
    agentLabel: '⚡ Claude 3.5 Haiku',
    provider: 'Anthropic',
    maxContext: 200000,
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cachePerMillion: 0.08,
    badgeColor: '#fdba74',
  },

  // OpenAI / Copilot Family
  'gpt-5.6-terra': {
    id: 'gpt-5.6-terra',
    source: 'copilot_cli',
    name: 'GPT-5.6 Terra',
    agentLabel: '🐙 GPT-5.6 Terra (GitHub Copilot)',
    provider: 'OpenAI',
    maxContext: 256000,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachePerMillion: 1.25,
    badgeColor: '#10b981',
  },
  'gpt-5': {
    id: 'gpt-5',
    source: 'copilot_cli',
    name: 'GPT-5 (Copilot)',
    agentLabel: '🐙 GPT-5 (GitHub Copilot)',
    provider: 'OpenAI',
    maxContext: 256000,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachePerMillion: 1.25,
    badgeColor: '#10b981',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    source: 'copilot_cli',
    name: 'GPT-4o (Omni)',
    agentLabel: '🐙 GPT-4o (GitHub Copilot)',
    provider: 'OpenAI',
    maxContext: 128000,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachePerMillion: 1.25,
    badgeColor: '#10b981',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    source: 'copilot_cli',
    name: 'GPT-4o Mini',
    agentLabel: '🐙 GPT-4o Mini',
    provider: 'OpenAI',
    maxContext: 128000,
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachePerMillion: 0.075,
    badgeColor: '#34d399',
  },
  'o1': {
    id: 'o1',
    source: 'copilot_cli',
    name: 'OpenAI o1',
    agentLabel: '🧠 OpenAI o1',
    provider: 'OpenAI',
    maxContext: 200000,
    inputPerMillion: 15.0,
    outputPerMillion: 60.0,
    cachePerMillion: 7.5,
    badgeColor: '#818cf8',
  },
  'o3-mini': {
    id: 'o3-mini',
    source: 'copilot_cli',
    name: 'OpenAI o3-mini',
    agentLabel: '🧠 OpenAI o3-mini (Reasoning)',
    provider: 'OpenAI',
    maxContext: 200000,
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cachePerMillion: 0.55,
    badgeColor: '#38bdf8',
  },
};

export interface ModelUsageRecord {
  model: ModelPricing;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUSD: number;
}

export interface TokenomicsState {
  activeModel: ModelPricing;
  detectedModelsList: ModelPricing[];
  totalContextTokens: number;
  maxContextTokens: number;
  contextPercent: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUSD: number;
  modelBreakdown: Record<string, ModelUsageRecord>;
  activeSource: string;
}

export class TokenomicsTracker {
  public activeModel: ModelPricing = ALL_PRICING_MODELS['gemini-3.7-flash'];
  public detectedModels: Map<string, ModelUsageRecord> = new Map();

  public totalContextTokens = 0;
  public totalInputTokens = 0;
  public totalOutputTokens = 0;
  public totalCachedTokens = 0;
  public totalCostUSD = 0.0;
  public activeSource = 'antigravity';

  public get activeModelId(): string {
    return this.activeModel.id;
  }

  public get meters() {
    return {
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      totalCostUSD: this.totalCostUSD,
    };
  }

  public getUsedModels(): ModelPricing[] {
    const list: ModelPricing[] = [];
    this.detectedModels.forEach((rec) => {
      list.push(rec.model);
    });
    return list;
  }

  public processEvent(evt: VisualizerEvent): void {
    this.handleEvent(evt);
  }

  public onUpdate?: (state: TokenomicsState) => void;

  constructor() {
    this.resetSession(this.activeModel.id);
  }

  public resetSession(modelId?: string): void {
    this.detectedModels.clear();
    this.totalContextTokens = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.totalCachedTokens = 0;
    this.totalCostUSD = 0.0;

    const initialId = modelId && ALL_PRICING_MODELS[modelId] ? modelId : 'gemini-3.7-flash';
    this.activeModel = ALL_PRICING_MODELS[initialId];
    this.activeSource = this.activeModel.source;
    this.registerModelUsage(initialId);
    this.recompute();
  }

  private registerModelUsage(modelId: string): ModelUsageRecord {
    let rec = this.detectedModels.get(modelId);
    if (!rec) {
      const model = ALL_PRICING_MODELS[modelId] || ALL_PRICING_MODELS['gemini-3.7-flash'];
      rec = {
        model,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        costUSD: 0.0,
      };
      this.detectedModels.set(modelId, rec);
    }
    return rec;
  }

  public setSource(source: string): void {
    const normalized = source.toLowerCase();
    let primaryModelId = 'gemini-3.7-flash';

    if (normalized.includes('claude')) {
      primaryModelId = 'claude-3-7-sonnet';
      this.activeSource = 'claude_code';
    } else if (normalized.includes('copilot')) {
      primaryModelId = 'gpt-4o';
      this.activeSource = 'copilot_cli';
    } else {
      primaryModelId = 'gemini-3.7-flash';
      this.activeSource = 'antigravity';
    }

    this.activeModel = ALL_PRICING_MODELS[primaryModelId];
    this.registerModelUsage(primaryModelId);
    this.recompute();
  }

  public syncFromEnrichment(enrichment: any): void {
    if (!enrichment) return;
    const modelId = enrichment.model || enrichment.latestModel;
    if (modelId) {
      let targetModel = ALL_PRICING_MODELS[modelId];
      if (!targetModel) {
        const lower = String(modelId).toLowerCase();
        if (lower.includes('gpt-5')) targetModel = ALL_PRICING_MODELS['gpt-5.6-terra'];
        else if (lower.includes('o3')) targetModel = ALL_PRICING_MODELS['o3-mini'];
        else if (lower.includes('o1')) targetModel = ALL_PRICING_MODELS['o1'];
        else if (lower.includes('4o-mini') || lower.includes('mini')) targetModel = ALL_PRICING_MODELS['gpt-4o-mini'];
        else if (lower.includes('claude-3-7') || lower.includes('claude-3.7')) targetModel = ALL_PRICING_MODELS['claude-3-7-sonnet'];
        else if (lower.includes('claude-3-5') || lower.includes('claude-3.5')) targetModel = ALL_PRICING_MODELS['claude-3-5-sonnet'];
        else if (lower.includes('flash')) targetModel = ALL_PRICING_MODELS['gemini-3.7-flash'];
      }
      if (targetModel) {
        this.activeModel = targetModel;
        this.activeSource = targetModel.source;
      }
    }

    if (typeof enrichment.activeContextTokens === 'number' && enrichment.activeContextTokens > 0) {
      this.totalContextTokens = enrichment.activeContextTokens;
    } else if (typeof enrichment.inputTokens === 'number') {
      this.totalContextTokens = enrichment.inputTokens;
    }

    if (typeof enrichment.inputTokens === 'number') this.totalInputTokens = enrichment.inputTokens;
    if (typeof enrichment.outputTokens === 'number') this.totalOutputTokens = enrichment.outputTokens;
    if (typeof enrichment.cacheReadTokens === 'number') this.totalCachedTokens = enrichment.cacheReadTokens;
    if (typeof enrichment.totalCostUsd === 'number') this.totalCostUSD = enrichment.totalCostUsd;

    const rec = this.registerModelUsage(this.activeModel.id);
    rec.inputTokens = this.totalInputTokens;
    rec.outputTokens = this.totalOutputTokens;
    rec.cachedTokens = this.totalCachedTokens;
    rec.costUSD = this.totalCostUSD;

    this.recompute();
  }

  public setModel(modelId: string): void {
    if (ALL_PRICING_MODELS[modelId]) {
      this.activeModel = ALL_PRICING_MODELS[modelId];
      this.activeSource = this.activeModel.source;
      this.registerModelUsage(modelId);
      this.recompute();
    }
  }

  public handleEvent(evt: VisualizerEvent): void {
    // Ignore OS system metrics & background process telemetry
    if (
      evt.agentId === 'proctracer' ||
      evt.type === 'os.telemetry' ||
      evt.payload?.proctracer_snapshot
    ) {
      return;
    }

    // Strictly trust explicit detectedModel from the Go backend parser
    let eventModelId = this.activeModel.id;

    if (evt.payload?.detectedModel && ALL_PRICING_MODELS[evt.payload.detectedModel]) {
      eventModelId = evt.payload.detectedModel;
      this.activeModel = ALL_PRICING_MODELS[eventModelId];
    }

    const rec = this.registerModelUsage(eventModelId);

    // Token Calculation (~3.8 chars per token)
    let payloadChars = 0;
    if (evt.payload) {
      payloadChars = JSON.stringify(evt.payload).length;
    }
    const titleChars = (evt.title || '').length;
    const summaryChars = (evt.summary || '').length;
    const totalChars = payloadChars + titleChars + summaryChars;

    let inTokens = typeof evt.payload?.inputTokens === 'number' ? evt.payload.inputTokens : 0;
    let outTokens = typeof evt.payload?.outputTokens === 'number' ? evt.payload.outputTokens : 0;
    let cacheTokens = typeof evt.payload?.cacheTokens === 'number' ? evt.payload.cacheTokens : 0;

    if (!inTokens && !outTokens) {
      if (evt.type === 'tool.call' || evt.type === 'file.read' || evt.type === 'mcp.call') {
        inTokens = Math.max(180, Math.round(totalChars / 3.8));
        outTokens = 85;
        cacheTokens = Math.round(inTokens * 0.4);
      } else if (evt.type === 'file.write' || evt.type === 'command.run') {
        inTokens = Math.max(350, Math.round(totalChars / 3.8));
        outTokens = Math.max(120, Math.round(payloadChars / 4.0));
        cacheTokens = Math.round(inTokens * 0.3);
      } else if (evt.type === 'agent.think') {
        inTokens = 450;
        outTokens = Math.max(90, Math.round(totalChars / 3.8));
        cacheTokens = 200;
      } else {
        inTokens = Math.max(100, Math.round(totalChars / 4.0));
        outTokens = 40;
      }
    }

    rec.inputTokens += inTokens;
    rec.outputTokens += outTokens;
    rec.cachedTokens += cacheTokens;

    this.totalInputTokens += inTokens;
    this.totalOutputTokens += outTokens;
    this.totalCachedTokens += cacheTokens;
    this.totalContextTokens = Math.min(this.activeModel.maxContext, this.totalContextTokens + inTokens + outTokens);

    this.recompute();
  }

  private recompute(): void {
    let totalCost = 0.0;
    const breakdown: Record<string, ModelUsageRecord> = {};

    this.detectedModels.forEach((rec, key) => {
      const inCost = (rec.inputTokens / 1_000_000) * rec.model.inputPerMillion;
      const outCost = (rec.outputTokens / 1_000_000) * rec.model.outputPerMillion;
      const cacheCost = (rec.cachedTokens / 1_000_000) * rec.model.cachePerMillion;
      rec.costUSD = inCost + outCost + cacheCost;
      totalCost += rec.costUSD;
      breakdown[key] = { ...rec };
    });

    this.totalCostUSD = totalCost;

    if (this.onUpdate) {
      this.onUpdate(this.getState());
    }
  }

  public getState(): TokenomicsState {
    const list: ModelPricing[] = [];
    this.detectedModels.forEach((rec) => {
      list.push(rec.model);
    });

    return {
      activeModel: this.activeModel,
      detectedModelsList: list,
      totalContextTokens: this.totalContextTokens,
      maxContextTokens: this.activeModel.maxContext,
      contextPercent: Math.min(100, (this.totalContextTokens / this.activeModel.maxContext) * 100),
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCachedTokens: this.totalCachedTokens,
      totalCostUSD: this.totalCostUSD,
      modelBreakdown: Object.fromEntries(this.detectedModels),
      activeSource: this.activeSource,
    };
  }

  public exportState(): any {
    const modelsObj: Record<string, any> = {};
    this.detectedModels.forEach((rec, key) => {
      modelsObj[key] = {
        inputTokens: rec.inputTokens,
        outputTokens: rec.outputTokens,
        cacheTokens: rec.cachedTokens,
        costUsd: rec.costUSD,
      };
    });

    return {
      activeModelId: this.activeModel.id,
      totalCostUsd: this.totalCostUSD,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalCacheTokens: this.totalCachedTokens,
      meters: this.meters,
      activeModels: modelsObj,
    };
  }

  public loadState(data: any): void {
    if (!data) return;
    if (data.activeModelId && ALL_PRICING_MODELS[data.activeModelId]) {
      this.activeModel = ALL_PRICING_MODELS[data.activeModelId];
      this.activeSource = this.activeModel.source;
    }
    if (typeof data.totalCostUsd === 'number') this.totalCostUSD = data.totalCostUsd;
    if (typeof data.totalInputTokens === 'number') this.totalInputTokens = data.totalInputTokens;
    if (typeof data.totalOutputTokens === 'number') this.totalOutputTokens = data.totalOutputTokens;
    if (typeof data.totalCacheTokens === 'number') this.totalCachedTokens = data.totalCacheTokens;

    if (data.activeModels && typeof data.activeModels === 'object') {
      Object.entries(data.activeModels).forEach(([mId, mData]: [string, any]) => {
        const pricing = ALL_PRICING_MODELS[mId] || ALL_PRICING_MODELS['gemini-3.7-flash'];
        this.detectedModels.set(mId, {
          model: pricing,
          inputTokens: mData.inputTokens || 0,
          outputTokens: mData.outputTokens || 0,
          cachedTokens: mData.cacheTokens || 0,
          costUSD: mData.costUsd || 0,
        });
      });
    }
    this.recompute();
    if (typeof data.totalCostUsd === 'number') this.totalCostUSD = data.totalCostUsd;
  }
}
