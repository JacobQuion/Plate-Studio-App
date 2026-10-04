import os from "node:os";
import path from "node:path";

/** Local data folder (see lib/storage.ts). Its own module so proxy.ts can use it without the Blob SDK. */
// On Vercel the app folder is read-only; $TMPDIR is the only writable place (and doesn't persist).
export const DATA_ROOT =
  process.env.PLATE_STUDIO_DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), "plate-studio-data") : path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"));
