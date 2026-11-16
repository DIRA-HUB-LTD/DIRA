-- Sign in with Microsoft or Google (OpenID Connect).
--
-- An identity is how a provider names a person (`subject`), tied to one DIRA teacher.
-- It never replaces the teacher row, so every school_id scoping rule is unchanged.
CREATE TABLE IF NOT EXISTS oauth_identities (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
    subject TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    school_id TEXT NOT NULL,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, subject),
    FOREIGN KEY (teacher_id, school_id) REFERENCES teachers(teacher_id, school_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_identities_teacher ON oauth_identities (teacher_id);

-- The organisation an enterprise workspace belongs to at its identity provider:
-- a Microsoft tenant id, or a Google Workspace domain. Staff from that same tenant may
-- sign in with Microsoft and be matched to the staff list by email. Microsoft's email
-- claim is not verified, so the tenant is what makes that match safe.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sso_provider TEXT
    CHECK (sso_provider IS NULL OR sso_provider IN ('google', 'microsoft'));
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sso_tenant TEXT;
