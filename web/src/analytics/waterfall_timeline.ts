import type { VisualizerEvent } from '../types';

export type SpanCategory = 'LLM_INFERENCE' | 'FILE_IO' | 'COMMAND_EXEC' | 'MCP_RPC' | 'INTERVENTION';

export interface TimelineSpan {
  id: string;
  category: SpanCategory;
  title: string;
  target?: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: 'SUCCESS' | 'ERROR' | 'PENDING';
  color: string;
}

export interface WaterfallTelemetry {
  spans: TimelineSpan[];
  totalLlmTimeMs: number;
  totalToolTimeMs: number;
  slowestSpan?: TimelineSpan;
  averageToolDurationMs: number;
}

export class WaterfallTimelineEngine {
  private spans: TimelineSpan[] = [];
  private activePendingSpan: TimelineSpan | null = null;
  private readonly maxSpans: number;

  constructor(maxSpans: number = 30) {
    this.maxSpans = Math.max(10, maxSpans);
  }

  public reset(): void {
    this.spans = [];
    this.activePendingSpan = null;
  }

  public determineCategory(type: string): { category: SpanCategory; color: string } {
    if (type.startsWith('file.')) return { category: 'FILE_IO', color: '#38bdf8' };
    if (type.startsWith('command.')) return { category: 'COMMAND_EXEC', color: '#10b981' };
    if (type.startsWith('mcp.')) return { category: 'MCP_RPC', color: '#a855f7' };
    if (type.startsWith('intervention.') || type.startsWith('checkpoint.')) return { category: 'INTERVENTION', color: '#ef4444' };
    return { category: 'LLM_INFERENCE', color: '#f59e0b' };
  }

  public processEvent(event: VisualizerEvent): WaterfallTelemetry {
    const now = event.timestamp || Date.now();

    // Close any previous pending span if duration was not provided
    if (this.activePendingSpan) {
      this.activePendingSpan.endTime = now;
      this.activePendingSpan.durationMs = Math.max(15, now - this.activePendingSpan.startTime);
      this.activePendingSpan = null;
    }

    const { category, color } = this.determineCategory(event.type);
    const duration = (event.payload?.durationMs as number) || (event.payload?.duration as number) || (category === 'LLM_INFERENCE' ? 650 : 85);
    const isError = event.payload?.error != null || (event.payload?.exitCode != null && event.payload.exitCode !== 0);

    const span: TimelineSpan = {
      id: event.id,
      category,
      title: event.title || event.type,
      target: event.payload?.file || event.payload?.CommandLine || event.payload?.target,
      startTime: now - duration,
      endTime: now,
      durationMs: duration,
      status: isError ? 'ERROR' : 'SUCCESS',
      color,
    };

    this.spans.push(span);
    if (this.spans.length > this.maxSpans) {
      this.spans.shift();
    }

    return this.getTelemetry();
  }

  public getTelemetry(): WaterfallTelemetry {
    let totalLlm = 0;
    let totalTool = 0;
    let toolCount = 0;
    let slowest: TimelineSpan | undefined;

    for (const span of this.spans) {
      if (span.category === 'LLM_INFERENCE') {
        totalLlm += span.durationMs;
      } else {
        totalTool += span.durationMs;
        toolCount++;
      }

      if (!slowest || span.durationMs > slowest.durationMs) {
        slowest = span;
      }
    }

    const averageToolDurationMs = toolCount > 0 ? Math.round(totalTool / toolCount) : 0;

    return {
      spans: [...this.spans],
      totalLlmTimeMs: totalLlm,
      totalToolTimeMs: totalTool,
      slowestSpan: slowest,
      averageToolDurationMs,
    };
  }
}
