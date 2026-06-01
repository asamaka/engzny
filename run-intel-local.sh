#!/usr/bin/env bash
# Local mirror of the cloud cron: rebuild the cinematic intel bundle every
# INTEL_INTERVAL seconds. engzny (running locally) serves the latest via
# GET /api/tv/intel (file fallback). Used until the GitHub Actions cron + prod
# deploy take over delivery from thinx.fun.
set -u
cd "$(dirname "$0")"
INTERVAL="${INTEL_INTERVAL:-600}"
LOG="$(pwd)/intel-local.log"
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then source "$HOME/.zshrc" >/dev/null 2>&1 || true; fi
echo "[intel-local] start $(date) interval ${INTERVAL}s" | tee -a "$LOG"
while true; do
  echo "[intel-local] $(date '+%H:%M:%S') building..." >> "$LOG"
  node scripts/build-intel.js >> "$LOG" 2>&1 && echo "[intel-local] ok" >> "$LOG" || echo "[intel-local] FAILED (kept previous)" >> "$LOG"
  sleep "$INTERVAL"
done
