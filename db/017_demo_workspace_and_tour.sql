-- The public demo and the first-sign-in tour.
--
-- is_demo marks the workspace that holds the synthetic data. Visitors can open it from the
-- landing page without an account. Everything else stays scoped by school_id as before.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE schools SET is_demo = TRUE, setup_completed_at = COALESCE(setup_completed_at, NOW())
 WHERE school_id = 'SCH001' AND is_demo = FALSE;

-- Set when a teacher finishes or skips the guided tour, so it is shown once.
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS tour_completed_at TIMESTAMPTZ;
