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

## DEAD END (conclusive): skill-text tuning is EXHAUSTED across ALL 4 phases on a trustworthy metric
**3/3 shard-wins (iter1-v2 +0.14, iter6 +0.078, iter7 +0.107) FAILED to generalize**
to the 50-task holdout. Then iter7 (answer-faithfulness) was **RE-TESTED on a
trustworthy 20-task / 60-point shard**: it HURTS there too (-0.051, 0.657 vs 0.709,
+2 timeouts). So the 5-task +0.107 was overfit/noise, now confirmed on a metric that
can distinguish real from noise.

**On the trustworthy 60-point shard (noise floor ~0.030), every remaining lever is
within-noise or worse:**
- **iter9 Phase 2 read-before-re-search**: 2-run mean 0.741 vs 0.709 = +0.032 (~1x noise), +calls. Within noise.
- **iter10 Phase 1 criteria-locking**: 0.700 vs 0.709 = -0.009 (neutral, within noise).

**ALL FOUR skill phases now tested on the trustworthy metric:** Phase 1 (criteria,
within-noise), Phase 2 (read-before-re-search, within-noise), Phase 4 (filtering /
anti-pad / faithfulness, all FAIL — recall loss or timeouts), Tool budget /
convergence (FAIL — calls coupled to F1). Every skill-text lever either overfits the
small shard, costs recall, costs time/timeout, or is within noise.

The synced skill (signature sync) is the honest best: 0.7087 on 60 points, 0.7306
all-trial / 0.7884 completed-trial on the 50-task holdout. **The skill-text lever is
exhausted — do NOT run more skill-text iterations; they are noise-chasing.** The only
real remaining F1 lever is the OFF-LIMITS adapter timeout (kills the stochastic 0-score
timeout tail on 40+ call multi-hop tasks).

## To produce a GENERALIZABLE improvement (would need a bigger eval signal)
- [ ] **Use a larger eval shard** (≥30-50 tasks, not 5) so the loop's primary
      metric reflects the real distribution and can't overfit 5 tasks. A 5-task
      shard is too small for skill tuning — it overfits. (The hard-shard switch
      helped find the excessive-answer LEVER but couldn't validate generalization.)
- [ ] **Validate every keep on the holdout** (run holdout before keeping), not just
      the shard. The shard alone misled (kept an overfit change). The holdout is
      the truth but slow (~45-70 min); a faster/smaller holdout (20×k2) per keep
      would catch overfitting.
- [ ] **Raise adapter timeout** (off-limits `src/adapter.ts` TIMEOUT_MS) to kill
      the timeout tail on 40+ call set-enum tasks — the real fix for all-trial F1.
- [ ] **Smarter search** finding all set members in fewer calls WITHOUT recall
      loss (the convergence rule tried this naively and lost recall).
