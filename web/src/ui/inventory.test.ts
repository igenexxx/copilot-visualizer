import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryModal, type SessionContextData } from './inventory';

describe('InventoryModal Component', () => {
  let modal: InventoryModal;

  const mockContext: SessionContextData = {
    sessionId: 'sess-test-1234567890',
    provider: 'antigravity',
    skills: [
      {
        id: 'angular-developer',
        name: 'angular-developer',
        description: 'Generates Angular code and architectural guidance',
        path: '/path/to/angular-developer/SKILL.md',
        icon: '🅰️',
        category: 'frontend',
        active: true,
        activationsCount: 2,
        lastUsed: Date.now(),
      },
      {
        id: 'adk-go-coder',
        name: 'adk-go-coder',
        description: 'Comprehensive guide for building agents in Go',
        path: '/path/to/adk-go-coder/SKILL.md',
        icon: '🐹',
        category: 'backend',
        active: false,
      },
    ],
    mcpServers: [
      {
        id: 'chrome-devtools-mcp',
        name: 'chrome-devtools-mcp',
        toolsCount: 16,
        tools: ['navigate_page', 'take_screenshot', 'click'],
        icon: '🌐',
        active: true,
        callsCount: 4,
      },
    ],
    rules: [
      {
        id: 'engineering_guidelines',
        title: 'Engineering Guidelines',
        content: 'SOLID, DRY, KISS, YAGNI. 90%+ test coverage.',
        type: 'memory',
        icon: '🧠',
      },
    ],
    slashCommands: [
      {
        name: '/plan',
        description: 'Step-by-step implementation plan',
        icon: '📋',
      },
    ],
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    modal = new InventoryModal();
  });

  it('should initialize modal DOM structure with tabs and badges', () => {
    const overlay = document.getElementById('inventory-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.style.display).toBe('none');

    const tabs = document.querySelectorAll('.inv-tab-btn');
    expect(tabs.length).toBe(4);
  });

  it('should populate context data and update counts', () => {
    modal.setContext(mockContext);

    const countSkills = document.getElementById('inv-count-skills');
    const countMcp = document.getElementById('inv-count-mcp');
    const countRules = document.getElementById('inv-count-rules');
    const countCommands = document.getElementById('inv-count-commands');

    expect(countSkills?.textContent).toBe('2');
    expect(countMcp?.textContent).toBe('1');
    expect(countRules?.textContent).toBe('1');
    expect(countCommands?.textContent).toBe('1');
  });

  it('should open, close, and toggle visibility', () => {
    const overlay = document.getElementById('inventory-modal-overlay');
    expect(overlay?.style.display).toBe('none');

    modal.open();
    expect(overlay?.style.display).toBe('flex');

    modal.close();
    expect(overlay?.style.display).toBe('none');

    modal.toggle();
    expect(overlay?.style.display).toBe('flex');
  });

  it('should render skills item slots with active badge and icons', () => {
    modal.setContext(mockContext);
    modal.open();

    const slots = document.querySelectorAll('.inv-slot');
    expect(slots.length).toBe(2);

    const activeBadge = document.querySelector('.inv-slot-badge.live');
    expect(activeBadge).not.toBeNull();
    expect(activeBadge?.textContent).toBe('ACTIVE');

    const detailsName = document.querySelector('.inv-card-name');
    expect(detailsName?.textContent).toBe('angular-developer');
  });

  it('should display active skill HUD banner when triggered', () => {
    modal.showActiveSkillBanner('home-server', '🖥️', 'Deploying microservices');

    const banner = document.getElementById('hud-active-skill-banner');
    expect(banner).not.toBeNull();
    expect(banner?.style.display).toBe('flex');
    expect(banner?.textContent).toContain('home-server');
    expect(banner?.textContent).toContain('Deploying microservices');
  });
});
