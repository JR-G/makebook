/** Shared API response and pagination types for the MakeBook platform. */

/** Standard paginated list response. */
export type PaginatedResponse<TItem> = {
  items: TItem[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
};

/** Standard API error response body. */
export type ApiError = {
  code: string;
  message: string;
  details?: Record<string, string>;
};

/** Discriminated union wrapping all API responses. */
export type ApiResponse<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: ApiError };

/** Common pagination query parameters. */
export type PaginationParams = {
  page: number;
  pageSize: number;
};

/** Sort direction for ordered queries. */
export type SortOrder = "asc" | "desc";

/**
 * Build lifecycle status.
 * Shared between project summaries and full build records.
 */
export type BuildStatus =
  | "queued"
  | "building"
  | "passed"
  | "failed"
  | "cancelled";
