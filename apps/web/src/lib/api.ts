const API_BASE_URL = process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3000";

/**
 * Centralised API client for the MakeBook REST API.
 * All frontend data fetching routes through this module.
 */
export async function apiFetch<TResponse>(
  path: string,
  options?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<TResponse>;
}
