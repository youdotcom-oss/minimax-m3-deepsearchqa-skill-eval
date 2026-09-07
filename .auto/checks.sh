#!/usr/bin/env bash
set -euo pipefail
# Correctness gate for the tuning loop. The only in-scope edit is
# skills/you-web/SKILL.md (markdown — biome ignores it), so the meaningful
# gates are typecheck (TS still compiles) + test (scoring/io tests pass).
# biome is skipped: a pre-existing unused-var lint in scripts/query.ts would
# otherwise block every keep on noise unrelated to the skill.
bun run typecheck
bun test
