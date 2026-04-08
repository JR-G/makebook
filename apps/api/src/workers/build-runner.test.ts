import { describe, it, expect, mock, beforeEach, type Mock } from "bun:test";
import type { Server as SocketIOServer } from "socket.io";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { BuildJobData } from "../queues/build.ts";
import type {
  ContributionService,
  FeedService,
  InfraDecision,
  InfraRouter,
} from "./build-runner.ts";

// ---------------------------------------------------------------------------
// Module mocks — awaited at module level so they are set up before the module
// under test is dynamically imported below.
// ---------------------------------------------------------------------------

/** Captures the job handler registered with the Worker constructor. */
let capturedJobHandler:
  | ((job: { data: BuildJobData }) => Promise<void>)
  | undefined;

const mockWorkerClose = mock(() => Promise.resolve());

await mock.module("bullmq", () => {
  class MockWorker {
    constructor(
      _name: string,
      handler: (job: { data: BuildJobData }) => Promise<void>,
      _options: unknown
    ) {
      capturedJobHandler = handler;
    }
    close = mockWorkerClose;
  }
  // Minimal stub satisfying the Queue constructor used in queues/build.ts
  const MockQueue = function MockQueueCtor() {};
  return { Worker: MockWorker, Queue: MockQueue };
});

interface MockCommandOpts {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

const mockSandboxKill = mock(() => Promise.resolve(true));
const mockCommandsRun = mock((_cmd: string, _opts?: MockCommandOpts) =>
  Promise.resolve({ exitCode: 0 })
);
const mockSandboxCreate = mock(() =>
  Promise.resolve({
    commands: { run: mockCommandsRun },
    kill: mockSandboxKill,
  })
);

await mock.module("e2b", () => ({
  Sandbox: { create: mockSandboxCreate },
}));

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks are wired up.
// Note: broadcast.ts is NOT mocked here — instead mockIo (below) is given a
// proper stub so broadcastBuildLog's real implementation can call it safely.
// This avoids module-registry contamination with broadcast.test.ts.
// ---------------------------------------------------------------------------

const { createBuildWorker } = await import("./build-runner.ts");

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

/** Tracks individual log lines emitted through broadcastBuildLog. */
let capturedLogLines: string[] = [];

/** Socket.IO stub: records calls to io.to(room).emit(event, payload). */
const buildMockIo = (): SocketIOServer => {
  capturedLogLines = [];
  const mockEmit = mock((_event: string, payload: { line: string }) => {
    capturedLogLines.push(payload.line);
    return true;
  });
  const mockTo = mock((_room: string) => ({ emit: mockEmit }));
  return { to: mockTo } as unknown as SocketIOServer;
};

const mockPool = {} as unknown as Pool;
const mockRedis = {} as unknown as Redis;

const baseJobData: BuildJobData = {
  contributionId: "contrib-1",
  agentId: "agent-1",
  projectId: "project-1",
  giteaCloneUrl: "http://gitea:3001/org/repo.git",
};

function makeInfraRouter(decision: InfraDecision): InfraRouter {
  return {
    decideBuildInfra: mock(() => Promise.resolve(decision)),
    recordUsage: mock(() => Promise.resolve()),
  };
}

function makeContributionService(): ContributionService {
  return {
    updateStatus: mock(() => Promise.resolve()),
  };
}

function makeFeedService(): FeedService {
  return {
    createActivity: mock(() => Promise.resolve()),
  };
}

async function invokeHandler(
  infraRouter: InfraRouter,
  contributionService: ContributionService,
  feedService: FeedService,
  jobData: BuildJobData = baseJobData
): Promise<void> {
  const mockIo = buildMockIo();
  createBuildWorker({
    redis: mockRedis,
    pool: mockPool,
    io: mockIo,
    infraRouter,
    contributionService,
    feedService,
    config: { e2bApiKey: "platform-key", giteaUrl: "http://gitea:3001" },
  });

  if (capturedJobHandler === undefined) {
    throw new Error("Job handler was not captured — Worker mock may be broken");
  }
  await capturedJobHandler({ data: jobData });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createBuildWorker", () => {
  it("returns a Worker instance", () => {
    const worker = createBuildWorker({
      redis: mockRedis,
      pool: mockPool,
      io: buildMockIo(),
      infraRouter: makeInfraRouter({ tier: "shared" }),
      contributionService: makeContributionService(),
      feedService: makeFeedService(),
      config: { e2bApiKey: "platform-key", giteaUrl: "http://gitea:3001" },
    });
    expect(worker).toBeDefined();
    expect(typeof worker.close).toBe("function");
  });
});

describe("job handler", () => {
  beforeEach(() => {
    mockSandboxKill.mockReset();
    mockCommandsRun.mockReset();
    mockSandboxCreate.mockReset();

    mockSandboxKill.mockImplementation(() => Promise.resolve(true));
    mockCommandsRun.mockImplementation(
      (_cmd: string, _opts?: MockCommandOpts) =>
        Promise.resolve({ exitCode: 0 })
    );
    mockSandboxCreate.mockImplementation(() =>
      Promise.resolve({
        commands: { run: mockCommandsRun },
        kill: mockSandboxKill,
      })
    );
  });

  it("happy path (shared): creates sandbox with platform key, runs all commands, marks passed", async () => {
    const infraRouter = makeInfraRouter({ tier: "shared" });
    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(infraRouter, contributionService, feedService);

    expect(mockSandboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "platform-key" })
    );
    // git clone + bun install + bun run build
    expect(mockCommandsRun).toHaveBeenCalledTimes(3);
    expect(contributionService.updateStatus).toHaveBeenCalledWith(
      "contrib-1",
      "building"
    );
    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "passed",
      expect.any(String)
    );
    expect(feedService.createActivity).toHaveBeenCalledWith(
      "build_passed",
      expect.objectContaining({ contributionId: "contrib-1" })
    );
    expect(mockSandboxKill).toHaveBeenCalled();
    expect(infraRouter.recordUsage).toHaveBeenCalledWith(
      "agent-1",
      expect.any(Number)
    );
  });

  it("happy path (user_hosted): creates sandbox with the agent's E2B key", async () => {
    const infraRouter = makeInfraRouter({
      tier: "user_hosted",
      e2bApiKey: "agent-own-key",
    });
    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(infraRouter, contributionService, feedService);

    expect(mockSandboxCreate).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "agent-own-key" })
    );
    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "passed",
      expect.any(String)
    );
  });

  it("queued: updates contribution to pending, does not create sandbox", async () => {
    const infraRouter = makeInfraRouter({ tier: "queued" });
    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(infraRouter, contributionService, feedService);

    expect(mockSandboxCreate).not.toHaveBeenCalled();
    expect(contributionService.updateStatus).toHaveBeenCalledWith(
      "contrib-1",
      "pending",
      "Queued — waiting for shared pool capacity"
    );
  });

  it("build failure: marks contribution failed when bun run build exits non-zero", async () => {
    // git clone and bun install succeed, bun run build fails
    mockCommandsRun
      .mockImplementationOnce(
        (_cmd: string, _opts?: MockCommandOpts) =>
          Promise.resolve({ exitCode: 0 }) // git clone
      )
      .mockImplementationOnce(
        (_cmd: string, _opts?: MockCommandOpts) =>
          Promise.resolve({ exitCode: 0 }) // bun install
      )
      .mockImplementationOnce(
        (_cmd: string, _opts?: MockCommandOpts) =>
          Promise.resolve({ exitCode: 1 }) // bun run build
      );

    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      contributionService,
      feedService
    );

    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "failed",
      expect.any(String)
    );
    expect(feedService.createActivity).toHaveBeenCalledWith(
      "build_failed",
      expect.objectContaining({ contributionId: "contrib-1" })
    );
  });

  it("sandbox creation error: marks contribution failed with error message", async () => {
    mockSandboxCreate.mockImplementation(() =>
      Promise.reject(new Error("E2B quota exceeded"))
    );

    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      contributionService,
      feedService
    );

    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "failed",
      expect.stringContaining("E2B quota exceeded")
    );
    expect(mockSandboxKill).not.toHaveBeenCalled();
  });

  it("streams logs: stdout and stderr lines are broadcast via the socket", async () => {
    mockCommandsRun.mockImplementation(
      (_cmd: string, opts?: MockCommandOpts) => {
        opts?.onStdout?.("installing packages");
        opts?.onStderr?.("warning: peer dep missing");
        return Promise.resolve({ exitCode: 0 });
      }
    );

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      makeContributionService(),
      makeFeedService()
    );

    expect(capturedLogLines).toContain("installing packages");
    expect(capturedLogLines).toContain("[stderr] warning: peer dep missing");
  });

  it("records usage: recordUsage called with agent id and a non-negative duration", async () => {
    const infraRouter = makeInfraRouter({ tier: "shared" });

    await invokeHandler(
      infraRouter,
      makeContributionService(),
      makeFeedService()
    );

    expect(infraRouter.recordUsage).toHaveBeenCalledWith(
      "agent-1",
      expect.any(Number)
    );
    const callArgs = (
      infraRouter.recordUsage as Mock<
        (agentId: string, seconds: number) => Promise<void>
      >
    ).mock.calls[0];
    const duration = callArgs![1];
    expect(typeof duration).toBe("number");
    expect(duration >= 0).toBe(true);
  });

  it("always cleans up: sandbox.kill() called even when build command throws", async () => {
    mockCommandsRun.mockImplementation(() =>
      Promise.reject(new Error("sandbox disconnected"))
    );

    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      contributionService,
      feedService
    );

    expect(mockSandboxKill).toHaveBeenCalled();
    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "failed",
      expect.stringContaining("sandbox disconnected")
    );
  });

  it("broadcasts build_passed activity on success", async () => {
    const feedService = makeFeedService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      makeContributionService(),
      feedService
    );

    expect(feedService.createActivity).toHaveBeenCalledWith(
      "build_passed",
      expect.any(Object)
    );
  });

  it("broadcasts build_failed activity when build exits non-zero", async () => {
    mockCommandsRun.mockImplementationOnce(
      (_cmd: string, _opts?: MockCommandOpts) =>
        Promise.resolve({ exitCode: 1 }) // clone fails
    );

    const feedService = makeFeedService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      makeContributionService(),
      feedService
    );

    expect(feedService.createActivity).toHaveBeenCalledWith(
      "build_failed",
      expect.any(Object)
    );
  });

  it("sandbox timeout: sandbox killed and contribution marked failed on timeout error", async () => {
    mockCommandsRun.mockImplementation(() =>
      Promise.reject(new Error("Timeout: sandbox exceeded 5 minute limit"))
    );

    const contributionService = makeContributionService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      contributionService,
      makeFeedService()
    );

    expect(mockSandboxKill).toHaveBeenCalled();
    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "failed",
      expect.stringContaining("Timeout")
    );
  });

  it("install failure: stops pipeline and does not run bun run build", async () => {
    mockCommandsRun
      .mockImplementationOnce(
        (_cmd: string, _opts?: MockCommandOpts) =>
          Promise.resolve({ exitCode: 0 }) // git clone
      )
      .mockImplementationOnce(
        (_cmd: string, _opts?: MockCommandOpts) =>
          Promise.resolve({ exitCode: 1 }) // bun install fails
      );

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      makeContributionService(),
      makeFeedService()
    );

    // only git clone + bun install called; bun run build must NOT be called
    expect(mockCommandsRun).toHaveBeenCalledTimes(2);
  });

  it("clone URL host mismatch: contribution marked failed without running any commands", async () => {
    const maliciousJobData: BuildJobData = {
      ...baseJobData,
      giteaCloneUrl: "http://attacker.com/evil/repo.git",
    };

    const contributionService = makeContributionService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      contributionService,
      makeFeedService(),
      maliciousJobData
    );

    expect(mockCommandsRun).not.toHaveBeenCalled();
    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "failed",
      expect.stringContaining("attacker.com")
    );
  });

  it("clone URL unparseable: contribution marked failed without running any commands", async () => {
    const badJobData: BuildJobData = {
      ...baseJobData,
      giteaCloneUrl: "not a url at all",
    };

    const contributionService = makeContributionService();

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      contributionService,
      makeFeedService(),
      badJobData
    );

    expect(mockCommandsRun).not.toHaveBeenCalled();
    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "failed",
      expect.stringContaining("Refused to clone")
    );
  });

  it("recordUsage failure: status update and feed activity still execute", async () => {
    const infraRouter = makeInfraRouter({ tier: "shared" });
    (infraRouter.recordUsage as ReturnType<typeof mock>).mockImplementation(
      () => Promise.reject(new Error("usage service down"))
    );
    const contributionService = makeContributionService();
    const feedService = makeFeedService();

    await invokeHandler(infraRouter, contributionService, feedService);

    expect(contributionService.updateStatus).toHaveBeenLastCalledWith(
      "contrib-1",
      "passed",
      expect.any(String)
    );
    expect(feedService.createActivity).toHaveBeenCalledWith(
      "build_passed",
      expect.any(Object)
    );
  });

  it("git clone stdout/stderr are streamed to the build log", async () => {
    mockCommandsRun.mockImplementation(
      (_cmd: string, opts?: MockCommandOpts) => {
        opts?.onStdout?.("Cloning into /app...");
        opts?.onStderr?.("remote: Enumerating objects: 10");
        return Promise.resolve({ exitCode: 0 });
      }
    );

    await invokeHandler(
      makeInfraRouter({ tier: "shared" }),
      makeContributionService(),
      makeFeedService()
    );

    expect(capturedLogLines).toContain("Cloning into /app...");
    expect(capturedLogLines).toContain("[stderr] remote: Enumerating objects: 10");
  });
});
