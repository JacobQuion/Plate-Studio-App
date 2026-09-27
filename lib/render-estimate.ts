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

  /**
   * Seconds left for one stage. With `afterNext`, the seconds that will still be left once
   * the next item in flight finishes (0 for a running stage without countable items).
   */
  private stageLeft(stage: StageId, now: number, afterNext = false): number {
    if (this.finished.has(stage)) return 0;
    const plan = this.plan[stage];
    const start = this.started.get(stage);
    if (start === undefined) return plan;
    const elapsed = (now - start) / 1000;
    const count = this.counts.get(stage);
    if (afterNext) {
      if (!count) return 0;
      const perItem = count.completed > 0 ? elapsed / count.completed : plan / count.total;
      return perItem * Math.max(0, count.total - count.completed - 1);
    }
    if (count && count.completed > 0) return (elapsed / count.completed) * (count.total - count.completed);
    // Nothing back yet: count down the plan, but never claim it's about to finish.
    return Math.max(plan - elapsed, plan * 0.1);
  }

  private total(now: number, afterNext: boolean): number {
    const left = (s: StageId) => this.stageLeft(s, now, afterNext);
    return Math.round(left("assets") + Math.max(left("motion"), left("voice")) + left("assemble"));
  }

  /** Seconds left for the whole render. */
  remaining(now = Date.now()): number {
    return this.total(now, false);
  }

  /**
   * Seconds that will still be left when the next item in flight finishes. The client counts
   * `remaining()` down between events but stops here, so a slow scene render can't run the
   * bar ahead of the scenes actually done.
   */
  floor(now = Date.now()): number {
    return Math.min(this.total(now, true), this.total(now, false));
  }
}
