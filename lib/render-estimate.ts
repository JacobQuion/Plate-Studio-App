import type { StageId } from "@/lib/types";

/**
 * Time-left estimate for one render. Starts from planned stage lengths and switches to
 * observed throughput once a stage reports finished items (clips back, scenes rendered),
 * so a slow or fast provider corrects the estimate after its first results.
 * Motion and voice run in parallel, so only the slower of the two counts.
 */
export class RenderEstimate {
  private started = new Map<StageId, number>();
  private finished = new Set<StageId>();
  private counts = new Map<StageId, { completed: number; total: number }>();

  constructor(private plan: Record<StageId, number>) {}

  update(stage: StageId, status: string, completed?: number, total?: number, now = Date.now()) {
    if (!this.started.has(stage)) this.started.set(stage, now);
    if (status !== "active") this.finished.add(stage);
    if (completed !== undefined && total) this.counts.set(stage, { completed, total });
  }

  /** Seconds left for one stage. */
  private stageLeft(stage: StageId, now: number): number {
    if (this.finished.has(stage)) return 0;
    const plan = this.plan[stage];
    const start = this.started.get(stage);
    if (start === undefined) return plan;
    const elapsed = (now - start) / 1000;
    const count = this.counts.get(stage);
    if (count && count.completed > 0) return (elapsed / count.completed) * (count.total - count.completed);
    // Nothing back yet: count down the plan, but never claim it's about to finish.
    return Math.max(plan - elapsed, plan * 0.1);
  }

  /** Seconds left for the whole render. */
  remaining(now = Date.now()): number {
    const left = (s: StageId) => this.stageLeft(s, now);
    return Math.round(left("assets") + Math.max(left("motion"), left("voice")) + left("assemble"));
  }
}
