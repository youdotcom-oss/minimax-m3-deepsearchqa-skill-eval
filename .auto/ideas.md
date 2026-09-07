# Ideas backlog — DeepSearchQA skill tuning

## CONVERGED — iter1-v2 is the answer (5.5× confidence)
Phase 4 "no extras" answer discipline + concrete tool budget. +0.14 F1 on hard
tasks, generalizes (holdout completed-trial 0.787 > production 0.7317), -40% calls.
4 attempts to beat it regressed. See `.auto/prompt.md` for the full table.

## Tried & FAILED (do NOT retry — all hurt recall)
- [x] Output Format filtered-list (iter2-v2): -6%. Over-corrects, drops correct items.
- [x] Phase 4 filter-candidates bullet (iter3-v2): -8%. Active filtering hurts recall.
- [x] Set-enumeration convergence / "1 set search + 1 read" (iter4-v2): -12%.
      Set-enum tasks REQUIRE per-member searches; forcing 1-search loses recall.
- [x] Realistic tool budget + partial-answer (iter5-v2): -11%. Reducing calls costs F1
      (calls and F1 are coupled; 10 calls → 0.80 vs 17 calls → 0.91).

## NOT tried (deferred — would need holdout to measure, shard can't)
- [ ] **Raise adapter timeout** (off-limits `src/adapter.ts` TIMEOUT_MS=600000 →
      higher) to kill the 11% timeout tail on 40+ call set-enum tasks. This is the
      real fix for the timeout tail but it's outside the skill — requires a code
      change to the adapter, not the skill. If the user wants to pursue, it's a
      src/ change (currently off-limits to this tuning loop).
- [ ] **Smarter search that finds all set members in fewer calls WITHOUT recall
      loss** — e.g., a single authoritative-table read that has all members. The
      convergence rule tried this naively (1 broad search) and lost recall because
      the page didn't have all members in one view. A smarter version would need
      to identify the right aggregate source per question type. Hard to express
      generically in a skill; likely needs per-domain heuristics.

## Follow-up (outside this session)
- [ ] Sync the tuned `skills/you-web/SKILL.md` back to the upstream
      `agent-skills/packages/pi/skills/you-web/SKILL.md` (different file — the repo
      skill is bespoke; port the "no extras" discipline + tool-budget wording
      generally). Separate sync step, outside the loop.
- [ ] Run the full holdout on the SYNCED-only skill (clean 50-task all-trial
      baseline) to get the precise iter1-v2 vs synced all-trial delta. The partial
      (90/150) was biased; a full run (~45 min) would nail it.
