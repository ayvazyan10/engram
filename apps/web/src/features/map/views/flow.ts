import { useEffect, useState } from 'react';
import { api, type MapPayload } from '../../../lib/api.js';
import type { FlowEdge } from './river.js';

export const typeColor = (type: string) => `var(--${type === 'semantic' ? 'sem' : type === 'episodic' ? 'epi' : 'pro'})`;

/** Both views only use graph edges whose endpoints belong to this map scope. */
export function useFlowEdges(payload: MapPayload) {
  const [result, setResult] = useState<{ edges: FlowEdge[]; note: string }>({ edges: [], note: '' });
  useEffect(() => {
    let cancelled = false;
    setResult({ edges: [], note: '' });
    if (!payload.nodes.length) return;
    const ids = new Set(payload.nodes.map((n) => n.id));
    api.getGraphEdges().then((data) => {
      if (!cancelled) setResult({ edges: data.edges.filter((e) => ids.has(e.sourceId) && ids.has(e.targetId)),
        note: data.truncated ? 'Only part of the memory graph was returned; some links may be missing.' : '' });
    }).catch(() => { if (!cancelled) setResult({ edges: [], note: 'Memory graph unavailable; links and contradictions cannot be shown.' }); });
    return () => { cancelled = true; };
  }, [payload]);
  return result;
}

/** A finite presentation clock; hidden tabs pause rather than skipping the story. */
export function usePulseClock(key: unknown, reduced: boolean, duration: number) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!key || reduced) { setElapsed(duration); return; }
    let raf = 0, elapsed = 0, previous = 0;
    setElapsed(0);
    const tick = (now: number) => {
      if (previous) elapsed += now - previous;
      previous = now;
      setElapsed(Math.min(duration, elapsed));
      if (elapsed < duration) raf = requestAnimationFrame(tick);
    };
    const resume = () => {
      cancelAnimationFrame(raf);
      previous = 0;
      if (!document.hidden && elapsed < duration) raf = requestAnimationFrame(tick);
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', resume); };
  }, [key, reduced, duration]);
  return reduced ? duration : elapsed;
}
