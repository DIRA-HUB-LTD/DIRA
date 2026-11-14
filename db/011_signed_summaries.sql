-- Signed evidence summaries: a plain-language, fully cited summary a teacher can use to
-- open a conversation with a guardian. The agent may only create DRAFT rows.
-- Only a signed-in, named teacher can approve (or discard) a draft, and DIRA never
-- sends a note anywhere: the teacher raises it with the guardian in person.
CREATE TABLE IF NOT EXISTS signed_summaries (
    note_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learner_id TEXT NOT NULL REFERENCES learners(learner_id),
    school_id TEXT NOT NULL REFERENCES schools(school_id),
    drafted_for_teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
    status TEXT NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'APPROVED', 'DISCARDED')),
    -- [{ "text": "...", "citations": ["OBS...", "TEST-..."] }, ...]
    sentences JSONB NOT NULL CHECK (jsonb_typeof(sentences) = 'array'),
    draft_text TEXT NOT NULL CHECK (length(trim(draft_text)) > 0),
    limitations JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(limitations) = 'array'),
    evidence_ids TEXT[] NOT NULL,
    test_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    gate_snapshot JSONB NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    run_id UUID,
    submission_id TEXT NOT NULL UNIQUE,
    approved_by_teacher_id TEXT REFERENCES teachers(teacher_id),
    approved_text TEXT,
    approved_at TIMESTAMPTZ,
    discarded_by_teacher_id TEXT REFERENCES teachers(teacher_id),
    discarded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (cardinality(evidence_ids) > 0),
    CHECK (
        (status = 'DRAFT' AND approved_at IS NULL AND discarded_at IS NULL)
        OR (status = 'APPROVED' AND approved_by_teacher_id IS NOT NULL
            AND approved_text IS NOT NULL AND approved_at IS NOT NULL)
        OR (status = 'DISCARDED' AND discarded_by_teacher_id IS NOT NULL
            AND discarded_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_signed_summaries_learner
    ON signed_summaries (learner_id, created_at DESC);

-- At most one open draft per learner per teacher, so retries cannot pile up drafts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signed_summaries_one_open_draft
    ON signed_summaries (learner_id, drafted_for_teacher_id)
    WHERE status = 'DRAFT';
