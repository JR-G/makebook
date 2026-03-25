import { randomBytes } from "crypto";
import type { Pool } from "pg";
import type {
  Project,
  ProjectWithCollaborators,
  CreateProjectInput,
  PaginatedResponse,
  AgentPublic,
  ProjectStatus,
} from "@makebook/types";
import type { GiteaService } from "./gitea.ts";

/** Valid project status values for runtime validation. */
const VALID_STATUSES: readonly ProjectStatus[] = [
  "open",
  "in_progress",
  "completed",
  "archived",
];

/** Maximum slug length in characters. */
const MAX_SLUG_LENGTH = 60;

/** Row shape returned by the projects table. */
interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  creator_id: string;
  gitea_repo: string;
  status: string;
  deploy_tier: string;
  created_at: Date;
  updated_at: Date;
}

/** Row shape from the agents table (public fields only). */
interface AgentRow {
  id: string;
  name: string;
  created_at: Date;
}

/** Row shape for build count and latest build queries. */
interface BuildStatsRow {
  build_count: string;
}

/** Row shape for the latest non-pending contribution. */
interface LatestBuildRow {
  id: string;
  status: string;
  created_at: Date;
}

/** Row shape for the total count query. */
interface CountRow {
  count: string;
}

/**
 * Creates an HTTP error with an attached status code for the global error handler.
 * @param message - Human-readable error message.
 * @param statusCode - HTTP status code.
 */
function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode }) as Error & { statusCode: number };
}

/**
 * Converts a raw project name into a URL-safe slug.
 * Lowercases, replaces non-alphanumeric characters with hyphens,
 * collapses consecutive hyphens, and strips leading/trailing hyphens.
 * @param name - Raw project name.
 * @returns A slug of at most 60 characters.
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

/**
 * Maps a database row to a typed Project object.
 * @param row - Raw row from the projects table.
 * @returns A Project with camelCase property names and ISO 8601 timestamps.
 */
function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    creatorId: row.creator_id,
    giteaRepo: row.gitea_repo,
    status: row.status as ProjectStatus,
    deployTier: row.deploy_tier as "shared" | "dedicated",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Maps a database row to a typed AgentPublic object.
 * @param row - Raw row from the agents table.
 * @returns An AgentPublic with camelCase property names.
 */
function rowToAgentPublic(row: AgentRow): AgentPublic {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  };
}

/** SQL to select all project fields. */
const SELECT_PROJECT = "SELECT * FROM projects";

/** SQL to select public agent fields. */
const SELECT_AGENT_PUBLIC = "SELECT id, name, created_at FROM agents";

/**
 * Manages the full lifecycle of projects: creation, retrieval, listing,
 * collaboration, and status transitions.
 */
export class ProjectService {
  constructor(
    private readonly pool: Pool,
    private readonly gitea: GiteaService,
  ) {}

  /**
   * Creates a new project and its corresponding Gitea repository.
   * The creator is automatically added as the first collaborator.
   * If the generated slug already exists, a 4-character hex suffix is appended.
   * @param agentId - ID of the agent creating the project.
   * @param input - Project name and optional description.
   * @returns The newly created project.
   * @throws 400 if the name is empty.
   */
  async create(agentId: string, input: CreateProjectInput): Promise<Project> {
    if (!input.name.trim()) {
      throw httpError("Project name cannot be empty", 400);
    }

    const baseSlug = generateSlug(input.name);

    if (!baseSlug) {
      throw httpError("Project name must contain at least one alphanumeric character", 400);
    }

    let slug = baseSlug;
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id FROM projects WHERE slug = $1",
      [slug],
    );

    if (existing.rows.length > 0) {
      const suffix = randomBytes(2).toString("hex");
      slug = `${baseSlug.slice(0, MAX_SLUG_LENGTH - 5)}-${suffix}`;
    }

    const { cloneUrl } = await this.gitea.createRepo(slug, input.description);

    const result = await this.pool.query<ProjectRow>(
      `INSERT INTO projects (name, slug, description, creator_id, gitea_repo, status, deploy_tier)
       VALUES ($1, $2, $3, $4, $5, 'open', 'shared')
       RETURNING *`,
      [input.name, slug, input.description ?? null, agentId, cloneUrl],
    );

    const row = result.rows[0];
    if (!row) {
      throw httpError("Failed to create project", 500);
    }

    const project = rowToProject(row);

    await this.pool.query(
      "INSERT INTO collaborators (project_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [project.id, agentId],
    );

    return project;
  }

  /**
   * Retrieves a project by its UUID.
   * @param id - Project UUID.
   * @returns The project, or null if not found.
   */
  async getById(id: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `${SELECT_PROJECT} WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? rowToProject(row) : null;
  }

  /**
   * Retrieves a project by its URL slug.
   * @param slug - Project slug.
   * @returns The project, or null if not found.
   */
  async getBySlug(slug: string): Promise<Project | null> {
    const result = await this.pool.query<ProjectRow>(
      `${SELECT_PROJECT} WHERE slug = $1`,
      [slug],
    );
    const row = result.rows[0];
    return row ? rowToProject(row) : null;
  }

  /**
   * Retrieves a project with its full collaborator list and build statistics.
   * @param id - Project UUID.
   * @returns The enriched project, or null if not found.
   */
  async getWithCollaborators(id: string): Promise<ProjectWithCollaborators | null> {
    const projectResult = await this.pool.query<ProjectRow>(
      `${SELECT_PROJECT} WHERE id = $1`,
      [id],
    );
    const row = projectResult.rows[0];
    if (!row) {
      return null;
    }
    const project = rowToProject(row);

    const collabResult = await this.pool.query<AgentRow>(
      `${SELECT_AGENT_PUBLIC}
       JOIN collaborators c ON c.agent_id = agents.id
       WHERE c.project_id = $1`,
      [id],
    );
    const collaborators = collabResult.rows.map(rowToAgentPublic);

    const countResult = await this.pool.query<BuildStatsRow>(
      "SELECT COUNT(*)::int AS build_count FROM contributions WHERE project_id = $1",
      [id],
    );
    const countRow = countResult.rows[0];
    const buildCount = countRow ? parseInt(countRow.build_count, 10) : 0;

    const latestResult = await this.pool.query<LatestBuildRow>(
      `SELECT id, status, created_at
       FROM contributions
       WHERE project_id = $1 AND status != 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [id],
    );
    const latestRow = latestResult.rows[0];
    const latestBuild = latestRow
      ? {
          id: latestRow.id,
          status: latestRow.status,
          createdAt: latestRow.created_at.toISOString(),
        }
      : null;

    return { ...project, collaborators, buildCount, latestBuild };
  }

  /**
   * Lists projects with optional filtering and pagination.
   * @param options - Pagination and filter options.
   * @returns A paginated list of projects ordered by creation date descending.
   */
  async list(options?: {
    page?: number;
    pageSize?: number;
    status?: string;
  }): Promise<PaginatedResponse<Project>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const params: (string | number)[] = [pageSize, offset];
    let whereClause = "";

    if (options?.status) {
      whereClause = "WHERE status = $3";
      params.push(options.status);
    }

    const [rowsResult, countResult] = await Promise.all([
      this.pool.query<ProjectRow>(
        `${SELECT_PROJECT} ${whereClause} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        params,
      ),
      this.pool.query<CountRow>(
        `SELECT COUNT(*) AS count FROM projects ${whereClause}`,
        options?.status ? [options.status] : [],
      ),
    ]);

    const countRow = countResult.rows[0];
    const total = countRow ? parseInt(countRow.count, 10) : 0;

    return {
      items: rowsResult.rows.map(rowToProject),
      total,
      page,
      pageSize,
    };
  }

  /**
   * Adds an agent as a collaborator on a project.
   * No-ops silently if the agent is already a collaborator.
   * @param projectId - Target project UUID.
   * @param agentId - Agent to add.
   * @throws 404 if the project does not exist.
   * @throws 400 if the project is archived.
   */
  async join(projectId: string, agentId: string): Promise<void> {
    const result = await this.pool.query<{ status: string }>(
      "SELECT status FROM projects WHERE id = $1",
      [projectId],
    );
    const row = result.rows[0];

    if (!row) {
      throw httpError("Project not found", 404);
    }

    if (row.status === "archived") {
      throw httpError("Cannot join an archived project", 400);
    }

    await this.pool.query(
      "INSERT INTO collaborators (project_id, agent_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [projectId, agentId],
    );
  }

  /**
   * Removes an agent from a project's collaborators.
   * @param projectId - Target project UUID.
   * @param agentId - Agent to remove.
   * @throws 400 if the agent is the project creator.
   */
  async leave(projectId: string, agentId: string): Promise<void> {
    const result = await this.pool.query<{ creator_id: string }>(
      "SELECT creator_id FROM projects WHERE id = $1",
      [projectId],
    );
    const row = result.rows[0];

    if (!row) {
      throw httpError("Project not found", 404);
    }

    if (row.creator_id === agentId) {
      throw httpError("Project creator cannot leave their own project", 400);
    }

    await this.pool.query(
      "DELETE FROM collaborators WHERE project_id = $1 AND agent_id = $2",
      [projectId, agentId],
    );
  }

  /**
   * Updates the lifecycle status of a project.
   * @param id - Project UUID.
   * @param status - New status value.
   * @returns The updated project.
   * @throws 400 if the status value is not a valid ProjectStatus.
   * @throws 404 if the project does not exist.
   */
  async updateStatus(id: string, status: string): Promise<Project> {
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      throw httpError(`Invalid status: ${status}`, 400);
    }

    const result = await this.pool.query<ProjectRow>(
      "UPDATE projects SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [status, id],
    );
    const row = result.rows[0];

    if (!row) {
      throw httpError("Project not found", 404);
    }

    return rowToProject(row);
  }

  /**
   * Lists all projects an agent has joined as a collaborator.
   * @param agentId - Agent UUID.
   * @returns Projects the agent is a collaborator on.
   */
  async listByAgent(agentId: string): Promise<Project[]> {
    const result = await this.pool.query<ProjectRow>(
      `${SELECT_PROJECT}
       JOIN collaborators c ON c.project_id = projects.id
       WHERE c.agent_id = $1
       ORDER BY projects.created_at DESC`,
      [agentId],
    );
    return result.rows.map(rowToProject);
  }

  /**
   * Lists all collaborators on a project.
   * @param projectId - Project UUID.
   * @returns Public agent profiles of all collaborators.
   */
  async getCollaborators(projectId: string): Promise<AgentPublic[]> {
    const result = await this.pool.query<AgentRow>(
      `${SELECT_AGENT_PUBLIC}
       JOIN collaborators c ON c.agent_id = agents.id
       WHERE c.project_id = $1
       ORDER BY c.joined_at ASC`,
      [projectId],
    );
    return result.rows.map(rowToAgentPublic);
  }
}
