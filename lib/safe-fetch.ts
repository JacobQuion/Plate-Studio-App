import { isIP } from "node:net";

/**
 * Minimal SSRF guard for server-side fetches of user-supplied URLs.
 * Blocks non-http(s) schemes, localhost, and private / link-local IP literals.
 * (Does not defend against DNS rebinding; good enough for a demo, not for prod.)
 */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Private hosts are not allowed");
  }
  if (isIP(host) && isPrivateIp(host)) {
    throw new Error("Private IP addresses are not allowed");
  }
  return url;
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return (
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe80") ||
    v6.startsWith("::ffff:")
  );
}

export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * fetch() that re-validates every redirect hop and enforces a timeout.
 * `allowHost` optionally restricts which hosts may be contacted.
 */
export async function safeFetch(
  raw: string,
  opts: { timeoutMs?: number; allowHost?: (host: string) => boolean; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { timeoutMs = 10_000, allowHost, headers } = opts;
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    const url = assertPublicUrl(current);
    if (allowHost && !allowHost(url.hostname)) {
      throw new Error(`Host not allowed: ${url.hostname}`);
    }
    const res = await fetch(url, {
      redirect: "manual",
      headers: { ...BROWSER_HEADERS, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

/** Download a URL into memory, refusing bodies larger than `maxBytes`. */
export async function fetchBuffer(raw: string, maxBytes = 25 * 1024 * 1024, timeoutMs = 20_000): Promise<Buffer> {
  const res = await safeFetch(raw, { timeoutMs });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${raw}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("File too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("File too large");
  return buf;
}
