#!/usr/bin/env bash
set -euo pipefail

media_path=$(bash tools/ci/provide-media.sh)
eval "$media_path"
bunx --no-install checks-test --pr --tier=e2e

if [[ ${GITHUB_EVENT_NAME:-} == pull_request && ${GITHUB_HEAD_REF:-} != "release/${GITHUB_BASE_REF:-}" ]]; then
  if base=$(jq -er '.pull_request.base.sha' "$GITHUB_EVENT_PATH") &&
    git diff --quiet "$base...HEAD" -- tools/pdf tools/ci .github/actions .github/workflows/ci.yml; then
    echo "PDF: no change to the renderer, its tests, its dependencies or its CI setup"
    exit 0
  fi
fi
exec uv run --project tools/pdf python tools/pdf/test_page.py
