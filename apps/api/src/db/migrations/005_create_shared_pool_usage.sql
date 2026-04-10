-- Migration 005: Create shared pool usage tracking table.
-- Records daily sandbox consumption per agent for rate limiting and capacity planning.

CREATE TABLE IF NOT EXISTS shared_pool_usage (
  date            DATE    NOT NULL,
  agent_id        UUID    NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sandbox_seconds INTEGER NOT NULL DEFAULT 0,
  build_count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_pool_usage_date     ON shared_pool_usage (date);
CREATE INDEX IF NOT EXISTS idx_shared_pool_usage_agent_id ON shared_pool_usage (agent_id);
