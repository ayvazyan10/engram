<div align="center">

# @engram-ai-memory/web

**Atlas dashboard for Engram — Map, Recall, Review, Timeline, Insights and Settings**

</div>

---

## Overview

The Atlas dashboard provides a map of memories, search and recall, a memory
sheet for inspection and editing, review queues, a timeline, insights, settings,
and an onboarding guide for connecting an AI.

The Map switcher lazily loads **Sky** (a WebGL memory sky), **Landscape** (retention terrain with a Now / +7 / +30 / +90-day decay preview), **River** (braided history by region, with brush-to-zoom and region following) and **Pulse** (a read-only recall explanation of ranks, graph pulls, token budget and exclusions) using the `view` query parameter, for example `#/?view=sky`.

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

# Build the workspace dependencies the API imports from dist
pnpm --filter @engram-ai-memory/core build
pnpm --filter @engram-ai-memory/mcp build

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

The built dashboard is served automatically by the Engram server at `http://localhost:4901` when `apps/web/dist/index.html` exists.

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
| `GET /api/memory` | Memory list and Timeline |
| `POST /api/memory`, `DELETE /api/memory/:id` | Store or archive a memory |
| `GET /api/map` | Project map and alternate views |
| `POST /api/search` | Map search pins |
| `POST /api/recall/explain` | Recall route and Pulse preview |
| `GET /api/analytics` | Insights |
| `GET /api/reflections` | Insights → Reflections |
| `GET /api/reflection/status` | Reflection status |
| `GET /api/graph/:id` | Memory connections |
| `GET /api/graph/edges` | Fault lines on the map |
| `GET /api/review/summary`, `GET /api/review/:queue` | Review counts and queue items |
| `POST /api/review/dismiss`, `POST /api/memory/:id/redact` | Dismiss a review item or redact detected secrets |
| `POST /api/contradictions/resolve`, `POST /api/contradictions/bulk/resolve` | Resolve individual or selected conflicts |
| `PATCH /api/memory/:id` | Inline editing |
| `POST /api/memory/:id/tags`, `DELETE /api/memory/:id/tags/:tag` | Add or remove a tag in the memory sheet |
| `POST /api/memory/bulk/tag` | Bulk tagging |
| `POST /api/memory/bulk/archive` | Bulk archival |
| `GET /api/health`, `GET /api/stats`, `GET /api/sync/status`, `GET /api/embeddings/status`, `GET /api/index/status` | Server and store status |
| `GET /api/decay/policy` | Retention previews |
| Socket.IO namespace `/neural` | Real-time events via `/socket.io` |
