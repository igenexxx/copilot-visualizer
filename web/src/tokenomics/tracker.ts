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
  // Google / Antigravity Family
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    source: 'antigravity',
    name: 'Gemini 2.5 Pro',
    agentLabel: '🔮 Gemini 2.5 Pro (Antigravity)',
    provider: 'Google',
    maxContext: 2000000,
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachePerMillion: 0.31,
    badgeColor: '#a855f7',
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    source: 'antigravity',
    name: 'Gemini 2.5 Flash',
    agentLabel: '⚡ Gemini 2.5 Flash (Subagent)',
    provider: 'Google',
    maxContext: 1000000,
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachePerMillion: 0.0375,
    badgeColor: '#8b5cf6',
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite',
    source: 'antigravity',
    name: 'Gemini 2.5 Flash-Lite',
    agentLabel: '💡 Gemini Flash-Lite',
    provider: 'Google',
    maxContext: 1000000,
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
    cachePerMillion: 0.01875,
    badgeColor: '#06b6d4',
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
  'o3-mini': {
    id: 'o3-mini',
    source: 'openai',
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
  public activeModel: ModelPricing = ALL_PRICING_MODELS['gemini-2.5-pro'];
  public detectedModels: Map<string, ModelUsageRecord> = new Map();

  public totalContextTokens = 0;
  public totalInputTokens = 0;
  public totalOutputTokens = 0;
  public totalCachedTokens = 0;
  public totalCostUSD = 0.0;
  public activeSource = 'antigravity';

  public onUpdate?: (state: TokenomicsState) => void;

  constructor() {
    this.registerModelUsage(this.activeModel.id);
  }

  private registerModelUsage(modelId: string): ModelUsageRecord {
    let rec = this.detectedModels.get(modelId);
    if (!rec) {
      const model = ALL_PRICING_MODELS[modelId] || ALL_PRICING_MODELS['gemini-2.5-pro'];
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
    let primaryModelId = 'gemini-2.5-pro';

    if (normalized.includes('claude')) {
      primaryModelId = 'claude-3-7-sonnet';
      this.activeSource = 'claude_code';
    } else if (normalized.includes('copilot')) {
      primaryModelId = 'gpt-4o';
      this.activeSource = 'copilot_cli';
    } else {
      primaryModelId = 'gemini-2.5-pro';
      this.activeSource = 'antigravity';
    }

    this.activeModel = ALL_PRICING_MODELS[primaryModelId];
    this.registerModelUsage(primaryModelId);
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
    // 1. Detect exact model from event payload or session context
    let eventModelId = this.activeModel.id;

    if (evt.payload?.detectedModel && ALL_PRICING_MODELS[evt.payload.detectedModel]) {
      eventModelId = evt.payload.detectedModel;
    } else if (evt.payload?.model) {
      const raw = String(evt.payload.model).toLowerCase();
      if (raw.includes('flash_lite') || raw.includes('flash-lite')) eventModelId = 'gemini-2.5-flash-lite';
      else if (raw.includes('flash')) eventModelId = 'gemini-2.5-flash';
      else if (raw.includes('pro')) eventModelId = 'gemini-2.5-pro';
      else if (raw.includes('3.7') || raw.includes('3-7')) eventModelId = 'claude-3-7-sonnet';
      else if (raw.includes('haiku')) eventModelId = 'claude-3-5-haiku';
      else if (raw.includes('mini') && raw.includes('o3')) eventModelId = 'o3-mini';
      else if (raw.includes('mini')) eventModelId = 'gpt-4o-mini';
    } else if (evt.type === 'subagent.delegate') {
      // Subagents default to lighter fast models (e.g. Flash)
      eventModelId = 'gemini-2.5-flash';
    }

    const rec = this.registerModelUsage(eventModelId);

    // 2. Token Calculation (~3.8 chars per token)
    let payloadChars = 0;
    if (evt.payload) {
      payloadChars = JSON.stringify(evt.payload).length;
    }
    const titleChars = (evt.title || '').length;
    const summaryChars = (evt.summary || '').length;
    const totalChars = payloadChars + titleChars + summaryChars;

    let inTokens = 0;
    let outTokens = 0;
    let cacheTokens = 0;

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
}
