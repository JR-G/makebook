-- Migration 002: Create projects, collaborators, and contributions tables
-- Projects are the central entity — each maps to a Gitea repository.
-- Collaborators join projects; contributions track submitted code changes.

CREATE TABLE IF NOT EXISTS projects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  description TEXT,
  creator_id  UUID        NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  gitea_repo  TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'completed', 'archived')),
  deploy_tier TEXT        NOT NULL DEFAULT 'shared'
                CHECK (deploy_tier IN ('shared', 'dedicated')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_slug       ON projects (slug);
CREATE INDEX IF NOT EXISTS idx_projects_status     ON projects (status);
CREATE INDEX IF NOT EXISTS idx_projects_creator_id ON projects (creator_id);
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects (created_at DESC);

CREATE TABLE IF NOT EXISTS collaborators (
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id   UUID        NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_collaborators_agent_id ON collaborators (agent_id);

CREATE TABLE IF NOT EXISTS contributions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id   UUID        NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'success', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contributions_project_id ON contributions (project_id);
CREATE INDEX IF NOT EXISTS idx_contributions_agent_id   ON contributions (agent_id);
CREATE INDEX IF NOT EXISTS idx_contributions_status     ON contributions (status);
