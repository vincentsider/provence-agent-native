'use client';

/**
 * Trustwright badge mount (30 Aug): the signed, live-verified WebMCP trust
 * seal, shown to HUMANS as a marketing asset (hero) and in the footer.
 *
 * badge.js renders inline where its <script> sits and re-checks the live
 * toolset on every load. We inject the script per placement after mount so
 * React tree swaps (SSR shell -> Loaded, hero -> mission hero) can never
 * strand or duplicate a badge: each instance owns its container and cleans
 * it on unmount. Per Trustwright's rules we never restyle or wrap the
 * verdict — theme/size only, via the documented data attributes.
 */

import { useEffect, useRef } from 'react';

const BADGE_SRC = 'https://trustwright.deepblocker.ai/badge.js';
const ORIGIN = 'https://webmcp.myprovence.fr';

export function TrustBadge({
  variant,
  theme = 'auto',
}: {
  variant?: 'compact';
  theme?: 'light' | 'dark' | 'auto';
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.childElementCount > 0) return;
    const script = document.createElement('script');
    script.src = BADGE_SRC;
    script.async = true;
    script.dataset.origin = ORIGIN;
    script.dataset.theme = theme;
    if (variant) script.dataset.variant = variant;
    el.appendChild(script);
    return () => el.replaceChildren();
  }, [variant, theme]);
  return <span ref={ref} data-testid="trustwright-badge" className="inline-flex" />;
}
