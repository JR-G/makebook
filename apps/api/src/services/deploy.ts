import type { Pool } from "pg";
import type { Project } from "@makebook/types";

/** Configuration for the Fly.io deployment service. */
interface DeployConfig {
  /** Platform-level Fly.io API token used when no per-user token is provided. */
  flyApiToken: string;
  /** Fly.io organisation slug used when creating new apps. */
  flyOrgSlug: string;
  /** Hours after deployment before a project is considered expired and destroyed. */
  deployExpiryHours: number;
}

/** Raw machine response from the Fly.io Machines API. */
interface FlyMachineResponse {
  id: string;
  state: string;
}

/** Result returned after a successful deployment. */
export interface DeployResult {
  deployUrl: string;
  machineId: string;
}

/** A deployed project eligible for expiry cleanup. */
interface ExpiredProject {
  id: string;
  flyMachineId: string;
  slug: string;
}

/**
 * Normalised machine lifecycle state.
 * Maps the full set of Fly.io machine states down to the four states
 * the deployment lifecycle cares about.
 */
export type MachineStatus = "running" | "stopped" | "destroyed" | "unknown";

/** Fly.io state strings that map to the "stopped" lifecycle state. */
const STOPPED_FLY_STATES = new Set(["stopped", "suspended"]);

/** Fly.io state strings that map to the "running" lifecycle state. */
const RUNNING_FLY_STATES = new Set(["started"]);

interface MachineGuestConfig {
  cpu_kind: string;
  cpus: number;
  memory_mb: number;
}

const SHARED_GUEST_CONFIG: MachineGuestConfig = {
  cpu_kind: "shared",
  cpus: 1,
  memory_mb: 256,
};

const USER_HOSTED_GUEST_CONFIG: MachineGuestConfig = {
  cpu_kind: "performance",
  cpus: 1,
  memory_mb: 512,
};

const SERVICE_AUTOSCALING = {
  autostart: true,
  autostop: "stop" as const,
  min_machines_running: 0,
};

/**
 * Manages Fly.io deployments for built projects.
 *
 * Handles the full app-and-machine lifecycle: creation, status querying,
 * stop/destroy, and scheduled expiry of shared-pool deployments.
 */
export class DeployService {
  private readonly FLY_API_BASE = "https://api.machines.dev/v1";

  constructor(
    private readonly pool: Pool,
    private readonly config: DeployConfig,
  ) {}

  private appNameForProject(project: Project): string {
    return `makebook-${project.slug}`;
  }

  private flyHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  private guestConfigForTier(tier: Project["deployTier"]): MachineGuestConfig {
    return tier === "user_hosted"
      ? USER_HOSTED_GUEST_CONFIG
      : SHARED_GUEST_CONFIG;
  }

  /**
   * Deploys a project to Fly.io as a Machine with auto-stop enabled.
   *
   * Creates the Fly app if it does not already exist (409 is treated as success).
   * Uses the caller-supplied `flyToken` if provided, otherwise falls back to the
   * platform token from config.
   *
   * @param project - The project to deploy.
   * @param options - Optional per-user Fly token.
   * @returns Deploy URL and machine ID on success.
   * @throws If Fly API calls fail with an unexpected status code.
   */
  async deploy(
    project: Project,
    options: { flyToken?: string },
  ): Promise<DeployResult> {
    const token = options.flyToken ?? this.config.flyApiToken;
    const appName = this.appNameForProject(project);
    const guestConfig = this.guestConfigForTier(project.deployTier);

    const createAppResponse = await fetch(`${this.FLY_API_BASE}/apps`, {
      method: "POST",
      headers: this.flyHeaders(token),
      body: JSON.stringify({
        app_name: appName,
        org_slug: this.config.flyOrgSlug,
      }),
    });

    if (!createAppResponse.ok && createAppResponse.status !== 409) {
      const errorBody = await createAppResponse.text();
      throw new Error(
        `Failed to create Fly app: ${createAppResponse.status} ${errorBody}`,
      );
    }

    const createMachineResponse = await fetch(
      `${this.FLY_API_BASE}/apps/${appName}/machines`,
      {
        method: "POST",
        headers: this.flyHeaders(token),
        body: JSON.stringify({
          config: {
            image: `registry.fly.io/${appName}:latest`,
            auto_destroy: true,
            services: [
              {
                ...SERVICE_AUTOSCALING,
                ports: [
                  { port: 443, handlers: ["tls", "http"] },
                  { port: 80, handlers: ["http"] },
                ],
                protocol: "tcp",
                internal_port: 8080,
              },
            ],
            guest: { ...guestConfig },
          },
        }),
      },
    );

    if (!createMachineResponse.ok) {
      const errorBody = await createMachineResponse.text();
      throw new Error(
        `Failed to create Fly machine: ${createMachineResponse.status} ${errorBody}`,
      );
    }

    const machine = (await createMachineResponse.json()) as FlyMachineResponse;
    const deployUrl = `https://${appName}.fly.dev`;

    await this.pool.query(
      `UPDATE projects
       SET status = 'deployed', deploy_url = $1, fly_machine_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [deployUrl, machine.id, project.id],
    );

    return { deployUrl, machineId: machine.id };
  }

  /**
   * Stops a running Fly machine without destroying it.
   *
   * @param machineId - The Fly machine ID.
   * @param appName - The Fly app name.
   * @throws If the Fly API returns a non-2xx response.
   */
  async stop(machineId: string, appName: string, flyToken?: string): Promise<void> {
    const token = flyToken ?? this.config.flyApiToken;
    const response = await fetch(
      `${this.FLY_API_BASE}/apps/${appName}/machines/${machineId}/stop`,
      {
        method: "POST",
        headers: this.flyHeaders(token),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to stop Fly machine ${machineId}: ${response.status} ${errorBody}`,
      );
    }
  }

  /**
   * Destroys a Fly machine and its associated resources.
   *
   * Silently succeeds if the machine is already gone (404), so this method
   * is safe to call as part of idempotent cleanup.
   *
   * @param machineId - The Fly machine ID.
   * @param appName - The Fly app name.
   * @throws If the Fly API returns a non-2xx, non-404 response.
   */
  async destroy(machineId: string, appName: string, flyToken?: string): Promise<void> {
    const token = flyToken ?? this.config.flyApiToken;
    const response = await fetch(
      `${this.FLY_API_BASE}/apps/${appName}/machines/${machineId}?force=true`,
      {
        method: "DELETE",
        headers: this.flyHeaders(token),
      },
    );

    if (response.ok || response.status === 404) {
      return;
    }

    const errorBody = await response.text();
    throw new Error(
      `Failed to destroy Fly machine ${machineId}: ${response.status} ${errorBody}`,
    );
  }

  /**
   * Retrieves the current status of a Fly machine, normalised to the
   * set of states relevant to the deployment lifecycle.
   *
   * @param machineId - The Fly machine ID.
   * @param appName - The Fly app name.
   * @returns Normalised machine status.
   */
  async getStatus(machineId: string, appName: string, flyToken?: string): Promise<MachineStatus> {
    const token = flyToken ?? this.config.flyApiToken;
    const response = await fetch(
      `${this.FLY_API_BASE}/apps/${appName}/machines/${machineId}`,
      { headers: this.flyHeaders(token) },
    );

    if (response.status === 404) {
      return "destroyed";
    }

    if (!response.ok) {
      return "unknown";
    }

    const machine = (await response.json()) as FlyMachineResponse;

    if (RUNNING_FLY_STATES.has(machine.state)) {
      return "running";
    }
    if (STOPPED_FLY_STATES.has(machine.state)) {
      return "stopped";
    }
    if (machine.state === "destroyed") {
      return "destroyed";
    }
    return "unknown";
  }

  /**
   * Queries the database for deployed projects that have exceeded the
   * configured expiry window, measured from their last `updated_at` timestamp.
   *
   * @returns List of expired projects eligible for cleanup.
   */
  async checkExpired(): Promise<ExpiredProject[]> {
    const result = await this.pool.query<{
      id: string;
      fly_machine_id: string;
      slug: string;
    }>(
      `SELECT id, fly_machine_id, slug
       FROM projects
       WHERE status = 'deployed'
         AND updated_at < NOW() - ($1 * INTERVAL '1 hour')`,
      [this.config.deployExpiryHours],
    );

    return result.rows.map((row) => ({
      id: row.id,
      flyMachineId: row.fly_machine_id,
      slug: row.slug,
    }));
  }

  /**
   * Destroys all expired deployed projects and marks them as archived.
   *
   * Individual project failures are written to stderr and do not abort
   * the overall cleanup run — remaining projects are still processed.
   *
   * @returns Number of projects successfully expired.
   */
  async expireAll(): Promise<number> {
    const expired = await this.checkExpired();
    let expiredCount = 0;

    for (const project of expired) {
      const appName = `makebook-${project.slug}`;
      try {
        await this.destroy(project.flyMachineId, appName);
        await this.pool.query(
          `UPDATE projects
           SET status = 'archived', deploy_url = NULL, fly_machine_id = NULL, updated_at = NOW()
           WHERE id = $1`,
          [project.id],
        );
        expiredCount++;
      } catch (error) {
        process.stderr.write(
          `Failed to expire project ${project.id}: ${String(error)}\n`,
        );
      }
    }

    return expiredCount;
  }
}
