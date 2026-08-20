import type { VisualizerEvent, ProcTracerStatus, TargetProcess, ProcSnapshot } from '../types';

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
    // Check if running inside Wails Desktop native shell
    const wailsRuntime = (window as any).runtime;
    if (wailsRuntime && typeof wailsRuntime.EventsOn === 'function') {
      this.isConnected = true;
      this.notifyStatus(true);

      // Subscribe to real-time events streamed from Go backend via Wails IPC
      wailsRuntime.EventsOn('visualizer:event', (event: VisualizerEvent) => {
        this.notifyEvent(event);
      });

      wailsRuntime.EventsOn('visualizer:initial_state', (_state: any) => {
        this.notifyStatus(true);
      });
      return;
    }

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

  public async fetchHistory(sessionId?: string): Promise<VisualizerEvent[]> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.GetSessionHistory === 'function') {
      try {
        const history = await wailsApp.GetSessionHistory(sessionId || '');
        if (history && history.length > 0) return history;
      } catch (err) {
        console.warn('Wails GetSessionHistory error:', err);
      }
    } else if (wailsApp && typeof wailsApp.GetSessionState === 'function') {
      try {
        const state = await wailsApp.GetSessionState(sessionId || 'desktop');
        return state?.events || [];
      } catch (err) {
        console.warn('Wails GetSessionState error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const url = sessionId ? `${host}/api/history?sessionId=${encodeURIComponent(sessionId)}` : `${host}/api/history`;
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch history:', e);
    }
    return [];
  }

  public async attachSession(sessionId: string): Promise<boolean> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.AttachSession === 'function') {
      try {
        await wailsApp.AttachSession(sessionId);
        return true;
      } catch (err) {
        console.warn('Wails AttachSession error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/sessions/attach?id=${encodeURIComponent(sessionId)}`);
      return res.ok;
    } catch (e) {
      console.warn('Failed to attach session:', e);
      return false;
    }
  }

  public async fetchRepoTree(): Promise<any[]> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.ScanRepoTree === 'function') {
      try {
        const tree = await wailsApp.ScanRepoTree('');
        return tree?.children || [];
      } catch (err) {
        console.warn('Wails ScanRepoTree error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/repo-tree`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch repo tree:', e);
    }
    return [];
  }

  public async fetchSessions(): Promise<any[]> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/sessions`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch sessions:', e);
    }
    return [];
  }

  public async fetchEnrichmentUsage(sessionId: string): Promise<any | null> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/enrichment/usage?id=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch enrichment usage:', e);
    }
    return null;
  }

  public async fetchSessionContext(sessionId: string): Promise<any | null> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/enrichment/context?id=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch session context capabilities:', e);
    }
    return null;
  }

  public async fetchSessionState(sessionId: string): Promise<any | null> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/sessions/state?id=${encodeURIComponent(sessionId)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch session state:', e);
    }
    return null;
  }

  public async saveSessionState(state: any): Promise<boolean> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/sessions/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      return res.ok;
    } catch (e) {
      console.warn('Failed to save session state:', e);
      return false;
    }
  }

  public async toggleEmergencyStop(active: boolean, reason?: string): Promise<void> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.TriggerEmergencyStop === 'function') {
      try {
        await wailsApp.TriggerEmergencyStop(reason || (active ? 'User engaged E-Stop' : 'Resumed'));
        return;
      } catch (err) {
        console.warn('Wails TriggerEmergencyStop error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/intervention/emergency-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, reason }),
    });
  }

  public async sendIntercom(sessionId: string, message: string): Promise<void> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.SendIntercomPrompt === 'function') {
      try {
        await wailsApp.SendIntercomPrompt(message);
        return;
      } catch (err) {
        console.warn('Wails SendIntercomPrompt error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/intervention/intercom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    });
  }

  public async respondCheckpoint(checkpointId: string, decision: 'APPROVED' | 'REJECTED' | 'MODIFIED', feedback?: string): Promise<void> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    await fetch(`${host}/api/intervention/checkpoint/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpointId, decision, feedback }),
    });
  }

  public async fetchCheckpoints(): Promise<any[]> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/intervention/checkpoints`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.warn('Failed to fetch checkpoints:', e);
    }
    return [];
  }

  public async fetchTapeList(): Promise<any[]> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.ListTapes === 'function') {
      try {
        return await wailsApp.ListTapes();
      } catch (err) {
        console.warn('Wails ListTapes error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/tape/list`);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to fetch tape list:', e);
    }
    return [];
  }

  public async loadTape(tapeId: string): Promise<any | null> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.LoadTape === 'function') {
      try {
        return await wailsApp.LoadTape(tapeId);
      } catch (err) {
        console.warn('Wails LoadTape error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/tape/load?id=${encodeURIComponent(tapeId)}`);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to load tape:', e);
    }
    return null;
  }

  public async saveTape(): Promise<any | null> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.SaveTape === 'function') {
      try {
        const id = await wailsApp.SaveTape('');
        return { ok: true, id };
      } catch (err) {
        console.warn('Wails SaveTape error:', err);
      }
    }

    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/tape/save`, { method: 'POST' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to save tape:', e);
    }
    return null;
  }

  public async fetchCurrentTape(): Promise<any | null> {
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/tape/current`);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to fetch current tape:', e);
    }
    return null;
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

  public async getProcStatus(): Promise<ProcTracerStatus | null> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.GetProcTracerStatus === 'function') {
      try {
        return await wailsApp.GetProcTracerStatus();
      } catch (err) {
        console.warn('Wails GetProcTracerStatus error:', err);
      }
    }
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/proc/status`);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to fetch proc status:', e);
    }
    return null;
  }

  public async getProcTargets(): Promise<TargetProcess[]> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.GetProcTargets === 'function') {
      try {
        return (await wailsApp.GetProcTargets()) || [];
      } catch (err) {
        console.warn('Wails GetProcTargets error:', err);
      }
    }
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/proc/targets`);
      if (res.ok) return (await res.json()) || [];
    } catch (e) {
      console.warn('Failed to fetch proc targets:', e);
    }
    return [];
  }

  public async attachProcPID(pid: number): Promise<ProcSnapshot | null> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.AttachProcPID === 'function') {
      try {
        return await wailsApp.AttachProcPID(pid);
      } catch (err) {
        console.warn('Wails AttachProcPID error:', err);
      }
    }
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/proc/attach?pid=${pid}`, { method: 'POST' });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to attach proc PID:', e);
    }
    return null;
  }

  public async getProcSnapshot(): Promise<ProcSnapshot | null> {
    const wailsApp = (window as any).go?.main?.App;
    if (wailsApp && typeof wailsApp.GetProcSnapshot === 'function') {
      try {
        return await wailsApp.GetProcSnapshot();
      } catch (err) {
        console.warn('Wails GetProcSnapshot error:', err);
      }
    }
    const host = window.location.port === '5173' ? 'http://localhost:9876' : '';
    try {
      const res = await fetch(`${host}/api/proc/snapshot`);
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn('Failed to fetch proc snapshot:', e);
    }
    return null;
  }
}

