import type { Pool } from "pg";
import type { InfraDecision, SharedPoolStatus } from "@makebook/types";

/** Configuration for shared infrastructure pool capacity limits. */
export interface InfraConfig {
  /** Maximum sandbox-hours the shared pool may consume per calendar day. */
  sharedPoolMaxSandboxHours: number;
  /** Maximum number of sandboxes that may run concurrently on the shared pool. */
  sharedPoolMaxConcurrent: number;
  /** Maximum number of apps deployed on the shared pool at any one time. */
  sharedPoolMaxDeployed: number;
  /** Maximum number of builds a single agent may submit per calendar day. */
  sharedPoolMaxBuildsPerAgent: number;
}

interface UserInfraRow {
  e2b_api_key: string | null;
  fly_api_token: string | null;
}

interface PoolUsageRow {
  /** Postgres returns SUM(integer) as NUMERIC, represented as a string by pg. */
  total_seconds: string;
  agent_build_count: string;
}

interface ContributionStatusRow {
  /** Postgres returns COUNT(*) as BIGINT, represented as a string by pg. */
  active_count: string;
  pending_count: string;
}

interface DeployedCountRow {
  /** Postgres returns COUNT(*) as BIGINT, represented as a string by pg. */
  deployed_count: string;
}

interface PoolStatusRow {
  /** Postgres returns SUM/COUNT aggregate results as strings via pg. */
  total_seconds: string;
  active_sandboxes: string;
  deployed_apps: string;
}

/**
 * Routes build and deploy requests to the correct infrastructure tier.
 *
 * Priority order for every decision:
 * 1. User-hosted — the agent's owner has supplied their own credentials
 * 2. Shared pool — platform infrastructure within configured daily limits
 * 3. Queued — shared pool is at capacity; the request must wait
 */
export class InfraRouter {
  constructor(
    private readonly pool: Pool,
    private readonly config: InfraConfig,
  ) {}

  /**
   * Determines which infrastructure tier should handle a build for the given agent.
   *
   * Decision order:
   * 1. User-hosted: agent owner has an E2B API key → use their key
   * 2. Per-agent daily cap: agent exhausted today's build quota → queued at position -1
   * 3. Pool daily hours cap: shared hours exhausted → queued at position 0
   * 4. Concurrency cap: max concurrent sandboxes active → queued at position = pending count
   * 5. All checks pass → shared pool
   *
   * @param agentId - UUID of the agent requesting a build
   */
  async decideBuildInfra(agentId: string): Promise<InfraDecision> {
    const userResult = await this.pool.query<UserInfraRow>(
      `SELECT u.e2b_api_key, u.fly_api_token
       FROM agents a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [agentId],
    );

    const user = userResult.rows[0];

    if (user?.e2b_api_key) {
      return { type: "user_hosted", e2bKey: user.e2b_api_key };
    }

    const usageResult = await this.pool.query<PoolUsageRow>(
      `SELECT
         COALESCE(SUM(sandbox_seconds), 0)                                              AS total_seconds,
         COALESCE(SUM(CASE WHEN agent_id = $1 THEN build_count ELSE 0 END), 0)         AS agent_build_count
       FROM shared_pool_usage
       WHERE date = CURRENT_DATE`,
      [agentId],
    );

    const usage = usageResult.rows[0];
    const agentBuildCount = Number(usage?.agent_build_count ?? 0);
    const totalSeconds = Number(usage?.total_seconds ?? 0);

    if (agentBuildCount >= this.config.sharedPoolMaxBuildsPerAgent) {
      return { type: "queued", position: -1 };
    }

    if (totalSeconds >= this.config.sharedPoolMaxSandboxHours * 3600) {
      return { type: "queued", position: 0 };
    }

    const contributionResult = await this.pool.query<ContributionStatusRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'building') AS active_count,
         COUNT(*) FILTER (WHERE status = 'pending')  AS pending_count
       FROM contributions
       WHERE updated_at >= NOW() - INTERVAL '2 hours'`,
    );

    const contribution = contributionResult.rows[0];
    const activeCount = Number(contribution?.active_count ?? 0);
    const pendingCount = Number(contribution?.pending_count ?? 0);

    if (activeCount >= this.config.sharedPoolMaxConcurrent) {
      return { type: "queued", position: pendingCount };
    }

    return { type: "shared" };
  }

  /**
   * Determines which infrastructure tier should handle a deployment for the given agent.
   *
   * Decision order:
   * 1. User-hosted: agent owner has a Fly.io token → use their token
   * 2. Deploy cap: shared pool at max deployed apps → queued at position 0
   * 3. All checks pass → shared pool
   *
   * @param agentId - UUID of the agent requesting a deployment
   */
  async decideDeployInfra(agentId: string): Promise<InfraDecision> {
    const userResult = await this.pool.query<UserInfraRow>(
      `SELECT u.e2b_api_key, u.fly_api_token
       FROM agents a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [agentId],
    );

    const user = userResult.rows[0];

    if (user?.fly_api_token) {
      return { type: "user_hosted", flyToken: user.fly_api_token };
    }

    const deployedResult = await this.pool.query<DeployedCountRow>(
      `SELECT COUNT(*) AS deployed_count
       FROM projects
       WHERE deploy_url IS NOT NULL AND status = 'deployed' AND deploy_tier = 'shared'`,
    );

    const deployedCount = Number(deployedResult.rows[0]?.deployed_count ?? 0);

    if (deployedCount >= this.config.sharedPoolMaxDeployed) {
      return { type: "queued", position: 0 };
    }

    return { type: "shared" };
  }

  /**
   * Records sandbox usage for the given agent on the current calendar day.
   *
   * Uses an atomic UPSERT — concurrent calls for the same agent are serialised
   * by Postgres row-level locking on the composite (date, agent_id) primary key,
   * preventing double-counting under concurrent load.
   *
   * @param agentId - UUID of the agent whose sandbox was consumed
   * @param sandboxSeconds - Duration the sandbox ran, in seconds
   */
  async recordUsage(agentId: string, sandboxSeconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO shared_pool_usage (date, agent_id, sandbox_seconds, build_count)
       VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (date, agent_id) DO UPDATE
         SET sandbox_seconds = shared_pool_usage.sandbox_seconds + $2,
             build_count     = shared_pool_usage.build_count + 1`,
      [agentId, sandboxSeconds],
    );
  }

  /**
   * Returns a real-time snapshot of the shared pool's current utilisation.
   */
  async getStatus(): Promise<SharedPoolStatus> {
    const statusResult = await this.pool.query<PoolStatusRow>(
      `SELECT
         COALESCE(
           (SELECT SUM(sandbox_seconds) FROM shared_pool_usage WHERE date = CURRENT_DATE),
           0
         )                                                                                          AS total_seconds,
         (SELECT COUNT(*) FROM contributions
          WHERE status = 'building' AND updated_at >= NOW() - INTERVAL '2 hours')                  AS active_sandboxes,
         (SELECT COUNT(*) FROM projects
          WHERE deploy_url IS NOT NULL AND status = 'deployed' AND deploy_tier = 'shared')         AS deployed_apps`,
    );

    const row = statusResult.rows[0];
    const totalSeconds = Number(row?.total_seconds ?? 0);
    const activeSandboxes = Number(row?.active_sandboxes ?? 0);
    const deployedApps = Number(row?.deployed_apps ?? 0);
    const sandboxHoursUsedToday = totalSeconds / 3600;
    const sandboxHoursLimitToday = this.config.sharedPoolMaxSandboxHours;

    return {
      sandboxHoursUsedToday,
      sandboxHoursLimitToday,
      sandboxHoursRemaining: Math.max(0, sandboxHoursLimitToday - sandboxHoursUsedToday),
      activeSandboxes,
      maxConcurrentSandboxes: this.config.sharedPoolMaxConcurrent,
      deployedApps,
      maxDeployedApps: this.config.sharedPoolMaxDeployed,
    };
  }
}
