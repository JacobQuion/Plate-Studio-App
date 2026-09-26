/** Shared types used by both the API routes and the client UI. */

export interface Dish {
  id: string;
  title: string;
  /** Display price, already formatted (e.g. "$14.50"). */
  price: string;
  description: string;
  imageUrl: string;
}

export interface MenuImportResult {
  restaurant: string;
  /** "live" = parsed from the page, "demo" = curated fallback menu. */
  source: "live" | "demo";
  dishes: Dish[];
  /** Why we fell back to the demo menu, when we did. */
  note?: string;
}

/** The four stages shown in the render progress bar. */
export type StageId = "assets" | "motion" | "voice" | "assemble";

/** "fallback" means the stage finished using a local mock instead of the external API. */
export type StageStatus = "active" | "done" | "fallback" | "error";

export interface ProgressEvent {
  type: "progress";
  stage: StageId;
  status: StageStatus;
  detail?: string;
}

export type VideoProvider = "luma" | "replicate" | "gemini" | "stock" | "local-motion";
export type VoiceProvider = "elevenlabs" | "system-tts" | "silent";

/** Where each scene sits in the rendered video. */
export interface SceneTiming {
  sceneId: string;
  start: number;
  duration: number;
}

export interface GenerateDoneEvent {
  type: "done";
  jobId: string;
  videoUrl: string;
  downloadUrl: string;
  durationSeconds: number;
  script: string;
  timeline: SceneTiming[];
  /** Clickable text regions per scene id: field -> normalized [x, y, w, h]. */
  layout: Record<string, Partial<Record<"headline" | "price" | "subline" | "cta", [number, number, number, number]>>>;
  providers: { video: VideoProvider; voice: VoiceProvider };
}

export interface GenerateErrorEvent {
  type: "error";
  message: string;
}

/** One line of the NDJSON stream returned by POST /api/generate. */
export type GenerateStreamEvent = ProgressEvent | GenerateDoneEvent | GenerateErrorEvent;
