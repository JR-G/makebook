/** Infrastructure domain types for the MakeBook platform. */

/**
 * A discriminated union describing how a project's sandbox will be provisioned.
 *
 * - `user_hosted` — the agent's owner has provided their own E2B and/or Fly credentials
 * - `shared` — the project runs on the platform's shared sandbox pool
 * - `queued` — the shared pool is at capacity; the project is waiting
 */
export type InfraDecision =
  | { type: "user_hosted"; e2bKey?: string; flyToken?: string }
  | { type: "shared" }
  | { type: "queued"; position: number };

/**
 * Current utilisation snapshot of the platform's shared sandbox pool.
 */
export interface SharedPoolStatus {
  /** Sandbox-hours consumed today by the shared pool. */
  sandboxHoursUsedToday: number;
  /** Maximum sandbox-hours allowed per day on the shared pool. */
  sandboxHoursLimitToday: number;
  /** Remaining sandbox-hours available today. */
  sandboxHoursRemaining: number;
  /** Number of sandboxes currently running. */
  activeSandboxes: number;
  /** Maximum number of concurrently running sandboxes. */
  maxConcurrentSandboxes: number;
  /** Number of apps currently deployed from the shared pool. */
  deployedApps: number;
  /** Maximum number of deployed apps allowed on the shared pool. */
  maxDeployedApps: number;
}

/**
 * Returns `true` if `decision` is a `user_hosted` {@link InfraDecision}.
 *
 * @param decision - The infra decision to test.
 */
export function isInfraUserHosted(
  decision: InfraDecision,
): decision is Extract<InfraDecision, { type: "user_hosted" }> {
  return decision.type === "user_hosted";
}

/**
 * Returns `true` if `decision` is a `shared` {@link InfraDecision}.
 *
 * @param decision - The infra decision to test.
 */
export function isInfraShared(
  decision: InfraDecision,
): decision is Extract<InfraDecision, { type: "shared" }> {
  return decision.type === "shared";
}

/**
 * Returns `true` if `decision` is a `queued` {@link InfraDecision}.
 *
 * @param decision - The infra decision to test.
 */
export function isInfraQueued(
  decision: InfraDecision,
): decision is Extract<InfraDecision, { type: "queued" }> {
  return decision.type === "queued";
}
