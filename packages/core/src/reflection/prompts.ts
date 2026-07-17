import type { ReflectionType } from './ReflectionEngine.js';

export function getReflectionPrompt(type: ReflectionType, memorySummary: string, stats: { total: number; byType: Record<string, number> }): string {
  const base = `You are analyzing a collection of AI memories. There are ${stats.total} total memories (${Object.entries(stats.byType).map(([k, v]) => `${v} ${k}`).join(', ')}).

Here are the most recent and important memories to analyze:

${memorySummary}`;

  switch (type) {
    case 'pattern':
      return `${base}

TASK: Identify recurring behavioral patterns, habits, or workflows. Look for:
- Activities that repeat at similar times or contexts
- Consistent preferences or approaches
- Recurring topics or themes

Output a single concise insight (1-3 sentences) describing the most significant pattern you found. If no clear pattern exists, output "NO_INSIGHT".`;

    case 'knowledge_gap':
      return `${base}

TASK: Identify knowledge gaps — areas where related topics exist but important connections are missing. Look for:
- Topics mentioned often but never deeply explored
- Related concepts that are never connected
- Questions raised but never answered
- Skills referenced but never documented

Output a single concise insight (1-3 sentences) describing the most significant knowledge gap. If no clear gap exists, output "NO_INSIGHT".`;

    case 'trend':
      return `${base}

TASK: Identify trends — how the user's focus, tools, or approaches have shifted over time. Look for:
- Topics that appeared recently vs. those that faded
- Technology or tool transitions
- Evolving priorities or goals
- Changing patterns of work

Output a single concise insight (1-3 sentences) describing the most significant trend. If no clear trend exists, output "NO_INSIGHT".`;

    case 'contradiction_summary':
      return `${base}

TASK: Identify contradictions or inconsistencies between memories. Look for:
- Facts that conflict with each other
- Preferences that changed without acknowledgment
- Decisions that contradict stated principles
- Information that has become outdated

Output a single concise insight (1-3 sentences) describing the most significant contradiction or inconsistency. If no contradiction exists, output "NO_INSIGHT".`;
  }
}
