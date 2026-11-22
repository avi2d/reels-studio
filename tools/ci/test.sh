#!/usr/bin/env bash
set -euo pipefail
# The generated test step runs one plain command, so the job's logic lives here:
# provision the media tools, run the bun suite, then run the PDF suite.
eval "$(bash "$(cd "$(dirname "$0")" && pwd)/provide-media.sh")"
bun run test --pr
uv run --project tools/pdf python tools/pdf/test_page.py
