"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, ExternalLink, LoaderCircle, Send, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { youtubeDetails, type AdProject, type ResolvedScene } from "@/lib/ad-plan";
import { PLATFORM_INFO, PLATFORMS, type ConnectionsResponse, type Platform, type Privacy, type SetupInfo } from "@/lib/platforms";
import type { GenerateDoneEvent } from "@/lib/types";
import { PlatformIcon } from "./PlatformIcon";
import { PlatformSetup } from "./PlatformSetup";
import { cx, formatTime } from "./shared";

type PostState = { state: "working" } | { state: "done"; url: string | null; note?: string } | { state: "error"; message: string; reconnect?: boolean };

const PRIVACY: { id: Privacy; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "Anyone can find and watch it." },
  { id: "unlisted", label: "Unlisted", hint: "YouTube: only people with the link. Other platforms post it publicly." },
  { id: "private", label: "Private", hint: "Only you. Instagram doesn't support private posts." },
];

const download = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
};

/**
 * Export: download the MP4, or publish it to every connected platform in one click.
 * Anything with edits the video doesn't include yet is rendered first.
 */
export function ExportDialog({
  open,
  onClose,
  projectId,
  project,
  scenes,
  video,
  rendering,
  durationSeconds,
  getVideo,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  project: AdProject;
  scenes: ResolvedScene[];
  /** The rendered video, when it includes every edit. */
  video: GenerateDoneEvent | null;
  rendering: boolean;
  durationSeconds: number;
  /** Resolves to an up-to-date video, rendering first if needed. */
  getVideo: () => Promise<GenerateDoneEvent | null>;
}) {
  const [connections, setConnections] = useState<ConnectionsResponse | null>(null);
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [edited, setEdited] = useState(false);
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [posts, setPosts] = useState<Partial<Record<Platform, PostState>>>({});
  const [phase, setPhase] = useState<"idle" | "rendering" | "publishing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [setupInfo, setSetupInfo] = useState<SetupInfo | null>(null);
  const [settingUp, setSettingUp] = useState<Platform | null>(null);

  const details = youtubeDetails(project, scenes);
  const tags = details.tags.split(", ").filter(Boolean);

  const loadConnections = useCallback(async (select?: Platform) => {
    try {
      const data = (await (await fetch("/api/connect")).json()) as ConnectionsResponse;
      setConnections(data);
      setSelected((s) => {
        const next = new Set([...s].filter((p) => data[p].connected));
        // First load: every connected platform. After connecting one: add it.
        if (!s.size && !select) PLATFORMS.forEach((p) => data[p].connected && next.add(p));
        if (select && data[select].connected) next.add(select);
        return next;
      });
    } catch {
      setError("Couldn't check your connected accounts.");
    }
  }, []);

  // Fresh copy each time the dialog opens, unless the user has written their own.
  useEffect(() => {
    if (!open) return;
    void loadConnections();
    void fetch("/api/connect/setup")
      .then((r) => r.json())
      .then(setSetupInfo)
      .catch(() => {});
    if (!edited) {
      setTitle(details.title);
      setCaption(details.description);
    }
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The sign-in popup reports back here.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== "plate-studio:connect") return;
      const platform = e.data.platform as Platform;
      if (e.data.error) setPosts((s) => ({ ...s, [platform]: { state: "error", message: e.data.error } }));
      else setPosts((s) => ({ ...s, [platform]: undefined }));
      void loadConnections(platform);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadConnections]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose]);

  const connect = (p: Platform) => {
    const w = 520;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    window.open(`/api/connect/${p}`, `connect-${p}`, `popup,width=${w},height=${h},left=${left},top=${top}`);
  };

  const disconnect = async (p: Platform) => {
    await fetch(`/api/connect/${p}`, { method: "DELETE" }).catch(() => {});
    setPosts((s) => ({ ...s, [p]: undefined }));
    void loadConnections();
  };

  const toggle = (p: Platform) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const busy = phase !== "idle" || rendering;
  const anyConnected = PLATFORMS.some((p) => connections?.[p].connected);
  const targets = PLATFORMS.filter((p) => selected.has(p) && connections?.[p].connected);
  const captionMax = Math.min(...(targets.length ? targets : PLATFORMS).map((p) => PLATFORM_INFO[p].captionMax));

  const ensureVideo = async () => {
    if (video) return video;
    setPhase("rendering");
    const v = await getVideo();
    setPhase("idle");
    if (!v) setError("The video didn't render. Check the message under the preview and try again.");
    return v;
  };

  const publish = async () => {
    if (!targets.length || busy) return;
    setError(null);
    const v = await ensureVideo();
    if (!v) return;
    setPhase("publishing");
    setPosts((s) => ({ ...s, ...Object.fromEntries(targets.map((p) => [p, { state: "working" }])) }));
    await Promise.all(
      targets.map(async (platform) => {
        let next: PostState;
        try {
          const res = await fetch("/api/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform, jobId: v.jobId, projectId, title, caption, tags, privacy }),
          });
          const data = await res.json();
          next = res.ok ? { state: "done", url: data.url, note: data.note } : { state: "error", message: data.error ?? `Failed (${res.status})`, reconnect: data.reconnect };
        } catch (err) {
          next = { state: "error", message: (err as Error).message };
        }
        setPosts((s) => ({ ...s, [platform]: next }));
        if (next.state === "done") setSelected((s) => new Set([...s].filter((p) => p !== platform)));
      }),
    );
    setPhase("idle");
  };

  const downloadVideo = async () => {
    const v = await ensureVideo();
    if (v) download(v.downloadUrl);
  };

  /** No app keys for this platform: download the file, copy the caption and open its upload page. */
  const uploadManually = (p: Platform) => {
    window.open(PLATFORM_INFO[p].uploadPage, "_blank", "noopener");
    void navigator.clipboard?.writeText(p === "youtube" ? `${title}\n\n${caption}` : caption).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    });
    void downloadVideo();
  };

  const needsRender = !video;
  const publishLabel =
    phase === "rendering" ? "Rendering…" : phase === "publishing" ? "Publishing…" : `${needsRender ? "Render & publish" : "Publish"}${targets.length ? ` to ${targets.length === 1 ? PLATFORM_INFO[targets[0]].label : `${targets.length} platforms`}` : ""}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
          onPointerDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal
            aria-labelledby="export-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0.15 }}
            className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-[#0e0e11] shadow-2xl ring-1 ring-white/10 sm:rounded-2xl"
          >
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-5">
              <h2 id="export-title" className="text-[17px] font-semibold text-white">
                Export
              </h2>
              <button onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-white">
                <X className="size-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
              {/* The file ------------------------------------------------------ */}
              <section className="flex items-center gap-4">
                <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/10">
                  {video ? (
                    <video key={video.videoUrl} src={`${video.videoUrl}#t=2.5`} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : scenes.find((s) => s.kind === "dish")?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={scenes.find((s) => s.kind === "dish")!.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover opacity-60" />
                  ) : null}
                  <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1 py-px text-[11px] font-medium text-white tabular-nums">
                    {formatTime(video?.durationSeconds ?? durationSeconds)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-zinc-100">{project.restaurant.trim() || "New Project"}</p>
                  <p className="mt-0.5 text-[13px] text-zinc-500">
                    {video ? "MP4 · up to date" : rendering ? "Rendering your latest edits…" : "Your latest edits will be rendered first"}
                  </p>
                </div>
                <button
                  onClick={downloadVideo}
                  disabled={busy}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 text-sm font-semibold text-white transition hover:bg-white/[0.06] disabled:opacity-40"
                >
                  {phase === "rendering" ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
                  Download
                </button>
              </section>

              {/* Platforms ----------------------------------------------------- */}
              <section>
                <h3 className="mb-2 text-[13px] font-medium tracking-wide text-zinc-500 uppercase">Publish to</h3>
                <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-xl bg-white/[0.02] ring-1 ring-white/[0.06]">
                  {PLATFORMS.map((p) => {
                    const c = connections?.[p];
                    const post = posts[p];
                    const canSelect = !!c?.connected && post?.state !== "working";
                    return (
                      <li key={p}>
                        <div className="flex min-h-16 items-center gap-3 px-3.5 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(p) && !!c?.connected}
                            disabled={!canSelect || busy}
                            onChange={() => toggle(p)}
                            aria-label={`Publish to ${PLATFORM_INFO[p].label}`}
                            className={cx("size-4 shrink-0 accent-brand-500", !c?.connected && "invisible", !anyConnected && "hidden")}
                          />
                          <PlatformIcon platform={p} className="size-7" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[15px] font-medium text-zinc-100">{PLATFORM_INFO[p].label}</p>
                            <PlatformLine connected={!!c?.connected} configured={!!c?.configured} account={c?.account} post={post} loading={!connections} />
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {post?.state === "working" ? (
                              <LoaderCircle aria-label="Publishing" className="accent-text size-5 animate-spin text-brand-400" />
                            ) : post?.state === "done" && post.url ? (
                              <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 text-[13px] font-medium text-emerald-300 transition hover:bg-emerald-400/20">
                                View post <ExternalLink className="size-3.5" />
                              </a>
                            ) : !connections ? null : !c?.configured ? (
                              <>
                                <SmallButton onClick={() => uploadManually(p)} disabled={busy} title={`Downloads the MP4, copies the caption and opens ${PLATFORM_INFO[p].label}`}>
                                  Upload manually
                                </SmallButton>
                                {setupInfo && (
                                  <SmallButton onClick={() => setSettingUp((s) => (s === p ? null : p))} primary={settingUp !== p}>
                                    {settingUp === p ? "Close" : "Set up"}
                                  </SmallButton>
                                )}
                              </>
                            ) : !c.connected || (post?.state === "error" && post.reconnect) ? (
                              <SmallButton onClick={() => connect(p)} primary>
                                {c.connected ? "Reconnect" : "Connect"}
                              </SmallButton>
                            ) : (
                              <SmallButton onClick={() => disconnect(p)} disabled={busy}>
                                Disconnect
                              </SmallButton>
                            )}
                          </div>
                        </div>
                        {settingUp === p && !c?.configured && setupInfo && (
                          <PlatformSetup
                            platform={p}
                            info={setupInfo}
                            onSaved={() => {
                              setSettingUp(null);
                              void loadConnections();
                            }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                {copied && <p className="mt-2 text-[13px] text-emerald-300">Caption copied. Paste it in when you upload the video.</p>}
                {connections && PLATFORMS.some((p) => !connections[p].configured) && (
                  <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">
                    Use <span className="text-zinc-400">Set up</span> to turn on one-click publishing for a platform. It takes a few minutes per platform to create the developer app.
                  </p>
                )}
              </section>

              {/* Post details -------------------------------------------------- */}
              <section className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-zinc-400">
                    Title <span className="font-normal text-zinc-600">YouTube &amp; Facebook</span>
                  </span>
                  <input
                    value={title}
                    maxLength={100}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setEdited(true);
                    }}
                    className="h-10 w-full rounded-lg bg-white/[0.04] px-3 text-[15px] text-zinc-100 ring-1 ring-white/10 outline-none focus:ring-brand-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-zinc-400">
                    Caption
                    <span className={cx("font-normal tabular-nums", caption.length > captionMax ? "text-rose-400" : "text-zinc-600")}>
                      {caption.length}/{captionMax}
                    </span>
                  </span>
                  <textarea
                    value={caption}
                    rows={6}
                    onChange={(e) => {
                      setCaption(e.target.value);
                      setEdited(true);
                    }}
                    className="w-full resize-y rounded-lg bg-white/[0.04] px-3 py-2.5 text-[14px] leading-relaxed text-zinc-100 ring-1 ring-white/10 outline-none focus:ring-brand-500"
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-[13px] font-medium text-zinc-400">Visibility</span>
                  <div role="radiogroup" className="inline-flex rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-white/10">
                    {PRIVACY.map((o) => (
                      <button
                        key={o.id}
                        role="radio"
                        aria-checked={privacy === o.id}
                        onClick={() => setPrivacy(o.id)}
                        className={cx("h-8 rounded-md px-3.5 text-[13px] font-medium transition", privacy === o.id ? "bg-white text-zinc-950" : "text-zinc-400 hover:text-white")}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[12px] text-zinc-500">{PRIVACY.find((o) => o.id === privacy)!.hint}</p>
                </div>
              </section>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3.5">
              <p className="min-w-0 text-[13px] text-rose-300">
                {error && (
                  <span className="flex items-center gap-1.5">
                    <TriangleAlert className="size-4 shrink-0" /> {error}
                  </span>
                )}
              </p>
              <button
                onClick={publish}
                disabled={!targets.length || busy || caption.length > captionMax}
                className="accent-fill relative inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-brand-700 to-brand-500 px-5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                {targets.length || busy ? publishLabel : "Select a platform"}
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlatformLine({ connected, configured, account, post, loading }: { connected: boolean; configured: boolean; account?: string; post?: PostState; loading: boolean }) {
  const base = "mt-0.5 text-[13px] leading-snug";
  if (loading) return <p className={cx(base, "text-zinc-600")}>Checking…</p>;
  if (post?.state === "working") return <p className={cx(base, "text-zinc-400")}>Uploading{account ? ` as ${account}` : ""}…</p>;
  if (post?.state === "done")
    return (
      <p className={cx(base, "text-emerald-300")}>
        <Check className="mr-1 inline size-3.5 align-[-2px]" />
        Published{account ? ` as ${account}` : ""}
        {post.note && <span className="block text-amber-300/90">{post.note}</span>}
      </p>
    );
  if (post?.state === "error") return <p className={cx(base, "text-rose-300")}>{post.message}</p>;
  if (!configured) return <p className={cx(base, "text-zinc-500")}>Not set up for one-click publishing</p>;
  if (!connected) return <p className={cx(base, "text-zinc-500")}>Not connected</p>;
  return <p className={cx(base, "truncate text-zinc-400")}>{account ?? "Connected"}</p>;
}

function SmallButton({ onClick, disabled, primary, title, children }: { onClick: () => void; disabled?: boolean; primary?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex h-8 items-center rounded-full px-3.5 text-[13px] font-semibold transition disabled:opacity-40",
        primary ? "bg-white text-zinc-950 hover:bg-zinc-200" : "text-zinc-400 ring-1 ring-white/10 hover:bg-white/[0.06] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
