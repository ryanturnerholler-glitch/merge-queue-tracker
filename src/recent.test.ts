import { describe, expect, it } from "vitest";
import { RecentEvents } from "./recent";
import type { QueueEntry } from "./types";

function entry(number: number): QueueEntry {
  return {
    repo: "org/app",
    number,
    title: "",
    url: "",
    author: "a",
    enqueuer: "a",
    position: 1,
    state: "QUEUED",
    enqueuedAt: "",
    etaSeconds: null,
  };
}

describe("RecentEvents", () => {
  it("lists newest first and drops events older than the window", () => {
    const recent = new RecentEvents(1000);
    recent.add({ entry: entry(1), outcome: { kind: "merged", at: null }, observedAt: 0 });
    recent.add({ entry: entry(2), outcome: { kind: "removed", at: null, reason: "x" }, observedAt: 500 });
    expect(recent.list(900).map((e) => e.entry.number)).toEqual([2, 1]);
    expect(recent.list(1200).map((e) => e.entry.number)).toEqual([2]);
    expect(recent.list(2000)).toEqual([]);
  });

  it("replaces an earlier event for the same pull request", () => {
    const recent = new RecentEvents();
    recent.add({ entry: entry(1), outcome: { kind: "removed", at: null, reason: "flaky" }, observedAt: 0 });
    recent.add({ entry: { ...entry(1), repo: "ORG/APP" }, outcome: { kind: "merged", at: null }, observedAt: 10 });
    const events = recent.list(20);
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome.kind).toBe("merged");
  });
});
