"use client";

import { useEffect } from "react";

/**
 * While something is still running server-side, reloads the page when it changes. With
 * `statusUrl`, polls that endpoint one request at a time (a poll may take a while: on
 * serverless it does the work) and reloads when the answer changes; otherwise reloads every few
 * seconds. A full reload, not router.refresh(): the latter served stale pages on Vercel.
 */
export function AutoRefresh({
  active,
  statusUrl,
  initial = null,
  ms = 1500,
}: {
  active: boolean;
  statusUrl?: string;
  /** The status endpoint's answer as of this render, so the first poll can already differ. */
  initial?: string | null;
  ms?: number;
}) {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    if (!statusUrl) {
      timer = setTimeout(() => window.location.reload(), Math.max(ms, 3000));
      return () => clearTimeout(timer);
    }

    let last: string | null = initial;
    const poll = async () => {
      try {
        const body = await (await fetch(statusUrl, { cache: "no-store" })).text();
        if (stopped) return;
        if (last !== null && body !== last) return window.location.reload();
        last = body;
      } catch {
        // offline for a moment: try again
      }
      if (!stopped) timer = setTimeout(poll, ms);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active, statusUrl, initial, ms]);

  return active ? (
    <p className="live" role="status">
      <span className="dot" aria-hidden /> The agent is working on this…
    </p>
  ) : null;
}
