"use client";

import { Check, LoaderCircle, MessageSquare, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { StageId } from "@/lib/types";
import { type GenState } from "./shared";
import { renderProgress } from "@/lib/render-progress";
import { ProgressBar } from "./ProgressBar";

const STAGES: { id: StageId; label: string }[] = [
  { id: "assets", label: "Preparing scenes" },
  { id: "motion", label: "Generating footage" },
  { id: "voice", label: "Recording voiceover" },
  { id: "assemble", label: "Putting it together" },
];

/** One line under the preview: what's happening with the video, and the one thing to do next. */
export function RenderStatus({
  gen,
  stale,
  canRender,
  hasScene,
  onRender,
}: {
  gen: GenState;
  /** There are edits the current video doesn't include. */
  stale: boolean;
  canRender: boolean;
  hasScene: boolean;
  onRender: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (gen.phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [gen.phase]);

  if (gen.phase === "running") {
    const current = STAGES.find((s) => gen.stages[s.id].status === "active") ?? STAGES.find((s) => gen.stages[s.id].status === "pending") ?? STAGES[STAGES.length - 1];
    const progress = renderProgress(gen.stages);
    return (
      <Row>
        <span className="flex items-center gap-2 text-zinc-200">
          <LoaderCircle className="accent-text size-4 animate-spin text-brand-500" />
          {current.label}…
          <span className="text-zinc-500">
            {progress}% · {Math.max(0, Math.floor((now - gen.startedAt) / 1000))}s
          </span>
        </span>
        <div className="w-40"><ProgressBar value={progress} label="Video generation progress" /></div>
      </Row>
    );
  }

  if (gen.phase === "error") {
    return (
      <Row>
        <span className="flex min-w-0 items-center gap-2 text-rose-300">
          <TriangleAlert className="size-4 shrink-0" /> <span className="max-w-2xl">{gen.message}</span>
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
          <Check className="size-4 text-emerald-400" /> 100% · Your video is ready to export.
        </span>
      </Row>
    );
  }

  return (
    <Row>
      <span className="flex items-center gap-2 text-zinc-500">
        {hasScene && (
          <>
            <MessageSquare className="size-4" /> Click Render to create your video. Export downloads the finished MP4.
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
