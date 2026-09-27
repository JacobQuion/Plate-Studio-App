"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Clapperboard, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dishScenes,
  editKey,
  estimateVoiceSeconds,
  newProject,
  planTimeline,
  resolveScenes,
  setAdDishes,
  type AdProject,
  type LibraryDish,
  type Timeline as TimelineData,
} from "@/lib/ad-plan";
import { DEMOS, DEMO_RESTAURANTS, demoForProject, type DemoRestaurant } from "@/lib/demo-menus";
import type { ProjectRecord } from "@/lib/projects";
import type { GenerateDoneEvent, GenerateStreamEvent, StageId } from "@/lib/types";
import { ChatPane, type PendingPhoto } from "@/app/_components/ChatPane";
import { ExportDialog } from "@/app/_components/ExportDialog";
import { Preview } from "@/app/_components/Preview";
import { InfoButton } from "@/app/_components/InfoButton";
import { RenderStatus } from "@/app/_components/RenderStatus";
import { Timeline } from "@/app/_components/Timeline";
import { useDemoStatuses } from "@/app/_components/useDemoStatuses";
import { fileToDataUri, freshStages, titleFromFilename, type ChatMessage, type GenState, type StageState } from "@/app/_components/shared";

const SAMPLE_URL = "https://www.yelp.com/biz/caffe-strada-berkeley";
/** The café sample imports a real Yelp page through the assistant; the rest are built in. */
const SAMPLES = [{ id: "cafe", label: "Café" }, ...DEMO_RESTAURANTS.map(({ id, label }) => ({ id, label }))];

type Snapshot = { project: AdProject; library: LibraryDish[] };

const msgId = () => Math.random().toString(36).slice(2);
/** Uploaded photos stay in the browser; the assistant only needs their metadata. */
const stripUploads = (lib: LibraryDish[]) => lib.map((d) => (d.imageUrl.startsWith("data:") ? { ...d, imageUrl: "" } : d));
/** What the autosave sends; also used to tell whether anything changed since the last save. */
const saveKey = (p: AdProject, lib: LibraryDish[], msgs: ChatMessage[]) => editKey(p, lib) + JSON.stringify(msgs.map((m) => [m.id, m.reverted]));
const SAVE_DELAY = 800;
const PANEL_MIN = 300;
const PANEL_MAX = 720;
const PANEL_KEY = "plate-studio:panel-width";
const clampPanel = (w: number) => Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, window.innerWidth * 0.6, w)));

/** A saved render, shown as if it had just finished. */
function restoredGen(initial: ProjectRecord | null): GenState {
  const r = initial?.render;
  if (!r) return { phase: "idle" };
  const { editKey: _key, renderedAt: _at, elapsed, ...rest } = r;
  const result: GenerateDoneEvent = { type: "done", ...rest, videoUrl: `/api/video/${r.jobId}`, downloadUrl: `/api/video/${r.jobId}?download=1` };
  const stages = freshStages();
  for (const k of Object.keys(stages) as (keyof typeof stages)[]) stages[k] = { status: "done" };
  return { phase: "done", stages, result, elapsed };
}

/** How long a demo's saved render takes to "render" again on each visit. */
const REPLAY_MS = 6500;
/** Roughly how long an example takes to render on the server, for its progress bar. */
const DEMO_RENDER_MS = 90_000;

/** The render stages at `f` (0..1) through a replayed render of `scenes` scenes. */
function replayStages(f: number, scenes: number): Record<StageId, StageState> {
  const stages = freshStages();
  const steps: [StageId, number][] = [["assets", 0.12], ["motion", 0.3], ["voice", 0.45], ["assemble", 1]];
  let from = 0;
  for (const [stage, to] of steps) {
    if (f >= to) stages[stage] = { status: "done" };
    else if (f >= from) {
      const total = stage === "assemble" ? scenes + 1 : undefined;
      stages[stage] = { status: "active", total, completed: total ? Math.floor(((f - from) / (to - from)) * total) : undefined };
    }
    from = to;
  }
  return stages;
}

/**
 * `initial` is the saved project (its render only when the video file still exists), or null for a new one.
 * `template` is a sample to load into a new project.
 * `demo`: a dashboard example (a shared project). It renders once, then each visit replays that render;
 * editing it saves the edits as a new project of the user's own instead.
 */
export function Studio({ id: routeId, initial, template, demo = false }: { id: string; initial: ProjectRecord | null; template?: string; demo?: boolean }) {
  const router = useRouter();
  const [project, setProject] = useState<AdProject>(() => initial?.project ?? newProject());
  const [library, setLibrary] = useState<LibraryDish[]>(() => initial?.library ?? []);
  const [messages, setMessages] = useState<ChatMessage[]>(() => (initial?.messages ?? []) as unknown as ChatMessage[]);
  const [linkRequest, setLinkRequest] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  /** The project this studio saves to: the route's, until an edited demo becomes a copy. */
  const [id, setId] = useState(routeId);
  const idRef = useRef(routeId);
  const replay = demo && !!initial?.render;
  const [gen, setGen] = useState<GenState>(() => (replay ? { phase: "running", stages: freshStages(), startedAt: Date.now(), replayUntil: Date.now() + REPLAY_MS } : restoredGen(initial)));
  const [renderedKey, setRenderedKey] = useState<string | null>(initial?.render?.editKey ?? null);
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(400);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Project state before each assistant turn, so the turn can be reverted. */
  const snapshots = useRef(new Map<string, Snapshot>());

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

  // ---- Autosave ----------------------------------------------------------------
  // Saved to the server (and so the dashboard) shortly after each edit. Brand-new
  // projects aren't saved until they have something in them, and ones opened from a
  // template not until they differ from it, so just looking at a template adds no card.
  const latest = useRef({ project, library, messages });
  latest.current = { project, library, messages };
  const savedKey = useRef<string | null>(initial ? saveKey(initial.project, initial.library, (initial.messages ?? []) as unknown as ChatMessage[]) : null);
  /** The untouched template's key: "pending" until the first save after it loads records it. A saved demo's is what's saved. */
  const templateKey = useRef<string | null>(template ? "pending" : demo ? savedKey.current : null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  /** `force` saves an untouched template too (rendering needs the project on the server). */
  const save = useCallback((force = false) => {
    saving.current = saving.current.then(async () => {
      const { project: p, library: lib, messages: msgs } = latest.current;
      const key = saveKey(p, lib, msgs);
      if (key === savedKey.current) return;
      if (savedKey.current === null && !p.restaurant.trim() && !lib.length && !msgs.length) return;
      if (savedKey.current === null && templateKey.current === "pending") templateKey.current = key;
      if (savedKey.current === null && key === templateKey.current && !force) return;
      // An edited demo: keep the example as it is and save the edits as a new project.
      if (demo && idRef.current === routeId && key !== templateKey.current) {
        idRef.current = crypto.randomUUID();
        savedKey.current = null;
        setId(idRef.current);
        window.history.replaceState(null, "", `/studio/${idRef.current}`);
      }
      try {
        const res = await fetch(`/api/projects/${idRef.current}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: p, library: lib, messages: msgs.filter((m) => !m.error || m.role === "user") }),
        });
        if (res.ok) savedKey.current = key;
      } catch {
        // Offline or the server restarted; the next edit retries.
      }
    });
    return saving.current;
  }, [demo, routeId]);
  useEffect(() => {
    const t = setTimeout(save, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [project, library, messages, save]);
  // Leaving the page with unsaved edits: warn, since the debounce may not have fired yet.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const { project: p, library: lib, messages: msgs } = latest.current;
      if (savedKey.current !== null && saveKey(p, lib, msgs) !== savedKey.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const goBack = async (e: React.MouseEvent) => {
    e.preventDefault();
    await save();
    router.push("/");
  };

  // Keep a valid selection: default to the first dish scene.
  useEffect(() => {
    if (!hasDishes) return setSelectedId(null);
    if (!scenes.some((s) => s.id === selectedId)) setSelectedId(scenes.find((s) => s.kind === "dish")?.id ?? null);
  }, [scenes, selectedId, hasDishes]);

  // ---- Rendering -------------------------------------------------------------
  /** Render the ad. Resolves to the finished video, or null if it failed. */
  const render = async (p: AdProject = project, lib: LibraryDish[] = library): Promise<GenerateDoneEvent | null> => {
    if (running) return null;
    const used = new Set(dishScenes(p).map((s) => s.dishId));
    const key = editKey(p, lib);
    const startedAt = Date.now();
    let stages = freshStages();
    let eta: { seconds: number; floor: number; at: number } | undefined;
    setGen({ phase: "running", stages, startedAt });
    const fail = (message: string) => {
      setGen({ phase: "error", stages, message });
      return null;
    };

    try {
      // Make sure the project exists on the server so the finished video is saved to it.
      await save(true);
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: p,
          library: lib.filter((d) => used.has(d.id)),
          projectId: idRef.current,
          editKey: key,
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
              [event.stage]: { status: event.status, detail: event.detail, completed: event.completed, total: event.total },
            };
            if (event.etaSeconds !== undefined) eta = { seconds: event.etaSeconds, floor: event.etaFloorSeconds ?? 0, at: Date.now() };
            setGen({ phase: "running", stages, startedAt, eta });
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
            return event;
          } else {
            return fail(event.message);
          }
        }
      }
      return fail("The render stream ended unexpectedly.");
    } catch (err) {
      return fail((err as Error).message);
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

  const loadSample = (sample: DemoRestaurant) => {
    const known = new Set(sample.dishes.map((d) => d.id));
    setLibrary((lib) => [...lib.filter((d) => !known.has(d.id)), ...sample.dishes]);
    setProject((p) => setAdDishes({ ...p, restaurant: sample.name, website: sample.website, cta: sample.cta }, sample.dishes.map((d) => d.id)));
    setMessages((m) => [
      ...m,
      {
        id: msgId(),
        role: "assistant",
        text: demo
          ? `This is a sample ad for ${sample.name}. Tell me what to change, and your edits are saved as a project of your own.`
          : `I loaded the sample menu for ${sample.name} with ${sample.dishes.length} dishes. Hit Render to make the video, or tell me what to change first.`,
      },
    ]);
  };

  const trySample = (sampleId: string) => {
    const sample = DEMO_RESTAURANTS.find((d) => d.id === sampleId);
    if (!sample) return send(`Make an ad from this menu: ${SAMPLE_URL}`);
    if (busy || running) return;
    loadSample(sample);
  };

  /** The video with every edit in it, rendering first when needed. */
  const latestVideo = async () => (result && !stale ? result : render());

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

  // A new project started from a dashboard template. Once only (effects run twice in dev),
  // and drop the query so a reload doesn't load it again.
  const templateLoaded = useRef(false);
  useEffect(() => {
    if (!template || templateLoaded.current) return;
    templateLoaded.current = true;
    if (!demo) router.replace(`/studio/${routeId}`, { scroll: false });
    const sample = (demo ? DEMOS : DEMO_RESTAURANTS).find((d) => d.id === template);
    if (sample) loadSample(sample);
    else trySample(template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template]);

  // A demo without a video yet renders on the server (the dashboard usually started it already):
  // show its progress, then load the finished project and play it.
  const demoId = demoForProject(routeId)?.id;
  const server = useDemoStatuses(demo && !initial?.render, demoId)?.[demoId ?? ""] ?? null;
  const serverStartedAt = server?.status === "rendering" ? server.startedAt : null;
  useEffect(() => {
    if (serverStartedAt === null) return;
    const scenesCount = scenes.length;
    const tick = () => {
      const f = Math.min(0.97, (Date.now() - serverStartedAt) / DEMO_RENDER_MS);
      setGen({ phase: "running", stages: replayStages(f, scenesCount), startedAt: serverStartedAt, replayUntil: serverStartedAt + DEMO_RENDER_MS });
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverStartedAt]);
  useEffect(() => {
    if (server?.status === "failed") setGen({ phase: "error", stages: freshStages(), message: `The example couldn't render: ${server.error}. Retrying in a couple of minutes.` });
    if (server?.status !== "ready") return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/projects/${routeId}`, { cache: "no-store" }).catch(() => null);
      const record = res?.ok ? ((await res.json()) as ProjectRecord) : null;
      if (cancelled || !record?.render) return;
      const msgs = (record.messages ?? []) as unknown as ChatMessage[];
      // The saved example is now the untouched version: editing it from here saves a copy.
      savedKey.current = templateKey.current = saveKey(record.project, record.library, msgs);
      setProject(record.project);
      setLibrary(record.library);
      setMessages(msgs);
      setRenderedKey(record.render.editKey);
      setGen(restoredGen(record));
      setShowVideo(true);
      setCurrentTime(0);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  // A demo that has been rendered replays that render: the progress animation, then the video.
  useEffect(() => {
    if (!replay || gen.phase !== "running" || !gen.replayUntil) return;
    const { startedAt, replayUntil } = gen;
    const sceneCount = initial!.render!.timeline.length;
    const t = setInterval(() => {
      const f = (Date.now() - startedAt) / (replayUntil - startedAt);
      if (f >= 1) {
        clearInterval(t);
        setGen(restoredGen(initial));
        setShowVideo(true);
        setCurrentTime(0);
      } else setGen({ phase: "running", stages: replayStages(f, sceneCount), startedAt, replayUntil });
    }, 250);
    return () => clearInterval(t);
    // Keyed on the replay itself, not each progress update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay, gen.phase === "running" && gen.replayUntil]);

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
      if (data.render) void render(data.project, merged);
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
          <Link
            href="/"
            onClick={goBack}
            title="All projects"
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-[17px] leading-none font-medium text-zinc-500 transition hover:bg-white/[0.04] hover:text-zinc-200"
          >
            <ChevronLeft className="size-[18px]" /> Back
          </Link>
          <input
            value={project.restaurant}
            onChange={(e) => setProject((p) => ({ ...p, restaurant: e.target.value }))}
            disabled={editing}
            placeholder="Blank project"
            aria-label="Restaurant name"
            className="field-sizing-content max-w-[40vw] min-w-24 truncate rounded-md bg-transparent px-1.5 py-1 text-[17px] leading-7 font-medium text-zinc-100 outline-none placeholder:text-zinc-500 hover:bg-white/[0.04] focus:bg-white/[0.06]"
          />
          {result && !stale && (
            <span title="The video is up to date" className="hidden md:block">
              <Check className="size-4 text-emerald-400" strokeWidth={2.5} />
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Sit closer to Render than the buttons sit to each other. */}
          <span className="-mr-1 flex sm:-mr-2">
            <InfoButton
              label="About Render and Export"
              align="end"
              items={[
                { title: "Render", text: "Builds the video with your latest edits so you can preview it here." },
                { title: "Export", text: "Download your ad as an MP4 or publish it to YouTube, Instagram, TikTok and Facebook. New edits are rendered first." },
              ]}
            />
          </span>
          <button
            onClick={() => void render()}
            disabled={!hasDishes || busy || running || (!!result && !stale)}
            title={result && !stale ? "The video is up to date" : "Render the video with your latest edits"}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-5 text-[15px] font-semibold text-white transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            <Clapperboard className="size-4" /> Render
          </button>
          <button
            onClick={() => setExportOpen(true)}
            disabled={!hasDishes || busy}
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
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 pt-2 pb-1 sm:px-3 sm:pt-3 lg:pb-7">
              <div className="h-[calc((100vw-1rem)*9/16)] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
                <Preview
                  ref={videoRef}
                  scene={hasDishes ? selected : null}
                  rendering={running}
                  gen={gen}
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
                  samples={SAMPLES}
                  onSample={trySample}
                />
              </div>
              <RenderStatus gen={gen} stale={stale} canRender={hasDishes && !busy} showVideo={showVideo} onRender={() => void render()} onShowVideo={setShowVideo} />
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

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        projectId={id}
        project={project}
        scenes={scenes}
        video={result && !stale ? result : null}
        rendering={running}
        durationSeconds={timeline.total}
        getVideo={latestVideo}
      />

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
