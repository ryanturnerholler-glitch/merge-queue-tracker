import type { EntryState, Outcome } from "./types";

/** A codicon id plus an optional theme color id, resolved into a ThemeIcon by the tree. */
export interface IconSpec {
  codicon: string;
  color?: string;
}

const STATE_ICONS: Record<EntryState, IconSpec> = {
  AWAITING_CHECKS: { codicon: "sync", color: "charts.blue" },
  QUEUED: { codicon: "clock" },
  MERGEABLE: { codicon: "check", color: "charts.green" },
  UNMERGEABLE: { codicon: "close", color: "charts.red" },
  LOCKED: { codicon: "lock", color: "charts.yellow" },
};

export function iconForState(state: EntryState): IconSpec {
  return STATE_ICONS[state];
}

export function iconForOutcome(outcome: Outcome): IconSpec {
  return outcome.kind === "merged" ? { codicon: "check", color: "charts.green" } : { codicon: "close", color: "charts.red" };
}
