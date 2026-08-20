export type EventType =
  | 'session.start'
  | 'session.end'
  | 'agent.spawn'
  | 'agent.state'
  | 'agent.think'
  | 'tool.call'
  | 'tool.result'
  | 'file.read'
  | 'file.write'
  | 'command.run'
  | 'command.output'
  | 'mcp.call'
  | 'mcp.response'
  | 'subagent.delegate'
  | 'subagent.return'
  | 'intervention.prompt'
  | 'checkpoint.request'
  | 'checkpoint.decision'
  | 'emergency.stop';

export type AgentRole = 'foreman' | 'crafter' | 'inspector' | 'tester' | 'operator';

export type StationType =
  | 'foreman_desk'
  | 'filing_vault'
  | 'search_radar'
  | 'cnc_lathe'
  | 'test_furnace'
  | 'phone_booth'
  | 'server_rack'
  | 'subagent_office'
  | 'repo_shelf'
  | 'conveyor'
  | 'security_gate';

export interface RepoFolder {
  name: string;
  relPath: string;
  fileCount: number;
  sizeBytes: number;
  fileTypes: string[];
}

export interface VisualizerEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  type: EventType | (string & {});
  agentId?: string;
  agentRole?: AgentRole;
  station?: StationType;
  title: string;
  summary?: string;
  payload?: Record<string, any>;
}

export interface RPGSkill {
  id: string;
  name: string;
  category: 'skill' | 'mcp';
  icon: string;
  keybind: string;
  description: string;
  manaCost: number;
  cooldownMs: number;
  lastUsed: number;
  active: boolean;
}

export interface RPGStats {
  level: number;
  title: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  xp: number;
  nextLevelXp: number;
  totalTokensBurned: number;
  spellsCast: number;
}

export interface WorkerAgent {
  id: string;
  role: AgentRole;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  currentStation?: StationType;
  state: 'idle' | 'walking' | 'working' | 'thinking' | 'on_phone' | 'stopped';
  activeEvent?: VisualizerEvent;
  color: string;
  speechBubble?: {
    text: string;
    expiresAt: number;
  };
  targetQueue?: { x: number; y: number; station?: StationType; event?: VisualizerEvent }[];
  speedMultiplier?: number;
  rpg?: RPGStats;
}

export interface Workstation {
  type: StationType;
  name: string;
  gridX: number;
  gridY: number;
  color: string;
  description: string;
  active: boolean;
  pulseTime: number;
  lastEvent?: VisualizerEvent;
  itemsCount: number;
  heatLevel: number; // 0..100%
  temperatureC: number; // 24°C..850°C
  wearPct: number; // 0..100%
  totalOperations: number;
  overheating: boolean;
}

export interface CheckpointItem {
  id: string;
  sessionId: string;
  actionType: string;
  description: string;
  payload?: Record<string, any>;
  createdAt: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MODIFIED';
}

// Linux/WSL Process Telemetry Types
export interface TargetProcess {
  pid: number;
  ppid: number;
  kind: 'antigravity' | 'copilot' | 'claude' | 'generic-ai' | string;
  name: string;
  executable: string;
  command_line: string[];
  cwd: string;
  model: string;
  user: string;
  start_time: string;
  state: string;
  env?: Record<string, string>;
  lock_file?: string;
}

export interface ResourceMetrics {
  timestamp: string;
  cpu_percent: number;
  rss_bytes: number;
  vms_bytes: number;
  peak_rss_bytes: number;
  read_bytes_sec: number;
  write_bytes_sec: number;
  read_syscalls_sec: number;
  write_syscalls_sec: number;
  total_read_bytes: number;
  total_write_bytes: number;
  fd_count: number;
  thread_count: number;
  child_count: number;
}

export interface NetworkEndpoint {
  local_addr: string;
  remote_addr: string;
  remote_host: string;
  remote_port: number;
  protocol: string;
  state: string;
  service_category: string;
  tx_queue: number;
  rx_queue: number;
}

export interface SubprocessInfo {
  pid: number;
  ppid: number;
  name: string;
  cmdline: string;
  state: string;
  rss_bytes: number;
  cpu_percent: number;
  start_time: string;
}

export interface TraceEvent {
  timestamp: string;
  kind: 'SPAWN' | 'EXIT' | 'NET_CONN' | 'FILE_IO' | 'AGENT' | 'SYSCALL' | string;
  severity: 'INFO' | 'WARN' | 'SUCCESS' | 'ACTION';
  source: string;
  summary: string;
  details?: string;
}

export interface ProcSnapshot {
  supported: boolean;
  target: TargetProcess;
  metrics: ResourceMetrics;
  children: SubprocessInfo[];
  connections: NetworkEndpoint[];
  recent_events: TraceEvent[];
  timestamp: string;
}

export interface ProcTracerStatus {
  supported: boolean;
  attached: boolean;
  target_pid: number;
  target_kind: string;
  target_name: string;
  snapshot?: ProcSnapshot;
  targets_list?: TargetProcess[];
}
