import { describe, expect, it } from "vitest";
import { runtimeConnectionString } from "../lib/db/client.ts";

const session = "postgresql://postgres.abc:pa%24s@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

describe("runtime connection string", () => {
  it("moves a Supabase session-pooler string to transaction mode in production, keeping the encoded password", () => {
    const result = runtimeConnectionString({ NODE_ENV: "production", DATABASE_URL: session });
    expect(result).toBe(
      "postgresql://postgres.abc:pa%24s@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    );
  });

  it("leaves everything else exactly as given", () => {
    expect(runtimeConnectionString({ NODE_ENV: "development", DATABASE_URL: session })).toBe(session);
    const local = "postgresql://u:p@localhost:5432/dira";
    expect(runtimeConnectionString({ NODE_ENV: "production", DATABASE_URL: local })).toBe(local);
    expect(runtimeConnectionString({ NODE_ENV: "production" })).toBeUndefined();
  });

  it("an explicit DATABASE_POOL_URL always wins", () => {
    expect(
      runtimeConnectionString({ NODE_ENV: "production", DATABASE_URL: session, DATABASE_POOL_URL: " x://y " }),
    ).toBe("x://y");
  });
});
