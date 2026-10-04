import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_ROOT } from "@/lib/storage-root";

/**
 * Signed session cookies: "<userId>.<expiresAt>.<hmac>". No storage lookup is needed to check
 * one, so proxy.ts can turn away signed-out requests cheaply.
 *
 * The key is AUTH_SECRET. Locally it's generated once into .data/auth-secret; anywhere the app
 * can't keep a file (Vercel) AUTH_SECRET must be set, or every cold start would sign everyone out.
 */

export const SESSION_COOKIE = "ps-session";
export const SESSION_DAYS = 30;

let secret: string | null = null;
function key(): string {
  if (secret) return secret;
  if (process.env.AUTH_SECRET) return (secret = process.env.AUTH_SECRET);
  if (process.env.VERCEL) throw new Error("AUTH_SECRET isn't set. Add a long random string to the project's environment variables.");
  const file = path.join(DATA_ROOT, "auth-secret");
  try {
    secret = fs.readFileSync(file, "utf8").trim();
  } catch {
    secret = randomBytes(32).toString("base64url");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  return secret;
}

const sign = (data: string) => createHmac("sha256", key()).update(data).digest("base64url");

export function createSessionToken(userId: string): { token: string; expires: Date } {
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const data = `${userId}.${expires.getTime()}`;
  return { token: `${data}.${sign(data)}`, expires };
}

/** The signed-in user's id, or null for a missing, forged or expired cookie. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const [userId, exp, mac] = token.split(".");
  if (!userId || !exp || !mac || !/^[a-f0-9]{24}$/.test(userId) || Number(exp) < Date.now()) return null;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given) ? userId : null;
}

export const sessionCookieOptions = (expires: Date, secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", expires });
