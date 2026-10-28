# Changelog

All notable changes to this extension are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
