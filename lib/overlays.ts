import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { FrameField } from "@/lib/ad-plan";
import type { BrandFont } from "@/lib/brand-font";

/**
 * sharp draws SVG text with whatever fonts fontconfig can find. Vercel's functions ship
 * no system fonts (and no fontconfig config), so text came out blank there. Point
 * fontconfig at the fonts bundled in assets/fonts so every environment renders the same.
 * This has to run before sharp renders its first text layer.
 */
function useBundledFonts() {
  if (process.env.FONTCONFIG_FILE) return;
  const fontDir = path.join(process.cwd(), "assets", "fonts");
  if (!fs.existsSync(fontDir)) return;
  const conf = path.join(os.tmpdir(), "platestudio-fonts.conf");
  fs.writeFileSync(
    conf,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${fontDir}</dir><cachedir>${path.join(os.tmpdir(), "fontconfig-cache")}</cachedir></fontconfig>`,
  );
  process.env.FONTCONFIG_FILE = conf;
}
useBundledFonts();

/**
 * Renders the ad's text layers as full-frame transparent PNGs, laid out on a 1920x1080 canvas
 * and rasterized at the output size.
 * FFmpeg then animates each layer in and out with fades and slides.
 *
 * Rendering text through SVG + sharp instead of FFmpeg's drawtext means we don't
 * depend on the FFmpeg build having freetype/fontconfig, and we get gradients,
 * shadows and rounded pills for free.
 *
 * The restaurant name is set in the brand font (lib/brand-font.ts): Google fonts are drawn
 * as outlines with real glyph widths; the bundled Inter stays SVG text in all caps.
 *
 *   intro  : eyebrow + restaurant name, centered
 *   dish   : lower third (name) + tagline line
 *   outro  : end card (restaurant, CTA button, website)
 *
 * Each writer also returns where its text landed (normalized [x, y, w, h]) so the
 * editor can make those regions of the video clickable.
 */

export type Box = [x: number, y: number, w: number, h: number];
export type FrameBoxes = Partial<Record<FrameField, Box>>;

const box = (x: number, y: number, w: number, h: number): Box =>
  [x / VIDEO_WIDTH, y / VIDEO_HEIGHT, w / VIDEO_WIDTH, h / VIDEO_HEIGHT].map((v) => Math.round(v * 1000) / 1000) as Box;
const textWidth = (lines: string[], fontSize: number, em: number) => Math.max(...lines.map((l) => l.length)) * fontSize * em;

/** The canvas every layer is designed on. The output can be smaller (see OUTPUT_WIDTH). */
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

/**
 * "light" renders 720p at 24 fps with faster encoder settings. Vercel's functions get about
 * one CPU and 5 minutes, which isn't enough for 1080p; RENDER_QUALITY=full|light overrides.
 */
export const RENDER_QUALITY: "full" | "light" =
  process.env.RENDER_QUALITY === "full" || process.env.RENDER_QUALITY === "light" ? process.env.RENDER_QUALITY : process.env.VERCEL ? "light" : "full";
export const OUTPUT_WIDTH = RENDER_QUALITY === "light" ? 1280 : VIDEO_WIDTH;
export const OUTPUT_HEIGHT = RENDER_QUALITY === "light" ? 720 : VIDEO_HEIGHT;

/** Bundled in assets/fonts (see useBundledFonts). */
const FONT = `Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const SIDE_PADDING = 110;
/** Title occupies the left ~60% so the dish stays visible on the right. */
const MAX_TEXT_WIDTH = 1150;
/** Bottom of the lower third; leaves room for YouTube's progress bar and controls. */
const TEXT_BOTTOM = 900;
const ACCENT = "#FDBA74";

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** Greedy word wrap using an average-glyph-width estimate (`em` = width factor per char). */
function wrap(text: string, fontSize: number, maxWidth: number, maxLines: number, em = 0.7): string[] {
  const maxChars = Math.max(6, Math.floor(maxWidth / (fontSize * em)));
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

function svgDoc(body: string, defs = ""): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" viewBox="0 0 ${VIDEO_WIDTH} ${VIDEO_HEIGHT}">
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.55"/>
        </filter>
        <linearGradient id="pricefill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FB923C"/>
          <stop offset="1" stop-color="#E11D48"/>
        </linearGradient>
        ${defs}
      </defs>
      ${body}
    </svg>`,
  );
}

function pill(x: number, y: number, label: string, fontSize: number, height: number, fill: string, color: string, anchor: "start" | "middle" = "start") {
  const width = Math.round(label.length * fontSize * 0.64 + height);
  const left = anchor === "middle" ? x - width / 2 : x;
  return {
    width,
    box: box(left, y, width, height),
    svg: `<g filter="url(#shadow)">
       <rect x="${left}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"/>
       <text x="${left + width / 2}" y="${y + height / 2 + fontSize * 0.36}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="2" fill="${color}">${escapeXml(label)}</text>
     </g>`,
  };
}

// ---------------------------------------------------------------------------
// Headline (the restaurant name)
// ---------------------------------------------------------------------------

interface Headline {
  lines: string[];
  lineHeight: number;
  width: number;
  /** SVG for the block centered on `x`, its top at `top`. */
  svg: (x: number, top: number) => string;
}

/** Wrap by measured width; the last kept line gets an ellipsis when text is left over. */
function wrapMeasured(text: string, measure: (s: string) => number, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  return kept;
}

function headline(text: string, brand: BrandFont | undefined, fontSize: number, maxWidth: number, maxLines: number, tracking: number): Headline {
  const font = brand?.font;
  if (!font) {
    const lines = wrap(text.toUpperCase(), fontSize, maxWidth, maxLines, 0.68);
    const lineHeight = Math.round(fontSize * 1.02);
    return {
      lines,
      lineHeight,
      width: textWidth(lines, fontSize, 0.68),
      svg: (x, top) => {
        const tspans = lines.map((l, i) => `<tspan x="${x}" y="${top + (i + 1) * lineHeight - fontSize * 0.2}">${escapeXml(l)}</tspan>`).join("");
        return `<text text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="${tracking}" fill="#FFFFFF" filter="url(#shadow)">${tspans}</text>`;
      },
    };
  }
  // Brand fonts keep the name's own capitalization, like a logo, and shrink until it fits.
  let size = fontSize;
  let lines: string[];
  let measure: (s: string) => number;
  for (;;) {
    const sz = size;
    measure = (s) => font.getAdvanceWidth(s, sz, { kerning: true });
    lines = wrapMeasured(text, measure, maxWidth, maxLines);
    if (lines.every((l) => measure(l) <= maxWidth) || size <= fontSize * 0.5) break;
    size = Math.round(size * 0.92);
  }
  // Tall script and display fonts need more room between lines than Inter.
  const lineHeight = Math.round(size * Math.min(1.35, Math.max(1.02, ((font.ascender - font.descender) / font.unitsPerEm) * 0.85)));
  const widths = lines.map(measure);
  return {
    lines,
    lineHeight,
    width: Math.max(...widths),
    svg: (x, top) =>
      `<g filter="url(#shadow)" fill="#FFFFFF">${lines
        .map((l, i) => `<path d="${font.getPath(l, x - widths[i] / 2, top + (i + 1) * lineHeight - size * 0.2, size, { kerning: true }).toPathData(1)}"/>`)
        .join("")}</g>`,
  };
}

// ---------------------------------------------------------------------------
// Intro
// ---------------------------------------------------------------------------

function introSvg(restaurant: string, eyebrow: string, brand?: BrandFont): { svg: Buffer; boxes: FrameBoxes } {
  const name = restaurant.trim() || "Now serving";
  const fontSize = name.length > 22 ? 110 : name.length > 14 ? 136 : 160;
  const head = headline(name, brand, fontSize, 1500, 2, -2);
  const { lines, lineHeight } = head;
  const blockTop = VIDEO_HEIGHT / 2 - (lines.length * lineHeight) / 2 + 30;
  const ruleY = blockTop + lines.length * lineHeight + 40;
  const headW = head.width;
  const eyeW = eyebrow.length * 36 * 0.95;
  const boxes: FrameBoxes = {
    headline: box((VIDEO_WIDTH - headW) / 2, blockTop, headW, lines.length * lineHeight),
    ...(eyebrow ? { subline: box((VIDEO_WIDTH - eyeW) / 2, blockTop - 80, eyeW, 50) } : {}),
  };
  const svg = svgDoc(
    `<text x="${VIDEO_WIDTH / 2}" y="${blockTop - 40}" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="700" letter-spacing="10" fill="${ACCENT}" filter="url(#shadow)">${escapeXml(eyebrow.toUpperCase())}</text>
     ${head.svg(VIDEO_WIDTH / 2, blockTop)}
     <rect x="${VIDEO_WIDTH / 2 - 60}" y="${ruleY}" width="120" height="8" rx="4" fill="url(#pricefill)"/>`,
  );
  return { svg, boxes };
}

// ---------------------------------------------------------------------------
// Dish scene
// ---------------------------------------------------------------------------

export interface DishOverlayText {
  title: string;
  tagline: string;
}

function dishTitleSvg({ title }: DishOverlayText): { svg: Buffer; boxes: FrameBoxes } {
  const fontSize = title.length > 34 ? 84 : title.length > 20 ? 100 : 118;
  const lineHeight = Math.round(fontSize * 1.02);
  const lines = wrap(title.toUpperCase(), fontSize, MAX_TEXT_WIDTH, 2);
  const titleTop = TEXT_BOTTOM - lines.length * lineHeight;
  const tspans = lines.map((l, i) => `<tspan x="${SIDE_PADDING}" y="${titleTop + (i + 1) * lineHeight - fontSize * 0.2}">${escapeXml(l)}</tspan>`).join("");
  const boxes: FrameBoxes = { headline: box(SIDE_PADDING, titleTop, textWidth(lines, fontSize, 0.7), lines.length * lineHeight) };
  const svg = svgDoc(
    `<rect x="0" y="0" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT}" fill="url(#sidefade)"/>
     <rect x="0" y="${VIDEO_HEIGHT * 0.4}" width="${VIDEO_WIDTH}" height="${VIDEO_HEIGHT * 0.6}" fill="url(#fade)"/>
     <text font-family="${FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="-1" fill="#FFFFFF" filter="url(#shadow)">${tspans}</text>`,
    `<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
       <stop offset="0" stop-color="#000" stop-opacity="0"/>
       <stop offset="0.6" stop-color="#000" stop-opacity="0.45"/>
       <stop offset="1" stop-color="#000" stop-opacity="0.85"/>
     </linearGradient>
     <linearGradient id="sidefade" x1="0" y1="0" x2="1" y2="0">
       <stop offset="0" stop-color="#000" stop-opacity="0.5"/>
       <stop offset="0.6" stop-color="#000" stop-opacity="0"/>
     </linearGradient>`,
  );
  return { svg, boxes };
}

function dishTaglineSvg({ tagline }: DishOverlayText): { svg: Buffer; boxes: FrameBoxes } {
  if (!tagline) return { svg: svgDoc(""), boxes: {} };
  const fontSize = 40;
  const lines = wrap(tagline, fontSize, 1000, 2, 0.5);
  const top = TEXT_BOTTOM + 30;
  const tspans = lines.map((l, i) => `<tspan x="${SIDE_PADDING + 28}" y="${top + (i + 1) * 50 - 10}">${escapeXml(l)}</tspan>`).join("");
  const boxes: FrameBoxes = { subline: box(SIDE_PADDING, top + 6, textWidth(lines, fontSize, 0.5) + 28, lines.length * 50) };
  const svg = svgDoc(
    `<rect x="${SIDE_PADDING}" y="${top + 6}" width="6" height="${lines.length * 50 - 4}" rx="3" fill="url(#pricefill)"/>
     <text font-family="${FONT}" font-size="${fontSize}" font-weight="500" fill="#F4F4F5" filter="url(#shadow)">${tspans}</text>`,
  );
  return { svg, boxes };
}

// ---------------------------------------------------------------------------
// Outro / end card
// ---------------------------------------------------------------------------

function outroSvg(restaurant: string, cta: string, website: string, brand?: BrandFont): { svg: Buffer; boxes: FrameBoxes } {
  const name = restaurant.trim();
  const fontSize = name.length > 22 ? 84 : 110;
  const head = name ? headline(name, brand, fontSize, 1500, 2, -1) : null;
  const lines = head?.lines ?? [];
  const lineHeight = head?.lineHeight ?? 0;
  const blockHeight = lines.length * lineHeight + 60 + 110 + (website ? 90 : 0);
  let y = VIDEO_HEIGHT / 2 - blockHeight / 2;
  const headTop = y;
  y += lines.length * lineHeight + 60;
  const button = pill(VIDEO_WIDTH / 2, y, `${(cta || "Order now").toUpperCase().slice(0, 24)}  →`, 48, 110, "#FFFFFF", "#111111", "middle");
  y += 110 + 80;
  const headW = head?.width ?? 0;
  const webW = website.slice(0, 48).length * 40 * 0.58;
  const boxes: FrameBoxes = {
    ...(lines.length ? { headline: box((VIDEO_WIDTH - headW) / 2, headTop, headW, lines.length * lineHeight) } : {}),
    cta: button.box,
    ...(website ? { subline: box((VIDEO_WIDTH - webW) / 2, y - 42, webW, 56) } : {}),
  };
  const svg = svgDoc(
    `${head?.svg(VIDEO_WIDTH / 2, headTop) ?? ""}
     ${button.svg}
     ${website ? `<text x="${VIDEO_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="600" letter-spacing="2" fill="${ACCENT}" filter="url(#shadow)">${escapeXml(website.slice(0, 48))}</text>` : ""}`,
  );
  return { svg, boxes };
}

// ---------------------------------------------------------------------------
// Writers (file names are keyed by scene id)
// ---------------------------------------------------------------------------

export async function renderIntroOverlay(dir: string, sceneId: string, headline: string, eyebrow: string, brand?: BrandFont): Promise<{ file: string; boxes: FrameBoxes }> {
  const file = `${dir}/overlay_${sceneId}.png`;
  const { svg, boxes } = introSvg(headline, eyebrow, brand);
  await sharp(svg).png().toFile(file);
  return { file, boxes };
}

export async function renderDishOverlays(dir: string, sceneId: string, text: DishOverlayText): Promise<{ title: string; tagline: string; boxes: FrameBoxes }> {
  const title = dishTitleSvg(text);
  const tagline = dishTaglineSvg(text);
  const files = { title: `${dir}/overlay_${sceneId}_title.png`, tagline: `${dir}/overlay_${sceneId}_tagline.png` };
  await Promise.all([sharp(title.svg).png().toFile(files.title), sharp(tagline.svg).png().toFile(files.tagline)]);
  return { ...files, boxes: { ...title.boxes, ...tagline.boxes } };
}

export async function renderOutroOverlay(dir: string, sceneId: string, headline: string, cta: string, website: string, brand?: BrandFont): Promise<{ file: string; boxes: FrameBoxes }> {
  const file = `${dir}/overlay_${sceneId}.png`;
  const { svg, boxes } = outroSvg(headline, cta, website, brand);
  await sharp(svg).png().toFile(file);
  return { file, boxes };
}
