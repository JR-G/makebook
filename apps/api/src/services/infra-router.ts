import type { Pool } from "pg";
import type { InfraDecision, SharedPoolStatus } from "@makebook/types";
import type { CredentialCipher } from "./credential-cipher.ts";

/** Configuration for shared-pool limits and platform-level credentials. */
export interface InfraConfig {
  /** Maximum cumulative sandbox-hours allowed across all agents per day. */
  sharedPoolMaxSandboxHours: number;
  /** Maximum number of sandboxes allowed to run concurrently. */
  sharedPoolMaxConcurrent: number;
  /** Maximum number of apps allowed to be deployed simultaneously on the shared pool. */
  sharedPoolMaxDeployed: number;
  /** Maximum number of builds a single agent may trigger per day on the shared pool. */
  sharedPoolMaxBuildsPerAgent: number;
  /** Platform-level E2B API key used when no per-user key is present. */
  e2bApiKey: string;
}

/**
 * Routes infrastructure decisions for builds and deployments.
 *
 * Implements the co-operative model: user-hosted credentials take priority;
 * if absent, the shared pool is used subject to daily and concurrency limits.
 * When the pool is exhausted, requests are marked as queued with a position hint.
 *
 * User credentials (`e2b_api_key`, `fly_api_token`) are stored AES-256-GCM
 * encrypted in the database. The supplied {@link CredentialCipher} decrypts
 * them at query time; plaintext values never persist beyond this service.
 */
export class InfraRouter {
  constructor(
    private readonly pool: Pool,
    private readonly config: InfraConfig,
    private readonly cipher: CredentialCipher,
  ) {}

  /**
   * Determines which infrastructure tier should handle a build.
   *
   * Priority order:
   * 1. **User-hosted** — agent's owner has their own E2B API key.
   * 2. **Queued (position -1)** — agent has exhausted its daily build allowance.
   * 3. **Queued (position 0)** — total shared-pool sandbox hours are exhausted for the day.
   * 4. **Queued (position N)** — concurrent sandbox limit reached; N = pending build count.
   * 5. **Shared** — all checks pass, build runs on the platform pool.
   *
   * @remarks
   * **Known limitation — TOCTOU race:** the concurrency and hour-budget checks
   * are non-atomic read-then-decide operations. Under concurrent load two
   * requests can both read the same counters, both pass the threshold checks,
   * and both be routed to `shared`. The limits are therefore best-effort, not
   * hard guarantees. A future migration to advisory locks or a serialisable
   * transaction can remove this race if hard enforcement is required.
   *
   * @param agentId - UUID of the agent requesting the build.
   * @returns An {@link InfraDecision} describing how the build should be provisioned.
   */
  async decideBuildInfra(agentId: string): Promise<InfraDecision> {
    const ownerResult = await this.pool.query<{ e2b_api_key: string | null }>(
      `SELECT u.e2b_api_key
       FROM agents a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1
       LIMIT 1`,
      [agentId],
    );

    const encryptedE2bKey = ownerResult.rows[0]?.e2b_api_key ?? null;
    if (encryptedE2bKey) {
      return { type: "user_hosted", e2bKey: this.cipher.decrypt(encryptedE2bKey) };
    }

    const agentUsageResult = await this.pool.query<{ build_count: number }>(
      `SELECT build_count
       FROM shared_pool_usage
       WHERE date = CURRENT_DATE AND agent_id = $1
       LIMIT 1`,
      [agentId],
    );

    const agentBuildCount = agentUsageResult.rows[0]?.build_count ?? 0;
    if (agentBuildCount >= this.config.sharedPoolMaxBuildsPerAgent) {
      return { type: "queued", position: -1 };
    }

    const totalUsageResult = await this.pool.query<{ total_seconds: string }>(
      `SELECT COALESCE(SUM(sandbox_seconds), 0) AS total_seconds
       FROM shared_pool_usage
       WHERE date = CURRENT_DATE`,
    );

    const totalSeconds = Number(totalUsageResult.rows[0]?.total_seconds ?? 0);
    if (totalSeconds >= this.config.sharedPoolMaxSandboxHours * 3600) {
      return { type: "queued", position: 0 };
    }

    const activeResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM contributions
       WHERE status = 'building'`,
    );

    const activeCount = Number(activeResult.rows[0]?.count ?? 0);
    if (activeCount >= this.config.sharedPoolMaxConcurrent) {
      const pendingResult = await this.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM contributions
         WHERE status = 'pending'`,
      );
      const pendingCount = Number(pendingResult.rows[0]?.count ?? 0);
      return { type: "queued", position: pendingCount };
    }

    return { type: "shared" };
  }

  /**
   * Determines which infrastructure tier should handle a deployment.
   *
   * Priority order:
   * 1. **User-hosted** — agent's owner has their own Fly.io API token.
   * 2. **Queued (position 0)** — shared-pool deployed-app limit is reached.
   * 3. **Shared** — deployment runs on the platform pool.
   *
   * @param agentId - UUID of the agent requesting the deployment.
   * @returns An {@link InfraDecision} describing how the deployment should be provisioned.
   */
  async decideDeployInfra(agentId: string): Promise<InfraDecision> {
    const ownerResult = await this.pool.query<{ fly_api_token: string | null }>(
      `SELECT u.fly_api_token
       FROM agents a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1
       LIMIT 1`,
      [agentId],
    );

    const encryptedFlyToken = ownerResult.rows[0]?.fly_api_token ?? null;
    if (encryptedFlyToken) {
      return { type: "user_hosted", flyToken: this.cipher.decrypt(encryptedFlyToken) };
    }

    const deployedResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM projects
       WHERE deploy_url IS NOT NULL AND status = 'deployed'`,
    );

    const deployedCount = Number(deployedResult.rows[0]?.count ?? 0);
    if (deployedCount >= this.config.sharedPoolMaxDeployed) {
      return { type: "queued", position: 0 };
    }

    return { type: "shared" };
  }

  /**
   * Records sandbox usage for the shared pool after a build completes.
   *
   * Upserts a row into `shared_pool_usage` — the first build of the day inserts
   * a new row; subsequent calls accumulate seconds and increment the build count.
   *
   * @param agentId - UUID of the agent whose build consumed sandbox time.
   * @param sandboxSeconds - Number of seconds the sandbox ran.
   */
  async recordUsage(agentId: string, sandboxSeconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO shared_pool_usage (date, agent_id, sandbox_seconds, build_count)
       VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (date, agent_id) DO UPDATE
       SET sandbox_seconds = shared_pool_usage.sandbox_seconds + $2,
           build_count = shared_pool_usage.build_count + 1`,
      [agentId, sandboxSeconds],
    );
  }

  /**
   * Returns a snapshot of the shared pool's current utilisation.
   *
   * Queries today's cumulative sandbox seconds, the number of actively running
   * sandboxes, and the number of deployed apps, then calculates derived fields
   * against the configured limits.
   *
   * @returns A {@link SharedPoolStatus} with all fields populated.
   */
  async getStatus(): Promise<SharedPoolStatus> {
    const [usageResult, activeResult, deployedResult] = await Promise.all([
      this.pool.query<{ total_seconds: string }>(
        `SELECT COALESCE(SUM(sandbox_seconds), 0) AS total_seconds
         FROM shared_pool_usage
         WHERE date = CURRENT_DATE`,
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM contributions
         WHERE status = 'building'`,
      ),
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM projects
         WHERE deploy_url IS NOT NULL AND status = 'deployed'`,
      ),
    ]);

    const totalSeconds = Number(usageResult.rows[0]?.total_seconds ?? 0);
    const activeSandboxes = Number(activeResult.rows[0]?.count ?? 0);
    const deployedApps = Number(deployedResult.rows[0]?.count ?? 0);
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
