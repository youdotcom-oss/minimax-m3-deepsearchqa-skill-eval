# autoresearch — you-web skill & rewriter

Autonomous research over the `you-web` skill and the You.com rewriter extension for `minimax/minimax-m3` on Pi / DeepSearchQA. Following the pattern from [karpathy/autoresearch](https://github.com/karpathy/autoresearch): the agent mutates the mutable surfaces, runs a fixed 5-minute experiment on a sampled subset, keeps or discards, and repeats indefinitely.

Repo baseline: 73.17% adjusted F1, 66.67% pass, 2700 trials / 900 tasks, K = 3, thinking medium.

## Phasing

Two phases, run sequentially. The point is to find out how far soft skill instructions get before paying the complexity of hard enforcement.

**Phase 1 — Skill only.** Mutate only `skills/you-web/SKILL.md`. Attempt every lever as a skill instruction first — including L1 highlights and L2 count=30 (tell the model to set them). The rewriter is off (not built or wired yet). Measure both ΔF1 and *compliance*: does the model actually set `extraction_mode` / `count`, stop early, emit Evidence, limit sources? Run the loop until the sample F1 **plateaus**: the best `sample_f1` has not advanced for 8 consecutive experiments. Log which levers the model complies with and which it ignores.

**Phase 2 — Extension.** Build and wire `src/rewriter.ts` (create the file; append its path to `additionalExtensionPaths` in `src/pi-session.ts`; add `assess-complexity` to the adapter `tools` list — this is the one-time harness wiring; do not touch `src/extension.ts`). Take the levers that failed or under-delivered as instructions and enforce them hard: arg-injection levers (L1 `extraction_mode`, L2 `count`) become unconditional, complexity-gated rewrites; behavior levers the model ignored get enforced where feasible (e.g., a read-gate before answering on complex tasks). Continue the loop mutating `src/rewriter.ts` (minor skill tweaks still allowed). The skill keeps only the instructions that proved to work in Phase 1; everything else moves to hard enforcement.

## Setup

Work with the user to:

1. **Agree on a run tag**: propose a tag from today's date (e.g. `aug24`). The branch `autoresearch/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current head.
3. **Read the in-scope files**:
   - `AGENTS.md` — repo guidance (Bun, ClickHouse-local, read-only queries, no external listeners).
   - `skills/you-web/SKILL.md` — **mutable surface 1** (the skill). Active in Phase 1.
   - `src/extension.ts` — the fixed You.com MCP proxy. Read-only.
   - `src/adapter.ts`, `src/pi-session.ts` — the harness. Read to understand session/extension/tool loading.
   - `src/grader.ts`, `src/results.ts` — grading + export (the ground-truth metric).
   - `analysis/findings.md` — prior analysis motivating the seed levers.
   - (`src/rewriter.ts` — **mutable surface 2**, created at the Phase 1→2 transition; not needed for Phase 1.)
4. **Build the sample runner** if absent: a fixed eval script (e.g. `scripts/run-sample.ts`) that loads the 40-task sample, runs the adapter with concurrency, grades, and prints the metrics summary. Ground-truth eval — once built, do not modify it during the loop.
5. **Verify the sample**: the fixed 40-task stratified sample from `prompts.jsonl` exists or is generated (see "Fixed sample").
6. **Initialize results.jsonl**: create empty `.auto/results.jsonl` (one JSON object per experiment, appended). Baseline is recorded after the first run. Leave it untracked (do not commit).
7. **Confirm and go.** Start in Phase 1 (skill only).

## The two mutable surfaces

Two surfaces total, activated by phase (see Phasing): Phase 1 edits only the skill; Phase 2 adds the rewriter. Everything else is fixed.

**Surface 1 — `skills/you-web/SKILL.md`** (soft). Edits steer the model through instructions: stop-early guidance, required Evidence section, cite-only-read-URLs, two-sources-sufficient, read-before-answering on hard questions, and even "set extraction_mode=highlights / count=30 for complex questions." The model may or may not comply (it ignores `count=30` today), so measure rather than assume.

**Surface 2 — `src/rewriter.ts`** (hard, Phase 2). The rewriter subscribes to the `tool_call` event for `you-search` and mutates `event.input` in place before `src/extension.ts` proxies to the You.com MCP. Pi guarantees mutations affect the actual tool execution. It also registers the `assess-complexity` tool and holds the per-session complexity score that gates enforcement. Read its policy (active levers, threshold, default-when-no-score) from an env var or config object so you can toggle per experiment without touching the harness.

`assess-complexity` tool contract (registered by the rewriter):
- input: `{ score: int 1-5, rationale: string }`
- side effect: stores the score in per-session extension state.
- output: an ack string (no instruction injection; enforcement lives in the `tool_call` handler).

`you-search` rewriter (`tool_call` handler):
- on each `you-search` call, read the stored complexity score and the run policy.
- L1 (complexity-gated): if `score >= threshold`, set `event.input.extraction_mode = "highlights"`; else leave it.
- L2 (default-count sweep): set `event.input.count` to the configured swept value when the model omits it (simulating a changed MCP default); optionally override specified counts too, for a clean sweep.
- never block; only mutate.

## What you CAN do

- Edit the surface(s) active in the current phase: Phase 1 → `skills/you-web/SKILL.md` only; Phase 2 → `src/rewriter.ts` (minor skill tweaks still allowed). Everything in the active surface is fair game.
- Use the existing query/analysis layer (`bun run query`, `analysis/`) to inspect trajectories and verify compliance between experiments.

## What you CANNOT do

- Modify `src/extension.ts`, `src/adapter.ts`, `src/pi-session.ts`, `src/grader.ts`, `src/results.ts`, the sample runner, or any other harness file during the loop (the one-time Phase 2 rewriter wiring is the only exception).
- Modify the evaluation metric or the judge. `src/grader.ts` is the ground truth.
- Install new packages or add dependencies.
- Start ClickHouse listeners or query remote URLs from ClickHouse (per `AGENTS.md`).
- Edit `skills/you-web/SKILL.md` on `main` — mutations live on the `autoresearch/<tag>` branch; only full-eval-confirmed changes merge to `main`.
- Jump to Phase 2 before Phase 1 plateaus — find out how far instructions go first.

## The goal

**Maximize sample adjusted F1** on the fixed 40-task sample, within guardrails. Higher is better. The first run is always the baseline (current skill, rewriter off).

A change is a **keep** only if ALL hold:
- `ΔF1 ≥ +1pp` vs the current best on the sample.
- `avg tokens/trial ≤ 1.3x` the baseline-sample tokens (unconditional highlights ~2x tokens; this forces the complexity gate to earn its keep).
- `avg search rounds/trial ≤` the baseline-sample rounds.

**Simplicity criterion**: all else equal, simpler is better. A +0.2pp gain that adds 20 lines of hacky rewriter logic is not worth it; a +0pp change that simplifies the skill is a keep. Removing instruction cruft that holds F1 is a win.

**Compliance log** (Phase 1): for each lever, record whether the model actually did what the instruction asked (set extraction_mode/count, stopped early, emitted Evidence, capped sources). This log drives which levers escalate to the rewriter in Phase 2.

## Fixed sample

- Deterministic stratified sample of **N = 40 tasks** from `prompts.jsonl`, held constant across all experiments so they are directly comparable.
- Stratify by `answer_type` (Single / Set) × difficulty proxy (`expectedCount`: 1 / 2 / 3+), top-k per stratum by `cityHash64(taskId)`.
- **K = 1** for the loop (speed); confirm winners at K = 3 in the full eval.
- Exclude the 4 ungradable tasks.

## Experiment budget

Each experiment runs in a **fixed 5-minute wall budget** (300s) for generate + grade + score on the 40-task sample. Tune concurrency so generate ≤ ~200s, grade ≤ ~80s, score ≤ ~20s. If over 300s, reduce N to 25-30. If a run exceeds 10 minutes, kill it and treat as failure.

## Seed experiment ideas

In Phase 1, attempt every lever as a skill instruction. Levers marked → extension are the prime candidates to escalate to the rewriter in Phase 2 if the model ignores them.

- **L1 Force highlights, complexity-gated** (→ extension: arg injection): instruct the model to set `extraction_mode: "highlights"` on `you-search` for complex questions; escalate to rewriter injection if compliance is low. Evidence: BrowseComp +10pp same-backend; this repo's over-rounding-hurts finding. ~2x tokens → gate to the hard subset. Lead lever; calibrate threshold at 3 and 4.
- **L2 Default-count sweep** (→ extension: arg injection, MCP simulation): the You.com MCP defaults `count` to 10, and the model's explicit choices cluster at 6–10, so observationally nearly every search runs at count≈10. 3b found no score effect — but only within that 6–10 band; counts of 20 / 30 / 50 are unexplored in the data. Use the rewriter to inject a fixed default `count` on searches where the model omits it (faithfully simulating a changed MCP default) and sweep values (e.g. 10 / 20 / 30 / 50) to map count→F1. The winner tells us whether to change the MCP default itself — the MCP is a change surface, and the rewriter simulates candidate MCP changes before we touch it. Phase 1 first tries instructing `count=30` (expect near-zero compliance, per 3a); Phase 2 runs the sweep by injection.
- **L3 Stop-early / round cap** (skill): "stop as soon as the answer is supported by read evidence; the 10-call ceiling is a maximum, not a target." Evidence: 5+ rounds 0.65 vs 0.84 at 1; failing trials +65% rounds. Cost-negative.
- **L4 Read before answering on hard/multi-part** (skill, → extension: read-gate): read at least one page before answering multi-part questions; escalate to a rewriter read-gate if ignored. Evidence: 0-reads worst on 3+ part (0.64) vs 1-2 reads (0.80).
- **L5 Required Evidence + cite-only-read-URLs** (skill): all three sections required; only cite URLs read via `you-contents`. Evidence: Evidence section in 5 of ~2,500; 646 cited more than read.
- **L6 Two sources usually sufficient** (skill): two independent sources usually enough; seek a third only on conflict/weakness. Evidence: 2 sources optimal; 3+ worse. Cost-negative.
- **L7 Heed MCP error messages** (skill, → extension: error-result augmentation): when a you-search/you-contents call returns an error (validation/422, rate-limit/429, quota/402), read the error, diagnose it, and change the next call — never re-issue the arguments that just failed. For validation errors, restructure (query, include_domains, language, offset, safesearch belong at the top level; `extraction` holds only `extraction_mode` and `full_page`). Evidence: trace `deepsearchqa-274` ignored clear validation errors and re-issued malformed (query-nested-under-`extraction`) calls for ~9 rounds; the 13 trials with malformed nesting pass 0% at 8.69 avg rounds vs 63% / 5.06 for well-formed. Broader than the nesting bug — applies to any MCP error. Tentative note: a trace scan finds MCP errors in 357/2667 trials (13.4%); the 286 that resume searching grind to 8.63 avg rounds and pass 23% vs 68.6% with no error — a possible error-induced over-rounding pattern, but the sample is modest and difficulty-confounded (error trials run more searches → more rate-limit exposure), so treat as a Phase 1 hypothesis to test, not a confirmed lever. Phase 1: skill instruction; Phase 2 escalation if still flailing: rewriter augments the error `tool_result` with an explicit fix directive, or blocks repeated identical failing args.

- **L8 Incremental query refinement** (skill): before each new search, state what you already know and what specific gap the next query fills — don't rewrite queries from scratch each round as if starting over. Evidence: 6b finds query common-prefix overlap near zero across all trials; FAIL trials expand queries (+13 chars first→last vs +8 for PASS) rather than narrowing; 6a finds reasoning depth drops 35% from round 3 onward — the model loses accumulated context and treats each round as a fresh search. Cost-negative.

- **L9 Domain-switching** (skill): if you've read two pages from the same domain without finding the answer, switch domains on the next search rather than re-searching within it. Evidence: 6b finds heavy re-reading (repetition ratio >1.5) is 4.3× more likely in the low-read 1–2 band for FAIL (5.6% vs 1.3%); 6c finds FAIL reads 7.0 vs 4.3 times per trial in late rounds but with fewer URLs per call — granular re-sampling of the same domains. Cost-negative.

- **L10 Pause and synthesize** (skill): after 2–3 reads, pause and state what you've learned before reading more — don't accumulate pages without integrating findings. Evidence: 6c finds FAIL reads more frequently in late rounds (7.0 vs 4.3 reads per trial) with fewer URLs per call (1.63 vs 1.76), suggesting scattered granular reading without synthesis; 6a finds FAIL assistant messages are 35% shorter from round 3 — shallow deliberation alongside high-volume reading. Complements L4 (read-before-answer). Cost-negative.

Suggested order: L1 (calibrate threshold) → L2 (sweep 10 / 20 / 30 / 50) → L3, L5, L6, L7, L8, L9, L10 (cost-negative) → L4 (interacts with the L1 gate). Then compose winners and re-test.

## Output format

The sample runner prints a summary:

```
---
sample_f1:        0.7317
avg_tokens:       12345
avg_rounds:       5.0
avg_latency_s:    82.5
n_gradable:       38
```

Extract the key metrics:

```
grep "^sample_f1:\|^avg_tokens:\|^avg_rounds:" .auto/run.log
```

## Logging results

Append one JSON object per experiment to `.auto/results.jsonl`. JSONL over TSV: the repo is JSONL-first, the per-experiment record carries nested compliance + guardrail data that TSV can't express cleanly, and the existing ClickHouse query layer reads JSONL for free (best-so-far, plateau detection, trends all fall out of a query). Leave it untracked (do not commit).

Schema (one object per line):

```
{
  "commit": "a1b2c3d",            // short git hash
  "phase": "p1",                  // "p1" | "p2"
  "ts": "2026-08-24T03:12:00Z",   // ISO timestamp
  "status": "keep",               // "keep" | "discard" | "crash"
  "description": "baseline (skill only, rewriter off)",
  "sample_f1": 0.7317,            // 0.0 for crashes
  "avg_tokens": 12345,            // 0 for crashes
  "avg_rounds": 5.0,              // 0.0 for crashes
  "avg_latency_s": 82.5,
  "n_gradable": 38,
  "guardrails": { "tokens_ratio": 1.0, "rounds_ratio": 1.0, "pass": true },  // baseline-normalized; omit on crash
  "compliance": {                 // Phase 1; null when the lever wasn't instructed this run, else a 0..1 rate or bool
    "highlights": null, "count": null, "stop_early": 0.4,
    "evidence": 0.2, "two_sources": 0.6, "read_on_hard": null
  }
}
```

Examples:

```
{"commit":"a1b2c3d","phase":"p1","ts":"2026-08-24T03:12:00Z","status":"keep","description":"baseline (skill only, rewriter off)","sample_f1":0.7317,"avg_tokens":12345,"avg_rounds":5.0,"avg_latency_s":82.5,"n_gradable":38,"guardrails":{"tokens_ratio":1.0,"rounds_ratio":1.0,"pass":true},"compliance":{"highlights":null,"count":null,"stop_early":null,"evidence":null,"two_sources":null,"read_on_hard":null}}
{"commit":"b2c3d4e","phase":"p1","ts":"2026-08-24T03:21:00Z","status":"keep","description":"L3 stop-early skill text","sample_f1":0.742,"avg_tokens":12400,"avg_rounds":4.6,"avg_latency_s":76.1,"n_gradable":38,"guardrails":{"tokens_ratio":1.0,"rounds_ratio":0.92,"pass":true},"compliance":{"highlights":null,"count":null,"stop_early":0.4,"evidence":null,"two_sources":null,"read_on_hard":null}}
{"commit":"e5f6a7b","phase":"p2","ts":"2026-08-24T05:02:00Z","status":"crash","description":"rewriter threw on missing score","error":"TypeError: cannot read score of undefined"}
```

## The experiment loop

LOOP FOREVER:

1. Look at the git state: current branch/commit, current phase.
2. Edit the active surface(s) with an experimental idea (Phase 1: `skills/you-web/SKILL.md`; Phase 2: `src/rewriter.ts`, minor skill tweaks allowed).
3. git commit.
4. Run the experiment: `bun run analysis:sample > .auto/run.log 2>&1` (redirect everything — do NOT flood your context).
5. Read the results: `grep "^sample_f1:\|^avg_tokens:\|^avg_rounds:" .auto/run.log`.
6. If the grep is empty, the run crashed. `tail -n 50 .auto/run.log` for the stack trace; fix trivial bugs and re-run, or log `crash` and move on.
7. (Phase 1) Update the compliance log: did the model actually do what the instruction asked? Inspect the trajectory via the query layer if needed.
8. Append the result to `.auto/results.jsonl` (do not commit the file).
9. If `ΔF1 ≥ +1pp` AND tokens ≤ 1.3x baseline AND rounds ≤ baseline → **keep**: advance the branch (keep the commit).
10. Else → **discard**: `git reset --hard` to where you started.
11. **Plateau check (Phase 1)**: if the best `sample_f1` has not advanced for 8 consecutive experiments, transition to Phase 2 — build/wire `src/rewriter.ts` (see Phasing) and move the levers the model ignored into hard enforcement.
12. Next idea. Combine kept winners; re-test compositions. Iterate until no single change or composition improves.

**Timeout**: if a run exceeds 10 minutes, kill it and treat as failure (discard + revert).

**Crashes**: fix trivial bugs and re-run; if the idea is fundamentally broken, log `crash` and move on.

**NEVER STOP**: once the loop has begun, do not pause to ask the human. The human may be asleep. You are autonomous. If you run out of ideas, think harder — re-read `analysis/findings.md`, re-read the skill, combine near-misses, try more radical changes. The loop runs until the human interrupts you. At ~5 min/experiment, that's ~12/hour, ~100 overnight.

## Validation gate (full eval)

Surviving winners from both phases get promoted to **one** full eval run: 2700 trials, K = 3, matched config (thinking medium, concurrency 3, same judge), vs the 73.17% baseline. Only full-eval-confirmed changes merge to `main` (skill edits to `skills/you-web/SKILL.md`, rewriter to `src/rewriter.ts`). `src/extension.ts` is never modified. The loop is for exploration; the full run is the source of truth.

## Open questions / calibration

- Complexity threshold for L1/L4: calibrate at 3 and 4 on the sample.
- Do highlights help easy tasks too? BrowseComp only tests hard; verify on the easy stratum.
- Judge cost in the 5-min budget; may need a second slot or a cheaper loop-only judge (keep the canonical judge for full eval).
- Which behavior levers are feasibly enforceable via the rewriter: arg injection covers L1/L2; a read-gate might cover L4; error-result augmentation or blocking repeated failing args covers L7; L3/L5/L6/L8/L9/L10 may not be mechanically enforceable and stay skill-only (or get dropped).
