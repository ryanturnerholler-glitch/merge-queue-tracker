import type { QueueEntry } from "./types";

/** `~4m`, `~1h 5m`, or `<1m`. Null when GitHub gave no estimate. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `~${hours}h ${rest}m` : `~${hours}h`;
}

export function truncate(text: string, max = 60): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Local wall-clock time like `11:42` for an ISO timestamp; empty when unparsable. */
export function formatClock(iso: string | null, locale?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

export function isOwn(entry: { author: string; enqueuer: string }, viewer: string): boolean {
  if (!viewer) return false;
  const me = viewer.toLowerCase();
  return entry.author.toLowerCase() === me || entry.enqueuer.toLowerCase() === me;
}

export interface QueueSummary {
  total: number;
  /** The viewer's own entry closest to the front, if any. */
  own: QueueEntry | null;
  ownCount: number;
}

export function summarize(entries: QueueEntry[], viewer: string): QueueSummary {
  const own = entries.filter((e) => isOwn(e, viewer)).sort((a, b) => a.position - b.position);
  return { total: entries.length, own: own[0] ?? null, ownCount: own.length };
}

/** `45s`, `5m`, `1h 5m`, for log lines and the retry notice. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
