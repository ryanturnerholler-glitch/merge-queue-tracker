import type { RecentEvent } from "./types";

export const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Pull requests that merged or were removed in the last two hours, newest first. */
export class RecentEvents {
  private items: RecentEvent[] = [];

  constructor(private readonly windowMs = RECENT_WINDOW_MS) {}

  add(event: RecentEvent): void {
    const key = `${event.entry.repo.toLowerCase()}#${event.entry.number}`;
    this.items = this.items.filter((e) => `${e.entry.repo.toLowerCase()}#${e.entry.number}` !== key);
    this.items.unshift(event);
  }

  list(now = Date.now()): RecentEvent[] {
    this.items = this.items.filter((e) => now - e.observedAt < this.windowMs);
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }

  /** Everything still inside the window, for persisting across window reloads. */
  snapshot(now = Date.now()): RecentEvent[] {
    return this.list(now);
  }

  /** Restores a persisted snapshot. Unreadable items are skipped; expired ones drop on the next `list`. */
  load(saved: unknown): void {
    if (!Array.isArray(saved)) return;
    this.items = [];
    const events = saved.filter(isRecentEvent).sort((a, b) => b.observedAt - a.observedAt);
    for (const event of events.reverse()) this.add(event);
  }
}

function isRecentEvent(value: unknown): value is RecentEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<RecentEvent>;
  const entry = v.entry as Partial<RecentEvent["entry"]> | undefined;
  const outcome = v.outcome as Partial<RecentEvent["outcome"]> | undefined;
  return (
    typeof v.observedAt === "number" &&
    !!entry &&
    typeof entry.repo === "string" &&
    typeof entry.number === "number" &&
    !!outcome &&
    (outcome.kind === "merged" || outcome.kind === "removed")
  );
}
