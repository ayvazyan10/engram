import { useState } from 'react';
import { useAuthStore } from '../../store/authStore.js';
import { setStoredApiKey, clearStoredApiKey } from '../../lib/apiKey.js';
import './ui.css';

/** Requests an API key when a REST call or socket handshake rejects access. */
export default function UnlockGate() {
  const hadKey = useAuthStore((s) => s.hadKey);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setStoredApiKey(trimmed);
    // Reload so every independent fetcher and the socket use the new key.
    window.location.reload();
  }

  function handleClear() {
    clearStoredApiKey();
    useAuthStore.getState().clearKey();
    setValue('');
  }

  return (
    <div className="ui-overlay ui-unlock-overlay">
      <div className="ui-unlock" role="dialog" aria-modal="true" aria-labelledby="unlock-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)');
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <svg viewBox="0 0 24 24" fill="none" className="ui-unlock-icon" aria-hidden="true">
          <path
            d="M7 10V7a5 5 0 0110 0v3M5.5 10h13a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1v-8a1 1 0 011-1zM12 14v3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h1 id="unlock-title" className="ui-unlock-title">{hadKey ? 'Wrong key — try again' : 'API key required'}</h1>
        <p className="ui-unlock-subtitle">
          {hadKey
            ? 'The stored key was rejected by the server. Enter the correct API key and try again.'
            : 'This Engram instance requires an API key. Enter the ENGRAM_API_KEY configured on the server.'}
        </p>

        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="API key"
          aria-label="API key"
          className="ui-input"
          disabled={submitting}
        />

        <div className="ui-unlock-actions">
          {hadKey && (
            <button
              className="ec-hover-tint ui-secondary"
              onClick={handleClear}
              disabled={submitting}
            >
              Clear key
            </button>
          )}
          <button
            className="ec-primary ui-primary ui-unlock-submit"
            onClick={handleSubmit}
            disabled={submitting || !value.trim()}
          >
            {submitting ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  );
}
