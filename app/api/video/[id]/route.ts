import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getDownloadUrl } from "@vercel/blob";
import { videoSource } from "@/lib/projects";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/video/:id[?download=1]
 * Streams a rendered final_video.mp4 (or its saved copy once $TMPDIR is cleaned) with HTTP Range support (Safari/iOS need it to play video).
 * A copy saved in Vercel Blob is a redirect to it instead: the Blob CDN handles Range requests and big files.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404 });

  const source = await videoSource(id);
  const download = new URL(req.url).searchParams.has("download");
  if (source && "url" in source) return Response.redirect(download ? getDownloadUrl(source.url) : source.url, 302);
  const file = source?.file;
  const info = file ? await stat(file).catch(() => null) : null;
  if (!file || !info) return new Response("Not found", { status: 404 });

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="plate-studio-video-${id.slice(0, 8)}.mp4"`;

  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=-500" means the last 500 bytes.
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(info.size) } });
}
