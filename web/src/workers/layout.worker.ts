// Web Worker for offloading DAG layout calculation, physics simulation & hull geometry

export interface WorkerNodeData {
  id: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
}

export interface WorkerLinkData {
  id: string;
  source: string;
  target: string;
}

export interface ComputeLayoutPayload {
  nodes: WorkerNodeData[];
  links: WorkerLinkData[];
  filterMode: string;
}

export interface HullResult {
  type: string;
  title: string;
  color: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface WorkerResponse {
  type: 'LAYOUT_RESULT' | 'PHYSICS_TICK' | 'HULLS_RESULT';
  nodes: WorkerNodeData[];
  hulls?: HullResult[];
  energy?: number;
}

const columnOrder: string[] = ['goal', 'agent', 'file', 'service', 'test_suite', 'checkpoint', 'deliverable'];

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'COMPUTE_SPREAD_LAYOUT') {
    const { nodes, filterMode } = payload as ComputeLayoutPayload;
    const colSpacing = 270;
    const rowSpacing = 76;
    const startX = 80;
    const startY = 120;

    const visibleNodes = filterNodes(nodes, filterMode);

    columnOrder.forEach((colType, colIdx) => {
      const typeNodes = visibleNodes.filter((n) => n.type === colType);
      typeNodes.forEach((node, rowIdx) => {
        node.targetX = startX + colIdx * colSpacing;
        node.targetY = startY + rowIdx * rowSpacing;
      });
    });

    const hulls = computeHulls(visibleNodes);

    self.postMessage({
      type: 'LAYOUT_RESULT',
      nodes: visibleNodes,
      hulls,
    });
  } else if (type === 'SIMULATE_PHYSICS_STEP') {
    const { nodes } = payload as { nodes: WorkerNodeData[]; links?: WorkerLinkData[] };
    let totalEnergy = 0;

    // 1. Move nodes toward targets
    for (const node of nodes) {
      const dx = node.targetX - node.x;
      const dy = node.targetY - node.y;
      node.x += dx * 0.18;
      node.y += dy * 0.18;
      const delta = Math.hypot(dx, dy);
      totalEnergy += delta;
    }

    // 2. Node-to-node collision separation
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];
        if (n1.type === n2.type) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.hypot(dx, dy);
          const minDist = 65;
          if (dist < minDist && dist > 0.1) {
            const overlap = (minDist - dist) * 0.08;
            const nx = dx / dist;
            const ny = dy / dist;
            n2.x += nx * overlap;
            n2.y += ny * overlap;
            n1.x -= nx * overlap;
            n1.y -= ny * overlap;
          }
        }
      }
    }

    const hulls = computeHulls(nodes);

    self.postMessage({
      type: 'PHYSICS_TICK',
      nodes,
      hulls,
      energy: totalEnergy,
    });
  }
};

function filterNodes(nodes: WorkerNodeData[], filterMode: string): WorkerNodeData[] {
  if (filterMode === 'all') return nodes;
  if (filterMode === 'files') {
    return nodes.filter((n) => n.type === 'file' || n.type === 'agent' || n.type === 'goal');
  }
  if (filterMode === 'agents') {
    return nodes.filter((n) => n.type === 'goal' || n.type === 'agent' || n.type === 'checkpoint' || n.type === 'deliverable');
  }
  if (filterMode === 'services') {
    return nodes.filter((n) => n.type === 'service' || n.type === 'agent');
  }
  return nodes;
}

function computeHulls(nodes: WorkerNodeData[]): HullResult[] {
  const defs: { type: string; title: string; color: string }[] = [
    { type: 'goal', title: '🎯 GOAL & PROMPT', color: '#f59e0b' },
    { type: 'agent', title: '👷 AGENTS & SUBAGENTS', color: '#06b6d4' },
    { type: 'file', title: '📁 CODE & ARTIFACT IMPACT', color: '#10b981' },
    { type: 'service', title: '📞 MCP SERVICES & TOOLS', color: '#a855f7' },
    { type: 'test_suite', title: '🧪 TEST VERIFICATION', color: '#38bdf8' },
    { type: 'checkpoint', title: '🛡️ SECURITY CHECKPOINTS', color: '#ef4444' },
    { type: 'deliverable', title: '📦 DELIVERABLES', color: '#14b8a6' },
  ];

  const hulls: HullResult[] = [];

  for (const def of defs) {
    const typeNodes = nodes.filter((n) => n.type === def.type);
    if (typeNodes.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of typeNodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }

    hulls.push({
      type: def.type,
      title: `${def.title} (${typeNodes.length})`,
      color: def.color,
      minX: minX - 16,
      minY: minY - 28,
      maxX: maxX + 16,
      maxY: maxY + 16,
    });
  }

  return hulls;
}
