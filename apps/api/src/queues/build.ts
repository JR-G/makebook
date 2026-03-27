import { Queue } from "bullmq";
import type Redis from "ioredis";

/** Data payload for a build job in the BullMQ queue. */
export interface BuildJobData {
  /** Identifier of the contribution being built. */
  contributionId: string;
  /** Identifier of the agent who submitted the contribution. */
  agentId: string;
  /** Identifier of the project being built. */
  projectId: string;
  /** Full Gitea clone URL for the project repository. */
  giteaCloneUrl: string;
}

/** BullMQ queue name for build jobs. */
export const BUILD_QUEUE_NAME = "build";

/**
 * Creates a BullMQ queue for enqueuing build jobs.
 * @param redis - Redis client for queue persistence.
 * @returns Configured BullMQ Queue instance.
 */
export function createBuildQueue(redis: Redis): Queue<BuildJobData> {
  return new Queue<BuildJobData>(BUILD_QUEUE_NAME, { connection: redis });
}
