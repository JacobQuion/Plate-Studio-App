import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { VoiceProvider } from "@/lib/types";

const execFileAsync = promisify(execFile);

/**
 * Voiceover wrappers. Priority:
 *   1. ElevenLabs (when ELEVENLABS_API_KEY is set)
 *   2. Gemini text-to-speech (when GEMINI_API_KEY is set): the voice on Vercel, which has no system TTS
 *   3. The OS's built-in TTS (`say` on macOS) so a stage demo still has a voice offline
 *   4. null -> the pipeline lays down a silent track
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

/** Gemini returns raw 16-bit mono PCM; wrap it in a WAV header so FFmpeg can read it. */
function pcmToWav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function geminiTts(script: string, outPath: string): Promise<string> {
  const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Read this line from a restaurant ad, warm and upbeat: ${script}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || "Charon" } } },
    },
  });
  // Per-minute limits (the free tier allows 3 lines a minute) say how long to wait: wait it out a couple of times.
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(45_000),
    });
    if (res.ok) break;
    const text = await res.text();
    const wait = Number(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(text)?.[1]);
    // A per-day limit won't clear by waiting.
    if (res.status !== 429 || /PerDay/.test(text) || !wait || wait > 45 || attempt >= 3) throw new Error(`Gemini TTS failed (${res.status}): ${text.slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
  }
  const data = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
  const audio = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!audio) throw new Error("Gemini TTS returned no audio");
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1]) || 24_000;
  await writeFile(outPath, pcmToWav(Buffer.from(audio.data, "base64"), rate));
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

/** Any cloud voice, so renders on a server without system TTS (Vercel) still get a voiceover. */
export function cloudVoiceConfigured(): boolean {
  return voiceConfigured() || Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Generate the voiceover. If ElevenLabs errors (rate limit, bad key) we log and
 * fall through to Gemini, then system TTS. `onFallback` lets the caller surface that in the UI.
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
  if (process.env.GEMINI_API_KEY) {
    try {
      return { provider: "gemini-tts", path: await geminiTts(script, `${dir}/${name}.wav`) };
    } catch (err) {
      console.warn("[voice] Gemini TTS failed, falling back:", err);
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
