import { randomBytes } from "node:crypto";

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.VITEST = "1";
for (const k of [
  "RING_CLIENT_ID",
  "RING_CLIENT_SECRET",
  "RING_HMAC_SIGNING_KEY",
  "RING_OAUTH_REDIRECT_URI",
  "RING_ACCESS_TOKEN",
  "RING_REFRESH_TOKEN",
]) {
  delete process.env[k];
}
