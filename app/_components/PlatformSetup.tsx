"use client";

import { Check, Copy, ExternalLink, LoaderCircle, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { PLATFORM_INFO, PLATFORM_SETUP, type Platform, type SetupInfo } from "@/lib/platforms";

/**
 * Walks through creating a platform's developer app and saves its keys to .env.local,
 * which turns on one-click publishing for it. Deployed apps list the env vars to add instead.
 */
export function PlatformSetup({ platform, info, onSaved }: { platform: Platform; info: SetupInfo; onSaved: () => void }) {
  const setup = PLATFORM_SETUP[platform];
  const label = PLATFORM_INFO[platform].label;
  const [values, setValues] = useState<Record<string, string>>({});
  const [publicUrl, setPublicUrl] = useState(info.publicUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const origin = publicUrl.trim().replace(/\/+$/, "") || info.origin;
  const redirect = `${origin}/api/connect/${platform}/callback`;
  // Instagram, TikTok and Facebook refuse http redirect URLs, so localhost needs an https tunnel.
  const needsTunnel = setup.httpsOnly && !origin.startsWith("https:");
  const showPublicUrl = info.editable && (needsTunnel || !!info.publicUrl || publicUrl !== info.publicUrl);
  const missing = setup.keys.some((k) => !k.optional && !values[k.env]?.trim());

  const copy = () =>
    void navigator.clipboard?.writeText(redirect).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/connect/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, values, publicUrl: publicUrl !== info.publicUrl ? publicUrl : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Couldn't save (${res.status})`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-white/[0.06] bg-black/20 px-3.5 py-4 text-[13px] leading-relaxed text-zinc-400">
      <ol className="list-decimal space-y-1 pl-5 marker:text-zinc-600">
        {setup.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <a href={setup.console} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-zinc-200 hover:text-white">
        Open {setup.consoleLabel} <ExternalLink className="size-3.5" />
      </a>

      <div>
        <span className="mb-1.5 block font-medium text-zinc-400">Redirect URL</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-white/[0.04] px-3 py-2 text-[12px] text-zinc-200 ring-1 ring-white/10">{redirect}</code>
          <button onClick={copy} aria-label="Copy redirect URL" className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 ring-1 ring-white/10 transition hover:bg-white/[0.06] hover:text-white">
            {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
          </button>
        </div>
        {needsTunnel && (
          <p className="mt-1.5 flex gap-1.5 text-amber-300/90">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {label} only accepts https redirect URLs. Start a tunnel (for example <code className="text-amber-200">ngrok http 3000</code>), enter its address below, and open Plate Studio from that address when you connect.
            </span>
          </p>
        )}
      </div>

      {info.editable ? (
        <div className="space-y-3">
          {showPublicUrl && <Field label="Public URL" hint="https tunnel or domain" value={publicUrl} onChange={setPublicUrl} placeholder="https://your-tunnel.ngrok.app" />}
          {setup.keys.map((k) => (
            <Field
              key={k.env}
              label={k.label}
              hint={k.optional ? "Optional" : undefined}
              secret={k.secret}
              value={values[k.env] ?? ""}
              onChange={(v) => setValues((s) => ({ ...s, [k.env]: v }))}
            />
          ))}
          {setup.note && <p className="text-zinc-500">{setup.note}</p>}
          <div className="flex items-center justify-end gap-3">
            {error && <p className="min-w-0 flex-1 text-rose-300">{error}</p>}
            <button
              onClick={save}
              disabled={saving || missing}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-40"
            >
              {saving && <LoaderCircle className="size-3.5 animate-spin" />}
              Save keys
            </button>
          </div>
          <p className="text-[12px] text-zinc-600">
            Saved to <code className="text-zinc-500">.env.local</code> on this computer.
          </p>
        </div>
      ) : (
        <div>
          <p>Add these environment variables in your hosting settings, then redeploy:</p>
          <ul className="mt-1.5 space-y-0.5">
            {setup.keys.map((k) => (
              <li key={k.env}>
                <code className="text-zinc-200">{k.env}</code> <span className="text-zinc-600">{k.label}{k.optional && ", optional"}</span>
              </li>
            ))}
          </ul>
          {setup.note && <p className="mt-2 text-zinc-500">{setup.note}</p>}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, value, onChange, secret, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; secret?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between font-medium text-zinc-400">
        {label} {hint && <span className="font-normal text-zinc-600">{hint}</span>}
      </span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="h-9 w-full rounded-lg bg-white/[0.04] px-3 text-[14px] text-zinc-100 ring-1 ring-white/10 outline-none placeholder:text-zinc-600 focus:ring-brand-500"
      />
    </label>
  );
}
