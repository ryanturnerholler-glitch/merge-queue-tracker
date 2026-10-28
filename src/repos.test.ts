import { describe, expect, it } from "vitest";
import { MAX_REPOS, parseRepoInput, readTrackedRepos, remoteHost, repoKey, reposFromRemotes } from "./repos";

describe("parseRepoInput", () => {
  it.each([
    ["owner/name", "owner", "name"],
    ["  owner/name.git ", "owner", "name"],
    ["https://github.com/owner/name", "owner", "name"],
    ["https://github.com/owner/name/", "owner", "name"],
    ["https://github.com/owner/name/pull/12", "owner", "name"],
    ["github.com/owner/name.js", "owner", "name.js"],
    ["https://github.example.com/owner/name/queue/main", "owner", "name"],
    ["git@github.com:owner/name.git", "owner", "name"],
    ["ssh://git@github.com/owner/name.git", "owner", "name"],
    ["owner/name/extra", "owner", "name"],
  ])("parses %s", (input, owner, name) => {
    expect(parseRepoInput(input)).toEqual({ owner, name });
  });

  it.each(["", "   ", "name", "/name", "owner/", "owner//name", "-owner/name", "owner/na me", "https://github.com/", "owner/.."])(
    "rejects %j",
    (input) => {
      expect(parseRepoInput(input)).toBeUndefined();
    },
  );
});

describe("readTrackedRepos", () => {
  it("accepts objects and plain strings, keeps branch, and dedupes case-insensitively", () => {
    const result = readTrackedRepos([
      { repo: "Org/App", branch: "release" },
      "org/app",
      { repo: "https://github.com/org/docs" },
      { repo: "org/lib", branch: "  " },
    ]);
    expect(result.repos).toEqual([
      { owner: "Org", name: "App", branch: "release" },
      { owner: "org", name: "docs" },
      { owner: "org", name: "lib" },
    ]);
    expect(result.invalid).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  it("reports unreadable entries without dropping the rest", () => {
    const result = readTrackedRepos(["org/app", "not a repo", { branch: "main" }, 7, null]);
    expect(result.repos.map(repoKey)).toEqual(["org/app"]);
    expect(result.invalid).toEqual(["not a repo", '{"branch":"main"}', "7", "null"]);
  });

  it("caps the list and counts what was dropped", () => {
    const raw = Array.from({ length: MAX_REPOS + 3 }, (_, i) => `org/repo-${i}`);
    const result = readTrackedRepos(raw);
    expect(result.repos).toHaveLength(MAX_REPOS);
    expect(result.dropped).toBe(3);
  });

  it("treats a missing or non-array setting as empty", () => {
    expect(readTrackedRepos(undefined).repos).toEqual([]);
    expect(readTrackedRepos("org/app").repos).toEqual([]);
  });
});

describe("remoteHost", () => {
  it("reads the host from https, ssh, scp-style, and bare remotes", () => {
    expect(remoteHost("https://github.com/org/app.git")).toBe("github.com");
    expect(remoteHost("https://user:token@GitHub.com:443/org/app")).toBe("github.com");
    expect(remoteHost("git@github.com:org/app.git")).toBe("github.com");
    expect(remoteHost("ssh://git@ghe.example.com/org/app.git")).toBe("ghe.example.com");
    expect(remoteHost("ghe.example.com/org/app")).toBe("ghe.example.com");
    expect(remoteHost("")).toBeUndefined();
    expect(remoteHost("not a url at all")).toBeUndefined();
  });
});

describe("reposFromRemotes", () => {
  it("keeps only remotes on the given host, parsed and deduplicated in order", () => {
    const urls = [
      "git@github.com:Org/App.git",
      "https://github.com/org/app",
      "https://gitlab.com/org/app.git",
      "git@ghe.example.com:team/service.git",
      "https://github.com/org/other.git",
    ];
    expect(reposFromRemotes(urls, "github.com")).toEqual([
      { owner: "Org", name: "App" },
      { owner: "org", name: "other" },
    ]);
    expect(reposFromRemotes(urls, "GHE.example.com")).toEqual([{ owner: "team", name: "service" }]);
    expect(reposFromRemotes(urls, "bitbucket.org")).toEqual([]);
  });
});
