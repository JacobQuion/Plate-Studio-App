import { resolveBrandFont } from "@/lib/brand-font";
import { isFontFamily } from "@/lib/fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/brand-font?website=&font=  ->  BrandFontInfo: the font the restaurant name will be set in. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const font = params.get("font");
  const website = (params.get("website") ?? "").slice(0, 80);
  return Response.json(await resolveBrandFont({ font: isFontFamily(font) ? font.trim() : undefined, website }));
}
