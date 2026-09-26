import type { ResolvedScene } from "@/lib/ad-plan";
import type { ShotKind } from "@/lib/shots";

export interface Clip {
  path: string;
  duration: number;
}

export type Shot = { kind: "clip"; clip: Clip } | { kind: "still"; path: string };
export const clipKey = (sceneId: string, kind: ShotKind) => `${sceneId}:${kind}`;
export const LIFESTYLE_IMAGES = {
  serving: "/lifestyle/serving.png",
  eating: "/lifestyle/eating.png",
  socializing: "/lifestyle/socializing.png",
} as const;

/** Allocate every source once across the whole ad, including intro and end card. */
export function planShots(
  scenes: ResolvedScene[],
  durations: number[],
  stills: Map<string, string>,
  clips: Map<string, Clip>,
  lifestyle: boolean,
  fallbackStills: Partial<Record<keyof typeof LIFESTYLE_IMAGES, string>>,
): Shot[][] {
  const used = new Set<string>();
  const take = (shot: Shot | null): Shot[] => {
    if (!shot) return [];
    const source = shot.kind === "clip" ? shot.clip.path : shot.path;
    if (used.has(source)) return [];
    used.add(source);
    return [shot];
  };
  const fallback = (name: keyof typeof LIFESTYLE_IMAGES): Shot | null => {
    const file = fallbackStills[name];
    return file ? { kind: "still", path: file } : null;
  };

  return scenes.map((scene, i) => {
    const clip = (kind: ShotKind): Shot | null => {
      const value = clips.get(clipKey(scene.id, kind));
      return value ? { kind: "clip", clip: value } : null;
    };
    // No recycled dish montage: brand cards get their own people shots, or a
    // plain background when lifestyle is off. Each is a continuous appearance.
    if (scene.kind === "intro") {
      return lifestyle ? [...take(clip("serving") ?? fallback("serving")), ...take(clip("kitchen"))] : [];
    }
    if (scene.kind === "outro") {
      return lifestyle ? [...take(clip("socializing") ?? fallback("socializing")), ...take(clip("cheers"))] : [];
    }

    const still = stills.get(scene.id);
    const hero = take(clip("hero") ?? (still ? { kind: "still", path: still } : null));
    if (!hero.length) throw new Error(`Choose a unique photo for "${scene.headline}" before rendering.`);
    // Always reserve one slot for the actual dish and prioritize people over
    // preparation shots. Never split the same still into multiple camera cuts.
    let room = Math.max(1, Math.floor(durations[i] / 1.4)) - 1;
    const bite = lifestyle && room > 0 ? take(clip("bite") ?? fallback("eating")) : [];
    room -= bite.length;
    const fire = lifestyle && room > 0 ? take(clip("fire")) : [];
    room -= fire.length;
    const plating = lifestyle && room > 0 ? take(clip("plating")) : [];
    return [...fire, ...plating, ...hero, ...bite];
  });
}
