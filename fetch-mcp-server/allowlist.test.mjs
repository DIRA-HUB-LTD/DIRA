import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_ALLOWED_DOMAINS, parseAllowedDomains } from "./server.mjs";

test("defaults to DIRA's education domains", () => {
  assert.deepEqual(parseAllowedDomains(undefined), DEFAULT_ALLOWED_DOMAINS);
  assert.deepEqual(parseAllowedDomains(""), DEFAULT_ALLOWED_DOMAINS);
});

test("accepts a configured comma-separated list and drops invalid entries", () => {
  assert.deepEqual(parseAllowedDomains(" Example.org, hbr.org ,not a domain,http://x.com"), [
    "example.org",
    "hbr.org",
  ]);
});
