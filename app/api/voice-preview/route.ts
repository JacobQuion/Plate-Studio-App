import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFfmpeg } from "@/lib/ffmpeg";
import { generateVoiceover } from "@/lib/providers/voice";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/voice-preview  { text }
 *   -> the line spoken in the same voice the render uses (audio/mpeg or audio/mp4)
 *
 * Lets the editor play a scene's voiceover before the ad is rendered.
 * System TTS writes AIFF, which Chrome can't play, so that gets converted to AAC.
 */
export async function POST(req: Request) {
  let text: string;
  try {
    text = String(((await req.json()) as Record<string, unknown>).text ?? "").trim().slice(0, 400);
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  if (!text) return Response.json({ error: "Nothing to say" }, { status: 400 });

  const dir = await mkdtemp(path.join(os.tmpdir(), "plate-studio-voice-"));
  try {
    const voice = await generateVoiceover(text, dir, undefined, "preview");
    if (!voice) return Response.json({ error: "No voice available on this server" }, { status: 503 });

    let file = voice.path;
    let type = "audio/mpeg";
    if (!file.endsWith(".mp3")) {
      file = path.join(dir, "preview.m4a");
      await runFfmpeg(["-i", voice.path, "-c:a", "aac", "-b:a", "128k", file], 30_000);
      type = "audio/mp4";
    }
    return new Response(new Uint8Array(await readFile(file)), {
      headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Voice-Provider": voice.provider },
    });
  } catch (err) {
    console.error("[voice-preview] failed:", err);
    return Response.json({ error: "Couldn't record the voiceover" }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
