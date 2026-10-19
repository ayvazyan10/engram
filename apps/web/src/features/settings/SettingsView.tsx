import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useTheme, type ColourMode } from '../../shell/theme.js';
import { Icon, type IconName } from '../../shell/icons.js';

const MODES: { mode: ColourMode; label: string; icon: IconName }[] = [
  { mode: 'auto', label: 'Match system', icon: 'contrast' },
  { mode: 'light', label: 'Light', icon: 'sun' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
];

/**
 * Settings, first cut: colour mode, the way to connect an AI, and the running
 * server's version. Health, sync, decay and the API key join it in F6.
 */
export default function SettingsView() {
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    api.health()
      .then((res) => {
        if (typeof res.version === 'string') setVersion(res.version);
      })
      // No version is better than a wrong one: the line stays hidden.
      .catch(() => {});
  }, []);

  return (
    <div className="at-page">
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
        <p>Add Engram to Claude Code, Claude Desktop, Cursor, VS Code or Codex, and watch the first memory arrive.</p>
        <a className="at-btn sec" href="#/welcome">
          <Icon name="plug" size={16} />
          Show the setup steps
        </a>
      </section>

      {version && (
        <section className="at-section" aria-labelledby="set-about">
          <h2 id="set-about">About</h2>
          <p className="at-data">Engram server {version}</p>
        </section>
      )}
    </div>
  );
}
