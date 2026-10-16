import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log";

let cachedKey: Buffer | null = null;

/**
 * Returns the 32-byte key used to encrypt tokens at rest.
 * Production requires APP_ENCRYPTION_KEY. Development falls back to a generated key file
 * in the data directory (git-ignored) so the app works out of the box.
 */
export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.APP_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    cachedKey = key;
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_ENCRYPTION_KEY is required in production");
  }
  const dir = path.dirname(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "rhi.db"));
  const file = path.join(dir, "dev-encryption.key");
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
    log.warn("APP_ENCRYPTION_KEY not set; generated a development key file", { file: "data/dev-encryption.key" });
  }
  cachedKey = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  return cachedKey;
}

export function seal(plaintext: string, key: Buffer = getEncryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function open(sealed: string, key: Buffer = getEncryptionKey()): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
