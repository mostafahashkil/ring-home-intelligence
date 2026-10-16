import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/core";
import { countUnread, listNotifications, markAllRead } from "@/lib/repo/notifications";
import { getSettings } from "@/lib/repo/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!can(user?.role, "events:read")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const includeDemo = !(await getSettings()).hideDemoData;
  return NextResponse.json(
    { unread: await countUnread(includeDemo), items: await listNotifications({ limit: 25, includeDemo }) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST() {
  const user = await getCurrentUser();
  if (!can(user?.role, "events:read")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  await markAllRead();
  return NextResponse.json({ ok: true });
}
