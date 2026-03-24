/**
 * PluginRegistry — formalized adapter/extension system for Engram.
 *
 * Plugins register hooks that fire at key points in the brain lifecycle:
 *   - onStore:     After a memory is stored (can inspect/modify result)
 *   - onRecall:    After recall completes (can inspect/modify context)
 *   - onForget:    When a memory is archived
 *   - onDecay:     After a decay sweep completes
 *   - onStartup:   When the brain initializes
 *   - onShutdown:  When the brain shuts down
 *
 * Plugins run in registration order. Errors in one plugin don't affect others.
 *
 * Example plugin:
 *   const myPlugin: EngramPlugin = {
 *     id: 'my-logger',
 *     name: 'Memory Logger',
 *     version: '1.0.0',
 *     hooks: {
 *       onStore: async (ctx) => { console.log('Stored:', ctx.memory.id); },
 *     },
 *   };
 *   brain.registerPlugin(myPlugin);
 */

import type { Memory } from '../db/schema.js';

// ─── Hook Context Types ──────────────────────────────────────────────────────

export interface StoreHookContext {
  memory: Memory;
  contradictions: number;
}

export interface RecallHookContext {
  query: string;
  memoriesUsed: number;
  latencyMs: number;
  context: string;
}

export interface ForgetHookContext {
  memoryId: string;
}

export interface DecayHookContext {
  scannedCount: number;
  archivedCount: number;
  decayedCount: number;
  consolidatedCount: number;
  durationMs: number;
}

export interface StartupHookContext {
  entryCount: number;
  loadedFrom: string;
  initDurationMs: number;
}

export interface ShutdownHookContext {
  entryCount: number;
}

// ─── Plugin Interface ────────────────────────────────────────────────────────

export interface PluginHooks {
  onStore?:    (ctx: StoreHookContext) => Promise<void> | void;
  onRecall?:   (ctx: RecallHookContext) => Promise<void> | void;
  onForget?:   (ctx: ForgetHookContext) => Promise<void> | void;
  onDecay?:    (ctx: DecayHookContext) => Promise<void> | void;
  onStartup?:  (ctx: StartupHookContext) => Promise<void> | void;
  onShutdown?: (ctx: ShutdownHookContext) => Promise<void> | void;
}

export interface EngramPlugin {
  /** Unique plugin identifier (e.g. "my-org/my-plugin") */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version */
  version: string;
  /** Optional description */
  description?: string;
  /** The hooks this plugin implements */
  hooks: PluginHooks;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string | undefined;
  hooks: string[];
  registeredAt: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class PluginRegistry {
  private plugins: Map<string, { plugin: EngramPlugin; registeredAt: string }> = new Map();

  /**
   * Register a plugin. Replaces any existing plugin with the same ID.
   */
  register(plugin: EngramPlugin): void {
    if (!plugin.id || !plugin.name || !plugin.version) {
      throw new Error('Plugin must have id, name, and version');
    }
    this.plugins.set(plugin.id, {
      plugin,
      registeredAt: new Date().toISOString(),
    });
  }

  /**
   * Unregister a plugin by ID.
   */
  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  /**
   * Check if a plugin is registered.
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * Get a registered plugin by ID.
   */
  get(id: string): EngramPlugin | undefined {
    return this.plugins.get(id)?.plugin;
  }

  /**
   * List all registered plugins with metadata.
   */
  list(): PluginInfo[] {
    return [...this.plugins.values()].map(({ plugin, registeredAt }) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      hooks: Object.keys(plugin.hooks).filter(
        (k) => typeof (plugin.hooks as Record<string, unknown>)[k] === 'function'
      ),
      registeredAt,
    }));
  }

  /**
   * Number of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }

  // ─── Hook Dispatchers ──────────────────────────────────────────────────

  /**
   * Run a named hook across all plugins that implement it.
   * Errors are caught per-plugin — one failing plugin won't break others.
   */
  async runHook<K extends keyof PluginHooks>(
    hookName: K,
    context: Parameters<NonNullable<PluginHooks[K]>>[0]
  ): Promise<void> {
    for (const { plugin } of this.plugins.values()) {
      const hook = plugin.hooks[hookName];
      if (hook) {
        try {
          await (hook as (ctx: typeof context) => Promise<void> | void)(context);
        } catch (err) {
          // Log but don't propagate — plugin errors shouldn't break the brain
          console.error(`[engram] Plugin "${plugin.id}" hook "${hookName}" failed:`, err);
        }
      }
    }
  }
}
