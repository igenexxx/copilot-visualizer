import { describe, it, expect, beforeEach } from 'vitest';
import { RPGEngine } from './engine';
import type { VisualizerEvent } from '../types';

describe('RPGEngine', () => {
  let engine: RPGEngine;

  beforeEach(() => {
    engine = new RPGEngine();
  });

  it('should initialize with default base stats', () => {
    expect(engine.stats.level).toBe(1);
    expect(engine.stats.title).toBe('Junior Code Crafter');
    expect(engine.stats.hp).toBe(100);
    expect(engine.stats.maxHp).toBe(100);
    expect(engine.stats.xp).toBe(0);
    expect(engine.skills.length).toBeGreaterThan(0);
  });

  it('should gain XP and level up when threshold is reached', () => {
    let leveledUp = false;
    let newLevel = 0;
    engine.onLevelUp = (lvl) => {
      leveledUp = true;
      newLevel = lvl;
    };

    // Add 350 XP (threshold for level 2 is 300 XP)
    engine.addExperience(350);

    expect(leveledUp).toBe(true);
    expect(newLevel).toBe(2);
    expect(engine.stats.level).toBe(2);
    expect(engine.stats.title).toBe('Senior Logic Artisan');
    expect(engine.stats.xp).toBe(50);
  });

  it('should unlock skills when casting tools', () => {
    const evt: VisualizerEvent = {
      id: 'e-2',
      sessionId: 's-1',
      timestamp: Date.now(),
      type: 'file.write',
      agentId: 'agent-1',
      agentRole: 'crafter',
      title: 'Write code',
      summary: 'Edit main.go',
      payload: {},
    };

    const res = engine.processEvent(evt);
    expect(res.skillId).toBe('skill-forge');
    expect(res.xpGained).toBe(60);
    expect(res.manaSpent).toBe(850);
  });

  it('should export state and restore correctly', () => {
    engine.stats.level = 5;
    engine.stats.xp = 1200;
    engine.stats.totalTokensBurned = 50000;
    engine.stats.spellsCast = 42;

    const exported = engine.exportState();
    expect(exported.stats.level).toBe(5);

    const freshEngine = new RPGEngine();
    freshEngine.loadState(exported);

    expect(freshEngine.stats.level).toBe(5);
    expect(freshEngine.stats.xp).toBe(1200);
    expect(freshEngine.stats.totalTokensBurned).toBe(50000);
    expect(freshEngine.stats.spellsCast).toBe(42);
  });

  it('should apply overheat damage and prevent HP from going below 0', () => {
    engine.stats.hp = 20;
    const dmg = engine.applyOverheatDamage(2, 6);
    expect(dmg).toBe(6);
    expect(engine.stats.hp).toBe(14);

    engine.applyOverheatDamage(5, 50);
    expect(engine.stats.hp).toBe(0);
  });

  it('should take immediate thermal damage when handling event on an overheated station', () => {
    engine.stats.hp = 100;
    const evt: VisualizerEvent = {
      id: 'e-overheat',
      sessionId: 's-1',
      timestamp: Date.now(),
      type: 'file.write',
      agentId: 'agent-1',
      station: 'cnc_lathe',
      title: 'Write code under fire',
      payload: {},
    };

    engine.handleEvent(evt, false, true);
    expect(engine.stats.hp).toBe(92); // 100 - 8 overheat damage
  });

  it('should handle adversarial / malformed loadState inputs without crashing', () => {
    expect(() => engine.loadState(null as any)).not.toThrow();
    expect(() => engine.loadState(undefined as any)).not.toThrow();
    expect(() => engine.loadState({} as any)).not.toThrow();
    expect(() => engine.loadState({ stats: null, skills: null } as any)).not.toThrow();
  });
});
