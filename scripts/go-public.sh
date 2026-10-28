#!/bin/sh
# Applies the GitHub settings a public repository needs, once, right after the
# visibility flip. Everything here is free on public repositories and gated
# behind GitHub Pro on private ones, which is why scripts/bootstrap.sh can't do
# it. Safe to rerun: every step is an upsert.
#
#   gh repo edit --visibility public --accept-visibility-change-consequences
#   sh scripts/go-public.sh
#
# The flip itself stays a manual command on purpose.
set -e

visibility=$(gh repo view --json visibility --jq .visibility)
if [ "$visibility" != "PUBLIC" ]; then
  echo "go-public: repository is $visibility; make it public first, then rerun" >&2
  exit 1
fi

api() { gh api --silent "$@"; }
step() { echo "go-public: $1"; }

step "squash-only merges, delete branch on merge, no wiki or projects"
api -X PATCH "repos/{owner}/{repo}" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F allow_update_branch=true -F allow_auto_merge=false \
  -F has_wiki=false -F has_projects=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY

step "secret scanning and push protection"
api -X PATCH "repos/{owner}/{repo}" --input - <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" } } }
JSON

step "Dependabot alerts and security updates"
api -X PUT "repos/{owner}/{repo}/vulnerability-alerts"
api -X PUT "repos/{owner}/{repo}/automated-security-fixes"

step "private vulnerability reporting (the route SECURITY.md points at)"
api -X PUT "repos/{owner}/{repo}/private-vulnerability-reporting"

step "CodeQL default setup"
api -X PATCH "repos/{owner}/{repo}/code-scanning/default-setup" --input - <<'JSON'
{ "state": "configured", "query_suite": "default", "languages": ["javascript-typescript"] }
JSON

step "Actions: SHA-pinned actions only, read-only token, approval for every fork PR run"
api -X PUT "repos/{owner}/{repo}/actions/permissions" --input - <<'JSON'
{ "enabled": true, "allowed_actions": "all", "sha_pinning_required": true }
JSON
api -X PUT "repos/{owner}/{repo}/actions/permissions/workflow" --input - <<'JSON'
{ "default_workflow_permissions": "read", "can_approve_pull_request_reviews": false }
JSON
api -X PUT "repos/{owner}/{repo}/actions/permissions/fork-pr-contributor-approval" --input - <<'JSON'
{ "approval_policy": "all_external_contributors" }
JSON

# Rulesets are upserted by name so a rerun updates instead of duplicating.
upsert_ruleset() {
  name=$1; body=$2
  id=$(gh api "repos/{owner}/{repo}/rulesets" --jq ".[] | select(.name == \"$name\") | .id")
  if [ -n "$id" ]; then
    echo "$body" | api -X PUT "repos/{owner}/{repo}/rulesets/$id" --input -
  else
    echo "$body" | api -X POST "repos/{owner}/{repo}/rulesets" --input -
  fi
}

step "ruleset: main needs a PR with passing CI, no force push, no deletion, signed commits"
# No bypass actors: the maintainer goes through a PR too, as the pre-push hook
# already demands. Zero approvals so a solo maintainer can merge their own PR;
# the gate is CI. The contexts are the job ids in .github/workflows/*.yml.
upsert_ruleset main '{
  "name": "main", "target": "branch", "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "required_signatures" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"] } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "secrets" }, { "context": "check" }, { "context": "title" } ] } }
  ] }'

step "ruleset: v* release tags are created by admins only and never moved or deleted"
# The release workflow publishes on a tag push, so the tag namespace is the
# release trigger. Repository admins (actor 5) bypass the creation rule.
upsert_ruleset "release tags" '{
  "name": "release tags", "target": "tag", "enforcement": "active",
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [ { "type": "creation" }, { "type": "update" }, { "type": "deletion" }, { "type": "non_fast_forward" } ] }'

echo "go-public: done. Check the Security tab once CodeQL has run, then"
echo "go-public: consider adding its check to the main ruleset."
