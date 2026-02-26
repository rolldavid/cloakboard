/**
 * API base URL for server communication.
 * Uses VITE_API_URL env var for separate frontend/server deployment,
 * falls back to empty string (same-origin) for local dev.
 */
export const API_BASE = (import.meta as any).env?.VITE_API_URL || '';

/**
 * Build a full API URL from a relative path.
 * @param path - e.g. '/api/deploy-cloak'
 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
