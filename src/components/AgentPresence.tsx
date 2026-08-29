'use client';

/**
 * The agent's body (issue #607): a small ink pen-nib presence that moves to
 * whatever the agent is operating, announces its intent one line BEFORE the
 * action, orbits a point it is considering (cursor proxemics), and retires
 * to a park when the human takes over (yield) or when work is done.
 *
 * Anti-Clippy rules: small, non-anthropomorphic, one intent per action,
 * silent at rest. Leak posture: every timeout/rAF/listener is stored and
 * cleared; movement is CSS-transition on transform (no per-frame renders;
 * rAF runs only during an orbit and is cancelled on the next event or
 * unmount). prefers-reduced-motion disables orbit and transitions.
 */

import { useEffect, useRef, useState } from 'react';
import { getPresenceBus, type PresenceEvent } from '@/lib/presence';
import { getSignalsLog } from '@/lib/signals';

const PARK_DELAY_MS = 5_000;
const ORBIT_MS = 1_400;
const ORBIT_RADIUS_PX = 26;

interface CursorState {
  x: number;
  y: number;
  parked: boolean;
}

function centerOf(selector: string): { x: number; y: number } | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 220) };
}

function parkPosition(): { x: number; y: number } {
  return { x: window.innerWidth - 56, y: window.innerHeight - 96 };
}

export function AgentPresence() {
  const bus = getPresenceBus();
  const [cursor, setCursor] = useState<CursorState>({ x: -100, y: -100, parked: true });
  const [visible, setVisible] = useState(false);
  // The banner is the human-facing voice: top-center, big, shows the current
  // intent while the agent works and retires with the body.
  const [banner, setBanner] = useState<string | null>(null);
  const parkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orbitRaf = useRef<number | null>(null);
  const activeRef = useRef(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    const clearTimers = () => {
      if (parkTimer.current) clearTimeout(parkTimer.current);
      if (orbitRaf.current !== null) cancelAnimationFrame(orbitRaf.current);
      parkTimer.current = null;
      orbitRaf.current = null;
    };

    const park = () => {
      activeRef.current = false;
      const p = parkPosition();
      setCursor((c) => ({ ...c, x: p.x, y: p.y, parked: true }));
      setBanner(null);
    };

    const scheduleParking = () => {
      if (parkTimer.current) clearTimeout(parkTimer.current);
      parkTimer.current = setTimeout(park, PARK_DELAY_MS);
    };

    const moveTo = (x: number, y: number) => {
      setVisible(true);
      setCursor((c) => ({ ...c, x, y, parked: false }));
    };

    const orbitAround = (cx: number, cy: number) => {
      if (reducedMotion.current) {
        moveTo(cx, cy);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = (now - start) / ORBIT_MS;
        if (t >= 1) {
          moveTo(cx, cy);
          orbitRaf.current = null;
          return;
        }
        const angle = t * 2 * Math.PI * 1.5;
        moveTo(cx + Math.cos(angle) * ORBIT_RADIUS_PX, cy + Math.sin(angle) * ORBIT_RADIUS_PX);
        orbitRaf.current = requestAnimationFrame(step);
      };
      if (orbitRaf.current !== null) cancelAnimationFrame(orbitRaf.current);
      orbitRaf.current = requestAnimationFrame(step);
    };

    const onEvent = () => {
      const e: PresenceEvent | null = bus.last();
      if (!e) return;
      switch (e.phase) {
        case 'announce': {
          activeRef.current = true;
          setVisible(true);
          setCursor((c) => ({ ...c, parked: false }));
          setBanner(e.intent);
          scheduleParking();
          break;
        }
        case 'focus': {
          activeRef.current = true;
          if (orbitRaf.current !== null) {
            cancelAnimationFrame(orbitRaf.current);
            orbitRaf.current = null;
          }
          const target =
            e.target === 'filters'
              ? centerOf('[data-presence="filters"]')
              : e.target === 'park'
                ? parkPosition()
                : centerOf('[data-presence="map"]');
          if (target) {
            // Proxemics: a geographic focus orbits before settling.
            if (typeof e.target === 'object') orbitAround(target.x, target.y);
            else moveTo(target.x, target.y);
          }
          scheduleParking();
          break;
        }
        case 'act':
          activeRef.current = true;
          scheduleParking();
          break;
        case 'done':
          scheduleParking();
          break;
        case 'yield':
          clearTimers();
          park();
          break;
      }
    };

    const unsubscribe = bus.subscribe(onEvent);

    // Yield: a human pointer during agent activity retires the body.
    const onPointerDown = (ev: PointerEvent) => {
      // Answering a question or dropping a ping is COLLABORATION, not a
      // takeover: those taps must not retire the body.
      const target = ev.target as Element | null;
      if (target?.closest('[data-testid="elicitation-cards"],[data-testid="ping-wheel"]')) return;
      if (activeRef.current) {
        bus.emit({ phase: 'yield' });
        try {
          getSignalsLog().addYield();
        } catch {
          /* signals are theatre-adjacent */
        }
      }
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });

    // Start parked.
    const p = parkPosition();
    setCursor((c) => ({ ...c, x: p.x, y: p.y }));

    return () => {
      unsubscribe();
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <>
      {/* The voice: fixed top-center, unmissable while the agent works. */}
      {banner && !cursor.parked && (
        <div
          data-testid="agent-banner"
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-3 z-[1100] w-[min(92vw,680px)] -translate-x-1/2"
        >
          <div className="flex items-center gap-4 border-2 border-brand-yellow bg-brand-petrol px-5 py-3 shadow-[6px_6px_0_rgba(0,39,49,0.35)]">
            {/* pen nib echo */}
            <svg width="26" height="26" viewBox="0 0 24 24" className="shrink-0">
              <path
                d="M3 21 L14 4 L20 10 L7 21 Z M14 4 L20 10"
                fill="#FFE500"
                stroke="#002731"
                strokeWidth="1.2"
              />
            </svg>
            <div className="min-w-0">
              <span className="display-caps block text-[11px] leading-none text-brand-yellow">
                l&apos;agent
              </span>
              <span className="mt-1 block truncate font-slab text-[17px] leading-snug text-white">
                {banner}
              </span>
            </div>
          </div>
        </div>
      )}
      {/* The body: the nib still travels to what it operates. */}
      <div
        data-testid="agent-presence"
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[1000]"
        style={{
          transform: `translate(${cursor.x}px, ${cursor.y}px)`,
          transition: reducedMotion.current ? 'none' : 'transform 700ms cubic-bezier(.3,.9,.3,1)',
          opacity: cursor.parked ? 0.35 : 1,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" className="drop-shadow-sm">
          <path
            d="M3 21 L14 4 L20 10 L7 21 Z M14 4 L20 10"
            fill="#002731"
            stroke="#FFE500"
            strokeWidth="1.2"
          />
        </svg>
      </div>
    </>
  );
}
