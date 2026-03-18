/**
 * BullMQ build worker.
 * Consumes build jobs from the queue, spins up E2B sandboxes,
 * clones the Gitea repo, runs install/build/test, and streams
 * output back via WebSocket.
 */
export class BuildRunner {
  /** @throws {Error} Stub — not yet implemented. */
  start(): never {
    throw new Error("BuildRunner.start not yet implemented.");
  }
}
