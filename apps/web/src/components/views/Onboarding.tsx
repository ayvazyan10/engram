import { useEffect, useState } from 'react';
import { useMemoryStore } from '../../store/memoryStore.js';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useTemplateStore } from '../../store/templateStore.js';
import { useServerStats } from '../../lib/serverStats.js';
import { getStoredApiKey } from '../../lib/apiKey.js';
import { RADIUS, SPACE, STATUS, TYPE, WEIGHT, withAlpha } from '../../lib/tokens.js';
import { segmentBase, segmentState, trackStyle } from '../ui/segmented.js';
import MemoryCard from '../ui/MemoryCard.js';

const PACKAGE_ARGS = '"-y", "-p", "@engram-ai-memory/mcp@latest", "engram-mcp"';

/** One entry per client: where the snippet goes, and the snippet itself.
 *  The snippets are the ones docs/INTEGRATIONS.md and the README publish. */
export const CLIENTS: { id: string; name: string; where: string; code: string }[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    where: 'Run this once in a terminal:',
    code:
      'claude mcp add engram -s user -e ENGRAM_DB_PATH=$HOME/.engram/engram.db ' +
      '-e ENGRAM_SOURCE=claude-code -- npx -y -p @engram-ai-memory/mcp@latest engram-mcp',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    where: 'Add this to claude_desktop_config.json (Settings → Developer → Edit Config), then restart Claude Desktop:',
    code: `{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": [${PACKAGE_ARGS}],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "claude-desktop"
      }
    }
  }
}`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    where: 'Add this to ~/.cursor/mcp.json, then reload Cursor:',
    code: `{
  "mcpServers": {
    "engram": {
      "command": "npx",
      "args": [${PACKAGE_ARGS}],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "cursor"
      }
    }
  }
}`,
  },
  {
    id: 'vscode',
    name: 'VS Code',
    where: 'Add this to .vscode/mcp.json in your project:',
    code: `{
  "servers": {
    "engram": {
      "type": "stdio",
      "command": "npx",
      "args": [${PACKAGE_ARGS}],
      "env": {
        "ENGRAM_DB_PATH": "~/.engram/engram.db",
        "ENGRAM_SOURCE": "vscode"
      }
    }
  }
}`,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    where: 'Add this to ~/.codex/config.toml:',
    code: `[mcp_servers.engram]
command = "npx"
args = [${PACKAGE_ARGS}]
env = { ENGRAM_DB_PATH = "~/.engram/engram.db", ENGRAM_SOURCE = "codex" }
startup_timeout_sec = 60`,
  },
];

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

interface Props {
  /** Reloads the memory list. Called when the store's census says memories
   *  exist that the list has not seen — an MCP client writes to the database
   *  directly, so its first memory never arrives as a socket event. */
  onRefresh: () => void;
  /** Leaves onboarding for the normal Home view. */
  onDone: () => void;
}

/**
 * First run: shown on Home while the store is empty. Pick a client, copy its
 * config, and watch for the first memory — a `memory:stored` event lands it
 * in the memory store, and this step turns into that memory's card.
 */
export default function Onboarding({ onRefresh, onDone }: Props) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const records = useMemoryStore((s) => s.records);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const stats = useServerStats();
  const [clientId, setClientId] = useState(CLIENTS[0]!.id);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const client = CLIENTS.find((c) => c.id === clientId) ?? CLIENTS[0]!;
  const first = records[0];
  const total = stats?.total ?? 0;

  useEffect(() => {
    if (!first && total > 0) onRefresh();
  }, [first, total, onRefresh]);

  const copyCode = () => {
    navigator.clipboard
      .writeText(client.code)
      .then(() => setCopy('copied'))
      .catch(() => setCopy('failed'));
  };

  const pickClient = (id: string) => {
    setClientId(id);
    setCopy('idle');
  };

  return (
    <section aria-labelledby="ec-onboarding-title" style={s.page}>
      <h1 id="ec-onboarding-title" style={{ ...s.title, color: t.textPrimary }}>
        Connect your AI in 30 seconds
      </h1>
      <p style={{ ...s.lead, color: t.textSecondary }}>
        Engram has no memories yet. Add it to the AI tool you use, and everything it remembers shows up here.
      </p>

      <ol style={s.steps}>
        <li style={s.step}>
          <StepNumber n={1} done={false} />
          <div style={s.stepBody}>
            <h2 style={{ ...s.stepTitle, color: t.textPrimary }}>Add Engram to your AI</h2>
            <div role="tablist" aria-label="AI client" style={{ ...trackStyle(t), flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%' }}>
              {CLIENTS.map((c) => {
                const active = c.id === client.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="ec-onboarding-panel"
                    className="ec-hover-tint"
                    style={{ ...segmentBase, ...segmentState(t, active) }}
                    onClick={() => pickClient(c.id)}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <div id="ec-onboarding-panel" role="tabpanel" aria-label={client.name} style={s.panel}>
              <div style={s.whereRow}>
                <p style={{ ...s.where, color: t.textSecondary }}>{client.where}</p>
                <button
                  type="button"
                  className="ec-primary"
                  onClick={copyCode}
                  style={{ ...s.copyBtn, background: t.accentStrong, color: t.onAccent }}
                >
                  {copy === 'copied' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre style={{ ...s.code, color: t.textPrimary, background: t.inputBg, borderColor: t.panelBorder }}>
                <code>{client.code}</code>
              </pre>
              {copy === 'failed' && (
                <p role="alert" style={{ ...s.note, color: STATUS.danger }}>
                  The browser blocked the clipboard. Select the text above and copy it.
                </p>
              )}
            </div>
            <dl style={{ ...s.facts, color: t.textMuted }}>
              <div style={s.fact}>
                <dt>Dashboard server</dt>
                <dd className="ec-tabular" style={{ ...s.factValue, color: t.textPrimary }}>{window.location.origin}</dd>
              </div>
              <div style={s.fact}>
                <dt>API key</dt>
                <dd style={{ ...s.factValue, color: t.textPrimary }}>
                  {getStoredApiKey()
                    ? 'Required — REST clients send it as the X-API-Key header'
                    : 'Not required'}
                </dd>
              </div>
            </dl>
          </div>
        </li>

        <li style={s.step}>
          <StepNumber n={2} done={Boolean(first)} />
          <div style={s.stepBody} aria-live="polite">
            {first ? (
              <>
                <h2 style={{ ...s.stepTitle, color: t.textPrimary }}>Your first memory arrived</h2>
                <MemoryCard record={first} selected={first.id === selectedId} onSelect={selectNeuron} />
                <button
                  type="button"
                  className="ec-primary"
                  onClick={onDone}
                  style={{ ...s.doneBtn, background: t.accentStrong, color: t.onAccent }}
                >
                  Go to your memories
                </button>
              </>
            ) : (
              <>
                <h2 style={{ ...s.stepTitle, color: t.textPrimary, display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
                  <svg style={s.spinner} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke={t.accent} strokeWidth="2.5" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" />
                  </svg>
                  Waiting for your first memory…
                </h2>
                <p style={{ ...s.note, color: t.textSecondary }}>
                  Restart your AI tool, then ask it to remember something — for example,
                  &ldquo;Remember that I prefer pnpm over npm.&rdquo; It appears here as soon as it is stored.
                </p>
              </>
            )}
          </div>
        </li>
      </ol>
    </section>
  );
}

function StepNumber({ n, done }: { n: number; done: boolean }) {
  const t = useTemplateStore((s) => s.activeTemplate);
  const color = done ? STATUS.success : t.textSecondary;
  return (
    <span
      aria-hidden="true"
      className="ec-tabular"
      style={{ ...s.number, color, borderColor: done ? withAlpha(STATUS.success, 0.5) : t.panelBorder }}
    >
      {done ? '✓' : n}
    </span>
  );
}

const s = {
  page: {
    width: '100%',
    maxWidth: 760,
    margin: '0 auto',
    padding: `${SPACE['3xl']} ${SPACE.lg} ${SPACE['3xl']}`,
  },
  title: { margin: 0, fontSize: TYPE.display, fontWeight: WEIGHT.semibold, lineHeight: 1.2, letterSpacing: '-0.015em' },
  lead: { margin: `${SPACE.sm} 0 0`, fontSize: TYPE.lg, lineHeight: 1.5, maxWidth: '60ch' },
  steps: { listStyle: 'none', margin: `${SPACE['2xl']} 0 0`, padding: 0, display: 'flex', flexDirection: 'column' as const, gap: SPACE['2xl'] },
  step: { display: 'flex', gap: SPACE.md, alignItems: 'flex-start' },
  number: {
    flexShrink: 0,
    width: 26,
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid',
    borderRadius: RADIUS.pill,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.semibold,
  },
  stepBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const, gap: SPACE.md },
  stepTitle: { margin: 0, fontSize: TYPE.xl, fontWeight: WEIGHT.semibold, lineHeight: 1.5 },
  panel: { display: 'flex', flexDirection: 'column' as const, gap: SPACE.sm, minWidth: 0 },
  whereRow: { display: 'flex', alignItems: 'flex-end', gap: SPACE.md, minWidth: 0 },
  where: { flex: 1, minWidth: 0, margin: 0, fontSize: TYPE.base, lineHeight: 1.5 },
  // Wraps at spaces only, so a flag never parts from its value mid-token;
  // a token longer than the line scrolls instead of breaking.
  code: {
    margin: 0,
    padding: SPACE.md,
    border: '1px solid',
    borderRadius: RADIUS.md,
    fontFamily: MONO,
    fontSize: TYPE.sm,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap' as const,
    overflowX: 'auto' as const,
  },
  copyBtn: {
    flexShrink: 0,
    minHeight: 28,
    padding: `0 ${SPACE.md}`,
    border: 'none',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.sm,
    fontWeight: WEIGHT.semibold,
    fontFamily: 'inherit',
  },
  note: { margin: 0, fontSize: TYPE.base, lineHeight: 1.5 },
  facts: { margin: 0, display: 'flex', flexWrap: 'wrap' as const, gap: `${SPACE.xs} ${SPACE['2xl']}`, fontSize: TYPE.sm },
  fact: { display: 'flex', flexDirection: 'column' as const, gap: SPACE['3xs'], minWidth: 0 },
  factValue: { margin: 0, fontSize: TYPE.base, overflowWrap: 'anywhere' as const },
  spinner: { width: 16, height: 16, flexShrink: 0, animation: 'ec-spin 0.8s linear infinite' },
  doneBtn: {
    alignSelf: 'flex-start',
    minHeight: 32,
    padding: `0 ${SPACE.lg}`,
    border: 'none',
    borderRadius: RADIUS.sm,
    fontSize: TYPE.base,
    fontWeight: WEIGHT.semibold,
    fontFamily: 'inherit',
  },
} as const;
