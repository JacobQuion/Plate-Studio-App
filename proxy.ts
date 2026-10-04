import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Sign-in gate: without a valid session, pages redirect to /login and API calls get a 401.
 * This only checks the cookie's signature; pages check that the profile is filled in.
 */
export function proxy(req: NextRequest) {
  if (verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the sign-in page and its API, Next's assets and public files (demo videos, icons).
  matcher: ["/((?!login|api/auth/|_next/|favicon|icon\\.svg|.*\\.(?:png|jpe?g|svg|webp|gif|mp4|webm|ico|txt|json)$).*)"],
};
