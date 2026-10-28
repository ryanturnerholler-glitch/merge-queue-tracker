export const ENTRY_STATES = ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "UNMERGEABLE", "LOCKED"] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

/** A repository from the `mqTracker.repos` setting. */
export interface TrackedRepo {
  owner: string;
  name: string;
  /** Branch whose queue to watch. Undefined means the repository's default branch. */
  branch?: string;
}

/** One pull request in a merge queue. */
export interface QueueEntry {
  /** `owner/name` as configured. */
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  enqueuer: string;
  position: number;
  state: EntryState;
  enqueuedAt: string;
  etaSeconds: number | null;
}

/** The queue of one tracked repository as of one poll. */
export interface RepoQueue {
  repo: string;
  /** The branch actually watched (resolved from the default branch when not configured). */
  branch: string;
  hasQueue: boolean;
  queueUrl: string | null;
  entries: QueueEntry[];
  /** How many entries the queue holds in total; more than `entries.length` when the page was cut off. */
  totalCount?: number;
  /** Set when GitHub could not return this repository (not found, no access). */
  error?: string;
  /** The error is GitHub's SAML single sign-on enforcement: the token needs authorizing for the organisation. */
  ssoRequired?: boolean;
}

export interface RateLimit {
  remaining: number;
  /** ISO timestamp. */
  resetAt: string;
}

export interface PollResult {
  viewer: string;
  repos: RepoQueue[];
  rateLimit: RateLimit | null;
}

/** A check or status that failed on the pull request's head commit. */
export interface FailedCheck {
  name: string;
  url: string | null;
}

/** Why a pull request left the queue. */
export type Outcome =
  | { kind: "merged"; at: string | null }
  | { kind: "removed"; at: string | null; reason: string | null; failedChecks?: FailedCheck[] };

export interface RecentEvent {
  entry: QueueEntry;
  outcome: Outcome;
  /** Epoch ms when the extension observed the change. */
  observedAt: number;
}
