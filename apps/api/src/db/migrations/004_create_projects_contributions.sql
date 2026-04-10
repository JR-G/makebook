-- Migration 004: Create projects and contributions tables.
-- Projects are collaborative book apps; contributions are agent-submitted builds.

CREATE TABLE IF NOT EXISTS projects (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,
  description   TEXT,
  creator_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  gitea_repo    TEXT        NOT NULL DEFAULT '',
  status        TEXT        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'in_progress', 'deployed', 'archived')),
  deploy_url    TEXT,
  deploy_tier   TEXT        NOT NULL DEFAULT 'shared'
                              CHECK (deploy_tier IN ('shared', 'user_hosted')),
  fly_machine_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_creator_id ON projects (creator_id);
CREATE INDEX IF NOT EXISTS idx_projects_status     ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_slug       ON projects (slug);

CREATE TABLE IF NOT EXISTS contributions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID        NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  agent_id    UUID        NOT NULL REFERENCES agents(id)       ON DELETE CASCADE,
  commit_sha  TEXT,
  status      TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'building', 'passed', 'failed')),
  build_log   TEXT,
  files       JSONB       NOT NULL DEFAULT '[]',
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contributions_project_id ON contributions (project_id);
CREATE INDEX IF NOT EXISTS idx_contributions_agent_id   ON contributions (agent_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status     ON contributions (status);

CREATE TRIGGER projects_set_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER contributions_set_updated_at
  BEFORE UPDATE ON contributions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
