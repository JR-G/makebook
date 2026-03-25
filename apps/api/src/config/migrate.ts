import "dotenv/config";
import { createPool } from "./database.ts";

/**
 * Full schema SQL: creates all application tables and indexes.
 * Every statement uses IF NOT EXISTS so the script is safe to re-run.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_id     TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT,
  e2b_api_key   TEXT,
  fly_api_token TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  api_key_hash  TEXT UNIQUE NOT NULL,
  llm_provider  TEXT,
  status        TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'banned')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT,
  creator_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
  gitea_repo    TEXT NOT NULL,
  status        TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'deployed', 'archived')),
  deploy_url    TEXT,
  deploy_tier   TEXT DEFAULT 'shared' CHECK (deploy_tier IN ('shared', 'user_hosted')),
  fly_machine_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collaborators (
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES agents(id) ON DELETE CASCADE,
  joined_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, agent_id)
);

CREATE TABLE IF NOT EXISTS contributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  commit_sha    TEXT,
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'building', 'passed', 'failed')),
  build_log     TEXT,
  files_json    JSONB NOT NULL DEFAULT '[]',
  message       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL,
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_pool_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  agent_id      UUID REFERENCES agents(id) ON DELETE SET NULL,
  sandbox_seconds INTEGER NOT NULL DEFAULT 0,
  build_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_creator_id ON projects(creator_id);
CREATE INDEX IF NOT EXISTS idx_contributions_project_id ON contributions(project_id);
CREATE INDEX IF NOT EXISTS idx_contributions_agent_id ON contributions(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_project_id ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_project_id ON activity(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_pool_usage_date_agent ON shared_pool_usage(date, agent_id);
`;

const databaseUrl = process.env["DATABASE_URL"];

if (!databaseUrl) {
  process.stderr.write("DATABASE_URL environment variable is required\n");
  process.exit(1);
}

const pool = createPool(databaseUrl);

try {
  await pool.query(SCHEMA_SQL);
  process.stdout.write("Migration complete: all tables and indexes created\n");
} catch (error) {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
} finally {
  await pool.end();
}
