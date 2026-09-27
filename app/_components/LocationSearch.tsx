"use client";

import { ExternalLink, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LOCATION_SOURCE, locationSearchLinks, type LocationSearchResult, type RestaurantLocation } from "@/lib/locations";
import type { ImportStreamEvent, MenuImportResult } from "@/lib/types";
import { readRenderEvents } from "@/lib/render-client";
import { ProgressBar } from "./ProgressBar";
import { SearchSuggestions } from "./SearchSuggestions";

export function LocationSearch({ onClose, onSelect }: { onClose: () => void; onSelect: (result: MenuImportResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LocationSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<RestaurantLocation | null>(null);
  const [progress, setProgress] = useState({ value: 0, detail: "" });
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    addressInput.current?.focus();
    return () => request.current?.abort();
  }, []);

  const search = async () => {
    if (query.trim().length < 3 || importing) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(""); setResults(null);
    try {
      const res = await fetch(`/api/locations?${new URLSearchParams({ q: query.trim() })}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed. Please try again.");
      if (!controller.signal.aborted) setResults(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search failed.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };

  const select = async (location: RestaurantLocation) => {
    if (importing) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setImporting(location); setError(""); setProgress({ value: 0, detail: "Connecting to your restaurant…" });
    try {
      const res = await fetch("/api/restaurant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }), signal: controller.signal });
      if (!res.ok || !res.body) throw new Error("Restaurant lookup couldn't start. Please try again.");
      for await (const event of readRenderEvents<ImportStreamEvent>(res.body)) {
        if (controller.signal.aborted) return;
        if (event.type === "progress") setProgress({ value: event.progress, detail: event.detail });
        else if (event.type === "done") {
          if (!event.result.dishes.length) { setError(event.result.note || "No dishes were found. Try another listing."); return; }
          onSelect(event.result); return;
        } else throw new Error(event.message);
      }
      throw new Error("Restaurant lookup was interrupted. Please try again.");
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Restaurant import failed.");
    } finally { if (!controller.signal.aborted) setImporting(null); }
  };

  const links = locationSearchLinks(query.trim());
  return <dialog ref={dialog} onCancel={onClose} onClick={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/15 bg-[#141418] p-6 text-zinc-100 shadow-2xl backdrop:bg-black/75" aria-labelledby="search-title">
    <div className="mb-6 flex items-start justify-between gap-3">
      <div><span className="text-xs font-medium tracking-widest text-brand-300 uppercase">From address to ad</span><h2 id="search-title" className="mt-2 text-2xl font-semibold">Start with your restaurant.</h2><p className="mt-2 text-sm leading-relaxed text-zinc-400">We’ll find its menu and food references, then prepare original AI scenes. No photo upload required when public details are available.</p></div>
      <button onClick={onClose} aria-label="Close restaurant search" className="rounded-lg p-2 hover:bg-white/10"><X className="size-5" /></button>
    </div>
    <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="space-y-3">
      <label className="block text-sm">Restaurant address<input ref={addressInput} autoFocus required minLength={3} maxLength={240} disabled={!!importing} value={query} onChange={(e) => { request.current?.abort(); setLoading(false); setQuery(e.target.value); setResults(null); setError(""); }} placeholder="Street address + city, or restaurant name + city" className="mt-2 block w-full rounded-xl border border-white/15 bg-black/25 px-4 py-3.5 outline-none focus:border-brand-400 disabled:opacity-50" /></label>
      <button type="submit" disabled={loading || !!importing || query.trim().length < 3} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-40">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />} {loading ? "Finding your restaurant…" : "Find restaurant"}</button>
    </form>
    {query.trim().length >= 3 && <div className="mt-3 grid grid-cols-2 gap-2">
      <a href={links.google} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-white/10 p-3 text-sm text-zinc-300 hover:bg-white/5">Google Maps <ExternalLink className="size-3.5" /></a>
      <a href={links.yelp} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-white/10 p-3 text-sm text-zinc-300 hover:bg-white/5">Yelp <ExternalLink className="size-3.5" /></a>
    </div>}
    {importing && <div role="status" className="mt-5 rounded-xl border border-brand-500/25 bg-brand-900/20 p-4"><p className="mb-1 text-sm font-medium">Preparing {importing.name}</p><div className="mb-3 flex items-center justify-between gap-4 text-xs text-zinc-400"><span>{progress.detail}</span><span>{progress.value}%</span></div><ProgressBar value={progress.value} label="Restaurant import progress" /></div>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-rose-500/10 p-3 text-sm leading-relaxed text-rose-200">{error}</p>}
    {results?.notice && <p role="status" className="mt-4 text-sm leading-relaxed text-zinc-400">{results.notice}</p>}
    {!!results?.locations.length && <div className="mt-5"><p className="mb-3 text-xs text-zinc-500">Choose the matching restaurant to collect its menu and food references.</p><ul className="space-y-2">{results.locations.map((l) => <li key={l.id} className="rounded-xl border border-white/10 p-3">
      <div className="flex items-start gap-3"><MapPin className="mt-1 size-4 shrink-0 text-brand-300" /><div className="min-w-0 flex-1"><p className="font-medium">{l.name}</p><p className="mt-1 text-sm text-zinc-400">{l.address}</p><a href={l.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-300">{LOCATION_SOURCE[l.source]} <ExternalLink className="size-3" /></a></div><button disabled={!!importing} onClick={() => void select(l)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium disabled:opacity-40">Use restaurant</button></div>
      {l.source === "web" && l.sources && <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-400">{l.sources.slice(0, 4).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a>)}</div>}
    </li>)}</ul></div>}
    <SearchSuggestions html={results?.searchSuggestions} />
    <p className="mt-5 text-xs leading-relaxed text-zinc-500">Google Maps and Yelp open in a new tab. Restaurant research runs here when you choose a result.</p>
  </dialog>;
}
