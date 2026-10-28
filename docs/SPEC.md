# Merge Queue Tracker — VS Code extension (build spec)

Written 2026-10-28. The addendum at the bottom overrides v1 where they
conflict. The repos the author tracks himself are not named here; they live in
his user settings.json and the gitignored `.local/` folder.

## Goal
A VS Code sidebar view that shows the live GitHub merge queues for the user's
repos, in the same tree style as the GitHub Pull Requests extension, plus
alerts when the user's PRs merge or get kicked out of the queue.

## Repo + packaging
- Standalone repo `mq-tracker`, private on the author's personal GitHub
  account.
- TypeScript, VS Code extension API, bundled with esbuild.
- Install locally as a .vsix (`vsce package` → "Install from VSIX").
  Do NOT publish to the Marketplace in v1.

## Repos to track (configurable)
Setting `mqTracker.repos` (array of `{ repo, branch }`). Ships empty; see the
addendum. The author's own two repos (both with merge queue enabled on main)
are configured in his user settings only.

## Auth
`vscode.authentication.getSession('github', ['repo'], { createIfNone: true })`.
Reuse VS Code's GitHub login. No PATs, no tokens on disk.

## Data source
GitHub GraphQL only (REST has no merge-queue endpoint). One query per poll
covering all repos via aliases:

```graphql
repository(owner, name) {
  mergeQueue(branch: "main") {
    url
    entries(first: 50) {
      nodes {
        position  state  enqueuedAt  estimatedTimeToMerge
        enqueuer { login }
        pullRequest { number title url author { login } }
      }
    }
  }
}
```

state values: QUEUED, AWAITING_CHECKS, MERGEABLE, UNMERGEABLE, LOCKED.

Removal detection: diff each poll against the previous one. When a PR leaves
the queue, fetch that PR's `merged` flag + latest RemovedFromMergeQueueEvent
(timelineItems) to get the reason. Merged → ✓. Removed → ✗ + reason.

## UI — sidebar
- Own view container (activity-bar icon) titled "Merge Queues". User can drag
  the view into the GitHub panel; VS Code remembers placement.
- TreeView layout:

```
˅ some-repo · main                      3
    ⟳ 1  #1234: title truncated…      ~4m
         author · checks running
    ◷ 2  #1235: title truncated…      ~9m
˅ other-repo · main                     0
    Queue empty
˅ Recent (last 2h)
    ✓ #1230  merged 11:42
    ✗ #1231  removed: <reason>   ↗
```

- Repo row: badge = queue count; inline action opens the GitHub queue page.
- Entry row icons: ⟳ AWAITING_CHECKS, ◷ QUEUED, ✓ MERGEABLE, ✗ UNMERGEABLE,
  🔒 LOCKED (use VS Code codicons, not emoji).
- Highlight rows where author or enqueuer = signed-in user.
- Click a row → open PR in browser. ↗ on removed → open the PR's checks tab.
- Title-bar buttons: refresh, open settings.
- Activity-bar icon badge = count of the user's own PRs currently queued.

## UI — status bar (left)
`$(git-merge) MQ 4 · yours: #1234 pos 1 ~4m`
Hidden when queues are empty. Click → focus the sidebar view.

## Notifications
Only for the signed-in user's PRs:
- Merged → info toast "#1234 merged" with [Open PR].
- Removed → warning toast "#1234 removed from queue: <reason>" with
  [Open checks] [Open PR].
Setting `mqTracker.notify` (true/false) to mute.

## Polling
- Every 45s while the VS Code window is focused; pause when unfocused,
  refresh immediately on refocus.
- Setting `mqTracker.pollSeconds` (min 15).
- On GraphQL errors or rate limit: show a warning row in the tree, back off
  to 5 min, don't spam toasts.

## Out of scope (v1)
Enqueue/dequeue actions, other branches, Marketplace publishing, team sharing,
webhooks.

## Done when
1. Installed in the author's VS Code; sidebar shows both of his repos.
2. Enqueue a real PR → it appears within one poll with position + ETA.
3. That PR merges → moves to Recent with ✓ and a toast fires.
4. A forced queue failure (or a PR known to fail checks) → ✗ with reason + toast.
5. Unfocus window → no polling (verify in Output channel log).

## Estimate
3–4 hours to working v1; +1 hour for polish on notifications/backoff.

---

# Addendum — Open-source release (overrides v1 spec where they conflict)

## Goal change
This is a public, free, MIT-licensed extension for anyone who uses GitHub
merge queues. Nothing in the code, history, README, screenshots, tests, or
fixtures may reference the author's employer, its org, or its repos.

## Overrides to v1
- `mqTracker.repos` ships EMPTY. Author's own repos live only in his
  user settings.json, never committed.
- First run with no repos → welcome view (viewsWelcome) with two buttons:
  [Add repository] and [Learn about merge queues] (link to GitHub docs).
- [Add repository] = QuickPick listing repos the signed-in user can access
  (viewer.repositories + organizations' repos, paginated, searchable),
  marking which have a merge queue on the default branch. Also accept a
  typed "owner/name" or full GitHub URL.
- Per-repo branch is configurable (default = repo's default branch, not
  hard-coded "main").
- Repo without a merge queue → row reads "No merge queue on <branch>",
  not an error.
- Remove repo: context-menu "Remove" on the repo row.

## Works for strangers, not just the author
- GitHub Enterprise Server: setting `mqTracker.enterpriseUri`; when set,
  use auth provider 'github-enterprise' and that host's GraphQL endpoint.
- Auth scope: 'repo' (needed for private repos). README explains why.
- Rate limits: one aliased GraphQL query per poll for ALL tracked repos;
  read rateLimit { remaining resetAt } in the same query and back off
  automatically when remaining < 200.
- Cap at 20 tracked repos; show a message past that.
- Light, dark, and high-contrast themes: codicons + ThemeColor only,
  no hard-coded colors.
- Every user-facing string in package.nls.json (ready for translation).
- No telemetry. No network calls except to the user's GitHub host.
  State this in the README.

## Repo setup (public, author's personal account)
- Start a FRESH repo for the public release if the private one ever had
  employer names committed. Do not flip a dirty repo to public.
- Files: LICENSE (MIT), README.md, CHANGELOG.md, CONTRIBUTING.md,
  SECURITY.md (how to report privately), CODE_OF_CONDUCT.md,
  .github/ISSUE_TEMPLATE (bug, feature), PULL_REQUEST_TEMPLATE.md.
- CI (GitHub Actions): lint + typecheck + unit tests + `vsce package` on
  every PR. Release workflow on tag `v*`: publish to VS Code Marketplace
  (secret VSCE_PAT) and Open VSX (secret OVSX_PAT), attach .vsix to the
  GitHub Release.
- Dependabot for npm + actions. Keep runtime dependencies near zero
  (use fetch; no Octokit unless needed).

## Tests
- Unit: queue-diff logic (entered / moved / merged / removed), state →
  icon mapping, repo-string parsing, backoff math. Use recorded GraphQL
  fixtures from a demo repo, never real employer data.
- Manual QA checklist in CONTRIBUTING.md: empty state, add repo, no-queue
  repo, merge, removal, unfocused window, rate-limit backoff, GHES.

## Demo repo for screenshots
- Merge queues exist only on org-owned repos [confirm against GitHub docs],
  so create a free personal demo org + public repo, enable the queue,
  and stage a few PRs. Screenshots/GIF for README + Marketplace come only
  from there.

## Marketplace listing
- Pick a name not already taken on the Marketplace or Open VSX [check
  before creating the publisher]. Working name: "Merge Queue Tracker".
- Publisher ID under the author's personal Microsoft account.
- package.json: displayName, description (one line: "See your GitHub
  merge queues in the sidebar and get alerted when your PR merges or gets
  kicked out."), icon (128x128 PNG), categories ["SCM Providers",
  "Other"], keywords [github, merge queue, pull request, ci], repository,
  bugs, homepage, galleryBanner, engines.vscode at a version ≥ 1 year old.
- README top: GIF of the sidebar, 3-line pitch, install button, quick
  start (sign in → add repo), settings table, FAQ (scopes, GHES, privacy).

## Release plan
1. v0.1.0 private: author uses it for ~1 week on his own repos.
2. Fix what breaks (alerts, backoff are the likely spots).
3. Fresh public repo → v0.9.0 published as "preview": true.
4. v1.0.0 after a week of no new bug reports; drop preview flag.

## Done when (adds to v1 checklist)
1. A clean VS Code profile with no settings installs from the Marketplace,
   signs in, adds a repo via QuickPick, and sees its queue.
2. Same works installed from Open VSX in Cursor or VSCodium.
3. `git log -p | grep -i` for employer name / org / repo names = no hits.
4. CI green; tagged release publishes to both stores automatically.

## Estimate
v1 private build 3–4h, plus 4–6h for this addendum (QuickPick, GHES,
tests, CI/release, README + GIF, listing).
