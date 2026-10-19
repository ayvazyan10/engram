import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type ReviewSingle, type SecretFinding } from '../../lib/api.js';
import { toPlainText } from '../../lib/plainText.js';
import { ActButton, Keys, MemoryMeta, percent, type Action } from './parts.js';

/** What each scanner rule found, in words. Unknown rules show their name. */
const RULES: Record<string, string> = {
  'github-token': 'GitHub token',
  'gitlab-token': 'GitLab token',
  'aws-access-key': 'AWS access key',
  'ai-api-key': 'AI API key',
  'cloudflare-api-token': 'Cloudflare API token',
  'cloudflare-tunnel-token': 'Cloudflare tunnel token',
  'slack-token': 'Slack token',
  'stripe-key': 'Stripe key',
  jwt: 'Signed token (JWT)',
  'private-key': 'Private key',
  'url-credentials': 'Password in a URL',
  'keyword-assignment': 'Password or key',
  'keyword-entropy': 'Key-like string',
};

const FIELD: Record<SecretFinding['field'], string> = {
  content: 'in the text',
  concept: 'in the concept',
  summary: 'in the summary',
};

const MASK = '[REDACTED]';

/** The server has already masked every secret span; draw each mask as a bar. */
function Masked({ text, className = 'rv-body' }: { text: string; className?: string }) {
  const parts = text.split(MASK);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      out.push(
        <span key={`m${i}`} className="rv-mask" role="img" aria-label="hidden value">
          hidden
        </span>
      );
    }
    if (part) out.push(<span key={`t${i}`}>{part}</span>);
  });
  return <p className={className}>{out}</p>;
}

// The decay policy is the server's and does not change while the page is
// open: ask once, and again only after a failure.
let policy: Promise<{ archiveThreshold: number }> | null = null;
function useArchiveThreshold(): number | null {
  const [threshold, setThreshold] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    policy ??= api.getDecayPolicy();
    policy.then(
      (p) => live && setThreshold(p.archiveThreshold),
      () => {
        policy = null;
      }
    );
    return () => {
      live = false;
    };
  }, []);
  return threshold;
}

function Meter({ label, value, mark }: { label: string; value: number; mark?: number | null }) {
  return (
    <div className="rv-meter">
      <span>{label}</span>
      <span className="rv-meter-track" aria-hidden="true">
        <i style={{ width: percent(Math.min(1, Math.max(0, value))) }} />
        {mark != null && <b style={{ left: percent(mark) }} />}
      </span>
      <span className="rv-num">{percent(value)}</span>
    </div>
  );
}

function FadingCard({ item, position, busy, onAct }: CardProps) {
  const threshold = useArchiveThreshold();
  const { memory, retention } = item;
  return (
    <>
      <div className="rv-card-head">
        <h2 className="rv-h">Important, but fading</h2>
        <span className="rv-pos">{position}</span>
      </div>
      <p className="rv-why">
        Marked {percent(memory.importance)} important, but retention is down to {percent(retention)}.
        {threshold != null && ` Below ${percent(threshold)} the decay sweep archives it, unless you pin it.`}
      </p>
      <section className="rv-col rv-single" aria-label="Memory">
        <MemoryMeta memory={memory} />
        <p className="rv-body">{toPlainText(memory.content)}</p>
        <div className="rv-meters">
          <Meter label="Importance" value={memory.importance} />
          <Meter label="Retention" value={retention} mark={threshold} />
        </div>
      </section>
      <div className="rv-actions">
        <ActButton label="Pin so it never fades" keyName="p" kind="pri" onClick={() => onAct('pin')} disabled={busy} />
        <ActButton label="Let it fade" keyName="d" onClick={() => onAct('dismiss')} disabled={busy} />
        <Keys keys={[['j', 'next'], ['k', 'back'], ['o', 'open'], ['x', 'select']]} />
      </div>
    </>
  );
}

/**
 * A memory the scanner flagged. Nothing here ever holds the value: the text
 * arrives masked and a finding carries only a masked preview. Redact asks
 * first, showing exactly those previews.
 */
function SecretCard({ item, position, busy, onAct, confirming, setConfirming }: CardProps) {
  const findings = item.findings ?? [];
  const confirmRef = useRef<HTMLButtonElement>(null);
  const noun = findings.length === 1 ? 'value' : 'values';

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <>
      <div className="rv-card-head">
        <h2 className="rv-h">This looks like a secret</h2>
        <span className="rv-pos">{position}</span>
      </div>
      <p className="rv-why">
        Your AI is handed this text whenever a recall matches it, and it syncs to your other devices. The values are
        hidden here.
      </p>
      <section className="rv-col rv-single" aria-label="Memory">
        <MemoryMeta memory={item.memory} />
        {item.memory.concept && <Masked text={item.memory.concept} className="rv-concept" />}
        <Masked text={toPlainText(item.memory.content)} />
        <ul className="rv-findings" aria-label="What the scanner found">
          {findings.map((f, i) => (
            <li key={i}>
              <span>
                {RULES[f.rule] ?? f.rule} {FIELD[f.field]}
              </span>
              <code>{f.preview}</code>
            </li>
          ))}
        </ul>
      </section>

      {confirming ? (
        <div
          className="rv-confirm"
          role="group"
          aria-label="Confirm redaction"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setConfirming(false);
          }}
        >
          <p>
            <strong>
              Replace {findings.length === 1 ? 'this value' : `these ${findings.length} values`} with {MASK}?
            </strong>{' '}
            The memory stays, and the change syncs like any edit. Archived copies keep their old text.
          </p>
          <ul className="rv-findings" aria-label="Values to redact">
            {findings.map((f, i) => (
              <li key={i}>
                <span>
                  {RULES[f.rule] ?? f.rule} {FIELD[f.field]}
                </span>
                <span>
                  <code>{f.preview}</code> becomes <code>{MASK}</code>
                </span>
              </li>
            ))}
          </ul>
          <div className="rv-confirm-row">
            <button ref={confirmRef} type="button" className="rv-btn danger" onClick={() => onAct('redact')} disabled={busy}>
              Redact {findings.length} {noun}
            </button>
            <button type="button" className="rv-btn quiet" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rv-actions">
          <ActButton label="Redact" keyName="r" kind="pri" onClick={() => setConfirming(true)} disabled={busy} />
          <ActButton label="Not a secret" keyName="d" onClick={() => onAct('dismiss')} disabled={busy} />
          <ActButton label="Archive" keyName="a" kind="quiet" onClick={() => onAct('archive')} disabled={busy} />
          <Keys keys={[['j', 'next'], ['k', 'back'], ['o', 'open'], ['x', 'select']]} />
        </div>
      )}
    </>
  );
}

interface CardProps {
  item: ReviewSingle;
  position: string;
  busy: boolean;
  onAct: (action: Action) => void;
  confirming: boolean;
  setConfirming: (on: boolean) => void;
}

export default function SingleCard(props: CardProps & { queue: 'fading' | 'secrets' }) {
  return props.queue === 'fading' ? <FadingCard {...props} /> : <SecretCard {...props} />;
}
