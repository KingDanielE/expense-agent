"use client";

import { useEffect } from "react";

/**
 * While something is still running server-side, reloads the page when it changes. With
 * `statusUrl`, polls that JSON endpoint and reloads only when its answer changes; otherwise
 * reloads every few seconds. (A full reload, not router.refresh(): the latter served stale
 * pages on Vercel.)
 */
export function AutoRefresh({ active, statusUrl, ms = 1500 }: { active: boolean; statusUrl?: string; ms?: number }) {
  useEffect(() => {
    if (!active) return;
    let last: string | null = null;
    let stopped = false;
    const tick = async () => {
      if (!statusUrl) return window.location.reload();
      try {
        const res = await fetch(statusUrl, { cache: "no-store" });
        const body = await res.text();
        if (last !== null && body !== last && !stopped) return window.location.reload();
        last = body;
      } catch {
        // offline for a moment: try again next tick
      }
    };
    const t = setInterval(tick, statusUrl ? ms : Math.max(ms, 3000));
    void tick();
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [active, statusUrl, ms]);

  return active ? (
    <p className="live" role="status">
      <span className="dot" aria-hidden /> The agent is working on this…
    </p>
  ) : null;
}
