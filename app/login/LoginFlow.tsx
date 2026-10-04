"use client";

import { ArrowLeft, ArrowRight, KeyRound, LoaderCircle, Mail } from "lucide-react";
import { useRef, useState } from "react";
import type { Profile } from "@/lib/auth";

type Step = "email" | "code" | "profile";

/** Email → 6-digit code → (first sign-in) owner and restaurant details. */
export function LoginFlow({ next, profile, devPass }: { next: string; profile: Profile | null; devPass: boolean }) {
  const [step, setStep] = useState<Step>(profile ? "profile" : "email");
  const [email, setEmail] = useState(profile?.email ?? "");
  const [code, setCode] = useState("");
  const [delivery, setDelivery] = useState<"email" | "log">("email");
  const [details, setDetails] = useState({
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    restaurant: profile?.restaurant ?? "",
    googleMapsUrl: profile?.googleMapsUrl ?? "",
    yelpUrl: profile?.yelpUrl ?? "",
  });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const call = async (url: string, body: unknown, method = "POST") => {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setWorking(false);
    }
  };

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const data = await call("/api/auth/code", { email });
    if (!data) return;
    setDelivery(data.delivery);
    setCode("");
    setStep("code");
    setTimeout(() => codeInput.current?.focus(), 50);
  };

  const verify = async (value = code) => {
    const data = await call("/api/auth/verify", { email, code: value });
    if (!data) return;
    if (data.complete) location.assign(next);
    else setStep("profile");
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await call("/api/auth/profile", details, "PUT")) location.assign(next);
  };

  // Temporary: skips the email code (local dev server only).
  const useDevPass = async () => {
    if (await call("/api/auth/dev", {})) location.assign(next);
  };

  const field = (key: keyof typeof details) => ({
    value: details[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDetails((d) => ({ ...d, [key]: e.target.value })),
  });

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#08080a] px-4 py-10">
      <div className="mb-8 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" className="size-8" />
        <span className="font-display text-[19px] font-bold tracking-tight text-white">Plate Studio</span>
      </div>

      <div className="w-full max-w-md rounded-2xl bg-[#0e0e11] p-6 shadow-2xl ring-1 ring-white/10 sm:p-8">
        {step === "email" && (
          <form onSubmit={sendCode} className="space-y-5">
            <div>
              <h1 className="font-display text-2xl font-bold text-white">Sign In</h1>
              <p className="mt-1.5 text-[15px] text-zinc-400">We&apos;ll email you a code. No password needed.</p>
            </div>
            <Field label="Email">
              <input type="email" required autoFocus autoComplete="email" placeholder="you@restaurant.com" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
            </Field>
            <Submit working={working}>
              Email me a code <ArrowRight className="size-4" />
            </Submit>
          </form>
        )}

        {step === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
            className="space-y-5"
          >
            <div>
              <button type="button" onClick={() => setStep("email")} className="mb-4 inline-flex items-center gap-1 text-[13px] text-zinc-500 transition hover:text-zinc-200">
                <ArrowLeft className="size-3.5" /> Use a different email
              </button>
              <h1 className="font-display text-2xl font-bold text-white">Check your email</h1>
              <p className="mt-1.5 text-[15px] text-zinc-400">
                {delivery === "email" ? (
                  <>
                    We sent a 6-digit code to <span className="text-zinc-200">{email}</span>.
                  </>
                ) : (
                  <>Email isn&apos;t set up on this server yet, so the code for {email} is in the terminal running the app.</>
                )}
              </p>
            </div>
            <Field label="Code">
              <input
                ref={codeInput}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (v.length === 6) void verify(v);
                }}
                className={`${INPUT} text-center font-mono text-2xl tracking-[0.5em]`}
              />
            </Field>
            <Submit working={working} disabled={code.length !== 6}>
              Sign in
            </Submit>
            <button type="button" onClick={() => void sendCode()} disabled={working} className="inline-flex w-full items-center justify-center gap-1.5 text-[13px] text-zinc-500 transition hover:text-zinc-200 disabled:opacity-40">
              <Mail className="size-3.5" /> Send a new code
            </button>
          </form>
        )}

        {step === "profile" && (
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="mb-1">
              <h1 className="font-display text-2xl font-bold text-white">Tell us about your restaurant</h1>
              <p className="mt-1.5 text-[15px] text-zinc-400">We&apos;ll use your listing to bring in your menu and dish photos.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input required autoFocus autoComplete="given-name" {...field("firstName")} className={INPUT} />
              </Field>
              <Field label="Last name">
                <input required autoComplete="family-name" {...field("lastName")} className={INPUT} />
              </Field>
            </div>
            <Field label="Restaurant name">
              <input required autoComplete="organization" placeholder="Kumo Ramen Bar" {...field("restaurant")} className={INPUT} />
            </Field>
            <Field label="Google Maps link" hint="Optional">
              <input type="url" inputMode="url" placeholder="https://maps.app.goo.gl/…" {...field("googleMapsUrl")} className={INPUT} />
            </Field>
            <Field label="Yelp page" hint="Optional">
              <input type="url" inputMode="url" placeholder="https://www.yelp.com/biz/…" {...field("yelpUrl")} className={INPUT} />
            </Field>
            <div className="pt-1">
              <Submit working={working}>
                Continue <ArrowRight className="size-4" />
              </Submit>
            </div>
          </form>
        )}

        {error && <p className="mt-4 text-center text-[14px] text-rose-300">{error}</p>}
      </div>

      {devPass && step === "email" && (
        <button
          type="button"
          onClick={useDevPass}
          disabled={working}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-dashed border-white/20 px-4 text-[14px] font-medium text-zinc-400 transition hover:border-white/40 hover:text-white disabled:opacity-40"
        >
          <KeyRound className="size-4" /> Developer pass
        </button>
      )}
    </div>
  );
}

const INPUT =
  "h-11 w-full rounded-lg bg-white/[0.04] px-3.5 text-[15px] text-zinc-100 ring-1 ring-white/10 outline-none placeholder:text-zinc-600 focus:ring-2 focus:ring-brand-500";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-zinc-400">
        {label} {hint && <span className="font-normal text-zinc-600">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Submit({ working, disabled, children }: { working: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={working || disabled}
      className="accent-fill relative inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-700 to-brand-500 px-5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
    >
      {working ? <LoaderCircle className="size-4 animate-spin" /> : children}
    </button>
  );
}
