#!/usr/bin/env bash
set -euo pipefail
# Correctness gate for the tuning loop. The only in-scope edit is
# skills/you-web/SKILL.md (markdown — biome ignores it), so this is pure safety:
# it catches any accidental drift in off-limits TS without ever blocking on the
# skill itself. Matches the project's own `bun run check` (typecheck + test + biome).
bun run check
