import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/** Absolute path to the bundled FFmpeg binary (falls back to a system `ffmpeg`). */
export const FFMPEG_BIN: string = (ffmpegPath as unknown as string | null) ?? "ffmpeg";

/** Run FFmpeg with the given args. Rejects with the tail of stderr on failure. */
export function runFfmpeg(args: string[], timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(/*turbopackIgnore: true*/ FFMPEG_BIN, ["-hide_banner", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FFmpeg timed out"));
    }, timeoutMs);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.split("\n").slice(-15).join("\n")}`));
    });
  });
}

/** Read a media file's duration in seconds (parsed from FFmpeg's input banner). */
export async function probeDuration(file: string): Promise<number | null> {
  // `-f null -` decodes nothing useful but makes FFmpeg print the input info and exit 0.
  const out = await runFfmpeg(["-i", file, "-t", "0", "-f", "null", "-"], 30_000).catch((e: Error) => e.message);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
