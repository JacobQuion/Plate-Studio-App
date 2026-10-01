"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Check, Globe, ImagePlus, MapPin, Megaphone, Mic, MousePointerClick, Plus, Sparkles, Store, Tag, Undo2, UtensilsCrossed, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_AD_DISHES, type LibraryDish } from "@/lib/ad-plan";
import { findMenuLink } from "@/lib/menu-link";
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
    label: "Yelp or Google Maps link",
    hint: "We'll pull your menu and photos",
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

/** Placeholder suggestions the empty composer types out in turn. */
const SUGGESTIONS = ["Paste a Yelp or Google Maps link", "Upload photos of your dishes"];

/** Types each phrase out left to right, holds the whole phrase, then moves to the next. Paused while `active` is false. */
function useTypewriter(phrases: string[], active: boolean) {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setLength(phrases[index].length);
    const done = length >= phrases[index].length;
    const id = setTimeout(
      () => {
        if (!done) return setLength((l) => l + 1);
        setLength(0);
        setIndex((i) => (i + 1) % phrases.length);
      },
      done ? 2600 : 45,
    );
    return () => clearTimeout(id);
  }, [active, phrases, index, length]);

  return { key: index, text: phrases[index].slice(0, length), typing: length < phrases[index].length };
}

export function ChatPane({
  messages,
  busy,
  pending,
  linkRequest,
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
  /** Bumped by the parent to open the link box (e.g. from the Dishes tab). */
  linkRequest: number;
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState(false);
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

  useEffect(() => {
    if (linkRequest) setLinkOpen(true);
  }, [linkRequest]);

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

  const closeLink = () => {
    setLinkOpen(false);
    setLinkDraft("");
    setLinkError(false);
  };

  const importLink = () => {
    const link = findMenuLink(linkDraft);
    if (!link) return setLinkError(true);
    if (busy) return;
    const note = draft.trim();
    send(note ? `${note}\n${link}` : `Import the menu from this link: ${link}`);
    closeLink();
  };

  const pick = (item: ContextItem) => {
    setMenuOpen(false);
    if (item.id === "media") return fileInput.current?.click();
    if (item.id === "link") return setLinkOpen(true);
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

  const showSuggestion = !draft && !pending.length;
  const suggestion = useTypewriter(SUGGESTIONS, showSuggestion);

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
          {/* Chips: every known dish (tap to put it in the ad or take it out) */}
          {library.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto px-3 pt-3 [scrollbar-width:none]">
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
          )}

          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {pending.map((p) => (
                <div key={p.dishId} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt={p.name} className="size-14 rounded-lg object-cover ring-1 ring-white/10" />
                  <button
                    onClick={() => onRemovePending(p.dishId)}
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
                aria-label="Add photos, a link or details"
                title="Add photos, a link or details"
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
            {/* Textarea and suggestion share one grid cell; the composer keeps a fixed height (its top lines up with the timeline's) and long drafts scroll. */}
            <div className="grid min-w-0 flex-1" onClick={() => textarea.current?.focus()}>
              <textarea
                ref={textarea}
                value={draft}
                rows={1}
                aria-label="Message Plate Studio"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={pending.length ? "Add a note about these photos (optional)" : ""}
                className="col-start-1 row-start-1 block h-[67px] w-full resize-none bg-transparent py-2 text-[15px] text-white outline-none placeholder:text-zinc-500"
              />
              <AnimatePresence initial={false}>
                {showSuggestion && (
                  <motion.span
                    key={suggestion.key}
                    aria-hidden
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="pointer-events-none col-start-1 row-start-1 py-2 text-[15px] leading-normal text-zinc-500"
                  >
                    {suggestion.text}
                    <span className={cx("ml-px inline-block h-[1.1em] w-px translate-y-[3px] bg-zinc-500", !suggestion.typing && "animate-pulse")} />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
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

      {/* Link popup ----------------------------------------------------------- */}
      <AnimatePresence>
        {linkOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onPointerDown={(e) => e.target === e.currentTarget && closeLink()}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          >
            <motion.form
              role="dialog"
              aria-label="Add your Yelp or Google Maps page"
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.12 }}
              onSubmit={(e) => {
                e.preventDefault();
                importLink();
              }}
              className="relative w-full max-w-sm rounded-xl bg-zinc-900 p-4 shadow-2xl ring-1 ring-white/10"
            >
              <button type="button" onClick={closeLink} aria-label="Close" className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-lg text-zinc-500 hover:text-white">
                <X className="size-4" />
              </button>
              <p className="flex items-center gap-2 text-[15px] font-medium text-zinc-100">
                <MapPin className="size-4 text-zinc-400" /> Paste your Yelp or Google page
              </p>
              <p className="mt-1 text-[13px] text-zinc-400">We&apos;ll grab your menu and photos.</p>
              <input
                autoFocus
                value={linkDraft}
                onChange={(e) => {
                  setLinkDraft(e.target.value);
                  setLinkError(false);
                }}
                onKeyDown={(e) => e.key === "Escape" && closeLink()}
                placeholder="yelp.com/biz/… or maps.google.com/…"
                className={cx(
                  "mt-3 w-full rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-white ring-1 outline-none placeholder:text-zinc-500 focus:ring-white/20",
                  linkError ? "ring-rose-400/50" : "ring-white/[0.08]",
                )}
              />
              {linkError && <p className="mt-1.5 text-xs text-rose-300">That&apos;s not a Yelp or Google page.</p>}
              <button
                type="submit"
                disabled={busy || !linkDraft.trim()}
                className="mt-3 h-9 w-full rounded-lg bg-violet-600 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-30"
              >
                Import
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

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
