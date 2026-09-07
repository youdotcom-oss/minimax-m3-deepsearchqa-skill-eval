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
- [x] Output Format filtered-list: -6% shard. Over-corrects, drops correct items.
- [x] Phase4 filter-candidates bullet: -8% shard. Active filtering hurts recall.
- [x] Set-enum convergence (1 search): -12% shard. Per-member search is necessary.
- [x] Realistic tool budget + partial: -11% shard. Calls and F1 are coupled.

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
