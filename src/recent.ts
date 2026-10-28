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
}
