"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page every `ms` while something is still running server-side. */
export function AutoRefresh({ active, ms = 1500 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return active ? (
    <p className="live" role="status">
      <span className="dot" aria-hidden /> The agent is working on this…
    </p>
  ) : null;
}
