import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { completeOAuth } from "@/lib/providers/ring/auth";
import { syncProvider } from "@/lib/providers/registry";
import { audit } from "@/lib/repo/audit";
import { log } from "@/lib/util/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  access_denied: "denied",
  invalid_scope: "invalid_scope",
  server_error: "ring_error",
};

export async function GET(req: NextRequest) {
  const back = (status: string) => {
    const u = new URL("/settings", req.url);
    u.searchParams.set("ring", status);
    u.hash = "integrations";
    return NextResponse.redirect(u);
  };
  try {
    const user = await requirePermission("integrations:manage");
    const sp = req.nextUrl.searchParams;
    const error = sp.get("error");
    if (error) {
      // e.g. access_denied with error_description=ring_base_plan_required
      const desc = sp.get("error_description");
      audit(user.id, "integration.ring_link_failed", null, { error, desc });
      return back(desc === "ring_base_plan_required" ? "base_plan_required" : (ERRORS[error] ?? "error"));
    }
    const code = sp.get("code");
    const state = sp.get("state");
    if (!code || !state) return back("error");
    await completeOAuth({ code, state, userId: user.id });
    audit(user.id, "integration.ring_connected");
    try {
      await syncProvider("ring", user.id);
    } catch (err) {
      log.warn("ring.initial_sync_failed", { err: err as Error });
    }
    return back("connected");
  } catch (err) {
    log.error("ring.oauth_callback_failed", { err: err as Error });
    return back("error");
  }
}
