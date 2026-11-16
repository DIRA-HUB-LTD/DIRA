// Authenticated encryption for third-party credentials kept in the database
// (a teacher's calendar OAuth tokens). AES-256-GCM; the key is derived from
// DIRA_CONNECTION_SECRET, which must be at least 32 bytes. Dependency-free and pure,
// so it is unit-tested without Next.js.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = "v1";

export function connectionSecretIsUsable(secret: string | undefined): secret is string {
  return typeof secret === "string" && Buffer.byteLength(secret) >= 32;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret), Buffer.from("dira-connection-salt"), "dira-connection-secrets", 32),
  );
}

export function seal(plaintext: string, secret: string): string {
  if (!connectionSecretIsUsable(secret)) throw new Error("Connection secret must be at least 32 bytes");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) =>
    typeof part === "string" ? part : part.toString("base64url"),
  ).join(".");
}

/** Returns the plaintext, or null if the value was tampered with or the secret is wrong. */
export function open(sealed: string | null | undefined, secret: string | undefined): string | null {
  if (!sealed || !connectionSecretIsUsable(secret)) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(parts[1], "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
