import type { QueueEntry, RepoQueue } from "./types";

export interface QueueDiff {
  entered: QueueEntry[];
  moved: { entry: QueueEntry; from: number }[];
  /** Entries present last poll and gone now. Why they left is resolved separately. */
  left: QueueEntry[];
}

export function entryKey(entry: { repo: string; number: number }): string {
  return `${entry.repo.toLowerCase()}#${entry.number}`;
}

/**
 * Compares two polls. Repositories are only compared when both polls read their
 * queue successfully, so a failed poll or a newly added repository never produces
 * phantom "left" events.
 */
export function diffQueues(previous: RepoQueue[] | undefined, next: RepoQueue[]): QueueDiff {
  const diff: QueueDiff = { entered: [], moved: [], left: [] };
  if (!previous) return diff;
  const previousByRepo = new Map(previous.map((q) => [q.repo.toLowerCase(), q]));

  for (const queue of next) {
    const before = previousByRepo.get(queue.repo.toLowerCase());
    if (!before || before.error || queue.error || !before.hasQueue || !queue.hasQueue) continue;

    const remaining = new Map(before.entries.map((e) => [entryKey(e), e]));
    for (const entry of queue.entries) {
      const key = entryKey(entry);
      const was = remaining.get(key);
      if (!was) {
        diff.entered.push(entry);
        continue;
      }
      remaining.delete(key);
      if (was.position !== entry.position) diff.moved.push({ entry, from: was.position });
    }
    diff.left.push(...remaining.values());
  }
  return diff;
}
