import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VisualizerClient } from './ws';
import type { VisualizerEvent } from '../types';

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public readyState: number = 0; // CONNECTING
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((e: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: ((err: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 10);
  }

  public send = vi.fn();
  public close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
}

describe('VisualizerClient', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should construct with correct URL and disconnected state', () => {
    const client = new VisualizerClient('ws://localhost:9876/ws');
    expect(client.isConnected).toBe(false);
  });

  it('should notify status listeners on open and close', async () => {
    const client = new VisualizerClient('ws://localhost:9876/ws');
    const statusHistory: boolean[] = [];

    client.onStatus((connected) => {
      statusHistory.push(connected);
    });

    client.connect();

    await new Promise((r) => setTimeout(r, 25));
    expect(client.isConnected).toBe(true);

    // Close socket
    MockWebSocket.instances[0].close();
    expect(client.isConnected).toBe(false);
    expect(statusHistory).toContain(true);
    expect(statusHistory).toContain(false);
  });

  it('should parse and dispatch received JSON events to event listeners', async () => {
    const client = new VisualizerClient('ws://localhost:9876/ws');
    const receivedEvents: VisualizerEvent[] = [];

    client.onEvent((evt) => {
      receivedEvents.push(evt);
    });

    client.connect();
    await new Promise((r) => setTimeout(r, 25));

    const testEvt: VisualizerEvent = {
      id: 'e-100',
      sessionId: 'sess-abc',
      timestamp: Date.now(),
      type: 'agent.think',
      agentId: 'alex',
      agentRole: 'foreman',
      title: 'Deep reasoning',
      summary: 'Evaluating next actions',
      payload: {},
    };

    MockWebSocket.instances[0].onmessage?.({
      data: JSON.stringify(testEvt),
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].id).toBe('e-100');
    expect(receivedEvents[0].title).toBe('Deep reasoning');
  });

  it('should unsubscribe listeners correctly', () => {
    const client = new VisualizerClient('ws://localhost:9876/ws');
    const listener = vi.fn();

    const unsubscribe = client.onEvent(listener);
    unsubscribe();

    // Trigger dummy event
    (client as any).notifyEvent({ id: 'test' });
    expect(listener).not.toHaveBeenCalled();
  });
});
