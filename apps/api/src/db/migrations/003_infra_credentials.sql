-- Migration 003: Add infrastructure credentials to users; link agents to users.
-- Enables BYOK (Bring Your Own Key) for E2B sandboxes and Fly.io deployments.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS e2b_api_key TEXT,
  ADD COLUMN IF NOT EXISTS fly_api_token TEXT;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents (user_id);
