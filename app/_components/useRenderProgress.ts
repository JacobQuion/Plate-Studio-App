"use client";

import { useEffect, useState } from "react";
import { STAGES, type GenState } from "./shared";

export interface RenderProgress {
  /** 0..1, never moves backwards during a render. */
  fraction: number;
}

/**
 * Smooth progress for the running render. The server sends a time-left estimate with each
 * event; between events we count it down locally, so the percentage keeps moving while a
 * minute-long video clip is generating.
 */
export function useRenderProgress(gen: GenState): RenderProgress | null {
  const [progress, setProgress] = useState<(RenderProgress & { startedAt: number }) | null>(null);

  useEffect(() => {
    if (gen.phase !== "running") return;
    const tick = () =>
      setProgress((prev) => {
        const next = measure(gen, Date.now());
        // A revised estimate never pulls the bar back within the same render.
        const floor = prev?.startedAt === gen.startedAt ? prev.fraction : 0;
        return { ...next, fraction: Math.max(floor, next.fraction), startedAt: gen.startedAt };
      });
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [gen]);

  return gen.phase === "running" && progress?.startedAt === gen.startedAt ? progress : null;
}

function measure(gen: Extract<GenState, { phase: "running" }>, now: number): RenderProgress {
  const elapsed = Math.max(0, (now - gen.startedAt) / 1000);
  const left = gen.eta ? gen.eta.seconds - (now - gen.eta.at) / 1000 : null;
  // Past the estimate, keep creeping toward (but never reaching) 100%.
  return { fraction: left === null ? Math.min(0.04, elapsed / 100) : Math.min(0.99, elapsed / (elapsed + Math.max(left, 3))) };
}

/**
 * "Scene 2 of 5" while scenes render (the assemble stage counts each scene plus the final
 * mix); before that, the name of the step in progress.
 */
export function stepLabel(gen: Extract<GenState, { phase: "running" }>): string {
  const { status, completed = 0, total } = gen.stages.assemble;
  if (status === "active" && total) return completed < total - 1 ? `Scene ${completed + 1} of ${total - 1}` : "Final mix";
  const i = STAGES.findIndex((s) => gen.stages[s.id].status === "active" || gen.stages[s.id].status === "pending");
  return STAGES[i === -1 ? STAGES.length - 1 : i].label;
}

