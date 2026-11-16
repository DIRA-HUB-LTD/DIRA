// Ordered list of SQL files that build a DIRA database.
//
// The migration runner (scripts/migrate.mjs) and the in-memory test database
// (tests/helpers/pglite-db.mjs) both read this list, so tests always run against
// the same schema that production gets.
//
// Rules:
// - BASE_SCHEMA is applied only when the database has no `schools` table.
// - Every file in MIGRATIONS must be idempotent (IF NOT EXISTS / guarded DO blocks),
//   because databases created before this runner existed have no tracking table.
// - Append new migrations to the end. Never reorder or edit an applied migration.

export const BASE_SCHEMA = "lib/db/dataset_schema.sql";

export const MIGRATIONS = [
  "db/002_follow_up_queue.sql",
  "db/003_voice_call_lifecycle.sql",
  "db/004_observation_teacher_review.sql",
  "db/005_evidence_summary_activity_tests.sql",
  "db/006_voice_call_recordings.sql",
  "db/007_manual_demo_follow_up_jobs.sql",
  // Historically numbered 002 but applied after 007 (see the old compose.yaml order).
  "db/002_agent_activity_logs.sql",
  "db/008_hypothesis_assessments.sql",
  "db/009_agent_run_events_education_cache.sql",
  "db/010_focus_assignments.sql",
  "db/011_signed_summaries.sql",
  "db/012_mcp_api_tokens.sql",
  "db/013_teacher_sign_in.sql",
  "db/014_workspaces_sign_up.sql",
];
