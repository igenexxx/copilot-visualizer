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
  type: EventType;
  agentId: string;
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
