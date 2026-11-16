-- The two connect steps after sign-up.
--   enterprise: upload the school's data (DIRA_HUB_ROADMAP.md §6)
--   individual: link a calendar through the borrowed Keeper.sh MCP server (§9)

-- A learner now belongs to the school that imported them, and keeps the school's own
-- admission number. Re-importing the same sheet updates rows instead of duplicating them.
-- Both columns are nullable: the seeded development learners have neither.
ALTER TABLE learners ADD COLUMN IF NOT EXISTS school_id TEXT REFERENCES schools(school_id);
ALTER TABLE learners ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_school_external_ref
    ON learners (school_id, external_ref)
    WHERE school_id IS NOT NULL AND external_ref IS NOT NULL;

-- One row per committed upload, so an admin can see what was imported and when.
CREATE TABLE IF NOT EXISTS data_imports (
    import_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id TEXT NOT NULL REFERENCES schools(school_id),
    created_by TEXT NOT NULL,
    summary JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (created_by, school_id) REFERENCES teachers(teacher_id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_data_imports_school ON data_imports (school_id, created_at DESC);

-- A teacher's link to an external calendar MCP server. The OAuth client registration,
-- tokens and PKCE verifier are stored encrypted (AES-256-GCM, see lib/auth/secret-box.ts),
-- never in clear text and never returned to the browser.
CREATE TABLE IF NOT EXISTS calendar_connections (
    teacher_id TEXT NOT NULL,
    school_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'keeper' CHECK (provider IN ('keeper')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'revoked')),
    oauth_state_hash TEXT,
    oauth_state_expires_at TIMESTAMPTZ,
    secrets_encrypted TEXT,
    connected_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (teacher_id, provider),
    FOREIGN KEY (teacher_id, school_id) REFERENCES teachers(teacher_id, school_id)
);
