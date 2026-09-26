"use client";

import { Check, LoaderCircle, MessageSquare, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { StageId } from "@/lib/types";
import { cx, type GenState } from "./shared";

const STAGES: { id: StageId; label: string }[] = [
  { id: "assets", label: "Preparing photos" },
  { id: "motion", label: "Adding motion" },
  { id: "voice", label: "Recording voiceover" },
  { id: "assemble", label: "Putting it together" },
];

/** One line under the preview: what's happening with the video, and the one thing to do next. */
export function RenderStatus({
  gen,
  stale,
  canRender,
  hasScene,
  showVideo,
  onRender,
  onShowVideo,
}: {
  gen: GenState;
  /** There are edits the current video doesn't include. */
  stale: boolean;
  canRender: boolean;
  hasScene: boolean;
  showVideo: boolean;
  onRender: () => void;
  onShowVideo: (show: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (gen.phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [gen.phase]);

  if (gen.phase === "running") {
    const i = Math.max(0, STAGES.findIndex((s) => gen.stages[s.id].status === "active" || gen.stages[s.id].status === "pending"));
    const current = STAGES[i] ?? STAGES[STAGES.length - 1];
    return (
      <Row>
        <span className="flex items-center gap-2 text-zinc-200">
          <LoaderCircle className="accent-text size-4 animate-spin text-brand-500" />
          {current.label}…
          <span className="text-zinc-500">
            Step {Math.min(i + 1, STAGES.length)} of {STAGES.length} · {((now - gen.startedAt) / 1000).toFixed(0)}s
          </span>
        </span>
        <div className="flex gap-1">
          {STAGES.map((s, n) => (
            <span key={s.id} className={cx("relative h-1 w-8 rounded-full", n < i ? "accent-fill bg-brand-700" : n === i ? "accent-fill bg-brand-800 opacity-60" : "bg-white/10")} />
          ))}
        </div>
      </Row>
    );
  }

  if (gen.phase === "error") {
    return (
      <Row>
        <span className="flex min-w-0 items-center gap-2 text-rose-300">
          <TriangleAlert className="size-4 shrink-0" /> <span className="truncate">{gen.message}</span>
        </span>
        <PrimaryButton onClick={onRender} disabled={!canRender}>
          <RotateCcw className="size-3.5" /> Try again
        </PrimaryButton>
      </Row>
    );
  }

  if (gen.phase === "done" && stale) {
    return (
      <Row>
        <span className="flex items-center gap-2 text-zinc-300">
          <span className="size-2 rounded-full bg-amber-400" /> You have changes that aren&apos;t in the video yet.
          <button onClick={() => onShowVideo(!showVideo)} className="text-zinc-500 underline-offset-2 hover:text-white hover:underline">
            {showVideo ? "Show my edits" : "Play last version"}
          </button>
        </span>
        <PrimaryButton onClick={onRender} disabled={!canRender}>
          Update video
        </PrimaryButton>
      </Row>
    );
  }

  if (gen.phase === "done") {
    return (
      <Row>
        <span className="flex items-center gap-2 text-zinc-300">
          <Check className="size-4 text-emerald-400" /> Your video is ready. Ask the assistant to change anything.
        </span>
      </Row>
    );
  }

  return (
    <Row>
      <span className="flex items-center gap-2 text-zinc-500">
        {hasScene && (
          <>
            <MessageSquare className="size-4" /> Ask the assistant to change anything. Hit Export when it looks right.
          </>
        )}
      </span>
    </Row>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-10 w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">{children}</div>;
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-40">
      {children}
    </button>
  );
}
