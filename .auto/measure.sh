#!/usr/bin/env bash
set -euo pipefail

# DeepSearchQA skill-tuning benchmark for MiniMax M3.
# Runs .auto/eval-shard.jsonl (5 tasks x k=3) through the pi-native harness
# (src/adapter.ts loads skills/you-web/SKILL.md, model minimax/minimax-m3,
# thinkingLevel medium), then src/grader.ts (temp-0 LLM judge, F1 over gold).
# Emits: METRIC deepsearchqa_avg, deepsearchqa_pass_rate, tool_calls_per_trial.
# Required env: OPENROUTER_API_KEY, YDC_API_KEY.

MODEL="minimax/minimax-m3"
PROVIDER="openrouter"
THINKING_LEVEL="medium"
K=3
CONCURRENCY=6
SHARD=".auto/eval-shard.jsonl"
RUNS_DIR=".auto/runs"
ADAPTER_TIMEOUT_MS=600000
GRADER_TIMEOUT_MS=240000

if [ -n "${AUTO_ITERATION:-}" ]; then
  ITER="$AUTO_ITERATION"
elif [ -f .auto/iter-counter ]; then
  ITER="$(cat .auto/iter-counter)"
else
  ITER=0
fi
echo "$((ITER+1))" > .auto/iter-counter
LABEL="dsqa-skill-iter-${ITER}"

mkdir -p "$RUNS_DIR"
RAW="${RUNS_DIR}/raw-${LABEL}.jsonl"
GRADED="${RUNS_DIR}/graded-${LABEL}.jsonl"

# Step 1: run the adapter on the shard (auto-loads skills/you-web/SKILL.md).
RUN_INPUT=$(cat <<EOF
{
  "mode": "run",
  "tasksPath": "$SHARD",
  "adapter": {
    "command": ["bun", "run", "src/adapter.ts"],
    "timeoutMs": $ADAPTER_TIMEOUT_MS,
    "maxOutputBytes": 1000000,
    "config": { "model": "$MODEL", "provider": "$PROVIDER", "thinkingLevel": "$THINKING_LEVEL" }
  },
  "k": $K,
  "concurrency": $CONCURRENCY,
  "label": "$LABEL"
}
EOF
)
bunx agent-eval-harness eval "$RUN_INPUT" > "$RAW"
echo "Raw: $(wc -l < "$RAW") trials" >&2

# Step 2: grade with the DeepSearchQA answer grader (id: deepsearchqa-answer).
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
echo "Graded: $(wc -l < "$GRADED") trials" >&2

# Step 3: emit METRIC lines (skip ungradable — mirrors the adjusted metric).
python3 - "$GRADED" <<'PY'
import json, sys
graded = sys.argv[1]
total = 0.0; count = 0; passes = 0; calls = 0
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
        if score is None:
            score = row.get('score', 0)
        if not gradable:
            continue
        s = float(score)
        total += s; count += 1
        if s >= 0.8: passes += 1
        proc = row.get('process') or {}
        calls += int(proc.get('toolCallCount', 0) or 0)
avg = total / count if count else 0.0
pr = passes / count if count else 0.0
tcpt = calls / count if count else 0.0
print(f'METRIC deepsearchqa_avg={avg:.6f}')
print(f'METRIC deepsearchqa_pass_rate={pr:.6f}')
print(f'METRIC tool_calls_per_trial={tcpt:.2f}')
print(f'[iter] trials={count} pass={passes} avg={avg:.4f} passRate={pr:.4f} toolCalls/trial={tcpt:.2f}', file=sys.stderr)
PY
