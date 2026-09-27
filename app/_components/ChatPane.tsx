"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, Globe, ImagePlus, MapPin, Megaphone, Mic, MousePointerClick, Plus, Sparkles, Store, Tag, Undo2, UtensilsCrossed, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_AD_DISHES, type LibraryDish } from "@/lib/ad-plan";
import { cx, type ChatMessage } from "./shared";

export interface PendingPhoto {
  dishId: string;
  name: string;
  /** Full-size data URI used for rendering. */
  full: string;
  /** Small data URI sent to the assistant and shown in the chat. */
  thumb: string;
}

/** Items in the composer's "+" menu. Prefill items start a message for the user to finish. */
type ContextItem = {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  prefill?: string;
};
const ADD_ITEMS: ContextItem[] = [
  {
    id: "media",
    label: "Dish photos",
    hint: "Upload pictures of your food",
    icon: ImagePlus,
  },
  {
    id: "link",
    label: "Find a restaurant",
    hint: "Start with just an address",
    icon: MapPin,
  },
];
const DETAIL_ITEMS: ContextItem[] = [
  {
    id: "name",
    label: "Restaurant name",
    hint: "Shown at the start and end",
    icon: Store,
    prefill: "Our restaurant is called ",
  },
  {
    id: "website",
    label: "Website",
    hint: "Shown on the end card",
    icon: Globe,
    prefill: "Our website is ",
  },
  {
    id: "cta",
    label: "Call to action",
    hint: "e.g. Order now, Book a table",
    icon: MousePointerClick,
    prefill: "Change the call to action to ",
  },
  {
    id: "offer",
    label: "Special offer",
    hint: "A deal or limited-time promo",
    icon: Tag,
    prefill: "Mention our special offer: ",
  },
  {
    id: "tone",
    label: "Voice & tone",
    hint: "How the narration sounds",
    icon: Mic,
    prefill: "Make the voiceover sound more ",
  },
  {
    id: "audience",
    label: "Who it's for",
    hint: "Your ideal customers",
    icon: Megaphone,
    prefill: "Our target customers are ",
  },
];
const PREFILLS = new Set(DETAIL_ITEMS.map((c) => c.prefill));

export function ChatPane({
  messages,
  busy,
  pending,
  onSearch,
  library,
  inAd,
  dishesDisabled,
  onToggleDish,
  onAddFiles,
  onRemovePending,
  onSend,
  onUndo,
}: {
  messages: ChatMessage[];
  busy: boolean;
  pending: PendingPhoto[];
  onSearch: () => void;
  library: LibraryDish[];
  /** Dish ids featured in the ad, in order. */
  inAd: string[];
  dishesDisabled: boolean;
  onToggleDish: (dishId: string) => void;
  onAddFiles: (files: File[]) => void;
  onRemovePending: (dishId: string) => void;
  onSend: (text: string) => void;
  onUndo: (messageId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, busy]);

  // Grow the composer with its content, up to ~6 lines.
  useEffect(() => {
    const t = textarea.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setMenuOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const send = (text = draft) => {
    if (busy || (!text.trim() && !pending.length)) return;
    onSend(text.trim());
    setDraft("");
  };

  const pick = (item: ContextItem) => {
    setMenuOpen(false);
    if (item.id === "media") return fileInput.current?.click();
    if (item.id === "link") return onSearch();
    if (!item.prefill) return;
    // Replace an untouched prefill from another item; otherwise start a new line after what's typed.
    const next = !draft.trim() || PREFILLS.has(draft) ? item.prefill : `${draft.trimEnd()}\n${item.prefill}`;
    setDraft(next);
    requestAnimationFrame(() => {
      const t = textarea.current;
      t?.focus();
      t?.setSelectionRange(next.length, next.length);
    });
  };

  const lastAssistant = messages.findLast((m) => m.role === "assistant")?.id;
  const full = inAd.length >= MAX_AD_DISHES;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onAddFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Messages ------------------------------------------------------------ */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 [mask-image:linear-gradient(to_bottom,transparent,black_24px)]">
        {messages.map((m) => {
          const latest = m.id === lastAssistant;
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cx("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}>
              {m.images && m.images.length > 0 && (
                <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
                  {m.images.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt="" className="size-16 rounded-lg object-cover ring-1 ring-white/10" />
                  ))}
                </div>
              )}
              {m.text &&
                (m.role === "user" ? (
                  <div className="max-w-[88%] rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2 text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-100">{m.text}</div>
                ) : (
                  <p className={cx("text-[15px] leading-relaxed whitespace-pre-wrap", m.error ? "text-rose-300" : latest ? "text-zinc-100" : "text-zinc-400")}>{m.text}</p>
                ))}
              {m.actions?.map((a, i) => (
                <p key={i} className={cx("text-[15px] leading-relaxed", latest ? "text-zinc-300" : "text-zinc-500")}>
                  {a}
                </p>
              ))}
              {m.undoable && (
                <button
                  onClick={() => onUndo(m.id)}
                  disabled={busy || m.reverted}
                  className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-white disabled:hover:text-zinc-500"
                >
                  <Undo2 className="size-3.5" /> {m.reverted ? "Reverted" : "Revert"}
                </button>
              )}
            </motion.div>
          );
        })}
        {busy && (
          <p className="text-[15px] text-zinc-400">
            <Sparkles className="accent-text mr-1.5 inline size-3.5 text-brand-500" />
            <span className="accent-text">Working on it…</span>
          </p>
        )}
      </div>

      {/* Composer ------------------------------------------------------------ */}
      <div className="shrink-0 px-4 pt-2 pb-4">
        <div className="accent-ring relative rounded-2xl border border-white/10 bg-white/[0.03] transition focus-within:border-white/20">
          {/* Chips: add sources, then every known dish (tap to put it in the ad or take it out) */}
          <div className="flex gap-1.5 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
            <Chip onClick={onSearch} disabled={busy}>
              <MapPin className="size-3.5" /> Search address
            </Chip>
            <Chip onClick={() => fileInput.current?.click()} disabled={busy}>
              <ImagePlus className="size-3.5" /> Photos
            </Chip>
            {library.length > 0 && <span className="mx-0.5 w-px shrink-0 self-stretch bg-white/10" />}
            {library.map((d) => {
              const position = inAd.indexOf(d.id);
              const selected = position >= 0;
              return (
                <Chip
                  key={d.id}
                  onClick={() => onToggleDish(d.id)}
                  active={selected}
                  disabled={dishesDisabled || (!selected && full)}
                  title={selected ? "Remove from ad" : full ? `Your ad already has ${MAX_AD_DISHES} dishes` : "Add to ad"}
                >
                  {d.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.imageUrl} alt="" referrerPolicy="no-referrer" className="-ml-1.5 size-5 rounded-full object-cover" />
                  ) : (
                    <UtensilsCrossed className="size-3.5 text-zinc-500" />
                  )}
                  <span className="max-w-32 truncate">{d.title || "Untitled dish"}</span>
                  {selected ? <Check className="accent-text size-3.5 text-brand-400" /> : <Plus className="size-3.5 text-zinc-500" />}
                </Chip>
              );
            })}
          </div>

          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pending.map((p) => (
                <div key={p.dishId} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt={p.name} className="size-14 rounded-lg object-cover ring-1 ring-white/10" />
                  <button
                    onClick={() => onRemovePending(p.dishId)}
                    disabled={busy}
                    aria-label={`Remove ${p.name}`}
                    className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 ring-1 ring-white/15 hover:text-white"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-end gap-1 p-2">
            <div ref={menu} className="relative">
              <button
                onClick={() => setMenuOpen((o) => !o)}
                disabled={busy}
                aria-label="Add photos, a restaurant or details"
                title="Add photos, a restaurant or details"
                className={cx("flex size-10 items-center justify-center rounded-xl transition", menuOpen ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/[0.06] hover:text-white")}
              >
                <Plus className={cx("size-5 transition", menuOpen && "rotate-45")} />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-full left-0 z-30 mb-2 w-72 origin-bottom-left rounded-xl border border-white/10 bg-[#161619] p-1.5 shadow-2xl"
                  >
                    <MenuSection title="Add to your ad" items={ADD_ITEMS} onPick={pick} />
                    <div className="my-1.5 h-px bg-white/[0.06]" />
                    <MenuSection title="Tell us about your business" items={DETAIL_ITEMS} onPick={pick} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                onAddFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <textarea
              ref={textarea}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={pending.length ? "Add a note about these photos (optional)" : "Ask anything…"}
              className="block min-w-0 flex-1 resize-none self-center bg-transparent py-2 text-[15px] text-white outline-none placeholder:text-zinc-500"
            />
            <button
              onClick={() => send()}
              disabled={busy || (!draft.trim() && !pending.length)}
              aria-label="Send"
              className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-30"
            >
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-3 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand-700/70 bg-[#0c0c0e]/90 text-sm text-brand-200"
          >
            <ImagePlus className="size-6" /> Drop dish photos
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chip({ onClick, active, disabled, title, children }: { onClick: () => void; active?: boolean; disabled?: boolean; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cx(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] whitespace-nowrap ring-1 transition disabled:cursor-not-allowed disabled:opacity-40",
        active ? "bg-brand-900/40 text-brand-100 ring-brand-700/70" : "bg-white/[0.04] text-zinc-300 ring-white/10 hover:bg-white/[0.08] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function MenuSection({ title, items, onPick }: { title: string; items: ContextItem[]; onPick: (item: ContextItem) => void }) {
  return (
    <div>
      <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-zinc-500">{title}</p>
      {items.map((item) => (
        <button key={item.id} onClick={() => onPick(item)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/[0.06]">
          <item.icon className="size-4 shrink-0 text-zinc-400" />
          <span className="min-w-0">
            <span className="block text-sm text-zinc-100">{item.label}</span>
            <span className="block truncate text-xs text-zinc-500">{item.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
