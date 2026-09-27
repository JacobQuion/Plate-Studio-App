"use client";

import { useEffect, useState } from "react";
import type { DemoStatus } from "@/lib/demos";

/**
 * The examples' server-side renders. Asking starts the next one without a video (`priority`: this
 * one, now), and this polls until every example is ready. Pass enabled=false to skip.
 */
export function useDemoStatuses(enabled = true, priority?: string): Record<string, DemoStatus> | null {
  const [statuses, setStatuses] = useState<Record<string, DemoStatus> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      let next: Record<string, DemoStatus> | null = null;
      try {
        const res = await fetch(`/api/demos${priority ? `?priority=${priority}` : ""}`, { method: "POST" });
        if (res.ok) next = (await res.json()) as Record<string, DemoStatus>;
      } catch {}
      if (stop) return;
      if (next) setStatuses(next);
      // Only the one that matters here, when given; otherwise until all are ready.
      const pending = next && Object.entries(next).some(([id, s]) => (!priority || id === priority) && s.status !== "ready");
      if (!next || pending) timer = setTimeout(check, 8_000);
    };
    void check();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [enabled, priority]);
  return statuses;
}
