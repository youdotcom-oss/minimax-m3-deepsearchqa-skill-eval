# Autoresearch: DeepSearchQA skill tuning for MiniMax M3

## Objective
Maximize MiniMax M3's DeepSearchQA gold-answer score by tuning the
**`skills/you-web/SKILL.md`** search skill that the eval harness loads. The
skill drives the model's `you-search` + `you-contents` tool behavior on
`google/deepsearchqa` questions. No guardrails on the skill content — just
maximize answer F1.

Production baseline (full 900 tasks × k=3, current skill): **adjusted avgScore
0.7317**, passRate 0.667, but **28.6 tool calls/trial** (the skill says ≤10 — M3
ignores it) at ~31 s/trial. Two levers: answer correctness (F1) and tool-call
efficiency (28.6 → ≤10 cuts cost ~3× and likely raises F1 by reducing noise).

## Metrics
- **Primary**: `deepsearchqa_avg` (F1 0.0–1.0, **higher is better**) — mean
  DeepSearchQA answer F1 across the shard, skipping ungradable trials. This is
  the only metric that decides keep/discard.
- **Secondary**: `deepsearchqa_pass_rate` (F1 ≥ 0.8 rate), `tool_calls_per_trial`
  (monitor the over-calling + cost lever). Secondary metrics never decide.

## How to Run
`./.auto/measure.sh` — runs the 5-task × k=3 shard through the pi-native harness
(`src/adapter.ts` → MiniMax M3 via OpenRouter, then `src/grader.ts` temp-0 LLM
judge), grades, and prints `METRIC deepsearchqa_avg=...`,
`METRIC deepsearchqa_pass_rate=...`, `METRIC tool_calls_per_trial=...`.

The harness loads `skills/you-web/SKILL.md` automatically (adapter default
`skillPath`). Editing that file and re-running `measure.sh` is the whole loop.

Required env: `OPENROUTER_API_KEY` (model + judge), `YDC_API_KEY` (you-search /
you-contents MCP). Both must be set in the shell that runs the session.

## Files in Scope
- **`skills/you-web/SKILL.md`** — the ONLY file the loop modifies. The search
  skill loaded by `src/adapter.ts`. This is the tuning target.

## Off Limits
- Do NOT modify `src/`, `scripts/`, `data/`, `datasets/`, `.minimax/`, `tests/`,
  `bun.lock`, `package.json`, `biome.json`, `tsconfig.json`, or any `.auto/`
  file other than `skills/you-web/SKILL.md`'s contents reflected through measure.
  Specifically: do not edit the grader, adapter, harness, or tasks.
- Do NOT add dependencies.
- Do NOT modify the grading pipeline or the shard files.
- `.minimax/skills/you-web/SKILL.md` is an unreferenced stale copy — leave it.

## Constraints
- Must pass `bun run typecheck` and `bun test` (the correctness gate in
  `.auto/checks.sh`). Note: `bun run biome` has a **pre-existing** unused-`block`
  lint error in `scripts/query.ts` unrelated to this skill, so `checks.sh` runs
  only typecheck + test (biome ignores `skills/you-web/SKILL.md` anyway).
- Keep the skill file concise and faithful to the **current** you-search /
  you-contents tool surface (see "Signature" below).

## Tool signature (you-search, current — MUST stay faithful)
The `you-search` LLM-facing surface is **only**: `query`, `count`, `freshness`,
`extraction` (`none` | `highlights` | `full_page`), `knowledge` (`core`),
`extraction_source` (`cache` | `fetch` | `blend`, only with `full_page`).
Inline operators are mapped server-side: `site:cdc.gov`, `lang:fr`, `loc:DE`.
**Removed from the LLM surface** (do NOT tell the model to pass these — zod
silently strips them): `include_domains`, `exclude_domains`, `offset`,
`extraction_mode` (renamed → `extraction`), `safesearch`, `crawl_timeout`,
`country`, `language`, `livecrawl`.
`you-contents` keeps: `urls`, `formats` (`markdown` | `html` | `metadata`),
`crawl_timeout`.

## Iteration 1 — mechanical signature-sync (do this FIRST, as the baseline)
The current skill is stale against the new you-search surface. Before any
behavioral tuning, make a behavior-neutral sync so the baseline is "skill
matches the tool it drives":
1. `include_domains=["cdc.gov"]` → `site:cdc.gov` inline operator (2 places).
2. `offset` for fresh results → remove (no longer on the surface).
3. `extraction_mode: "highlights"` → `extraction: "highlights"` (1 place).
Do not change behavior/structure in this iteration — just align param names.
Measure to confirm no regression, keep, then iterate freely.

## Shard
`.auto/eval-shard.jsonl` — 5 gradable tasks (3 Single + 2 Set Answer),
`random.seed(42)`, fixed for the whole session. A fixed shard keeps the noise
floor low (M3-generation variance only) so the autoresearch confidence signal is
meaningful (≥2.0× ≈ real improvement). The model never sees
`metadata.expected_answer` (only the grader does), so memorization-overfit is
impossible; the only generalization risk is question-type skew on 5 tasks.

## Holdout (truth-check, run when stalled or at session end)
`.auto/holdout.sh [skillPath]` runs 50 held-out tasks (disjoint from the shard,
`.auto/holdout-shard.jsonl`) × k=3 on a given skill (~5–13 min). Compare:
  `bash .auto/holdout.sh .auto/baseline-skill.md`   (pre-tuning baseline)
  `bash .auto/holdout.sh skills/you-web/SKILL.md`    (tuned)
If tuned-50 ≈ baseline-50 and ≈ production 0.73, no overfit. If tuned-50 <<
baseline-50, the shard overfit — back out. `.auto/baseline-skill.md` is the
pre-sync skill snapshot.

## What's Been Tried

Baseline measured directly (pre-sync current skill, seed-42 shard, 15 trials):
`deepsearchqa_avg=0.8778`, `pass_rate=0.800`, `tool_calls/trial=14.1`.
Note: the shard (0.88) is easier than the full 900 (production 0.7317) — the
loop optimizes within the shard's ~0.12 headroom to 1.0; the holdout is the
truth-check that gains generalize to the harder full distribution.

| # | Change | Score | Δ% | Verdict |
|---|--------|-------|----|---------|
| 0 | baseline (current stale skill, pre-sync) | 0.8778 | — | reference |
| 1 | mechanical signature-sync | TBD | — | next |

## Key Learnings
- Shard baseline 0.8778 at 14.1 calls/trial — already far under production's
  28.6, so the over-calling lever is smaller on this shard than on the full
  900. Headroom is correctness (0.88 → 1.0), not call-count.
- 3/5 shard tasks are Single Answer (numeric/date); 2 are Set Answer (lists).
  Set-Answer excessive-answer penalties are the likely F1 leak — push list
  discipline.
