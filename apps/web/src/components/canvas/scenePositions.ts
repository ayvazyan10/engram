/**
 * Where every node currently *is* on screen, shared by the three layers that
 * have to agree about it.
 *
 * NeuronField owns the tween and writes into this; NeuronRings and NeuronLabels
 * read it. Without a shared buffer the rings and labels would sit at the new
 * target while the cores were still gliding towards it — visibly detached for
 * the half second a view switch takes.
 *
 * A mutable ref rather than state on purpose: it changes every frame during a
 * tween, and re-rendering three components 60 times a second to move a sphere
 * is exactly the cost this rebuild set out to remove.
 */

export interface ScenePositions {
  /** Node id per instance index. */
  ids: string[];
  /** Flat x,y,z triples, parallel to `ids`. */
  xyz: Float32Array;
  /**
   * Bumped on every write. Readers that mirror these coordinates into their own
   * GPU buffers (the edge geometry) compare it and skip the upload when nothing
   * has moved — which is every frame the scene is at rest.
   */
  version: number;
}

export function createScenePositions(): ScenePositions {
  return { ids: [], xyz: new Float32Array(0), version: 0 };
}
