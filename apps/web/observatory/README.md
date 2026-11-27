# Observatory — visualization comparison harness

Throwaway. Switch between fifteen visualizations of the same real store in one
click, so the owner can compare them. Delete the whole thing when the choice is
made:

```
rm -rf apps/web/observatory
```

The Atlas app does not import this harness.

## Run it

The 3D demos require the React Three packages listed below to be available in `apps/web`.

```
cd apps/web && npx vite --config observatory/vite.config.ts
```

Serves `http://127.0.0.1:4912`, proxying `/api` to the API on `4901`.

It runs separately from the app's dev server on 4902 and reads the API on 4901.
The harness has its own Vite config, port and build.

## Why it lives here

pnpm keeps each package's dependencies under that package's own
`node_modules`. Sitting inside `apps/web` lets the harness resolve `react`,
`three` and `date-fns`. The demos also import `@react-three/fiber`,
`@react-three/drei` and `@react-three/postprocessing`. A clean workspace
install does not supply those three packages from `apps/web/package.json`.

It is nonetheless fully separate from the application:

| | scope | sees `observatory/`? |
|---|---|---|
| `apps/web/tsconfig.json` | `include: ["src"]` | no |
| `apps/web/vitest.config.ts` | coverage includes `src/**/*.{ts,tsx}` | no harness tests or coverage |
| `pnpm lint` | `eslint src` | no |
| `pnpm build` | `vite.config.ts`, root `apps/web` | no |

The application typecheck, lint and build use the app sources. Vitest uses its default test-file discovery.

## Data

Real, from the running API. No fixtures, and no fallback — if a request fails
the page says so and draws nothing.

| endpoint | gives |
|---|---|
| `GET /api/graph/layout` | visible memories with PCA or fallback positions (651 projected in the measured store) |
| `GET /api/graph/edges?limit=20000` | renderable links and stored totals (3,099 renderable in that store) |
| `GET /api/decay/policy` | the configured half-life used for retention (7 days in that store) |

`data.ts` joins them and derives, once, what all fifteen demos share: link
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
  is why edges were hard to see in the original 3D scene.
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
| `demos/MemoryRiver.tsx` | 10 — Hybrid | memories and links along a timeline |
| `demos/MemoryGalaxy.tsx` | 11 — 3D | link communities as spiral arms |
| `demos/MemoryMatrix.tsx` | 12 — 3D | a plane ordered by age and link community |
| `demos/OrbitalCore.tsx` | 13 — 3D | orbits arranged by age |
| `demos/MemoryTree.tsx` | 14 — Hybrid | tree branches and the links left out as roots |
| `demos/MemoryConstellations.tsx` | 15 — 2D | groups joined by their strongest links |

Each file exports a `DemoModule` and owns its own name, dimension and claim.
`demos/registry.ts` is the only file that knows about more than one demo.

Read **`demos/contract.ts`** first — it is the whole boundary: the data shapes,
the props, and the nine rules a demo has to hold to. `tokens.css` is the colour
and type layer, and its header carries every measurement behind it.
