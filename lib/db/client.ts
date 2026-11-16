// lib/db/client.ts
import { Pool } from "pg";

// DON'T initialize anything at the top level
let pool: Pool | null = null;

// Export a function that creates/gets the pool only when called
export const getPool = (): Pool => {
  // Test-only seam for the eval harness and in-memory database tests. Ignored
  // outside NODE_ENV=test (Vitest sets it), so it cannot affect dev or production.
  if (process.env.NODE_ENV === "test") {
    const testPool = (globalThis as typeof globalThis & { __diraTestPool?: Pool }).__diraTestPool;
    if (testPool) return testPool;
  }

  if (pool) return pool;

  // DATABASE_POOL_URL, when set, is what the running app uses (a transaction-mode
  // pooler such as Supabase's port 6543, which shares few server connections among
  // many serverless instances). DATABASE_URL stays the direct/session string that
  // migrations and scripts need. Nothing here uses session state, so both work.
  const connectionString = process.env.DATABASE_POOL_URL?.trim() || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  const configuredMax = Number(process.env.DIRA_DB_POOL_MAX);
  const production = process.env.NODE_ENV === "production";
  pool = new Pool({
    connectionString,
    // Each serverless instance keeps few connections; a session pooler allows ~15 in total.
    max: Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : production ? 3 : 10,
    idleTimeoutMillis: production ? 10_000 : 30_000,
    connectionTimeoutMillis: 8_000,
  });

  // Optional: cache in development for hot reloading
  if (process.env.NODE_ENV !== "production") {
    (globalThis as typeof globalThis & { diraPool?: Pool }).diraPool = pool;
  }

  return pool;
};
