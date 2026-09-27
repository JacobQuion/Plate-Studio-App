import { cookies } from "next/headers";
import { isPlatform, PLATFORM_INFO } from "@/lib/platforms";
import { connectionCookie, cookieOptions, encodeConnection, exchangeCode, redirectUri, STATE_COOKIE } from "@/lib/publish";

export const runtime = "nodejs";

/**
 * GET /api/connect/:platform/callback?code&state
 * Where the platform sends the user back after signing in. Stores the tokens in a cookie,
 * tells the studio window and closes the popup.
 */
export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isPlatform(platform)) return new Response("Unknown platform", { status: 404 });
  const label = PLATFORM_INFO[platform].label;
  const url = new URL(req.url);
  const jar = await cookies();
  const state = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  const code = url.searchParams.get("code");
  let error: string | null = null;
  if (!code) error = url.searchParams.get("error_description") || url.searchParams.get("error_message") || `${label} sign-in was cancelled.`;
  else if (!state || url.searchParams.get("state") !== state) error = "The sign-in link expired. Please try again.";
  else {
    try {
      const connection = await exchangeCode(platform, code, redirectUri(req, platform));
      jar.set(connectionCookie(platform), encodeConnection(connection), cookieOptions(url.protocol === "https:"));
    } catch (err) {
      console.error(`[connect] ${platform} sign-in failed:`, err);
      error = (err as Error).message;
    }
  }
  return popupResult(platform, label, error);
}

function popupResult(platform: string, label: string, error: string | null) {
  const message = JSON.stringify({ type: "plate-studio:connect", platform, error });
  const text = error ? `Couldn't connect ${label}: ${error}` : `${label} is connected. You can close this window.`;
  const html = `<!doctype html><meta charset="utf-8"><title>${label}</title>
<body style="font:15px system-ui;background:#08080a;color:#e4e4e7;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center">
<p id="m"></p>
<script>
document.getElementById("m").textContent = ${JSON.stringify(text).replace(/</g, "\\u003c")};
const ok = ${!error};
if (window.opener) {
  window.opener.postMessage(${message.replace(/</g, "\\u003c")}, location.origin);
  if (ok) window.close();
} else if (ok) setTimeout(() => location.replace("/"), 1200);
</script></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
