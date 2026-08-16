export function getProviderIcon(source: string, size: number = 18): string {
  const norm = (source || '').toLowerCase();

  if (norm.includes('copilot')) {
    // GitHub Copilot SVG
    return `<svg class="provider-svg icon-copilot" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.53 1.03 1.53 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" fill="#38bdf8"/>
      <circle cx="9" cy="11.5" r="1.5" fill="#0f172a"/>
      <circle cx="15" cy="11.5" r="1.5" fill="#0f172a"/>
    </svg>`;
  }

  if (norm.includes('claude')) {
    // Anthropic Claude SVG (Starburst)
    return `<svg class="provider-svg icon-claude" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2.5L13.8 8.8L20.1 7L15.3 11.5L21.5 13.5L15.5 15.8L18.5 21.5L12.8 17.5L10.5 23L8.5 17L3 20L5.8 14.5L0.5 13L6.5 10.8L2.5 5.5L8.5 8L12 2.5Z" fill="#d97706"/>
    </svg>`;
  }

  if (norm.includes('antigravity') || norm.includes('gemini')) {
    // Google Gemini 4-pointed Sparkle SVG with gradient
    return `<svg class="provider-svg icon-gemini" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 1.5C12 7.29899 7.29899 12 1.5 12C7.29899 12 12 16.701 12 22.5C12 16.701 16.701 12 22.5 12C16.701 12 12 7.29899 12 1.5Z" fill="url(#gemini-sparkle-grad)"/>
      <defs>
        <linearGradient id="gemini-sparkle-grad" x1="1.5" y1="1.5" x2="22.5" y2="22.5" gradientUnits="userSpaceOnUse">
          <stop stop-color="#38bdf8"/>
          <stop offset="0.5" stop-color="#818cf8"/>
          <stop offset="1" stop-color="#c084fc"/>
        </linearGradient>
      </defs>
    </svg>`;
  }

  // Generic / Terminal Agent
  return `<svg class="provider-svg icon-generic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" rx="3" stroke="#94a3b8" stroke-width="2"/>
    <path d="M7 9L10 12L7 15M12 15H16" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function getProviderLabel(source: string): string {
  const norm = (source || '').toLowerCase();
  if (norm.includes('copilot')) return 'GitHub Copilot CLI';
  if (norm.includes('claude')) return 'Anthropic Claude Code';
  if (norm.includes('antigravity') || norm.includes('gemini')) return 'Google Gemini (Antigravity)';
  return 'AI Agent Session';
}

export function getProviderColor(source: string): string {
  const norm = (source || '').toLowerCase();
  if (norm.includes('copilot')) return '#38bdf8';
  if (norm.includes('claude')) return '#d97706';
  if (norm.includes('antigravity') || norm.includes('gemini')) return '#818cf8';
  return '#94a3b8';
}
