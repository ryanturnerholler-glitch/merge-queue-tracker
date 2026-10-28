import type { EntryState, Outcome, PollResult, QueueEntry, RepoQueue, TrackedRepo } from "./types";
import { ENTRY_STATES } from "./types";
import { repoKey } from "./repos";

export interface GraphQLError {
  message: string;
  type?: string;
  path?: (string | number)[];
}

export interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T | null;
  errors?: GraphQLError[];
}

export type GitHubErrorKind = "auth" | "rate-limit" | "network" | "http" | "graphql";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: GitHubErrorKind,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/** The GraphQL endpoint for github.com, or for a GitHub Enterprise Server host. */
export function graphqlEndpoint(enterpriseUri: string | undefined): string {
  const trimmed = enterpriseUri?.trim();
  if (!trimmed) return "https://api.github.com/graphql";
  const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  return `${url.origin}/api/graphql`;
}

/** The web URL of a merge queue page, used when GitHub did not return one. */
export function queuePageUrl(enterpriseUri: string | undefined, repo: TrackedRepo, branch: string): string {
  const origin = new URL(graphqlEndpoint(enterpriseUri)).origin.replace("://api.", "://");
  return `${origin}/${repo.owner}/${repo.name}/queue/${encodeURIComponent(branch)}`;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Posts one GraphQL request. Throws GitHubError on transport, auth, and whole-query failures. */
export async function graphql<T = Record<string, unknown>>(
  endpoint: string,
  token: string,
  query: string,
  variables: Record<string, unknown>,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<GraphQLResponse<T>> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "merge-queue-tracker",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    throw new GitHubError(`Network error: ${messageOf(error)}`, "network");
  }

  if (response.status === 401) {
    throw new GitHubError("GitHub rejected the sign-in token (401). Sign in again.", "auth");
  }
  if (response.status === 403 || response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? ` Retry after ${retryAfter}s.` : "";
    throw new GitHubError(`GitHub rate limit or access denied (${response.status}).${suffix}`, "rate-limit");
  }
  if (!response.ok) {
    throw new GitHubError(`GitHub returned HTTP ${response.status}.`, "http");
  }

  let body: GraphQLResponse<T>;
  try {
    body = (await response.json()) as GraphQLResponse<T>;
  } catch (error) {
    throw new GitHubError(`GitHub returned an unreadable response: ${messageOf(error)}`, "http");
  }
  if (!body.data && body.errors?.length) {
    const kind: GitHubErrorKind = body.errors.some((e) => e.type === "RATE_LIMITED") ? "rate-limit" : "graphql";
    throw new GitHubError(body.errors.map((e) => e.message).join("; "), kind);
  }
  return body;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Merge queue poll -------------------------------------------------------

const QUEUE_FRAGMENT = `fragment QueueFields on MergeQueue {
  url
  entries(first: 50) {
    nodes {
      position
      state
      enqueuedAt
      estimatedTimeToMerge
      enqueuer { login }
      pullRequest { number title url author { login } }
    }
  }
}`;

export interface BuiltQuery {
  query: string;
  variables: Record<string, string | number>;
}

/** One aliased query covering every tracked repository, plus the viewer and the rate limit. */
export function buildQueueQuery(repos: TrackedRepo[]): BuiltQuery {
  const declarations: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, string | number> = {};
  repos.forEach((repo, i) => {
    declarations.push(`$o${i}: String!`, `$n${i}: String!`);
    variables[`o${i}`] = repo.owner;
    variables[`n${i}`] = repo.name;
    let queueArgs = "";
    if (repo.branch) {
      declarations.push(`$b${i}: String!`);
      variables[`b${i}`] = repo.branch;
      queueArgs = `(branch: $b${i})`;
    }
    selections.push(
      `r${i}: repository(owner: $o${i}, name: $n${i}) { nameWithOwner defaultBranchRef { name } mergeQueue${queueArgs} { ...QueueFields } }`,
    );
  });
  const params = declarations.length ? `(${declarations.join(", ")})` : "";
  const query = `query MergeQueues${params} {
  viewer { login }
  rateLimit { remaining resetAt }
  ${selections.join("\n  ")}
}
${QUEUE_FRAGMENT}`;
  return { query, variables };
}

interface EntryNode {
  position?: number | null;
  state?: string | null;
  enqueuedAt?: string | null;
  estimatedTimeToMerge?: number | null;
  enqueuer?: { login?: string | null } | null;
  pullRequest?: {
    number?: number | null;
    title?: string | null;
    url?: string | null;
    author?: { login?: string | null } | null;
  } | null;
}

interface RepoNode {
  nameWithOwner?: string | null;
  defaultBranchRef?: { name?: string | null } | null;
  mergeQueue?: { url?: string | null; entries?: { nodes?: (EntryNode | null)[] | null } | null } | null;
}

export interface QueueResponseData {
  viewer?: { login?: string | null } | null;
  rateLimit?: { remaining?: number | null; resetAt?: string | null } | null;
  [alias: string]: unknown;
}

function toState(value: string | null | undefined): EntryState {
  return (ENTRY_STATES as readonly string[]).includes(value ?? "") ? (value as EntryState) : "QUEUED";
}

/** Turns the poll response into one RepoQueue per tracked repository, in the configured order. */
export function parseQueueResponse(repos: TrackedRepo[], response: GraphQLResponse<QueueResponseData>): PollResult {
  const data = response.data ?? {};
  const errors = response.errors ?? [];
  const queues = repos.map((repo, i): RepoQueue => {
    const alias = `r${i}`;
    const key = repoKey(repo);
    const node = data[alias] as RepoNode | null | undefined;
    if (!node) {
      const error = errors.find((e) => e.path?.[0] === alias)?.message ?? "Repository not found or not accessible.";
      return { repo: key, branch: repo.branch ?? "", hasQueue: false, queueUrl: null, entries: [], error };
    }
    const branch = repo.branch ?? node.defaultBranchRef?.name ?? "";
    const queue = node.mergeQueue;
    if (!queue) return { repo: key, branch, hasQueue: false, queueUrl: null, entries: [] };

    const entries = (queue.entries?.nodes ?? [])
      .filter((n): n is EntryNode => !!n?.pullRequest?.number)
      .map((n): QueueEntry => {
        const pr = n.pullRequest ?? {};
        return {
          repo: key,
          number: pr.number ?? 0,
          title: pr.title ?? "",
          url: pr.url ?? "",
          author: pr.author?.login ?? "",
          enqueuer: n.enqueuer?.login ?? "",
          position: n.position ?? 0,
          state: toState(n.state),
          enqueuedAt: n.enqueuedAt ?? "",
          etaSeconds: typeof n.estimatedTimeToMerge === "number" ? n.estimatedTimeToMerge : null,
        };
      })
      .sort((a, b) => a.position - b.position);
    return { repo: key, branch, hasQueue: true, queueUrl: queue.url ?? null, entries };
  });

  const remaining = data.rateLimit?.remaining;
  const resetAt = data.rateLimit?.resetAt;
  return {
    viewer: data.viewer?.login ?? "",
    repos: queues,
    rateLimit: typeof remaining === "number" && resetAt ? { remaining, resetAt } : null,
  };
}

// --- Why a pull request left the queue --------------------------------------

/** Looks up merged state and the latest removal event for pull requests that left a queue. */
export function buildOutcomeQuery(entries: { repo: string; number: number }[]): BuiltQuery {
  const declarations: string[] = [];
  const selections: string[] = [];
  const variables: Record<string, string | number> = {};
  entries.forEach((entry, i) => {
    const [owner = "", name = ""] = entry.repo.split("/");
    declarations.push(`$o${i}: String!`, `$n${i}: String!`, `$p${i}: Int!`);
    variables[`o${i}`] = owner;
    variables[`n${i}`] = name;
    variables[`p${i}`] = entry.number;
    selections.push(
      `p${i}: repository(owner: $o${i}, name: $n${i}) { pullRequest(number: $p${i}) { merged mergedAt timelineItems(last: 5, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes { ... on RemovedFromMergeQueueEvent { createdAt reason } } } } }`,
    );
  });
  const query = `query QueueOutcomes(${declarations.join(", ")}) {\n  ${selections.join("\n  ")}\n}`;
  return { query, variables };
}

export interface OutcomeResponseData {
  [alias: string]: {
    pullRequest?: {
      merged?: boolean | null;
      mergedAt?: string | null;
      timelineItems?: { nodes?: ({ createdAt?: string | null; reason?: string | null } | null)[] | null } | null;
    } | null;
  } | null;
}

export function parseOutcomes(count: number, response: GraphQLResponse<OutcomeResponseData>): Outcome[] {
  const data = response.data ?? {};
  return Array.from({ length: count }, (_, i): Outcome => {
    const pr = data[`p${i}`]?.pullRequest;
    if (pr?.merged) return { kind: "merged", at: pr.mergedAt ?? null };
    const events = (pr?.timelineItems?.nodes ?? []).filter((n) => n !== null);
    const last = events[events.length - 1];
    return { kind: "removed", at: last?.createdAt ?? null, reason: last?.reason?.trim() || null };
  });
}

// --- Repository picker ------------------------------------------------------

export interface RepoChoice {
  nameWithOwner: string;
  defaultBranch: string | null;
  hasQueue: boolean;
  isArchived: boolean;
}

export const VIEWER_REPOS_QUERY = `query ViewerRepos($after: String) {
  viewer {
    repositories(
      first: 50
      after: $after
      orderBy: { field: PUSHED_AT, direction: DESC }
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { nameWithOwner isArchived defaultBranchRef { name } mergeQueue { id } }
    }
  }
}`;

export const SEARCH_REPOS_QUERY = `query SearchRepos($q: String!) {
  search(query: $q, type: REPOSITORY, first: 20) {
    nodes { ... on Repository { nameWithOwner isArchived defaultBranchRef { name } mergeQueue { id } } }
  }
}`;

interface RepoChoiceNode {
  nameWithOwner?: string | null;
  isArchived?: boolean | null;
  defaultBranchRef?: { name?: string | null } | null;
  mergeQueue?: { id?: string | null } | null;
}

export interface ViewerReposData {
  viewer?: {
    repositories?: {
      pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
      nodes?: (RepoChoiceNode | null)[] | null;
    } | null;
  } | null;
}

export interface SearchReposData {
  search?: { nodes?: (RepoChoiceNode | null)[] | null } | null;
}

export function parseRepoChoices(nodes: (RepoChoiceNode | null)[] | null | undefined): RepoChoice[] {
  return (nodes ?? [])
    .filter((n): n is RepoChoiceNode => !!n?.nameWithOwner)
    .map((n) => ({
      nameWithOwner: n.nameWithOwner ?? "",
      defaultBranch: n.defaultBranchRef?.name ?? null,
      hasQueue: !!n.mergeQueue,
      isArchived: !!n.isArchived,
    }));
}
