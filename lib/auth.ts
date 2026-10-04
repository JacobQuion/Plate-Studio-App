import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { deleteObject, putObject, readObject } from "@/lib/storage";

/**
 * Restaurant owners sign in with a 6-digit code emailed to them (Resend when RESEND_API_KEY is
 * set; otherwise, outside production, the code is printed in the server log). Accounts live in
 * storage under users/<id>/profile.json, where the id is derived from the email address.
 */

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  restaurant: string;
  googleMapsUrl: string;
  yelpUrl: string;
  createdAt: number;
  updatedAt: number;
}

/** Profile fields the owner fills in after their first sign-in. */
export type ProfileInput = Pick<Profile, "firstName" | "lastName" | "restaurant" | "googleMapsUrl" | "yelpUrl">;

export const profileComplete = (p: Profile | null): p is Profile => !!p && !!p.firstName && !!p.lastName && !!p.restaurant;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
export const normalizeEmail = (raw: unknown) => (typeof raw === "string" ? raw.trim().toLowerCase() : "");
export const isEmail = (email: string) => email.length <= 254 && EMAIL.test(email);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const userIdFor = (email: string) => sha(`user:${email}`).slice(0, 24);
const profileKey = (id: string) => `users/${id}/profile.json`;
const codeKey = (email: string) => `auth/codes/${sha(`code:${email}`)}.json`;

// ---------------------------------------------------------------------------
// Sign-in codes
// ---------------------------------------------------------------------------

const CODE_MINUTES = 10;
const RESEND_AFTER = 30_000;
const MAX_ATTEMPTS = 5;

interface StoredCode {
  hash: string;
  sentAt: number;
  expiresAt: number;
  attempts: number;
}

const hashCode = (email: string, code: string) => sha(`${email}:${code}`);

/** Thrown with a message that's safe to show the user. */
export class AuthError extends Error {}

/** Email a fresh code (replacing any earlier one). */
export async function sendSignInCode(email: string): Promise<{ delivery: "email" | "log" }> {
  const previous = await readCode(email);
  if (previous && Date.now() - previous.sentAt < RESEND_AFTER) throw new AuthError("A code was just sent. Wait a few seconds before asking for another.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = Date.now();
  const stored: StoredCode = { hash: hashCode(email, code), sentAt: now, expiresAt: now + CODE_MINUTES * 60_000, attempts: 0 };
  await putObject(codeKey(email), Buffer.from(JSON.stringify(stored)), "application/json");

  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM || "Plate Studio <onboarding@resend.dev>",
        to: [email],
        subject: `${code} is your Plate Studio code`,
        text: `Your Plate Studio sign-in code is ${code}. It expires in ${CODE_MINUTES} minutes.\n\nIf you didn't ask for it, you can ignore this email.`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#18181b"><p>Your Plate Studio sign-in code:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p><p style="color:#71717a">It expires in ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p></div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { delivery: "email" };
    console.error("[auth] Resend failed:", res.status, (await res.text()).slice(0, 300));
    // Locally, still let the owner in: the code goes to the log below.
    if (process.env.NODE_ENV === "production") {
      // The code never went out, so don't make them wait to ask again.
      await deleteObject(codeKey(email));
      throw new AuthError("We couldn't send the email. Try again in a minute.");
    }
  }
  if (process.env.NODE_ENV === "production") throw new AuthError("Email sign-in isn't set up on this server yet (RESEND_API_KEY).");
  console.log(`\n[auth] Sign-in code for ${email}: ${code}  (${process.env.RESEND_API_KEY ? "Resend couldn't email it" : "set RESEND_API_KEY to email it"})\n`);
  return { delivery: "log" };
}

async function readCode(email: string): Promise<StoredCode | null> {
  const raw = await readObject(codeKey(email));
  try {
    return raw ? (JSON.parse(raw.toString("utf8")) as StoredCode) : null;
  } catch {
    return null;
  }
}

/** Check a code; on success it's used up and the account exists. */
export async function verifySignInCode(email: string, code: string): Promise<Profile> {
  const stored = await readCode(email);
  if (!stored || stored.expiresAt < Date.now()) throw new AuthError("That code has expired. Send a new one.");
  if (stored.attempts >= MAX_ATTEMPTS) throw new AuthError("Too many wrong codes. Send a new one.");
  const expected = Buffer.from(stored.hash);
  const given = Buffer.from(hashCode(email, code.replace(/\D/g, "")));
  if (!timingSafeEqual(expected, given)) {
    await putObject(codeKey(email), Buffer.from(JSON.stringify({ ...stored, attempts: stored.attempts + 1 })), "application/json");
    throw new AuthError(stored.attempts + 1 >= MAX_ATTEMPTS ? "Too many wrong codes. Send a new one." : "That code isn't right. Check the email and try again.");
  }
  await deleteObject(codeKey(email));
  const id = userIdFor(email);
  const existing = await getProfile(id);
  if (existing) return existing;
  const now = Date.now();
  const profile: Profile = { id, email, firstName: "", lastName: "", restaurant: "", googleMapsUrl: "", yelpUrl: "", createdAt: now, updatedAt: now };
  await writeProfile(profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Developer pass (temporary; local dev server only)
// ---------------------------------------------------------------------------

export const devPassEnabled = () => process.env.NODE_ENV === "development";

/** Sign in as a shared test account with its details filled in, skipping the email code. */
export async function devPassProfile(): Promise<Profile> {
  if (!devPassEnabled()) throw new AuthError("The developer pass only works on the local dev server.");
  const email = "dev@platestudio.local";
  const id = userIdFor(email);
  const existing = await getProfile(id);
  const createdAt = existing?.createdAt ?? Date.now();
  if (profileComplete(existing)) return existing;
  const profile: Profile = { id, email, firstName: "Developer", lastName: "Pass", restaurant: "Test Kitchen", googleMapsUrl: "", yelpUrl: "", createdAt, updatedAt: Date.now() };
  await writeProfile(profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function getProfile(id: string): Promise<Profile | null> {
  const raw = await readObject(profileKey(id));
  try {
    return raw ? (JSON.parse(raw.toString("utf8")) as Profile) : null;
  } catch {
    return null;
  }
}

const writeProfile = (p: Profile) => putObject(profileKey(p.id), Buffer.from(JSON.stringify(p)), "application/json");

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A link on one of `hosts`, normalized to https; "" for blank. Throws for anything else. */
function link(v: unknown, hosts: RegExp, label: string): string {
  const raw = text(v, 500);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!hosts.test(url.hostname)) throw new Error();
    url.protocol = "https:";
    return url.toString();
  } catch {
    throw new AuthError(`That doesn't look like a ${label} link.`);
  }
}

export async function updateProfile(id: string, input: Record<string, unknown>): Promise<Profile> {
  const current = await getProfile(id);
  if (!current) throw new AuthError("Your account wasn't found. Sign in again.");
  const next: Profile = {
    ...current,
    firstName: text(input.firstName, 50),
    lastName: text(input.lastName, 50),
    restaurant: text(input.restaurant, 60),
    googleMapsUrl: link(input.googleMapsUrl, /(^|\.)google\.[a-z.]+$|^maps\.app\.goo\.gl$|^goo\.gl$/i, "Google Maps"),
    yelpUrl: link(input.yelpUrl, /(^|\.)yelp\.[a-z.]+$/i, "Yelp"),
    updatedAt: Date.now(),
  };
  if (!next.firstName || !next.lastName) throw new AuthError("Enter your first and last name.");
  if (!next.restaurant) throw new AuthError("Enter your restaurant's name.");
  await writeProfile(next);
  return next;
}

// ---------------------------------------------------------------------------
// Current user
// ---------------------------------------------------------------------------

/** The signed-in user's id from the session cookie (no storage read). */
export async function currentUserId(): Promise<string | null> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The signed-in user's profile, or null. */
export async function currentUser(): Promise<Profile | null> {
  const id = await currentUserId();
  return id ? getProfile(id) : null;
}

/** For pages: the signed-in owner, else off to /login (which also finishes a half-filled profile). */
export async function requireOwner(next: string): Promise<Profile> {
  const user = await currentUser();
  if (profileComplete(user)) return user;
  redirect(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}
