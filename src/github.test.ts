import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildOutcomeQuery,
  buildQueueQuery,
  GitHubError,
  graphql,
  graphqlEndpoint,
  parseOutcomes,
  parseQueueResponse,
  parseRepoChoices,
  queuePageUrl,
  type GraphQLResponse,
  type OutcomeResponseData,
  type QueueResponseData,
  type ViewerReposData,
} from "./github";
import type { TrackedRepo } from "./types";

function fixture<T>(name: string): GraphQLResponse<T> {
  return JSON.parse(readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), "utf8")) as GraphQLResponse<T>;
}

const repos: TrackedRepo[] = [
  { owner: "mq-demo-org", name: "demo-app" },
  { owner: "mq-demo-org", name: "demo-docs", branch: "trunk" },
  { owner: "mq-demo-org", name: "missing" },
];

describe("graphqlEndpoint", () => {
  it("defaults to github.com", () => {
    expect(graphqlEndpoint(undefined)).toBe("https://api.github.com/graphql");
    expect(graphqlEndpoint("  ")).toBe("https://api.github.com/graphql");
  });

  it("uses the enterprise host's /api/graphql", () => {
    expect(graphqlEndpoint("https://github.example.com")).toBe("https://github.example.com/api/graphql");
    expect(graphqlEndpoint("github.example.com/")).toBe("https://github.example.com/api/graphql");
    expect(graphqlEndpoint("https://github.example.com/some/path")).toBe("https://github.example.com/api/graphql");
  });
});

describe("queuePageUrl", () => {
  it("builds the queue page for github.com and GHES", () => {
    expect(queuePageUrl(undefined, { owner: "o", name: "n" }, "main")).toBe("https://github.com/o/n/queue/main");
    expect(queuePageUrl("https://ghe.example.com", { owner: "o", name: "n" }, "release/1.0")).toBe(
      "https://ghe.example.com/o/n/queue/release%2F1.0",
    );
  });
});

describe("buildQueueQuery", () => {
  it("aliases every repository and only passes a branch when one is configured", () => {
    const built = buildQueueQuery(repos);
    expect(built.variables).toEqual({
      o0: "mq-demo-org",
      n0: "demo-app",
      o1: "mq-demo-org",
      n1: "demo-docs",
      b1: "trunk",
      o2: "mq-demo-org",
      n2: "missing",
    });
    expect(built.query).toContain("r0: repository(owner: $o0, name: $n0) { nameWithOwner defaultBranchRef { name } mergeQueue { ...QueueFields } }");
    expect(built.query).toContain("mergeQueue(branch: $b1)");
    expect(built.query).toContain("viewer { login }");
    expect(built.query).toContain("rateLimit { remaining resetAt }");
    expect(built.query).not.toContain("$b0");
  });

  it("is valid with no repositories", () => {
    expect(buildQueueQuery([]).query).toMatch(/^query MergeQueues \{/);
  });
});

describe("parseQueueResponse", () => {
  const result = parseQueueResponse(repos, fixture<QueueResponseData>("queues.json"));

  it("reads the viewer and rate limit", () => {
    expect(result.viewer).toBe("demo-user");
    expect(result.rateLimit).toEqual({ remaining: 4987, resetAt: "2026-10-28T13:00:00Z" });
  });

  it("returns queues in configured order with entries sorted by position", () => {
    expect(result.repos.map((r) => r.repo)).toEqual(["mq-demo-org/demo-app", "mq-demo-org/demo-docs", "mq-demo-org/missing"]);
    const app = result.repos[0]!;
    expect(app.hasQueue).toBe(true);
    expect(app.branch).toBe("main");
    expect(app.queueUrl).toBe("https://github.com/mq-demo-org/demo-app/queue/main");
    expect(app.entries.map((e) => [e.position, e.number, e.state])).toEqual([
      [1, 41, "AWAITING_CHECKS"],
      [2, 42, "QUEUED"],
      [3, 43, "UNMERGEABLE"],
    ]);
    expect(app.entries[1]).toMatchObject({
      repo: "mq-demo-org/demo-app",
      author: "demo-user",
      enqueuer: "demo-user",
      etaSeconds: 540,
      url: "https://github.com/mq-demo-org/demo-app/pull/42",
    });
    expect(app.entries[2]!.etaSeconds).toBeNull();
  });

  it("marks a repository without a queue, keeping the configured branch", () => {
    expect(result.repos[1]).toEqual({
      repo: "mq-demo-org/demo-docs",
      branch: "trunk",
      hasQueue: false,
      queueUrl: null,
      entries: [],
    });
  });

  it("attaches the GraphQL error to a repository that came back null", () => {
    expect(result.repos[2]!.error).toContain("Could not resolve to a Repository");
    expect(result.repos[2]!.hasQueue).toBe(false);
  });

  it("falls back to QUEUED for an unknown state", () => {
    const response: GraphQLResponse<QueueResponseData> = {
      data: {
        r0: {
          mergeQueue: {
            entries: { nodes: [{ position: 1, state: "SOMETHING_NEW", pullRequest: { number: 1 } }] },
          },
        },
      },
    };
    const parsed = parseQueueResponse([{ owner: "o", name: "n" }], response);
    expect(parsed.repos[0]!.entries[0]!.state).toBe("QUEUED");
    expect(parsed.rateLimit).toBeNull();
  });
});

describe("outcomes", () => {
  const left = [
    { repo: "mq-demo-org/demo-app", number: 40 },
    { repo: "mq-demo-org/demo-app", number: 39 },
    { repo: "mq-demo-org/demo-app", number: 38 },
  ];

  it("builds one aliased lookup per pull request", () => {
    const built = buildOutcomeQuery(left);
    expect(built.variables).toMatchObject({ o0: "mq-demo-org", n0: "demo-app", p0: 40, p2: 38 });
    expect(built.query).toContain("p1: repository(owner: $o1, name: $n1) { pullRequest(number: $p1)");
    expect(built.query).toContain("RemovedFromMergeQueueEvent { createdAt reason }");
  });

  it("classifies merged, removed with the latest reason, and unknown", () => {
    expect(parseOutcomes(3, fixture<OutcomeResponseData>("outcomes.json"))).toEqual([
      { kind: "merged", at: "2026-10-28T12:12:30Z" },
      {
        kind: "removed",
        at: "2026-10-28T12:14:10Z",
        reason: "The merge queue removed this pull request because a required check failed",
      },
      { kind: "removed", at: null, reason: null },
    ]);
  });
});

describe("parseRepoChoices", () => {
  it("skips null nodes and flags queues and archived repos", () => {
    const nodes = fixture<ViewerReposData>("viewer-repos.json").data!.viewer!.repositories!.nodes;
    expect(parseRepoChoices(nodes)).toEqual([
      { nameWithOwner: "mq-demo-org/demo-app", defaultBranch: "main", hasQueue: true, isArchived: false },
      { nameWithOwner: "demo-user/dotfiles", defaultBranch: "main", hasQueue: false, isArchived: false },
      { nameWithOwner: "mq-demo-org/old-site", defaultBranch: null, hasQueue: false, isArchived: true },
    ]);
  });
});

describe("graphql", () => {
  const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) => async () =>
    new Response(JSON.stringify(body), { status, headers });

  it("posts the query with a bearer token and returns the body", async () => {
    let seen: { input: string; init: RequestInit } | undefined;
    const response = await graphql("https://api.github.com/graphql", "tok", "query { viewer { login } }", {}, async (input, init) => {
      seen = { input, init };
      return new Response(JSON.stringify({ data: { viewer: { login: "x" } } }));
    });
    expect(response.data).toEqual({ viewer: { login: "x" } });
    expect(seen?.input).toBe("https://api.github.com/graphql");
    expect((seen?.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(seen?.init.body as string)).toEqual({ query: "query { viewer { login } }", variables: {} });
  });

  it("maps 401 to an auth error", async () => {
    await expect(graphql("e", "t", "q", {}, ok({}, 401))).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps 403 and 429 to rate-limit errors with retry-after", async () => {
    const error = await graphql("e", "t", "q", {}, ok({}, 403, { "retry-after": "60" })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).kind).toBe("rate-limit");
    expect((error as GitHubError).message).toContain("60s");
  });

  it("throws when there is no data at all, flagging RATE_LIMITED", async () => {
    await expect(
      graphql("e", "t", "q", {}, ok({ errors: [{ message: "API rate limit exceeded", type: "RATE_LIMITED" }] })),
    ).rejects.toMatchObject({ kind: "rate-limit", message: "API rate limit exceeded" });
  });

  it("returns partial data together with its errors", async () => {
    const response = await graphql("e", "t", "q", {}, ok({ data: { r0: null }, errors: [{ message: "nope", path: ["r0"] }] }));
    expect(response.data).toEqual({ r0: null });
    expect(response.errors).toHaveLength(1);
  });

  it("wraps network failures", async () => {
    await expect(
      graphql("e", "t", "q", {}, async () => {
        throw new Error("ECONNRESET");
      }),
    ).rejects.toMatchObject({ kind: "network", message: "Network error: ECONNRESET" });
  });
});
