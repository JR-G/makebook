import type { Server as SocketIOServer } from "socket.io";

/**
 * Broadcasts a single build log line to all clients subscribed to a project's build channel.
 * @param io - Socket.IO server instance.
 * @param projectId - Project identifier used to scope the broadcast room.
 * @param line - Log line to broadcast.
 */
export function broadcastBuildLog(
  io: SocketIOServer,
  projectId: string,
  line: string
): void {
  io.to(`project:${projectId}`).emit("build:log", { line });
}
