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
`.auto/eval-shard.jsonl` — **30 moderate-difficulty tasks** (production score
0.3–0.7, mean 0.54, 11 Single + 19 Set Answer — stratified to the ~35% Single
base rate), `random.seed(30)`, fixed for the session. **90 data points per run**
(30×k=3) — 6× more signal than the prior 5-task shard (15 points), enough to
distinguish a real gain from the ~0.047 M3 noise floor.

**Why 30, not 5:** the prior 5-task shard was conclusively untrustworthy — **3/3
shard-wins failed to generalize** to the 50-task holdout (iter1-v2 +0.14, iter6
+0.078, iter7 +0.107 all overfit/noise). A 5-task shard's primary metric is not a
valid signal. The 30-task shard is the methodology fix: enough tasks that a real
improvement is measurable, still moderate-difficulty (real headroom, 0.3–0.7).
The model never sees `metadata.expected_answer` (only the grader does); the
50-task holdout remains the generalization truth-check.

~8.5 min/iter at concurrency 6. Previous 5-task shard is at
`.auto/eval-shard-v2-5task.jsonl.bak`.

## Holdout (truth-check, run when stalled or at session end)
`.auto/holdout.sh [skillPath]` runs 50 held-out tasks (disjoint from the shard,
`.auto/holdout-shard.jsonl`) × k=3 on a given skill (~5–13 min). Compare:
  `bash .auto/holdout.sh .auto/baseline-skill.md`   (pre-tuning baseline)
  `bash .auto/holdout.sh skills/you-web/SKILL.md`    (tuned)
If tuned-50 ≈ baseline-50 and ≈ production 0.73, no overfit. If tuned-50 <<
baseline-50, the shard overfit — back out. `.auto/baseline-skill.md` is the
pre-sync skill snapshot.

## CONCLUSION — final skill = signature-sync only (the "synced" skill)

**The tuning run did NOT produce a generalizable skill-text improvement.** The
Phase 4 "no extras" discipline (iter1-v2) scored +0.14 on the 5-task hard shard
(5.5× shard-confidence) but **did NOT generalize** to the 50-task holdout —
that gain was overfit to the shard. The skill was reverted to the synced state.

**Honest before/after on the SAME 50 holdout tasks (×k=3):**
| metric | SYNCED (ref) | iter1-v2 (tuned) |
|-------|-------------|------------------|
| completed-trial F1 | 0.7884 (139) | 0.7875 (134) — **tied** |
| all-trial F1 | 0.7306 | 0.7035 (slightly worse) |
| timeouts | 3 | 8 (5 extra, different tasks) |
| calls/trial | 20.21 | 17.28 |

iter1-v2's stricter answer discipline made the model **over-search to nail the
exact set** on 5 set-enum tasks → timeouts where synced's lighter wording
completed. The +0.14 shard gain was specific to those 5 tasks, not a real
improvement. This is the overfitting risk from a 5-task shard — the loop's shard
metric was actively misleading (it would keep re-applying the overfit change).

**Kept**: the mechanical signature sync (iter-1) — aligns the skill to the
current you-search surface (`site:` operator, drop `offset`, `extraction`
enum). This is a clear correctness fix with no downside (the stale params were
silently zod-stripped before, so `site:` filtering was broken).

**Reverted**: Phase 4 "no extras" answer discipline + concrete tool budget
(iter1-v2). Defensible idea (reduces excessive answers) but overfit the shard;
neutral-to-slightly-worse on the real distribution.

## Final state
- `skills/you-web/SKILL.md` = synced skill (signature sync only).
- The 4 sync edits: `include_domains`→`site:`, drop `offset`, `extraction_mode`→`extraction`.
- iter1-v2 (the overfit shard-winner) is preserved at commit a7700ae for reference.
