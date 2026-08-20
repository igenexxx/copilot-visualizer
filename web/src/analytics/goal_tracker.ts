import type { VisualizerEvent } from '../types';

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  timestamp: number;
}

export interface GoalStackTelemetry {
  rootGoal: string;
  activeSubtask: string;
  currentAction: string;
  breadcrumbs: string[];
  checklist: ChecklistItem[];
  completedCount: number;
  totalChecklistCount: number;
}

export class GoalTrackerEngine {
  private rootGoal: string = 'General Orchestration';
  private activeSubtask: string = 'Idle';
  private currentAction: string = 'Awaiting events';
  private checklist: ChecklistItem[] = [];

  /**
   * Resets the goal tracker.
   */
  public reset(): void {
    this.rootGoal = 'General Orchestration';
    this.activeSubtask = 'Idle';
    this.currentAction = 'Awaiting events';
    this.checklist = [];
  }

  /**
   * Extracts checklist items from markdown text.
   */
  public parseChecklist(text: string): ChecklistItem[] {
    if (!text) return [];

    const items: ChecklistItem[] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      const match = line.match(/^[\s*-]*\[([ xX])\]\s+(.+)$/);
      if (match) {
        const isCompleted = match[1].toLowerCase() === 'x';
        const taskText = match[2].trim();
        items.push({
          id: `task-${taskText.slice(0, 24).toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          text: taskText,
          completed: isCompleted,
          timestamp: Date.now(),
        });
      }
    }

    return items;
  }

  /**
   * Ingests a new event into the goal tracking stack.
   */
  public processEvent(event: VisualizerEvent): GoalStackTelemetry {
    if (
      event.agentId === 'proctracer' ||
      event.type === 'os.telemetry' ||
      event.payload?.proctracer_snapshot
    ) {
      return this.getTelemetry();
    }

    // 1. Check for root goal update
    if (event.type === 'session.start' || event.type === 'user.prompt') {
      if (event.title) this.rootGoal = event.title;
      else if (event.summary) this.rootGoal = event.summary;
    }

    // 2. Scrape checklist and subtasks from think events or plans
    if (event.type === 'agent.think' || event.type === 'plan.step') {
      const content = event.summary || event.payload?.content || event.title || '';
      const newItems = this.parseChecklist(content);

      if (newItems.length > 0) {
        // Merge or replace checklist items
        for (const item of newItems) {
          const existing = this.checklist.find((c) => c.text === item.text);
          if (existing) {
            existing.completed = item.completed;
          } else {
            this.checklist.push(item);
          }
        }
      }

      // Infer subtask from thought headline
      if (event.title && !event.title.toLowerCase().startsWith('thinking')) {
        this.activeSubtask = event.title;
      }
    }

    // 3. Update micro-action
    this.currentAction = event.title || event.type;

    // 4. Auto-advance active subtask based on first incomplete checklist item
    const firstIncomplete = this.checklist.find((c) => !c.completed);
    if (firstIncomplete) {
      this.activeSubtask = firstIncomplete.text;
    }

    // 5. Auto-mark checklist item completed on verification pass
    if (event.type === 'command.run' || event.type === 'command.output') {
      const isSuccess = event.payload?.exitCode === 0 || (event.summary && /pass|ok|success/i.test(event.summary));
      if (isSuccess && firstIncomplete && /test|verify|build|check/i.test(firstIncomplete.text)) {
        firstIncomplete.completed = true;
      }
    }

    return this.getTelemetry();
  }

  /**
   * Returns current goal stack telemetry.
   */
  public getTelemetry(): GoalStackTelemetry {
    const completedCount = this.checklist.filter((c) => c.completed).length;

    return {
      rootGoal: this.rootGoal,
      activeSubtask: this.activeSubtask,
      currentAction: this.currentAction,
      breadcrumbs: [this.rootGoal, this.activeSubtask, this.currentAction].filter(Boolean),
      checklist: [...this.checklist],
      completedCount,
      totalChecklistCount: this.checklist.length,
    };
  }
}
