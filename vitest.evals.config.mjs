import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Evals (see evals/run-evals.test.mjs):
//   npm run eval            -> --mode live: real model from .env.local, 5 repeats
//   npm run eval:scripted   -> harness self-check, no model, not evidence
export default defineConfig(({ mode }) => {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(root, file));
    } catch {
      // optional
    }
  }
  return {
    resolve: {
      alias: {
        "@": root,
        "server-only": path.join(root, "tests", "helpers", "server-only.mjs"),
      },
    },
    test: {
      include: ["evals/run-evals.test.mjs"],
      fileParallelism: false,
      testTimeout: 600_000,
      hookTimeout: 120_000,
      env: { EVAL_MODE: mode === "live" ? "live" : "scripted" },
    },
  };
});
