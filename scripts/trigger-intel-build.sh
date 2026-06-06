#!/usr/bin/env bash
# trigger-intel-build.sh — manually run the "Cinematic Intel Builder" GitHub
# Action (intel-cron.yml) that pulls news + builds the Iran Watch feed.
#
# WHY THIS EXISTS / WHAT WORKS WHERE (read before reaching for another path):
#   • The GitHub MCP integration available to agents LACKS `actions: write`,
#     so mcp__github__actions_run_trigger returns 403 "Resource not accessible
#     by integration". It cannot dispatch workflows.
#   • The Vercel runtime endpoint POST /api/tv/intel/build/trigger uses
#     GITHUB_DISPATCH_TOKEN, which is provisioned for the eval/improvement path
#     and may be expired (401 Bad credentials).
#   • api.github.com IS reachable from the agent sandbox (egress-allowed); a
#     direct authenticated curl with a PAT is the reliable manual trigger.
#
# USAGE:
#   GH_DISPATCH_PAT=github_pat_xxx ./scripts/trigger-intel-build.sh [force]
#     force   optional; "force" or "1" bypasses the novelty/reuse gate so the
#             run always re-curates (and exercises the full-text + web-search
#             newsroom pass). Default: a normal gated build.
#
# TOKEN REQUIREMENTS (fine-grained PAT):
#   • Repository access: only asamaka/engzny
#   • Permissions: Actions → Read and write   (workflow_dispatch needs this)
#   Create at https://github.com/settings/tokens?type=beta . Pass it via the
#   GH_DISPATCH_PAT (or GITHUB_TOKEN) env var — never commit it.
set -euo pipefail

OWNER="${INTEL_REPO_OWNER:-asamaka}"
REPO="${INTEL_REPO_NAME:-engzny}"
WORKFLOW="intel-cron.yml"
REF="${INTEL_REF:-main}"
TOKEN="${GH_DISPATCH_PAT:-${GITHUB_TOKEN:-}}"

case "${1:-}" in force|1|true|--force) FORCE="true" ;; *) FORCE="false" ;; esac

if [ -z "$TOKEN" ]; then
  echo "ERROR: no token. Set GH_DISPATCH_PAT (fine-grained PAT, Actions:write on $OWNER/$REPO)." >&2
  exit 1
fi

echo "Dispatching $WORKFLOW on $OWNER/$REPO@$REF (force=$FORCE)…"
code=$(curl -s -o /tmp/intel-dispatch.out -w '%{http_code}' \
  -X POST "https://api.github.com/repos/$OWNER/$REPO/actions/workflows/$WORKFLOW/dispatches" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "{\"ref\":\"$REF\",\"inputs\":{\"force\":\"$FORCE\"}}")

if [ "$code" = "204" ]; then
  echo "✅ dispatched. Watch: https://github.com/$OWNER/$REPO/actions/workflows/$WORKFLOW"
  echo "   Result feed (≈2-4 min): https://www.thinx.fun/api/tv/intel/public  (or /m)"
else
  echo "❌ dispatch failed (HTTP $code):" >&2
  cat /tmp/intel-dispatch.out >&2; echo >&2
  [ "$code" = "401" ] && echo "   → token invalid/expired." >&2
  [ "$code" = "403" ] && echo "   → token lacks Actions:write on $OWNER/$REPO." >&2
  [ "$code" = "404" ] && echo "   → workflow/ref not found, or token can't see the repo." >&2
  exit 1
fi
