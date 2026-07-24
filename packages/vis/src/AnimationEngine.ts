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
  /** Timers scheduled by triggerWave, tracked so stop() can cancel them. */
  private waveTimers = new Set<ReturnType<typeof setTimeout>>();
  /** True from the moment a tick is scheduled/running until the loop ends. */
  private running = false;
  private readonly TICK_MS = 16; // ~60fps

  constructor(decayRate: number = 0.05) {
    // A non-positive rate never reaches <= 0, so activations never drain: the
    // loop would reschedule forever (burning CPU) and a negative rate grows
    // activation toward Infinity.
    if (!Number.isFinite(decayRate) || decayRate <= 0) {
      throw new Error(`AnimationEngine decayRate must be a positive number (got ${decayRate})`);
    }
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
      // Handles are tracked: previously a pending wave timer could fire after
      // stop(), restart the decay loop and keep invoking listeners long after
      // the consumer (e.g. an unmounted React component) had torn down.
      const timer = setTimeout(() => {
        this.waveTimers.delete(timer);
        const decayedActivation = baseActivation * Math.pow(0.7, index);
        this.trigger(id, decayedActivation);
      }, index * delayMs);
      this.waveTimers.add(timer);
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

  /** Stop the animation loop and cancel any pending wave timers. */
  stop(): void {
    if (this.frameTimer) {
      clearTimeout(this.frameTimer);
      this.frameTimer = null;
    }
    for (const timer of this.waveTimers) clearTimeout(timer);
    this.waveTimers.clear();
    this.running = false;
  }

  private ensureRunning(): void {
    // Guard on `running`, not on frameTimer. tick() only assigns frameTimer at
    // its END — after invoking listeners — so a listener calling trigger()
    // (the documented "activation propagates to neighbours" behaviour) re-entered
    // tick() recursively and each unwind spawned another setTimeout chain, all
    // but the last orphaned and uncancellable by stop().
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  private tick(): void {
    const events: ActivityEvent[] = [];
    const now = Date.now();

    for (const [id, activation] of this.activations) {
      // Clamp so a caller-supplied activation can never drive emitted values
      // out of the documented 0..1 range.
      const decayed = Math.min(1, activation) - this.decayRate;
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

    // Always clear the previous handle before assigning a new one so exactly
    // one timer can ever be live.
    if (this.frameTimer) clearTimeout(this.frameTimer);

    if (this.activations.size > 0) {
      this.frameTimer = setTimeout(() => this.tick(), this.TICK_MS);
    } else {
      this.frameTimer = null;
      this.running = false;
    }
  }
}
