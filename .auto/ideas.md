# Ideas backlog — DeepSearchQA skill tuning

## Do first
- [ ] **Iteration 1: mechanical signature-sync** (see `.auto/prompt.md`).
      `include_domains=["cdc.gov"]` → `site:cdc.gov` (2 places); drop `offset`;
      `extraction_mode: "highlights"` → `extraction: "highlights"`. Behavior-neutral.

## High-leverage (try after the sync)
- [ ] **Tool-call budget enforcement.** Production is 28.6 calls/trial vs the
      skill's ≤10. M3 ignores the budget. Make it concrete and early: a hard
      "stop searching after N calls and answer from what you have" + "1 search,
      1-2 contents reads, then answer" for simple single-answer questions.
      Cuts cost ~3× and likely raises F1 (less noise, fewer off-topic reads).
- [ ] **Answer-format discipline for Set Answer.** 584/900 tasks are Set
      Answer (lists). The grader penalizes excessive answers. Push "list each
      item on its own line, no extras" harder.
- [ ] **Read-before-answer rigor.** Skill already says "snippets never count
      as reading." Strengthen: for numeric/date/amount answers (316 Single
      Answer tasks), require a contents read of the authoritative source
      before stating the value.
- [ ] **Zero-result recovery.** New you-search appends zero-result guidance on
      empty hits — make the skill tell M3 to widen the query (drop `site:`,
      broader terms) instead of repeating.

## Truth-check (run when stalled or at session end)
- [ ] **Holdout validation.** `bash .auto/holdout.sh .auto/baseline-skill.md`
      then `bash .auto/holdout.sh skills/you-web/SKILL.md`. Tuned-50 should
      match baseline-50 and ≈ production 0.73. If tuned << baseline, the shard
      overfit — revert to a backed-out commit.
