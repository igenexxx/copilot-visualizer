import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProcTelemetryPanel } from './proc_telemetry';
import type { VisualizerClient } from '../services/ws';
import type { ProcSnapshot, ProcTracerStatus, TargetProcess } from '../types';

describe('ProcTelemetryPanel', () => {
  let mockClient: Partial<VisualizerClient>;
  let panel: ProcTelemetryPanel;

  beforeEach(() => {
    document.body.innerHTML = '<div class="header-right"></div>';
    mockClient = {
      getProcStatus: vi.fn().mockResolvedValue({
        supported: true,
        attached: true,
        target_pid: 1234,
        target_kind: 'antigravity',
        target_name: 'antigravity',
      } as ProcTracerStatus),
      getProcSnapshot: vi.fn().mockResolvedValue(null),
      getProcTargets: vi.fn().mockResolvedValue([]),
      attachProcPID: vi.fn().mockResolvedValue(null),
    };
    panel = new ProcTelemetryPanel(mockClient as VisualizerClient);
  });

  afterEach(() => {
    panel.close();
    document.body.innerHTML = '';
  });

  it('renders badge and initial markup', () => {
    const badge = document.getElementById('btn-proc-telemetry-badge');
    expect(badge).toBeTruthy();
    const modal = document.getElementById('proc-telemetry-modal');
    expect(modal).toBeTruthy();
    expect(modal?.style.display).toBe('none');
  });

  it('opens and closes modal on toggle and close button', () => {
    panel.open();
    expect(panel.isOpen).toBe(true);
    const modal = document.getElementById('proc-telemetry-modal');
    expect(modal?.style.display).toBe('flex');

    panel.close();
    expect(panel.isOpen).toBe(false);
    expect(modal?.style.display).toBe('none');

    panel.toggleModal();
    expect(panel.isOpen).toBe(true);
  });

  it('closes on Escape key press', () => {
    panel.open();
    expect(panel.isOpen).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.isOpen).toBe(false);
  });

  it('updates status for supported attached environment', () => {
    const status: ProcTracerStatus = {
      supported: true,
      attached: true,
      target_pid: 5678,
      target_kind: 'copilot',
      target_name: 'copilot-cli',
      snapshot: {
        supported: true,
        target: {
          pid: 5678,
          ppid: 1,
          kind: 'copilot',
          name: 'copilot-cli',
          executable: '/bin/copilot',
          command_line: ['copilot', '--model', 'gpt-4o'],
          cwd: '/workspace',
          model: 'gpt-4o',
          user: 'zhenya',
          start_time: new Date().toISOString(),
          state: 'Running',
        },
        metrics: {
          timestamp: new Date().toISOString(),
          cpu_percent: 3.5,
          rss_bytes: 100 * 1024 * 1024,
          vms_bytes: 200 * 1024 * 1024,
          peak_rss_bytes: 120 * 1024 * 1024,
          read_bytes_sec: 1024,
          write_bytes_sec: 2048,
          read_syscalls_sec: 10,
          write_syscalls_sec: 20,
          total_read_bytes: 5000,
          total_write_bytes: 10000,
          fd_count: 32,
          thread_count: 6,
          child_count: 1,
        },
        children: [
          {
            pid: 5679,
            ppid: 5678,
            name: 'bash',
            cmdline: 'bash -c git status',
            state: 'Running',
            rss_bytes: 10 * 1024 * 1024,
            cpu_percent: 0,
            start_time: new Date().toISOString(),
          },
        ],
        connections: [
          {
            local_addr: '127.0.0.1:45000',
            remote_addr: '140.82.112.21:443',
            remote_host: 'api.githubcopilot.com',
            remote_port: 443,
            protocol: 'TCP',
            state: 'ESTABLISHED',
            service_category: 'GitHub Copilot API',
            tx_queue: 0,
            rx_queue: 0,
          },
        ],
        recent_events: [
          {
            timestamp: new Date().toISOString(),
            kind: 'SPAWN',
            severity: 'ACTION',
            source: 'procfs',
            summary: 'Spawned subprocess: bash',
          },
        ],
        timestamp: new Date().toISOString(),
      },
    };

    panel.updateStatus(status);
    const badgeText = document.getElementById('proc-badge-text');
    expect(badgeText?.textContent).toContain('5678');
  });

  it('updates status for unsupported (non-Linux) environment', () => {
    panel.updateStatus({
      supported: false,
      attached: false,
      target_pid: 0,
      target_kind: '',
      target_name: '',
    });

    const badgeText = document.getElementById('proc-badge-text');
    expect(badgeText?.textContent).toContain('N/A (Non-Linux)');
  });

  it('renders overview, children, network, and event tabs when open', () => {
    panel.open();

    const snap: ProcSnapshot = {
      supported: true,
      target: {
        pid: 1000,
        ppid: 1,
        kind: 'antigravity',
        name: 'antigravity',
        executable: '/usr/bin/antigravity',
        command_line: ['antigravity'],
        cwd: '/repo',
        model: 'gemini-3.7-flash',
        user: 'zhenya',
        start_time: new Date().toISOString(),
        state: 'Running',
      },
      metrics: {
        timestamp: new Date().toISOString(),
        cpu_percent: 12.4,
        rss_bytes: 64 * 1024 * 1024,
        vms_bytes: 128 * 1024 * 1024,
        peak_rss_bytes: 80 * 1024 * 1024,
        read_bytes_sec: 500000,
        write_bytes_sec: 250000,
        read_syscalls_sec: 50,
        write_syscalls_sec: 25,
        total_read_bytes: 1000000,
        total_write_bytes: 500000,
        fd_count: 24,
        thread_count: 8,
        child_count: 1,
      },
      children: [
        {
          pid: 1001,
          ppid: 1000,
          name: 'go',
          cmdline: 'go test ./...',
          state: 'Running',
          rss_bytes: 32 * 1024 * 1024,
          cpu_percent: 5,
          start_time: new Date().toISOString(),
        },
      ],
      connections: [
        {
          local_addr: '127.0.0.1:51234',
          remote_addr: '142.250.180.10:443',
          remote_host: 'generativelanguage.googleapis.com',
          remote_port: 443,
          protocol: 'TCP',
          state: 'ESTABLISHED',
          service_category: 'Google Gemini API',
          tx_queue: 0,
          rx_queue: 0,
        },
      ],
      recent_events: [
        {
          timestamp: new Date().toISOString(),
          kind: 'NET_CONN',
          severity: 'SUCCESS',
          source: 'net',
          summary: 'Connected to Google Gemini API',
        },
      ],
      timestamp: new Date().toISOString(),
    };

    panel.updateSnapshot(snap);
    const body = document.getElementById('proc-modal-body');
    expect(body?.innerHTML).toContain('gemini-3.7-flash');
    expect(body?.innerHTML).toContain('12.4%');

    // Switch to children tab
    const tabChildren = document.querySelector('[data-tab="children"]') as HTMLElement;
    tabChildren?.click();
    expect(body?.innerHTML).toContain('go test ./...');

    // Switch to network tab
    const tabNet = document.querySelector('[data-tab="network"]') as HTMLElement;
    tabNet?.click();
    expect(body?.innerHTML).toContain('Google Gemini API');

    // Switch to events tab
    const tabEvents = document.querySelector('[data-tab="events"]') as HTMLElement;
    tabEvents?.click();
    expect(body?.innerHTML).toContain('Connected to Google Gemini API');
  });

  it('attaches to target PID via select and input', async () => {
    const targets: TargetProcess[] = [
      {
        pid: 2000,
        ppid: 1,
        kind: 'claude',
        name: 'claude-code',
        executable: '/bin/claude',
        command_line: ['claude'],
        cwd: '/home',
        model: 'sonnet',
        user: 'zhenya',
        start_time: new Date().toISOString(),
        state: 'Running',
      },
    ];

    panel.updateStatus({
      supported: true,
      attached: true,
      target_pid: 1000,
      target_kind: 'antigravity',
      target_name: 'antigravity',
      targets_list: targets,
    });

    const select = document.getElementById('proc-target-select') as HTMLSelectElement;
    expect(select.options.length).toBe(1);

    select.value = '2000';
    select.dispatchEvent(new Event('change'));
    expect(mockClient.attachProcPID).toHaveBeenCalledWith(2000);
  });
});
