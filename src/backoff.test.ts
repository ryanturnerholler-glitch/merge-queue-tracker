import { describe, expect, it } from "vitest";
import { clampPollSeconds, DEFAULT_POLL_SECONDS, ERROR_BACKOFF_SECONDS, MIN_POLL_SECONDS, nextDelay } from "./backoff";

describe("clampPollSeconds", () => {
  it("enforces the minimum and the default", () => {
    expect(clampPollSeconds(5)).toBe(MIN_POLL_SECONDS);
    expect(clampPollSeconds(15)).toBe(15);
    expect(clampPollSeconds(90.7)).toBe(90);
    expect(clampPollSeconds(undefined)).toBe(DEFAULT_POLL_SECONDS);
    expect(clampPollSeconds("20")).toBe(DEFAULT_POLL_SECONDS);
    expect(clampPollSeconds(Number.NaN)).toBe(DEFAULT_POLL_SECONDS);
  });
});

describe("nextDelay", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");

  it("uses the poll interval when all is well", () => {
    expect(nextDelay({ pollSeconds: 45, failed: false, rateLimit: { remaining: 4000, resetAt: "" }, now })).toEqual({
      delayMs: 45_000,
      reason: "normal",
    });
    expect(nextDelay({ pollSeconds: 45, failed: false, rateLimit: null, now }).delayMs).toBe(45_000);
  });

  it("backs off five minutes after an error", () => {
    expect(nextDelay({ pollSeconds: 45, failed: true, rateLimit: null, now })).toEqual({
      delayMs: ERROR_BACKOFF_SECONDS * 1000,
      reason: "error",
    });
  });

  it("waits for the rate limit reset, at least five minutes and at most an hour", () => {
    const soon = nextDelay({ pollSeconds: 45, failed: false, rateLimit: { remaining: 199, resetAt: "2026-10-28T12:01:00Z" }, now });
    expect(soon).toEqual({ delayMs: ERROR_BACKOFF_SECONDS * 1000, reason: "rate-limit" });

    const later = nextDelay({ pollSeconds: 45, failed: false, rateLimit: { remaining: 10, resetAt: "2026-10-28T12:40:00Z" }, now });
    expect(later).toEqual({ delayMs: 40 * 60_000 + 5000, reason: "rate-limit" });

    const far = nextDelay({ pollSeconds: 45, failed: false, rateLimit: { remaining: 0, resetAt: "2026-10-28T15:00:00Z" }, now });
    expect(far.delayMs).toBe(3_600_000);

    const broken = nextDelay({ pollSeconds: 45, failed: false, rateLimit: { remaining: 0, resetAt: "not a date" }, now });
    expect(broken).toEqual({ delayMs: ERROR_BACKOFF_SECONDS * 1000, reason: "rate-limit" });
  });

  it("does not back off at exactly the threshold", () => {
    expect(nextDelay({ pollSeconds: 30, failed: false, rateLimit: { remaining: 200, resetAt: "" }, now }).reason).toBe("normal");
  });
});
