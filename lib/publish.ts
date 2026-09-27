import { readFile } from "node:fs/promises";
import { PLATFORM_INFO, type Platform, type Privacy } from "@/lib/platforms";

/**
 * One-click publishing: OAuth sign-in and video upload for each platform.
 *
 *   YouTube    Google OAuth → YouTube Data API resumable upload
 *   Instagram  Instagram API with Instagram Login → Reels container, resumable upload, publish
 *   TikTok     Login Kit → Content Posting API direct post (FILE_UPLOAD)
 *   Facebook   Facebook Login → Page token → Page video upload
 *
 * A platform is available when its app keys are in the environment (see .env.example).
 * The signed-in account's tokens live in an httpOnly cookie per platform, so every
 * browser posts to its own accounts.
 */

export interface Connection {
  access: string;
  refresh?: string;
  /** ms epoch when `access` expires. */
  exp?: number;
  /** Channel title, page name or @handle. */
  account?: string;
  /** Instagram user id / Facebook page id. */
  id?: string;
}

export interface Post {
  title: string;
  /** Description / caption, hashtags included. */
  caption: string;
  /** YouTube keywords. */
  tags: string[];
  privacy: Privacy;
}

export interface PublishResult {
  url: string | null;
  /** Something the user should know, e.g. the post went up as private. */
  note?: string;
}

interface Provider {
  keys: () => { id?: string; secret?: string };
  authorizeUrl: (redirectUri: string, state: string) => string;
  exchange: (code: string, redirectUri: string) => Promise<Connection>;
  refresh?: (c: Connection) => Promise<Connection>;
  publish: (c: Connection, video: Buffer, post: Post) => Promise<PublishResult>;
}

const GRAPH_VERSION = "v23.0";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function call<T = Record<string, unknown>>(url: string, init: RequestInit = {}, what = "Request"): Promise<T> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(120_000) });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {}
  const err = apiError(data);
  if (!res.ok || err) throw new Error(`${what} failed: ${err ?? (text.slice(0, 200) || res.status)}`);
  return data as T;
}

/** Pull a readable message out of the many error shapes these APIs return. */
function apiError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const e = d.error as Record<string, unknown> | string | undefined;
  if (typeof e === "string") return (d.error_description as string) || e;
  // TikTok always sends { error: { code: "ok" } } on success.
  if (e && typeof e === "object" && e.code !== "ok") return String(e.message || e.code || "Unknown error");
  return null;
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});

const qs = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

const youtube: Provider = {
  keys: () => ({ id: process.env.YOUTUBE_CLIENT_ID, secret: process.env.YOUTUBE_CLIENT_SECRET }),
  authorizeUrl: (redirect_uri, state) =>
    `https://accounts.google.com/o/oauth2/v2/auth?${qs({
      client_id: youtube.keys().id!,
      redirect_uri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      access_type: "offline",
      prompt: "consent",
      state,
    })}`,
  async exchange(code, redirect_uri) {
    const { id, secret } = youtube.keys();
    const t = await call<{ access_token: string; refresh_token?: string; expires_in: number }>(
      "https://oauth2.googleapis.com/token",
      form({ code, client_id: id!, client_secret: secret!, redirect_uri, grant_type: "authorization_code" }),
      "Google sign-in",
    );
    const channels = await call<{ items?: { snippet: { title: string } }[] }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    }).catch(() => ({ items: [] }));
    if (!channels.items?.length) throw new Error("This Google account doesn't have a YouTube channel yet. Create one on youtube.com and try again.");
    return { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + t.expires_in * 1000, account: channels.items[0].snippet.title };
  },
  async refresh(c) {
    const { id, secret } = youtube.keys();
    const t = await call<{ access_token: string; expires_in: number }>(
      "https://oauth2.googleapis.com/token",
      form({ refresh_token: c.refresh!, client_id: id!, client_secret: secret!, grant_type: "refresh_token" }),
      "Google sign-in refresh",
    );
    return { ...c, access: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  },
  async publish(c, video, post) {
    const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.access}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(video.length),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          // YouTube rejects titles over 100 characters or containing angle brackets.
          title: post.title.replace(/[<>]/g, "").slice(0, 100) || "New on the menu",
          description: post.caption.replace(/[<>]/g, "").slice(0, PLATFORM_INFO.youtube.captionMax),
          tags: post.tags.slice(0, 15),
          categoryId: "26", // Howto & Style, where most food content lives
        },
        status: { privacyStatus: post.privacy, selfDeclaredMadeForKids: false },
      }),
    });
    const location = start.headers.get("location");
    if (!start.ok || !location) throw new Error(`YouTube upload failed: ${apiError(await start.json().catch(() => null)) ?? start.status}`);
    const uploaded = await call<{ id: string; status?: { privacyStatus?: string } }>(
      location,
      { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: new Uint8Array(video), signal: AbortSignal.timeout(600_000) },
      "YouTube upload",
    );
    // Uploads from Google Cloud projects that haven't passed YouTube's audit are locked to private.
    const locked = post.privacy !== "private" && uploaded.status?.privacyStatus === "private";
    return { url: `https://youtu.be/${uploaded.id}`, note: locked ? "YouTube kept it private because this app hasn't been verified by Google yet." : undefined };
  },
};

// ---------------------------------------------------------------------------
// Instagram (Reels)
// ---------------------------------------------------------------------------

const IG = `https://graph.instagram.com/${GRAPH_VERSION}`;

const instagram: Provider = {
  keys: () => ({ id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET }),
  authorizeUrl: (redirect_uri, state) =>
    `https://www.instagram.com/oauth/authorize?${qs({
      client_id: instagram.keys().id!,
      redirect_uri,
      response_type: "code",
      scope: "instagram_business_basic,instagram_business_content_publish",
      state,
    })}`,
  async exchange(code, redirect_uri) {
    const { id, secret } = instagram.keys();
    const short = await call<{ access_token: string }>(
      "https://api.instagram.com/oauth/access_token",
      form({ client_id: id!, client_secret: secret!, grant_type: "authorization_code", redirect_uri, code }),
      "Instagram sign-in",
    );
    const long = await call<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?${qs({ grant_type: "ig_exchange_token", client_secret: secret!, access_token: short.access_token })}`,
      {},
      "Instagram sign-in",
    );
    const me = await call<{ user_id: string; username: string }>(`${IG}/me?${qs({ fields: "user_id,username", access_token: long.access_token })}`, {}, "Instagram profile");
    return { access: long.access_token, exp: Date.now() + long.expires_in * 1000, account: `@${me.username}`, id: String(me.user_id) };
  },
  async refresh(c) {
    const t = await call<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?${qs({ grant_type: "ig_refresh_token", access_token: c.access })}`,
      {},
      "Instagram sign-in refresh",
    );
    return { ...c, access: t.access_token, exp: Date.now() + t.expires_in * 1000 };
  },
  async publish(c, video, post) {
    const caption = post.caption.slice(0, PLATFORM_INFO.instagram.captionMax);
    const container = await call<{ id: string }>(
      `${IG}/${c.id}/media`,
      form({ media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true", access_token: c.access }),
      "Instagram upload",
    );
    await call(
      `https://rupload.facebook.com/ig-api-upload/${GRAPH_VERSION}/${container.id}`,
      { method: "POST", headers: { Authorization: `OAuth ${c.access}`, offset: "0", file_size: String(video.length) }, body: new Uint8Array(video), signal: AbortSignal.timeout(600_000) },
      "Instagram upload",
    );
    // Instagram transcodes the video before it can be published.
    for (let i = 0; ; i++) {
      const s = await call<{ status_code: string; status?: string }>(`${IG}/${container.id}?${qs({ fields: "status_code,status", access_token: c.access })}`, {}, "Instagram processing");
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram couldn't process the video${s.status ? `: ${s.status}` : ""}`);
      if (i > 60) throw new Error("Instagram is taking too long to process the video. Try again in a few minutes.");
      await sleep(5000);
    }
    const media = await call<{ id: string }>(`${IG}/${c.id}/media_publish`, form({ creation_id: container.id, access_token: c.access }), "Instagram publish");
    const link = await call<{ permalink?: string }>(`${IG}/${media.id}?${qs({ fields: "permalink", access_token: c.access })}`).catch(() => ({ permalink: undefined }));
    const note = post.privacy === "private" ? "Instagram posts are always public on your profile." : undefined;
    return { url: link.permalink ?? `https://www.instagram.com/${c.account?.replace(/^@/, "") ?? ""}`, note };
  },
};

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

const TT = "https://open.tiktokapis.com/v2";

type TikTokToken = { access_token: string; refresh_token: string; expires_in: number; open_id: string };

const tiktokConnection = async (t: TikTokToken, previous?: Connection): Promise<Connection> => {
  const info = await call<{ data: { user: { username?: string; display_name?: string } } }>(`${TT}/user/info/?fields=open_id,display_name,username`, {
    headers: { Authorization: `Bearer ${t.access_token}` },
  }).catch(() => null);
  const user = info?.data.user;
  return {
    access: t.access_token,
    refresh: t.refresh_token,
    exp: Date.now() + t.expires_in * 1000,
    id: user?.username ?? previous?.id,
    account: user?.username ? `@${user.username}` : (user?.display_name ?? previous?.account),
  };
};

const tiktok: Provider = {
  keys: () => ({ id: process.env.TIKTOK_CLIENT_KEY, secret: process.env.TIKTOK_CLIENT_SECRET }),
  authorizeUrl: (redirect_uri, state) =>
    `https://www.tiktok.com/v2/auth/authorize/?${qs({
      client_key: tiktok.keys().id!,
      redirect_uri,
      response_type: "code",
      scope: "user.info.basic,user.info.profile,video.publish",
      state,
    })}`,
  async exchange(code, redirect_uri) {
    const { id, secret } = tiktok.keys();
    const t = await call<TikTokToken>(`${TT}/oauth/token/`, form({ client_key: id!, client_secret: secret!, code, grant_type: "authorization_code", redirect_uri }), "TikTok sign-in");
    return tiktokConnection(t);
  },
  async refresh(c) {
    const { id, secret } = tiktok.keys();
    const t = await call<TikTokToken>(`${TT}/oauth/token/`, form({ client_key: id!, client_secret: secret!, grant_type: "refresh_token", refresh_token: c.refresh! }), "TikTok sign-in refresh");
    return tiktokConnection(t, c);
  },
  async publish(c, video, post) {
    const auth = { Authorization: `Bearer ${c.access}`, "Content-Type": "application/json; charset=UTF-8" };
    const creator = await call<{ data: { privacy_level_options: string[]; max_video_post_duration_sec: number } }>(
      `${TT}/post/publish/creator_info/query/`,
      { method: "POST", headers: auth },
      "TikTok account check",
    );
    const options = creator.data.privacy_level_options;
    const wanted = post.privacy === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE";
    // Chunks must be 5-64 MB; the last one takes the remainder (up to 128 MB).
    const MB = 1024 * 1024;
    const chunkSize = video.length <= 64 * MB ? video.length : 32 * MB;
    const chunks = Math.max(1, Math.floor(video.length / chunkSize));

    const init = async (privacy_level: string) =>
      call<{ data: { publish_id: string; upload_url: string } }>(
        `${TT}/post/publish/video/init/`,
        {
          method: "POST",
          headers: auth,
          body: JSON.stringify({
            post_info: { title: post.caption.slice(0, PLATFORM_INFO.tiktok.captionMax), privacy_level },
            source_info: { source: "FILE_UPLOAD", video_size: video.length, chunk_size: chunkSize, total_chunk_count: chunks },
          }),
        },
        "TikTok upload",
      );
    let privacy = options.includes(wanted) ? wanted : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
    let started: Awaited<ReturnType<typeof init>>;
    try {
      started = await init(privacy);
    } catch (err) {
      // Apps that haven't passed TikTok's audit can only post privately.
      if (!/unaudited/i.test((err as Error).message) || privacy === "SELF_ONLY") throw err;
      privacy = "SELF_ONLY";
      started = await init(privacy);
    }

    for (let i = 0; i < chunks; i++) {
      const from = i * chunkSize;
      const to = i === chunks - 1 ? video.length : from + chunkSize;
      const res = await fetch(started.data.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${from}-${to - 1}/${video.length}` },
        body: new Uint8Array(video.subarray(from, to)),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error(`TikTok upload failed (${res.status})`);
    }

    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      const s = await call<{ data: { status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(
        `${TT}/post/publish/status/fetch/`,
        { method: "POST", headers: auth, body: JSON.stringify({ publish_id: started.data.publish_id }) },
        "TikTok processing",
      );
      if (s.data.status === "FAILED") throw new Error(`TikTok couldn't publish the video: ${s.data.fail_reason ?? "unknown reason"}`);
      const postId = s.data.publicaly_available_post_id?.[0];
      if (s.data.status === "PUBLISH_COMPLETE" && (postId || privacy === "SELF_ONLY")) {
        const profile = c.id ? `https://www.tiktok.com/@${c.id}` : "https://www.tiktok.com/";
        return {
          url: postId && c.id ? `${profile}/video/${postId}` : profile,
          note: privacy === "SELF_ONLY" && post.privacy !== "private" ? "TikTok posted it as private (only you) because this app hasn't passed TikTok's audit yet." : undefined,
        };
      }
    }
    return { url: c.id ? `https://www.tiktok.com/@${c.id}` : null, note: "TikTok is still processing it. It'll show up on your profile in a few minutes." };
  },
};

// ---------------------------------------------------------------------------
// Facebook (Page videos)
// ---------------------------------------------------------------------------

const FB = `https://graph.facebook.com/${GRAPH_VERSION}`;

const facebook: Provider = {
  keys: () => ({ id: process.env.FACEBOOK_APP_ID, secret: process.env.FACEBOOK_APP_SECRET }),
  authorizeUrl: (redirect_uri, state) =>
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${qs({
      client_id: facebook.keys().id!,
      redirect_uri,
      response_type: "code",
      scope: "pages_show_list,pages_read_engagement,pages_manage_posts",
      state,
    })}`,
  async exchange(code, redirect_uri) {
    const { id, secret } = facebook.keys();
    const short = await call<{ access_token: string }>(`${FB}/oauth/access_token?${qs({ client_id: id!, client_secret: secret!, redirect_uri, code })}`, {}, "Facebook sign-in");
    // Page tokens made from a long-lived user token don't expire.
    const long = await call<{ access_token: string }>(
      `${FB}/oauth/access_token?${qs({ grant_type: "fb_exchange_token", client_id: id!, client_secret: secret!, fb_exchange_token: short.access_token })}`,
      {},
      "Facebook sign-in",
    );
    const pages = await call<{ data: { id: string; name: string; access_token: string }[] }>(
      `${FB}/me/accounts?${qs({ fields: "id,name,access_token", limit: "100", access_token: long.access_token })}`,
      {},
      "Facebook pages",
    );
    const wanted = process.env.FACEBOOK_PAGE_ID;
    const page = pages.data.find((p) => p.id === wanted) ?? pages.data[0];
    if (!page) throw new Error("Facebook didn't share any Pages. Publishing needs a Facebook Page for your restaurant; pick it when you sign in.");
    return { access: page.access_token, id: page.id, account: page.name };
  },
  async publish(c, video, post) {
    const body = new FormData();
    body.set("access_token", c.access);
    body.set("title", post.title.slice(0, 255));
    body.set("description", post.caption.slice(0, PLATFORM_INFO.facebook.captionMax));
    // Unpublished page videos are only visible to page admins.
    body.set("published", String(post.privacy !== "private"));
    body.set("source", new Blob([new Uint8Array(video)], { type: "video/mp4" }), "ad.mp4");
    const uploaded = await call<{ id: string }>(`https://graph-video.facebook.com/${GRAPH_VERSION}/${c.id}/videos`, { method: "POST", body, signal: AbortSignal.timeout(600_000) }, "Facebook upload");
    return { url: `https://www.facebook.com/${c.id}/videos/${uploaded.id}` };
  },
};

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const PROVIDERS: Record<Platform, Provider> = { youtube, instagram, tiktok, facebook };

export const platformConfigured = (p: Platform) => {
  const { id, secret } = PROVIDERS[p].keys();
  return !!(id && secret);
};

export const authorizeUrl = (p: Platform, redirectUri: string, state: string) => PROVIDERS[p].authorizeUrl(redirectUri, state);
export const exchangeCode = (p: Platform, code: string, redirectUri: string) => PROVIDERS[p].exchange(code, redirectUri);

/** Refresh tokens that expire within the next few minutes. Returns the same object when nothing changed. */
export async function freshConnection(p: Platform, c: Connection): Promise<Connection> {
  const refresh = PROVIDERS[p].refresh;
  // Instagram's 60-day tokens can only be refreshed while still valid, so renew them a week early.
  const margin = p === "instagram" ? 7 * 86_400_000 : 5 * 60_000;
  if (!refresh || !c.exp || c.exp - Date.now() > margin) return c;
  const expired = new Error(`Your ${PLATFORM_INFO[p].label} sign-in expired. Connect it again.`);
  if (p !== "instagram" && !c.refresh) throw expired;
  try {
    return await refresh(c);
  } catch (err) {
    if (c.exp > Date.now() + 60_000) return c;
    throw p === "instagram" ? expired : err;
  }
}

export async function publishVideo(p: Platform, c: Connection, file: string, post: Post): Promise<PublishResult> {
  return PROVIDERS[p].publish(c, await readFile(file), post);
}

// ---------------------------------------------------------------------------
// Connection cookies
// ---------------------------------------------------------------------------

export const connectionCookie = (p: Platform) => `ps-${p}`;
export const STATE_COOKIE = "ps-oauth-state";

export const encodeConnection = (c: Connection) => Buffer.from(JSON.stringify(c)).toString("base64url");
export function decodeConnection(value: string | undefined): Connection | null {
  if (!value) return null;
  try {
    const c = JSON.parse(Buffer.from(value, "base64url").toString()) as Connection;
    return typeof c.access === "string" ? c : null;
  } catch {
    return null;
  }
}

export const cookieOptions = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 60 * 60 * 24 * 365 });

/** Where OAuth providers send the user back. PUBLIC_URL overrides the request origin (needed behind proxies and tunnels). */
export function redirectUri(req: Request, p: Platform) {
  const origin = process.env.PUBLIC_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
  return `${origin}/api/connect/${p}/callback`;
}
