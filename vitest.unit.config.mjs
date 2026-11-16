import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Unit and in-memory-database tests. None of these need Docker or network access.
// (vitest.config.mjs runs the older integration tests against the local Docker database.)
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.join(root, "tests", "helpers", "server-only.mjs"),
    },
  },
  test: {
    include: [
      "tests/education-retrieval.test.mjs",
      "tests/education-markdown-cache.test.mjs",
      "tests/fetch-mcp.integration.test.mjs",
      "tests/fetch-mcp-client.test.mjs",
      "tests/evidence-reasoning.test.mjs",
      "tests/models.test.mjs",
      "tests/model-cost.test.mjs",
      "tests/voice-config.test.mjs",
      "tests/internal-demo-voice-route.test.mjs",
      "tests/public-demo-voice.test.mjs",
      "tests/demo-call-route.test.mjs",
      "tests/seed-staging-import.test.mjs",
      "tests/suggest-test.test.mjs",
      "tests/suggest-test-graph.test.mjs",
      // Added for the Long View readiness work.
      "tests/migrations.test.mjs",
      "tests/learner-visibility.test.mjs",
      "tests/focus-rotation.test.mjs",
      "tests/model-provider.test.mjs",
      "tests/teacher-session.test.mjs",
      "tests/sign-up.test.mjs",
      "tests/school-import.test.mjs",
      "tests/calendar-connection.test.mjs",
      "tests/sso-sign-in.test.mjs",
      "tests/demo-access.test.mjs",
      "tests/queue-from-timetable.test.mjs",
      "tests/mcp-access.test.mjs",
      "tests/mcp-tools-inventory.test.mjs",
      "tests/signed-summary.test.mjs",
      "tests/profile-update-agent.test.mjs",
      "tests/profile-agent-integration.test.mjs",
      "tests/run-summary.test.mjs",
      "tests/education-sources.test.mjs",
      "tests/engine-characterization.test.mjs",
      "packages/assessment-engine/tests/engine.test.mjs",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
