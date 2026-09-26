import Anthropic from "@anthropic-ai/sdk";
import {
  CAMERA_STYLES,
  DURATION_LIMITS,
  MAX_AD_DISHES,
  TRANSITIONS,
  dishScenes,
  estimateVoiceSeconds,
  planTimeline,
  resolveScenes,
  setAdDishes,
  updateScene,
  type AdProject,
  type LibraryDish,
  type Scene,
} from "@/lib/ad-plan";
import { MenuImportError, findMenuLink, importMenu } from "@/lib/menu-import";

/**
 * The studio's chat assistant. Claude reads the current ad project and edits it
 * through tools; the edited project is sent back to the browser, which replaces
 * its state with it. With only GEMINI_API_KEY set, Gemini runs the same tools.
 * Without either, a small rule-based assistant handles links, photos and a few
 * commands so the studio still works offline.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface Attachment {
  dishId: string;
  /** Small JPEG data URI of an uploaded photo, for Claude to look at. */
  thumb: string;
}

/** The section of the ad the user picked on the timeline. */
export interface Focus {
  start: number;
  end: number;
  sceneIds: string[];
}

export interface AssistantResult {
  reply: string;
  /** Human-readable list of edits, shown under the reply. */
  actions: string[];
  suggestions: string[];
  /** Claude asked to render the ad after this turn. */
  render: boolean;
  project: AdProject;
  library: LibraryDish[];
  engine: "claude" | "gemini" | "basic";
}

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 10;
const DEFAULT_SUGGESTIONS = ["Make the voiceover punchier", "Render the ad", "Change the button to Book a table"];

export const assistantConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
export const geminiAssistantConfigured = () => Boolean(process.env.GEMINI_API_KEY);

/** Which model runs the chat: Claude if configured, then Gemini, then the rule-based fallback. */
export function assistantEngine(): AssistantResult["engine"] {
  if (assistantConfigured()) return "claude";
  if (geminiAssistantConfigured()) return "gemini";
  return "basic";
}

// ---------------------------------------------------------------------------
// Working state + tools
// ---------------------------------------------------------------------------

export class Workspace {
  actions: string[] = [];
  suggestions: string[] = [];
  render = false;
  constructor(
    public project: AdProject,
    public library: LibraryDish[],
  ) {}

  /** Compact JSON view of the project for the model. */
  describe(): string {
    const scenes = resolveScenes(this.project, this.library);
    const timeline = planTimeline(
      scenes,
      scenes.map((s) => estimateVoiceSeconds(s.voice)),
    );
    const inAd = new Set(dishScenes(this.project).map((s) => s.dishId));
    return JSON.stringify({
      brand: { restaurant: this.project.restaurant, cta: this.project.cta, website: this.project.website, music: this.project.music, lifestyle_shots: this.project.lifestyle },
      estimated_total_seconds: timeline.total,
      scenes: scenes.map((s, i) => ({
        scene_id: s.id,
        kind: s.kind,
        ...(s.dishId ? { dish_id: s.dishId } : {}),
        headline: s.headline,
        subline: s.subline,
        ...(s.kind === "outro" ? { cta: s.cta } : {}),
        voice: s.voice,
        duration: s.duration ?? "auto",
        estimated_seconds: timeline.durations[i],
        ...(s.kind === "dish" ? { camera: s.camera } : {}),
        transition_out: i < scenes.length - 1 ? s.transition : null,
        edited_fields: Object.keys(s.overridden),
      })),
      library: this.library.map((d) => ({
        dish_id: d.id,
        title: d.title,
        price: d.price,
        description: d.description,
        in_ad: inAd.has(d.id),
        source: d.uploaded ? "uploaded photo" : "imported menu",
      })),
    });
  }

  async importMenu(url: string) {
    const menu = await importMenu(url);
    const known = new Map(this.library.map((d) => [d.id, d]));
    const added: LibraryDish[] = [];
    for (const d of menu.dishes) {
      const clash = known.get(d.id);
      if (clash && clash.title === d.title) continue; // already imported
      added.push(clash ? { ...d, id: `${d.id}-${Math.random().toString(36).slice(2, 6)}` } : d);
    }
    this.library = [...this.library, ...added];
    if (!this.project.restaurant.trim()) this.project = { ...this.project, restaurant: menu.restaurant };
    if (!dishScenes(this.project).length && added.length) {
      this.project = setAdDishes(this.project, added.slice(0, 3).map((d) => d.id));
    }
    this.actions.push(added.length ? `Imported ${added.length} dish${added.length === 1 ? "" : "es"} from ${menu.restaurant}` : menu.note ?? "No dish photos were found. Upload your own photos.");
    return { restaurant: menu.restaurant, source: menu.source, note: menu.note, added: added.map((d) => ({ dish_id: d.id, title: d.title, price: d.price })) };
  }

  setBrand(input: { restaurant?: string; cta?: string; website?: string; music?: boolean; lifestyle_shots?: boolean }) {
    const p = { ...this.project };
    const changed: string[] = [];
    if (typeof input.restaurant === "string") (p.restaurant = input.restaurant.slice(0, 60)), changed.push("name");
    if (typeof input.cta === "string") (p.cta = input.cta.slice(0, 24)), changed.push("call to action");
    if (typeof input.website === "string") (p.website = input.website.slice(0, 80)), changed.push("website");
    if (typeof input.music === "boolean") (p.music = input.music), changed.push(input.music ? "music on" : "music off");
    if (typeof input.lifestyle_shots === "boolean") (p.lifestyle = input.lifestyle_shots), changed.push(input.lifestyle_shots ? "dining & service shots on" : "dining & service shots off");
    this.project = p;
    if (changed.length) this.actions.push(`Updated ${changed.join(", ")}`);
    return { ok: true };
  }

  setAdDishes(ids: string[]) {
    const valid = ids.filter((id) => this.library.some((d) => d.id === id));
    if (ids.length && !valid.length) throw new Error("None of those dish_ids are in the library");
    this.project = setAdDishes(this.project, valid);
    this.actions.push(`Ad now features ${valid.length} dish${valid.length === 1 ? "" : "es"}`);
    return { featured: valid.slice(0, MAX_AD_DISHES), ignored: ids.filter((id) => !valid.includes(id)) };
  }

  updateDish(input: { dish_id: string; title?: string; price?: string; description?: string }) {
    const d = this.library.find((x) => x.id === input.dish_id);
    if (!d) throw new Error(`No dish with id ${input.dish_id}`);
    const patch: Partial<LibraryDish> = {};
    if (typeof input.title === "string") patch.title = input.title.slice(0, 80);
    if (typeof input.price === "string") patch.price = input.price.slice(0, 20);
    if (typeof input.description === "string") patch.description = input.description.slice(0, 400);
    this.library = this.library.map((x) => (x.id === d.id ? { ...x, ...patch } : x));
    this.actions.push(`Updated dish “${patch.title ?? d.title}”`);
    return { ok: true };
  }

  updateScene(input: Record<string, unknown>) {
    const id = String(input.scene_id ?? "");
    const scene = this.project.scenes.find((s) => s.id === id);
    if (!scene) throw new Error(`No scene with id ${id}`);
    const patch: Partial<Scene> = {};
    const text = (k: "headline" | "price" | "subline" | "cta" | "voice", max: number) => {
      if (!(k in input)) return;
      const v = input[k];
      patch[k] = v === null ? undefined : String(v).slice(0, max);
    };
    text("headline", 80);
    text("price", 20);
    text("subline", 160);
    text("cta", 24);
    text("voice", 400);
    if ("duration" in input) {
      const d = input.duration;
      patch.duration = typeof d === "number" ? Math.min(DURATION_LIMITS.max, Math.max(DURATION_LIMITS.min, d)) : undefined;
    }
    if ("camera" in input) patch.camera = CAMERA_STYLES.some((c) => c.id === input.camera) ? (input.camera as Scene["camera"]) : undefined;
    if ("transition" in input) patch.transition = (TRANSITIONS as readonly string[]).includes(input.transition as string) ? (input.transition as Scene["transition"]) : undefined;
    this.project = updateScene(this.project, id, patch);
    const label = scene.kind === "intro" ? "intro" : scene.kind === "outro" ? "end card" : `“${this.library.find((d) => d.id === scene.dishId)?.title ?? "dish"}” scene`;
    this.actions.push(`Edited ${label}: ${Object.keys(patch).join(", ")}`);
    return { ok: true };
  }
}

const nullable = (type: string, description: string) => ({ type: [type, "null"], description });

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "import_menu",
    description:
      "Import dishes from a Yelp or Google Maps link into the library. Sets the restaurant name if it's empty, and fills an empty ad with the first dishes. Returns the dishes added.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "set_brand",
    description: "Update brand-wide settings: restaurant name, call-to-action text, website, background music, and lifestyle_shots (guests eating, a waiter serving food, friends socializing, and cooking shots; uses paid AI video when configured, Pexels footage, or distinct bundled dining images without keys).",
    input_schema: {
      type: "object",
      properties: {
        restaurant: { type: "string" },
        cta: { type: "string", description: "Max 24 characters, e.g. 'Book a table'" },
        website: { type: "string" },
        music: { type: "boolean" },
        lifestyle_shots: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "set_ad_dishes",
    description: `Choose which library dishes the ad features and in what order (1-${MAX_AD_DISHES}). Scenes for dishes kept in the ad keep their edits.`,
    input_schema: {
      type: "object",
      properties: { dish_ids: { type: "array", items: { type: "string" } } },
      required: ["dish_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "update_dish",
    description: "Edit a library dish (name, price, menu description). Use this to name uploaded photos. Scenes that haven't overridden these fields pick up the change.",
    input_schema: {
      type: "object",
      properties: { dish_id: { type: "string" }, title: { type: "string" }, price: { type: "string" }, description: { type: "string" } },
      required: ["dish_id"],
      additionalProperties: false,
    },
  },
  {
    name: "update_scene",
    description:
      "Override fields of one scene. Omit a field to leave it alone; pass null to reset it to automatic. headline = big title (intro/end card: restaurant name; dish: dish name). subline = intro eyebrow, dish tagline, or end-card website. cta = end-card button text. voice = what the narrator says during this scene. duration = seconds (null = auto). transition = transition out of this scene.",
    input_schema: {
      type: "object",
      properties: {
        scene_id: { type: "string" },
        headline: nullable("string", "On-screen title"),
        subline: nullable("string", "Secondary on-screen line"),
        cta: nullable("string", "End card only, max 24 chars"),
        voice: nullable("string", "Narration for this scene, one or two short sentences"),
        duration: nullable("number", `Seconds, ${DURATION_LIMITS.min}-${DURATION_LIMITS.max}`),
        camera: { type: ["string", "null"], enum: [...CAMERA_STYLES.map((c) => c.id), null] },
        transition: { type: ["string", "null"], enum: [...TRANSITIONS, null] },
      },
      required: ["scene_id"],
      additionalProperties: false,
    },
  },
  {
    name: "suggest_replies",
    description: "Offer 2-4 short follow-ups the user might send next, written in the user's voice (e.g. 'Make the pizza scene longer'). Call this once at the end of every turn.",
    input_schema: {
      type: "object",
      properties: { suggestions: { type: "array", items: { type: "string" } } },
      required: ["suggestions"],
      additionalProperties: false,
    },
  },
];

export async function runTool(ws: Workspace, name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "import_menu":
      return ws.importMenu(String(input.url ?? ""));
    case "set_brand":
      return ws.setBrand(input);
    case "set_ad_dishes":
      return ws.setAdDishes(Array.isArray(input.dish_ids) ? input.dish_ids.map(String) : []);
    case "update_dish":
      return ws.updateDish(input as { dish_id: string });
    case "update_scene":
      return ws.updateScene(input);
    case "suggest_replies":
      ws.suggestions = (Array.isArray(input.suggestions) ? input.suggestions : []).map(String).filter(Boolean).slice(0, 4);
      return { ok: true };
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const SYSTEM = `You are the creative director inside Plate Studio, a tool that turns restaurant dish photos into ~30 second 16:9 YouTube ads.

An ad is: an intro (restaurant name over a waiter serving guests and the kitchen), one scene per featured dish (the dish itself and someone eating, plus cooking and plating when time allows, with the dish name and tagline and one narration line), and an end card (restaurant, call-to-action button and website, over friends socializing and toasting). Each photo or clip appears once per video; no reused dish montage or looping footage. Lifestyle shots use an AI video key, Pexels stock footage, or three distinct bundled AI-generated dining images without keys. brand.lifestyle_shots turns these on or off; when off, the brand cards have plain backgrounds. Duplicate dish photos must be replaced before rendering. Scene lengths are automatic unless set, and the total aims for 30 seconds. The user sees the video, a timeline and an editor next to this chat, and can also edit anything there directly.

Each user message starts with the current project as JSON in <ad_state>. Uploaded photos arrive as images labelled with their dish_id. When the user has picked a section of the timeline, a <selection> lists the scenes in it: apply edits to those scenes only, unless the message clearly asks for something else.

How to work:
- Make changes with the tools instead of describing them. Several tool calls in one turn are fine.
- When photos are uploaded, look at each one and call update_dish with an appetizing name and a one-sentence menu description. Don't invent prices. Then make sure they're featured in the ad.
- For general feedback ("punchier", "more upscale", "shorter"), rewrite the relevant voice lines, taglines or durations to match. Keep narration natural to read aloud: short sentences, no emoji, no hashtags.
- Keep the whole ad near 30 seconds unless the user asks otherwise; check estimated_total_seconds. That leaves room for about 3 dishes with one short narration line each (under 12 words); if more dishes are featured, keep their lines even shorter.
- Rendering only starts when the user clicks Render in the UI. Never say a video is being generated or has finished. After edits or an import, tell them to click Render when ready. Export only downloads an already completed render and never starts generation.
- Reply in one to three short sentences saying what you changed or asking the one question you need answered. The edits already show in the editor, so don't list every field.
- End every turn by calling suggest_replies with specific next steps for this ad.`;

async function runClaude(ws: Workspace, history: ChatTurn[], attachments: Attachment[], focus: Focus | null): Promise<string> {
  const client = new Anthropic();
  const last = history[history.length - 1];
  const images: Anthropic.Beta.BetaContentBlockParam[] = attachments.flatMap((a) => {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(a.thumb);
    if (!m) return [];
    return [
      { type: "text", text: `Uploaded photo, dish_id=${a.dishId}:` },
      { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } },
    ];
  });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(0, -1).map((t) => ({ role: t.role, content: t.text || "(no text)" })),
    {
      role: "user",
      content: [
        { type: "text", text: `<ad_state>${ws.describe()}</ad_state>` },
        ...(focus?.sceneIds.length
          ? [{ type: "text" as const, text: `<selection>The user selected ${focus.start.toFixed(1)}s–${focus.end.toFixed(1)}s of the timeline, covering scene_ids: ${focus.sceneIds.join(", ")}</selection>` }]
          : []),
        ...images, { type: "text", text: last?.text || "(The user sent photos without a message.)" }],
    },
  ];

  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // A chat loop over small edits: medium effort keeps turns snappy.
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") return reply || "I can't help with that request, but I'm happy to keep working on the ad.";
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !toolUses.length) break;

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      try {
        const out = await runTool(ws, call.name, (call.input ?? {}) as Record<string, unknown>);
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) });
      } catch (err) {
        results.push({ type: "tool_result", tool_use_id: call.id, content: (err as Error).message, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return reply || (ws.actions.length ? "Done. Take a look at the editor below the video." : "What would you like to change?");
}

// ---------------------------------------------------------------------------
// Gemini (same tools and prompt, over the Gemini REST API)
// ---------------------------------------------------------------------------

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

class GeminiAuthError extends Error {}
/** The key works but its quota or spending cap is used up, so retrying won't help. */
class GeminiQuotaError extends Error {}

type GeminiPart = {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

const GEMINI_TOOLS = [
  { functionDeclarations: TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) },
];

async function geminiGenerate(contents: GeminiContent[]) {
  const model = process.env.GEMINI_CHAT_MODEL || "gemini-flash-latest";
  let res: Response;
  // Rate limits and "high demand" 503s are usually brief, so retry a few times.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${GEMINI_API}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools: GEMINI_TOOLS }),
      signal: AbortSignal.timeout(90_000),
    });
    if (res.ok || ![429, 500, 503].includes(res.status) || attempt >= 3) break;
    // A 429 without retry info is an exhausted quota or spending cap, not a brief rate limit.
    if (res.status === 429 && !/RetryInfo|PerMinute/.test(await res.clone().text())) break;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID/.test(text)) throw new GeminiAuthError(text);
    if (res.status === 429) throw new GeminiQuotaError(text);
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 500)}`);
  }
  return (await res.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
}

async function runGemini(ws: Workspace, history: ChatTurn[], attachments: Attachment[], focus: Focus | null): Promise<string> {
  const last = history[history.length - 1];
  const images: GeminiPart[] = attachments.flatMap((a) => {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(a.thumb);
    if (!m) return [];
    return [{ text: `Uploaded photo, dish_id=${a.dishId}:` }, { inlineData: { mimeType: m[1], data: m[2] } }];
  });
  const contents: GeminiContent[] = [
    ...history.slice(0, -1).map((t): GeminiContent => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text || "(no text)" }] })),
    {
      role: "user",
      parts: [
        { text: `<ad_state>${ws.describe()}</ad_state>` },
        ...(focus?.sceneIds.length
          ? [{ text: `<selection>The user selected ${focus.start.toFixed(1)}s–${focus.end.toFixed(1)}s of the timeline, covering scene_ids: ${focus.sceneIds.join(", ")}</selection>` }]
          : []),
        ...images,
        { text: last?.text || "(The user sent photos without a message.)" },
      ],
    },
  ];

  let reply = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await geminiGenerate(contents);
    const candidate = response.candidates?.[0];
    if (response.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
      return reply || "I can't help with that request, but I'm happy to keep working on the ad.";
    }
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) reply = text;

    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
    if (!calls.length) break;

    // Send the model's turn back unchanged: it carries thought signatures Gemini needs.
    contents.push({ role: "model", parts });
    const results: GeminiPart[] = [];
    for (const call of calls) {
      let response: Record<string, unknown>;
      try {
        response = { result: await runTool(ws, call.name, call.args ?? {}) };
      } catch (err) {
        response = { error: (err as Error).message };
      }
      results.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response } });
    }
    contents.push({ role: "user", parts: results });
  }
  return reply || (ws.actions.length ? "Done. Take a look at the editor below the video." : "What would you like to change?");
}

// ---------------------------------------------------------------------------
// Basic fallback (no API key)
// ---------------------------------------------------------------------------

async function runBasic(ws: Workspace, history: ChatTurn[], attachments: Attachment[]): Promise<string> {
  const text = history[history.length - 1]?.text ?? "";
  const notes: string[] = [];

  const link = findMenuLink(text);
  if (link) {
    try {
      const r = await ws.importMenu(link);
      notes.push(`Imported ${r.added.length} dishes from ${r.restaurant}.`);
    } catch (err) {
      notes.push(err instanceof MenuImportError ? err.message : "I couldn't import that link.");
    }
  }
  if (attachments.length) {
    const ids = [...dishScenes(ws.project).map((s) => s.dishId!), ...attachments.map((a) => a.dishId)];
    ws.setAdDishes(ids);
    notes.push(`Your ${attachments.length} photo${attachments.length > 1 ? "s are" : " is"} ready. Click Render when you're happy with the selected dishes.`);
  }
  const cta = /\b(?:button|cta|call to action)\b[^"“]*["“]([^"”]{2,24})["”]/i.exec(text)?.[1];
  if (cta) {
    ws.setBrand({ cta });
    notes.push(`The button now says “${cta}”.`);
  }
  if (/\bmusic\s+off\b|\bno music\b|\bwithout music\b/i.test(text)) ws.setBrand({ music: false }), notes.push("Music is off.");
  else if (/\bmusic\s+on\b|\badd music\b/i.test(text)) ws.setBrand({ music: true }), notes.push("Music is on.");
  if (/\b(no|without|remove|drop|turn off)\b[^.]*\b(people|diners|cooking|lifestyle|eating|socializing|waiter|server|serving)\b/i.test(text)) ws.setBrand({ lifestyle_shots: false }), notes.push("Dining, service and cooking shots are off.");
  else if (/\b(add|more|with|turn on|show)\b[^.]*\b(people|diners|cooking|lifestyle|eating|socializing|waiter|server|serving)\b/i.test(text)) ws.setBrand({ lifestyle_shots: true }), notes.push("Dining, service and cooking shots are on.");
  if (/\brender\b|\b(generate|export) (the |my )?(video|ad)\b/i.test(text)) notes.push("Click Render to generate your video. Once it's ready, Export downloads the MP4.");

  ws.suggestions = dishScenes(ws.project).length ? ["Render the ad", "Turn the music off", 'Change the button to "Book a table"'] : ["Find a restaurant", "Upload dish photos"];
  if (notes.length) return notes.join(" ");
  return "I can import Yelp or Google Maps links, add photos, change the button text and render. For free-form feedback, add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env.local. You can also edit any scene directly below the video.";
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAssistant(input: { history: ChatTurn[]; attachments: Attachment[]; project: AdProject; library: LibraryDish[]; focus?: Focus | null }): Promise<AssistantResult> {
  const ws = new Workspace(input.project, input.library);
  let engine = assistantEngine();
  let reply: string;
  if (engine === "claude") {
    try {
      reply = await runClaude(ws, input.history, input.attachments, input.focus ?? null);
    } catch (err) {
      if (!(err instanceof Anthropic.AuthenticationError)) throw err;
      console.warn("[assistant] Anthropic credentials rejected; using the basic assistant");
      engine = "basic";
      reply = await runBasic(ws, input.history, input.attachments);
    }
  } else if (engine === "gemini") {
    try {
      reply = await runGemini(ws, input.history, input.attachments, input.focus ?? null);
    } catch (err) {
      if (!(err instanceof GeminiAuthError || err instanceof GeminiQuotaError)) throw err;
      console.warn(`[assistant] Gemini ${err instanceof GeminiQuotaError ? "quota exhausted" : "API key rejected"}; using the basic assistant`);
      engine = "basic";
      reply = await runBasic(ws, input.history, input.attachments);
    }
  } else {
    reply = await runBasic(ws, input.history, input.attachments);
  }
  return {
    reply,
    actions: ws.actions,
    suggestions: ws.suggestions.length ? ws.suggestions : DEFAULT_SUGGESTIONS,
    render: ws.render,
    project: ws.project,
    library: ws.library,
    engine,
  };
}
