-- Pilot sign-in for named teachers: teacher ID + PIN.
-- This is the first slice of the identity work in DIRA_HUB_ROADMAP.md (phone OTP
-- comes later). It exists so that approvals are made by a named, signed-in person
-- rather than by the demo fallback context.
-- pin_hash format: scrypt$<salt hex>$<hash hex>
ALTER TABLE teachers
    ADD COLUMN IF NOT EXISTS pin_hash TEXT
        CHECK (pin_hash IS NULL OR pin_hash ~ '^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$');

CREATE TABLE IF NOT EXISTS teacher_sign_in_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_sign_in_attempts_recent
    ON teacher_sign_in_attempts (teacher_id, attempted_at DESC);
