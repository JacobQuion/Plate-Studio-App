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
