# Observatory — visualization comparison harness

Throwaway. Three visualizations of the same real store, side by side in one
click, so the owner can pick one. Delete the whole thing when the choice is
made:

```
rm -rf apps/web/observatory
```

Nothing outside this directory refers to it.

## Run it

```
cd apps/web && npx vite --config observatory/vite.config.ts
```

Serves `http://127.0.0.1:4912`, proxying `/api` to the API on `4901`.

It does **not** touch the app's dev server on 4911 or the API on 4901, and it
does not share a Vite config, a port, or a build with them.

## Why it lives here

pnpm keeps each package's dependencies under that package's own
`node_modules`. Sitting inside `apps/web` is what lets these files resolve
`react`, `three`, `@react-three/fiber`, `@react-three/drei`,
`@react-three/postprocessing`, `recharts`, `zustand` and `date-fns` without
installing anything.

It is nonetheless fully separate from the application:

| | scope | sees `observatory/`? |
|---|---|---|
| `apps/web/tsconfig.json` | `include: ["src"]` | no |
| `apps/web/vitest.config.ts` | `include: ['src/**/*.{ts,tsx}']` | no |
| `pnpm lint` | `eslint src` | no |
| `pnpm build` | `vite.config.ts`, root `apps/web` | no |

So an agent rebuilding `apps/web/src` and this harness cannot collide, and the
harness cannot break the app's typecheck, tests, lint or build.

## Data

Real, from the running API. No fixtures, and no fallback — if a request fails
the page says so and draws nothing.

| endpoint | gives |
|---|---|
| `GET /api/graph/layout` | 651 memories, each with a PCA coordinate |
| `GET /api/graph/edges?limit=20000` | 3,099 renderable links, plus the honest totals |
| `GET /api/decay/policy` | the 7-day half-life retention is computed against |

`data.ts` joins them and derives, once, what all nine demos share: link
endpoints as array indices, per-node degrees split by link kind, connected
components ranked largest-first, retention and its band.

Numbers worth knowing before you draw (all measured on this store):

- 3,099 links are renderable; **5,393 of the 8,492 stored point at archived
  memories** and cannot be drawn. Any subset shown needs its real denominator
  on screen.
- Links split almost exactly in half: **1,560 `relates_to`, 1,539
  `contradicts`.** Agrees run strong (median strength 0.93), contradicts run
  weak (0.57).
- **96%** of links join two memories of the same type, and 79% of memories are
  semantic — memory type explains almost nothing about the structure.
- Mean link span in the projection is **7.08** against a mean random-pair
  distance of **40.81**. Connected memories are already piled together, which
  is why edges are invisible in the current 3D scene.
- The 3-component PCA keeps **38%** of the embedding variance.
- 613 memories are connected, 38 are isolated; 17 components, the largest 538.
- Retention: 35 vivid, 10 holding, 42 fading, **564 at the archive threshold**.

## Filling a slot

| file | slot | idea |
|---|---|---|
| `demos/LaidOutByLink.tsx` | 1 — 2D | layout computed from the links, not the embedding |
| `demos/LaidOutByMeaning.tsx` | 2 — 3D | keep the projection, invert node/link hierarchy |
| `demos/OverviewAndDetail.tsx` | 3 — Hybrid | an aggregate view bound to a detail view |
| `demos/TimeAndNeighbourhood.tsx` | 4 — Hybrid | the calendar as overview, one day's links as detail |
| `demos/TextFirst.tsx` | 5 — Hybrid | the writing itself as the overview |
| `demos/ContradictionLedger.tsx` | 6 — Hybrid | every disagreement, and one of them made readable |
| `demos/Strata.tsx` | 7 — 3D | equal-count age beds, links leaning across time |
| `demos/AxesAndChords.tsx` | 8 — 3D | nothing floats: nodes pinned to axes, links as chords |
| `demos/LinkTerrain.tsx` | 9 — 3D | link density as landform, read across rather than into |

Each file exports a `DemoModule` and owns its own name, dimension and claim.
`demos/registry.ts` is the only file that knows about more than one demo.

Read **`demos/contract.ts`** first — it is the whole boundary: the data shapes,
the props, and the nine rules a demo has to hold to. `tokens.css` is the colour
and type layer, and its header carries every measurement behind it.
