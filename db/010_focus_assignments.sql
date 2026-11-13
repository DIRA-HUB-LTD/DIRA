-- Fortnightly focus list: each teacher gets up to 10 learners from their own
-- classes for a 14-day period. The list is stored so it stays stable for the
-- whole period (observing a learner ticks them off; it does not reshuffle the list).
CREATE TABLE IF NOT EXISTS focus_assignments (
    teacher_id TEXT NOT NULL REFERENCES teachers(teacher_id),
    school_id TEXT NOT NULL REFERENCES schools(school_id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    learner_id TEXT NOT NULL REFERENCES learners(learner_id),
    priority_rank SMALLINT NOT NULL CHECK (priority_rank BETWEEN 1 AND 10),
    reason TEXT NOT NULL CHECK (
        reason IN (
            'no_observation_this_year',
            'not_observed_by_this_teacher',
            'least_recently_observed'
        )
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (teacher_id, period_start, learner_id),
    UNIQUE (teacher_id, period_start, priority_rank),
    CHECK (period_end = period_start + 13)
);

CREATE INDEX IF NOT EXISTS idx_focus_assignments_school_period
    ON focus_assignments (school_id, period_start);
