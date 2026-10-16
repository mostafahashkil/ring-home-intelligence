/**
 * Ring webhook endpoint (register this URL in the Ring Developer Portal).
 * Order matters: verify HMAC over the raw body → parse → idempotency on meta.request_id → ingest → 200 fast.
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ingest } from "@/lib/pipeline";
import { audit } from "@/lib/repo/audit";
import { loadCredentials, markExpired, ringConfig } from "@/lib/providers/ring/auth";
import { parseRingWebhook, verifyWebhookSignature } from "@/lib/providers/ring/webhook";
import { ensureInitialized } from "@/lib/bootstrap";
import { log } from "@/lib/util/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

export async function POST(req: NextRequest) {
  const key = ringConfig().hmacKey;
  if (!key) {
    // Acknowledge so Ring doesn't retry forever, but process nothing without a way to authenticate it.
    log.warn("ring.webhook.no_signing_key");
    return NextResponse.json({ status: "ignored", reason: "webhook verification not configured" }, { status: 200 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  if (!verifyWebhookSignature(key, raw, req.headers.get("x-signature"))) {
    log.warn("ring.webhook.bad_signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = parseRingWebhook(body);
  if (!parsed) return NextResponse.json({ error: "Unrecognized payload" }, { status: 400 });

  const db = await getDb();
  const fresh = await db.run("INSERT INTO webhook_receipts (request_id, received_at) VALUES (?, ?) ON CONFLICT DO NOTHING", [
    parsed.requestId,
    Date.now(),
  ]);
  if (fresh.changes === 0) return NextResponse.json({ status: "already_processed" });

  try {
    await ensureInitialized();
    const linkedAccount = (await loadCredentials())?.accountId;
    if (parsed.kind !== "ignored" && linkedAccount && parsed.accountId && parsed.accountId !== linkedAccount) {
      log.warn("ring.webhook.account_mismatch");
      return NextResponse.json({ status: "ignored" });
    }
    if (parsed.kind === "event") {
      const r = await ingest(parsed.input);
      return NextResponse.json({ status: r.status });
    }
    if (parsed.kind === "integration") {
      await audit("ring", `integration.${parsed.type}`);
      if (parsed.type === "app_integration_removed") await markExpired();
    }
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    // Release the receipt so Ring's retry can be processed.
    await db.run("DELETE FROM webhook_receipts WHERE request_id = ?", [parsed.requestId]);
    log.error("ring.webhook.failed", { err: err as Error });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
