/** Social platforms an ad can be published to. Pure module: shared by the UI and the API. */

export const PLATFORMS = ["youtube", "instagram", "tiktok", "facebook"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_INFO: Record<Platform, { label: string; uploadPage: string; captionMax: number }> = {
  youtube: { label: "YouTube", uploadPage: "https://www.youtube.com/upload", captionMax: 5000 },
  instagram: { label: "Instagram", uploadPage: "https://www.instagram.com/", captionMax: 2200 },
  tiktok: { label: "TikTok", uploadPage: "https://www.tiktok.com/tiktokstudio/upload", captionMax: 2200 },
  facebook: { label: "Facebook", uploadPage: "https://www.facebook.com/", captionMax: 5000 },
};

export const isPlatform = (v: unknown): v is Platform => (PLATFORMS as readonly unknown[]).includes(v);

/** public = everyone; unlisted = link only (YouTube; other platforms treat it as public); private = only you. */
export type Privacy = "public" | "unlisted" | "private";

export interface ConnectionStatus {
  /** The app keys for this platform are in the environment. */
  configured: boolean;
  /** This browser has signed in to an account. */
  connected: boolean;
  /** Channel, page or @handle it will post as. */
  account?: string;
}

export type ConnectionsResponse = Record<Platform, ConnectionStatus>;

export interface PublishRecord {
  platform: Platform;
  /** Link to the post, when the platform gives one. */
  url: string | null;
  at: number;
  jobId: string;
}

export interface SetupKey {
  /** Environment variable it's saved as. */
  env: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
}

/** How to create each platform's developer app, shown in the export dialog's Set up panel. */
export const PLATFORM_SETUP: Record<Platform, { console: string; consoleLabel: string; steps: string[]; keys: SetupKey[]; httpsOnly: boolean; note?: string }> = {
  youtube: {
    console: "https://console.cloud.google.com/apis/credentials",
    consoleLabel: "Google Cloud Console",
    steps: [
      "Create a project (or pick one) in Google Cloud Console.",
      "Under APIs & Services → Library, enable YouTube Data API v3.",
      "On the OAuth consent screen, choose External and add your Google account as a test user.",
      "Under Credentials, create an OAuth client ID of type Web application and add the redirect URL below as an authorized redirect URI.",
      "Paste the client ID and client secret here.",
    ],
    keys: [
      { env: "YOUTUBE_CLIENT_ID", label: "Client ID" },
      { env: "YOUTUBE_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
    httpsOnly: false,
    note: "Until Google verifies the app, YouTube keeps uploads private.",
  },
  instagram: {
    console: "https://developers.facebook.com/apps/",
    consoleLabel: "Meta for Developers",
    steps: [
      "Create an app in Meta for Developers with the Instagram use case (Instagram API with Instagram Login).",
      "Under API setup with Instagram login → Set up Instagram business login, add the redirect URL below.",
      "Under App roles → Roles, add your Instagram account as an Instagram tester and accept the invite in the Instagram app.",
      "Copy the Instagram app ID and Instagram app secret from the API setup page (not the Meta app ID).",
    ],
    keys: [
      { env: "INSTAGRAM_APP_ID", label: "Instagram app ID" },
      { env: "INSTAGRAM_APP_SECRET", label: "Instagram app secret", secret: true },
    ],
    httpsOnly: true,
    note: "Posting needs an Instagram Business or Creator account.",
  },
  tiktok: {
    console: "https://developers.tiktok.com/apps/",
    consoleLabel: "TikTok for Developers",
    steps: [
      "Create an app in TikTok for Developers → Manage apps.",
      "Add the Login Kit and Content Posting API products, and turn on Direct Post.",
      "Under Login Kit, add the redirect URL below.",
      "In Sandbox, add your TikTok account as a target user (or submit the app for review).",
      "Paste the client key and client secret here.",
    ],
    keys: [
      { env: "TIKTOK_CLIENT_KEY", label: "Client key" },
      { env: "TIKTOK_CLIENT_SECRET", label: "Client secret", secret: true },
    ],
    httpsOnly: true,
    note: "Until TikTok audits the app, videos post as private (only you).",
  },
  facebook: {
    console: "https://developers.facebook.com/apps/",
    consoleLabel: "Meta for Developers",
    steps: [
      "Create an app in Meta for Developers with the Manage everything on your Page use case.",
      "Under Facebook Login → Settings, add the redirect URL below to Valid OAuth Redirect URIs.",
      "Copy the App ID and App secret from App settings → Basic.",
      "Optionally add the ID of the Page to post to; otherwise it uses your first Page.",
    ],
    keys: [
      { env: "FACEBOOK_APP_ID", label: "App ID" },
      { env: "FACEBOOK_APP_SECRET", label: "App secret", secret: true },
      { env: "FACEBOOK_PAGE_ID", label: "Page ID", optional: true },
    ],
    httpsOnly: true,
    note: "Posting needs a Facebook Page you manage.",
  },
};

/** GET /api/connect/setup */
export interface SetupInfo {
  /** Keys can be saved from the app (development only; deployed apps use their host's env settings). */
  editable: boolean;
  /** Current PUBLIC_URL, if set. */
  publicUrl: string;
  /** Origin the redirect URLs are built from. */
  origin: string;
}
