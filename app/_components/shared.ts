import type { SceneKind } from "@/lib/ad-plan";
import type { GenerateDoneEvent, StageId, StageStatus } from "@/lib/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type StageState = { status: StageStatus | "pending"; detail?: string };
export type GenState =
  | { phase: "idle" }
  | { phase: "running"; stages: Record<StageId, StageState>; startedAt: number }
  | { phase: "done"; stages: Record<StageId, StageState>; result: GenerateDoneEvent; elapsed: number }
  | { phase: "error"; stages: Record<StageId, StageState>; message: string };

export const freshStages = (): Record<StageId, StageState> => ({
  assets: { status: "pending" },
  motion: { status: "pending" },
  voice: { status: "pending" },
  assemble: { status: "pending" },
});

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Thumbnails of photos attached to this message. */
  images?: string[];
  /** Edits the assistant made during this turn. */
  actions?: string[];
  error?: boolean;
  /** The edits from this turn can be reverted (and whether they have been). */
  undoable?: boolean;
  reverted?: boolean;
}

export const sceneLabel = (kind: SceneKind, dishNumber: number, headline: string) =>
  kind === "intro" ? "Intro" : kind === "outro" ? "End card" : `${dishNumber}. ${headline || "Untitled dish"}`;

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Read an image file, downscale it and return a JPEG data URI. */
export async function fileToDataUri(file: File, maxEdge: number, quality = 0.88): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

/** "grilled-salmon_bowl.JPG" -> "Grilled Salmon Bowl" */
export function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base || /^(img|dsc|photo|image|pxl)\s?\d/i.test(base)) return "New dish";
  return base.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);
}
