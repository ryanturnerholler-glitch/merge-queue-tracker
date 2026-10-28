import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatEta, isOwn, summarize, truncate } from "./format";
import type { QueueEntry } from "./types";

function entry(number: number, position: number, author: string, enqueuer = author): QueueEntry {
  return { repo: "org/app", number, title: `t${number}`, url: "", author, enqueuer, position, state: "QUEUED", enqueuedAt: "", etaSeconds: 60 * position };
}

describe("formatEta", () => {
  it.each([
    [null, null],
    [-5, null],
    [20, "<1m"],
    [240, "~4m"],
    [3600, "~1h"],
    [3900, "~1h 5m"],
  ])("%s → %s", (seconds, expected) => {
    expect(formatEta(seconds)).toBe(expected);
  });
});

describe("truncate", () => {
  it("keeps short titles and ends long ones with an ellipsis", () => {
    expect(truncate("  short  ")).toBe("short");
    const long = "a".repeat(70);
    expect(truncate(long)).toHaveLength(60);
    expect(truncate(long).endsWith("…")).toBe(true);
    expect(truncate("word ".repeat(20), 12)).toBe("word word w…");
  });
});

describe("formatClock", () => {
  it("renders hours and minutes, and nothing for bad input", () => {
    expect(formatClock("2026-10-28T11:42:00Z", "en-GB")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatClock("nope")).toBe("");
    expect(formatClock(null)).toBe("");
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45_000, "45s"],
    [300_000, "5m"],
    [3_600_000, "1h"],
    [3_900_000, "1h 5m"],
  ])("%d → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("isOwn", () => {
  it("matches author or enqueuer, ignoring case, and never matches an empty viewer", () => {
    expect(isOwn({ author: "Me", enqueuer: "x" }, "me")).toBe(true);
    expect(isOwn({ author: "x", enqueuer: "ME" }, "me")).toBe(true);
    expect(isOwn({ author: "x", enqueuer: "y" }, "me")).toBe(false);
    expect(isOwn({ author: "", enqueuer: "" }, "")).toBe(false);
  });
});

describe("summarize", () => {
  it("counts entries and picks the viewer's entry closest to the front", () => {
    const entries = [entry(1, 3, "me"), entry(2, 1, "other"), entry(3, 2, "other", "me")];
    const summary = summarize(entries, "me");
    expect(summary.total).toBe(3);
    expect(summary.ownCount).toBe(2);
    expect(summary.own?.number).toBe(3);
    expect(summarize([], "me")).toEqual({ total: 0, own: null, ownCount: 0 });
  });
});
