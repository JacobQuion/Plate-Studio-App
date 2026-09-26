import { writeFile } from "node:fs/promises";
import { fetchBuffer } from "@/lib/safe-fetch";
import type { StockQuery } from "@/lib/shots";

/**
 * Stock footage from Pexels (free API key, free for commercial use, no attribution
 * required). Fills the cooking, plating and eating shots when there's no AI video
 * provider, or when an AI clip fails: real footage of flames and people eating,
 * found by searching for the kind of dish, keeping only clips whose title names it.
 */

export function stockConfigured(): boolean {
  return !!process.env.PEXELS_API_KEY;
}

interface PexelsFile {
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}
interface PexelsVideo {
  id: number;
  /** Page URL with a descriptive slug, e.g. /video/barista-making-latte-art-4377784/ */
  url: string;
  duration: number;
  video_files: PexelsFile[];
}

/** The 1080p-ish MP4: the widest file up to 1920, else the narrowest wider one. */
function bestFile(video: PexelsVideo): PexelsFile | null {
  const mp4s = video.video_files.filter((f) => f.file_type === "video/mp4" && f.width && f.height && f.width > f.height);
  const fits = mp4s.filter((f) => f.width! <= 1920 && f.width! >= 1280).sort((a, b) => b.width! - a.width!);
  return fits[0] ?? mp4s.sort((a, b) => a.width! - b.width!).find((f) => f.width! > 1920) ?? null;
}

/** The clip's title, from its page slug: "barista making latte art". */
const clipTitle = (video: PexelsVideo) => (video.url.match(/\/video\/([^/]+?)(?:-\d+)?\/?$/)?.[1] ?? "").replace(/-/g, " ").toLowerCase();

/**
 * Download a landscape clip for the first query that has on-topic results (title
 * matches every `match` pattern), skipping videos in `used` (so dishes don't share
 * footage) and adding the pick to it. Picks at random among the top results so re-renders vary.
 * Throws when nothing suitable is found.
 */
export async function fetchStockClip(queries: StockQuery[], outPath: string, used: Set<number>): Promise<string> {
  const key = process.env.PEXELS_API_KEY!;
  for (const { query, match } of queries) {
    const url = `https://api.pexels.com/videos/search?${new URLSearchParams({ query, orientation: "landscape", size: "medium", per_page: "30" })}`;
    const res = await fetch(url, { headers: { Authorization: key }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Pexels search failed (${res.status}): ${await res.text()}`);
    const { videos = [] } = (await res.json()) as { videos?: PexelsVideo[] };
    const candidates = videos
      .filter((v) => !used.has(v.id) && v.duration >= 4 && v.duration <= 60 && match.every((re) => re.test(clipTitle(v))))
      .map((v) => ({ id: v.id, file: bestFile(v) }))
      .filter((c): c is { id: number; file: PexelsFile } => c.file !== null)
      .slice(0, 6);
    if (!candidates.length) continue;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    used.add(pick.id);
    await writeFile(outPath, await fetchBuffer(pick.file.link, 150 * 1024 * 1024, 60_000));
    return outPath;
  }
  throw new Error(`No stock footage for "${queries[0]?.query}"`);
}
