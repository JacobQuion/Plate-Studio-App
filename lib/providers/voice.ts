import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { VoiceProvider } from "@/lib/types";

const execFileAsync = promisify(execFile);

/**
 * Voiceover wrappers. Priority:
 *   1. ElevenLabs (when ELEVENLABS_API_KEY is set)
 *   2. The OS's built-in TTS (`say` on macOS) so a stage demo still has a voice offline
 *   3. null -> the pipeline lays down a silent track
 */

export interface Voiceover {
  provider: Exclude<VoiceProvider, "silent">;
  path: string;
}

async function elevenLabs(script: string, outPath: string): Promise<string> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: script,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs failed (${res.status}): ${await res.text()}`);
  await writeFile(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

async function systemTts(script: string, outPath: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  await execFileAsync("say", ["-r", "190", "-o", outPath, script], { timeout: 30_000 });
  return outPath;
}

export function voiceConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/**
 * Generate the voiceover. If ElevenLabs errors (rate limit, bad key) we log and
 * fall through to system TTS. `onFallback` lets the caller surface that in the UI.
 */
export async function generateVoiceover(
  script: string,
  dir: string,
  onFallback?: (reason: string) => void,
  name = "voice",
): Promise<Voiceover | null> {
  if (voiceConfigured()) {
    try {
      return { provider: "elevenlabs", path: await elevenLabs(script, `${dir}/${name}.mp3`) };
    } catch (err) {
      console.warn("[voice] ElevenLabs failed, falling back:", err);
      onFallback?.((err as Error).message);
    }
  }
  try {
    const path = await systemTts(script, `${dir}/${name}.aiff`);
    if (path) return { provider: "system-tts", path };
  } catch (err) {
    console.warn("[voice] system TTS failed:", err);
  }
  return null;
}
