import type { TrackedRepo } from "./types";

export const MAX_REPOS = 20;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]+$/;

function valid(owner: string, name: string): { owner: string; name: string } | undefined {
  const cleanName = name.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(cleanName) || /^\.+$/.test(cleanName)) return undefined;
  return { owner, name: cleanName };
}

/**
 * Accepts `owner/name`, a GitHub URL (`https://github.com/owner/name/pull/12`,
 * `github.com/owner/name`), or an SSH remote (`git@github.com:owner/name.git`).
 * Works for GitHub Enterprise hosts too, since only the path is used.
 */
export function parseRepoInput(input: string): { owner: string; name: string } | undefined {
  const text = input.trim();
  if (!text) return undefined;

  const ssh = /^(?:ssh:\/\/)?(?:git@)?[^:/\s]+:(?!\/\/)([^/\s]+)\/([^/\s]+?)\/?$/.exec(text);
  if (ssh && !text.includes("://")) return valid(ssh[1] ?? "", ssh[2] ?? "");

  let path = text;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[\w-]+(?:\.[\w-]+)+(?::\d+)?\//.test(text)) {
    try {
      path = new URL(text.includes("://") ? text : `https://${text}`).pathname;
    } catch {
      return undefined;
    }
  }
  const parts = path.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length < 2) return undefined;
  return valid(parts[0] ?? "", parts[1] ?? "");
}

/**
 * The host of a git remote URL, lower-cased and without credentials or port:
 * `git@github.com:o/n.git` and `https://user@github.com:443/o/n` both give `github.com`.
 */
export function remoteHost(url: string): string | undefined {
  const text = url.trim();
  if (!text) return undefined;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)[^/\s]+\/[^/\s]+\/?$/.exec(text);
  if (scp && !text.includes("://")) return scp[1]?.toLowerCase();
  try {
    return new URL(text.includes("://") ? text : `https://${text}`).hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

/** Repositories among the remote URLs that live on `host`, deduplicated and in order. */
export function reposFromRemotes(remoteUrls: string[], host: string): TrackedRepo[] {
  const seen = new Set<string>();
  const repos: TrackedRepo[] = [];
  for (const url of remoteUrls) {
    if (remoteHost(url) !== host.toLowerCase()) continue;
    const parsed = parseRepoInput(url);
    if (!parsed) continue;
    const key = repoKey(parsed).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(parsed);
  }
  return repos;
}

export function repoKey(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

export interface TrackedRepos {
  repos: TrackedRepo[];
  /** Setting entries that could not be parsed, as written. */
  invalid: string[];
  /** Repositories beyond the cap of MAX_REPOS, which are not tracked. */
  dropped: number;
}

/** Parses the raw `mqTracker.repos` setting value, deduplicating and capping it. */
export function readTrackedRepos(raw: unknown): TrackedRepos {
  const repos: TrackedRepo[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(raw)) return { repos, invalid, dropped: 0 };

  for (const item of raw) {
    let repoText: unknown;
    let branch: unknown;
    if (typeof item === "string") {
      repoText = item;
    } else if (item && typeof item === "object") {
      repoText = (item as { repo?: unknown }).repo;
      branch = (item as { branch?: unknown }).branch;
    }
    const parsed = typeof repoText === "string" ? parseRepoInput(repoText) : undefined;
    if (!parsed) {
      invalid.push(typeof repoText === "string" ? repoText : JSON.stringify(item));
      continue;
    }
    const key = repoKey(parsed).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const tracked: TrackedRepo = { owner: parsed.owner, name: parsed.name };
    if (typeof branch === "string" && branch.trim()) tracked.branch = branch.trim();
    repos.push(tracked);
  }

  const dropped = Math.max(0, repos.length - MAX_REPOS);
  return { repos: repos.slice(0, MAX_REPOS), invalid, dropped };
}
