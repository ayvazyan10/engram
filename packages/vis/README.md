# @engram-ai-memory/vis

3D visualization helpers for [Engram](https://github.com/ayvazyan10/engram) — force-directed graph layout, color mapping, and animation engine for rendering neural memory graphs.

## Install

```bash
npm install @engram-ai-memory/vis
```

Peer dependencies: `three`, `react`, `react-dom`, `@react-three/fiber`

## Exports

| Export | Description |
|---|---|
| `NeuralGraph` | Force-directed 3D layout algorithm (Fibonacci sphere, spiral arms, layered, cloud clusters) |
| `ColorMapper` | Maps memory types to theme colors |
| `AnimationEngine` | Activity pulse and activation event animation system |

## Usage

```typescript
import { NeuralGraph, ColorMapper } from '@engram-ai-memory/vis';

// Create layout positions for memories
const graph = new NeuralGraph();
const positions = graph.layout(memories, {
  style: 'fibonacci',  // fibonacci | spiral | layered | clusters
  radius: 40,
  spread: 1.2,
});

// Map memory type to color
const color = ColorMapper.getColor('semantic', 'cosmos');
```

## View Modes

The Engram dashboard ships with 5 visualization modes:

| Mode | Layout | Style |
|---|---|---|
| **Cosmos** | Fibonacci sphere | Metallic cores, slow rotation |
| **Nebula** | Fibonacci sphere | Ghost orbs, high bloom |
| **Neural Net** | Layered columns | Neon green, grid |
| **Galaxy** | Spiral arms | Tiny stars, fast rotation |
| **Clusters** | Cloud clusters | Plasma, moderate rotation |

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Dashboard source](https://github.com/ayvazyan10/engram/tree/master/apps/web)
- [Website](https://engram.am)

## License

MIT
