import { Worker, type Job } from "bullmq";
import { Sandbox } from "e2b";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { Server as SocketIOServer } from "socket.io";
import { BUILD_QUEUE_NAME, type BuildJobData } from "../queues/build.ts";
import { broadcastBuildLog } from "../socket/broadcast.ts";

/** Possible build outcomes for a contribution. */
export type BuildStatus = "pending" | "building" | "passed" | "failed";

/** Result of an infrastructure routing decision for a build. */
export type InfraDecision =
  | { tier: "shared" }
  | { tier: "user_hosted"; e2bApiKey: string }
  | { tier: "queued" };

/** Routes builds to appropriate infrastructure tiers and tracks sandbox usage. */
export interface InfraRouter {
  /**
   * Determines which infrastructure tier to use for the given agent's build.
   * @param agentId - Agent requesting the build.
   * @returns Infrastructure decision including tier and, if user-hosted, the agent's E2B API key.
   */
  decideBuildInfra(agentId: string): Promise<InfraDecision>;

  /**
   * Records sandbox usage after a build completes or fails.
   * @param agentId - Agent whose sandbox was used.
   * @param sandboxDurationSeconds - How long the sandbox was active.
   */
  recordUsage(agentId: string, sandboxDurationSeconds: number): Promise<void>;
}

/** Manages contribution lifecycle and persists build results. */
export interface ContributionService {
  /**
   * Updates the build status and optional log for a contribution.
   * @param contributionId - Contribution to update.
   * @param status - New build status.
   * @param buildLog - Optional accumulated build output.
   */
  updateStatus(
    contributionId: string,
    status: BuildStatus,
    buildLog?: string
  ): Promise<void>;
}

/** Records platform activity events and broadcasts them via WebSocket. */
export interface FeedService {
  /**
   * Creates an activity event in the platform feed.
   * @param type - Event type identifier (e.g. "build_passed").
   * @param payload - Arbitrary event data.
   */
  createActivity(
    type: string,
    payload: Record<string, unknown>
  ): Promise<void>;
}

/** Dependencies required to create a build worker. */
export interface BuildWorkerOptions {
  /** Redis client for BullMQ queue connection. */
  redis: Redis;
  /** PostgreSQL connection pool (reserved for future DB lookups within the worker). */
  pool: Pool;
  /** Socket.IO server for real-time log streaming to clients. */
  io: SocketIOServer;
  /** Decides infra tier and records sandbox usage. */
  infraRouter: InfraRouter;
  /** Persists contribution build status and logs. */
  contributionService: ContributionService;
  /** Broadcasts activity events to the platform feed. */
  feedService: FeedService;
  /** Runtime configuration for sandbox creation and Gitea access. */
  config: { e2bApiKey: string; giteaUrl: string };
}

const SANDBOX_TIMEOUT_MS = 300_000;
const WORKER_CONCURRENCY = 3;
const BUILD_RATE_LIMIT_MAX = 10;
const BUILD_RATE_LIMIT_DURATION_MS = 60_000;

/**
 * Executes git clone, bun install, and bun run build inside the sandbox,
 * streaming stdout/stderr through the provided log callback.
 * @param sandbox - Active E2B sandbox instance.
 * @param giteaCloneUrl - Repository URL to clone.
 * @param log - Callback to receive each output line.
 * @returns Final build status based on command exit codes.
 */
async function runBuildCommands(
  sandbox: Sandbox,
  giteaCloneUrl: string,
  log: (line: string) => void
): Promise<BuildStatus> {
  const cloneResult = await sandbox.commands.run(
    `git clone ${giteaCloneUrl} /app`
  );
  if (cloneResult.exitCode !== 0) return "failed";

  const installResult = await sandbox.commands.run("cd /app && bun install", {
    onStdout: log,
    onStderr: (line: string) => {
      log(`[stderr] ${line}`);
    },
  });
  if (installResult.exitCode !== 0) return "failed";

  const buildResult = await sandbox.commands.run("cd /app && bun run build", {
    onStdout: log,
    onStderr: (line: string) => {
      log(`[stderr] ${line}`);
    },
  });
  return buildResult.exitCode === 0 ? "passed" : "failed";
}

/**
 * Creates a BullMQ worker that processes build jobs from the build queue.
 *
 * Each job spins up an E2B sandbox, clones the Gitea repository, runs
 * `bun install` and `bun run build`, streams output via Socket.IO, and
 * updates the contribution status on completion or failure.
 * @param options - Worker dependencies and runtime configuration.
 * @returns Running BullMQ Worker instance. Call `.close()` for graceful shutdown.
 */
export function createBuildWorker(options: BuildWorkerOptions): Worker {
  const { redis, io, infraRouter, contributionService, feedService, config } =
    options;

  return new Worker<BuildJobData>(
    BUILD_QUEUE_NAME,
    async (job: Job<BuildJobData>) => {
      const { contributionId, agentId, projectId, giteaCloneUrl } = job.data;
      const startTime = Date.now();
      let sandbox: Sandbox | null = null;
      let buildStatus: BuildStatus = "failed";
      const buildLog: string[] = [];

      try {
        const decision = await infraRouter.decideBuildInfra(agentId);

        if (decision.tier === "queued") {
          await contributionService.updateStatus(
            contributionId,
            "pending",
            "Queued — waiting for shared pool capacity"
          );
          return;
        }

        const apiKey =
          decision.tier === "user_hosted"
            ? decision.e2bApiKey
            : config.e2bApiKey;

        await contributionService.updateStatus(contributionId, "building");
        await feedService.createActivity("contribution_submitted", {
          contributionId,
          projectId,
          agentId,
        });

        sandbox = await Sandbox.create({ apiKey, timeoutMs: SANDBOX_TIMEOUT_MS });

        const log = (line: string): void => {
          buildLog.push(line);
          broadcastBuildLog(io, projectId, line);
        };

        buildStatus = await runBuildCommands(sandbox, giteaCloneUrl, log);
      } catch (error) {
        buildLog.push(error instanceof Error ? error.message : String(error));
        buildStatus = "failed";
      } finally {
        if (sandbox !== null) {
          const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
          await sandbox.kill().catch(() => undefined);
          await infraRouter.recordUsage(agentId, durationSeconds);
        }
      }

      const combinedLog = buildLog.join("\n");
      await contributionService.updateStatus(
        contributionId,
        buildStatus,
        combinedLog
      );
      const activityType =
        buildStatus === "passed" ? "build_passed" : "build_failed";
      await feedService.createActivity(activityType, {
        contributionId,
        projectId,
        agentId,
      });
    },
    {
      connection: redis,
      concurrency: WORKER_CONCURRENCY,
      limiter: {
        max: BUILD_RATE_LIMIT_MAX,
        duration: BUILD_RATE_LIMIT_DURATION_MS,
      },
    }
  );
}
