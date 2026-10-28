# mq-tracker — Claude Code Guide

A VS Code extension that shows live GitHub merge queues in the sidebar and
alerts the signed-in user when their PR merges or gets kicked out of the queue.
Built for Ryan first (private, installed from a `.vsix`), then released free
under MIT. Claude implements end-to-end; Ryan drives from Claude Code chats.

The build spec is [`docs/SPEC.md`](docs/SPEC.md). Read it before any work.

## Hard rules

- **No employer names in git, ever.** Not in code, comments, tests, fixtures,
  README, screenshots, or commit messages. The repos Ryan actually tracks live
  in his VS Code user `settings.json` and in the gitignored `.local/` folder.
  The spec's addendum requires a fresh repo for the public release if this one
  ever has them committed, so keep it clean from day one.
- **No tokens on disk.** Auth goes through `vscode.authentication` only.
- **No network calls except to the user's GitHub host.** No telemetry.
- Never publish to the Marketplace or Open VSX without Ryan saying so.
- Runtime dependencies stay near zero. Each one must earn its place.

## How to work here

- `npm run check` (lint + typecheck + unit tests) must pass before a PR, and
  `npx vsce package` must produce a `.vsix`. Add these as the real CI check in
  `.github/workflows/ci.yml` in the PR that sets up the project.
- Verify in a real VS Code window, not just tests: install the `.vsix`, and
  check the Output channel for polling behaviour.
- Test fixtures are recorded from a demo repo, never from real queues.
- Going public is Ryan's command to run, never Claude's. Right after it, run
  `sh scripts/go-public.sh` for the rulesets and security settings that are
  only available on public repos.

## Repo standards

Follows [Personal-Projects/STANDARDS.md](https://github.com/ryanturnerholler-glitch/Personal-Projects/blob/main/STANDARDS.md):
PR-only squash merges, gitleaks in `.githooks/` and CI, Dependabot. On a fresh
clone run `sh scripts/bootstrap.sh`. Design and writing rules load in every
session from `~/.claude/CLAUDE.md`.
