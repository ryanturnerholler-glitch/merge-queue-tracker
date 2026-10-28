import type { RepoQueue } from "./types";

/** A queue snapshot older than this is not worth diffing against: start fresh instead. */
export const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const SNAPSHOT_KEY = "mqTracker.queues";
export const RECENT_KEY = "mqTracker.recent";
export const OWN_ONLY_KEY = "mqTracker.ownOnly";

/** The last poll, persisted so a window reload still notices what merged or was removed meanwhile. */
export interface QueueSnapshot {
  version: 1;
  /** The GraphQL endpoint the snapshot came from; another host's queues are not comparable. */
  endpoint: string;
  /** Epoch ms. */
  savedAt: number;
  repos: RepoQueue[];
}

export function makeSnapshot(endpoint: string, repos: RepoQueue[], now = Date.now()): QueueSnapshot {
  return { version: 1, endpoint, savedAt: now, repos };
}

/** The persisted queues, when they are from this endpoint, recent enough, and readable. */
export function restoreSnapshot(saved: unknown, endpoint: string, now = Date.now()): RepoQueue[] | undefined {
  if (!saved || typeof saved !== "object") return undefined;
  const s = saved as Partial<QueueSnapshot>;
  if (s.version !== 1 || s.endpoint !== endpoint || typeof s.savedAt !== "number") return undefined;
  if (now - s.savedAt > SNAPSHOT_MAX_AGE_MS || now < s.savedAt) return undefined;
  if (!Array.isArray(s.repos) || !s.repos.every(isRepoQueue)) return undefined;
  return s.repos;
}

function isRepoQueue(value: unknown): value is RepoQueue {
  if (!value || typeof value !== "object") return false;
  const q = value as Partial<RepoQueue>;
  return (
    typeof q.repo === "string" &&
    typeof q.branch === "string" &&
    typeof q.hasQueue === "boolean" &&
    Array.isArray(q.entries) &&
    q.entries.every((e) => e && typeof e === "object" && typeof e.repo === "string" && typeof e.number === "number")
  );
}
