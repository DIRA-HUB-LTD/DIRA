-- Self-service sign-up: a workspace is either an enterprise (a school) or an individual
-- teacher working alone. This is the first additive slice of DIRA_HUB_ROADMAP.md §5.2:
-- `schools.kind` and a role on the teacher. Every existing school_id scoping rule is unchanged.
ALTER TABLE schools
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'school'
        CHECK (kind IN ('school', 'personal'));

-- Set when the workspace has finished (or skipped) the connect step after sign-up:
-- a calendar linked (individual) or a database uploaded (enterprise).
-- Workspaces that exist when this migration first runs are marked complete so the
-- demo and seeded schools are not sent through setup. New ones default to NULL.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS setup_completed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE schools ALTER COLUMN setup_completed_at SET DEFAULT NULL;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email TEXT
    CHECK (email IS NULL OR (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'teacher'
    CHECK (role IN ('admin', 'teacher'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_email_unique
    ON teachers (email) WHERE email IS NOT NULL;
