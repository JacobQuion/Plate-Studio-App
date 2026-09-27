"use client";

import { Check, RotateCcw, TriangleAlert } from "lucide-react";
import type { GenState } from "./shared";

/** One line under the preview: what's happening with the video, and the one thing to do next. */
export function RenderStatus({
  gen,
  stale,
  canRender,
  showVideo,
  onRender,
  onShowVideo,
}: {
  gen: GenState;
  /** There are edits the current video doesn't include. */
  stale: boolean;
  canRender: boolean;
  showVideo: boolean;
  onRender: () => void;
  onShowVideo: (show: boolean) => void;
}) {
  // The rendering overlay on the preview already shows the percentage and current scene.
  if (gen.phase === "running") return null;

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

  // Nothing to report: render nothing so the preview gets the space.
  return null;
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
