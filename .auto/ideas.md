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

## DEAD END (conclusive): skill-text tuning is EXHAUSTED across ALL 4 phases; hard-subset shards OVERFIT
**4/4 shard-wins FAILED to generalize to the 50-task holdout** — iter1-v2 +0.14,
iter6 +0.078, iter7 +0.107 (all 5-task hard shard), AND iter11 +0.057 (20-task hard
shard, sound mechanism, stable 2-run spread 0.0016). iter11 is the decisive case:
sound mechanism (contents-batching: calls flat, faster wall, no recall loss),
stable across two runs, yet STILL TIED on the holdout (completed 0.798 vs synced
0.788, within noise).

**The overfitting vector is HARD-SUBSET SELECTION, not shard size or mechanism
quality.** A difficulty-filtered shard (prod 0.3-0.7) overfits to that subset's
task mix (hard multi-hop set-enum), so wins don't transfer to the broad
distribution. Both the 5-task AND 20-task hard shards overfit identically.

**On the trustworthy 60-point hard shard (noise ~0.030), every lever is
within-noise or worse:**
- iter9 Phase 2 read-before-re-search: 2-run mean +0.032 (~1x noise), +calls. Within noise.
- iter10 Phase 1 criteria-locking: -0.009 (neutral, within noise).
- iter8 Phase 4 faithfulness (re-test): -0.051, +2 timeouts. HURTS.
- iter11 Phase 2 contents-batching: +0.057 shard (stable) but TIED on holdout.

**ALL FOUR skill phases tested:** Phase 1 (criteria, within-noise), Phase 2
(read-before-re-search within-noise / contents-batch shard-overfit), Phase 4
(filtering/anti-pad/faithfulness, all FAIL), budget/convergence (FAIL — calls
coupled to F1). The skill-text lever is exhausted.

The synced skill (signature sync) is the honest best: 0.7087 on 60 hard-shard
points, **0.7306 all-trial / 0.7884 completed-trial on the 50-task holdout**.
**Do NOT run more skill-text iterations on a hard shard — they overfit.**

## To produce a GENERALIZABLE improvement (would need a bigger eval signal)
- [ ] **Use a RANDOM (not difficulty-filtered) eval shard** of 30-50 tasks reflecting
      the BROAD distribution (easy+hard mix). Proven: hard-subset shards (5-task AND
      20-task, prod 0.3-0.7) BOTH overfit — wins on hard multi-hop set-enum don't
      transfer to single-facet tasks. A representative random sample is the only shard
      that can produce a generalizable signal. (~14 min/iter at 50 tasks; needs
      run_experiment timeout ~1800s due to the set-enum tail.)
- [ ] **Validate every keep on the holdout** (run holdout before keeping), not just
      the shard. 4/4 shard-wins failed holdout; the shard alone is never sufficient.
- [ ] **Raise adapter timeout** (off-limits `src/adapter.ts` TIMEOUT_MS) to kill
      the timeout tail on 40+ call set-enum tasks — the real fix for all-trial F1.
- [ ] **Smarter search** finding all set members in fewer calls WITHOUT recall
      loss (the convergence rule tried this naively and lost recall).
