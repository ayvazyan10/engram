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

import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { createHmac } from 'crypto';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { getDb, schema } from '../db/index.js';
import { readEnvNumberOr } from '../lifecycle/envConfig.js';
import type { EnvSource } from '../lifecycle/envConfig.js';
import type { Webhook } from '../db/schema.js';
import {
  assertSafeWebhookTarget,
  assertSafeWebhookUrl,
  type HostResolver,
  type SafeWebhookTarget,
} from './urlGuard.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'stored'
  | 'forgotten'
  | 'decayed'
  | 'consolidated'
  | 'contradiction'
  | 'reflected';

export const ALL_EVENTS: WebhookEvent[] = [
  'stored', 'forgotten', 'decayed', 'consolidated', 'contradiction', 'reflected',
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
  /**
   * Whether an HMAC secret is configured — never the secret itself.
   *
   * The value is what a receiver uses to verify `X-Engram-Signature`, so
   * handing it back on a read lets anyone with API read access forge
   * deliveries the receiver will accept. It is write-only: supplied on
   * subscribe, kept in the row for the signer, and never serialized out
   * again. A caller that has lost it rotates it by re-subscribing.
   */
  hasSecret: boolean;
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

/** Upper bound on concurrent background dispatches when nothing overrides it. */
const DEFAULT_MAX_CONCURRENT_DISPATCH = 32;

/**
 * Resolve the dispatch ceiling from the environment.
 *
 * This was `parseInt(env ?? '32', 10)` with nothing looking at the result, so
 * `ENGRAM_WEBHOOK_MAX_CONCURRENCY=many` produced `NaN` — and `this.inFlight >=
 * NaN` is false for every value of `inFlight`, which removed the bound
 * entirely. The limit that exists to stop a single batch-store from stacking
 * hundreds of detached deliveries disappeared exactly when someone had tried
 * to configure it.
 *
 * A tuning knob rather than a security control: the safe reading of a
 * malformed value is the documented default, announced on stderr, not a dead
 * process. `readEnvNumberOr` is what makes that choice explicit — the same
 * parse and the same bounds as the strict readers, a different answer to
 * "and then what".
 *
 * Exported so the branches are testable without re-importing the module for
 * each one; `fire()` reads the module constant below.
 */
export function resolveMaxConcurrentDispatch(
  env: EnvSource,
  warn?: (message: string) => void
): number {
  return readEnvNumberOr(
    env,
    'ENGRAM_WEBHOOK_MAX_CONCURRENCY',
    DEFAULT_MAX_CONCURRENT_DISPATCH,
    { min: 1 },
    warn
  );
}

const MAX_CONCURRENT_DISPATCH = resolveMaxConcurrentDispatch(process.env);

/** Base delay for exponential backoff (ms). */
const RETRY_BASE_MS = 500;

/** Default per-attempt request timeout (ms). */
const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookManagerOptions {
  /** Injectable DNS resolver for the SSRF guard (tests). */
  readonly lookup?: HostResolver;
  /** Per-attempt request timeout in ms. Defaults to REQUEST_TIMEOUT_MS. */
  readonly requestTimeoutMs?: number;
}

// ─── Manager ─────────────────────────────────────────────────────────────────

export class WebhookManager {
  /** Background dispatches currently in flight (bounded by MAX_CONCURRENT_DISPATCH). */
  private inFlight = 0;
  /** Events dropped because the dispatch queue was saturated. */
  private dropped = 0;

  constructor(private readonly options: WebhookManagerOptions = {}) {}

  /** Guard options for this manager (resolver injection point). */
  private guardOptions(): { lookup?: HostResolver } {
    return this.options.lookup ? { lookup: this.options.lookup } : {};
  }

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
    // Reject SSRF targets (loopback, link-local metadata, RFC1918) before the
    // subscription is ever persisted.
    await assertSafeWebhookUrl(opts.url, this.guardOptions());

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
      // Deliberately not echoing `opts.secret`: the caller supplied it, so
      // returning it adds nothing and puts it in one more log/response body.
      hasSecret: Boolean(opts.secret),
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
    // Bounded queue. Each delivery can take ~30s (3 attempts x 10s timeout plus
    // backoff) and nothing limited how many ran at once — a single batch-store
    // request could stack hundreds of detached deliveries, each holding a socket
    // and its payload.
    if (this.inFlight >= MAX_CONCURRENT_DISPATCH) {
      this.dropped++;
      console.error(
        `[engram] webhook dispatch saturated (${MAX_CONCURRENT_DISPATCH} in flight) — dropped '${event}' (${this.dropped} total dropped)`
      );
      return;
    }

    this.inFlight++;
    // Fire-and-forget, but the rejection MUST be handled here: fireAsync used to
    // be launched bare, so a DB error during background dispatch became an
    // unhandled rejection and terminated the process.
    this.fireAsync(event, data)
      .catch((err: unknown) => {
        console.error('[engram] webhook dispatch failed:', err);
      })
      .finally(() => {
        this.inFlight--;
      });
  }

  /** Number of background dispatches currently running. */
  getInFlightCount(): number {
    return this.inFlight;
  }

  /** Number of events dropped because the dispatch queue was saturated. */
  getDroppedCount(): number {
    return this.dropped;
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
      // One corrupt row or one failing delivery must not abort dispatch to the
      // remaining webhooks.
      try {
        const events: WebhookEvent[] = JSON.parse(wh.events);
        if (!Array.isArray(events) || !events.includes(event)) continue;

        const result = await this.deliver(wh, payload);
        results.push(result);
      } catch (err: unknown) {
        console.error(`[engram] webhook ${wh.id} dispatch failed:`, err);
        results.push({
          webhookId: wh.id,
          url: wh.url,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          attempts: 0,
        });
      }
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

    // Re-validate at delivery time, not just at subscribe time: DNS can be
    // repointed at a private address after the subscription was created.
    //
    // The validated addresses come back with the URL and are pinned into the
    // socket below. Checking an address and then letting the transport resolve
    // the hostname a second time is not a check at all: an attacker-controlled
    // nameserver only has to answer "public" here and "169.254.169.254" a
    // millisecond later, and deliveries fire often enough to keep trying.
    let target: SafeWebhookTarget;
    try {
      target = await assertSafeWebhookTarget(wh.url, this.guardOptions());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordFailure(wh.id);
      return { webhookId: wh.id, url: wh.url, success: false, error: message, attempts: 0 };
    }

    const timeoutMs = this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await postJson(target, body, headers, timeoutMs);

        statusCode = res.status;

        if (res.status >= 200 && res.status < 300) {
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

        // 4xx (other than 408/429) are permanent — retrying just hammers the
        // endpoint and burns the retry budget.
        const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
        if (!retryable) break;
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

    // Increment and auto-disable in a single statement. The previous
    // read-compute-write lost increments under concurrent deliveries, so a dead
    // endpoint kept being hammered well past MAX_FAIL_COUNT.
    await db
      .update(schema.webhooks)
      .set({
        failCount: sql`${schema.webhooks.failCount} + 1`,
        lastTriggeredAt: new Date().toISOString(),
        active: sql`CASE WHEN ${schema.webhooks.failCount} + 1 >= ${MAX_FAIL_COUNT} THEN 0 ELSE ${schema.webhooks.active} END`,
      })
      .where(eq(schema.webhooks.id, id));
  }
}

// ─── Transport ───────────────────────────────────────────────────────────────

interface DeliveryResponse {
  readonly status: number;
  readonly statusText: string;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void;

/**
 * A `dns.lookup` replacement that answers with the addresses the SSRF guard
 * already cleared, whatever hostname it is handed.
 *
 * This is the piece that actually closes the DNS-rebinding window. Everything
 * else — validating at subscribe time, re-validating at delivery time — only
 * inspects an answer; this makes the inspected answer the one the socket uses.
 */
function createPinnedLookup(addresses: readonly string[]): net.LookupFunction {
  const pinned: dns.LookupAddress[] = addresses.map((address) => ({
    address,
    family: net.isIPv6(address) ? 6 : 4,
  }));

  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    // Node asks for every address when Happy Eyeballs is on (the default since
    // Node 20) and for a single one otherwise — answer in the shape requested.
    if (options.all === true) {
      callback(null, [...pinned]);
      return;
    }

    const first = pinned[0];
    if (first === undefined) {
      callback(new Error(`No validated address to connect to for ${hostname}`), '');
      return;
    }
    callback(null, first.address, first.family);
  };
}

function buildRequestOptions(
  target: SafeWebhookTarget,
  body: string,
  headers: Readonly<Record<string, string>>
): https.RequestOptions {
  const { url, addresses } = target;
  const isHttps = url.protocol === 'https:';
  // `url.hostname` keeps the brackets on an IPv6 literal; node wants it bare
  // and re-brackets it itself when building the Host header. Passing the
  // hostname (not the pinned IP) also keeps Host and TLS SNI correct.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  return {
    protocol: url.protocol,
    hostname,
    port: url.port !== '' ? Number(url.port) : isHttps ? 443 : 80,
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
    // A fresh, unpooled connection per delivery. The global agent keys its
    // socket pool on host:port and knows nothing about `lookup`, so a pooled
    // socket could outlive the address check that authorised it.
    agent: false,
    // Empty only when ENGRAM_WEBHOOK_ALLOW_PRIVATE short-circuited the guard,
    // in which case no address was validated and there is nothing to pin.
    ...(addresses.length > 0 ? { lookup: createPinnedLookup(addresses) } : {}),
  };
}

/**
 * POST a JSON body to a target the guard has cleared.
 *
 * Uses node:http(s) rather than `fetch`: the socket must go to the address the
 * guard validated, and the global fetch offers no way to override its own DNS
 * resolution without pulling in undici directly.
 *
 * Redirects are never followed — node's client does not follow them at all, so
 * a 302 to 169.254.169.254 surfaces as an ordinary non-2xx status and is
 * reported as a delivery failure.
 */
function postJson(
  target: SafeWebhookTarget,
  body: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number
): Promise<DeliveryResponse> {
  const transport = target.url.protocol === 'https:' ? https : http;

  return new Promise<DeliveryResponse>((resolve, reject) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;

    const finish = (act: () => void): void => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimeout(deadline);
      act();
    };

    const req = transport.request(buildRequestOptions(target, body, headers), (res) => {
      // The response body is unused, but it must be drained or the socket and
      // its buffers stay pinned until the process exits.
      res.resume();
      res.on('end', () =>
        finish(() =>
          resolve({ status: res.statusCode ?? 0, statusText: res.statusMessage ?? '' })
        )
      );
      res.on('error', (err: Error) => finish(() => reject(err)));
    });

    const timedOut = (): void => {
      req.destroy(new Error(`Webhook request timed out after ${timeoutMs}ms`));
    };

    // setTimeout() on the request is a socket-inactivity timeout, which a
    // slow-drip server can reset forever; the timer is the hard deadline.
    req.setTimeout(timeoutMs, timedOut);
    deadline = setTimeout(timedOut, timeoutMs);
    req.on('error', (err: Error) => finish(() => reject(err)));
    req.end(body);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSubscription(row: Webhook): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events) as WebhookEvent[],
    active: Boolean(row.active),
    description: row.description,
    // Mirrors the signer's own `if (wh.secret)` test in deliver(), so
    // hasSecret is true exactly when a delivery would actually be signed.
    hasSecret: Boolean(row.secret),
    createdAt: row.createdAt,
    lastTriggeredAt: row.lastTriggeredAt,
    failCount: row.failCount,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
