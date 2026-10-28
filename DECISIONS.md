# Decisions

Durable record of decisions and rejected directions, so they don't get rehashed.
Append new entries at the top.

---

## 2026-10-28 — Fresh repository with a single clean commit

The first private repo's scaffold squash commit message and one PR body
named the author's employer repos (a copied grep line; no file ever did).
The spec says such a repo can't be flipped public, so the project moved to
`merge-queue-tracker`, created private with one commit of the clean tree and
to be made public at v0.9.0. The old repo is archived. Rejected: rewriting
and force-pushing the old history, since GitHub keeps orphaned commits
reachable by SHA.

## 2026-10-28 — Runtime strings use vscode.l10n, manifest strings use package.nls.json

The spec asks for every user-facing string in `package.nls.json`. That file
only covers `package.json` (commands, settings, welcome text); VS Code's
mechanism for strings inside the extension code is `vscode.l10n.t()` with a
`l10n/bundle.l10n.json` that `npm run l10n` regenerates. Both are in place, so
a translator copies the two files per locale. Rejected: a hand-rolled lookup
table keyed into package.nls.json, which VS Code would not load per locale.

## 2026-10-28 — Test fixtures are synthetic until the demo organisation exists

The fixtures under `tests/fixtures/` are hand-written in the exact shape of
GitHub's GraphQL responses, using a fictional `mq-demo-org`. When the public
demo organisation is created for screenshots, re-record them from it and keep
the same file names.

## 2026-10-28 — Keep employer names out of git from the first commit

The spec's addendum says the public release needs a fresh repo if this one
ever had the author's employer, org, or repo names committed. Rather than plan
on a second repo, this one stays clean: the tracked repos live in the author's
VS Code user settings and the gitignored `.local/` folder, and the committed
spec refers to them only as "the author's repos". Rejected: committing the v1
spec verbatim and starting over for the public release.
