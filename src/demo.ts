import type { EntryState, Outcome, PollResult, QueueEntry, RepoQueue, TrackedRepo } from "./types";

/**
 * Demo mode: a scripted queue that plays through enqueue, reorder, merge, and
 * removal without GitHub or a sign-in. Used to try the extension, take
 * screenshots, and QA notifications. Every string here is sample data.
 */
export const DEMO_VIEWER = "you";
export const DEMO_POLL_MS = 6000;
export const DEMO_REPOS: TrackedRepo[] = [
  { owner: "mq-demo-org", name: "demo-app" },
  { owner: "mq-demo-org", name: "demo-docs" },
];

const APP = "mq-demo-org/demo-app";

interface DemoPr {
  title: string;
  author: string;
  enqueuer: string;
}

const PRS: Record<number, DemoPr> = {
  41: { title: "Bump dependencies for the October release train", author: "dependabot", enqueuer: "octo-reviewer" },
  42: { title: "Add retry to the upload client", author: DEMO_VIEWER, enqueuer: DEMO_VIEWER },
  43: { title: "Rename config keys", author: "octo-reviewer", enqueuer: "octo-reviewer" },
  44: { title: "Fix flaky scheduler test", author: "octo-reviewer", enqueuer: DEMO_VIEWER },
  45: { title: "Document the merge queue setup", author: "sam-writes", enqueuer: "sam-writes" },
};

/** [number, state, etaSeconds] in queue order; position is the index + 1. */
type Step = [number, EntryState, number | null][];

const STEPS: Step[] = [
  [
    [41, "AWAITING_CHECKS", 240],
    [42, "QUEUED", 540],
    [43, "UNMERGEABLE", null],
  ],
  [
    [41, "MERGEABLE", 30],
    [42, "AWAITING_CHECKS", 300],
    [43, "UNMERGEABLE", null],
    [44, "QUEUED", 600],
  ],
  [
    [42, "AWAITING_CHECKS", 200],
    [44, "QUEUED", 500],
    [45, "LOCKED", 800],
  ],
  [
    [42, "MERGEABLE", 20],
    [44, "AWAITING_CHECKS", 400],
    [45, "LOCKED", 700],
  ],
  [
    [44, "AWAITING_CHECKS", 250],
    [45, "QUEUED", 550],
  ],
  [[45, "MERGEABLE", 40]],
  [],
];

const OUTCOMES: Record<number, Outcome> = {
  41: { kind: "merged", at: null },
  42: { kind: "merged", at: null },
  43: { kind: "removed", at: null, reason: "The merge queue removed this pull request because a required check failed" },
  44: { kind: "removed", at: null, reason: "Removed by octo-reviewer" },
  45: { kind: "merged", at: null },
};

export class DemoSource {
  private step = 0;

  /** The next scripted poll. Loops back to the start after the queue empties. */
  next(now = Date.now()): PollResult {
    const script = STEPS[this.step] ?? [];
    this.step = (this.step + 1) % STEPS.length;
    const entries = script.map(([number, state, etaSeconds], i): QueueEntry => {
      const pr = PRS[number] ?? { title: `Pull request ${number}`, author: "someone", enqueuer: "someone" };
      return {
        repo: APP,
        number,
        title: pr.title,
        url: `https://github.com/${APP}/pull/${number}`,
        author: pr.author,
        enqueuer: pr.enqueuer,
        position: i + 1,
        state,
        enqueuedAt: new Date(now - (i + 1) * 3 * 60_000).toISOString(),
        etaSeconds,
      };
    });
    const repos: RepoQueue[] = [
      { repo: APP, branch: "main", hasQueue: true, queueUrl: `https://github.com/${APP}/queue/main`, entries },
      { repo: "mq-demo-org/demo-docs", branch: "main", hasQueue: false, queueUrl: null, entries: [] },
    ];
    return { viewer: DEMO_VIEWER, repos, rateLimit: { remaining: 4990, resetAt: new Date(now + 3_600_000).toISOString() } };
  }

  outcomes(left: QueueEntry[], now = Date.now()): Outcome[] {
    const at = new Date(now).toISOString();
    return left.map((entry) => {
      const outcome = OUTCOMES[entry.number] ?? { kind: "removed", at: null, reason: null };
      return { ...outcome, at };
    });
  }

  reset(): void {
    this.step = 0;
  }
}
