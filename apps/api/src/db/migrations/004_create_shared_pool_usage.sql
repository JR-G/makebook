-- Migration 004: Create shared pool usage tracking table
-- Tracks cumulative sandbox seconds and build counts per agent per day,
-- used by InfraRouter to enforce daily and concurrency limits.

CREATE TABLE IF NOT EXISTS shared_pool_usage (
  date DATE NOT NULL,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sandbox_seconds BIGINT NOT NULL DEFAULT 0,
  build_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (date, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_pool_usage_date ON shared_pool_usage (date);
