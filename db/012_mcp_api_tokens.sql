-- Per-teacher MCP access tokens. A school system (or any MCP client) uses one of
-- these instead of the shared DIRA_MCP_ACCESS_TOKEN, so every tool call acts as a
-- specific teacher in a specific school and can be revoked on its own.
-- Only a SHA-256 hash of the token is stored; the plaintext is shown once at creation.
CREATE TABLE IF NOT EXISTS mcp_api_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    label TEXT NOT NULL CHECK (length(trim(label)) > 0),
    school_id TEXT NOT NULL,
    teacher_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    FOREIGN KEY (teacher_id, school_id) REFERENCES teachers(teacher_id, school_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_api_tokens_teacher
    ON mcp_api_tokens (teacher_id, school_id);
