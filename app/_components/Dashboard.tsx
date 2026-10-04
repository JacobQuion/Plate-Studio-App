"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, Download, EllipsisVertical, LogOut, Play, Plus, Search, Trash2, UserRound, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TEMPLATES, demoProjectId } from "@/lib/demo-menus";
import { PLATFORM_INFO, type Platform } from "@/lib/platforms";
import type { DemoStatus } from "@/lib/demos";
import type { ProjectSummary } from "@/lib/projects";
import { PlatformIcon } from "./PlatformIcon";
import { useDemoStatuses } from "./useDemoStatuses";
import { cx, formatTime } from "./shared";

const STATUS: Record<ProjectSummary["status"], { label: string; dot: string; title: string }> = {
  ready: { label: "Ready", dot: "bg-emerald-400", title: "The video includes every edit" },
  edited: { label: "Unrendered edits", dot: "bg-amber-400", title: "There are edits the video doesn't include yet" },
  draft: { label: "Draft", dot: "bg-zinc-400", title: "Not rendered yet" },
};

function ago(ms: number, now: number) {
  const s = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secs] of [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3600], ["minute", 60]] as const) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return "just now";
}

const fullDate = (ms: number) => new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });

/** Saved projects are hidden for now: the home page shows only "New project" and the examples. */
const SHOW_PROJECTS = false;

export interface Owner {
  firstName: string;
  lastName: string;
  email: string;
  restaurant: string;
}

/** Every saved project, newest edit first. */
/** `exampleTitles`: each example card's title, which the owner can change from the example's studio. */
export function Dashboard({ projects: initial, exampleTitles, owner }: { projects: ProjectSummary[]; exampleTitles: Record<string, string>; owner: Owner }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setProjects(initial), [initial]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const newProject = (template?: string) => router.push(`/studio/${template ? demoProjectId(template) : crypto.randomUUID()}`);

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete "${p.name || "New Project"}"? Its video and chat will be deleted too. Posts you've published stay up.`)) return;
    setProjects((list) => list.filter((x) => x.id !== p.id));
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" }).catch(() => {});
    router.refresh();
  };

  const q = query.trim().toLowerCase();
  const shown = q ? projects.filter((p) => [p.name, ...p.dishes].some((s) => s.toLowerCase().includes(q))) : projects;

  return (
    <div className="min-h-dvh bg-[#08080a]">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0c0c0e]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" className="size-7" />
            <span className="font-display text-[17px] font-bold tracking-tight text-white">Plate Studio</span>
          </Link>
          <AccountMenu owner={owner} />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6">
        <NewAd titles={exampleTitles} onPick={newProject} />

        {SHOW_PROJECTS && projects.length > 0 && (
          <section className="mt-14">
            {projects.length > 4 && (
              <div className="mb-6 flex justify-end">
                <label className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search restaurants or dishes"
                    aria-label="Search projects"
                    className="h-10 w-full rounded-full bg-white/[0.04] pr-4 pl-9 text-sm text-zinc-100 ring-1 ring-white/10 outline-none placeholder:text-zinc-500 focus:ring-brand-500"
                  />
                </label>
              </div>
            )}

            <ul className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence initial={false}>
                {shown.map((p) => (
                  <motion.li key={p.id} layout exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.2 }}>
                    <ProjectCard project={p} now={now} onDelete={() => remove(p)} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            {q && !shown.length && <p className="py-16 text-center text-sm text-zinc-500">No projects match &ldquo;{query}&rdquo;.</p>}
          </section>
        )}
      </main>
    </div>
  );
}

/** "New project" plus the sample restaurants, as one 3×2 grid. Templates open their shared demo project. */
function NewAd({ titles, onPick }: { titles: Record<string, string>; onPick: (template?: string) => void }) {
  const demos = useDemoStatuses();
  return (
    <section>
      <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl mb-6">Project Library</h1>
      <ul className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <button onClick={() => onPick()} className="group block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-white/15 text-zinc-400 transition group-hover:border-brand-500/70 group-hover:bg-brand-500/[0.04] group-hover:text-white">
              <span className="flex size-11 items-center justify-center rounded-full bg-white/[0.06] transition group-hover:bg-brand-500">
                <Plus className="size-5" />
              </span>
            </div>
            <p className="mt-3 truncate text-[15px] font-semibold text-zinc-100">New Project</p>
            <p className="mt-0.5 text-[13px] text-zinc-500">Start from scratch</p>
          </button>
        </li>
        {TEMPLATES.map((t, i) => (
          <li key={t.id}>
            <TemplateCard template={t} title={titles[t.id] || `Example ${i + 1}: ${t.name}`} demo={demos?.[t.id]} onPick={() => onPick(t.id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One example, with its server-side render's status. */
function TemplateCard({ template: t, title, demo, onPick }: { template: (typeof TEMPLATES)[number]; title: string; demo?: DemoStatus; onPick: () => void }) {
  const badge: { dot: string; label: string; title?: string } =
    demo?.status === "ready"
      ? { dot: "bg-emerald-400", label: "Ready" }
      : demo?.status === "failed"
        ? { dot: "bg-amber-400", label: "Render failed, retrying soon", title: demo.error }
        : demo?.status === "rendering"
          ? { dot: "animate-pulse bg-brand-400", label: "Rendering…" }
          : demo?.status === "queued"
            ? { dot: "bg-zinc-400", label: "Up next" }
            : { dot: "bg-zinc-400", label: "Example" };
  return (
    <button onClick={onPick} className="group block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/[0.08] transition group-hover:ring-white/20">
        <PreviewLoop src={`/demos/${t.id}.mp4`} poster={t.imageUrl.replace("w=1600", "w=800")} />
        <span title={badge.title} className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur-md">
          <span className={cx("size-1.5 rounded-full", badge.dot)} /> {badge.label}
        </span>
        <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold text-zinc-950 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Play className="size-3 fill-current" strokeWidth={3} /> Watch demo
        </span>
      </div>
      <p className="mt-3 truncate text-[15px] font-semibold text-zinc-100">{title}</p>
      <p className="mt-0.5 text-[13px] text-zinc-500">{t.cuisine}</p>
    </button>
  );
}

/** Where the preview loop starts (past the fade-in from black) and ends (once the first dish is on screen). */
const LOOP_START = 0.6;
const LOOP_END = 6;

/** The demo's opening seconds on a muted loop, or its photo if the video can't play. */
function PreviewLoop({ src, poster }: { src: string; poster: string }) {
  const [failed, setFailed] = useState(false);
  const cls = "size-full object-cover transition duration-500 group-hover:scale-[1.03]";
  if (failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={poster} alt="" loading="lazy" className={cls} />;
  }
  return (
    <video
      src={`${src}#t=${LOOP_START}`}
      poster={poster}
      autoPlay
      muted
      playsInline
      preload="auto"
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (v.currentTime >= LOOP_END) v.currentTime = LOOP_START;
      }}
      onEnded={(e) => {
        e.currentTarget.currentTime = LOOP_START;
        void e.currentTarget.play();
      }}
      onError={() => setFailed(true)}
      className={cls}
    />
  );
}

function ProjectCard({ project: p, now, onDelete }: { project: ProjectSummary; now: number; onDelete: () => void }) {
  const status = STATUS[p.status];
  const href = `/studio/${p.id}`;
  // Latest post per platform.
  const published = new Map<Platform, ProjectSummary["publishes"][number]>();
  for (const x of p.publishes) published.set(x.platform, x);

  return (
    <article className="group relative">
      <Link href={href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-b from-zinc-900 to-zinc-950 ring-1 ring-white/[0.08] transition group-hover:ring-white/20">
          {p.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumbUrl} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-1.5 text-zinc-600">
              <UtensilsCrossed className="size-6" />
              <span className="text-xs">No photos yet</span>
            </div>
          )}
          <span title={status.title} className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur-md">
            <span className={cx("size-1.5 rounded-full", status.dot)} /> {status.label}
          </span>
          {p.durationSeconds > 0 && (
            <span
              title={p.durationEstimated ? "Estimated length (not rendered yet)" : "Video length"}
              className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[12px] font-semibold text-white tabular-nums"
            >
              {p.durationEstimated && "~"}
              {formatTime(p.durationSeconds)}
            </span>
          )}
        </div>
      </Link>

      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-zinc-100">
            <Link href={href} className="hover:underline">
              {p.name || "New Project"}
            </Link>
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            {p.dishes.length} {p.dishes.length === 1 ? "dish" : "dishes"} ·{" "}
            <span title={`Edited ${fullDate(p.updatedAt)} · created ${fullDate(p.createdAt)}`} suppressHydrationWarning>
              Edited {ago(p.updatedAt, now)}
            </span>
          </p>
          {p.dishes.length > 0 && <p className="mt-0.5 truncate text-[13px] text-zinc-600">{p.dishes.join(", ")}</p>}
          {published.size > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              {[...published.values()].map((x) => {
                const label = `Published to ${PLATFORM_INFO[x.platform].label} ${ago(x.at, now)}`;
                const icon = <PlatformIcon platform={x.platform} className="size-5" />;
                return x.url ? (
                  <a key={x.platform} href={x.url} target="_blank" rel="noreferrer" title={label} className="rounded transition hover:scale-110">
                    {icon}
                  </a>
                ) : (
                  <span key={x.platform} title={label}>
                    {icon}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <CardMenu project={p} onDelete={onDelete} />
      </div>
    </article>
  );
}

function CardMenu({ project: p, onDelete }: { project: ProjectSummary; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition";
  return (
    <div ref={root} className="relative -mt-1 -mr-1.5 shrink-0">
      <button
        aria-label="Project options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx("flex size-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-white", open && "bg-white/[0.06] text-white")}
      >
        <EllipsisVertical className="size-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-xl bg-zinc-900 p-1 shadow-2xl ring-1 ring-white/10">
          <Link href={`/studio/${p.id}`} role="menuitem" className={cx(item, "text-zinc-200 hover:bg-white/[0.06]")}>
            <Clapperboard className="size-4 text-zinc-400" /> Open in studio
          </Link>
          {p.jobId && (
            <a href={`/api/video/${p.jobId}?download=1`} download role="menuitem" onClick={() => setOpen(false)} className={cx(item, "text-zinc-200 hover:bg-white/[0.06]")}>
              <Download className="size-4 text-zinc-400" /> Download MP4
            </a>
          )}
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className={cx(item, "text-rose-300 hover:bg-rose-500/10")}
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

/** Initials button with who's signed in and Sign out. */
function AccountMenu({ owner }: { owner: Owner }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.assign("/login");
  };

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Account"
        className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-3 text-[14px] text-zinc-300 transition hover:bg-white/[0.04]"
      >
        <span className="hidden max-w-48 truncate sm:inline">{owner.restaurant}</span>
        <span className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white">
          <UserRound className="size-[18px]" />
        </span>
      </button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-64 rounded-xl bg-zinc-900 p-1.5 shadow-2xl ring-1 ring-white/10">
          <div className="px-2.5 py-2">
            <p className="truncate text-[14px] font-medium text-zinc-100">
              {owner.firstName} {owner.lastName}
            </p>
            <p className="truncate text-[13px] text-zinc-500">{owner.email}</p>
          </div>
          <div className="my-1 h-px bg-white/[0.06]" />
          <button onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] text-zinc-300 transition hover:bg-white/[0.06] hover:text-white">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
