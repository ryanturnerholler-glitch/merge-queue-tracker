#!/bin/sh
# One-time setup for a repo made from repo-template, and for every fresh clone.
# A template copies files only: it can't set the hooks path or repo settings.
set -e
git config core.hooksPath .githooks
command -v gitleaks >/dev/null 2>&1 || echo "bootstrap: install gitleaks (brew install gitleaks) or commits will be refused" >&2
echo "bootstrap: hooks on"
if command -v gh >/dev/null 2>&1 && gh repo view >/dev/null 2>&1; then
  # The settings in STANDARDS.md "Repo settings (GitHub)".
  gh api -X PATCH "repos/{owner}/{repo}" --silent \
    -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
    -F delete_branch_on_merge=true -F allow_update_branch=true \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
  gh api -X PUT "repos/{owner}/{repo}/vulnerability-alerts" --silent
  gh api -X PUT "repos/{owner}/{repo}/automated-security-fixes" --silent
  echo "bootstrap: squash-only merges, delete-branch-on-merge, Dependabot alerts and security updates on"
else
  echo "bootstrap: no GitHub repo yet; rerun after the first push for repo settings" >&2
fi
