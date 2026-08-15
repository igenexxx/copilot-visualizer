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
  | 'subagent.return';

export type AgentRole = 'foreman' | 'crafter' | 'inspector' | 'tester' | 'operator';

export type StationType =
  | 'foreman_desk'
  | 'filing_vault'
  | 'search_radar'
  | 'cnc_lathe'
  | 'test_furnace'
  | 'phone_booth'
  | 'conveyor';

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

export interface WorkerAgent {
  id: string;
  role: AgentRole;
  name: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  currentStation?: StationType;
  state: 'idle' | 'walking' | 'working' | 'thinking' | 'on_phone';
  activeEvent?: VisualizerEvent;
  color: string;
  speechBubble?: {
    text: string;
    expiresAt: number;
  };
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
}
