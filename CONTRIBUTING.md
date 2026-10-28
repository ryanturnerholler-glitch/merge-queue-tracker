# Contributing

Thanks for helping. Bug reports and pull requests are welcome; for anything
larger than a fix, open an issue first so we can agree on the shape.

## Ground rules

- No telemetry, and no network calls except to the user's GitHub host.
- No tokens on disk. Auth goes through `vscode.authentication` only.
- Runtime dependencies stay near zero. Each one has to earn its place.
- Every user-facing string goes through `vscode.l10n.t()` or
  `package.nls.json`.
- Test fixtures are synthetic or recorded from the public demo repository,
  never from a real queue.

## Development

```bash
sh scripts/bootstrap.sh   # once per clone: git hooks and repo settings
npm install
npm run check             # lint + typecheck + unit tests
npm run build
```

Press F5 in VS Code to launch an Extension Development Host with the build.
`npm run l10n` regenerates `l10n/bundle.l10n.json` from the source strings.
`npx vsce package` produces the `.vsix`.

Every pull request must pass `npm run check` and `npx vsce package`; CI runs
both. Commits land through squash-merged pull requests only.

## What happens to your pull request

- Fork the repository and open a pull request against `main`. Nobody outside
  the project has push access, and `main` only accepts squash merges of pull
  requests whose checks pass.
- The maintainer approves the first CI run on a pull request from a fork
  (GitHub's "Approve and run" button), then reviews the change. CI runs with a
  read-only token and no secrets, so a workflow run can't publish or push.
- Review comments have to be resolved before the merge. The PR title becomes
  the commit subject on `main`, so keep it under 72 characters.
- Release tags are created by the maintainer only, and the release workflow
  is the only thing that publishes.

## Manual QA checklist

Run through this in a real VS Code window before a release, with the
**Merge Queue Tracker** output channel open. **Merge Queues: Toggle Demo
Mode** plays a scripted queue (enter, move, merge, removal, toasts) without
GitHub; use it for the UI items, then a real repository for the rest.

- [ ] **Empty state**: with no `mqTracker.repos`, the view shows the welcome
      text with *Add repository* and *Learn about merge queues*.
- [ ] **Add repository**: the picker lists your repositories, marks those with
      a merge queue, accepts a typed `owner/name` and a pasted GitHub URL, and
      the new row appears and polls within one interval.
- [ ] **No-queue repository**: a repository without a merge queue shows
      "No merge queue on <branch>", not an error.
- [ ] **Merge**: enqueue one of your pull requests; it appears with a position
      and ETA, then on merge moves to *Recent* with a check mark and an
      information toast with *Open PR*.
- [ ] **Removal**: a pull request that fails checks shows the cross icon, then
      on removal moves to *Recent* with the reason and a warning toast with
      *Open checks* and *Open PR*.
- [ ] **Unfocused window**: switch to another app; the log says polling
      paused and no polls happen until you return, when one fires at once.
- [ ] **Rate-limit backoff**: with the rate limit under 200 points (or a
      simulated API error), the tree shows a warning row and the log shows a
      five-minute or longer delay, without repeated toasts.
- [ ] **GHES**: with `mqTracker.enterpriseUri` and `github-enterprise.uri`
      set, sign-in uses the enterprise provider and queries hit that host.
- [ ] **Themes**: light, dark, and high-contrast all render the icons and the
      highlight for your own pull requests.
- [ ] **Remove**: the repository row's context menu removes it from settings.

## Releasing

Tag `vX.Y.Z` on `main` and push the tag. The release workflow runs the checks,
packages the `.vsix`, attaches it to a GitHub release, and, when the
`VSCE_PAT` and `OVSX_PAT` secrets exist, publishes to the VS Code Marketplace
and Open VSX. Update `CHANGELOG.md` and the version in `package.json` first.
