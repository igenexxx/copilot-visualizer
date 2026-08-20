import type { RPGSkill, RPGStats, VisualizerEvent } from '../types';

export class RPGEngine {
  public dailyTokenBudget: number = 1000000;
  public tokensBurnedToday: number = 0;
  public thermalDamageTokens: number = 0;

  public stats: RPGStats = {
    level: 1,
    title: 'Junior Code Crafter',
    hp: 1000000,
    maxHp: 1000000,
    mp: 200000,
    maxMp: 200000,
    xp: 0,
    nextLevelXp: 300,
    totalTokensBurned: 0,
    spellsCast: 0,
  };

  constructor() {
    this.loadDailyBudget();
  }

  public loadDailyBudget(): void {
    try {
      const saved = localStorage.getItem('copilot_daily_token_budget');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0) {
          this.dailyTokenBudget = parsed;
        }
      }
    } catch (_) {}
    this.stats.maxHp = this.dailyTokenBudget;
    this.recalculateHp();
  }

  public setDailyTokenBudget(budgetTokens: number): void {
    this.dailyTokenBudget = Math.max(10000, budgetTokens);
    this.stats.maxHp = this.dailyTokenBudget;
    try {
      localStorage.setItem('copilot_daily_token_budget', String(this.dailyTokenBudget));
    } catch (_) {}
    this.recalculateHp();
    if (this.onStatsChanged) {
      this.onStatsChanged(this.stats);
    }
  }

  public recalculateHp(): void {
    const totalConsumed = this.tokensBurnedToday + this.thermalDamageTokens;
    this.stats.hp = Math.max(0, this.stats.maxHp - totalConsumed);
  }

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
  public applyOverheatDamage(overheatedStationsCount: number = 1, customDamage?: number): number {
    if (overheatedStationsCount <= 0) return 0;
    const damageTokens = customDamage ? customDamage * 1000 : (overheatedStationsCount * 4500);
    this.thermalDamageTokens += damageTokens;
    this.recalculateHp();
    if (this.onStatsChanged) {
      this.onStatsChanged(this.stats);
    }
    return Math.round(damageTokens / 1000);
  }

  public processEvent(
    evt: VisualizerEvent,
    isHistory: boolean = false,
    isOverheated: boolean = false
  ): { skillId?: string; xpGained: number; manaSpent: number } {
    return this.handleEvent(evt, isHistory, isOverheated);
  }

  public handleEvent(
    evt: VisualizerEvent,
    isHistory: boolean = false,
    isOverheated: boolean = false
  ): { skillId?: string; xpGained: number; manaSpent: number } {
    if (
      evt.agentId === 'proctracer' ||
      evt.type === 'os.telemetry' ||
      evt.payload?.proctracer_snapshot
    ) {
      return { xpGained: 0, manaSpent: 0 };
    }

    let triggeredSkillId: string | undefined;
    let xpGain = 15;
    let manaCost = 400;

    // Apply immediate thermal stress damage if workstation was already overheating
    if (isOverheated) {
      this.thermalDamageTokens += 8000;
      this.recalculateHp();
    }

    if (evt.type === 'file.write') {
      triggeredSkillId = 'skill-forge';
      xpGain = 60;
      manaCost = 850;
    } else if (evt.type === 'file.read' || evt.type.includes('search')) {
      triggeredSkillId = 'skill-radar';
      xpGain = 30;
      manaCost = 350;
    } else if (evt.type === 'command.run' || evt.type === 'command.output') {
      triggeredSkillId = 'skill-laser';
      xpGain = 90;
      manaCost = 1200;
      // Recover HP on successful tests (if not under critical overheat)
      if (!isOverheated) {
        this.thermalDamageTokens = Math.max(0, this.thermalDamageTokens - 5000);
        this.recalculateHp();
      }
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

    // Trigger skill highlight and cooldown animation (LIVE ONLY)
    if (triggeredSkillId && !isHistory) {
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
    // Token consumption reduces daily budget (HP)
    this.tokensBurnedToday += manaCost;
    this.recalculateHp();
    this.addExperience(xpGain, isHistory);

    if (this.onStatsChanged) {
      this.onStatsChanged(this.stats);
    }

    return { skillId: triggeredSkillId, xpGained: xpGain, manaSpent: manaCost };
  }

  public addExperience(amount: number, isHistory: boolean = false): void {
    this.stats.xp += amount;
    while (this.stats.xp >= this.stats.nextLevelXp) {
      this.levelUp(isHistory);
    }
  }

  private levelUp(isHistory: boolean = false): void {
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

    if (this.onLevelUp && !isHistory) {
      this.onLevelUp(this.stats.level, this.stats.title);
    }
  }

  public exportState(): any {
    return {
      level: this.stats.level,
      title: this.stats.title,
      exp: this.stats.xp,
      xp: this.stats.xp,
      nextLevelExp: this.stats.nextLevelXp,
      nextLevelXp: this.stats.nextLevelXp,
      hp: this.stats.hp,
      maxHp: this.stats.maxHp,
      mp: this.stats.mp,
      maxMp: this.stats.maxMp,
      totalTokensBurned: this.stats.totalTokensBurned,
      spellsCast: this.stats.spellsCast,
      stats: { ...this.stats },
      unlockedSkills: this.skills.filter(s => s.active).map(s => s.id),
    };
  }

  public loadState(data: any): void {
    if (!data) return;
    const s = data.stats || data;
    if (typeof s.level === 'number') this.stats.level = s.level;
    if (typeof s.title === 'string') this.stats.title = s.title;
    if (typeof s.exp === 'number') this.stats.xp = s.exp;
    if (typeof s.xp === 'number') this.stats.xp = s.xp;
    if (typeof s.nextLevelExp === 'number') this.stats.nextLevelXp = s.nextLevelExp;
    if (typeof s.nextLevelXp === 'number') this.stats.nextLevelXp = s.nextLevelXp;
    if (typeof s.hp === 'number') this.stats.hp = s.hp;
    if (typeof s.maxHp === 'number') this.stats.maxHp = s.maxHp;
    if (typeof s.mp === 'number') this.stats.mp = s.mp;
    if (typeof s.maxMp === 'number') this.stats.maxMp = s.maxMp;
    if (typeof s.totalTokensBurned === 'number') this.stats.totalTokensBurned = s.totalTokensBurned;
    if (typeof s.spellsCast === 'number') this.stats.spellsCast = s.spellsCast;
  }
}
