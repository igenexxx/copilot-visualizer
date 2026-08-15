import type { VisualizerEvent } from '../types';

export type EventListener = (event: VisualizerEvent) => void;
export type StatusListener = (connected: boolean) => void;

export class VisualizerClient {
  private ws: WebSocket | null = null;
  private eventListeners: Set<EventListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private reconnectTimer: number | null = null;
  private url: string;
  public isConnected: boolean = false;

  constructor(url?: string) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.port === '5173' ? 'localhost:9876' : window.location.host;
    this.url = url || `${protocol}//${host}/ws`;
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.notifyStatus(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (e) => {
        try {
          const event: VisualizerEvent = JSON.parse(e.data);
          this.notifyEvent(event);
        } catch (err) {
          console.error('Failed to parse WebSocket event:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.notifyStatus(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('WebSocket connection error:', err);
        this.ws?.close();
      };
    } catch (err) {
      this.isConnected = false;
      this.notifyStatus(false);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectTimer) {
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 2000);
    }
  }

  public onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.isConnected);
    return () => this.statusListeners.delete(listener);
  }

  private notifyEvent(event: VisualizerEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }

  private notifyStatus(connected: boolean): void {
    this.statusListeners.forEach((l) => l(connected));
  }

  public async fetchHistory(): Promise<VisualizerEvent[]> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/history`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch history:', e);
    }
    return [];
  }

  public async startSimulator(loop: boolean = true): Promise<void> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/simulator/start?loop=${loop}`, { method: 'POST' });
  }

  public async stopSimulator(): Promise<void> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/simulator/stop`, { method: 'POST' });
  }

  public async setSimulatorSpeed(multiplier: number): Promise<void> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/simulator/speed?multiplier=${multiplier}`, { method: 'POST' });
  }

  public async ingestEvent(event: Partial<VisualizerEvent>): Promise<void> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
  }
}
