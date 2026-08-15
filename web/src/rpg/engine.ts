import type { RPGSkill, RPGStats, VisualizerEvent } from '../types';

export class RPGEngine {
  public stats: RPGStats = {
    level: 1,
    title: 'Junior Code Crafter',
    hp: 100,
    maxHp: 100,
    mp: 200000,
    maxMp: 200000,
    xp: 0,
    nextLevelXp: 300,
    totalTokensBurned: 0,
    spellsCast: 0,
  };

  public skills: RPGSkill[] = [
    // Class Skills (Tools)
    {
      id: 'skill-forge',
      name: 'Code Forge',
      category: 'skill',
      icon: '⚡',
      keybind: '1',
      description: 'Forges and edits source code blocks (replace_file_content)',
      manaCost: 850,
      cooldownMs: 800,
      lastUsed: 0,
      active: false,
    },
    {
      id: 'skill-radar',
      name: 'Search Radar',
      category: 'skill',
      icon: '🔍',
      keybind: '2',
      description: 'Scans codebase symbols & file indexes (grep / view_file)',
      manaCost: 350,
      cooldownMs: 600,
      lastUsed: 0,
      active: false,
    },
    {
      id: 'skill-furnace',
      name: 'Test Crucible',
      category: 'skill',
      icon: '🧪',
      keybind: '3',
      description: 'Executes build pipelines & adversarial test suites (run_command)',
      manaCost: 1200,
      cooldownMs: 1200,
      lastUsed: 0,
      active: false,
    },
    {
      id: 'skill-barrier',
      name: 'Safety Barrier',
      category: 'skill',
      icon: '🛡️',
      keybind: '4',
      description: 'Guards against risky shell commands & prompts developer',
      manaCost: 500,
      cooldownMs: 1500,
      lastUsed: 0,
      active: false,
    },

    // MCP Spells
    {
      id: 'mcp-github',
      name: 'GitHub MCP',
      category: 'mcp',
      icon: '🐙',
      keybind: 'Q',
      description: 'Bridges to GitHub API: PR reviews, commits, branch management',
      manaCost: 1500,
      cooldownMs: 1000,
      lastUsed: 0,
      active: false,
    },
    {
      id: 'mcp-gopls',
      name: 'Gopls MCP',
      category: 'mcp',
      icon: '📐',
      keybind: 'W',
      description: 'Go Language Server Protocol: diagnostics, references, rename',
      manaCost: 900,
      cooldownMs: 800,
      lastUsed: 0,
      active: false,
    },
    {
      id: 'mcp-web',
      name: 'Web MCP',
      category: 'mcp',
      icon: '🌐',
      keybind: 'E',
      description: 'Live internet crawler & Google search documentation retrieval',
      manaCost: 1800,
      cooldownMs: 1500,
      lastUsed: 0,
      active: false,
    },
    {
      id: 'mcp-intercom',
      name: 'Intercom Call',
      category: 'mcp',
      icon: '📻',
      keybind: 'R',
      description: 'Direct frequency channel with Human Foreman',
      manaCost: 400,
      cooldownMs: 1000,
      lastUsed: 0,
      active: false,
    },
  ];

  public onLevelUp?: (newLevel: number, title: string) => void;
  public onStatsChanged?: (stats: RPGStats) => void;

  public handleEvent(evt: VisualizerEvent): { skillId?: string; xpGained: number; manaSpent: number } {
    let triggeredSkillId: string | undefined;
    let xpGain = 15;
    let manaCost = 400;

    if (evt.type === 'file.write') {
      triggeredSkillId = 'skill-forge';
      xpGain = 60;
      manaCost = 850;
    } else if (evt.type === 'file.read' || evt.type.includes('search')) {
      triggeredSkillId = 'skill-radar';
      xpGain = 25;
      manaCost = 350;
    } else if (evt.type === 'command.run' || evt.type === 'command.output') {
      triggeredSkillId = 'skill-furnace';
      xpGain = 90;
      manaCost = 1200;
      // Recover HP on successful tests
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + 5);
    } else if (evt.type === 'checkpoint.request' || evt.type === 'checkpoint.decision') {
      triggeredSkillId = 'skill-barrier';
      xpGain = 120;
      manaCost = 500;
    } else if (evt.type === 'mcp.call' || evt.type === 'mcp.response') {
      const server = (evt.payload?.server || evt.title || '').toLowerCase();
      if (server.includes('github')) triggeredSkillId = 'mcp-github';
      else if (server.includes('gopls')) triggeredSkillId = 'mcp-gopls';
      else if (server.includes('web') || server.includes('search')) triggeredSkillId = 'mcp-web';
      else triggeredSkillId = 'mcp-intercom';

      xpGain = 80;
      manaCost = 1500;
    } else if (evt.type === 'intervention.prompt') {
      triggeredSkillId = 'mcp-intercom';
      xpGain = 50;
      manaCost = 400;
    }

    // Trigger skill highlight and cooldown animation
    if (triggeredSkillId) {
      const skill = this.skills.find((s) => s.id === triggeredSkillId);
      if (skill) {
        skill.active = true;
        skill.lastUsed = Date.now();
        setTimeout(() => {
          skill.active = false;
        }, 1200);
      }
    }

    // Apply Mana & XP
    this.stats.spellsCast++;
    this.stats.totalTokensBurned += manaCost;
    this.stats.mp = Math.max(0, this.stats.mp - manaCost);
    this.addExperience(xpGain);

    if (this.onStatsChanged) {
      this.onStatsChanged(this.stats);
    }

    return { skillId: triggeredSkillId, xpGained: xpGain, manaSpent: manaCost };
  }

  public addExperience(amount: number): void {
    this.stats.xp += amount;
    while (this.stats.xp >= this.stats.nextLevelXp) {
      this.levelUp();
    }
  }

  private levelUp(): void {
    this.stats.xp -= this.stats.nextLevelXp;
    this.stats.level++;
    // Exponential difficulty curve for higher levels
    this.stats.nextLevelXp = Math.round(350 * Math.pow(this.stats.level, 1.85));
    this.stats.maxHp += 25;
    this.stats.hp = this.stats.maxHp;
    this.stats.maxMp += 75000;
    this.stats.mp = this.stats.maxMp;

    const titles = [
      'Junior Code Crafter',
      'Senior Logic Artisan',
      'Staff Code Architect',
      'Principal Multi-Agent Engineer',
      'Grandmaster AI Synthesizer',
      'Omnipotent Agentic Deity',
    ];
    this.stats.title = titles[Math.min(titles.length - 1, this.stats.level - 1)];

    if (this.onLevelUp) {
      this.onLevelUp(this.stats.level, this.stats.title);
    }
  }
}
