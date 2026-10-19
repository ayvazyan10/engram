import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useServerStats } from '../../lib/serverStats.js';
import { getStoredApiKey } from '../../lib/apiKey.js';
import { Icon } from '../../shell/icons.js';
import { MemoryRow } from '../memory/MemoryRow.js';
import './onboarding.css';

const PACKAGE_ARGS = '"-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"';

function jsonConfig(key: string, source: string, extra = ''): string {
  return `{
  "${key}": {
    "engram": {
${extra}      "command": "npx",
      "args": [${PACKAGE_ARGS}],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "${source}"
      }
    }
  }
}`;
}

export interface ClientSetup {
  /** Shown on the choice when a client has more than one way in. */
  label?: string;
  where: string;
  code: string;
}

/**
 * One entry per client, with the snippets docs/INTEGRATIONS.md and the README
 * publish. Claude Code has two ways in, the plugin or `engram setup`; they are
 * alternatives, and using both registers Engram twice.
 */
export const CLIENTS: { id: string; name: string; setups: ClientSetup[]; note?: string }[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    setups: [
      {
        label: 'Plugin (recommended)',
        where: 'Run these two commands inside Claude Code:',
        code: '/plugin marketplace add ayvazyan10/engram\n/plugin install engram@engram',
      },
      {
        label: 'engram setup',
        where: 'Run this once in a terminal:',
        code: 'npx -y @engram-ai-memory/cli setup --npx --source claude-code',
      },
    ],
    note: 'Use the plugin or engram setup, never both: with both, Engram is connected twice and every session is stored twice.',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    setups: [
      {
        where: 'Add this to claude_desktop_config.json (Settings, Developer, Edit Config), then restart Claude Desktop:',
        code: jsonConfig('mcpServers', 'claude-desktop'),
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    setups: [{ where: 'Add this to ~/.cursor/mcp.json, then reload Cursor:', code: jsonConfig('mcpServers', 'cursor') }],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    setups: [{ where: 'Add this to .vscode/mcp.json in your project:', code: jsonConfig('servers', 'vscode', '      "type": "stdio",\n') }],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    setups: [
      {
        where: 'Add this to ~/.codex/config.toml:',
        code: `[mcp_servers.engram]
command = "npx"
args = [${PACKAGE_ARGS}]
env = { ENGRAM_DB_PATH = "~/.engram/engram.db", ENGRAM_SOURCE = "codex" }
startup_timeout_sec = 60`,
      },
    ],
  },
];

/** Left/Right (and Home/End) move between tabs, as a tablist should. */
function stepTab(event: KeyboardEvent<HTMLElement>, count: number, at: number): number | null {
  const next =
    event.key === 'ArrowRight' ? (at + 1) % count
    : event.key === 'ArrowLeft' ? (at - 1 + count) % count
    : event.key === 'Home' ? 0
    : event.key === 'End' ? count - 1
    : null;
  if (next === null) return null;
  event.preventDefault();
  const tabs = event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
  tabs[next]?.focus();
  return next;
}

/**
 * Step one of connecting an AI, shared by Welcome and Settings: pick a client,
 * copy its config, and the two facts a config needs.
 */
export function ConnectClients() {
  const [clientAt, setClientAt] = useState(0);
  const [setupAt, setSetupAt] = useState(0);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const client = CLIENTS[clientAt]!;
  const setup = client.setups[setupAt] ?? client.setups[0]!;

  const pickClient = (i: number) => {
    setClientAt(i);
    setSetupAt(0);
    setCopy('idle');
  };

  const copyCode = () => {
    // A browser without the async clipboard (plain http on another host) has none to call.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(setup.code))
      .then(() => setCopy('copied'))
      .catch(() => setCopy('failed'));
  };

  return (
    <div className="wc-connect">
      <div
        className="wc-clients"
        role="tablist"
        aria-label="AI client"
        onKeyDown={(e) => {
          const next = stepTab(e, CLIENTS.length, clientAt);
          if (next !== null) pickClient(next);
        }}
      >
        {CLIENTS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            id={`wc-tab-${c.id}`}
            aria-selected={i === clientAt}
            aria-controls="wc-panel"
            tabIndex={i === clientAt ? 0 : -1}
            onClick={() => pickClient(i)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div id="wc-panel" role="tabpanel" aria-labelledby={`wc-tab-${client.id}`} className="wc-panel">
        {client.setups.length > 1 && (
          <div className="at-seg wc-ways" role="radiogroup" aria-label={`How to add Engram to ${client.name}`}>
            {client.setups.map((s, i) => (
              <label key={s.label} className="at-seg-opt">
                <input
                  type="radio"
                  name={`wc-way-${client.id}`}
                  checked={i === setupAt}
                  onChange={() => {
                    setSetupAt(i);
                    setCopy('idle');
                  }}
                />
                {s.label}
              </label>
            ))}
          </div>
        )}
        {client.note && <p className="wc-note">{client.note}</p>}
        <div className="wc-where">
          <p>{setup.where}</p>
          <button type="button" className="at-btn" onClick={copyCode}>
            <CopyIcon />
            {copy === 'copied' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="wc-code">
          <code>{setup.code}</code>
        </pre>
        {copy === 'failed' && (
          <p className="wc-alert" role="alert">
            The browser blocked the clipboard. Select the text above and copy it.
          </p>
        )}
      </div>

      <dl className="wc-facts">
        <div>
          <dt>Dashboard server</dt>
          <dd>{window.location.origin}</dd>
        </div>
        <div>
          <dt>API key</dt>
          <dd>{getStoredApiKey() ? 'Required: REST clients send it as the X-API-Key header' : 'Not required on this machine'}</dd>
        </div>
      </dl>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true" focusable="false">
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5v-3a1 1 0 00-1-1h-9a1 1 0 00-1 1v9a1 1 0 001 1h3" />
    </svg>
  );
}

interface Props {
  /** True while the shell's memory list is still loading. */
  loading: boolean;
  /** Reloads the memory list. An MCP client writes to the database directly,
   *  so its memory reaches the census (GET /stats) before any socket event. */
  onRefresh: () => void;
  /** Leaves for the map. */
  onDone: () => void;
}

/**
 * First run, over uncharted ground: connect a client, then wait, live, for
 * the first memory it stores. From Settings, on a store that already holds
 * memories, the same steps wait for the next one instead.
 */
export default function Welcome({ loading, onRefresh, onDone }: Props) {
  const records = useMemoryStore((s) => s.records);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const total = useServerStats()?.total;
  // The newest memory when the page opened (null: none). Anything newer arrived while it was open.
  const [baseline, setBaseline] = useState<string | null | undefined>(() => (loading ? undefined : (records[0]?.id ?? null)));
  const lastTotal = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!loading && baseline === undefined) setBaseline(useMemoryStore.getState().records[0]?.id ?? null);
  }, [loading, baseline]);

  useEffect(() => {
    if (total === undefined) return;
    const before = lastTotal.current;
    lastTotal.current = total;
    if (before === undefined ? total > 0 && useMemoryStore.getState().records.length === 0 : total > before) onRefresh();
  }, [total, onRefresh]);

  const first = baseline !== undefined && records[0] && records[0].id !== baseline ? records[0] : null;
  const empty = baseline === null;

  return (
    <div className="wc-stage">
      <Uncharted />
      <section className="wc-card" aria-labelledby="wc-title">
        <h1 id="wc-title" className="wc-title">
          {empty || baseline === undefined ? 'Nothing charted yet' : 'Connect your AI in 30 seconds'}
        </h1>
        <p className="wc-lede">
          {empty || baseline === undefined
            ? 'Engram has no memories yet. Connect your AI in 30 seconds, and every memory it stores becomes a place on the map.'
            : 'Add Engram to another AI tool. What it stores joins the memories already on the map.'}
        </p>

        <ol className="wc-steps">
          <li>
            <span className="wc-num" aria-hidden="true">1</span>
            <div>
              <h2>Add Engram to your AI</h2>
              <ConnectClients />
            </div>
          </li>
          <li>
            {first ? (
              <span className="wc-num wc-pin" aria-hidden="true">
                <svg viewBox="0 0 40 52" width={26} height={34}>
                  <path d="M20 50C17 40 6 32 6 20a14 14 0 0128 0c0 12-11 20-14 30z" />
                  <circle cx="20" cy="20" r="5.5" />
                </svg>
              </span>
            ) : (
              <span className="wc-num" aria-hidden="true">2</span>
            )}
            <div aria-live="polite">
              {first ? (
                <>
                  <h2>{empty ? 'Your first memory arrived' : 'A new memory arrived'}</h2>
                  <p className="wc-p">It is on the map now. Every memory lands the same way, live.</p>
                  <div className="wc-arrived">
                    <MemoryRow record={first} current={first.id === selectedId} onOpen={selectNeuron} />
                  </div>
                  <button type="button" className="at-btn" onClick={onDone}>
                    <Icon name="map" size={16} />
                    Open the map
                  </button>
                </>
              ) : (
                <>
                  <h2>Ask it to remember something</h2>
                  <p className="wc-wait">
                    <span className="wc-pulse" aria-hidden="true" />
                    <span>
                      Waiting for {empty || baseline === undefined ? 'your first memory' : 'the next memory'}. Restart your AI tool, then
                      try “Remember that I prefer pnpm over npm.”
                    </span>
                  </p>
                </>
              )}
            </div>
          </li>
        </ol>
      </section>
    </div>
  );
}

/** Blank survey paper: a graticule, a dotted coast, a compass and the word for it. */
function Uncharted() {
  const lines: string[] = [];
  for (let x = 40; x < 1280; x += 80) lines.push(`M${x} 0V800`);
  for (let y = 40; y < 800; y += 80) lines.push(`M0 ${y}H1280`);
  return (
    <svg className="wc-paper" viewBox="0 0 1280 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path className="wc-grat" d={lines.join('')} />
      <path
        className="wc-coast"
        d="M110 690c60-40 40-120 120-150s150 30 210-20 40-150 140-170 170 50 230 10 60-120 150-110 120 90 110 160-80 110-40 170 120 70 110 120"
      />
      <g className="wc-rose" transform="translate(1170 690)">
        <circle r="26" />
        <path d="M0-36V36M-36 0H36" />
        <path className="wc-needle" d="M0-22l5 22-5 22-5-22z" />
      </g>
      <text className="wc-word" x="150" y="660">
        Uncharted
      </text>
    </svg>
  );
}
