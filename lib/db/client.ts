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

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Optional: cache in development for hot reloading
  if (process.env.NODE_ENV !== "production") {
    (globalThis as typeof globalThis & { diraPool?: Pool }).diraPool = pool;
  }

  return pool;
};
