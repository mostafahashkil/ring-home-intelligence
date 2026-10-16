import { NextRequest, NextResponse } from "next/server";

/**
 * Cheap gate: requests without a session cookie go to /login. Real validation (hashed token lookup,
 * expiry, role permissions) happens server-side in every page, action and route handler.
 */
const PUBLIC = ["/login", "/setup", "/api/ring/webhook", "/api/health"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (req.cookies.get("rhi_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
