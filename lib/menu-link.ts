/** Pull a Google Maps / Yelp link out of free text, if there is one. Pure: safe to import client-side. */
export function findMenuLink(text: string): string | null {
  const m = /\b((?:https?:\/\/)?(?:[\w-]+\.)*(?:yelp\.[a-z.]+|google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s<>"')]*)/i.exec(text);
  return m ? m[1] : null;
}
