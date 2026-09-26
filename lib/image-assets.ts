import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ResolvedScene } from "@/lib/ad-plan";
import { fetchBuffer } from "@/lib/safe-fetch";

/** Decode before fingerprinting so metadata and URL differences cannot hide copies. */
export async function prepareDishImages(dishes: ResolvedScene[]): Promise<Map<string, Buffer>> {
  const seen = new Map<string, string>();
  const images = new Map<string, Buffer>();
  for (const dish of dishes) {
    if (!dish.imageUrl) throw new Error(`Add a photo for "${dish.headline}" before rendering.`);
    let pixels: Buffer;
    try {
      const dataUri = /^data:image\/[a-z+.-]+;base64,/i.exec(dish.imageUrl);
      const bytes = dataUri ? Buffer.from(dish.imageUrl.slice(dataUri[0].length), "base64") : await fetchBuffer(dish.imageUrl);
      pixels = await sharp(bytes).rotate().resize(2880, 1620, { fit: "cover", position: sharp.strategy.attention }).removeAlpha().toColourspace("srgb").raw().toBuffer();
    } catch {
      throw new Error(`Couldn't load the photo for "${dish.headline}". Upload it again or choose another image.`);
    }
    const fingerprint = createHash("sha256").update(pixels).digest("hex");
    const previous = seen.get(fingerprint);
    if (previous !== undefined) throw new Error(`"${dish.headline}" uses the same photo as "${previous}". Choose a different photo so images never repeat within the video.`);
    seen.set(fingerprint, dish.headline);
    images.set(dish.id, await sharp(pixels, { raw: { width: 2880, height: 1620, channels: 3 } }).jpeg({ quality: 92 }).toBuffer());
  }
  return images;
}
