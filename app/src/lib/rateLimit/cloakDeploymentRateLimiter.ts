/**
 * Cloak Deployment Rate Limiter
 *
 * Enforces a limit of 5 Cloak deployments per hour per user.
 * Uses localStorage to track deployment timestamps.
 */

const STORAGE_KEY = 'cloak_deployment_timestamps';
const MAX_DEPLOYMENTS_PER_HOUR = 5;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  remainingDeployments: number;
  resetTime: Date | null;
  message: string;
}

/**
 * Get stored deployment timestamps
 */
function getDeploymentTimestamps(): number[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const timestamps = JSON.parse(stored) as number[];
    return Array.isArray(timestamps) ? timestamps : [];
  } catch {
    return [];
  }
}

/**
 * Save deployment timestamps
 */
function saveDeploymentTimestamps(timestamps: number[]): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(timestamps));
}

/**
 * Remove expired timestamps (older than 1 hour)
 */
function filterValidTimestamps(timestamps: number[]): number[] {
  const oneHourAgo = Date.now() - ONE_HOUR_MS;
  return timestamps.filter(ts => ts > oneHourAgo);
}

/**
 * Check if a Cloak deployment is allowed under the rate limit
 */
export function checkCloakDeploymentRateLimit(): RateLimitResult {
  const allTimestamps = getDeploymentTimestamps();
  const validTimestamps = filterValidTimestamps(allTimestamps);

  // Clean up old timestamps if needed
  if (validTimestamps.length !== allTimestamps.length) {
    saveDeploymentTimestamps(validTimestamps);
  }

  const deploymentsInLastHour = validTimestamps.length;
  const remainingDeployments = Math.max(0, MAX_DEPLOYMENTS_PER_HOUR - deploymentsInLastHour);

  if (deploymentsInLastHour >= MAX_DEPLOYMENTS_PER_HOUR) {
    // Find the oldest timestamp to calculate reset time
    const oldestTimestamp = Math.min(...validTimestamps);
    const resetTime = new Date(oldestTimestamp + ONE_HOUR_MS);

    return {
      allowed: false,
      remainingDeployments: 0,
      resetTime,
      message: `Rate limit exceeded. You can deploy ${MAX_DEPLOYMENTS_PER_HOUR} Cloaks per hour. Try again at ${resetTime.toLocaleTimeString()}.`,
    };
  }

  return {
    allowed: true,
    remainingDeployments,
    resetTime: null,
    message: `You have ${remainingDeployments} Cloak deployment${remainingDeployments === 1 ? '' : 's'} remaining this hour.`,
  };
}

/**
 * Record a Cloak deployment (call after successful deployment)
 */
export function recordCloakDeployment(): void {
  const timestamps = getDeploymentTimestamps();
  const validTimestamps = filterValidTimestamps(timestamps);

  validTimestamps.push(Date.now());
  saveDeploymentTimestamps(validTimestamps);
}

/**
 * Get the current rate limit status without modifying state
 */
export function getCloakDeploymentRateLimitStatus(): {
  deploymentsInLastHour: number;
  remainingDeployments: number;
  oldestDeploymentTime: Date | null;
  nextResetTime: Date | null;
} {
  const allTimestamps = getDeploymentTimestamps();
  const validTimestamps = filterValidTimestamps(allTimestamps);

  const deploymentsInLastHour = validTimestamps.length;
  const remainingDeployments = Math.max(0, MAX_DEPLOYMENTS_PER_HOUR - deploymentsInLastHour);

  let oldestDeploymentTime: Date | null = null;
  let nextResetTime: Date | null = null;

  if (validTimestamps.length > 0) {
    const oldestTimestamp = Math.min(...validTimestamps);
    oldestDeploymentTime = new Date(oldestTimestamp);
    nextResetTime = new Date(oldestTimestamp + ONE_HOUR_MS);
  }

  return {
    deploymentsInLastHour,
    remainingDeployments,
    oldestDeploymentTime,
    nextResetTime,
  };
}

/**
 * Reset rate limit (for testing purposes only)
 */
export function resetCloakDeploymentRateLimit(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
