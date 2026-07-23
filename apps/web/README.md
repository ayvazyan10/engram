<div align="center">

# @engram-ai-memory/web

**Multi-view dashboard for Engram — 3D neural graph, Timeline, Analytics, and Reflections**

</div>

---

## Overview

The Engram web dashboard provides four distinct views into your AI memory:

| View | Description |
|------|-------------|
| **3D Neural Graph** | Interactive Three.js visualization with 5 layouts (Cosmos, Nebula, Neural Net, Galaxy, Clusters) and 3 UI themes |
| **Timeline** | Chronological memory feed grouped by day, showing type badges, importance, and concepts |
| **Analytics** | Growth charts, type/source distribution, activity heatmap, top concepts cloud |
| **Reflections** | AI-generated insight cards with type filters, confidence scores, and a due indicator |

## Tech Stack

- **React 19** + TypeScript
- **React Three Fiber** + Drei + Postprocessing (3D view)
- **Recharts** (Analytics charts)
- **Zustand** (State management — 6 stores)
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
├── components/
│   ├── canvas/          # 3D neural graph (NeuralCanvas, Neuron, Connections)
│   ├── layout/          # AppLayout — mode-aware shell
│   ├── ui/              # Shared UI (ViewSwitcher, SearchBar, StatusBar, etc.)
│   └── views/           # Full-page views (TimelineView, AnalyticsView, ReflectionView)
├── hooks/
│   └── useWebSocket.ts  # Real-time memory events
├── lib/
│   ├── api.ts           # Typed REST client (20+ methods)
│   └── socket.ts        # Socket.io connection
└── store/
    ├── dashboardStore.ts    # ViewMode state (3d/timeline/analytics/reflections)
    ├── memoryStore.ts       # Memory records
    ├── neuralStore.ts       # 3D graph nodes, connections, selection
    ├── viewStore.ts         # 3D layout configs (5 views)
    ├── templateStore.ts     # UI themes (Neural, Mono, Midnight)
    ├── analyticsStore.ts    # Analytics data
    └── reflectionStore.ts   # Reflection insights + scheduling status
```

## View Modes

### 3D Neural Graph
The original visualization — neurons positioned in 3D space using layout algorithms (Fibonacci sphere, spiral galaxy, layered net, cloud clusters). Connections rendered between related memories. Real-time bloom postprocessing.

### Timeline
Grouped-by-day chronological feed. Each card shows memory type, content preview, concept, importance, and creation time.

### Analytics
- **Stat cards**: Total memories, average importance, concept count, source count
- **Growth chart**: AreaChart of memories created per day
- **Type distribution**: Donut chart (episodic/semantic/procedural)
- **Source distribution**: Horizontal bar chart
- **Concept cloud**: Chip grid of top concepts by frequency
- **Activity heatmap**: 7×24 grid (day × hour) showing memory creation density

### Reflections
- **Status pill**: Whether a reflection cycle is due, or how many stores until the next one
- **Due hint**: Prompts you to have the connected AI run `request_reflection` → `store_reflection` (reflection is AI-driven; the dashboard never generates insights itself)
- **Type filters**: Pattern, Knowledge Gap, Trend, Contradiction Summary
- **Insight cards**: Content, confidence, importance, and creation date

## Themes

Three built-in themes available via the header switcher:

| Theme | Style |
|-------|-------|
| **Neural** | Deep blue, indigo accent, sci-fi atmosphere |
| **Mono** | Pure black/white, Vercel-inspired minimalism |
| **Midnight** | Deep purple, violet accent, dark luxury |

## API Integration

The dashboard connects to these server endpoints:

| Endpoint | Used by |
|----------|---------|
| `GET /api/memory` | Memory list (all views) |
| `GET /api/analytics` | Analytics view |
| `GET /api/reflections` | Reflections view |
| `GET /api/reflection/status` | Reflection status pill |
| `GET /api/graph/:id` | 3D connections |
| `GET /api/contradictions` | Contradiction highlighting |
| `PATCH /api/memory/:id` | Inline editing |
| `POST /api/memory/bulk/tag` | Bulk tagging |
| `POST /api/memory/bulk/archive` | Bulk archival |
| `WS /neural` | Real-time events |
