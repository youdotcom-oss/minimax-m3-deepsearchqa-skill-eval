#!/usr/bin/env bash
set -euo pipefail
# Correctness gate for the tuning loop. The only in-scope edit is
# skills/you-web/SKILL.md (markdown — biome ignores it), so this is pure safety:
# it catches accidental drift in tracked TS without ever blocking on the skill.
# Typecheck uses .auto/tsconfig.checks.json (extends the base, includes only
# src/scripts/tests/analysis) so gitignored scratch like probe/ doesn't fail
# tsc — tsc does not respect .gitignore, but biome and bun test do.
bun --bun tsc --noEmit -p .auto/tsconfig.checks.json
bun test
bun run biome
