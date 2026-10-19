import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api.js';
import { getStoredApiKey } from '../../lib/apiKey.js';
import { formatDateTime, formatRelative } from '../../lib/dates.js';
import { useServerStats } from '../../lib/serverStats.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTheme, type ColourMode } from '../../shell/theme.js';
import { Icon, type IconName } from '../../shell/icons.js';
import { ConnectClients } from '../onboarding/Welcome.js';
import './settings.css';

const MODES: { mode: ColourMode; label: string; icon: IconName }[] = [
  { mode: 'auto', label: 'Match system', icon: 'contrast' },
  { mode: 'light', label: 'Light', icon: 'sun' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
];

type Health = Awaited<ReturnType<typeof api.health>>;
type Decay = Awaited<ReturnType<typeof api.getDecayPolicy>>;
type Sync = Awaited<ReturnType<typeof api.getSyncStatus>>;
type Embeddings = Awaited<ReturnType<typeof api.getEmbeddingStatus>>;
type IndexStatus = Awaited<ReturnType<typeof api.getIndexStatus>>;

/** A read that failed is `'failed'`, one still on its way `undefined`. */
type Read<T> = T | 'failed' | undefined;

interface Reads {
  health: Read<Health>;
  decay: Read<Decay>;
  sync: Read<Sync>;
  embeddings: Read<Embeddings>;
  index: Read<IndexStatus>;
}

const NOTHING: Reads = { health: undefined, decay: undefined, sync: undefined, embeddings: undefined, index: undefined };

function settle<T>(promise: Promise<T>): Promise<T | 'failed'> {
  return promise.catch(() => 'failed' as const);
}

function known<T>(read: Read<T>): T | null {
  return read === undefined || read === 'failed' ? null : read;
}

/** `3600000` as "Every hour"; 0 means the sweep never runs on its own. */
export function describeInterval(ms: number | undefined): string {
  if (ms === undefined) return 'Unknown';
  if (ms <= 0) return 'Off';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `Every ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
}

/** Seconds of uptime as "3 hours", "2 days". */
export function describeUptime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * Settings and health: colour mode, connecting an AI, and what the running
 * server says about itself. Everything below Connect is read-only; the decay
 * policy, sync and re-embedding are changed from the CLI or the API.
 */
export default function SettingsView() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const stats = useServerStats();
  const live = useNeuralStore((s) => s.isConnected);
  const [reads, setReads] = useState<Reads>(NOTHING);

  const load = useCallback(() => {
    setReads(NOTHING);
    void Promise.all([
      settle(api.health()),
      settle(api.getDecayPolicy()),
      settle(api.getSyncStatus()),
      settle(api.getEmbeddingStatus()),
      settle(api.getIndexStatus()),
    ]).then(([health, decay, sync, embeddings, index]) => setReads({ health, decay, sync, embeddings, index }));
  }, []);

  useEffect(load, [load]);

  const health = known(reads.health);
  const decay = known(reads.decay);
  const sync = known(reads.sync);
  const embeddings = known(reads.embeddings);
  const index = known(reads.index);
  const pending = (read: Read<unknown>) => (read === undefined ? 'Checking…' : 'Could not read');
  const apiKey = getStoredApiKey();

  return (
    <div className="at-page st-page">
      <h1 className="at-display">Settings</h1>

      <section className="at-section" aria-labelledby="set-colours">
        <h2 id="set-colours">Colours</h2>
        <p>Paper and ink by day, a night chart after dark. Match system follows your device.</p>
        <div className="at-seg" role="radiogroup" aria-labelledby="set-colours">
          {MODES.map((m) => (
            <label key={m.mode} className="at-seg-opt">
              <input type="radio" name="colour-mode" value={m.mode} checked={mode === m.mode} onChange={() => setMode(m.mode)} />
              <Icon name={m.icon} size={16} />
              {m.label}
            </label>
          ))}
        </div>
      </section>

      <section className="at-section" aria-labelledby="set-connect">
        <h2 id="set-connect">Connect an AI</h2>
        <p>Add Engram to Claude Code, Claude Desktop, Cursor, VS Code or Codex. Copy the config, restart the tool, and it remembers from then on.</p>
        <ConnectClients />
        <a className="at-btn sec st-watch" href="#/welcome">
          <Icon name="plug" size={16} />
          Watch for the next memory
        </a>
      </section>

      <section className="at-section" aria-labelledby="set-health">
        <div className="st-h">
          <h2 id="set-health">Health</h2>
          <button type="button" className="mm-quiet" onClick={load}>
            Check again
          </button>
        </div>
        <dl className="st-rows">
          <Row
            label="Server"
            note={health ? `Up ${describeUptime(health.uptime)}` : undefined}
            state={reads.health === 'failed' ? 'bad' : health ? 'good' : undefined}
          >
            {health ? `Running, v${health.version}` : reads.health === 'failed' ? 'Not answering' : 'Checking…'}
          </Row>
          <Row
            label="Live updates"
            note={live ? 'New memories appear without a reload' : 'The dashboard shows what it last loaded'}
            state={live ? 'good' : 'bad'}
          >
            {live ? 'Connected' : 'Offline'}
          </Row>
          <Row label="Memories" note="Every project; archived memories are not counted">
            {stats ? stats.total.toLocaleString('en-US') : 'Checking…'}
          </Row>
          <Row label="Database" note="The file this server reads and writes">
            <span className="st-path">{stats?.dbPath ?? (stats ? 'Not reported' : 'Checking…')}</span>
          </Row>
          <Row label="Search index" note={index ? (index.persisted ? 'Saved to disk between restarts' : 'Rebuilt in memory at each start') : undefined}>
            {index ? `${index.entryCount.toLocaleString('en-US')} memories indexed` : pending(reads.index)}
          </Row>
          <Row
            label="Embeddings"
            note={
              embeddings
                ? embeddings.needsReEmbed
                  ? 'Some memories were embedded by another model, so search can miss them until they are re-embedded'
                  : `${embeddings.totalEmbedded.toLocaleString('en-US')} memories embedded, ${embeddings.currentDimension} dimensions`
                : undefined
            }
            state={embeddings ? (embeddings.needsReEmbed ? 'bad' : 'good') : undefined}
          >
            {embeddings ? embeddings.currentModel : pending(reads.embeddings)}
          </Row>
        </dl>
      </section>

      <section className="at-section" aria-labelledby="set-decay">
        <h2 id="set-decay">Forgetting</h2>
        <p>How memories fade when no AI recalls them. Shown here, changed through the API.</p>
        <dl className="st-rows">
          <Row label="Half-life" note={decay ? `Retention halves every ${decay.halfLifeDays} days without a recall` : undefined}>
            {decay ? `${decay.halfLifeDays} ${decay.halfLifeDays === 1 ? 'day' : 'days'}` : pending(reads.decay)}
          </Row>
          <Row label="Archive below" note="Pinned and protected memories are kept whatever their retention">
            {decay ? `${Math.round(decay.archiveThreshold * 100)}% retention` : pending(reads.decay)}
          </Row>
          <Row label="Decay sweep" note="When the server looks for memories to archive">
            {decay ? describeInterval(decay.decayIntervalMs) : pending(reads.decay)}
          </Row>
        </dl>
      </section>

      <section className="at-section" aria-labelledby="set-sync">
        <h2 id="set-sync">Cloud sync</h2>
        {sync && !sync.enabled ? (
          <p>Off. Set ENGRAM_SYNC_URL on the server to keep memories in step across devices.</p>
        ) : (
          <dl className="st-rows">
            <Row label="State" state={sync ? (sync.state === 'error' ? 'bad' : 'good') : undefined}>
              {sync ? describeSyncState(sync.state) : pending(reads.sync)}
            </Row>
            {sync && (
              <>
                <Row label="Last synced" note={sync.lastSyncAt ? formatDateTime(sync.lastSyncAt) : undefined}>
                  {sync.lastSyncAt ? formatRelative(sync.lastSyncAt) : 'Not yet'}
                </Row>
                <Row label="Waiting to push" note="Sent on the next cycle">
                  {(sync.pendingPushCount ?? 0).toLocaleString('en-US')}
                </Row>
                {sync.lastError && (
                  <Row label="Last error" state="bad">
                    {sync.lastError}
                  </Row>
                )}
              </>
            )}
          </dl>
        )}
      </section>

      <section className="at-section" aria-labelledby="set-access">
        <h2 id="set-access">Access</h2>
        <dl className="st-rows">
          <Row label="API key" note={apiKey ? 'Kept for this tab only, and forgotten when it closes' : 'Set ENGRAM_API_KEY on the server to require one'}>
            {apiKey ? 'Required, and this tab has it' : 'Not required'}
          </Row>
          <Row label="Dashboard" note="Where AI tools and the REST API reach this server">
            {window.location.origin}
          </Row>
        </dl>
      </section>

      {health && (
        <section className="at-section" aria-labelledby="set-about">
          <h2 id="set-about">About</h2>
          <p className="at-data">Engram server v{health.version}</p>
        </section>
      )}
    </div>
  );
}

function describeSyncState(state: Sync['state']): string {
  if (state === 'pushing') return 'Sending changes';
  if (state === 'pulling') return 'Fetching changes';
  if (state === 'error') return 'Failing';
  return 'Idle';
}

/** One fact: what it is and what it means on the left, the value on the right. */
function Row({ label, note, state, children }: { label: string; note?: string; state?: 'good' | 'bad'; children: ReactNode }) {
  return (
    <div className="st-row">
      <dt>
        {label}
        {note && <small>{note}</small>}
      </dt>
      <dd data-state={state}>
        {state && <i aria-hidden="true" />}
        <span>{children}</span>
      </dd>
    </div>
  );
}
