import type { Pool } from "pg";
import { generateApiKey } from "@makebook/auth";
import type {
  Agent,
  AgentPublic,
  AgentStatus,
  RegisterAgentInput,
  PaginatedResponse,
} from "@makebook/types";

/** SQL to insert a new agent row. */
const INSERT_AGENT_SQL = `
  INSERT INTO agents (user_id, name, description, api_key_hash, llm_provider, status)
  VALUES ($1, $2, $3, $4, $5, 'active')
  RETURNING id, user_id, name, description, api_key_hash, llm_provider, status, created_at, updated_at
`;

/** SQL to look up an agent by primary key. */
const SELECT_AGENT_BY_ID_SQL = `
  SELECT id, user_id, name, description, api_key_hash, llm_provider, status, created_at, updated_at
  FROM agents WHERE id = $1
`;

/** SQL to list agents with optional status filter. */
const LIST_AGENTS_SQL = `
  SELECT id, user_id, name, description, api_key_hash, llm_provider, status, created_at, updated_at
  FROM agents
  WHERE ($1::text IS NULL OR status = $1)
  ORDER BY created_at DESC
  LIMIT $2 OFFSET $3
`;

/** SQL to count agents with optional status filter. */
const COUNT_AGENTS_SQL = `
  SELECT COUNT(*)::int AS total FROM agents
  WHERE ($1::text IS NULL OR status = $1)
`;

/** SQL to update agent status. */
const UPDATE_STATUS_SQL = `
  UPDATE agents SET status = $1, updated_at = NOW()
  WHERE id = $2
  RETURNING id, user_id, name, description, api_key_hash, llm_provider, status, created_at, updated_at
`;

/** SQL to rotate an agent's API key hash. */
const ROTATE_KEY_SQL = `
  UPDATE agents SET api_key_hash = $1, updated_at = NOW()
  WHERE id = $2 AND user_id = $3
  RETURNING id, user_id, name, description, api_key_hash, llm_provider, status, created_at, updated_at
`;

/** SQL to list all agents belonging to a user. */
const LIST_AGENTS_BY_USER_SQL = `
  SELECT id, user_id, name, description, api_key_hash, llm_provider, status, created_at, updated_at
  FROM agents WHERE user_id = $1
  ORDER BY created_at DESC
`;

/** SQL to update user credentials. */
const UPDATE_USER_CREDENTIALS_SQL = `
  UPDATE users
  SET
    e2b_api_key   = COALESCE($2, e2b_api_key),
    fly_api_token = COALESCE($3, fly_api_token),
    updated_at    = NOW()
  WHERE id = $1
`;

/** SQL to check agent ownership (used for 403 vs 404 distinction). */
const SELECT_AGENT_EXISTS_SQL = `SELECT id FROM agents WHERE id = $1`;

/** Pattern that valid agent names must match. */
const VALID_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** Maximum allowed length for an agent name. */
const MAX_NAME_LENGTH = 50;

/** Valid agent status values. */
const VALID_STATUSES: readonly AgentStatus[] = ["active", "inactive", "banned"];

/** Raw database row shape returned from agent queries. */
interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  api_key_hash: string;
  llm_provider: string | null;
  status: AgentStatus;
  created_at: Date;
  updated_at: Date;
}

/**
 * Maps a raw database row to the internal Agent domain model.
 * @param row - Raw row from the agents table.
 * @returns Typed Agent object.
 */
function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    apiKeyHash: row.api_key_hash,
    llmProvider: row.llm_provider,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Strips sensitive fields to produce a public-safe agent view.
 * @param agent - Full internal Agent object.
 * @returns AgentPublic with apiKeyHash and userId removed.
 */
export function toPublic(agent: Agent): AgentPublic {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    llmProvider: agent.llmProvider,
    status: agent.status,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

/**
 * Validates an agent name against platform rules.
 * @param name - The candidate name string.
 * @throws 400 error if the name is empty, too long, or contains invalid characters.
 */
function validateAgentName(name: string): void {
  if (!name || name.length === 0) {
    const error = new Error("Agent name is required") as Error & {
      statusCode: number;
    };
    error.statusCode = 400;
    throw error;
  }

  if (name.length > MAX_NAME_LENGTH) {
    const error = new Error(
      `Agent name must be ${MAX_NAME_LENGTH} characters or fewer`,
    ) as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }

  if (!VALID_NAME_PATTERN.test(name)) {
    const error = new Error(
      "Agent name may only contain letters, digits, hyphens, and underscores",
    ) as Error & { statusCode: number };
    error.statusCode = 400;
    throw error;
  }
}

/**
 * Agent lifecycle management service.
 * Handles registration, profile retrieval, status updates,
 * API key rotation, and per-user listings.
 */
export class AgentService {
  constructor(private readonly pool: Pool) {}

  /**
   * Registers a new agent for the given user.
   * Generates and returns the plain API key exactly once — it is never stored.
   * Optionally persists e2bApiKey and flyApiToken onto the user's account.
   *
   * @param userId - UUID of the registering user.
   * @param input - Validated registration input.
   * @returns The public agent view and the single-use plain API key.
   * @throws 400 if the name is invalid.
   * @throws 409 if the user already has an agent with this name.
   */
  async register(
    userId: string,
    input: RegisterAgentInput,
  ): Promise<{ agent: AgentPublic; apiKey: string }> {
    validateAgentName(input.name);

    const { key, hash } = generateApiKey();

    let agentRow: AgentRow;
    try {
      const result = await this.pool.query<AgentRow>(INSERT_AGENT_SQL, [
        userId,
        input.name,
        input.description ?? null,
        hash,
        input.llmProvider ?? null,
      ]);
      const insertedRow = result.rows[0];
      if (insertedRow === undefined) {
        throw new Error("INSERT returned no rows");
      }
      agentRow = insertedRow;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "23505"
      ) {
        const conflict = new Error(
          "An agent with this name already exists for this user",
        ) as Error & { statusCode: number };
        conflict.statusCode = 409;
        throw conflict;
      }
      throw error;
    }

    if (input.e2bApiKey !== undefined || input.flyApiToken !== undefined) {
      await this.pool.query(UPDATE_USER_CREDENTIALS_SQL, [
        userId,
        input.e2bApiKey ?? null,
        input.flyApiToken ?? null,
      ]);
    }

    return { agent: toPublic(rowToAgent(agentRow)), apiKey: key };
  }

  /**
   * Retrieves the full internal agent record by ID.
   * @param id - Agent UUID.
   * @returns The Agent, or null if not found.
   */
  async getById(id: string): Promise<Agent | null> {
    const result = await this.pool.query<AgentRow>(SELECT_AGENT_BY_ID_SQL, [
      id,
    ]);

    const row = result.rows[0];
    if (row === undefined) {
      return null;
    }

    return rowToAgent(row);
  }

  /**
   * Retrieves the public-safe agent view by ID.
   * @param id - Agent UUID.
   * @returns AgentPublic, or null if not found.
   */
  async getPublicById(id: string): Promise<AgentPublic | null> {
    const agent = await this.getById(id);

    if (agent === null) {
      return null;
    }

    return toPublic(agent);
  }

  /**
   * Returns a paginated list of public agent views.
   * @param options - Pagination and filter options: page (default 1), pageSize (default 20), status filter.
   * @returns Paginated response containing AgentPublic items.
   */
  async list(options?: {
    page?: number;
    pageSize?: number;
    status?: string;
  }): Promise<PaginatedResponse<AgentPublic>> {
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 20;
    const status = options?.status ?? null;
    const offset = (page - 1) * pageSize;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<AgentRow>(LIST_AGENTS_SQL, [status, pageSize, offset]),
      this.pool.query<{ total: number }>(COUNT_AGENTS_SQL, [status]),
    ]);

    const total = countResult.rows[0]?.total ?? 0;
    const items = listResult.rows.map((row) => toPublic(rowToAgent(row)));

    return { items, total, page, pageSize };
  }

  /**
   * Updates the lifecycle status of an agent.
   * @param id - Agent UUID.
   * @param status - New status value.
   * @returns The updated full Agent record.
   * @throws 400 if status is not a valid AgentStatus value.
   * @throws 404 if the agent does not exist.
   */
  async updateStatus(id: string, status: AgentStatus): Promise<Agent> {
    if (!VALID_STATUSES.includes(status)) {
      const error = new Error(
        `Status must be one of: ${VALID_STATUSES.join(", ")}`,
      ) as Error & { statusCode: number };
      error.statusCode = 400;
      throw error;
    }

    const result = await this.pool.query<AgentRow>(UPDATE_STATUS_SQL, [
      status,
      id,
    ]);

    const updatedRow = result.rows[0];
    if (updatedRow === undefined) {
      const error = new Error("Agent not found") as Error & {
        statusCode: number;
      };
      error.statusCode = 404;
      throw error;
    }

    return rowToAgent(updatedRow);
  }

  /**
   * Generates and stores a new API key for an agent owned by the given user.
   * The old key is immediately invalidated.
   *
   * @param agentId - Agent UUID.
   * @param userId - UUID of the requesting user — must match the agent's owner.
   * @returns The new plain API key (only time it is returned).
   * @throws 404 if the agent does not exist.
   * @throws 403 if the agent exists but belongs to a different user.
   */
  async rotateApiKey(
    agentId: string,
    userId: string,
  ): Promise<{ apiKey: string }> {
    const { key, hash } = generateApiKey();

    const result = await this.pool.query<AgentRow>(ROTATE_KEY_SQL, [
      hash,
      agentId,
      userId,
    ]);

    if (result.rows.length > 0) {
      return { apiKey: key };
    }

    const existsResult = await this.pool.query<{ id: string }>(
      SELECT_AGENT_EXISTS_SQL,
      [agentId],
    );

    if (existsResult.rows.length === 0) {
      const notFoundError = new Error("Agent not found") as Error & {
        statusCode: number;
      };
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    const forbiddenError = new Error(
      "You do not have permission to rotate this agent's key",
    ) as Error & { statusCode: number };
    forbiddenError.statusCode = 403;
    throw forbiddenError;
  }

  /**
   * Returns all agents registered by a specific user.
   * @param userId - The owning user's UUID.
   * @returns Array of AgentPublic views, ordered by creation date descending.
   */
  async getByUserId(userId: string): Promise<AgentPublic[]> {
    const result = await this.pool.query<AgentRow>(LIST_AGENTS_BY_USER_SQL, [
      userId,
    ]);

    return result.rows.map((row) => toPublic(rowToAgent(row)));
  }
}
