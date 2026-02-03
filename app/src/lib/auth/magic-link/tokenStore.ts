/**
 * Shared Token Store for Magic Link Authentication
 *
 * In development: Uses global object to persist across hot reloads
 * In production: Should use Redis or database
 *
 * Note: In serverless deployments, each function instance has its own memory,
 * so a persistent store (Redis/database) is required for production.
 */

export interface TokenData {
  email: string;
  expiresAt: number;
}

// Token expiry (15 minutes)
export const TOKEN_EXPIRY_MS = 15 * 60 * 1000;

// Use global object to persist across Next.js hot reloads in development
const globalForTokens = globalThis as unknown as {
  magicLinkTokenStore: Map<string, TokenData> | undefined;
};

// Singleton token store - persists across hot reloads
const tokenStore = globalForTokens.magicLinkTokenStore ?? new Map<string, TokenData>();

if (process.env.NODE_ENV !== 'production') {
  globalForTokens.magicLinkTokenStore = tokenStore;
}

/**
 * Store a token with associated email
 */
export function setToken(token: string, email: string): void {
  tokenStore.set(token, {
    email,
    expiresAt: Date.now() + TOKEN_EXPIRY_MS,
  });

}

/**
 * Get token data if valid
 */
export function getToken(token: string): TokenData | null {
  const data = tokenStore.get(token);
  // Avoid logging token prefix in production

  if (!data) return null;

  // Check if expired
  if (data.expiresAt < Date.now()) {
    tokenStore.delete(token);
    return null;
  }

  return data;
}

/**
 * Delete a token (single use)
 */
export function deleteToken(token: string): void {
  tokenStore.delete(token);
}

/**
 * Check if token exists and is valid (without deleting)
 */
export function validateToken(token: string): { valid: boolean; email?: string } {
  const data = getToken(token);
  if (!data) {
    return { valid: false };
  }
  return { valid: true, email: data.email };
}

/**
 * Consume token (validate and delete)
 */
export function consumeToken(token: string): { valid: boolean; email?: string } {
  const data = getToken(token);
  if (!data) {
    return { valid: false };
  }
  deleteToken(token);
  return { valid: true, email: data.email };
}

/**
 * Debug: List all tokens (dev only)
 */
export function debugListTokens(): void {
  if (process.env.NODE_ENV !== 'development') return;

}
