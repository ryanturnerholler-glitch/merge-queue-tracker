import { describe, expect, it } from "vitest";
import { makeSnapshot, restoreSnapshot, SNAPSHOT_MAX_AGE_MS } from "./state";
import type { RepoQueue } from "./types";

const endpoint = "https://api.github.com/graphql";
const repos: RepoQueue[] = [
  {
    repo: "org/app",
    branch: "main",
    hasQueue: true,
    queueUrl: null,
    entries: [
      { repo: "org/app", number: 1, title: "", url: "", author: "a", enqueuer: "a", position: 1, state: "QUEUED", enqueuedAt: "", etaSeconds: null },
    ],
  },
];

describe("snapshot", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");

  it("round-trips through JSON, as a Memento would store it", () => {
    const saved = JSON.parse(JSON.stringify(makeSnapshot(endpoint, repos, now))) as unknown;
    expect(restoreSnapshot(saved, endpoint, now + 60_000)).toEqual(repos);
  });

  it("ignores another host's snapshot, a stale one, one from the future, and garbage", () => {
    const saved = makeSnapshot(endpoint, repos, now);
    expect(restoreSnapshot(saved, "https://ghe.example.com/api/graphql", now)).toBeUndefined();
    expect(restoreSnapshot(saved, endpoint, now + SNAPSHOT_MAX_AGE_MS + 1)).toBeUndefined();
    expect(restoreSnapshot(saved, endpoint, now - 1)).toBeUndefined();
    expect(restoreSnapshot(undefined, endpoint, now)).toBeUndefined();
    expect(restoreSnapshot("nope", endpoint, now)).toBeUndefined();
    expect(restoreSnapshot({ version: 2, endpoint, savedAt: now, repos }, endpoint, now)).toBeUndefined();
    expect(restoreSnapshot({ version: 1, endpoint, savedAt: now, repos: [{ repo: 1 }] }, endpoint, now)).toBeUndefined();
    expect(restoreSnapshot({ version: 1, endpoint, savedAt: now, repos: [{ ...repos[0], entries: [{}] }] }, endpoint, now)).toBeUndefined();
  });
});
