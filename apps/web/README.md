<div align="center">

# @engram-ai-memory/web

**Atlas dashboard for Engram — Map, Review, Timeline, and Insights**

</div>

---

## Overview

The Atlas dashboard provides a map of memories, search and recall, a memory
sheet for inspection and editing, review queues, a timeline, insights, settings,
and an onboarding guide for connecting an AI.

The Map switcher lazily loads **Sky** (a WebGL memory sky), **Landscape** (retention terrain with a Now / +7 / +30 / +90-day decay preview), **River** (braided history by region, with brush-to-zoom and region following) and **Pulse** (a read-only recall explanation of ranks, graph pulls, token budget and exclusions) at `#/?view=sky|landscape|river|pulse`.

## Tech Stack

- **React 19** + TypeScript
- **Canvas** + D3 (memory map)
- **three.js** (lazy Sky and Landscape views)
- **Recharts** (Insights charts)
- **Zustand** (State management)
- **Vite** (Build tooling)
- **Socket.io** (Real-time updates)
- **date-fns** (Date formatting)

## Development

```bash
# From the monorepo root
pnpm install

# Start the API server (required for data)
pnpm --filter @engram-ai-memory/server dev

# Start the web dev server
pnpm --filter @engram-ai-memory/web dev
# → http://localhost:4902
```

The dev server proxies API requests to `http://localhost:4901`.

## Production

```bash
pnpm --filter @engram-ai-memory/web build
```

The built dashboard is served automatically by the Engram server at `http://localhost:4901` when the `dist/` folder exists.

## Architecture

```
src/
├── components/ui/      # Shared dialogs, error boundary and API-key gate
├── features/           # Atlas screens and memory sheet
├── shell/              # Navigation, routes, commands and colour mode
├── styles/             # Atlas tokens, fonts and global interaction styles
├── hooks/              # Real-time events and media-query subscriptions
├── lib/                # REST client, socket connection and formatting
└── store/              # Shared memory, auth, analytics and graph state
```

## Colour mode

Atlas uses `src/styles/tokens.css` as the source for colour, typography, spacing,
radius and motion. Auto follows the system colour scheme; Light and Dark are
explicit overrides. `src/shell/theme.ts` persists the choice and sets the
`data-theme` attribute before React renders.

## API Integration

The dashboard connects to these server endpoints:

| Endpoint | Used by |
|----------|---------|
| `GET /api/memory` | Memory list (all views) |
| `GET /api/analytics` | Insights |
| `GET /api/reflections` | Review |
| `GET /api/reflection/status` | Reflection status |
| `GET /api/graph/:id` | Memory connections |
| `GET /api/contradictions` | Contradiction highlighting |
| `PATCH /api/memory/:id` | Inline editing |
| `POST /api/memory/bulk/tag` | Bulk tagging |
| `POST /api/memory/bulk/archive` | Bulk archival |
| `WS /neural` | Real-time events |
