const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

/**
 * Centralised API client for the MakeBook REST API.
 * All frontend data fetching routes through this module.
 */
export async function apiFetch<TResponse>(
  path: string,
  options?: RequestInit,
): Promise<TResponse> {
  const mergedHeaders = new Headers(options?.headers);
  if (!mergedHeaders.has("Content-Type")) {
    mergedHeaders.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: mergedHeaders,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TResponse>;
}
