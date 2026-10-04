/** Brand fonts for the restaurant name on the intro and end card. Pure module: shared by the UI and the renderer. */

/** Bundled with the app (assets/fonts); used when nothing better is known. */
export const DEFAULT_FONT = "Inter";

/** Google Fonts offered in the picker, roughly from plain to decorative. Any other Google font works too. */
export const FONT_CHOICES: { family: string; style: string }[] = [
  { family: "Inter", style: "Clean & modern" },
  { family: "Montserrat", style: "Geometric" },
  { family: "Oswald", style: "Condensed" },
  { family: "Bebas Neue", style: "Tall caps" },
  { family: "Anton", style: "Heavy" },
  { family: "Playfair Display", style: "Elegant serif" },
  { family: "DM Serif Display", style: "Classic serif" },
  { family: "Abril Fatface", style: "Bistro" },
  { family: "Cormorant Garamond", style: "Fine dining" },
  { family: "Roboto Slab", style: "Slab" },
  { family: "Lobster", style: "Retro diner" },
  { family: "Pacifico", style: "Casual script" },
  { family: "Caveat", style: "Handwritten" },
  { family: "Rye", style: "Western" },
  { family: "Fredoka", style: "Friendly" },
];

/** A plausible Google Fonts family name (letters, digits and spaces). */
export const isFontFamily = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/.test(v.trim());

/** Google Fonts stylesheet with the regular and heavy weights of each family (missing weights are skipped). */
export const googleFontsCss = (families: string[]) =>
  `https://fonts.googleapis.com/css?family=${families.map((f) => `${f.trim().replace(/ +/g, "+")}:400,700,800,900`).join("|")}&display=swap`;

/** Where the font the ad uses came from. */
export type FontSource = "chosen" | "website" | "default";

/** GET /api/brand-font */
export interface BrandFontInfo {
  family: string;
  source: FontSource;
}
