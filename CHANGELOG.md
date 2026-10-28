# Changelog

All notable changes to this extension are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.9.0] - 2026-10-28

First public release, on the VS Code Marketplace and as a `.vsix` attached to
the GitHub release.

### Added

- Polling continues at a slower rate while the window is unfocused
  (`mqTracker.unfocusedPollSeconds`, default five minutes; `0` pauses as
  before), so merge and removal alerts arrive while you work elsewhere.
- The last poll, the "Recent" list, and the filter state survive a window
  reload, so a pull request that merged meanwhile still notifies.
- "Track This Workspace's Repository" adds the open folder's GitHub remote,
  from the view title, the welcome view, or the Command Palette.
- Removal alerts and "Recent" rows name the checks that failed, and
  "Open checks" jumps to the first failing check.
- Alerts when one of your pull requests becomes next to merge or turns
  unmergeable while queued (`mqTracker.notifyProgress`).
- A filter button that shows only your own pull requests.
- A "+N more in the queue" row when a queue has more than 50 entries.
- A "Single sign-on required" row, linking to the authorization page, when an
  organisation enforces SAML and VS Code's token is not authorised for it.
- "Show Merge Queues" command, and the view title shows when the last poll ran.
- A Get Started walkthrough.

### Changed

- `mqTracker.enterpriseUri` falls back to VS Code's `github-enterprise.uri`,
  so GitHub Enterprise users set one setting instead of two.
- Development dependencies updated (vitest 5, eslint 10, esbuild 0.28,
  vsce 4), clearing the open security advisories in the test tool chain.

## [0.1.0] - 2026-10-28

First private build.

### Added

- Sidebar view listing each tracked repository's merge queue with position,
  state icon, estimated time to merge, and author.
- Highlighting, activity-bar badge, and status bar summary for the signed-in
  user's own pull requests.
- Notifications when one of your pull requests merges or is removed from the
  queue, with the removal reason from GitHub.
- "Recent (last 2h)" section for pull requests that merged or were removed.
- Add repository via a searchable picker, typed `owner/name`, or a GitHub URL;
  remove via the repository row's context menu.
- Polling only while the window is focused, with five-minute backoff on
  errors and automatic slow-down when the GraphQL rate limit runs low.
- GitHub Enterprise Server support through `mqTracker.enterpriseUri`.
- Demo mode (`Merge Queues: Toggle Demo Mode`) that plays a scripted sample
  queue with no sign-in or network.
