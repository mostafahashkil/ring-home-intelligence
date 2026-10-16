import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/auth/core";
import { requirePermission } from "@/lib/auth/session";
import { beginOAuth, RingAuthError } from "@/lib/providers/ring/auth";
import { audit } from "@/lib/repo/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts partner-initiated OAuth 2.0 + PKCE. The user signs in at Ring — never here. */
export async function GET(req: Request) {
  try {
    const user = await requirePermission("integrations:manage");
    const url = beginOAuth(user.id);
    audit(user.id, "integration.ring_link_started");
    return NextResponse.redirect(url);
  } catch (err) {
    const back = new URL("/settings", req.url);
    back.hash = "integrations";
    back.searchParams.set("ring", err instanceof ForbiddenError ? "forbidden" : err instanceof RingAuthError ? "not_configured" : "error");
    return NextResponse.redirect(back);
  }
}
