import { describe, expect, it } from "vitest";
import { DEMO_VIEWER, DemoSource } from "./demo";
import { diffQueues } from "./queueDiff";
import { isOwn } from "./format";

describe("DemoSource", () => {
  it("plays a script that covers entered, moved, merged, and removed, including the viewer's own PRs", () => {
    const demo = new DemoSource();
    const seen = { entered: 0, moved: 0, merged: 0, removed: 0, ownLeft: 0 };
    let previous = demo.next().repos;
    for (let i = 0; i < 6; i++) {
      const next = demo.next().repos;
      const diff = diffQueues(previous, next);
      seen.entered += diff.entered.length;
      seen.moved += diff.moved.length;
      for (const [j, outcome] of demo.outcomes(diff.left).entries()) {
        if (outcome.kind === "merged") seen.merged++;
        else {
          seen.removed++;
          expect(outcome.reason).toBeTruthy();
        }
        if (isOwn(diff.left[j]!, DEMO_VIEWER)) seen.ownLeft++;
      }
      previous = next;
    }
    expect(seen.entered).toBeGreaterThan(0);
    expect(seen.moved).toBeGreaterThan(0);
    expect(seen.merged).toBe(3);
    expect(seen.removed).toBe(2);
    expect(seen.ownLeft).toBe(2);
    expect(previous[0]!.entries).toEqual([]);
  });

  it("loops and keeps positions contiguous", () => {
    const demo = new DemoSource();
    for (let i = 0; i < 9; i++) {
      const result = demo.next();
      expect(result.repos[0]!.entries.map((e) => e.position)).toEqual(result.repos[0]!.entries.map((_, j) => j + 1));
      expect(result.repos[1]!.hasQueue).toBe(false);
    }
  });
});
