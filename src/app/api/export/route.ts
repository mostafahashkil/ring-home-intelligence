import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/core";
import { exportData } from "@/lib/privacy/data";
import { audit } from "@/lib/repo/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (!can(user.role, "data:export")) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  await audit(user.id, "data.exported");
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(await exportData(), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="home-intelligence-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
