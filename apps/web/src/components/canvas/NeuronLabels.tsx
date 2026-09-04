import { Suspense, useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { useNeuralStore } from '../../store/neuralStore.js';
import { truncateLabel } from '../../lib/plainText.js';
import { importanceRadius } from './encoding.js';
import type { ScenePositions } from './scenePositions.js';

/**
 * Labels you can actually read.
 *
 * The old rule was `type === 'semantic' && importance > 0.75`, which matched 118
 * of 200 loaded nodes. Because the concepts are job-generated, only 55 of those
 * 118 were distinct — `# Knowledge Gap Analysis` appeared 18 times, `# Trend
 * Analysis` 18 times — and every one of them rendered with `depthOffset={-1}`,
 * so text on the far side of the graph punched through the nodes in front of it.
 *
 * Three changes:
 *   1. Focus first. The selected node, its direct neighbours and whatever is
 *      hovered are always labelled — that is what a label is for.
 *   2. The ambient layer collapses identical concepts to one representative
 *      with a count ("Trend Analysis x18") and is capped by a screen-space
 *      greedy declutter: candidates sorted by importance, accepted only if
 *      their rect misses every rect already accepted.
 *   3. Constant apparent size and normal depth testing, so a label is legible
 *      at any distance and is occluded by whatever is genuinely in front of it.
 */

interface Props {
  positions: RefObject<ScenePositions>;
}

/** Apparent cap height, in CSS pixels, regardless of distance from the camera. */
const TARGET_PX = 13;
/** Hard cap on the always-on layer. */
const AMBIENT_CAP = 12;
/** Direct neighbours of the selection worth labelling, strongest edges first. */
const NEIGHBOUR_CAP = 8;
/** How often the declutter re-runs, in seconds. */
const RECOMPUTE_INTERVAL = 0.15;
/** Candidates considered before projection — keeps the sort bounded. */
const CANDIDATE_POOL = 60;

interface Candidate {
  id: string;
  index: number;
  text: string;
  importance: number;
  radius: number;
  focus: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/** Longest label drawn; the text is truncated to this so a rect is always one
 *  line. F7: the cut used to be a bare `slice(0, MAX_CHARS)` with no ellipsis,
 *  which drew "Codex must use Engram as" and "CORRECTION: AI Cartoon Studio no
 *  l" as though those were the whole label. `truncateLabel` marks the cut, the
 *  way AnalyticsView's `truncateSourceLabel` always did. */
const MAX_CHARS = 34;

/**
 * Ink for the 3D labels (F2).
 *
 * Every ambient label used to be painted in its node's type colour — text
 * wearing the data colour, and at a distance the outline and the fill fought
 * each other. The label sits directly above the node it names, so the node IS
 * the coloured mark beside the text; the label only has to be legible. Focus
 * labels stay a step brighter than ambient ones so the hierarchy survives.
 */
const LABEL_INK = { focus: '#f8fafc', ambient: '#cbd5e1' } as const;

/** Rough screen box for a label of `length` characters at TARGET_PX. */
export function labelRect(x: number, y: number, length: number): Rect {
  return { x, y, w: Math.min(length, MAX_CHARS) * TARGET_PX * 0.62 + 12, h: TARGET_PX * 2 };
}

/**
 * Greedy screen-space declutter: keep the most important label whose box is
 * still free. `cap` bounds the ambient layer only — a label the user asked for
 * by selecting or hovering is never dropped for want of budget, though it is
 * still dropped if it would land on top of one already placed. Exported so the
 * rule is testable without a WebGL context.
 */
export function declutter<T extends { rect: Rect; forced: boolean }>(items: readonly T[], cap: number): T[] {
  const accepted: T[] = [];
  const taken: Rect[] = [];
  let ambient = 0;
  for (const item of items) {
    if (!item.forced && ambient >= cap) continue;
    if (taken.some((r) => overlaps(item.rect, r))) continue;
    accepted.push(item);
    taken.push(item.rect);
    if (!item.forced) ambient += 1;
  }
  return accepted;
}

const scratchVec = new THREE.Vector3();
const scratchUp = new THREE.Vector3();

export default function NeuronLabels({ positions }: Props) {
  const neurons = useNeuralStore((s) => s.neurons);
  const connections = useNeuralStore((s) => s.connections);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const hoveredId = useNeuralStore((s) => s.hoveredNeuronId);
  const { camera, size } = useThree();

  /** Ids that always get a label: the selection, its neighbours, the hover. */
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    if (hoveredId) ids.add(hoveredId);
    if (selectedId) {
      ids.add(selectedId);
      const neighbours = connections
        .filter((c) => c.sourceId === selectedId || c.targetId === selectedId)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, NEIGHBOUR_CAP);
      for (const edge of neighbours) {
        ids.add(edge.sourceId === selectedId ? edge.targetId : edge.sourceId);
      }
    }
    return ids;
  }, [connections, selectedId, hoveredId]);

  /**
   * One candidate per DISTINCT label text, represented by its most important
   * node and carrying how many memories share that exact concept.
   */
  const candidates = useMemo<Candidate[]>(() => {
    const byText = new Map<string, { index: number; count: number }>();
    neurons.forEach((n, index) => {
      const text = n.label.trim();
      if (!text) return;
      const existing = byText.get(text);
      if (!existing) byText.set(text, { index, count: 1 });
      else {
        existing.count += 1;
        if (n.importance > neurons[existing.index]!.importance) existing.index = index;
      }
    });

    const ambient = [...byText.entries()]
      .map(([text, entry]) => {
        const node = neurons[entry.index]!;
        return {
          id: node.id,
          index: entry.index,
          text: entry.count > 1 ? `${text} ×${entry.count}` : text,
          importance: node.importance,
          radius: importanceRadius(node.importance),
          focus: false,
        };
      })
      .sort((a, b) => b.importance - a.importance)
      .slice(0, CANDIDATE_POOL);

    const focus = neurons
      .map((n, index) => ({ n, index }))
      .filter(({ n }) => focusIds.has(n.id))
      .map(({ n, index }) => ({
        id: n.id,
        index,
        text: n.label.trim() || n.id.slice(0, 8),
        importance: n.importance,
        radius: importanceRadius(n.importance),
        focus: true,
      }));

    const seen = new Set(focus.map((f) => f.id));
    return [...focus, ...ambient.filter((a) => !seen.has(a.id))];
  }, [neurons, focusIds]);

  const [visible, setVisible] = useState<Candidate[]>([]);
  const sinceRecompute = useRef(RECOMPUTE_INTERVAL);
  const signatureRef = useRef('');

  const recompute = useCallback(() => {
    const xyz = positions.current.xyz;
    const projected: { candidate: Candidate; rect: Rect; forced: boolean }[] = [];
    for (const candidate of candidates) {
      const base = candidate.index * 3;
      if (base + 2 >= xyz.length) continue;
      scratchVec.set(xyz[base]!, xyz[base + 1]!, xyz[base + 2]!).project(camera);
      if (scratchVec.z < -1 || scratchVec.z > 1) continue;
      const x = (scratchVec.x * 0.5 + 0.5) * size.width;
      const y = (-scratchVec.y * 0.5 + 0.5) * size.height;
      const rect = labelRect(x, y, candidate.text.length);
      // Reject anything whose box would run off the canvas rather than drawing
      // half a word at the edge — a clipped label reads as a rendering bug.
      if (x - rect.w / 2 < 0 || x + rect.w / 2 > size.width) continue;
      if (y - rect.h < 0 || y + rect.h > size.height) continue;
      projected.push({ candidate, rect, forced: candidate.focus });
    }
    // Focus labels first, so a decluttered ambient label can never displace the
    // one the user actually asked for by selecting or hovering a node.
    projected.sort((a, b) =>
      Number(b.forced) - Number(a.forced) || b.candidate.importance - a.candidate.importance
    );
    const accepted = declutter(projected, AMBIENT_CAP).map((p) => p.candidate);
    const signature = accepted.map((a) => a.id).join('|');
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      setVisible(accepted);
    }
  }, [candidates, camera, positions, size.width, size.height]);

  useFrame((_state, delta) => {
    sinceRecompute.current += delta;
    if (sinceRecompute.current < RECOMPUTE_INTERVAL) return;
    sinceRecompute.current = 0;
    recompute();
  });

  return (
    <>
      {visible.map((candidate) => (
        <LabelSprite key={candidate.id} candidate={candidate} positions={positions} />
      ))}
    </>
  );
}

interface LabelSpriteProps {
  candidate: Candidate;
  positions: RefObject<ScenePositions>;
}

/**
 * One label, billboarded, held at a constant apparent size.
 *
 * W3: the <Text> keeps its own Suspense boundary. drei's Text suspends while
 * its font loads, and a single shared boundary would blank the whole scene —
 * lights, nodes, edges — rather than just this one decorative label.
 */
function LabelSprite({ candidate, positions }: LabelSpriteProps) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ camera, size }) => {
    const group = groupRef.current;
    if (!group) return;
    const base = candidate.index * 3;
    const xyz = positions.current.xyz;
    if (base + 2 >= xyz.length) return;

    scratchVec.set(xyz[base]!, xyz[base + 1]!, xyz[base + 2]!);
    const distance = camera.position.distanceTo(scratchVec);
    const fov = ((camera as THREE.PerspectiveCamera).fov ?? 50) * (Math.PI / 180);
    // Apparent height stays TARGET_PX whatever the distance.
    const scale = (TARGET_PX * 2 * distance * Math.tan(fov / 2)) / size.height;

    // Lift the label clear of its node along the screen's up axis.
    scratchUp.setFromMatrixColumn(camera.matrixWorld, 1);
    group.position
      .copy(scratchVec)
      .addScaledVector(scratchUp, candidate.radius + scale * 1.1);
    group.quaternion.copy(camera.quaternion);
    group.scale.setScalar(scale);
  });

  return (
    <group ref={groupRef} raycast={() => null}>
      <Suspense fallback={null}>
        <Text
          fontSize={1}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.16}
          outlineColor="#01040c"
          outlineOpacity={0.9}
          renderOrder={10}
        >
          {truncateLabel(candidate.text, MAX_CHARS)}
          {/* Always on top. With 118 labels and depthOffset={-1} the old scene
              had back-hemisphere text punching through front geometry; with a
              decluttered dozen, drawing them over the graph is what keeps them
              legible — half a word emerging from behind a sphere reads as a
              rendering fault, not as depth. */}
          <meshBasicMaterial
            attach="material"
            color={candidate.focus ? LABEL_INK.focus : LABEL_INK.ambient}
            transparent
            depthTest={false}
            depthWrite={false}
            toneMapped={false}
          />
        </Text>
      </Suspense>
    </group>
  );
}
