#!/usr/bin/env bash
set -euo pipefail
# One-shot generalization truth-check. Runs 50 held-out tasks (disjoint from
# .auto/eval-shard.jsonl) x k=3 on a given skill and prints metrics.
# Usage:  bash .auto/holdout.sh [skillPath]   (default: skills/you-web/SKILL.md)
# Compare pre-tuning vs tuned:
#   bash .auto/holdout.sh .auto/baseline-skill.md
#   bash .auto/holdout.sh skills/you-web/SKILL.md
# Required env: OPENROUTER_API_KEY, YDC_API_KEY.

SKILL="${1:-skills/you-web/SKILL.md}"
MODEL="minimax/minimax-m3"
PROVIDER="openrouter"
THINKING_LEVEL="medium"
K=3
CONCURRENCY=6
SHARD=".auto/holdout-shard.jsonl"
RUNS_DIR=".auto/runs"
ADAPTER_TIMEOUT_MS=600000
GRADER_TIMEOUT_MS=240000
LABEL="holdout-$(basename "$SKILL" .md)"

mkdir -p "$RUNS_DIR"
RAW="${RUNS_DIR}/raw-${LABEL}.jsonl"
GRADED="${RUNS_DIR}/graded-${LABEL}.jsonl"

RUN_INPUT=$(cat <<EOF
{
  "mode": "run",
  "tasksPath": "$SHARD",
  "adapter": {
    "command": ["bun", "run", "src/adapter.ts"],
    "timeoutMs": $ADAPTER_TIMEOUT_MS,
    "maxOutputBytes": 1000000,
    "config": { "model": "$MODEL", "provider": "$PROVIDER", "thinkingLevel": "$THINKING_LEVEL", "skillPath": "$SKILL" }
  },
  "k": $K,
  "concurrency": $CONCURRENCY,
  "label": "$LABEL"
}
EOF
)
bunx agent-eval-harness eval "$RUN_INPUT" > "$RAW"
echo "Raw: $(wc -l < "$RAW") trials" >&2

GRADE_INPUT=$(cat <<EOF
{
  "mode": "grade",
  "trialsPath": "$RAW",
  "concurrency": $CONCURRENCY,
  "graders": [
    {"id": "process", "type": "process", "weight": 0.1},
    {"id": "deepsearchqa-answer", "type": "command", "when": "completed", "weight": 1,
     "options": {"command": ["bun", "run", "src/grader.ts"], "output": "grader_json", "timeoutMs": $GRADER_TIMEOUT_MS, "maxOutputBytes": 500000}}
  ]
}
EOF
)
bunx agent-eval-harness eval "$GRADE_INPUT" > "$GRADED"

python3 - "$GRADED" "$SKILL" <<'PY'
import json, sys
graded, skill = sys.argv[1], sys.argv[2]
total = count = passes = calls = 0
with open(graded) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        row = json.loads(line)
        score = None; gradable = True
        for g in row.get('graderResults', []):
            if g.get('id') == 'deepsearchqa-answer':
                score = g.get('score')
                oc = g.get('outcome') or {}
                gradable = oc.get('gradable', True)
                break
        if score is None: score = row.get('score', 0)
        if not gradable: continue
        s = float(score); total += s; count += 1
        if s >= 0.8: passes += 1
        proc = row.get('process') or {}
        calls += int(proc.get('toolCallCount', 0) or 0)
avg = total / count if count else 0.0
pr = passes / count if count else 0.0
tc = calls / count if count else 0.0
print(f'HOLDOUT skill={skill}')
print(f'  trials={count} pass={passes} avg={avg:.4f} passRate={pr:.4f} toolCalls/trial={tc:.2f}')
PY
