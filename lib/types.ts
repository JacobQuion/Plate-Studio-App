/** Shared types used by both the API routes and the client UI. */

export interface Dish {
  id: string;
  title: string;
  /** Display price, already formatted (e.g. "$14.50"). */
  price: string;
  description: string;
  imageUrl: string;
  /** Imported dishes generate original footage; their source photos are references only. */
  visualMode?: "generate";
  visualDescription?: string;
  sourceUrl?: string;
  evidence?: "menu" | "photo";
}

export interface MenuImportResult {
  restaurant: string;
  /** Only real menu data is imported; missing data never inserts sample dishes. */
  source: "live" | "unavailable";
  dishes: Dish[];
  /** Partial-source failures or food labels that need review. */
  note?: string;
  location?: import("./locations").RestaurantLocation;
  searchSuggestions?: string;
}

export type ImportStreamEvent =
  | { type: "progress"; progress: number; detail: string }
  | { type: "done"; result: MenuImportResult }
  | { type: "error"; message: string };

/** Work groups contributing to the overall render progress bar. */
export type StageId = "assets" | "motion" | "voice" | "assemble";

/** "fallback" means the stage finished using a local renderer or alternative provider. */
export type StageStatus = "active" | "done" | "fallback" | "error";

export interface ProgressEvent {
  type: "progress";
  stage: StageId;
  status: StageStatus;
  detail?: string;
  /** Completed fraction of this stage, based on completed work (0–1). */
  progress?: number;
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
