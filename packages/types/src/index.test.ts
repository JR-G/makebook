import { describe, expect, it } from "bun:test";
import {
  isActivityType,
  isBuildStatus,
  isInfraQueued,
  isInfraShared,
  isInfraUserHosted,
  isProjectStatus,
} from "./index.ts";
import type { InfraDecision } from "./index.ts";

describe("isBuildStatus", () => {
  it("returns true for all valid statuses", () => {
    expect(isBuildStatus("pending")).toBe(true);
    expect(isBuildStatus("building")).toBe(true);
    expect(isBuildStatus("passed")).toBe(true);
    expect(isBuildStatus("failed")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isBuildStatus("unknown")).toBe(false);
    expect(isBuildStatus("success")).toBe(false);
    expect(isBuildStatus("running")).toBe(false);
  });

  it("returns false for empty string (boundary)", () => {
    expect(isBuildStatus("")).toBe(false);
  });
});

describe("isProjectStatus", () => {
  it("returns true for all valid statuses", () => {
    expect(isProjectStatus("open")).toBe(true);
    expect(isProjectStatus("in_progress")).toBe(true);
    expect(isProjectStatus("deployed")).toBe(true);
    expect(isProjectStatus("archived")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isProjectStatus("active")).toBe(false);
    expect(isProjectStatus("closed")).toBe(false);
  });

  it("returns false for empty string (boundary)", () => {
    expect(isProjectStatus("")).toBe(false);
  });
});

describe("isActivityType", () => {
  it("returns true for all valid activity types", () => {
    expect(isActivityType("project_created")).toBe(true);
    expect(isActivityType("agent_joined")).toBe(true);
    expect(isActivityType("contribution_submitted")).toBe(true);
    expect(isActivityType("build_passed")).toBe(true);
    expect(isActivityType("build_failed")).toBe(true);
    expect(isActivityType("deployed")).toBe(true);
    expect(isActivityType("message_posted")).toBe(true);
    expect(isActivityType("project_forked")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isActivityType("project_deleted")).toBe(false);
    expect(isActivityType("user_created")).toBe(false);
  });

  it("returns false for empty string (boundary)", () => {
    expect(isActivityType("")).toBe(false);
  });
});

describe("isInfraUserHosted", () => {
  it("returns true for user_hosted decisions", () => {
    const decision: InfraDecision = { type: "user_hosted", e2bKey: "key123" };
    expect(isInfraUserHosted(decision)).toBe(true);
  });

  it("returns true for user_hosted deploy decisions with flyToken", () => {
    const decision: InfraDecision = {
      type: "user_hosted",
      flyToken: "fly_token",
    };
    expect(isInfraUserHosted(decision)).toBe(true);
  });

  it("returns false for shared decisions", () => {
    const decision: InfraDecision = { type: "shared" };
    expect(isInfraUserHosted(decision)).toBe(false);
  });

  it("returns false for queued decisions", () => {
    const decision: InfraDecision = { type: "queued", position: 1 };
    expect(isInfraUserHosted(decision)).toBe(false);
  });
});

describe("isInfraShared", () => {
  it("returns true for shared decisions", () => {
    const decision: InfraDecision = { type: "shared" };
    expect(isInfraShared(decision)).toBe(true);
  });

  it("returns false for user_hosted decisions", () => {
    const decision: InfraDecision = { type: "user_hosted", e2bKey: "key123" };
    expect(isInfraShared(decision)).toBe(false);
  });

  it("returns false for queued decisions", () => {
    const decision: InfraDecision = { type: "queued", position: 3 };
    expect(isInfraShared(decision)).toBe(false);
  });
});

describe("isInfraQueued", () => {
  it("returns true for queued decisions", () => {
    const decision: InfraDecision = { type: "queued", position: 5 };
    expect(isInfraQueued(decision)).toBe(true);
  });

  it("returns false for shared decisions", () => {
    const decision: InfraDecision = { type: "shared" };
    expect(isInfraQueued(decision)).toBe(false);
  });

  it("returns false for user_hosted decisions", () => {
    const decision: InfraDecision = { type: "user_hosted", e2bKey: "key" };
    expect(isInfraQueued(decision)).toBe(false);
  });

  it("discriminates the union correctly — position is accessible after narrowing", () => {
    const decision: InfraDecision = { type: "queued", position: 7 };
    if (isInfraQueued(decision)) {
      expect(decision.position).toBe(7);
    } else {
      throw new Error("expected queued decision to be narrowed");
    }
  });
});
