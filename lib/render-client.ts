import type { AdProject, LibraryDish } from "@/lib/ad-plan";
import type { GenerateStreamEvent } from "@/lib/types";

export function renderKey(project: AdProject, library: LibraryDish[]): string {
  const used = new Set(project.scenes.map((s) => s.dishId));
  return JSON.stringify([project, library.filter((d) => used.has(d.id)).map((d) => [d.id, d.title, d.price, d.description, d.imageUrl])]);
}

/** Handle arbitrary chunk boundaries and a final event without a trailing newline. */
export async function* readRenderEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<GenerateStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) yield JSON.parse(line) as GenerateStreamEvent;
    }
    if (buffer.trim()) yield JSON.parse(buffer) as GenerateStreamEvent;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function downloadRenderedVideo(url: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(res.status === 404 ? "This video is no longer available. Click Render to create it again." : "The download failed. Please try Export again.");
  if (!res.headers.get("content-type")?.includes("video/mp4")) throw new Error("The server didn't return an MP4. Please render again.");
  const blob = await res.blob();
  if (!blob.size) throw new Error("The video file is empty. Please render again.");
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = "plate-studio-ad.mp4";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
