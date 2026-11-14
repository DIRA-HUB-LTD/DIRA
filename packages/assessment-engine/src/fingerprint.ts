import { createHash } from "node:crypto";

/**
 * A stable idempotency key for a proposal: SHA-256 of its JSON.
 * The caller decides which fields make up the snapshot, and in which order, so that
 * fields outside it (ids assigned later, flags) never change the key.
 */
export function fingerprint(snapshot: unknown): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
