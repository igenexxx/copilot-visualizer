import type { CognitiveTelemetry } from '../analytics/cognitive_classifier';
import type { LoopStatus } from '../analytics/loop_detector';

export class CognitiveHUD {
  private container: HTMLElement;
  private onInterveneClick?: (suggestion?: string) => void;

  constructor(containerId: string = 'cognitive-hud-container') {
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      el.className = 'cognitive-hud';
      const header = document.querySelector('.header');
      if (header) {
        header.appendChild(el);
      } else {
        document.body.prepend(el);
      }
    }
    this.container = el;
    this.renderInitial();
  }

  public setOnIntervene(callback: (suggestion?: string) => void): void {
    this.onInterveneClick = callback;
  }

  private renderInitial(): void {
    this.container.innerHTML = `
      <div class="cog-badge" id="cog-badge" title="Active Cognitive Mode">
        <span class="cog-icon" id="cog-icon">💤</span>
        <span class="cog-label" id="cog-label">IDLE</span>
      </div>
      <div class="cog-apm" id="cog-apm" title="Actions Per Minute">
        <span class="apm-value" id="apm-val">0</span>
        <span class="apm-label">APM</span>
      </div>
      <div class="loop-beacon" id="loop-beacon" style="display: none;">
        <span class="beacon-pulse">🚨</span>
        <span class="beacon-text" id="beacon-text">Loop Detected</span>
        <button class="btn-beacon-intervene" id="btn-beacon-intervene">⚡ Intervene</button>
      </div>
    `;

    const btn = document.getElementById('btn-beacon-intervene');
    if (btn) {
      btn.addEventListener('click', () => {
        const text = document.getElementById('beacon-text')?.getAttribute('data-suggestion') || '';
        if (this.onInterveneClick) {
          this.onInterveneClick(text);
        }
      });
    }
  }

  public update(cog: CognitiveTelemetry, loop: LoopStatus): void {
    const badge = document.getElementById('cog-badge');
    const icon = document.getElementById('cog-icon');
    const label = document.getElementById('cog-label');
    const apmVal = document.getElementById('apm-val');
    const beacon = document.getElementById('loop-beacon');
    const beaconText = document.getElementById('beacon-text');

    if (badge && icon && label) {
      icon.textContent = cog.modeIcon;
      label.textContent = cog.currentMode.replace('_', ' ');
      badge.style.borderColor = cog.modeColor;
      badge.style.boxShadow = `0 0 10px ${cog.modeColor}33`;
    }

    if (apmVal) {
      apmVal.textContent = String(cog.activeActionPerMin);
    }

    if (beacon && beaconText) {
      if (loop.level === 'CRITICAL' || loop.level === 'CAUTION') {
        beacon.style.display = 'inline-flex';
        beacon.className = `loop-beacon beacon-${loop.level.toLowerCase()}`;
        beaconText.textContent = loop.level === 'CRITICAL' ? 'CRITICAL LOOP' : 'LOOP RISK';
        beaconText.setAttribute('data-suggestion', loop.suggestedIntervention || '');
        beacon.title = loop.reason || 'Agent repetitive cycle detected';
      } else {
        beacon.style.display = 'none';
      }
    }
  }
}
