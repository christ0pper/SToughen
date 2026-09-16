/**
 * Slows down password guessing against the sign-in screen.
 *
 * The app is reachable from the internet, and every screen behind the login
 * holds names, pay and bank details. Without this, an attacker can try
 * passwords as fast as the network allows; bcrypt makes each attempt cost
 * something, but not enough.
 *
 * Deliberately simple: a count per username held in memory, cleared on a
 * successful sign-in. It is not a distributed rate limiter - a hosted
 * deployment runs several copies of the app and each keeps its own count, so
 * the real ceiling is this limit times the number of copies. That is still the
 * difference between thousands of guesses a minute and a handful, which is the
 * point. A shared limiter belongs in the database or the host's edge, and is
 * worth adding if this is ever exposed to the open internet rather than to a
 * company that knows its own address.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

interface Attempts {
  count: number;
  firstAt: number;
}

// Survives hot reloads in development, where module state is otherwise reset.
const globalForThrottle = globalThis as unknown as { loginAttempts?: Map<string, Attempts> };
const attempts = (globalForThrottle.loginAttempts ??= new Map<string, Attempts>());

function prune(now: number): void {
  for (const [key, entry] of attempts) {
    if (now - entry.firstAt > WINDOW_MS) attempts.delete(key);
  }
}

/** Seconds to wait, or 0 when this name may try again now. */
export function retryAfterSeconds(username: string): number {
  const now = Date.now();
  prune(now);
  const entry = attempts.get(username);
  if (!entry || entry.count < MAX_ATTEMPTS) return 0;
  return Math.max(1, Math.ceil((entry.firstAt + WINDOW_MS - now) / 1000));
}

export function recordFailure(username: string): void {
  const now = Date.now();
  prune(now);
  const entry = attempts.get(username);
  if (!entry) attempts.set(username, { count: 1, firstAt: now });
  else entry.count += 1;
}

export function clearFailures(username: string): void {
  attempts.delete(username);
}

/** "5 minutes" / "45 seconds" - a wait a person can act on. */
export function describeWait(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.ceil(seconds / 60)} minutes`;
}
