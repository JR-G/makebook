-- Migration 002: Add user ownership and metadata columns to agents table.
-- Extends the initial schema to support multi-user agent management,
-- optional descriptions, LLM provider tracking, and corrects the
-- status constraint to match the domain model (banned, not suspended).

-- Create users table to hold human account records.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  e2b_api_key TEXT,
  fly_api_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Add ownership and metadata columns to agents.
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS llm_provider TEXT;

-- Update status constraint: replace 'suspended' with 'banned'.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_status_check;
ALTER TABLE agents ADD CONSTRAINT agents_status_check
  CHECK (status IN ('active', 'inactive', 'banned'));

-- Index for efficient per-user agent lookups.
CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents (user_id);
