import { describe, expect, it } from "vitest";
import { diffQueues } from "./queueDiff";
import type { QueueEntry, RepoQueue } from "./types";

function entry(number: number, position: number, repo = "org/app"): QueueEntry {
  return {
    repo,
    number,
    title: `PR ${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    author: "someone",
    enqueuer: "someone",
    position,
    state: "QUEUED",
    enqueuedAt: "2026-10-28T12:00:00Z",
    etaSeconds: null,
  };
}

function queue(entries: QueueEntry[], extra: Partial<RepoQueue> = {}): RepoQueue {
  return { repo: "org/app", branch: "main", hasQueue: true, queueUrl: null, entries, ...extra };
}

describe("diffQueues", () => {
  it("reports nothing on the first poll", () => {
    expect(diffQueues(undefined, [queue([entry(1, 1)])])).toEqual({ entered: [], moved: [], changed: [], left: [] });
  });

  it("detects entered, moved, and left entries", () => {
    const before = [queue([entry(1, 1), entry(2, 2), entry(3, 3)])];
    const after = [queue([entry(2, 1), entry(3, 2), entry(4, 3)])];
    const diff = diffQueues(before, after);
    expect(diff.entered.map((e) => e.number)).toEqual([4]);
    expect(diff.moved.map((m) => [m.entry.number, m.from, m.entry.position])).toEqual([
      [2, 2, 1],
      [3, 3, 2],
    ]);
    expect(diff.left.map((e) => e.number)).toEqual([1]);
  });

  it("matches repositories case-insensitively and keeps repositories apart", () => {
    const before = [queue([entry(1, 1, "Org/App")], { repo: "Org/App" }), queue([entry(1, 1, "org/other")], { repo: "org/other" })];
    const after = [queue([entry(1, 1, "org/app")], { repo: "org/app" }), queue([], { repo: "org/other" })];
    const diff = diffQueues(before, after);
    expect(diff.left.map((e) => e.repo)).toEqual(["org/other"]);
    expect(diff.entered).toEqual([]);
  });

  it("ignores repositories that errored in either poll, lost their queue, or are new", () => {
    const before = [
      queue([entry(1, 1)]),
      queue([entry(5, 1, "org/b")], { repo: "org/b" }),
      queue([entry(7, 1, "org/c")], { repo: "org/c" }),
    ];
    const after = [
      queue([], { error: "boom" }),
      queue([], { repo: "org/b", hasQueue: false }),
      queue([entry(7, 1, "org/c")], { repo: "org/c" }),
      queue([entry(9, 1, "org/new")], { repo: "org/new" }),
    ];
    expect(diffQueues(before, after)).toEqual({ entered: [], moved: [], changed: [], left: [] });
  });

  it("reports state changes separately from moves", () => {
    const before = [queue([entry(1, 1), { ...entry(2, 2), state: "AWAITING_CHECKS" }])];
    const after = [queue([{ ...entry(1, 1), state: "MERGEABLE" }, { ...entry(2, 1), state: "AWAITING_CHECKS" }, entry(3, 2)])];
    const diff = diffQueues(before, after);
    expect(diff.changed).toEqual([{ entry: after[0]!.entries[0], from: "QUEUED" }]);
    expect(diff.moved.map((m) => m.entry.number)).toEqual([2]);
    expect(diff.entered.map((e) => e.number)).toEqual([3]);
  });
});
