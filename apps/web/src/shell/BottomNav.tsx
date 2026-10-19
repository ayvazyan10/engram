import { useEffect, useId, useRef, useState } from 'react';
import { useRouteStore } from './routeStore.js';
import { Icon } from './icons.js';
import { INSIGHTS, MAP, NavLink, RECALL, REVIEW, SETTINGS, TIMELINE, isCurrent } from './Rail.js';

/**
 * The phone's navigation: four destinations and More, which holds Insights,
 * Settings and the command list. CSS shows it below 720px, where the rail goes.
 */
export default function BottomNav({ reviewCount, onCommands }: { reviewCount: number; onCommands: () => void }) {
  const route = useRouteStore((s) => s.route.name);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const moreCurrent = isCurrent('insights', route) || isCurrent('settings', route);

  // A tap anywhere else closes; so does Escape, handing focus back.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav className="at-tabbar" aria-label="Engram">
      <NavLink item={MAP} current={isCurrent('map', route)} />
      <NavLink item={RECALL} current={isCurrent('recall', route)} />
      <NavLink item={TIMELINE} current={isCurrent('timeline', route)} />
      <NavLink item={REVIEW} current={isCurrent('review', route)} count={reviewCount} />
      <div ref={wrapRef} className="at-more">
        <button
          ref={buttonRef}
          type="button"
          className="at-nav"
          aria-current={moreCurrent ? 'page' : undefined}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon name="more" />
          <span>More</span>
        </button>
        {open && (
          <ul id={menuId} className="at-pop at-more-menu" aria-label="More">
            {[INSIGHTS, SETTINGS].map((item) => (
              <li key={item.name}>
                <a
                  href={item.href}
                  className="at-opt"
                  aria-current={isCurrent(item.name, route) ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <Icon name={item.icon} size={18} />
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="at-opt"
                onClick={() => {
                  setOpen(false);
                  onCommands();
                }}
              >
                <Icon name="search" size={18} />
                Commands
              </button>
            </li>
          </ul>
        )}
      </div>
    </nav>
  );
}
