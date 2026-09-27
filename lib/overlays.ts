import sharp from "sharp";
import type { FrameField } from "@/lib/ad-plan";

/**
 * Renders the ad's text layers as full-frame transparent PNGs, laid out on a 1920x1080 canvas
 * and rasterized at the output size.
 * FFmpeg then animates each layer in and out with fades and slides.
 *
 * Rendering text through SVG + sharp instead of FFmpeg's drawtext means we don't
 * depend on the FFmpeg build having freetype/fontconfig, and we get gradients,
 * shadows and rounded pills for free.
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

const FONT = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
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
// Intro
// ---------------------------------------------------------------------------

function introSvg(restaurant: string, eyebrow: string): { svg: Buffer; boxes: FrameBoxes } {
  const name = restaurant.toUpperCase() || "NOW SERVING";
  const fontSize = name.length > 22 ? 110 : name.length > 14 ? 136 : 160;
  const lines = wrap(name, fontSize, 1500, 2, 0.68);
  const lineHeight = Math.round(fontSize * 1.02);
  const blockTop = VIDEO_HEIGHT / 2 - (lines.length * lineHeight) / 2 + 30;
  const tspans = lines.map((l, i) => `<tspan x="${VIDEO_WIDTH / 2}" y="${blockTop + (i + 1) * lineHeight - fontSize * 0.2}">${escapeXml(l)}</tspan>`).join("");
  const ruleY = blockTop + lines.length * lineHeight + 40;
  const headW = textWidth(lines, fontSize, 0.68);
  const eyeW = eyebrow.length * 36 * 0.95;
  const boxes: FrameBoxes = {
    headline: box((VIDEO_WIDTH - headW) / 2, blockTop, headW, lines.length * lineHeight),
    ...(eyebrow ? { subline: box((VIDEO_WIDTH - eyeW) / 2, blockTop - 80, eyeW, 50) } : {}),
  };
  const svg = svgDoc(
    `<text x="${VIDEO_WIDTH / 2}" y="${blockTop - 40}" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="700" letter-spacing="10" fill="${ACCENT}" filter="url(#shadow)">${escapeXml(eyebrow.toUpperCase())}</text>
     <text text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="-2" fill="#FFFFFF" filter="url(#shadow)">${tspans}</text>
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

function outroSvg(restaurant: string, cta: string, website: string): { svg: Buffer; boxes: FrameBoxes } {
  const name = restaurant.toUpperCase();
  const fontSize = name.length > 22 ? 84 : 110;
  const lines = name ? wrap(name, fontSize, 1500, 2, 0.68) : [];
  const lineHeight = Math.round(fontSize * 1.02);
  const blockHeight = lines.length * lineHeight + 60 + 110 + (website ? 90 : 0);
  let y = VIDEO_HEIGHT / 2 - blockHeight / 2;
  const headTop = y;
  const tspans = lines.map((l, i) => `<tspan x="${VIDEO_WIDTH / 2}" y="${y + (i + 1) * lineHeight - fontSize * 0.2}">${escapeXml(l)}</tspan>`).join("");
  y += lines.length * lineHeight + 60;
  const button = pill(VIDEO_WIDTH / 2, y, `${(cta || "Order now").toUpperCase().slice(0, 24)}  →`, 48, 110, "#FFFFFF", "#111111", "middle");
  y += 110 + 80;
  const headW = lines.length ? textWidth(lines, fontSize, 0.68) : 0;
  const webW = website.slice(0, 48).length * 40 * 0.58;
  const boxes: FrameBoxes = {
    ...(lines.length ? { headline: box((VIDEO_WIDTH - headW) / 2, headTop, headW, lines.length * lineHeight) } : {}),
    cta: button.box,
    ...(website ? { subline: box((VIDEO_WIDTH - webW) / 2, y - 42, webW, 56) } : {}),
  };
  const svg = svgDoc(
    `<text text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="-1" fill="#FFFFFF" filter="url(#shadow)">${tspans}</text>
     ${button.svg}
     ${website ? `<text x="${VIDEO_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="40" font-weight="600" letter-spacing="2" fill="${ACCENT}" filter="url(#shadow)">${escapeXml(website.slice(0, 48))}</text>` : ""}`,
  );
  return { svg, boxes };
}

// ---------------------------------------------------------------------------
// Writers (file names are keyed by scene id)
// ---------------------------------------------------------------------------

export async function renderIntroOverlay(dir: string, sceneId: string, headline: string, eyebrow: string): Promise<{ file: string; boxes: FrameBoxes }> {
  const file = `${dir}/overlay_${sceneId}.png`;
  const { svg, boxes } = introSvg(headline, eyebrow);
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

export async function renderOutroOverlay(dir: string, sceneId: string, headline: string, cta: string, website: string): Promise<{ file: string; boxes: FrameBoxes }> {
  const file = `${dir}/overlay_${sceneId}.png`;
  const { svg, boxes } = outroSvg(headline, cta, website);
  await sharp(svg).png().toFile(file);
  return { file, boxes };
}
