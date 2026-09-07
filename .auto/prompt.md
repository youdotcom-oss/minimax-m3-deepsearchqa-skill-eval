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
- Must pass `bun run check` (typecheck + test + biome) — the correctness gate in
  `.auto/checks.sh`. `skills/you-web/SKILL.md` is markdown, which biome ignores, so
  the gate is pure safety: it catches any accidental drift in off-limits TS files
  without ever blocking on the skill itself.
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
`.auto/eval-shard.jsonl` — **5 moderate-difficulty tasks** (production score
0.3–0.65, 2 Single + 3 Set Answer), `random.seed(7)`, fixed for the session.
These have real headroom (production 0.33–0.56 → ceiling 1.0), unlike the
original seed-42 shard which was near-saturated (4/5 at 1.0 — tuning it mostly
chased noise on 2 stochastic leaks). Moderate-task selection is standard
hard-example tuning, not overfitting: the model never sees `metadata.expected_answer`
(only the grader does). The holdout (50 tasks) is the generalization truth-check.
Previous seed-42 shard baseline was 0.83; this hard shard will baseline much
lower (~0.4–0.5) with real room to improve.

## Holdout (truth-check, run when stalled or at session end)
`.auto/holdout.sh [skillPath]` runs 50 held-out tasks (disjoint from the shard,
`.auto/holdout-shard.jsonl`) × k=3 on a given skill (~5–13 min). Compare:
  `bash .auto/holdout.sh .auto/baseline-skill.md`   (pre-tuning baseline)
  `bash .auto/holdout.sh skills/you-web/SKILL.md`    (tuned)
If tuned-50 ≈ baseline-50 and ≈ production 0.73, no overfit. If tuned-50 <<
baseline-50, the shard overfit — back out. `.auto/baseline-skill.md` is the
pre-sync skill snapshot.

## What's Been Tried

**Shard v1 (seed-42, 5 easy tasks):** baseline 0.83 (0.8308 loop / 0.8778
manual). Near-saturated — 4/5 tasks at 1.0; only stochastic leaks (115: 7
excessive authors; 762: wrong-answer on France). Tuning it chased noise.
  - iter-1: mechanical signature-sync (site:, drop offset, extraction). 0.7974
    (within 0.047 noise). KEPT — correctness baseline (site: now functional).
  - iter-2: tighter Phase 4 + tool budget. 0.8308 (equal baseline, noise) +
    checks_failed on probe/ scratch (env fixed). DISCARDED.

**Shard v2 (seed-7, 5 hard tasks, prod 0.33–0.56):** re-baselining now.
Headroom is real (Set-Answer excessive leaks + Single-Answer correctness).

| # | Change | Score | Δ% | Verdict |
|---|--------|-------|----|---------|
| 0v1 | baseline (stale skill, easy shard) | 0.8308 | — | reference (v1) |
| 1 | signature-sync | 0.7974 | -4% | kept (correctness) |
| 2 | Phase4+tool budget | 0.8308 | 0% | checks_failed (env) |
| 0v2 | baseline (synced skill, hard shard) | TBD | — | next |

## Key Learnings
- Easy shard (v1) is near-saturated → noise-dominated, useless for tuning.
  Switched to hard shard (v2) for real headroom.
- Real F1 leaks observed: (a) **excessive answers** on Set Answer (115: 7 extra
  names alongside 3 correct → F1 0.46); (b) **wrong-answer** on hard Single
  (762: excluded France on bad reasoning). Answer-discipline targets (a);
  (b) is a search/correctness issue, harder to fix with skill text.
- `probe/` gitignored scratch appears mid-session and breaks full-project tsc;
  checks.sh now scopes typecheck to tracked src via .auto/tsconfig.checks.json.
