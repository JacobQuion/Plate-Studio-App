"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, Download, EllipsisVertical, Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { TEMPLATES } from "@/lib/demo-menus";
import { PLATFORM_INFO, type Platform } from "@/lib/platforms";
import type { ProjectSummary } from "@/lib/projects";
import { PlatformIcon } from "./PlatformIcon";
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

/** Every saved project, newest edit first. */
export function Dashboard({ projects: initial }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setProjects(initial), [initial]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const newProject = (template?: string) => router.push(`/studio/${crypto.randomUUID()}${template ? `?template=${template}` : ""}`);

  const remove = async (p: ProjectSummary) => {
    if (!confirm(`Delete "${p.name || "Untitled project"}"? Its video and chat will be deleted too. Posts you've published stay up.`)) return;
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
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-8 pb-16 sm:px-6">
        <NewAd onPick={newProject} />

        {projects.length > 0 && (
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

/** "New project" plus the sample restaurants, as one 3×2 grid. Templates open a new project with their menu loaded. */
function NewAd({ onPick }: { onPick: (template?: string) => void }) {
  return (
    <section>
      <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl mb-6">Make a new ad</h1>
      <ul className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <button
            onClick={() => onPick()}
            className="group flex aspect-video w-full flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-white/15 text-zinc-400 transition hover:border-brand-500/70 hover:bg-brand-500/[0.04] hover:text-white"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-white/[0.06] transition group-hover:bg-brand-500">
              <Plus className="size-5" />
            </span>
            <span className="text-[15px] font-semibold">New project</span>
            <span className="-mt-1.5 text-[13px] text-zinc-500">Your photos or your Yelp / Google Maps page</span>
          </button>
        </li>
        {TEMPLATES.map((t) => (
          <li key={t.id}>
            <button onClick={() => onPick(t.id)} className="group block w-full rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <div className="relative aspect-video overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-white/[0.08] transition group-hover:ring-white/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.imageUrl.replace("w=1600", "w=800")} alt="" loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                <span className="absolute top-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur-md">Example</span>
                <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold text-zinc-950 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Plus className="size-3" strokeWidth={3} /> Use template
                </span>
              </div>
              <p className="mt-3 truncate text-[15px] font-semibold text-zinc-100">{t.name}</p>
              <p className="mt-0.5 text-[13px] text-zinc-500">
                {t.cuisine} · {t.detail}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
              {p.name || "Untitled project"}
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
