"use client";

import { ExternalLink, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LOCATION_SOURCE, locationSearchLinks, type LocationSearchResult, type RestaurantLocation } from "@/lib/locations";

export function LocationSearch({ onClose, onSelect }: { onClose: () => void; onSelect: (location: RestaurantLocation) => void }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [results, setResults] = useState<LocationSearchResult | null>(null);
  const [searched, setSearched] = useState({ query: "", city: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);

  const search = async () => {
    if (query.trim().length < 2 || city.trim().length < 2) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(""); setResults(null);
    const terms = { query: query.trim(), city: city.trim() };
    setSearched(terms);
    try {
      const res = await fetch(`/api/locations?${new URLSearchParams({ q: terms.query, city: terms.city })}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed. Please try again.");
      setResults(data);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search failed.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };
  const links = locationSearchLinks(searched.query, searched.city);
  return (
    <dialog ref={dialog} onCancel={onClose} onClick={(e) => e.target === e.currentTarget && onClose()} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-white/15 bg-[#141418] p-6 text-zinc-100 shadow-2xl backdrop:bg-black/75" aria-labelledby="search-title">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><h2 id="search-title" className="text-xl font-semibold">Find your restaurant</h2><p className="mt-1 text-sm text-zinc-400">Search by name or cuisine and city.</p></div>
        <button onClick={onClose} aria-label="Close restaurant search" className="rounded-lg p-2 hover:bg-white/10"><X className="size-5" /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void search(); }} className="space-y-3">
        <label className="block text-sm">Restaurant or cuisine<input autoFocus required minLength={2} maxLength={120} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Caffe Strada or Italian food" className="mt-1 block w-full rounded-xl border border-white/15 bg-black/25 px-3 py-3 outline-none focus:border-brand-400" /></label>
        <label className="block text-sm">City or neighborhood<input required minLength={2} maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Berkeley, CA" className="mt-1 block w-full rounded-xl border border-white/15 bg-black/25 px-3 py-3 outline-none focus:border-brand-400" /></label>
        <button type="submit" disabled={loading || query.trim().length < 2 || city.trim().length < 2} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-40">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />} {loading ? "Searching…" : "Search"}</button>
      </form>
      {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
      {results?.notice && <p role="status" className="mt-4 text-sm text-zinc-400">{results.notice}</p>}
      {!!results?.locations.length && <ul className="mt-4 space-y-2">{results.locations.map((l) => <li key={l.id} className="rounded-xl border border-white/10 p-3">
        <div className="flex items-start gap-3"><MapPin className="mt-1 size-4 shrink-0 text-brand-300" /><div className="min-w-0 flex-1"><p className="font-medium">{l.name}</p><p className="mt-1 text-sm text-zinc-400">{l.address}</p><a href={l.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-300">{LOCATION_SOURCE[l.source]} <ExternalLink className="size-3" /></a></div><button onClick={() => onSelect(l)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium">Add</button></div>
      </li>)}</ul>}
      {searched.query && <div className="mt-5 space-y-4 border-t border-white/10 pt-4">
        <div className="grid grid-cols-2 gap-2">
          <a href={links.google} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-white/15 p-3 text-sm hover:bg-white/5">Google Maps <ExternalLink className="size-3.5" /></a>
          <a href={links.yelp} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-white/15 p-3 text-sm hover:bg-white/5">Yelp <ExternalLink className="size-3.5" /></a>
        </div>
        <details className="text-sm"><summary className="cursor-pointer font-medium">Add a location by name and address</summary>
          <p className="mt-2 text-zinc-400">Use the restaurant name above, then enter the address you found. This saves the location; add your dish photos separately.</p>
          <input aria-label="Restaurant street address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" maxLength={240} className="mt-3 w-full rounded-lg border border-white/15 bg-black/25 p-3 outline-none focus:border-brand-400" />
          <button disabled={!address.trim() || !query.trim()} onClick={() => onSelect({ id: `manual-${crypto.randomUUID()}`, name: query.trim(), address: `${address.trim()}, ${city.trim()}`, source: "manual", url: locationSearchLinks(query.trim(), `${address.trim()} ${city.trim()}`).google })} className="mt-2 w-full rounded-lg bg-white p-3 font-medium text-zinc-950 disabled:opacity-40">Add {query.trim() || "location"}</button>
        </details>
      </div>}
    </dialog>
  );
}
