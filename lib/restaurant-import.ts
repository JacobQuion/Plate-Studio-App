import type { RestaurantLocation } from "./locations";
import type { Dish, MenuImportResult } from "./types";
import { decodeEntities, importMenu, parseMenuHtml, readPageHtml } from "./menu-import";
import { describeFoodPhotos, groundedMenu, publicUrl } from "./restaurant-research";
import { safeFetch } from "./safe-fetch";

type Report = (progress: number, detail: string) => void;
type Details = { location: RestaurantLocation; photos: string[]; menuUrl?: string };

async function fetchDetails(location: RestaurantLocation): Promise<Details> {
  if (location.source === "google" && process.env.GOOGLE_PLACES_API_KEY) {
    const id = location.id.replace(/^google-/, "");
    if (!/^[\w-]+$/.test(id)) throw new Error("Invalid Google place identifier.");
    const headers = { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": "id,displayName,formattedAddress,websiteUri,googleMapsUri,photos" };
    const res = await fetch(`https://places.googleapis.com/v1/places/${id}`, { headers, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Google Maps details unavailable (${res.status}).`);
    const place = await res.json() as { displayName?: { text: string }; formattedAddress?: string; websiteUri?: string; googleMapsUri?: string; photos?: { name: string }[] };
    // Fetch photos only for visual analysis. Keys and Google's ephemeral photo names never reach the browser.
    const images = process.env.GEMINI_API_KEY ? await Promise.allSettled((place.photos ?? []).slice(0, 6).map(async ({ name }) => {
      if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) return "";
      const photo = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&skipHttpRedirect=true`, {
        headers: { "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY! }, signal: AbortSignal.timeout(12_000),
      });
      if (!photo.ok) return "";
      return publicUrl((await photo.json()).photoUri) ?? "";
    })) : [];
    return {
      location: { ...location, name: place.displayName?.text || location.name, address: place.formattedAddress || location.address, website: publicUrl(place.websiteUri), url: publicUrl(place.googleMapsUri) || location.url },
      photos: images.flatMap((r) => r.status === "fulfilled" && r.value ? [r.value] : []),
    };
  }
  if (location.source === "yelp" && process.env.YELP_API_KEY) {
    const id = location.id.replace(/^yelp-/, "");
    if (!/^[\w-]+$/.test(id)) throw new Error("Invalid Yelp business identifier.");
    const res = await fetch(`https://api.yelp.com/v3/businesses/${id}`, { headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Yelp details unavailable (${res.status}).`);
    const business = await res.json() as { name?: string; url?: string; photos?: string[]; location?: { display_address?: string[] }; attributes?: { menu_url?: string } };
    return {
      location: { ...location, name: business.name || location.name, address: business.location?.display_address?.join(", ") || location.address, url: publicUrl(business.url) || location.url },
      photos: (business.photos ?? []).flatMap((p) => publicUrl(p) ? [p] : []).slice(0, 6),
      menuUrl: publicUrl(business.attributes?.menu_url),
    };
  }
  return { location, photos: [] };
}

/** Crawl at most three public pages on the restaurant's own menu site. */
export async function websiteMenu(url: string): Promise<Dish[]> {
  const start = new URL(url);
  const queue = [start.toString()];
  const visited = new Set<string>();
  const dishes: Dish[] = [];
  while (queue.length && visited.size < 3 && dishes.length < 12) {
    const page = queue.shift()!;
    if (visited.has(page)) continue;
    visited.add(page);
    try {
      const res = await safeFetch(page, { timeoutMs: 8000, allowHost: (host) => host.replace(/^www\./, "") === start.hostname.replace(/^www\./, "") });
      if (!res.ok || !/text\/html|application\/xhtml\+xml/.test(res.headers.get("content-type") ?? "")) continue;
      const html = await readPageHtml(res);
      const current = res.url || page;
      dishes.push(...parseMenuHtml(html, current));
      for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        if (!/menu/i.test(`${match[1]} ${decodeEntities(match[2])}`)) continue;
        const next = new URL(decodeEntities(match[1]), current);
        next.hash = "";
        if (next.origin === start.origin && !/\.(pdf|jpg|png)$/i.test(next.pathname) && !visited.has(next.toString()) && queue.length < 5) queue.push(next.toString());
      }
    } catch { /* Public menu pages are best-effort; photo analysis / grounded search follows. */ }
  }
  return dishes;
}

export async function importRestaurant(input: RestaurantLocation, report: Report = () => {}): Promise<MenuImportResult> {
  report(10, "Reading restaurant details and finding photo references…");
  let details: Details = { location: input, photos: [] };
  const notices: string[] = [];
  try { details = await fetchDetails(input); }
  catch (error) { notices.push(error instanceof Error ? error.message : "Restaurant details couldn't be loaded."); }
  const { location } = details;
  report(35, "Reading the restaurant's public menu…");
  const pages = [...new Set([location.website, details.menuUrl].filter((u): u is string => !!u))];
  const results = await Promise.allSettled([
    ...pages.map(websiteMenu),
    ...(location.source === "google" || location.source === "yelp" ? [importMenu(location.url).then((m) => m.dishes)] : []),
  ]);
  let dishes = results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
  let searchSuggestions: string | undefined;
  report(60, "Identifying food and building original scene references…");
  if (process.env.GEMINI_API_KEY) {
    if (!dishes.length) {
      try { const menu = await groundedMenu(location); dishes = menu.dishes; searchSuggestions = menu.searchSuggestions; }
      catch { notices.push("Online menu research was unavailable."); }
    }
    const photos = [...dishes.map((d) => d.imageUrl).filter(Boolean), ...details.photos];
    try {
      const visualDishes = await describeFoodPhotos(photos, location.url);
      if (!dishes.length) dishes = visualDishes;
      else dishes = dishes.map((d) => {
        // Exact labels only: never assign an unrelated listing photo to a menu item.
        const reference = visualDishes.find((v) => v.title.toLowerCase() === d.title.toLowerCase());
        return reference ? { ...d, visualDescription: reference.visualDescription } : d;
      });
    } catch { notices.push("Photo analysis was unavailable; using menu descriptions where available."); }
  }
  report(90, "Preparing your dishes and source links…");
  const seen = new Set<string>();
  dishes = dishes.filter((d) => {
    const key = d.title.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 6).map((d) => ({ ...d, imageUrl: "", visualMode: "generate" }));
  if (!dishes.length) notices.push(process.env.GEMINI_API_KEY
    ? "No reliable menu items or identifiable food photos were found for this location. Try another listing or optionally upload photos."
    : "No readable public menu was found. Add a Gemini API key to identify food from listing photos and search online menus automatically, or optionally upload photos.");
  if (dishes.some((d) => d.evidence === "photo")) notices.push("Food labels were identified from photos. Review the names before generating.");
  report(100, dishes.length ? "Restaurant ready. Your original scenes are ready to generate." : "Lookup finished; no dishes could be verified.");
  return { restaurant: location.name, location, source: dishes.length ? "live" : "unavailable", dishes, searchSuggestions, note: notices.join(" ") || undefined };
}
