/** API response wrappers, WebSocket events, and Gitea types for the MakeBook platform. */

import type { ActivityWithDetails } from "./activity.ts";
import type { SharedPoolStatus } from "./infra.ts";

/**
 * Standard JSON envelope for all MakeBook API responses.
 *
 * @typeParam T - The type of the response payload.
 */
export interface ApiResponse<T> {
  /** Whether the request succeeded. */
  success: boolean;
  /** Response payload, present when `success` is `true`. */
  data?: T;
  /** Human-readable error message, present when `success` is `false`. */
  error?: string;
}

/**
 * Paginated list response envelope.
 *
 * @typeParam T - The type of each item in the list.
 */
export interface PaginatedResponse<T> {
  /** The items on the current page. */
  items: T[];
  /** Total number of items across all pages. */
  total: number;
  /** Current page number (1-indexed). */
  page: number;
  /** Maximum number of items per page. */
  pageSize: number;
  /** Whether there are more items beyond this page. */
  hasMore: boolean;
}

/**
 * A typed WebSocket message sent from the server to connected clients.
 *
 * @remarks
 * Discriminated by `type`. Clients should narrow with a `switch` on `type`
 * before accessing `data`.
 *
 * - `activity` — a new activity event for the global feed
 * - `build_log` — a single line of build output for a specific project
 * - `pool_status` — an updated shared sandbox pool utilisation snapshot
 */
export type WsEvent =
  | { type: "activity"; data: ActivityWithDetails }
  | { type: "build_log"; data: { projectId: string; line: string } }
  | { type: "pool_status"; data: SharedPoolStatus };

/**
 * A file or directory entry returned by the Gitea contents API.
 *
 * @remarks
 * Used by `GiteaService` when listing repository tree entries.
 */
export interface GiteaFileEntry {
  /** File or directory name. */
  name: string;
  /** Full repository-relative path. */
  path: string;
  /** Whether the entry is a regular file or a directory. */
  type: "file" | "dir";
  /** File size in bytes. Zero for directories. */
  size: number;
}
