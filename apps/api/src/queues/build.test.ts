import { describe, it, expect, mock } from "bun:test";
import type { BuildJobData } from "./build.ts";

// Mock bullmq to avoid Redis connection attempts during the test.
// Both Queue and Worker are included to prevent contamination if this module
// is loaded in the same process as build-runner.test.ts.
await mock.module("bullmq", () => {
  function MockQueue(this: { name: string }, name: string) {
    this.name = name;
  }
  const MockWorker = function MockWorkerCtor() {};
  return { Queue: MockQueue, Worker: MockWorker };
});

const { createBuildQueue, BUILD_QUEUE_NAME } = await import("./build.ts");

describe("BUILD_QUEUE_NAME", () => {
  it("is a non-empty string", () => {
    expect(typeof BUILD_QUEUE_NAME).toBe("string");
    expect(BUILD_QUEUE_NAME.length).toBeGreaterThan(0);
  });
});

describe("createBuildQueue", () => {
  it("returns a Queue constructed with BUILD_QUEUE_NAME", () => {
    const mockRedis = {} as Parameters<typeof createBuildQueue>[0];
    const queue = createBuildQueue(mockRedis);
    expect(queue.name).toBe(BUILD_QUEUE_NAME);
  });

  it("BuildJobData type includes all required fields", () => {
    // Compile-time shape verification via a typed assignment.
    const sample: BuildJobData = {
      contributionId: "c1",
      agentId: "a1",
      projectId: "p1",
      giteaCloneUrl: "http://gitea:3001/org/repo.git",
    };
    expect(sample.contributionId).toBe("c1");
    expect(sample.agentId).toBe("a1");
    expect(sample.projectId).toBe("p1");
    expect(sample.giteaCloneUrl).toBeDefined();
  });
});
