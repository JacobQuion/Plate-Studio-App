import { configuredVideoProvider } from "@/lib/providers/video";
import { stockConfigured } from "@/lib/providers/stock";
import { voiceConfigured } from "@/lib/providers/voice";
import { assistantEngine } from "@/lib/assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/status: which integrations are live vs. running on local fallbacks. */
export function GET() {
  const video = configuredVideoProvider();
  return Response.json({
    video: video ?? (stockConfigured() ? "stock" : "local-motion"),
    assistant: assistantEngine(),
    voice: voiceConfigured() ? "elevenlabs" : process.platform === "darwin" ? "system-tts" : "silent",
  });
}
