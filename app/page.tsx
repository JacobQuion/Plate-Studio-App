"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Clapperboard, LoaderCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  dishScenes,
  estimateVoiceSeconds,
  planTimeline,
  resolveScenes,
  setAdDishes,
  type AdProject,
  type LibraryDish,
  type Timeline as TimelineData,
} from "@/lib/ad-plan";
import type { GenerateDoneEvent, MenuImportResult } from "@/lib/types";
import { activateLocation, archiveDish, archiveLocation, emptyWorkspace, restoreDish, restoreLocation, type Workspace } from "@/lib/workspace";
import { loadWorkspace, saveWorkspace } from "@/lib/local-workspace";
import { downloadRenderedVideo, readRenderEvents, renderKey } from "@/lib/render-client";
import type { RestaurantLocation } from "@/lib/locations";
import { LibraryPanel } from "./_components/LibraryPanel";
import { LocationSearch } from "./_components/LocationSearch";
import { ChatPane, type PendingPhoto } from "./_components/ChatPane";
import { Preview } from "./_components/Preview";
import { InfoButton } from "./_components/InfoButton";
import { RenderStatus } from "./_components/RenderStatus";
import { Timeline } from "./_components/Timeline";
import { fileToDataUri, formatTime as formatClock, freshStages, titleFromFilename, type ChatMessage, type GenState } from "./_components/shared";

type Snapshot = { project: AdProject; library: LibraryDish[] };

const msgId = () => Math.random().toString(36).slice(2);
/** Uploaded photos stay in the browser; the assistant only needs their metadata. */
const stripUploads = (lib: LibraryDish[]) => lib.map((d) => (d.imageUrl.startsWith("data:") ? { ...d, imageUrl: "" } : d));
const PANEL_MIN = 300;
const PANEL_MAX = 720;
const PANEL_KEY = "plate-studio:panel-width";
const clampPanel = (w: number) => Math.round(Math.max(PANEL_MIN, Math.min(PANEL_MAX, window.innerWidth * 0.6, w)));
export default function Studio() {
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const { project, library } = workspace;
  const setProject = useCallback((update: SetStateAction<AdProject>) => setWorkspace((w) => ({ ...w, project: typeof update === "function" ? update(w.project) : update })), []);
  const setLibrary = useCallback((update: SetStateAction<LibraryDish[]>) => setWorkspace((w) => ({ ...w, library: typeof update === "function" ? update(w.library) : update })), []);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Loading local workspace…");
  const [panel, setPanel] = useState<"context" | "library">("context");
  const [searchOpen, setSearchOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<GenerateDoneEvent | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [gen, setGen] = useState<GenState>({ phase: "idle" });
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(400);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Project state before each assistant turn, so the turn can be reverted. */
  const snapshots = useRef(new Map<string, Snapshot>());
  const renderLock = useRef(false);
  const exportLock = useRef(false);
  const uploadLock = useRef(false);

  const running = gen.phase === "running";
  const scenes = useMemo(() => resolveScenes(project, library), [project, library]);
  const hasDishes = scenes.some((s) => s.kind === "dish");
  const stale = !!result && renderedKey !== renderKey(project, library);
  const videoMode = !!result && !running;

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

  // Restore before enabling edits; never overwrite saved photos with the empty initial state.
  useEffect(() => {
    let cancelled = false;
    loadWorkspace().then((saved) => {
      if (cancelled) return;
      if (saved) setWorkspace(saved);
      setStorageAvailable(true);
      setSaveStatus("Saved on this device");
    }).catch(() => {
      if (!cancelled) setSaveStatus("Local saving unavailable. Keep this tab open to preserve your edits.");
    }).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready || !storageAvailable) return;
    let current = true;
    setSaveStatus("Saving on this device…");
    saveWorkspace(workspace).then(() => { if (current) setSaveStatus("Saved on this device"); }).catch(() => { if (current) setSaveStatus("Couldn't save locally. Keep this tab open and check available storage."); });
    return () => { current = false; };
  }, [workspace, ready, storageAvailable]);

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
  const render = async () => {
    if (renderLock.current || !ready || busy || uploading || exporting) return;
    const used = new Set(dishScenes(project).map((s) => s.dishId));
    const featured = library.filter((d) => used.has(d.id));
    if (!featured.length) return setToast("Add at least one dish photo before rendering.");
    if (featured.some((d) => !d.imageUrl)) return setToast("Add a photo for every selected dish before rendering.");
    renderLock.current = true;
    const key = renderKey(project, library);
    const startedAt = Date.now();
    let stages = freshStages();
    setGen({ phase: "running", stages, startedAt });
    try {
      const res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, library: featured }),
        signal: AbortSignal.timeout(15 * 60_000),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      for await (const event of readRenderEvents(res.body)) {
        if (event.type === "progress") {
          stages = { ...stages, [event.stage]: { status: event.status, detail: event.detail } };
          setGen({ phase: "running", stages, startedAt });
        } else if (event.type === "done") {
          setResult(event);
          setGen({ phase: "done", stages, result: event, elapsed: (Date.now() - startedAt) / 1000 });
          setRenderedKey(key);
          setCurrentTime(0);
          return;
        } else throw new Error(event.message);
      }
      throw new Error("The render connection ended before the video was ready. Please try again.");
    } catch (err) {
      setGen({ phase: "error", stages, message: err instanceof Error ? err.message : "Video generation failed. Please try again." });
    } finally { renderLock.current = false; }
  };

  // ---- Chat --------------------------------------------------------------------
  const addFiles = async (files: File[]) => {
    if (!ready || busy || running || exporting || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    const photos: PendingPhoto[] = [];
    for (const file of files.filter((f) => f.type.startsWith("image/"))) {
      try {
        const [full, thumb] = await Promise.all([fileToDataUri(file, 2880), fileToDataUri(file, 640, 0.8)]);
        photos.push({ dishId: `up-${crypto.randomUUID()}`, name: file.name, full, thumb });
      } catch { setToast(`Couldn't read ${file.name}. Try a JPEG, PNG or WebP image.`); }
    }
    if (photos.length) {
      setPending((p) => [...p, ...photos]);
      setWorkspace((w) => ({ ...w,
        library: [...w.library, ...photos.map((p) => ({ id: p.dishId, title: titleFromFilename(p.name), price: "", description: "", imageUrl: p.full, uploaded: true }))],
        project: setAdDishes(w.project, [...dishScenes(w.project).map((s) => s.dishId!), ...photos.map((p) => p.dishId)]),
      }));
    }
    setUploading(false);
    uploadLock.current = false;
  };

  const exportVideo = async () => {
    if (!result || stale || running || exportLock.current) return;
    exportLock.current = true;
    setExporting(true);
    try { await downloadRenderedVideo(result.downloadUrl); }
    catch (err) { setToast(err instanceof Error ? err.message : "Export failed. Please try again."); }
    finally { setExporting(false); exportLock.current = false; }
  };

  const removeDish = (id: string) => {
    if (!ready || busy || running || uploading || exporting) return;
    setWorkspace((w) => archiveDish(w, id));
    setPending((p) => p.filter((x) => x.dishId !== id));
    snapshots.current.clear();
  };

  const addLocation = async (location: RestaurantLocation) => {
    if (!ready || busy || running || uploading || exporting) return;
    setSearchOpen(false);
    setPanel("library");
    setWorkspace((w) => activateLocation(w, location));
    if (location.source === "manual") return;
    setBusy(true);
    try {
      const res = await fetch("/api/scrape-menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: location.url }) });
      const data = await res.json() as MenuImportResult & { error?: string };
      if (!res.ok) throw new Error(data.error || "Menu import failed.");
      const dishes: LibraryDish[] = data.dishes.map((d) => ({ ...d, id: `${location.id}:${d.id}`, locationId: location.id }));
      setWorkspace((w) => {
        const added = dishes.filter((d) => !w.library.some((x) => x.id === d.id));
        return { ...w, library: [...w.library, ...added], project: setAdDishes(w.project, [...dishScenes(w.project).map((s) => s.dishId!), ...added.map((d) => d.id)]) };
      });
      setToast(dishes.length ? `Added ${dishes.length} dish photos from ${location.name}.` : "Location saved. Upload your dish photos to get started.");
    } catch { setToast("Location saved. Menu photos couldn't be imported; upload your own photos."); }
    finally { setBusy(false); }
  };

  const undo = (messageId: string) => {
    const snap = snapshots.current.get(messageId);
    if (!snap || !ready || busy || running || uploading || exporting) return;
    setProject(snap.project);
    // Restore edited dish details, but keep dishes added since (e.g. uploads) in the library.
    const known = new Set(snap.library.map((d) => d.id));
    setLibrary((lib) => [...snap.library, ...lib.filter((d) => !known.has(d.id))]);
    snapshots.current.delete(messageId);
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, reverted: true } : x)));
  };

  const send = async (text: string) => {
    if (busy || running || uploading || exporting || !ready) return;
    const photos = pending;
    const before: Snapshot = { project, library };
    const lib = library;
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
      if (data.render) setToast("Your edits are ready. Click Render to generate the video.");
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
  const editing = busy || running || uploading || exporting || !ready;

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

  const toggleDish = (id: string) => setProject((p) => { const ids = dishScenes(p).map((s) => s.dishId!); return setAdDishes(p, ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]); });

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
              { title: "Export", text: "Downloads the completed MP4. Render your latest edits first." },
            ]}
          />
          <button
            onClick={() => render()}
            disabled={!hasDishes || editing}
            title="Generate a video from your selected dishes"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-white/15 px-5 text-[15px] font-semibold text-white transition hover:bg-white/[0.06] disabled:opacity-40"
          >
            <Clapperboard className="size-4" /> Render
          </button>
          <button
            onClick={exportVideo}
            disabled={!result || stale || editing}
            title={!result ? "Render a video before exporting" : stale ? "Render your latest changes before exporting" : "Download the generated MP4"}
            className="accent-fill accent-ring relative inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-brand-700 to-brand-500 px-5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {/* Keep the label in place while rendering so the button doesn't change size */}
            <span className={exporting ? "invisible" : undefined}>Export</span>
            {exporting && <LoaderCircle aria-label="Downloading video" className="absolute inset-0 m-auto size-4 animate-spin" />}
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
                  { title: "Yelp / Google Maps", text: "Search by restaurant name and city, then save the location and add your dish photos." },
                ]}
              />
            </span>
          </div>
          <div className="flex shrink-0 gap-2 px-4 pt-3">
            <button onClick={() => setPanel("context")} className={`rounded-lg px-3 py-2 text-sm ${panel === "context" ? "bg-white/10 text-white" : "text-zinc-500"}`}>Assistant</button>
            <button onClick={() => setPanel("library")} className={`rounded-lg px-3 py-2 text-sm ${panel === "library" ? "bg-white/10 text-white" : "text-zinc-500"}`}>Dishes, locations & history</button>
          </div>
          {panel === "context" ? <ChatPane
            messages={messages} busy={editing} pending={pending} onSearch={() => setSearchOpen(true)} library={library} inAd={dishIds} dishesDisabled={editing}
            onToggleDish={toggleDish} onAddFiles={addFiles} onRemovePending={removeDish} onSend={send} onUndo={undo}
          /> : <LibraryPanel workspace={workspace} disabled={editing} onSearch={() => setSearchOpen(true)} onAddFiles={addFiles} onToggleDish={toggleDish}
            onRemoveDish={removeDish} onRestoreDish={(id) => setWorkspace((w) => restoreDish(w, id))}
            onSelectLocation={(id) => { const l = workspace.locations.find((x) => x.id === id); if (l) setWorkspace((w) => activateLocation(w, l)); }}
            onRemoveLocation={(id) => { setWorkspace((w) => archiveLocation(w, id)); snapshots.current.clear(); }}
            onRestoreLocation={(id) => setWorkspace((w) => restoreLocation(w, id))}
          />}
          <p role="status" className="shrink-0 border-t border-white/5 px-4 py-2 text-xs text-zinc-500">{saveStatus}</p>
        </aside>

        {/* Editor: stage and timeline --------------------------------------- */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Stage ---------------------------------------------------------------- */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2 pt-2 pb-1 sm:px-3 sm:pt-3">
              <div className="h-[calc((100vw-1rem)*9/16)] shrink-0 lg:h-auto lg:min-h-0 lg:flex-1">
                <Preview
                  ref={videoRef}
                  gen={gen}
                  dishCount={dishIds.length}
                  stale={stale}
                  result={result}
                  busy={editing}
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
                  onSearch={() => setSearchOpen(true)}
                  onRender={() => void render()}
                />
              </div>
              <RenderStatus gen={gen} stale={stale} canRender={hasDishes && !editing} hasScene={hasDishes} onRender={() => void render()} />
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

      {searchOpen && <LocationSearch onClose={() => setSearchOpen(false)} onSelect={(l) => void addLocation(l)} />}
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
