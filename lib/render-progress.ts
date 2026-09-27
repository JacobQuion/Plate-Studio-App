import type { StageId, StageStatus } from "./types";

type Stage = { status: StageStatus | "pending"; progress?: number };
const WEIGHTS: Record<StageId, number> = { assets: 10, motion: 65, voice: 5, assemble: 20 };

/** Parallel voice/motion stages contribute independently. Time alone never advances the bar. */
export function renderProgress(stages: Record<StageId, Stage>): number {
  return Math.min(99, Math.floor(Object.entries(WEIGHTS).reduce((sum, [id, weight]) => {
    const stage = stages[id as StageId];
    const fraction = stage.status === "done" || stage.status === "fallback" ? 1 : Math.max(0, Math.min(1, stage.progress ?? 0));
    return sum + fraction * weight;
  }, 0)));
}
