/** Isolate provider-rendered search attribution: no scripts or access to our origin. */
export function SearchSuggestions({ html }: { html?: string }) {
  if (!html) return null;
  return <iframe title="Google Search suggestions" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:"><base target="_blank">${html}`} className="mt-4 h-28 w-full rounded-lg border-0 bg-white" />;
}
