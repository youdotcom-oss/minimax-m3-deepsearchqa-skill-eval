# Ideas backlog — DeepSearchQA skill tuning

## OUTCOME: tuning overfit the shard; reverted to signature-sync only
The Phase 4 "no extras" discipline scored +0.14 on the 5-task hard shard
(5.5× shard-confidence) but did NOT generalize to the 50-task holdout
(completed-trial F1 TIED 0.788 vs 0.788; all-trial slightly WORSE due to 5 extra
timeouts from over-searching to nail the exact set). The skill was reverted to the
synced state. See `.auto/prompt.md` CONCLUSION for the full before/after table.

## Tried & FAILED (do NOT retry on a 5-task shard — all overfit or hurt recall)
- [x] Phase4 "no extras" + tool budget (iter1-v2): +0.14 SHARD but TIED on holdout
      completed-trial, worse all-trial (5 extra timeouts). OVERFIT the shard.
- [x] Output Format filtered-list (iter2-v2): -6% shard. Over-corrects, drops correct items.
- [x] Phase4 filter-candidates bullet (iter3-v2): -8% shard. Active filtering hurts recall.
- [x] Set-enum convergence (1 search) (iter4-v2): -12% shard. Per-member search is necessary.
- [x] Realistic tool budget + partial (iter5-v2): -11% shard. Calls and F1 are coupled.
- [x] **Softer Phase4 anti-padding** (iter6): +0.078 SHARD (5.5x shard-confidence) but
      HOLDOUT REJECTED — completed-trial F1 0.748 < synced 0.788 (-0.04), all-trial
      0.7229 < 0.7306. Even softened (no over-search pressure), the 'don't pad with
      extras' nudge hurts recall — the model over-filters and drops correct items.
- [x] **Phase4 answer-faithfulness** (iter7): +0.107 SHARD (3.8x shard-confidence)
      but HOLDOUT REJECTED/TIED — completed-trial 0.7753 vs synced 0.7884 (within
      0.047 noise = tied), all-trial 0.7236 < 0.7306. RE-TESTED on 60-pt shard (iter8):
      HURTS (-0.051, 0.657 vs 0.709, +2 timeouts). The 5-task +0.107 was overfit/noise.
- [x] **Phase 2 read-before-re-search** (iter9): first run +0.047 (looked real), re-run
      0.725. 2-run mean 0.741 vs 0.709 = +0.032 = WITHIN ~0.030 noise (not confirmed).
      +calls (21.4->23.8). Reverted: within-noise + verbosity.
- [x] **Phase 1 criteria-locking** (iter10): 0.700 vs 0.709 = -0.009 (neutral, within
      noise). Targeted wrong-entity-among-candidates failures; planning text didn't move
      the metric. Reverted: within-noise, no benefit.
- [x] **Phase 2 contents-batching 3-5/call** (iter11): +0.057 SHARD, STABLE across 2
      runs (0.7663, 0.7647; spread 0.0016), calls FLAT, faster wall, 0 timeouts — the
      soundest mechanism yet. HOLDOUT TIED (completed 0.798 vs synced 0.788, within
      noise; all-trial 0.724 vs 0.731). 4th shard-win to fail generalization. Reverted.

## DEAD END (revised, honest): skill-text effects are UNRESOLVABLE on a 60-point shard
**17 hypotheses tested** across all 5 phases + 3 framings + simplification, on 2
shard types, holdout-validated. BUT the critical finding: the 60-point random
shard has a **~0.071 noise floor** (synced re-runs 0.7933/0.7224/0.7245), LARGER
than every skill-text delta observed (|0.020|–|0.047|). So:

- **4 hard-shard wins (iter1-v2 +0.14, iter6 +0.078, iter7 +0.107, iter11 +0.057)
  FAILED holdout generalization** — this IS confirmed (holdout is stable).
- **The random-shard 'neutral-to-negative' verdicts (iter13-17) are UNRESOLVABLE** —
  within the 0.071 noise floor; not confirmed regressions, just noise.
- The synced skill (~0.747 random-shard mean; holdout 0.7306 all-trial / 0.7884
  completed-trial) is the best we have. No change beat the noise floor, but none
  were confirmed real regressions either.

**The honest conclusion is NOT 'skill-text tuning failed' — it is 'skill-text
effects below ~0.07 cannot be measured on a 60-point shard.'** Resolving them
needs a much larger eval (>=200 tasks) or 5+ repeated runs per condition.

**Confirmed (stable, holdout-validated):** hard-subset selection overfits (4/4
hard-shard wins failed holdout); the synced skill is the honest best.
**Unconfirmed (within noise):** whether any skill-text change helps or hurts the
broad distribution — the 60-point shard can't tell.

## CRITICAL METHODOLOGY FINDING: the eval metric cannot resolve skill-text effects
The 60-point random shard has a **noise floor of ~0.09** (4 synced-skill re-runs:
0.7933, 0.7224, 0.7245, 0.8112 — mean 0.763, median 0.758, range 0.089; calls also
varied 16.4–19.9). **Every skill-text delta observed in the entire session (max
|0.057|) is WITHIN this noise floor** — none are statistically real. Single-run
keep/discard on a 60-point shard is noise-chasing.

**This reinterprets the whole session honestly:**
- **4 hard-shard wins (iter1-v2 +0.14, iter6 +0.078, iter7 +0.107, iter11 +0.057)
  FAILED holdout generalization** — this IS confirmed (holdout is stable, 50 tasks).
- **All random-shard 'neutral-to-negative' verdicts (iter13-17) are UNRESOLVABLE** —
  within the 0.09 noise floor; not confirmed regressions.
- The 'calls coupled to F1' conclusion is NOT supported at this noise level.
- The synced skill (median 0.758 random-shard; holdout 0.7306 all-trial / 0.7884
  completed-trial) is the best estimate. No change beat the noise floor.

**The honest verdict is NOT 'skill-text tuning failed' — it is 'skill-text effects
below ~0.09 cannot be measured on a 60-point single run.'** To resolve them:
(1) >=200-300 tasks (k=3, ~2-3h/run), or (2) 5+ repeated runs per condition with
median (~2h per condition), or (3) optimize on the 50-task holdout (but it's also
noisy single-run). A 60-point single-run loop is fundamentally underpowered.
