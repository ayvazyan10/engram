/**
 * AnimationEngine — schedules and propagates activation waves across the neural graph.
 *
 * When a memory is accessed, its corresponding neuron "fires" and the activation
 * propagates to connected neurons with exponential decay.
 */

export interface ActivityEvent {
  neuronId: string;
  activation: number;
  timestamp: number;
}

type ActivationCallback = (events: ActivityEvent[]) => void;

export class AnimationEngine {
  private activations = new Map<string, number>(); // current activation per node
  private decayRate: number;
  private listeners: ActivationCallback[] = [];
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly TICK_MS = 16; // ~60fps

  constructor(decayRate: number = 0.05) {
    this.decayRate = decayRate;
  }

  /**
   * Trigger activation on one or more neurons.
   * Activation propagates to connected nodes with reduced strength.
   */
  trigger(neuronId: string, activation: number = 1.0): void {
    const current = this.activations.get(neuronId) ?? 0;
    this.activations.set(neuronId, Math.min(1.0, current + activation));
    this.ensureRunning();
  }

  /**
   * Trigger an activation wave across multiple neurons.
   */
  triggerWave(path: string[], baseActivation: number = 1.0, delayMs: number = 50): void {
    path.forEach((id, index) => {
      setTimeout(() => {
        const decayedActivation = baseActivation * Math.pow(0.7, index);
        this.trigger(id, decayedActivation);
      }, index * delayMs);
    });
  }

  /** Subscribe to activation updates. */
  onActivation(callback: ActivationCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  /** Get current activation for a neuron. */
  getActivation(neuronId: string): number {
    return this.activations.get(neuronId) ?? 0;
  }

  /** Stop the animation loop. */
  stop(): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
  }

  private ensureRunning(): void {
    if (!this.frameTimer) {
      this.tick();
    }
  }

  private tick(): void {
    const events: ActivityEvent[] = [];
    const now = Date.now();

    for (const [id, activation] of this.activations) {
      const decayed = activation - this.decayRate;
      if (decayed <= 0) {
        this.activations.delete(id);
        events.push({ neuronId: id, activation: 0, timestamp: now });
      } else {
        this.activations.set(id, decayed);
        events.push({ neuronId: id, activation: decayed, timestamp: now });
      }
    }

    if (events.length > 0) {
      for (const listener of this.listeners) {
        listener(events);
      }
    }

    if (this.activations.size > 0) {
      this.frameTimer = setTimeout(() => this.tick(), this.TICK_MS);
    } else {
      this.frameTimer = null;
    }
  }
}
