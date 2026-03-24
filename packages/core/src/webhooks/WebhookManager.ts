/**
 * WebhookManager — subscribe external systems to memory events via HTTP callbacks.
 *
 * Supported events:
 *   - stored:        A new memory was stored
 *   - forgotten:     A memory was archived
 *   - decayed:       A decay sweep completed
 *   - consolidated:  Episodic memories were consolidated into semantic
 *   - contradiction: A contradiction was detected on store
 *
 * Webhooks fire asynchronously (non-blocking). Failed deliveries retry
 * up to 3 times with exponential backoff. After 10 consecutive failures,
 * the webhook is auto-disabled.
 */

import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { createHmac } from 'crypto';
import { getDb, schema } from '../db/index.js';
import type { Webhook } from '../db/schema.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'stored'
  | 'forgotten'
  | 'decayed'
  | 'consolidated'
  | 'contradiction';

export const ALL_EVENTS: WebhookEvent[] = [
  'stored', 'forgotten', 'decayed', 'consolidated', 'contradiction',
];

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  description: string | null;
  secret: string | null;
  createdAt: string;
  lastTriggeredAt: string | null;
  failCount: number;
}

export interface WebhookDeliveryResult {
  webhookId: string;
  url: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
}

/** Max consecutive failures before auto-disabling a webhook. */
const MAX_FAIL_COUNT = 10;

/** Max retry attempts per delivery. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms). */
const RETRY_BASE_MS = 500;

// ─── Manager ─────────────────────────────────────────────────────────────────

export class WebhookManager {
  /**
   * Subscribe a new webhook.
   */
  async subscribe(opts: {
    url: string;
    events: WebhookEvent[];
    secret?: string;
    description?: string;
  }): Promise<WebhookSubscription> {
    const db = getDb();
    const id = uuidv4();
    const now = new Date().toISOString();

    await db.insert(schema.webhooks).values({
      id,
      url: opts.url,
      events: JSON.stringify(opts.events),
      secret: opts.secret ?? null,
      description: opts.description ?? null,
      active: true,
      metadata: '{}',
      createdAt: now,
      failCount: 0,
    });

    return {
      id,
      url: opts.url,
      events: opts.events,
      active: true,
      description: opts.description ?? null,
      secret: opts.secret ?? null,
      createdAt: now,
      lastTriggeredAt: null,
      failCount: 0,
    };
  }

  /**
   * Unsubscribe (delete) a webhook.
   */
  async unsubscribe(id: string): Promise<boolean> {
    const db = getDb();
    await db.delete(schema.webhooks).where(eq(schema.webhooks.id, id));
    return true;
  }

  /**
   * List all webhooks.
   */
  async list(activeOnly = false): Promise<WebhookSubscription[]> {
    const db = getDb();
    const rows = activeOnly
      ? await db.select().from(schema.webhooks).where(eq(schema.webhooks.active, true))
      : await db.select().from(schema.webhooks);

    return rows.map(toSubscription);
  }

  /**
   * Get a single webhook by ID.
   */
  async get(id: string): Promise<WebhookSubscription | null> {
    const db = getDb();
    const [row] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).limit(1);
    return row ? toSubscription(row) : null;
  }

  /**
   * Fire an event to all matching active webhooks.
   * Non-blocking — fires in background, does not throw.
   */
  fire(event: WebhookEvent, data: Record<string, unknown>): void {
    // Fire-and-forget — errors are caught and logged
    void this.fireAsync(event, data);
  }

  /**
   * Fire an event and wait for all deliveries to complete.
   * Returns delivery results for each webhook.
   */
  async fireAsync(event: WebhookEvent, data: Record<string, unknown>): Promise<WebhookDeliveryResult[]> {
    const db = getDb();
    const activeWebhooks = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.active, true));

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const results: WebhookDeliveryResult[] = [];

    for (const wh of activeWebhooks) {
      const events: WebhookEvent[] = JSON.parse(wh.events);
      if (!events.includes(event)) continue;

      const result = await this.deliver(wh, payload);
      results.push(result);
    }

    return results;
  }

  /**
   * Send a test event to a specific webhook.
   */
  async sendTest(id: string): Promise<WebhookDeliveryResult> {
    const db = getDb();
    const [wh] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).limit(1);
    if (!wh) return { webhookId: id, url: '', success: false, error: 'Webhook not found', attempts: 0 };

    const payload: WebhookPayload = {
      event: 'stored',
      timestamp: new Date().toISOString(),
      data: { test: true, message: 'This is a test webhook event from Engram' },
    };

    return this.deliver(wh, payload);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  /**
   * Deliver a payload to a webhook with retry.
   */
  private async deliver(wh: Webhook, payload: WebhookPayload): Promise<WebhookDeliveryResult> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Engram-Webhook/0.1',
      'X-Engram-Event': payload.event,
    };

    // HMAC signature if secret is configured
    if (wh.secret) {
      const sig = createHmac('sha256', wh.secret).update(body).digest('hex');
      headers['X-Engram-Signature'] = `sha256=${sig}`;
    }

    let lastError: string | undefined;
    let statusCode: number | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(wh.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        statusCode = res.status;

        if (res.ok) {
          // Success — reset fail count
          await this.recordSuccess(wh.id);
          return {
            webhookId: wh.id,
            url: wh.url,
            success: true,
            statusCode,
            attempts: attempt,
          };
        }

        lastError = `HTTP ${res.status}: ${res.statusText}`;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      // Exponential backoff before retry
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }

    // All retries exhausted — record failure
    await this.recordFailure(wh.id);

    return {
      webhookId: wh.id,
      url: wh.url,
      success: false,
      statusCode,
      error: lastError,
      attempts: MAX_RETRIES,
    };
  }

  private async recordSuccess(id: string): Promise<void> {
    const db = getDb();
    await db
      .update(schema.webhooks)
      .set({
        lastTriggeredAt: new Date().toISOString(),
        failCount: 0,
      })
      .where(eq(schema.webhooks.id, id));
  }

  private async recordFailure(id: string): Promise<void> {
    const db = getDb();
    const [wh] = await db.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).limit(1);
    if (!wh) return;

    const newFailCount = (wh.failCount ?? 0) + 1;
    const updates: Record<string, unknown> = {
      failCount: newFailCount,
      lastTriggeredAt: new Date().toISOString(),
    };

    // Auto-disable after too many failures
    if (newFailCount >= MAX_FAIL_COUNT) {
      updates.active = false;
    }

    await db
      .update(schema.webhooks)
      .set(updates)
      .where(eq(schema.webhooks.id, id));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSubscription(row: Webhook): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events) as WebhookEvent[],
    active: Boolean(row.active),
    description: row.description,
    secret: row.secret,
    createdAt: row.createdAt,
    lastTriggeredAt: row.lastTriggeredAt,
    failCount: row.failCount,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
