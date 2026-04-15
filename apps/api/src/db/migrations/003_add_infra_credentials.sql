-- Migration 003: Add infrastructure credential columns
-- Adds user_id FK to agents so the platform can resolve per-user API keys,
-- and adds e2b_api_key / fly_api_token to users for bring-your-own-infra support.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS e2b_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fly_api_token TEXT;
