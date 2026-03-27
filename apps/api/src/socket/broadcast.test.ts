import { describe, it, expect, mock } from "bun:test";
import type { Server as SocketIOServer } from "socket.io";
import { broadcastBuildLog } from "./broadcast.ts";

describe("broadcastBuildLog", () => {
  it("emits to the correct project room with the log line", () => {
    const mockEmit = mock((_event: string, _payload: unknown) => true);
    const mockTo = mock((_room: string) => ({ emit: mockEmit }));
    const mockIo = { to: mockTo } as unknown as SocketIOServer;

    broadcastBuildLog(mockIo, "project-42", "Build started");

    expect(mockTo).toHaveBeenCalledWith("project:project-42");
    expect(mockEmit).toHaveBeenCalledWith("build:log", { line: "Build started" });
  });

  it("scopes broadcast to the specific projectId room", () => {
    const mockEmit = mock((_event: string, _payload: unknown) => true);
    const mockTo = mock((_room: string) => ({ emit: mockEmit }));
    const mockIo = { to: mockTo } as unknown as SocketIOServer;

    broadcastBuildLog(mockIo, "other-project", "line");

    expect(mockTo).toHaveBeenCalledWith("project:other-project");
  });

  it("edge case: broadcasts an empty line without error", () => {
    const mockEmit = mock((_event: string, _payload: unknown) => true);
    const mockTo = mock((_room: string) => ({ emit: mockEmit }));
    const mockIo = { to: mockTo } as unknown as SocketIOServer;

    broadcastBuildLog(mockIo, "p1", "");

    expect(mockEmit).toHaveBeenCalledWith("build:log", { line: "" });
  });
});
