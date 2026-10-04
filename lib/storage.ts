import { del, list, put } from "@vercel/blob";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { DATA_ROOT } from "@/lib/storage-root";

/**
 * Where saved projects, thumbnails and rendered videos live, by key ("projects/<id>/project.json").
 *   - Vercel Blob when BLOB_READ_WRITE_TOKEN is set. Required on Vercel: each request can run on a
 *     different instance, so a file one request writes to local disk isn't there for the next.
 *   - Otherwise files under .data/ (or $PLATE_STUDIO_DATA_DIR).
 *
 * Blobs are public but written under an unguessable name, a fresh one on every write
 * ("projects/<id>/project.<version>.json"), and read back by listing for the newest. Overwriting
 * one name in place would leave the CDN serving the old copy for a while after each save.
 */

export const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
if (process.env.VERCEL && !useBlob) {
  console.warn("[storage] BLOB_READ_WRITE_TOKEN isn't set: projects and videos won't persist between requests on Vercel.");
}

const localPath = (key: string) => path.join(DATA_ROOT, key);

/** "projects/x/project.json" → ["projects/x/project.", ".json"]: every version's name starts with the first half. */
function splitKey(key: string): [string, string] {
  const ext = path.extname(key);
  return [key.slice(0, key.length - ext.length) + ".", ext];
}

/** Every stored version of a key, newest first. */
async function versions(key: string) {
  const [prefix] = splitKey(key);
  const found: { url: string; pathname: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    found.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

/** Store `body` (a Buffer, or a local file for big uploads like videos) under `key`, replacing what was there. */
export async function putObject(key: string, body: Buffer | { file: string }, contentType: string): Promise<void> {
  if (!useBlob) {
    const dest = localPath(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    if (Buffer.isBuffer(body)) await writeFile(tmp, body);
    else await copyFile(body.file, tmp);
    await rename(tmp, dest);
    return;
  }
  const [prefix, ext] = splitKey(key);
  const version = `${Date.now().toString(36).padStart(9, "0")}${randomBytes(12).toString("hex")}`;
  const data = Buffer.isBuffer(body) ? body : (Readable.toWeb(createReadStream(body.file)) as ReadableStream);
  const size = Buffer.isBuffer(body) ? body.length : (await stat(body.file)).size;
  const { url } = await put(`${prefix}${version}${ext}`, data, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    cacheControlMaxAge: 31_536_000, // Each version's name is new, so it never changes.
    multipart: size > 8 * 1024 * 1024,
  });
  const stale = (await versions(key)).filter((b) => b.url !== url).map((b) => b.url);
  if (stale.length) await del(stale).catch((err) => console.warn("[storage] couldn't delete old versions:", (err as Error).message));
}

/** A public URL for `key` (Blob only; locally it's served by an API route instead). */
export async function objectUrl(key: string): Promise<string | null> {
  if (!useBlob) return null;
  return (await versions(key))[0]?.url ?? null;
}

export async function objectExists(key: string): Promise<boolean> {
  if (useBlob) return !!(await objectUrl(key));
  return stat(localPath(key)).then((s) => s.isFile(), () => false);
}

export async function readObject(key: string): Promise<Buffer | null> {
  if (!useBlob) return readFile(localPath(key)).catch(() => null);
  const url = await objectUrl(key);
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

/** The local file for `key`: the stored file itself, or a download of the blob to `downloadTo`. */
export async function objectFile(key: string, downloadTo: string): Promise<string | null> {
  if (!useBlob) return (await objectExists(key)) ? localPath(key) : null;
  const url = await objectUrl(key);
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) return null;
  await mkdir(path.dirname(downloadTo), { recursive: true });
  const tmp = `${downloadTo}.${process.pid}.tmp`;
  await writeFile(tmp, Readable.fromWeb(res.body as import("node:stream/web").ReadableStream));
  await rename(tmp, downloadTo);
  return downloadTo;
}

/** Delete `key`, or everything under it when it ends in "/". */
export async function deleteObject(key: string): Promise<void> {
  if (!useBlob) {
    await rm(localPath(key), { recursive: true, force: true });
    return;
  }
  const urls: string[] = [];
  if (key.endsWith("/")) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: key, cursor, limit: 1000 });
      urls.push(...page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  } else {
    urls.push(...(await versions(key)).map((b) => b.url));
  }
  if (urls.length) await del(urls);
}

/** The names of the folders directly under `prefix` ("projects/" → project ids). */
export async function listFolders(prefix: string): Promise<string[]> {
  if (!useBlob) return readdir(localPath(prefix)).catch(() => [] as string[]);
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, mode: "folded", cursor, limit: 1000 });
    names.push(...page.folders.map((f) => f.slice(prefix.length).replace(/\/$/, "")));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return names;
}
