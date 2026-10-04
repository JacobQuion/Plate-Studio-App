import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import opentype from "opentype.js";
import { DEFAULT_FONT, googleFontsCss, isFontFamily, type BrandFontInfo } from "@/lib/fonts";
import { safeFetch } from "@/lib/safe-fetch";

/**
 * Brand fonts: the restaurant name is set in the restaurant's own typeface.
 *
 *   chosen    project.font, picked in the studio or by the assistant
 *   website   detected from the restaurant's site: Google Fonts it loads, then the font-family
 *             its headings and logo use; a non-Google font maps to the closest Google style
 *   default   Inter (bundled)
 *
 * Google fonts are downloaded as TTF once, cached under $TMPDIR, and drawn as outlines
 * (see lib/overlays.ts), so they don't need to be installed for fontconfig.
 */

export interface BrandFont extends BrandFontInfo {
  /** Parsed outlines; null means the bundled Inter, drawn as SVG text. */
  font: opentype.Font | null;
}

const CACHE_DIR = path.join(os.tmpdir(), "plate-studio", "fonts");
const MAX_CSS = 1_500_000;

// ---------------------------------------------------------------------------
// Google Fonts
// ---------------------------------------------------------------------------

const fonts = new Map<string, Promise<opentype.Font | null>>();

/** The heaviest weight Google Fonts has of `family`, or null if it isn't a Google font. */
export function loadGoogleFont(family: string): Promise<opentype.Font | null> {
  const key = family.trim().toLowerCase();
  let pending = fonts.get(key);
  if (!pending) {
    pending = downloadGoogleFont(family.trim()).catch((err) => {
      console.warn(`[font] couldn't load ${family}:`, (err as Error).message);
      fonts.delete(key); // a network hiccup shouldn't stick
      return null;
    });
    fonts.set(key, pending);
  }
  return pending;
}

async function downloadGoogleFont(family: string): Promise<opentype.Font | null> {
  const file = path.join(CACHE_DIR, `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ttf`);
  let data = await readFile(file).catch(() => null);
  if (!data) {
    // Without a browser User-Agent, Google serves plain TTFs (which opentype.js can read).
    const res = await fetch(googleFontsCss([family]), { signal: AbortSignal.timeout(8000) });
    if (res.status === 400) return null; // not a Google font
    if (!res.ok) throw new Error(`Google Fonts responded ${res.status}`);
    const faces = [...(await res.text()).matchAll(/@font-face\s*\{([^}]*)\}/g)].flatMap(([, face]) => {
      const weight = Number(/font-weight:\s*(\d+)/.exec(face)?.[1] ?? 400);
      const src = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.ttf)\)/.exec(face)?.[1];
      return src && !/font-style:\s*italic/.test(face) ? [{ weight, src }] : [];
    });
    const heaviest = faces.sort((a, b) => b.weight - a.weight)[0];
    if (!heaviest) return null;
    const ttf = await fetch(heaviest.src, { signal: AbortSignal.timeout(15_000) });
    if (!ttf.ok) throw new Error(`Font download responded ${ttf.status}`);
    data = Buffer.from(await ttf.arrayBuffer());
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, data).catch(() => {});
  }
  return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

// ---------------------------------------------------------------------------
// Website detection
// ---------------------------------------------------------------------------

/** Fallback stacks, generic names and icon fonts: never a brand. */
const IGNORE =
  /^(inherit|initial|unset|revert|sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|-apple-system|blinkmacsystemfont|segoe ui.*|helvetica( neue)?|arial|times( new roman)?|georgia|verdana|tahoma|trebuchet ms|courier( new)?|apple color emoji|noto color emoji)$|awesome|icon|glyph|slick|dashicons|eicons|swiper|revicons|fontello|material|etmodules|wpzoom/i;
/** Weight and foundry suffixes webfont services add ("Gotham Bold", "Acta Display W01 Medium"). */
const SUFFIX = /\s+(w0\d|lt|std|pro|mt|web|webfont|regular|roman|book|medium|bold|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|black|heavy|light|extra ?light|thin|italic|oblique)$/i;
const HEADING = /\b(h1|h2|h3|logo|brand|title|heading|headline|hero|display|masthead)\b/i;

/** Font families a site uses, best guess at its brand font first. */
async function websiteFonts(website: string): Promise<string[]> {
  const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  const res = await safeFetch(url.toString(), { timeoutMs: 6000 });
  if (!res.ok) return [];
  const html = (await res.text()).slice(0, 2_000_000);
  // Per family: [uses in headings and logos, uses anywhere]. Headings decide; the rest breaks ties.
  const scores = new Map<string, [number, number]>();
  const add = (raw: string, points: number, heading = false) => {
    let family = raw.trim().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
    while (SUFFIX.test(family)) family = family.replace(SUFFIX, "");
    if (!/^[a-z]/i.test(family) || IGNORE.test(family) || !isFontFamily(family)) return;
    const [h, total] = scores.get(family) ?? [0, 0];
    scores.set(family, [h + (heading ? 1 : 0), total + points]);
  };
  const addGoogleLinks = (text: string) => {
    for (const [, query] of text.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s)>]+)/g)) {
      for (const [, fam] of query.replace(/&amp;/g, "&").matchAll(/family=([^&]+)/g)) {
        decodeURIComponent(fam.replace(/\+/g, " ")).split("|").forEach((f) => add(f.split(":")[0], 10));
      }
    }
  };
  const addCss = (css: string) => {
    addGoogleLinks(css);
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const isFace = /@font-face/i.test(selector);
      for (const [, prop, value] of body.matchAll(/(font-family|--[\w-]*font[\w-]*)\s*:\s*([^;}]+)/gi)) {
        if (/var\(/.test(value)) continue;
        // A variable's name says what it's for: --font-heading, --font-display...
        const heading = HEADING.test(selector) || (prop.startsWith("--") && HEADING.test(prop.replace(/[-_]/g, " ")));
        add(value.split(",")[0], 1, heading && !isFace);
      }
    }
  };

  addGoogleLinks(html);
  for (const [, css] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) addCss(css);
  const sheets = [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => (/rel=["']?stylesheet/i.test(tag) ? /href=["']([^"']+)["']/i.exec(tag)?.[1] : undefined))
    .filter((href): href is string => !!href && !/fonts\.googleapis\.com/.test(href))
    .slice(0, 5);
  await Promise.all(
    sheets.map(async (href) => {
      try {
        const r = await safeFetch(new URL(href.replace(/&amp;/g, "&"), res.url || url).toString(), { timeoutMs: 5000 });
        if (r.ok) addCss((await r.text()).slice(0, MAX_CSS));
      } catch {}
    }),
  );
  return [...scores.entries()].sort(([, a], [, b]) => b[0] - a[0] || b[1] - a[1]).map(([f]) => f);
}

/** Closest Google font to a commercial one, by the words in its name. */
function lookalike(family: string): string | null {
  const f = family.toLowerCase();
  if (/script|hand|brush|signature|marker|cursive/.test(f)) return "Pacifico";
  if (/slab|rockwell|clarendon|archer|egyptian/.test(f)) return "Roboto Slab";
  if (/condensed|compressed|narrow|bebas|oswald|league gothic|knockout|tungsten|trade gothic/.test(f)) return "Oswald";
  if (/sans|grotesk|grotesque|futura|gotham|proxima|avenir|circular|graphik|brandon|gilroy|poppins|geometric/.test(f)) return "Montserrat";
  if (/serif|garamond|didot|bodoni|caslon|baskerville|tiempos|canela|freight|chronicle|mercury|minion|playfair|lora|acta|domaine|sectra|recoleta|cooper|sentinel|kepler|eaves|bembo|perpetua|times/.test(f)) return "Playfair Display";
  return null;
}

const detected = new Map<string, Promise<string | null>>();

/** The website's brand font as a Google font family, or null. Cached per site. */
export function detectWebsiteFont(website: string): Promise<string | null> {
  const key = website.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  let pending = detected.get(key);
  if (!pending) {
    pending = (async () => {
      // Best candidate first: the Google font itself, or a lookalike of a commercial one.
      for (const family of (await websiteFonts(key)).slice(0, 4)) {
        if (await loadGoogleFont(family)) return family;
        const similar = lookalike(family);
        if (similar) return similar;
      }
      return null;
    })().catch((err) => {
      console.warn(`[font] couldn't read ${website}:`, (err as Error).message);
      detected.delete(key);
      return null;
    });
    detected.set(key, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const DETECT_TIMEOUT = 15_000;

/** Which font the ad's name is set in. Never throws; falls back to Inter. */
export async function resolveBrandFont(project: { font?: string; website: string }): Promise<BrandFontInfo> {
  // A chosen name that isn't a Google font renders in Inter, so say so.
  if (project.font) return project.font.toLowerCase() === DEFAULT_FONT.toLowerCase() || (await loadGoogleFont(project.font)) ? { family: project.font, source: "chosen" } : { family: DEFAULT_FONT, source: "default" };
  if (project.website.trim()) {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), DETECT_TIMEOUT));
    const family = await Promise.race([detectWebsiteFont(project.website), timeout]);
    if (family) return { family, source: "website" };
  }
  return { family: DEFAULT_FONT, source: "default" };
}

/** resolveBrandFont plus the font itself, ready to draw. */
export async function loadBrandFont(project: { font?: string; website: string }): Promise<BrandFont> {
  const info = await resolveBrandFont(project);
  if (info.family.toLowerCase() === DEFAULT_FONT.toLowerCase()) return { ...info, font: null };
  const font = await loadGoogleFont(info.family);
  return font ? { ...info, font } : { family: DEFAULT_FONT, source: "default", font: null };
}
