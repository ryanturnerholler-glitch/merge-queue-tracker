import { describe, expect, it } from "vitest";
import { iconForOutcome, iconForState } from "./icons";
import { ENTRY_STATES } from "./types";

describe("iconForState", () => {
  it("maps every queue state to a codicon", () => {
    expect(Object.fromEntries(ENTRY_STATES.map((s) => [s, iconForState(s)]))).toEqual({
      AWAITING_CHECKS: { codicon: "sync", color: "charts.blue" },
      QUEUED: { codicon: "clock" },
      MERGEABLE: { codicon: "check", color: "charts.green" },
      UNMERGEABLE: { codicon: "close", color: "charts.red" },
      LOCKED: { codicon: "lock", color: "charts.yellow" },
    });
  });

  it("only uses theme colors, never literal colors", () => {
    for (const state of ENTRY_STATES) {
      expect(iconForState(state).color ?? "charts.x").toMatch(/^charts\./);
    }
  });
});

describe("iconForOutcome", () => {
  it("shows a check for merged and a cross for removed", () => {
    expect(iconForOutcome({ kind: "merged", at: null })).toEqual({ codicon: "check", color: "charts.green" });
    expect(iconForOutcome({ kind: "removed", at: null, reason: null })).toEqual({ codicon: "close", color: "charts.red" });
  });
});
