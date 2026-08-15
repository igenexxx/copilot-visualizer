import type { VisualizerEvent } from '../types';

export interface ModelPricing {
  id: string;
  source: 'antigravity' | 'claude_code' | 'copilot_cli' | 'generic';
  name: string;
  agentLabel: string;
  maxContext: number;
  inputPerMillion: number;
  outputPerMillion: number;
  cachePerMillion: number;
  badgeColor: string;
}

export const PRICING_MODELS: Record<string, ModelPricing> = {
  antigravity: {
    id: 'antigravity',
    source: 'antigravity',
    name: 'Gemini 2.5 Pro (Antigravity)',
    agentLabel: '🔮 Google Antigravity Agent',
    maxContext: 2000000,
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachePerMillion: 0.31,
    badgeColor: '#a855f7',
  },
  claude_code: {
    id: 'claude_code',
    source: 'claude_code',
    name: 'Claude 3.7 Sonnet (Claude Code)',
    agentLabel: '🤖 Anthropic Claude Code',
    maxContext: 200000,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachePerMillion: 0.3,
    badgeColor: '#f97316',
  },
  copilot_cli: {
    id: 'copilot_cli',
    source: 'copilot_cli',
    name: 'GPT-4o (GitHub Copilot)',
    agentLabel: '🐙 GitHub Copilot CLI',
    maxContext: 128000,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachePerMillion: 1.25,
    badgeColor: '#06b6d4',
  },
  generic: {
    id: 'generic',
    source: 'generic',
    name: 'Claude 3.5 Sonnet',
    agentLabel: '⚡ AI Coding Agent',
    maxContext: 200000,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachePerMillion: 0.3,
    badgeColor: '#3b82f6',
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
  agentSource: string;
}

export class TokenomicsTracker {
  public model: ModelPricing = PRICING_MODELS.antigravity;

  public contextTokens = 0;
  public inputTokens = 0;
  public outputTokens = 0;
  public cachedTokens = 0;
  public totalCostUSD = 0.0;
  public activeSource = 'antigravity';

  public onUpdate?: (state: TokenomicsState) => void;

  public setSource(source: string): void {
    const normalized = source.toLowerCase();
    let selected: ModelPricing = PRICING_MODELS.generic;

    if (normalized.includes('antigravity') || normalized.includes('gemini')) {
      selected = PRICING_MODELS.antigravity;
    } else if (normalized.includes('claude')) {
      selected = PRICING_MODELS.claude_code;
    } else if (normalized.includes('copilot')) {
      selected = PRICING_MODELS.copilot_cli;
    }

    this.activeSource = selected.source;
    this.model = selected;
    this.recompute();
  }

  public setModel(modelId: string): void {
    if (PRICING_MODELS[modelId]) {
      this.model = PRICING_MODELS[modelId];
      this.activeSource = this.model.source;
      this.recompute();
    }
  }

  /**
   * Calculates accurate token consumption based on actual event payload character lengths.
   * Standard LLM heuristic: ~3.8 characters per token.
   */
  public handleEvent(evt: VisualizerEvent): void {
    // Auto-detect agent source from event sessionId or payload
    if (evt.sessionId) {
      const lower = evt.sessionId.toLowerCase();
      if (lower.includes('antigravity') || lower.includes('gemini') || evt.agentRole === 'foreman') {
        if (this.activeSource !== 'antigravity' && !lower.includes('claude') && !lower.includes('copilot')) {
          this.setSource('antigravity');
        }
      } else if (lower.includes('claude')) {
        this.setSource('claude_code');
      } else if (lower.includes('copilot')) {
        this.setSource('copilot_cli');
      }
    }

    let payloadChars = 0;
    if (evt.payload) {
      payloadChars = JSON.stringify(evt.payload).length;
    }
    const titleChars = (evt.title || '').length;
    const summaryChars = (evt.summary || '').length;
    const totalChars = payloadChars + titleChars + summaryChars;

    // Accurate token conversion (~3.8 chars/token)
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

    this.inputTokens += inTokens;
    this.outputTokens += outTokens;
    this.cachedTokens += cacheTokens;

    // Context depth builds as conversation history grows
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
      agentSource: this.activeSource,
    };
  }
}
