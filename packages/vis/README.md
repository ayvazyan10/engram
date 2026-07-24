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
| `NeuralGraph` | Force-directed 3D layout — incremental simulation (`addNode` / `addEdge` / `tick`) |
| `ColorMapper` | Maps an activation value (0–1) to a colour |
| `AnimationEngine` | Activation decay loop and activity-event emission |

## Usage

```typescript
import { NeuralGraph, ColorMapper, AnimationEngine } from '@engram-ai-memory/vis';

// Build the graph, then run the force simulation.
const graph = new NeuralGraph();
for (const memory of memories) {
  graph.addNode(memory.id, memory.type, memory.content.slice(0, 40));
}
graph.addEdge(sourceId, targetId, 0.8);

const positions = graph.tick(50); // LayoutNode[] — run N simulation steps
// ...or read them back later:
graph.getPositions();

// Colour is derived from activation, not from the memory type.
const hex = ColorMapper.toHex(0.7);
const intensity = ColorMapper.emissiveIntensity(0.7);

// Activation decays over time and emits events.
const engine = new AnimationEngine(0.05); // decayRate must be > 0
const unsubscribe = engine.onActivation((events) => {
  for (const e of events) graph.setActivation(e.neuronId, e.activation);
});
engine.trigger(memoryId, 1.0);
// engine.stop() cancels the loop and any pending triggerWave timers.
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
