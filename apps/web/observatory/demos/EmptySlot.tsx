import type { ObsData } from './contract';

/**
 * The unfilled state of a demo slot. Every slot renders this until its author
 * replaces it with a real visualization.
 *
 * It exists so the harness is verifiably wired before the three visualizations
 * arrive: it renders inside the real box, from the real loaded store, and
 * prints the counts it was handed. If these numbers are right, the author's
 * only remaining job is to draw.
 *
 * Delete this import when you fill your slot.
 */
export function EmptySlot({
  data,
  width,
  height,
  brief,
}: {
  data: ObsData;
  width: number;
  height: number;
  brief: string;
}) {
  const { stats } = data;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: 14,
        padding: 24,
      }}
    >
      <p className="obs-note" style={{ margin: 0, maxWidth: '54ch' }}>
        {brief}
      </p>
      <p className="obs-label" style={{ margin: 0, maxWidth: '90ch' }}>
        Slot is empty. Box {width}&thinsp;&times;&thinsp;{height}. Holding {stats.memories} memories
        and {data.links.length} links ({stats.agrees} agree, {stats.contradicts} contradict), in{' '}
        {stats.components} clusters, largest {stats.largestComponent}, median degree{' '}
        {stats.degree.median}, busiest memory {stats.degree.max}.
      </p>
    </div>
  );
}
