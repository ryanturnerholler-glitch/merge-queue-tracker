import type { RateLimit } from "./types";

export const MIN_POLL_SECONDS = 15;
export const DEFAULT_POLL_SECONDS = 45;
/** While the window is unfocused, poll this often by default. 0 pauses polling instead. */
export const DEFAULT_UNFOCUSED_POLL_SECONDS = 300;
/** After a failed poll, wait this long before trying again. */
export const ERROR_BACKOFF_SECONDS = 300;
/** Below this many remaining GraphQL points, slow down until the limit resets. */
export const RATE_LIMIT_THRESHOLD = 200;
export const MAX_BACKOFF_SECONDS = 3600;

export function clampPollSeconds(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_POLL_SECONDS;
  return Math.max(MIN_POLL_SECONDS, Math.floor(n));
}

/**
 * The unfocused interval: 0 means pause while unfocused; anything else is at
 * least the focused interval, since polling faster when nobody is looking makes no sense.
 */
export function clampUnfocusedPollSeconds(value: unknown, pollSeconds: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_UNFOCUSED_POLL_SECONDS;
  if (n <= 0) return 0;
  return Math.max(clampPollSeconds(pollSeconds), n);
}

export type DelayReason = "normal" | "error" | "rate-limit";

export interface DelayInput {
  pollSeconds: number;
  /** The poll that just finished threw. */
  failed: boolean;
  rateLimit: RateLimit | null;
  /** Epoch ms. */
  now: number;
}

export interface Delay {
  delayMs: number;
  reason: DelayReason;
}

/** How long to wait before the next poll. */
export function nextDelay(input: DelayInput): Delay {
  if (input.failed) return { delayMs: ERROR_BACKOFF_SECONDS * 1000, reason: "error" };

  const limit = input.rateLimit;
  if (limit && limit.remaining < RATE_LIMIT_THRESHOLD) {
    const resetAt = Date.parse(limit.resetAt);
    const untilReset = Number.isFinite(resetAt) ? resetAt - input.now + 5000 : 0;
    const delayMs = Math.min(MAX_BACKOFF_SECONDS * 1000, Math.max(ERROR_BACKOFF_SECONDS * 1000, untilReset));
    return { delayMs, reason: "rate-limit" };
  }

  return { delayMs: clampPollSeconds(input.pollSeconds) * 1000, reason: "normal" };
}
