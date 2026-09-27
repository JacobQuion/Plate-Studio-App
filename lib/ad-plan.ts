import type { Dish } from "@/lib/types";

/**
 * The ad project: the single editable description of an ad, shared by the
 * assistant (which edits it through tools), the timeline editor (which edits it
 * directly) and the renderer (which turns it into an MP4).
 *
 * A project is a list of scenes: an intro, one scene per featured dish, and an
 * end card. Every on-screen and spoken field of a scene is optional; unset
 * fields are derived from the dish library and the brand settings by
 * `resolveScenes()`, so edits only store what the user actually changed.
 *
 * Pure module: imported by both client components and server code.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SceneKind = "intro" | "dish" | "outro";
export type CameraStyle = "auto" | "push" | "pan" | "detail";
export const CAMERA_STYLES: { id: CameraStyle; label: string }[] = [
  { id: "auto", label: "Mixed" },
  { id: "push", label: "Push in / pull out" },
  { id: "pan", label: "Pans & tilts" },
  { id: "detail", label: "Close-ups" },
];

export const TRANSITIONS = ["smoothleft", "fadeblack", "slideup", "circleopen", "wipeleft", "smoothup", "dissolve", "slideleft"] as const;
export type TransitionName = (typeof TRANSITIONS)[number];
export const TRANSITION_LABELS: Record<TransitionName, string> = {
  smoothleft: "Smooth slide",
  fadeblack: "Fade through black",
  slideup: "Slide up",
  circleopen: "Circle reveal",
  wipeleft: "Wipe",
  smoothup: "Smooth up",
  dissolve: "Dissolve",
  slideleft: "Push left",
};

/** Text fields a viewer can click on in the frame. */
export type FrameField = "headline" | "price" | "subline" | "cta";
/** All per-scene fields that can be overridden. */
export type SceneField = FrameField | "voice";

export interface Scene {
  id: string;
  kind: SceneKind;
  /** Dish scenes: which library dish this scene features. */
  dishId?: string;
  headline?: string;
  price?: string;
  subline?: string;
  cta?: string;
  voice?: string;
  /** Seconds; unset = fit the voiceover and share the remaining time. */
  duration?: number;
  camera?: CameraStyle;
  /** Transition out of this scene into the next one. */
  transition?: TransitionName;
}

export interface AdProject {
  restaurant: string;
  cta: string;
  website: string;
  music: boolean;
  /** AI-generated cooking and diner shots around each dish (needs a video API key). */
  lifestyle: boolean;
  /** Always [intro, ...dish scenes, outro]. */
  scenes: Scene[];
}

export type LibraryDish = Dish & { uploaded?: boolean };

export interface ResolvedScene {
  id: string;
  kind: SceneKind;
  dishId?: string;
  /** 1-based position among dish scenes (0 for intro/outro). */
  dishNumber: number;
  headline: string;
  price: string;
  subline: string;
  cta: string;
  voice: string;
  duration: number | null;
  camera: CameraStyle;
  transition: TransitionName;
  imageUrl: string;
  overridden: Partial<Record<SceneField, boolean>>;
}

// ---------------------------------------------------------------------------
// Timing constants
// ---------------------------------------------------------------------------

export const TARGET_DURATION = 15;
export const TRANSITION_SECONDS = 0.6;
export const VOICE_LEAD = 0.35;
export const MAX_AD_DISHES = 6;
const INTRO_MIN = 4.5;
const OUTRO_MIN = 6;
const DISH_MIN = 3.5;
export const DURATION_LIMITS = { min: 3, max: 30 };

// ---------------------------------------------------------------------------
// Construction + editing
// ---------------------------------------------------------------------------

let counter = 0;
export const newSceneId = (kind: SceneKind) => `${kind}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function newProject(): AdProject {
  return {
    restaurant: "",
    cta: "Order now",
    website: "",
    music: true,
    lifestyle: true,
    scenes: [
      { id: "intro", kind: "intro" },
      { id: "outro", kind: "outro" },
    ],
  };
}

export const dishScenes = (p: AdProject) => p.scenes.filter((s) => s.kind === "dish");

/** Feature exactly these dishes, in this order. Existing scenes (and their edits) are kept. */
export function setAdDishes(p: AdProject, dishIds: string[]): AdProject {
  const existing = new Map(dishScenes(p).map((s) => [s.dishId, s]));
  const unique = [...new Set(dishIds)].slice(0, MAX_AD_DISHES);
  const scenes = unique.map((dishId) => existing.get(dishId) ?? { id: newSceneId("dish"), kind: "dish" as const, dishId });
  return { ...p, scenes: [p.scenes[0], ...scenes, p.scenes[p.scenes.length - 1]] };
}

export function updateScene(p: AdProject, sceneId: string, patch: Partial<Scene>): AdProject {
  return {
    ...p,
    scenes: p.scenes.map((s) => {
      if (s.id !== sceneId) return s;
      const next: Scene = { ...s, ...patch };
      // `undefined` in a patch means "back to auto".
      for (const k of Object.keys(patch) as (keyof Scene)[]) if (patch[k] === undefined) delete next[k];
      return next;
    }),
  };
}

export function moveScene(p: AdProject, sceneId: string, delta: -1 | 1): AdProject {
  const ids = dishScenes(p).map((s) => s.dishId!);
  const i = dishScenes(p).findIndex((s) => s.id === sceneId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return p;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return setAdDishes(p, ids);
}

// ---------------------------------------------------------------------------
// Default copy
// ---------------------------------------------------------------------------

/** First sentence of a description, capped at `maxWords` without ending on a dangling connector. */
export function shortenDescription(description: string, maxWords = 18): string {
  const clean = description.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (!clean) return "";
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, "");
  const words = firstSentence.split(" ");
  if (words.length <= maxWords) return firstSentence;
  // Don't end the line on a dangling connector ("...cilantro on a").
  const kept = words.slice(0, maxWords);
  while (kept.length > 1 && /^(a|an|the|and|or|on|of|in|with|to|for|over|,)$/i.test(kept.at(-1)!)) kept.pop();
  return kept.join(" ").replace(/,$/, "");
}

const INTRO_LINES = ["Hungry? Here's what's cooking at {r}.", "Your next favorite meal is waiting at {r}.", "Let's eat. This is {r}."];
const DISH_LEADS = ["Start with the", "Then there's the", "Don't skip the", "Next up, the", "And our", "Save room for the"];

function defaultDishVoice(dish: Dish, i: number, count: number): string {
  const lead = count === 1 ? "Meet the" : i === count - 1 && i > 0 ? DISH_LEADS[5] : DISH_LEADS[i % 5];
  // A 30 second ad has ~5s per dish past three, only enough to name it; the tagline carries the rest.
  const desc = count > 3 ? "" : shortenDescription(dish.description, count > 2 ? 7 : 12);
  return `${lead} ${dish.title}. ${desc ? `${desc}.` : ""}`.trim();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Fill every scene's unset fields from the library and brand. Scenes whose dish is gone are dropped. */
export function resolveScenes(p: AdProject, library: LibraryDish[]): ResolvedScene[] {
  const byId = new Map(library.map((d) => [d.id, d]));
  const dishes = dishScenes(p).filter((s) => s.dishId && byId.has(s.dishId));
  const r = p.restaurant.trim();
  const cta = p.cta.trim() || "Order now";
  const firstImage = dishes.length ? byId.get(dishes[0].dishId!)!.imageUrl : "";
  const out: ResolvedScene[] = [];

  const push = (s: Scene, defaults: Omit<ResolvedScene, "id" | "kind" | "dishId" | "duration" | "camera" | "transition" | "overridden">) => {
    const overridden: ResolvedScene["overridden"] = {};
    const pick = (f: SceneField) => {
      if (s[f] !== undefined) overridden[f] = true;
      return s[f] ?? defaults[f];
    };
    const position = out.length;
    out.push({
      ...defaults,
      id: s.id,
      kind: s.kind,
      dishId: s.dishId,
      headline: pick("headline"),
      price: pick("price"),
      subline: pick("subline"),
      cta: pick("cta"),
      voice: pick("voice"),
      duration: s.duration ?? null,
      camera: s.camera ?? "auto",
      transition: s.transition ?? TRANSITIONS[position % TRANSITIONS.length],
      overridden,
    });
  };

  push(p.scenes[0], {
    dishNumber: 0,
    headline: r || "Now serving",
    price: "",
    subline: dishes.length > 1 ? "Now serving" : "Fresh from our kitchen",
    cta: "",
    voice: r ? INTRO_LINES[r.length % INTRO_LINES.length].replace("{r}", r) : "Hungry? Here's what's cooking today.",
    imageUrl: firstImage,
  });
  dishes.forEach((s, i) => {
    const dish = byId.get(s.dishId!)!;
    push(s, {
      dishNumber: i + 1,
      headline: dish.title,
      price: dish.price,
      subline: shortenDescription(dish.description, 16),
      cta: "",
      voice: defaultDishVoice(dish, i, dishes.length),
      imageUrl: dish.imageUrl,
    });
  });
  push(p.scenes[p.scenes.length - 1], {
    dishNumber: 0,
    headline: r,
    price: "",
    subline: p.website.trim(),
    cta,
    voice: `${cta.replace(/[.!?\s]+$/, "")}${r ? ` at ${r}` : ""}. See you soon!`,
    imageUrl: firstImage,
  });
  return out;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Rough speaking time, used before the real voiceover exists. */
export const estimateVoiceSeconds = (text: string) => (text.trim() ? text.trim().split(/\s+/).length / 2.6 + 0.3 : 0);

export interface Timeline {
  durations: number[];
  starts: number[];
  total: number;
}

/**
 * Scene lengths. Each auto-length scene is at least long enough for its
 * voiceover line to finish before the next transition starts; leftover time up
 * to TARGET_DURATION is shared between the auto-length dish scenes.
 */
export function planTimeline(scenes: ResolvedScene[], voiceSeconds: number[]): Timeline {
  const T = TRANSITION_SECONDS;
  const need = (i: number, extra: number) => (voiceSeconds[i] ? VOICE_LEAD + voiceSeconds[i] + extra + T : 0);
  const durations = scenes.map((s, i) => {
    if (s.duration != null) return s.duration;
    if (s.kind === "intro") return Math.max(INTRO_MIN, need(i, 0.3));
    if (s.kind === "outro") return Math.max(OUTRO_MIN, need(i, 1.2) - T);
    return Math.max(DISH_MIN, need(i, 0.5));
  });
  const auto = scenes.map((s, i) => (s.kind === "dish" && s.duration == null ? i : -1)).filter((i) => i >= 0);
  const spare = TARGET_DURATION + (scenes.length - 1) * T - durations.reduce((a, b) => a + b, 0);
  if (spare > 0 && auto.length) for (const i of auto) durations[i] += spare / auto.length;
  const rounded = durations.map((d) => Math.round(d * 100) / 100);
  const starts: number[] = [];
  let t = 0;
  rounded.forEach((d, i) => {
    starts.push(Math.round(t * 100) / 100);
    t += d - (i < rounded.length - 1 ? T : 0);
  });
  return { durations: rounded, starts, total: Math.round(t * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Validation (for data coming over the wire)
// ---------------------------------------------------------------------------

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

export function sanitizeProject(raw: unknown): AdProject {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawScenes = Array.isArray(o.scenes) ? (o.scenes as Record<string, unknown>[]) : [];
  const scene = (s: Record<string, unknown>, kind: SceneKind): Scene => {
    const out: Scene = { id: str(s.id, 64) || newSceneId(kind), kind };
    if (kind === "dish") out.dishId = str(s.dishId, 128);
    for (const [f, max] of [["headline", 80], ["price", 20], ["subline", 160], ["cta", 24], ["voice", 400]] as const) {
      const v = str(s[f], max);
      if (v !== undefined) out[f] = v;
    }
    if (typeof s.duration === "number" && Number.isFinite(s.duration)) out.duration = Math.min(DURATION_LIMITS.max, Math.max(DURATION_LIMITS.min, s.duration));
    if (CAMERA_STYLES.some((c) => c.id === s.camera)) out.camera = s.camera as CameraStyle;
    if ((TRANSITIONS as readonly string[]).includes(s.transition as string)) out.transition = s.transition as TransitionName;
    return out;
  };
  const intro = rawScenes.find((s) => s.kind === "intro");
  const outro = rawScenes.find((s) => s.kind === "outro");
  const dishes = rawScenes.filter((s) => s.kind === "dish" && typeof s.dishId === "string").slice(0, MAX_AD_DISHES);
  return {
    restaurant: str(o.restaurant, 60) ?? "",
    cta: str(o.cta, 24) ?? "Order now",
    website: str(o.website, 80) ?? "",
    music: o.music !== false,
    lifestyle: o.lifestyle !== false,
    scenes: [scene(intro ?? { id: "intro" }, "intro"), ...dishes.map((s) => scene(s, "dish")), scene(outro ?? { id: "outro" }, "outro")],
  };
}

export function sanitizeLibrary(raw: unknown, maxImageChars: number): LibraryDish[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).slice(0, 60).flatMap((d) => {
    const id = str(d.id, 128);
    const imageUrl = str(d.imageUrl, maxImageChars) ?? "";
    if (!id) return [];
    if (imageUrl && !/^(https?:\/\/|data:image\/[a-z+.-]+;base64,)/i.test(imageUrl)) return [];
    return [{ id, title: str(d.title, 80) ?? "", price: str(d.price, 20) ?? "", description: str(d.description, 400) ?? "", imageUrl, uploaded: d.uploaded === true }];
  });
}

/** Everything that affects the rendered video, for detecting edits a render doesn't include. */
export const editKey = (p: AdProject, lib: LibraryDish[]) => JSON.stringify([p, lib.map((d) => [d.id, d.title, d.price, d.description, d.imageUrl.length])]);

// ---------------------------------------------------------------------------
// YouTube copy
// ---------------------------------------------------------------------------

export function youtubeDetails(p: AdProject, scenes: ResolvedScene[]) {
  const r = p.restaurant.trim();
  const dishes = scenes.filter((s) => s.kind === "dish");
  const names = dishes.map((d) => d.headline);
  const title =
    dishes.length === 1
      ? `${names[0]}${r ? ` at ${r}` : ""}${dishes[0].price ? ` (${dishes[0].price})` : ""}`
      : `${r || "Our menu"}: ${names.slice(0, 3).join(", ")}${dishes.length > 3 ? " & more" : ""}`;
  const cta = p.cta.trim() || "Order now";
  const menuLines = dishes.map((d) => `• ${d.headline}${d.price ? ` (${d.price})` : ""}${d.subline ? `: ${d.subline}` : ""}`);
  const description = [
    ...(dishes.length ? [`What's cooking${r ? ` at ${r}` : ""}:`, ...menuLines, ""] : []),
    `${cta}${r ? ` at ${r}` : ""}${p.website.trim() ? `: ${p.website.trim()}` : "."}`,
    "",
    "#food #foodie #eatlocal",
  ].join("\n");
  const tags = [...names, r, "food", "restaurant", "menu"].filter(Boolean).join(", ");
  return { title, description, tags, all: `${title}\n\n${description}\n\nTags: ${tags}` };
}
