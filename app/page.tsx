"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Clapperboard, LoaderCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dishScenes,
  estimateVoiceSeconds,
  newProject,
  planTimeline,
  resolveScenes,
  setAdDishes,
  type AdProject,
  type LibraryDish,
  type Timeline as TimelineData,
} from "@/lib/ad-plan";
import type { GenerateStreamEvent } from "@/lib/types";
import { ChatPane, type PendingPhoto } from "./_components/ChatPane";
import { Preview } from "./_components/Preview";
import { InfoButton } from "./_components/InfoButton";
import { RenderStatus } from "./_components/RenderStatus";
import { Timeline } from "./_components/Timeline";
import { fileToDataUri, formatTime as formatClock, freshStages, titleFromFilename, type ChatMessage, type GenState } from "./_components/shared";

const SAMPLE_URL = "https://www.yelp.com/biz/caffe-strada-berkeley";

type Snapshot = { project: AdProject; library: LibraryDish[] };

const msgId = () => Math.random().toString(36).slice(2);
/** Uploaded photos stay in the browser; the assistant only needs their metadata. */
const stripUploads = (lib: LibraryDish[]) => lib.map((d) => (d.imageUrl.startsWith("data:") ? { ...d, imageUrl: "" } : d));
/** Everything that affects the rendered video, for detecting unrendered edits. */
const editKey = (p: AdProject, lib: LibraryDish[]) => JSON.stringify([p, lib.map((d) => [d.id, d.title, d.price, d.description, d.imageUrl.length])]);
const PANEL_MIN = 300;
const PANEL_MAX = 720;
const PANEL_KEY = "plate-studio:panel-width";
const clampPanel = (w: number) => Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, window.innerWidth * 0.6, w)));
const download = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
};

export default function Studio() {
  const [project, setProject] = useState<AdProject>(newProject);
  const [library, setLibrary] = useState<LibraryDish[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [linkRequest, setLinkRequest] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [gen, setGen] = useState<GenState>({ phase: "idle" });
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(400);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Project state before each assistant turn, so the turn can be reverted. */
  const snapshots = useRef(new Map<string, Snapshot>());
  /** Download the video as soon as the current render finishes. */
  const exportAfterRender = useRef(false);

  const running = gen.phase === "running";
  const result = gen.phase === "done" ? gen.result : null;
  const scenes = useMemo(() => resolveScenes(project, library), [project, library]);
  const hasDishes = scenes.some((s) => s.kind === "dish");
  const stale = !!result && renderedKey !== editKey(project, library);
  const videoMode = !!result && showVideo && !running;

  // Real scene timings when the video matches the edits; estimates otherwise.
  const timeline: TimelineData = useMemo(() => {
    if (result && !stale && result.timeline.length === scenes.length) {
      return {
        durations: result.timeline.map((t) => t.duration),
        starts: result.timeline.map((t) => t.start),
        total: result.durationSeconds,
      };
    }
    return planTimeline(
      scenes,
      scenes.map((s) => estimateVoiceSeconds(s.voice)),
    );
  }, [result, stale, scenes]);

  const sceneAt = useCallback(
    (t: number) => {
      if (!result) return null;
      let id: string | null = null;
      for (const s of result.timeline) if (t >= s.start) id = s.sceneId;
      return id;
    },
    [result],
  );
  const selected = scenes.find((s) => s.id === selectedId) ?? null;

  // The section picked on the timeline, clamped to the current length. It falls
  // back to the whole ad when edits shrink the ad past it.
  const span: [number, number] = range && range[0] < timeline.total - 0.25 ? [range[0], Math.min(range[1], timeline.total)] : [0, timeline.total];
  const focus =
    span[0] > 0.01 || span[1] < timeline.total - 0.01
      ? {
          start: span[0],
          end: span[1],
          sceneIds: scenes.filter((_, i) => timeline.starts[i] < span[1] && timeline.starts[i] + timeline.durations[i] > span[0]).map((s) => s.id),
        }
      : null;

  // Restore the context panel width this browser last used.
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_KEY));
      if (saved) setPanelWidth(clampPanel(saved));
    } catch {}
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep a valid selection: default to the first dish scene.
  useEffect(() => {
    if (!hasDishes) return setSelectedId(null);
    if (!scenes.some((s) => s.id === selectedId)) setSelectedId(scenes.find((s) => s.kind === "dish")?.id ?? null);
  }, [scenes, selectedId, hasDishes]);

  // ---- Rendering -------------------------------------------------------------
  const render = async (p: AdProject = project, lib: LibraryDish[] = library) => {
    if (running) return;
    const used = new Set(dishScenes(p).map((s) => s.dishId));
    const key = editKey(p, lib);
    const startedAt = Date.now();
    let stages = freshStages();
    setGen({ phase: "running", stages, startedAt });
    const fail = (message: string) => {
      exportAfterRender.current = false;
      setGen({ phase: "error", stages, message });
    };

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: p,
          library: lib.filter((d) => used.has(d.id)),
        }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        return fail(data.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as GenerateStreamEvent;
          if (event.type === "progress") {
            stages = {
              ...stages,
              [event.stage]: { status: event.status, detail: event.detail },
            };
            setGen({ phase: "running", stages, startedAt });
          } else if (event.type === "done") {
            setGen({
              phase: "done",
              stages,
              result: event,
              elapsed: (Date.now() - startedAt) / 1000,
            });
            setRenderedKey(key);
            setShowVideo(true);
            setCurrentTime(0);
            if (exportAfterRender.current) {
              exportAfterRender.current = false;
              download(event.downloadUrl);
            }
            return;
          } else {
            return fail(event.message);
          }
        }
      }
      fail("The render stream ended unexpectedly.");
    } catch (err) {
      fail((err as Error).message);
    }
  };

  // ---- Chat --------------------------------------------------------------------
  const addFiles = async (files: File[]) => {
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      try {
        const [full, thumb] = await Promise.all([fileToDataUri(file, 2880), fileToDataUri(file, 640, 0.8)]);
        setPending((p) => [...p, { dishId: `up-${crypto.randomUUID()}`, name: file.name, full, thumb }]);
      } catch {
        setToast(`Couldn't read ${file.name}`);
      }
    }
  };

  const openLink = () => setLinkRequest((n) => n + 1);

  const trySample = () => {
    send(`Make an ad from this menu: ${SAMPLE_URL}`);
  };

  const exportVideo = () => {
    if (result && !stale) return download(result.downloadUrl);
    exportAfterRender.current = true;
    render();
  };

  const undo = (messageId: string) => {
    const snap = snapshots.current.get(messageId);
    if (!snap || busy || running) return;
    setProject(snap.project);
    // Restore edited dish details, but keep dishes added since (e.g. uploads) in the library.
    const known = new Set(snap.library.map((d) => d.id));
    setLibrary((lib) => [...snap.library, ...lib.filter((d) => !known.has(d.id))]);
    snapshots.current.delete(messageId);
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, reverted: true } : x)));
  };

  const send = async (text: string) => {
    if (busy) return;
    const photos = pending;
    const before: Snapshot = { project, library };
    const lib: LibraryDish[] = [
      ...library,
      ...photos.map((p) => ({
        id: p.dishId,
        title: titleFromFilename(p.name),
        price: "",
        description: "",
        imageUrl: p.full,
        uploaded: true,
      })),
    ];
    const userMsg: ChatMessage = {
      id: msgId(),
      role: "user",
      text,
      images: photos.map((p) => p.thumb),
    };
    const history = [...messages, userMsg]
      .filter((m) => !m.error)
      .map((m) => ({
        role: m.role,
        text: m.text || (m.images?.length ? "(sent photos)" : ""),
      }));

    setMessages((m) => [...m, userMsg]);
    setPending([]);
    setLibrary(lib);
    setBusy(true);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history,
          attachments: photos.map((p) => ({
            dishId: p.dishId,
            thumb: p.thumb,
          })),
          project,
          library: stripUploads(lib),
          focus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The assistant is unavailable.");
      const local = new Map(lib.map((d) => [d.id, d.imageUrl]));
      const merged: LibraryDish[] = (data.library as LibraryDish[]).map((d) => ({ ...d, imageUrl: d.imageUrl || local.get(d.id) || "" }));
      setProject(data.project);
      setLibrary(merged);
      const id = msgId();
      const undoable = !!data.actions?.length;
      if (undoable) {
        // Only the latest turn can be reverted; older snapshots would undo later edits too.
        snapshots.current = new Map([[id, before]]);
      }
      setMessages((m) => [
        ...(undoable ? m.map((x) => ({ ...x, undoable: x.reverted ? x.undoable : false })) : m),
        {
          id,
          role: "assistant",
          text: data.reply,
          actions: data.actions,
          undoable,
        },
      ]);
      if (data.render) render(data.project, merged);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: msgId(),
          role: "assistant",
          text: (err as Error).message,
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // ---- Editor ------------------------------------------------------------------
  const editing = busy || running;

  const selectScene = (id: string) => {
    setSelectedId(id);
    setCursor(timeline.starts[scenes.findIndex((s) => s.id === id)] ?? 0);
    const v = videoRef.current;
    const timing = result?.timeline.find((t) => t.sceneId === id);
    if (v && videoMode && timing) {
      v.pause();
      // Land just after the scene's text has animated in.
      const into = scenes.find((s) => s.id === id)?.kind === "dish" ? 2.2 : 1.4;
      v.currentTime = Math.min(timing.start + into, timing.start + timing.duration - 0.2);
    }
  };

  const dishIds = dishScenes(project).map((s) => s.dishId!);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v && videoMode) {
      v.currentTime = t;
      return;
    }
    setCursor(t);
    let idx = 0;
    timeline.starts.forEach((start, i) => t >= start && (idx = i));
    if (scenes[idx]) setSelectedId(scenes[idx].id);
  };

  /** Drag the context panel's right edge to resize it. */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    let w = startW;
    const move = (ev: PointerEvent) => setPanelWidth((w = clampPanel(startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      try {
        localStorage.setItem(PANEL_KEY, String(w));
      } catch {}
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggleDish = (id: string) => setProject((p) => setAdDishes(p, dishIds.includes(id) ? dishIds.filter((x) => x !== id) : [...dishIds, id]));

  return (
    <div data-editing={editing || undefined} className="flex min-h-dvh flex-col bg-[#08080a] lg:h-dvh lg:overflow-hidden">
      {/* Stroke for .accent-text icons while editing: a gradient that slowly rotates around each 24×24 icon. */}
      <svg aria-hidden width="0" height="0" className="absolute">
        <linearGradient id="accent-flow" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="24" y2="0">
          <stop offset="0" style={{ stopColor: "var(--color-brand-600)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--color-brand-400)" }} />
          <stop offset="1" style={{ stopColor: "var(--color-brand-300)" }} />
          <animateTransform attributeName="gradientTransform" type="rotate" from="0 12 12" to="360 12 12" dur="5s" repeatCount="indefinite" />
        </linearGradient>
      </svg>
      {/* Top bar -------------------------------------------------------------- */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-[#0c0c0e] pr-3 pl-3 sm:pl-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <button
            onClick={() => history.back()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[17px] leading-none font-medium text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <ChevronLeft className="size-[18px]" /> Back
          </button>
          <input
            value={project.restaurant}
            onChange={(e) => setProject((p) => ({ ...p, restaurant: e.target.value }))}
            disabled={editing}
            placeholder="Blank project"
            aria-label="Restaurant name"
            className="field-sizing-content max-w-[40vw] min-w-24 truncate rounded-md bg-transparent px-1.5 py-1 text-[17px] leading-7 font-medium text-zinc-100 outline-none placeholder:text-zinc-500 hover:bg-white/[0.04] focus:bg-white/[0.06]"
          />
          {hasDishes && (
            <span className="hidden items-center gap-2 text-[15px] whitespace-nowrap text-zinc-500 md:flex">
              <span className="accent-fill relative size-2 rounded-full bg-brand-700" />
              {dishIds.length} {dishIds.length === 1 ? "dish" : "dishes"} · {formatClock(timeline.total)}
            </span>
          )}
          {result && !stale && (
            <span title="The video is up to date" className="hidden md:block">
              <Check className="size-4 text-emerald-400" strokeWidth={2.5} />
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <InfoButton
            label="About Render and Export"
            align="end"
            items={[
              { title: "Render", text: "Builds the video with your latest edits so you can preview it here." },
              { title: "Export", text: "Downloads your ad as an MP4, rendering it first if there are new edits." },
            ]}
          />
          <button
            onClick={() => render()}
            disabled={!hasDishes || busy || running || (!!result && !stale)}
            title={result && !stale ? "The video is up to date" : "Render the video with your latest edits"}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-5 text-[15px] font-semibold text-white transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            <Clapperboard className="size-4" /> Render
          </button>
          <button
            onClick={exportVideo}
            disabled={!hasDishes || busy || running}
            className="accent-fill accent-ring relative inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-700 to-brand-500 px-5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {/* Keep the label in place while rendering so the button doesn't change size */}
            <span className={running ? "invisible" : undefined}>Export</span>
            {running && <LoaderCircle aria-label="Making video" className="absolute inset-0 m-auto size-4 animate-spin" />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left panel ----------------------------------------------------------- */}
        <aside
          style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}
          className="relative order-last flex h-[60dvh] shrink-0 flex-col border-t border-white/[0.06] bg-[#0c0c0e] lg:order-none lg:h-full lg:w-[var(--panel-w)] lg:border-t-0 lg:border-r"
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize context panel"
            title="Drag to resize · double-click to reset"
            onPointerDown={startResize}
            onDoubleClick={() => {
              setPanelWidth(400);
              try {
                localStorage.removeItem(PANEL_KEY);
              } catch {}
            }}
            className="absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition hover:after:w-0.5 hover:after:bg-brand-700/80 lg:block"
          />
          <div className="flex h-14 shrink-0 items-center border-b border-white/[0.06] px-5">
            <h2 className="flex items-center gap-2 text-[15px] font-medium text-zinc-100">
              <Sparkles className="accent-text size-4 text-brand-500" /> Context
            </h2>
            <span className="ml-1.5 flex">
              <InfoButton
                label="About adding context"
                items={[
                  { title: "Upload media", text: "Click Media or drag dish photos onto this panel to add them to your ad." },
                  { title: "Yelp / Google Maps", text: "Paste your restaurant's link and we'll import your name, menu and dish photos." },
                ]}
              />
            </span>
          </div>
          <ChatPane
            messages={messages}
            busy={busy}
            pending={pending}
            linkRequest={linkRequest}
            library={library}
            inAd={dishIds}
            dishesDisabled={editing}
            onToggleDish={toggleDish}
            onAddFiles={addFiles}
            onRemovePending={(id) => setPending((p) => p.filter((x) => x.dishId !== id))}
            onSend={send}
            onUndo={undo}
          />
        </aside>

        {/* Editor: stage and timeline --------------------------------------- */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Stage ---------------------------------------------------------------- */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 pt-2 pb-1 sm:px-3 sm:pt-3">
              <div className="h-[calc((100vw-1rem)*9/16)] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
                <Preview
                  ref={videoRef}
                  scene={hasDishes ? selected : null}
                  rendering={running}
                  result={result}
                  showVideo={showVideo}
                  busy={busy}
                  onVideoClick={() => {
                    const id = sceneAt(videoRef.current?.currentTime ?? 0);
                    if (id) setSelectedId(id);
                  }}
                  onTime={(t) => {
                    setCurrentTime(t);
                    // Follow the playhead while playing so the editor shows what's on screen.
                    const id = sceneAt(t);
                    if (id && videoRef.current && !videoRef.current.paused) setSelectedId(id);
                  }}
                  onAddFiles={addFiles}
                  onLink={openLink}
                  onSample={trySample}
                />
              </div>
              <RenderStatus gen={gen} stale={stale} canRender={hasDishes && !busy} hasScene={hasDishes} showVideo={showVideo} onRender={() => render()} onShowVideo={setShowVideo} />
            </div>

          </main>

          <Timeline
            scenes={scenes}
            timeline={timeline}
            selectedId={selectedId}
            currentTime={videoMode ? currentTime : cursor}
            range={span}
            onSelect={selectScene}
            onSeek={seek}
            onRange={setRange}
          />
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/10 bg-zinc-900 px-3.5 py-2.5 text-sm text-zinc-200 shadow-2xl"
          >
            <Check className="size-4 text-emerald-400" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
