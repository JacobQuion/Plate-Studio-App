import { safeFetch } from "@/lib/safe-fetch";
import type { Dish, MenuImportResult } from "@/lib/types";
import { createHash } from "node:crypto";

/**
 * Best-effort menu import from a Google Maps or Yelp URL:
 *   1. schema.org JSON-LD (Restaurant.hasMenu / MenuItem), which many sites embed
 *   2. Yelp's server-rendered /menu/<biz> markup
 *   3. Return an empty menu with a useful message if real menu data isn't available
 *
 * Google Maps renders menus client-side, so for Maps links we usually only get
 * the restaurant name (from the URL) and fall through to step 3.
 */

/** A problem with the link itself (shown to the user as-is). */
export class MenuImportError extends Error {}

export { findMenuLink } from "@/lib/menu-link";

const MAX_DISHES = 12;

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    /(^|\.)yelp\.[a-z.]+$/.test(h) ||
    /(^|\.)google\.[a-z.]+$/.test(h) ||
    h === "goo.gl" ||
    h === "maps.app.goo.gl" ||
    h.endsWith(".googleusercontent.com")
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPrice(price: unknown, currency?: unknown): string {
  if (price == null || price === "") return "";
  const raw = String(price).trim();
  if (/^[^\d]/.test(raw)) return raw; // already has a symbol, e.g. "$12"
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return raw;
  const code = typeof currency === "string" && currency ? currency : "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function pickImage(image: unknown): string {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (Array.isArray(image)) return pickImage(image[0]);
  if (typeof image === "object" && "url" in image) return pickImage((image as { url: unknown }).url);
  return "";
}

/** Guess a restaurant name from the URL itself (works even when the page can't be fetched). */
function nameFromUrl(url: URL): string {
  const place = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
  if (place) return decodeURIComponent(place[1].replace(/\+/g, " "));
  const biz = /\/(?:biz|menu)\/([^/?#]+)/.exec(url.pathname);
  if (biz) {
    return biz[1]
      .replace(/-\d+$/, "")
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return "";
}

function nameFromHtml(html: string): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1];
  const title = og ?? /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
  if (!title) return "";
  return decodeEntities(title).split(/\s[-|–·]\s/)[0].replace(/^Menu for\s+/i, "").trim();
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Walk every JSON-LD block and collect schema.org MenuItem nodes. */
function parseJsonLd(html: string): Dish[] {
  const dishes: Dish[] = [];
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const obj = node as Record<string, unknown>;
    const type = obj["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (types.includes("MenuItem") && typeof obj.name === "string") {
      const offers = (Array.isArray(obj.offers) ? obj.offers[0] : obj.offers) as Record<string, unknown> | undefined;
      dishes.push({
        id: `ld-${dishes.length}`,
        title: decodeEntities(obj.name),
        price: formatPrice(offers?.price, offers?.priceCurrency),
        description: typeof obj.description === "string" ? decodeEntities(obj.description) : "",
        imageUrl: pickImage(obj.image),
      });
    }
    Object.values(obj).forEach(visit);
  };

  for (const [, json] of blocks) {
    try {
      visit(JSON.parse(json));
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  }
  return dishes;
}

/** Yelp's /menu/<biz> page: one `menu-item` block per dish. */
function parseYelpMenu(html: string): Dish[] {
  const dishes: Dish[] = [];
  const chunks = html.split(/class="menu-item(?:\s|")/).slice(1);
  for (const chunk of chunks) {
    const body = chunk.slice(0, 4000);
    const name = /<h4[^>]*>([\s\S]*?)<\/h4>/i.exec(body)?.[1];
    if (!name) continue;
    const price = /menu-item-price-amount[^>]*>([\s\S]*?)</i.exec(body)?.[1];
    const desc = /menu-item-details-description[^>]*>([\s\S]*?)<\/p>/i.exec(body)?.[1];
    const image = /<img[^>]+src="(https:\/\/[^"]+)"/i.exec(body)?.[1];
    dishes.push({
      id: `yelp-${dishes.length}`,
      title: decodeEntities(name),
      price: decodeEntities(price ?? ""),
      description: decodeEntities(desc ?? ""),
      // Yelp serves thumbnails (…/ms.jpg, /258s.jpg); ask for the original.
      imageUrl: image ? image.replace(/\/[a-z0-9]+s\.jpg$/i, "/o.jpg") : "",
    });
  }
  return dishes;
}

/** Menu text is enough to generate an original scene; a photo is optional. */
export function parseMenuHtml(html: string, sourceUrl: string): Dish[] {
  const seen = new Set<string>();
  return [...parseJsonLd(html), ...parseYelpMenu(html)].flatMap((dish): Dish[] => {
    const key = dish.title.toLowerCase();
    if (!key || seen.has(key)) return [];
    seen.add(key);
    let imageUrl = "";
    try {
      const url = new URL(dish.imageUrl, sourceUrl);
      if (dish.imageUrl && /^https?:$/.test(url.protocol)) imageUrl = url.toString();
    } catch {}
    return [{ ...dish, id: `menu-${createHash("sha256").update(key).digest("hex").slice(0, 16)}`, imageUrl, visualMode: "generate", sourceUrl, evidence: "menu" }];
  }).slice(0, MAX_DISHES);
}

/** Bound HTML downloads, including chunked bodies without Content-Length. */
export async function readPageHtml(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error("Menu page is too large");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importMenu(raw: string): Promise<MenuImportResult> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new MenuImportError("Please paste a valid Google Maps or Yelp link.");
  }
  if (!isAllowedHost(url.hostname)) throw new MenuImportError("Only Google Maps and Yelp links are supported.");

  let restaurant = nameFromUrl(url);
  let dishes: Dish[] = [];
  let note: string | undefined;

  try {
    const res = await safeFetch(url.toString(), { timeoutMs: 8000, allowHost: isAllowedHost });
    if (res.ok) {
      const html = await readPageHtml(res);
      restaurant = restaurant || nameFromHtml(html);
      // Maps short links redirect to a /maps/place/ URL that contains the name.
      if (!restaurant && res.url) restaurant = nameFromUrl(new URL(res.url));
      dishes = parseMenuHtml(html, res.url || url.toString());
    } else {
      note = `The page responded with ${res.status}.`;
    }
  } catch (err) {
    note = `Couldn't reach the page (${(err as Error).message}).`;
  }

  // Original footage can be generated from verified menu descriptions alone.
  const seen = new Set<string>();
  const usable = dishes.filter((d) => {
    const key = d.title.toLowerCase();
    if (!d.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const result: MenuImportResult =
    usable.length > 0
      ? { restaurant: restaurant || "Imported restaurant", source: "live", dishes: usable.slice(0, MAX_DISHES) }
      : {
          restaurant: restaurant || "Restaurant",
          source: "unavailable",
          dishes: [],
          note: "No public menu data was found. Try address search to look up the restaurant's details and food photos." + (note ? ` ${note}` : ""),
        };

  return result;
}
